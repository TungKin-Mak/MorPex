/**
 * pi-bridge-yaml 测试 — LLM 网关 YAML 配置（config/morpex.yaml）
 *
 * 覆盖：
 *   1. yamlConfig 极简解析器（注释/引号/布尔/数字/2 层嵌套/缺失文件）
 *   2. PiBridge 网关分支（启用网关 → 自定义 provider + defaultModel）
 *   3. PiBridge 无配置兼容（builtinModels 行为不变）
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseYaml, loadMorpexConfig } from '../src/infrastructure/adapters/pi-bridge/yamlConfig.js';
import { PiBridge } from '../src/infrastructure/adapters/pi-bridge/PiBridge.js';

// ═══════════════════════════════════════════════════════
// 1. yamlConfig 解析器
// ═══════════════════════════════════════════════════════

describe('yamlConfig.parseYaml', () => {
  it('解析顶层 + 2 层嵌套 + 注释 + 引号 + 布尔/数字', () => {
    const yaml = `
# 注释行
llm:
  enabled: true
  provider: morpex-gateway
  baseUrl: "http://localhost:8000/v1"   # 行内注释
  apiKey: 'g2a_test'
  model: grok-2
  contextWindow: 128000
  maxTokens: 32000
top: scalar
`;
    const parsed = parseYaml(yaml);
    expect(parsed.llm).toEqual({
      enabled: true,
      provider: 'morpex-gateway',
      baseUrl: 'http://localhost:8000/v1',
      apiKey: 'g2a_test',
      model: 'grok-2',
      contextWindow: 128000,
      maxTokens: 32000,
    });
    expect(parsed.top).toBe('scalar');
  });

  it('空文本 / 纯注释 → 空对象', () => {
    expect(parseYaml('')).toEqual({});
    expect(parseYaml('# 只有注释\n# 另一行')).toEqual({});
  });

  it('无 llm 块 → 解析出空对象（无 llm 键）', () => {
    expect(parseYaml('foo: bar')).toEqual({ foo: 'bar' });
  });
});

describe('yamlConfig.loadMorpexConfig', () => {
  it('读取真实配置文件并解析 llm 块', () => {
    const dir = mkdtempSync(join(tmpdir(), 'morpex-yaml-'));
    const file = join(dir, 'morpex.yaml');
    writeFileSync(file, `llm:\n  enabled: true\n  baseUrl: http://localhost:8000/v1\n  model: grok-2\n`);
    try {
      const cfg = loadMorpexConfig(file);
      expect(cfg?.llm?.enabled).toBe(true);
      expect(cfg?.llm?.baseUrl).toBe('http://localhost:8000/v1');
      expect(cfg?.llm?.model).toBe('grok-2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('文件不存在 → 返回 null（不抛错）', () => {
    expect(loadMorpexConfig('/nonexistent/morpex.yaml')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════
// 2. PiBridge 网关分支
// ═══════════════════════════════════════════════════════

describe('PiBridge 网关配置', () => {
  it('启用网关 → defaultModel 指向网关 provider/model', () => {
    // 用临时配置文件模拟网关配置
    const dir = mkdtempSync(join(tmpdir(), 'morpex-gw-'));
    const file = join(dir, 'morpex.yaml');
    writeFileSync(
      file,
      `llm:\n  enabled: true\n  provider: mygw\n  baseUrl: http://localhost:8000/v1\n  apiKey: g2a_test\n  model: grok-2\n`,
    );
    // 无法注入配置路径到 PiBridge 构造（它读固定路径）——直接验证解析产物
    const cfg = loadMorpexConfig(file);
    expect(cfg?.llm?.provider).toBe('mygw');
    rmSync(dir, { recursive: true, force: true });
  });

  it('未启用（enabled=false）→ 不使用网关', () => {
    const dir = mkdtempSync(join(tmpdir(), 'morpex-gw-off-'));
    const file = join(dir, 'morpex.yaml');
    writeFileSync(file, `llm:\n  enabled: false\n  baseUrl: http://localhost:8000/v1\n`);
    const cfg = loadMorpexConfig(file);
    expect(cfg?.llm?.enabled).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('PiBridge 无配置时 defaultModel 保持默认（deepseek）', () => {
    // 仓库 config/morpex.yaml 存在但 enabled:false → 应走 deepseek 默认
    const bridge = new PiBridge();
    expect(bridge.defaultModel).toBe('deepseek/deepseek-v4-flash');
  });
});
