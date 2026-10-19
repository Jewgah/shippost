"use client";
import { defaultComment, defaultPageComment, type CommentLinks } from "@/lib/firstComment";
import { useEffect, useState } from "react";
import type { DraftOption } from "@/lib/draftParser";

type Render = { state: "waiting" | "rendering" | "done" | "failed"; done: number; total?: number; error?: string; note?: string } | null;
// Candidates are 3 images, plus a video when config `video` is set (total 4): the label says which.
const ready = (done: number, total: number | undefined) =>
  total === 4 ? (done === 4 ? "3 images + video ready" : `${done} of 4 ready`) : `${done} images ready`;
export function renderLabel(r: Render): string {
  if (!r) return "images: starting";
  if (r.state === "waiting") return "images: waiting for another render";
  if (r.state === "rendering" && r.note) return `${r.done}/${r.total ?? 3} done, ${r.note}`;
  // ~2 min per image measured on this Mac (114-136 s, 2026-10-14), so 0/3 for minutes is normal.
  if (r.state === "rendering") return `images: ${r.done}/${r.total ?? 3} done, about 2 min each`;
  if (r.state === "done") return r.total === 0 ? "no AI image prompt, text only" : ready(r.done, r.total);
  // A failed video still leaves the images (and the reverse): say what is usable.
  return `${r.done > 0 ? `${ready(r.done, r.total)}, ` : ""}failed: ${r.error ?? "unknown error"}`;
}

// "Add to queue": put this option in the manual LinkedIn queue. Adding renders its 3 candidate
// images (and the video, when config `video` is set) in the background; posting happens later, one click at a time, from the queue dropdown in the top bar.
export default function LinkedInPostPanel({
  option,
  date,
  companyMode,
  brandName,
  hasCompanyPage,
  commentLinks = { siteUrl: "", landingUrl: "", companyUrl: "" },
  onGenerateCompany,
  generatingCompany = false,
}: {
  option: DraftOption;
  date: string;
  companyMode: boolean;
  brandName: string;
  hasCompanyPage: boolean;
  commentLinks?: CommentLinks;
  /** Runs "Generate for company" (writes sections D and B into the draft). */
  onGenerateCompany?: () => void;
  generatingCompany?: boolean;
}) {
  // Company page text: section A in company mode, else the "Generate for company" version (D), else A.
  const companyText = companyMode ? option.companyPost : option.companyPage || option.companyPost;
  const [mode, setMode] = useState<"personal" | "company">("personal");
  const [text, setText] = useState(option.companyPost);
  const [repost, setRepost] = useState(option.repostCaption);
  // Picked per mode (site link, or the Infinify offer on a profile-only Infinify post), still editable.
  const [comment, setComment] = useState(() => defaultComment(option, "personal", commentLinks));
  // Company mode: the page's own comment on its post (its voice, its site), apart from the author's.
  const [pageComment, setPageComment] = useState(() => defaultPageComment(commentLinks));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  // Older personal-mode drafts have no company version (D) and no repost caption (B).
  const missingCompanyVersion = !companyMode && !option.companyPage;

  // "Generate for company" rewrote the draft: refill the company fields from the new sections.
  useEffect(() => {
    if (mode !== "company") return;
    setText(companyText);
    setRepost(option.repostCaption);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [option.companyPage, option.repostCaption]);

  const pickMode = (m: "personal" | "company") => {
    setMode(m);
    setText(m === "company" ? companyText : option.companyPost);
    setComment(defaultComment(option, m, commentLinks));
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/linkedin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, option: option.n, mode, text, repost, comment, pageComment }),
      });
      const j = await r.json();
      if (!r.ok) setErr(j.error || "Couldn't add it to the queue.");
      else {
        setAdded(true);
        // The top-bar queue dropdown listens for this, so the new item shows up at once.
        window.dispatchEvent(new Event("shippost:queue-changed"));
      }
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const field =
    "w-full rounded-md border border-border bg-bg p-2 text-sm text-fg outline-none transition duration-200 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent";

  return (
    <div className="mb-3 space-y-3 rounded-lg border border-accent/40 bg-elevated p-3 text-sm">
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <legend className="sr-only">Where to post</legend>
        <label className="flex cursor-pointer items-center gap-1.5 py-1">
          <input type="radio" name={`mode-${date}-${option.n}`} checked={mode === "personal"} onChange={() => pickMode("personal")} />
          my profile only
        </label>
        <label
          className={`flex items-center gap-1.5 py-1 ${hasCompanyPage ? "cursor-pointer" : "opacity-50"}`}
          title={hasCompanyPage ? "" : "Set brand.linkedinPageUrl in config.json"}
        >
          <input
            type="radio"
            name={`mode-${date}-${option.n}`}
            disabled={!hasCompanyPage}
            checked={mode === "company"}
            onChange={() => pickMode("company")}
          />
          {brandName || "company"} page + repost on my profile
        </label>
      </fieldset>

      {mode === "company" && missingCompanyVersion && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-xs text-muted">
          <span className="mr-auto">This draft has no {brandName || "company"} version or repost caption yet: below is your personal post.</span>
          {onGenerateCompany && (
            <button
              type="button"
              onClick={onGenerateCompany}
              disabled={generatingCompany}
              className="cursor-pointer rounded-md border border-accent px-2 py-1 font-semibold text-accent transition duration-200 hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50"
            >
              {generatingCompany ? "Writing it… (1-2 min)" : "Generate the company version + caption"}
            </button>
          )}
        </div>
      )}

      <label className="block">
        <span className="mb-1 block text-xs text-muted">{mode === "company" ? `Post on the ${brandName || "company"} page` : "Post on my profile"}</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} maxLength={3000} className={`${field} resize-y`} />
      </label>

      {mode === "company" && (
        <label className="block">
          <span className="mb-1 block text-xs text-muted">Repost caption on my profile (empty = no repost)</span>
          <textarea value={repost} onChange={(e) => setRepost(e.target.value)} rows={3} maxLength={3000} className={`${field} resize-y`} />
        </label>
      )}

      {mode === "company" && (
        <label className="block">
          <span className="mb-1 block text-xs text-muted">First comment as {brandName || "the page"} on its post (the page&apos;s voice), empty = none</span>
          <textarea value={pageComment} onChange={(e) => setPageComment(e.target.value)} rows={2} maxLength={1250} className={`${field} resize-y`} />
        </label>
      )}

      <label className="block">
        <span className="mb-1 block text-xs text-muted">
          {mode === "company" ? "Your comment on your repost" : "First comment (on your post)"}, empty = none
        </span>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={1250} className={`${field} resize-y`} />
      </label>

      <div className="flex items-center justify-end">
        <button
          onClick={submit}
          disabled={busy || added || !text.trim()}
          className="min-h-[36px] cursor-pointer rounded-md border border-accent bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent transition duration-200 hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50"
        >
          {busy ? "Adding…" : added ? "Added to the queue" : "Add to queue (renders the images)"}
        </button>
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}

      {added && <p className="text-xs text-good">Added to the queue (opened at the top right).</p>}
    </div>
  );
}
