/**
 * UserProfileEngine — 用户画像引擎
 *
 * 从多次对话中逐步积累对用户的了解（Cognee 风格的记忆进化）。
 *
 * 核心能力：
 *   - updateFromConversation() → LLM 增量抽取用户特征
 *   - getProfile() → 返回用户画像
 *   - formatForSystemPrompt() → 生成 LLM system prompt 注入文本
 *
 * 特征（Trait）结构：
 *   key:        特征维度（tech_stack, industry, role, communication_style...）
 *   value:      特征值（"TypeScript", "Healthcare", "architect"...）
 *   confidence: 置信度 0-1（多次确认会提高）
 *   evidence:   原始证据（用户说过的原话）
 *   source:     来源会话 ID
 *
 * 持久化：
 *   data/knowledge/user-profiles.jsonl（一行一个 UserTrait）
 */

import * as fs from 'fs';
import * as path from 'path';

// ── 类型 ──

export interface UserTrait {
  key: string;
  value: string;
  confidence: number;   // 0-1
  source: string;       // 会话 ID 或 'manual'
  evidence: string;     // 用户原话
  updatedAt: number;
}

export interface ProfileUpdateResult {
  added: UserTrait[];
  updated: UserTrait[];
  merged: UserTrait[];    // 合并后的完整画像
  total: number;
}

// ── LLM Prompt ──

const TRAIT_EXTRACTION_PROMPT = `You are a user profiler. Analyze the conversation below and extract traits about the user.

Output ONLY valid JSON (no markdown) in this format:
{
  "traits": [
    {
      "key": "trait_category",
      "value": "specific_value",
      "confidence": 0.8,
      "evidence": "the exact user quote that supports this"
    }
  ]
}

Trait categories include but are not limited to:
- tech_stack: technologies, frameworks, languages the user uses
- industry: the industry/domain the user works in
- role: job title or role (engineer, manager, founder, researcher...)
- experience_level: junior, mid, senior, expert
- communication_style: concise, detailed, visual, code-heavy...
- preferences: any stated preferences about tools, workflows, etc.
- goals: what the user is trying to achieve
- constraints: budget, time, team size limitations

Rules:
1. Only extract traits with confidence >= 0.5
2. Evidence must be a direct quote from the conversation
3. If nothing new is learned, return { "traits": [] }
4. Do not invent traits — every trait must have clear evidence

Conversation:
---
{conversation}
---`;

// ── UserProfileEngine ──

export class UserProfileEngine {
  private profiles: Map<string, UserTrait[]> = new Map();
  private profileFile: string;
  private llmEndpoint: string;
  private llmModel: string;

  constructor(config?: {
    dataDir?: string;
    llmEndpoint?: string;
    llmModel?: string;
  }) {
    const dataDir = path.resolve(config?.dataDir ?? './data/knowledge');
    this.profileFile = path.join(dataDir, 'user-profiles.jsonl');
    this.llmEndpoint = config?.llmEndpoint ?? 'http://localhost:11434/api/generate';
    this.llmModel = config?.llmModel ?? 'deepseek-r1:1.5b';
  }

  // ═══════════════════════════════════════════════════════════════
  // 初始化
  // ═══════════════════════════════════════════════════════════════

  async initialize(): Promise<void> {
    // 确保目录存在
    const dir = path.dirname(this.profileFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 加载已有画像
    if (fs.existsSync(this.profileFile)) {
      try {
        const content = fs.readFileSync(this.profileFile, 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const trait: UserTrait & { userId: string } = JSON.parse(line);
            const userId = trait.userId ?? 'default';
            if (!this.profiles.has(userId)) {
              this.profiles.set(userId, []);
            }
            this.profiles.get(userId)!.push({
              key: trait.key,
              value: trait.value,
              confidence: trait.confidence,
              source: trait.source,
              evidence: trait.evidence,
              updatedAt: trait.updatedAt,
            });
          } catch { /* skip corrupt */ }
        }
        console.log(`[UserProfile] ✅ 已加载 ${this.profiles.size} 个用户画像`);
      } catch (err: any) {
        console.warn(`[UserProfile] ⚠️ 加载失败: ${err.message}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 画像更新
  // ═══════════════════════════════════════════════════════════════

  /**
   * 从一段对话中增量更新用户画像
   *
   * @param userId   用户 ID（默认 'default'）
   * @param messages 对话消息 [{ role, content }]
   * @returns 更新结果（新增 + 更新的 trait）
   */
  async updateFromConversation(
    userId: string = 'default',
    messages: Array<{ role: string; content: string }>,
  ): Promise<ProfileUpdateResult> {
    // 构建对话文本
    const conversation = messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    // 抽取新特征
    const extracted = await this.evaluateTraits(conversation);

    // 确保用户画像存在
    if (!this.profiles.has(userId)) {
      this.profiles.set(userId, []);
    }
    const current = this.profiles.get(userId)!;

    const added: UserTrait[] = [];
    const updated: UserTrait[] = [];

    for (const newTrait of extracted) {
      // 查找已有相同 key+value 的 trait
      const existing = current.find(
        t => t.key === newTrait.key && t.value.toLowerCase() === newTrait.value.toLowerCase(),
      );

      if (existing) {
        // 更新置信度（加权平均，偏向近期）
        existing.confidence = Math.min(1, existing.confidence * 0.7 + newTrait.confidence * 0.3 + 0.05);
        existing.evidence = newTrait.evidence; // 使用最新证据
        existing.updatedAt = Date.now();
        existing.source = userId;
        updated.push(existing);
      } else {
        // 检查是否有矛盾的旧 trait（同 key 不同 value）
        const contradictory = current.find(
          t => t.key === newTrait.key && t.value.toLowerCase() !== newTrait.value.toLowerCase(),
        );

        if (contradictory && newTrait.confidence > contradictory.confidence) {
          // 新证据置信度更高 → 替换
          contradictory.value = newTrait.value;
          contradictory.confidence = newTrait.confidence;
          contradictory.evidence = newTrait.evidence;
          contradictory.updatedAt = Date.now();
          updated.push(contradictory);
        } else if (!contradictory) {
          // 全新 trait
          const trait: UserTrait = {
            key: newTrait.key,
            value: newTrait.value,
            confidence: newTrait.confidence,
            source: userId,
            evidence: newTrait.evidence,
            updatedAt: Date.now(),
          };
          current.push(trait);
          added.push(trait);

          // 持久化
          this.appendTrait(userId, trait);
        }
      }
    }

    // 持久化更新的 trait
    for (const t of updated) {
      this.appendTrait(userId, t);
    }

    return {
      added,
      updated,
      merged: current,
      total: current.length,
    };
  }

  /**
   * 手动设置特征（用户显式声明）
   */
  setTrait(userId: string, key: string, value: string): UserTrait {
    if (!this.profiles.has(userId)) {
      this.profiles.set(userId, []);
    }
    const current = this.profiles.get(userId)!;

    // 覆盖已有或新建
    const existing = current.find(t => t.key === key);
    const trait: UserTrait = {
      key,
      value,
      confidence: 1.0, // 手动设置 = 完全信任
      source: 'manual',
      evidence: `用户手动设置: ${key}=${value}`,
      updatedAt: Date.now(),
    };

    if (existing) {
      existing.value = value;
      existing.confidence = 1.0;
      existing.evidence = trait.evidence;
      existing.updatedAt = Date.now();
    } else {
      current.push(trait);
    }

    this.appendTrait(userId, trait);
    return trait;
  }

  // ═══════════════════════════════════════════════════════════════
  // 查询
  // ═══════════════════════════════════════════════════════════════

  /**
   * 获取用户完整画像
   */
  getProfile(userId: string = 'default'): UserTrait[] {
    return this.profiles.get(userId) ?? [];
  }

  /**
   * 获取高置信度特征（confidence >= minConfidence）
   */
  getHighConfidenceTraits(userId: string = 'default', minConfidence: number = 0.7): UserTrait[] {
    return this.getProfile(userId).filter(t => t.confidence >= minConfidence);
  }

  /**
   * 格式化为 LLM System Prompt 注入文本
   *
   * 输出示例：
   *   ## 用户画像
   *   - 技术栈: TypeScript, Python, PostgreSQL (高置信度)
   *   - 行业: 金融科技
   *   - 角色: 后端架构师
   *   - 沟通风格: 简洁直接
   */
  formatForSystemPrompt(userId: string = 'default'): string {
    const traits = this.getHighConfidenceTraits(userId, 0.6);
    if (traits.length === 0) return '';

    // 按维度分组
    const byKey = new Map<string, UserTrait[]>();
    for (const t of traits) {
      if (!byKey.has(t.key)) byKey.set(t.key, []);
      byKey.get(t.key)!.push(t);
    }

    const lines: string[] = ['## 用户画像'];
    for (const [key, values] of byKey) {
      const label = this.keyLabel(key);
      const valueStr = values
        .sort((a, b) => b.confidence - a.confidence)
        .map(t => t.confidence >= 0.8 ? `${t.value} (高置信度)` : t.value)
        .join(', ');
      lines.push(`- ${label}: ${valueStr}`);
    }

    return lines.join('\n');
  }

  // ═══════════════════════════════════════════════════════════════
  // 管理
  // ═══════════════════════════════════════════════════════════════

  /**
   * 重置用户画像
   */
  resetProfile(userId: string): void {
    this.profiles.delete(userId);
    console.log(`[UserProfile] 🔄 已重置画像: ${userId}`);
  }

  /**
   * 获取统计
   */
  getStats() {
    const stats: Record<string, { traitCount: number; avgConfidence: number }> = {};
    for (const [userId, traits] of this.profiles) {
      const avgConf = traits.length > 0
        ? traits.reduce((s, t) => s + t.confidence, 0) / traits.length
        : 0;
      stats[userId] = { traitCount: traits.length, avgConfidence: Math.round(avgConf * 100) / 100 };
    }
    return stats;
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * 调用 LLM 抽取用户特征
   */
  private async evaluateTraits(
    conversation: string,
  ): Promise<Array<{ key: string; value: string; confidence: number; evidence: string }>> {
    const prompt = TRAIT_EXTRACTION_PROMPT.replace('{conversation}', conversation);

    try {
      const resp = await fetch(this.llmEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.llmModel,
          prompt,
          stream: false,
          options: { temperature: 0.1, max_tokens: 1024 },
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json() as Record<string, any>;
      const raw = data.response ?? data.choices?.[0]?.text ?? data.choices?.[0]?.message?.content ?? '';

      // 解析 JSON
      const jsonStr = this.extractJSON(raw);
      const parsed = JSON.parse(jsonStr);

      return (parsed.traits ?? []).map((t: any) => ({
        key: String(t.key ?? 'unknown').trim(),
        value: String(t.value ?? '').trim(),
        confidence: Math.max(0, Math.min(1, Number(t.confidence) || 0.6)),
        evidence: String(t.evidence ?? '').trim(),
      }));
    } catch {
      // LLM 不可用时，使用关键词降级提取
      return this.fallbackExtraction(conversation);
    }
  }

  /**
   * 关键词降级提取（无 LLM 时的后备方案）
   */
  private fallbackExtraction(
    conversation: string,
  ): Array<{ key: string; value: string; confidence: number; evidence: string }> {
    const traits: Array<{ key: string; value: string; confidence: number; evidence: string }> = [];

    const patterns: Array<{ regex: RegExp; key: string; extract: (m: RegExpMatchArray) => string }> = [
      { regex: /(?:我(?:用|使用|在用|主要用|一直在用)|my\s+stack\s+is|I\s+use)\s+(?:的是\s*)?([A-Za-z+#.\-\s]+?)(?:[，。,\.\s]|$)/gi, key: 'tech_stack', extract: m => m[1].trim() },
      { regex: /(?:我(?:在|从事|做|搞)|I\s+work\s+in|I'm\s+in)\s*(.+?)(?:行业|领域|方向)[，。,\.\s]/gi, key: 'industry', extract: m => m[1].trim() },
      { regex: /(?:我是|我的角色是|我的职位是|I'm\s+a\s+|I\s+work\s+as\s+a?\s*)(.+?)(?:[，。,\.\s]|$)/gi, key: 'role', extract: m => m[1].trim() },
    ];

    for (const { regex, key, extract } of patterns) {
      // 只看用户消息
      const userLines = conversation
        .split('\n')
        .filter(l => l.startsWith('user:') || l.startsWith('User:'))
        .join('\n');

      const match = regex.exec(userLines);
      if (match) {
        traits.push({
          key,
          value: extract(match).substring(0, 80),
          confidence: 0.5,
          evidence: match[0].trim(),
        });
      }
    }

    return traits;
  }

  /**
   * 从 LLM 原始响应中提取 JSON
   */
  private extractJSON(raw: string): string {
    let jsonStr = raw.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();
    const jsonStart = jsonStr.indexOf('{');
    if (jsonStart > 0) jsonStr = jsonStr.slice(jsonStart);
    return jsonStr;
  }

  /**
   * 追加 trait 到 JSONL 文件
   */
  private appendTrait(userId: string, trait: UserTrait): void {
    try {
      const dir = path.dirname(this.profileFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(
        this.profileFile,
        JSON.stringify({ userId, ...trait }) + '\n',
        'utf-8',
      );
    } catch { /* 不阻塞 */ }
  }

  /**
   * trait key → 中文标签映射
   */
  private keyLabel(key: string): string {
    const labels: Record<string, string> = {
      tech_stack: '技术栈',
      industry: '行业',
      role: '角色',
      experience_level: '经验水平',
      communication_style: '沟通风格',
      preferences: '偏好',
      goals: '目标',
      constraints: '约束条件',
      coding_style: '编码风格',
      architecture_style: '架构偏好',
      team_size: '团队规模',
      project_type: '项目类型',
    };
    return labels[key] ?? key;
  }
}
