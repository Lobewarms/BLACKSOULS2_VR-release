import { loadMapNames, destinationName } from '../data/data.js';

// The stored map label may be an untranslated editor name from an older version.
// Resolve it from the stable map ID using the player's installed game instead.
export async function prepareSaveLocations(slots) {
  await loadMapNames(slots.map(slot => slot.meta?.mapId).filter(id => Number.isInteger(id) && id > 0));
}

export function saveLocation(meta) {
  return Number.isInteger(meta?.mapId) && meta.mapId > 0 ? destinationName(meta.mapId) : meta?.map || '';
}

// Imported original saves use RPG::Map data rather than mod-save metadata.
// Keep their original contents intact; only attach a translated presentation label.
export async function prepareOriginalSaveLocations(entries) {
  const mapId = entry => entry.contents?.get('map')?.map_id;
  await loadMapNames(entries.map(mapId).filter(id => Number.isInteger(id) && id > 0));
  return entries.map(entry => entry.contents ? { ...entry, map: destinationName(mapId(entry)) } : entry);
}
