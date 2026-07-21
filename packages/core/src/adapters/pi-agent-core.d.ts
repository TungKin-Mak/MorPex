/**
 * TypeScript declaration augmentations for @earendil-works/pi-agent-core
 *
 * The installed version (0.79.10) exports these members at runtime but
 * their type declaration files don't declare them as named exports.
 * This file bridges the gap so TypeScript compilation succeeds.
 *
 * ═══════════════════════════════════════════════════════════════════
 * WHEN UPGRADING PI-AGENT-CORE: If the new version has proper .d.ts
 * files, delete this file and verify compilation.
 * ═══════════════════════════════════════════════════════════════════
 */

declare module '@earendil-works/pi-agent-core' {
  // ── Runtime classes ──
  // ── AgentHarness event payloads ──
  export interface ToolCallEvent {
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
    [key: string]: unknown;
  }

  export interface ToolResultEvent {
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
    content?: unknown;
    details?: unknown;
    isError?: boolean;
    [key: string]: unknown;
  }

  export class AgentHarness {
    constructor(config: {
      env: any;
      model: any;
      session: any;
      tools?: any[];
      systemPrompt?: string;
      beforeToolCall?: (params: {
        toolCallId: string;
        toolName: string;
        args: Record<string, unknown>;
      }) => Promise<{ block?: boolean; reason?: string } | undefined> | { block?: boolean; reason?: string } | undefined;
      afterToolCall?: (params: {
        toolCallId: string;
        toolName: string;
        result?: unknown;
        isError?: boolean;
      }) => Promise<void> | undefined;
    });
    prompt(input: string): Promise<{
      content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
      [key: string]: unknown;
    }>;
    abort(): Promise<void>;
    on(event: 'tool_call', handler: (event: ToolCallEvent) => Promise<unknown> | unknown): void;
    on(event: 'tool_result', handler: (event: ToolResultEvent) => Promise<unknown> | unknown): void;
    on(event: string, handler: (event: Record<string, unknown>) => Promise<unknown> | unknown): void;
  }

  export class InMemorySessionRepo {
    create(session: {
      id: string;
      systemPrompt?: string;
      [key: string]: unknown;
    }): Promise<Session>;
  }

  export function uuidv7(): string;

  // ── Runtime event type ──
  export interface AgentEvent {
    type: string;
    toolCallId: string;
    toolName: string;
    input?: Record<string, unknown>;
    content?: unknown;
    details?: unknown;
    isError?: boolean;
    [key: string]: unknown;
  }

  // ── Message / tool types ──
  export interface AgentMessage {
    role: string;
    content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
    [key: string]: unknown;
  }

  export interface AgentToolResult {
    content: Array<{ type: string; text?: string; [key: string]: unknown }>;
    details?: Record<string, unknown>;
    isError?: boolean;
    [key: string]: unknown;
  }

  // ── AgentTool definition ──
  export interface AgentTool {
    name: string;
    label?: string;
    description: string;
    parameters: any;
    execute: (
      toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
      onUpdate?: (update: unknown) => void,
    ) => Promise<AgentToolResult>;
  }

  // ── Session type ──
  export interface Session {
    id: string;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
  }

  // ── Environment type ──
  export interface ExecutionEnv {
    cwd: string;
    [key: string]: unknown;
  }
}

declare module '@earendil-works/pi-agent-core/node' {
  export class NodeExecutionEnv {
    constructor(config?: { cwd?: string });
    cwd: string;
  }
}

declare module '@earendil-works/pi-ai' {
  // ── ThinkingLevel ──
  export type ThinkingLevel = string;

  // ── Model / Provider types ──
  // ── Model type (may be used as generic) ──
  export interface Model<T = unknown> {
    id: string;
    name: string;
    provider: string;
    api: string;
    config?: T;
    [key: string]: unknown;
  }

  export interface Api {
    baseUrl: string;
    apiKey?: string;
    [key: string]: unknown;
  }

  export type KnownProvider = string;

  // ── AssistantMessage type (for completeSimple return) ──
  export interface AssistantMessage {
    content: Array<{ type: string; text?: string; [key: string]: unknown }>;
    [key: string]: unknown;
  }

  // ── AssistantMessageEventStream type (for streamSimple return) ──
  export interface AssistantMessageEventStream {
    [Symbol.asyncIterator](): AsyncIterator<{ type: string; delta?: string; [key: string]: unknown }>;
    result(): Promise<AssistantMessage>;
  }

  // ── Type system (JSON Schema-like) ──
  export const Type: {
    Object: (props: Record<string, unknown>) => Record<string, unknown>;
    String: (opts?: Record<string, unknown>) => Record<string, unknown>;
    Number: (opts?: Record<string, unknown>) => Record<string, unknown>;
    Boolean: (opts?: Record<string, unknown>) => Record<string, unknown>;
    Array: (itemType: Record<string, unknown>) => Record<string, unknown>;
    [key: string]: unknown;
  };

  export type Static<T> = T;
  export type TSchema = Record<string, unknown>;

  export function getModels(provider?: string): Model[];
  export function getProviders(): string[];
  export function getModel(provider: string, modelId: string): Model;
  export function parseJsonWithRepair<T = unknown>(json: string): T;
  export function clampThinkingLevel(level: string): string;
  export function getSupportedThinkingLevels(): string[];

  // ── Simple API functions (from compat) ──
  export function completeSimple<TApi extends Api>(
    model: Model<TApi>,
    context: { systemPrompt?: string; messages: Array<{ role: string; content: string; timestamp: number }> },
    options?: { maxTokens?: number; temperature?: number },
  ): Promise<AssistantMessage>;

  export function streamSimple<TApi extends Api>(
    model: Model<TApi>,
    context: { systemPrompt?: string; messages: Array<{ role: string; content: string; timestamp: number }> },
    options?: { maxTokens?: number; temperature?: number },
  ): AssistantMessageEventStream;
}
