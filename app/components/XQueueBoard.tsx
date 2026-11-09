"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { renderLabel } from "./LinkedInPostPanel";
import { VIDEO, candidateName, chosenCandidate, defaultCandidate } from "./QueueBoard";

type Render = { state: "waiting" | "rendering" | "done" | "failed"; done: number; total?: number; error?: string; note?: string } | null;
type Item = {
  id: string;
  draft: string;
  option: number;
  topic: string;
  text: string;
  thread?: string[];
  comment?: string;
  status: "queued" | "posting" | "posted" | "failed";
  error?: string;
  xIds?: string[];
  url?: string;
  postedAt?: string;
  images: number[];
  render: Render;
};
type Queue = { items: Item[]; hasKeys: boolean };

const imgUrl = (id: string, v: number) => `/api/asset?which=queue&channel=x&id=${encodeURIComponent(id)}&v=${v}`;
const btn =
  "min-h-[44px] cursor-pointer rounded-lg px-3 py-2 text-sm text-muted transition duration-200 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";

// The X queue: each queued post with its 16:9 candidates (and the 4:5 clip when config `video` is
// set) and its own Post button. Posting goes through the X API (app/scripts/x-post.mjs) on a click;
// nothing is scheduled. A failed chain keeps the ids already posted, so Retry only posts the rest.
export default function XQueueBoard({ pollMs = 3_000, onCount }: { pollMs?: number; onCount?: (queued: number) => void }) {
  const [q, setQ] = useState<Queue | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, number | null>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [checkNote, setCheckNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/x-queue", { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      setQ(await r.json());
      setLoadErr(null);
    } catch (e) {
      setLoadErr(String((e as Error).message));
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, pollMs);
    window.addEventListener("shippost:queue-changed", load);
    return () => {
      clearInterval(t);
      window.removeEventListener("shippost:queue-changed", load);
    };
  }, [load, pollMs]);

  const items = q?.items ?? [];
  const queued = items.filter((i) => i.status === "queued");
  useEffect(() => onCount?.(queued.length), [queued.length, onCount]);
  const posting = items.find((i) => i.status === "posting");
  const recent = items.filter((i) => i.status === "posted" || i.status === "failed").slice(-6).reverse();
  const setErr = (id: string, e: string | null) => setErrs((m) => ({ ...m, [id]: e ?? "" }));

  const send = async (id: string, body: Record<string, unknown>, method = "POST") => {
    if (busyId) return;
    setBusyId(id);
    setErr(id, null);
    try {
      const r =
        method === "DELETE"
          ? await fetch(`/api/x-queue?id=${encodeURIComponent(id)}`, { method })
          : await fetch("/api/x-queue", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, id }) });
      if (!r.ok) setErr(id, (await r.json().catch(() => ({}))).error || "That did not work.");
      await load();
    } catch (e) {
      setErr(id, String((e as Error).message));
    } finally {
      setBusyId(null);
    }
  };

  const post = (i: Item) => {
    // Past the first post the media is already on X: nothing is uploaded again.
    if ((i.xIds?.length ?? 0) > 0) return send(i.id, { action: "trigger", image: null });
    const chosen = chosenCandidate(i.images, picks, i.id);
    if (chosen !== null && !i.images.includes(chosen)) return setErr(i.id, `${candidateName(chosen)} is not available any more.`);
    return send(i.id, { action: "trigger", image: chosen });
  };

  const checkKeys = async () => {
    setChecking(true);
    setCheckNote(null);
    try {
      const r = await fetch("/api/x-queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check" }) });
      const j = await r.json().catch(() => ({}));
      setCheckNote(j.message || j.error || (r.ok ? "The keys work." : "The check failed."));
    } catch (e) {
      setCheckNote(String((e as Error).message));
    } finally {
      setChecking(false);
    }
  };

  const thumb = (selected: boolean) =>
    `relative cursor-pointer overflow-hidden rounded-lg border-2 transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
      selected ? "border-accent" : "border-border hover:border-accent/60"
    }`;

  return (
    <div className="space-y-4">
      {loadErr && <p className="text-sm text-red-400">Couldn&apos;t load the X queue: {loadErr}</p>}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" onClick={checkKeys} disabled={checking} className={`${btn} border border-border`}>
          {checking ? "Checking…" : "Check X keys"}
        </button>
        {q && !q.hasKeys && <span className="text-muted">X keys missing or incomplete: see the README, &quot;X posting&quot;.</span>}
        {checkNote && (
          <span role="status" className="text-muted">
            {checkNote}
          </span>
        )}
      </div>

      {q && queued.length === 0 && (
        <p className="rounded-lg border border-border p-4 text-sm text-muted">Nothing queued. Add a post from an X option card.</p>
      )}

      {queued.map((i) => {
        const chosen = chosenCandidate(i.images, picks, i.id);
        // No render state yet: render-variants is still starting, so it counts as rendering.
        const rendering = !i.render || i.render.state === "rendering" || i.render.state === "waiting";
        const blockedByRender = rendering && !(i.id in picks) && defaultCandidate(i.images) === null;
        const done = i.xIds?.length ?? 0;
        return (
          <section key={i.id} className="space-y-3 rounded-2xl border border-border bg-surface p-4">
            <div>
              <div className="truncate text-sm font-semibold text-fg">{i.topic || i.draft}</div>
              <div className="text-xs text-muted">
                {1 + (i.thread?.length ?? 0) + (i.comment ? 1 : 0)} posts · {renderLabel(i.render)}
                {done > 0 && ` · ${done} already on X, Post continues after them`}
              </div>
            </div>
            <p className="line-clamp-3 whitespace-pre-line text-sm text-fg/90">{i.text}</p>

            {done === 0 && (
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={`Image for ${i.topic || i.draft}`}>
                {[1, 2, 3].map((v) =>
                  i.images.includes(v) ? (
                    <button key={v} role="radio" aria-checked={chosen === v} onClick={() => setPicks((m) => ({ ...m, [i.id]: v }))} className={thumb(chosen === v)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imgUrl(i.id, v)} alt={`Candidate image ${v}`} className="aspect-video w-full object-cover" />
                    </button>
                  ) : (
                    <div key={v} className="flex aspect-video items-center justify-center rounded-lg border-2 border-dashed border-border text-xs text-muted">
                      {i.render?.state === "waiting" ? "waiting its turn" : rendering ? "rendering…" : "no image"}
                    </div>
                  )
                )}
                {i.images.includes(VIDEO) && (
                  <button role="radio" aria-checked={chosen === VIDEO} onClick={() => setPicks((m) => ({ ...m, [i.id]: VIDEO }))} className={thumb(chosen === VIDEO)}>
                    <video src={imgUrl(i.id, VIDEO)} muted loop autoPlay playsInline aria-label="Candidate video" className="aspect-video w-full object-contain" />
                    <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-white">video</span>
                  </button>
                )}
                <button role="radio" aria-checked={chosen === null} onClick={() => setPicks((m) => ({ ...m, [i.id]: null }))} className={`${thumb(chosen === null)} flex aspect-video items-center justify-center text-xs text-muted`}>
                  No image
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => post(i)}
                disabled={Boolean(busyId) || Boolean(posting) || blockedByRender || !q?.hasKeys}
                className="min-h-[44px] cursor-pointer rounded-lg border border-accent bg-accent/15 px-5 py-2 text-sm font-semibold text-accent transition duration-200 hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50"
              >
                {busyId === i.id ? "Starting…" : done > 0 ? "Post the rest" : "Post"}
              </button>
              <button type="button" onClick={() => send(i.id, {}, "DELETE")} disabled={Boolean(busyId)} className={`${btn} hover:text-red-400`}>
                Remove
              </button>
              <Link href={`/x/draft/${encodeURIComponent(i.draft)}?option=${i.option}`} className={btn}>
                Open the draft
              </Link>
              <span className="text-xs text-muted">
                {posting && posting.id !== i.id ? "Another post is going out: one at a time." : blockedByRender ? 'Its images are still rendering. Wait, or pick "No image".' : ""}
              </span>
            </div>
            {i.error && <p className="rounded-lg border border-red-400/40 p-2 text-xs text-red-300">Last try did not post anything: {i.error}</p>}
            {errs[i.id] && <p className="text-xs text-red-400">{errs[i.id]}</p>}
          </section>
        );
      })}

      {posting && (
        <p aria-live="polite" className="rounded-lg border border-border p-3 text-sm text-fg">
          Posting {posting.topic || posting.draft} to X…
        </p>
      )}

      {recent.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted">Recent</h3>
          {recent.map((i) => (
            <div key={i.id} className="rounded-lg border border-border p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className={i.status === "failed" ? "text-red-300" : "text-fg"}>{i.status === "posted" ? "Posted" : "Failed"}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{i.topic || i.draft}</span>
                {i.url && (
                  <a href={i.url} target="_blank" rel="noopener noreferrer" className="cursor-pointer text-accent underline-offset-2 hover:underline">
                    Open on X
                  </a>
                )}
                {i.status === "failed" && (
                  <button type="button" onClick={() => send(i.id, { action: "requeue" })} disabled={Boolean(busyId)} className="cursor-pointer text-accent underline-offset-2 hover:underline disabled:opacity-50">
                    Retry
                  </button>
                )}
                {i.status === "failed" && (
                  <button type="button" onClick={() => send(i.id, {}, "DELETE")} disabled={Boolean(busyId)} className="cursor-pointer text-muted hover:text-red-400 disabled:opacity-50">
                    Remove
                  </button>
                )}
              </div>
              {i.status === "failed" && (
                <p className="mt-1 text-red-300">
                  {i.error}
                  {(i.xIds?.length ?? 0) > 0 && ` (${i.xIds?.length} posts already on X: Retry puts it back in the queue, then Post continues after them)`}
                </p>
              )}
              {errs[i.id] && <p className="mt-1 text-red-400">{errs[i.id]}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
