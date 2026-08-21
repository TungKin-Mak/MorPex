/**
 * Space Types — 组织空间类型定义（P1 部门 Space 化）
 *
 * 设计契约：docs/design/space-model.md
 * Space = UI 会话抽象为「组织空间」：总部（hq）+ 部门（department）。
 * 部门由已安装工作流包（WorkflowProvider）驱动生成；任务线程（task）后续按需扩展。
 */

export type SpaceId = string;

/** 空间类型：hq = 总部（秘书闲聊+路由入口），department = 部门（由工作流包驱动），task = 任务线程（后续） */
export type SpaceType = 'hq' | 'department' | 'task';

/** Space — 组织空间实体 */
export interface Space {
  id: SpaceId;                 // 'hq' | `dept_${workflowId}`
  type: SpaceType;
  name: string;                // 中文名（软件部/电商部/嵌入式部/硬件部）
  icon?: string;
  parentId: SpaceId | null;    // hq 无父；department 父 = 'hq'
  departmentId?: string;       // 部门空间对应的引擎 departmentId（映射 Department 时）
  workflowId?: string;         // 部门由哪个工作流包驱动
  managerPersona?: string;     // 经理角色设定（LLM persona 注入编排器）
  capabilities?: string[];     // 工位能力提示（来自 workflow actions；非硬性工位列表）
  routeHint?: string;          // 路由提示文本（部门名+职责+动作，供 LLM 路由 prompt / 展示）
  description?: string;
  createdAt: number;
}

/** SpaceTree — 空间树（总部 + 部门列表） */
export interface SpaceTree {
  hq: Space;
  departments: Space[];
}

/** 自定义别名文件结构：{ [workflowId]: 中文名 } */
export type SpaceAliasMap = Record<string, string>;
