/**
 * XJMCU MCP Server — stdio JSON-RPC（MCP 协议 2024-11-05 子集）
 *
 * 对外暴露 2 个工具给任意支持 MCP 的 Agent（pi/Claude/Cursor…）：
 *   xjmcu_compile  {chip, source, output?}   → buildcli 编译
 *   xjmcu_simulate {xbin, timeout_ms?}       → astrocli 仿真
 *
 * 实现：依赖零新增的极简 stdio JSON-RPC（initialize/tools.list/tools.call）。
 * 与 DomainPrimitiveRegistry 内部路径共用同一 ActionPrimitive 实现（单一真相源）：
 *   - MorPex 引擎内：YamlWorkflowRuntime → DomainPrimitiveRegistry.execute('xjmcu.compile')
 *   - 外部 Agent：    MCP client → tools/call('xjmcu_compile')
 *
 * 启动：node --import tsx packages/workflows/xjmcu/src/mcp/server.ts
 * @packageDocumentation
 */
import { Readable, Writable } from 'node:process';
import { XJMcuCompileAction } from '../actions/compile.js';
import { XJMcuSimulateAction } from '../actions/simulate.js';

// ── 工具定义（与 ActionPrimitive inputSchema 一致）──

const TOOLS = [
  {
    name: 'xjmcu_compile',
    description: '编译 XJ MCU 固件：buildcli build，产出 firmware.hex / firmware.xbin',
    inputSchema: {
      type: 'object',
      properties: {
        chip: { type: 'string', description: '芯片型号（如 XC8P9530）' },
        source: { type: 'string', description: 'C 源码文件路径' },
        output: { type: 'string', description: '输出目录（可选）' },
      },
      required: ['chip', 'source'],
    },
  },
  {
    name: 'xjmcu_simulate',
    description: 'astrocli 仿真运行固件，校验功能时序',
    inputSchema: {
      type: 'object',
      properties: {
        xbin: { type: 'string', description: '.xbin 固件路径' },
        timeout_ms: { type: 'number', description: '超时毫秒（默认 30000）' },
      },
      required: ['xbin'],
    },
  },
] as const;

type ToolCallResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  const action =
    name === 'xjmcu_compile' ? new XJMcuCompileAction()
    : name === 'xjmcu_simulate' ? new XJMcuSimulateAction()
    : null;
  if (!action) {
    return { content: [{ type: 'text', text: `未知工具: ${name}` }], isError: true };
  }
  const r = await action.execute(args);
  return {
    content: [{ type: 'text', text: JSON.stringify(r.success ? r.data : { error: r.error }, null, 2) }],
    isError: !r.success,
  };
}

// ── 极简 stdio JSON-RPC 循环（LSP 式 Content-Length 分帧 + 行分帧兼容）──

let buf = '';

function handleLine(line: string): void {
  if (!line.trim()) return;
  let msg: { id?: number | string; method?: string; params?: Record<string, unknown> };
  try {
    msg = JSON.parse(line);
  } catch {
    return; // 非 JSON 行忽略（stdio 噪声容错）
  }
  const { id, method } = msg;
  const reply = (result: unknown): void => {
    if (id === undefined) return;
    write(JSON.stringify({ jsonrpc: '2.0', id, result }));
  };

  switch (method) {
    case 'initialize':
      reply({
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mcp-xjmcu', version: '1.0.0' },
      });
      break;
    case 'notifications/initialized':
      break; // 通知无响应
    case 'tools/list':
      reply({ tools: TOOLS });
      break;
    case 'tools/call': {
      const toolName = String(msg.params?.name ?? '');
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      callTool(toolName, args)
        .then((r) => {
          if (id !== undefined) write(JSON.stringify({ jsonrpc: '2.0', id, result: r }));
        })
        .catch((err: unknown) => {
          if (id !== undefined) {
            write(JSON.stringify({
              jsonrpc: '2.0', id,
              result: { content: [{ type: 'text', text: `执行失败: ${String(err)}` }], isError: true },
            }));
          }
        });
      break;
    }
    default:
      if (id !== undefined && method?.startsWith('rpc.')) {
        // ping 等 rpc 扩展
        write(JSON.stringify({ jsonrpc: '2.0', id, result: {} }));
      }
  }
}

function write(s: string): void {
  Writable.prototype.write.call(process.stdout, s + '\n');
}

Readable.prototype.on.call(process.stdin, 'data', (chunk: Buffer) => {
  buf += chunk.toString('utf-8');
  let idx: number;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).replace(/\r$/, '');
    buf = buf.slice(idx + 1);
    // 兼容 LSP 式 Content-Length 帧：头行后跟空行 + JSON 体
    const m = line.match(/^Content-Length:\s*(\d+)/i);
    if (m) {
      const need = Number(m[1]);
      const bodyStart = buf.indexOf('\n\n');
      if (bodyStart >= 0 && bodyStart + 2 + Number(m[1]) <= buf.length) {
        const body = buf.slice(bodyStart + 2, bodyStart + 2 + need);
        buf = buf.slice(bodyStart + 2 + need);
        handleLine(body);
      }
      continue;
    }
    handleLine(line);
  }
});

console.error('[mcp-xjmcu] ✅ stdio server 就绪（tools: xjmcu_compile / xjmcu_simulate）');
