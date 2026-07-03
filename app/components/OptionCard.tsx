"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import type { DraftOption } from "@/lib/draftParser";
import { StarBadge, ScoreBadge, PillarTag } from "./badges";
import ABSection from "./ABSection";
import LinkedInPreview from "./LinkedInPreview";

export default function OptionCard({
  option,
  date,
  brandName,
  hasLogo,
  index,
  bodyScroll = false,
  companyMode = true,
  authorName = "",
  hasAvatar = false,
  initiallyRejected = false,
}: {
  option: DraftOption;
  date: string;
  brandName: string;
  hasLogo: boolean;
  index: number;
  bodyScroll?: boolean;
  companyMode?: boolean;
  authorName?: string;
  hasAvatar?: boolean;
  initiallyRejected?: boolean;
}) {
  const [posted, setPosted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [postErr, setPostErr] = useState<string | null>(null);
  // Seeded from the rejects log so a thumbed-down option stays marked across reloads.
  const [rejected, setRejected] = useState(initiallyRejected);
  const [rejecting, setRejecting] = useState(false);
  const [rejectErr, setRejectErr] = useState<string | null>(null);

  const router = useRouter();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [editing, setEditing] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");
  const [editRunning, setEditRunning] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    []
  );

  const applyEdit = async () => {
    const p = editPrompt.trim();
    if (!p || editRunning) return;
    setEditErr(null);
    setEditRunning(true);
    try {
      const res = await fetch("/api/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, option: option.n, prompt: p }),
      });
      const j = await res.json();
      if (!res.ok || j.started === false) {
        setEditRunning(false);
        setEditErr(j.error || (j.running ? "Another run is in progress — try again shortly." : "Couldn't start the edit."));
        return;
      }
      // poll the shared run state until the rewrite finishes, then refresh the page
      pollRef.current = setInterval(async () => {
        try {
          const s = await (await fetch("/api/generate", { cache: "no-store" })).json();
          if (s.running) return;
          if (pollRef.current) clearInterval(pollRef.current);
          setEditRunning(false);
          if (s.lastResult?.ok) {
            setEditing(false);
            setEditPrompt("");
            router.refresh();
          } else {
            setEditErr(s.lastResult?.error || "Edit failed — check drafts/.run.log");
          }
        } catch {
          /* transient — keep polling */
        }
      }, 3000);
    } catch (e) {
      setEditRunning(false);
      setEditErr(String((e as Error).message));
    }
  };

  const markPosted = async () => {
    setBusy(true);
    setPostErr(null);
    try {
      const res = await fetch("/api/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          option: option.n,
          pillar: option.pillar,
          topic: option.topic,
          companyPost: option.companyPost,
          repostCaption: option.repostCaption,
        }),
      });
      if (res.ok) {
        setPosted(true);
      } else {
        const j = await res.json().catch(() => ({}));
        setPostErr(j.error || "Couldn't save this pick — try again.");
      }
    } catch (e) {
      setPostErr(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  // Thumbs-down: logs the option so future generations avoid this angle. Not added to the
  // voice corpus (rejects teach the engine what NOT to write).
  const markRejected = async () => {
    setRejecting(true);
    setRejectErr(null);
    try {
      const res = await fetch("/api/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, option: option.n, pillar: option.pillar, topic: option.topic }),
      });
      if (res.ok) {
        setRejected(true);
      } else {
        const j = await res.json().catch(() => ({}));
        setRejectErr(j.error || "Couldn't save this — try again.");
      }
    } catch (e) {
      setRejectErr(String((e as Error).message));
    } finally {
      setRejecting(false);
    }
  };

  // Delete this single option from the draft. If it was the last one, the whole package is gone
  // server-side, so we leave the draft page rather than refresh into a 404.
  const deleteOption = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteErr(null);
    try {
      const res = await fetch(`/api/drafts/${date}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ option: option.n }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleting(false);
        setDeleteErr(j.error || "Couldn't delete this option.");
        return;
      }
      if (j.draftDeleted) router.push("/"); // last option removed — the package no longer exists
      else router.refresh(); // re-render the carousel without this option
    } catch (e) {
      setDeleting(false);
      setDeleteErr(String((e as Error).message));
    }
  };

  const showLogoThumb = hasLogo && /logo/i.test(option.visual);
  const reduce = useReducedMotion();

  return (
    <motion.article
      initial={reduce ? false : { opacity: 0, y: 22, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={
        reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 24, delay: index * 0.07 }
      }
      whileHover={reduce ? undefined : { y: -4 }}
      className={`group relative rounded-2xl border bg-surface p-4 transition-shadow duration-200 hover:shadow-glow sm:p-5 ${
        bodyScroll ? "flex h-full flex-col" : ""
      } ${option.star ? "border-accent/60 shadow-glow" : "border-border"}`}
    >
      {option.star && !reduce && (
        <span
          aria-hidden
          className="animate-glow-breathe pointer-events-none absolute -inset-px rounded-2xl ring-1 ring-accent/40"
        />
      )}
      <div className={`mb-3 flex flex-wrap items-center gap-2 ${bodyScroll ? "shrink-0" : ""}`}>
        <span className="font-mono text-sm text-muted">Option {option.n || "?"}</span>
        {option.star && <StarBadge />}
        <PillarTag pillar={option.pillar} />
        <span className="text-sm font-semibold text-fg">{option.topic}</span>
        <span className="ml-auto flex items-center gap-2">
          <ScoreBadge score={option.score} />
          {option.parsed && (
            <button
              onClick={() => {
                setEditing((v) => !v);
                setEditErr(null);
              }}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-elevated px-2 py-0.5 text-xs text-fg transition hover:border-accent hover:text-accent"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 20h4L18 10l-4-4L4 16v4zM14 6l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Edit with AI
            </button>
          )}
          <button
            onClick={() => {
              setConfirmingDelete((v) => !v);
              setDeleteErr(null);
            }}
            aria-label="Delete this option"
            title="Delete this option"
            className="inline-flex items-center rounded-md border border-border bg-elevated px-2 py-0.5 text-xs text-muted transition hover:border-red-400/60 hover:text-red-300"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0v12a2 2 0 002 2h6a2 2 0 002-2V7M10 11v6M14 11v6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </span>
      </div>

      <AnimatePresence initial={false}>
        {confirmingDelete && (
          <motion.div
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={`overflow-hidden ${bodyScroll ? "shrink-0" : ""}`}
          >
            <div className="mb-3 rounded-lg border border-red-400/40 bg-elevated p-3">
              <p className="text-xs text-fg">
                Delete option {option.n || "?"}? It&apos;s removed from this draft for good
                {option.star ? " (this is the ⭐ top pick)" : ""}.
              </p>
              {deleteErr && <p className="mt-1 text-xs text-red-400">{deleteErr}</p>}
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setConfirmingDelete(false);
                    setDeleteErr(null);
                  }}
                  disabled={deleting}
                  className="rounded-md px-2.5 py-1 text-xs text-muted transition hover:text-fg disabled:opacity-50"
                >
                  Cancel
                </button>
                <motion.button
                  onClick={deleteOption}
                  disabled={deleting}
                  whileTap={reduce || deleting ? undefined : { scale: 0.96 }}
                  className="rounded-md border border-red-400/50 bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-300 transition hover:bg-red-500/25 disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Delete option"}
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {editing && (
          <motion.div
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={`overflow-hidden ${bodyScroll ? "shrink-0" : ""}`}
          >
            <div className="mb-3 rounded-lg border border-accent/40 bg-elevated p-3">
              <textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                rows={2}
                maxLength={800}
                disabled={editRunning}
                placeholder="Tell the AI how to change this option — e.g. “make it punchier, drop the hashtags”"
                className="w-full resize-none rounded-md border border-border bg-bg p-2 text-sm text-fg outline-none transition placeholder:text-muted focus:border-accent disabled:opacity-60"
              />
              {editErr && <p className="mt-1 text-xs text-red-400">{editErr}</p>}
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setEditing(false);
                    setEditErr(null);
                  }}
                  disabled={editRunning}
                  className="rounded-md px-2.5 py-1 text-xs text-muted transition hover:text-fg disabled:opacity-50"
                >
                  Cancel
                </button>
                <motion.button
                  onClick={applyEdit}
                  disabled={editRunning || !editPrompt.trim()}
                  whileTap={reduce || editRunning ? undefined : { scale: 0.96 }}
                  className="rounded-md px-3 py-1 text-xs font-semibold text-[#06210f] transition disabled:opacity-50"
                  style={{ background: "var(--good)" }}
                >
                  {editRunning ? "Rewriting…" : "Apply"}
                </motion.button>
              </div>
              {editRunning && (
                <p className="mt-1 text-center text-[11px] text-muted">
                  Rewriting option {option.n} on your Claude subscription — ~1–3 min.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!option.parsed ? (
        <pre
          className={`overflow-auto rounded-lg border border-border bg-bg/40 p-3 text-xs text-muted ${
            bodyScroll ? "min-h-0 flex-1" : ""
          }`}
        >
          {option.raw}
        </pre>
      ) : (
        <div className={`space-y-3 ${bodyScroll ? "min-h-0 flex-1 overflow-y-auto pr-1" : ""}`}>
          <LinkedInPreview
            companyPost={option.companyPost}
            brandName={brandName}
            hasLogo={hasLogo}
            companyMode={companyMode}
            authorName={authorName}
            hasAvatar={hasAvatar}
          />

          <ABSection
            label={companyMode ? "A" : "Post"}
            hint={companyMode ? "company post — paste on your page" : "your post — paste on your profile"}
            text={option.companyPost}
            limit={3000}
          />
          {companyMode && option.repostCaption && (
            <ABSection label="B" hint="repost caption — your profile" text={option.repostCaption} limit={3000} />
          )}
          {option.firstComment && (
            <ABSection
              label="C"
              hint="first comment — paste under the post right after publishing"
              text={option.firstComment}
            />
          )}

          {option.why && <p className="text-xs text-muted"><span className="text-fg/70">Why it works:</span> {option.why}</p>}
          {option.visual && (
            <div className="rounded-lg border border-border bg-bg/30 p-3 text-xs text-muted">
              <div className="mb-1.5 flex items-center gap-2">
                {showLogoThumb && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src="/api/asset?which=logo" alt="" className="h-7 w-7 rounded object-contain ring-1 ring-border" />
                )}
                <span className="font-semibold text-fg/70">Suggested visuals</span>
              </div>
              <div className="whitespace-pre-line leading-relaxed">{option.visual}</div>
            </div>
          )}

          <div className="pt-1">
            <div className="flex flex-wrap items-center gap-2">
              {/* Post and reject are mutually exclusive terminal states; while either is
                  in flight the other is disabled so the same option can't land in both logs. */}
              {!rejected && (
                <motion.button
                  onClick={markPosted}
                  disabled={busy || posted || rejecting}
                  whileTap={reduce || posted ? undefined : { scale: 0.96 }}
                  animate={posted && !reduce ? { scale: [1, 1.06, 1] } : undefined}
                  transition={{ duration: 0.32, ease: "easeOut" }}
                  className={`overflow-hidden rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
                    posted
                      ? "bg-good/15 text-good"
                      : "border border-border bg-elevated text-fg hover:border-accent hover:text-accent"
                  }`}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={posted ? "posted" : busy ? "busy" : "idle"}
                      initial={reduce ? false : { opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduce ? undefined : { opacity: 0, y: -5 }}
                      transition={{ duration: 0.2 }}
                      className="inline-block"
                    >
                      {posted ? "✓ posted — added to your voice corpus" : busy ? "saving…" : "✓ I posted this"}
                    </motion.span>
                  </AnimatePresence>
                </motion.button>
              )}

              {!posted && (
                <motion.button
                  onClick={markRejected}
                  disabled={rejecting || rejected || busy}
                  whileTap={reduce || rejected ? undefined : { scale: 0.96 }}
                  title="Don't suggest this angle again — future runs will avoid it"
                  className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-60 ${
                    rejected
                      ? "bg-elevated text-muted"
                      : "border border-border bg-elevated text-muted hover:border-red-400/60 hover:text-red-300"
                  }`}
                >
                  {rejected ? "✕ won't suggest again" : rejecting ? "saving…" : "Not for me"}
                </motion.button>
              )}
            </div>
            {postErr && <p className="mt-1 text-xs text-red-400">{postErr}</p>}
            {rejectErr && <p className="mt-1 text-xs text-red-400">{rejectErr}</p>}
          </div>
        </div>
      )}
    </motion.article>
  );
}
