# Workflow Plugin 开发标准（理想架构第 9 层）

**版本**: 1.0  
**日期**: 2026-07-30  
**强制生效**

## 核心原则

1. **领域逻辑零容忍**：任何领域特定代码（电商、硬件、内容、MCU 等）**严禁**进入 `packages/core/src/`。
2. **Ontology Gate 强制**：插件内所有生成/行动**必须**先调用 `KnowledgeQueryPrimitive`（已绑定 Ontology Gate）。
3. **只使用通用原语**：只能使用 `DomainPrimitiveRegistry` 中的 5 个通用原语。
4. **EventBus 通信**：插件通过 EventBus 与核心交互，不直接调用核心内部模块。
5. **部门隔离**：所有操作必须携带 `departmentId`。

## 标准目录结构

```
packages/workflows/<domain>/
├── manifest.json              # 必须
├── package.json
├── src/
│   ├── index.ts               # 导出所有 Action
│   ├── bootstrap.ts           # 插件初始化（注册原语、监听事件）
│   └── actions/
│       └── *.ts               # 领域 Action（实现 ActionPrimitive）
├── knowledge/                 # 领域知识（YAML/JSON）
├── toolchain/                 # 领域工具链（可选）
└── README.md
```

## 必须遵循的代码规范

### 1. Action 必须实现 ActionPrimitive

```typescript
import type { ActionPrimitive, ActionResult } from '@morpex/core/tools/primitives/types.js';
import { DomainPrimitiveRegistry } from '@morpex/core';

export class MyDomainAction implements ActionPrimitive {
  name = 'domain_action';
  
  canHandle(task: string): number {
    // 返回 0~1 的匹配度
    return /关键词/.test(task.toLowerCase()) ? 0.9 : 0;
  }

  async execute(params: any, context?: { departmentId?: string }): Promise<ActionResult> {
    // ★ 必须先查知识（KnowledgeQueryPrimitive 已自动走 Ontology Gate）
    // 然后使用 FileOperationPrimitive / ArtifactGenerationPrimitive 等通用原语
  }
}

// 注册
DomainPrimitiveRegistry.register(new MyDomainAction());
```

### 2. 插件初始化必须调用 Ontology Gate

```typescript
// src/bootstrap.ts
import { initializeOntologyGate } from '@morpex/core/tools/primitives/KnowledgeQueryPrimitive.js';

export async function bootstrapWorkflow(domain: string) {
  // 确保 Ontology Gate 已注入（由 bootstrapUnified 统一处理）
  console.log(`[Workflow:${domain}] 已就绪，强制 Ontology Gate`);
}
```

### 3. 禁止事项

- 禁止直接 import `pi-ai` / `pi-agent-core`
- 禁止硬编码领域知识（必须放在 `knowledge/` 目录）
- 禁止绕过 `KnowledgeQueryPrimitive` 直接生成内容
- 禁止在 core 中实现领域原语

## 现有插件迁移检查

| 插件     | 状态         | 需改进点                     |
|----------|--------------|------------------------------|
| `xjmcu`  | 基本符合     | 需确认是否走 KnowledgeQueryPrimitive |
| `ecommerce` | 新建       | 必须严格按本规范实现         |
| `hardware` | 新建        | 必须严格按本规范实现         |

## 验收标准

- [ ] manifest.json 存在
- [ ] 所有 Action 实现 `ActionPrimitive`
- [ ] 启动时调用 `DomainPrimitiveRegistry.register`
- [ ] 所有生成操作先走 `KnowledgeQueryPrimitive`
- [ ] 通过 `tsc --noEmit`
- [ ] 文档（README.md）完整

**违反本规范的插件将被拒绝加载。**
