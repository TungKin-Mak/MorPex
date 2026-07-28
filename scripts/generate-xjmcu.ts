/**
 * generate-xjmcu.ts — MorPex XJ MCU 工作流 v3
 *
 * 流程（和工程师实际开发一致）:
 *   ① 从记忆系统找 Demo 代码 + SFR 定义
 *   ② LLM 融合: Demo 框架 + 寄存器配置 + 用户逻辑
 *   ③ 输出完整 C 程序 → 编译 → 调试
 *
 * 运行:
 *   npx tsx scripts/generate-xjmcu.ts
 */

import { XJMcuWorkflowPlugin } from '../packages/core/src/extensions/xjmcu/XJMcuWorkflowPlugin.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const CHIP = 'XC8P8616';

async function main() {
  console.log(`╔══════════════════════════════════════════╗`);
  console.log(`║  MorPex XJ MCU Workflow v3              ║`);
  console.log(`║  芯片: ${CHIP}                          ║`);
  console.log(`╚══════════════════════════════════════════╝\n`);

  const plugin = new XJMcuWorkflowPlugin();
  await plugin.initialize({} as any);

  // ① 检索知识
  console.log('📖 ① 查资料: 找 Demo + 寄存器定义');
  const knowledge = plugin.retrieveKnowledge(CHIP);
  console.log(`   SFR: ${knowledge.sfrs.length} 个`);
  console.log(`   教程/Demo: ${knowledge.memories.length} 条`);

  // ② LLM 融合
  console.log('\n⚙️  ② 融合: Demo 框架 + 寄存器配置 + 用户逻辑');
  const code = await plugin.generateCode({
    chip: CHIP,
    requirement: `双路ADC采样调节PWM占空比。
逻辑:
  1. 以 ADC Demo 的中断框架为基础 (TC0 1ms + ADC 中断)
  2. 以 PWM Demo 的定时器配置为参考
  3. 配置 ADC 双通道 (AIN0/P50, AIN1/P51)
  4. 配置 PWM1 (P60) 输出 1KHz
  5. 每 10ms 轮流启动 ADC 两个通道
  6. ADC 中断中: 读取结果 → 双路平均 → 映射到 PWM 占空比`,
    demos: ['adc', 'pwm'],  // 指定需要的外设 Demo
  });

  // ③ 保存
  const lines = code.split('\n');
  const dir = path.resolve(`data/${CHIP.toLowerCase()}_workspace`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'main.c'), code, 'utf-8');
  console.log(`\n💾 ③ 输出: ${dir}/main.c (${lines.length} 行)`);

  // 校验
  const checks: [string, boolean][] = [
    ['芯片头文件', new RegExp(`#include\\s+["<]${CHIP}`, 'i').test(code)],
    ['file_clrRam()', /\bfile_clrRam\b/.test(code)],
    ['中断入口 0x08', /org\s+0x08/.test(code)],
    ['EI()', /\bEI\s*\(\)/.test(code)],
    ['CWDT()', /\bCWDT\b/.test(code)],
    ['ADC 初始化', /\bADC_Init\b|\bAdc_Init\b|\bfile_adcSet\b/.test(code)],
    ['PWM 初始化', /\bPWM1_Init\b|\bPWM_Init\b|\bfile_PWM\b/.test(code)],
    ['ADC 中断 (ADIF)', /\bADIF\b/.test(code)],
    ['无 unsigned long', !/unsigned\s+long/.test(code)],
    ['无 stdint.h', !/stdint\.h/.test(code)],
  ];
  let pass = 0;
  for (const [name, ok] of checks) {
    console.log(`   ${ok ? '✅' : '❌'} ${name}`);
    if (ok) pass++;
  }
  console.log(`\n   通过: ${pass}/${checks.length}`);

  await plugin.stop();
  console.log('\n✅ 完成');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
