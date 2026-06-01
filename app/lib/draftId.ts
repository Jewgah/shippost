// Pure, client-safe helpers for a draft id. A draft id is either a plain date
// (YYYY-MM-DD, legacy one-per-day) or a timestamped run (YYYY-MM-DD_HHMMSS).
// No node/server-only imports — keep it trivially testable.

// One source of truth for a draft id's shape. Also the path-traversal guard used
// by readDraft()/listDrafts(): no slashes, dots, or junk can match.
const DRAFT_ID_RE = /^\d{4}-\d{2}-\d{2}(_\d{6})?$/;

/** True iff `id` is a well-formed draft id (the form used in URLs + filenames). */
export function isDraftId(id: string): boolean {
  return DRAFT_ID_RE.test(id);
}

/** Friendly label: timestamped ids show the time (HH:MM); plain dates pass through. */
export function formatDraftId(id: string): string {
  const m = id.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})\d{2}$/);
  return m ? `${m[1]} ${m[2]}:${m[3]}` : id;
}
