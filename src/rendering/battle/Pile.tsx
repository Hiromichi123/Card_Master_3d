import { useMemo } from 'react';
import type { Texture } from 'three';

import { CARD_BACK_URL } from '../../data/assets';
import { useManagedTexture } from '../../services/useManagedTexture';
import { CardMesh } from '../cards/CardMesh';
import { getCardFaceGeometry } from '../cards/cardGeometry';
import type { PileView } from './placements';
import { PILE_CARD_SCALE, pilePosition } from './layout';

/**
 * 牌堆与弃牌堆。
 *
 * P3 只把数量放进 HUD，桌上什么都没有——牌打到哪去了在画面里看不出来。
 * 这里把两个区做出来：牌堆盖着（只有背面），弃牌堆露出**最上面那张明牌**，
 * 底下垫一张错开的背面当作厚度。
 *
 * 空的时候也画一圈底衬，否则开局时这个区域完全不可见，
 * 玩家不知道那里将来会有东西。
 */

/** 底衬：一块与牌等大的浅色垫片，让这个区域在空的时候也看得见。 */
function PileBase({ color }: { color: string }) {
  const geometry = useMemo(() => getCardFaceGeometry(), []);
  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
      {/*
        底衬要看得见，否则开局时弃牌区是空的、牌堆也还没画，
        整块区域在画面上不存在。用基本材质（不吃光照）+ 三成不透明度，
        在深浅两种格子垫上都能辨认，又不至于像一张真的牌。
      */}
      <meshBasicMaterial color={color} transparent opacity={0.55} depthWrite={false} />
    </mesh>
  );
}

/**
 * 一张背面朝上的牌，用来堆出厚度。
 *
 * **只在卡背贴图就绪之后才挂上去。** 先挂一个没有 `map` 的材质、
 * 等贴图到了再赋值，three 不会自动重编译着色器，结果是这块牌子永远渲染成纯白
 * （P3 实机截图里那两块白方块就是这么来的）。等贴图到了再建材质，一次到位。
 */
function BackPlate({
  y,
  offsetX,
  offsetZ,
  rotation,
  texture,
}: {
  y: number;
  offsetX: number;
  offsetZ: number;
  rotation: number;
  texture: Texture;
}) {
  const geometry = useMemo(() => getCardFaceGeometry(), []);
  return (
    <mesh
      geometry={geometry}
      rotation={[-Math.PI / 2, 0, rotation]}
      position={[offsetX, y, offsetZ]}
    >
      <meshStandardMaterial map={texture} roughness={0.6} metalness={0.05} />
    </mesh>
  );
}

export function Pile({ pile }: { pile: PileView }) {
  const position = pilePosition(pile.side, pile.kind);
  const backTexture = useManagedTexture(CARD_BACK_URL);
  const isDeck = pile.kind === 'deck';
  const visible = pile.count > 0;

  return (
    <group position={[position[0], position[1], position[2]]}>
      {/* 整堆按同一个比例缩放：底衬、垫片与明牌要一起变小，各自写一份迟早对不齐 */}
      <group scale={PILE_CARD_SCALE}>
        <PileBase color={isDeck ? '#7fb2ff' : '#c9a86a'} />

        {visible && isDeck && backTexture && (
          <>
            {/* 几张错开的背面：张数看不出来，但「这里有一摞」看得出来 */}
            <BackPlate y={0.004} offsetX={-0.05} offsetZ={0.035} rotation={0.05} texture={backTexture} />
            <BackPlate y={0.009} offsetX={-0.025} offsetZ={0.018} rotation={0.025} texture={backTexture} />
            <BackPlate y={0.014} offsetX={0} offsetZ={0} rotation={0} texture={backTexture} />
          </>
        )}

        {visible && !isDeck && (
          <>
            {backTexture && (
              <BackPlate y={0.006} offsetX={0.05} offsetZ={-0.04} rotation={-0.05} texture={backTexture} />
            )}
            {pile.topCard && (
              <CardMesh
                card={pile.topCard}
                position={[0, 0.014, 0]}
                rotationX={-Math.PI / 2}
                interactive={false}
              />
            )}
          </>
        )}
      </group>
    </group>
  );
}
