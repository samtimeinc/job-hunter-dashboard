/**
 * OpenAPI 3.0 document for the /api/agent surface.
 *
 * Also served at GET /api/agent/openapi.json (behind AGENT_API_KEY).
 *
 * Notes on the schema shapes:
 *  - All timestamp fields are RFC 3339 / ISO-8601 strings (UTC).
 *  - Nullable fields use `nullable: true` per OAS 3.0.
 *  - Description fields are present on the Job schema but omitted from the
 *    search list response unless `includeDescription=true` is requested —
 *    see the description-per-query extensions on the search operation.
 */
const ERROR_RESPONSE = {
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['status', 'message'],
        properties: {
          status: { type: 'integer', example: 401 },
          message: { type: 'string', example: 'Unauthorized' },
        },
      },
    },
  },
};

const JOB_SCHEMA = {
  type: 'object',
  required: [
    'id',
    'externalId',
    'source',
    'company',
    'title',
    'url',
    'location',
    'workMode',
    'salaryMin',
    'salaryMax',
    'salaryCurrency',
    'salaryPeriod',
    'postedAt',
    'firstSeenAt',
    'lastSeenAt',
    'active',
    'tags',
    'isTargetCompany',
  ],
  properties: {
    id: { type: 'string', format: 'uuid', description: 'Internal job id (stable).' },
    externalId: { type: 'string', description: 'Source-specific id used for dedup.' },
    source: {
      type: 'string',
      enum: [
        'remotive',
        'adzuna',
        'jsearch',
        'greenhouse',
        'lever',
        'ashby',
        'playwright',
        'workday',
        'github',
      ],
    },
    company: { type: 'string' },
    companySlug: { type: 'string', nullable: true },
    title: { type: 'string' },
    url: { type: 'string', format: 'uri', description: 'Canonical details page.' },
    applyUrl: {
      type: 'string',
      format: 'uri',
      nullable: true,
      description: 'Direct apply URL when known; null when the source did not provide one.',
    },
    companyDomain: {
      type: 'string',
      nullable: true,
      description: 'Normalised company domain e.g. "stripe.com". Null when not derivable.',
    },
    location: { type: 'string', nullable: true },
    workMode: { type: 'string', enum: ['remote', 'hybrid', 'onsite', 'unknown'] },
    salaryMin: {
      type: 'integer',
      nullable: true,
      description: 'Annual or hourly integer lower bound; null when not posted.',
    },
    salaryMax: { type: 'integer', nullable: true },
    salaryCurrency: { type: 'string', nullable: true, example: 'USD' },
    salaryPeriod: { type: 'string', enum: ['year', 'hour'], nullable: true },
    postedAt: { type: 'string', format: 'date-time', nullable: true },
    firstSeenAt: { type: 'string', format: 'date-time' },
    lastSeenAt: { type: 'string', format: 'date-time' },
    active: {
      type: 'boolean',
      description: 'True when the job still appeared in the most recent scan.',
    },
    tags: { type: 'array', items: { type: 'string' } },
    isTargetCompany: { type: 'boolean' },
    acknowledgedAt: { type: 'string', format: 'date-time', nullable: true },
    hiddenAt: { type: 'string', format: 'date-time', nullable: true },
    descriptionText: {
      type: 'string',
      nullable: true,
      description:
        'Plain-text job body normalised by the scraper. Null when the source exposes no description (Remotive, Workday list endpoint, GitHub iCIMS, Playwright). Always null on the search list unless includeDescription=true.',
    },
    descriptionHtml: {
      type: 'string',
      nullable: true,
      description:
        'Original HTML description when the scraper received HTML (Greenhouse `content`, Adzuna/text-only sources leave this null).',
    },
    tracker: {
      oneOf: [{ $ref: '#/components/schemas/ApplicationTracker' }, { type: 'null' }],
      description: 'Linked tracker row, or null if the job has no tracker yet.',
    },
  },
};

const TRACKER_SCHEMA = {
  type: 'object',
  required: ['id', 'jobId', 'status', 'appliedAt', 'notes', 'updatedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    jobId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['to_apply', 'applied', 'interviewing'] },
    appliedAt: { type: 'string', format: 'date-time', nullable: true },
    notes: { type: 'string', nullable: true },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const SECURITY_SCHEME = {
  type: 'http',
  scheme: 'bearer',
  description:
    'Pass AGENT_API_KEY as the bearer token: `Authorization: Bearer <AGENT_API_KEY>`. The same value is also accepted via the `X-Agent-Key` header.',
};

/** Filters shared by the search endpoint query string. Defined inline so the
 *  values + descriptions live next to the schema. */
const JOB_QUERY_PARAMS = [
  {
    name: 'search',
    in: 'query',
    description:
      'Case-insensitive substring match on title + company (and descriptionText when includeDescription=true).',
    required: false,
    schema: { type: 'string' },
  },
  {
    name: 'statuses',
    in: 'query',
    description:
      "Comma-separated application statuses. 'to_apply' includes jobs that have no tracker row yet (implicit default). Example: `statuses=to_apply,applied`.",
    required: false,
    schema: { type: 'string', example: 'to_apply,applied' },
  },
  {
    name: 'sources',
    in: 'query',
    description: 'Comma-separated source filter. Example: `sources=greenhouse,lever`.',
    required: false,
    schema: { type: 'string' },
  },
  {
    name: 'workModes',
    in: 'query',
    description: 'Comma-separated work-mode filter. Example: `workModes=remote,hybrid`.',
    required: false,
    schema: { type: 'string' },
  },
  {
    name: 'companyScope',
    in: 'query',
    description: 'Restrict to target companies or others.',
    required: false,
    schema: { type: 'string', enum: ['all', 'target', 'other'] },
  },
  {
    name: 'visibility',
    in: 'query',
    description:
      'Hidden-row visibility. Defaults to `active` (excludes hidden). `all` returns both.',
    required: false,
    schema: { type: 'string', enum: ['active', 'hidden', 'all'] },
  },
  {
    name: 'postedWithinDays',
    in: 'query',
    description: 'Only jobs posted within the last N days (null postedAt counts as recent).',
    required: false,
    schema: { type: 'integer', minimum: 1 },
  },
  {
    name: 'active',
    in: 'query',
    description:
      'Filter by scan activity. `true` (default) = only jobs still seen in the latest scan; `false` = only closed/stale rows.',
    required: false,
    schema: { type: 'boolean' },
  },
  {
    name: 'limit',
    in: 'query',
    description: 'Page size. Clamped to [1, 200]. Default 50.',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 200 },
  },
  {
    name: 'pageSize',
    in: 'query',
    description: 'Alias for `limit`.',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 200 },
  },
  {
    name: 'cursor',
    in: 'query',
    description:
      'Opaque cursor returned in the previous response `nextCursor`. Preferred over `page` for stable iteration.',
    required: false,
    schema: { type: 'string' },
  },
  {
    name: 'page',
    in: 'query',
    description: '1-based page index. Ignored when `cursor` is also supplied.',
    required: false,
    schema: { type: 'integer', minimum: 1 },
  },
  {
    name: 'includeDescription',
    in: 'query',
    description:
      'When true, return descriptionText/descriptionHtml on each job. Defaults to false to keep payloads small.',
    required: false,
    schema: { type: 'boolean' },
  },
];

export const AGENT_OPENAPI = {
  openapi: '3.0.3',
  info: {
    title: 'Job Hunt Dashboard — Agent API',
    version: '1.0.0',
    description:
      'Read-only and tracker-write surface for an external job-application workflow. Authenticated via a server-side `AGENT_API_KEY`. The API never accepts application submission — that step is always human-approved.',
  },
  servers: [
    {
      url: '/api/agent',
      description: 'Relative to the dashboard host (works for local + deployed).',
    },
  ],
  components: {
    securitySchemes: {
      agentApiKey: SECURITY_SCHEME,
    },
    schemas: {
      Job: JOB_SCHEMA,
      ApplicationTracker: TRACKER_SCHEMA,
      JobListResponse: {
        type: 'object',
        required: ['jobs', 'total', 'nextCursor'],
        properties: {
          jobs: { type: 'array', items: { $ref: '#/components/schemas/Job' } },
          total: {
            type: 'integer',
            description: 'Total jobs matching the filters across all pages.',
          },
          nextCursor: {
            type: 'string',
            nullable: true,
            description:
              'Pass back as `cursor` for the next page, or null when the end is reached.',
          },
        },
      },
      UpdateTrackerRequest: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['to_apply', 'applied', 'interviewing'] },
          appliedAt: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description:
              'ISO timestamp. Ignored for status=to_apply; defaults to now() when omitted otherwise.',
          },
          notes: { type: 'string', nullable: true },
        },
      },
      AgentTrackerResponse: {
        type: 'object',
        required: ['tracker'],
        properties: { tracker: { $ref: '#/components/schemas/ApplicationTracker' } },
      },
      HealthResponse: {
        type: 'object',
        required: ['ok'],
        properties: { ok: { type: 'boolean' } },
      },
    },
    responses: {
      Unauthorized: {
        description: 'AGENT_API_KEY missing or wrong.',
        ...ERROR_RESPONSE,
      },
      Forbidden: {
        description: 'AGENT_API_KEY not configured on the server (fail-closed).',
        ...ERROR_RESPONSE,
      },
      NotFound: {
        description: 'Job not found.',
        ...ERROR_RESPONSE,
      },
      BadRequest: {
        description: 'Malformed request body (e.g. invalid tracker status).',
        ...ERROR_RESPONSE,
      },
    },
  },
  security: [{ agentApiKey: [] }],
  paths: {
    '/': {
      get: {
        summary: 'Capability summary',
        description:
          'Returns a small JSON object describing the agent surface and pointing at the OpenAPI document.',
        responses: {
          '200': {
            description: 'Capability summary.',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '503': { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/openapi.json': {
      get: {
        summary: 'OpenAPI document',
        description: 'Returns this document (also available checked-in at openapi/agent.yaml).',
        responses: {
          '200': {
            description: 'OpenAPI 3.0 JSON document.',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '503': { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/jobs': {
      get: {
        summary: 'Search jobs',
        description:
          'Cursor- or page-paginated search across the dashboard job set. To find every job currently marked `to_apply` (including untouched ones), pass `statuses=to_apply`. With `includeDescription=true` the response bodies carry descriptionText/descriptionHtml.',
        parameters: JOB_QUERY_PARAMS,
        responses: {
          '200': {
            description: 'Paginated job list.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/JobListResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '503': { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/jobs/{id}': {
      get: {
        summary: 'Get one job',
        description:
          'Returns the full normalised job record including description fields and tracker data. 404 for an unknown id.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Complete job record.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['job'],
                  properties: { job: { $ref: '#/components/schemas/Job' } },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
          '503': { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/jobs/{id}/tracker': {
      post: {
        summary: 'Update application-tracker status',
        description:
          'Upsert the tracker row for a job. Returns the updated record. Does NOT submit any application externally — submission always stays human-approved.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateTrackerRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated tracker.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AgentTrackerResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
          '503': { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
  },
} as const;

/** Short summary returned by GET /api/agent. */
export const AGENT_API_INFO = {
  name: 'Job Hunt Dashboard — Agent API',
  version: '1.0.0',
  description:
    'Authenticated surface for an external job-application workflow. All routes require AGENT_API_KEY. Application submission is intentionally not exposed.',
  openapiUrl: '/api/agent/openapi.json',
  endpoints: ['GET /api/agent/jobs', 'GET /api/agent/jobs/:id', 'POST /api/agent/jobs/:id/tracker'],
  auth: {
    schemes: ['Authorization: Bearer <AGENT_API_KEY>', 'X-Agent-Key: <AGENT_API_KEY>'],
    note: 'AGENT_API_KEY is server-only and never bundled into client JavaScript.',
  },
} as const;
