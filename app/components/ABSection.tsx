"use client";
import { useState } from "react";
import { motion } from "framer-motion";

export default function ABSection({
  label,
  hint,
  text,
}: {
  label: string;
  hint: string;
  text: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  };

  return (
    <div className="rounded-lg border border-border bg-bg/40">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold text-fg">
          {label} <span className="font-normal text-muted">· {hint}</span>
        </span>
        <button
          onClick={copy}
          className="relative rounded-md border border-border bg-elevated px-2.5 py-1 text-xs text-fg transition hover:border-accent hover:text-accent"
        >
          <motion.span key={copied ? "y" : "n"} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {copied ? "✓ copied" : "copy"}
          </motion.span>
        </button>
      </div>
      <p className="whitespace-pre-line px-3 py-3 text-sm leading-relaxed text-fg/90">{text}</p>
    </div>
  );
}
