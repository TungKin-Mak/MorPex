/**
 * 领域插件工具链测试（L9 Workflow / xjmcu 硬件域）— 环境驱动退化路径
 *
 * 覆盖：
 *   - xjmcu.compile / xjmcu.pipeline：buildcli/astrocli 工具链不可用（vi.mock child_process 模拟）
 *     → 优雅降级 {success:false, error}，不崩溃（真实环境就绪即走真实编译）
 *   - xjmcu.generate：纯 fs 生成 C 源码（无工具链依赖）→ 真实产出文件
 *   - canHandle 关键词匹配
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const TMP = path.join(os.tmpdir(), `morpex-toolchain-${Date.now()}`);
fs.mkdirSync(TMP, { recursive: true });

afterAll(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
});

// 模拟工具链不可用：execSync 抛错（= buildcli/astrocli 未安装）
vi.mock('child_process', () => ({
  execSync: () => { throw new Error('buildcli/astrocli 工具链不存在'); },
}));

describe('xjmcu.compile — 工具链降级', () => {
  it('canHandle 匹配固件/编译关键词', async () => {
    const { XJMcuCompileAction } = await import('../../workflows/xjmcu/src/actions/compile.js');
    const a = new XJMcuCompileAction();
    expect(a.canHandle('编译 XJ MCU 固件')).toBeGreaterThan(0);
    expect(a.canHandle('优化网页排版')).toBe(0);
  });

  it('chip/source 缺失 → 明确参数错误', async () => {
    const { XJMcuCompileAction } = await import('../../workflows/xjmcu/src/actions/compile.js');
    const a = new XJMcuCompileAction();
    const r = await a.execute({ chip: 'XC8P9530' }, { departmentId: 'hardware' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('必填');
  });

  it('工具链不存在 → 优雅降级 {success:false, error} 不崩溃', async () => {
    const { XJMcuCompileAction } = await import('../../workflows/xjmcu/src/actions/compile.js');
    const a = new XJMcuCompileAction();
    const r = await a.execute(
      { chip: 'XC8P9530', source: 'fake_main.c', output: TMP },
      { departmentId: 'hardware' },
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain('工具链不存在');
  });
});

describe('xjmcu.pipeline — 全流程降级', () => {
  it('canHandle 匹配全流程/流水线', async () => {
    const { XJMcuPipelineAction } = await import('../../workflows/xjmcu/src/actions/pipeline.js');
    const a = new XJMcuPipelineAction();
    expect(a.canHandle('xjmcu 全流程流水线')).toBeGreaterThan(0);
  });

  it('工具链不存在 → 编译步骤降级（success:true + steps.compile.ok=false）', async () => {
    const { XJMcuPipelineAction } = await import('../../workflows/xjmcu/src/actions/pipeline.js');
    const a = new XJMcuPipelineAction();
    const r = await a.execute({ chip: 'XC8P9530', output: TMP }, { departmentId: 'hardware' });
    // 契约：编译步骤失败被捕获记录，不中断流水线（partial 报告）
    expect(r.success).toBe(true);
    const steps = (r.data as { steps: Record<string, any> }).steps;
    expect(steps.gen).toBeTruthy(); // 源码生成成功
    expect(steps.compile.ok).toBe(false); // 工具链缺失 → 编译步骤降级
  });
});

describe('xjmcu.generate — 源码生成（无工具链依赖）', () => {
  it('生成 C 源码文件到指定目录', async () => {
    const { XJMcuGenerateAction } = await import('../../workflows/xjmcu/src/actions/generate.js');
    const a = new XJMcuGenerateAction();
    const r = await a.execute({ chip: 'XC8P9530', requirement: '点亮 LED', output: TMP }, {});
    expect(r.success).toBe(true);
    const file = (r.data as { sourcePath: string }).sourcePath;
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, 'utf-8');
    expect(content).toContain('#include "XC8P9530.h"');
  });

  it('chip 缺失 → 参数错误', async () => {
    const { XJMcuGenerateAction } = await import('../../workflows/xjmcu/src/actions/generate.js');
    const a = new XJMcuGenerateAction();
    const r = await a.execute({}, {});
    expect(r.success).toBe(false);
    expect(r.error).toContain('chip 必填');
  });
});
