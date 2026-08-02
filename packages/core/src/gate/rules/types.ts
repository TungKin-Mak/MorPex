/**
 * gate/rules/types — 规则中断更正：规则实体与违规类型定义
 *
 * 功能② Phase 1（MVP）：
 *   - RuleEntity 为规则数据契约（core 提供机制，领域提供内容 —— No Domain Logic in Core）
 *   - 规则由领域插件经 RuleRegistry.register 注入，bootstrap 装配
 *   - Phase 1 只执行 ruleType='regex'（确定性匹配）；'semantic' 预留 Phase 3 LLM 语义复核
 */

/** 规则严重度：ERROR=硬中断（进入修正重试）；WARNING=记录+继续 */
export type RuleSeverity = 'ERROR' | 'WARNING';

/** 检测方式：regex=确定性正则；whitelist=API 白名单前缀；keyword=通用两级模型（关键词扫名+LLM 语义复核，全行业通用）；semantic=LLM 语义复核（Phase 3）；领域可经 DetectorRegistry 注册自定义类型（如 'custom:no-eval'） */
export type RuleType = 'regex' | 'whitelist' | 'keyword' | 'semantic' | (string & {});

/** 规则状态：pending=提炼待人工确认（不参与匹配）；active=生效；disabled=人工关闭 */
export type RuleStatus = 'pending' | 'active' | 'disabled';

/** 规则来源：manual=人工撰写；review_extraction=审核反馈 LLM 提炼；evolution=L7 演化挖掘（Phase 3） */
export type RuleSource = 'manual' | 'review_extraction' | 'evolution';

/** 规则检查目标：LLM 输出 proposal 的哪个字段 */
export type RuleTarget = 'proposal.payload' | 'proposal.action_type' | 'proposal.raw';

/** 规则权威级（与 KnowledgeAuthorityTier 一致；演化规则写 tier-2 受 TierWriteGuard 约束） */
export type RuleTier = 'tier-0' | 'tier-1' | 'tier-2';

/**
 * RuleEntity — 一条规则（L2 知识权威，tier-0/1 人工 / tier-2 演化）
 *
 * 匹配语义（Phase 1 确定性）：
 *   - 文本经规范化管道（NFKC 全角→半角 + 小写 + 去空白）后，再匹配
 *   - disallowedPattern 同样规范化后作为正则（隐含不区分大小写、无空白语义）
 *   - aliases 为精确包含匹配（如"苹果耳机"代称）
 */
export interface RuleEntity {
  /** 规则唯一 ID（register 时未提供则自动生成） */
  id: string;
  /** 标题（L2 ontology 对象 title 语义） */
  title?: string;
  /** 权威级 */
  tier: RuleTier;
  /** 领域归属（工作流插件的 domain 标识） */
  domain: string;
  /** 严重度 */
  severity: RuleSeverity;
  /** 检测方式（Phase 1 仅 regex 生效） */
  ruleType: RuleType;
  /** 检查 LLM 输出的哪个字段 */
  target: RuleTarget;
  /** 禁止模式（正则；经规范化后匹配；ruleType='regex' 时使用，白名单规则可省略） */
  disallowedPattern?: string;
  /** 别名/代称展开（规范化后精确包含匹配） */
  aliases?: string[];
  /**
   * 关注点关键词（ruleType='keyword' 时使用；任意行业任意词，如 isr_interrupt / 价格 / 利率）
   *
   * 通用两级模型（不绑定任何领域语法）：
   *   第一级（确定性扫名）：输出文本包含任一关键词 → 标记待确认
   *   第二级（LLM 语义复核）：管道层按 description 判断“触及该词的内容是否满足要求”
   *     → 触发（triggered=true）才进入修正重生成；未触发 → 该规则不算违规
   */
  keywords?: string[];
  /**
   * API 白名单前缀（ruleType='whitelist' 时使用，Phase 2）
   * 检测：目标文本中出现的"厂商风格 API token"（含下划线且首字母大写，如 IOCP_W / LL_GPIO_WritePin）
   * 其前缀（第一个 _ 前片段）不在白名单内 → 违规。
   * MCU 场景示例：['IOCP','NVIC','SysTick','FLASH','RCC']
   */
  allowedApiPrefixes?: string[];
  /** 确定性替换目标（Phase 2；Phase 1 保留字段不执行） */
  allowedAction?: string;
  /** 优先级（越大越先匹配；误报降级用） */
  priority: number;
  /** 状态：pending 不参与匹配 */
  status: RuleStatus;
  /** 来源 */
  source: RuleSource;
  /** 人话描述（审计 / 重试约束注入用） */
  description: string;
  /** 提炼来源（人工审核原话，溯源用） */
  extractedFrom?: string;
}

/** RuleViolation — 一次规则命中 */
export interface RuleViolation {
  ruleId: string;
  severity: RuleSeverity;
  /** 命中的规范化文本片段 */
  matchedText: string;
  target: RuleTarget;
  description: string;
  /** 命中的关键词（ruleType='keyword' 时填充；第二级语义判断依据） */
  keyword?: string;
  /** 第二级语义判断确认触发（keyword 规则；true=需修正，进入重生成） */
  semanticTriggered?: boolean;
  /** 语义判断理由（注入修正重生成的约束用） */
  semanticReason?: string;
  /** 语义判断修正建议 */
  semanticSuggestion?: string;
}

/** 规则中断结果（check 返回） */
export interface RuleCheckResult {
  violations: RuleViolation[];
  /** 是否有 ERROR 违规（需中断/重试） */
  hasError: boolean;
  /** 本次检查中因连续命中被临时降级的规则 ID */
  downgradedRuleIds: string[];
}
