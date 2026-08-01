/**
 * CapabilityGraph — v9 能力关系图
 *
 * 管理能力的继承/层次关系。
 * 支持: 父能力查找、子能力查找、能力覆盖分析。
 *
 * 拓扑:
 *   coding → { debug, review, refactor }
 *   planning → { task_decomposition, strategy_generation }
 *   execution → { sandbox_exec, tool_call, artifact_gen }
 */

import type { Capability, CapabilityMatchResult } from './Capability.js'

export class CapabilityGraph {
  private capabilities: Map<string, Capability> = new Map()
  private children: Map<string, Set<string>> = new Map()

  /**
   * register — 注册能力到图中
   */
  register(cap: Capability): void {
    this.capabilities.set(cap.name, cap)
    for (const parent of cap.parentCapabilities) {
      if (!this.children.has(parent)) {
        this.children.set(parent, new Set())
      }
      this.children.get(parent)!.add(cap.name)
    }
  }

  /**
   * getCapability — 获取能力定义
   */
  getCapability(name: string): Capability | undefined {
    return this.capabilities.get(name)
  }

  /**
   * getChildren — 获取父能力的子能力列表
   */
  getChildren(parentName: string): Capability[] {
    const childNames = this.children.get(parentName)
    if (!childNames) return []
    return [...childNames]
      .map(name => this.capabilities.get(name))
      .filter((c): c is Capability => c !== undefined)
  }

  /**
   * getParents — 获取能力的父能力列表
   */
  getParents(childName: string): Capability[] {
    const cap = this.capabilities.get(childName)
    if (!cap) return []
    return cap.parentCapabilities
      .map(name => this.capabilities.get(name))
      .filter((c): c is Capability => c !== undefined)
  }

  /**
   * matchesCapability — 检查 Agent 能力是否匹配需求
   *
   * 匹配规则:
   *   1. 直接匹配: Agent 拥有该能力
   *   2. 父匹配: Agent 拥有该能力的父能力
   *      (例如: Agent 有 coding, 可以处理 debug)
   */
  matchesCapability(agentCapabilities: string[], requiredCapability: string): boolean {
    // 直接匹配
    if (agentCapabilities.includes(requiredCapability)) return true

    // 父匹配: 检查 Agent 是否拥有所需能力的父能力
    const required = this.capabilities.get(requiredCapability)
    if (required) {
      for (const parent of required.parentCapabilities) {
        if (agentCapabilities.includes(parent)) return true
      }
    }

    return false
  }

  /**
   * findCoverage — 分析 Agent 集合对需求的能力覆盖
   *
   * @param agentCapabilities - Agent ID → Agent 能力列表
   * @param requiredCapabilities - 需求的能力列表
   * @returns 覆盖分析结果
   */
  findCoverage(
    agentCapabilities: Map<string, string[]>,
    requiredCapabilities: string[],
  ): { covered: string[]; uncovered: string[]; coverageRatio: number } {
    const covered: string[] = []
    const uncovered: string[] = []

    for (const req of requiredCapabilities) {
      const isCovered = [...agentCapabilities.values()].some(
        caps => this.matchesCapability(caps, req)
      )
      if (isCovered) {
        covered.push(req)
      } else {
        uncovered.push(req)
      }
    }

    return {
      covered,
      uncovered,
      coverageRatio: requiredCapabilities.length > 0
        ? covered.length / requiredCapabilities.length
        : 0,
    }
  }

  /**
   * getHierarchy — 获取能力层级拓扑
   */
  getHierarchy(): Record<string, string[]> {
    const hierarchy: Record<string, string[]> = {}
    for (const [parent, childSet] of this.children) {
      hierarchy[parent] = [...childSet]
    }
    // 添加上级能力（没有父能力的能力）
    for (const [name] of this.capabilities) {
      if (!hierarchy[name]) {
        const cap = this.capabilities.get(name)!
        if (cap.parentCapabilities.length === 0) {
          hierarchy[name] = this.getChildren(name).map(c => c.name)
        }
      }
    }
    return hierarchy
  }
}
