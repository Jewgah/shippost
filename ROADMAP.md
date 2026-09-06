# Roadmap

A running log of notable changes, most recent first.

## feat: build a LinkedIn carousel PDF from an option and its rendered hero (2026-09-06)

**Problem:** A batch could produce a post and, since the render path landed, one image. It could not produce the format LinkedIn actually rewards for a walkthrough: a document post, a PDF whose pages the feed shows as swipeable slides. Building one by hand meant retyping the post into a design tool, and every retype is a chance for the copy on the slides to stop matching the copy in the post.

**Solution:** `cd app && npm run carousel -- <draft id> <option>` writes `<draftsDir>/.visuals/<draftId>-o<N>.pdf`. The slides are derived from the option's OWN post text through the existing parser, never from a second content model: paragraph 1 is the hook (over the rendered hero when there is one, inlined as a data URI so a `file://` page never has to resolve a subresource), the remaining paragraphs become one slide each - short ones and questions set as statements, bullet runs as bullet slides - and the closing slide reuses the link the engine's ladder already chose and wrote into the option's first comment, falling back to `brand.landingUrl` for `client-outcome` and `brand.siteUrl` otherwise. A bare "link in comments" line never reaches a slide, and a post too short to fill three slides is refused rather than published as a hook and a link. Type sizes come from character count rather than from measurement, because print crops in silence: hook 88 to 64 px, statement 104 to 72, body 46 or 40, all above the floors a feed thumbnail needs, with an overflow warning from the live page as a second line of defence. Colours are parsed out of the app's own `styles/globals.css`, so the deck cannot drift from the product, and `--accent` is fills and rules only: measured, `#8b5cf6` on the midnight preset's surface is 4.40:1, under the AA floor, so every coloured word uses `--accent2` (6.8:1 worst preset). The deck reads as one thing because the kicker, the rule, the wordmark, the counter and the 100 px frame land on the same pixels on every page while only the content block moves; the rule is a progress bar that completes exactly on the closing page, which is also the only page in the deck carrying a filled block, so the ask lands. Over the worst photo there is (pure white, no pre-darkening) the scrim still puts the hook at 11.3:1.

Deliberately CLI-only: the app links to a PDF that exists, it never builds one. That removes the whole `/api/render`-shaped surface (lock, result file, polling, spawn) and with it the real hazard, which is chromium competing with a ~20 GB flux checkpoint for unified memory - the script refuses outright (exit 3) while the `.rendering` lock is fresh, without taking it, since a CLI killed mid-run would leak a lock the app depends on. `carouselOptions` hides a PDF older than its draft: "Edit with AI" rewrites an option in place and keeps its number, so a stale PDF would keep its filename while holding copy the post no longer says, and unlike the hero PNG this artefact contains the post text itself. The script imports `app/lib/carousel.ts` and `draftParser.ts` directly under Node's type stripping (>= 22.18, guarded with a clear message), which is what keeps the content model in one place and under the vitest suite. Playwright is pinned to `~1.60.0`, not `^`: the caret resolves to 1.63, which wants a chromium revision that then has to be downloaded. Measured: `pdfinfo` reports `810 x 1013.04 pts`, which IS 1080x1350 CSS px (Chromium rounds the height by 0.04 %); it will never print the pixel figures, so that is the number to check. 15 new tests (134 total).

**Files changed:** app/lib/carousel.ts, app/scripts/build-carousel.mjs, app/lib/drafts.ts, app/app/api/asset/route.ts, app/app/draft/[date]/page.tsx, app/components/DraftCarousel.tsx, app/components/OptionCard.tsx, app/package.json, app/package-lock.json, app/test/carousel.test.ts, app/test/visuals.test.ts, scripts/doctor.sh, README.md

---

## feat: render an option's suggested visual with a local ComfyUI (2026-09-06)

**Problem:** Every option already ships three visual ideas and the first one carries a ready-to-render `AI prompt: "..."`, but nothing could turn it into an image. A post with an image gets meaningfully more reach, so the prompt was a to-do item the author had to carry into another tool, at the exact moment (right before posting) when friction wins. The draft parser also had no way to read those ideas: `extractVisuals` returned the whole block as one opaque string.

**Solution:** An end-to-end, entirely optional render path. `parseVisualIdeas` splits the visuals block into `{n, text, prompt, noAi}` ideas (tolerant of both the em-dash separator the SKILL template writes and the plain hyphen a humanized file ends up with), and `firstRenderablePrompt` picks the one the button uses. `engine/render-visual.mjs` (forked from marketing-studio's ComfyUI client, which is untouched) probes 127.0.0.1:8188 only (Docker commonly owns :8000), POSTs the pinned flux-schnell graph in `engine/workflows/linkedin-hero-flux.json` (4 steps, cfg 1.0, euler/simple, 1088x1360 because the latent is height/8), polls `/history`, downscales to exactly 1080x1350 with sharp, writes `<draftsDir>/.visuals/<draftId>-o<N>.png` tmp-then-rename, and POSTs `/free` so the checkpoint stops holding ~20-24 GB of unified memory. The prompt and seed are assigned into the parsed graph, never string-substituted into JSON text, so a prompt containing a quote or a backslash cannot produce an unparseable graph, and the seed reaches ComfyUI as the number its INT schema wants. `engine/comfy-headless.sh` starts the server detached and polls it ready (max 3 min), never calling `open`, so nothing needs a desktop session. `POST /api/render` mirrors `/api/edit` but takes its own `.rendering` lock, never `.generating`, so a render can neither block nor be blocked by a generation, and it pipes the renderer's stderr into `.last_render.json` so a failure reads as its actual cause instead of a shrug. `/api/asset` gained a `which=visual` branch whose path is BUILT from a validated draft id and a clamped integer. The card shows the PNG with a download link when it exists and a "Render image" button when it does not, polling the same way the AI edit does. `generate.sh` renders the top pick after the notification fires (not before it), taking the same lock, resolving `node` under a minimal launchd PATH, and always returning 0: exit 2 from the renderer means "ComfyUI is not running", which is not a failed run. Measured on an M5 Pro: 77 s for a cold render, 71 s warm, and the machine swaps hard while the model is resident, which is why only one image renders at a time. Known and accepted: the graph ends in `SaveImage`, so ComfyUI also keeps its own copy of every render in its `output/` folder, outside the repo and unpruned. 8 new tests (119 total).

**Files changed:** engine/render-visual.mjs, engine/comfy-headless.sh, engine/workflows/linkedin-hero-flux.json, engine/generate.sh, app/lib/draftParser.ts, app/lib/drafts.ts, app/app/api/render/route.ts, app/app/api/asset/route.ts, app/app/draft/[date]/page.tsx, app/components/DraftCarousel.tsx, app/components/OptionCard.tsx, app/test/visuals.test.ts, app/test/draftParser.test.ts, scripts/doctor.sh, README.md

---

## feat: buyer pillar + landing URL, import hardening, weekly cadence, run-state writes (2026-09-06)

**Problem:** Every draft was aimed at other developers by construction: the pillar taxonomy had no buyer-facing pillar, the only link ever offered was the portfolio, and nothing in the rubric asked whether a non-technical reader would recognise themselves in line 1. The voice corpus could be polluted silently: a LinkedIn full export's `messages.csv` (DMs) got in through the zip's "any .csv" fallback plus the `content` column fallback, and `addRecentPosts` accepted a 3-character block. The import wrote before showing anything. The cadence double-counted a pick logged twice (the same `(date, option)` re-logged nine days later moved "last posted" to a day nothing was posted). A scheduled run left no machine-readable trace: `.last_generate.json` was written only by the app's button, so it went 10 weeks stale while the scheduler ran daily; six failed runs signalled with a sound and nothing else; and a daily schedule with a 46h guard produced batches nobody read.

**Solution:** SKILL.md gains a **WHO THIS IS FOR** block fed by two new config keys, `brand.audience` and `brand.landingUrl` (loaded by `config.sh`, printed in the harvest's BRAND block, documented with neutral placeholders); a 5th pillar **client-outcome** (a named industry, the manual process, the before/after in hours or money, no tool name in the hook, CTA to the landing URL) that draws on the bio, the offers and the audience rather than commits, so it never starves, and carries a strict truthfulness rule (figures only from the harvest or an explicitly hypothetical frame, never an implied real client result); a hard cap of 2 of 5 on `smart-ai-workflow` + `build-in-public`; a 6th rubric dimension, **Owner recognition**, with reject-and-rewrite under 5; and a link ladder (client-outcome uses the landing URL, everything else the site URL). The app knows the new pillar (badge, steering category). Import hardening: no first-.csv fallback (the error lists the CSVs seen), `messages.csv` refused by name, `content`/`message` dropped from the column fallbacks, and `looksLikePost` (>= 150 chars, no HTML tag, no `%TOKEN%`) gates every corpus write as a second line of defence; the import route has a preview mode (detected column, counts, the two most recent posts, nothing written) and both the onboarding wizard and the Settings uploader show it and only write on "Yes, import these"; manual paste and import report `skipped`. `cadenceFromPicks` dedupes on `(date, option)` keeping the earliest timestamp. `generate.sh` writes `.last_generate.json` on success and failure in the app's shape, appends failures (with the run log tail) to `.failures.log`, logs its notification text, and when the newest pick is older than 5 days the notification reads "you have not posted in N days, M drafts waiting" (jq date math, fractional seconds stripped). The schedule examples document a weekly `Weekday` and the guard interaction (every successful run resets it, app button included, so a weekly schedule wants a lower `minGapHours`). Note: scheduled runs were already personal-only (launchd never sets the company-mode env); the personal-first switch only changes app-button runs. 11 new tests (105 total).

**Files changed:** engine/SKILL.md, engine/harvest.sh, engine/lib/config.sh, engine/generate.sh, engine/schedule/com.example.shippost.plist.example, engine/schedule/crontab.example, config.example.json, app/lib/sharesCsv.ts, app/lib/voice.ts, app/lib/theme.ts, app/app/api/import/route.ts, app/app/api/recent-posts/route.ts, app/components/wizard/OnboardingWizard.tsx, app/components/SettingsPanel.tsx, app/test/sharesCsv.test.ts, app/test/voice.test.ts, app/test/picks.test.ts, app/test/engine.test.ts, README.md, docs/linkedin-export.md

---

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
