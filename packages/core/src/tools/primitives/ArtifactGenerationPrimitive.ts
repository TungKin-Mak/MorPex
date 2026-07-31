/**
 * ArtifactGenerationPrimitive — 产物生成原语
 *
 * 通用的产物生成操作，始终以知识查询结果为前提：
 *   1. 先查询 KnowledgeQueryPrimitive 获取已有知识
 *   2. 将知识作为上下文注入 LLM 生成
 *   3. 通过 FileOperationPrimitive 写入文件
 *   4. 通过 ArtifactFacade 注册产物生命周期
 *
 * 支持的产物类型：
 *   - code: 源代码文件
 *   - doc: 文档（Markdown, HTML 等）
 *   - config: 配置文件（JSON, YAML, TOML 等）
 *   - data: 数据文件（CSV, JSONL 等）
 *   - report: 分析报告
 *
 * @packageDocumentation
 */

import type { ActionPrimitive, ActionResult, ArtifactGenerationRequest, ArtifactGenerationResult } from './types.js';
import type { ForcedQueryGuard } from '../../ontology/ForcedQueryGuard.js';
import { runOntologyGroundedReasoning } from '../../ontology/runOntologyGroundedReasoning.js';
import { OntologyService } from '../../ontology/OntologyService.js';
import { systemMetadataGraph } from '../../metadata/SystemMetadataGraph.js';
import { ObjectTypeRegistry } from '../../ontology/ObjectTypeRegistry.js';
import type { IEventStore } from '../../protocol/events/store/IEventStore.js';

// —— Ontology Gate Integration ——

let ontologyGuard: ForcedQueryGuard | null = null;
let ontologyService: OntologyService | null = null;
let eventStoreRef: IEventStore | null = null;
/** vNext+: EventBus 引用（QueryMiss 实时广播 → KnowledgeGapListener） */
let eventBusRef: { emit(event: { id: string; type: string; timestamp: number; executionId: string; source: string; payload: Record<string, unknown> }): void } | null = null;
/** 架构全功能实现：真实 piBridge（两阶段 Gate 的 LLM 推理由 bootstrap 注入） */
let piBridgeRef: ((params: { system?: string; prompt: string; temperature?: number; maxTokens?: number }) => Promise<{ text: string }>) | null = null;

/**
 * setPiBridge — 注入真实 piBridge（bootstrap 时调用；缺省回退到空文本占位）
 */
export function setPiBridge(
  fn: (params: { system?: string; prompt: string; temperature?: number; maxTokens?: number }) => Promise<{ text: string }>,
): void {
  piBridgeRef = fn;
  console.log('[ArtifactGenerationPrimitive] ✅ 真实 PiBridge 已注入（Gate 两阶段推理启用）');
}

/** 内部获取 piBridge（未注入时回退占位，保证不硬崩） */
function getPiBridge() {
  return piBridgeRef ?? (async () => ({ text: '' }));
}

/**
 * initializeOntologyGateForArtifact — 必须在 bootstrap 时调用
 */
export function initializeOntologyGateForArtifact(
  guard: ForcedQueryGuard,
  service: OntologyService,
  store?: IEventStore,
  eventBus?: { emit(event: { id: string; type: string; timestamp: number; executionId: string; source: string; payload: Record<string, unknown> }): void },
): void {
  ontologyGuard = guard;
  ontologyService = service;
  eventStoreRef = store ?? null;
  eventBusRef = eventBus ?? null;
  console.log('[ArtifactGenerationPrimitive] ✅ Ontology Gate 已注入');
}

function getOntologyGuard(): ForcedQueryGuard {
  if (!ontologyGuard) {
    throw new Error('[ArtifactGenerationPrimitive] Ontology Gate 未初始化');
  }
  return ontologyGuard;
}

// ── 产物生成器类型 ──

interface ArtifactGenerator {
  type: ArtifactGenerationRequest['type'];
  /** 根据规格和知识上下文生成产物 */
  generate: (spec: string, knowledge: string[], deptId: string) => Promise<Array<{ path: string; content: string; type: string }>>;
}

// ═══════════════════════════════════════════════════════════
// vNext+ Step2#4: 副作用前校验（Pre-Side-Effect Verify）
//   写文件 / 产生对外 Artifact 前必须通过 Verification + Ontology 引用检查。
//   失败则阻断（不落盘），而非事后评分。
// ═══════════════════════════════════════════════════════════

export type PreSideEffectVerifier = (
  files: Array<{ path: string; content: string; type: string }>,
  deptId: string,
  meta: { type: string; specification: string; riskTier: string },
) => Promise<{ ok: boolean; errors?: string[] }>;

// ── ArtifactGenerationPrimitive ──

export class ArtifactGenerationPrimitive implements ActionPrimitive {
  name = 'artifact_generation';
  description = '产物生成：基于知识查询结果生成代码、文档、配置、数据、报告等。始终遵循"知识优先"原则——先查知识再生成。';
  inputSchema = {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['code', 'doc', 'config', 'data', 'report'],
        description: '产物类型',
      },
      specification: { type: 'string', description: '产物规格描述' },
      knowledgeContext: {
        type: 'array',
        items: { type: 'string' },
        description: '知识上下文（由 KnowledgeQueryPrimitive 提供）',
      },
      outputPath: { type: 'string', description: '输出路径（可选，默认按类型自动分配）' },
      riskTier: {
        type: 'string',
        enum: ['tier-0', 'tier-1', 'tier-2'],
        description: '风险分级：tier-0 Critical（对外发布/资金，强制两阶段）/ tier-1 Standard（默认）/ tier-2 Draft（允许受控探索）',
      },
    },
    required: ['type', 'specification'],
  };

  /** 已注册的产物生成器 */
  private static generators: Map<ArtifactGenerationRequest['type'], ArtifactGenerator> = new Map();

  /** LLM 调用器（通过 PiBridge 注入） */
  private static llmCaller: ((prompt: string) => Promise<string>) | null = null;

  /** 文件操作执行器 */
  private static fileWriter: ((path: string, content: string, deptId: string) => Promise<ActionResult>) | null = null;

  /** 副作用前校验钩子（写文件前必须通过；未注入则跳过校验） */
  private static verificationHook: PreSideEffectVerifier | null = null;

  /**
   * setVerificationHook — 注入副作用前校验器（Pre-Side-Effect Verify）
   * 由 VerificationEngine / ApprovalGate 或外部策略注入。
   */
  static setVerificationHook(hook: PreSideEffectVerifier | null): void {
    ArtifactGenerationPrimitive.verificationHook = hook;
    console.log('[ArtifactGenerationPrimitive] ✅ 副作用前校验钩子已注入');
  }

  /**
   * registerGenerator — 注册产物生成器
   */
  static registerGenerator(generator: ArtifactGenerator): void {
    ArtifactGenerationPrimitive.generators.set(generator.type, generator);
  }

  /**
   * setLLMCaller — 注入 LLM 调用器
   */
  static setLLMCaller(caller: (prompt: string) => Promise<string>): void {
    ArtifactGenerationPrimitive.llmCaller = caller;
  }

  /**
   * setFileWriter — 注入文件写入器
   */
  static setFileWriter(writer: (path: string, content: string, deptId: string) => Promise<ActionResult>): void {
    ArtifactGenerationPrimitive.fileWriter = writer;
  }

  canHandle(task: string): number {
    const lower = task.toLowerCase();
    if (/生成|创建|写|编码|代码|文档|配置|报告|generate|create|write|code|document|config|report/.test(lower)) {
      return 0.9;
    }
    if (/产物|artifact|产出|输出/.test(lower)) {
      return 0.95;
    }
    return 0;
  }

  async execute(
    params: Record<string, unknown>,
    context?: { departmentId?: string; userId?: string; executionId?: string; missionId?: string }
  ): Promise<ActionResult> {
    const deptId = context?.departmentId || 'global';
    const type = params.type as ArtifactGenerationRequest['type'];
    const specification = params.specification as string;
    let knowledgeContext = params.knowledgeContext as string[] | undefined;
    const outputPath = params.outputPath as string | undefined;
    // vNext+: Graded Ontology Gate — 产物生成默认 Standard（tier-1）
    const riskTier = (params.riskTier as 'tier-0' | 'tier-1' | 'tier-2' | undefined) ?? 'tier-1';
    const executionId = context?.executionId || `art_${Date.now()}`;
    const missionId = context?.missionId;

    if (!type || !['code', 'doc', 'config', 'data', 'report'].includes(type)) {
      return { success: false, error: `ArtifactGenerationPrimitive: 不支持的产物类型 "${type}"` };
    }

    if (!specification?.trim()) {
      return { success: false, error: 'ArtifactGenerationPrimitive: specification 参数不能为空' };
    }

    // ★★★ Ontology Gate 强制检查 ★★★
    const guard = getOntologyGuard();

    // 如果没有提供 knowledgeContext，强制走 Ontology Gate 获取
    if (!knowledgeContext || knowledgeContext.length === 0) {
      console.log('[ArtifactGenerationPrimitive] ⚠️ 未提供 knowledgeContext，强制调用 Ontology Gate...');

      try {
        const ontologyResult = await runOntologyGroundedReasoning({
          goal: specification,
          missionId,
          ontology: ontologyService!,
          guard,
          piBridge: {
            generateText: getPiBridge(),
          },
          extraContext: `departmentId=${deptId}, type=${type}`,
          eventStore: eventStoreRef ?? undefined,
          eventBus: eventBusRef ?? undefined,
          scenario: 'artifact_generation',
          riskTier,
        });

        if (!ontologyResult.hasUsefulFacts) {
          // vNext+: tier-2 允许受控探索继续；tier-0/1 阻断并要求补充知识
          if (ontologyResult.riskTier === 'tier-2') {
            console.warn('[ArtifactGenerationPrimitive] ⚠️ Ontology 无有效事实（tier-2 受控探索），继续生成并标注不确定性');
            knowledgeContext = [
              '[ControlledExploration] Ontology 未返回有效事实，本次生成基于尽力而为，缺失已记录为 QueryMiss 信号',
            ];
          } else {
            return {
              success: false,
              error: 'ArtifactGenerationPrimitive: Ontology Gate 未返回有效知识上下文，无法生成产物（QueryMiss 已记录）',
              data: {
                success: false,
                files: [],
                knowledgeGaps: ['Ontology 未提供足够事实', `tier=${ontologyResult.riskTier}`],
              } satisfies ArtifactGenerationResult,
            };
          }
        } else {
          // 将 Ontology 返回的事实转为 knowledgeContext
          knowledgeContext = ontologyResult.proposal.referenced_object_ids.map((f: any) => JSON.stringify(f)) || [];
        }
      } catch (err) {
        return {
          success: false,
          error: `[Ontology Gate] 强制知识查询失败: ${(err as Error).message}`,
        };
      }
    }

    // 继续原有生成逻辑（已确保有知识上下文）
    guard.recordToolCall(executionId, 'artifact_generation_start', { type, specification, knowledgeCount: knowledgeContext?.length }, null);

    // 1. 尝试使用注册的生成器
    const generator = ArtifactGenerationPrimitive.generators.get(type);
    let files: Array<{ path: string; content: string; type: string }> = [];

    if (generator) {
      try {
        files = await generator.generate(specification, knowledgeContext || [], deptId);
      } catch (err) {
        console.warn(`[ArtifactGenerationPrimitive] ⚠️ 生成器 "${type}" 失败，尝试 LLM 降级: ${(err as Error).message}`);
      }
    }

    // 2. 降级：使用 LLM 生成
    if (files.length === 0 && ArtifactGenerationPrimitive.llmCaller) {
      try {
        const knowledgeBlock = knowledgeContext && knowledgeContext.length > 0
          ? `\n参考知识:\n${knowledgeContext.map((k, i) => `  [${i + 1}] ${k}`).join('\n')}`
          : '\n⚠️ 未提供知识上下文——生成结果可能不准确，建议先使用 KnowledgeQueryPrimitive 查询知识。';

        const prompt = `你是一个专业的${type === 'code' ? '程序员' : type === 'doc' ? '技术文档写手' : type === 'config' ? '运维工程师' : type === 'data' ? '数据分析师' : '报告撰写专家'}。

任务: 根据以下规格生成${type === 'code' ? '代码' : type === 'doc' ? '文档' : type === 'config' ? '配置文件' : type === 'data' ? '数据' : '报告'}。

规格说明:
${specification}

${knowledgeBlock}

请输出 JSON 格式:
{
  "files": [
    { "path": "文件名（含路径）", "content": "完整文件内容", "type": "文件类型" }
  ]
}

要求:
- 内容必须基于给定的知识，不能捏造不存在的事实
- 如果知识不足以完成任务，请在 content 中注明知识缺口
- 只输出 JSON，不要其他内容`;

        const response = await ArtifactGenerationPrimitive.llmCaller(prompt);
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          files = parsed.files || [];
        }
      } catch (err) {
        console.warn(`[ArtifactGenerationPrimitive] ⚠️ LLM 生成失败: ${(err as Error).message}`);
      }
    }

    // 3. 如果仍然没有生成结果，返回错误
    if (files.length === 0) {
      return {
        success: false,
        error: `ArtifactGenerationPrimitive: 无法生成 ${type} 产物。请确保已注册生成器或注入 LLM 调用器。`,
        data: {
          success: false,
          files: [],
          knowledgeGaps: ['无可用生成器', '无 LLM 调用器或调用失败'],
        } satisfies ArtifactGenerationResult,
      };
    }

    // ═══════════════════════════════════════════════════════════
    // vNext+ Step2#4: Pre-Side-Effect Verify — 写文件前必须通过校验
    //   失败则阻断（不落盘）并记录，而非事后评分
    // ═══════════════════════════════════════════════════════════
    if (ArtifactGenerationPrimitive.verificationHook) {
      const v = await ArtifactGenerationPrimitive.verificationHook(files, deptId, {
        type,
        specification,
        riskTier,
      });
      if (!v.ok) {
        const verifyErrors = v.errors?.length ? v.errors : ['未通过副作用前校验'];
        console.warn(
          `[ArtifactGenerationPrimitive] ⛔ 副作用前校验未通过，阻断写入 (${files.length} 个文件): ${verifyErrors.join('; ')}`,
        );
        guard.recordToolCall(
          executionId,
          'artifact_generation_blocked',
          { type, reason: 'pre_side_effect_verification_failed', errors: verifyErrors, riskTier },
          null,
        );
        return {
          success: false,
          error: `[Pre-Side-Effect Verify] 产物未通过校验，已阻断写入: ${verifyErrors.join('; ')}`,
          data: {
            success: false,
            files: [],
            knowledgeGaps: verifyErrors,
          } satisfies ArtifactGenerationResult,
        };
      }
    }

    // 4. 写入文件 + 记录 Ontology Trace
    const warnings: string[] = [];
    if (ArtifactGenerationPrimitive.fileWriter) {
      for (const file of files) {
        const targetPath = outputPath
          ? `${outputPath}/${file.path}`
          : file.path;
        const writeResult = await ArtifactGenerationPrimitive.fileWriter(targetPath, file.content, deptId);
        if (!writeResult.success) {
          warnings.push(`文件写入失败: ${targetPath} — ${writeResult.error}`);
        }
      }
    }

    guard.recordToolCall(executionId, 'artifact_generation_completed', { type, fileCount: files.length }, { files });

    const result: ArtifactGenerationResult = {
      success: true,
      files,
      warnings: warnings.length > 0 ? warnings : undefined,
    };

    console.log(
      `[ArtifactGenerationPrimitive] 📦 生成 ${type} 产物: ${files.length} 个文件 (Ontology Gate 通过, 部门: ${deptId})`
    );

    return { success: true, data: result };
  }
}
