/**
 * PreferenceModel — 动态偏好模型
 *
 * Phase 2 / MorPex v8.5: 从用户交互中持续学习偏好，
 * 支持置信度衰减和强度演化。
 *
 * 偏好分类:
 *   - technology:    技术栈偏好
 *   - communication: 沟通方式偏好
 *   - work_style:    工作方式偏好
 *   - tool:          工具偏好
 *   - domain:        领域偏好
 *
 * 学习机制:
 *   - 每次观察增强置信度和强度
 *   - 长期未观察的偏好自动衰减
 *   - 冲突偏好通过置信度仲裁
 */

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

export type PreferenceCategory = 'technology' | 'communication' | 'work_style' | 'tool' | 'domain';

export type PreferenceStrength = 'weak' | 'moderate' | 'strong';

export interface Preference {
  /** 偏好类别 */
  category: PreferenceCategory;

  /** 偏好键（如 'language', 'framework', 'channel'） */
  key: string;

  /** 偏好值（如 'TypeScript', 'Slack', 'daily-standup'） */
  value: string;

  /** 强度 */
  strength: PreferenceStrength;

  /** 置信度 (0-1)，未加强时随时间衰减 */
  confidence: number;

  /** 首次观察时间 */
  firstObserved: number;

  /** 最近观察时间 */
  lastObserved: number;

  /** 观察次数 */
  observationCount: number;
}

export interface PreferenceProfile {
  userId: string;
  preferences: Preference[];
  lastUpdated: number;
}

// ═══════════════════════════════════════════════════════════════
// PreferenceModel
// ═══════════════════════════════════════════════════════════════

export class PreferenceModel {
  private preferences: Map<string, Preference> = new Map();
  private userId: string;

  constructor(userId: string = 'default') {
    this.userId = userId;
  }

  /**
   * record — 记录偏好观察
   *
   * 如果偏好已存在，增强置信度和强度。
   * 如果是新偏好，创建条目。
   *
   * 强度演化: 1次=weak, 3次=moderate, 10次=strong
   * 置信度: min(1, observationCount / 5)
   *
   * @param category - 偏好类别
   * @param key - 偏好键
   * @param value - 偏好值
   * @param initialConfidence - 初始置信度（默认 0.3）
   */
  record(
    category: PreferenceCategory,
    key: string,
    value: string,
    initialConfidence: number = 0.3
  ): void {
    const mapKey = `${category}:${key}`;
    const existing = this.preferences.get(mapKey);

    if (existing) {
      if (existing.value === value) {
        // 相同偏好 → 增强
        existing.observationCount++;
        existing.lastObserved = Date.now();
        existing.confidence = Math.min(1, existing.observationCount / 5);
        // 强度升级
        if (existing.observationCount >= 10) existing.strength = 'strong';
        else if (existing.observationCount >= 3) existing.strength = 'moderate';
      } else {
        // 冲突偏好 → 如果新值置信度更高则替换
        if (initialConfidence > existing.confidence) {
          existing.value = value;
          existing.observationCount = 1;
          existing.strength = 'weak';
          existing.confidence = initialConfidence;
          existing.firstObserved = Date.now();
          existing.lastObserved = Date.now();
        }
      }
    } else {
      this.preferences.set(mapKey, {
        category,
        key,
        value,
        strength: 'weak',
        confidence: initialConfidence,
        firstObserved: Date.now(),
        lastObserved: Date.now(),
        observationCount: 1,
      });
    }
  }

  /**
   * getByCategory — 按类别获取偏好
   */
  getByCategory(category: PreferenceCategory): Preference[] {
    return [...this.preferences.values()]
      .filter(p => p.category === category)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * getTop — 获取指定键的最高置信度偏好
   */
  getTop(key: string): Preference | undefined {
    const candidates = [...this.preferences.values()]
      .filter(p => p.key === key)
      .sort((a, b) => b.confidence - a.confidence);
    return candidates[0];
  }

  /**
   * getAll — 获取所有偏好，按置信度降序排列
   */
  getAll(): Preference[] {
    return [...this.preferences.values()]
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * getStrong — 获取所有 strong 级别的偏好
   */
  getStrong(): Preference[] {
    return this.getAll().filter(p => p.strength === 'strong');
  }

  /**
   * decay — 应用置信度衰减
   *
   * 超过 maxAge 未观察的偏好置信度减半。
   * 置信度 < 0.1 的偏好被移除。
   *
   * @param maxAgeMs - 最大未观察时间（默认 7天）
   */
  decay(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [key, pref] of this.preferences) {
      const age = now - pref.lastObserved;
      if (age > maxAgeMs) {
        pref.confidence *= 0.5;
        if (pref.confidence < 0.1) {
          toRemove.push(key);
        }
      }
    }

    for (const key of toRemove) {
      this.preferences.delete(key);
    }
  }

  /**
   * buildProfile — 构建偏好画像
   */
  buildProfile(): PreferenceProfile {
    return {
      userId: this.userId,
      preferences: this.getAll(),
      lastUpdated: Date.now(),
    };
  }

  /**
   * count — 偏好总数
   */
  count(): number {
    return this.preferences.size;
  }

  // ═══════════════════════════════════════════════════════════
  // 序列化
  // ═══════════════════════════════════════════════════════════

  toJSON(): Preference[] {
    return this.getAll();
  }

  static fromJSON(data: { userId?: string; preferences: Preference[] }): PreferenceModel {
    const model = new PreferenceModel(data.userId || 'default');
    for (const pref of data.preferences || []) {
      const mapKey = `${pref.category}:${pref.key}`;
      model.preferences.set(mapKey, pref);
    }
    return model;
  }
}
