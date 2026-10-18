// Database loading ($data_* equivalents) from Data/*.rvdata2
import { loadMarshal } from './marshal.js';
import { fetchBinary, resolve } from './assets.js';
import { tr } from '../ui/i18n.js';

export const $data = {
  actors: null, classes: null, skills: null, items: null, weapons: null, armors: null,
  enemies: null, troops: null, states: null, animations: null, tilesets: null,
  commonEvents: null, system: null, mapInfos: null,
};

const FILES = {
  actors: 'Actors', classes: 'Classes', skills: 'Skills', items: 'Items', weapons: 'Weapons',
  armors: 'Armors', enemies: 'Enemies', troops: 'Troops', states: 'States',
  tilesets: 'Tilesets', commonEvents: 'CommonEvents', system: 'System', mapInfos: 'MapInfos',
};

export async function loadRvdata(name) {
  const path = resolve('Data', name, ['.rvdata2']);
  if (!path) throw new Error(`Data file not found: ${name}`);
  return loadMarshal(await fetchBinary(path));
}

export async function loadDatabase(onProgress) {
  const keys = Object.keys(FILES);
  let done = 0;
  await Promise.all(keys.map(async k => {
    $data[k] = await loadRvdata(FILES[k]);
    done++;
    onProgress?.(done / keys.length, FILES[k]);
  }));
  // Animations are large; load in background
  loadRvdata('Animations').then(a => { $data.animations = a; }).catch(() => {});
  return $data;
}

const mapCache = new Map();
const mapTitles = new Map();
export async function loadMap(mapId) {
  if (mapCache.has(mapId)) return mapCache.get(mapId);
  const map = await loadRvdata(`Map${String(mapId).padStart(3, '0')}`);
  mapTitles.set(mapId, String(map.display_name || '').trim());
  mapCache.set(mapId, map);
  if (mapCache.size > 6) mapCache.delete(mapCache.keys().next().value);
  return map;
}

// MapInfos contains the developer's editor labels, often untranslated. Destination
// maps contain the player-facing names from the installed language of the game.
export async function loadMapNames(ids) {
  const seen = new Set();
  let pending = [...new Set(ids.filter(id => id > 0))];
  for (let depth = 0; pending.length && depth < 8; depth++) {
    const current = pending.filter(id => !seen.has(id));
    if (!current.length) break;
    current.forEach(id => seen.add(id));
    await Promise.allSettled(current.map(id => mapTitles.has(id) ? null : loadMap(id)));
    pending = [...new Set(current.filter(id => !mapTitles.get(id)).map(id => $data.mapInfos?.get(id)?.parent_id).filter(id => id > 0))];
  }
}

export function destinationName(mapId) {
  let id = mapId;
  const seen = new Set();
  for (let depth = 0; id > 0 && depth < 8 && !seen.has(id); depth++) {
    seen.add(id);
    if (mapTitles.get(id)) return mapTitles.get(id);
    id = $data.mapInfos?.get(id)?.parent_id;
  }
  return tr('지역 {id}', { id: mapId });
}

export function mapName(mapId) {
  const info = $data.mapInfos?.get(mapId);
  if (!info) return `Map${mapId}`;
  const clean = n => String(n || '').replace(/[●\s]+$/g, '').replace(/BOSS/g, '').trim();
  let name = clean(info.name);
  // editor names are often just "１" or "２－１": prefix the nearest descriptive parent
  if (name.length <= 4) {
    let p = $data.mapInfos.get(info.parent_id);
    for (let guard = 0; p && guard < 8; guard++) {
      const pn = clean(p.name);
      if (pn.length > 4) { name = `${pn} ${name}`; break; }
      p = $data.mapInfos.get(p.parent_id);
    }
  }
  return name;
}

// Parse "<tag:value>" style notes
export function noteTag(note, re) {
  const m = (note || '').match(re);
  return m || null;
}
