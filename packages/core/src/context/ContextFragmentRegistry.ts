/**
 * ContextFragmentRegistry — 上下文片段提供者注册中心
 *
 * v9.1 Context Assembly Layer: 统一管理多源上下文片段提供者。
 *
 * 支持的来源：
 *   - user_profile: 用户画像
 *   - behavior_twin: 行为孪生
 *   - goal_graph: 目标图
 *   - mission_state: 任务状态
 *   - decision_history: 决策历史
 *   - artifact_lineage: 产物血缘
 *   - agent_status: Agent 状态
 *   - custom: 自定义扩展
 */

// ── 片段来源类型 ──

export type FragmentSource =
  | 'user_profile'
  | 'behavior_twin'
  | 'goal_graph'
  | 'mission_state'
  | 'decision_history'
  | 'artifact_lineage'
  | 'agent_status'
  | 'custom'

// ── ContextFragment — 上下文片段 ──

export interface ContextFragment {
  /** 来源类型 */
  source: FragmentSource
  /** 片段数据 */
  data: Record<string, unknown>
  /** 数据版本 */
  version: number
  /** 采集时间戳 */
  collectedAt: number
  /** 存活时间 (ms)，过期后可丢弃 */
  ttl?: number
}

// ── ContextAssemblyInput — 上下文组装输入 ──

export interface ContextAssemblyInput {
  /** 任务 ID */
  missionId: string
  /** 用户 ID（可选） */
  userId?: string
  /** Agent ID（可选） */
  agentId?: string
  /** 父上下文 ID（可选，用于嵌套） */
  parentContextId?: string
  /** 标签（用于模板匹配） */
  tags?: string[]
}

// ── FragmentProvider — 片段提供者接口 ──

export interface FragmentProvider {
  /** 来源类型，注册时作为 key */
  readonly source: FragmentSource
  /** 采集上下文片段 */
  collect(input: ContextAssemblyInput): Promise<ContextFragment>
}

// ── ContextFragmentRegistry — 片段注册中心 ──

export class ContextFragmentRegistry {
  private providers = new Map<FragmentSource, FragmentProvider>()

  /**
   * register — 注册片段提供者
   *
   * 同一 source 只能注册一个提供者，重复注册会覆盖。
   */
  register(provider: FragmentProvider): void {
    this.providers.set(provider.source, provider)
  }

  /**
   * unregister — 注销片段提供者
   *
   * @returns 是否存在并注销
   */
  unregister(source: FragmentSource): boolean {
    return this.providers.delete(source)
  }

  /**
   * getProvider — 获取指定来源的提供者
   */
  getProvider(source: FragmentSource): FragmentProvider | undefined {
    return this.providers.get(source)
  }

  /**
   * listSources — 列出所有已注册的来源类型
   */
  listSources(): FragmentSource[] {
    return [...this.providers.keys()]
  }

  /**
   * collectAll — 收集所有已注册提供者的片段
   *
   * 可选地仅收集指定来源列表的片段。
   * 单个提供者失败不影响其他提供者。
   *
   * @param input - 组装输入
   * @param sources - 指定来源列表（不传则收集全部）
   * @returns 所有成功采集的片段
   */
  async collectAll(
    input: ContextAssemblyInput,
    sources?: FragmentSource[]
  ): Promise<ContextFragment[]> {
    const targets = sources ?? this.listSources()
    const results: ContextFragment[] = []

    for (const source of targets) {
      const provider = this.providers.get(source)
      if (!provider) continue
      try {
        const fragment = await provider.collect(input)
        results.push(fragment)
      } catch (err) {
        console.warn(`[ContextFragmentRegistry] Provider "${source}" 采集失败:`, err)
      }
    }

    return results
  }

  /**
   * count — 已注册提供者数量
   */
  count(): number {
    return this.providers.size
  }

  /**
   * clear — 清空所有提供者
   */
  clear(): void {
    this.providers.clear()
  }
}
