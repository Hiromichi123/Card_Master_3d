import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  Matrix4,
  MeshStandardMaterial,
  type BufferGeometry,
  type InstancedMesh,
  type Material,
  type Texture,
} from 'three';

import { CARD_BACK_URL } from '../../data/assets';
import { useManagedTexture } from '../../services/useManagedTexture';
import { CardMesh } from '../cards/CardMesh';
import {
  CARD_DIMENSIONS,
  getCardBodyGeometry,
  getCardFaceGeometry,
} from '../cards/cardGeometry';
import type { PileView } from './placements';
import { PILE_CARD_SCALE, pilePosition } from './layout';
import { MechaPileCounter } from './MechaPileCounter';

/**
 * 牌堆与弃牌堆。
 *
 * P3 只把数量放进 HUD，桌上什么都没有——牌打到哪去了在画面里看不出来。
 * 这里把两个区做成**有真实厚度**的实体：每张牌按卡牌自身的厚度（0.024）
 * 叠一层，摞起来多高就等于还剩几张。弃牌堆最上面那张是明牌。
 *
 * 厚度用 `InstancedMesh` 画：一摞最多二十来张，逐张建 mesh 会让 draw call
 * 从 182 涨到两百多（棋盘那边为同一件事吃过这个亏，见 `V-TABLE-8`）。
 */

/** 一摞最多画多少张。超过这个数就不再增高，免得弃牌堆堆成一根柱子。 */
const MAX_PLATES = 20;

/** 一张牌的厚度，与真实卡牌一致。 */
const PLATE_THICKNESS = CARD_DIMENSIONS.thickness;

/**
 * 底衬：一块与牌等大的浅色垫片。
 *
 * **只在空的时候画。** 它原本一直画着，结果牌堆底下露出一块又亮又白的方块
 * （基本材质不吃光照、叠在浅色格子垫上再被泛光一推，看着像一块塑料板）。
 * 有牌的时候这一摞自己就说明了问题，不需要底衬。
 */
function PileBase({ color }: { color: string }) {
  const geometry = useMemo(() => getCardFaceGeometry(), []);
  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
      <meshBasicMaterial color={color} transparent opacity={0.28} depthWrite={false} />
    </mesh>
  );
}

/**
 * 一摞牌。每张沿 Y 叠一个卡牌厚度。
 *
 * **要两种材质。** `ExtrudeGeometry` 把「正反面」和「侧面」分成两个材质组
 * （materialIndex 0 / 1），侧面的 UV 是按挤出参数生成的，直接套卡背贴图会
 * 全部采到纹理左上角那一点——卡背图的左上角是白的，于是整摞渲染成一块白砖头
 * （P3 实机截图里那两块白方块就是这么来的）。侧面改用不透明色的纸边材质，
 * 一摞牌从侧面看本来就该是一叠纸边。
 *
 * 每张再给一点随机偏转，否则严丝合缝地叠着看起来像一块实心方块。
 */
function Stack({ count, texture }: { count: number; texture: Texture }) {
  const meshRef = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => getCardBodyGeometry(), []);
  const plates = Math.min(count, MAX_PLATES);

  const capMaterial = useMemo(
    () => new MeshStandardMaterial({ map: texture, roughness: 0.62, metalness: 0.05 }),
    [texture],
  );
  const edgeMaterial = useMemo(
    () => new MeshStandardMaterial({ color: '#cfc8ba', roughness: 0.85, metalness: 0 }),
    [],
  );
  useEffect(
    () => () => {
      capMaterial.dispose();
      edgeMaterial.dispose();
    },
    [capMaterial, edgeMaterial],
  );

  /**
   * `args` 必须**缓存住**。
   *
   * 写成行内数组字面量的话，每次渲染都是一个新的数组，
   * R3F 会认为 `args` 变了、把整个 `InstancedMesh` 拆掉重建——
   * 而重建会把所有实例矩阵重置为单位矩阵。表现是**一张立在原地的卡牌
   * 插在棋盘里**（矩阵没写进去），而不是一摞躺着的牌。
   *
   * 棋盘那边为同一个坑吃过一次亏，`Table.tsx` 的注释里写了规则：
   * `args` 含运行时可变对象时，写入实例属性的 effect 必须把它们放进依赖。
   * 这里更进一步——`args` 本身的引用也要稳定。
   */
  const args = useMemo<[BufferGeometry, Material[], number]>(
    () => [geometry, [capMaterial, edgeMaterial], MAX_PLATES],
    [geometry, capMaterial, edgeMaterial],
  );

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }
    const matrix = new Matrix4();
    const turnMatrix = new Matrix4();
    for (let i = 0; i < plates; i += 1) {
      // 用下标当伪随机种子：同一个厚度每次渲染出来的样子是稳定的
      const jitter = Math.sin(i * 12.9898) * 0.012;
      const turn = Math.sin(i * 78.233) * 0.02;
      // 先绕 Y 在卡面内微转，再躺平——顺序反了那个小角度会变成俯仰
      matrix.makeRotationX(-Math.PI / 2);
      matrix.multiply(turnMatrix.makeRotationY(turn));
      matrix.setPosition(jitter, PLATE_THICKNESS / 2 + i * PLATE_THICKNESS, jitter * 0.6);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.count = plates;
    mesh.instanceMatrix.needsUpdate = true;
  }, [plates, args]);

  if (plates === 0) {
    return null;
  }

  return (
    <instancedMesh ref={meshRef} args={args} castShadow receiveShadow />
  );
}

/**
 * 牌堆 / 弃牌堆。
 *
 * **卡背贴图没就绪之前什么都不画。** 先挂一个没有 `map` 的材质、等贴图到了再赋值，
 * three 不会自动重编译着色器，结果是这一摞永远渲染成纯白（P3 实机截图里那两块
 * 白方块就是这么来的）。
 */
export function Pile({ pile, mecha = false }: { pile: PileView; mecha?: boolean }) {
  const position = pilePosition(pile.side, pile.kind);
  const backTexture = useManagedTexture(CARD_BACK_URL);
  const isDeck = pile.kind === 'deck';
  const filled = pile.count > 0;

  const topOffset = Math.min(pile.count, MAX_PLATES) * PLATE_THICKNESS;

  return (
    <group position={[position[0], position[1], position[2]]}>
      {mecha && <MechaPileCounter pile={pile} />}
      {/* 整堆按同一个比例缩放：底衬、叠层与明牌要一起变小，各自写一份迟早对不齐 */}
      <group scale={PILE_CARD_SCALE}>
        {!filled && <PileBase color={isDeck ? '#7fb2ff' : '#c9a86a'} />}

        {filled && backTexture && (
          <Stack count={pile.count} texture={backTexture} />
        )}

        {/* 弃牌堆的最上面一张是明牌，摆在摞顶之上 */}
        {!isDeck && pile.topCard && (
          <CardMesh
            card={pile.topCard}
            position={[0, topOffset + 0.004, 0]}
            rotationX={-Math.PI / 2}
            interactive={false}
          />
        )}
      </group>
    </group>
  );
}
