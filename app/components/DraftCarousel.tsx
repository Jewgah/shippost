"use client";
import type { CommentLinks } from "@/lib/firstComment";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { DraftOption } from "@/lib/draftParser";
import OptionCard from "./OptionCard";
import XOptionCard from "./XOptionCard";
import type { Channel } from "@/lib/channel";

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
  rejectedOptions = [],
  renderedOptions = [],
  builtCarousels = [],
  hasCompanyPage = false,
  commentLinks,
  channel = "linkedin",
}: {
  options: DraftOption[];
  date: string;
  brandName: string;
  hasLogo: boolean;
  companyMode: boolean;
  authorName: string;
  hasAvatar: boolean;
  rejectedOptions?: number[];
  renderedOptions?: number[];
  /** Option numbers whose carousel PDF already exists on disk. */
  builtCarousels?: number[];
  hasCompanyPage?: boolean;
  commentLinks?: CommentLinks;
  channel?: Channel;
}) {
  const reduce = useReducedMotion();
  const railRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  // Deep link: ?option=N opens on option N (its number, not its position, so it survives deletes).
  // The URL is only rewritten once the rail has scrolled, so a fresh load never clobbers ?option.
  const linked = useRef(false);
  // After an option is deleted the list shrinks; `active` may briefly point past the end until the
  // next scroll recomputes it. Clamp for the counter and arrow-disabled states.
  const lastIndex = Math.max(0, options.length - 1);
  const safeActive = Math.min(active, lastIndex);

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
    linked.current = true;
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

  useEffect(() => {
    const n = Number(new URLSearchParams(window.location.search).get("option"));
    const i = options.findIndex((o) => o.n === n);
    const rail = railRef.current;
    const child = rail?.children[i] as HTMLElement | undefined;
    if (rail && child) rail.scrollTo({ left: child.offsetLeft - rail.offsetLeft });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the URL on the visible option so it can be copied or reloaded.
  useEffect(() => {
    const n = options[safeActive]?.n;
    if (!linked.current || !n) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("option") === String(n)) return;
    url.searchParams.set("option", String(n));
    window.history.replaceState(window.history.state, "", url);
  }, [safeActive, options]);

  return (
    <div className="relative">
      {/* counter */}
      <div className="mb-3 text-xs text-muted">
        <span className="font-mono text-fg">{safeActive + 1}</span> / {options.length}
        <span className="ml-2 hidden sm:inline">· swipe or use ← →</span>
      </div>

      {/* rail flanked by big side arrows OUTSIDE the cards */}
      <div className="flex items-center gap-2 sm:gap-3">
        <SideArrow dir="prev" disabled={safeActive === 0} reduce={reduce} onClick={() => scrollToIndex(safeActive - 1)} />
        <div
          ref={railRef}
          onScroll={onScroll}
          className="flex min-w-0 flex-1 snap-x snap-mandatory gap-4 overflow-x-auto py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {options.map((o, i) => (
            <div key={o.n || i} className="h-[72vh] w-full max-w-[600px] shrink-0 snap-center">
              {channel === "x" ? (
                <XOptionCard option={o} date={date} initiallyRejected={rejectedOptions.includes(o.n)} />
              ) : (
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
                initiallyRejected={rejectedOptions.includes(o.n)}
                initiallyRendered={renderedOptions.includes(o.n)}
                hasCarousel={builtCarousels.includes(o.n)}
                hasCompanyPage={hasCompanyPage}
                commentLinks={commentLinks}
              />
              )}
            </div>
          ))}
        </div>
        <SideArrow
          dir="next"
          disabled={safeActive === lastIndex}
          reduce={reduce}
          onClick={() => scrollToIndex(safeActive + 1)}
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
