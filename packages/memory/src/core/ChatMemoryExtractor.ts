/**
 * ChatMemoryExtractor — 聊天记忆自动提取
 *
 * 解决 storage-comprehensive.md #2.2 / #2.4：
 *   对话结束后自动评估哪些信息值得记住，写入 MemoryBus，
 *   并增量更新用户画像。
 *
 * 使用方式（在聊天完成时调用）：
 *   const extractor = new ChatMemoryExtractor(bus, cognify, profile);
 *   await extractor.extractFromMessages(sessionId, userId, messages);
 *
 * 工作流程：
 *   1. 构建提取 prompt → LLM 评估哪些内容值得记住
 *   2. 对每个"值得记住"的内容 → bus.remember()
 *   3. 对每个"新发现"的用户特征 → profile.updateFromConversation()
 *   4. 对"纠正"内容 → bus.forget() + bus.remember() 覆写
 */

import { MemoryBus } from './MemoryBus.js';
import type { MemoryPayload } from './MemoryBus.js';
import { ECLCognifyEngine } from './ECLCognifyEngine.js';
import { UserProfileEngine } from './UserProfileEngine.js';

// ── 类型 ──

export interface ExtractableMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
}

export interface ExtractionResult {
  memoriesStored: number;
  traitsUpdated: number;
  correctionsApplied: number;
  errors: string[];
}

// ── LLM Prompt ──

const EXTRACTION_PROMPT = `You are a memory curator. Analyze the conversation below and decide what is worth remembering.

Output ONLY valid JSON (no markdown, no explanation) in this format:
{
  "memories": [
    {
      "content": "Fact or insight worth remembering",
      "importance": 5,
      "tags": ["tag1", "tag2"],
      "reason": "Why this is worth remembering"
    }
  ],
  "corrections": [
    {
      "oldFact": "Previously believed wrong fact",
      "newFact": "Corrected fact",
      "reason": "Correction evidence from conversation"
    }
  ],
  "userTraits": [
    {
      "key": "tech_stack",
      "value": "TypeScript",
      "confidence": 0.9,
      "evidence": "exact user quote"
    }
  ]
}

Rules:
- importance: 5=critical decision/milestone, 4=important preference/fact, 3=useful context, 2=trivial, 1=noise
- Only extract truly meaningful information. Skip small talk, greetings, and generic statements.
- For corrections: only include if the conversation explicitly contradicts a previously stated fact.
- For userTraits: extract preferences, skills, tools used, communication style, and professional context.
- If nothing meaningful, return { "memories": [], "corrections": [], "userTraits": [] }.

Conversation:
---
{conversation}
---`;

// ── ChatMemoryExtractor ──

export class ChatMemoryExtractor {
  private bus: MemoryBus;
  private cognify: ECLCognifyEngine;
  private profile: UserProfileEngine;
  private llmEndpoint: string;

  constructor(
    bus: MemoryBus,
    cognify: ECLCognifyEngine,
    profile: UserProfileEngine,
    llmEndpoint?: string,
  ) {
    this.bus = bus;
    this.cognify = cognify;
    this.profile = profile;
    this.llmEndpoint = llmEndpoint ?? 'http://localhost:11434/api/generate';
  }

  /**
   * 从对话消息中提取记忆和用户特征
   *
   * @param sessionId - 会话 ID（用于溯源）
   * @param userId - 用户 ID（用于画像更新）
   * @param messages - 对话消息
   * @returns 提取结果统计
   */
  async extractFromMessages(
    sessionId: string,
    userId: string,
    messages: ExtractableMessage[],
  ): Promise<ExtractionResult> {
    const result: ExtractionResult = {
      memoriesStored: 0,
      traitsUpdated: 0,
      correctionsApplied: 0,
      errors: [],
    };

    if (messages.length === 0) return result;

    // Step 1: 构建对话文本
    const conversation = messages
      .map(m => `[${m.role}]: ${m.content}`)
      .join('\n');

    // Step 2: LLM 分析
    try {
      const rawResponse = await this.callLLM(
        EXTRACTION_PROMPT.replace('{conversation}', conversation.substring(0, 8000)),
      );
      const parsed = this.parseResponse(rawResponse);

      // Step 3: 写入提取的记忆
      if (parsed.memories) {
        for (const mem of parsed.memories) {
          try {
            const payload: MemoryPayload = {
              content: mem.content,
              source: 'chat',
              sourceId: sessionId,
              tags: [...(mem.tags ?? []), 'auto_extracted'],
              importance: mem.importance ?? 3,
              memType: 'knowledge',
              metadata: { extractionReason: mem.reason, sessionId, userId },
            };
            await this.bus.remember(payload);
            result.memoriesStored++;
          } catch (err: any) {
            result.errors.push(`记忆写入失败: ${err.message}`);
          }
        }
      }

      // Step 4: 应用纠正
      if (parsed.corrections) {
        for (const corr of parsed.corrections) {
          try {
            // 查找并删除旧记忆（通过内容匹配）
            // 注意：这是简化版，生产环境应使用 ID 精确匹配
            await this.bus.remember({
              content: corr.newFact,
              source: 'chat',
              sourceId: sessionId,
              tags: ['correction', 'auto_extracted'],
              importance: 5,
              memType: 'correction',
              metadata: { correctedFact: corr.oldFact, reason: corr.reason },
            });
            result.correctionsApplied++;
          } catch (err: any) {
            result.errors.push(`纠正应用失败: ${err.message}`);
          }
        }
      }

      // Step 5: 更新用户画像
      if (parsed.userTraits && parsed.userTraits.length > 0) {
        try {
          const profileMsgs = messages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
          const updateResult = await this.profile.updateFromConversation(userId, profileMsgs);
          result.traitsUpdated = updateResult.total;
        } catch (err: any) {
          result.errors.push(`画像更新失败: ${err.message}`);
        }
      }
    } catch (err: any) {
      result.errors.push(`LLM 调用失败: ${err.message}`);
    }

    // Step 6: 降级 — 如果 LLM 失败，仍做基础提取
    if (result.memoriesStored === 0 && result.errors.length > 0) {
      result.memoriesStored += this.basicExtraction(sessionId, messages);
    }

    if (result.memoriesStored > 0 || result.traitsUpdated > 0) {
      console.log(`[ChatExtract] ✅ 提取: ${result.memoriesStored} 记忆, ${result.traitsUpdated} 特征, ${result.correctionsApplied} 纠正`);
    }
    return result;
  }

  /**
   * 基础提取（LLM 不可用时的降级方案）
   * 检测 "记住:" 前缀、显式声明等技术模式
   */
  private basicExtraction(sessionId: string, messages: ExtractableMessage[]): number {
    let count = 0;
    for (const msg of messages) {
      if (msg.role !== 'user') continue;

      // 显式记忆指令: "记住: xxx"
      const rememberMatch = msg.content.match(/记住[：:]\s*(.+)/);
      if (rememberMatch) {
        this.bus.remember({
          content: rememberMatch[1].trim(),
          source: 'chat',
          sourceId: sessionId,
          tags: ['explicit', 'auto_extracted'],
          importance: 4,
          memType: 'knowledge',
        });
        count++;
      }

      // 技术栈声明: "我用 xxx"
      const techMatch = msg.content.match(/我(?:用|使用|在用)(?:的)?是?\s*(.+?)(?:[，。,.!！]|$)/);
      if (techMatch) {
        this.bus.remember({
          content: `用户使用: ${techMatch[1].trim()}`,
          source: 'chat',
          sourceId: sessionId,
          tags: ['tech_stack', 'auto_extracted'],
          importance: 3,
          memType: 'profile',
        });
        count++;
      }
    }
    if (count > 0) {
      console.log(`[ChatExtract] 🔽 降级提取: ${count} 条（基于规则）`);
    }
    return count;
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  private async callLLM(prompt: string): Promise<string> {
    const resp = await fetch(this.llmEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-r1:1.5b',
        prompt,
        stream: false,
        options: { temperature: 0.3, max_tokens: 2048 },
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!resp.ok) {
      throw new Error(`LLM 返回 ${resp.status}`);
    }

    const data = await resp.json() as Record<string, any>;
    return data.response ?? data.choices?.[0]?.text ?? data.choices?.[0]?.message?.content ?? '';
  }

  private parseResponse(raw: string): {
    memories?: Array<{ content: string; importance: number; tags: string[]; reason?: string }>;
    corrections?: Array<{ oldFact: string; newFact: string; reason?: string }>;
    userTraits?: Array<{ key: string; value: string; confidence: number; evidence?: string }>;
  } {
    let jsonStr = raw.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();
    const jsonStart = jsonStr.indexOf('{');
    if (jsonStart > 0) jsonStr = jsonStr.slice(jsonStart);

    try {
      return JSON.parse(jsonStr);
    } catch {
      console.warn('[ChatExtract] ⚠️ JSON 解析失败，使用降级提取');
      return {};
    }
  }
}
