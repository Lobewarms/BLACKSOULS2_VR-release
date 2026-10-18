import { loadMapNames, destinationName } from '../data/data.js';

// The stored map label may be an untranslated editor name from an older version.
// Resolve it from the stable map ID using the player's installed game instead.
export async function prepareSaveLocations(slots) {
  await loadMapNames(slots.map(slot => slot.meta?.mapId).filter(id => Number.isInteger(id) && id > 0));
}

export function saveLocation(meta) {
  return Number.isInteger(meta?.mapId) && meta.mapId > 0 ? destinationName(meta.mapId) : meta?.map || '';
}
