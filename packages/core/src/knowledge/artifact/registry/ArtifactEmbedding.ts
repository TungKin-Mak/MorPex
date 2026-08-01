/**
 * ArtifactEmbedding — 产物语义嵌入
 *
 * 为 Artifact 生成和管理语义向量，支持语义搜索和相似度比较。
 * 注意：实际向量生成需要 LLM/Embedding 服务，
 * 本模块提供向量存储、管理和相似度计算。
 */
import type { ArtifactNode, ArtifactEmbedding as ArtifactEmbeddingType } from './types.js';

export interface SimilarityResult {
  artifactId: string;
  name: string;
  score: number;
}

export class ArtifactEmbedding {
  private embeddings = new Map<string, ArtifactEmbeddingType>();
  private modelName = 'default';

  constructor(modelName?: string) {
    if (modelName) this.modelName = modelName;
  }

  /** 注册嵌入向量 */
  register(embedding: ArtifactEmbeddingType): void {
    this.embeddings.set(embedding.artifactId, embedding);
  }

  /** 获取嵌入向量 */
  get(artifactId: string): ArtifactEmbeddingType | undefined {
    return this.embeddings.get(artifactId);
  }

  /** 删除嵌入向量 */
  remove(artifactId: string): void {
    this.embeddings.delete(artifactId);
  }

  /** 从 ArtifactNode 生成嵌入（使用 hash-based 简易表示） */
  generate(node: ArtifactNode): ArtifactEmbeddingType {
    // 简易嵌入：基于 Artifact 属性的特征向量
    // 实际应用中应使用 LLM/Embedding API
    const features = this.extractFeatures(node);
    return {
      artifactId: node.id,
      vector: features,
      model: this.modelName,
      dimensions: features.length,
      createdAt: Date.now(),
    };
  }

  /** 批量生成嵌入 */
  generateAll(nodes: ArtifactNode[]): ArtifactEmbeddingType[] {
    return nodes.map(n => this.generate(n));
  }

  /** 查找相似 Artifact */
  findSimilar(artifactId: string, topK: number = 5): SimilarityResult[] {
    const target = this.embeddings.get(artifactId);
    if (!target) return [];

    const results: SimilarityResult[] = [];

    for (const [id, emb] of this.embeddings) {
      if (id === artifactId) continue;
      const score = this.cosineSimilarity(target.vector, emb.vector);
      const node = this.findNodeById(id);
      results.push({ artifactId: id, name: node?.name ?? id, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /** 语义搜索 */
  search(query: string, topK: number = 5): SimilarityResult[] {
    // 简易实现：基于文本匹配的搜索
    const results: SimilarityResult[] = [];
    const queryLower = query.toLowerCase();

    for (const [id, emb] of this.embeddings) {
      const node = this.findNodeById(id);
      if (!node) continue;

      let score = this.cosineSimilarity(this.generate(node).vector, emb.vector);

      // Text match bonus
      if (node.name.toLowerCase().includes(queryLower)) score += 0.2;
      if (node.description.toLowerCase().includes(queryLower)) score += 0.1;

      results.push({ artifactId: id, name: node.name, score: Math.min(1, score) });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /** 向量维度 */
  size(): number { return this.embeddings.size; }

  /** 清除所有嵌入 */
  clear(): void { this.embeddings.clear(); }

  /** 导出 */
  toJSON(): ArtifactEmbeddingType[] { return [...this.embeddings.values()]; }

  /** 导入 */
  static fromJSON(data: ArtifactEmbeddingType[]): ArtifactEmbedding {
    const store = new ArtifactEmbedding();
    for (const emb of data) store.register(emb);
    return store;
  }

  /** 余弦相似度 */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
    return magnitude === 0 ? 0 : dot / magnitude;
  }

  /** 从 ArtifactNode 提取特征向量 */
  private extractFeatures(node: ArtifactNode): number[] {
    const features: number[] = [];

    // Type one-hot
    const types = ['code', 'document', 'config', 'schema', 'report', 'plan'];
    for (const t of types) features.push(node.type === t ? 1 : 0);

    // Capability count (normalized)
    features.push(Math.min(1, node.capabilities.length / 5));

    // Dependency count (normalized)
    features.push(Math.min(1, node.dependencies.length / 10));

    // Success rate
    features.push(node.successRate);

    // Version components
    const parts = node.version.split('.').map(Number);
    features.push(parts[0] || 0);
    features.push(parts[1] || 0);
    features.push(parts[2] || 0);

    // Age (days since creation, normalized)
    const ageDays = (Date.now() - node.createdAt) / (1000 * 86400);
    features.push(Math.min(1, ageDays / 365));

    // Usage frequency
    features.push(Math.min(1, node.usageHistory.length / 20));

    return features;
  }

  private nodesCache: ArtifactNode[] = [];
  setNodeCache(nodes: ArtifactNode[]): void { this.nodesCache = nodes; }

  private findNodeById(id: string): ArtifactNode | undefined {
    return this.nodesCache.find(n => n.id === id);
  }
}
