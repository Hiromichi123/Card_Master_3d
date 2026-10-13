import type { BattleEvent } from '../../domain/battle/types';
import type { EffectTemplateId } from '../effects/familyMap';
import type { SoundCue } from '../../services/audio/cues';

const TEMPLATE_SOUND: Partial<Record<EffectTemplateId, SoundCue>> = {
  normalAttack: 'attack', ranged: 'attack', piercing: 'attack', groupPiercing: 'attack',
  slash: 'slash', groupSlash: 'slash', swordDance: 'slash', groupSwordDance: 'slash',
  fireball: 'fire', groupFireball: 'fire', bombard: 'fire', groupBombard: 'fire', deathBombard: 'fire',
  iceSeal: 'ice', groupIceSeal: 'ice', lightning: 'lightning', groupLightning: 'lightning',
  heal: 'heal', groupHeal: 'heal', shield: 'shield',
};

/** Card movement has no EffectPlayRequest, so it is mapped independently of skills. */
export function cardSoundFor(event: BattleEvent, skipped: boolean): SoundCue | null {
  if (skipped) return null;
  switch (event.type) {
    case 'CardDrawn': return 'deal';
    case 'CardPlayed': return 'play';
    case 'CardDeployed': return 'deploy';
    default: return null;
  }
}

/** One sound per visible cast, never one per affected target or passive stat update. */
export function castSoundFor(event: BattleEvent, template: EffectTemplateId | null, skipped: boolean): SoundCue | null {
  if (skipped || !template) return null;
  if (event.type === 'AttackDeclared') return TEMPLATE_SOUND[template] ?? 'attack';
  if (event.type !== 'SkillTriggered' && event.type !== 'SpellReflected') return null;
  if (event.family === 'teleport') return 'teleport';
  return TEMPLATE_SOUND[template] ?? null;
}
