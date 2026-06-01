"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { DraftOption } from "@/lib/draftParser";
import OptionCard from "./OptionCard";

// Lay the ranked options side-by-side in a horizontal, snap-scrolling rail so all five
// are scannable at a glance (vs. a tall vertical stack). Prev/next + dots + ←/→ keys.
export default function DraftCarousel({
  options,
  date,
  brandName,
  hasLogo,
  companyMode,
  authorName,
  hasAvatar,
}: {
  options: DraftOption[];
  date: string;
  brandName: string;
  hasLogo: boolean;
  companyMode: boolean;
  authorName: string;
  hasAvatar: boolean;
}) {
  const reduce = useReducedMotion();
  const railRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const scrollToIndex = useCallback(
    (i: number) => {
      const rail = railRef.current;
      if (!rail) return;
      const clamped = Math.max(0, Math.min(i, rail.children.length - 1));
      const child = rail.children[clamped] as HTMLElement | undefined;
      if (child)
        rail.scrollTo({ left: child.offsetLeft - rail.offsetLeft, behavior: reduce ? "auto" : "smooth" });
    },
    [reduce]
  );

  const onScroll = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const center = rail.scrollLeft + rail.clientWidth / 2;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < rail.children.length; i++) {
      const c = rail.children[i] as HTMLElement;
      const cc = c.offsetLeft - rail.offsetLeft + c.clientWidth / 2;
      const d = Math.abs(cc - center);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    setActive(best);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") scrollToIndex(active + 1);
      else if (e.key === "ArrowLeft") scrollToIndex(active - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, scrollToIndex]);

  return (
    <div className="relative">
      {/* counter */}
      <div className="mb-3 text-xs text-muted">
        <span className="font-mono text-fg">{active + 1}</span> / {options.length}
        <span className="ml-2 hidden sm:inline">· swipe or use ← →</span>
      </div>

      {/* rail flanked by big side arrows OUTSIDE the cards */}
      <div className="flex items-center gap-2 sm:gap-3">
        <SideArrow dir="prev" disabled={active === 0} reduce={reduce} onClick={() => scrollToIndex(active - 1)} />
        <div
          ref={railRef}
          onScroll={onScroll}
          className="flex min-w-0 flex-1 snap-x snap-mandatory gap-4 overflow-x-auto py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {options.map((o, i) => (
            <div key={o.n || i} className="h-[72vh] w-full max-w-[600px] shrink-0 snap-center">
              <OptionCard
                option={o}
                date={date}
                brandName={brandName}
                hasLogo={hasLogo}
                index={i}
                bodyScroll
                companyMode={companyMode}
                authorName={authorName}
                hasAvatar={hasAvatar}
              />
            </div>
          ))}
        </div>
        <SideArrow
          dir="next"
          disabled={active === options.length - 1}
          reduce={reduce}
          onClick={() => scrollToIndex(active + 1)}
        />
      </div>

      {/* dots */}
      <div className="mt-2 flex justify-center gap-1.5">
        {options.map((o, i) => (
          <button
            key={o.n || i}
            type="button"
            aria-label={`Go to option ${i + 1}`}
            onClick={() => scrollToIndex(i)}
            className={`h-1.5 rounded-full transition-all duration-200 ${
              i === active ? "w-6 bg-accent" : "w-1.5 bg-border hover:bg-muted"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function SideArrow({
  dir,
  disabled,
  reduce,
  onClick,
}: {
  dir: "prev" | "next";
  disabled: boolean;
  reduce: boolean | null;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileHover={reduce || disabled ? undefined : { scale: 1.08 }}
      whileTap={reduce || disabled ? undefined : { scale: 0.92 }}
      aria-label={dir === "prev" ? "Previous option" : "Next option"}
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-fg shadow-glow transition hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-30 sm:h-14 sm:w-14"
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d={dir === "prev" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"}
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </motion.button>
  );
}
