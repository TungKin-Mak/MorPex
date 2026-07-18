/**
 * MCP — 边车运行时基础设施统一出口
 *
 * 用法：
 *   import { McpRuntimeManager } from './mcp/index.js';
 *   const manager = McpRuntimeManager.getInstance();
 *   const client = await manager.spawn('my-service', 'node', ['./handler.js']);
 *   const result = await client.call('myMethod', { foo: 'bar' });
 *   await manager.shutdownAll();
 */

export { McpRuntimeManager, default } from './McpRuntimeManager.js';
export { McpJsonRpcHandler } from './McpJsonRpcHandler.js';

export type {
  McpClient,
  JsonRpcRequest,
  JsonRpcSuccess,
  JsonRpcError,
  JsonRpcResponse,
  McpProcessStatus,
} from './McpRuntimeManager.js';
