import type { CardInstance } from '../cards/types';
import type { BattleEventPayload, BattleState } from './types';

/** Fresh base stats and marks on leaving combat/retrieval; returning originals detach from dead clones. */
export function resetCardLife(state: BattleState, card: CardInstance,
  emit?: (event: BattleEventPayload) => void, preserveRevivalUse = false): void {
  const definition = state.definitions[card.definitionId];
  if (!definition) return;
  let group = state.groups[card.stateGroupId];
  if (!group) return;
  if (group.memberIds.length > 1) {
    const oldIndex = group.memberIds.indexOf(card.instanceId);
    if (oldIndex >= 0) group.memberIds.splice(oldIndex, 1);
    const groupId = `${card.instanceId}-life-${state.turnIndex}-${state.nextEventSeq}`;
    card.stateGroupId = groupId;
    group = { groupId, owner: card.owner, hp: definition.hp, maxHp: definition.hp,
      atk: definition.atk, memberIds: [card.instanceId], deathHandled: false };
    state.groups[groupId] = group;
  }
  group.hp = definition.hp;
  group.maxHp = definition.hp;
  group.atk = definition.atk;
  group.deathHandled = false;
  delete group.berserkBaseAtk;
  delete group.berserkBonus;
  delete group.unyielding;
  const revivedUsed = preserveRevivalUse && card.marks.revivedUsed;
  const marks = card.marks as unknown as Record<string, unknown>;
  for (const key of Object.keys(marks)) delete marks[key];
  Object.assign(card.marks, { undyingUsed: false, revivedUsed,
    skillImmune: definition.rawTraits.includes('免疫'), silenced: false, concealmentUsed: false });
  card.cd = definition.cd;
  card.flying = definition.rawTraits.includes('飞行');
  card.hasAttackedThisTurn = false;
  emit?.({ type: 'CardReset', side: card.owner, instanceId: card.instanceId, groupId: card.stateGroupId,
    atk: group.atk, hp: group.hp, maxHp: group.maxHp, cd: card.cd, flying: card.flying });
}
