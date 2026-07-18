/**
 * MorPex Contracts — Runtime Events (bus-level)
 *
 * Higher-level events emitted on the MorPexCore EventBus.
 * These wrap adapter events with execution context.
 */

import type { ToolCall, ToolResult } from './tool.js';
import type { RuntimeError } from './errors.js';
import type { TokenUsage } from './inference.js';
import type { AgentRuntimeEvent } from './agent-runtime.js';

// ═══════════════════════════════════════════════════════════════════
// MorPex Runtime Event (EventBus level)
// ═══════════════════════════════════════════════════════════════════

export type MorPexRuntimeEvent =
  | { type: 'gateway.adapter.registered'; adapterName: string; timestamp: number }
  | { type: 'runtime.execution.started'; executionId: string; agentRole: string; adapterName: string; input: unknown; timestamp: number }
  | { type: 'runtime.execution.completed'; executionId: string; agentRole: string; adapterName: string; status: string; duration: number; timestamp: number }
  | { type: 'runtime.execution.failed'; executionId: string; agentRole: string; adapterName: string; error: string; timestamp: number }
  | { type: 'runtime.execution.aborted'; executionId: string; timestamp: number }
  | { type: 'runtime.tool.called'; executionId: string; toolName: string; args: unknown; timestamp: number }
  | { type: 'runtime.tool.finished'; executionId: string; toolName: string; result: unknown; timestamp: number }
  | { type: 'runtime.tool.failed'; executionId: string; toolName: string; error: string; timestamp: number }
  | { type: 'runtime.agent.started'; executionId: string; timestamp: number }
  | { type: 'runtime.agent.completed'; executionId: string; timestamp: number }
  | { type: 'runtime.agent.failed'; executionId: string; error: string; timestamp: number }
  | { type: 'runtime.plan.generated'; executionId: string; timestamp: number }
  | { type: 'runtime.dag.created'; executionId: string; timestamp: number }
  | { type: 'runtime.task.started'; executionId: string; timestamp: number }
  | { type: 'runtime.task.completed'; executionId: string; timestamp: number }
  | { type: 'kernel.started'; uptime: number; pluginCount: number; timestamp: number };

// Re-export agent runtime events for convenience
export type { AgentRuntimeEvent };
