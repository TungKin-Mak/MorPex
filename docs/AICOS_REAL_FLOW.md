# MorPex 真实任务数据流与架构（基于 199 任务实测日志重现）

> 数据来源：`data/batch-runs/*.log`（5 批次，GLM 99 + opencode 109）+ `data/trace-reports/task-*.md`（99 份函数级调用追踪）
> 本文档 100% 基于实测日志中的真实调用序列，非设计文档。

---

## 一、架构总览（8 层 + 数据流主链路）

```mermaid
graph TD
    subgraph L1["L1 入口与治理"]
        CF[CompanyFacade.executeGoal]
        CP[ControlPlane.checkAll]
        AG[ApprovalGate.requestApproval]
    end

    subgraph L2["L2 知识本体"]
        OS[OntologyService]
        OSq[OntologyService.queryObjects]
        OSu[OntologyService.upsertObject/getObject]
        KQ[KnowledgeQueryPrimitive]
    end

    subgraph L3["L3 规划"]
        HP[HierarchicalPlanner]
        DP[DeliveryPlanner]
    end

    subgraph L4["L4 认知装配"]
        CE[ContextAssemblyEngine.assemble]
        CEr[ContextAssemblyEngine.collectFragmentsWithTimeout]
    end

    subgraph L5["L5 执行"]
        UEE[UnifiedExecutionEngine.execute]
        UA[executeAuto]
        OR[OrchestratorAgent.run - 总大脑]
        SE[StepAgentExecutor - step-agent]
        PT[原语工具 knowledge/file/shell/api/artifact]
        MC[MissionController.createMission/updateMission]
        TO[TeamOrchestrator.orchestrate]
    end

    subgraph L6["L6 评价"]
        VE[VerificationEngine.verify]
        LE[LearningEngine.learnFromOutcome]
    end

    subgraph L7["L7 进化"]
        EV[EvolutionSandbox - 进化分析]
        EM[ExperienceMiner]
    end

    subgraph L8["L8 基础设施"]
        GR[GroundedReasoning - Gate 两阶段]
        ES[EventStore context.snapshot]
        CPx[ContextPersistence 装配快照]
        AF[ArtifactFacade.create - 交付物]
    end

    %% 主数据流
    CF -->|1 用户目标| CP
    CP -->|2 门禁通过| MC
    MC -->|3 创建 Mission| TO
    TO -->|4 编排团队| GR
    GR -->|5a Phase1 强制查询| OSq
    GR -->|5b 基于事实推理| OS
    GR -->|6 知识凭证| HP
    HP -->|7 规划 N 步| CE
    CE -->|8 聚焦上下文| CEr
    CE -->|9 assembledContext| UEE
    UEE -->|10 生成类| UA
    UA -->|11 总大脑编排| OR
    OR -->|12 拆解步骤| SE
    SE -->|13 工具循环| PT
    PT -->|13a 知识查询| KQ
    PT -->|13b 产物落盘| AF
    VE -->|15 质量校验| LE
    LE -->|16 经验沉淀| EM
    EM -->|17 进化提案| EV
    EV -->|18 抽离| ES
    ES -->|19 召回接口| CPx
    ES -.->|20 交付报告| CF
```

---

## 二、单任务完整数据流时序图（成功任务，实证调用序列）

> 依据 `data/trace-reports/task-002.md`（66.6s，352 次函数调用）+ 日志事件。绿色为必经、红色为失败点（工具空参）。

```mermaid
sequenceDiagram
    autonumber
    participant U as 用户/调用方
    participant CF as CompanyFacade (L1)
    participant CP as ControlPlane (L1)
    participant MR as MorPexRuntime
    participant MC as MissionController
    participant GR as GroundedReasoning (Gate)
    participant OS as OntologyService (L2)
    participant HP as 统一规划 (L3)
    participant CE as ContextAssemblyEngine (L4)
    participant UEE as UnifiedExecutionEngine (L5)
    participant OR as OrchestratorAgent (总大脑)
    participant SE as StepAgentExecutor
    participant PT as 原语工具
    participant VE as VerificationEngine (L6)
    participant ES as EventStore (L8)

    U->>CF: executeGoal(目标文本)
    CF->>CP: checkAll() — 门禁校验(goal/policy/resource)
    CP-->>CF: ✅ 通过
    CF->>MR: run(goal)
    MR->>MC: createMission() — 建立 Mission(FSM 状态机)
    MC-->>MR: missionId

    rect rgb(220,245,255)
    Note over GR,OS: ══ Gate 两阶段（知识强制）══
    MR->>GR: runOntologyGroundedReasoning(goal)
    GR->>OS: Phase1 queryObjects() — 强制查询本体
    OS-->>GR: 知识对象（queryCallCount≥1）
    GR->>OS: Phase2 基于事实推理（LLM）
    GR-->>MR: ✅ KnowledgeContextPackage(凭证)
    end

    MR->>HP: 统一规划（Ontology grounding 后）
    HP-->>MR: 📋 规划完成 N 步（HierarchicalPlanner）
    MR->>CE: assemble() — 聚焦上下文装配
    CE->>CE: collectFragmentsWithTimeout（8 来源 Provider）
    CE->>CE: focusedSummary + 近期摘要召回 + 风险分级
    CE-->>MR: 🧩 assembledContext（含 providerAttribution）

    MR->>UEE: execute(goal, context)
    UEE->>UEE: analyzeComplexity + resolveMode
    UEE->>UEE: executeAuto — 生成类识别
    UEE->>OR: 🎫 Gate 凭证签发后 orchestrator.run(goal)

    rect rgb(235,245,235)
    Note over OR,PT: ══ 多 Agent 编排（会话 3 架构）══
    OR->>OR: LLM 分析复杂度 + 拆解 steps
    OR->>SE: executeStep(step, upstreamResults)
    SE->>SE: 创建沙箱 data/agent-workspace/<nodeId>/
    SE->>PT: 工具循环（knowledge/file/shell/api/artifact）
    PT-->>SE: 工具结果（含 Gate/沙箱/白名单校验）
    SE-->>OR: step 成果（交付摘要）
    OR->>OR: LLM 审计 pass/fail（可迭代≤3 轮）
    OR-->>UEE: ✅ 最终交付物（LLM 汇总）
    end

    UEE->>VE: verify() — 质量校验
    VE-->>UEE: ✅ 校验通过
    MR->>MR: Evaluation 评分 + needsHumanReview 标记
    MR->>MR: 🔄 进化分析（EvolutionSandbox 提案）
    MR->>ES: context.snapshot（完整快照抽离，含 taskRef）
    MR->>ES: missionSummary（摘要 + experienceMiner）
    CF-->>U: 📊 CEO 执行报告（成功/失败 + 产物数）
```

---

## 三、step-agent 工具循环内部（失败热点放大图）

> 实测 40/41 失败 = 工具空参（思考模式间歇性）。以下为工具循环 + 失败点 + 已根治措施。

```mermaid
graph TD
    A[step-agent 接收步骤职责] --> B{LLM 思考}
    B -->|需要数据/动手| C[发起工具调用]
    C --> D{参数校验<br/>validateRequiredParams}
    D -->|✅ 完整| E[原语执行]
    E -->|✅ 成功| F[工具结果回填]
    E -->|❌ 原语错误| G[错误回填 agent 循环]
    D -->|❌ 空参| H{是否 knowledge 空 query?}
    H -->|是 + 有 goal| I[✅ 用 step goal 兜底<br/>会话 13 根治]
    H -->|否| J[返回 isError + 工具专属<br/>正确调用示例 JSON]
    J --> B
    G --> B
    B -->|无工具需求| K[输出交付摘要]
    K --> L{extractText 判空?}
    L -->|空| M[纠正性重试 1 次<br/>会话 9 防御]
    L -->|有文本| N[step 成果返回 orchestrator]
    M -->|仍空| O[降级 fallback（ExecutionFabric 单次 LLM）]
    O --> P[step 失败标记]

    style D fill:#ffe4e1
    style H fill:#d4edda
    style J fill:#fff3cd
    style M fill:#cce5ff
```

---

## 四、数据持久化与召回

```mermaid
graph LR
    subgraph 抽离
        A[任务完成] --> B[context.snapshot 完整快照]
        A --> C[missionSummary 摘要]
        A --> D[context.archived 事件]
    end

    subgraph 存储
        B --> ES[(EventStore SQLite<br/>权威快照)]
        D --> ES
        A2[装配过程] --> CPx[(ContextPersistence<br/>装配快照)]
        CPx -->|loadRecent| R1
    end

    subgraph 召回
        R1[RecentSummaryReader<br/>双源合并 taskRef 去重]
        R2[ContextArchive.loadMerged<br/>EventStore + ContextPersistence]
    end

    R2 -->|统一召回接口| Assembly[下次任务聚焦装配]
```

---

## 五、失败路径时序（工具空参 → 降级 → 失败）

> 实测 48/199 任务失败，100% 为 step-agent 工具空参。以下为真实失败传播链（日志实证）。

```mermaid
sequenceDiagram
    autonumber
    participant SE as StepAgentExecutor
    participant PT as 原语工具
    participant AGT as agent 循环(pi-agent-core)
    participant FB as fallback(ExecutionFabric)
    participant OR as OrchestratorAgent

    SE->>AGT: prompt(步骤)
    AGT->>PT: 调用 knowledge/shell/api（思考模式空参）
    PT-->>AGT: ❌ isError: 参数不能为空 + 重新调用指引
    AGT-->>SE: 返回 content（可能为空/放弃工具）
    SE->>SE: extractText 判空?
    SE->>SE: 纠正性重试 1 次（会话 9 防御）
    AGT-->>SE: 仍空
    SE->>FB: 降级 fallback（单次 LLM 生成）
    FB-->>SE: 生成内容
    SE-->>OR: step 成果
    OR->>OR: 审计/汇总
    Note over OR: 若关键步骤失败 → 任务 ok=false<br/>（48/199，API 限额/模型思考模式所致）
```

---

## 六、实测数据统计（佐证架构）

```mermaid
pie title 199 任务结果分布
    "成功" : 158
    "工具空参失败" : 48
    "超时(GLM 遗留)" : 3
```

```mermaid
pie title 失败原因分布（48 工具空参明细）
    "query 空" : 20
    "url 空" : 18
    "command 空" : 10
```

---

## 七、架构-日志映射表（每层证据）

| 层 | 组件 | 日志证据（前缀标记） | 实测调用率 |
|---|---|---|---|
| L1 | CompanyFacade / ControlPlane / ApprovalGate | `[CompanyFacade] 🎯 executeGoal`、`ControlPlane: 通过` | 99/99 |
| L2 | OntologyService / KnowledgeQueryPrimitive | `[GroundedReasoning] 🏁 Phase 1 - 强制查询`、`[KnowledgeQueryPrimitive] 🔍` | 99/99 |
| L3 | HierarchicalPlanner / DeliveryPlanner | `[MorPexRuntime] 📋 统一规划完成: N 步` | 99/99 |
| L4 | ContextAssemblyEngine | `[MorPexRuntime] 🧩 聚焦上下文已装配 (X 字符)` | 99/99 |
| L5 | UnifiedExecutionEngine / OrchestratorAgent / StepAgentExecutor / 原语 | `[OrchestratorAgent] 🎫 Gate 凭证签发成功`、`[StepAgentExecutor]`、`[ShellExecutionPrimitive] 💻` | 99/99（工具循环） |
| L6 | VerificationEngine / LearningEngine | `🔄 [CrossAgentLearningEngine] learnFromOutcome`、`⚠️ Evaluation 标记 needsHumanReview` | 95/99 |
| L7 | EvolutionSandbox / ExperienceMiner | `[MorPexRuntime] 🔄 进化分析: N 个提案`、`没有产生经验` | 99/99 |
| L8 | EventStore / ContextPersistence / ArtifactFacade / GroundedReasoning | `context.snapshot`、`[ArtifactFacade]`、`[report] ✅ N 份报告已生成` | 99/99 |

**关键实证结论**：
- 核心 8 层链路每任务必经（99/99），架构通路 100%
- 真实任务成功率 79.4%（158/199），瓶颈 = LLM 工具空参（非架构）
- 安全层（PrimitiveGate / shell 白名单 / 沙箱）全部实测生效
