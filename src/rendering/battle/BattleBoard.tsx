import type { CardDefinition, SideId } from '../../domain/cards/types';
import type { StatKind } from '../cards/statBadge';
import type { StatLayout } from '../cards/StatBadges';
import { MovingCard } from './MovingCard';
import { Pile } from './Pile';
import type { PileView } from './placements';
import { useSettingsStore } from '../../state/settingsStore';
import { CameraRig } from './CameraRig';
import { SceneEnvironment } from './SceneEnvironment';
import { SceneGround } from './SceneGround';
import { SlotMarkers } from './SlotMarkers';
import type { SlotZone } from './layout';
import { Table } from './Table';

/**
 * 一张卡在桌面上的位置与朝向。由上层（P3 的 `BattleState` 映射）产生。
 *
 * **身份是 `instanceId`，不是 `cardId`。** 同一张定义在一局里可以同时存在多份
 * （重复 trait、分身、复制），按 `cardId` 做 key 会让它们共用同一个 React 元素、
 * 一起高亮，卡牌换区时还会被当成新元素重放翻面动画。
 */
export interface CardPlacement {
  readonly instanceId: string;
  readonly card: CardDefinition;
  readonly position: readonly [number, number, number];
  readonly rotationY?: number | undefined;
  readonly rotationX?: number | undefined;
  readonly faceDown?: boolean | undefined;
  readonly interactive?: boolean | undefined;
  /** 卡牌整体缩放（准备区的卡比战斗区小一圈）。 */
  readonly scale?: number | undefined;
  /**
   * 当前数值。缺省用卡面定义里的初始值。
   *
   * 战斗中的 HP/ATK 会随祝福、破甲、受伤改动，且**要按命中节点才更新显示**，
   * 所以这里必须能独立于 `card` 传入（`V-CARD-3`）。
   */
  readonly stats?:
    | { readonly atk: number; readonly hp: number; readonly cd: number }
    | undefined;
  /** 刚刚变化过的项，会换成亮色高亮。 */
  readonly emphasisedStats?: ReadonlySet<StatKind> | undefined;
  /** 这张牌在哪个区域。决定数值怎么摆（见 `StatBadges`）。 */
  readonly statLayout?: StatLayout | undefined;
  /** 是否显示数值徽标。对手的手牌不显示。 */
  readonly showStats?: boolean | undefined;
  /** 是否叠全息层。对手的手牌不叠。 */
  readonly holo?: boolean | undefined;
  /**
   * 这张牌上一次是从哪里来的（抽牌、还魂）。
   *
   * 只在它**首次出现在画面上**时用得到：从牌堆抽到手、从弃牌堆被捞回来，
   * 这两种情况下画面上原本没有它，需要一个起点才知道该从哪飞过来。
   * 其余移动（出牌、部署、顺位整理）牌本来就在画面上，从当前位置接着走即可。
   */
  readonly spawn?: readonly [number, number, number] | undefined;
}

/**
 * 战桌场景的整体组装。
 *
 * `V-WORLD-5`：`cameraShake` 只影响表现，不参与规则。
 *
 * `V-TABLE-3`：一盏主光 + 环境光起步；主光方向固定，
 * 避免卡面在动画过程中忽明忽暗。
 */
export interface BattleBoardProps {
  /** 可放置槽位键集合，由上层传入。 */
  readonly placeable?: ReadonlySet<string> | undefined;
  readonly targeted?: ReadonlySet<string> | undefined;
  /** 桌面上的卡牌。由 `BattleState` 的映射结果提供。 */
  readonly placements?: readonly CardPlacement[] | undefined;
  /**
   * 当前选中的卡。
   *
   * 是 `instanceId` 而不是 `cardId`——场上可能同时有两张同定义的卡，
   * 按定义比对会让它们一起亮。
   */
  readonly selectedInstanceId?: string | null | undefined;
  /** 点击卡牌。第二个参数是该卡的 `instanceId`。 */
  readonly onCardClick?: ((card: CardDefinition, instanceId: string) => void) | undefined;
  readonly onCardHover?: ((card: CardDefinition, hovered: boolean) => void) | undefined;
  /** 点击槽位。用于把手牌放到准备区。 */
  readonly onSlotClick?: ((side: SideId, zone: SlotZone, index: number) => void) | undefined;
  /** 双方的牌堆与弃牌堆。 */
  readonly piles?: readonly PileView[] | undefined;
}

export function BattleBoard({
  placeable,
  targeted,
  placements,
  selectedInstanceId,
  onCardClick,
  onCardHover,
  onSlotClick,
  piles,
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
      <SlotMarkers placeable={placeable} targeted={targeted} onSlotClick={onSlotClick} />

      {piles?.map((pile) => <Pile key={`${pile.side}-${pile.kind}`} pile={pile} />)}

      {placements?.map((placement) => (
        <MovingCard
          key={placement.instanceId}
          instanceId={placement.instanceId}
          card={placement.card}
          target={placement.position}
          spawn={placement.spawn}
          rotationY={placement.rotationY}
          rotationX={placement.rotationX}
          faceDown={placement.faceDown}
          interactive={placement.interactive}
          scale={placement.scale}
          stats={placement.stats}
          emphasisedStats={placement.emphasisedStats}
          statLayout={placement.statLayout}
          showStats={placement.showStats}
          holo={placement.holo}
          selected={placement.instanceId === selectedInstanceId}
          // CardMesh 只认得卡牌定义，实例身份由这里补上——
          // 直接透传 onCardClick 的话第二个参数会永远缺省。
          onClick={
            onCardClick
              ? (card) => onCardClick(card, placement.instanceId)
              : undefined
          }
          onHoverChange={onCardHover}
        />
      ))}
    </>
  );
}
