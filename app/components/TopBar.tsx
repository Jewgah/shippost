"use client";
import { useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import ThemeSwitcher from "./ThemeSwitcher";

export default function TopBar({ brandName }: { brandName: string }) {
  const reduce = useReducedMotion();
  const [quitting, setQuitting] = useState(false);

  async function quit() {
    if (!confirm("Stop the shippost server? The app will close and the browser tab can be closed.")) return;
    setQuitting(true);
    try {
      await fetch("/api/quit", { method: "POST" });
    } catch {
      /* server is going down — the fetch dropping is expected */
    }
  }

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/80 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3">
        <Link href="/" className="flex items-baseline gap-2">
          <motion.span
            whileHover={reduce ? undefined : { scale: 1.04 }}
            whileTap={reduce ? undefined : { scale: 0.98 }}
            className="inline-block font-mono text-lg font-bold tracking-tight text-fg"
          >
            ship
            <span className="text-shimmer bg-gradient-to-r from-accent via-accent2 to-accent bg-clip-text text-transparent">
              post
            </span>
          </motion.span>
          {brandName && (
            <span className="text-xs text-muted">· {brandName}</span>
          )}
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href="/settings"
            aria-label="Settings"
            title="Settings"
            className="text-muted transition hover:text-accent"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
              <path
                d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H1a2 2 0 110-4h.09A1.65 1.65 0 004.6 8a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V1a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <ThemeSwitcher />
          <button
            type="button"
            onClick={quit}
            aria-label="Quit shippost"
            title="Quit shippost (stop the server)"
            className="text-muted transition hover:text-red-500"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 2v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path
                d="M7.5 6.5a8 8 0 109 0"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
      {quitting && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-bg/95 backdrop-blur">
          <p className="font-mono text-lg font-bold text-fg">shippost stopped</p>
          <p className="text-sm text-muted">
            Server shut down. You can close this tab — relaunch with <code>npm run dev</code> (or
            your own launcher) anytime.
          </p>
        </div>
      )}
    </header>
  );
}
