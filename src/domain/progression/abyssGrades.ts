import type { SkillSpec } from '../skills/types';
import type { AbyssEffect, AbyssGrowthOption } from './abyssTypes';

export const ABYSS_GRADES = ['green', 'blue', 'purple', 'gold', 'red'] as const;
export type AbyssGrade = typeof ABYSS_GRADES[number];
export const ABYSS_GRADE_INFO: Readonly<Record<AbyssGrade, { name: string; color: string; weight: number }>> = {
  green: { name: '绿色 · 基础', color: '#83d99b', weight: 80 },
  blue: { name: '蓝色 · 进阶', color: '#7fb9f5', weight: 55 },
  purple: { name: '紫色 · 高阶', color: '#bc94f3', weight: 27 },
  gold: { name: '金色 · 史诗', color: '#efc66d', weight: 10 },
  red: { name: '红色 · 极致', color: '#f17b83', weight: 2 },
};
const attackFamilies = new Set(['fireball', 'iceSeal', 'lightning', 'slash', 'bombard', 'piercing', 'directDamage', 'poisonCloud']);
const peakFamilies = new Set(['immunity', 'spellReflect', 'unyielding', 'execute', 'instantDeath', 'swordDance', 'groupSwordDance', 'copy', 'undying']);
function at(index: number): AbyssGrade { return ABYSS_GRADES[Math.max(0, Math.min(4, index))]!; }

export function abyssStatGrade(stat: 'atk' | 'hp' | 'cd', amount: number): AbyssGrade {
  return at(Math.max(1, Math.abs(amount)) - 1 + (stat === 'atk' ? 1 : 0));
}
export function abyssTraitGrade(trait: SkillSpec): AbyssGrade {
  const family = trait.family ?? '';
  const level = Math.max(1, trait.param ?? 1);
  if (peakFamilies.has(family)) return 'red';
  if (family.startsWith('group') || family === 'explodeOnDeath') return at(level + 2);
  if (attackFamilies.has(family)) return at(level);
  return at(level + 1);
}
export function abyssTraitDiscoveryId(trait: SkillSpec): string {
  return `trait:${trait.family}:${trait.param ?? 0}`;
}
export function abyssEffectLevel(effect: AbyssEffect): number {
  return Math.max(1, Math.abs(effect.modifier.atk), Math.abs(effect.modifier.hp), Math.abs(effect.modifier.cd),
    ...effect.modifier.traits.map(trait => trait.param ?? 1));
}
export function abyssEffectGrade(effect: AbyssEffect): AbyssGrade {
  const { atk, hp, cd, traits } = effect.modifier;
  const grades: AbyssGrade[] = [
    ...(atk ? [abyssStatGrade('atk', atk)] : []),
    ...(hp ? [abyssStatGrade('hp', hp)] : []),
    ...(cd ? [abyssStatGrade('cd', cd)] : []), ...traits.map(abyssTraitGrade),
  ];
  return at(Math.max(0, ...grades.map(grade => ABYSS_GRADES.indexOf(grade))));
}
/** Defaults preserve stored offers from before numbered attribute rewards. */
export function abyssGrowthAmount(option: AbyssGrowthOption): number {
  return option.kind === 'atk' || option.kind === 'hp' || option.kind === 'cd'
    ? option.amount ?? (option.kind === 'hp' ? 2 : 1) : 0;
}
export function abyssGrowthGrade(option: AbyssGrowthOption): AbyssGrade {
  if (option.kind === 'trait') return abyssTraitGrade(option.trait);
  if (option.kind === 'atk' || option.kind === 'hp' || option.kind === 'cd') return abyssStatGrade(option.kind, abyssGrowthAmount(option));
  return option.kind === 'remove' || option.kind === 'crystal' ? 'purple' : 'blue';
}
