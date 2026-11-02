---
name: shippost-x
description: X (twitter) variant of the shippost engine. 5 ranked, distinct X posts (each at most 280 characters, with an optional thread) from recent dev work. Follows SKILL.md with the overrides below.
---

# shippost for X: 5 ranked options, one post each

Follow `SKILL.md` (same folder) for Steps 1 to 4, Step 6 and Step 6.5, and for the header line, the `⭐` on the top pick and the footer. **Only the overrides below change.** Nothing is published: the author copies a post, or opens X's compose window, by hand.

## Override: Step 1, harvest on the X channel

Run the harvest with the channel set, exactly like this:

```bash
SHIPPOST_CHANNEL=x bash <engine>/harvest.sh
```

It then prints the author's X posts first (the voice to match) and the LinkedIn posts after them. Treat the LinkedIn posts as a voice seed only: match the voice, never the length. Do not repeat a topic from RECENT DRAFTS or REJECTED ANGLES.

## Override: Step 5, the X format

Each option is one post in **section A**, plus optional sections B and C:

- `**A. Company post**`: the post itself. **At most 280 characters counted the X way**: every link counts 23 whatever its length, an emoji or a CJK character counts 2, everything else counts 1, a newline counts 1. Count before you write it down and cut until it fits.
- `**B. Thread**` (optional, 2 to 5 posts): posts 2 and up, each at most 280 characters, each starting on its own line with its number and a slash: `2/ ...`, `3/ ...`. Never use `---` between thread posts (that line closes the option). Omit B when the idea fits in one post; a thread only earns its place when each post adds something.
- `**C. First comment**` (optional): the link, when the option has one. **Never put a link in post A**: X buries posts with outbound links, a link in the first reply does not. Follow the same link ladder as SKILL.md Step 5 (Landing URL, Site URL, or omit C entirely). When C exists, end post A with nothing about the link.
- `_Why it works:_` one line, as in SKILL.md.
- Drop `_Suggested visuals:_`: no image is rendered for X.

There is no company-page post and no repost caption: one author, one account. Ignore any "Mode" instruction about a company page.

## Override: X voice

- A builder talking, not a brand announcing. One idea per post, the hook IS the post (no "see more" fold on X).
- No hashtag spam: at most one hashtag, and none is the default. No "🧵" or "Thread:" openers.
- Same banned words, same punctuation rules as SKILL.md (no em dashes, en dashes or arrows in the post text).
- Sound said, not written: short lines, one fragment is fine, stop on the sharp line.

## Override: Step 7, the file

Write to the exact path the wrapper passed (inside the `x/` folder of the drafts dir). Same file shape as SKILL.md Step 7 (the same first-line title and the same option header line), with the title reading "X drafts" instead of "LinkedIn drafts" and the instruction line saying: copy section A, or open it in X from the app; post the thread and the first comment as replies.

Before finishing, re-count every section A and every thread post. Any one over 280 is rewritten, not trimmed mid-word.
