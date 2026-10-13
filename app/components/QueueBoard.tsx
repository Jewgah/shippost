"use client";
import { useCallback, useEffect, useState } from "react";
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
  status: "queued" | "posting" | "posted" | "failed";
  error?: string;
  createdAt: string;
  postedAt?: string;
  reposted?: boolean;
  images: number[];
  render: Render;
};
type Queue = { items: Item[]; nextId: string | null; rendering: boolean };

const imgUrl = (id: string, v: number) => `/api/asset?which=queue&id=${encodeURIComponent(id)}&v=${v}`;
const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");

// The manual LinkedIn queue: the next post in full (pick one of its 3 images), one button to
// post it, and the rest of the queue below. Nothing here is scheduled.
export default function QueueBoard({
  brandName,
  hasLogo,
  authorName,
  hasAvatar,
}: {
  brandName: string;
  hasLogo: boolean;
  authorName: string;
  hasAvatar: boolean;
}) {
  const [q, setQ] = useState<Queue | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // undefined = not chosen yet (use the first image); null = "no image".
  const [image, setImage] = useState<number | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [triggered, setTriggered] = useState<string | null>(null);

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
    const t = setInterval(load, 3_000);
    return () => clearInterval(t);
  }, [load]);

  const items = q?.items ?? [];
  const next = items.find((i) => i.id === q?.nextId) ?? null;
  const nextId = next?.id;
  // A new "next" item starts on its first image again.
  useEffect(() => setImage(undefined), [nextId]);

  const chosen = next ? (image === undefined ? next.images[0] ?? null : image) : null;
  const chosenAvailable = chosen === null || (next?.images.includes(chosen) ?? false);
  const posting = items.find((i) => i.status === "posting");
  const last = triggered ? items.find((i) => i.id === triggered) : undefined;
  const rest = items.filter((i) => i.status === "queued" && i.id !== nextId);
  const done = items.filter((i) => i.status === "posted" || i.status === "failed").slice(-8).reverse();

  const triggerNext = async () => {
    if (!next || busy) return;
    // Never fall back to text-only behind the user's back: a picked image that is gone is an error.
    if (!chosenAvailable) {
      setErr(`Image ${chosen} is not available any more. Pick another one, or "no image".`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/linkedin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "trigger", id: next.id, image: chosen }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErr(j.error || "Couldn't start the post.");
      else setTriggered(next.id);
      await load();
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const r = await fetch(`/api/linkedin?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok) setErr((await r.json().catch(() => ({}))).error || "Couldn't remove it.");
    await load();
  };

  const thumb = (selected: boolean) =>
    `relative cursor-pointer overflow-hidden rounded-lg border-2 transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
      selected ? "border-accent" : "border-border hover:border-accent/60"
    }`;

  return (
    <div className="space-y-6">
      {loadErr && <p className="text-sm text-red-400">Couldn&apos;t load the queue: {loadErr}</p>}

      {last && (last.status === "posting" || last.status === "posted" || last.status === "failed") && (
        <div
          aria-live="polite"
          className={`rounded-lg border p-3 text-sm ${last.status === "failed" ? "border-red-400/50 text-red-300" : "border-border text-fg"}`}
        >
          {last.status === "posting" && "Posting to LinkedIn… a browser window is doing it, leave it alone."}
          {last.status === "posted" && `Posted${last.mode === "company" ? (last.reposted ? " and reposted on your profile" : " on the page") : ""}.`}
          {last.status === "failed" && (
            <>
              Post failed: {last.error || "unknown error"}
              <div className="mt-1 text-xs text-muted">Screenshot: drafts/.linkedin/{last.id}.error.png</div>
            </>
          )}
          {last.status === "posted" && last.error && <div className="mt-1 text-xs text-red-300">Repost failed: {last.error}</div>}
        </div>
      )}

      {q && !next && <p className="rounded-lg border border-border p-4 text-sm text-muted">Nothing queued. Add a post from a draft&apos;s option card.</p>}

      {next && (
        <section className="space-y-4 rounded-2xl border border-accent/50 bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-semibold text-fg">Next post</h2>
            <span className="text-sm text-muted">
              {next.topic} · {next.mode === "company" ? `${brandName || "company"} page + repost on your profile` : "your profile only"}
            </span>
          </div>

          <div>
            <div className="mb-2 text-xs text-muted">
              Image <span className="ml-1">({renderLabel(next.render)})</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Image to attach">
              {[1, 2, 3].map((v) =>
                next.images.includes(v) ? (
                  <button key={v} role="radio" aria-checked={chosen === v} onClick={() => setImage(v)} className={thumb(chosen === v)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imgUrl(next.id, v)} alt={`Candidate image ${v}`} className="aspect-[4/5] w-full object-cover" />
                  </button>
                ) : (
                  <div
                    key={v}
                    className="flex aspect-[4/5] items-center justify-center rounded-lg border-2 border-dashed border-border text-xs text-muted"
                  >
                    {next.render?.state === "rendering" || next.render?.state === "waiting" || !next.render ? "rendering…" : "no image"}
                  </div>
                )
              )}
              <button
                role="radio"
                aria-checked={chosen === null}
                onClick={() => setImage(null)}
                className={`${thumb(chosen === null)} flex aspect-[4/5] items-center justify-center text-xs text-muted`}
              >
                No image
              </button>
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs text-muted">{next.mode === "company" ? `On the ${brandName || "company"} page` : "On your profile"}</div>
            <LinkedInPreview
              companyPost={next.text}
              brandName={brandName}
              hasLogo={hasLogo}
              companyMode={next.mode === "company"}
              authorName={authorName}
              hasAvatar={hasAvatar}
              imageSrc={chosen !== null && chosenAvailable ? imgUrl(next.id, chosen) : null}
            />
          </div>

          {next.mode === "company" && (
            <div>
              <div className="mb-1 text-xs text-muted">Repost on your profile</div>
              {next.repost ? (
                <LinkedInPreview companyPost={next.repost} brandName={brandName} hasLogo={hasLogo} companyMode={false} authorName={authorName} hasAvatar={hasAvatar} />
              ) : (
                <p className="text-xs text-muted">No repost caption: the page post goes out alone.</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3">
            {err && <p className="mr-auto text-xs text-red-400">{err}</p>}
            {posting && <p className="mr-auto text-xs text-muted">A post is going out right now.</p>}
            <button
              onClick={triggerNext}
              disabled={busy || Boolean(posting)}
              className="min-h-[44px] cursor-pointer rounded-lg border border-accent bg-accent/15 px-4 py-2 text-sm font-semibold text-accent transition duration-200 hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50"
            >
              {busy ? "Starting…" : "Trigger next post"}
            </button>
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-fg">Then</h2>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {rest.map((i, n) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="font-mono text-xs text-muted">#{n + 2}</span>
                <span className="text-fg">{i.topic}</span>
                <span className="text-xs text-muted">
                  {i.mode === "company" ? "page + repost" : "profile"} · {renderLabel(i.render)}
                </span>
                <button
                  onClick={() => remove(i.id)}
                  className="ml-auto cursor-pointer rounded px-1 text-xs text-muted transition duration-200 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

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
