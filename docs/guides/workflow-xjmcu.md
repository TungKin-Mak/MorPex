# XJ MCU Workflow Plugin 使用指南

## 插件位置

```
packages/workflows/xjmcu/
├── toolchain/       ← 编译(buildcli) + 仿真(astrocli) 工具链
├── knowledge/       ← 15个矽杰微MCU型号的 YAML 知识文件
├── src/             ← TypeScript 工作流适配器
└── manifest.json    ← 插件注册清单
```

## 架构

```
MorPex Engine ←→ memory.db (共享记忆库)
                      ↑
xjmcu Workflow Plugin ──┘
    │
    ├── generate.ts  → 从 YAML/knowledge 生成 C 代码
    ├── compile.ts   → 调 buildcli 编译 → .hex / .xbin
    └── pipeline.ts  → 全闭环：生成 → 编译 → 烧录 → 读寄存器
```

## 使用方式

### 通过 MorPex API 调用

```typescript
const result = await morpex.runWorkflow('xjmcu', {
  action: 'pipeline',
  chip: 'XC8P9530',
  requirement: 'TC0 1ms定时, P64翻转'
});
```

### 直接命令行

```bash
# 编译
cd toolchain
python -m buildcli build --chip XC8P9530 --src main.c

# 烧录+仿真
python -m astrocli freerun build/firmware.xbin

# 全流水线（由 pipeline action 自动完成）
```

### 通过 MorPex 脚本

```bash
npx tsx packages/workflows/xjmcu/src/actions/pipeline.ts
```

## 知识管理

| 文件 | 作用 |
|------|------|
| `knowledge/*.yaml` | 芯片寄存器/引脚/代码模板（**唯一事实源**） |
| `mcu_memory_kb.py` | 查询 memory.db 获取芯片知识 |
| `scripts/import_*.py` | 将 YAML 导入 memory.db |

**记忆库查询优先级：**
1. `mcu_memory_kb.py` 自动查找 `E:/Morpex/data/memory.db`
2. 找不到则报 `MissingKnowledge`

## 添加新芯片

1. 创建 `knowledge/xc8pxxxx用法.yaml`（参照 9530 模板）
2. 运行 `scripts/import_yaml_to_memory.py --chip XC8PXXXX`
3. 验证：`python toolchain/mcu_memory_kb.py --chip XC8PXXXX`
