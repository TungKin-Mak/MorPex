/**
 * SpaceService — 组织空间服务（P1 部门 Space 化）
 *
 * 设计契约：docs/design/space-model.md §1
 * 职责：
 *   1. 扫描已注册 WorkflowProvider → 构建部门 Space（总部 hq + 各部门）
 *   2. 中文映射表 + 自定义别名（data/space-aliases.json 优先）
 *   3. 持久化 data/spaces.json（防抖落盘）
 *   4. 发射 space.created 事件（EventBus）
 *   5. routeGoal：按 provider.matchGoal 做任务路由兜底（LLM 路由由 StudioServer 层做）
 *
 * 依赖：WorkflowRegistry（静态，bootstrap 已注册 4 个 provider）+ EventBus。
 */

import { EventBus } from '../../infrastructure/common/EventBus.js';
import { WorkflowRegistry } from '../../workflow/WorkflowProvider.js';
import type { WorkflowProvider } from '../../workflow/WorkflowProvider.js';
import type { Space, SpaceId, SpaceTree, SpaceAliasMap } from './space-types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** 默认中文映射表（workflowId → 中文部门名）。自定义别名优先级更高。 */
const DEFAULT_ALIASES: SpaceAliasMap = {
  software: '软件部',
  ecommerce: '电商部',
  xjmcu: '嵌入式部',
  hardware: '硬件部',
};

const HQ_SPACE_ID = 'hq';

export class SpaceService {
  private eventBus: EventBus;
  private dataRoot: string;
  private spaces: Map<SpaceId, Space> = new Map();
  private aliases: SpaceAliasMap = { ...DEFAULT_ALIASES };
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private loaded = false;

  constructor(eventBus: EventBus, dataRoot?: string) {
    if (!eventBus) throw new Error('[SpaceService] EventBus 是必填参数');
    this.eventBus = eventBus;
    this.dataRoot = path.resolve(dataRoot ?? path.join(process.cwd(), 'data'));
    this.loadAliases();
  }

  // ── 别名 ──

  private get aliasesPath(): string {
    return path.join(this.dataRoot, 'space-aliases.json');
  }

  private loadAliases(): void {
    try {
      if (fs.existsSync(this.aliasesPath)) {
        const raw = JSON.parse(fs.readFileSync(this.aliasesPath, 'utf-8')) as SpaceAliasMap;
        if (raw && typeof raw === 'object') this.aliases = { ...DEFAULT_ALIASES, ...raw };
      }
    } catch (err) {
      console.warn('[SpaceService] ⚠️ 别名文件读取失败（用默认映射）:', (err as Error).message);
    }
  }

  /** 设置/更新别名（供后续 UI 端点；立即生效 + 落盘）。 */
  setAlias(workflowId: string, name: string): void {
    this.aliases[workflowId] = name.trim() || DEFAULT_ALIASES[workflowId] || workflowId;
    try {
      fs.mkdirSync(this.dataRoot, { recursive: true });
      fs.writeFileSync(this.aliasesPath, JSON.stringify(this.aliases, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[SpaceService] ⚠️ 别名写入失败:', (err as Error).message);
    }
  }

  // ── 扫描生成 ──

  /**
   * scanWorkflowProviders — 扫描已注册 WorkflowProvider，构建/刷新部门 Space。
   * 幂等：已存在同 workflowId 的部门空间不重复创建，仅补齐缺失字段。
   */
  scanWorkflowProviders(): void {
    const providers = WorkflowRegistry.getAll();
    if (providers.length === 0) {
      console.warn('[SpaceService] ⚠️ 无已注册 WorkflowProvider（部门空间为空）');
    }
    const now = Date.now();
    for (const provider of providers) {
      const space = this.buildDepartmentSpace(provider, now);
      const existing = this.spaces.get(space.id);
      if (!existing) {
        this.spaces.set(space.id, space);
        this.emitSpaceCreated(space);
      } else {
        // 刷新动态字段（persona/capabilities 可能随 provider 更新）
        this.spaces.set(space.id, { ...existing, ...space, createdAt: existing.createdAt });
      }
    }
    this.persist();
  }

  private buildDepartmentSpace(provider: WorkflowProvider, now: number): Space {
    const wfId = provider.name;
    const actions = provider.getActions();
    const capabilityNames = actions.map((a) => a.name);
    const name = this.aliases[wfId] ?? provider.description?.slice(0, 12) ?? wfId;
    const routeHint = [
      `部门：${name}`,
      provider.description ? `职责：${provider.description}` : '',
      capabilityNames.length > 0 ? `能力/动作：${capabilityNames.join('、')}` : '',
      `工作流：${wfId}`,
    ]
      .filter(Boolean)
      .join('。');
    return {
      id: `dept_${wfId}`,
      type: 'department',
      name,
      icon: undefined,
      parentId: HQ_SPACE_ID,
      departmentId: undefined, // 映射引擎 Department（P3 完整化；当前不强制创建 Department 实体）
      workflowId: wfId,
      managerPersona: `你是${name}的经理。部门职责：${provider.description ?? '负责本部门领域任务'}。本部门可用能力：${capabilityNames.join('、') || '通用能力'}。请以经理口吻接单、澄清、拆解任务给工位，工位按任务复杂度动态编排。`,
      capabilities: capabilityNames,
      routeHint,
      description: provider.description,
      createdAt: now,
    };
  }

  private emitSpaceCreated(space: Space): void {
    this.eventBus.emit({
      id: `evt_space_${space.id}_${Date.now()}`,
      type: 'space.created',
      timestamp: Date.now(),
      executionId: 'kernel',
      source: 'space-service',
      payload: { space },
    });
  }

  // ── 持久化 ──

  private get spacesPath(): string {
    return path.join(this.dataRoot, 'spaces.json');
  }

  private persist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      try {
        fs.mkdirSync(this.dataRoot, { recursive: true });
        fs.writeFileSync(this.spacesPath, JSON.stringify(this.getTree(), null, 2), 'utf-8');
      } catch (err) {
        console.warn('[SpaceService] ⚠️ 空间树持久化失败:', (err as Error).message);
      }
    }, 500);
  }

  /** 从磁盘恢复（启动时；缺失/损坏则静默回退到扫描结果）。 */
  restore(): void {
    try {
      if (!fs.existsSync(this.spacesPath)) return;
      const tree = JSON.parse(fs.readFileSync(this.spacesPath, 'utf-8')) as SpaceTree;
      if (tree?.hq) this.spaces.set(tree.hq.id, tree.hq);
      for (const dept of tree?.departments ?? []) this.spaces.set(dept.id, dept);
    } catch (err) {
      console.warn('[SpaceService] ⚠️ 空间树恢复失败（用扫描结果）:', (err as Error).message);
    }
  }

  // ── 查询 ──

  /** 确保已加载：恢复快照 + 扫描为真相源（懒加载，首次查询触发）。 */
  ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.restore();
    this.scanWorkflowProviders();
  }

  getTree(): SpaceTree {
    this.ensureLoaded();
    const hq: Space = {
      id: HQ_SPACE_ID,
      type: 'hq',
      name: '总部',
      icon: '🏢',
      parentId: null,
      createdAt: this.spaces.get(HQ_SPACE_ID)?.createdAt ?? Date.now(),
    };
    const departments = [...this.spaces.values()]
      .filter((s) => s.type === 'department')
      .sort((a, b) => a.createdAt - b.createdAt);
    return { hq, departments };
  }

  getSpace(id: SpaceId): Space | undefined {
    this.ensureLoaded();
    return this.spaces.get(id);
  }

  getDepartmentSpace(workflowId: string): Space | undefined {
    this.ensureLoaded();
    return this.spaces.get(`dept_${workflowId}`);
  }

  /** 路由兜底：按 provider.matchGoal 匹配部门空间（LLM 路由失败时用）。 */
  routeGoal(goal: string): Space | undefined {
    this.ensureLoaded();
    const matched = WorkflowRegistry.findForGoal(goal);
    if (matched.length === 0) return undefined;
    return this.getDepartmentSpace(matched[0].name);
  }

  /** 路由提示（供 LLM 路由 prompt 注入全部部门能力）。 */
  routingHint(): string {
    this.ensureLoaded();
    const depts = this.getTree().departments;
    if (depts.length === 0) return '（无可用部门）';
    return depts.map((d) => `- ${d.routeHint ?? d.name}`).join('\n');
  }

  /** 获取默认部门（LLM 路由失败且 matchGoal 未命中时兜底：软件部；无则返回 undefined）。 */
  getDefaultDepartmentSpace(): Space | undefined {
    this.ensureLoaded();
    return this.getDepartmentSpace('software') ?? this.getTree().departments[0];
  }

  /** P3-B：手动刷新部门空间（安装/发现新工作流后调用；幂等，补齐缺失字段）。 */
  refresh(): void {
    this.ensureLoaded();
    this.scanWorkflowProviders();
  }
}
