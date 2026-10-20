import { $data } from '../data/data.js';
import { withActorEquipment } from '../game/actor-equipment.js';

const grants = (weapon, id) => (weapon?.features || []).some(f => f.code === 43 && f.data_id === id);

export function menuOwnedGear(actor, party) {
  const out = [];
  for (const kind of ['weapon', 'armor']) {
    const ids = new Set((actor?.equips || []).filter(e => e.kind === kind && e.id).map(e => e.id));
    for (const [id, count] of (kind === 'weapon' ? party?.weapons : party?.armors) || []) if (count > 0) ids.add(id);
    for (const id of [...ids].sort((a, b) => a - b)) {
      const weapon = (kind === 'weapon' ? $data.weapons : $data.armors)[id];
      if (weapon && (kind === 'weapon' || weapon.etype_id === 1)) out.push({ weapon, kind });
    }
  }
  return out;
}

export function menuSkills(actor, party) {
  const skills = new Map((actor?.allSkills?.() || []).map(skill => [skill.id, skill]));
  for (const { weapon } of menuOwnedGear(actor, party)) for (const feature of weapon.features || []) {
    const skill = feature.code === 43 && $data.skills[feature.data_id];
    if (skill?.name) skills.set(skill.id, skill);
  }
  return [...skills.values()].sort((a, b) => a.id - b.id);
}

// A quick action must not silently drop a shield, ring or second weapon. Match
// the native equip permissions, including permissions lost with the old weapon.
export function menuWeaponEquipment(actor, weapon, kind) {
  const slot = kind === 'weapon' ? 0 : 1;
  if (!actor?.equipChangeOk?.(slot) || !actor.canEquipItem(kind, weapon)) return null;
  const equips = actor.equips.map(e => ({ ...e }));
  equips[slot] = { kind, id: weapon.id };
  const compatible = withActorEquipment(actor, equips, () => equips.every((entry, slot) => {
    if (!entry.id) return true;
    const item = entry.kind === 'weapon' ? $data.weapons[entry.id] : $data.armors[entry.id];
    const type = entry.kind === 'weapon' ? 0 : item?.etype_id;
    return item && actor.equipSlotType(slot) === type && actor.canEquipItem(entry.kind, item);
  }));
  return compatible ? equips : null;
}

export function menuWeaponCandidates(actor, party, source, effective) {
  const known = actor?.allSkills?.().some(skill => skill.id === source?.id);
  const required = [source?.required_wtype_id1, source?.required_wtype_id2,
    effective?.required_wtype_id1, effective?.required_wtype_id2].filter(id => id > 0);
  const candidates = menuOwnedGear(actor, party).filter(({ weapon, kind }) => grants(weapon, source?.id)
    || known && kind === 'weapon' && required.includes(weapon.wtype_id))
    .filter(({ weapon, kind }) => {
      const slot = kind === 'weapon' ? 0 : 1;
      const elsewhere = actor.equips.some((entry, index) => index !== slot && entry.kind === kind && entry.id === weapon.id);
      return !elsewhere || party.itemCount(kind, weapon.id) > 0;
    })
    .map(({ weapon, kind }) => ({ weapon, kind, equips: menuWeaponEquipment(actor, weapon, kind) }));
  const families = new Map();
  for (const candidate of candidates) {
    const name = String(candidate.weapon.name || `#${candidate.weapon.id}`).normalize('NFKC').trim();
    const refinement = /\+\s*(\d+)\s*$/.exec(name);
    const family = candidate.kind + ':' + (refinement ? name.slice(0, refinement.index).trim() : name);
    if (!families.has(family)) families.set(family, []);
    families.get(family).push({ candidate, refinement: refinement ? Number(refinement[1]) || 0 : 0 });
  }
  return [...families.values()].flatMap(family => family.sort((a, b) => b.refinement - a.refinement
    || a.candidate.weapon.id - b.candidate.weapon.id).map(entry => entry.candidate));
}
