/**
 * topologicalSort — 通用拓扑排序（Kahn 算法）
 *
 * 统一的依赖拓扑排序，用于：
 *   - PluginSystem 插件依赖解析
 *   - CrossDomainRouter DAG 节点排序
 *   - DAGEngine 任务排序
 *
 * @param nodes   - 待排序节点
 * @param getDeps - 获取节点依赖 ID 列表的函数
 * @param getId   - 获取节点唯一 ID 的函数
 * @returns 拓扑排序后的节点列表；存在环时返回原序
 */
export function topologicalSort<T>(
  nodes: T[],
  getDeps: (node: T) => string[],
  getId: (node: T) => string,
): T[] {
  const nodeMap = new Map(nodes.map(n => [getId(n), n]));
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  // 初始化
  for (const node of nodes) {
    const id = getId(node);
    inDegree.set(id, 0);
    adjList.set(id, []);
  }

  // 构建入度表和邻接表（依赖去重，避免重复导致入度偏高）
  for (const node of nodes) {
    const id = getId(node);
    const seen = new Set<string>();
    for (const depId of getDeps(node)) {
      if (!nodeMap.has(depId)) continue;
      if (seen.has(depId)) continue; // 去重：同一依赖只计算一次
      seen.add(depId);
      inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
      adjList.get(depId)?.push(id);
    }
  }

  // Kahn 算法
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: T[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = nodeMap.get(current);
    if (node) sorted.push(node);

    for (const neighbor of adjList.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  // 检查是否有环
  if (sorted.length < nodes.length) {
    console.warn('[topologicalSort] ⚠️ 图中存在环，返回原始顺序');
    return nodes;
  }

  return sorted;
}
