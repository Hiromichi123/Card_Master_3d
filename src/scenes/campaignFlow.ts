import { summonDefinitionIds } from '../domain/skills/tacticalTraits';
import { cardById, cardDatabase, decks, stages } from '../data';
import type { StageRewardSpec } from '../data';
import { buildCardPool } from '../domain/progression/gacha';
import { settleStage, settlementRng } from '../domain/progression/campaign';
import type { Settlement, StageLaunch } from '../domain/progression/campaign';
import { rarityIndex } from '../state/useRarityIndex';
import type { BattleConfig, BattleOutcome } from '../domain/battle/types';
import type { CardDefinition } from '../domain/cards/types';
import type { DefinitionTable } from '../rendering/presentation/demoBattle';

/**
 * 战役的「选关 → 开战 → 结算」之间要拼的那几块。
 *
 * 领域层只认参数（`planStageLaunch` / `settleStage` 都收现成的牌组、奖励规格、
 * 卡池），数据层的 JSON 与引擎要的形状之间的转换放在这里——
 * 于是 `App` 与地图屏都不必认识 `cardDatabase` 与 `buildCardPool`。
 */

/** 一关的静态配置（来自 `stages.json` 与 `decks.json`）。 */
export interface StageInfo {
  readonly id: string;
  readonly name: string;
  readonly chapterId: string;
  readonly chapterName: string;
  /** 关卡海报的 ID；数据里可能是 null（那几关就画一块纯色底板）。 */
  readonly posterId: string | null;
  readonly summary: string | null;
  readonly reward: StageRewardSpec | null;
  /** 这一关的敌方牌组（`decks.json`）。空数组表示配置缺失。 */
  readonly enemyDeck: readonly string[];
}

/** 章节（含它的关卡）。 */
export interface ChapterInfo {
  readonly id: string;
  readonly name: string;
  readonly posterId: string;
  readonly backgroundType: string;
  readonly stages: readonly StageInfo[];
}

/**
 * Six world chapters with four stages each. Newly added enemy decks remain
 * empty until configured through the admin editor.
 * Poster and background IDs remain available for the existing chapter/stage views.
 */
export function campaignChapters(enemyOverrides: Readonly<Record<string, readonly string[]>> = {}): readonly ChapterInfo[] {
  const chapters:ChapterInfo[]=stages.chapters.map((chapter) => ({
    id: chapter.id,
    name: chapter.name,
    posterId: `chapter_${chapter.id.split('_')[1] ?? '1'}_enter`,
    backgroundType: `bg/${chapter.id}_map`,
    stages: chapter.stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      chapterId: chapter.id,
      chapterName: chapter.name,
      posterId: stage.posterId,
      summary: stage.summary,
      reward: stage.reward,
      enemyDeck: enemyOverrides[stage.id] ?? decks.enemy[stage.id]?.cardIds ?? [],
    })),
  }));
  return chapters;
}

/** 引擎要的定义表：只放这一局用得到的卡。 */
export function definitionsFor(cardIds: readonly string[]): DefinitionTable {
  const table: Record<string, CardDefinition> = {};
  for (const cardId of summonDefinitionIds(cardIds, (id) => cardById.get(id))) {
    const definition = cardById.get(cardId);
    if (definition) {
      table[cardId] = definition;
    }
  }
  return table;
}

/** 把一次启动变成引擎的配置。种子取自 `battleId`，所以同一次挑战可复现。 */
export function configFor(launch: StageLaunch): BattleConfig {
  return {
    seed: launch.seed,
    playerDeck: launch.playerDeck,
    enemyDeck: launch.enemyDeck,
    label: launch.stageName,
  };
}

/**
 * 算这一局的奖励。
 *
 * **不改任何东西**：只读 `outcome` 与 `launch`，随机流由 `battleId` 派生
 * （`settlementRng`），所以重渲染、重开页面都会得到同一份结果——
 * 不用把「这次掉了什么」存下来。
 */
export function settlementFor(launch: StageLaunch, outcome: BattleOutcome): Settlement {
  return settleStage({
    rewardSpec: launch.rewardSpec,
    outcome,
    rng: settlementRng(launch.battleId),
    pool: buildCardPool(cardDatabase.definitions),
    rarityOrder: rarityIndex().order,
    dropSeed: launch.seed,
  });
}
