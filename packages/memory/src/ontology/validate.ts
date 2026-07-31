/**
 * ontology/validate — 写入校验（白名单闸门）
 *
 * upsert 前校验：实体类型 / 关系类型 ∈ 白名单；facts 非空；confidence 0~1。
 * 不满足 → rejected；实体类型缺失 → 提示可进确认队列（new_entity）。
 */

import type { UpsertEntityInput } from '../memory-types.js';
import { isEntityType, isRelationType } from './schema.js';

export interface ValidationResult {
  ok: boolean;
  /** 明确拒绝的原因（类型非法等） */
  rejectReason?: string;
  /** 需人工确认的原因（如实体类型不在白名单但值得保留） */
  needConfirmReason?: 'new_entity';
}

export function validateUpsert(input: UpsertEntityInput): ValidationResult {
  if (!input.name?.trim()) {
    return { ok: false, rejectReason: '实体名不能为空' };
  }
  const conf = input.confidence ?? 0.5;
  if (conf < 0 || conf > 1) {
    return { ok: false, rejectReason: 'confidence 必须在 0~1' };
  }
  if (!input.entityType) {
    return { ok: false, rejectReason: '缺少 entityType' };
  }
  if (!isEntityType(input.entityType)) {
    // 不在白名单：拒绝（防污染），提示可走 new_entity 确认
    return { ok: false, rejectReason: `entityType "${input.entityType}" 不在白名单`, needConfirmReason: 'new_entity' };
  }
  for (const rel of input.relations ?? []) {
    if (!isRelationType(rel.relationType)) {
      return { ok: false, rejectReason: `relationType "${rel.relationType}" 不在白名单` };
    }
  }
  if (!input.facts?.length && !input.relations?.length) {
    return { ok: false, rejectReason: '至少提供一条 facts 或 relations（原子事实）' };
  }
  return { ok: true };
}
