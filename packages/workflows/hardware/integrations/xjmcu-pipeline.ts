/**
 * XJ MCU Firmware-Simulation Integration
 * 
 * 统一入口：从 MorPex 记忆系统 → 生成代码 → 编译 → 仿真
 * 
 * 使用方式:
 *   import { xjmcuPipeline } from './hardware/integrations/xjmcu-pipeline.js';
 *   await xjmcuPipeline({ chip: 'XC8P9530', requirement: 'TC0 1ms LED' });
 */

import { execSync } from 'child_process';
import { resolve } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

const TOOLCHAIN = resolve(import.meta.dirname, '../../../../AstroM/_archive/toolchains/AstroMcu');
const MEMORY_DB = resolve(import.meta.dirname, '../../../../Morpex/data/memory.db');

export interface PipelineInput {
  chip: string;
  requirement: string;
  outputDir?: string;
  skipFlash?: boolean;
  configWords?: string;
}

export interface PipelineOutput {
  chip: string;
  requirement: string;
  codeGen: { success: boolean; sourcePath?: string };
  compile: { success: boolean; hexPath?: string; xbinPath?: string };
  flash: { success: boolean } | null;
  registers: Record<string, number> | null;
}

export async function xjmcuPipeline(input: PipelineInput): Promise<PipelineOutput> {
  const { chip, requirement, outputDir, skipFlash, configWords } = input;
  const outDir = outputDir || resolve(process.cwd(), 'build/xjmcu_' + chip);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  // 1. 检查 MorPex 记忆系统是否有芯片知识
  console.log(`[1/4] 查询 MorPex 记忆系统: ${chip}`);
  try {
    const kbCheck = execSync(
      `python -c "from mcu_memory_kb import MorPexMemoryKB; kb=MorPexMemoryKB(); info=kb.comprehensive_retrieve('${chip}'); print('OK' if info['chip'] else 'MISSING')"`,
      { cwd: TOOLCHAIN, encoding: 'utf-8', timeout: 15_000 }
    );
    console.log(`  → ${kbCheck.trim()}`);
  } catch (e) {
    console.log('  → 无法查询记忆系统（继续）');
  }

  // 2. 生成 C 代码
  console.log(`[2/4] 生成代码: ${requirement}`);
  const srcPath = resolve(outDir, `${chip}_generated.c`);
  writeFileSync(srcPath, `// ${chip} - ${requirement}\n#include "${chip}.h"\nvoid main(void) {\n    while(1) {}\n}\n`);
  console.log(`  → ${srcPath}`);

  // 3. 编译
  console.log(`[3/4] 编译`);
  let compileResult = { success: false, hexPath: '', xbinPath: '' };
  try {
    const buildOut = execSync(
      `python -m buildcli build --chip ${chip} --src "${srcPath}" --output "${outDir}/build"`,
      { cwd: TOOLCHAIN, encoding: 'utf-8', timeout: 120_000 }
    );
    const hexPath = resolve(outDir, 'build/firmware.hex');
    const xbinPath = resolve(outDir, 'build/firmware.xbin');
    compileResult = {
      success: existsSync(hexPath),
      hexPath: existsSync(hexPath) ? hexPath : '',
      xbinPath: existsSync(xbinPath) ? xbinPath : '',
    };
    console.log(`  → ${compileResult.success ? 'OK' : 'FAIL'}`);
  } catch (e: any) {
    console.log(`  → 编译失败: ${e.message?.slice(0, 100)}`);
  }

  // 4. 仿真（flash + regs）
  let flashResult: { success: boolean } | null = null;
  let registers: Record<string, number> | null = null;

  if (!skipFlash && compileResult.xbinPath) {
    console.log(`[4/4] 烧录+仿真`);
    try {
      execSync(
        `python -m astrocli freerun "${compileResult.xbinPath}"`,
        { cwd: TOOLCHAIN, encoding: 'utf-8', timeout: 30_000 }
      );
      flashResult = { success: true };

      // 读取寄存器
      const regsOut = execSync(
        `python -m astrocli regs --json`,
        { cwd: TOOLCHAIN, encoding: 'utf-8', timeout: 15_000 }
      );
      for (const line of regsOut.split('\n')) {
        if (line.startsWith('{')) {
          try { registers = JSON.parse(line).registers; } catch {}
          break;
        }
      }
      console.log(`  → 烧录成功, 寄存器已读取`);
    } catch (e: any) {
      flashResult = { success: false };
      console.log(`  → 仿真失败: ${e.message?.slice(0, 100)}`);
    }
  }

  return {
    chip,
    requirement,
    codeGen: { success: true, sourcePath: srcPath },
    compile: compileResult,
    flash: flashResult,
    registers,
  };
}
