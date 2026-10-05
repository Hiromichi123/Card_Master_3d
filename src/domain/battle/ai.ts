import type { Rng } from './rng';
import type { BattleState, Command } from './types';

/**
 * 基础 AI。
 *
 * 只做一件事：**通过和其他调用方完全相同的命令入口提交行动**。
 * 它没有直接改状态的权力，也不能绕过 `validateCommand`；因此
 * 「AI 的行动合法」和「玩家的行动合法」是同一套判定，不会出现两套规则。
 *
 * 它的思考时间属于演出层（P3 里由演出层决定何时调用本函数），
 * 不参与合法性判断，也不影响结果。
 *
 * 策略刻意做得简单：出一张牌，然后结束回合。目的是让 P3 能先跑通一整局，
 * 复杂策略不在本轮范围内。
 */
export function chooseCommand(state: BattleState, rng: Rng, side = state.currentSide): Command {
  if (state.outcome || state.phase !== 'awaitingPlay') {
    return { kind: 'endTurn', side };
  }

  const zones = state.zones[side];

  // 还有出牌额度、手牌非空、准备区有空位 → 出一张
  if (state.cardsPlayedThisTurn < state.rules.cardsPerTurn && zones.hand.length > 0) {
    const slot = zones.prep.findIndex((id) => id === null);
    if (slot >= 0) {
      /**
       * 选哪一张：优先出**冷却最短**的卡。
       *
       * 这是最朴素的一条启发式，但已经比「随手出第一张」明显更像在玩：
       * CD 短的卡能更快上场参与攻击，而 CD 长的先留在手里等。
       * 同 CD 时用带 seed 的随机打破平局——不能用 `Math.random()`，
       * 否则同 seed 的两局结果会不同。
       */
      const hand = zones.hand.slice();
      hand.sort((a, b) => {
        const cardA = state.instances[a];
        const cardB = state.instances[b];
        const cdA = cardA ? (state.definitions[cardA.definitionId]?.cd ?? 0) : 0;
        const cdB = cardB ? (state.definitions[cardB.definitionId]?.cd ?? 0) : 0;
        return cdA - cdB;
      });
      const bestCd = hand.length > 0 ? hand[0] : undefined;
      const bestValue = bestCd
        ? (state.definitions[state.instances[bestCd]?.definitionId ?? '']?.cd ?? 0)
        : 0;
      const tied = hand.filter((id) => {
        const card = state.instances[id];
        return card
          ? (state.definitions[card.definitionId]?.cd ?? 0) === bestValue
          : false;
      });

      const chosen = rng.pick(tied.length > 0 ? tied : hand);
      return { kind: 'playCard', side, instanceId: chosen, prepSlot: slot };
    }
  }

  return { kind: 'endTurn', side };
}
