"use client";
import { useState, Fragment } from "react";

function withHashtags(text: string) {
  // Highlight #hashtags in LinkedIn's accent color.
  const parts = text.split(/(#[\p{L}0-9_]+)/u);
  return parts.map((p, i) =>
    /^#[\p{L}0-9_]+$/u.test(p) ? (
      <span key={i} className="text-[#0a66c2]">
        {p}
      </span>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    )
  );
}

export default function LinkedInPreview({
  companyPost,
  brandName,
  hasLogo,
}: {
  companyPost: string;
  brandName: string;
  hasLogo: boolean;
}) {
  const [open, setOpen] = useState(false);
  const lines = companyPost.split("\n");
  const firstLine = lines[0] ?? "";
  const hasMore = companyPost.trim().length > firstLine.trim().length;
  const shown = open ? companyPost : firstLine;

  return (
    <div className="rounded-lg border border-border bg-white text-[#1d1d1f] shadow-sm">
      <div className="flex items-center gap-2 px-3 pt-3">
        {hasLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/api/asset?which=logo" alt="" className="h-9 w-9 rounded-full object-contain bg-white ring-1 ring-black/10" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0a66c2] text-sm font-bold text-white">
            {(brandName || "S").charAt(0).toUpperCase()}
          </div>
        )}
        <div className="leading-tight">
          <div className="text-sm font-semibold">{brandName || "Your Brand"}</div>
          <div className="text-[11px] text-[#666]">now · 🌐</div>
        </div>
      </div>
      <div className="px-3 py-2 text-[13px] leading-snug">
        <span className="whitespace-pre-line">{withHashtags(shown)}</span>
        {hasMore && !open && (
          <button onClick={() => setOpen(true)} className="ml-1 text-[#666] hover:text-[#0a66c2]">
            …see more
          </button>
        )}
      </div>
      <div className="flex items-center justify-around border-t border-black/10 py-1 text-[12px] font-medium text-[#666]">
        <span>👍 Like</span>
        <span>💬 Comment</span>
        <span>↻ Repost</span>
        <span>➤ Send</span>
      </div>
    </div>
  );
}
