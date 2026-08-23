/**
 * YamlManualLoader — 部门手册（声明式工作流 YAML）解析/校验/匹配
 *
 * 职责（通用，不含领域逻辑）：
 *   1. load(path)        → 读取 + yaml.parse + schema 校验 → WorkflowManual
 *   2. validate(manual)  → 结构校验（id 唯一、depends_on/on_failure 引用存在、无环）
 *   3. match(manual, goal) → 按 match.aliases 判定该手册是否接管此目标
 *
 * 设计约束：
 *   - 纯数据层：不执行任何步骤；执行在 YamlWorkflowRuntime
 *   - 领域无关：任意部门的手册均用同一 Schema（yaml+解释器+mcp+部门 四件套之"yaml"）
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

// ── 类型 ──

/** 失败处理策略 */
export type FailurePolicy =
  | { kind: 'backjump'; target: string }
  | { kind: 'retry'; times: number }
  | { kind: 'skip' }
  | { kind: 'abort' };

/** 人审门（ask）——阻塞等待用户回答，禁止 LLM 猜测 */
export interface AskGate {
  /** 触发条件描述（自然语言；运行时交给 step-agent 判断是否满足） */
  when?: string;
  /** 展示给用户的问题模板（支持 {{placeholder}}） */
  prompt: string;
  /** 超时策略：reject = 超时判失败走 on_failure；continue = 按未指定继续 */
  timeout?: 'reject' | 'continue';
  timeoutMs?: number;
}

/** 单步骤定义（8 键） */
export interface ManualStep {
  id: string;
  /** 'llm' = step-agent 执行；其他 = DomainPrimitiveRegistry 注册的原语名（如 <domain>.<action>）*/
  action: string;
  description: string;
  /** ${inputs.x} / ${steps.<id>.outputs.<name>} 表达式映射 */
  inputs?: Record<string, string>;
  depends_on?: string[];
  on_failure?: string; // 'backjump:<id>' | 'retry(n)' | 'skip' | 'abort'
  ask?: AskGate;
  /** 本步产物引用名（供下游 ${steps.<id>.outputs.<name>} 引用） */
  outputs?: string[];
}

/** 手册顶层结构（6 键） */
export interface WorkflowManual {
  name: string;
  version: number;
  description?: string;
  match?: { aliases: string[] };
  inputs?: Record<string, unknown>;
  outputs?: string[];
  steps: ManualStep[];
}

/** 校验错误 */
export interface ManualValidationError {
  step?: string;
  message: string;
}

// ── 解析 ──

/** 从文件加载并校验手册。校验失败抛错（fail loud）。 */
export function loadManual(path: string): WorkflowManual {
  const raw = readFileSync(path, 'utf-8');
  const manual = parse(raw) as WorkflowManual;
  const errors = validateManual(manual);
  if (errors.length > 0) {
    throw new Error(
      `[YamlManualLoader] 手册校验失败 (${path}):\n${errors.map(e => `  - [${e.step ?? 'manual'}] ${e.message}`).join('\n')}`,
    );
  }
  return manual;
}

/** 结构校验：返回全部错误（空数组 = 合法） */
export function validateManual(m: WorkflowManual | null | undefined): ManualValidationError[] {
  const errors: ManualValidationError[] = [];
  if (!m || typeof m !== 'object') {
    return [{ message: '手册为空或非对象' }];
  }
  if (!m.name || typeof m.name !== 'string') errors.push({ message: '缺少 name' });
  if (!Array.isArray(m.steps) || m.steps.length === 0) {
    return [...errors, { message: 'steps 为空——手册必须至少包含一个步骤' }];
  }

  const ids = new Set<string>();
  for (const s of m.steps) {
    if (!s.id) errors.push({ message: `步骤缺少 id: ${JSON.stringify(s).slice(0, 80)}` });
    else if (ids.has(s.id)) errors.push({ step: s.id, message: `步骤 id 重复: ${s.id}` });
    else ids.add(s.id);
    if (!s.action) errors.push({ step: s.id, message: '缺少 action（llm 或原语名）' });
    if (!s.description) errors.push({ step: s.id, message: '缺少 description（step-agent 执行所需上下文）' });
    if (s.ask && !s.ask.prompt) errors.push({ step: s.id, message: 'ask 缺少 prompt' });
  }

  // 引用完整性：depends_on / on_failure 的 backjump 目标必须存在
  for (const s of m.steps) {
    for (const dep of s.depends_on ?? []) {
      if (!ids.has(dep)) errors.push({ step: s.id, message: `depends_on 引用不存在的步骤: ${dep}` });
    }
    const policy = parseFailurePolicy(s.on_failure);
    if (policy.kind === 'invalid') {
      errors.push({ step: s.id, message: `on_failure 非法: "${s.on_failure}"（合法: backjump:<id> / retry(n) / skip / abort）` });
    } else if (policy.kind === 'backjump' && !ids.has(policy.target)) {
      errors.push({ step: s.id, message: `on_failure backjump 目标不存在: ${policy.target}` });
    } else if (policy.kind === 'backjump') {
      // 回跳不允许形成前向环之外的自指/下游跳（只允许回跳到上游或自身）
      const order = topoOrder(m.steps);
      if (order.get(s.id)! <= order.get(policy.target)!) {
        errors.push({ step: s.id, message: `on_failure backjump 目标 "${policy.target}" 必须是本步骤的上游` });
      }
    }
  }

  // 依赖无环检查
  if (hasCycle(m.steps)) {
    errors.push({ message: 'depends_on 存在循环依赖' });
  }
  return errors;
}

/** on_failure 字符串 → 结构化策略 */
export function parseFailurePolicy(
  raw?: string,
): { kind: 'backjump'; target: string } | { kind: 'retry'; times: number } | { kind: 'skip' } | { kind: 'abort' } | { kind: 'invalid' } {
  if (!raw) return { kind: 'abort' }; // 默认：失败即中止（显式优于隐式）
  const t = raw.trim();
  if (t === 'skip') return { kind: 'skip' };
  if (t === 'abort') return { kind: 'abort' };
  const retry = t.match(/^retry\((\d+)\)$/);
  if (retry) return { kind: 'retry', times: Math.max(1, parseInt(retry[1]!, 10)) };
  const bj = t.match(/^backjump:([\w-]+)$/);
  if (bj) return { kind: 'backjump', target: bj[1]! };
  return { kind: 'invalid' };
}

/** 拓扑序（用于 backjump 方向校验）；有环时返回空表 */
function topoOrder(steps: ManualStep[]): Map<string, number> {
  const order = new Map<string, number>();
  const visiting = new Set<string>();
  let counter = 0;
  const visit = (id: string): boolean => {
    if (order.has(id)) return true;
    if (visiting.has(id)) return false; // 环
    visiting.add(id);
    const step = steps.find(s => s.id === id);
    for (const dep of step?.depends_on ?? []) {
      if (!visit(dep)) return false;
    }
    visiting.delete(id);
    order.set(id, counter++);
    return true;
  };
  for (const s of steps) {
    if (!visit(s.id)) return new Map();
  }
  return order;
}

/** 环检测 */
function hasCycle(steps: ManualStep[]): boolean {
  return topoOrder(steps).size === 0 && steps.length > 0;
}

/** 目标路由：goal 含任一别名即命中（大小写不敏感） */
export function matchManual(m: WorkflowManual, goal: string): boolean {
  const g = goal.toLowerCase();
  return (m.match?.aliases ?? []).some(a => g.includes(a.toLowerCase()));
}
