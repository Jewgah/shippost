import type { Cadence } from "@/lib/voice";

// A slim status strip for the every-2-days posting habit: when you last posted, your streak,
// and whether you're due. Server-rendered (no interactivity) — purely presentational.

function ago(daysSince: number | null): string {
  if (daysSince === null) return "never";
  if (daysSince === 0) return "today";
  if (daysSince === 1) return "yesterday";
  return `${daysSince}d ago`;
}

export default function CadenceBar({ cadence }: { cadence: Cadence }) {
  const { total, daysSince, due, streak } = cadence;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm">
      {total === 0 ? (
        <span className="text-muted">
          No posts logged yet. Pick one and hit <span className="text-fg">&ldquo;I posted this&rdquo;</span> to start a streak.
        </span>
      ) : (
        <>
          <span className="text-muted">
            Last posted <span className="text-fg">{ago(daysSince)}</span>
          </span>
          {streak >= 2 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">
              🔥 {streak} in a row
            </span>
          )}
          <span className="ml-auto shrink-0">
            {due ? (
              <span className="inline-flex items-center rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-semibold text-amber-300">
                Due now
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-good/15 px-2 py-0.5 text-xs font-semibold text-good">
                On track
              </span>
            )}
          </span>
        </>
      )}
    </div>
  );
}
