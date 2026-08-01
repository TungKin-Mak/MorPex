/**
 * XJMcuWorkflowPlugin v3.0 — 矽杰微 MCU 工作流插件
 *
 * @deprecated 领域逻辑必须位于 packages/workflows/xjmcu/（No Domain Logic in Core）。
 *   本文件已无外部消费者，保留仅为兼容；新实现请使用 packages/workflows/xjmcu/。
 *
 * 工作流（与工程师实际开发方式一致）:
 *   1. 找 Demo: 从记忆系统提取需要的外设 Demo 代码
 *   2. 查寄存器: 提供 datasheet 的 SFR 位定义
 *   3. LLM 融合: Demo 框架 + 寄存器配置 + 用户逻辑
 *
 * 适配所有矽杰微芯片 — 知识全部来自记忆系统
 */

import type { MorPexPlugin, PluginContext } from '../../common/types.js';

export class MissingKnowledgeError extends Error {
  constructor(domain: string, key: string, detail?: string) {
    super(`[MissingKnowledge] ${domain}: ${key} — ${detail || ''}`);
    this.name = 'MissingKnowledgeError';
  }
}

export interface GenerateCodeOptions {
  chip: string;
  requirement: string;
  /** 需要用到哪些外设的 Demo */
  demos: string[];
  model?: string;
}

export class XJMcuWorkflowPlugin implements MorPexPlugin {
  readonly name = 'xjmcu-workflow';
  readonly version = '3.0.0';
  readonly dependencies: string[] = [];
  private db: any = null;
  private missionsDb: any = null;
  private piBridge: any = null;
  private initialized = false;

  async initialize(_context: PluginContext): Promise<void> {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    try {
      const BetterDB = require('better-sqlite3');
      this.db = new BetterDB('./data/memory.db', { readonly: true });
      this.db.pragma('journal_mode=WAL');
      try { this.missionsDb = new BetterDB('./data/missions.db', { readonly: true }); this.missionsDb.pragma('journal_mode=WAL'); } catch { this.missionsDb = null; }
      console.log('[XJMcuPlugin] ✅ 记忆系统连接就绪');
    } catch (err) {
      console.warn('[XJMcuPlugin] ⚠️ 记忆系统不可用:', (err as Error).message);
    }
    try {
      const { PiBridge } = await import('../../adapters/pi-bridge/PiBridge.js');
      this.piBridge = new PiBridge();
      await this.piBridge.init();
      console.log('[XJMcuPlugin] ✅ PiBridge 就绪');
    } catch (err) {
      console.warn('[XJMcuPlugin] ⚠️ PiBridge 不可用:', (err as Error).message);
    }
    this.initialized = true;
  }

  async start(): Promise<void> { console.log(`[XJMcuPlugin] v${this.version} 已启动`); }
  async stop(): Promise<void> {
    if (this.db) try { this.db.close(); } catch {}
    if (this.missionsDb) try { this.missionsDb.close(); } catch {}
    this.initialized = false;
  }

  // ═══════════════════════════════════════════════════════════
  // 知识检索
  // ═══════════════════════════════════════════════════════════

  retrieveKnowledge(chipName: string): Record<string, any> {
    if (!this.db) throw new Error('记忆系统未初始化');
    const chip = this.db.prepare("SELECT * FROM kg_entities WHERE name = ? AND type = 'MCU'").get(chipName);
    if (!chip) throw new MissingKnowledgeError('chip', chipName, '请先导入 datasheet');

    const chipData = JSON.parse(chip.data_json || '{}');
    const rels = this.db.prepare("SELECT to_id FROM kg_relations WHERE from_id = ? AND type = 'has_peripheral'").all(chip.id);
    const peripherals = rels.map((r: any) => {
      const p = this.db.prepare("SELECT * FROM kg_entities WHERE id = ?").get(r.to_id);
      return p ? { name: p.name, data: JSON.parse(p.data_json || '{}') } : null;
    }).filter(Boolean);
    const sfrs = this.db.prepare("SELECT * FROM kg_entities WHERE type = 'SFR' ORDER BY name").all()
      .map((r: any) => ({ name: r.name, data: JSON.parse(r.data_json || '{}') }));
    const mems = this.db.prepare("SELECT id, content, tags FROM memory_entries WHERE tags LIKE ? OR tags LIKE ?")
      .all(`%${chipName.toLowerCase()}%`, '%adc%');
    let sops: any[] = [];
    if (this.missionsDb) {
      try { sops = this.missionsDb.prepare("SELECT * FROM shared_experiences WHERE tags LIKE ?").all(`%${chipName.toLowerCase()}%`); } catch {}
    }
    return { chip: { ...chip, data: chipData }, peripherals, sfrs, memories: mems, sops };
  }

  // ═══════════════════════════════════════════════════════════
  // Prompt 组装 — 和工程师实际开发流程一样
  // ═══════════════════════════════════════════════════════════

  buildPrompt(knowledge: Record<string, any>, options: GenerateCodeOptions): { system: string; user: string } {
    const cd = knowledge.chip.data;

    // system: 简短角色
    const system = `你是矽杰微 MCU C 代码生成专家。根据用户提供的 Demo 代码 + 寄存器定义 + 需求，融合生成完整 C 程序。`;

    // user: 按工程师思维组织
    let user = `请为 ${knowledge.chip.name} 生成 C 代码。\n\n`;

    // 第一步：芯片规格
    user += `## 1. 芯片\n`;
    user += `型号 ${knowledge.chip.name} | ${cd.arch || '8-bit'} | ROM ${cd.rom || '?'} | RAM ${cd.ram || '?'} | ${cd.freq || '?'}\n\n`;

    // 第二步：外设 Demo 代码（这是核心——工程师先找 Demo）
    user += `## 2. 参考 Demo 代码\n`;
    user += `以下是为 ${knowledge.chip.name} 提供的外设 Demo。请以这些 Demo 为基础进行修改和融合。\n`;
    user += `保留 Demo 中的中断框架、寄存器初始化模式、函数命名风格。\n`;
    const addedDemos = new Set<string>();
    for (const demoTag of options.demos) {
      // 从记忆系统找对应标签的 Demo
      const demos = this.db!.prepare(
        "SELECT id, content FROM memory_entries WHERE tags LIKE ? AND (tags LIKE '%demo%' OR tags LIKE '%program%')"
      ).all(`%${demoTag}%`);
      for (const d of demos) {
        if (!addedDemos.has(d.id)) {
          user += `\n### Demo: ${d.id}\n`;
          // 只取前 100 行作为参考
          const lines = d.content.split('\n');
          user += lines.slice(0, 100).join('\n') + '\n';
          if (lines.length > 100) user += `// ... (${lines.length - 100} lines omitted)\n`;
          addedDemos.add(d.id);
        }
      }
    }
    if (addedDemos.size === 0) {
      user += `(记忆系统中没有 ${options.demos.join('/')} 的 Demo 代码，请提供)\n`;
    }

    // 第三步：寄存器定义（供查表确认 bit 位置）
    user += `\n## 3. 寄存器位定义（请根据此表配置寄存器）\n`;
    const keySFRs = ['ADCON0','ADCON1','ADATH0','ADATL','ADATH1','TC0CON','TC0C',
      'TC1CON','TC1PRDL','TC1PRDTH','PWM1DTL','PWM2DTL','PWM3DTL',
      'PWMCON1','PWMCON2','PWM7CON','INTE0','INTF0','P5CON','P5AE','P6CON'];
    for (const sfr of knowledge.sfrs) {
      if (keySFRs.includes(sfr.name)) {
        user += `${sfr.name} @ ${sfr.data.address || '?'}\n`;
        if (sfr.data.bits) {
          for (const [pos, info] of Object.entries(sfr.data.bits as Record<string, any>)) {
            user += `  ${pos}: ${info.name} — ${(info.desc || '').substring(0, 80)}\n`;
          }
        }
        if (sfr.data.channel_map) {
          user += `  通道:\n`;
          for (const [k, v] of Object.entries(sfr.data.channel_map)) {
            user += `    ${k} → ${v}\n`;
          }
        }
        user += '\n';
      }
    }

    // 第四步：约束
    user += `## 4. 约束\n`;
    user += `- 头文件: #include "${knowledge.chip.name}.h"\n`;
    user += `- 类型: unsigned char, unsigned int (禁止 unsigned long / uint32_t / struct / typedef)\n`;
    user += `- 中断: void int_isr(void) __interrupt { __asm__("org 0x08"); ... }\n`;
    user += `- 总中断 EI() / DI(), 喂狗 CWDT()\n`;
    user += `- 清 RAM: file_clrRam()\n`;
    user += `- ❌ 禁止: stdint.h / stdbool.h / stdio.h / stdlib.h / printf\n\n`;

    // 第五步：融合任务
    user += `## 5. 任务\n`;
    user += `请参考上面的芯片资料和 Demo 代码，生成完成以下功能的完整 C 程序。\n`;
    user += `保持 Demo 的代码结构，但根据寄存器定义正确配置各 bit。\n\n`;
    user += `${options.requirement}\n`;

    return { system, user };
  }

  async generateCode(options: GenerateCodeOptions): Promise<string> {
    if (!this.piBridge) throw new Error('PiBridge 不可用');
    const knowledge = this.retrieveKnowledge(options.chip);
    const { system, user } = this.buildPrompt(knowledge, options);
    const result = await this.piBridge.generateText({
      model: options.model || 'deepseek/deepseek-v4-flash',
      system, prompt: user, temperature: 0.15, maxTokens: 4096,
    });
    return this.extractCode(result.text);
  }

  private extractCode(text: string): string {
    const m = text.match(/```(?:c|C)?\s*\n([\s\S]*?)```/);
    return m ? m[1].trim() : text.trim();
  }
}
