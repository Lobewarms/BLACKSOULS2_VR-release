// Database loading ($data_* equivalents) from Data/*.rvdata2
import { loadMarshal } from './marshal.js';
import { fetchBinary, resolve } from './assets.js';

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
export async function loadMap(mapId) {
  if (mapCache.has(mapId)) return mapCache.get(mapId);
  const map = await loadRvdata(`Map${String(mapId).padStart(3, '0')}`);
  mapCache.set(mapId, map);
  if (mapCache.size > 6) mapCache.delete(mapCache.keys().next().value);
  return map;
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
