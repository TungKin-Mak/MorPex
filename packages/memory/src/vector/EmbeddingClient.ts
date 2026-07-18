/**
 * EmbeddingClient — BGE-M3 嵌入服务 HTTP 客户端
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export class EmbeddingClient {
  private baseUrl: string;
  private zvec: any = null;
  private _hasNative = false;

  constructor(baseUrl: string = 'http://localhost:3100') {
    this.baseUrl = baseUrl;

    // 尝试加载 zvec（可选，仅当需要本地量化时）
    try {
      this.zvec = require('@zvec/zvec');
      this._hasNative = true;
    } catch {}
  }

  get hasNative(): boolean { return this._hasNative; }

  async embed(text: string): Promise<Float32Array | null> {
    try {
      const resp = await fetch(`${this.baseUrl}/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) return null;
      const data = await resp.json() as Record<string, any>;
      if (!data.ok || !data.vector) return null;
      return new Float32Array(data.vector);
    } catch {
      return null;
    }
  }

  async embedBatch(texts: string[]): Promise<Float32Array[] | null> {
    if (texts.length === 0) return [];
    try {
      const resp = await fetch(`${this.baseUrl}/embed-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts }),
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) return null;
      const data = await resp.json() as Record<string, any>;
      if (!data.ok || !data.vectors) return null;
      return data.vectors.map((v: number[]) => new Float32Array(v));
    } catch {
      return null;
    }
  }

  async healthCheck(retries = 5, delayMs = 2000): Promise<boolean> {
    for (let i = 0; i < retries; i++) {
      try {
        const resp = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) return true;
      } catch { /* retry */ }
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
    return false;
  }
}
