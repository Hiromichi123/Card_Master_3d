/**
 * 固定演示对局。
 *
 * 清单要求「建立固定『演示战斗』，可快速展示部署、元素攻击、群体命中和死亡，
 * 不依赖随机抽到合适牌」。随机性必须固定，否则同一段演出没法复现，
 * 普通/快速/跳过三条路径的比对也无从谈起。
 *
 * seed 与牌组都取自切片定义（`docs/SLICE.md` 第 2 节）：
 * 演示对局用 `seedBase` 本身，规则用例用 `seedBase + k`。
 * 牌组是挑过的，覆盖 25 个技能族 + 飞行规则。
 */

import { cardById, slice } from '../../data';
import type { BattleConfig } from '../../domain/battle/types';
import type { CardDefinition } from '../../domain/cards/types';

/** 引擎要的定义表；`cardById` 是 Map，转一次。 */
export type DefinitionTable = Readonly<Record<string, CardDefinition>>;

function deckById(id: string): readonly string[] {
  const deck = slice.decks.find((entry) => entry.id === id);
  if (!deck) {
    throw new Error(`切片里没有名为 ${id} 的牌组`);
  }
  return deck.cardIds;
}

export const DEMO_PLAYER_DECK = deckById('demo-player');
export const DEMO_ENEMY_DECK = deckById('demo-enemy');

export const DEMO_CONFIG: BattleConfig = {
  seed: slice.seedBase,
  playerDeck: DEMO_PLAYER_DECK,
  enemyDeck: DEMO_ENEMY_DECK,
  label: '演示战斗',
};

/**
 * 演示对局用到的全部卡牌定义。
 *
 * 只装这一局会用到的那些：引擎按 `definitions` 查表，装全 247 张没有必要，
 * 而且定义表会被 `structuredClone` 的 state 按引用共享，越小越省。
 */
export function demoDefinitions(): DefinitionTable {
  const table: Record<string, CardDefinition> = {};
  for (const cardId of [...DEMO_PLAYER_DECK, ...DEMO_ENEMY_DECK]) {
    const definition = cardById.get(cardId);
    if (!definition) {
      throw new Error(`演示牌组引用了不存在的卡：${cardId}`);
    }
    table[cardId] = definition;
  }
  return table;
}

/**
 * AI 用的随机源。
 *
 * 与 `tests/unit/battleEngine.test.ts` 里同样的派生方式：从对局 seed 派生，
 * 这样 AI 的平局取舍也随同 seed 复现，不会让「同一局跑两次结果不同」。
 */
export const AI_SEED_MIX = 0x5f3759df;
