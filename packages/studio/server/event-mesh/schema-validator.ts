/**
 * SchemaValidator — Schema 验证器
 *
 * MorPex v10: 验证事件是否符合已注册的 Schema。
 * 支持字段存在性检查、类型检查、必填字段验证。
 */

import type { EventSchema, ValidationResult, ValidationError, MorpexEventV10 } from './types.js';
import { EventRegistry } from './event-registry.js';

// ── SchemaValidator ──

export class SchemaValidator {
  private registry: EventRegistry;

  constructor(registry: EventRegistry) {
    this.registry = registry;
  }

  /**
   * validate — 验证事件是否符合其类型的 Schema
   *
   * @param event - v10 格式事件
   * @returns ValidationResult
   */
  validate(event: MorpexEventV10): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // 1. 基础字段验证
    if (!event.id) errors.push({ path: 'id', message: 'Event ID is required', severity: 'error' });
    if (!event.type) errors.push({ path: 'type', message: 'Event type is required', severity: 'error' });

    // 2. 版本检查
    if (event.version === undefined || event.version === null) {
      warnings.push('Event has no version field — consider adding version for schema validation');
    }

    // 3. Schema 验证
    const schema = this.registry.getSchema(event.type, event.version);
    if (schema) {
      const schemaErrors = this.validateAgainstSchema(event.payload, schema.schema);
      errors.push(...schemaErrors);
    } else if (event.version) {
      // 有版本号但无对应 schema
      warnings.push(`No schema registered for ${event.type} v${event.version}`);
    }

    return {
      valid: errors.filter(e => e.severity === 'error').length === 0,
      errors,
      warnings,
    };
  }

  /**
   * validateBatch — 批量验证
   */
  validateBatch(events: MorpexEventV10[]): { valid: number; invalid: number; results: ValidationResult[] } {
    const results = events.map(e => this.validate(e));
    const valid = results.filter(r => r.valid).length;
    const invalid = results.filter(r => !r.valid).length;
    return { valid, invalid, results };
  }

  /**
   * health — 健康检查
   */
  health(): { ok: boolean; name: string; uptime: number } {
    return {
      ok: true,
      name: 'SchemaValidator',
      uptime: Date.now(),
    };
  }

  // ── 私有方法 ──

  /**
   * validateAgainstSchema — 递归验证 payload 是否符合 schema 定义
   */
  private validateAgainstSchema(
    payload: any,
    schema: Record<string, unknown>,
    path: string = 'payload'
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!schema || typeof schema !== 'object') return errors;

    const properties = (schema as any).properties as Record<string, any> | undefined;
    const required = (schema as any).required as string[] | undefined;

    if (!properties) return errors;

    // 检查必填字段
    if (required) {
      for (const field of required) {
        const fieldPath = `${path}.${field}`;
        if (payload === undefined || payload === null || payload[field] === undefined) {
          errors.push({
            path: fieldPath,
            message: `Missing required field: ${field}`,
            severity: 'error',
          });
        }
      }
    }

    // 检查字段类型
    for (const [field, fieldSchema] of Object.entries(properties)) {
      const fieldPath = `${path}.${field}`;
      const value = payload?.[field];

      if (value === undefined) continue; // 非必填字段可以不出现

      const type = fieldSchema.type as string | undefined;
      if (type) {
        const typeError = this.checkType(value, type, fieldPath);
        if (typeError) errors.push(typeError);
      }

      // 递归检查嵌套对象
      if (fieldSchema.properties && typeof value === 'object' && value !== null) {
        const nestedErrors = this.validateAgainstSchema(value, fieldSchema, fieldPath);
        errors.push(...nestedErrors);
      }
    }

    return errors;
  }

  private checkType(value: any, expectedType: string, path: string): ValidationError | null {
    const actualType = Array.isArray(value) ? 'array' : typeof value;

    // 类型映射（JSON Schema 到 TypeScript）
    const typeMap: Record<string, string[]> = {
      string: ['string'],
      number: ['number'],
      integer: ['number'],
      boolean: ['boolean'],
      array: ['array'],
      object: ['object'],
    };

    const validTypes = typeMap[expectedType] || [expectedType];
    if (!validTypes.includes(actualType)) {
      return {
        path,
        message: `Expected ${expectedType}, got ${actualType}`,
        severity: 'error',
      };
    }

    return null;
  }
}
