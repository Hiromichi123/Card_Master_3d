import type { CardDefinition } from '../../domain/cards/types';
import { CardMesh } from '../cards/CardMesh';
import { useSettingsStore } from '../../state/settingsStore';
import { CameraRig } from './CameraRig';
import { LAYOUT } from './layout';
import { SlotMarkers } from './SlotMarkers';
import { Table } from './Table';

/** 一张卡在桌面上的位置与朝向。由上层（P3 的 BattleState 映射）产生。 */
export interface CardPlacement {
  readonly card: CardDefinition;
  readonly position: readonly [number, number, number];
  readonly rotationY?: number;
  readonly rotationX?: number;
  readonly faceDown?: boolean;
  readonly interactive?: boolean;
}

/**
 * 战桌场景的整体组装。
 *
 * `V-WORLD-5`：`cameraShake` 只影响表现，不参与规则；
 * 这里先放光照与相机，镜头反馈在 P3 接演出层时再加。
 *
 * `V-TABLE-3`：一盏主光 + 环境光起步；主光方向固定，
 * 避免卡面在动画过程中忽明忽暗。
 */
export interface BattleBoardProps {
  /** 可放置槽位键集合，由上层传入。 */
  readonly placeable?: ReadonlySet<string> | undefined;
  readonly targeted?: ReadonlySet<string> | undefined;
  /** 桌面上的卡牌。P1 由演示布置提供，P3 换成 BattleState 的映射结果。 */
  readonly placements?: readonly CardPlacement[] | undefined;
  readonly selectedCardId?: string | null | undefined;
  readonly onCardClick?: ((card: CardDefinition) => void) | undefined;
  readonly onCardHover?: ((card: CardDefinition, hovered: boolean) => void) | undefined;
  /** 阴影贴图边长，按画质档传入。 */
  readonly shadowMapSize?: number | undefined;
}

export function BattleBoard({
  placeable,
  targeted,
  placements,
  selectedCardId,
  onCardClick,
  onCardHover,
  shadowMapSize = 2048,
}: BattleBoardProps) {
  const theme = useSettingsStore((state) => state.tableTheme);
  const quality = useSettingsStore((state) => state.quality);

  return (
    <>
      <CameraRig />

      {/* 环境光给整体一个可读的底，主光负责方向感与阴影 */}
      <ambientLight intensity={0.9} />
      <hemisphereLight args={['#9fb6e0', '#3b4252', 0.9]} />

      {/*
        主光跟随桌面中心，而不是世界原点：桌子是按 tableCenterZ 居中的，
        光源若仍以原点为基准，远端准备区会落在阴影相机范围外而丢掉阴影。
      */}
      <directionalLight
        position={[6, 12, LAYOUT.tableCenterZ + 7]}
        target-position={[0, 0, LAYOUT.tableCenterZ]}
        intensity={1.5}
        castShadow
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        shadow-camera-near={1}
        shadow-camera-far={45}
        shadow-camera-left={-11}
        shadow-camera-right={11}
        shadow-camera-top={11}
        shadow-camera-bottom={-11}
        shadow-bias={-0.0006}
      />

      <Table theme={theme} quality={quality} />
      <SlotMarkers placeable={placeable} targeted={targeted} />

      {placements?.map((placement, index) => (
        <CardMesh
          key={`${placement.card.cardId}#${index}`}
          card={placement.card}
          position={placement.position}
          rotationY={placement.rotationY}
          rotationX={placement.rotationX}
          faceDown={placement.faceDown}
          interactive={placement.interactive}
          selected={placement.card.cardId === selectedCardId}
          onClick={onCardClick}
          onHoverChange={onCardHover}
        />
      ))}
    </>
  );
}
