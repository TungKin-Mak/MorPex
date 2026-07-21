/**
 * PersonalTwinGraph — 个人孪生图谱
 *
 * Phase 5 / MorPex v8: 围绕用户长期目标和个性化模式的认知图谱。
 *
 * 职责：
 *   1. 存储用户的知识图谱（目标、项目、偏好、决策、协作关系等）
 *   2. 支持结构化查询（按类型、关系、置信度）
 *   3. 支持学习（从用户交互中提取偏好和模式）
 *   4. 支持序列化（持久化和恢复）
 *
 * 与 KnowledgeGraph（通用知识图谱）的关系：
 *   - PersonalTwinGraph 专注于用户个性化维度（认知层）
 *   - KnowledgeGraph 专注于通用领域知识（知识层）
 *   - PersonalTwinGraph 查询结果可为 Planner 提供决策依据
 *
 * 节点类型及关系模式：
 *   user ──── belongs_to ────→ goal
 *   user ──── likes ─────────→ preference
 *   user ──── works_with ────→ person
 *   user ──── experienced ───→ experience
 *   goal ──── depends_on ────→ goal
 *   decision ── decides_by ──→ factor
 *   workflow ── depends_on ──→ workflow
 */

import type {
  TwinNode,
  TwinEdge,
  TwinNodeType,
  TwinEdgeType,
  TwinQuery,
  TwinStats,
  DecisionProfile,
  SubgraphResult,
  TwinInsight,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// ID 生成器
// ═══════════════════════════════════════════════════════════════

let nodeCounter = 0;
let edgeCounter = 0;

function generateNodeId(): string {
  nodeCounter++;
  return `twn_${Date.now()}_${nodeCounter}`;
}

function generateEdgeId(): string {
  edgeCounter++;
  return `twe_${Date.now()}_${edgeCounter}`;
}

// ═══════════════════════════════════════════════════════════════
// PersonalTwinGraph
// ═══════════════════════════════════════════════════════════════

export class PersonalTwinGraph {
  /** 节点存储：id → TwinNode */
  private nodes: Map<string, TwinNode> = new Map();

  /** 边存储：id → TwinEdge */
  private edges: Map<string, TwinEdge> = new Map();

  /** 出边索引：sourceId → Set<edgeId> */
  private adjOut: Map<string, Set<string>> = new Map();

  /** 入边索引：targetId → Set<edgeId> */
  private adjIn: Map<string, Set<string>> = new Map();

  /** 用户 ID（默认 'default'） */
  private userId: string;

  /**
   * @param userId - 用户标识（默认 'default'）
   */
  constructor(userId: string = 'default') {
    this.userId = userId;
  }

  /**
   * 获取用户 ID
   */
  getUserId(): string {
    return this.userId;
  }

  // ═══════════════════════════════════════════════════════════
  // 节点 CRUD
  // ═══════════════════════════════════════════════════════════

  /**
   * addNode — 添加节点
   *
   * 如果节点已存在（相同 id），则合并属性并更新。
   *
   * @param node - 节点数据（id 可选，未提供时自动生成）
   * @returns 添加的节点（包含自动生成的 id）
   */
  addNode(node: Partial<TwinNode> & { type: TwinNodeType; label: string }): TwinNode {
    const id = node.id || generateNodeId();
    const now = Date.now();

    const existing = this.nodes.get(id);
    if (existing) {
      // 合并更新
      const updated: TwinNode = {
        ...existing,
        ...node,
        id,
        properties: { ...existing.properties, ...(node.properties || {}) },
        updatedAt: now,
      };
      this.nodes.set(id, updated);
      return updated;
    }

    const newNode: TwinNode = {
      id,
      type: node.type,
      label: node.label,
      description: node.description,
      properties: node.properties || {},
      confidence: node.confidence ?? 1.0,
      source: node.source || 'explicit',
      createdAt: now,
      updatedAt: now,
      metadata: node.metadata,
    };

    this.nodes.set(id, newNode);
    return newNode;
  }

  /**
   * getNode — 获取节点
   */
  getNode(id: string): TwinNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * updateNode — 更新节点
   *
   * @param id - 节点 ID
   * @param updates - 需要更新的字段
   * @returns 更新后的节点，如果不存在则返回 undefined
   */
  updateNode(id: string, updates: Partial<TwinNode>): TwinNode | undefined {
    const node = this.nodes.get(id);
    if (!node) return undefined;

    const updated: TwinNode = {
      ...node,
      ...updates,
      id,
      properties: updates.properties
        ? { ...node.properties, ...updates.properties }
        : node.properties,
      updatedAt: Date.now(),
    };

    this.nodes.set(id, updated);
    return updated;
  }

  /**
   * removeNode — 删除节点及关联边
   *
   * @param id - 节点 ID
   * @returns true 如果节点存在并被删除
   */
  removeNode(id: string): boolean {
    if (!this.nodes.has(id)) return false;

    // 删除所有关联边
    const outEdges = this.adjOut.get(id);
    if (outEdges) {
      for (const edgeId of outEdges) {
        this.edges.delete(edgeId);
      }
      this.adjOut.delete(id);
    }

    const inEdges = this.adjIn.get(id);
    if (inEdges) {
      for (const edgeId of inEdges) {
        this.edges.delete(edgeId);
      }
      this.adjIn.delete(id);
    }

    this.nodes.delete(id);
    return true;
  }

  /**
   * getNodesByType — 按类型获取节点
   */
  getNodesByType(type: TwinNodeType): TwinNode[] {
    const result: TwinNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.type === type) {
        result.push(node);
      }
    }
    return result;
  }

  /**
   * searchNodes — 搜索节点（按标签/描述文本）
   *
   * @param query - 搜索文本（大小写不敏感）
   * @param type - 可选，按类型过滤
   * @returns 匹配的节点列表
   */
  searchNodes(query: string, type?: TwinNodeType): TwinNode[] {
    const lower = query.toLowerCase();
    const result: TwinNode[] = [];

    for (const node of this.nodes.values()) {
      if (type && node.type !== type) continue;
      if (
        node.label.toLowerCase().includes(lower) ||
        (node.description && node.description.toLowerCase().includes(lower))
      ) {
        result.push(node);
      }
    }

    return result;
  }

  // ═══════════════════════════════════════════════════════════
  // 边 CRUD
  // ═══════════════════════════════════════════════════════════

  /**
   * addEdge — 添加边
   *
   * 自动维护邻接表索引。
   *
   * @param edge - 边数据（id 可选）
   * @returns 添加的边
   * @throws 如果 sourceId 或 targetId 节点不存在
   */
  addEdge(edge: Partial<TwinEdge> & {
    type: TwinEdgeType;
    sourceId: string;
    targetId: string;
  }): TwinEdge {
    const id = edge.id || generateEdgeId();
    const now = Date.now();

    // 验证节点存在
    if (!this.nodes.has(edge.sourceId)) {
      throw new Error(`[PersonalTwinGraph] 源节点不存在: ${edge.sourceId}`);
    }
    if (!this.nodes.has(edge.targetId)) {
      throw new Error(`[PersonalTwinGraph] 目标节点不存在: ${edge.targetId}`);
    }

    const newEdge: TwinEdge = {
      id,
      type: edge.type,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      weight: edge.weight ?? 0.5,
      confidence: edge.confidence ?? 1.0,
      evidence: edge.evidence || [],
      createdAt: now,
      metadata: edge.metadata,
    };

    this.edges.set(id, newEdge);

    // 更新邻接表
    if (!this.adjOut.has(edge.sourceId)) {
      this.adjOut.set(edge.sourceId, new Set());
    }
    this.adjOut.get(edge.sourceId)!.add(id);

    if (!this.adjIn.has(edge.targetId)) {
      this.adjIn.set(edge.targetId, new Set());
    }
    this.adjIn.get(edge.targetId)!.add(id);

    return newEdge;
  }

  /**
   * getEdge — 获取边
   */
  getEdge(id: string): TwinEdge | undefined {
    return this.edges.get(id);
  }

  /**
   * getEdgesBetween — 获取两节点间的边
   *
   * @param sourceId - 源节点 ID
   * @param targetId - 目标节点 ID
   * @returns 边列表
   */
  getEdgesBetween(sourceId: string, targetId: string): TwinEdge[] {
    const result: TwinEdge[] = [];
    const outEdges = this.adjOut.get(sourceId);
    if (!outEdges) return result;

    for (const edgeId of outEdges) {
      const edge = this.edges.get(edgeId);
      if (edge && edge.targetId === targetId) {
        result.push(edge);
      }
    }

    return result;
  }

  /**
   * removeEdge — 删除边
   *
   * @param id - 边 ID
   * @returns true 如果边存在并被删除
   */
  removeEdge(id: string): boolean {
    const edge = this.edges.get(id);
    if (!edge) return false;

    this.edges.delete(id);

    // 更新邻接表
    this.adjOut.get(edge.sourceId)?.delete(id);
    this.adjIn.get(edge.targetId)?.delete(id);

    return true;
  }

  /**
   * getEdgesByType — 按类型获取边
   */
  getEdgesByType(type: TwinEdgeType): TwinEdge[] {
    const result: TwinEdge[] = [];
    for (const edge of this.edges.values()) {
      if (edge.type === type) {
        result.push(edge);
      }
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════
  // 高级查询 API
  // ═══════════════════════════════════════════════════════════

  /**
   * getPreferences — 获取用户偏好
   *
   * @param category - 可选，按类别过滤
   * @returns 偏好节点列表
   */
  getPreferences(category?: string): TwinNode[] {
    const prefs = this.getNodesByType('preference');
    if (!category) return prefs;

    return prefs.filter(p => {
      const cat = p.properties['category'];
      return cat === category;
    });
  }

  /**
   * getGoals — 获取用户目标
   *
   * @param status - 可选，按状态过滤
   * @returns 目标节点列表（按优先级排序）
   */
  getGoals(status?: 'active' | 'completed' | 'abandoned'): TwinNode[] {
    const goals = this.getNodesByType('goal');
    const filtered = status
      ? goals.filter(g => g.properties['status'] === status)
      : goals;

    // 按优先级排序：critical > high > medium > low
    const priorityOrder: Record<string, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };

    return filtered.sort((a, b) => {
      const pa = priorityOrder[a.properties['priority'] as string] ?? 99;
      const pb = priorityOrder[b.properties['priority'] as string] ?? 99;
      return pa - pb;
    });
  }

  /**
   * getCollaborators — 获取协作者
   *
   * @returns 协作者及协作强度列表
   */
  getCollaborators(): Array<{ person: TwinNode; strength: number }> {
    const people = this.getNodesByType('person');
    const result: Array<{ person: TwinNode; strength: number }> = [];

    for (const person of people) {
      // 查找 user → person 的 works_with 边
      const edges = this.getEdgesBetween(this.userId, person.id);
      const worksEdge = edges.find(e => e.type === 'works_with');
      const strength = worksEdge ? worksEdge.weight : 0.5;
      result.push({ person, strength });
    }

    return result.sort((a, b) => b.strength - a.strength);
  }

  /**
   * getDecisionProfile — 获取决策画像
   *
   * 分析用户的决策模式，返回：
   *   - 风险偏好
   *   - 常用决策因素
   *   - 近期决策
   *
   * @returns 决策画像
   */
  getDecisionProfile(): DecisionProfile {
    const decisions = this.getNodesByType('decision');

    // 分析风险偏好
    const riskCounts: Record<string, number> = {};
    for (const d of decisions) {
      const factors = d.properties['factors'] as Record<string, number> | undefined;
      if (factors) {
        for (const factor of Object.keys(factors)) {
          riskCounts[factor] = (riskCounts[factor] || 0) + 1;
        }
      }
    }

    // 排序找出最常见因素
    const sortedFactors = Object.entries(riskCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([factor]) => factor);

    // 按时间排序取最近 5 条
    const recent = [...decisions]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5);

    return {
      riskTolerance: 'medium', // 默认，后续从决策模式中学习
      commonFactors: sortedFactors.length > 0 ? sortedFactors : [],
      recentDecisions: recent,
      decisionCount: decisions.length,
    };
  }

  /**
   * getWorkflows — 获取工作流
   */
  getWorkflows(): TwinNode[] {
    return this.getNodesByType('workflow');
  }

  /**
   * getRelated — 获取关联节点（图遍历）
   *
   * 从指定节点出发，沿边遍历指定深度。
   *
   * @param nodeId - 起始节点 ID
   * @param edgeType - 可选，按边类型过滤
   * @param maxDepth - 最大遍历深度（默认 1）
   * @returns 关联节点列表（去重）
   */
  getRelated(nodeId: string, edgeType?: TwinEdgeType, maxDepth: number = 1): TwinNode[] {
    const visited = new Set<string>([nodeId]);
    const result: TwinNode[] = [];
    const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;

      // 遍历出边
      const outEdges = this.adjOut.get(id);
      if (outEdges) {
        for (const edgeId of outEdges) {
          const edge = this.edges.get(edgeId);
          if (!edge || (edgeType && edge.type !== edgeType)) continue;
          if (!visited.has(edge.targetId)) {
            visited.add(edge.targetId);
            const targetNode = this.nodes.get(edge.targetId);
            if (targetNode) {
              result.push(targetNode);
              queue.push({ id: edge.targetId, depth: depth + 1 });
            }
          }
        }
      }

      // 遍历入边
      const inEdges = this.adjIn.get(id);
      if (inEdges) {
        for (const edgeId of inEdges) {
          const edge = this.edges.get(edgeId);
          if (!edge || (edgeType && edge.type !== edgeType)) continue;
          if (!visited.has(edge.sourceId)) {
            visited.add(edge.sourceId);
            const sourceNode = this.nodes.get(edge.sourceId);
            if (sourceNode) {
              result.push(sourceNode);
              queue.push({ id: edge.sourceId, depth: depth + 1 });
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * getSubgraph — 获取子图
   *
   * @param nodeId - 中心节点 ID
   * @param depth - 遍历深度
   * @returns 子图（节点 + 边）
   */
  getSubgraph(nodeId: string, depth: number = 1): SubgraphResult {
    const nodeIds = new Set<string>([nodeId]);
    const resultNodes: TwinNode[] = [];
    const resultEdges: TwinEdge[] = [];
    const queue: Array<{ id: string; d: number }> = [{ id: nodeId, d: 0 }];

    while (queue.length > 0) {
      const { id, d } = queue.shift()!;
      const node = this.nodes.get(id);
      if (node) {
        resultNodes.push(node);
      }
      if (d >= depth) continue;

      const outEdges = this.adjOut.get(id);
      if (outEdges) {
        for (const edgeId of outEdges) {
          const edge = this.edges.get(edgeId);
          if (!edge) continue;
          resultEdges.push(edge);
          if (!nodeIds.has(edge.targetId)) {
            nodeIds.add(edge.targetId);
            queue.push({ id: edge.targetId, d: d + 1 });
          }
        }
      }

      const inEdges = this.adjIn.get(id);
      if (inEdges) {
        for (const edgeId of inEdges) {
          const edge = this.edges.get(edgeId);
          if (!edge) continue;
          resultEdges.push(edge);
          if (!nodeIds.has(edge.sourceId)) {
            nodeIds.add(edge.sourceId);
            queue.push({ id: edge.sourceId, d: d + 1 });
          }
        }
      }
    }

    return { nodes: resultNodes, edges: resultEdges };
  }

  /**
   * query — 通用查询
   *
   * @param q - 查询参数
   * @returns 匹配的节点列表
   */
  query(q: TwinQuery): TwinNode[] {
    let result = [...this.nodes.values()];

    if (q.nodeType) {
      result = result.filter(n => n.type === q.nodeType);
    }

    if (q.label) {
      const lower = q.label.toLowerCase();
      result = result.filter(n => n.label.toLowerCase().includes(lower));
    }

    if (q.confidence?.min !== undefined) {
      result = result.filter(n => n.confidence >= q.confidence!.min!);
    }
    if (q.confidence?.max !== undefined) {
      result = result.filter(n => n.confidence <= q.confidence!.max!);
    }

    if (q.since) {
      result = result.filter(n => n.createdAt >= q.since!);
    }
    if (q.until) {
      result = result.filter(n => n.createdAt <= q.until!);
    }

    // 如果有边类型过滤
    if (q.edgeType) {
      const edgeNodeIds = new Set<string>();
      for (const edge of this.edges.values()) {
        if (edge.type === q.edgeType) {
          edgeNodeIds.add(edge.sourceId);
          edgeNodeIds.add(edge.targetId);
        }
      }
      result = result.filter(n => edgeNodeIds.has(n.id));
    }

    if (q.tags && q.tags.length > 0) {
      result = result.filter(n => {
        const tags = n.metadata?.tags as string[] | undefined;
        return tags && q.tags!.some(t => tags.includes(t));
      });
    }

    if (q.limit && result.length > q.limit) {
      result = result.slice(0, q.limit);
    }

    return result;
  }

  // ═══════════════════════════════════════════════════════════
  // 学习 API
  // ═══════════════════════════════════════════════════════════

  /**
   * learnPreference — 从观察中学习用户偏好
   *
   * 如果同类偏好已存在，更新置信度和强度。
   *
   * @param category - 偏好类别（如 'technology', 'communication'）
   * @param key - 偏好键（如 'typescript', 'async_communication'）
   * @param value - 偏好值（如 'strong_like', 'prefers_email'）
   * @param confidence - 置信度 0-1
   * @returns 偏好节点
   */
  async learnPreference(
    category: string,
    key: string,
    value: string,
    confidence: number = 0.5
  ): Promise<TwinNode> {
    // 检查是否已有同类别同键的偏好
    const existing = this.getNodesByType('preference');
    const match = existing.find(n =>
      n.properties['category'] === category &&
      n.properties['key'] === key
    );

    if (match) {
      // 更新现有偏好
      const newStrength = this.calculateNewStrength(
        match.properties['strength'] as string,
        confidence
      );
      return this.updateNode(match.id, {
        properties: {
          ...match.properties,
          value,
          strength: newStrength,
        },
        confidence: Math.min(1.0, match.confidence + confidence * 0.1),
        source: 'extracted',
      })!;
    }

    // 创建新偏好
    return this.addNode({
      type: 'preference',
      label: `${category}: ${key}`,
      description: `${category} 偏好 — ${key} = ${value}`,
      properties: {
        category,
        key,
        value,
        strength: confidence > 0.7 ? 'strong' : confidence > 0.4 ? 'moderate' : 'weak',
      },
      confidence,
      source: 'extracted',
    });
  }

  /**
   * learnDecision — 学习用户决策模式
   *
   * 记录用户在某个上下文中的决策过程和因素权重。
   *
   * @param context - 决策上下文描述
   * @param options - 可选方案列表
   * @param chosen - 选择方案
   * @param reasoning - 选择原因
   * @param factors - 决策因素及其权重
   * @returns 决策节点
   */
  async learnDecision(
    context: string,
    options: string[],
    chosen: string,
    reasoning: string,
    factors: Record<string, number>
  ): Promise<TwinNode> {
    const decision = this.addNode({
      type: 'decision',
      label: `Decision: ${context.substring(0, 60)}`,
      description: context,
      properties: {
        context,
        options,
        chosen,
        reasoning,
        factors,
      },
      confidence: 0.8,
      source: 'extracted',
    });

    // 关联决策到用户
    this.addEdge({
      type: 'belongs_to',
      sourceId: decision.id,
      targetId: this.userId,
      weight: 1.0,
      confidence: 1.0,
      evidence: ['User made this decision'],
    });

    // 为每个因素创建关联
    for (const [factor] of Object.entries(factors)) {
      const factorNode = this.addNode({
        type: 'preference',
        label: `decision_factor: ${factor}`,
        properties: {
          category: 'decision_factor',
          key: factor,
          value: 'considered',
          strength: 'moderate',
        },
        confidence: 0.6,
        source: 'extracted',
      });

      this.addEdge({
        type: 'decides_by',
        sourceId: decision.id,
        targetId: factorNode.id,
        weight: factors[factor],
        confidence: 0.7,
        evidence: [`Factor ${factor} weighted ${factors[factor]}`],
      });
    }

    return decision;
  }

  /**
   * learnWorkflow — 学习用户工作流
   *
   * @param name - 工作流名称
   * @param steps - 步骤列表
   * @param tools - 使用的工具
   * @param domain - 领域
   * @returns 工作流节点
   */
  async learnWorkflow(
    name: string,
    steps: string[],
    tools: string[] = [],
    domain?: string
  ): Promise<TwinNode> {
    return this.addNode({
      type: 'workflow',
      label: name,
      description: `${domain ? `[${domain}] ` : ''}${steps.length} 步工作流`,
      properties: {
        name,
        steps,
        frequency: 'occasional',
        domain,
        tools,
      },
      confidence: 0.7,
      source: 'extracted',
    });
  }

  /**
   * getInsights — 从图谱中提取洞察
   *
   * 分析节点和边的关系，生成可操作的洞察。
   *
   * @returns 洞察列表
   */
  getInsights(): TwinInsight[] {
    const insights: TwinInsight[] = [];

    // 1. 强偏好洞察
    const strongPrefs = this.getNodesByType('preference')
      .filter(p => p.properties['strength'] === 'strong' && p.confidence > 0.7);
    if (strongPrefs.length > 0) {
      insights.push({
        type: 'preference',
        title: 'Strong preferences detected',
        description: `User has ${strongPrefs.length} strong preference(s): ${strongPrefs.map(p => p.properties['key']).join(', ')}`,
        confidence: 0.8,
        relatedNodeIds: strongPrefs.map(p => p.id),
      });
    }

    // 2. 高频工作流洞察
    const workflows = this.getNodesByType('workflow')
      .filter(w => w.properties['frequency'] === 'daily' || w.properties['frequency'] === 'regular');
    if (workflows.length > 0) {
      insights.push({
        type: 'pattern',
        title: 'Regular workflows identified',
        description: `${workflows.length} workflow(s) used regularly: ${workflows.map(w => w.label).join(', ')}`,
        confidence: 0.9,
        relatedNodeIds: workflows.map(w => w.id),
      });
    }

    // 3. 活跃目标洞察
    const activeGoals = this.getGoals('active');
    if (activeGoals.length > 0) {
      insights.push({
        type: 'recommendation',
        title: 'Active goals in progress',
        description: `${activeGoals.length} active goal(s). Top priority: "${activeGoals[0].label}"`,
        confidence: 0.9,
        relatedNodeIds: activeGoals.map(g => g.id),
      });
    }

    return insights;
  }

  // ═══════════════════════════════════════════════════════════
  // 统计
  // ═══════════════════════════════════════════════════════════

  /**
   * getStats — 获取图谱统计
   */
  getStats(): TwinStats {
    const byNodeType: Record<string, number> = {};
    const byEdgeType: Record<string, number> = {};
    let totalConfidence = 0;

    for (const node of this.nodes.values()) {
      byNodeType[node.type] = (byNodeType[node.type] || 0) + 1;
      totalConfidence += node.confidence;
    }

    for (const edge of this.edges.values()) {
      byEdgeType[edge.type] = (byEdgeType[edge.type] || 0) + 1;
    }

    return {
      totalNodes: this.nodes.size,
      totalEdges: this.edges.size,
      byNodeType,
      byEdgeType,
      averageConfidence: this.nodes.size > 0
        ? totalConfidence / this.nodes.size
        : 0,
    };
  }

  /**
   * clear — 清空图谱
   */
  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.adjOut.clear();
    this.adjIn.clear();
  }

  // ═══════════════════════════════════════════════════════════
  // 序列化
  // ═══════════════════════════════════════════════════════════

  /**
   * toJSON — 序列化为可持久化的 JSON
   *
   * @returns 可 JSON 序列化的对象
   */
  toJSON(): { userId: string; nodes: TwinNode[]; edges: TwinEdge[] } {
    return {
      userId: this.userId,
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
    };
  }

  /**
   * fromJSON — 从 JSON 加载图谱
   *
   * @param data - 序列化数据
   * @returns PersonalTwinGraph 实例
   */
  static fromJSON(data: {
    userId: string;
    nodes: TwinNode[];
    edges: TwinEdge[];
  }): PersonalTwinGraph {
    const graph = new PersonalTwinGraph(data.userId);

    for (const node of data.nodes) {
      graph.nodes.set(node.id, node);
    }

    for (const edge of data.edges) {
      graph.edges.set(edge.id, edge);

      if (!graph.adjOut.has(edge.sourceId)) {
        graph.adjOut.set(edge.sourceId, new Set());
      }
      graph.adjOut.get(edge.sourceId)!.add(edge.id);

      if (!graph.adjIn.has(edge.targetId)) {
        graph.adjIn.set(edge.targetId, new Set());
      }
      graph.adjIn.get(edge.targetId)!.add(edge.id);
    }

    return graph;
  }

  // ═══════════════════════════════════════════════════════════
  // 内部工具
  // ═══════════════════════════════════════════════════════════

  /**
   * calculateNewStrength — 根据新证据计算新的偏好强度
   */
  private calculateNewStrength(
    currentStrength: string,
    newConfidence: number
  ): string {
    const strengthMap: Record<string, number> = {
      weak: 0,
      moderate: 1,
      strong: 2,
    };
    const reverseMap = ['weak', 'moderate', 'strong'];

    const current = strengthMap[currentStrength] ?? 1;
    const delta = newConfidence > 0.6 ? 1 : newConfidence > 0.3 ? 0 : -1;
    const newLevel = Math.max(0, Math.min(2, current + delta));

    return reverseMap[newLevel];
  }
}
