"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { DraftOption } from "@/lib/draftParser";

type Render = { state: "waiting" | "rendering" | "done" | "failed"; done: number; total?: number; error?: string } | null;
type Item = {
  id: string;
  mode: "personal" | "company";
  status: "queued" | "posting" | "posted" | "failed";
  position: number | null;
  images: number[];
  render: Render;
  error?: string;
};

export function renderLabel(r: Render): string {
  if (!r) return "images: starting";
  if (r.state === "waiting") return "images: waiting for another render";
  if (r.state === "rendering") return `images: ${r.done}/${r.total ?? 3} rendering`;
  if (r.state === "done") return r.total === 0 ? "no AI image prompt, text only" : `${r.done} images ready`;
  return `images failed: ${r.error ?? "unknown error"}`;
}

// "Add to queue": put this option in the manual LinkedIn queue. Adding renders its 3 candidate
// images in the background; posting happens later, one click at a time, from /queue.
export default function LinkedInPostPanel({
  option,
  date,
  companyMode,
  brandName,
  hasCompanyPage,
}: {
  option: DraftOption;
  date: string;
  companyMode: boolean;
  brandName: string;
  hasCompanyPage: boolean;
}) {
  // Company page text: section A in company mode, else the "Generate for company" version (D), else A.
  const companyText = companyMode ? option.companyPost : option.companyPage || option.companyPost;
  const [mode, setMode] = useState<"personal" | "company">("personal");
  const [text, setText] = useState(option.companyPost);
  const [repost, setRepost] = useState(option.repostCaption);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/linkedin?date=${encodeURIComponent(date)}&option=${option.n}`, { cache: "no-store" });
      if (r.ok) setItems((await r.json()).items);
    } catch {
      /* transient */
    }
  }, [date, option.n]);

  useEffect(() => {
    load();
    // Renders take minutes: refresh so progress and "posted" show up without a reload.
    const t = setInterval(load, 5_000);
    return () => clearInterval(t);
  }, [load]);

  const pickMode = (m: "personal" | "company") => {
    setMode(m);
    setText(m === "company" ? companyText : option.companyPost);
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/linkedin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, option: option.n, mode, text, repost }),
      });
      const j = await r.json();
      if (!r.ok) setErr(j.error || "Couldn't add it to the queue.");
      else await load();
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const r = await fetch(`/api/linkedin?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok) setErr((await r.json().catch(() => ({}))).error || "Couldn't remove it.");
    await load();
  };

  const field =
    "w-full rounded-md border border-border bg-bg p-2 text-sm text-fg outline-none transition duration-200 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent";

  return (
    <div className="mb-3 space-y-3 rounded-lg border border-accent/40 bg-elevated p-3 text-sm">
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <legend className="sr-only">Where to post</legend>
        <label className="flex cursor-pointer items-center gap-1.5 py-1">
          <input type="radio" name={`mode-${date}-${option.n}`} checked={mode === "personal"} onChange={() => pickMode("personal")} />
          my profile only
        </label>
        <label
          className={`flex items-center gap-1.5 py-1 ${hasCompanyPage ? "cursor-pointer" : "opacity-50"}`}
          title={hasCompanyPage ? "" : "Set brand.linkedinPageUrl in config.json"}
        >
          <input
            type="radio"
            name={`mode-${date}-${option.n}`}
            disabled={!hasCompanyPage}
            checked={mode === "company"}
            onChange={() => pickMode("company")}
          />
          {brandName || "company"} page + repost on my profile
        </label>
      </fieldset>

      <label className="block">
        <span className="mb-1 block text-xs text-muted">{mode === "company" ? `Post on the ${brandName || "company"} page` : "Post on my profile"}</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} maxLength={3000} className={`${field} resize-y`} />
      </label>

      {mode === "company" && (
        <label className="block">
          <span className="mb-1 block text-xs text-muted">Repost caption on my profile (empty = no repost)</span>
          <textarea value={repost} onChange={(e) => setRepost(e.target.value)} rows={3} maxLength={3000} className={`${field} resize-y`} />
        </label>
      )}

      <div className="flex items-center justify-end">
        <button
          onClick={submit}
          disabled={busy || !text.trim()}
          className="min-h-[36px] cursor-pointer rounded-md border border-accent bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent transition duration-200 hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add to queue (renders 3 images)"}
        </button>
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}

      {items.length > 0 && (
        <ul className="space-y-1 border-t border-border pt-2 text-xs text-muted">
          {items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-fg">{i.status === "queued" && i.position ? `#${i.position} in queue` : i.status}</span>
              <span>{i.mode === "company" ? `${brandName || "company"} page + repost` : "my profile"}</span>
              {i.status === "queued" && <span>· {renderLabel(i.render)}</span>}
              {i.error && (
                <span className="truncate text-red-400" title={i.error}>
                  {i.error}
                </span>
              )}
              {(i.status === "queued" || i.status === "failed") && (
                <button
                  onClick={() => remove(i.id)}
                  className="ml-auto cursor-pointer rounded px-1 transition duration-200 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  remove
                </button>
              )}
            </li>
          ))}
          <li>
            <Link href="/queue" className="text-accent hover:underline">
              Open the queue
            </Link>
          </li>
        </ul>
      )}
    </div>
  );
}
