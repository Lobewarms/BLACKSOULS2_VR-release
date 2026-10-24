// Optional resource metadata keeps legacy 15/17-field enemy tuples intact.
export function packEnemyMp(enemies) {
  return Object.fromEntries(enemies.filter(e => Number.isInteger(e.b.mp) && e.b.mp >= 0 && e.b.mp <= 1e8)
    .map(e => [e.netId, e.b.mp]));
}

export function readEnemyMp(snapshot, id) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
    || !Object.prototype.hasOwnProperty.call(snapshot, id)) return null;
  const mp = snapshot[id];
  return Number.isInteger(mp) && mp >= 0 && mp <= 1e8 ? mp : null;
}
