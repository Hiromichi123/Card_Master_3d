/**
 * 演出节奏与坐标常量。
 *
 * 集中放一处，是为了让「同一个事件在两处用了不同的时长」这种不一致不可能发生——
 * beat 时长、命中高度、离场代理的存活时间都从这一份读。
 */

import type { BattleEvent } from '../../domain/battle/types';

/**
 * 每个事件占的演出时长（秒，未乘速度档）。
 *
 * 「起手 → 命中」的观感由模板自己负责，这里给的是**两个事件之间**的间隔，
 * 所以数值偏小。没有列举的事件用 `DEFAULT_BEAT`。
 */
export const EVENT_BEAT: Partial<Record<BattleEvent['type'], number>> = {
  CardDrawn: 0.22,
  CardReset: 0,
  CooldownCardGranted: 0.22,
  CooldownCardUsed: 0.18,
  FormationInserted: 0.12,
  PriorityChosen: 0,
  DeploymentWindowOpened: 0,
  CardPlayed: 0.3,
  CardDeployed: 0.3,
  CardSummoned: 0.3,
  CloneCreated: 0.3,
  CardMoved: 0.28,
  SkillTriggered: 0.42,
  AttackDeclared: 0.3,
  DamageApplied: 0.16,
  Healed: 0.22,
  StatChanged: 0.18,
  PlayerHpChanged: 0.2,
  CardDied: 0.32,
  SlotCompacted: 0.12,
  CooldownChanged: 0.1,
  TurnEnded: 0.24,
  BattleEnded: 0.2,
};

/** 没有专门配时长的事件。 */
export const DEFAULT_BEAT = 0.12;

/** 一次行动演完之后的收尾停顿，让玩家看清最终局面再放开输入。 */
export const SETTLE_BEAT = 0.18;

/**
 * 离场代理在画面上多留的时间。
 *
 * 它不是靠代理自己的动画回调来回收的——那正是 PLAN 第 4.1 节禁止的做法。
 * 导演在 `CardDied` 之后接一个这么长的普通 `wait` beat，跳过与取消都能正确收掉它。
 */
export const PROXY_EXIT_SECONDS = 0.45;

/** 数值徽标高亮的持续时间（受击/增益那一下的白圈）。 */
export const EMPHASIS_SECONDS = 0.35;

/** AI「思考」的停顿。它属于演出，不参与规则——所以跳过档会把它一起跳掉。 */
export const AI_THINK_SECONDS = 0.55;

/** 命中点的高度：桌面是 y=0，弹体的落点贴在台呢上。 */
export const IMPACT_Y = 0.08;

/** 施法起点的高度：从卡面上方一点发出，轨迹才有高度差。 */
export const CAST_Y = 0.55;

/** 起点朝施法者自己那一侧偏出的距离，让弹体看得出是「从这张卡出发」。 */
export const CAST_OFFSET = 0.38;

/** 本体血量的锚点高度与离桌心的距离。 */
export const PLAYER_ANCHOR_Y = 0.9;
export const PLAYER_ANCHOR_Z = 6.1;
