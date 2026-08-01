/**
 * DomainManifestLoader — 领域清单加载器
 *
 * 从 data/domains/*.json 加载和验证领域清单。
 * 支持全量加载、单域加载、热重载。
 *
 * 遵循迁移铁律：
 *   0.1 (字段名法则): JSON 字段名 = 代码字段名
 *   0.2 (类型来源法则): 类型基于 pi-ai/pi-agent-core 已有类型扩展
 *   0.4 (删除优先法则): 不对已有 pi 功能做二次封装
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DomainManifest, ValidationResult, ValidationError } from './types.js';

/**
 * DomainManifestLoader — 领域清单加载器
 *
 * 用法：
 *   const loader = new DomainManifestLoader();
 *   const manifests = await loader.loadAll();
 *   for (const m of manifests) {
 *     const result = loader.validate(m);
 *     if (!result.valid) console.error(result.errors);
 *   }
 */
export class DomainManifestLoader {
  private manifestsDir: string;
  private cache: Map<string, DomainManifest> = new Map();

  /**
   * @param manifestsDir - 领域清单 JSON 文件目录，默认 ./data/domains
   */
  constructor(manifestsDir?: string) {
    this.manifestsDir = manifestsDir ?? path.resolve(process.cwd(), 'data', 'domains');
  }

  /**
   * 加载所有领域清单
   * 扫描 manifestsDir 下所有 *.json 文件，逐个加载并校验。
   * 校验失败的清单会被跳过并记录 warning。
   *
   * @returns 所有有效的 DomainManifest 列表
   */
  async loadAll(): Promise<DomainManifest[]> {
    this.ensureDir();
    const manifests: DomainManifest[] = [];

    try {
      const files = fs.readdirSync(this.manifestsDir)
        .filter(f => f.endsWith('.json'))
        .sort();

      for (const file of files) {
        const filePath = path.join(this.manifestsDir, file);
        const manifest = this.loadFromFile(filePath);
        if (manifest) {
          const validation = this.validate(manifest);
          if (validation.valid) {
            this.cache.set(manifest.domain_id, manifest);
            manifests.push(manifest);
          } else {
            console.warn(`[DomainManifestLoader] ⚠️ 跳过 ${file}: 校验失败`, validation.errors);
          }
        }
      }
    } catch (err: unknown) {
      console.error(`[DomainManifestLoader] ❌ 加载领域清单失败:`, (err as Error).message);
    }

    return manifests;
  }

  /**
   * 加载指定领域清单
   *
   * @param domainId - 领域 ID
   * @returns DomainManifest 或 null（未找到）
   */
  async load(domainId: string): Promise<DomainManifest | null> {
    // 先查缓存
    const cached = this.cache.get(domainId);
    if (cached) return cached;

    // 尝试从文件加载
    const filePath = path.join(this.manifestsDir, `${domainId}.json`);
    if (!fs.existsSync(filePath)) {
      // 尝试查找 domain_id 匹配的文件
      const files = fs.readdirSync(this.manifestsDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const manifest = this.loadFromFile(path.join(this.manifestsDir, file));
        if (manifest && manifest.domain_id === domainId) {
          const validation = this.validate(manifest);
          if (validation.valid) {
            this.cache.set(domainId, manifest);
            return manifest;
          }
        }
      }
      return null;
    }

    const manifest = this.loadFromFile(filePath);
    if (manifest) {
      const validation = this.validate(manifest);
      if (validation.valid) {
        this.cache.set(domainId, manifest);
        return manifest;
      }
    }
    return null;
  }

  /**
   * 校验领域清单的完整性和合法性
   *
   * 检查项：
   *   - 必填字段存在且类型正确
   *   - domain_id 符合标识符规范
   *   - version 为 semver 格式
   *   - wake_conditions 至少有一个条件
   *
   * @param manifest - 待校验的领域清单
   * @returns 校验结果
   */
  validate(manifest: DomainManifest): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // 1. 必填字段校验
    this.validateRequiredString(manifest.domain_id, 'domain_id', errors);
    this.validateRequiredString(manifest.domain_name, 'domain_name', errors);
    this.validateRequiredString(manifest.version, 'version', errors);
    this.validateRequiredString(manifest.master_agent_config?.system_prompt, 'master_agent_config.system_prompt', errors);
    this.validateRequiredString(manifest.master_agent_config?.model, 'master_agent_config.model', errors);

    // 2. domain_id 格式校验（只能包含小写字母、数字、下划线、连字符）
    if (manifest.domain_id && !/^[a-z0-9_-]+$/.test(manifest.domain_id)) {
      errors.push({
        field: 'domain_id',
        message: `domain_id "${manifest.domain_id}" 只能包含小写字母、数字、下划线、连字符`,
        code: 'INVALID_DOMAIN_ID_FORMAT',
      });
    }

    // 3. version 格式校验（简单 semver）
    if (manifest.version && !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
      warnings.push(`version "${manifest.version}" 不是标准 semver 格式 (x.y.z)`);
    }

    // 4. subscribed_events 校验
    if (!Array.isArray(manifest.subscribed_events)) {
      errors.push({
        field: 'subscribed_events',
        message: 'subscribed_events 必须是字符串数组',
        code: 'INVALID_TYPE',
      });
    }

    // 5. skills 校验
    if (!Array.isArray(manifest.skills)) {
      errors.push({
        field: 'skills',
        message: 'skills 必须是字符串数组',
        code: 'INVALID_TYPE',
      });
    }

    // 6. output_artifacts 校验
    if (!Array.isArray(manifest.output_artifacts)) {
      errors.push({
        field: 'output_artifacts',
        message: 'output_artifacts 必须是数组',
        code: 'INVALID_TYPE',
      });
    } else {
      for (let i = 0; i < manifest.output_artifacts.length; i++) {
        const art = manifest.output_artifacts[i];
        if (!art.type || !art.format) {
          errors.push({
            field: `output_artifacts[${i}]`,
            message: '每个 output_artifact 必须包含 type 和 format',
            code: 'MISSING_FIELD',
          });
        }
      }
    }

    // 7. wake_conditions 校验
    if (!manifest.wake_conditions) {
      errors.push({
        field: 'wake_conditions',
        message: 'wake_conditions 是必填字段',
        code: 'MISSING_FIELD',
      });
    } else {
      const wc = manifest.wake_conditions;
      if (!Array.isArray(wc.intent_patterns) || wc.intent_patterns.length === 0) {
        warnings.push('wake_conditions.intent_patterns 为空，该领域可能无法被自动唤醒');
      }
      if (!Array.isArray(wc.events)) {
        errors.push({
          field: 'wake_conditions.events',
          message: 'events 必须是字符串数组',
          code: 'INVALID_TYPE',
        });
      }
      if (!Array.isArray(wc.artifact_triggers)) {
        errors.push({
          field: 'wake_conditions.artifact_triggers',
          message: 'artifact_triggers 必须是字符串数组',
          code: 'INVALID_TYPE',
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 重新加载所有领域清单（清空缓存）
   */
  async reloadAll(): Promise<DomainManifest[]> {
    this.cache.clear();
    return this.loadAll();
  }

  /**
   * 获取已加载的清单数量
   */
  get loadedCount(): number {
    return this.cache.size;
  }

  /**
   * 获取所有已缓存的领域 ID
   */
  getCachedDomainIds(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 获取配置的领域目录
   */
  getManifestsDir(): string {
    return this.manifestsDir;
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  private ensureDir(): void {
    if (!fs.existsSync(this.manifestsDir)) {
      fs.mkdirSync(this.manifestsDir, { recursive: true });
      console.log(`[DomainManifestLoader] 创建领域目录: ${this.manifestsDir}`);
    }
  }

  private loadFromFile(filePath: string): DomainManifest | null {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);

      // 字段名直接映射（铁律 0.1：字段名 = JSON key）
      const manifest: DomainManifest = {
        domain_id: data.domain_id,
        domain_name: data.domain_name,
        version: data.version,
        master_agent_config: {
          system_prompt: data.master_agent_config?.system_prompt ?? '',
          model: data.master_agent_config?.model ?? '',
          temperature: data.master_agent_config?.temperature,
          maxTokens: data.master_agent_config?.maxTokens,
        },
        subscribed_events: data.subscribed_events ?? [],
        skills: data.skills ?? [],
        output_artifacts: data.output_artifacts ?? [],
        wake_conditions: {
          intent_patterns: data.wake_conditions?.intent_patterns ?? [],
          events: data.wake_conditions?.events ?? [],
          artifact_triggers: data.wake_conditions?.artifact_triggers ?? [],
        },
      };

      return manifest;
    } catch (err: unknown) {
      console.warn(`[DomainManifestLoader] ⚠️ 加载文件失败 ${filePath}: ${(err as Error).message}`);
      return null;
    }
  }

  private validateRequiredString(value: any, field: string, errors: ValidationError[]): void {
    if (!value || typeof value !== 'string' || value.trim().length === 0) {
      errors.push({
        field,
        message: `${field} 是必填字段且不能为空`,
        code: 'MISSING_REQUIRED_FIELD',
      });
    }
  }
}
