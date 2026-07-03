# Roadmap

A running log of notable changes, most recent first.

## fix: deep-review follow-up — stable option identity, quit guard, owner-token lock (2026-07-03)

**Problem:** A multi-agent deep review of the day's batch confirmed five issues: (1) position-derived numbers for tolerated generic headers were unstable identity — deleting an option shifted the survivors' numbers so logged picks/rejects highlighted the wrong cards, and "Edit with AI" (which matches the literal `Option N` header text) could rewrite a different block than the one clicked; (2) quitting mid-generation orphaned the `claude -p` child and leaked the run lock; (3) the run lock swallowed real errors (EACCES/ENOSPC) as "already running" forever, and a stale-but-alive run could unlink a newer run's lock; (4) with no `siteUrl`, the model wrote a "(no link — soft CTA)" placeholder that rendered as a copyable "paste as first comment" card; (5) in personal-only mode (no B section) the pasteable post swallowed everything after A, now including the C link.

**Solution:** (1) `normalizeDraftMarkdown` freezes generic headers into explicit `## Option N` on first read — before any pick/reject/edit/delete can record a number — so identity never drifts and edit/delete agree (verified live: opening the page rewrites the file); (2) `/api/quit` returns 409 while a run is live, with a friendly alert; (3) the lock now stores an owner token, release is compare-and-delete, and non-EEXIST failures throw instead of masquerading as "running"; (4) SKILL.md omits section C entirely when there's no link, with a render-guard belt for old drafts; (5) the A-section end anchor falls back to C/why/visuals when B is absent, and the C header regex tolerates slipped punctuation. Also: chronological-vs-lexical import sort is now all-or-nothing (a mixed file can't produce a non-transitive order), the folder browser honors an out-of-home `app.projectsRoot` like suggestions do, and the one real project name in a test fixture was replaced with a fictional one. 11 new tests (94 total), including the run lock's first unit tests.

**Files changed:** app/lib/draftParser.ts, app/lib/drafts.ts, app/lib/runLock.ts, app/app/api/generate/route.ts, app/app/api/edit/route.ts, app/app/api/quit/route.ts, app/components/TopBar.tsx, app/components/OptionCard.tsx, app/lib/sharesCsv.ts, app/lib/projects.ts, engine/SKILL.md, engine/generate.sh, app/test/draftParser.test.ts, app/test/sharesCsv.test.ts, app/test/runLock.test.ts

---

## feat: first-comment link section (C) — end-to-end (2026-07-03)

**Problem:** Links in a LinkedIn post body suppress reach; the fix is a link in the first comment — but drafts had nowhere to put one, and a half-started spec (SKILL.md only) would have corrupted the repost caption in the app because the parser didn't know section C existed. It also hardcoded the author's personal URL into the public template.

**Solution:** Full C section: SKILL.md drafts a `**C. First comment**` per option using a config-driven `brand.siteUrl` (surfaced by the harvest's BRAND block; empty = no links, soft CTAs), the parser extracts `firstComment` (and stops the B section at C so the caption stays clean), the app renders it as its own copyable card section, edit.sh preserves it on AI rewrites, and the README's publish ritual gained the paste-the-comment step.

**Files changed:** engine/SKILL.md, engine/harvest.sh, engine/lib/config.sh, engine/edit.sh, config.example.json, app/lib/draftParser.ts, app/components/OptionCard.tsx, app/test/draftParser.test.ts, README.md

---

## feat: quit button — stop the server from the UI (2026-07-03)

**Problem:** The app runs as a dev server someone started in a terminal (or a launcher); there was no way to stop it from the UI, so it lingered in the background unnoticed.

**Solution:** A power icon in the TopBar posts to a new `/api/quit` route (same cross-site guard as every mutating route) which flushes the response and exits the process — verified live: both `next dev` and the npm parent die. A farewell overlay tells the user how to relaunch. Plus a proper app icon.

**Files changed:** app/components/TopBar.tsx, app/app/api/quit/route.ts, app/app/icon.png

---

## fix: correctness pass — parser numbering, pick validation, atomic run lock, import ordering (2026-07-03)

**Problem:** Four latent bugs: (1) a tolerated generic option header numbered by position could collide with an explicit `## Option N` and make delete remove the wrong block; (2) `/api/pick` skipped the draft-id validation its sibling routes have, letting garbage corrupt the picks log join key; (3) the generate/edit lock was check-then-write, so two rapid clicks could spawn two overlapping `claude -p` runs; (4) LinkedIn imports sorted dates lexically, feeding the wrong "most recent" posts into the voice corpus for non-ISO (e.g. US) exports.

**Solution:** (1) when any generic header exists, ALL blocks are numbered by position — unique by construction, and parseDraft/parseDraftMeta/removeOptionFromMarkdown share the numbering; (2) `isDraftId` guard added to `/api/pick`; (3) a shared `acquireRunLock` creates the lock with `O_EXCL` (stale locks stolen safely); (4) dates compare as real timestamps when parseable, lexically otherwise. Each fix has a regression test. Also: a corrupt `.last_run` no longer breaks generate.sh's guard arithmetic.

**Files changed:** app/lib/draftParser.ts, app/app/api/pick/route.ts, app/lib/runLock.ts, app/app/api/generate/route.ts, app/app/api/edit/route.ts, app/lib/sharesCsv.ts, engine/generate.sh, app/test/draftParser.test.ts, app/test/sharesCsv.test.ts

---

## chore: portability + CI hardening + first engine tests (2026-07-03)

**Problem:** The folder browser and recent-project suggestions hardcoded `~/Desktop/Projects` (silently empty on any other layout); the README clone URL required SSH keys; CI ran only typecheck+vitest (no build, no shell lint); and the bash engine — the product core — had zero tests.

**Solution:** New `app.projectsRoot` config key (defaults preserved); README clones over https; CI now also runs `next build` and a shellcheck job (with a `.shellcheckrc` documenting deliberate style suppressions and real fixes applied: `cd || exit`, annotated word-splits); new `engine.test.ts` smoke-tests harvest.sh (digest carries brand/site URL/scrub list/fixture commits) and generate.sh (2-day guard, corrupt `.last_run`) against a throwaway repo + config — plus `SHIPPOST_NO_NOTIFY` so tests never pop desktop notifications. CONTRIBUTING.md added.

**Files changed:** app/lib/projects.ts, app/app/api/suggestions/route.ts, config.example.json, README.md, .github/workflows/ci.yml, .shellcheckrc, scripts/doctor.sh, app/test/engine.test.ts, engine/generate.sh, CONTRIBUTING.md

---

## a2d45e3 — feat: make suggested visuals scroll-stopping art, never the brand logo (2026-06-14)

**Problem:** The visual-suggestion guidance told the engine to "mix the types" and lean on the brand logo plus a generic conceptual shot, which produced forgettable, stock-style image ideas. The logo is the boring default the author already has.

**Solution:** Recast the 3 suggested visuals around a deliberate art-directed star slot (idea 1: an iconic character/archetype recast in the post's role, vivid art styles encouraged), kept idea 2 as the real screenshot/before-after, and made idea 3 a different lane (candid photo metaphor or a second, distinct art style). Hard-banned the brand logo as a suggestion in both the SKILL prompt and the harvest's logo hint, and required style variety across the 5 options so a batch never repeats one look.

**Files changed:** engine/SKILL.md, engine/harvest.sh

---

## verify — reject signal avoids a rejected angle, confirmed by a live run (2026-06-01)

**Problem:** The reject signal's plumbing was unit-tested, but whether a real headless generation actually honors REJECTED ANGLES was unverified.

**Solution:** Ran `engine/generate.sh --force` (the headless `claude -p` path behind the app's Generate button) after rejecting the freshest, most-postable angle (the reject feature itself), chosen because it was NOT in the recent-drafts anti-repeat set, so any avoidance is attributable to the rejection. The harvest fed that feature prominently as commit material; the generated draft produced 5 other recent-commit angles and zero mention of the rejected one. End-to-end loop confirmed: thumb-down → `.rejects.jsonl` → harvest `REJECTED ANGLES` → `SKILL.md` → generation skips it. Test artifacts (the seeded reject, generated draft, run logs) are gitignored, so no code change accompanies this entry.

**Files changed:** none (verification only).

---

## 93e996c — feat: "Not for me" reject signal that steers future generations (2026-06-01)

**Problem:** There was no way to tell the engine an angle was unwanted, so a rejected idea could resurface every run. Picks taught it what to write; nothing taught it what to avoid.

**Solution:** Added a "Not for me" button on each option that POSTs to a new `/api/reject` route, appending to a capped `.rejects.jsonl` (separate from picks, not added to the voice corpus). The harvest surfaces recent rejected topics and SKILL.md tells the engine never to offer them or close variants. Rejected state persists across reloads via `rejectedOptionsByDraftId` threaded through the draft page and carousel. Post/reject buttons are mutually exclusive and cross-guarded so an option can't end up in both logs.

**Files changed:** app/components/OptionCard.tsx, app/components/DraftCarousel.tsx, app/app/draft/[date]/page.tsx, app/app/api/reject/route.ts, app/lib/voice.ts, app/lib/config.ts, engine/harvest.sh, engine/SKILL.md, app/test/rejects.test.ts

---

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
