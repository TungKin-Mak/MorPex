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
  isGenerativePrimitive,
  inferArtifactType,
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

describe('路径分配（方案 B：生成类跳过参数提取）', () => {
  it('isGenerativePrimitive 识别生成类原语', () => {
    expect(isGenerativePrimitive('artifact_generation')).toBe(true);
    expect(isGenerativePrimitive('file_operation')).toBe(false);
    expect(isGenerativePrimitive('knowledge_query')).toBe(false);
    expect(isGenerativePrimitive('shell_execution')).toBe(false);
    expect(isGenerativePrimitive('api_call')).toBe(false);
  });

  it('inferArtifactType 按目标关键词推断类型', () => {
    expect(inferArtifactType('生成电商价格合规检查报告')).toBe('report');
    expect(inferArtifactType('帮我做一份销售报表')).toBe('report');
    expect(inferArtifactType('生成 MCU 初始化代码')).toBe('code');
    expect(inferArtifactType('编写配置文件')).toBe('config');
    expect(inferArtifactType('分析销售数据')).toBe('data');
    expect(inferArtifactType('生成设计文档')).toBe('doc');
    expect(inferArtifactType('随便写点什么')).toBe('doc'); // 默认
  });
});
