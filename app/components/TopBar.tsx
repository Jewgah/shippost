"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import ThemeSwitcher from "./ThemeSwitcher";
import QueueBoard from "./QueueBoard";
import XQueueBoard from "./XQueueBoard";

const QUEUE_OPEN_KEY = "shippost-queue-open";

export default function TopBar({
  brandName,
  hasLogo = false,
  authorName = "",
  hasAvatar = false,
}: {
  brandName: string;
  hasLogo?: boolean;
  authorName?: string;
  hasAvatar?: boolean;
}) {
  const reduce = useReducedMotion();
  const path = usePathname() ?? "";
  const onX = path === "/x" || path.startsWith("/x/");
  const [quitting, setQuitting] = useState(false);
  // The LinkedIn queue lives in this dropdown, on every page. It stays open across pages and
  // reloads (remembered per browser) until closed with the icon or Esc.
  const [queueOpen, setQueueOpen] = useState(false);
  const [queued, setQueued] = useState(0);
  const [queuedX, setQueuedX] = useState(0);
  const waiting = onX ? queuedX : queued;
  const queueName = onX ? "X post queue" : "LinkedIn post queue";
  // The panel is portalled to <body>: the header's backdrop-blur would otherwise become the
  // containing block of a `fixed` child and squash the panel into the header's 56px.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const queueRef = useRef<HTMLDivElement>(null);
  const queueBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    try {
      setQueueOpen(localStorage.getItem(QUEUE_OPEN_KEY) === "1");
    } catch {
      /* storage blocked: starts closed */
    }
  }, []);
  const toggleQueue = useCallback((open: boolean) => {
    setQueueOpen(open);
    try {
      localStorage.setItem(QUEUE_OPEN_KEY, open ? "1" : "0");
    } catch {
      /* storage blocked: still works for this page */
    }
  }, []);
  // "Add to queue" on a card opens the dropdown, so the new post (and its renders) is in view.
  // Wide screens: the open queue pushes the page content left instead of covering it, so the
  // draft recenters in the space that is left (styles/globals.css, html.queue-open).
  useEffect(() => {
    document.documentElement.classList.toggle("queue-open", queueOpen && !onX);
    return () => document.documentElement.classList.remove("queue-open");
  }, [queueOpen, onX]);
  useEffect(() => {
    const open = () => toggleQueue(true);
    window.addEventListener("shippost:queue-changed", open);
    return () => window.removeEventListener("shippost:queue-changed", open);
  }, [toggleQueue]);
  // A click anywhere outside the dropdown (and outside its own icon, which toggles) closes it.
  useEffect(() => {
    if (!queueOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (queueRef.current?.contains(t) || queueBtnRef.current?.contains(t)) return;
      toggleQueue(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [queueOpen, toggleQueue]);
  useEffect(() => {
    if (!queueOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // Esc in a text field (editing a draft) belongs to the field, not to the dropdown.
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "Escape") toggleQueue(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [queueOpen, toggleQueue]);

  async function quit() {
    if (!confirm("Stop the shippost server? The app will close and the browser tab can be closed.")) return;
    try {
      const res = await fetch("/api/quit", { method: "POST" });
      if (res.status === 409) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || "A generation is still running — wait for it to finish before quitting.");
        return;
      }
      setQuitting(true);
    } catch {
      setQuitting(true); // server already went down mid-request — same outcome
    }
  }

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/80 backdrop-blur">
      <div className="relative mx-auto flex max-w-3xl items-center justify-between px-5 py-3">
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
        <nav aria-label="Channel" className="flex items-center rounded-full border border-border p-0.5 text-xs">
          {[
            { href: "/", label: "LinkedIn", active: !onX },
            { href: "/x", label: "X", active: onX },
          ].map((t) => (
            <Link
              key={t.href}
              href={t.href}
              aria-current={t.active ? "page" : undefined}
              className={`rounded-full px-3 py-1 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                t.active ? "bg-accent text-bg" : "text-muted hover:text-fg"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <button
            ref={queueBtnRef}
            type="button"
            onClick={() => toggleQueue(!queueOpen)}
            aria-expanded={queueOpen}
            aria-controls="queue-dropdown"
            aria-label={`${queueName}${waiting ? `, ${waiting} waiting` : ""}`}
            title={queueName}
            className={`relative transition hover:text-accent ${queueOpen ? "text-accent" : "text-muted"}`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M17 16l3 2-3 2v-4z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            {waiting > 0 && (
              <span className="absolute -right-2 -top-2 min-w-[16px] rounded-full bg-accent px-1 text-center font-mono text-[10px] leading-4 text-bg">
                {waiting}
              </span>
            )}
          </button>
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
      {/* Always mounted (hidden when closed) so the badge stays current; polls slower while closed. */}
      {mounted &&
        createPortal(
          <div
            ref={queueRef}
            id="queue-dropdown"
            hidden={!queueOpen}
            className="fixed bottom-4 right-4 top-16 z-30 w-[min(var(--queue-w),calc(100vw-32px))] overflow-y-auto rounded-2xl border border-border bg-bg p-4 shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-fg">{onX ? "X queue" : "LinkedIn queue"}</h2>
              <button
                type="button"
                onClick={() => toggleQueue(false)}
                aria-label="Close the queue"
                className="rounded px-1 text-muted transition hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                ✕
              </button>
            </div>
            {/* Both stay mounted so each badge count stays current; the other channel's board is hidden. */}
            <div hidden={onX}>
              <QueueBoard
                brandName={brandName}
                hasLogo={hasLogo}
                authorName={authorName}
                hasAvatar={hasAvatar}
                pollMs={queueOpen && !onX ? 3_000 : 15_000}
                onCount={setQueued}
              />
            </div>
            <div hidden={!onX}>
              <XQueueBoard pollMs={queueOpen && onX ? 3_000 : 15_000} onCount={setQueuedX} />
            </div>
          </div>,
          document.body
        )}
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
