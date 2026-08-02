/**
 * MorPex Core — 通用原语类型定义
 *
 * 定义 ActionPrimitive 接口和 ActionResult 类型，
 * 所有通用原语和工作流插件中的领域原语统一实现此接口。
 *
 * 设计原则：
 * - 通用原语：不包含任何领域知识，由 plugins/workflows/ 插件提供领域逻辑
 * - 知识优先：任何生成/创建操作前必须先查询 MemoryWiki/KnowledgeGraph
 * - 部门隔离：所有 execute() 调用必须携带 departmentId
 */

import type { KnowledgeContextPackage } from '../../../gate/context.js';

// ── ActionPrimitive ──

export interface ActionPrimitive {
  /** 原语唯一标识 */
  name: string;
  /** 原语描述 */
  description: string;
  /** 输入参数 Schema（JSON Schema 格式） */
  inputSchema: Record<string, unknown>;
  /** 判断是否能处理该任务，返回匹配度 0-1 */
  canHandle(task: string): number;
  /** 执行原语操作 */
  execute(
    params: Record<string, unknown>,
    context?: { departmentId?: string; userId?: string; gateContext?: KnowledgeContextPackage }
  ): Promise<ActionResult>;
}

// ── ActionResult ──

export interface ActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  /** 是否需要人工审批（高价值/破坏性操作） */
  requiresApproval?: boolean;
}

// ── 知识查询专用类型 ──

export interface KnowledgeQuery {
  /** 查询文本 */
  query: string;
  /** 限定查询范围（如 memory_wiki, knowledge_graph, artifact_registry） */
  sources?: Array<'memory_wiki' | 'knowledge_graph' | 'artifact_registry' | 'personal_brain'>;
  /** 部门 ID（必填，用于隔离） */
  departmentId: string;
  /** 最大返回条数 */
  maxResults?: number;
  /** 最低置信度阈值 (0-1) */
  minConfidence?: number;
}

export interface KnowledgeQueryResult {
  found: boolean;
  items: Array<{
    source: string;
    content: string;
    metadata?: Record<string, unknown>;
    confidence: number;
  }>;
  /** 如果知识不足，给出应该搜索/验证的方向 */
  suggestedActions?: string[];
  /** vNext+: QueryMiss 信号（无结果时非空，驱动 Feedback/Evolution） */
  queryMiss?: {
    tier: 'tier-0' | 'tier-1' | 'tier-2';
    reason: 'no_results' | 'reference_validation_failed' | 'parse_failed';
    controlledExploration: boolean;
  };
}

// ── 文件操作类型 ──

export interface FileOperationRequest {
  operation: 'read' | 'write' | 'delete' | 'list' | 'exists' | 'mkdir' | 'copy' | 'move' | 'stat';
  path: string;
  content?: string;
  destination?: string;
  departmentId: string;
}

// ── 产物生成类型 ──

export interface ArtifactGenerationRequest {
  /** 产物类型：code | doc | config | data | report */
  type: 'code' | 'doc' | 'config' | 'data' | 'report';
  /** 产物描述/规格 */
  specification: string;
  /** 参考知识（来自知识查询的结果） */
  knowledgeContext?: string[];
  /** 部门 ID */
  departmentId: string;
  /** 输出路径 */
  outputPath?: string;
}

export interface ArtifactGenerationResult {
  success: boolean;
  files: Array<{
    path: string;
    content: string;
    type: string;
  }>;
  warnings?: string[];
  knowledgeGaps?: string[];
}

// ── API 调用类型 ──

export interface APICallRequest {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  departmentId: string;
}

// ── Shell 执行类型 ──

export interface ShellExecutionRequest {
  command: string;
  args?: string[];
  cwd?: string;
  timeout?: number;
  departmentId: string;
  /** 命令允许列表检查（安全） */
  allowedCommands?: string[];
}
