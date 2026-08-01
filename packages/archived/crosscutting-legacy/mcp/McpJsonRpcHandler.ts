/**
 * McpJsonRpcHandler — STUB (MCP module removed during v4→v9 refactor)
 * @deprecated MCP protocol handling removed.
 */
export class McpJsonRpcHandler {
  name = 'McpJsonRpcHandler';
  version = '1.0.0';
  constructor(_opts?: any) {}
  async handle(_request: any) { return { jsonrpc: '2.0', result: null, id: null }; }
  getStats() { return { totalRequests: 0 }; }
}
