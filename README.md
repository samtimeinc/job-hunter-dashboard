# Job Hunt Dashboard

Personal job-hunting dashboard for **React / Node / TypeScript** roles in
**Seattle** and **Remote**, with direct scrapers for **32 target companies**
and six aggregator sources.

---

## ✨ Features

- **Hybrid job sourcing** — aggregators + direct career-page fetchers. No
  ToS-violating scraping of LinkedIn/Indeed.
  - **Remotive** — remote-only, no key required
  - **Adzuna** — has salary data (free API key)
  - **Active Jobs DB** via RapidAPI (Fantastic.Jobs) — hourly-refreshed
    index of jobs from 200k+ company career pages, 55+ ATS platforms
    (Greenhouse/Lever/Workday/iCIMS/…), plus LinkedIn/Wellfound/YC.
    AI-enriched with salary, work-arrangement, and seniority. Replaces
    JSearch, which silently returned empty results when its upstream
    scraper (Google for Jobs) hiccupped.
  - **Hacker News "Who is hiring?"** — monthly YC-startup megathread; no
    API key needed; rich with seed-to-Series-B companies that rarely
    appear on commercial aggregators
  - **The Muse** — employer-curated job board with rich company profiles
    (free API key, email signup)
  - **USAJOBS** — official federal government SWE roles (cleared/contractor
    positions, free API key)
  - **Greenhouse**, **Ashby**, **Lever**, **Workday** — direct career-page
    fetchers for target companies
  - **Playwright** — headless-Chromium scraper for in-house portals
    (Amazon verified; Microsoft / Starbucks / Google are stubs)
- **Location filter** — single source of truth in
  [`scrapers/types.ts`](server/src/scrapers/types.ts). Defaults to
  `Seattle` + `Remote`; rejects everything else before insert.
- **Target tracker** — per-job status: _To Apply → Applied → Interviewing_
- **"New since last visit" badge** + highlighted rows; _Mark all seen_
  clears it
- **Filters** — search, work mode, source, posted-window, target-companies-only
- **Salary honesty** — displayed only when posted by the source, else `N/A`
- **On-demand + scheduled scans** — manual "Refresh now" button **and**
  a GitHub Actions schedule at **08:00 & 20:00 UTC** (moved off Vercel cron
  to dodge the Hobby-tier ~60s serverless cap; see "Cron schedule" below)

---

## 🧱 Tech Stack

| Layer    | Choice                                                                                 |
| -------- | -------------------------------------------------------------------------------------- |
| DB       | PostgreSQL on **Neon** + **Drizzle ORM** (migrations auto-generated — never hand-edit) |
| Backend  | **Express** + TypeScript, routes in `src/api/`, queries in `src/db/queries/`           |
| Frontend | **Vite** + React + TypeScript + **Tailwind** (functional components only)              |
| Deploy   | **Vercel** — frontend at `/`, Express as `/api`, cron worker for scheduled scans       |

---

## 🚀 Local development

```bash
# 1. Install
npm install

# 2. Configure env
cp .env.example .env
# Fill in DATABASE_URL + SCAN_SECRET, optionally the API keys

# 3. Push DB schema to Neon (auto-generates + applies)
npm run db:push

# 4. Dev (server :3001 + client :5173 with API proxy)
npm run dev
```

Open http://localhost:5173.

> If port 5173 is already in use, Vite automatically moves to 5174.

---

## 📁 Layout

```
jobhunt-dashboard/
├── api/                   Vercel serverless entries
│   ├── index.ts              mounts Express at /api
│   └── cron.ts               cron-triggered scan
├── client/                React + Vite frontend
│   └── src/
│       ├── api/           typed fetch client
│       ├── components/    job table, badges, filters, stats header
│       └── hooks/         useJobs, useStats, useSettings
├── server/                Express API + DB + scrapers
│   ├── src/
│   │   ├── api/           routes only (per agents.md convention)
│   │   ├── db/
│   │   │   ├── queries/   all DB access lives here (per agents.md)
│   │   │   └── schema.ts  Drizzle schema
│   │   └── scrapers/
│   │       ├── types.ts   shared helpers + passesLocationFilter()
│   │       ├── targets.ts TARGET_COMPANIES + add-a-company templates
│   │       └── playwright/  headless browser adapters (Amazon verified)
│   └── scripts/
│       ├── run-scan.ts         `npm run scan`
│       └── prune-locations.ts  `npm run prune:locations`
├── shared/                shared TS types (source-only; no compiled output)
├── HANDOFF.md             handoff doc for the next contributor/agent
└── vercel.json            routes + cron schedule
```

---

## 🔁 Common commands

| Command                                    | Description                                                       |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `npm run dev`                              | Start Express + Vite together                                     |
| `npm run dev:server`                       | Express only on `:3001`                                           |
| `npm run dev:client`                       | Vite only                                                         |
| `npm run typecheck`                        | Typecheck all three workspaces                                    |
| `npx tsc -p tsconfig.json --noEmit`        | Vercel-path typecheck (covers `api/` — the workspace one doesn't) |
| `npm test -w server`                       | Run the vitest suite (~214 tests)                                 |
| `npm run build`                            | Emit `server/dist` + `client/dist`                                |
| `npm run scan`                             | One-off scan, prints per-source stats                             |
| `npm run prune:locations`                  | Delete DB rows that fail the current location filter (idempotent) |
| `npm run db:push`                          | Apply schema changes to Neon                                      |
| `npm run db:studio`                        | Open Drizzle Studio UI                                            |

---

## 🎯 Target companies

**32 direct-scraped companies** across five ATS types, plus **9 badge-only**
entries. Edit [`server/src/scrapers/targets.ts`](server/src/scrapers/targets.ts) to
add or remove. The file's top comment has a step-by-step "HOW TO ADD A COMPANY"
recipe plus TEMPLATE_* blocks at the bottom for each ATS type.

| ATS           | Count | Companies                                                                                          |
| ------------- | ----- | -------------------------------------------------------------------------------------------------- |
| Greenhouse    | 15    | Anthropic, Cloudflare, Airtable, Figma, Discord, Smartsheet, Stripe, Robinhood, Coinbase, Datadog, Roblox, Pinterest, Reddit, Airbnb, Lyft |
| Ashby         | 6     | OpenAI, Vercel, Linear, Notion, Ramp, Scribd                                                       |
| Lever         | 2     | Getty Images, Relay                                                                                |
| Workday       | 8     | Concentrix, Amgen, BigCommerce, Quantiphi, BMO, RELX, MillerKnoll, Prudential                      |
| Playwright    | 1     | Amazon (verified) · Microsoft / Starbucks / Google (unverified stubs)                              |
| Badge-only    | 9     | Microsoft, Starbucks, Google, PayPal, Etsy, Adobe, Shopify, Atlassian, Uber                        |
| Deprioritised | 3     | Plaid, Slack (→ Salesforce), Redfin (→ Rocket)                                                     |

**Badge-only** entries get the ★ Watchlist chip in the UI when an aggregator
(Adzuna / Active Jobs DB / Remotive) returns a role whose company name matches — no
direct scrape, but they're not zero-coverage.

---

## 🛰 Cron schedule (GitHub Actions)

The scan runs **twice daily at 08:00 & 20:00 UTC** via
[`.github/workflows/scan.yml`](.github/workflows/scan.yml), which runs
`npm run scan` directly on the Actions runner and writes to Neon.

Why not Vercel cron / `/api/cron`? Vercel Hobby caps Node serverless at ~60s
(`maxDuration: 120` in `vercel.json` is silently clamped), and the gateway
hard-cuts the connection there. A full scan fits *on average* but a Neon
cold-start + one slow fetch can push it over → bare `504` with no response
body. GitHub Actions has no such limit.

The in-app **"Refresh now"** button still hits `/api/scan` (Express, same
`SCAN_SECRET` via `X-Scan-Secret`) for on-demand single runs.

### Required repo secrets (Settings → Secrets and variables → Actions)

| Secret | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon connection string (same as Vercel's). **Required.** |
| `ADZUNA_APP_ID` / `ADZUNA_API_KEY` | Adzuna aggregator. |
| `RAPIDAPI_KEY` | Active Jobs DB (shared across RapidAPI providers). |
| `THEMUSE_API_KEY` | The Muse. |
| `USAJOBS_API_KEY` | USAJOBS. |

Scrapers whose key is missing skip cleanly — only `DATABASE_URL` is required
for the workflow to run.

---

## 🌎 Location filter

The single rule is `passesLocationFilter()` in
[`server/src/scrapers/types.ts`](server/src/scrapers/types.ts).

- Default allowed list: **`Seattle` + `Remote`**
- `Remote` token = remote wildcard (matches `workMode === 'remote'` **or** any
  location containing the substring `remote`)
- `Seattle` / `Washington` / `WA` aliases expand to known WA cities
  (Bellevue, Redmond, Kirkland, Spokane, Tacoma, Olympia, …)
- **DC trap**: bare `Washington` and `\bwa\b` would false-match Washington, DC
  — explicit rejection kicks in for any location containing
  `dc` / `d.c.` / `district of columbia`

The filter only blocks **new inserts** — existing rows stay until pruned.
After tightening the rule or shrinking the allowed list:

```bash
npm run scan              # pull in newly-matching roles
npm run prune:locations   # delete rows that no longer pass
```

---

## 🔐 Env vars

See [`.env.example`](.env.example) for the full list. Minimum to boot:

- `DATABASE_URL`
- `SCAN_SECRET`
- `AGENT_API_KEY` (only required for the `/api/agent` surface; otherwise it 503s)

Optional (scrapers degrade gracefully when empty):

- `ADZUNA_APP_ID` + `ADZUNA_API_KEY`
- `RAPIDAPI_KEY` (shared across all RapidAPI providers — subscribe to Active Jobs DB on the marketplace)
- `THEMUSE_API_KEY`
- `USAJOBS_API_KEY`

**Never commit `.env`** (it's in `.gitignore`). For Vercel, set
`DATABASE_URL`, `SCAN_SECRET`,
`AGENT_API_KEY`, and any aggregator keys in Vercel project settings. **Do not
define `VITE_AGENT_API_KEY`** — any `VITE_*` var is baked into the client
bundle. (Scheduled scans run from `.github/workflows/scan.yml` directly against
Neon — no `CRON_SECRET` is needed.)

---

## � Agent API

A secure, machine-to-machine surface at `/api/agent` for an external
job-application workflow. **Authenticated, read-mostly, and intentionally does
not submit applications.**

### Setup

```bash
# Single command to create the schema + agent-readable job columns:
npm run db:push

# Add a server-only secret to .env (and to Vercel project env for prod):
AGENT_API_KEY=node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

> ⚠️ **Never** expose the agent secret as `VITE_AGENT_API_KEY` — Vite inlines
> `VITE_*` vars into the browser bundle. `AGENT_API_KEY` is **server-only**.

### Authentication

Every `/api/agent/*` route requires `AGENT_API_KEY`. Send it via either header:

```
Authorization: Bearer $AGENT_API_KEY
X-Agent-Key: $AGENT_API_KEY
```

Missing or wrong → `401`. Not configured on the server → `503` (fail-closed).

### Routes

| Method | Path                          | Purpose                                                         |
| ------ | ----------------------------- | --------------------------------------------------------------- |
| `GET`  | `/api/agent`                  | Capability summary                                              |
| `GET`  | `/api/agent/openapi.json`     | OpenAPI 3.0 document (also checked in at `openapi/agent.yaml`)  |
| `GET`  | `/api/agent/jobs`             | Cursor-paginated search; remember `nextCursor`                  |
| `GET`  | `/api/agent/jobs/:id`         | Full record incl. `descriptionText`, `descriptionHtml`, tracker |
| `POST` | `/api/agent/jobs/:id/tracker` | Update application tracker; returns the updated record          |

### Filter the worklist

To retrieve every job currently marked `to_apply` (including ones the dashboard
hasn't touched yet):

```bash
curl -H "Authorization: Bearer $AGENT_API_KEY" \
  "https://YOUR_DOMAIN/api/agent/jobs?statuses=to_apply&limit=50&includeDescription=true"
```

### Fetch one job

```bash
curl -H "Authorization: Bearer $AGENT_API_KEY" \
  "https://YOUR_DOMAIN/api/agent/jobs/JOB_ID"
```

### Update application status

```bash
curl -X POST \
  -H "Authorization: Bearer $AGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"applied","appliedAt":"2026-08-06T20:00:00Z","notes":"Submitted manually"}' \
  "https://YOUR_DOMAIN/api/agent/jobs/JOB_ID/tracker"
```

### Example response payload

```json
{
  "jobs": [
    {
      "id": "1ef3...",
      "externalId": "gh-42",
      "source": "greenhouse",
      "company": "Stripe",
      "companySlug": "stripe",
      "title": "Senior Software Engineer",
      "url": "https://boards.greenhouse.io/stripe/jobs/42",
      "applyUrl": null,
      "companyDomain": "stripe.com",
      "location": "Seattle, WA",
      "workMode": "remote",
      "salaryMin": 180000,
      "salaryMax": 240000,
      "salaryCurrency": "USD",
      "salaryPeriod": "year",
      "postedAt": "2026-08-01T00:00:00.000Z",
      "firstSeenAt": "2026-08-02T00:00:00.000Z",
      "lastSeenAt": "2026-08-05T00:00:00.000Z",
      "active": true,
      "tags": ["Engineering"],
      "isTargetCompany": true,
      "descriptionText": "We're hiring senior engineers to build…",
      "descriptionHtml": "<p>We're hiring senior engineers…</p>",
      "tracker": {
        "status": "to_apply",
        "appliedAt": null,
        "notes": null,
        "updatedAt": "2026-08-05T00:00:00.000Z"
      }
    }
  ],
  "total": 1,
  "nextCursor": "eyJ0IjoiMjAyNi0"
}
```

### Description sources & gaps

`descriptionText` / `descriptionHtml` are populated where the upstream source
exposes them; **never fabricated**. Current coverage:

| Source              | descriptionText                          | descriptionHtml           |
| ------------------- | ---------------------------------------- | ------------------------- |
| Greenhouse          | ✅ cleaned from `content`                | ✅ original HTML          |
| Adzuna              | ✅ `description` (text)                  | — (text-only source)      |
| Active Jobs DB      | ✅ API-delivered `description_text` (plain text) | —                         |
| Lever               | ✅ `descriptionPlain` (or stripped HTML) | ✅ original `description` |
| Ashby               | ✅ `descriptionPlain`                    | —                         |
| Remotive            | ❌ (API provides no description field)   | ❌                        |
| Workday             | ❌ (list endpoint returns no body)       | ❌                        |
| Playwright adapters | ❌ (not extracted)                       | ❌                        |

### Optional MCP adapter

A Model Context Protocol server is included for local agent hosts (e.g. Claude
Desktop). It exposes three tools — `search_jobs`, `get_job`,
`update_application_status` — that call the **same internal query layer** as the
REST routes (no duplicated DB logic).

```bash
# From dev:
npm run mcp            # runs server/src/agent/mcp-server.ts via tsx
# After a production build:
npm run build -w server && npm run start:mcp
```

The MCP server is a **stdio process**, not mounted on Express — it doesn't fit
Vercel's request/response model. Remote agents must use the REST API above; the
MCP adapter is for trusted local hosts.

### ⚠️ Application submission

**Application submission must remain human-approved.** This surface lets an
agent search, read, rank, and update tracker status — never submit. The actual
"apply" action is always a click on `url` / `applyUrl` by a real person.

---

## �🧩 Notes & design decisions

- **No LinkedIn/Indeed direct scraping** — those violate ToS and get
  IP-blocked fast. Active Jobs DB (Fantastic.Jobs via RapidAPI) is a
  sanctioned aggregator that indexes LinkedIn-sourced roles hourly.
- **Salary honesty** — only what's posted is shown; never fabricated.
- **Single-user** — no auth; a shared `SCAN_SECRET` protects write paths.
- **Drizzle migrations** — `npm run db:generate` to generate, then commit
  `db/migrations/` (never hand-edit, per the convention in `agents.md`).

For build-of-record gotchas, verified ATS slugs, and trap-doors, see the
repo memory at `/memories/repo/jobhunt-dashboard.md`.
