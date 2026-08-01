/**
 * Industry Adapters — 类型定义
 *
 * 行业偏置层：提供意图提示、工作流模板、工具建议。
 * 不做执行逻辑。
 */

// ── 行业 ──

/** 支持的行业 */
export type IndustryType = 'software' | 'video' | 'content' | 'ecommerce' | 'general';

// ── 工作流模板 ──

/** 工作流步骤 */
export interface WorkflowStep {
  name: string;
  description: string;
  /** 所需角色 */
  requiredRole: string;
  /** 预期产物类型 */
  outputType: string;
  /** 依赖的上一步名称 */
  dependencies: string[];
}

/** 工作流模板 */
export interface WorkflowTemplate {
  id: string;
  industry: IndustryType;
  name: string;
  steps: WorkflowStep[];
}

// ── 行业配置 ──

/** 行业适配器定义 */
export interface IndustryAdapter {
  /** 行业标识 */
  type: IndustryType;
  /** 显示名称 */
  label: string;
  /** 意图分类提示词（帮助 IntentResolver 识别） */
  intentHints: string[];
  /** 工作流模板 */
  workflows: WorkflowTemplate[];
  /** 建议工具 */
  suggestedTools: string[];
  /** 领域关键词 */
  keywords: string[];
}

// ── 插件配置 ──

export interface IndustryPluginConfig {
  /** 启用哪些行业 */
  enabledIndustries?: IndustryType[];
}
