import { $data } from '../data/data.js';
import { actorEquipment, withActorEquipment } from '../game/actor-equipment.js';

const grants = (weapon, id) => (weapon?.features || []).some(f => f.code === 43 && f.data_id === id);
const previews = new WeakMap();

function previewFor(actor, party) {
  const preview = actor && previews.get(actor);
  return preview && preview.equips === actorEquipment(actor) && (party === undefined || preview.party === party) ? preview : null;
}

// Only synchronous, read-only menu enumeration shares these equipment facts.
// Every refresh gets a new scope. Costs, states, cooldowns and actual casts keep
// their live authority; a borrowed equipment overlay never uses normal grants.
export function withMenuSkillPreview(actor, party, run) {
  if (!actor) return run();
  const previous = previews.get(actor);
  const skills = actor.allSkills();
  const gear = collectOwnedGear(actor, party);
  previews.set(actor, { party, equips: actorEquipment(actor), skills, known: new Set(skills.map(s => s.id)), gear, equipment: new Map() });
  try { return run(); }
  finally { if (previous) previews.set(actor, previous); else previews.delete(actor); }
}

export function menuKnowsSkill(actor, id) {
  const preview = previewFor(actor);
  return preview ? preview.known.has(id) : !!actor?.allSkills?.().some(skill => skill.id === id);
}

export function menuOwnedGear(actor, party) {
  const preview = previewFor(actor, party);
  if (preview) return preview.gear;
  return collectOwnedGear(actor, party);
}

function collectOwnedGear(actor, party) {
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
  const skills = new Map((previewFor(actor, party)?.skills || actor?.allSkills?.() || []).map(skill => [skill.id, skill]));
  for (const { weapon } of menuOwnedGear(actor, party)) for (const feature of weapon.features || []) {
    const skill = feature.code === 43 && $data.skills[feature.data_id];
    if (skill?.name) skills.set(skill.id, skill);
  }
  return [...skills.values()].sort((a, b) => a.id - b.id);
}

// A quick action must not silently drop a shield, ring or second weapon. Match
// the native equip permissions, including permissions lost with the old weapon.
export function menuWeaponEquipment(actor, weapon, kind) {
  const preview = previewFor(actor), key = `${kind}:${weapon.id}`;
  if (preview?.equipment.has(key)) return preview.equipment.get(key);
  const equips = compatibleEquipment(actor, weapon, kind);
  if (preview) preview.equipment.set(key, equips);
  return equips;
}

function compatibleEquipment(actor, weapon, kind) {
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
  const known = menuKnowsSkill(actor, source?.id);
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
