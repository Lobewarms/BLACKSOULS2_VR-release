// Action calculations can borrow gear without trading items or changing the
// actor's serializable equipment. Nested scopes always restore the caller.
const overlays = new WeakMap();

export const actorEquipment = actor => overlays.get(actor) || actor.equips;

export function withActorEquipment(actor, equips, run) {
  if (!actor) return run();
  const previous = overlays.get(actor);
  if (equips) overlays.set(actor, equips); else overlays.delete(actor);
  try { return run(); }
  finally { if (previous) overlays.set(actor, previous); else overlays.delete(actor); }
}
