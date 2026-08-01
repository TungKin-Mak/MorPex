/**
 * IndustryRegistry — 行业适配器注册中心
 *
 * 管理所有行业的工作流模板、意图提示、工具建议。
 * 供 Intent Plugin 和 Planner Plugin 使用。
 */

import type { IndustryAdapter, IndustryType, WorkflowTemplate } from './types.js';

/**
 * 所有行业适配器定义
 */
const ALL_INDUSTRIES: IndustryAdapter[] = [
  // ═══════════════════════════════════════
  // Software Development
  // ═══════════════════════════════════════
  {
    type: 'software',
    label: '软件开发',
    intentHints: [
      '用户要求编写、修改或审查代码',
      '涉及编程语言、框架、数据库',
      '需要设计架构、API、系统设计',
    ],
    workflows: [
      {
        id: 'sw-dev',
        industry: 'software',
        name: '标准软件开发流程',
        steps: [
          { name: '需求分析', description: '分析用户需求，编写需求文档', requiredRole: 'pm', outputType: 'document', dependencies: [] },
          { name: '系统设计', description: '架构设计、技术选型、API 设计', requiredRole: 'cto', outputType: 'document', dependencies: ['需求分析'] },
          { name: '编码实现', description: '编写代码实现功能', requiredRole: 'engineer', outputType: 'code', dependencies: ['系统设计'] },
          { name: '代码审查', description: '审查代码质量、安全性', requiredRole: 'reviewer', outputType: 'report', dependencies: ['编码实现'] },
          { name: '测试验证', description: '编写测试、执行测试', requiredRole: 'qa', outputType: 'report', dependencies: ['编码实现'] },
          { name: '部署上线', description: '配置环境、部署发布', requiredRole: 'devops', outputType: 'config', dependencies: ['测试验证', '代码审查'] },
        ],
      },
    ],
    suggestedTools: ['git', 'eslint', 'prettier', 'jest', 'docker', 'github-actions'],
    keywords: ['代码', '开发', '编程', '网站', '应用', 'API', '数据库', '前端', '后端', '全栈', 'bug', '功能'],
  },

  // ═══════════════════════════════════════
  // Video Production
  // ═══════════════════════════════════════
  {
    type: 'video',
    label: '视频制作',
    intentHints: [
      '用户要制作、编辑视频内容',
      '涉及脚本、分镜、剪辑、渲染',
      '需要视频创作工作流',
    ],
    workflows: [
      {
        id: 'video-prod',
        industry: 'video',
        name: '视频制作流程',
        steps: [
          { name: '脚本创作', description: '撰写视频脚本、台词', requiredRole: 'writer', outputType: 'document', dependencies: [] },
          { name: '分镜设计', description: '设计分镜头脚本', requiredRole: 'designer', outputType: 'image', dependencies: ['脚本创作'] },
          { name: '素材制作', description: '录制/生成视频素材', requiredRole: 'producer', outputType: 'video_script', dependencies: ['分镜设计'] },
          { name: '后期剪辑', description: '剪辑、特效、配音', requiredRole: 'editor', outputType: 'video_script', dependencies: ['素材制作'] },
          { name: '发布上线', description: '导出、发布到平台', requiredRole: 'producer', outputType: 'other', dependencies: ['后期剪辑'] },
        ],
      },
    ],
    suggestedTools: ['剪映', 'Premiere', 'After Effects', 'DaVinci'],
    keywords: ['视频', '脚本', '剪辑', '分镜', '渲染', '配音', '字幕', '短视频'],
  },

  // ═══════════════════════════════════════
  // Content Creation
  // ═══════════════════════════════════════
  {
    type: 'content',
    label: '内容创作',
    intentHints: [
      '用户要撰写文章、博客、营销文案',
      '涉及内容策划、写作、编辑',
      '需要内容创作工作流',
    ],
    workflows: [
      {
        id: 'content-create',
        industry: 'content',
        name: '内容创作流程',
        steps: [
          { name: '选题策划', description: '确定主题、目标受众', requiredRole: 'editor', outputType: 'document', dependencies: [] },
          { name: '大纲编写', description: '撰写文章大纲', requiredRole: 'writer', outputType: 'document', dependencies: ['选题策划'] },
          { name: '内容撰写', description: '撰写完整内容', requiredRole: 'writer', outputType: 'document', dependencies: ['大纲编写'] },
          { name: '编辑审校', description: '编辑、校对、优化', requiredRole: 'editor', outputType: 'document', dependencies: ['内容撰写'] },
          { name: '发布分发', description: '发布到各平台', requiredRole: 'editor', outputType: 'other', dependencies: ['编辑审校'] },
        ],
      },
    ],
    suggestedTools: ['markdown', 'grammarly', 'wordpress'],
    keywords: ['文章', '博客', '内容', '写作', '文案', '编辑', '发布', '营销'],
  },

  // ═══════════════════════════════════════
  // E-commerce
  // ═══════════════════════════════════════
  {
    type: 'ecommerce',
    label: '电商运营',
    intentHints: [
      '用户要运营电商店铺',
      '涉及商品上架、营销、数据分析',
      '需要电商工作流',
    ],
    workflows: [
      {
        id: 'ecom-ops',
        industry: 'ecommerce',
        name: '电商运营流程',
        steps: [
          { name: '选品分析', description: '市场调研、选品决策', requiredRole: 'pm', outputType: 'report', dependencies: [] },
          { name: '商品上架', description: '编写描述、上传图片、定价', requiredRole: 'operator', outputType: 'structured_data', dependencies: ['选品分析'] },
          { name: '营销推广', description: '制定推广计划、执行', requiredRole: 'marketer', outputType: 'document', dependencies: ['商品上架'] },
          { name: '数据分析', description: '分析销售数据、优化', requiredRole: 'analyst', outputType: 'report', dependencies: ['营销推广'] },
          { name: '客户服务', description: '处理售后、评价管理', requiredRole: 'operator', outputType: 'other', dependencies: ['商品上架'] },
        ],
      },
    ],
    suggestedTools: ['生意参谋', '直通车', '数据罗盘'],
    keywords: ['电商', '商品', '上架', '营销', '推广', '店铺', '运营', '选品'],
  },
];

/**
 * IndustryRegistry — 行业适配器注册中心
 */
export class IndustryRegistry {
  private adapters: Map<IndustryType, IndustryAdapter> = new Map();

  constructor(enabledIndustries?: IndustryType[]) {
    const enabled = enabledIndustries ?? ['software', 'video', 'content', 'ecommerce'];
    for (const industry of ALL_INDUSTRIES) {
      if (enabled.includes(industry.type)) {
        this.adapters.set(industry.type, industry);
      }
    }
  }

  /** 获取行业适配器 */
  get(type: IndustryType): IndustryAdapter | undefined {
    return this.adapters.get(type);
  }

  /** 获取所有已启用的行业 */
  getAll(): IndustryAdapter[] {
    return [...this.adapters.values()];
  }

  /** 获取行业的工作流模板 */
  getWorkflows(type: IndustryType): WorkflowTemplate[] {
    return this.adapters.get(type)?.workflows ?? [];
  }

  /** 获取行业的意图提示 */
  getIntentHints(type: IndustryType): string[] {
    return this.adapters.get(type)?.intentHints ?? [];
  }

  /** 获取行业的建议工具 */
  getSuggestedTools(type: IndustryType): string[] {
    return this.adapters.get(type)?.suggestedTools ?? [];
  }

  /** 获取行业的关键词 */
  getKeywords(type: IndustryType): string[] {
    return this.adapters.get(type)?.keywords ?? [];
  }

  /** 根据输入文本猜测行业 */
  guessIndustry(input: string): { industry: IndustryType; confidence: number } {
    const lower = input.toLowerCase();
    let bestIndustry: IndustryType = 'general';
    let bestScore = 0;

    for (const [type, adapter] of this.adapters) {
      let score = 0;
      for (const kw of adapter.keywords) {
        if (lower.includes(kw.toLowerCase())) score += 1;
      }
      // 归一化
      score = score / Math.max(adapter.keywords.length, 1);
      if (score > bestScore) {
        bestScore = score;
        bestIndustry = type;
      }
    }

    return { industry: bestIndustry, confidence: Math.min(bestScore * 2, 1) };
  }

  /** 获取所有意图提示（供 IntentResolver 使用） */
  getAllIntentHints(): string[] {
    const hints: string[] = [];
    for (const adapter of this.adapters.values()) {
      hints.push(...adapter.intentHints);
    }
    return hints;
  }
}
