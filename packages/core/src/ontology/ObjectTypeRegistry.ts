/**
 * ObjectTypeRegistry — 对象类型注册与校验
 *
 * 迭代2：管理所有已知 Object Type Schema，提供属性校验。
 */

import { DEFAULT_SCHEMAS, type ObjectTypeSchema } from './objectTypes.js';

export class ObjectTypeRegistry {
  private schemas = new Map<string, ObjectTypeSchema>();

  constructor(initial: ObjectTypeSchema[] = DEFAULT_SCHEMAS) {
    for (const s of initial) this.schemas.set(s.type, s);
  }

  /**
   * register — 注册一个新的 Object Type Schema
   */
  register(schema: ObjectTypeSchema): void {
    this.schemas.set(schema.type, schema);
  }

  /**
   * get — 获取指定类型的 Schema
   */
  get(type: string): ObjectTypeSchema | undefined {
    return this.schemas.get(type);
  }

  /**
   * validateProperties — 校验属性是否满足 Schema 要求
   *
   * @returns 缺失的必填属性列表（空数组表示完全合法）
   */
  validateProperties(type: string, properties: Record<string, unknown>): string[] {
    const schema = this.schemas.get(type);
    if (!schema) return [`Unknown type: ${type}`];
    const missing = schema.requiredProperties.filter((k) => properties[k] == null);
    return missing.map((k) => `Missing required property: ${k}`);
  }

  /**
   * list — 列出所有已注册的 Schema
   */
  list(): ObjectTypeSchema[] {
    return Array.from(this.schemas.values());
  }

  /**
   * has — 检查类型是否已注册
   */
  has(type: string): boolean {
    return this.schemas.has(type);
  }

  /**
   * getDefaultStatus — 获取类型的默认状态
   */
  getDefaultStatus(type: string): string | undefined {
    return this.schemas.get(type)?.defaultStatus;
  }
}
