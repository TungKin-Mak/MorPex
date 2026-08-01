/**
 * Prompt Types — 提示词系统类型定义
 *
 * 三级分封架构（Leader → Expert → Fork）的提示词模板类型。
 * 用于驱动 LLM 理解并严格执行 MorPex 系统的特权级约束。
 *
 * 遵循迁移铁律：
 *   0.2 (类型来源法则): 类型基于 pi-agent-core 扩展
 */

// ═══════════════════════════════════════════════════════════════
// AstroM 3D 追踪结构
// ═══════════════════════════════════════════════════════════════

/**
 * AstroMTrace — 前端 3D 全息大脑粒子流追踪结构体
 *
 * 用于驱动 AstroM 3D 全息大脑实时精准渲染电信号粒子流。
 * 每个跨域消息、工具调用或状态变更都必须附带此结构体。
 */
export interface AstroMTrace {
  /** 追踪唯一 ID */
  traceId: string;
  /** 源领域/组件 */
  sourceZone: string;
  /** 目标领域/组件 */
  targetZone: string;
  /** 内容类型，决定前端渲染方式 */
  contentType: 'json_dag' | 'code_diff' | 'artifact_summary' | 'negotiation' | 'error' | 'tool_call';
  /** 时间戳 */
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// 提示词模板
// ═══════════════════════════════════════════════════════════════

/**
 * PromptTemplate — 提示词模板定义
 *
 * 每个角色（Leader/Expert/Fork）有独立的提示词模板，
 * 包含角色定义、行为准则、安全红线。
 */
export interface PromptTemplate {
  /** 模板唯一 ID */
  id: string;
  /** 角色类型 */
  role: 'leader' | 'expert' | 'fork';
  /** 特权环级别 */
  ring: 0 | 1 | 2;
  /** 版本号 (semver) */
  version: string;
  /** 模板内容（含 {placeholder} 占位符） */
  template: string;
  /** 模板中的占位符列表 */
  placeholders: string[];
}

/**
 * PromptCompileOptions — 提示词编译选项
 *
 * 将模板中的占位符替换为实际值。
 */
export interface PromptCompileOptions {
  /** 可用领域列表文本（Leader 专用） */
  availableDomains?: string;
  /** 领域名称（Expert 专用） */
  domainName?: string;
  /** 领域 ID（Expert 专用） */
  domainId?: string;
  /** 任务目标（Expert 专用） */
  goal?: string;
  /** 产物 URI 摘要（Expert 专用） */
  vfsMountUri?: string;
  /** 专家名称 */
  expertName?: string;
  /** 时间戳 */
  timestamp?: number;
}

// ═══════════════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════════════

/**
 * createAstroMTrace — 构建 AstroM 3D 追踪结构体
 *
 * @param sourceZone - 源领域/组件
 * @param targetZone - 目标领域/组件
 * @param contentType - 内容类型
 * @returns AstroMTrace 对象
 */
export function createAstroMTrace(
  sourceZone: string,
  targetZone: string,
  contentType: AstroMTrace['contentType'],
): AstroMTrace {
  return {
    traceId: `trace_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
    sourceZone,
    targetZone,
    contentType,
    timestamp: Date.now(),
  };
}
