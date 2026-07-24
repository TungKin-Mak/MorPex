import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * PersistentArtifactStore — ArtifactNode 持久化存储 (JSON file)
 * v15 Integration: 使用文件系统持久化，支持重启恢复。
 * 可替换为 SqliteEventStore 当 EventStore API 稳定后。
 */
export class PersistentArtifactStore {
  private artifacts: Map<string, any> = new Map();
  private ready = false;
  private filePath: string;

  constructor(dbPath?: string) {
    this.filePath = dbPath || './data/artifacts.json';
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  async init(): Promise<void> {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          data.forEach((a: any) => this.artifacts.set(a.id, a));
        }
      }
    } catch (err) {
      console.warn('[PersistentArtifactStore] 恢复失败，使用空状态:', (err as Error).message);
    }
    this.ready = true;
  }

  save(artifact: any): void {
    this.artifacts.set(artifact.id, { ...artifact });
    this.flush();
  }

  transition(id: string, to: string): boolean {
    const art = this.artifacts.get(id);
    if (!art) return false;
    art.status = to;
    art.updatedAt = Date.now();
    this.flush();
    return true;
  }

  get(id: string): any { return this.artifacts.get(id); }
  getByTask(taskId: string): any[] {
    return [...this.artifacts.values()].filter((a: any) => a.sourceTask === taskId);
  }
  isReady(): boolean { return this.ready; }

  private flush(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify([...this.artifacts.values()], null, 2), 'utf-8');
    } catch (err) {
      console.warn('[PersistentArtifactStore] 写入失败:', (err as Error).message);
    }
  }
}
