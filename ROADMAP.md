# Roadmap

A running log of notable changes, most recent first.

## be0b78c — feat: distinguish and track drafts on the list (topics, posted status, search) (2026-06-01)

**Problem:** The drafts list rendered an identical "N options · pillars" subtitle on every row, so runs were indistinguishable; there was no way to see which batches had already been posted; "I posted this" failed silently; and the list full-parsed every draft body just to render summaries.

**Solution:** Lead each row with the top-pick topic + score and the remaining option topics (dropping the repetitive pillars); read the previously write-only `.picks.jsonl` to badge runs already posted from (joined on the exact draft id); add client-side topic/date search; surface post failures; and parse headers only via a new `parseDraftMeta` that shares one split/header pass with `parseDraft`. Also hardened the picks reader against valid-JSON-but-non-object lines that would otherwise 500 the home page.

**Files changed:** app/components/DraftList.tsx, app/components/OptionCard.tsx, app/lib/draftParser.ts, app/lib/drafts.ts, app/lib/voice.ts, app/test/draftParser.test.ts, app/test/picks.test.ts

---
