// Optional art metadata leaves the legacy 15/17-field enemy tuples unchanged.
// Only names in each recipient's installed battleback folders can be selected.
import { resolveImage } from '../data/assets.js';

function battlebacks(value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  for (let i = 0; i < 2; i++) {
    const name = value[i];
    if (typeof name !== 'string' || name.length > 128 || name.includes('..') || /[\\/:?#%\u0000-\u001f\u007f]/.test(name)) return null;
    if (name && !resolveImage(`Graphics/Battlebacks${i + 1}`, name)) return null;
  }
  return value.slice();
}

export function packEnemyArt(enemies) {
  const entries = [];
  for (const enemy of enemies) {
    if (!Number.isSafeInteger(enemy.netId) || enemy.netId < 1) continue;
    const names = battlebacks(enemy.battlebacks);
    if (names) entries.push([enemy.netId, names]);
  }
  return Object.fromEntries(entries);
}

export function readEnemyArt(snapshot, id) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
    || !Object.prototype.hasOwnProperty.call(snapshot, id)) return null;
  return battlebacks(snapshot[id]);
}
