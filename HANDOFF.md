# HANDOFF — Job Hunt Dashboard

> Final read for the next agent (human or otherwise) picking this up.
> Last verified working: **2026-08-05**. Read this _before_ touching anything.

---

## 0. TL;DR

- ✅ **Personal job-hunting dashboard** that scrapes **multiple direct company sources** (Greenhouse / Ashby / Lever / Workday / 1 Playwright) + three aggregator APIs for React/Node/TypeScript roles in Seattle-or-Remote.
- ✅ **Live, working end-to-end**: scraping → Postgres (Neon) → Express API → React/Tailwind dashboard → click-to-apply.
- ✅ **Auto-runs** via Vercel cron at 08:00 & 20:00 PT. Last working scan covered 416 jobs across 5+ active source types.
- ⏳ **Four small non-blocking gaps** — listed below in priority order, each with a concrete fix plan.

If you only do one thing first: **read `/memories/repo/jobhunt-dashboard.md`** — every gotcha, every verified slug, every workaround is there. Re-reading it before any scraper/DB work is mandatory.

---

## 1. Project shape

```
jobhunt-dashboard/
├── api/                    Vercel serverless entries (/api mounts Express; /api/cron is the scheduled scan)
├── client/                 Vite + React + TS + Tailwind (functional components only)
│   └── src/{api,components,hooks}
├── server/                 Express + Drizzle + scrapers
│   ├── src/
│   │   ├── api/            Routes only (per agents.md convention)
│   │   ├── db/             Schema + queries (per agents.md: all DB access here)
│   │   └── scrapers/       types.ts has shared helpers incl. passesLocationFilter
│   │       └── playwright/ Headless browser framework (1 verified, 3 stubs)
│   └── scripts/
│       ├── run-scan.ts         npm run scan
│       ├── prune-locations.ts  npm run prune:locations
│       └── inspect-db.ts       npm run inspect (unofficial — add to package.json if missing)
├── shared/                 Cross-package TS types (no compiled output; included via include path)
└── vercel.json             Routes /api/*, schedules cron at "0 15,3 * * *"
```

**Stack**: PG/Neon + Drizzle ORM · Vite + React + TS + Tailwind · Express TS · Vercel deploy + cron. **Single-user** (no auth; `SCAN_SECRET` gates write paths).

---

## 2. What state the code is in right now

- Typecheck clean across all three packages (`shared`, `server`, `client`).
- Last production build (`npm run build`) succeeds.
- DB has **416 jobs** across 5+ source types after the location filter prune.
- **Hide-jobs feature shipped end-to-end**: schema column (`hidden_at`), `hide / unhide` endpoints (`server/src/api/jobs.ts`), `visibility` filter on `listJobs()`, hidden rows excluded from stats. UI gate is the FilterBar `VisibilityToggle`.
- Settings modal edits keywords + locations at runtime; changes take effect on the next `npm run scan`.
- Location filter has a one-shot prune script — run it any time settings or the filter rule change.

---

## 3. Outstanding work, prioritized

Each item spells out **exactly what to change** so the next agent doesn't have to re-derive it.

### 🟡 P1 — Greenhouse scraper silently aborts on heavy boards

**Status: still open, verified 2026-08-05.** `server/src/scrapers/greenhouse.ts` calls `fetchJson(url)` with no `timeoutMs`, so it inherits the default 10s in `server/src/scrapers/types.ts`. Big Greenhouse boards (Datadog ~300, Stripe ~500) intermittently exceed that and emit `greenhouse: fetched 0, errors: This operation was aborted`. **Ashby is already bumped to 20s and Lever to 25s — Greenhouse is the last hold-out with the default.**

**Fix (one line):**

1. Edit `server/src/scrapers/greenhouse.ts`.
2. Change the `fetchJson<GreenhouseBoard>(url)` call to accept an options object: `fetchJson<GreenhouseBoard>(url, { timeoutMs: 25_000 })` — match the existing pattern in `lever.ts:44`.
3. Run `npm run scan` and watch the Greenhouse log lines to confirm `fetched 0` is gone.

No schema change, no migration. The same treatment could be applied to `workday.ts` later if it starts showing the symptom, but it hasn't so far.

### 🔵 P2 — No tests; one function worth covering

Repo has zero tests — no `__tests__/`, no `vitest.config.*`, no `*.test.ts` anywhere. The only function with a thorough enough spec to warrant coverage is `passesLocationFilter()` in `server/src/scrapers/types.ts` (DC trap, Remote wildcard, Seattle-alias regex, null-location rule). The 16-case spec lives as comments in `/memories/repo/jobhunt-dashboard.md` ("Location filter" section).

**How to add:**

1. `npm i -D vitest -w server` (root workspace).
2. Add `"test": "vitest run"` to `server/package.json` scripts.
3. Create `server/src/scrapers/__tests__/filter.test.ts` with the 16 documented cases.
4. Wire it into the P3 CI workflow below.

No `vitest.config.ts` needed at minimum — Vitest auto-discovers `__tests__/**`.

### 🟢 P3 — No CI

`/memories/cicd-ideas-nextjs-firebase-vercel.md` has the user's preferred CI shape for a different stack. The lowest-effort pin for _this_ repo is a `.github/workflows/ci.yml` that gives fast PR feedback (~30s) before Vercel builds main. **Don't add a deploy step — Vercel owns deploys + preview URLs.**

**Create `.github/workflows/ci.yml`:**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'npm' }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run build
      # if you added vitest in P2:
      # - run: npm test
```

### 🟢 P3 — Settings admin UI uses three plain text inputs

`client/src/components/SettingsModal.tsx` still uses `splitList()` on three comma-separated `<input>` fields for `targetCompanies / keywords / locations`. The lowest-friction UX win is **location chips** because `locations` has a small, fixed vocabulary (Seattle, Portland, Bay Area, Remote).

**How to do it:**

1. Keep the existing comma-encoded API contract — the server stores locations as a `text[]` array, no schema change.
2. Add a local `LOCATIONS = ['Seattle', 'Portland', 'Bay Area', 'Remote']` constant in `SettingsModal.tsx`.
3. Render those as clickable pill toggles that add/remove entries from `draft.locations`, mirroring the `VisibilityToggle` pattern from `FilterBar.tsx`.
4. Leave `targetCompanies` and `keywords` as plain inputs (open-ended lists, chips don't fit).

Gotcha: `noUncheckedIndexedAccess` is on in the base tsconfig — array-index lookups need `!` or guards. Already documented in repo memory under "Hide jobs feature".

### ⛔ Explicitly NOT to do

- **Do not re-enable the Microsoft / Starbucks / Google Playwright adapters without first reverse-engineering the live DOM.** They're kept with `⚠️ STATUS: ADAPTER NOT REGISTERED` banners; their selectors were never verified. Reactivation steps are spelled out in the file headers and the repo memory. (Google's DOM was deliberately obfuscated, so probably not worth the recurring maintenance.) These three companies still get **badge-matched** against Adzuna / Active Jobs DB / Remotive by `matchNames`, so coverage isn't zero.
- **Do not write a "deploy to Vercel" Action** — Vercel already handles builds, deploys, and preview URLs. GitHub Actions here should be code-quality only.
- **Do not hand-edit `db/migrations/`** — per `agents.md`. Schema changes go through `npm run db:push` / `npm run db:generate`.

### ℹ️ Parked (no action, monitor only)

- **JSearch REMOVED 2026-08-07** in favor of Active Jobs DB (Fantastic.Jobs). JSearch's real-time upstream scraper (Google for Jobs / LinkedIn) was periodically returning `{"data":{"jobs":[],"cursor":null}}` for every query — empty-data flakiness baked into its architecture. Active Jobs DB is an hourly-refreshed DATABASE instead of a live scrape, ~10× faster and 100% listed uptime. Swap history documented in `/memories/repo/jobhunt-dashboard.md` ("JSearch empty-results flakiness").
- **Dead Playwright adapters for Microsoft/Starbucks/Google**: documented as badge-only with re-activation steps in `server/src/scrapers/targets.ts`. No coverage loss because they badge-match against Adzuna / Active Jobs DB / Remotive.

---

## 4. How the pieces talk to each other

```
[Browser]
  │
  ▼
Vite proxy /api/* (client/vite.config.ts proxy → :3001)
  │
  ▼
Express app (server/src/app.ts)
  │
  ├── GET /api/jobs             → listJobs()     page 100 + new-since-visit badge + visibility filter
  ├── GET /api/jobs/stats       → getStats()     hidden rows excluded from every count
  ├── POST /api/jobs/acknowledge → acknowledgeAll()  (clears "New" badge)
  ├── POST   /api/jobs/:id/hide → hideJob()     (204)
  ├── DELETE /api/jobs/:id/hide → unhideJob()   (204)
  ├── POST /api/jobs/:id/tracker → upsertTracker()  (per-job status)
  ├── GET  /api/settings        → keywords/locations editing
  ├── PUT /api/settings         → update those
  ├── POST /api/scan            → runScan()   (gated by SCAN_SECRET)
  │
  └── runScan() orchestrator:
        Parallel (api):    Remotive + Adzuna + Active Jobs DB + HackerNews + The Muse + USAJOBS + Greenhouse + Ashby + Lever + Workday
        Serial   (browser): Playwright adapters (one shared Chromium)
        ──────────────────
        For each RawJob returned:
          1. passesLocationFilter(job, locations) ← single source of truth
          2. upsertJobs()  → batched insert (INSERT .. ON CONFLICT DO UPDATE)
```

### ⚠️ 504 on /api/cron — FIXED 2026-08-07

The GitHub Actions "Trigger /api/cron" step was failing with `curl: (22) ... 504` after ~2m. That's Vercel's Gateway Timeout: `api/cron.ts` runs `runScan()` synchronously with `maxDuration: 120`, and the scan blew past it.

Two compounding causes, both fixed:

1. **Chatty DB writes.** The old `upsertJob()` did a `SELECT` + `UPDATE`/`INSERT` per job → ~2 sequential Neon HTTP round-trips × ~400 jobs ≈ 800+ round-trips. Replaced with a batched `upsertJobs()` (`server/src/db/queries/jobs.ts`) that per 100-row chunk does 1 existence probe + 1 insert + 1 `INSERT .. ON CONFLICT DO UPDATE`. `upsertJob()` is kept as a 1-row wrapper for backward compat.
2. **Sequential aggregators.** Remotive/Adzuna/Active Jobs DB/HN/Muse/USAJOBS now run via `Promise.all` in `orchestrator.ts` (safe — each scraper catches its own errors). Workday's inner fetch also got a 15s AbortController timeout so a hung tenant can't stall the scan.

Verified: full `npm run scan` completes in **~48s** locally (incl. local Playwright browser runs that Vercel skips). `api/cron.ts` now also returns a JSON 500 with the error message instead of a bare 504, so a future failure is diagnosable from the Actions log.

---

## 5. Things that look wrong but aren't

- **`server/scripts/run-scan.ts` paths .env three levels up** (`../../../`), but `server/src/config.ts` paths only two levels up (`../../`). Both correct — depends on folder depth.
- **`drizzle-kit` only works because both `drizzle-orm` and `drizzle-kit` are root devDependencies.** If only one is installed, it will fail cryptically trying to find peer packages.
- **Server tsconfig has `"DOM"` lib.** Required only because `page.evaluate()` callbacks reference `document/HTMLElement` despite running in browser context. Don't try to remove it.
- **Vault-mapped `Remote` is in the locations list** but Adzuna silently strips it before passing as `where=` (geographic-only). The orchestrator filter does the actual remote matching. Two-step is intentional.
- **The 19 "San Francisco"-located Ashby rows** in the DB are not bugs — they're roles where Ashby's `workplaceType=Remote` and the `San Francisco` field is just the office of record. The filter correctly keeps them under the "Remote" rule.
- **Vite + monorepo `envDir`**: Vite only loads `.env` from its own root, but this repo's single `.env` lives at the monorepo root. Fixed by `envDir: monorepoRoot` in `client/vite.config.ts`. Vercel injects env from its dashboard at build time, so this fix doesn't apply there — `VITE_SCAN_SECRET` must be a Project Environment Variable (Production + Preview) and requires a rebuild to take effect.

---

## 6. Adding a company — the recipe

Documented at the top of `server/src/scrapers/targets.ts`. Quick version:

1. Find the company's ATS slug by opening its careers page:
   - `boards.greenhouse.io/<slug>` → use `greenhouse` template
   - `jobs.ashbyhq.com/<slug>` → use `ashby` template
   - `jobs.lever.co/<slug>` → use `lever` template
   - Workday tenant (`<co>.wdN.myworkdayjobs.com`) → use `workday` template (probe `/wday/cxs/<tenant>/<site>/jobs`)
   - Custom in-house portal → use `playwright` template (requires the adapter slug exists and is verified)
2. Add an entry to `TARGET_COMPANIES` in `targets.ts` using one of the TEMPLATE_* blocks at the bottom of the file.
3. `npm run scan` — no build, no migration.

**Verify the slug is right first** with a curl probe — most false starts are stale/sideways slugs. The repo memory has an "ATS identification cheat-sheet" with the exact probe endpoint per ATS type (Greenhouse / Ashby / Lever / Workday / iCIMS / SPA signatures).

---

## 7. Common commands

```bash
npm install                       # everything
npm run dev                       # both server (:3001) and client (:5173)
npm run dev:server                # just Express
npm run dev:client                # just Vite
npm run typecheck                 # all three workspaces
npm run build                     # emit server/dist + client/dist
npm run scan                      # one-off scan
npm run prune:locations           # delete DB rows that fail today's location filter
npm run db:push                   # apply schema changes to Neon
npm run db:studio                 # Drizzle Studio UI
```

Client port is **5173** in fresh runs, may land on **5174** if 5173 is held by a previous Vite.

---

## 8. Required env vars

`.env` at the repo root. Minimum-viable:

```
DATABASE_URL=postgresql://…from neon.tech
SCAN_SECRET=<random hex>           # same value in VITE_SCAN_SECRET
```

Optional (scripters degrade gracefully when empty):

```
ADZUNA_APP_ID / ADZUNA_API_KEY
RAPIDAPI_KEY  (Active Jobs DB subscription required on the RapidAPI marketplace)
```

**Do not commit `.env`** (it's in `.gitignore`). For Vercel, set `DATABASE_URL`, `SCAN_SECRET`, `CRON_SECRET` (= `SCAN_SECRET`), and any aggregator keys you want active in production in the Vercel project settings.

---

## 9. Memory pointers

- **`/memories/repo/jobhunt-dashboard.md`** — exhaustive build-of-record: every gotcha, verified slug, DB constraint, scraper quirk. **Read first** before any scraper or DB work. Highlights relevant to outstanding work:
  - "Workday gotchas" — three latent bugs (limit ≤ 20, multi-token inconsistency, locale+site URL shape) and the verified-tenant list.
  - "Location filter" — the 16-case spec for `passesLocationFilter()` (feeds the P2 test work).
- **`/memories/cicd-ideas-nextjs-firebase-vercel.md`** — CI patterns the user has used before. Use as the starting point for the P3 CI workflow (translate from Next.js/Firebase shape to plain Vite + Express).
- **`/memories/github-actions-cra.md`** — concrete `npm ci` + lint + build workflow shape already validated in another repo.

---

## 10. When you change the location filter or settings

The filter **only blocks new inserts** — it doesn't retroactively delete existing rows. After tightening the rule or shrinking `locations` in settings:

```bash
npm run scan          # add new matching roles
npm run prune:locations   # remove the now-out-of-region rows
```

Both are idempotent. Run prune especially after editing the filter logic in `scrapers/types.ts`.
