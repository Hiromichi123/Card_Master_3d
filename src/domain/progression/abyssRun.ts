import { cardDatabase } from '../../data';
import { seedFrom } from '../battle/rng';
import type { CardDefinition } from '../cards/types';
import { reject, type Planned } from './plan';
import type { ProfileState } from './types';
import type { AbyssAction, AbyssCard, AbyssHistory, AbyssRun, AbyssState } from './abyssTypes';
import { ABYSS_DECK_LIMIT, ABYSS_RECRUIT_PRICE, ABYSS_RULES_VERSION, ABYSS_STAT_LIMIT, ABYSS_TRAINING_PRICE, ABYSS_WIN_COINS, abyssGrowthTargets, abyssStarterChoices, makeAbyssEncounter, makeAbyssGrowthOffer } from './abyssRules';

export function emptyAbyssState(): AbyssState {
  return { revision: 0, run: null, history: [], knownEffectIds: [] };
}

export function abyssStateToken(profile: Pick<ProfileState, 'abyss'>): string {
  const { revision, run } = profile.abyss;
  return `abyss:${revision}:${run?.id ?? '-'}:${run?.revision ?? 0}:${run?.stage.kind ?? 'none'}`;
}

function archive(state: AbyssState, run: AbyssRun, reason: AbyssHistory['reason'], now: Date): AbyssState {
  const entry: AbyssHistory = {
    runId: run.id, startedAt: run.startedAt, endedAt: now.toISOString(), reason,
    floor: run.floor, encounter: run.encounter, wins: run.wins, losses: run.losses,
    coins: run.coins, earnedCoins: run.earnedCoins,
    cards: run.cards.map(card => ({ ...card, upgrades: { ...card.upgrades }, addedTraits: card.addedTraits.map(item => ({ ...item })), baseDefinition: { ...card.baseDefinition, rawTraits: [...card.baseDefinition.rawTraits], skills: card.baseDefinition.skills.map(item => ({ ...item })), art: { ...card.baseDefinition.art } }, definition: { ...card.definition, rawTraits: [...card.definition.rawTraits], skills: card.definition.skills.map(item => ({ ...item })), art: { ...card.definition.art } } })),
  };
  return { ...state, run: null, history: [entry, ...state.history].slice(0, 10) };
}

/**
 * 读档专用：规则或卡库版本已经**不兼容**的在途 run，按「放弃挑战」归档后继续读档。
 *
 * `abyssValidation` 要求 run 的 `rulesVersion` / `contentVersion` 与当前**完全相等**
 * （在途 run 的候选是拿旧卡库生成的，加卡之后再也复现不出来）。
 * 原来的做法是把**整份存档**判成不可读，于是加一次卡就把玩家锁死在登录页
 * （2026-10-12 实测：加 16 张卡改掉 `contentVersion`，admin 号进不去）。
 * 这里只降级这一种情况，而且走玩家点「放弃」的**同一条归档路径**：
 * 不补造候选、不发奖励、不动主货币与库存；调用方还要把结果再过一遍
 * `validateAbyssState`，免得把真正的坏进度也一起救进来。
 *
 * 返回 `null` = 不该降级（没有 run，或 run 本来就兼容），调用方维持原判。
 */
export function retireIncompatibleRun(state: AbyssState, currentContentVersion: string, now: Date): AbyssState | null {
  const run = state.run;
  if (!run || (run.rulesVersion === ABYSS_RULES_VERSION && run.contentVersion === currentContentVersion)) return null;
  const time = now.getTime();
  if (!Number.isFinite(time)) return null;
  const startedAt = Date.parse(run.startedAt);
  // endedAt 不得早于 startedAt：`?day=` 能把时钟拨到过去，倒流的 endedAt 会让归档本身不合法
  const ended = new Date(Number.isFinite(startedAt) ? Math.max(time, startedAt) : time);
  const archived = archive(state, run, 'abandoned', ended);
  // 与 `planAbyssAction` 的 abandon 一致：状态变了，版本号跟着走
  return { ...archived, revision: state.revision + 1 };
}

function discover(state: AbyssState, ids: readonly string[]): AbyssState {
  return { ...state, knownEffectIds: [...new Set([...state.knownEffectIds, ...ids])] };
}

function nextBattle(run: AbyssRun, definitions: readonly CardDefinition[]): AbyssRun {
  const floor = run.encounter === 10 ? run.floor + 1 : run.floor;
  const encounter = run.encounter === 10 ? 1 : run.encounter + 1;
  if (!Number.isSafeInteger(floor) || floor > 10000) throw new Error('已到达本版支持的最深层，请结算本轮。');
  const next = { ...run, floor, encounter };
  return { ...next, stage: { kind: 'boonChoice', battle: makeAbyssEncounter(next, definitions) } };
}

/** 输入只含选择与权威结果，价格/奖励/候选一律由领域规则生成。 */
export function planAbyssAction(profile: ProfileState, action: AbyssAction, now: Date | number, definitions: readonly CardDefinition[] = cardDatabase.definitions): Planned<AbyssState> {
  if (action.expectedToken !== abyssStateToken(profile)) return reject('深渊进度已变化，请使用当前面板重新操作。');
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) return reject('当前时间无效。');
  const old = profile.abyss;
  const run = old.run;
  let state = old;
  let next = run;
  try {
    if (action.kind === 'start') {
      if (run && !action.confirmAbandon) return reject('已有深渊进度，请先确认放弃本轮。');
      if (run) state = archive(state, run, 'abandoned', date);
      const id = `abyss/${date.getTime()}/${old.revision + 1}`;
      const seed = seedFrom(`${id}:${profile.revision}`);
      next = {
        id, seed, revision: 0, rulesVersion: ABYSS_RULES_VERSION, contentVersion: cardDatabase.contentVersion,
        startedAt: date.toISOString(), floor: 1, encounter: 1, lives: 3, coins: 0, earnedCoins: 0,
        wins: 0, losses: 0, cards: [], lastSettledBattleId: null,
        stage: { kind: 'starterDraft', choices: abyssStarterChoices(id, seed, definitions) },
      };
    } else {
      if (!run) return reject('没有可以继续的深渊进度。');
      if (run.rulesVersion !== ABYSS_RULES_VERSION || run.contentVersion !== cardDatabase.contentVersion) return reject('此轮深渊规则或卡库版本不兼容，无法继续。');
      const stage = run.stage;
      switch (action.kind) {
        case 'chooseStarter': {
          if (stage.kind !== 'starterDraft' || !Number.isInteger(action.index)) return reject('当前不是起始选组阶段。');
          const choice = stage.choices[action.index];
          if (!choice) return reject('这套起始卡组不存在。');
          const equipped = { ...run, cards: choice.cards };
          next = { ...equipped, stage: { kind: 'boonChoice', battle: makeAbyssEncounter(equipped, definitions) } };
          break;
        }
        case 'chooseBoon': {
          if (stage.kind !== 'boonChoice' || !Number.isInteger(action.index)) return reject('当前不能选择开场增益。');
          const pair = stage.battle.boonChoices[action.index];
          if (!pair) return reject('这组绑定增益不存在。');
          next = { ...run, stage: { kind: 'battleReady', battle: { ...stage.battle, selectedBoon: action.index } } };
          state = discover(state, [pair.positive.id, pair.negative.id, stage.battle.enemyEffect.id]);
          break;
        }
        case 'beginBattle':
          if (stage.kind !== 'battleReady') return reject('请先完成战前选择；进行中的战斗可直接继续。');
          next = { ...run, stage: { kind: 'inBattle', battle: stage.battle } };
          break;
        case 'settle': {
          if (stage.kind !== 'inBattle' || stage.battle.battleId !== action.battleId || run.lastSettledBattleId === action.battleId) return reject('这场战斗已结算或不属于当前进度。');
          const outcome = action.outcome;
          if (!outcome || !['win', 'draw'].includes(outcome.kind) || (outcome.kind === 'win' && !['player', 'enemy'].includes(outcome.winner))) return reject('战斗结果无效。');
          const won = outcome.kind === 'win' && outcome.winner === 'player';
          const boss = stage.battle.difficulty === 'nightmare';
          const gain = won ? ABYSS_WIN_COINS[stage.battle.difficulty] : boss ? 0 : 10;
          const lives = won ? run.lives : boss ? 0 : run.lives - 1;
          const result = won ? 'win' : outcome.kind === 'draw' ? 'draw' : 'loss';
          next = { ...run, lives, coins: run.coins + gain, earnedCoins: run.earnedCoins + gain, wins: run.wins + Number(won), losses: run.losses + Number(!won), lastSettledBattleId: action.battleId };
          if (lives === 0) { state = archive(state, next, 'defeated', date); next = null; break; }
          next = { ...next, stage: { kind: 'camp', battle: stage.battle, result, freeRemaining: won ? 3 : 0, offerSerial: 0, offer: won ? makeAbyssGrowthOffer(next, 'free', 0, definitions) : null } };
          break;
        }
        case 'buy': {
          if (stage.kind !== 'camp' || stage.offer || stage.freeRemaining > 0) return reject('请先处理当前培养机会。');
          if (action.purchase !== 'training' && action.purchase !== 'recruit') return reject('未知深渊商品。');
          const price = action.purchase === 'training' ? ABYSS_TRAINING_PRICE : ABYSS_RECRUIT_PRICE;
          if (run.coins < price) return reject(`深渊币不足，需要 ${price} 币。`);
          const serial = stage.offerSerial + 1;
          next = { ...run, coins: run.coins - price, stage: { ...stage, offerSerial: serial, offer: makeAbyssGrowthOffer(run, action.purchase, serial, definitions) } };
          break;
        }
        case 'chooseGrowth': {
          if (stage.kind !== 'camp' || !stage.offer || stage.offer.id !== action.offerId || !Number.isInteger(action.index)) return reject('这次培养机会已变化。');
          const offer = stage.offer;
          const option = offer.options[action.index];
          if (!option) return reject('培养选项不存在。');
          let cards: readonly AbyssCard[] = run.cards;
          if (option.kind === 'recruit') {
            if (!action.discardNew) {
              if (cards.length >= ABYSS_DECK_LIMIT) {
                if (!action.targetId || !cards.some(card => card.instanceId === action.targetId)) return reject('卡组已满，请选择一张替换，或明确放弃新卡。');
                cards = cards.map(card => card.instanceId === action.targetId ? option.card : card);
              } else cards = [...cards, option.card];
            }
          } else {
            if (action.discardNew) return reject('只有新卡可以选择放弃。');
            const target = abyssGrowthTargets(cards, option).find(card => card.instanceId === action.targetId);
            if (!target) return reject('请选择可接受此次培养的卡牌；不能删除最后一张卡。');
            if (option.kind === 'remove') cards = cards.filter(card => card.instanceId !== target.instanceId);
            else {
              let grown = target;
              if (option.kind === 'trait') {
                grown = { ...target, addedTraits: [...target.addedTraits, option.trait], definition: { ...target.definition, rawTraits: [...target.definition.rawTraits, option.trait.raw], skills: [...target.definition.skills, option.trait] } };
                state = discover(state, [`trait:${option.trait.family}`]);
              } else {
                const key = option.kind;
                const value = key === 'cd' ? target.definition.cd - 1 : Math.min(ABYSS_STAT_LIMIT, target.definition[key] + (key === 'hp' ? 2 : 1));
                grown = { ...target, upgrades: { ...target.upgrades, [key]: target.upgrades[key] + value - target.definition[key] }, definition: { ...target.definition, [key]: value } };
              }
              cards = cards.map(card => card.instanceId === target.instanceId ? grown : card);
            }
          }
          const freeRemaining = stage.freeRemaining - Number(offer.source === 'free');
          const serial = stage.offerSerial + 1;
          const updated = { ...run, cards };
          next = { ...updated, stage: { ...stage, freeRemaining, offerSerial: serial, offer: freeRemaining > 0 ? makeAbyssGrowthOffer(updated, 'free', serial, definitions) : null } };
          break;
        }
        case 'skipFree':
          if (stage.kind !== 'camp' || stage.freeRemaining <= 0 || stage.offer?.source !== 'free') return reject('当前没有可放弃的免费培养。');
          next = { ...run, stage: { ...stage, freeRemaining: 0, offer: null } };
          break;
        case 'next':
          if (stage.kind === 'bossDecision') next = nextBattle(run, definitions);
          else if (stage.kind === 'camp' && !stage.offer && stage.freeRemaining === 0) next = stage.battle.difficulty === 'nightmare'
            ? { ...run, stage: { kind: 'bossDecision', battle: stage.battle } } : nextBattle(run, definitions);
          else return reject('请先处理当前选择。');
          break;
        case 'finish':
          if (stage.kind !== 'bossDecision') return reject('只有胜利通过噩梦并完成营地后可以结算。');
          state = archive(state, run, 'settled', date); next = null;
          break;
        case 'abandon':
          state = archive(state, run, 'abandoned', date); next = null;
          break;
      }
    }
    if (next && (!Number.isSafeInteger(next.coins) || !Number.isSafeInteger(next.earnedCoins))) return reject('深渊币已超出可保存范围。');
    state = { ...state, revision: old.revision + 1, run: next ? { ...next, revision: (run && next.id === run.id ? run.revision : 0) + 1 } : null };
    if (!Number.isSafeInteger(state.revision)) return reject('深渊版本号已超出可保存范围。');
    return {
      transaction: { operationId: action.operationId ?? `${action.expectedToken}:${action.kind}`, currencyDelta: {}, inventoryDelta: {}, abyssUpdate: { expectedToken: action.expectedToken, state } },
      view: state,
    };
  } catch (error) {
    return reject(error instanceof Error ? error.message : '深渊选项生成失败，进度未改变。');
  }
}
