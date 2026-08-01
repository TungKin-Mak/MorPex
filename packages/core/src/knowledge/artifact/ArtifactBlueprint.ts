/**
 * ArtifactBlueprint — 产物蓝图
 * Phase 1-5: 在执行之前先定义产物规格，Execution 围绕蓝图进行
 */
export interface ArtifactBlueprint {
  id: string;
  name: string;
  type: 'document' | 'code' | 'design' | 'data' | 'media';
  description: string;
  requiredCapabilities: string[];
  dependsOn: string[];
  outputFormat: string;
  validationRules: string[];
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
}

export class ArtifactBlueprintBuilder {
  static fromGoal(goalContext: { objective: string; requiredCapabilities: string[]; domain?: string }): ArtifactBlueprint[] {
    const blueprints: ArtifactBlueprint[] = [];
    const baseId = `bp_${Date.now()}`;

    if (goalContext.requiredCapabilities.some(c => c.includes('PCB') || c.includes('Design'))) {
      blueprints.push({ id: `${baseId}_pcb`, name: 'PCB Design Files', type: 'design', description: 'PCB 设计文件（原理图、布局、Gerber）', requiredCapabilities: ['PCB Design'], dependsOn: [], outputFormat: '.zip (Gerber + BOM)', validationRules: ['dfm_check'], status: 'PENDING' });
      blueprints.push({ id: `${baseId}_firmware`, name: 'Firmware Binary', type: 'code', description: '固件二进制文件', requiredCapabilities: ['Firmware Development'], dependsOn: [`${baseId}_pcb`], outputFormat: '.hex/.bin', validationRules: ['compile_check'], status: 'PENDING' });
    }
    if (goalContext.requiredCapabilities.some(c => c.includes('Amazon') || c.includes('Listing'))) {
      blueprints.push({ id: `${baseId}_listing`, name: 'Amazon Listing', type: 'document', description: 'Amazon 商品列表', requiredCapabilities: ['Amazon Listing'], dependsOn: [], outputFormat: 'JSON', validationRules: ['amazon_policy'], status: 'PENDING' });
      blueprints.push({ id: `${baseId}_images`, name: 'Product Images', type: 'media', description: '商品图片', requiredCapabilities: ['Image Generation'], dependsOn: [`${baseId}_listing`], outputFormat: '.jpg/.png', validationRules: ['image_quality'], status: 'PENDING' });
    }
    if (goalContext.requiredCapabilities.some(c => c.includes('Backend') || c.includes('Frontend'))) {
      blueprints.push({ id: `${baseId}_api`, name: 'API Server', type: 'code', description: '后端 API 服务', requiredCapabilities: ['Backend Development'], dependsOn: [], outputFormat: 'TypeScript + Node.js', validationRules: ['code_review'], status: 'PENDING' });
    }
    if (goalContext.requiredCapabilities.some(c => c.includes('Video') || c.includes('Content'))) {
      blueprints.push({ id: `${baseId}_video`, name: 'Promotional Video', type: 'media', description: '产品宣传视频', requiredCapabilities: ['Video Production'], dependsOn: [], outputFormat: '.mp4', validationRules: ['video_quality'], status: 'PENDING' });
    }
    if (blueprints.length === 0) {
      blueprints.push({ id: `${baseId}_doc`, name: 'Project Document', type: 'document', description: `项目文档: ${goalContext.objective.substring(0, 80)}`, requiredCapabilities: goalContext.requiredCapabilities.length > 0 ? [goalContext.requiredCapabilities[0]] : ['execute'], dependsOn: [], outputFormat: 'Markdown', validationRules: ['min_length'], status: 'PENDING' });
    }
    return blueprints;
  }
}
