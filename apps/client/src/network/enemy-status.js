// Optional display metadata; the existing 15-field enemy tuple stays compatible.
export function packEnemyBuffs(enemies) {
  return Object.fromEntries(enemies.filter(e => e.b.buffs?.some(level => level !== 0))
    .map(e => [e.netId, e.b.buffs.slice(0, 8)]));
}

export function readEnemyBuffs(snapshot, id) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const levels = snapshot[id] ?? Array(8).fill(0);
  return Array.isArray(levels) && levels.length === 8 && levels.every(level => Number.isInteger(level) && Math.abs(level) <= 2)
    ? levels.slice() : null;
}
