"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { DraftSummary } from "@/lib/drafts";
import { formatDraftId } from "@/lib/draftId";

// Show the search box once the archive is big enough that scanning gets tedious.
const SEARCH_THRESHOLD = 4;

export default function DraftList({ drafts }: { drafts: DraftSummary[] }) {
  const reduce = useReducedMotion();
  const router = useRouter();
  const [query, setQuery] = useState("");
  // Mirror the server-provided list so a delete can drop the card instantly; the prop resyncs it
  // after router.refresh() lands the new server render.
  const [items, setItems] = useState(drafts);
  useEffect(() => setItems(drafts), [drafts]);

  const onDeleted = (date: string) => {
    setItems((prev) => prev.filter((d) => d.date !== date));
    router.refresh();
  };

  // Filter client-side over what the list actually holds: topics + the friendly date.
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return items;
    return items.filter((d) =>
      [formatDraftId(d.date), d.topPick ?? "", ...d.topics].join(" ").toLowerCase().includes(q)
    );
  }, [items, q]);

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-8 text-center">
        <p className="text-fg">No drafts yet.</p>
        <p className="mt-2 text-sm text-muted">
          Run the engine: <code className="font-mono text-accent">/shippost</code> in Claude Code, or{" "}
          <code className="font-mono text-accent">bash engine/generate.sh</code>. New drafts appear here.
        </p>
      </div>
    );
  }

  return (
    <div>
      {items.length >= SEARCH_THRESHOLD && (
        <div className="relative mb-4">
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
          >
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search drafts by topic or date…"
            aria-label="Search drafts"
            className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-3 text-sm text-fg outline-none transition placeholder:text-muted focus:border-accent"
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted">
          No drafts match <span className="text-fg">&ldquo;{query.trim()}&rdquo;</span>.
        </div>
      ) : (
        <ul className="space-y-3">
          <AnimatePresence initial={false}>
            {filtered.map((d, i) => {
              // Headline = the ⭐ top pick (what you'd most likely post). The remaining
              // topics give each run a recognisable fingerprint where pillars can't.
              const headline = d.topPick ?? d.topics[0] ?? null;
              // Drop only the headline's own slot (first match) — if two options happen to share
              // a topic string, the duplicate should still be counted in "others", not erased too.
              const headlineIdx = headline ? d.topics.indexOf(headline) : -1;
              const others = d.topics.filter((_, i) => i !== headlineIdx);
              const posted = d.postedOptions.length > 0;
              const postedLabel =
                d.postedOptions.length === 1
                  ? `Posted · option ${d.postedOptions[0]}`
                  : `Posted · ${d.postedOptions.length} used`;
              return (
                <motion.li
                  key={d.date}
                  layout
                  initial={reduce ? false : { opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0, marginTop: 0, scale: 0.97 }}
                  transition={reduce ? { duration: 0 } : { duration: 0.35, delay: i * 0.05, ease: "easeOut" }}
                  className="group relative"
                >
                  <Link
                    href={`/draft/${d.date}`}
                    className={`group/card flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface px-5 py-4 transition duration-200 hover:border-accent hover:shadow-glow ${
                      posted ? "opacity-65 hover:opacity-100" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted">{formatDraftId(d.date)}</span>
                        {posted && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-good/15 px-2 py-0.5 text-[10px] font-semibold text-good">
                            ✓ {postedLabel}
                          </span>
                        )}
                      </div>
                      {headline ? (
                        <div className="mt-1.5 flex items-baseline gap-2">
                          <span className="truncate text-base font-medium text-fg">
                            <span className="text-accent">★</span> {headline}
                          </span>
                          {d.topScore != null && (
                            <span className="shrink-0 font-mono text-xs text-muted">{d.topScore.toFixed(1)}</span>
                          )}
                        </div>
                      ) : (
                        <div className="mt-1.5 text-base font-medium text-fg">{d.optionCount} options</div>
                      )}
                      <div className="mt-1 truncate text-xs text-muted">
                        {others.length > 0
                          ? `+${others.length} more · ${others.join(", ")}`
                          : `${d.optionCount} option${d.optionCount === 1 ? "" : "s"}`}
                      </div>
                    </div>
                    <span className="shrink-0 text-muted transition-transform duration-200 group-hover/card:translate-x-1 group-hover/card:text-accent">
                      →
                    </span>
                  </Link>
                  <DeleteDraftButton date={d.date} onDeleted={() => onDeleted(d.date)} />
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

// Two-step delete for a whole draft package: a quiet trash icon (top-right of the card) that, on
// click, swaps to an explicit "Delete / Cancel" confirm so a stray tap never wipes a draft.
function DeleteDraftButton({ date, onDeleted }: { date: string; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/drafts/${date}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setBusy(false);
        setErr(j.error || "Couldn't delete this draft.");
        return;
      }
      onDeleted(); // parent drops the card + refreshes
    } catch (e) {
      setBusy(false);
      setErr(String((e as Error).message));
    }
  };

  return (
    <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
      {err && <span className="mr-1 text-[10px] text-red-400">{err}</span>}
      {confirming ? (
        <>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="rounded-md border border-red-400/50 bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-300 transition hover:bg-red-500/25 disabled:opacity-50"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              setErr(null);
            }}
            disabled={busy}
            className="rounded-md border border-border bg-elevated px-2 py-0.5 text-[11px] text-muted transition hover:text-fg disabled:opacity-50"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label="Delete this draft"
          title="Delete this draft"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted opacity-0 transition hover:border-red-400/50 hover:bg-elevated hover:text-red-300 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0v12a2 2 0 002 2h6a2 2 0 002-2V7M10 11v6M14 11v6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
