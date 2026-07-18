/* ═════════════════════════════════════════════════════════════════
   BrainScene — 3D 大脑场景（R3F 版）
   接入 Zustand store，实时响应后端脑区事件
   ═════════════════════════════════════════════════════════════════ */

import React, { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { PART_CONFIG, ensurePartConfig, type PartName } from './brainConfig';
import { useAstroStore } from './stores';

/** 选中分区流光颜色 */
const GOLD = new THREE.Color(0.91, 0.76, 0.32);
const ALERT_RED = new THREE.Color(1.0, 0.15, 0.2);

/** 脑区名称映射（store → partNames 索引） */
const REGION_MAP: Record<string, number> = {
  FRONTAL: 0,
  PARIETAL: 1,
  TEMPORAL: 2,
  OCCIPITAL: 3,
  CEREBELLUM: 4,
};

/** 活动阶段 → 流光速度倍率 */
const PHASE_FLOW_SPEED: Record<string, number> = {
  idle: 0.3,
  planning: 0.6,
  reasoning: 1.0,
  executing: 1.5,
};

/* ==================== 着色器定义 ==================== */

const flowEdgeVert = `
varying vec3 vPos;
void main(){
  vPos=position;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`;

const flowEdgeFrag = `
uniform vec3 uColor;uniform float uOpacity;uniform float uTime;
uniform float uFlowSpeed;uniform float uPhase;uniform vec3 uDir;uniform float uFlowMix;
varying vec3 vPos;
void main(){
  float staticG=0.85;
  float path=vPos.x*uDir.x+vPos.z*uDir.y+vPos.y*uDir.z;
  float t=fract(path*0.8+uTime*uFlowSpeed*0.5+uPhase);
  float pulse=exp(-pow(abs(t-0.5)/0.5,2.0)*30.0);
  float trail=exp(-pow(abs(t-0.30)*4.0,2.0))*0.65;
  float flow=min(max(pulse*1.2,trail),1.0);
  float glow=mix(staticG,0.10+0.90*flow,uFlowMix);
  vec3 col=mix(uColor*1.5,mix(uColor*0.2,uColor*1.8,flow),uFlowMix);
  float alpha=clamp(glow*uOpacity,0.0,1.0);
  gl_FragColor=vec4(col,alpha);
}`;

/* ==================== PartLayer 类型 ==================== */

interface PartLayer {
  leftGrp: THREE.Group;
  rightGrp: THREE.Group;
  maskL: THREE.Mesh;
  maskR: THREE.Mesh;
  shellEdgeMat: THREE.ShaderMaterial;
  fillMat: THREE.MeshStandardMaterial;
  fillMatR: THREE.MeshStandardMaterial;
  centroid: [number, number, number];
  convexGeo: THREE.BufferGeometry;
}

/* ==================== 大脑模型加载 ==================== */

function useBrainParts(): { partLayers: Record<string, PartLayer>; partNames: string[] } | null {
  const { scene } = useGLTF('/brain_5part.glb');

  return useMemo(() => {
    if (!scene) return null;

    const meshes: THREE.Mesh[] = [];
    scene.traverse((c: any) => { if (c.isMesh) meshes.push(c); });

    const PL: Record<string, PartLayer> = {};
    const flowDirs = [
      new THREE.Vector3(1.5, 1.2, 1.0), new THREE.Vector3(1.5, -1.2, 1.0),
      new THREE.Vector3(1.5, 1.2, -1.0), new THREE.Vector3(-1.5, 1.2, 1.0),
      new THREE.Vector3(-1.5, -1.2, 1.0),
    ];

    for (const ch of meshes) {
      const cfg = ensurePartConfig(ch.name);
      const geo = ch.geometry.clone();
      const p = geo.getAttribute('position');
      const vc = p.count;

      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < vc; i++) { cx += p.getX(i); cy += p.getY(i); cz += p.getZ(i); }
      cx /= vc; cy /= vc; cz /= vc;
      geo.computeVertexNormals();
      geo.computeBoundingBox();
      geo.computeBoundingSphere();

      // 凸包 Hitbox
      const hullPoints: THREE.Vector3[] = [];
      const hullPos = ch.geometry.attributes.position;
      for (let i = 0; i < hullPos.count; i += 2) {
        hullPoints.push(new THREE.Vector3().fromBufferAttribute(hullPos, i));
      }
      const convexGeo = new ConvexGeometry(hullPoints);
      convexGeo.computeVertexNormals();

      const depthMaskMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, side: THREE.DoubleSide });

      const shellMat = new THREE.MeshStandardMaterial({
        color: cfg.color.clone().multiplyScalar(0.35),
        emissive: cfg.color, emissiveIntensity: 0.5,
        metalness: 0.3, roughness: 0.6,
        transparent: true, opacity: 0.55, side: THREE.DoubleSide,
        depthTest: true, depthWrite: false,
      });

      const idx = Object.keys(PL).length;
      const dir = flowDirs[idx % flowDirs.length];

      const shellEdgeMat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: cfg.color.clone().multiplyScalar(1.0) },
          uOpacity: { value: 0.4 }, uTime: { value: 0 },
          uFlowSpeed: { value: 1.2 }, uPhase: { value: 0 },
          uDir: { value: dir.clone() }, uFlowMix: { value: 0 },
        },
        vertexShader: flowEdgeVert, fragmentShader: flowEdgeFrag,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
      });

      const eg = new THREE.EdgesGeometry(geo, 12);

      // 左侧
      const leftGrp = new THREE.Group();
      leftGrp.name = `L_${ch.name}`;
      const maskL = new THREE.Mesh(geo, depthMaskMat); maskL.renderOrder = -1; leftGrp.add(maskL);
      const fillL = new THREE.Mesh(geo, shellMat); fillL.renderOrder = 0; leftGrp.add(fillL);
      const seL = new THREE.LineSegments(eg, shellEdgeMat); seL.renderOrder = 1; leftGrp.add(seL);

      // 右侧（镜像）
      const rightGrp = new THREE.Group();
      rightGrp.name = `R_${ch.name}`;
      rightGrp.scale.x = -1;
      const shellMatR = shellMat.clone();
      const maskR = new THREE.Mesh(geo, depthMaskMat); maskR.renderOrder = -1; rightGrp.add(maskR);
      const fillR = new THREE.Mesh(geo, shellMatR); fillR.renderOrder = 0; rightGrp.add(fillR);
      const seR = new THREE.LineSegments(eg.clone(), shellEdgeMat); seR.renderOrder = 1; rightGrp.add(seR);

      PL[ch.name] = { leftGrp, rightGrp, maskL, maskR, shellEdgeMat, fillMat: shellMat, fillMatR: shellMatR, centroid: [cx, cy, cz], convexGeo };
    }

    return { partLayers: PL, partNames: Object.keys(PL) };
  }, [scene]);
}

/* ==================== Props ==================== */

interface BrainSceneProps {
  onPartClick?: (name: PartName) => void;
  onPartHover?: (name: PartName | null) => void;
  shellOpacity?: number;
  edgeOpacity?: number;
  flowMixMax?: number;
}

/* ==================== 主组件 ==================== */

const BrainScene: React.FC<BrainSceneProps> = ({
  onPartClick,
  onPartHover,
  shellOpacity = 0.55,
  edgeOpacity = 0.68,
  flowMixMax = 1.0,
}) => {
  const { camera } = useThree();
  const brainParts = useBrainParts();

  // ── Store 状态 ──
  const storeActiveRegion = useAstroStore((s) => s.activeBrainRegion);
  const storeBrainAlert = useAstroStore((s) => s.brainAlert);
  const storeAlertRegion = useAstroStore((s) => s.alertRegion);
  const storeActivityPhase = useAstroStore((s) => s.brainActivityPhase);
  const storeBrainExploded = useAstroStore((s) => s.brainExploded);

  // ── 内部状态 ──
  const controlsRef = useRef<any>(null);
  const hoveredRef = useRef<string | null>(null);
  const partLayersRef = useRef<Record<string, PartLayer> | null>(null);
  const clickStartRef = useRef<[number, number]>([0, 0]);
  const isDraggingRef = useRef(false);
  const tmRefs = useRef<Record<string, number>>({});

  const [selectedPart, setSelectedPart] = useState<PartName | null>(null);
  const [exploded, setExploded] = useState(false);

  partLayersRef.current = brainParts?.partLayers ?? null;

  // ── Store → 本地状态同步 ──
  useEffect(() => {
    if (!brainParts) return;
    if (storeActiveRegion) {
      const idx = REGION_MAP[storeActiveRegion];
      if (idx !== undefined && idx < brainParts.partNames.length) {
        setSelectedPart(brainParts.partNames[idx] as PartName);
        setExploded(true);
        return;
      }
    }
    if (storeBrainExploded) {
      setExploded(true);
    }
  }, [storeActiveRegion, storeBrainExploded, brainParts]);

  // 当 store 清除 region 时，收拢
  useEffect(() => {
    if (!storeActiveRegion && !storeBrainExploded && selectedPart) {
      // 仅当 store 没有主动设置 region 时才收拢
    }
  }, [storeActiveRegion, storeBrainExploded]);

  // ── 初始化相机 ──
  useEffect(() => {
    if (camera) {
      (camera as THREE.PerspectiveCamera).fov = 38;
      camera.position.set(2.2, 0.5, 0);
      camera.up.set(0, 0, 1);
      camera.lookAt(0, 0, 0);
    }
  }, [camera]);

  // ── useFrame ──
  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const dt = Math.min(delta, 0.05);
    const partLayers = partLayersRef.current;
    if (!partLayers || !brainParts) return;

    const partNames = brainParts.partNames;
    const selKey = selectedPart as string | null;

    // 活动阶段 → 流光线速度
    const baseFlowSpeed = PHASE_FLOW_SPEED[storeActivityPhase] ?? 0.8;

    for (const n of partNames) {
      const ly = partLayers[n];
      const [cx, cy, cz] = ly.centroid;
      const isSel = selKey === n;
      const partIdx = partNames.indexOf(n);

      // 爆炸位移
      let targetTm = 0;
      if (exploded) {
        if (selKey) {
          targetTm = isSel ? 1.68 : (3.5 * 0.3);
        } else {
          targetTm = 3.5;
        }
      }

      const currentTm = tmRefs.current[n] || 0;
      tmRefs.current[n] = currentTm + (targetTm - currentTm) * Math.min(dt * 15, 0.4);
      const tm = tmRefs.current[n];

      ly.leftGrp.position.set(cx * tm, cy * tm, cz * tm);
      ly.rightGrp.position.set(-cx * tm, cy * tm, cz * tm);

      if (ly.maskL) ly.maskL.visible = !(exploded && isSel);
      if (ly.maskR) ly.maskR.visible = !(exploded && isSel);

      // Shader uniforms
      const phase = partIdx * 1.57;
      ly.shellEdgeMat.uniforms.uTime.value = t;
      ly.shellEdgeMat.uniforms.uPhase.value = phase;
      ly.shellEdgeMat.uniforms.uFlowSpeed.value = baseFlowSpeed;

      const isHover = !isSel && hoveredRef.current === n;
      const cfg = PART_CONFIG[n as PartName] ?? ensurePartConfig(n);

      // 流光混合
      const flowTarget = isSel ? flowMixMax : (isHover ? flowMixMax * 0.6 : 0);
      const smooth = (v: number, target: number, speed = 4) => v + (target - v) * Math.min(dt * speed, 0.15);
      ly.shellEdgeMat.uniforms.uFlowMix.value = smooth(ly.shellEdgeMat.uniforms.uFlowMix.value, flowTarget);

      // ── 告警闪烁 ──
      const isAlert = storeBrainAlert && storeAlertRegion &&
        REGION_MAP[storeAlertRegion] === partIdx;
      const alertPulse = isAlert ? (Math.sin(t * 8) * 0.5 + 0.5) : 0;

      if (isSel) {
        ly.shellEdgeMat.uniforms.uColor.value.copy(GOLD);
        ly.shellEdgeMat.uniforms.uOpacity.value = smooth(ly.shellEdgeMat.uniforms.uOpacity.value, 0.7);
        ly.fillMat.emissive.copy(cfg.color);
        ly.fillMat.emissiveIntensity = smooth(ly.fillMat.emissiveIntensity, 0.9);
        ly.fillMat.opacity = smooth(ly.fillMat.opacity, 0.15);
        ly.fillMatR.emissive.copy(cfg.color);
        ly.fillMatR.emissiveIntensity = smooth(ly.fillMatR.emissiveIntensity, 0.9);
        ly.fillMatR.opacity = smooth(ly.fillMatR.opacity, 0.15);
      } else if (isAlert) {
        // 告警闪烁红
        const alertColor = new THREE.Color().copy(ALERT_RED).lerp(GOLD, alertPulse);
        ly.shellEdgeMat.uniforms.uColor.value.copy(alertColor);
        ly.shellEdgeMat.uniforms.uOpacity.value = 0.6 + alertPulse * 0.3;
        ly.fillMat.emissive.copy(ALERT_RED).multiplyScalar(0.5 + alertPulse * 0.5);
        ly.fillMat.emissiveIntensity = smooth(ly.fillMat.emissiveIntensity, 0.8);
        ly.fillMat.opacity = smooth(ly.fillMat.opacity, 0.4);
        ly.fillMatR.emissive.copy(ALERT_RED).multiplyScalar(0.5 + alertPulse * 0.5);
        ly.fillMatR.emissiveIntensity = smooth(ly.fillMatR.emissiveIntensity, 0.8);
        ly.fillMatR.opacity = smooth(ly.fillMatR.opacity, 0.4);
      } else if (isHover) {
        ly.shellEdgeMat.uniforms.uColor.value.copy(cfg.color).multiplyScalar(1.8);
        ly.shellEdgeMat.uniforms.uOpacity.value = smooth(ly.shellEdgeMat.uniforms.uOpacity.value, 0.5);
        ly.fillMat.emissive.copy(cfg.color).multiplyScalar(0.4);
        ly.fillMat.emissiveIntensity = smooth(ly.fillMat.emissiveIntensity, 0.5);
        ly.fillMat.opacity = smooth(ly.fillMat.opacity, 0.4);
        ly.fillMatR.emissive.copy(cfg.color).multiplyScalar(0.4);
        ly.fillMatR.emissiveIntensity = smooth(ly.fillMatR.emissiveIntensity, 0.5);
        ly.fillMatR.opacity = smooth(ly.fillMatR.opacity, 0.4);
      } else {
        ly.shellEdgeMat.uniforms.uColor.value.copy(cfg.color).multiplyScalar(1.0);
        ly.shellEdgeMat.uniforms.uOpacity.value = smooth(ly.shellEdgeMat.uniforms.uOpacity.value, 0.4);
        ly.fillMat.emissive.copy(cfg.color).multiplyScalar(0.3);
        ly.fillMat.emissiveIntensity = smooth(ly.fillMat.emissiveIntensity, 0.35);
        ly.fillMat.opacity = smooth(ly.fillMat.opacity, shellOpacity);
        ly.fillMatR.emissive.copy(cfg.color).multiplyScalar(0.3);
        ly.fillMatR.emissiveIntensity = smooth(ly.fillMatR.emissiveIntensity, 0.35);
        ly.fillMatR.opacity = smooth(ly.fillMatR.opacity, shellOpacity);
      }
    }

    if (controlsRef.current) {
      controlsRef.current.autoRotate = !selectedPart;
    }
  });

  if (!brainParts) return null;

  return (
    <>
      <ambientLight intensity={0.12} color="#446688" />
      <directionalLight position={[3, 5, 4]} intensity={0.7} color="#ccddff" />
      <directionalLight position={[-4, -2, -3]} intensity={0.3} color="#ff8844" />
      <directionalLight position={[-1, 3, -5]} intensity={0.2} color="#4488ff" />

      {/* 背景球体：点击取消选中 */}
      <mesh
        onClick={() => { setSelectedPart(null); setExploded(false); }}
        scale={[6, 6, 6]}
      >
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial visible={false} side={THREE.BackSide} />
      </mesh>

      <group>
        {brainParts.partNames.map((name) => {
          const layer = brainParts.partLayers[name];

          const handleOver = (e: any) => {
            e.stopPropagation();
            if (hoveredRef.current !== name) {
              hoveredRef.current = name;
              document.body.style.cursor = 'pointer';
              onPartHover?.(name as PartName);
            }
          };

          const handleOut = (e: any) => {
            e.stopPropagation();
            if (hoveredRef.current === name) {
              hoveredRef.current = null;
              document.body.style.cursor = 'auto';
              onPartHover?.(null);
            }
          };

          const handleClick = (e: any) => {
            e.stopPropagation();
            if (isDraggingRef.current) return;
            if (selectedPart === name) {
              setSelectedPart(null);
              setExploded(false);
            } else {
              setSelectedPart(name as PartName);
              setExploded(true);
            }
            onPartClick?.(name as PartName);
          };

          const handlePointerDown = (e: any) => {
            e.stopPropagation();
            clickStartRef.current = [e.clientX, e.clientY];
            isDraggingRef.current = false;
          };

          const handlePointerUpCheck = (e: any) => {
            const dx = e.clientX - clickStartRef.current[0];
            const dy = e.clientY - clickStartRef.current[1];
            if (Math.hypot(dx, dy) > 6) isDraggingRef.current = true;
          };

          return (
            <group key={name}>
              <primitive object={layer.leftGrp}>
                <mesh
                  geometry={layer.convexGeo}
                  onPointerOver={handleOver}
                  onPointerOut={handleOut}
                  onPointerDown={handlePointerDown}
                  onPointerUp={handlePointerUpCheck}
                  onClick={handleClick}
                >
                  <meshBasicMaterial visible={false} />
                </mesh>
              </primitive>
              <primitive object={layer.rightGrp}>
                <mesh
                  geometry={layer.convexGeo}
                  onPointerOver={handleOver}
                  onPointerOut={handleOut}
                  onPointerDown={handlePointerDown}
                  onPointerUp={handlePointerUpCheck}
                  onClick={handleClick}
                >
                  <meshBasicMaterial visible={false} />
                </mesh>
              </primitive>
            </group>
          );
        })}
      </group>

      <OrbitControls
        ref={controlsRef}
        target={[0, 0, 0]}
        enableDamping
        dampingFactor={0.08}
        minDistance={0.8}
        maxDistance={4.0}
        autoRotate={!selectedPart}
        autoRotateSpeed={1.8}
        rotateSpeed={1.2}
        enablePan={false}
      />
    </>
  );
};

export default BrainScene;
