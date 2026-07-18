/**
 * ConfigStore — 系统配置持久化
 *
 * 解决 storage-comprehensive.md #6.1：/api/config 目前只返回硬编码值。
 *
 * 存储位置：data/config/system.json
 *
 * 使用方式：
 *   const config = new ConfigStore();
 *   await config.initialize();
 *   config.get('engine');           // → 'deepseek'
 *   config.set('engine', 'openai'); // → 自动持久化
 */

import * as fs from 'fs';
import * as path from 'path';

// ── 类型 ──

export interface SystemConfig {
  version: string;
  engine: string;
  thinkingLevel: 'fast' | 'balanced' | 'deep';
  model: string;
  plugins: string[];
  embedUrl: string;
  maxTokens: number;
  temperature: number;
  [key: string]: any;  // 允许扩展
}

const DEFAULT_CONFIG: SystemConfig = {
  version: '0.1.0',
  engine: 'deepseek',
  thinkingLevel: 'balanced',
  model: 'deepseek-v4-flash',
  plugins: [],
  embedUrl: 'http://localhost:3100',
  maxTokens: 4096,
  temperature: 0.7,
};

// ── ConfigStore ──

export class ConfigStore {
  private filePath: string;
  private config: SystemConfig;
  private _ready = false;

  constructor(dataDir?: string) {
    this.filePath = path.resolve(dataDir ?? './data/config', 'system.json');
    this.config = { ...DEFAULT_CONFIG };
  }

  get ready(): boolean { return this._ready; }

  async initialize(): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const saved = JSON.parse(raw);
        this.config = { ...DEFAULT_CONFIG, ...saved };
        console.log(`[Config] ✅ 已加载配置: ${this.filePath}`);
      } catch (err: any) {
        console.warn(`[Config] ⚠️ 配置加载失败，使用默认值: ${err.message}`);
        this.save(); // 写入默认配置
      }
    } else {
      // 首次运行，写入默认配置
      this.save();
      console.log(`[Config] ✅ 已创建默认配置: ${this.filePath}`);
    }

    this._ready = true;
  }

  /** 读取配置项 */
  get<K extends keyof SystemConfig>(key: K): SystemConfig[K] {
    return this.config[key];
  }

  /** 读取全部配置 */
  getAll(): SystemConfig {
    return { ...this.config };
  }

  /** 设置配置项（自动持久化） */
  set<K extends keyof SystemConfig>(key: K, value: SystemConfig[K]): void {
    this.config[key] = value;
    this.save();
  }

  /** 批量更新配置 */
  update(partial: Partial<SystemConfig>): void {
    this.config = { ...this.config, ...partial };
    this.save();
  }

  /** 重置为默认值 */
  reset(): void {
    this.config = { ...DEFAULT_CONFIG };
    this.save();
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (err: any) {
      console.warn(`[Config] ⚠️ 保存失败: ${err.message}`);
    }
  }
}
