# MorPex 项目目录树（AICOS-Core 8 层）

> 生成时间: 2026-08-01 | 单一真相源: docs/AICOS_CORE_ARCHITECTURE.md
> 已排除: node_modules/.git/archived/data/dist/coverage

## packages/core/src — AICOS-Core 8 层

```
    src
cognition
  decision
  goal
  learning
    agent
  memory
  planning
    goal-intelligence
  twin
  workflow
evaluation
evolution
  workflow
    contract
    lineage
    testing
execution
  fabric
  harness
    orchestrator
    swarm
  runtime
    approval
    budget
    checkpoint
    cognitive-loop
    compensation
    dag
    mission
    sandbox
    scheduler
    simulation
    state-machine
    verification
facade
  gateway
    adapters
gate
governance
  capability
  control-plane
infrastructure
  adapters
    memory
    pi-bridge
  common
    resilience
  observability
  protocol
    contracts
    events
  tools
    primitives
  utils
knowledge
  artifact
    registry
  context
  graph
    knowledge
  memory
  ontology
    projectors
    prompts
workflow
```

## 各层文件数

- `facade/`: 6 文件
- `governance/`: 34 文件
- `knowledge/`: 47 文件
- `gate/`: 5 文件
- `cognition/`: 60 文件
- `execution/`: 80 文件
- `evaluation/`: 4 文件
- `evolution/`: 24 文件
- `infrastructure/`: 85 文件
- `workflow/`: 2 文件

## 项目顶层结构

```
configs
docs
packages/archived
packages/connectors
packages/contracts
packages/core
packages/memory
packages/studio
packages/workflows
packages/workflow-sdk
scripts
tests
```

## docs/ 当前文档（已清理，仅保留有效）

AICOS_CORE_ARCHITECTURE.md
AICOS_CORE_FILE_REGISTRY.md
DEPLOY.md
MEMORY_DEPLOYMENT.md
MONITORING.md
ontology-grounding.md
performance-checklist.md
PROJECT_TREE.md
README.md
SECURITY.md
testing-guide.md
