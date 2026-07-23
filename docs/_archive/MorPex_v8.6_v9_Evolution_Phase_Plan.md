# MorPex v8.5 → v8.8 → v9 Architecture Upgrade Specification

版本目标：

> 将 MorPex 从 Agent Framework 升级为 Personal AI Work Operating System

核心理念：

**先打造可靠执行内核，再基于真实工作数据逐步增加智能能力。**

MorPex 不追求：

- ❌ 完全数字分身
- ❌ AI 自主管理人生
- ❌ AI 自我修改自身

MorPex 追求：

- ✅ 理解用户工作目标
- ✅ 可靠执行复杂任务
- ✅ 管理长期工作知识
- ✅ 优化重复工作流程
- ✅ 在 Human 控制下增强个人生产力


---

# 1. 战略重新定位


## 原目标（删除）

## Digital Twin（完全数字分身）

删除原因：

人的完整模型无法工程化获取：

- 情绪
- 身体状态
- 潜意识
- 未表达经验
- 价值观变化


AI 不应该假装成为用户。


---

# 新目标

## Personal Work Model（个人工作模型）


只建模：

- 工作习惯
- 决策偏好
- 项目经验
- 工作流程
- 技术选择倾向


例如：


用户偏好：

长期维护性 > 快速上线

工作方式：

先架构设计
再实现
最后优化

决策习惯：

喜欢风险分析后决策



不是：

“另一个自己”。


而是：

“你的工作方式模型”。


---


# 2. 删除 AI 自主进化


## 删除：

Self Evolution


原因：

AI 修改自身：

- Runtime
- Planner
- 权限
- 安全策略

不可控。


---

# 替换：

## Workflow Evolution


目标：

优化工作流程。


允许：

- 优化重复任务
- 优化 Prompt 模板
- 优化 Agent 编排
- 优化工作流


不允许：

- 修改核心 Kernel
- 修改安全规则
- 修改权限系统


流程：


发现问题

↓

生成优化建议

↓

Human Approval

↓

应用



---

# 3. 删除 AI 自主管理人生


## 删除：

Life Manager


原因：

人生目标属于人。


AI 不应该决定：

- 职业方向
- 人生选择
- 价值判断


---

# 替换：

## Goal Assistant


AI 管理：

用户明确指定目标。


例如：

用户：

> 准备投资人会议


AI：

负责：

- 材料整理
- 时间安排
- Q&A准备
- 风险检查


不负责：

判断：

“你是否应该创业”。


---

# 4. MorPex 最终架构


                     HUMAN


                       |

              Experience Layer

          Web / WeChat / Feishu / CLI


                       |

              Interaction OS


                       |

              Event Protocol


                       |

    =================================

                 CORE KERNEL


    Mission Runtime

    Planner

    DAG Runtime

    FSM

    Verification

    Recovery

    Artifact System

    Memory

    Governance

    Observability


    =================================


                       |

              Agent Capability Layer


                       |

                Tools / MCP / API



    =================================

              Extension Plane


    Personal Work Model

    Workflow Evolution

    Proactive Assistant

    Decision Support


    =================================


---

# Phase 1：v8.6 Kernel Stabilization


目标：

把 MorPex 变成可靠执行系统。


---

# 1. Mission Context System


新增：


runtime/context/



职责：

统一任务上下文。


数据模型：


```ts
interface MissionContext {

 missionId:string;

 userId:string;


 goal:any;


 memoryContext:any;


 decisionContext:any;


 artifacts:any;


 executionState:any;


 permissions:any;

}

规则：

禁止 Agent 自己访问数据库。

所有信息通过 Context 注入。

2. Artifact System

新增：

artifact/

目标：

管理 AI 工作产物。

支持：

文档
代码
数据
报告
方案
分析结果

数据结构：

interface Artifact {


 id:string;


 missionId:string;


 type:string;


 version:number;


 creator:string;


 content:any;


 metadata:any;


}

价值：

未来所有智能能力依赖 Artifact。

包括：

Workflow Evolution
Memory Learning
Experience Analysis
3. Execution Observability

新增：

runtime/observability/

目标：

记录系统真实运行数据。

ExecutionTrace：

interface ExecutionTrace {


missionId:string;


nodeId:string;


agent:string;


tool:string;


status:string;


duration:number;


cost:number;


error?:string;


}

记录：

Agent 调用
Tool 调用
Token 消耗
成功率
失败原因
时间成本
4. Event Store

当前：

EventBus

升级：

Event Sourcing。

新增：

event-store/

EventRepository

EventProjection


原则：

禁止：

mission.status="completed"

改为：

MISSION_COMPLETED event

状态由事件恢复。

收益：

Replay
Debug
Learning
Phase 2：v8.7 Intelligence Foundation

目标：

建立未来智能能力的数据基础。

1. Memory Consolidation

新增：

memory/consolidation/

流程：

Mission Complete


↓

Experience Extractor


↓

Importance Score


↓

Long Term Memory

2. 双流 Memory 架构

非常重要：

聊天数据和工作数据必须分离。

Conversation Memory

来源：

普通聊天。

保存：

上下文
临时交流

特点：

短期。

不参与学习。

Work Experience Memory

来源：

Mission

↓

Plan

↓

Execution

↓

Artifact

↓

Feedback


用于：

工作模型
流程优化
决策支持
3. Memory Gate

所有长期记忆必须经过筛选。

模型：

{

"importance":90,

"reusable":true,

"workflowRelated":true,

"decisionRelated":true

}

普通聊天：

你好

哈哈

随便讨论


不保存。

任务经验：

最终选择 DAG+FSM

原因：

需要恢复能力


保存。

Phase 3：v8.8 Real World Integration

目标：

让 MorPex 进入真实工作环境。

接入：

微信
飞书
Email
Calendar
文件系统

统一：

Channel Adapter

↓

Message Gateway

↓

Event Protocol

↓

Mission Runtime

Phase 4：Extension Architecture

目标：

未来能力插件化。

目录：

extensions/


接口：

interface Extension {


id:string;


initialize();


onEvent();


shutdown();


}

原则：

未来能力：

不能修改 Kernel。

只能：

监听事件。

分析数据。

产生建议。

Phase 5：v9 Personal Work Intelligence
启动条件

不是时间。

而是数据。

必须满足：

真实运行 >= 3个月


+

Mission >= 1000


+

完整 Execution Trace


+

稳定 Memory


+

用户反馈数据


否则：

不开启。

v9 功能模块
1. Personal Work Model

输入：

Execution Trace

Decision

Feedback

Preference

Artifact


输出：

Work Profile


例如：

偏好：

稳定方案

工作：

先设计后编码

风险：

偏保守

2. Workflow Evolution

目标：

自动发现重复流程。

流程：

Repeated Workflow


↓

Pattern Detection


↓

Optimization Proposal


↓

Human Approval


↓

Apply

3. Proactive Assistant

目标：

主动提供工作帮助。

例如：

发现：

你每周五都会整理周报


建议：

自动生成初稿


不是：

自主行动。

4. Decision Support

目标：

辅助决策。

不是：

替用户决定。

流程：

Data

↓

Analysis

↓

Options

↓

Human Decision

数据闭环

MorPex 的长期资产：

Event Store


+

Execution Trace


+

Artifact Store


+

User Feedback


        |

        v


Experience Dataset


        |

        v


Intelligence Layer

Human Control Architecture
Level 0

数据收集

AI：

观察。

Level 1

AI 提议

用户：

批准。

Level 2

低风险自动执行。

例如：

整理文件。

Level 3

高风险人工确认。

例如：

商业决策。

禁止事项

MorPex 永久禁止：

1.

AI 自主修改核心系统。

2.

AI 自主管理人生。

3.

所有聊天进入长期记忆。

4.

没有数据基础开启智能能力。

5.

隐藏执行过程。

最终产品定位

MorPex 不是：

❌ AI Clone

❌ Digital Human

❌ Autonomous Life Agent

MorPex 是：

Personal AI Work Operating System

核心价值：

1. Reliable Execution

可靠完成复杂任务。

2. Personal Work Memory

长期理解你的工作方式。

3. Workflow Evolution

持续优化重复流程。

4. Human Controlled Intelligence

增强人，而不是替代人。

最终升级路线
MorPex v8.5


↓

v8.6

Kernel Stabilization


↓

v8.7

Memory + Intelligence Foundation


↓

v8.8

Real World Integration


↓

真实数据积累


↓

v9

Personal Work Intelligence


最终目标：

一个长期运行、可靠执行、理解工作方式、持续优化流程，但始终由人掌控的 AI 工作操作系统。


---

这份文档可以直接作为 **MorPex v8.5 → v9 Upgrade Specification** 给你的 coding agent 执行。建议后续不要一次性让 agent 改全部，而是按 Phase 1 → Phase 2 → Phase 3 顺序提交，每个 Phase 完成后跑架构审计。