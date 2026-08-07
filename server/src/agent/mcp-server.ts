/**
 * Optional Model Context Protocol adapter for the job-hunt dashboard.
 *
 * Exposes three tools that map 1:1 onto the REST surface:
 *   • search_jobs         → listAgentJobs()
 *   • get_job             → getAgentJob()
 *   • update_application_status → upsertTracker()
 *
 * The adapter reuses the SAME internal query/service layer as the REST routes
 * — there is no duplicated database logic, no parallel ORM access. That keeps
 * behaviour, filtering semantics, and serialisation identical between an HTTP
 * agent and an MCP-driven agent.
 *
 * Runtime model:
 *   - Runs as a standalone stdio process: `node server/dist/agent/mcp-server.js`
 *     (or `npm run mcp` after a build). Designed to be launched by an MCP host
 *     such as Claude Desktop / GitHub Copilot Agent Mode.
 *   - NOT mounted on the Vercel Express app. A long-lived stdio server doesn't
 *     fit Vercel's request/response serverless model — that's why this is a
 *     separate entrypoint rather than middleware. The REST API at /api/agent
 *     remains the deployment-friendly way in for remote agents.
 *   - The MCP process inherits DATABASE_URL from the launching environment;
 *     AGENT_API_KEY is NOT required here because the process is local/trusted
 *     and is already authenticated by whatever launches it (the MCP host).
 *     Auth for remote callers is enforced at the REST boundary.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { config } from '../config.js';
import { getAgentJob, listAgentJobs } from '../db/queries/agent.js';
import { upsertTracker } from '../db/queries/trackers.js';

const STATUS_ENUM = z.enum(['to_apply', 'applied', 'interviewing']);
const SOURCE_ENUM = z.enum([
  'remotive',
  'adzuna',
  'jsearch',
  'greenhouse',
  'lever',
  'ashby',
  'playwright',
  'workday',
]);
const WORK_MODE_ENUM = z.enum(['remote', 'hybrid', 'onsite', 'unknown']);

/** Build the MCP server with the three tools registered. Exported so tests
 *  can spin up an instrumented instance. */
export function buildMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'jobhunt-agent', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  // search_jobs — the headline tool. Lets the agent pull the full to_apply
  // queue (default) or any filtered slice. Mirrors GET /api/agent/jobs.
  server.registerTool(
    'search_jobs',
    {
      title: 'Search jobs',
      description:
        'Search the job dashboard. Defaults to the worklist (status=to_apply, including untouched jobs). Use statuses/companies to narrow. Pass includeDescription=true to receive description bodies. Returns { jobs, total, nextCursor }.',
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe('Substring on title + company (+ descriptionText when includeDescription).'),
        statuses: z
          .string()
          .optional()
          .describe(
            "Comma-separated: to_apply,applied,interviewing. 'to_apply' also picks up jobs with no tracker yet.",
          ),
        sources: z
          .string()
          .optional()
          .describe('Comma-separated source slugs (greenhouse, lever, ashby, …).'),
        workModes: z.string().optional().describe('Comma-separated: remote,hybrid,onsite,unknown.'),
        companyScope: z.enum(['all', 'target', 'other']).optional(),
        visibility: z.enum(['active', 'hidden', 'all']).optional(),
        postedWithinDays: z.number().int().positive().optional(),
        active: z
          .boolean()
          .optional()
          .describe('Default true = only jobs still seen in the latest scan.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Page size (max 200). Default 50.'),
        cursor: z.string().optional().describe('Opaque cursor from a previous nextCursor.'),
        includeDescription: z
          .boolean()
          .optional()
          .describe('Default false. Set true to receive descriptionText/descriptionHtml.'),
      },
    },
    async (args) => {
      const filters = {
        search: args.search,
        statuses: args.statuses
          ? (args.statuses
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean) as never)
          : undefined,
        sources: args.sources
          ? (args.sources
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean) as never)
          : undefined,
        workModes: args.workModes
          ? (args.workModes
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean) as never)
          : undefined,
        companyScope: args.companyScope,
        visibility: args.visibility,
        postedWithinDays: args.postedWithinDays,
        active: args.active,
        limit: args.limit,
        cursor: args.cursor,
        includeDescription: args.includeDescription ?? false,
      };
      const result = await listAgentJobs(filters);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        // structuredContent is also surfaced for clients that prefer it.
        // Cast via Record<string, unknown> because the MCP SDK requires an
        // index signature on structuredContent, and our shared types are
        // strict interfaces (no index signature).
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  // get_job — full record including description + tracker. Mirrors GET /api/agent/jobs/:id.
  server.registerTool(
    'get_job',
    {
      title: 'Get job',
      description:
        'Fetch one complete job record by id, including descriptionText, descriptionHtml, and tracker. Returns 404-shaped "error" field when unknown.',
      inputSchema: {
        id: z.string().min(1).describe('Internal job id returned by search_jobs.'),
      },
    },
    async (args) => {
      const job = await getAgentJob(args.id, { includeDescription: true });
      if (!job) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Job not found: ${args.id}` }],
          structuredContent: { error: 'not_found', id: args.id },
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(job) }],
        structuredContent: job as unknown as Record<string, unknown>,
      };
    },
  );

  // update_application_status — the only mutating tool. Mirrors POST /api/agent/jobs/:id/tracker.
  server.registerTool(
    'update_application_status',
    {
      title: 'Update application status',
      description:
        'Set the tracker status for a job (to_apply | applied | interviewing). Does NOT submit any application externally — submission is always human-approved. Returns the updated tracker record.',
      inputSchema: {
        jobId: z.string().min(1),
        status: STATUS_ENUM,
        appliedAt: z
          .string()
          .datetime()
          .optional()
          .describe(
            'ISO 8601 timestamp. Ignored when status=to_apply; defaults to now() otherwise.',
          ),
        notes: z.string().nullable().optional(),
      },
    },
    async (args) => {
      const existing = await getAgentJob(args.jobId);
      if (!existing) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Job not found: ${args.jobId}` }],
          structuredContent: { error: 'not_found', id: args.jobId },
        };
      }
      const tracker = await upsertTracker(args.jobId, {
        status: args.status,
        appliedAt: args.appliedAt ?? null,
        notes: args.notes ?? null,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(tracker) }],
        structuredContent: tracker as unknown as Record<string, unknown>,
      };
    },
  );

  // Touch the imported enums so the linter doesn't flag them as unused —
  // they're available for future tools that want stricter per-array-element
  // validation rather than the comma-separated string input used above.
  void SOURCE_ENUM;
  void WORK_MODE_ENUM;
  void config;

  return server;
}

/** Standalone entry point. Reads from stdin / writes JSON-RPC to stdout.
 *  Logs go to stderr so they don't corrupt the protocol framing. */
export async function runMcpServer(): Promise<void> {
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// When executed directly (node .../mcp-server.js), boot the server.
// Guarded so importing this module from tests doesn't start it.
const isDirectRun = (() => {
  try {
    return process.argv[1]?.endsWith('mcp-server.js') ?? false;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  runMcpServer().catch((err) => {
    console.error('[mcp] fatal:', err);
    process.exit(1);
  });
}
