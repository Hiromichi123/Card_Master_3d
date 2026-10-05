import type { CardDefinition, SideId } from '../../domain/cards/types';
import { cardById, slice } from '../../data';
import type { CardPlacement } from './BattleBoard';
import { CARD_FLAT_ROTATION_X, handCardTransform } from './layout';
import { buildSlots, type SlotDescriptor } from './layout';

/**
 * P1 的演示布置。
 *
 * 存在的理由：P1 的验收是**视觉**的——透视、厚度、阴影、翻转、中文可读——
 * 这些必须在有真实卡面时才能判断。P2 的规则引擎还没写，所以先用切片数据
 * 摆一盘静态局面来验收渲染。
 *
 * 这不是规则实现，也不假装是：P3 会把它换成 `BattleState` 的映射，
 * 那时本文件应当被删除而不是继续扩展。
 */

function slotsFor(side: SideId, zone: SlotDescriptor['zone']): SlotDescriptor[] {
  return buildSlots().filter((slot) => slot.side === side && slot.zone === zone);
}

/** 取切片里的第 n 张（按切片顺序，保证每次运行一致）。 */
function sliceCard(index: number): CardDefinition | undefined {
  const entry = slice.cards[index];
  return entry ? cardById.get(entry.cardId) : undefined;
}

export interface DemoArrangement {
  readonly placements: CardPlacement[];
  readonly handCardIds: string[];
}

export function buildDemoArrangement(): DemoArrangement {
  const placements: CardPlacement[] = [];

  // 玩家战斗区：放 3 张，留两个空槽以便观察槽位标记与空位对比
  const playerBattleSlots = slotsFor('player', 'battle');
  const playerBattleCards = [0, 5, 7]
    .map((index) => sliceCard(index))
    .filter((card): card is CardDefinition => card !== undefined);

  playerBattleCards.forEach((card, i) => {
    const slot = playerBattleSlots[i];
    if (!slot) {
      return;
    }
    placements.push({
      card,
      position: slot.position,
      rotationX: CARD_FLAT_ROTATION_X,
    });
  });

  // 敌方战斗区：放 2 张
  const enemyBattleSlots = slotsFor('enemy', 'battle');
  const enemyBattleCards = [1, 10]
    .map((index) => sliceCard(index))
    .filter((card): card is CardDefinition => card !== undefined);

  enemyBattleCards.forEach((card, i) => {
    const slot = enemyBattleSlots[i];
    if (!slot) {
      return;
    }
    placements.push({
      card,
      position: slot.position,
      rotationX: CARD_FLAT_ROTATION_X,
    });
  });

  // 玩家准备区：放 2 张，验证准备区的卡比战斗区小一圈的观感
  const playerPrepSlots = slotsFor('player', 'prep');
  const playerPrepCards = [3, 12]
    .map((index) => sliceCard(index))
    .filter((card): card is CardDefinition => card !== undefined);

  playerPrepCards.forEach((card, i) => {
    const slot = playerPrepSlots[i];
    if (!slot) {
      return;
    }
    placements.push({
      card,
      position: slot.position,
      rotationX: CARD_FLAT_ROTATION_X,
    });
  });

  // 敌方准备区：放 3 张卡背，验证背面渲染
  const enemyPrepSlots = slotsFor('enemy', 'prep');
  const enemyPrepCards = [2, 6, 9]
    .map((index) => sliceCard(index))
    .filter((card): card is CardDefinition => card !== undefined);

  enemyPrepCards.forEach((card, i) => {
    const slot = enemyPrepSlots[i];
    if (!slot) {
      return;
    }
    placements.push({
      card,
      position: slot.position,
      rotationX: CARD_FLAT_ROTATION_X,
      faceDown: true,
    });
  });

  // 玩家手牌：8 张扇形
  const handIndices = [0, 3, 5, 15, 16, 18, 20, 22];
  const handCards = handIndices
    .map((index) => sliceCard(index))
    .filter((card): card is CardDefinition => card !== undefined);

  handCards.forEach((card, index) => {
    const transform = handCardTransform(index, handCards.length);
    placements.push({
      card,
      position: transform.position,
      rotationY: transform.rotationY,
      rotationX: transform.rotationX,
    });
  });

  return {
    placements,
    handCardIds: handCards.map((card) => card.cardId),
  };
}
