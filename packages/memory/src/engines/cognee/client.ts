/**
 * engines/cognee/client — cognee 本地引擎的 TS HTTP 客户端
 *
 * 通过 cognee API server（cognee-cli serve / fastapi）访问：
 *   POST /api/v1/remember  写记忆（建图）
 *   POST /api/v1/recall    分层召回（session → 图）
 *   POST /api/v1/search    图/混合检索
 *   POST /api/v1/forget    删数据集
 *
 * 低耦合：只负责 HTTP 协议映射，不包含业务规则（业务在 MemoryAPI 层）。
 */

export interface CogneeConfig {
  baseUrl: string;      // 如 http://localhost:8000
  apiKey?: string;      // API key / user token
  userId?: string;      // 多租户 user-id（可空，默认 user）
  timeoutMs?: number;
}

interface SearchHitDTO {
  dataset_name?: string;
  search_result?: string[];
  [k: string]: unknown;
}

export class CogneeClient {
  constructor(private readonly cfg: CogneeConfig) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json', ...extra };
    if (this.cfg.apiKey) h.authorization = `Bearer ${this.cfg.apiKey}`;
    if (this.cfg.userId) h['x-user-id'] = this.cfg.userId;
    return h;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs ?? 120_000);
    try {
      const res = await fetch(`${this.cfg.baseUrl}${path}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`cognee ${path} HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(t);
    }
  }

  /** 写一条事实进记忆图（cognee 1.4: multipart/form-data） */
  async remember(data: string, opts: { dataset?: string; sessionId?: string; background?: boolean } = {}): Promise<{ ok: boolean; id?: string; reason?: string }> {
    try {
      // 手动构造 multipart（绕开 Node fetch FormData 的流问题，Windows 下更稳）
      const boundary = `----morpex${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const parts = [
        `--${boundary}\r\nContent-Disposition: form-data; name="datasetName"\r\n\r\n${opts.dataset ?? 'company'}`,
        opts.sessionId
          ? `--${boundary}\r\nContent-Disposition: form-data; name="session_id"\r\n\r\n${opts.sessionId}`
          : '',
        `--${boundary}\r\nContent-Disposition: form-data; name="data"; filename="memory.txt"\r\nContent-Type: text/plain\r\n\r\n${data}`,
        `--${boundary}--\r\n`,
      ];
      const body = parts.filter(Boolean).join('\r\n');

      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs ?? 180_000);
      try {
        const res = await fetch(`${this.cfg.baseUrl}/api/v1/remember`, {
          method: 'POST',
          headers: this.headers({ 'content-type': `multipart/form-data; boundary=${boundary}` }),
          body,
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          return { ok: false, reason: `HTTP ${res.status}: ${text.slice(0, 200)}` };
        }
        const r = (await res.json()) as Record<string, unknown>;
        return { ok: true, id: typeof r.dataset_id === 'string' ? r.dataset_id : undefined };
      } finally {
        clearTimeout(t);
      }
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  }

  /** 分层召回 */
  async recall(query: string, opts: { dataset?: string; scope?: string; sessionId?: string } = {}): Promise<EngineHitDTO[]> {
    const body: Record<string, unknown> = { query_text: query };
    if (opts.dataset) body.datasets = [opts.dataset];
    if (opts.scope) body.scope = opts.scope;
    if (opts.sessionId) body.session_id = opts.sessionId;
    return this.post<EngineHitDTO[]>('/api/v1/recall', body);
  }

  /** 检索（search_type 区分图优先/混合/双时间）；返回答案文本数组 */
  async search(query: string, searchType: 'GRAPH_COMPLETION' | 'RAG_COMPLETION' | 'TEMPORAL', opts: { dataset?: string } = {}): Promise<string[]> {
    const body: Record<string, unknown> = { query, search_type: searchType };
    if (opts.dataset) body.datasets = [opts.dataset];
    const rows = await this.post<string[] | SearchHitDTO[]>('/api/v1/search', body);
    return rows.map((r) => (typeof r === 'string' ? r : String((r as SearchHitDTO).search_result?.join(' ') ?? '')))
      .filter(Boolean);
  }

  /** 删除数据集 */
  async forget(dataset: string): Promise<void> {
    await this.post('/api/v1/forget', { dataset_names: [dataset] });
  }

  /** 获取数据集图（纯图结构：节点/关系，无 LLM 生成） */
  async getGraph(dataset: string): Promise<{ nodes: GraphNodeDTO[]; links: GraphLinkDTO[] }> {
    // datasets 是 GET
    const res = await fetch(`${this.cfg.baseUrl}/api/v1/datasets`, { headers: this.headers() });
    if (!res.ok) return { nodes: [], links: [] };
    const list = (await res.json()) as Array<{ id: string; name: string }>;
    const target = list.find((d) => d.name === dataset) ?? list[0];
    if (!target) return { nodes: [], links: [] };
    const gres = await fetch(`${this.cfg.baseUrl}/api/v1/datasets/${target.id}/graph`, { headers: this.headers() });
    if (!gres.ok) return { nodes: [], links: [] };
    const g = (await gres.json()) as { nodes?: GraphNodeDTO[]; links?: GraphLinkDTO[] };
    return { nodes: g.nodes ?? [], links: g.links ?? [] };
  }

  /** 引擎可用性探测 */
  async available(): Promise<boolean> {
    try {
      const res = await fetch(`${this.cfg.baseUrl}/api/v1/datasets`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(3_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

interface GraphNodeDTO {
  id?: string;
  label?: string | null;
  name?: string | null;
  properties?: Record<string, unknown>;
  [k: string]: unknown;
}

interface GraphLinkDTO {
  id?: string;
  source?: string;
  target?: string;
  type?: string;
  label?: string;
  [k: string]: unknown;
}

interface EngineHitDTO {
  id?: string;
  content?: string;
  score?: number;
  search_result?: string[];
  dataset_name?: string;
  [k: string]: unknown;
}
