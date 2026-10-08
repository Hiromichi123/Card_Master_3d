/** These casts require enemy battlefield cards, unlike piercing/ranged/siege base attacks. */
export const ENEMY_CARD_ATTACK_FAMILIES = new Set([
  'fireball', 'iceSeal', 'lightning', 'groupFireball', 'groupIceSeal', 'groupLightning',
  'bombard', 'groupBombard', 'poisonCloud', 'instantDeath', 'directDamage', 'groupPhysicalDamage',
  'slash', 'groupSlash', 'swordDance', 'groupSwordDance', 'execute', 'lethalStrike',
  'curse', 'armorBreak', 'explodeOnDeath', 'alignedDeathBlast',
]);
