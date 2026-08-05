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
  console.log(`【1】配置解析`);
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
    // 会话 10：GLM 网关（智谱）——无 g2a_ 前缀要求；仅提示智谱 key 格式
    if (!key.startsWith('f53c2b')) {
      console.log(`    ℹ️ 前缀非智谱示例 f53c2b…（GLM 网关 key 无固定前缀要求，仅提示）`);
    }
  } else {
    console.log(`    ❌ 未解析到（${llm.apiKey === '' ? '配置里 ${VAR} 引用的环境变量未找到' : '未配置'}）`);
  }

  // 3. enabled 状态
  console.log(`\n【3】启用状态`);
  if (!llm.enabled) {
    console.log(`    ⚠️ enabled=false —— 使用内置默认（GLM-4.7-Flash，读 GLM_API_KEY）`);
    console.log(`    （当前仅 GLM-4.7-Flash；enabled=false 走内置默认模型）`);
    return;
  }

  // 4. 网关可达性 + 模型名
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
      console.log(`      （invalid_api_key → apiKey 无效，请确认 config 里 ${'${GROK2API_API_KEY}'} 指向的密钥是否正确）`);
    }
  } catch (err) {
    console.log(`    ❌ 网关不可达: ${(err as Error).message}`);
  }
}

main().catch((err) => {
  console.error('❌ 检查脚本异常:', err);
  process.exit(1);
});
