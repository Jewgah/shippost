"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import type { DraftSummary } from "@/lib/drafts";
import { formatDraftId } from "@/lib/draftId";

// Show the search box once the archive is big enough that scanning gets tedious.
const SEARCH_THRESHOLD = 4;

export default function DraftList({ drafts }: { drafts: DraftSummary[] }) {
  const reduce = useReducedMotion();
  const [query, setQuery] = useState("");

  // Filter client-side over what the list actually holds: topics + the friendly date.
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return drafts;
    return drafts.filter((d) =>
      [formatDraftId(d.date), d.topPick ?? "", ...d.topics].join(" ").toLowerCase().includes(q)
    );
  }, [drafts, q]);

  if (drafts.length === 0) {
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
      {drafts.length >= SEARCH_THRESHOLD && (
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
                initial={reduce ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={reduce ? { duration: 0 } : { duration: 0.35, delay: i * 0.05, ease: "easeOut" }}
              >
                <Link
                  href={`/draft/${d.date}`}
                  className={`group flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface px-5 py-4 transition duration-200 hover:border-accent hover:shadow-glow ${
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
                  <span className="shrink-0 text-muted transition-transform duration-200 group-hover:translate-x-1 group-hover:text-accent">
                    →
                  </span>
                </Link>
              </motion.li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
