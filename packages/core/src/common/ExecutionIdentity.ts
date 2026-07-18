/**
 * ExecutionIdentity — 全链路 ID 系统
 *
 * ID 格式：{prefix}_{YYYYMMDD}_{shortUUID}
 *
 * | 类型      | prefix | 示例                        |
 * |-----------|--------|-----------------------------|
 * | executionId | exe  | exe_20260707_a81f92cd       |
 * | traceId   | trc    | trc_20260707_b72e83df       |
 * | sessionId | ses    | ses_20260707_c63f94e1       |
 * | eventId   | evt    | evt_20260707_d54fa5b2       |
 * | artifactId| art    | art_20260707_e43fb6c3       |
 *
 * 设计要点：
 *   - 分布式安全：shortUUID 降低碰撞概率
 *   - 可排序：YYYYMMDD 前缀天然按时间排序
 *   - 可调试：前缀标识 ID 类型
 */

import { generateShortUUID } from '../adapters/identity.js';
import type { ExecutionIdentity as ExecutionIdentityType } from './types.js';

/** ID 前缀常量 */
export const ID_PREFIXES = {
  execution: 'exe',
  trace: 'trc',
  session: 'ses',
  event: 'evt',
  artifact: 'art',
} as const;

/** 解析后的 ID 结构 */
export interface ParsedId {
  type: string;
  date: string;
  random: string;
}

/**
 * 生成 shortUUID（取 uuidv7 最后 8 位）
 * 委托给 IdentityAdapter 中的 generateShortUUID，
 * 该函数封装了 pi-agent-core 的 uuidv7 调用。
 *   - 时间有序 → 天然按生成时间排序
 *   - 分布式安全 → 128 位随机性 + 时间戳前缀
 *   - 兼容现有格式 → {prefix}_{YYYYMMDD}_{8hex}
 */
function shortUUID(): string {
  return generateShortUUID();
}

/**
 * 获取当前日期 YYYYMMDD 格式
 */
function todayDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * ExecutionIdentity — ID 生成器与链式追踪
 *
 * 职责：
 *   - 生成各种类型 ID
 *   - 创建完整 Identity 对象
 *   - 维护父子执行链（用于 DAG 递归追踪）
 */
export class ExecutionIdentity {
  private chainMap: Map<string, string[]> = new Map(); // childId → [parentId, ...root]

  /**
   * 生成指定前缀的 ID
   * 格式：{prefix}_{YYYYMMDD}_{shortUUID}
   */
  static generate(prefix: string): string {
    return `${prefix}_${todayDate()}_${shortUUID()}`;
  }

  /** 创建 executionId */
  createExecutionId(): string {
    return ExecutionIdentity.generate(ID_PREFIXES.execution);
  }

  /** 创建 traceId */
  createTraceId(): string {
    return ExecutionIdentity.generate(ID_PREFIXES.trace);
  }

  /** 创建 sessionId */
  createSessionId(): string {
    return ExecutionIdentity.generate(ID_PREFIXES.session);
  }

  /** 创建 eventId */
  createEventId(): string {
    return ExecutionIdentity.generate(ID_PREFIXES.event);
  }

  /** 创建 artifactId */
  createArtifactId(): string {
    return ExecutionIdentity.generate(ID_PREFIXES.artifact);
  }

  /**
   * 创建完整的 ExecutionIdentity 对象
   *
   * @param options.sessionId - 可指定 sessionId（默认新建）
   * @param options.parentExecutionId - 父执行 ID（用于 DAG 嵌套）
   */
  create(options?: { sessionId?: string; parentExecutionId?: string }): ExecutionIdentityType {
    const executionId = this.createExecutionId();
    const traceId = this.createTraceId();
    const sessionId = options?.sessionId ?? this.createSessionId();

    // 记录父子关系
    if (options?.parentExecutionId) {
      this.link(options.parentExecutionId, executionId);
    }

    return {
      executionId,
      traceId,
      sessionId,
      parentExecutionId: options?.parentExecutionId,
      createdAt: Date.now(),
    };
  }

  /**
   * 链式关联：记录 parent → child 关系
   */
  link(parentId: string, childId: string): void {
    const parentChain = this.chainMap.get(parentId);
    if (parentChain) {
      // child 继承 parent 的全路径 + parent
      this.chainMap.set(childId, [...parentChain, parentId]);
    } else {
      // parent 是根节点
      this.chainMap.set(childId, [parentId]);
    }
  }

  /**
   * 回溯：给定任意 childId，返回从根到叶的全路径
   * 返回顺序：[root, ..., parent, child]
   */
  getChain(childId: string): string[] {
    const chain = this.chainMap.get(childId);
    if (!chain) {
      return [childId]; // 孤节点，自己就是根
    }
    return [...chain, childId];
  }

  /**
   * 解析 ID：exe_20260707_a81f92cd → { type, date, random }
   */
  parse(id: string): ParsedId | null {
    const match = id.match(/^([a-z]+)_(\d{8})_([a-f0-9]+)$/);
    if (!match) return null;
    return {
      type: match[1],
      date: match[2],
      random: match[3],
    };
  }

  /**
   * 验证 ID 格式是否合法
   */
  isValid(id: string): boolean {
    return this.parse(id) !== null;
  }

  /**
   * 获取 ID 类型（前缀部分）
   */
  getType(id: string): string | null {
    const parsed = this.parse(id);
    return parsed?.type ?? null;
  }

  /**
   * 获取 ID 的日期部分
   */
  getDate(id: string): string | null {
    const parsed = this.parse(id);
    return parsed?.date ?? null;
  }

  /**
   * 清空链式关系
   */
  clearChains(): void {
    this.chainMap.clear();
  }
}
