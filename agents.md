# Job Hunt Dashboard Web App

Personal job-hunting dashboard. Monorepo of three npm workspaces
(`shared`, `server`, `client`): **React (Vite) + Express + TypeScript +
Tailwind + PostgreSQL (Neon) via Drizzle ORM**.

## Stack

- **DB** — PostgreSQL on Neon + Drizzle ORM. Apply schema changes with
  `npm run db:push`. Never hand-edit `db/migrations` (the original
  convention on this file, preserved).
- **Backend** — Express + TypeScript in `server/`. Routes live in
  `server/src/api/`; all DB access goes through `server/src/db/queries/`.
- **Frontend** — Vite + React + TypeScript + Tailwind in `client/`.
  Functional components only.
- **Deploy** — Vercel (static client at `/`, Express mounted at `/api`).
  Scheduled scans run via **GitHub Actions**, not Vercel cron (Hobby tier
  caps Node serverless at ~60s).

## Commands

```bash
npm install              # all three workspaces
npm run dev              # server (:3001) + client (:5173) together
npm run typecheck        # typecheck shared / server / client
npm test -w server       # vitest suite (~214 tests)
npm run build            # emit server/dist + client/dist
npm run scan             # one-off job scan, writes to Neon
npm run prune:locations  # delete DB rows failing today's location filter
npm run db:push          # apply Drizzle schema changes to Neon
npm run db:studio        # open Drizzle Studio
npm run mcp -w server    # run the local MCP adapter over stdio
```

> The workspace `typecheck` script does **not** cover the Vercel serverless
> entries in `api/`. Reproduce Vercel's typecheck with
> `npx tsc -p tsconfig.json --noEmit` from the repo root — run it before
> pushing if you touched anything under `api/`.

## Conventions

- Functional components only. No class components.
- API routes live in `server/src/api/`. All DB access goes through
  `server/src/db/queries/`.
- Use **date-fns**, never Moment.js.
- The location filter has a single source of truth:
  `passesLocationFilter()` in `server/src/scrapers/types.ts`.

## Avoid

- No class components.
- Don't modify `db/migrations` directly — use `npm run db:generate` / `db:push`.
- Don't use Moment.js.
- Don't write a "deploy to Vercel" GitHub Action — Vercel owns deploys.
  GitHub Actions in this repo are for scheduled scans + (future)
  code-quality CI only.
- Don't re-enable the Microsoft / Starbucks / Google Playwright adapters
  without re-deriving their live DOM selectors (re-activation steps are in
  the file headers and `/memories/repo/jobhunt-dashboard.md`).

## Keep in mind

- Keep code clean, modular, readable, and maintainable.
- UI should look modern, clean, and use color effectively to differentiate
  states (status badges, work-mode badges, watchlist chips).
- You're free to suggest improvements anywhere you see fit.

## Handoff

Read `HANDOFF.md` for the current project state before touching anything.
Deeper verified facts (build-of-record gotchas, ATS slugs, scraper quirks)
live in `/memories/repo/jobhunt-dashboard.md`.
