"use client";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import type { DraftSummary } from "@/lib/drafts";
import { PILLAR_LABELS } from "@/lib/theme";
import { formatDraftId } from "@/lib/draftId";

export default function DraftList({ drafts }: { drafts: DraftSummary[] }) {
  const reduce = useReducedMotion();

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
    <ul className="space-y-3">
      {drafts.map((d, i) => (
        <motion.li
          key={d.date}
          initial={reduce ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.35, delay: i * 0.05, ease: "easeOut" }}
        >
          <Link
            href={`/draft/${d.date}`}
            className="group flex items-center justify-between rounded-2xl border border-border bg-surface px-5 py-4 transition duration-200 hover:border-accent hover:shadow-glow"
          >
            <div>
              <div className="font-mono text-sm text-fg">{formatDraftId(d.date)}</div>
              <div className="mt-1 text-xs text-muted">
                {d.optionCount} options · {d.pillars.map((p) => PILLAR_LABELS[p] ?? p).join(", ")}
              </div>
            </div>
            <span className="text-muted transition-transform duration-200 group-hover:translate-x-1 group-hover:text-accent">
              →
            </span>
          </Link>
        </motion.li>
      ))}
    </ul>
  );
}
