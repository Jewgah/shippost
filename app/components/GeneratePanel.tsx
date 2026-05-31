"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

type Phase = "idle" | "running" | "error";

// Believable pipeline narration over the ~1–2 min wait (cosmetic — no real progress API).
const STEPS = [
  "Reading your latest commits…",
  "Pulling your AI-workflow skills…",
  "Brainstorming ~10 angles…",
  "Selecting the 5 strongest…",
  "Scrubbing client details…",
  "Drafting each post…",
  "Humanizing the voice…",
  "Scoring & ranking…",
  "Almost there…",
];

export default function GeneratePanel() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const onDone = useCallback(
    (lastResult: { ok?: boolean; date?: string; error?: string } | null) => {
      stopPoll();
      if (lastResult?.ok && lastResult.date) {
        router.push(`/draft/${lastResult.date}`);
        router.refresh();
      } else {
        setPhase("error");
        setError(lastResult?.error || "Generation failed — check drafts/.run.log");
      }
    },
    [router]
  );

  const startPolling = useCallback(() => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch("/api/generate", { cache: "no-store" });
        const j = await r.json();
        setNow(Date.now());
        if (!j.running) onDone(j.lastResult);
      } catch {
        /* transient — keep polling */
      }
    }, 3000);
  }, [onDone]);

  // On mount: if a run is already in progress (e.g. page refresh), resume the live view.
  useEffect(() => {
    (async () => {
      try {
        const j = await (await fetch("/api/generate", { cache: "no-store" })).json();
        if (j.running) {
          setPhase("running");
          setStartedAt(j.startedAt ?? Date.now());
          setNow(Date.now());
          startPolling();
        }
      } catch {
        /* ignore */
      }
    })();
    return stopPoll;
  }, [startPolling]);

  // tick the elapsed clock while running
  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const generate = async () => {
    setError(null);
    setPhase("running");
    const t = Date.now();
    setStartedAt(t);
    setNow(t);
    try {
      const j = await (await fetch("/api/generate", { method: "POST" })).json();
      if (j.started === false && !j.running) {
        setPhase("error");
        setError("Couldn't start generation.");
        return;
      }
      startPolling();
    } catch (e) {
      setPhase("error");
      setError(String((e as Error).message));
    }
  };

  const elapsedSec = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
  const ss = String(elapsedSec % 60).padStart(2, "0");
  const step = STEPS[Math.min(STEPS.length - 1, Math.floor(elapsedSec / 22))];

  return (
    <div className="mb-8">
      {phase !== "running" ? (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface px-5 py-4">
          <div>
            <h1 className="text-lg font-semibold text-fg">Your drafts</h1>
            <p className="mt-0.5 text-sm text-muted">
              Generate 5 ranked options from your recent work, then pick one to publish.
            </p>
            {phase === "error" && error && <p className="mt-1 text-sm text-red-400">{error}</p>}
          </div>
          <button
            onClick={generate}
            className="group inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-[#06210f] shadow-glow transition-transform duration-200 hover:-translate-y-0.5"
            style={{ background: "var(--good)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 3l14 9-14 9V3z" fill="currentColor" />
            </svg>
            Generate drafts
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-accent/40 bg-surface p-5 shadow-glow">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                {!reduce && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                )}
                <span className="relative inline-flex h-3 w-3 rounded-full bg-accent" />
              </span>
              <div>
                <div className="text-sm font-semibold text-fg">Writing your 5 drafts…</div>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={step}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.3 }}
                    className="text-xs text-muted"
                  >
                    {step}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
            <span className="font-mono text-xs text-muted">
              {mm}:{ss} · ~1–3 min
            </span>
          </div>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border p-4">
                <div className="mb-3 flex gap-2">
                  <div className="skeleton h-4 w-16 rounded" />
                  <div className="skeleton h-4 w-28 rounded" />
                  <div className="skeleton ml-auto h-4 w-10 rounded" />
                </div>
                <div className="skeleton mb-2 h-3 w-full rounded" />
                <div className="skeleton mb-2 h-3 w-[92%] rounded" />
                <div className="skeleton h-3 w-2/3 rounded" />
              </div>
            ))}
          </div>
          <p className="mt-3 text-center text-xs text-muted">
            Generating on your own Claude subscription — you can keep this tab open.
          </p>
        </div>
      )}
    </div>
  );
}
