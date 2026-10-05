import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Vector3 } from 'three';

import { effectDirector, type EffectRequest } from './effectDirector';
import { ParticlePool } from './ParticlePool';
import { PARTICLE_FRAGMENT_SHADER, PARTICLE_VERTEX_SHADER } from './particleShader';
import { particleStats } from './particleStats';
import { DEFAULT_EFFECT_COLOR, EFFECT_RECIPES } from './templates';

/**
 * 粒子与特效系统的场景侧。
 *
 * 整场只有一个 `Points` 对象与一个粒子池（`V-FX-6`）：
 * 所有特效共用同一批缓冲区，不为每个特效、每颗粒子建对象或组件。
 * 特效之间的差异只体现在「往池子里发射什么」以及时间轴怎么排。
 *
 * 属性缓冲直接指向粒子池的 `Float32Array`，不复制：
 * 每帧只标记 `needsUpdate`，数据从池子到 GPU 走一趟。
 */

export interface EffectSystemProps {
  /** 粒子容量。按画质档传入（低 250 / 中 1000 / 高 3000）。 */
  readonly capacity?: number | undefined;
  /** 着色器里的尺寸缩放，跟随像素比。 */
  readonly pixelScale?: number | undefined;
  /**
   * 暂停：冻结粒子与时间轴。
   *
   * 刻意不通过停掉整个渲染循环实现——实验台里「暂停特效看某一帧」时，
   * 相机与悬停仍要能操作。所以冻结发生在消费 delta 的这一层。
   */
  readonly paused?: boolean | undefined;
}

/** 一个正在播放的特效实例。 */
interface ActiveEffect {
  readonly id: string;
  readonly update: (delta: number) => void;
  readonly isFinished: () => boolean;
  readonly skipToEnd: () => void;
}

export function EffectSystem({
  capacity = 1000,
  pixelScale,
  paused = false,
}: EffectSystemProps) {
  const pool = useMemo(() => new ParticlePool(capacity), [capacity]);
  const activeRef = useRef<ActiveEffect[]>([]);
  const gl = useThree((state) => state.gl);

  /** 直接复用池子的数组作为顶点属性，避免每帧拷贝 */
  const geometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pool.positions, 3));
    geo.setAttribute('aColor', new BufferAttribute(pool.colors, 3));
    geo.setAttribute('aSize', new BufferAttribute(pool.sizes, 1));
    geo.setAttribute('aAlpha', new BufferAttribute(pool.alphas, 1));
    // 粒子分布在整个战桌范围，关闭自动包围球计算避免每帧重算
    geo.boundingSphere = null;
    return geo;
  }, [pool]);

  // 换池子（改画质档）时释放旧的几何
  useEffect(() => () => geometry.dispose(), [geometry]);

  const uniforms = useMemo(
    () => ({ uPixelScale: { value: 260 } }),
    [],
  );

  useEffect(() => {
    // 粒子按像素缩放，否则高 DPI 屏上会小一半
    const dpr = gl.getPixelRatio();
    uniforms.uPixelScale.value = (pixelScale ?? 260) * dpr;
  }, [gl, pixelScale, uniforms]);

  useEffect(() => {
    const scratchFrom = new Vector3();
    const scratchTo = new Vector3();
    const extraTargets: Vector3[] = [];

    const unsubscribe = effectDirector.subscribe((request: EffectRequest) => {
      const recipe = EFFECT_RECIPES[request.template];
      if (!recipe) {
        console.warn(`[EffectSystem] 未知特效模板：${request.template}`);
        return;
      }

      scratchFrom.set(request.from[0], request.from[1], request.from[2]);
      scratchTo.set(request.to[0], request.to[1], request.to[2]);

      extraTargets.length = 0;
      for (const point of request.extraTargets ?? []) {
        extraTargets.push(new Vector3(point[0], point[1], point[2]));
      }

      const color = request.color
        ? new Color(request.color)
        : (DEFAULT_EFFECT_COLOR.clone() as Color);

      const timeline = recipe.build({
        pool,
        from: scratchFrom.clone(),
        to: scratchTo.clone(),
        extraTargets: extraTargets.map((v) => v.clone()),
        color,
        intensity: request.intensity ?? 1,
        countScale: request.countScale ?? 1,
        durationScale: request.durationScale ?? 1,
        onHit: request.onHit,
      });

      const effect: ActiveEffect = {
        id: request.id,
        update: (delta) => timeline.update(delta),
        isFinished: () => timeline.isFinished,
        skipToEnd: () => timeline.skipToEnd(),
      };
      activeRef.current.push(effect);
    });

    return () => {
      unsubscribe();
      activeRef.current = [];
      pool.clear();
    };
  }, [pool]);

  useFrame((_, delta) => {
    if (paused) {
      // 冻结：不推进粒子、不推进时间轴，也不重设属性标记。
      // 相机与卡牌悬停不受影响——它们走的是各自的 useFrame，与这里无关。
      return;
    }

    // delta 上限保护：切标签页回来时 delta 会很大，不夹住会让粒子瞬移
    const step = Math.min(delta, 0.05);

    // 帧率归一化：模板里的「每帧发射 n 颗」乘上这个系数后，
    // 单位时间的粒子密度不随帧率变化，低帧率机器上特效不会变稀。
    pool.frameScale = step * 60;

    pool.update(step);
    particleStats.alive = pool.alive;
    particleStats.capacity = capacity;
    if (pool.alive > particleStats.peak) {
      particleStats.peak = pool.alive;
    }

    const active = activeRef.current;
    if (active.length > 0) {
      for (const effect of active) {
        effect.update(step);
      }
      activeRef.current = active.filter((effect) => !effect.isFinished());
    }

    // 只标记变化的属性；position 一直是变化的
    geometry.getAttribute('position').needsUpdate = true;
    geometry.getAttribute('aColor').needsUpdate = true;
    geometry.getAttribute('aSize').needsUpdate = true;
    geometry.getAttribute('aAlpha').needsUpdate = true;
  });

  /**
   * 登记「立即结束全部特效」的能力。
   *
   * 跳过模式不能只是不再渲染：时间轴的 `skipToEnd` 会补发每个步骤的
   * 完成回调，保证跳过与正常播放得到相同结果（施工清单的硬性要求）。
   * 活跃特效存在本组件的 ref 里，模块级函数够不到，所以由组件把能力注册给调度中枢。
   */
  useEffect(() => {
    return effectDirector.registerSkipper(() => {
      for (const effect of activeRef.current) {
        effect.skipToEnd();
      }
      activeRef.current = [];
    });
  }, []);

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        vertexShader={PARTICLE_VERTEX_SHADER}
        fragmentShader={PARTICLE_FRAGMENT_SHADER}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}
