import Link from "next/link";
import type { DraftSummary } from "@/lib/drafts";
import { PILLAR_LABELS } from "@/lib/theme";

export default function DraftList({ drafts }: { drafts: DraftSummary[] }) {
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
      {drafts.map((d) => (
        <li key={d.date}>
          <Link
            href={`/draft/${d.date}`}
            className="flex items-center justify-between rounded-2xl border border-border bg-surface px-5 py-4 transition hover:border-accent"
          >
            <div>
              <div className="font-mono text-sm text-fg">{d.date}</div>
              <div className="mt-1 text-xs text-muted">
                {d.optionCount} options · {d.pillars.map((p) => PILLAR_LABELS[p] ?? p).join(", ")}
              </div>
            </div>
            <span className="text-muted">→</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
