"use client";
import { motion, useReducedMotion } from "framer-motion";

// Living gradient wash behind all content. Three large blurred blobs drift and
// breathe, colored entirely from the active theme's CSS tokens so it morphs with
// the ThemeSwitcher. Honors reduced-motion by rendering the blobs static.
const BLOBS = [
  {
    color: "var(--accent)",
    className: "left-[-12%] top-[-18%] h-[60vh] w-[60vh]",
    motion: { x: [0, 70, -30, 0], y: [0, 50, -20, 0], scale: [1, 1.15, 0.95, 1] },
    duration: 26,
  },
  {
    color: "var(--accent2)",
    className: "right-[-16%] top-[8%] h-[52vh] w-[52vh]",
    motion: { x: [0, -60, 30, 0], y: [0, 40, 60, 0], scale: [1, 1.1, 1.05, 1] },
    duration: 32,
  },
  {
    color: "var(--good)",
    className: "left-[18%] bottom-[-22%] h-[48vh] w-[48vh]",
    motion: { x: [0, 50, -50, 0], y: [0, -40, 25, 0], scale: [1, 1.2, 0.9, 1] },
    duration: 38,
  },
];

export default function AuroraBackground() {
  const reduce = useReducedMotion();
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {BLOBS.map((b, i) => (
        <motion.div
          key={i}
          className={`absolute rounded-full opacity-40 mix-blend-screen blur-[90px] ${b.className}`}
          style={{ background: `radial-gradient(circle at center, ${b.color}, transparent 70%)` }}
          animate={reduce ? undefined : b.motion}
          transition={
            reduce
              ? undefined
              : { duration: b.duration, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }
          }
        />
      ))}
    </div>
  );
}
