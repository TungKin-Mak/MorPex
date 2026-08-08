# 功能②：规则中断更正（RuleEnforcementGuard）— 最终方案

> 状态：**方案定稿（2026-08-03）**｜Phase 1 **已实现并验证**（2026-08-03）｜Phase 2/3 待排期｜
> 架构落点：L3 Ontology Gate 扩展（L2 新增 Rule 知识实体）
> 关联文档：[AICOS_CORE_ARCHITECTURE.md](./AICOS_CORE_ARCHITECTURE.md)（8 层唯一真相源）｜[SESSION_LOG.md](../SESSION_LOG.md)

---

## 0. 一句话定位

> 把"规则文档"从**被动知识**升级为**主动执法**：LLM 每次输出都被自动检测，命中规则 → 中断 → 带规则重试 → 仍失败交人工。本质是给 L3 防火墙加一个 **规则执行器**（非记忆系统本体）。

---

## 1. 核心架构模型：core 管骨架，领域管内容，运行时注入

```
L3 Gate（core，纯净，不 import 任何领域代码）
  └─ RuleEnforcementGuard（统一流程：命中→中断→带约束重试→降级→事件）
        ├─ 内置通用检测器：文本检测器（规范化+正则 / 别名展开）
        ├─ 调用 RuleRegistry.getActiveRules(domain)        ← 拿领域规则（数据）
        ├─ Detector 接口（预留：代码层/结构层/行为层检测器经接口注入）
        └─ 违规/降级事件 → eventStore（复用 ontology.* 事件模式）

领域工作流（packages/workflows/<domain>/）
  ├─ rules/   ：规则内容（RuleEntity 数据）—— bootstrap 时 register
  └─ adapters/：专属检测器（软件领域 tsc/eslint 适配器，实现 Detector 接口，Phase 2）
```

**三条宪法兼容**：
1. core 零领域依赖 —— 规则/检测器**运行时注入**，非静态 import（复用 `PolicyRuleRegistry` + `registerAmazonRules` 现成链路）
2. 领域逻辑只在 `packages/workflows/<domain>/` —— 规则内容与专属检测器都下沉领域
3. 任何副作用先过 Gate —— guard 挂载在 Gate 管道内，领域产出无法绕过

---

## 2. 规则实体（L2 新知识类型）

规则作为 **L2 ontology 对象**（type=`Rule`）存储，天然获得 tier/版本/血缘/QueryMiss 同套治理。

```ts
interface RuleEntity {
  id: string;
  tier: 'tier-0' | 'tier-1' | 'tier-2';   // 人工=0/1，演化=2（TierWriteGuard 已预留闸门）
  domain: string;                          // 领域隔离归属
  severity: 'ERROR' | 'WARNING';           // ERROR=硬中断；WARNING=记录+继续
  ruleType: 'regex' | 'semantic';          // 检测方式（Phase 1 只做 regex）
  target: 'proposal.payload' | 'proposal.action_type' | 'proposal.raw';
  disallowedPattern: string;               // 正则（文本维度主检）
  aliases?: string[];                      // 别名/代称展开（如 苹果耳机 → AirPods）
  allowedAction?: string;                  // 可选词法层微优化（Phase 2 修正管线①，非核心；领域无需为每条规则配置）
  priority: number;                        // 误报降级用
  status: 'pending' | 'active' | 'disabled'; // 提炼后待确认闸
  source: 'manual' | 'review_extraction' | 'evolution'; // 来源
  description: string;                     // 人话描述（规则含义，供审计/提炼溯源）
  extractedFrom?: string;                  // 提炼来源（人工审核原话）
}
```

- **存储**：`OntologyService.upsertObject`（type=`Rule`）；`objectTypes.ts` 的 `CORE_OBJECT_TYPES` + `DEFAULT_SCHEMAS` 新增 `Rule`
- **写守卫**：人工规则 tier-0/1；演化规则走 L7 晋升（`promotedByEvolution`）写 tier-2 —— 现成 `TierWriteGuard` 直接约束，零改动

---

## 3. 规则维护闭环（用户核心需求）

```
LLM 输出 → 人工审核 → 反馈一句话（"文案别出现竞品xx的名字"）
  → RuleExtractor：LLM 提炼成 RuleEntity（disallowedPattern 由提炼自动生成）
  → status=pending（待确认，不生效）         ← 关键安全阀：防提炼歪
  → 人工确认 → status=active → 进入 RuleRegistry
```

- **提炼≠生效**：pending → active 之间必须人工确认，防止 LLM 提炼误伤（如"别出现竞品"被提炼成"禁所有品牌名"）
- **自动变体展开**：提炼时自动生成规范化/别名变体（大小写、全角、空格、常见代称），进入 aliases
- **来源可溯**：`extractedFrom` 记录人工审核原话，审计与回滚都靠它

---

## 4. 检测策略（5 维分类骨架 + 文本/代码分层）

**不做"规则大全"，做"5 维分类骨架 + 注册机制 + 执行验证兜底 + 审核即提炼自增强"**：

| 维度 | 检测器 | 现状 | Phase |
|---|---|---|---|
| ① 文本层 | 规范化+正则（内置）、别名展开、LLM 语义复核（兜底） | 空白 | **1（正则）/3（语义）** |
| ② 结构层 | Schema/业务规则（复用 QualityRule）、引用校验（已有 validateReferences） | 已存在 | 复用 |
| ③ 代码层 | 编译/Lint/AST（领域适配器实现 Detector） | 空白 | 2 |
| ④ 行为层 | 执行验证、预算（已有 L5） | 已存在 | 复用 |
| ⑤ 合规层 | PolicyRuleRegistry/ComplianceChecker/TierWriteGuard | 已存在 | 复用 |

### 文本规范化管道（确定性，零 LLM 成本）
```
原始文本 → ① NFKC 全角→半角（str.normalize('NFKC')）→ ② 小写折叠
         → ③ 去空白/标点 → ④ 正则匹配
```
- `AirPods` / `air pods` / `ＡｉｒＰｏｄｓ` → 全部归一化为 `airpods`，一条正则命中
- 别名表（aliases）覆盖语义代称（苹果耳机/无线耳机）
- 编辑距离模糊匹配：可选，仅低严重度规则或命中转人工复核（防误伤）

### 判断标准：能"数据化"的匹配放 core 引擎，不能的放领域实现
| 匹配方式 | 引擎放哪 | 领域提供 |
|---|---|---|
| 正则/别名/规范化 | **core 内置** | 规则**数据** |
| AST/编译/Lint | core 只留 **Detector 接口** | 检测器**实现**（适配器） |

**⚠️ 语义边界**：`ApiWhitelistDetector` 是**代码类 payload 专用**检测器（剥注释/字符串后扫 API token）——纯文案场景（含引号）会造成漏报，应使用 `regex` 规则，勿当作通用文本检测器。

---

## 5. 中断 → 修正 → 降级 流程

```
Phase 2 推理 → normalizeProposal（JSON 解析）
  → RuleEnforcementGuard.check(proposal, domain)      // 纯函数：规范化+匹配
  → 有 ERROR 违规？
      ├─ 否 → 继续 → validateReferences → 签发 KCP → 缓存
      └─ 是 → 中断：
             ① 带约束重试：违规规则注入 Phase 2 reasoning prompt 重跑（maxAttempts=3, temperature 0.2）
             ② 重试仍违规 → needs_human_review=true + emit rule.violation
             ③ 同一规则单次执行连续命中 2 次仍不过 → 临时禁用该规则 + emit rule.downgraded + 人工介入
```

- **修正策略分层（通用管线，不随领域变）**：
  - ① 词法修正（Phase 2）：通用机械操作（删违规片段/规范化重比/去多余符号），引擎自带、无领域语义
  - ② 结构修正（Phase 2）：AST/编译/类型校验后自动修复（eslint --fix 式），引擎调用通用工具
  - ③ 语义修正（**Phase 1 已实现**）：把"领域规范 + 违规详情"注入 LLM 重写（带约束重试 maxAttempts=3）——万能兜底，任何领域适用
  - ④ 人工介入（**Phase 1 已实现**）：needs_human_review
  - 每层完成后都**重新检测验证**，通过才放行；失败则升级到下一层
- **规范驱动（多领域通用）**：领域只声明"什么合法"（白名单/范围/示例），**不写"违规怎么改"**；替换规则从多领域核心手段降级为①词法层的可选微优化
- **修正的本质**：重试携带明确修正方向（已命中规则/规范作为约束注入），非盲目重跑 —— 这是与普通 retry 的本质区别
- **WARNING 规则**：只 emit 事件 + 提示，不中断（把误报杀伤面降为可观测噪音）
- **降级三层防护**：ERROR/WARNING 分级 → 连续命中自动降级 → 人工事后 `disabled` 关闭误报规则

---

## 6. Phase 1 MVP 落点拆解（文件级）

### 新增（core）
| 文件 | 职责 | 关键接口 |
|---|---|---|
| `packages/core/src/gate/rules/types.ts` | 规则与违规类型 | `RuleEntity` / `RuleViolation { ruleId, matchedText, severity }` |
| `packages/core/src/gate/rules/RuleRegistry.ts` | 规则注册机制（core 静态表 + 插件注册） | `register(domain, rule)` / `getActiveRules(domain)` / `setStatus(id, status)` |
| `packages/core/src/gate/rules/normalize.ts` | 文本规范化管道（NFKC+小写+去空白） | `normalizeText(raw): string` |
| `packages/core/src/gate/rules/RuleEnforcementGuard.ts` | 纯函数检测器（文本维度） | `check(proposal, rules): RuleViolation[]` |
| `packages/core/src/gate/rules/ruleEvents.ts` | 规则事件（仿 ontologyEvents 字符串字面量模式） | `createRuleViolationEvent` / `createRuleDowngradedEvent` |
| `packages/core/src/gate/rules/RuleExtractor.ts` | 审核反馈 → LLM 提炼规则（输出 pending 实体） | `extractRule(feedback, domain, llm): Promise<RuleEntity>` |
| `packages/core/src/gate/rules/rulePersistence.ts` | L2 规则存取（OntologyService.upsertObject） | `saveRule` / `confirmRule` / `disableRule` |

### 修改（core）
| 文件 | 改动 |
|---|---|
| `packages/core/src/knowledge/ontology/objectTypes.ts` | `CORE_OBJECT_TYPES` 加 `'Rule'`；`DEFAULT_SCHEMAS` 加 Rule schema |
| `packages/core/src/gate/runOntologyGroundedReasoning.ts` | Phase 2 normalizeProposal 后挂 guard；加带约束重试循环（maxAttempts=3）；挂载需对 4 个调用方默认值兜底（Planner/Runtime 不传 riskTier/eventStore）；`GroundedReasoningOptions` 新增可选 `domain?: string` 按域路由（当前调用方未传 → 全局，Phase 2 打通） |
| `packages/core/src/gate/index.ts` | 导出 rules 新模块 |

### 新增（领域示例）
| 文件 | 职责 |
|---|---|
| `packages/workflows/ecommerce/src/rules/rule-register.ts` | 注册 1 条示例 ERROR 规则（竞品禁词），bootstrap 时调用（仿 registerAmazonRules 链路）；**默认 status='pending' 待确认生效**（演示确认闸，且避免未确认示例规则跨域误伤其它领域输出） |

### 测试
`packages/core/__tests__/gate/rules/*.test.ts`（直接 import src，vitest）：
- normalize 管道：`AirPods`/`air pods`/`ＡｉｒＰｏｄｓ` → 同一命中
- guard 匹配：命中/未命中/别名展开/WARNING 不中断
- 重试循环：3 次内通过 vs 3 次超限转 needs_human_review
- 连续命中降级：2 次命中 → 临时禁用 + 事件

**Phase 1 明确不做**：通用修正管线①词法层/②结构层（含 allowedAction 微优化、eslint --fix）、缓存规则版本、L5 预算接线、检测器类型扩展（白名单/AST/schema）、语义复核、演化挖掘 —— 均入 Phase 2/3。

---

## 7. Phase 2 / Phase 3

**Phase 2（正确性+成本）**
- ✅ **通用修正管线①词法层**（已实现 2026-08-03）：`lexicalCorrection.ts` 保守机械替换（allowedAction 定位不到不动/异常兜底），挂载于重试前；`allowedAction` 为可选微优化（非核心）
- **通用修正管线②结构层**：AST/编译/类型校验后自动修复（eslint --fix 式），引擎调用通用工具；software 领域 tsc/eslint 适配器（待实现；依赖解析需验证，完整 AST 区分声明/调用待后续）
- ✅ **检测器类型扩展（规范驱动）**（已实现 2026-08-03 两批）：`RuleDetector` 接口正式化 + `ApiWhitelistDetector`（API 白名单前缀，剥注释/字符串升级 B1，xjmcu 示例 pending）+ `DetectorRegistry` 领域注入机制（B2，software `custom:no-eval` 示例 pending，验证注入链路）；schema/AST 规则待后续
- ✅ **缓存一致性**（已实现 2026-08-03）：`RuleRegistry.fingerprint()` 并入 `groundingCache` key——规则变更 → 指纹变 → 旧缓存天然失效
- ✅ **L5 预算接线**（已实现 2026-08-03）：`GroundedReasoningOptions.onTokenUsage` 回调——Phase1 查询/Phase2 推理/每次规则重试后估算 tokens（ceil((prompt+text)/4)，精确计费待后续）；MorPexRuntime 接入 emit `execution.gate.token_usage`；回调带 try/catch 防御
- ✅ **domain 上下文沿调用链传递**（已实现 2026-08-03，F）：MorPexRuntime 从 `context.goal.domain` 注入 `options.domain` 按域过滤；其余 3 调用方无可靠信号保持全局（pending 示例规则兜底）
- ✅ **keyword 通用两级模型**（已实现 2026-08-03）：规则 = **关注点关键词 + 自然语言要求**（全行业通用，不绑领域语法：编程 `isr_interrupt` / 电商 `价格` / 金融 `利率`）。第一级 `KeywordDetector` 确定性扫名（输出含任一关键词，零成本）→ 第二级**按需** LLM 语义复核（仅命中时调，按 `description` 判定 `triggered`）→ 触发则计入违规进入修正重生成（注入判定理由/建议）；未触发 → 该规则不算违规放行；JSON 解析失败保守触发转人工；语义判断 token 已计入 `onTokenUsage`；ecommerce `price_disclosure` 示例 pending。成本控制：regex/whitelist 命中不调语义 LLM

**Phase 3（可延后）**
- L7 演化挖掘规则：failure/low_score → 规则提案 → 晋升 tier-2（TierWriteGuard 闸门已预留）
- LLM 语义复核检测器（语义兜底）——注：keyword 模型第二级已实现"按需语义复核"；此处指**全量语义复核**（无关键词前置，对每个输出），可延后
- 规则治理面板（pending 确认队列 UI / 误报关闭）

---

## 8. 已知风险与规避

| 风险 | 规避 |
|---|---|
| 确定性匹配器误报卡死 | WARNING 不中断 + 连续命中 2 次自动降级 + 人工 disabled |
| 缓存命中跳过检查 | 规则版本并入缓存 key / 规则变更清缓存（Phase 2） |
| Gate 内重试无预算 | 管道层 maxAttempts=3 硬上限（MVP）；L5 接线（Phase 2） |
| LLM 提炼规则歪 | pending 确认闸 + extractedFrom 溯源 + 可回滚 |
| 调用方参数不全 | 4 个调用方默认值兜底（riskTier→tier-1, eventStore→undefined 不阻断） |

---

## 9. 验收标准（Phase 1 完成时）

✅ 已达成（2026-08-03）：tsc 0 / validate-architecture 100% / vitest 64 文件 614 通过（新增 5 测试文件 25 用例，原 589 零回归）
- [x] `tsc 0` / `validate-architecture 100%` / vitest 全绿（新增规则测试全通过）
- [x] 违规输出被拦截并带规则重试 ≤3 次；超限转 needs_human_review
- [x] 规范化管道对大小写/全角/空格变体 100% 命中（单测证明）
- [x] 连续命中 2 次自动降级 + 事件可审计（rule.violation / rule.downgraded）
- [x] pending→active 确认闸生效；未确认规则不参与匹配
- [x] 领域注册 1 条示例规则（**默认 pending**，演示确认闸），bootstrap 链路跑通（core 零领域依赖可验证）
- [x] `options.domain` 传入时按域路由（集成测试：非本域规则旁路 / 本域规则命中重试）
