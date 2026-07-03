---
name: shippost
description: Generate 5 ranked, distinct LinkedIn drafts (each with a company-page post + personal repost caption) from recent dev work and your AI workflow. Multi-pass smart engine — brainstorm, draft, humanize, self-critique, rank. Scrubs all client identities. Use for an every-2-days posting habit.
argument-hint: "[pillar hint, e.g. smart-ai-workflow — optional; otherwise spreads across pillars]"
---

# shippost — LinkedIn post engine (5 ranked options)

Produce **5 distinct, ranked options** for the author's **company page** (their own brand) — they pick one and publish in ~2 minutes. Each option is self-contained: a ready company post **+** a personal-repost caption **+** a first-comment link **+** a one-line "why it works" **+** a suggested visual. Output language is whatever the wrapper passes (default English). Saved as a dated markdown file in the configured drafts dir. Nothing is published — the author reviews and posts manually.

This is a **multi-pass single-agent** process — all reasoning, no subagents/new tools.

## Step 1 — Harvest

```bash
bash <engine>/harvest.sh
```
(The wrapper runs the engine's own `harvest.sh`; when run by hand, use the path printed by the installer.)

Read all of it:
- **WHO YOU ARE** — the author's real profile/bio. **Ground every post in this**; you may draw on it for credibility, and never contradict it.
- **BRAND** — the company page these posts go on, its tagline/offers/vibe (the author's own brand — safe to name).
- **SCRUB** — names/terms you must redact (day job, clients, customers).
- recent commits (subjects + bodies + files) in the allowlisted repos,
- the inventory of the author's custom Claude Code skills,
- the last few drafts (avoid repeating those topics),
- **REJECTED ANGLES** (if present): topics the author thumbed down in the app — never offer these or close variants,
- **YOUR RECENT LINKEDIN POSTS** (if present): match that voice and do **not** repeat those themes,
- an optional voice sample.

Note: the AI cannot see the author's live LinkedIn profile or published posts (login wall / HTTP 999). This profile context + the imported recent posts are how it "sees" them — keep them current for best results.

## Step 2 — Ideate WIDE (think before writing)

Brainstorm **~10 candidate angles** across all four pillars:

1. **build-in-public** — a real feature/fix shipped in an allowlisted repo (use the commit bodies/files for specifics). Story = problem → what you built → why it matters.
2. **smart-ai-workflow** — how the author actually uses AI: a **custom skill they built** (from the inventory), multi-agent review, headless automation. **This is the differentiator — lean in.**
3. **cool-repo / tool** — an OSS AI repo/tool genuinely worth sharing. **Never claim to have tried something you didn't.**
4. **lesson / takeaway** — one concrete insight tied to the real work above.

## Step 3 — Select 5 DISTINCT

Pick the 5 strongest, with **different topics** and **≥3 pillars** of spread. Don't repeat topics shown in "RECENT DRAFTS", and never offer an angle listed under "REJECTED ANGLES" (the author already thumbed it down). **Quality beats spread** — 5 strong posts across 3 pillars beat 5 forced across 4. Never invent a "cool-repo" you didn't try just to fill a slot.

## Step 4 — SCRUB (every option, even your own repos)

Remove or generalize:
- **Any client/company you build *for*** — never name the day-job clients/customers listed in the SCRUB section. **The author's own brand is the page you post to, so naming it is encouraged; never treat it as a client.**
- **People's names** (except the author / the brand), emails, phone numbers.
- **Secrets**: keys, tokens, passwords, connection strings, DB names, internal/staging URLs, IPs.
- When unsure, generalize ("a client", "a project I'm building", "an app"). The post is about the author's **craft**, not who they work for. If a story can't be told without exposing a client, drop it for another angle.

## Step 5 — Draft each of the 5

For every option write:
1. **Company post** — ready to paste on the brand page.
2. **Personal repost caption** — 1–2 first-person lines the author adds when resharing to their own feed (their POV / the "why").
3. **First comment** — the link to drop in the post's **first comment**, never the body (LinkedIn suppresses reach on posts with outbound links; a comment link doesn't). Pick by this ladder:
   - The harvest's BRAND section lists a **Site URL** and the post shows real build/work → use that exact URL (frame it "more of what I build"). **Never invent or extend a URL** (no guessed slugs/paths) — a 404 is worse than no link.
   - No Site URL configured, or a pure opinion/process post with nothing concrete to show → **omit section C entirely** (no header, no placeholder text) and end the post body with a soft one-line CTA instead ("happy to go deeper, DM me"). Don't bolt a link onto an unrelated post — it reads as spam and converts nothing.
   These links are `nofollow` (referral clicks, not SEO juice) — the point is sending warm viewers to the work. When there IS a link, end sections A/B with a plain `link in comments` line.
4. **Why it works** — one line (for the author, not published).
5. **Suggested visuals — 3 ideas** (for the author): three *different* images that could accompany the post, **best first**. Posts with an image get more reach.
   - **Idea 1 — the scroll-stopper (the star slot).** Think like an art director, not a stock library: turn the post's core concept into ONE bold, unexpected piece of art. The go-to move is an **iconic character/archetype recast in the post's role** — a splashy cartoon-mouse conductor for an orchestrator, a chess grandmaster moving robot pieces for a planner, a heist crew mid-job for parallel agents, a lighthouse keeper for monitoring. Push the style: paint-splash digital art, dramatic oil-painting energy, surreal scale, neon-noir — whatever fits the concept. Append the ready prompt as `AI prompt: "…"`; for THIS slot vivid art language is encouraged (dynamic paint splashes, expressive brushwork, dramatic lighting, bold color). It should look like striking art someone chose on purpose, not a corporate stock image.
   - **Idea 2 — the real thing**: a screenshot / before-after / terminal recording of the actual feature, marked `(screenshot — no AI)`. Authenticity wins when the work itself is visual.
   - **Idea 3 — a different lane from #1**: a candid photographic metaphor — real-photography language (candid, available/natural light, shot on 35mm, subtle grain, slightly imperfect framing), no AI-art tells in this one — OR a second creative direction in a *different art style* than idea 1.
   - **Never suggest the brand logo as a visual.** The author already has it; it is the boring default these ideas exist to beat. Only mention it if the post literally announces the brand itself.
   - **Vary across the batch**: the 5 options' star slots must not share one style (not five paint-splash pieces) — rotate styles, eras, and metaphor types.

**Voice rules (strict):**
- First-person builder energy. Punchy, real, celebrates shipping/learning. **Sounds human, NOT AI.**
- **Brand:** you may name the brand and frame posts around it, but keep the author's authentic human voice — never borrow marketing adjectives.
- **Banned:** leverage, synergy, game-changer, revolutionary, cutting-edge, paradigm, unlock, delve, "in today's fast-paced world", "I'm thrilled/excited to announce", "🚀 to the moon".
- **Punctuation (post body, sections A & B):** NO em-dashes (—), NO en-dashes (–), NO arrows (→ ← ⇒). They instantly read as "a robot wrote this." Use a comma, a period, parentheses, or a plain hyphen; write the word ("to", "then", "becomes") instead of an arrow. (This is for the A/B post text only — the per-option **header line** still uses " — " as the file's separator, so keep that.)
- Specific, scrubbed details (numbers, the real problem, feature names). Specificity = credibility.

**LinkedIn format (per company post):**
- Strong **one-line hook** (it's all that shows before "see more" — earn the click).
- 2–5 short lines / tight mini-story; blank line between thoughts.
- One clear **takeaway** + a soft CTA or genuine question.
- 0–2 emojis (end of line, not start). Max 3 focused hashtags. ~80–180 words.
- **Hard limit: section A ≤ 3000 characters** (LinkedIn's cap) — keep section B ≤ 3000 too. Target 80–180 words (~600–1300 chars); if a draft runs long, tighten it. **Never exceed 3000 characters.**

## Step 6 — Self-critique, score & rank

Score each option 1–10 on: **Hook** (does line 1 stop the scroll?), **Specificity**, **Voice** (human, zero banned words), **Value** (reader learns/feels something), **CTA**. **Revise weak hooks** before finalizing. Then **rank 1→5** (descending) and mark **#1 with ⭐** as the recommended pick.

## Step 6.5 — HUMANIZE (de-AI pass, before writing)

Real people don't write like polished marketing copy. Pass every draft through this filter:
- **Vary the rhythm.** AI defaults to same-length sentences. Mix a long line with a 3-word punch. Allow **one deliberate sentence fragment**.
- **Kill the bow.** Don't end every post with a neat summarizing wrap-up. Stop on the sharp line, or an honest question — not a moral.
- **Cut the tells:** the rhetorical-question-then-answer ("The result? …"), the perfect tricolon ("faster, cleaner, simpler", drop one), the "it's not X, it's Y" overuse, and every em-dash, en-dash, and arrow in the post body (use commas, periods, parentheses, or a plain hyphen).
- **Rough up over-polished hooks** so they sound said, not written.
- **Section B (personal caption) goes harder** — more first-person, more raw, a little messy is fine; it's the author talking. **Section A (company post) stays lighter** — human, but still credible and brand-safe.
- Keep specifics and the banned-word ban. Re-check the hook after editing; keep whichever version is stronger.

## Step 7 — Write the file

Write to the exact path the wrapper passed (or `<draftsDir>/YYYY-MM-DD.md`). **The first line must be the header below.** Each option's header line must read `## [⭐ ]Option N — {pillar} — {2-4 word topic}   ({score}/10)` so the harvester (and the app) can read topics next time.

```
# LinkedIn drafts — 2026-05-31 · 5 options, ranked · pick ONE

> Post section A to your company page, then Repost-with-thoughts to your
> profile using section B, then drop section C as the first comment.
> ⭐ = my top pick this run.

## ⭐ Option 1 — smart-ai-workflow — multi-agent review   (9.2/10)
**A. Company post**
<ready-to-paste post>

**B. Repost caption (your profile)**
<short first-person caption>

**C. First comment**
<the BRAND section's Site URL, to paste as the first comment — include this section ONLY when there is a real link; otherwise omit it entirely>

_Why it works:_ <one line>
_Suggested visuals:_
1. <scroll-stopper concept art — e.g. a splashy cartoon-mouse conductor leading an orchestra of robot musicians> — AI prompt: "<vivid art prompt — dynamic paint splashes, expressive brushwork, dramatic lighting, bold color>"
2. <the real thing — e.g. a before/after screenshot of the feature> (screenshot — no AI)
3. <different lane — candid photo metaphor or a second, different art style> — AI prompt: "<…>"

---
## Option 2 — build-in-public — currency formatter   (8.6/10)
**A. Company post**
...
**B. Repost caption (your profile)**
...
**C. First comment**
...
_Why it works:_ ...
_Suggested visuals:_
1. ...
2. ...
3. ...

---
(Options 3, 4, 5 — same shape, descending score)

---
pillars used: smart-ai-workflow, build-in-public, lesson, cool-repo, build-in-public
sources (scrubbed): <one short source per option>
scrubbed: yes (no clients, no secrets)
```

## Step 8 — Finish

- **Interactive run (`/shippost`):** tell the author where it saved, that ⭐ is the top pick, and the 3-step publish (post A to the company page → Repost-with-thoughts B to personal → drop C as the first comment). Offer tweaks ("more technical", "shorter", "funnier", "regenerate option 3").
- **Headless run (scheduler):** just write the file and exit. No questions.

## No-material fallback

If the window is thin, still produce 5 — backfill with **smart-ai-workflow** angles from the skills inventory (always available) and **lesson** angles, rather than forcing weak build-in-public posts. Keep the header line and the per-option header format.

$ARGUMENTS
