import type { CardDefinition } from '../cards/types';
import type { SkillSpec } from './types';

/** User-defined changes belong to the 3D game; preserve the imported legacy snapshot. */
export function withModernTraits(original: CardDefinition): CardDefinition {
  let card = original;
  if (card.cardId === 'A+_002' && !card.rawTraits.includes('炮击1')) {
    card = { ...card, rawTraits: [...card.rawTraits, '炮击1'], skills: [...card.skills,
      { raw: '炮击1', resolution: 'implemented', family: 'bombard', param: 1, matchKind: 'full' }] };
  }
  if (card.cardId === 'SSS_008') {
    card = { ...card, rawTraits: ['自毁'], skills: [
      { raw: '自毁', resolution: 'implemented', family: 'selfDestruct', param: null, matchKind: 'exact' }] };
  }
  if (card.cardId === 'S_013') {
    card = { ...card,
      rawTraits: card.rawTraits.map((raw) => raw === '贯穿' ? '贯穿5' : raw),
      skills: card.skills.map((skill) => skill.raw === '贯穿' ? { ...skill, raw: '贯穿5' } : skill),
    };
  }
  const skills = card.skills.map((skill): SkillSpec => {
    let family: string | null = null;
    let param: number | null = null;
    if (/^溅射(?:\d+)?$/.test(skill.raw)) family = 'splash';
    else if (skill.raw === '隐匿') family = 'concealment';
    else if (skill.raw === '先攻') family = 'firstStrike';
    else if (skill.raw === '吞噬') family = 'devour';
    else if (skill.raw === '至高之作') family = 'masterpiece';
    else if (skill.raw === '先锋') family = 'vanguard';
    else if (skill.raw === '对空') family = 'antiAir';
    else if (skill.raw === '群体禁飞') family = 'groupGround';
    else if (skill.raw === '攻城') family = 'siege';
    else if (/^狂暴(?:\d+)?$/.test(skill.raw)) family = 'berserk';
    else if (skill.raw === '远射') family = 'ranged';
    else if (skill.raw === '法术反弹') family = 'spellReflect';
    else if (/^斩杀(?:\d+)?$/.test(skill.raw)) family = 'execute';
    else if (/^传送(?:\d+)?$/.test(skill.raw)) family = 'teleport';
    else if (skill.raw === '临点坍缩') family = 'criticalCollapse';
    else if (skill.raw === '不屈') family = 'unyielding';
    else {
      const match = /^(伤害|群体伤害|即死|闪避赋予|贯穿|斩击|群体斩击|剑舞|群体剑舞|献祭|群体贯穿|群体延迟|严霜|燃烧|剧毒|流血|重伤|毒雾|必杀)(\d+)$/.exec(skill.raw);
      if (match) {
        family = ({ 伤害: 'directDamage', 群体伤害: 'groupPhysicalDamage', 即死: 'instantDeath', 闪避赋予: 'grantDodge', 贯穿: 'piercing', 斩击: 'slash', 群体斩击: 'groupSlash', 剑舞: 'swordDance', 群体剑舞: 'groupSwordDance', 献祭: 'sacrifice', 群体贯穿: 'groupPiercing', 群体延迟: 'groupDelay', 严霜: 'severeFrost', 燃烧: 'burning', 剧毒: 'venom', 流血: 'bleeding', 重伤: 'grievousWound', 毒雾: 'poisonCloud', 必杀: 'lethalStrike' } as Record<string, string>)[match[1]!] ?? null;
        param = Number(match[2]);
      } else {
        const groupSlash = /^群体斩(\d+)击$/.exec(skill.raw);
        if (groupSlash) { family = 'groupSlash'; param = Number(groupSlash[1]); }
        const death = /^(?:死亡爆裂|爆裂)(\d+)?$/.exec(skill.raw);
        if (death) { family = 'explodeOnDeath'; param = death[1] ? Number(death[1]) : 2; }
      }
    }
    if (!family) return skill;
    return { raw: skill.raw, family, param, resolution: 'implemented', matchKind: param === null ? 'exact' : 'full',
      evidence: '3D 用户指定机制；docs/TRAIT_EXPANSION.md', note: '已在 3D 战斗管线实现。' };
  });
  return skills.every((skill, index) => skill === card.skills[index]) ? card : { ...card, skills };
}
