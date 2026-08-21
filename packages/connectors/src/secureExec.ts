/**
 * secureExec — 安全子进程执行工具（防御性模式 · 参考 deepseek-harness defensive-patterns）
 *
 * ⚠️ 本文件与 `packages/core/src/infrastructure/common/secureExec.ts` 同源。
 * `@morpex/connectors` 是独立包（零依赖），由 core 依赖它；反向 import core 会成环，
 * 故此处内联一份（保持语义与 API 一致，禁止各自漂移）。改一处须同步另一处。
 *
 * 消除执行外壳/临时文件三类缺陷类：
 *   1. 凭据泄漏：把含 KEY/SECRET/TOKEN/PASSWORD 的环境变量带进子进程 → 输出/日志/产物泄漏。
 *   2. 结果折叠：timeout / exitCode / signal 是**正交独立因子**——一个进程可「超时」且「exit 0」
 *      （如它吞掉了 SIGTERM）。任何实现都不得把这些因子嵌套折叠进单一布尔结果。
 *   3. 可预测路径：临时文件/目录用可预测的公共路径 → symlink 竞态与越权读取。
 *
 * @packageDocumentation
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

// ── 凭据清洗 ──

/** 命中即剔除的 env 键名特征（大小写不敏感） */
const SECRET_KEY_PATTERN = /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/i;

/**
 * scrubEnv — 过滤含凭据特征的环境变量
 *
 * 任务环境（CI/本地）常带 DEEPSEEK_API_KEY / GITHUB_TOKEN 等；
 * 直接透传给子进程会让其出现在 `env`、`spill` 文件或命令输出中。
 * 消费端若确需部分透传，可在清洗后再显式补充。
 */
export function scrubEnv(env: Record<string, string | undefined> | undefined): Record<string, string | undefined> | undefined {
  if (!env) return undefined;
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      continue; // 不透传：不写入 out
    }
    out[key] = value;
  }
  return out;
}

// ── 正交结果 ──

/**
 * ExecOutcome — 子进程执行结果（正交独立因子）
 *
 * 约定（公共契约，双向遵守）：
 *   - `exitCode` 与 `timedOut` / `signal` **相互独立保留**，禁止嵌套折叠。
 *     一个进程可「超时（timedOut=true）且 exitCode===0」（它吞掉信号后正常退出）；
 *     消费端必须各自读取，不得从单一 `ok` 推断。
 *   - `signal` 记录导致终止的信号（SIGTERM/SIGKILL...），未终止则为 undefined。
 *   - `ok === !timedOut && exitCode === 0`（便捷字段，非真相源；真相源在三个独立字段）。
 */
export interface ExecOutcome {
  ok: boolean;
  exitCode?: number;
  timedOut?: boolean;
  signal?: string;
  stdout: string;
  stderr: string;
}

export interface RunCommandOptions {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  /** 原样透传的 env；默认经 scrubEnv 清洗后透传（防凭据泄漏） */
  env?: Record<string, string | undefined>;
  /** 是否清洗凭据（默认 true） */
  scrubEnv?: boolean;
}

/**
 * runCommand — 用 spawn 执行子进程（shell:false，避免 shell 注入）
 *
 * 超时语义：到达 timeoutMs 发 SIGTERM 并标记 timedOut=true；
 * 随后仍等待 `close` 事件（即子进程真正退出）才 resolve——**dispose 到静默**，
 * 不抛事后孤儿。结果按 {@link ExecOutcome} 正交上报。
 *
 * 永不 reject：任何失败（spawn 错误 / 超时 / 非零退出）都以 ExecOutcome 返回，
 * 由调用方决定如何处置（正交：错误也是一种「子进程没成功」的可控状态）。
 */
export function runCommand(opts: RunCommandOptions): Promise<ExecOutcome> {
  const {
    command,
    args = [],
    cwd,
    timeoutMs,
    env: rawEnv,
    scrubEnv: doScrub = true,
  } = opts;

  return new Promise<ExecOutcome>((resolve) => {
    // 凭据清洗在透传前完成；消费端仍应假定子进程输出可能含普通机密，勿再外泄
    const env = doScrub ? scrubEnv(rawEnv) : rawEnv;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        cwd,
        env: env ?? process.env,
        shell: false, // 禁止 shell：参数不拼进字符串，天然防注入
      });
    } catch (err) {
      resolve({
        ok: false,
        stdout: '',
        stderr: String(err),
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (outcome: ExecOutcome): void => {
      if (settled) return; // 幂等：close 与 error 只会结算一次
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(outcome);
    };

    child.stdout?.on('data', (d: Buffer | string) => { stdout += String(d); });
    child.stderr?.on('data', (d: Buffer | string) => { stderr += String(d); });

    child.on('error', (err: Error) => {
      finish({ ok: false, stdout, stderr: stderr || err.message });
    });

    child.on('close', (code, signal) => {
      // 正交：timedOut 独立于 exitCode——即使 exitCode===0，只要超时过则 ok=false
      finish({
        ok: !timedOut && code === 0,
        exitCode: code ?? undefined,
        timedOut: timedOut || undefined,
        signal: signal ?? undefined,
        stdout,
        stderr,
      });
    });

    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        // 先温和：SIGTERM 后若进程未退，close 事件会带 signal 结算；
        // 残余清理由调用方按 ExecOutcome.signal 决定（本项目不自动 SIGKILL）
        child.kill('SIGTERM');
      }, timeoutMs);
    }
  });
}

// ── 私有临时路径 ──

/**
 * makePrivateTempDir — 创建私有临时目录（0700）
 *
 * mkdtemp 生成的目录名已带随机后缀；此处显式 chmod 0700 防同机其它用户读取。
 */
export async function makePrivateTempDir(prefix = 'morpex-'): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  await chmod(dir, 0o700);
  return dir;
}

/**
 * randomPrivateFilePath — 在私有目录内生成随机文件名（防可预测路径）
 *
 * 用法：`const f = randomPrivateFilePath(dir, 'spill'); await writeExclusive(f, data);`
 */
export function randomPrivateFilePath(dir: string, name = 'tmp'): string {
  return path.join(dir, `${name}_${randomBytes(8).toString('hex')}`);
}

/**
 * writeExclusive — 独占创建 + 写入（O_EXCL: 'wx'，0600）
 *
 * 'wx' 在目标已存在时直接失败——天然防 symlink 竞态与覆盖他人文件；
 * 0600 仅属主可读写。配合随机名使用，杜绝「可预测的公共可读路径」。
 */
export async function writeExclusive(filePath: string, content: string): Promise<void> {
  const fh = await open(filePath, 'wx', 0o600);
  try {
    await fh.writeFile(content, 'utf8');
  } finally {
    await fh.close();
  }
}

/**
 * cleanupTempDir — 递归删除私有临时目录
 *
 * 仅限已知真实目录（由 makePrivateTempDir 创建的）——不为可预测路径开 rm -rf 之门。
 */
export async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}