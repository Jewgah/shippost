"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import type { DraftOption } from "@/lib/draftParser";
import { StarBadge, ScoreBadge, PillarTag } from "./badges";
import ABSection from "./ABSection";
import LinkedInPreview from "./LinkedInPreview";

export default function OptionCard({
  option,
  date,
  brandName,
  hasLogo,
  index,
}: {
  option: DraftOption;
  date: string;
  brandName: string;
  hasLogo: boolean;
  index: number;
}) {
  const [posted, setPosted] = useState(false);
  const [busy, setBusy] = useState(false);

  const markPosted = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          option: option.n,
          pillar: option.pillar,
          topic: option.topic,
          companyPost: option.companyPost,
          repostCaption: option.repostCaption,
        }),
      });
      if (res.ok) setPosted(true);
    } finally {
      setBusy(false);
    }
  };

  const showLogoThumb = hasLogo && /logo/i.test(option.visual);

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.06, ease: "easeOut" }}
      className={`rounded-2xl border bg-surface p-4 sm:p-5 ${
        option.star ? "border-accent/60 shadow-glow" : "border-border"
      }`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-muted">Option {option.n || "?"}</span>
        {option.star && <StarBadge />}
        <PillarTag pillar={option.pillar} />
        <span className="text-sm font-semibold text-fg">{option.topic}</span>
        <span className="ml-auto">
          <ScoreBadge score={option.score} />
        </span>
      </div>

      {!option.parsed ? (
        <pre className="overflow-x-auto rounded-lg border border-border bg-bg/40 p-3 text-xs text-muted">
          {option.raw}
        </pre>
      ) : (
        <div className="space-y-3">
          <LinkedInPreview companyPost={option.companyPost} brandName={brandName} hasLogo={hasLogo} />

          <ABSection label="A" hint="company post — paste on your page" text={option.companyPost} />
          {option.repostCaption && (
            <ABSection label="B" hint="repost caption — your profile" text={option.repostCaption} />
          )}

          {option.why && <p className="text-xs text-muted"><span className="text-fg/70">Why it works:</span> {option.why}</p>}
          {option.visual && (
            <div className="flex items-center gap-2 text-xs text-muted">
              {showLogoThumb && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src="/api/asset?which=logo" alt="" className="h-8 w-8 rounded object-contain ring-1 ring-border" />
              )}
              <span><span className="text-fg/70">Suggested visual:</span> {option.visual}</span>
            </div>
          )}

          <div className="pt-1">
            <button
              onClick={markPosted}
              disabled={busy || posted}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                posted
                  ? "bg-good/15 text-good"
                  : "border border-border bg-elevated text-fg hover:border-accent hover:text-accent"
              }`}
            >
              {posted ? "✓ posted — added to your voice corpus" : busy ? "saving…" : "✓ I posted this"}
            </button>
          </div>
        </div>
      )}
    </motion.article>
  );
}
