/**
 * 前端环境配置：读取 Vite 注入的 VITE_API_BASE。
 * 未配置时默认后端本地地址 http://localhost:5473。
 */
const configured: string | undefined = import.meta.env.VITE_API_BASE;

export const API_BASE: string = configured?.trim().replace(/\/+$/, '') || 'http://localhost:5473';
