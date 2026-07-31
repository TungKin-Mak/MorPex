# Workflow Plugins（理想架构第 9 层）

**所有领域逻辑必须放在此处。**

## 标准

请严格遵守 `WORKFLOW_PLUGIN_STANDARD.md`。

## 已支持插件

- `xjmcu` — MCU 固件开发
- `ecommerce` — 电商工作流
- `hardware` — 硬件工作流
- `software` — 软件工作流

## 加载方式

由 `bootstrapUnified()` 自动加载。

## 开发新插件

1. 复制任意现有插件目录
2. 修改 `manifest.json` 和 `src/bootstrap.ts`
3. 实现 `ActionPrimitive`
4. 所有生成必须先走 `KnowledgeQueryPrimitive`

**违反标准的插件不会被加载。**
