/**
 * pi-bridge-extra-provider 测试 — 附加模型（llm_* 块）接入
 *
 * 覆盖：
 *   1. yamlConfig：llm_* 顶层块解析为 extraLlms + ${VAR} 环境变量引用
 *   2. PiBridge：builtin 基底 + 附加 gateway provider 并存注册（默认模型不变）
 *   3. 附加 provider 注册过滤（enabled=false / 缺字段跳过）
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMorpexConfig, getEnabledExtraLlms, isExtraLlmUsable } from '../src/infrastructure/adapters/pi-bridge/yamlConfig.js';
import { PiBridge } from '../src/infrastructure/adapters/pi-bridge/PiBridge.js';

// ═══════════════════════════════════════════════════════
// 辅助：临时 cwd + 配置文件
// ═══════════════════════════════════════════════════════

const oldCwd = process.cwd();
let tempDir: string | null = null;

function withTempConfig(yaml: string): string {
  tempDir = mkdtempSync(join(tmpdir(), 'morpex-extra-'));
  // PiBridge 构造器读 resolve(process.cwd(), 'config/morpex.yaml')——需写进 config/ 子目录
  const cfgDir = join(tempDir, 'config');
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(join(cfgDir, 'morpex.yaml'), yaml);
  process.chdir(tempDir);
  return tempDir;
}

afterEach(() => {
  process.chdir(oldCwd);
  if (tempDir) {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    tempDir = null;
  }
});

// ═══════════════════════════════════════════════════════
// 1. yamlConfig：llm_* 解析
// ═══════════════════════════════════════════════════════

describe('yamlConfig.loadMorpexConfig — 附加模型 llm_* 块', () => {
  it('解析 llm_minicpm 块到 extraLlms，并解析 ${VAR} 环境变量引用', () => {
    process.env.MORPEX_TEST_MINICPM_KEY = 'test-key-123';
    try {
      const dir = withTempConfig(
        `llm:\n  mode: builtin\n  provider: opencode\n  model: deepseek-v4-flash-free\n` +
        `llm_minicpm:\n  mode: gateway\n  enabled: true\n  provider: minicpm\n  model: minicpm5\n` +
        `  baseUrl: http://127.0.0.1:8080/v1\n  apiKey: \${MORPEX_TEST_MINICPM_KEY}\n` +
        `  contextWindow: 32768\n  maxTokens: 8192\n  reasoning: true\n`,
      );
      const cfg = loadMorpexConfig(join(dir, 'config', 'morpex.yaml'));
      expect(cfg?.extraLlms).toHaveLength(1);
      expect(cfg?.extraLlms?.[0]).toMatchObject({
        mode: 'gateway',
        provider: 'minicpm',
        model: 'minicpm5',
        baseUrl: 'http://127.0.0.1:8080/v1',
        apiKey: 'test-key-123', // ${VAR} 已解析
        contextWindow: 32768,
        maxTokens: 8192,
        reasoning: true,
      });
      // 主 llm 块不受影响
      expect(cfg?.llm?.provider).toBe('opencode');
    } finally {
      delete process.env.MORPEX_TEST_MINICPM_KEY;
    }
  });

  it('无 llm_* 块 → extraLlms 为空', () => {
    const dir = withTempConfig('llm:\n  enabled: true\n  provider: opencode\n  model: deepseek-v4-flash-free\n');
    const cfg = loadMorpexConfig(join(dir, 'config', 'morpex.yaml'));
    expect(cfg?.extraLlms).toBeUndefined();
  });

  it('isExtraLlmUsable — 三处共用过滤条件（enabled=false / 缺字段跳过；缺 enabled 视为可用）', () => {
    expect(isExtraLlmUsable({ provider: 'a', model: 'm', baseUrl: 'http://x/v1' })).toBe(true); // 缺 enabled → 可用
    expect(isExtraLlmUsable({ enabled: true, provider: 'a', model: 'm', baseUrl: 'http://x/v1' })).toBe(true);
    expect(isExtraLlmUsable({ enabled: false, provider: 'a', model: 'm', baseUrl: 'http://x/v1' })).toBe(false);
    expect(isExtraLlmUsable({ enabled: true, provider: 'a', model: 'm' })).toBe(false); // 缺 baseUrl
    expect(isExtraLlmUsable({ enabled: true, provider: 'a', baseUrl: 'http://x/v1' })).toBe(false); // 缺 model
    expect(isExtraLlmUsable({ enabled: true, model: 'm', baseUrl: 'http://x/v1' })).toBe(false); // 缺 provider
  });

  it('getEnabledExtraLlms — 过滤后仅剩可用块（与 PiBridge 注册一致）', () => {
    const dir = withTempConfig(
      `llm:\n  enabled: true\n  provider: opencode\n  model: m\n` +
      `llm_ok:\n  provider: ok\n  model: okm\n  baseUrl: http://localhost:9/v1\n` +
      `llm_off:\n  enabled: false\n  provider: off\n  model: offm\n  baseUrl: http://localhost:9/v1\n` +
      `llm_broken:\n  provider: broken\n  model: brokenm\n`,
    );
    const cfg = loadMorpexConfig(join(dir, 'config', 'morpex.yaml'));
    const enabled = getEnabledExtraLlms(cfg);
    expect(enabled.map((g) => g.provider)).toEqual(['ok']);
  });
});

// ═══════════════════════════════════════════════════════
// 2. PiBridge：builtin 基底 + 附加 provider 并存
// ═══════════════════════════════════════════════════════

describe('PiBridge — 附加模型注册', () => {
  it('builtin 基底 + 附加 gateway provider 并存注册，默认模型不变', async () => {
    withTempConfig(
      `llm:\n  mode: builtin\n  enabled: true\n  provider: opencode\n  model: deepseek-v4-flash-free\n` +
      `llm_minicpm:\n  mode: gateway\n  enabled: true\n  provider: minicpm\n  model: minicpm5\n` +
      `  baseUrl: http://127.0.0.1:8080/v1\n  apiKey: ''\n  contextWindow: 32768\n  maxTokens: 8192\n  reasoning: true\n`,
    );
    const bridge = new PiBridge();
    expect(bridge.defaultModel).toBe('opencode/deepseek-v4-flash-free');

    await bridge.init();
    expect(bridge.ready).toBe(true);

    // 附加 provider 已注册
    expect(bridge.listProviders()).toContain('minicpm');
    const model = bridge.findModel('minicpm', 'minicpm5');
    expect(model).toBeDefined();
    expect(model?.id).toBe('minicpm5');
    expect(model?.contextWindow).toBe(32768);
    expect(model?.maxTokens).toBe(8192);
    expect(model?.reasoning).toBe(true);
    expect(model?.provider).toBe('minicpm');

    // builtin 基底仍在（opencode provider 存在）
    expect(bridge.listProviders()).toContain('opencode');
  });

  it('enabled=false 或缺 baseUrl 的附加块跳过注册', async () => {
    withTempConfig(
      `llm:\n  mode: builtin\n  enabled: true\n  provider: opencode\n  model: deepseek-v4-flash-free\n` +
      `llm_off:\n  mode: gateway\n  enabled: false\n  provider: offprov\n  model: offmodel\n  baseUrl: http://localhost:9/v1\n` +
      `llm_nobase:\n  mode: gateway\n  enabled: true\n  provider: nobase\n  model: nobasemodel\n`,
    );
    const bridge = new PiBridge();
    await bridge.init();
    expect(bridge.listProviders()).not.toContain('offprov');
    expect(bridge.listProviders()).not.toContain('nobase');
    // 主 provider 不受影响
    expect(bridge.listProviders()).toContain('opencode');
  });
});
