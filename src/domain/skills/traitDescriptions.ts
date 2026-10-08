import type { SkillSpec } from './types';
import { lethalStrikeChance } from './tacticalTraits';

/** Functional summaries shared by card hover surfaces; imported flavour text remains separate. */
export function describeTraitFunction(skill: SkillSpec): string {
  const n = skill.param ?? (['explodeOnDeath', 'alignedDeathBlast'].includes(skill.family ?? '') ? 2 : 1);
  if (skill.family === 'immunity') return '目前保留卡面与状态标记，技能伤害免疫尚未接入。';
  if (skill.raw === '飞行') return '规避无对空的地面普攻；该普攻穿过自己命中本体。';
  const text: Record<string, string> = {
    fireball: `随机敌方受到 ${n} 点技能伤害。`, iceSeal: `随机敌方受到 ${n} 点技能伤害。`,
    lightning: `随机敌方受到 ${n} 点技能伤害。`, bombard: `随机敌方受到 ${n} 点技能伤害。`,
    groupFireball: `敌方全体各受到 ${n} 点技能伤害。`, groupIceSeal: `敌方全体各受到 ${n} 点技能伤害。`,
    groupLightning: `敌方全体各受到 ${n} 点技能伤害。`, groupBombard: `敌方全体各受到 ${n} 点技能伤害。`,
    slash: `对位受到 ${n} 点技能伤害。`, groupSlash: `敌方全体各受到 ${n} 点技能伤害。`,
    swordDance: `对位直接扣除 ${n} HP，无视飞行、防御、闪避等机制。`,
    groupSwordDance: `敌方全体各直接扣除 ${n} HP，无视飞行、防御、闪避等机制。`,
    directDamage: `随机敌方受到一次 ${n} 点普通攻击。`, groupPhysicalDamage: `敌方全体各受到一次 ${n} 点普通攻击。`,
    piercing: `独立对敌方本体造成 ${n} 点伤害。`, groupPiercing: `五路各直击本体 ${n} 点，合计最多 ${n * 5} 点。`,
    ranged: '普攻越过对位，直接射击敌方本体。', siege: '普攻直接攻击敌方本体。',
    instantDeath: '随机敌方 HP 清零，进入死亡处理。', execute: '攻击前，对位 HP 低于自身 HP 时直接击杀。',
    lethalStrike: `攻击前以 ${Math.round(lethalStrikeChance(n) * 10000) / 100}% 概率直接击杀对位。`,
    selfDestruct: '上场立即施放技能并完成一次有效攻击，随后自毁离场。',
    alignedDeathBlast: `死亡离场时对位受到 ${n} 点炮击；对位为空跳过。`,
    foxSpiritSummon: '上场在空位召唤火焰狐灵（HP 3、火球2），满场跳过。',
    explodeOnDeath: `死亡时对敌方全体各炮击 ${n} 点；无敌方卡牌则跳过。`,
    concealment: '每次上场规避第一次命中自己的普通攻击。', firstStrike: '优先行动；多个先攻仍按原槽位顺序。',
    devour: '攻击前清空敌方弃牌堆。', masterpiece: '上场在空位召唤一张蒸汽艺术；无空位跳过。',
    vanguard: '在场且 HP > 0 时优先替队友承受可命中的普通攻击。',
    antiAir: '普通攻击可以命中飞行单位。', groupGround: '在场时压制敌方全体飞行；光环消失后恢复。',
    berserk: '损失的 HP 转化为 ATK；回血后加攻同步回落。',
    criticalCollapse: '普攻击中对位时，超出其剩余 HP 的伤害返还给自己。',
    unyielding: '首次 HP 归零后继续行动至下个自身回合结束，随后离场。',
    splash: '普攻命中对位时，其两侧各受 floor(ATK/2) 普攻伤害。',
    groupDelay: `敌方等待区全体 CD +${n}。`,
    severeFrost: `受敌方普攻后赋予严霜；目标下次主动普攻后受 ${n} 技能伤害，持续一回合。`,
    burning: `受敌方普攻后赋予燃烧；目标下次主动普攻后受 ${n} 技能伤害，持续一回合。`,
    venom: `受敌方普攻后赋予剧毒；目标下次主动普攻后受 ${n} 技能伤害，持续一回合。`,
    bleeding: `受敌方普攻后赋予流血；目标下次主动普攻后受 ${n} 技能伤害，持续一回合。`,
    grievousWound: `受敌方普攻后赋予重伤；目标下次主动普攻后 ATK −${n}，到期恢复。`,
    poisonCloud: `随机敌方受 1～${n} 技能伤害，并获得剧毒${n}。`,
    defense: `每次普通攻击减伤 ${n}，可被破甲抵消。`, holyShield: `普攻或技能伤害各减 ${n}；不挡真伤和直接击杀。`,
    armorBreak: `本次普攻抵消对位 ${n} 点防御。`, dodge: '按等级概率闪避普通攻击。',
    grantDodge: `随机友方获得闪避${n}，持续至离场，同类取最高等级。`,
    spellReflect: '立即保护己方，把敌方来袭法术整次反弹回去。',
    sacrifice: `每个自身回合，从其它友方抽取至多 ${n} HP 恢复自己；满血跳过。`,
    teleport: '每个自身回合打乱敌方战斗区顺序，改变对位。',
    healAlly: `随机受伤友方恢复 ${n} HP，不超过上限。`, groupHeal: `全体受伤友方各恢复 ${n} HP。`,
    selfHeal: `自己恢复 ${n} HP，不超过上限。`, vampire: `攻击实际造成伤害后，自己恢复 ${n} HP。`,
    blessing: `随机友方 ATK 与 HP 各增加 ${n}。`, groupBlessing: `全体友方 ATK 与 HP 各增加 ${n}。`,
    inspire: `上场时随机友方 ATK +${n}。`, groupInspire: `上场时全体友方 ATK +${n}。`,
    curse: `对位 ATK −${n}，最低为 0。`, injury: `攻击后自己受到 ${n} 点伤害。`,
    counter: `普攻确实造成自己掉血后，对攻击者造成 ${n} 技能伤害。`,
    silence: '压制当前对位卡的主动和受击技能；对位变化后重新判定。',
    drawCard: `牌堆至少有 ${n} 张时抽 ${n} 张。`, soulReturn: `弃牌至少有 ${n} 张时取回 ${n} 张，状态刷新。`,
    haste: `己方最左等待卡 CD −${n}，最低为 0。`, delay: `敌方最左等待卡 CD +${n}。`,
    clone: '上场在空位生成分身，共享 HP、ATK 和死亡。', copy: '攻击前生成独立复制体，己方每回合最多一次。',
    undying: '死亡后恢复基础状态并返回手牌，可再次上场。', rebirth: '死亡后恢复基础状态并回空等待槽重新冷却，每生命周期一次。',
  };
  if (skill.resolution === 'unimplemented' || skill.resolution === 'ambiguous') return '当前未实现或机制待确认。';
  return text[skill.family ?? ''] ?? (skill.resolution === 'flavor' ? '说明性特性。' : '按卡牌说明生效。');
}
