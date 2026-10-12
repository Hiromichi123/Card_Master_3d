import type { CardDefinition, SideId } from '../../cards/types';
import type { BattleState, Command } from '../types';

export const AI_VERSION = '1.0' as const;
export type AiDifficulty = 'easy' | 'normal' | 'hard' | 'boss';
export type AiStyle = 'balanced' | 'aggressive' | 'defensive' | 'control';
export type AiPolicy = 'baseline' | 'heuristic' | 'hybrid';
export interface AiSettings { readonly difficulty: AiDifficulty; readonly style: AiStyle; readonly policy: AiPolicy }
export const DEFAULT_AI: AiSettings = { difficulty: 'normal', style: 'balanced', policy: 'heuristic' };
export const AI_DIFFICULTIES: readonly AiDifficulty[] = ['easy','normal','hard','boss'];
export const AI_STYLES: readonly AiStyle[] = ['balanced','aggressive','defensive','control'];
export const AI_POLICIES: readonly AiPolicy[] = ['baseline','heuristic','hybrid'];
export const AI_DIFFICULTY_LABELS: Record<AiDifficulty,string> = {easy:'简单',normal:'普通',hard:'困难',boss:'Boss'};
export const AI_STYLE_LABELS: Record<AiStyle,string> = {balanced:'均衡',aggressive:'进攻',defensive:'防守',control:'控制'};
export const AI_POLICY_LABELS: Record<AiPolicy,string> = {baseline:'旧版基础',heuristic:'规则推演',hybrid:'学习＋推演'};
export function normalizeAiSettings(value: Partial<AiSettings> = {}): AiSettings {
  return {
    difficulty: AI_DIFFICULTIES.includes(value.difficulty!) ? value.difficulty! : DEFAULT_AI.difficulty,
    style: AI_STYLES.includes(value.style!) ? value.style! : DEFAULT_AI.style,
    policy: AI_POLICIES.includes(value.policy!) ? value.policy! : DEFAULT_AI.policy,
  };
}
export interface AiObservation {
  readonly version: typeof AI_VERSION;
  readonly side: SideId;
  /** Contains public/own visible instances only. No real seed, RNG, deck IDs, or hidden opponent hand. */
  readonly visible: BattleState;
  readonly counts: Record<SideId,{readonly deck:number;readonly hiddenHand:number}>;
  readonly ownReserve: readonly CardDefinition[];
  /** Public card catalogue, supplied independently of the secret enemy roster. */
  readonly catalogue: readonly CardDefinition[];
}
export interface AiModel {
  readonly format: 'card-master-ai'; readonly version: 1; readonly name: string;
  readonly featureNames: readonly string[];
  readonly kind: 'linear' | 'mlp';
  readonly weights?: readonly number[];
  readonly hidden?: readonly (readonly number[])[];
  readonly hiddenBias?: readonly number[];
  readonly output?: readonly number[];
  readonly outputBias?: number;
}
export interface AiScoredAction { readonly command:Command; readonly key:string; readonly features:readonly number[]; readonly score:number }
export interface AiDecision {
  readonly version: typeof AI_VERSION; readonly command:Command; readonly side:SideId;
  readonly options:AiSettings; readonly phase:BattleState['phase']; readonly turn:number;
  readonly candidates:readonly AiScoredAction[]; readonly selectedKey:string;
  readonly transitions:number; readonly samples:number; readonly model:string|null;
  readonly reason:string;
}
export interface AiRequest {
  readonly observation:AiObservation; readonly options:AiSettings; readonly seed:number;
  readonly model?: AiModel | null;
}
export interface AiBudget { readonly width:number; readonly samples:number; readonly turns:number; readonly steps:number; readonly transitions:number; readonly branches:number; readonly exploration:number }
export const AI_BUDGETS: Record<AiDifficulty,AiBudget> = {
  easy:{width:6,samples:1,turns:1,steps:12,transitions:120,branches:1,exploration:.2},
  normal:{width:10,samples:2,turns:2,steps:22,transitions:640,branches:1,exploration:.025},
  hard:{width:12,samples:3,turns:2,steps:26,transitions:1900,branches:2,exploration:0},
  boss:{width:16,samples:3,turns:2,steps:32,transitions:3200,branches:2,exploration:0},
};
