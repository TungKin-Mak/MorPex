/**
 * ManagementHub — CEO 管理群统筹中心
 *
 * Phase 1 / 组织层核心
 *
 * 定位：一人虚拟公司的"CEO 控制面板"。
 * CEO 通过管理群 @部门负责人 触发任务，ManagementHub 负责任务路由和状态聚合。
 *
 * 职责：
 *   1. 创建管理群（CEO + 所有 LeadAgent）
 *   2. 解析 CEO 指令（@部门名 任务内容 → 路由到对应 LeadAgent）
 *   3. 跨部门状态聚合（所有部门的最新进度一览）
 *   4. 定期自动推送部门状态摘要（每 5 分钟）
 *   5. 发射 hub.event 供前端 SSE 展示
 *
 * 管理群消息流：
 *   CEO: "@编程部 优化登录模块"
 *     → ManagementHub.parseCommand()
 *       → 识别 @编程部
 *       → LeadAgentOrchestrator.orchestrateTask('编程部', '优化登录模块')
 *         → GroupChatManager.sendSystemMessage('管理群', '📋 编程部任务已启动')
 *           → EventBus → SSE → 前端 + EventStore
 *
 * 使用方式：
 *   const hub = new ManagementHub(eventBus, deptManager, leadOrchestrator, groupChatManager);
 *   await hub.initialize(); // 创建管理群
 *   const result = await hub.handleCommand('@编程部 帮我写一个 Python 爬虫');
 */

import { EventBus } from '../common/EventBus.js';
import { DepartmentManager } from '../department/DepartmentManager.js';
import { LeadAgentOrchestrator } from '../department/LeadAgentOrchestrator.js';
import { GroupChatManager } from '../interaction/GroupChatManager.js';
import type { ChatGroup } from '../interaction/GroupChatManager.js';
import type { Department, DepartmentId } from '../department/types.js';

// ── Types ──

export interface ParsedCommand {
  /** 识别的部门名称 */
  departmentName?: string;
  /** 任务内容 */
  task: string;
  /** 命令类型 */
  type: 'assign_task' | 'query_status' | 'list_departments' | 'unknown';
  /** 原始输入 */
  raw: string;
}

export interface HubStatusReport {
  timestamp: number;
  departments: Array<{
    name: string;
    status: Department['status'];
    leadAgent: string;
    activeTasks: number;
    completedToday: number;
    lastActivity: number;
  }>;
  totalActiveTasks: number;
  totalCompletedToday: number;
}

// ── ManagementHub ──

export class ManagementHub {
  name = 'ManagementHub';
  version = '1.0.0';

  private eventBus: EventBus;
  private departmentManager: DepartmentManager;
  private leadAgentOrchestrator: LeadAgentOrchestrator;
  private groupChatManager: GroupChatManager;

  /** 管理群（CEO + 所有 LeadAgent） */
  private managementGroup: ChatGroup | null = null;

  /** CEO ID（默认 ceo-001） */
  private ceoId: string;

  /** 自动状态摘要定时器 */
  private statusTimer: ReturnType<typeof setInterval> | null = null;

  /** 每日完成计数 */
  private todayCompleted = 0;
  private todayStart = Date.now();

  constructor(
    eventBus: EventBus,
    departmentManager: DepartmentManager,
    leadAgentOrchestrator: LeadAgentOrchestrator,
    groupChatManager: GroupChatManager,
    ceoId: string = 'ceo-001',
  ) {
    if (!eventBus) throw new Error('[ManagementHub] EventBus 是必填参数');
    if (!departmentManager) throw new Error('[ManagementHub] DepartmentManager 是必填参数');
    if (!leadAgentOrchestrator) throw new Error('[ManagementHub] LeadAgentOrchestrator 是必填参数');
    if (!groupChatManager) throw new Error('[ManagementHub] GroupChatManager 是必填参数');

    this.eventBus = eventBus;
    this.departmentManager = departmentManager;
    this.leadAgentOrchestrator = leadAgentOrchestrator;
    this.groupChatManager = groupChatManager;
    this.ceoId = ceoId;

    // 监听部门完成事件，统计每日完成数
    this.eventBus.on('department.task.completed', () => {
      this.todayCompleted++;
    });

    // 监听新部门创建 → 自动加入管理群
    this.eventBus.on('department.created', (event: any) => {
      const dept = event.payload?.department as Department | undefined;
      if (dept && this.managementGroup) {
        const leadAgent = this.leadAgentOrchestrator.getLeadAgent(dept.id);
        if (leadAgent) {
          this.groupChatManager.addMember(this.managementGroup.id, leadAgent.id, 'lead_agent');
          this.groupChatManager.sendSystemMessage(
            this.managementGroup.id,
            `🏢 新部门 "${dept.name}" 已创建，${leadAgent.name} 已加入管理群`,
          );
        }
      }
    });
  }

  /**
   * initialize — 初始化管理群
   *
   * 1. 创建管理群（如果不存在）
   * 2. 添加 CEO 为成员
   * 3. 添加所有已有部门的 LeadAgent 为成员
   * 4. 启动自动状态摘要定时器（每 5 分钟）
   */
  async initialize(): Promise<void> {
    // 1. 创建管理群
    const existingGroup = this.groupChatManager.findGroupByName('🏢 管理群');
    if (existingGroup) {
      this.managementGroup = existingGroup;
      console.log(`[ManagementHub] ✅ 管理群已存在: ${existingGroup.id}`);
    } else {
      this.managementGroup = this.groupChatManager.createGroup(
        '🏢 管理群',
        [this.ceoId],
        { type: 'management', description: 'CEO 管理群 — 统筹所有部门' },
      );
    }

    // 2. 添加所有现有部门的 LeadAgent
    const departments = this.departmentManager.listDepartments();
    for (const dept of departments) {
      const leadAgent = this.leadAgentOrchestrator.getLeadAgent(dept.id);
      if (leadAgent && this.managementGroup) {
        this.groupChatManager.addMember(this.managementGroup.id, leadAgent.id, 'lead_agent');
      }
    }

    // 3. 欢迎消息
    if (this.managementGroup) {
      const deptCount = departments.length;
      this.groupChatManager.sendSystemMessage(
        this.managementGroup.id,
        `🚀 CEO 管理群已就绪。当前有 ${deptCount} 个部门，${deptCount > 0 ? '各部门 LeadAgent 已在线' : '等待创建部门。\n📝 使用 CompanyFacade.createDepartment() 创建第一个部门。'}`,
      );
    }

    // 4. 启动自动状态摘要（每 5 分钟）
    this.startStatusTimer();

    console.log(`[ManagementHub] ✅ 管理群初始化完成 (${departments.length} 个部门)`);
  }

  /**
   * startStatusTimer — 启动自动状态摘要
   *
   * 每 5 分钟自动推送各部门状态摘要到管理群。
   */
  private startStatusTimer(): void {
    if (this.statusTimer) return;

    this.statusTimer = setInterval(() => {
      if (!this.managementGroup) return;

      const report = this.generateStatusReport();
      const lines = report.departments.map(d =>
        `  • ${d.name}: ${d.activeTasks > 0 ? `⏳ ${d.activeTasks} 个任务执行中` : '✅ 空闲'}` +
        ` | 今日完成: ${d.completedToday}`,
      );

      const message = [
        `📊 **部门状态摘要** (${new Date(report.timestamp).toLocaleTimeString()})`,
        ...lines,
        '',
        `总览: ${report.totalActiveTasks} 个活跃任务 | 今日共完成 ${report.totalCompletedToday} 个`,
      ].join('\n');

      this.groupChatManager.sendSystemMessage(this.managementGroup!.id, message, { type: 'status_update' });
    }, 5 * 60 * 1000); // 5 分钟

    // 不阻止进程退出
    if (this.statusTimer && typeof this.statusTimer === 'object' && 'unref' in this.statusTimer) {
      this.statusTimer.unref();
    }
  }

  /**
   * stop — 停止管理群（清理定时器）
   */
  stop(): void {
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 命令处理
  // ═══════════════════════════════════════════════════════════════

  /**
   * handleCommand — 处理 CEO 指令
   *
   * 支持格式：
   *   "@部门名 任务内容" → 分配任务到部门
   *   "@部门名 状态" → 查询部门状态
   *   "状态" → 查询所有部门状态
   *   "列出部门" → 列出所有部门
   *   其他 → 未识别指令
   *
   * @param input - CEO 输入文本
   * @returns 处理结果
   */
  async handleCommand(input: string): Promise<{ ok: boolean; message: string; result?: unknown }> {
    const parsed = this.parseCommand(input);

    switch (parsed.type) {
      case 'assign_task': {
        if (!parsed.departmentName) {
          return { ok: false, message: '请指定部门，格式: @部门名 任务内容' };
        }

        // 通过 LeadAgent 编排任务
        const result = await this.leadAgentOrchestrator.orchestrateTask(parsed.departmentName, parsed.task);

        // 更新管理群
        if (this.managementGroup && result.ok) {
          this.groupChatManager.sendTaskCompletedMessage(
            this.managementGroup.id,
            result.taskId || 'unknown',
            `"${parsed.departmentName}" 任务完成`,
          );
        }

        return {
          ok: result.ok,
          message: result.message,
          result: { taskId: result.taskId, output: result.output },
        };
      }

      case 'query_status': {
        const report = this.generateStatusReport();
        if (parsed.departmentName) {
          const deptStatus = report.departments.find(d => d.name === parsed.departmentName);
          return deptStatus
            ? { ok: true, message: `${deptStatus.name} 状态: ${deptStatus.activeTasks > 0 ? '忙碌' : '空闲'}` }
            : { ok: false, message: `部门 "${parsed.departmentName}" 不存在` };
        }
        return { ok: true, message: '状态已获取', result: report };
      }

      case 'list_departments': {
        const depts = this.departmentManager.listDepartments();
        const names = depts.map(d => `  • ${d.name} (${d.status})`).join('\n');
        return {
          ok: true,
          message: `当前有 ${depts.length} 个部门:\n${names}`,
          result: depts,
        };
      }

      default:
        return { ok: false, message: `无法识别的指令。试试 @部门名 任务内容` };
    }
  }

  /**
   * parseCommand — 解析 CEO 指令
   *
   * 识别模式：
   *   - @部门名 任意文本 → assign_task
   *   - @部门名 状态/status → query_status (按部门)
   *   - 状态/status → query_status (全部)
   *   - 列出部门/部门列表 → list_departments
   */
  parseCommand(input: string): ParsedCommand {
    const trimmed = input.trim();

    // 匹配 @部门名 模式
    const atMatch = trimmed.match(/^@(\S+)\s+(.+)/s);
    if (atMatch) {
      const departmentName = atMatch[1];
      const rest = atMatch[2].trim();

      // 如果 @后的内容是查询状态
      if (/^(状态|status)$/i.test(rest)) {
        return { departmentName, task: rest, type: 'query_status', raw: trimmed };
      }

      return { departmentName, task: rest, type: 'assign_task', raw: trimmed };
    }

    // 匹配全局状态查询
    if (/^(状态|status)$/i.test(trimmed)) {
      return { task: trimmed, type: 'query_status', raw: trimmed };
    }

    // 匹配列出部门
    if (/^(列出部门|部门列表|departments)$/i.test(trimmed)) {
      return { task: trimmed, type: 'list_departments', raw: trimmed };
    }

    return { task: trimmed, type: 'unknown', raw: trimmed };
  }

  // ═══════════════════════════════════════════════════════════════
  // 状态报告
  // ═══════════════════════════════════════════════════════════════

  /**
   * generateStatusReport — 生成部门状态摘要
   */
  generateStatusReport(): HubStatusReport {
    const departments = this.departmentManager.listDepartments();
    const stats = this.leadAgentOrchestrator.getStats();

    const deptStatuses = departments.map(d => {
      const leadAgent = d.leadAgentId ? this.leadAgentOrchestrator.getLeadAgent(d.id) : undefined;
      const deptTasks = this.leadAgentOrchestrator.listTasks(d.id);
      const activeTasks = deptTasks.filter(t => t.status === 'executing' || t.status === 'assigned').length;
      const completedToday = deptTasks.filter(
        t => t.status === 'completed' && t.completedAt && t.completedAt >= this.todayStart,
      ).length;

      return {
        name: d.name,
        status: d.status,
        leadAgent: leadAgent?.name ?? '未分配',
        activeTasks,
        completedToday,
        lastActivity: d.updatedAt,
      };
    });

    return {
      timestamp: Date.now(),
      departments: deptStatuses,
      totalActiveTasks: stats.totalTasks - stats.completedTasks - stats.failedTasks,
      totalCompletedToday: this.todayCompleted,
    };
  }

  /**
   * getManagementGroupId — 获取管理群 ID
   */
  getManagementGroupId(): string | undefined {
    return this.managementGroup?.id;
  }

  /**
   * getManagementGroup — 获取管理群
   */
  getManagementGroup(): ChatGroup | undefined {
    return this.managementGroup ?? undefined;
  }

  /**
   * setCeoId — 设置 CEO ID
   */
  setCeoId(ceoId: string): void {
    this.ceoId = ceoId;
  }
}
