# 五处状态源统一计划

## 当前状态

| 状态源 | 写路径 | 读路径 | 持久化 |
|--------|--------|--------|--------|
| MissionController | `createMission()` / `updateMission()` / `addBlock()` | `getMission()` / `getAllMissions()` | `PersistentMissionStore` (SQLite) |
| SystemMetadataGraph | `registerEntity()` / `addRelation()` | `query()` / `getEntity()` | 内存 |
| OntologyService | `upsertObject()` / `registerEntity()` | `queryObjects()` / `getObject()` | 委托给 SystemMetadataGraph |
| ArtifactFacade | `create()` / `transition()` | `get()` / `getByTask()` | `PersistentArtifactStore` (SQLite) |
| EventStore | `append()` / `appendBatch()` | `query()` / `replay()` | `SqliteEventStore` |

## 目标架构

```
EventStore (单一真相源)
  ├── MissionProjection  ← MissionController 只读缓存
  ├── ArtifactProjection ← ArtifactFacade 只读缓存
  ├── OntologyProjection ← OntologyService 只读缓存
  └── MetadataProjection ← SystemMetadataGraph 只读缓存
```

所有写操作 → EventStore.append() → EventProjection → 更新读模型

## 实施步骤

### Step 1: MissionController → EventStore 集成
- MissionController 接受 `IEventStore` 作为构造参数
- `createMission()` → `EventStore.append(MISSION_CREATED)`
- `updateMission()` → `EventStore.append(MISSION_UPDATED)`
- `addBlock()` → `EventStore.append(MISSION_BLOCKED)`
- `getMission()` → 从 EventProjection 投影

### Step 2: ArtifactFacade → EventStore 集成
- `create()` → `EventStore.append(ARTIFACT_CREATED)`
- `transition()` → `EventStore.append(ARTIFACT_UPDATED)`

### Step 3: SystemMetadataGraph → EventStore 集成
- `registerEntity()` → `EventStore.append(SYSTEM_ENTITY_REGISTERED)`

### Step 4: OntologyService → EventStore 集成
- 查询走 OntologyService (读优化)
- 写通过 EventStore (写验证)

### Step 5: 统一投影层
- EventProjection 从 EventStore 重建所有状态
- 启动时从 EventStore 恢复所有模块状态

## 优先级

P1: Step 1 (MissionController + EventStore) — 本次实施
P2: Step 2-4
P3: Step 5 (统一投影)
