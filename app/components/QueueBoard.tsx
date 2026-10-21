"use client";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import LinkedInPreview from "./LinkedInPreview";
import { renderLabel } from "./LinkedInPostPanel";

type Render = { state: "waiting" | "rendering" | "done" | "failed"; done: number; total?: number; error?: string } | null;
type Item = {
  id: string;
  draft: string;
  option: number;
  topic: string;
  mode: "personal" | "company";
  text: string;
  repost: string;
  comment?: string;
  pageComment?: string;
  status: "queued" | "posting" | "posted" | "failed";
  error?: string;
  createdAt: string;
  postedAt?: string;
  reposted?: boolean;
  images: number[];
  cards?: { post: boolean; repost: boolean };
  render: Render;
};
type Queue = { items: Item[]; nextId: string | null; rendering: boolean };

// Mirror VIDEO and ATTACHED in lib/linkedinQueue.ts (server-only, so not importable here).
export const VIDEO = 4;
export const ATTACHED = 5;
const isVideo = (v: number | null) => v === VIDEO || v === ATTACHED;

/** What a post goes out with when nothing was clicked: its first image. A video is only ever an explicit pick. */
export const defaultCandidate = (images: number[]): number | null => images.find((v) => !isVideo(v)) ?? null;

/** The candidate a post uses: the explicit pick when there is one (null = "No image"), else the default. */
export const chosenCandidate = (images: number[], picks: Record<string, number | null>, id: string): number | null =>
  id in picks ? picks[id] : defaultCandidate(images);

/** How a candidate is named in an error: "Image 2", "The video", "Your video". */
export const candidateName = (v: number) => (v === VIDEO ? "The video" : v === ATTACHED ? "Your video" : `Image ${v}`);
const cardUrl = (id: string, kind: "post" | "repost") => `/api/asset?which=card&id=${encodeURIComponent(id)}&kind=${kind}`;
const imgUrl = (id: string, v: number) => `/api/asset?which=queue&id=${encodeURIComponent(id)}&v=${v}`;
const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
// Ease-out cubic-bezier for opening and closing a post: quick start, soft landing.
const EASE = [0.22, 1, 0.36, 1] as const;

// The LinkedIn queue: every queued post as a card that opens and closes, each with its own image
// choice and its own Post button. Any post can go out, in any order. Nothing here is scheduled.
export default function QueueBoard({
  brandName,
  hasLogo,
  authorName,
  hasAvatar,
  pollMs = 3_000,
  onCount,
}: {
  brandName: string;
  hasLogo: boolean;
  authorName: string;
  hasAvatar: boolean;
  /** How often to refresh. The top-bar dropdown keeps this mounted and slows it down while closed. */
  pollMs?: number;
  /** Reports how many posts are waiting, for the top-bar badge. */
  onCount?: (queued: number) => void;
}) {
  const reduce = useReducedMotion();
  const [q, setQ] = useState<Queue | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // Per post: absent = not chosen yet (its first image), null = "no image", n = image n (4 = the clip, 5 = your video).
  const [images, setImages] = useState<Record<string, number | null>>({});
  // Which cards are open. The first queued post opens by default, once.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [triggered, setTriggered] = useState<string | null>(null);
  const [loginNote, setLoginNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/linkedin", { cache: "no-store" });
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
    // "Add to queue" on a card fires this, so a new item shows up without waiting for the poll.
    window.addEventListener("shippost:queue-changed", load);
    return () => {
      clearInterval(t);
      window.removeEventListener("shippost:queue-changed", load);
    };
  }, [load, pollMs]);

  const items = q?.items ?? [];
  const queued = items.filter((i) => i.status === "queued");
  useEffect(() => onCount?.(queued.length), [queued.length, onCount]);
  const firstId = queued[0]?.id;
  useEffect(() => {
    if (firstId) setOpen((o) => (firstId in o ? o : { ...o, [firstId]: true }));
  }, [firstId]);

  const posting = items.find((i) => i.status === "posting");
  const last = triggered ? items.find((i) => i.id === triggered) : undefined;
  const done = items.filter((i) => i.status === "posted" || i.status === "failed").slice(-8).reverse();

  const chosenFor = (i: Item) => chosenCandidate(i.images, images, i.id);
  const setErr = (id: string, e: string | null) => setErrs((m) => ({ ...m, [id]: e ?? "" }));

  const post = async (i: Item) => {
    if (busyId) return;
    const chosen = chosenFor(i);
    // Never fall back to text-only behind the user's back: a picked image that is gone is an error.
    if (chosen !== null && !i.images.includes(chosen)) {
      setErr(i.id, `${candidateName(chosen)} is not available any more. Pick another one, or "No image".`);
      return;
    }
    setBusyId(i.id);
    setErr(i.id, null);
    try {
      const r = await fetch("/api/linkedin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "trigger", id: i.id, image: chosen }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErr(i.id, j.error || "Couldn't start the post.");
      else setTriggered(i.id);
      await load();
    } catch (e) {
      setErr(i.id, String((e as Error).message));
    } finally {
      setBusyId(null);
    }
  };

  const login = async () => {
    setLoginNote(null);
    const r = await fetch("/api/linkedin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "login" }) });
    const j = await r.json().catch(() => ({}));
    setLoginNote(r.ok ? "A browser window opened on LinkedIn: log in there (5 min), it closes by itself once you are in." : j.error || "Couldn't open the login window.");
  };

  const remove = async (id: string) => {
    const r = await fetch(`/api/linkedin?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok) setErr(id, (await r.json().catch(() => ({}))).error || "Couldn't remove it.");
    await load();
  };

  const thumb = (selected: boolean) =>
    `relative cursor-pointer overflow-hidden rounded-lg border-2 transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
      selected ? "border-accent" : "border-border hover:border-accent/60"
    }`;

  return (
    <div className="space-y-4">
      {loadErr && <p className="text-sm text-red-400">Couldn&apos;t load the queue: {loadErr}</p>}

      {last && (last.status === "posting" || last.status === "posted" || last.status === "failed") && (
        <div
          aria-live="polite"
          className={`rounded-lg border p-3 text-sm ${last.status === "failed" ? "border-red-400/50 text-red-300" : "border-border text-fg"}`}
        >
          {last.status === "posting" && "Posting to LinkedIn… a browser window is doing it. If it shows the LinkedIn login page, log in there (5 min), then leave it alone."}
          {last.status === "posted" && `Posted${last.mode === "company" ? (last.reposted ? " and reposted on your profile" : " on the page") : ""}.`}
          {last.status === "failed" && (
            <>
              Post failed: {last.error || "unknown error"}
              <div className="mt-1 text-xs text-muted">Screenshot: drafts/.linkedin/{last.id}.error.png</div>
            </>
          )}
          {last.status === "posted" && last.error && <div className="mt-1 text-xs text-red-300">Follow-up failed: {last.error}</div>}
        </div>
      )}

      {q && queued.length === 0 && (
        <p className="rounded-lg border border-border p-4 text-sm text-muted">Nothing queued. Add a post from a draft&apos;s option card.</p>
      )}

      {queued.map((i, n) => {
        const isOpen = Boolean(open[i.id]);
        const chosen = chosenFor(i);
        const rendering = i.render?.state === "rendering" || i.render?.state === "waiting";
        // Nothing chosen yet and no image ready: wait rather than post text-only by accident.
        // (Your video does not count: it is never the default, so it must not unblock a text-only post.)
        const blockedByRender = rendering && !(i.id in images) && defaultCandidate(i.images) === null;
        // Between the click and the runner claiming it, the post is still "queued": show it started.
        const starting = triggered === i.id && !posting && !i.error;
        const working = busyId === i.id || starting;
        const disabled = Boolean(busyId) || Boolean(posting) || starting || blockedByRender;
        return (
          <section key={i.id} className={`rounded-2xl border bg-surface transition-colors duration-300 ${isOpen ? "border-accent/50" : "border-border"}`}>
            <button
              onClick={() => setOpen((o) => ({ ...o, [i.id]: !isOpen }))}
              aria-expanded={isOpen}
              aria-controls={`queue-item-${i.id}`}
              className="flex w-full cursor-pointer items-center gap-2 rounded-2xl px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="font-mono text-xs text-muted">#{n + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-fg">{i.topic}</span>
                <span className="block text-xs text-muted">
                  {i.mode === "company" ? `${brandName || "company"} page + repost` : "your profile"} · {renderLabel(i.render)}
                </span>
              </span>
              <motion.svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                animate={{ rotate: isOpen ? 180 : 0 }}
                transition={reduce ? { duration: 0 } : { duration: 0.3, ease: EASE }}
                className="shrink-0 text-muted"
              >
                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </motion.svg>
            </button>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  id={`queue-item-${i.id}`}
                  key="body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={reduce ? { duration: 0 } : { duration: 0.35, ease: EASE }}
                  className="overflow-hidden"
                >
                  <div className="space-y-4 px-4 pb-4">
                    {/* Post first: the action sits above the content it acts on. */}
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={() => post(i)}
                        disabled={disabled}
                        aria-busy={working}
                        className="min-h-[44px] cursor-pointer rounded-lg border border-accent bg-accent/15 px-5 py-2 text-sm font-semibold text-accent transition duration-200 hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50"
                      >
                        <span className="inline-flex items-center gap-2">
                          {working && (
                            <svg className="h-4 w-4 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                              <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                            </svg>
                          )}
                          {working ? "Opening the browser…" : "Post"}
                        </span>
                      </button>
                      {!working && (
                        <button
                          onClick={() => remove(i.id)}
                          className="min-h-[44px] cursor-pointer rounded-lg px-3 py-2 text-sm text-muted transition duration-200 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          Remove
                        </button>
                      )}
                      <span className="text-xs text-muted">
                        {posting && posting.id !== i.id
                          ? "Another post is going out: one at a time."
                          : blockedByRender
                            ? 'Its images are still rendering. Wait, or pick "No image".'
                            : ""}
                      </span>
                    </div>
                    {errs[i.id] && <p className="text-xs text-red-400">{errs[i.id]}</p>}
                    {i.error && (
                      <p className="rounded-lg border border-red-400/40 p-2 text-xs text-red-300">
                        Last try did not post anything: {i.error}
                        {/not logged in/i.test(i.error) && (
                          <button onClick={login} className="ml-2 cursor-pointer font-semibold text-accent underline-offset-2 hover:underline">
                            Log in to LinkedIn
                          </button>
                        )}
                      </p>
                    )}
                    {loginNote && <p className="text-xs text-muted">{loginNote}</p>}

                    <div>
                      <div className="mb-2 text-xs text-muted">Image</div>
                      <div
                        className={`grid gap-2 ${["grid-cols-4", "grid-cols-5", "grid-cols-6"][[VIDEO, ATTACHED].filter((v) => i.images.includes(v)).length]}`}
                        role="radiogroup"
                        aria-label={`Image or video for ${i.topic}`}
                      >
                        {[1, 2, 3].map((v) =>
                          i.images.includes(v) ? (
                            <button
                              key={v}
                              role="radio"
                              aria-checked={chosen === v}
                              onClick={() => setImages((m) => ({ ...m, [i.id]: v }))}
                              className={thumb(chosen === v)}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={imgUrl(i.id, v)} alt={`Candidate image ${v}`} className="aspect-[4/5] w-full object-cover" />
                            </button>
                          ) : (
                            <div
                              key={v}
                              className="flex aspect-[4/5] items-center justify-center rounded-lg border-2 border-dashed border-border text-center text-xs text-muted"
                            >
                              {i.render?.state === "waiting" ? "waiting its turn" : rendering || !i.render ? "rendering…" : "no image"}
                            </div>
                          )
                        )}
                        {/* The clip (4) only shows up once rendered: it exists only when config `video` is set.
                            Your video (5) only when the option declared one (`_Video:_` in the draft). */}
                        {([[VIDEO, "video", "Candidate video"], [ATTACHED, "Your video", "Your video"]] as const).map(([v, tag, label]) =>
                          i.images.includes(v) ? (
                            <button
                              key={v}
                              role="radio"
                              aria-checked={chosen === v}
                              onClick={() => setImages((m) => ({ ...m, [i.id]: v }))}
                              className={thumb(chosen === v)}
                            >
                              <video src={imgUrl(i.id, v)} muted loop autoPlay playsInline aria-label={label} className="aspect-[4/5] w-full object-cover" />
                              <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-white">{tag}</span>
                            </button>
                          ) : null
                        )}
                        <button
                          role="radio"
                          aria-checked={chosen === null}
                          onClick={() => setImages((m) => ({ ...m, [i.id]: null }))}
                          className={`${thumb(chosen === null)} flex aspect-[4/5] items-center justify-center text-xs text-muted`}
                        >
                          No image
                        </button>
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 text-xs text-muted">{i.mode === "company" ? `On the ${brandName || "company"} page` : "On your profile"}</div>
                      <LinkedInPreview
                        companyPost={i.text}
                        brandName={brandName}
                        hasLogo={hasLogo}
                        companyMode={i.mode === "company"}
                        authorName={authorName}
                        hasAvatar={hasAvatar}
                        imageSrc={chosen !== null && !isVideo(chosen) && i.images.includes(chosen) ? imgUrl(i.id, chosen) : null}
                        videoSrc={chosen !== null && isVideo(chosen) && i.images.includes(chosen) ? imgUrl(i.id, chosen) : null}
                      />
                    </div>

                    {i.mode === "company" && i.pageComment && (
                      <div>
                        <div className="mb-1 text-xs text-muted">First comment as {brandName || "the page"} on its post</div>
                        <p className="whitespace-pre-wrap rounded-lg border border-border p-2 text-xs text-fg">{i.pageComment}</p>
                        {i.cards?.post && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={cardUrl(i.id, "post")} alt="Card under the page comment" className="mt-1 w-28 rounded border border-border" />
                        )}
                      </div>
                    )}
                    {i.comment && (
                      <div>
                        <div className="mb-1 text-xs text-muted">{i.mode === "company" ? "Your comment on the repost" : "First comment"}</div>
                        <p className="whitespace-pre-wrap rounded-lg border border-border p-2 text-xs text-fg">{i.comment}</p>
                        {i.cards?.repost && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={cardUrl(i.id, "repost")} alt="Card under the comment" className="mt-1 w-28 rounded border border-border" />
                        )}
                      </div>
                    )}

                    {i.mode === "company" && (
                      <div>
                        <div className="mb-1 text-xs text-muted">Repost on your profile</div>
                        {i.repost ? (
                          <LinkedInPreview companyPost={i.repost} brandName={brandName} hasLogo={hasLogo} companyMode={false} authorName={authorName} hasAvatar={hasAvatar} />
                        ) : (
                          <p className="text-xs text-muted">No repost caption: the page post goes out alone.</p>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        );
      })}

      {done.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-fg">Recent</h2>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {done.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className={`font-mono text-xs ${i.status === "failed" ? "text-red-400" : "text-good"}`}>{i.status}</span>
                <span className="text-fg">{i.topic}</span>
                <span className="text-xs text-muted">{fmt(i.postedAt || i.createdAt)}</span>
                {i.error && (
                  <span className="truncate text-xs text-red-400" title={i.error}>
                    {i.error}
                  </span>
                )}
                {i.status === "failed" && (
                  <button
                    onClick={() => remove(i.id)}
                    className="ml-auto cursor-pointer rounded px-1 text-xs text-muted transition duration-200 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
