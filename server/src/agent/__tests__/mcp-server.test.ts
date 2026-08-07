import { describe, it, expect } from 'vitest';
import { buildMcpServer } from '../mcp-server.js';

/**
 * Smoke test for the MCP adapter. We build the server directly (no transport)
 * and confirm it declares the three expected tools.
 *
 * The server's tool registry is intentionally not part of the public MCP API,
 * so we poke at internals via a typed cast to read the registered tool names
 * without spinning up a JSON-RPC transport. This keeps the test fast and
 * process-local.
 */
describe('MCP server (agent adapter)', () => {
  it('builds without throwing', () => {
    expect(() => buildMcpServer()).not.toThrow();
  });

  it('registers the three required tools', () => {
    const server = buildMcpServer();
    // The high-level McpServer stores registered tools on a private field; we
    // access it via the well-known `_registeredTools` symbol used by the SDK.
    // If a future SDK version renames it, this test should fail loudly so we
    // update the assertion rather than silently ship a broken adapter.
    // Internally the SDK keeps a plain object keyed by tool name.
    const reg = (
      server as unknown as {
        _registeredTools?: Record<string, { description?: string }>;
      }
    )._registeredTools;
    expect(reg).toBeTypeOf('object');
    expect(reg).not.toBeNull();
    const names = Object.keys(reg ?? {});
    expect(names).toEqual(
      expect.arrayContaining(['search_jobs', 'get_job', 'update_application_status']),
    );
  });

  it('does not register an application-submission tool', () => {
    const server = buildMcpServer();
    const reg = (
      server as unknown as {
        _registeredTools?: Record<string, unknown>;
      }
    )._registeredTools;
    const names = Object.keys(reg ?? {});
    expect(names).not.toContain('submit_application');
    expect(names).not.toContain('apply_to_job');
  });
});
