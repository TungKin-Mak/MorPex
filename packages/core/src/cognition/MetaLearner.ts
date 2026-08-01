import { EventBus } from '../common/EventBus.js';

// ── Types ──

export interface TaskRecord {
  taskId: string;
  goal: string;
  result: 'success' | 'failure';
  duration: number;
  departmentId?: string;
  planUsed?: string;
  capabilities?: string[];
}

export interface UserFeedback {
  rating: number; // 1-5
  comments?: string;
  corrections?: string;
}

export interface LearningResult {
  preferencesUpdated: boolean;
  patternsLearned: number;
  confidenceDelta: number;
  insights: string[];
}

export interface MetaLearnerLike {
  learnFromTask(task: TaskRecord, feedback?: UserFeedback): Promise<LearningResult>;
  readonly name: string;
}

// ── 内部类型 ──

interface DepartmentPattern {
  successRate: number;
  avgDuration: number;
  commonTasks: string[];
  taskCount: number;
  successCount: number;
}

interface PreferenceModel {
  preferredPlanMode: 'quick' | 'full' | 'auto';
  preferredCapabilities: string[];
  departmentPatterns: Map<string, DepartmentPattern>;
  userRatingHistory: number[];
  lastUpdated: number;
}

// ── MetaLearner ──

export class MetaLearner {
  name = 'MetaLearner';
  version = '1.0.0';

  private eventBus: EventBus;
  private model: PreferenceModel;

  constructor(eventBus: EventBus) {
    if (!eventBus) throw new Error('[MetaLearner] EventBus 是必填参数');
    this.eventBus = eventBus;

    this.model = {
      preferredPlanMode: 'auto',
      preferredCapabilities: [],
      departmentPatterns: new Map(),
      userRatingHistory: [],
      lastUpdated: Date.now(),
    };
  }

  async learnFromTask(task: TaskRecord, feedback?: UserFeedback): Promise<LearningResult> {
    const changes: string[] = [];
    let preferencesUpdated = false;

    // 1. 更新部门模式
    if (task.departmentId) {
      this.updateDepartmentPattern(task);
      changes.push('department_pattern_updated');
    }

    // 2. 处理用户反馈
    if (feedback) {
      this.model.userRatingHistory.push(feedback.rating);
      if (feedback.rating >= 4 && task.result === 'success') {
        this.model.preferredPlanMode = task.planUsed === 'full' ? 'full' : 'quick';
        preferencesUpdated = true;
        changes.push('plan_mode_preference_updated');
      }
      if (feedback.corrections) {
        changes.push('user_correction_received');
      }
    }

    // 3. 更新能力偏好（从成功任务中学习）
    if (task.capabilities && task.result === 'success') {
      for (const cap of task.capabilities) {
        if (!this.model.preferredCapabilities.includes(cap)) {
          this.model.preferredCapabilities.push(cap);
        }
      }
      changes.push('capabilities_extended');
    }

    this.model.lastUpdated = Date.now();

    // 4. 发射学习事件
    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'brain.meta.learned',
      timestamp: Date.now(),
      executionId: task.taskId,
      source: 'meta-learner',
      payload: {
        taskId: task.taskId,
        result: task.result,
        preferencesUpdated,
        patternsLearned: changes.length,
        changes,
      },
    });

    return {
      preferencesUpdated,
      patternsLearned: changes.length,
      confidenceDelta: feedback ? (feedback.rating - 3) / 5 : 0,
      insights: changes,
    };
  }

  private updateDepartmentPattern(task: TaskRecord): void {
    const deptId = task.departmentId!;
    let pattern = this.model.departmentPatterns.get(deptId);

    if (!pattern) {
      pattern = { successRate: 0, avgDuration: 0, commonTasks: [], taskCount: 0, successCount: 0 };
      this.model.departmentPatterns.set(deptId, pattern);
    }

    pattern.taskCount++;
    if (task.result === 'success') pattern.successCount++;
    pattern.successRate = pattern.successCount / pattern.taskCount;
    pattern.avgDuration = (pattern.avgDuration * (pattern.taskCount - 1) + task.duration) / pattern.taskCount;

    // 记录常见任务前缀
    const goalPrefix = task.goal.substring(0, 20);
    if (!pattern.commonTasks.includes(goalPrefix)) {
      pattern.commonTasks.push(goalPrefix);
      if (pattern.commonTasks.length > 20) pattern.commonTasks.shift();
    }
  }

  getPreferenceModel(): Readonly<PreferenceModel> {
    return this.model;
  }

  getDepartmentPattern(deptId: string): DepartmentPattern | undefined {
    return this.model.departmentPatterns.get(deptId);
  }

  getRecommendedMode(deptId?: string): 'quick' | 'full' | 'auto' {
    // 如果某个部门成功率高且任务数足够，推荐对应模式
    if (deptId) {
      const pattern = this.model.departmentPatterns.get(deptId);
      if (pattern && pattern.taskCount >= 3) {
        if (pattern.successRate >= 0.8) return 'quick';
        if (pattern.successRate < 0.5) return 'full';
      }
    }
    return this.model.preferredPlanMode;
  }

  getStats(): { totalDepartments: number; userFeedbackCount: number; preferredMode: string } {
    return {
      totalDepartments: this.model.departmentPatterns.size,
      userFeedbackCount: this.model.userRatingHistory.length,
      preferredMode: this.model.preferredPlanMode,
    };
  }
}
