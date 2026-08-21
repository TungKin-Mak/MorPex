/**
 * HTTP 传输封装：统一拼 API_BASE、JSON 头、错误提取。
 * 仅被 src/api/client.ts 使用；视图层不直接触碰 URL。
 */
import { API_BASE } from '../env.js';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function joinPath(path: string): string {
  return `${API_BASE}${path}`;
}

async function parseErrorBody(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    if (typeof body?.error === 'string' && body.error) return body.error;
    if (typeof body?.message === 'string' && body.message) return body.message;
    return fallback;
  } catch {
    return fallback;
  }
}

/** GET 请求：非 2xx 抛 ApiError（优先携带服务端 error 字段信息）。 */
export async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(joinPath(path), { headers: { Accept: 'application/json' } });
  } catch (err) {
    throw new Error(`无法连接后端（${joinPath(path)}）：${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    const msg = await parseErrorBody(res, `HTTP ${res.status}`);
    throw new ApiError(res.status, msg);
  }
  try {
    return (await res.json()) as T;
  } catch {
    // 代理/网关返回 HTML 错误页时 JSON.parse 会抛 SyntaxError，归一化为友好错误
    throw new ApiError(res.status, '响应不是合法 JSON');
  }
}

/** POST 请求：非 2xx 抛 ApiError（优先携带服务端 error 字段信息）。 */
export async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(joinPath(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`无法连接后端（${joinPath(path)}）：${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    const msg = await parseErrorBody(res, `HTTP ${res.status}`);
    throw new ApiError(res.status, msg);
  }
  try {
    return (await res.json()) as T;
  } catch {
    // 代理/网关返回 HTML 错误页时 JSON.parse 会抛 SyntaxError，归一化为友好错误
    throw new ApiError(res.status, '响应不是合法 JSON');
  }
}

/** DELETE 请求：非 2xx 抛 ApiError（与 get/post 同风格；会话 17h 删除会话用）。 */
export async function del<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(joinPath(path), {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    throw new Error(`无法连接后端（${joinPath(path)}）：${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    const msg = await parseErrorBody(res, `HTTP ${res.status}`);
    throw new ApiError(res.status, msg);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(res.status, '响应不是合法 JSON');
  }
}
