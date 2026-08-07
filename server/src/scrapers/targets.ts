/**
 * Target companies and how to fetch their jobs.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ HOW TO ADD A COMPANY                                                 │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ 1. Find the company's ATS form by opening its careers page:          │
 * │     • "boards.greenhouse.io/<slug>"     → greenhouse                  │
 * │     • "jobs.lever.co/<slug>"            → lever                       │
 * │     • "jobs.ashbyhq.com/<slug>"         → ashby                       │
 * │     • "<co>.wd1.myworkdayjobs.com/..."  → workday (auth-walled)      │
 * │     • custom-built portal (no JSON)     → playwright adapter (see 2) │
 * │                                                                       │
 * │ 2. Append an entry to TARGET_COMPANIES below using one of the        │
 * │    TEMPLATE_* blocks at the bottom of this file.                     │
 * │                                                                       │
 * │ 3. If using a new playwright adapter:                                 │
 * │     a. add `'yourcompany'` to `PlaywrightAdapter` below                │
 * │     b. implement `yourcompany` in server/src/scrapers/playwright/    │
 * │     c. register it in server/src/scrapers/playwright/index.ts        │
 * │                                                                       │
 * │ 4. That's it — `npm run scan` picks up the new entry on next run.   │
 * │    No build step, no migration, no restart needed in dev.            │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Companies without a `career` entry get the ★ Watchlist badge in the UI
 * when an aggregator (Adzuna / JSearch / Remotive) returns a matching role
 * by name — see `isTargetCompany()` at the bottom.
 */

export interface TargetCompany {
  name: string;
  /** Substrings matched case-insensitively against scraped company names.
   *  Include plausible variants: 'notion labs' + 'notion', 'aws' + 'amazon'. */
  matchNames: string[];
  career?:
    | { type: 'greenhouse'; slug: string }
    | { type: 'lever'; slug: string }
    | { type: 'ashby'; slug: string }
    | { type: 'workday'; host: string; tenant: string; site: string }
    /** In-house portal scraped via a headless browser. */
    | { type: 'playwright'; adapter: PlaywrightAdapter };
}

/**
 * Every in-house career portal that has a Playwright adapter implemented.
 * Add new adapter slugs here when you build a working DOM extractor in
 * server/src/scrapers/playwright/<name>.ts.
 */
export type PlaywrightAdapter =
  // ✅ Verified working (live DOM confirmed 2026-07-28)
  | 'amazon'
  // 🚧 Implemented but DOM selector unverified — adapters return [] gracefully.
  // To enable: verify the adapter against the live site, then move the slug
  // above and add a `career` entry to TARGET_COMPANIES using it.
  | 'starbucks'
  | 'microsoft'
  | 'google';

export const TARGET_COMPANIES: TargetCompany[] = [
  // ═══════════════════════════════════════════════════════════════════════
  // AI Research & Foundations
  // ═══════════════════════════════════════════════════════════════════════
  { name: 'OpenAI', matchNames: ['openai', 'open ai'], career: { type: 'ashby', slug: 'openai' } },
  {
    name: 'Anthropic',
    matchNames: ['anthropic'],
    career: { type: 'greenhouse', slug: 'anthropic' },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Developer tools / infra
  // ═══════════════════════════════════════════════════════════════════════
  { name: 'Vercel', matchNames: ['vercel'], career: { type: 'ashby', slug: 'vercel' } },
  { name: 'Linear', matchNames: ['linear'], career: { type: 'ashby', slug: 'linear' } },
  {
    name: 'Notion',
    matchNames: ['notion labs', 'notion'],
    career: { type: 'ashby', slug: 'notion' },
  },
  // Verified live 2026-08-04 against boards-api.greenhouse.io/v1/boards/cloudflare (290 roles).
  {
    name: 'Cloudflare',
    matchNames: ['cloudflare'],
    career: { type: 'greenhouse', slug: 'cloudflare' },
  },
  // Verified live 2026-08-04 against api.ashbyhq.com/posting-api/job-board/ramp (120 roles).
  {
    name: 'Ramp',
    matchNames: ['ramp', 'ramp business corporation'],
    career: { type: 'ashby', slug: 'ramp' },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Productivity / collaboration
  // ═══════════════════════════════════════════════════════════════════════
  { name: 'Airtable', matchNames: ['airtable'], career: { type: 'greenhouse', slug: 'airtable' } },
  { name: 'Figma', matchNames: ['figma'], career: { type: 'greenhouse', slug: 'figma' } },
  { name: 'Discord', matchNames: ['discord'], career: { type: 'greenhouse', slug: 'discord' } },
  {
    name: 'Smartsheet',
    matchNames: ['smartsheet'],
    career: { type: 'greenhouse', slug: 'smartsheet' },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Payments / fintech
  // ═══════════════════════════════════════════════════════════════════════
  { name: 'Stripe', matchNames: ['stripe'], career: { type: 'greenhouse', slug: 'stripe' } },
  {
    name: 'Robinhood',
    matchNames: ['robinhood'],
    career: { type: 'greenhouse', slug: 'robinhood' },
  },
  // Verified live 2026-08-04 against boards-api.greenhouse.io/v1/boards/coinbase (163 roles).
  { name: 'Coinbase', matchNames: ['coinbase'], career: { type: 'greenhouse', slug: 'coinbase' } },

  // ═══════════════════════════════════════════════════════════════════════
  // Observability / data
  // ═══════════════════════════════════════════════════════════════════════
  { name: 'Datadog', matchNames: ['datadog'], career: { type: 'greenhouse', slug: 'datadog' } },

  // ═══════════════════════════════════════════════════════════════════════
  // Gaming / creative platforms
  // ═════════════════════════════════════════════════════════════════════════
  // Verified live 2026-08-04 against boards-api.greenhouse.io/v1/boards/roblox (220 roles).
  { name: 'Roblox', matchNames: ['roblox'], career: { type: 'greenhouse', slug: 'roblox' } },

  // ═════════════════════════════════════════════════════════════════════════
  // Reading / content
  // ═════════════════════════════════════════════════════════════════════════
  { name: 'Scribd', matchNames: ['scribd'], career: { type: 'ashby', slug: 'ScribdInc' } },

  // ═════════════════════════════════════════════════════════════════════════
  // Discovery / inspiration
  // ═════════════════════════════════════════════════════════════════════════
  // Verified live 2026-08-04 against boards-api.greenhouse.io/v1/boards/pinterest (226 roles).
  {
    name: 'Pinterest',
    matchNames: ['pinterest'],
    career: { type: 'greenhouse', slug: 'pinterest' },
  },
  // Verified live 2026-08-04 against boards-api.greenhouse.io/v1/boards/reddit (186 roles).
  {
    name: 'Reddit',
    matchNames: ['reddit', 'reddit inc'],
    career: { type: 'greenhouse', slug: 'reddit' },
  },

  // ═════════════════════════════════════════════════════════════════════════
  // Travel / marketplace
  // ═════════════════════════════════════════════════════════════════════════
  // Verified live 2026-08-04 against boards-api.greenhouse.io/v1/boards/airbnb (189 roles).
  { name: 'Airbnb', matchNames: ['airbnb'], career: { type: 'greenhouse', slug: 'airbnb' } },
  // Verified live 2026-08-04 against boards-api.greenhouse.io/v1/boards/lyft (169 roles).
  { name: 'Lyft', matchNames: ['lyft'], career: { type: 'greenhouse', slug: 'lyft' } },

  // ═══════════════════════════════════════════════════════════════════════
  // Lever boards (legacy startups that didn't migrate to Ashby/Greenhouse)
  // Verified live 2026-08-02 against api.lever.co/v0/postings/<slug>
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'Getty Images',
    matchNames: ['getty images', 'gettyimages'],
    career: { type: 'lever', slug: 'gettyimages' },
  },
  { name: 'Relay', matchNames: ['relay', 'relaypro'], career: { type: 'lever', slug: 'relay' } },

  // ═══════════════════════════════════════════════════════════════════════
  // Workday tenants (enterprise + consulting). All 8 endpoints below were
  // verified live 2026-08-02 by POSTing to /wday/cxs/<tenant>/<site>/jobs
  // with searchText "React" and confirming >= 4 postings came back.
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'Concentrix',
    matchNames: ['concentrix'],
    career: {
      type: 'workday',
      host: 'https://cnx.wd1.myworkdayjobs.com',
      tenant: 'cnx',
      site: 'external_global',
    },
  },
  {
    name: 'Amgen',
    matchNames: ['amgen'],
    career: {
      type: 'workday',
      host: 'https://amgen.wd1.myworkdayjobs.com',
      tenant: 'amgen',
      site: 'Careers',
    },
  },
  {
    name: 'BigCommerce',
    matchNames: ['bigcommerce', 'big commerce'],
    career: {
      type: 'workday',
      host: 'https://bigcommerce.wd12.myworkdayjobs.com',
      tenant: 'bigcommerce',
      site: 'Commerce',
    },
  },
  {
    name: 'Quantiphi',
    matchNames: ['quantiphi'],
    career: {
      type: 'workday',
      host: 'https://quantiphi.wd1.myworkdayjobs.com',
      tenant: 'quantiphi',
      site: 'Careers_at_Quantiphi',
    },
  },
  {
    name: 'BMO',
    matchNames: ['bmo', 'bank of montreal'],
    career: {
      type: 'workday',
      host: 'https://bmo.wd3.myworkdayjobs.com',
      tenant: 'bmo',
      site: 'External',
    },
  },
  {
    name: 'RELX',
    matchNames: ['relx'],
    career: {
      type: 'workday',
      host: 'https://relx.wd3.myworkdayjobs.com',
      tenant: 'relx',
      site: 'relx',
    },
  },
  {
    name: 'MillerKnoll',
    matchNames: ['millerknoll', 'miller knoll'],
    career: {
      type: 'workday',
      host: 'https://millerknoll.wd1.myworkdayjobs.com',
      tenant: 'millerknoll',
      site: 'MillerKnoll',
    },
  },
  {
    name: 'Prudential',
    matchNames: ['prudential', 'pgim'],
    career: {
      type: 'workday',
      host: 'https://pru.wd5.myworkdayjobs.com',
      tenant: 'pru',
      site: 'Careers',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // In-house career portals (scraped via Playwright, no JSON API)
  // ═══════════════════════════════════════════════════════════════════════
  // Only entries whose adapter has been verified live belong here. To add a
  // new adapter: implement it in server/src/scrapers/playwright/<name>.ts
  // and prove it returns real jobs via a debug script before flipping it on.
  {
    name: 'Amazon',
    matchNames: ['amazon', 'aws', 'amazon web services'],
    career: { type: 'playwright', adapter: 'amazon' },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Badge-only (matched against Adzuna / JSearch / Remotive results by name)
  // ═══════════════════════════════════════════════════════════════════════
  // No `career` entry → these companies aren't scraped directly, but any job
  // surfaced by an aggregator whose company-name contains a matchName gets
  // the ★ Watchlist badge + the "Target companies" filter toggle.
  //
  // For these three we attempted Playwright adapters (see playwright/
  // microsoft.ts, starbucks.ts, google.ts) but the live DOM selectors
  // couldn't be verified — they returned 0 with a console warning rather than
  // crashing. If you reverse-engineer any of them in the future, add a
  // `career` entry pointing at the right PlaywrightAdapter slug.
  { name: 'Microsoft', matchNames: ['microsoft', 'msft', 'azure'] },
  { name: 'Starbucks', matchNames: ['starbucks', 'sbux'] },
  { name: 'Google', matchNames: ['google', 'alphabet', 'google llc', 'youtube'] },

  // Batch added 2026-08-04 (early-career friendly, React/TS/Node/Next stack).
  // Each was probed against Greenhouse / Ashby / Lever / Workday before landing
  // here — none exposed a clean JSON API we can scrape, so they badge-match
  // against Adzuna / JSearch / Remotive results by company name instead.
  //   PAYPAL  — careers.pypl.com is a Q4 Inc portal behind a login wall; the
  //             legacy paypal.wd3.myworkdayjobs.com tenant returns HTTP 422 on
  //             every site name (decommissioned). Not publicly scrapable.
  //   ETSY    — careers.etsy.com runs on SmashFly (CloudFront-hosted SPA); no
  //             public JSON feed. Would need a Playwright adapter to scrape.
  //   ADOBE   — careers.adobe.com runs on the Phenom platform; Phenom has a
  //             JSON endpoint but no scraper adapter exists in this repo yet.
  //   SHOPIFY — shopify.com/careers is an in-house brochure that deliberately
  //             de-emphasises individual postings (routes to discipline pages);
  //             no JSON feed.
  { name: 'PayPal', matchNames: ['paypal', 'paypal holdings'] },
  { name: 'Etsy', matchNames: ['etsy'] },
  { name: 'Adobe', matchNames: ['adobe'] },
  { name: 'Shopify', matchNames: ['shopify'] },

  // Batch added 2026-08-04. Probed against Greenhouse / Ashby / Lever / Workday
  // before landing here — no clean JSON API, badge-matches aggregators instead.
  //   ATLASSIAN — careers live at atlassian.com/company/careers/all-jobs on the
  //              Beamery platform (signed `flows.beamery.com/atlassian` link).
  //              The all-jobs page is JS-rendered (no inline JSON, no __NEXT_DATA__,
  //              no /api/* endpoint reachable without query parameters). Would
  //              need a Playwright adapter + reverse-engineered XHR to scrape.
  { name: 'Atlassian', matchNames: ['atlassian'] },

  //   UBER — lives at jobs.uber.com on a Next.js SSR app served behind Cloudflare.
  //          /api/* returns HTTP 403 (bot-protected), so the only data reachable
  //          server-side is the 10 jobs embedded in the flight payload of the
  //          SSR HTML — and `?search=` is ignored by the SSR layer (every query
  //          returns the same 10 ML/AV-Labs roles). Useful scraping requires
  //          hitting the SPA's XHR endpoint with a real browser (Playwright),
  //          which is too brittle/labor-intensive for one extra company.
  { name: 'Uber', matchNames: ['uber', 'uber technologies'] },

  // ═══════════════════════════════════════════════════════════════════════
  // DEPRIORITISED — documented so we don't rediscover these issues
  // ═══════════════════════════════════════════════════════════════════════
  // PLAID   — custom careers portal at plaid.com/careers/openings/*; no JSON.
  // SLACK   — fully absorbed into Salesforce; careers live behind auth-walled
  //           salesforce.wd1.myworkdayjobs.com.
  // REDFIN  — acquired by Rocket Companies 2023; careers redirect to
  //           careers.rocket.com (Taleo, no JSON API).

  // ═══════════════════════════════════════════════════════════════════════
  // TEMPLATE BLOCKS — uncomment & edit to add a new company
  // ═══════════════════════════════════════════════════════════════════════
  // TEMPLATE_GREENHOUSE  (most common among mid-sized tech)
  // { name: 'Example', matchNames: ['example'], career: { type: 'greenhouse', slug: 'example' } },
  //
  // TEMPLATE_ASHBY  (AI startups, modern tooling companies)
  // { name: 'Example', matchNames: ['example'], career: { type: 'ashby', slug: 'example' } },
  //
  // TEMPLATE_LEVER  (legacy startups that didn't migrate)
  // { name: 'Example', matchNames: ['example'], career: { type: 'lever', slug: 'example' } },
  //
  // TEMPLATE_PLAYWRIGHT  (new in-house portal — see "HOW TO ADD A COMPANY" at the top)
  // { name: 'Example', matchNames: ['example'], career: { type: 'playwright', adapter: 'examplename' } },
  //
  // TEMPLATE_BADGE_ONLY  (no direct scrape, matches against aggregators by name)
  // { name: 'Example', matchNames: ['example'] },
];

export function isTargetCompany(name: string): boolean {
  const lower = name.toLowerCase();
  return TARGET_COMPANIES.some((c) => c.matchNames.some((m) => lower.includes(m.toLowerCase())));
}
