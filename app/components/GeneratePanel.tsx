"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import FolderPicker from "./FolderPicker";

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

  // ── steering (optional): direction text + project/category scope ──
  const [steerOpen, setSteerOpen] = useState(false);
  const [direction, setDirection] = useState("");
  const [project, setProject] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [projects, setProjects] = useState<{ name: string; source: string; inAllowlist: boolean }[]>([]);
  const [categories, setCategories] = useState<{ id: string; label: string }[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const steerCount = [project, category, direction.trim() ? "d" : ""].filter(Boolean).length;

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

  // load steering suggestions (projects + categories) — reusable so we can refresh after a
  // project is added through the folder picker.
  const loadSuggestions = useCallback(async () => {
    try {
      const j = await (await fetch("/api/suggestions", { cache: "no-store" })).json();
      setProjects(Array.isArray(j.projects) ? j.projects : []);
      setCategories(Array.isArray(j.categories) ? j.categories : []);
    } catch {
      /* suggestions are optional — generation still works without them */
    }
  }, []);

  useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);

  // A freshly added project should appear as a chip AND be selected as the batch scope.
  const onProjectAdded = useCallback(
    async (name: string) => {
      await loadSuggestions();
      setProject(name);
    },
    [loadSuggestions]
  );

  const generate = async () => {
    setError(null);
    setPhase("running");
    const t = Date.now();
    setStartedAt(t);
    setNow(t);
    try {
      const j = await (
        await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            direction: direction.trim() || undefined,
            project: project || undefined,
            category: category || undefined,
          }),
        })
      ).json();
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
        <div className="rounded-2xl border border-border bg-surface px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-fg">Your drafts</h1>
              <p className="mt-0.5 text-sm text-muted">
                Generate 5 ranked options from your recent work, then pick one to publish.
              </p>
              {phase === "error" && error && <p className="mt-1 text-sm text-red-400">{error}</p>}
            </div>
            <motion.button
              onClick={generate}
              whileHover={reduce ? undefined : { y: -2 }}
              whileTap={reduce ? undefined : { scale: 0.97 }}
              className="group relative inline-flex shrink-0 cursor-pointer items-center gap-2 overflow-hidden rounded-xl px-4 py-2.5 text-sm font-semibold text-[#06210f] shadow-glow"
              style={{ background: "var(--good)" }}
            >
              {/* shine sweep on hover */}
              {!reduce && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 left-0 w-1/2 -translate-x-[130%] skew-x-[-12deg] bg-gradient-to-r from-transparent via-white/45 to-transparent group-hover:[animation:shine_0.9s_ease-out_forwards]"
                />
              )}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="relative z-10">
                <path d="M5 3l14 9-14 9V3z" fill="currentColor" />
              </svg>
              <span className="relative z-10">Generate drafts</span>
            </motion.button>
          </div>

          {/* ── steering (optional) ── */}
          <div className="mt-4 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setSteerOpen((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-medium text-muted transition hover:text-accent"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                className={`transition-transform duration-200 ${steerOpen ? "rotate-90" : ""}`}
              >
                <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Steer this batch
              {steerCount > 0 && (
                <span className="ml-1 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                  {steerCount} active
                </span>
              )}
            </button>

            <AnimatePresence initial={false}>
              {steerOpen && (
                <motion.div
                  initial={reduce ? false : { height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={reduce ? undefined : { height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className="overflow-hidden"
                >
                  <div className="space-y-3 pt-3">
                    <div>
                      <label className="mb-1 block text-xs text-muted">Direction</label>
                      <textarea
                        value={direction}
                        onChange={(e) => setDirection(e.target.value)}
                        rows={2}
                        maxLength={500}
                        placeholder="e.g. focus on how I made my agents smarter"
                        className="w-full resize-none rounded-lg border border-border bg-elevated p-2.5 text-sm text-fg outline-none transition placeholder:text-muted focus:border-accent"
                      />
                    </div>

                    <div>
                      <div className="mb-1.5 text-xs text-muted">Project</div>
                      <div className="flex flex-wrap gap-1.5">
                        {projects.map((p) => {
                          const active = project === p.name;
                          return (
                            <motion.button
                              key={`${p.source}-${p.name}`}
                              type="button"
                              whileTap={reduce ? undefined : { scale: 0.95 }}
                              onClick={() => setProject(active ? null : p.name)}
                              title={
                                p.inAllowlist
                                  ? "Scopes generation to this project's recent work"
                                  : "Used as a focus hint (not in your mineable allowlist)"
                              }
                              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${
                                active
                                  ? "border-accent bg-accent/15 text-accent"
                                  : "border-border bg-elevated text-fg hover:border-accent/60"
                              }`}
                            >
                              {p.name}
                              {!p.inAllowlist && (
                                <span className="text-[9px] uppercase tracking-wide text-muted">recent</span>
                              )}
                            </motion.button>
                          );
                        })}
                        <motion.button
                          type="button"
                          whileTap={reduce ? undefined : { scale: 0.95 }}
                          onClick={() => setPickerOpen(true)}
                          title="Point shippost at another of your repos (adds it to the mineable allowlist)"
                          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted transition hover:border-accent hover:text-accent"
                        >
                          + Add a project
                        </motion.button>
                      </div>
                    </div>

                    {categories.length > 0 && (
                      <div>
                        <div className="mb-1.5 text-xs text-muted">Category</div>
                        <div className="flex flex-wrap gap-1.5">
                          {categories.map((c) => {
                            const active = category === c.id;
                            return (
                              <motion.button
                                key={c.id}
                                type="button"
                                whileTap={reduce ? undefined : { scale: 0.95 }}
                                onClick={() => setCategory(active ? null : c.id)}
                                className={`rounded-full border px-2.5 py-1 text-xs transition ${
                                  active
                                    ? "border-accent bg-accent/15 text-accent"
                                    : "border-border bg-elevated text-fg hover:border-accent/60"
                                }`}
                              >
                                {c.label}
                              </motion.button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      ) : (
        <div className="relative">
          {/* sweeping gradient-border glow while generating */}
          {!reduce && (
            <div
              aria-hidden
              className="border-sweep pointer-events-none absolute -inset-px rounded-2xl opacity-70 blur-[3px]"
            />
          )}
          <div className="relative rounded-2xl border border-accent/40 bg-surface p-5 shadow-glow">
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
                    initial={{ opacity: 0, y: 6, filter: "blur(2px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: -6, filter: "blur(2px)" }}
                    transition={{ duration: 0.35, ease: "easeOut" }}
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
          {/* indeterminate progress sweep */}
          <div className="mb-4 h-1 overflow-hidden rounded-full bg-border/40">
            {!reduce ? (
              <div className="progress-sweep h-full w-1/4 rounded-full" />
            ) : (
              <div className="h-full w-1/3 rounded-full bg-accent/60" />
            )}
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
        </div>
      )}

      {pickerOpen && <FolderPicker onClose={() => setPickerOpen(false)} onAdded={onProjectAdded} />}
    </div>
  );
}
