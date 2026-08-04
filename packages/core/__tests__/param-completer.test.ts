/**
 * paramCompleter 测试 — 原语参数补全/校验层
 *
 * 背景：50 任务实测 GLM 失败主因是工具参数缺必填字段（type/query undefined）。
 * 方案：按 inputSchema.required 校验，缺失字段二次 LLM 提取补全。
 */
import { describe, it, expect } from 'vitest';
import {
  getRequiredParams,
  validatePrimitiveParams,
  buildExtractPrompt,
} from '../src/infrastructure/tools/paramCompleter.js';

const artifactSchema = {
  type: 'object',
  properties: { type: { type: 'string' }, specification: { type: 'string' } },
  required: ['type', 'specification'],
};

describe('paramCompleter', () => {
  it('getRequiredParams 从 schema 读必填字段', () => {
    expect(getRequiredParams(artifactSchema)).toEqual(['type', 'specification']);
    expect(getRequiredParams({ type: 'object', required: ['query'] })).toEqual(['query']);
    expect(getRequiredParams({})).toEqual([]);
    expect(getRequiredParams(undefined)).toEqual([]);
  });

  it('validatePrimitiveParams 识别缺失字段（null/undefined/空串）', () => {
    expect(validatePrimitiveParams(artifactSchema, { type: 'report', specification: 'x' })).toEqual([]);
    expect(validatePrimitiveParams(artifactSchema, { specification: 'x' })).toEqual(['type']);
    expect(validatePrimitiveParams(artifactSchema, { type: 'report' })).toEqual(['specification']);
    expect(validatePrimitiveParams(artifactSchema, { type: '', specification: undefined })).toEqual(['type', 'specification']);
  });

  it('buildExtractPrompt 无缺失 → 基础 prompt；有缺失 → 带补全提示', () => {
    const base = buildExtractPrompt('生成报告', 'artifact_generation', '{"required":["type"]}');
    expect(base).toContain('直接输出纯 JSON');
    expect(base).not.toContain('缺失');

    const withMissing = buildExtractPrompt('生成报告', 'artifact_generation', '{"required":["type"]}', ['type']);
    expect(withMissing).toContain('必填参数缺失，必须补全：type');
  });
});
