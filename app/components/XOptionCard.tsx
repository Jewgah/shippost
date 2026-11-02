"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DraftOption } from "@/lib/draftParser";
import { X_LIMIT, splitThread, xComposeUrl, xLength } from "@/lib/xText";
import { PillarTag, ScoreBadge, StarBadge } from "./badges";

// One X option: the post, an optional numbered thread, the first-reply link, and the actions.
// Nothing is posted by the app: "Open in X" hands the text to X's own compose window.

function PostBox({ label, text, openInX }: { label: string; text: string; openInX?: boolean }) {
  const [copied, setCopied] = useState(false);
  const len = xLength(text);
  const over = len > X_LIMIT;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: select manually */
    }
  };
  return (
    <div className="rounded-lg border border-border bg-bg/40">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-semibold text-fg">{label}</span>
        <div className="flex items-center gap-2">
          <span
            className={`font-mono text-[11px] ${over ? "font-semibold text-red-400" : "text-muted"}`}
            title="Counted the way X counts: a link is 23, an emoji is 2"
            aria-live="polite"
          >
            {len}/{X_LIMIT}
          </span>
          {openInX && (
            <a
              href={xComposeUrl(text)}
              target="_blank"
              rel="noopener noreferrer"
              className="cursor-pointer rounded-md border border-border bg-elevated px-2.5 py-1 text-xs text-fg transition hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Open in X
            </a>
          )}
          <button
            type="button"
            onClick={copy}
            className="cursor-pointer rounded-md border border-border bg-elevated px-2.5 py-1 text-xs text-fg transition hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {copied ? "✓ copied" : "copy"}
          </button>
        </div>
      </div>
      <p className="whitespace-pre-line px-3 py-3 text-sm leading-relaxed text-fg/90">{text}</p>
    </div>
  );
}

export default function XOptionCard({
  option,
  date,
  initiallyRejected = false,
}: {
  option: DraftOption;
  date: string;
  initiallyRejected?: boolean;
}) {
  const router = useRouter();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const [posted, setPosted] = useState(false);
  const [rejected, setRejected] = useState(initiallyRejected);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");
  const [editRunning, setEditRunning] = useState(false);

  const thread = splitThread(option.repostCaption);

  const call = async (url: string, body: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, channel: "x" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error || "That did not work, try again.");
      return res.ok ? j : null;
    } catch (e) {
      setErr(String((e as Error).message));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const markPosted = async () => {
    const j = await call("/api/pick", {
      date,
      option: option.n,
      pillar: option.pillar,
      topic: option.topic,
      companyPost: option.companyPost,
      repostCaption: option.repostCaption,
    });
    if (j) setPosted(true);
  };

  const markRejected = async () => {
    const j = await call("/api/reject", { date, option: option.n, pillar: option.pillar, topic: option.topic });
    if (j) setRejected(true);
  };

  const applyEdit = async () => {
    const p = editPrompt.trim();
    if (!p || editRunning) return;
    setErr(null);
    setEditRunning(true);
    const j = await call("/api/edit", { date, option: option.n, prompt: p });
    if (!j || j.started === false) {
      setEditRunning(false);
      if (j) setErr("Another run is in progress, try again shortly.");
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const s = await (await fetch("/api/generate?channel=x", { cache: "no-store" })).json();
        if (s.running) return;
        if (pollRef.current) clearInterval(pollRef.current);
        setEditRunning(false);
        if (s.lastResult?.ok) {
          setEditing(false);
          setEditPrompt("");
          router.refresh();
        } else {
          setErr(s.lastResult?.error || "Edit failed, check x/.run.log in your drafts folder");
        }
      } catch {
        /* transient: keep polling */
      }
    }, 3000);
  };

  const btn =
    "cursor-pointer rounded-md border border-border bg-elevated px-3 py-1.5 text-xs text-fg transition hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <article
      className={`flex h-full flex-col rounded-2xl border border-border bg-surface p-4 ${rejected ? "opacity-50" : ""}`}
    >
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted">Option {option.n}</span>
        {option.star && <StarBadge />}
        <PillarTag pillar={option.pillar} />
        <ScoreBadge score={option.score} />
        <span className="min-w-0 truncate text-sm font-semibold text-fg">{option.topic}</span>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        <PostBox label="Post" text={option.companyPost} openInX />
        {thread.map((t, i) => (
          <PostBox key={i} label={`Thread ${i + 2}/`} text={t} />
        ))}
        {option.firstComment && <PostBox label="First reply (the link)" text={option.firstComment} />}
        {option.why && <p className="text-xs text-muted">Why it works: {option.why}</p>}
      </div>

      {editing && (
        <div className="mt-3 space-y-2">
          <textarea
            value={editPrompt}
            onChange={(e) => setEditPrompt(e.target.value)}
            rows={2}
            maxLength={800}
            aria-label="How should this post change?"
            placeholder="e.g. shorter, punchier hook"
            className="w-full rounded-lg border border-border bg-bg p-2 text-sm text-fg outline-none focus:border-accent"
          />
          <button type="button" className={btn} onClick={applyEdit} disabled={editRunning || !editPrompt.trim()}>
            {editRunning ? "Rewriting…" : "Rewrite"}
          </button>
        </div>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={btn} onClick={markPosted} disabled={busy || posted}>
          {posted ? "✓ logged" : "I posted this"}
        </button>
        <button type="button" className={btn} onClick={() => setEditing((v) => !v)}>
          Edit with AI
        </button>
        <button type="button" className={btn} onClick={markRejected} disabled={busy || rejected}>
          {rejected ? "Not for me ✓" : "Not for me"}
        </button>
        {err && (
          <span role="alert" className="text-xs text-red-400">
            {err}
          </span>
        )}
      </footer>
    </article>
  );
}
