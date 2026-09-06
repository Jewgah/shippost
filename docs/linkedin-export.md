# Getting your LinkedIn posts (for the voice corpus)

shippost writes in **your** voice by reading posts you've already published. LinkedIn
blocks automated reading of your profile (you'll hit an `HTTP 999` wall, and their
Terms prohibit scraping), so the clean, allowed way to hand it your posts is
LinkedIn's own **data export**.

## Steps

1. On LinkedIn, click your photo → **Settings & Privacy**.
2. Open **Data Privacy** → **Get a copy of your data**.
3. Choose **"Posts"** (sometimes listed under the *"Want something in particular?"*
   options as **Shares**), then **Request archive**.
4. The posts subset is usually ready in a **few minutes**; the *full* archive can take
   up to **24 hours**. LinkedIn emails you a download link.
5. Download the ZIP. Inside is **`Shares.csv`** — the `ShareCommentary` column holds
   each post's text.

## Importing into shippost

Open the app (`npm run dev` → http://localhost:3030). On first launch the onboarding
wizard asks for this file — drag the **`.zip`** (or the extracted **`Shares.csv`**)
onto the drop zone. shippost:

- auto-detects the commentary column (names vary by export version/locale),
- drops empty rows (reshares with no comment) and link-only posts,
- keeps your most recent ~30 posts,
- shows you the detected column and your two most recent posts first, and writes them to
  `recent-posts.md` in your drafts folder only after you confirm they are yours.

Only `Shares.csv` is accepted. The full archive also contains `messages.csv` (your DMs):
that file is refused by name and by shape, because a corpus of cold DMs makes the drafts
sound like a mail merge. Blocks shorter than 150 characters, HTML, or mail-merge tokens
(`%FIRSTNAME%`) are skipped on every import path, and the app tells you how many.

You can re-import anytime from the wizard (visit `/onboarding`). And every post you
mark **"I posted this"** in the app is appended to the corpus automatically, so your
voice profile keeps improving without any manual export.

## No export? Paste instead

The wizard has a **manual paste** tab — drop in 3–5 posts you've written (separate
them with a line containing just `---`). That's enough to seed the voice.
