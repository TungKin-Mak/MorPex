/**
 * scripts/check-llm.ts — LLM 配置检查脚本（用 MorPex 自身配置链路解析，不依赖 shell 手动 export）
 *
 * 报告：
 *   1. config/morpex.yaml 是否解析成功 + llm 配置内容
 *   2. apiKey 是否解析到（process.env → Windows 用户级 env 自动兜底，不打印值）
 *   3. enabled 状态
 *   4. 网关可达性 + 模型名是否在网关模型列表中
 *
 * 运行：npx tsx scripts/check-llm.ts
 */
import { loadMorpexConfig } from '../packages/core/src/infrastructure/adapters/pi-bridge/yamlConfig.js';

async function main(): Promise<void> {
  console.log('══════════════════════════════════════════');
  console.log('  MorPex LLM 配置检查');
  console.log('══════════════════════════════════════════\n');

  // 1. 读取配置（MorPex 自身解析链路：parseYaml + resolveEnvRefs）
  const cfg = loadMorpexConfig();
  if (!cfg?.llm) {
    console.log('❌ 未读取到 llm 配置（config/morpex.yaml 缺失或解析失败）');
    console.log('   请确认 config/morpex.yaml 存在且格式正确');
    return;
  }
  const llm = cfg.llm;
  const mode = llm.mode ?? 'builtin';
  console.log(`【1】配置解析`);
  console.log(`    mode     = ${mode}（builtin=内置 provider / gateway=自定义网关）`);
  console.log(`    enabled  = ${llm.enabled}`);
  console.log(`    provider = ${llm.provider ?? '(未填)'}`);
  console.log(`    baseUrl  = ${llm.baseUrl ?? '(未填)'}`);
  console.log(`    model    = ${llm.model ?? '(未填)'}`);
  console.log(`    apiKey   = ${llm.apiKey ? '已解析到（见【2】）' : '❌ 空'}`);

  // 2. apiKey 解析状态
  const key = llm.apiKey ?? '';
  console.log(`\n【2】apiKey 解析状态`);
  if (key) {
    console.log(`    ✅ 已解析（长度=${key.length}，前缀=${key.slice(0, 8)}…）`);
  } else {
    console.log(`    ❌ 未解析到（${llm.apiKey === '' ? '配置里 ${VAR} 引用的环境变量未找到' : '未配置'}）`);
  }

  // 3. enabled 状态
  console.log(`\n【3】启用状态`);
  if (!llm.enabled) {
    console.log(`    ⚠️ enabled=false —— LLM 未启用`);
    return;
  }

  // 4. 模型有效性：builtin → pi-ai 内置注册表验证；gateway → HTTP /models 验证
  console.log(`\n【4】模型有效性（${mode} 模式）`);
  if (mode === 'builtin') {
    try {
      const { PiBridge } = await import('../packages/core/src/infrastructure/adapters/index.js');
      const bridge = new PiBridge();
      await bridge.init();
      const models = (bridge as unknown as { models: { getModel(p: string, id: string): unknown } }).models;
      const found = models.getModel(llm.provider ?? '', llm.model ?? '');
      console.log(`    内置 provider "${llm.provider}" 模型 "${llm.model}": ${found ? '✅ 在注册表' : '❌ 不在注册表——请检查 provider/model'}`);
      if (found) {
        const f = found as { contextWindow?: number; maxTokens?: number };
        console.log(`    contextWindow=${f.contextWindow} maxTokens=${f.maxTokens}`);
      }
    } catch (err) {
      console.log(`    ❌ 内置模型验证失败: ${(err as Error).message}`);
    }
  } else {
    // gateway 模式：HTTP /models 验证
    console.log(`\n【4】网关可达性（${llm.baseUrl}）`);
    if (!key) {
      console.log(`    ❌ apiKey 为空，跳过网关测试`);
      return;
    }
    try {
      const res = await fetch(`${llm.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        console.log(`    ✅ 网关可达（HTTP ${res.status}）`);
        try {
          const body = (await res.json()) as { data?: Array<{ id: string }> };
          const ids = (body.data ?? []).map((m) => m.id);
          console.log(`    网关模型列表（${ids.length} 个）: ${ids.join(', ')}`);
          if (llm.model) {
            const ok = ids.includes(llm.model);
            console.log(`    配置模型 "${llm.model}" 是否在列表: ${ok ? '✅ 有效' : '❌ 不在列表——调用会失败，请改为列表中的模型名'}`);
          }
        } catch {
          console.log(`    （响应非标准 JSON，已可达）`);
        }
      } else {
        const text = await res.text();
        console.log(`    ❌ 网关返回 HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
    } catch (err) {
      console.log(`    ❌ 网关不可达: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error('❌ 检查脚本异常:', err);
  process.exit(1);
});
