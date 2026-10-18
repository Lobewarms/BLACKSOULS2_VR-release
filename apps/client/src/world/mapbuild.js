// A map's 3D view from its data and the map hints (maphints.js) - the game's (main.js presentMap) and the map editor's
// (mapedit.html) are built the same way here, so what the editor shows is what the game builds.
import { buildMapMesh } from './mapmesh.js';
import { analyzeMap, reachableCells } from './mapanalysis.js';
import { doorPictureHeight } from '../entities/sprites.js';
import * as H from './maphints.js';
import { loadMapNames, destinationName } from '../data/data.js';

// what the map hints tell buildMapMesh for a map
export function meshHintOptions(mapId) {
  return {
    floorHints: H.floorHints(mapId), lips: H.lipHints(mapId), abyss: H.abyssHints(mapId), sideView: H.isSideView(mapId),
    flatPictures: H.flatPictures(mapId), terraces: H.terraceHints(mapId), props: H.propHints(mapId), whole: H.wholeHints(mapId),
    cabinets: H.cabinetHints(mapId), parallaxWalls: H.parallaxWalls(mapId), caps: H.capHints(mapId), tops: H.topHints(mapId),
    solids: H.solidHints(mapId), wallFloors: H.wallFloorHints(mapId), mounds: H.moundHints(mapId), overlaps: H.overlapHints(mapId),
    massBackdrop: H.massBackdrop(mapId), openSky: H.openSky(mapId), wallCap: H.wallCap(mapId), doorTops: H.doorTops(mapId),
    highGround: H.highGround(mapId),
  };
}

// A tile an event lays "below characters" on its page is part of the map there - Game_Map#all_tiles counts it, before the map's
// own: a bridge a lever lays over a gap, a path that comes out of the ground (하얀 성시 １, 홍성 프릿셀 １, 크리미아 간호 묘지 １...).
// Where it lets one by a cell the map's own tiles shut, the 3D view builds that cell as floor - the event lies on it as its tile
// (sprites.js) - and is built again as the event's page changes (gamemap.js openingTile). One that shuts the way already stands as
// its own picture there (sprites.js: a statue put together from such events). pageOf: the page each event is on (the game's);
// without it, the last page that asks for nothing (the map editor)
export function openingTiles(grid, events, pageOf = null) {
  const out = new Map();
  const bare = p => { const c = p.condition || {}; return !c.switch1_valid && !c.switch2_valid && !c.variable_valid && !c.self_switch_valid && !c.item_valid && !c.actor_valid; };
  for (const ev of events || []) {
    const p = pageOf ? pageOf(ev) : [...(ev.pages || [])].reverse().find(bare);
    const t = p?.graphic?.tile_id;
    if (!(t > 0) || p.priority_type !== 0 || p.through || !grid.valid(ev.x, ev.y) || grid.anyPassable(ev.x, ev.y)) continue;
    if (![2, 4, 6, 8].some(d => grid.passable(ev.x, ev.y, d, [t]))) continue;
    const i = ev.x + ev.y * grid.w;
    out.set(i, [...(out.get(i) || []), t]);
  }
  return out;
}
export function withEventTiles(grid, events, pageOf = null) {
  const lay = openingTiles(grid, events, pageOf);
  if (!lay.size) return grid;
  return Object.assign(Object.create(grid), { passage: (x, y, bit, extra) => grid.passage(x, y, bit, lay.has(x + y * grid.w) ? lay.get(x + y * grid.w).concat(extra || []) : extra) });
}

// the grid the 3D view is built from: the map's own, with open cells (the dark round a boss fight opened - arena.js) passable,
// the upper-layer pieces the view leaves out (maphints hideArt) taken off, and the gaps invisible events plug stopped up
export function viewGrid(grid, mapId, events, open = null) {
  // (open cells: passable for the mesh only - the game's own passability takes them through G.arena.opens)
  let meshGrid = open?.size ? Object.assign(Object.create(grid), { passage: (x, y, bit, extra) => open.has(x + y * grid.w) || grid.passage(x, y, bit, extra) }) : grid;
  // (upper-layer pieces the 3D view leaves out - maphints hideArt; passing over them stays as in the original)
  const hide = new Set();
  for (const [x0, y0, x1, y1, ids] of H.hideArtHints(mapId) || []) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (grid.valid(x, y) && ids.includes(grid.tile(x, y, 2))) hide.add(x + y * grid.w);
  }
  if (hide.size) {
    const under = meshGrid;
    meshGrid = Object.assign(Object.create(under), {
      tile: (x, y, z) => (z === 2 && hide.has(x + y * grid.w) ? 0 : under.tile(x, y, z)),
      passage: (x, y, bit, extra) => under.passage(x, y, bit, extra),
    });
  }
  // (an invisible event the map sets in a gap between two walls - one page, no condition, no command, nothing drawn,
  // stopping the player - is that wall in the 3D view too: in 2D the gap is a roof's edge drawn over walkable tiles,
  // and the 3D view showed an open alley with an invisible wall across it - 루트위지 시가지 x38)
  const plug = new Set();
  for (const ev of events || []) {
    const pages = ev?.pages || [];
    if (pages.length !== 1) continue;
    const p = pages[0], c = p.condition || {};
    if (c.switch1_valid || c.switch2_valid || c.variable_valid || c.self_switch_valid || c.item_valid || c.actor_valid) continue;
    if (p.priority_type !== 1 || p.through || p.graphic?.character_name || p.graphic?.tile_id || (p.list || []).some(cmd => cmd.code !== 0)) continue;
    const x = ev.x, y = ev.y;
    const shut = (dx, dy) => grid.valid(x + dx, y + dy) && !grid.anyPassable(x + dx, y + dy);
    const drawn = grid.tile(x, y, 2) > 0 || grid.tile(x, y, 1) >= 4352;     // (something drawn there: not open ground)
    if (drawn && ((shut(0, -1) && shut(0, 1)) || (shut(-1, 0) && shut(1, 0)))) plug.add(x + y * grid.w);
  }
  if (plug.size) {
    const under = meshGrid;
    meshGrid = Object.assign(Object.create(under), { passage: (x, y, bit, extra) => !plug.has(x + y * grid.w) && under.passage(x, y, bit, extra) });
  }
  return meshGrid;
}

// map: the RPG::Map, grid its MapGrid, events the RPG::Events (all of them), pageOf the page each one is on (fall zones, doors
// and exits come from them - the game passes the pages they are on now), seeds where the player arrives (the cells walkable
// from there decide which wall tops are solid), extra more buildMapMesh options (analysisOnly)
// -> { mesh, ana, walk }
export async function buildMapView({ map, grid, mapId, events, pageOf, seeds = [], open = null, extra = {} }) {
  // (with the tiles events lay where they open the way - openingTiles)
  const laid = withEventTiles(grid, events, pageOf);
  const meshGrid = viewGrid(laid, mapId, events, open);
  map.__id = mapId;
  const ana = pageOf ? analyzeMap(map, grid, pageOf) : analyzeMap(map, grid);
  await loadMapNames(ana.exits.filter(e => e.mapId !== mapId).map(e => e.mapId));
  for (const exit of ana.exits) if (exit.mapId > 0 && exit.mapId !== mapId) exit.label = destinationName(exit.mapId);
  const walk = seeds.length ? reachableCells(map, laid, ana, [...seeds, ...H.walkedTo(mapId)]) : null;
  // how tall each door picture stands: a doorway with a door opens up to its top (the wall goes on above it)
  const doorH = new Map();
  await Promise.all([...ana.doorPics].map(async ([i, d]) => doorH.set(i, await doorPictureHeight(d.name, d.index).catch(() => 0))));
  const mesh = await buildMapMesh(meshGrid, {
    pits: ana.pits, gaps: ana.gaps, isDoorCell: (x, y) => ana.doors.has(x + y * grid.w), falls: ana.falls, reach: walk?.reach,
    doorHeight: (x, y) => doorH.get(x + y * grid.w) || 0, ...meshHintOptions(mapId), ...extra,
  });
  return { mesh, ana, walk };
}
