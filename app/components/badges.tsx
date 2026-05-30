import { PILLAR_LABELS } from "@/lib/theme";

export function StarBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">
      ★ top pick
    </span>
  );
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  return (
    <span className="rounded-md border border-border bg-elevated px-2 py-0.5 font-mono text-xs text-muted">
      {score.toFixed(1)}
    </span>
  );
}

export function PillarTag({ pillar }: { pillar: string }) {
  if (!pillar) return null;
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
      {PILLAR_LABELS[pillar] ?? pillar}
    </span>
  );
}
