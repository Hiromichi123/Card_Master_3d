import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BoxGeometry,
  BufferAttribute,
  ExtrudeGeometry,
  Matrix4,
  Path,
  Shape,
  type BufferGeometry,
  type InstancedMesh,
} from 'three';

import { buildMaterial } from '../table/materials';
import type { TableTheme } from '../table/themes';
import { hasWeather, WeatherLayer } from '../table/weather';
import { LAYOUT } from './layout';
import { MechaTable } from './MechaTable';
import { VolcanoTable } from './VolcanoTable';

/**
 * 战斗桌。
 *
 * 构造方式**移植自** `D:\Github\Chessboard-three.js`（MIT）的
 * `src/render/realtime/boardMesh.js`：格子垫 + 缝下的嵌线板 + 立体边框，
 * 材质全部来自主题的纯数据描述。差别只在于这里是牌桌而不是棋盘的 8×8：
 * 格子的数量按桌面尺寸算，浅/深两色仍然交替铺满。
 *
 * 三条来自视觉规范的约束（`V-TABLE-1..4`）：
 * - 桌面要有可见细节，不是纯色平面 → 木纹/大理石都是程序化生成的；
 * - 槽位边界常态低对比，只有可放置状态才提对比；
 * - 主光方向固定，避免卡面在动画中忽明忽暗。
 */

/** 棋子格边长。取 1.3 是因为它同时满足两件事：牌列进深能被整数格覆盖，格子也不至于碎。 */
const TILE_SIZE = 1.3;
const MAT_COLS = 8;
const MAT_ROWS = 8;
/** 格子之间的缝。棋盘上这条缝露出下面的嵌线，是「棋子格」最重要的辨识线索。 */
const TILE_GAP = 0.03;
const TILE_THICKNESS = 0.16;
/** 边框宽度。原项目取棋盘跨度的固定比例，这里用固定值——桌面尺寸是固定的。 */
const FRAME_WIDTH = 0.58;
/** 边框顶面略高于格子，摸上去像一块真板子。 */
const FRAME_TOP = 0.03;
const BEVEL = 0.09;

const MAT_SPAN = MAT_COLS * TILE_SIZE;

/**
 * 边框的截面：外圈圆角、中间挖空。
 *
 * 圆角半径取的是边框宽度的比例而不是常数——固定常数在窄边框上会把角吃掉。
 */
function frameShape(half: number, width: number): Shape {
  const radius = Math.max(0.06, width * 0.45);
  const outer = half + width;

  const shape = new Shape();
  shape.moveTo(-outer + radius, -outer);
  shape.lineTo(outer - radius, -outer);
  shape.quadraticCurveTo(outer, -outer, outer, -outer + radius);
  shape.lineTo(outer, outer - radius);
  shape.quadraticCurveTo(outer, outer, outer - radius, outer);
  shape.lineTo(-outer + radius, outer);
  shape.quadraticCurveTo(-outer, outer, -outer, outer - radius);
  shape.lineTo(-outer, -outer + radius);
  shape.quadraticCurveTo(-outer, -outer, -outer + radius, -outer);

  const hole = new Path();
  hole.moveTo(-half, -half);
  hole.lineTo(-half, half);
  hole.lineTo(half, half);
  hole.lineTo(half, -half);
  hole.lineTo(-half, -half);
  shape.holes.push(hole);

  return shape;
}

/**
 * 平面 UV。
 *
 * 木纹必须**跨过整块板**连续排布，若按每个格子各自的包围盒去展开，
 * 相邻格子上的纹理会各自起头，看起来像贴了一堆小方块而不是一整块木头。
 */
function applyPlanarUV(geometry: BufferGeometry, span: number): void {
  const position = geometry.getAttribute('position');
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) {
    uv[i * 2] = position.getX(i) / span + 0.5;
    uv[i * 2 + 1] = position.getZ(i) / span + 0.5;
  }
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
}

export interface TableProps {
  readonly theme: TableTheme;
  /** 程序化贴图的分辨率档。低档不出贴图（见 materials.ts）。 */
  readonly quality: 'low' | 'medium' | 'high';
  /** 天气层的主题 id。没有天气的主题传到表外即可。 */
  readonly weatherId?: string | undefined;
  /** 减少动态：天气层冻结而不是移除。 */
  readonly reduceMotion?: boolean | undefined;
}

export function Table(props: TableProps) {
  if (props.theme.geometry === 'mecha') {
    return <MechaTable theme={props.theme} quality={props.quality} reduceMotion={props.reduceMotion ?? false} />;
  }
  if (props.theme.geometry === 'volcano') {
    return <VolcanoTable theme={props.theme} quality={props.quality} reduceMotion={props.reduceMotion ?? false} />;
  }
  return <ClassicTable {...props} />;
}

function ClassicTable({
  theme,
  quality,
  weatherId,
  reduceMotion = false,
}: TableProps) {
  const half = MAT_SPAN / 2;

  const { lightMaterial, darkMaterial, frameMaterial, inlayMaterial } = useMemo(() => {
      // 边框的纹理尺度按整块板的跨度展开，木纹才是连续的
      const span = MAT_SPAN + FRAME_WIDTH * 2;
      return {
        lightMaterial: buildMaterial(theme.mat.light, { quality, textureScale: 1 }),
        darkMaterial: buildMaterial(theme.mat.dark, { quality, textureScale: 1 }),
        frameMaterial: buildMaterial(theme.mat.frame, { quality, textureScale: 1 }),
        inlayMaterial: buildMaterial(
          {
            kind: 'plain',
            color: theme.mat.inlay,
            roughness: 0.45,
            metalness: 0.25,
            emissive: theme.mat.inlay,
            emissiveIntensity: 0.12,
          },
          { quality },
        ),
        span,
      };
    }, [theme, quality]);

  useEffect(
    () => () => {
      lightMaterial.dispose();
      darkMaterial.dispose();
      frameMaterial.dispose();
      inlayMaterial.dispose();
    },
    [lightMaterial, darkMaterial, frameMaterial, inlayMaterial],
  );

  /** 格子几何：整块垫子共用一套，只有材质按深浅交替。 */
  const tileGeometry = useMemo(
    () => new BoxGeometry(TILE_SIZE - TILE_GAP, TILE_THICKNESS, TILE_SIZE - TILE_GAP),
    [],
  );

  const inlayGeometry = useMemo(
    () => new BoxGeometry(MAT_SPAN + 0.05, TILE_THICKNESS - 0.02, MAT_SPAN + 0.05),
    [],
  );

  const frameGeometry = useMemo(() => {
    const geometry = new ExtrudeGeometry(frameShape(half, FRAME_WIDTH), {
      depth: TILE_THICKNESS,
      bevelEnabled: true,
      bevelThickness: BEVEL,
      bevelSize: BEVEL,
      bevelSegments: 2,
      curveSegments: 4,
    });
    geometry.rotateX(-Math.PI / 2);
    // rotateX(-90°) 之后挤出方向朝下，平移回与格子垫同一高度
    geometry.translate(0, -TILE_THICKNESS / 2, 0);
    applyPlanarUV(geometry, MAT_SPAN + FRAME_WIDTH * 2);
    return geometry;
  }, [half]);

  useEffect(
    () => () => {
      tileGeometry.dispose();
      inlayGeometry.dispose();
      frameGeometry.dispose();
    },
    [tileGeometry, inlayGeometry, frameGeometry],
  );

  /**
   * 格子分成深浅两组，各自用一个 InstancedMesh 画。
   *
   * 8×8 = 64 个独立 mesh 就是 64 次 draw call，实测会把整场从 178 推到 244，
   * 越过 `V-PERF` 的重演出上限。分成两个实例化网格后是 **2 次**——
   * 格子是纯装饰，不值得为它牺牲掉整个特效的预算。
   */
  const tilePositions = useMemo(() => {
    const light: [number, number][] = [];
    const dark: [number, number][] = [];
    for (let row = 0; row < MAT_ROWS; row += 1) {
      for (let col = 0; col < MAT_COLS; col += 1) {
        const x = (col - (MAT_COLS - 1) / 2) * TILE_SIZE;
        const z = (row - (MAT_ROWS - 1) / 2) * TILE_SIZE;
        ((col + row) % 2 === 0 ? light : dark).push([x, z]);
      }
    }
    return { light, dark };
  }, []);

  const lightTilesRef = useRef<InstancedMesh>(null);
  const darkTilesRef = useRef<InstancedMesh>(null);

  /**
   * 写入实例矩阵。
   *
   * 依赖里**必须**带上材质：`instancedMesh` 的 `args` 含材质对象，
   * 换主题时 `buildMaterial` 会返回一个新材质，`args` 随之改变，
   * R3F 就会**重建**这个 InstancedMesh——而重建会把所有实例矩阵重置为单位矩阵。
   * 如果依赖里只有 `tilePositions`（换主题时它不变），这个 effect 不会再跑，
   * 于是棋盘中央会留下一块没有变换的杂散格子（实测就是这么发现的）。
   */
  useLayoutEffect(() => {
    const matrix = new Matrix4();
    const write = (mesh: InstancedMesh | null, positions: [number, number][]): void => {
      if (!mesh) {
        return;
      }
      positions.forEach(([x, z], index) => {
        matrix.makeTranslation(x, -TILE_THICKNESS / 2, z);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    write(lightTilesRef.current, tilePositions.light);
    write(darkTilesRef.current, tilePositions.dark);
  }, [tilePositions, lightMaterial, darkMaterial]);

  return (
    <group position={[0, 0, LAYOUT.tableCenterZ]}>
      {/*
        嵌线板：比格子垫略大一圈，从格子的缝隙里透出来。
        棋盘上用 `inlay` 画出一条细金线，是这类台面最容易辨认的细节。
      */}
      <mesh
        receiveShadow
        position={[0, -TILE_THICKNESS / 2 - 0.01, 0]}
        material={inlayMaterial}
        geometry={inlayGeometry}
      />

      <instancedMesh
        ref={lightTilesRef}
        args={[tileGeometry, lightMaterial, tilePositions.light.length]}
        receiveShadow
      />
      <instancedMesh
        ref={darkTilesRef}
        args={[tileGeometry, darkMaterial, tilePositions.dark.length]}
        receiveShadow
      />

      <mesh
        geometry={frameGeometry}
        material={frameMaterial}
        position={[0, TILE_THICKNESS / 2 + FRAME_TOP, 0]}
        receiveShadow
        castShadow
      />

      {/*
        中线：双方分界。
        棋盘没有这条线，但牌桌需要它——没有它就看不出哪几格属于哪一方。
        用嵌线色画一条极细的亮线，常态下不抢卡面的注意力。
      */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
        <planeGeometry args={[MAT_SPAN - FRAME_WIDTH, 0.016]} />
        <meshBasicMaterial color={theme.mat.inlay} transparent opacity={0.5} />
      </mesh>

      {/*
        天气层跟桌子一起平移，所以它落在桌面坐标系里而不是世界原点——
        否则桌面布局一改（桌子不再居中）就会露馅。
      */}
      {weatherId && hasWeather(weatherId) && (
        <WeatherLayer themeId={weatherId} quality={quality} reducedMotion={reduceMotion} />
      )}
    </group>
  );
}
