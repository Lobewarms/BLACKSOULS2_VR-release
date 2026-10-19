// Transient extra-action rolls. Nothing here is written into a save or battler.
export class BonusActions {
  constructor({ duration = 3, random = Math.random } = {}) {
    this.duration = duration;
    this.random = random;
    this.epoch = 0;
    this.clear();
  }
  clear() {
    this.owner = null;
    this.icons = [];
    this.remaining = 0;
    this.hadSources = false;
    this.epoch++;
  }
  sources(actor) {
    const objects = actor?.featureObjects?.();
    const rows = Array.isArray(objects)
      ? objects.flatMap(object => (object?.features || []).filter(feature => feature.code === 61)
        .map(feature => ({ value: feature.value, icon: object.icon_index })))
      : (actor?.featuresWith?.(61) || []).map(feature => ({ value: feature.value, icon: 0 }));
    return rows.filter(row => Number.isFinite(row.value) && row.value > 0)
      .map(row => ({ chance: Math.min(1, row.value), icon: Number.isSafeInteger(row.icon) && row.icon > 0 ? row.icon : 0 }));
  }
  sync(context) {
    const { actor, map, state } = context || {};
    if (!actor || !map || !state) { this.clear(); return false; }
    const owner = this.owner;
    if (!owner || owner.actor !== actor || owner.actorId !== actor.id || owner.map !== map || owner.mapId !== map.mapId || owner.state !== state) {
      this.clear();
      this.owner = { actor, actorId: actor.id, map, mapId: map.mapId, state };
    }
    const hasSources = this.sources(actor).length > 0;
    if (!hasSources && this.hadSources) {
      this.icons = []; this.remaining = 0; this.epoch++;
    }
    this.hadSources = hasSources;
    return true;
  }
  status(context) {
    if (!this.sync(context) || !this.icons.length || this.remaining <= 0) return null;
    return { count: this.icons.length, remaining: this.remaining, duration: this.duration, icon: this.icons[0] };
  }
  available(context) { return !!this.status(context); }
  begin(context, { eligible = true } = {}) {
    if (!this.sync(context) || !eligible) return null;
    const sources = this.sources(context.actor);
    const bonus = this.icons.length > 0 && this.remaining > 0;
    if (bonus) {
      this.icons.shift();
      if (!this.icons.length) this.remaining = 0;
    }
    return { owner: this.owner, epoch: this.epoch, bonus, sources, completed: false };
  }
  complete(ticket, context, { eligible = true } = {}) {
    if (!ticket || ticket.completed) return 0;
    ticket.completed = true;
    if (!this.sync(context) || ticket.owner !== this.owner || ticket.epoch !== this.epoch || ticket.bonus || !eligible || !this.hadSources) return 0;
    const icons = ticket.sources.filter(source => source.chance >= 1 || this.random() < source.chance).map(source => source.icon);
    if (!icons.length) return 0;
    this.icons.push(...icons);
    this.remaining = this.duration;
    return icons.length;
  }
  update(dt, context, { paused = false, clear = false } = {}) {
    if (clear) { this.clear(); return; }
    if (!this.sync(context) || paused || !this.icons.length || !Number.isFinite(dt) || dt <= 0) return;
    this.remaining = Math.max(0, this.remaining - dt);
    if (this.remaining === 0) this.icons = [];
  }
}
