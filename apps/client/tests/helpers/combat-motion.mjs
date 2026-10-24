import { DeskSwing } from '../../src/combat/deskswing.js';
import { WeaponLag } from '../../src/combat/weaponlag.js';

// Prototype fixtures bypass CombatSystem's renderer-owning constructor. Keep
// its real motion components and neutral initial equipment pace in those tests.
export function combatMotion() {
  return { deskSwing: new DeskSwing(), weaponLag: new WeaponLag(), weaponPace: 1, enemies: [] };
}
