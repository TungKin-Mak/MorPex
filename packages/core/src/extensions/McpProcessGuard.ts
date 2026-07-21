/**
 * McpProcessGuard — STUB (MCP module removed during v4→v9 refactor)
 * @deprecated MCP process guard removed.
 */
export class McpProcessGuard {
  name = 'McpProcessGuard';
  version = '1.0.0';
  constructor(_opts?: any) {}
  async checkProcess(_pid: number) { return { allowed: true }; }
  getStats() { return { totalChecks: 0 }; }
}
