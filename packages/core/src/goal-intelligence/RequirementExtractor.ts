/**
 * RequirementExtractor — 从目标中提取能力需求
 */
import type { GoalContext } from '../contracts/goal.js';

export class RequirementExtractor {
  static async extract(ctx: GoalContext): Promise<GoalContext> {
    return { ...ctx, requiredCapabilities: RequirementExtractor.inferCapabilities(ctx.objective) };
  }

  static inferCapabilities(objective: string): string[] {
    const caps: string[] = [];
    const lower = objective.toLowerCase();
    // 中文关键词
    if (lower.includes('设计') || lower.includes('design')) caps.push('design');
    if (lower.includes('开发') || lower.includes('code') || lower.includes('实现') || lower.includes('implement')) caps.push('code');
    if (lower.includes('测试') || lower.includes('test')) caps.push('test');
    if (lower.includes('部署') || lower.includes('deploy')) caps.push('deploy');
    if (lower.includes('分析') || lower.includes('research') || lower.includes('analy')) caps.push('analyze');
    if (lower.includes('销售') || lower.includes('sell') || lower.includes('发布') || lower.includes('publish')) caps.push('publish');
    // 英文关键词 — 软件工程能力
    if (lower.includes('backend') || lower.includes('back-end') || lower.includes('server') || lower.includes('api')) caps.push('Backend Development');
    if (lower.includes('frontend') || lower.includes('front-end') || lower.includes('client') || lower.includes('ui') || lower.includes('web')) caps.push('Frontend Development');
    if (lower.includes('database') || lower.includes('db') || lower.includes('sql') || lower.includes('data')) caps.push('Database Design');
    if (lower.includes('auth') || lower.includes('login') || lower.includes('register') || lower.includes('user')) caps.push('User Authentication');
    if (lower.includes('team') || lower.includes('collaborat') || lower.includes('share')) caps.push('Team Collaboration');
    if (lower.includes('todo') || lower.includes('task') || lower.includes('crud')) caps.push('CRUD Operations');
    // 硬件/电商关键词
    if (lower.includes('pcb') || lower.includes('circuit') || lower.includes('board')) caps.push('PCB Design');
    if (lower.includes('firmware') || lower.includes('embedded')) caps.push('Firmware Development');
    if (lower.includes('amazon') || lower.includes('listing') || lower.includes('ecommerce')) caps.push('Amazon Listing');
    if (lower.includes('keyword') || lower.includes('seo')) caps.push('Keyword Research');
    if (lower.includes('image') || lower.includes('photo') || lower.includes('picture')) caps.push('Image Generation');
    if (lower.includes('video') || lower.includes('film') || lower.includes('movie')) caps.push('Video Production');
    if (lower.includes('industrial') || lower.includes('3d') || lower.includes('model')) caps.push('Industrial Design');
    // 兜底
    if (caps.length === 0) caps.push('execute');
    return caps;
  }
}
