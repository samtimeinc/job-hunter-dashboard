# HANDOFF — Job Hunt Dashboard

> Final read for the next agent (human or otherwise) picking this up.
> Last verified working: **2026-07-31**. Read this *before* touching anything.

---

## 0. TL;DR

- ✅ **Personal job-hunting dashboard** that scrapes 12 target tech companies + 3 aggregator APIs for React/Node/TypeScript roles in Seattle-or-Remote.
- ✅ **Live, working end-to-end**: scraping → Postgres (Neon) → Express API → React/Tailwind dashboard → click-to-apply.
- ✅ **Auto-runs** via Vercel cron at 08:00 & 20:00 PT.
- ⏳ **A few non-blocking gaps** — listed below in priority order with file paths.

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
- DB has **416 jobs** across 5 sources after the location filter prune.
- Latest scan output (above) shows the **location filter working** — Ashby rejected 185, Greenhouse rejected 249, Amazon (Playwright) rejected 20.
- The Settings modal in the UI controls keywords + locations at runtime; changes take effect on the next `npm run scan`.

### Stats from the latest scan

| Source | Roles fetched | Inserted this run | Filtered out |
|---|---|---|---|
| Adzuna | 13 | 2 | (geo-filtered at query time) |
| JSearch | 10 | 2 | 8 |
| Ashby (OpenAI/Notion/Linear/Vercel/Scribd) | 399+ | small dedup | **185** |
| Greenhouse (Stripe, Anthropic, etc) | ~360 across 5 sites | dedup | **249** |
| Playwright (Amazon only) | 27 | dedup | 20 |

---

## 3. Outstanding work, prioritized

### 🟡 P1 — One scraper intermittently aborts

In the latest scan, one Greenhouse line showed:
```
greenhouse: fetched 0, errors: This operation was aborted
```

This is the **default 10s `fetchJson` timeout** in `server/src/scrapers/types.ts` tripping on a heavy Greenhouse board (likely Datadog, ~300 jobs). Fix: pass an explicit `timeoutMs` for Greenhouse, similar to how Ashby is already bumped to 20s. One-line change.

### 🟡 P1 — Three Playwright adapters are dead code

`server/src/scrapers/playwright/{microsoft,starbucks,google}.ts` are implemented but their DOM selectors were never verified against the live sites. Each file now opens with a `⚠️ STATUS: ADAPTER NOT REGISTERED` banner spelling out the re-activation steps:

1. Open the live site headlessly via a `scripts/debug-<name>.ts` (template: the deleted `debug-amazon.ts`)
2. Reverse-engineer the actual card selectors
3. Update the file
4. Add a `career` block to the company entry in `server/src/scrapers/targets.ts`
5. Move the slug to the "verified" section of `PlaywrightAdapter` in the same file

The three companies are currently **badge-only** entries — they DO get matched against Adzuna/JSearch results by name. So they're not zero-coverage, just not directly scraped. Microsoft and Starbucks are most worth fixing; Google's DOM was deliberately obfuscated with random class names so probably not worth the recurring maintenance.

### 🟢 P2 — JSearch traffic shape is weird

- The "type" of JSearch uses `/search-v2` on `jsearch.p.rapidapi.com`. Other users on RapidAPI have seen this endpoint go stale monthly. If JSearch starts 404'ing again, re-probe against `/search` and `jsearch4.p.rapidapi.com` variants.
- The response shape doesn't document `job_highlights` / `employer_reviews` — could be richer salary fields here if you want to surface them.

### 🟢 P2 — No tests

Only throwaway diagnostic scripts (`scripts/debug-*.ts`) which get deleted after use. The **one piece that genuinely warrants a unit test** is `passesLocationFilter()` in `server/src/scrapers/types.ts` — there's a documented spec for it (16 cases incl. the DC trap) that lived in `test-filter.ts` until cleanup. Re-create that file as `server/src/scrapers/__tests__/filter.test.ts` and wire up vitest if you want CI coverage there.

### 🟢 P2 — README is stale

The README at repo root still describes the original 4-company setup. Things missing:
- The full target-company list (now 12 direct + 3 badge-only)
- Section about Playwright scraping for in-house portals
- The new `npm run prune:locations` script
- The location filter rule and how to extend it
- Pointer to `/memories/repo/jobhunt-dashboard.md` for build-of-record gotchas

### 🟢 P3 — No CI

GitHub Actions config exists in `/memories/cicd-ideas-nextjs-firebase-vercel.md` for a Next.js+Firebase stack but nothing here. Lowest-effort win: a `.github/workflows/ci.yml` running `npm ci && npm run typecheck && npm run build` on PRs. Vercel already builds + deploys on `main`, so this is just a fast feedback loop for PRs.

### 🟢 P3 — Settings admin UI is half-baked

The Settings modal in `client/src/components/SettingsModal.tsx` edits a comma-separated list for `targetCompanies`, `keywords`, `locations`. Adding multi-select chips for `locations` (Seattle/Portland/Bay Area/Remote as toggleable chips) would make filter management friendlier. Not blocking.

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
  ├── GET /api/jobs             → listJobs()    page 100 + new-since-visit badge
  ├── GET /api/jobs/stats       → getStats()
  ├── POST /api/jobs/acknowledge → acknowledgeAll()  (clears "New" badge)
  ├── POST /api/jobs/:id/tracker → upsertTracker()  (per-job status)
  ├── GET  /api/settings        → keywords/locations editing
  ├── PUT  /api/settings        → update those
  ├── POST /api/scan            → runScan()   (gated by SCAN_SECRET)
  │
  └── runScan() orchestrator:
        Parallel (api):    Remotive + Adzuna + JSearch + Greenhouse + Ashby + Lever + Workday
        Serial   (browser): Playwright adapters (one shared Chromium)
        ──────────────────
        For each RawJob returned:
          1. passesLocationFilter(job, locations) ← single source of truth
          2. upsertJob()  → inserts new or bumps lastSeenAt on existing
```

---

## 5. Things that look wrong but aren't

- **`server/scripts/run-scan.ts` paths .env three levels up** (`../../../`), but `server/src/config.ts` paths only two levels up (`../../`). Both correct — depends on folder depth.
- **`drizzle-kit` only works because both `drizzle-orm` and `drizzle-kit` are root devDependencies.** If only one is installed, it will fail cryptically trying to find peer packages.
- **Server tsconfig has `"DOM"` lib.** Required only because `page.evaluate()` callbacks reference `document/HTMLElement` despite running in browser context. Don't try to remove it.
- **Vault-mapped `Remote` is in the locations list** but Adzuna silently strips it before passing as `where=` (geographic-only). The orchestrator filter does the actual remote matching. Two-step is intentional.
- **The 19 "San Francisco"-located Ashby rows** in the DB are not bugs — they're roles where Ashby's `workplaceType=Remote` and the `San Francisco` field is just the office of record. The filter correctly keeps them under the "Remote" rule.

---

## 6. Adding a company — the recipe

Documented at the top of `server/src/scrapers/targets.ts`. Quick version:

1. Find the company's ATS slug by opening its careers page:
   - `boards.greenhouse.io/<slug>` → use `greenhouse` template
   - `jobs.ashbyhq.com/<slug>` → use `ashby` template
   - `jobs.lever.co/<slug>` → use `lever` template
   - Custom in-house portal → use `playwright` template (requires the adapter slug exists)
2. Add an entry to `TARGET_COMPANIES` in `targets.ts` using one of the TEMPLATE_* blocks at the bottom of the file.
3. `npm run scan` — no build, no migration.

**Verify the slug is right first** with a curl probe — most false starts are stale/sideways slugs.

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
JSEARCH_RAPIDAPI_KEY
```

**Do not commit `.env`** (it's in `.gitignore`). For Vercel, set `DATABASE_URL`, `SCAN_SECRET`, `CRON_SECRET` (= `SCAN_SECRET`), and any aggregator keys you want active in production in the Vercel project settings.

---

## 9. Memory pointers

- **`/memories/repo/jobhunt-dashboard.md`** — exhaustive build-of-record: every gotcha, verified slug, DB constraint, scraper quirk. **Read first** before scraper or DB work.
- **`/memories/session/architecture.md`** — session snapshot of the architecture decisions.
- **`/memories/cicd-ideas-nextjs-firebase-vercel.md`** and **`/memories/github-actions-cra.md`** — CI patterns the user has used before. Use as a starting point if implementing workflow #5 below.

---

## 10. When you change the location filter or settings

The filter **only blocks new inserts** — it doesn't retroactively delete existing rows. After tightening the rule or shrinking `locations` in settings:

```bash
npm run scan          # add new matching roles
npm run prune:locations   # remove the now-out-of-region rows
```

Both are idempotent. Run prune especially after editing the filter logic in `scrapers/types.ts`.
