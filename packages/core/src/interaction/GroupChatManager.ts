/**
 * GroupChatManager — 动态群聊管理器
 *
 * Phase 1 / 组织层核心
 *
 * 职责：
 *   1. 创建/解散逻辑群组（每个部门对应一个群）
 *   2. 群成员管理（加入/离开/角色标注）
 *   3. 消息收发（文本 + 结构化事件消息）
 *   4. 消息持久化到 UnifiedEventStore
 *   5. 通过 EventBus.onProjected 推送到 SSE/WebSocket
 *   6. 外部 IM 适配器接口（飞书/企业微信，Phase 3 对接）
 *
 * 群聊消息流：
 *   sendMessage()
 *     → EventBus.emit('group_chat.message.sent')
 *       → EventBus.onProjected() → SSE → 前端
 *       → EventStore 持久化
 *       → External IM Adapter（可选）
 *
 * 使用方式：
 *   const groupChat = new GroupChatManager(eventBus);
 *   const group = groupChat.createGroup('编程部', ['ceo-1', 'lead-1'], { type: 'department', departmentId: 'dept_xxx' });
 *   groupChat.sendMessage('group_xxx', 'ceo-1', '大家好，开始今天的任务');
 *   groupChat.sendSystemMessage('group_xxx', '📋 新任务已分配：优化登录模块');
 */

import { EventBus } from '../common/EventBus.js';
import type { DepartmentId } from '../department/types.js';

// ── Types ──

export type GroupId = string;
export type GroupType = 'department' | 'management' | 'project' | 'direct_message';
export type MessageType = 'text' | 'system' | 'task_assigned' | 'task_completed' | 'status_update' | 'error';

export interface GroupMember {
  agentId: string;
  displayName: string;
  role: 'ceo' | 'lead_agent' | 'worker' | 'observer';
  joinedAt: number;
  isOnline: boolean;
}

export interface ChatMessage {
  id: string;
  groupId: GroupId;
  senderId: string;
  senderName: string;
  type: MessageType;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ChatGroup {
  id: GroupId;
  name: string;
  type: GroupType;
  members: Map<string, GroupMember>;
  createdAt: number;
  metadata?: {
    departmentId?: DepartmentId;
    projectId?: string;
    description?: string;
  };
}

export interface GroupChatStats {
  totalGroups: number;
  totalMessages: number;
  groupsByType: Record<GroupType, number>;
  activeMembers: number;
}

// ── GroupChatManager ──

export class GroupChatManager {
  name = 'GroupChatManager';
  version = '1.0.0';

  private eventBus: EventBus;
  private groups: Map<GroupId, ChatGroup> = new Map();
  private messageStore: ChatMessage[] = [];
  private static readonly MAX_MESSAGES_IN_MEMORY = 1000;
  private groupCounter = 0;

  /** 外部 IM 适配器（Phase 3 对接飞书/企微） */
  private externalAdapter: ExternalIMAdapter | null = null;

  constructor(eventBus: EventBus) {
    if (!eventBus) throw new Error('[GroupChatManager] EventBus 是必填参数');
    this.eventBus = eventBus;

    // 监听部门事件，自动推送系统消息
    this.eventBus.on('department.created', (event: any) => {
      const dept = event.payload?.department;
      if (dept?.groupChatId) {
        this.sendSystemMessage(dept.groupChatId, `🏢 部门 "${dept.name}" 已创建`);
      }
    });

    // 监听部门任务事件，自动推送进度
    this.eventBus.on('department.task.assigned', (event: any) => {
      const payload = event.payload;
      const deptGroup = this.findGroupByDepartment(payload.departmentId);
      if (deptGroup) {
        this.sendSystemMessage(deptGroup.id, `📋 新任务已分配: "${payload.task?.substring(0, 80)}..."`);
      }
    });

    this.eventBus.on('department.task.completed', (event: any) => {
      const payload = event.payload;
      const deptGroup = this.findGroupByDepartment(payload.departmentId);
      if (deptGroup) {
        const duration = payload.duration ? ` (${Math.round(payload.duration / 1000)}s)` : '';
        this.sendSystemMessage(deptGroup.id, `✅ 任务完成${duration}`);
      }
    });

    this.eventBus.on('department.task.failed', (event: any) => {
      const payload = event.payload;
      const deptGroup = this.findGroupByDepartment(payload.departmentId);
      if (deptGroup) {
        this.sendSystemMessage(deptGroup.id, `❌ 任务失败: ${payload.error || '未知错误'}`);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 群组管理
  // ═══════════════════════════════════════════════════════════════

  /**
   * createGroup — 创建群组
   *
   * @param name - 群组名称（如"编程部"、"管理群"）
   * @param memberIds - 初始成员 ID 列表
   * @param options - 可选群组配置
   * @returns 创建的 ChatGroup
   */
  createGroup(
    name: string,
    memberIds: string[] = [],
    options?: {
      type?: GroupType;
      departmentId?: DepartmentId;
      projectId?: string;
      description?: string;
    },
  ): ChatGroup {
    const id: GroupId = `group_${++this.groupCounter}_${Date.now()}`;
    const groupType: GroupType = options?.type ?? (options?.departmentId ? 'department' : 'project');

    const group: ChatGroup = {
      id,
      name,
      type: groupType,
      members: new Map(),
      createdAt: Date.now(),
      metadata: {
        departmentId: options?.departmentId,
        projectId: options?.projectId,
        description: options?.description,
      },
    };

    // 添加初始成员
    for (const memberId of memberIds) {
      group.members.set(memberId, {
        agentId: memberId,
        displayName: memberId,
        role: memberId.startsWith('ceo') ? 'ceo' : memberId.startsWith('lead') ? 'lead_agent' : 'worker',
        joinedAt: Date.now(),
        isOnline: true,
      });
    }

    this.groups.set(id, group);

    // 发射事件
    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'group_chat.group.created',
      timestamp: Date.now(),
      executionId: 'kernel',
      source: 'group-chat-manager',
      payload: { groupId: id, groupName: name, groupType, memberCount: memberIds.length },
    });

    // 发送创建系统消息
    this.sendSystemMessage(id, `💬 群组 "${name}" 已创建`);

    console.log(`[GroupChatManager] ✅ 群组 "${name}" 已创建 (${id})`);
    return group;
  }

  /**
   * getGroup — 获取群组
   */
  getGroup(groupId: GroupId): ChatGroup | undefined {
    return this.groups.get(groupId);
  }

  /**
   * findGroupByName — 按名称查找群组
   */
  findGroupByName(name: string): ChatGroup | undefined {
    return [...this.groups.values()].find(g => g.name === name);
  }

  /**
   * findGroupByDepartment — 按部门 ID 查找群组
   */
  findGroupByDepartment(departmentId: DepartmentId): ChatGroup | undefined {
    return [...this.groups.values()].find(g => g.metadata?.departmentId === departmentId);
  }

  /**
   * listGroups — 列出所有群组
   *
   * @param type - 可选，按类型过滤
   */
  listGroups(type?: GroupType): ChatGroup[] {
    const all = [...this.groups.values()];
    return type ? all.filter(g => g.type === type) : all;
  }

  /**
   * deleteGroup — 解散群组
   */
  deleteGroup(groupId: GroupId): boolean {
    const existed = this.groups.has(groupId);
    if (!existed) return false;

    this.groups.delete(groupId);

    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'group_chat.group.deleted',
      timestamp: Date.now(),
      executionId: 'kernel',
      source: 'group-chat-manager',
      payload: { groupId },
    });

    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  // 成员管理
  // ═══════════════════════════════════════════════════════════════

  /**
   * addMember — 添加成员到群组
   */
  addMember(groupId: GroupId, agentId: string, role: GroupMember['role'] = 'worker'): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    group.members.set(agentId, {
      agentId,
      displayName: agentId,
      role,
      joinedAt: Date.now(),
      isOnline: true,
    });

    this.sendSystemMessage(groupId, `👤 ${agentId} 加入了群聊`);
    return true;
  }

  /**
   * removeMember — 从群组移除成员
   */
  removeMember(groupId: GroupId, agentId: string): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    const removed = group.members.delete(agentId);
    if (removed) {
      this.sendSystemMessage(groupId, `🚪 ${agentId} 离开了群聊`);
    }
    return removed;
  }

  /**
   * getMembers — 获取群组成员列表
   */
  getMembers(groupId: GroupId): GroupMember[] {
    const group = this.groups.get(groupId);
    return group ? [...group.members.values()] : [];
  }

  // ═══════════════════════════════════════════════════════════════
  // 消息收发
  // ═══════════════════════════════════════════════════════════════

  /**
   * sendMessage — 发送消息
   *
   * @param groupId - 群组 ID
   * @param senderId - 发送者 ID
   * @param content - 消息内容
   * @param options - 可选参数（消息类型、元数据）
   * @returns 创建的 ChatMessage
   */
  sendMessage(
    groupId: GroupId,
    senderId: string,
    content: string,
    options?: { type?: MessageType; metadata?: Record<string, unknown> },
  ): ChatMessage | { error: string } {
    const group = this.groups.get(groupId);
    if (!group) return { error: `群组 "${groupId}" 不存在` };

    const member = group.members.get(senderId);
    const message: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      groupId,
      senderId,
      senderName: member?.displayName ?? senderId,
      type: options?.type ?? 'text',
      content,
      timestamp: Date.now(),
      metadata: options?.metadata,
    };

    // 存入内存（FIFO 上限）
    this.messageStore.push(message);
    if (this.messageStore.length > GroupChatManager.MAX_MESSAGES_IN_MEMORY) {
      this.messageStore.shift();
    }

    // 通过 EventBus 广播（SSE/WebSocket 前端消费）
    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'group_chat.message.sent',
      timestamp: Date.now(),
      executionId: groupId,
      source: 'group-chat-manager',
      payload: {
        groupId,
        groupName: group.name,
        message: {
          id: message.id,
          senderId: message.senderId,
          senderName: message.senderName,
          type: message.type,
          content: message.content,
          timestamp: message.timestamp,
          metadata: message.metadata,
        },
        memberCount: group.members.size,
      },
    });

    // Fire-and-forget: 推送到外部 IM 适配器（如果已注册）
    if (this.externalAdapter) {
      this.externalAdapter.sendToGroup(group.name, message).catch((err: Error) => {
        console.warn(`[GroupChatManager] 外部 IM 推送失败:`, err.message);
      });
    }

    return message;
  }

  /**
   * sendSystemMessage — 发送系统消息（自动发送者）
   */
  sendSystemMessage(
    groupId: GroupId,
    content: string,
    metadata?: Record<string, unknown>,
  ): ChatMessage | { error: string } {
    return this.sendMessage(groupId, 'system', content, { type: 'system', metadata });
  }

  /**
   * sendTaskAssignedMessage — 发送任务分配通知
   */
  sendTaskAssignedMessage(groupId: GroupId, task: string, taskId: string): ChatMessage | { error: string } {
    return this.sendMessage(groupId, 'system', `📋 新任务: ${task}`, {
      type: 'task_assigned',
      metadata: { taskId, timestamp: Date.now() },
    });
  }

  /**
   * sendTaskCompletedMessage — 发送任务完成通知
   */
  sendTaskCompletedMessage(groupId: GroupId, taskId: string, summary: string): ChatMessage | { error: string } {
    return this.sendMessage(groupId, 'system', `✅ 任务完成: ${summary}`, {
      type: 'task_completed',
      metadata: { taskId, timestamp: Date.now() },
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 消息查询
  // ═══════════════════════════════════════════════════════════════

  /**
   * getMessages — 获取群组消息历史
   *
   * @param groupId - 群组 ID
   * @param limit - 最大条数（默认 50）
   * @returns 消息列表（按时间从新到旧）
   */
  getMessages(groupId: GroupId, limit: number = 50): ChatMessage[] {
    return this.messageStore
      .filter(m => m.groupId === groupId)
      .reverse()
      .slice(0, limit);
  }

  /**
   * getRecentMessages — 获取最近的全局消息
   */
  getRecentMessages(limit: number = 20): ChatMessage[] {
    return [...this.messageStore].reverse().slice(0, limit);
  }

  // ═══════════════════════════════════════════════════════════════
  // 外部 IM 适配器
  // ═══════════════════════════════════════════════════════════════

  /**
   * setExternalAdapter — 注册外部 IM 适配器
   *
   * Phase 3 对接飞书/企业微信时使用。
   *
   * @param adapter - 外部 IM 适配器实例
   */
  setExternalAdapter(adapter: ExternalIMAdapter): void {
    this.externalAdapter = adapter;
    console.log(`[GroupChatManager] ✅ 外部 IM 适配器已注册:`, adapter.constructor.name);
  }

  /**
   * removeExternalAdapter — 移除外部 IM 适配器
   */
  removeExternalAdapter(): void {
    this.externalAdapter = null;
    console.log(`[GroupChatManager] 外部 IM 适配器已移除`);
  }

  // ═══════════════════════════════════════════════════════════════
  // 统计
  // ═══════════════════════════════════════════════════════════════

  /**
   * getStats — 获取群聊统计
   */
  getStats(): GroupChatStats {
    const byType: Record<string, number> = { department: 0, management: 0, project: 0, direct_message: 0 };
    let activeMembers = 0;

    for (const group of this.groups.values()) {
      byType[group.type] = (byType[group.type] || 0) + 1;
      activeMembers += group.members.size;
    }

    return {
      totalGroups: this.groups.size,
      totalMessages: this.messageStore.length,
      groupsByType: byType as GroupChatStats['groupsByType'],
      activeMembers,
    };
  }
}

// ── ExternalIMAdapter — 外部 IM 适配器接口 ──

/**
 * ExternalIMAdapter — 外部即时通讯适配器接口
 *
 * 用于对接飞书、企业微信、钉钉等外部 IM 平台。
 * Phase 3 实现具体适配器。
 *
 * 使用方式：
 *   class FeishuAdapter implements ExternalIMAdapter {
 *     async sendToGroup(groupName: string, message: ChatMessage): Promise<void> {
 *       // 调用飞书 API 发送群消息
 *     }
 *   }
 */
export interface ExternalIMAdapter {
  readonly name: string;
  initialize(): Promise<void>;
  sendToGroup(groupName: string, message: ChatMessage): Promise<void>;
  sendDirectMessage(userId: string, message: ChatMessage): Promise<void>;
}
