/**
 * PersonalTwinGraph 个人孪生图谱测试（L4 Cognition/twin）— 此前零覆盖（295 stmt / 0.7%）
 *
 * 覆盖：节点增删改查/搜索 + 边管理/关系查询 + 目标/协作/决策画像聚合
 *       + 图遍历（getRelated/getSubgraph）+ query + learn* 学习 + stats/序列化
 */
import { describe, it, expect } from 'vitest';
import { PersonalTwinGraph } from '../src/cognition/twin/PersonalTwinGraph.js';

describe('PersonalTwinGraph — 节点管理', () => {
  it('addNode/getNode/getNodesByType/getUserId', () => {
    const g = new PersonalTwinGraph('u1');
    expect(g.getUserId()).toBe('u1');
    const n = g.addNode({ type: 'goal', label: '完成产品', description: '季度目标' });
    expect(n.id).toBeTruthy();
    expect(g.getNode(n.id)?.label).toBe('完成产品');
    expect(g.getNodesByType('goal')).toHaveLength(1);
    expect(g.getNodesByType('user')).toHaveLength(0);
  });

  it('updateNode 更新字段；removeNode 删除', () => {
    const g = new PersonalTwinGraph();
    const n = g.addNode({ type: 'project', label: '项目A' });
    const updated = g.updateNode(n.id, { label: '项目A-改名', properties: { prio: 1 } });
    expect(updated?.label).toBe('项目A-改名');
    expect(updated?.properties.prio).toBe(1);
    expect(g.removeNode(n.id)).toBe(true);
    expect(g.getNode(n.id)).toBeUndefined();
    expect(g.removeNode('missing')).toBe(false);
  });

  it('searchNodes 按 label/description 匹配 + 类型过滤', () => {
    const g = new PersonalTwinGraph();
    g.addNode({ type: 'goal', label: '发布产品 v2', description: '包含定价' });
    g.addNode({ type: 'goal', label: '写周报' });
    g.addNode({ type: 'workflow', label: '发布流程' });
    expect(g.searchNodes('发布')).toHaveLength(2);
    expect(g.searchNodes('发布', 'goal')).toHaveLength(1);
    expect(g.searchNodes('定价')).toHaveLength(1);
    expect(g.searchNodes('不存在xyz')).toHaveLength(0);
  });
});

describe('PersonalTwinGraph — 边与关系', () => {
  it('addEdge 校验节点存在；getEdgesBetween/getEdgesByType/removeEdge', () => {
    const g = new PersonalTwinGraph();
    const a = g.addNode({ type: 'user', label: 'me' });
    const b = g.addNode({ type: 'goal', label: '目标1' });
    expect(() => g.addEdge({ type: 'decides_by', sourceId: 'missing', targetId: b.id })).toThrow(/源节点不存在/);
    const e = g.addEdge({ type: 'decides_by', sourceId: a.id, targetId: b.id });
    expect(e.id).toBeTruthy();
    expect(g.getEdgesBetween(a.id, b.id)).toHaveLength(1);
    expect(g.getEdgesByType('decides_by')).toHaveLength(1);
    expect(g.removeEdge(e.id)).toBe(true);
    expect(g.getEdgesBetween(a.id, b.id)).toHaveLength(0);
  });

  it('getRelated 按边遍历邻接节点（含深度）', () => {
    const g = new PersonalTwinGraph();
    const me = g.addNode({ type: 'user', label: 'me' });
    const goal = g.addNode({ type: 'goal', label: '目标' });
    const proj = g.addNode({ type: 'project', label: '项目' });
    g.addEdge({ type: 'decides_by', sourceId: me.id, targetId: goal.id });
    g.addEdge({ type: 'belongs_to', sourceId: proj.id, targetId: goal.id });
    const related = g.getRelated(me.id);
    expect(related.some(n => n.id === goal.id)).toBe(true);
    const sub = g.getSubgraph(me.id, 2);
    expect(sub.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it('getGoals 按状态过滤', () => {
    const g = new PersonalTwinGraph();
    const g1 = g.addNode({ type: 'goal', label: '进行中', properties: { status: 'active' } });
    g.addNode({ type: 'goal', label: '已完成', properties: { status: 'completed' } });
    expect(g.getGoals('active').some(n => n.id === g1.id)).toBe(true);
    expect(g.getGoals('completed')).toHaveLength(1);
  });
});

describe('PersonalTwinGraph — 决策画像与洞察', () => {
  it('getDecisionProfile 返回决策偏好聚合', () => {
    const g = new PersonalTwinGraph();
    const me = g.addNode({ type: 'user', label: 'me' });
    const d1 = g.addNode({ type: 'decision', label: '选型A', properties: { risk: 'low', timeSpentMs: 5000 } });
    g.addEdge({ type: 'decides_by', sourceId: me.id, targetId: d1.id });
    const profile = g.getDecisionProfile();
    expect(profile).toBeTruthy();
    expect(typeof profile).toBe('object');
  });

  it('getCollaborators 返回协作人 + 强度', () => {
    const g = new PersonalTwinGraph();
    const me = g.addNode({ type: 'user', label: 'me' });
    const p1 = g.addNode({ type: 'person', label: '张三', properties: { strength: 0.8 } });
    const p2 = g.addNode({ type: 'person', label: '李四', properties: { strength: 0.5 } });
    g.addEdge({ type: 'works_with', sourceId: me.id, targetId: p1.id });
    g.addEdge({ type: 'works_with', sourceId: me.id, targetId: p2.id });
    const collabs = g.getCollaborators();
    expect(collabs.map(c => c.person.label).sort()).toEqual(['张三', '李四']);
  });

  it('getStats 统计节点/边 + toJSON 序列化 + clear', () => {
    const g = new PersonalTwinGraph();
    const me = g.addNode({ type: 'user', label: 'me' });
    g.addNode({ type: 'goal', label: '目标' });
    g.addEdge({ type: 'decides_by', sourceId: me.id, targetId: g.getNodesByType('goal')[0].id });
    const stats = g.getStats();
    expect(stats.totalNodes).toBe(2);
    expect(stats.totalEdges).toBe(1);
    expect(stats.byNodeType.goal).toBe(1);
    const json = g.toJSON();
    expect(json.userId).toBe('default');
    expect(json.nodes.length).toBe(2);
    g.clear();
    expect(g.getStats().totalNodes).toBe(0);
  });

  it('query 按条件过滤节点', () => {
    const g = new PersonalTwinGraph();
    g.addNode({ type: 'goal', label: 'A', properties: { prio: 1 } });
    g.addNode({ type: 'workflow', label: 'B' });
    const r = g.query({ nodeType: 'goal' } as any);
    expect(r.length).toBe(1);
    expect(r[0].type).toBe('goal');
  });
});
