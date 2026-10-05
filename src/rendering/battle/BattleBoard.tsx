import type { CardDefinition } from '../../domain/cards/types';
import { CardMesh } from '../cards/CardMesh';
import { useSettingsStore } from '../../state/settingsStore';
import { CameraRig } from './CameraRig';
import { SceneEnvironment } from './SceneEnvironment';
import { SceneGround } from './SceneGround';
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
}

export function BattleBoard({
  placeable,
  targeted,
  placements,
  selectedCardId,
  onCardClick,
  onCardHover,
}: BattleBoardProps) {
  const theme = useSettingsStore((state) => state.tableTheme);
  const quality = useSettingsStore((state) => state.quality);
  const shadows = useSettingsStore((state) => state.profile.shadows);
  const reduceMotion = useSettingsStore((state) => state.reduceMotion);

  return (
    <>
      <CameraRig />

      {/*
        环境与灯光移植自棋盘项目：一盏投影主光 + 冷色补光 + 轮廓光 + 极低环境光，
        再加上运行时生成的房间环境贴图。台面用的是物理材质，
        没有环境贴图时 clearcoat 与 envMapIntensity 基本不起作用，
        木头和大理石会长得一样平。
      */}
      <SceneEnvironment theme={theme} shadows={shadows} />

      {/* 棋盘之外的大圆桌：远端的边缘由雾化成背景色 */}
      <SceneGround theme={theme} />

      <Table
        theme={theme}
        quality={quality}
        weatherId={theme.id}
        reduceMotion={reduceMotion}
      />
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
