"use client";
import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

interface FolderEntry {
  name: string;
  path: string;
  isGit: boolean;
  inAllowlist: boolean;
  sensitive: boolean;
}
interface Listing {
  path: string;
  parent: string | null;
  home: string;
  entries: FolderEntry[];
}

// A local folder browser for adding a project to the mineable allowlist. The OS can't hand the
// browser a real folder path (sandbox), so the local server lists dirs and we drill in here.
export default function FolderPicker({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (name: string) => void;
}) {
  const reduce = useReducedMotion();
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingPath, setAddingPath] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);

  const browse = useCallback(async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = path ? `/api/folders?path=${encodeURIComponent(path)}` : "/api/folders";
      const res = await fetch(url, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) setError(j.error || "Couldn't read that folder.");
      else setListing(j);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    browse();
  }, [browse]);

  // Esc closes — standard modal affordance.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const add = async (entry: FolderEntry) => {
    if (addingPath) return;
    setAddingPath(entry.path);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: entry.path }),
      });
      const j = await res.json();
      if (!res.ok || j.ok === false) {
        setError(j.error || "Couldn't add this folder.");
        return;
      }
      setAdded((prev) => new Set(prev).add(entry.path));
      if (j.warning) setNote(j.warning);
      onAdded(j.name || entry.name); // parent refreshes its project chips + selects it
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setAddingPath(null);
    }
  };

  // Friendly version of the current path: collapse home → ~.
  const prettyPath = listing
    ? listing.path === listing.home
      ? "~"
      : listing.path.startsWith(listing.home + "/")
        ? "~" + listing.path.slice(listing.home.length)
        : listing.path
    : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add a project"
    >
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <motion.div
        initial={reduce ? false : { opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={reduce ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
        className="relative flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-glow"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-fg">Add a project</h2>
            <p className="truncate font-mono text-xs text-muted" title={listing?.path}>
              {prettyPath || "…"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-3 shrink-0 rounded-md border border-border bg-elevated px-2 py-1 text-xs text-muted transition hover:text-fg"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {listing?.parent && (
            <button
              type="button"
              onClick={() => browse(listing.parent!)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted transition hover:bg-elevated"
            >
              <span aria-hidden>↑</span> ..
            </button>
          )}

          {loading ? (
            <p className="px-3 py-6 text-center text-sm text-muted">Reading…</p>
          ) : listing && listing.entries.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">No sub-folders here.</p>
          ) : (
            listing?.entries.map((e) => {
              const isAdded = e.inAllowlist || added.has(e.path);
              return (
                <div
                  key={e.path}
                  className="group flex items-center gap-2 rounded-lg px-3 py-2 transition hover:bg-elevated"
                >
                  <button
                    type="button"
                    onClick={() => browse(e.path)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    title={`Open ${e.name}`}
                  >
                    <span aria-hidden className="text-muted">
                      📁
                    </span>
                    <span className="truncate text-sm text-fg">{e.name}</span>
                    {e.isGit && (
                      <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">
                        git
                      </span>
                    )}
                  </button>
                  {e.sensitive ? (
                    <span
                      className="shrink-0 text-[10px] text-muted"
                      title="Under your day-job repos or matches a scrubbed name — can't be mined"
                    >
                      client · blocked
                    </span>
                  ) : isAdded ? (
                    <span className="shrink-0 text-xs font-medium text-good">✓ added</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => add(e)}
                      disabled={addingPath === e.path}
                      className="shrink-0 rounded-md border border-border bg-elevated px-2.5 py-1 text-xs text-fg opacity-0 transition hover:border-accent hover:text-accent focus-visible:opacity-100 disabled:opacity-50 group-hover:opacity-100"
                    >
                      {addingPath === e.path ? "adding…" : "+ Add"}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="border-t border-border px-4 py-2.5">
          {error && <p className="mb-1 text-xs text-red-400">{error}</p>}
          {note && <p className="mb-1 text-xs text-good">{note}</p>}
          <p className="text-[11px] text-muted">
            Click a folder to open it; <span className="text-fg/70">+ Add</span> puts it on your mineable
            allowlist. Only add <span className="text-fg/70">your own</span> repos — never client work.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
