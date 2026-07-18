/* ═════════════════════════════════════════════════════════════════
   brainConfig.ts — 脑区色彩与配置
   ═════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';

export type PartName = string;

interface PartConfig {
  color: THREE.Color;
}

const COLORS = [
  new THREE.Color('#ff4455'), // 红
  new THREE.Color('#aa44ff'), // 紫
  new THREE.Color('#ffbb33'), // 金
  new THREE.Color('#3388ff'), // 蓝
  new THREE.Color('#ff55aa'), // 粉
];

/** 脑区色彩配置 — 按 GLB 中 mesh name 映射 */
export const PART_CONFIG: Record<string, PartConfig> = {};

/**
 * 动态获取配置（GLB 加载后调用）。
 * 根据 mesh name 轮询分配颜色。
 */
let colorIdx = 0;
export function ensurePartConfig(name: string): PartConfig {
  if (!PART_CONFIG[name]) {
    PART_CONFIG[name] = { color: COLORS[colorIdx % COLORS.length].clone() };
    colorIdx++;
  }
  return PART_CONFIG[name];
}
