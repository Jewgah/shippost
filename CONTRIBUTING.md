# Contributing

Thanks for looking! shippost is small on purpose — a bash engine (`engine/`) that drives
`claude -p`, and a local Next.js app (`app/`).

## Setup

Follow the README's Install section. You'll need Node 18+, jq, git, and Claude Code
(only for actually generating drafts — the app + tests run without it).

## Before you open a PR

```bash
cd app
npm run typecheck
npm test
npm run build
shellcheck ../engine/*.sh ../engine/lib/*.sh ../scripts/*.sh   # if you touched shell
```

CI runs exactly these, so a green local run means a green PR.

## Ground rules

- **Never commit private files** — `config.json`, `postable-projects.txt`,
  `recent-posts.md`, drafts. `scripts/doctor.sh` verifies they're untracked.
- Keep it dependency-light. Prefer stdlib / what's already installed.
- New logic gets a test in `app/test/` (vitest). Bug fixes get a regression test.
- One focused change per PR beats a grab-bag.
