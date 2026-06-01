# Roadmap

A running log of notable changes, most recent first.

## a21f227 — feat: posting cadence + streak on home, CI, picks-log hardening (2026-06-01)

**Problem:** Nothing surfaced the every-2-days posting habit (whether you were due, any streak); the picks log grew unbounded; an unreadable draft could 500 the whole list; and there was no CI to protect the test suite now that the repo is public.

**Solution:** Added a server-rendered CadenceBar (last-posted, on-cadence streak, due/on-track) backed by a pure, unit-tested `computeCadence`, fed by a single `pickData()` read shared with the posted badges. Capped the picks log (append normally, rewrite-to-trim only when over cap). Made `listDrafts` skip and log an unreadable draft. Added a GitHub Actions CI workflow running typecheck + vitest on push/PR.

**Files changed:** app/components/CadenceBar.tsx, app/app/page.tsx, app/lib/voice.ts, app/lib/drafts.ts, .github/workflows/ci.yml, app/test/cadence.test.ts, app/test/picks.test.ts

---

## be0b78c — feat: distinguish and track drafts on the list (topics, posted status, search) (2026-06-01)

**Problem:** The drafts list rendered an identical "N options · pillars" subtitle on every row, so runs were indistinguishable; there was no way to see which batches had already been posted; "I posted this" failed silently; and the list full-parsed every draft body just to render summaries.

**Solution:** Lead each row with the top-pick topic + score and the remaining option topics (dropping the repetitive pillars); read the previously write-only `.picks.jsonl` to badge runs already posted from (joined on the exact draft id); add client-side topic/date search; surface post failures; and parse headers only via a new `parseDraftMeta` that shares one split/header pass with `parseDraft`. Also hardened the picks reader against valid-JSON-but-non-object lines that would otherwise 500 the home page.

**Files changed:** app/components/DraftList.tsx, app/components/OptionCard.tsx, app/lib/draftParser.ts, app/lib/drafts.ts, app/lib/voice.ts, app/test/draftParser.test.ts, app/test/picks.test.ts

---
