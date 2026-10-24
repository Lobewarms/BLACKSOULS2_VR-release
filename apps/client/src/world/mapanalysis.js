// Reads a map's events / region notes to find what the 3D builder cannot see from tiles alone:
//  - fall zones (touch events or region common events that make the player plunge) -> pits
//  - jump gaps (region "jump over" events)                                      -> pits
//  - door cells and map exits (Transfer Player)                                  -> doorways / floor markers
import { $data, destinationName } from '../data/data.js';
import { F, isWallType } from './tiles.js';

// common events that only send the player away after dying / items, not real exits
const NOT_EXIT_CE = new Set([3, 11, 186]);

// リージョン通行 (KURE) / リージョンイベントだけ settings from the original scripts
export const SWITCH_PASS = { 1: 53, 2: 55, 3: 242, 39: 121, 45: 884, 56: 931 };
export const PLAYER_BLOCK_REGIONS = [50];
export const EVENT_PASS_REGIONS = [50];

// RPG Maker "falling" animation on the player: through ON (in this or an earlier route), then a
// fast slide of 5+ steps in one direction with the walk animation off / high speed
function fallRoute(route, throughBefore = false) {
  const list = route?.list;
  if (!Array.isArray(list)) return null;
  const codes = list.map(c => c.code);
  const through = throughBefore || codes.includes(37);
  const fast = codes.includes(32) || list.some(c => c.code === 29 && c.parameters[0] >= 5);
  if (!through || !fast) return null;
  let run = 0, best = 0, dir = 0, cur = 0;
  for (const c of codes) {
    if (c >= 1 && c <= 4) { if (c === cur) run++; else { cur = c; run = 1; } if (run > best) { best = run; dir = c; } }
    else if (![29, 30, 31, 32, 33, 34, 35, 36, 37].includes(c)) { cur = 0; run = 0; }
  }
  return best >= 5 ? { dir, n: best } : null;   // dir: route codes 1 down, 2 left, 3 right, 4 up
}
function fallRouteDir(route, throughBefore = false) { return fallRoute(route, throughBefore)?.dir || 0; }
export function isFallRoute(route, throughBefore = false) { return fallRouteDir(route, throughBefore) !== 0; }
// Slow, through-enabled vertical rides are distinct from the original fast
// falling animation. Non-movement settings and short waits may split the run.
export function liftRoute(route, throughBefore = false) {
  if (!Array.isArray(route?.list) || fallRoute(route, throughBefore)) return null;
  let through = throughBefore, run = 0, best = 0, current = 0, dir = 0;
  for (const command of route.list) {
    const code = command.code;
    if (code === 37) through = true;
    if (code === 38) through = false;
    if (through && (code === 1 || code === 4)) {
      run = code === current ? run + 1 : 1; current = code;
      if (run > best) { best = run; dir = code; }
    } else if (code && ![15, 29, 30, 31, 32, 33, 34, 35, 36, 37].includes(code)) { current = 0; run = 0; }
  }
  return best >= 8 ? { dir, n: best } : null;
}
export function throughRock(grid, x, y, run) {
  if (!grid || !run || ![1, 4].includes(run.dir) || !Number.isInteger(run.n) || run.n < 8 || run.n > grid.h) return false;
  const dy = run.dir === 4 ? -1 : 1;
  let rock = 0;
  for (let k = 1; k <= run.n; k++) {
    if (!grid.valid(x, y + dy * k)) return false;
    if (!grid.anyPassable(x, y + dy * k)) rock++;
  }
  return rock >= run.n * 0.75;
}
// the slide of the first fall in a list: {dir, n} (how far the player is carried), or null
export function fallOfList(list, depth = 0) {
  let through = false;
  for (const c of list || []) {
    if (c.code === 102) return null;
    if (c.code === 205 && c.parameters[0] === -1) {
      const route = c.parameters[1];
      const f = fallRoute(route, through);
      if (f) return f;
      if (route.list.some(m => m.code === 37)) through = true;
      if (route.list.some(m => m.code === 38)) through = false;
    }
    if (c.code === 117 && depth < 2) {
      const f = fallOfList($data.commonEvents[c.parameters[0]]?.list, depth + 1);
      if (f) return f;
    }
  }
  return null;
}

// true when the list makes the player fall before any choice is offered
export function isFallList(list, depth = 0) {
  let through = false;
  for (const c of list || []) {
    if (c.code === 102) return false;               // e.g. a gatekeeper offering "자살한다"
    if (c.code === 205 && c.parameters[0] === -1) {
      const route = c.parameters[1];
      if (isFallRoute(route, through)) return true;
      if (route.list.some(m => m.code === 37)) through = true;
      if (route.list.some(m => m.code === 38)) through = false;
    }
    if (c.code === 117 && depth < 2) {
      const ce = $data.commonEvents[c.parameters[0]];
      if (ce && isFallList(ce.list, depth + 1)) return true;
    }
  }
  return false;
}

// jump (dx,dy) performed on the player before any choice, e.g. 名無しの森飛び越え
function jumpOf(list, depth = 0) {
  for (const c of list || []) {
    if (c.code === 102) return null;
    if (c.code === 205 && c.parameters[0] === -1) {
      for (const m of c.parameters[1].list) if (m.code === 14 && (m.parameters[0] || m.parameters[1])) return { dx: m.parameters[0], dy: m.parameters[1] };
    }
    if (c.code === 117 && depth < 2) {
      const r = jumpOf($data.commonEvents[c.parameters[0]]?.list, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

// first map exit found in a list: direct Transfer Player, or one inside a called common event
export function transferOf(list, depth = 0) {
  for (const c of list || []) {
    if (c.code === 201) {
      const p = c.parameters;
      return p[0] === 0 ? { mapId: p[1], x: p[2], y: p[3] } : { mapId: 0 };
    }
    if (c.code === 117 && depth < 1 && !NOT_EXIT_CE.has(c.parameters[0])) {
      const ce = $data.commonEvents[c.parameters[0]];
      if (ce && !isFallList(ce.list)) {
        const r = transferOf(ce.list, depth + 1);
        if (r) return r;
      }
    }
  }
  return null;
}

function regionRules(map) {
  const out = [];
  for (const line of String(map.note || '').split(/\r?\n/)) {
    const m = /RCE:(\d+),(\d+),(\d+)/i.exec(line);
    if (m) out.push({ region: +m[1], ce: +m[2] });
  }
  return out;
}

// pageOf(ev) -> the page to analyse (current page in game, first page in the viewer)
export function analyzeMap(map, grid, pageOf = ev => ev.pages[0]) {
  const w = grid.w;
  const pits = new Set();
  const falls = [];   // {x, y, dir, n}: a fall event and how far down it carries the player
  const doors = new Set();
  const doorPics = new Map();   // cell -> { name, index }: events drawn with a door / gate picture
  const exits = [];   // {x, y, mapId, label, kind:'event'|'region'}
  const jumps = [];   // {x, y, dx, dy}: stepping here makes the player jump (dx, dy)
  const lifts = [];   // structural vertical shafts, independent of their current event page
  const gaps = new Set();   // the cells a jump passes over (also pits)
  const idx = (x, y) => x + y * w;
  for (const [, ev] of map.events) {
    const page = pageOf(ev);
    if (!page) continue;
    const g = page.graphic;
    if (/door|ドア|扉|門|gate/i.test(g.character_name || '')) doorPics.set(idx(ev.x, ev.y), { name: g.character_name, index: g.character_index });
    const invisible = !g.character_name && !g.tile_id;
    if (invisible && (page.trigger === 1 || page.trigger === 2) && isFallList(page.list)) {
      pits.add(idx(ev.x, ev.y));
      const f = fallOfList(page.list);
      if (f) falls.push({ x: ev.x, y: ev.y, dir: f.dir, n: f.n });
    }
    if (page.trigger > 2) continue;
    const t = transferOf(page.list);
    if (t) {
      exits.push({ x: ev.x, y: ev.y, mapId: t.mapId, label: t.mapId && t.mapId !== map.__id ? destinationName(t.mapId) : '', kind: 'event', eventId: ev.id, trigger: page.trigger });
      doors.add(idx(ev.x, ev.y));
    } else if (/^!/.test(g.character_name) && /door|扉|ドア/i.test(g.character_name)) doors.add(idx(ev.x, ev.y));
  }
  for (const [, event] of map.events) for (const page of event.pages || []) {
    if (page.trigger > 2) continue;
    let through = false;
    for (const command of page.list || []) {
      if (command.code !== 205 || command.parameters?.[0] !== -1) continue;
      const route = command.parameters[1], run = liftRoute(route, through);
      for (const move of route?.list || []) { if (move.code === 37) through = true; else if (move.code === 38) through = false; }
      if (!run || !throughRock(grid, event.x, event.y, run)) continue;
      const end = event.y + (run.dir === 4 ? -run.n : run.n);
      const yTop = Math.min(event.y, end), yBottom = Math.max(event.y, end);
      const same = lifts.find(lift => lift.x === event.x && yTop <= lift.yBottom && yBottom >= lift.yTop);
      if (same) { same.yTop = Math.min(same.yTop, yTop); same.yBottom = Math.max(same.yBottom, yBottom); }
      else lifts.push({ x: event.x, yTop, yBottom });
    }
  }
  for (const rule of regionRules(map)) {
    const ce = $data.commonEvents[rule.ce];
    if (!ce) continue;
    const cells = [];
    for (let y = 0; y < grid.h; y++) for (let x = 0; x < w; x++) if (grid.region(x, y) === rule.region) cells.push([x, y]);
    if (isFallList(ce.list)) {
      const f = fallOfList(ce.list);
      for (const [x, y] of cells) { pits.add(idx(x, y)); if (f) falls.push({ x, y, dir: f.dir, n: f.n }); }
      continue;
    }
    const jump = jumpOf(ce.list);
    if (jump) {
      for (const [x, y] of cells) {
        jumps.push({ x, y, dx: jump.dx, dy: jump.dy });
        const n = Math.max(Math.abs(jump.dx), Math.abs(jump.dy));
        for (let k = 1; k < n; k++) {
          const gx = x + Math.sign(jump.dx) * k, gy = y + Math.sign(jump.dy) * k;
          if (grid.valid(gx, gy) && !grid.anyPassable(gx, gy)) { pits.add(idx(gx, gy)); gaps.add(idx(gx, gy)); }
        }
      }
      continue;
    }
    const t = transferOf(ce.list);
    if (t && cells.length <= 40) {
      for (const [x, y] of cells) exits.push({ x, y, mapId: t.mapId, label: t.mapId && t.mapId !== map.__id ? destinationName(t.mapId) : '', kind: 'region' });
    }
  }
  return { pits, falls, doors, doorPics, exits, jumps, gaps, lifts };
}

// Where the player can get to on this map from where they arrive (and the map's own warps): RPG
// Maker steps (both tiles' passage and the region rules, a switch-opened region counted as open),
// carried on by falls and jumps. A touch exit ends the walk there, a touch jump carries the player
// off the cell at once; an event that never lets the player by (a fixed blocker on every page) cannot
// be entered. The 3D builder raises the wall tops the player can never stand on into solid walls.
//
// "Leaks": an upper-layer tile set to ○ (a painting, a candlestick) drawn on a wall face makes that
// face passable in RPG Maker, and a wall top's end piece drawn with the wrong shape lets the player
// step onto it from the ground; from there they could walk about on the wall tops. A step onto a
// wall that goes straight through it to ground or an event (a bridge end on a cliff, a doorway) is a
// way, and so is one onto an event, exit, fall or jump. What only leaks lead to stays reachable when
// it holds an event (the game meant it); otherwise the cells the leaks lead into come back as
// `blocked`: the player cannot step on them and the 3D wall stays whole.
// -> { reach: Uint8Array (1 = the player can stand here), blocked: [cell index, ...] }
const STEP = { 2: [0, 1], 4: [-1, 0], 6: [1, 0], 8: [0, -1] };
const FALL_STEP = { 1: [0, 1], 2: [-1, 0], 3: [1, 0], 4: [0, -1] };   // move route codes
// a route that takes the character off its cell (steps, jumps, through on), not just turns it (a door
// opening is a few turns)
const leavesCell = route => route.list.some(m => (m.code >= 1 && m.code <= 14) || m.code === 37);
export function reachableCells(map, grid, ana, seeds) {
  const w = grid.w, h = grid.h;
  const idx = (x, y) => x + y * w;
  const stop = new Uint8Array(w * h);     // 1: the walk ends here (exit), 2: cannot be entered
  const carry = new Map();                // cell -> [[x, y]] where a fall / jump puts the player
  const carryTo = (from, x, y) => {
    if (!grid.valid(x, y)) return;
    if (!carry.has(from)) carry.set(from, []);
    carry.get(from).push([x, y]);
  };
  const starts = [...seeds];
  // events moved by others (or by their own routes) can step out of the way; an exit's own opening
  // routes do not count, it sends the player away anyway
  const isExit = p => (p.trigger === 1 || p.trigger === 2) && !!transferOf(p.list);
  const movers = new Set();
  for (const [, ev] of map.events) {
    for (const p of ev.pages) for (const c of p.list) {
      if (((c.code === 205 && leavesCell(c.parameters[1])) || c.code === 203) && !isExit(p)) movers.add(c.parameters[0] === 0 ? ev.id : c.parameters[0]);
      // the map's own warps are places the player arrives at too
      if (c.code === 201 && c.parameters[0] === 0 && c.parameters[1] === map.__id) starts.push([c.parameters[2], c.parameters[3]]);
    }
  }
  for (const [, ev] of map.events) {
    if (!grid.valid(ev.x, ev.y)) continue;
    let pass = false, away = false;
    for (const p of ev.pages) {
      const touch = p.trigger === 1 || p.trigger === 2;
      // a jump the event makes the player do: from its cell (touch) or from in front of it (button)
      const j = (touch || p.trigger === 0) && jumpOf(p.list);
      if (j && touch) carryTo(idx(ev.x, ev.y), ev.x + j.dx, ev.y + j.dy);
      else if (j) {
        const fx = ev.x - Math.sign(j.dx), fy = ev.y - Math.sign(j.dy);
        if (grid.valid(fx, fy)) carryTo(idx(fx, fy), fx + j.dx, fy + j.dy);
      }
      if (isExit(p) || (j && touch)) away = true;
      else if (p.priority_type !== 1 || p.through || p.move_type === 1 || p.move_type === 2 || (p.move_type === 3 && leavesCell(p.move_route)) || movers.has(ev.id)) pass = true;
    }
    if (!pass) stop[idx(ev.x, ev.y)] = away ? 1 : 2;
  }
  for (const e of ana.exits) if (e.kind === 'region') stop[idx(e.x, e.y)] = 1;
  for (const f of ana.falls) {
    const [dx, dy] = FALL_STEP[f.dir] || [0, 0];
    carryTo(idx(f.x, f.y), f.x + dx * f.n, f.y + dy * f.n);
  }
  for (const j of ana.jumps || []) carryTo(idx(j.x, j.y), j.x + j.dx, j.y + j.dy);
  for (const lift of ana.lifts || []) if (grid.anyPassable(lift.x, lift.yTop)) {
    carryTo(idx(lift.x, lift.yBottom), lift.x, lift.yTop);
    carryTo(idx(lift.x, lift.yTop), lift.x, lift.yBottom);
  }
  const can = (x, y, d) => {
    const x2 = x + STEP[d][0], y2 = y + STEP[d][1];
    if (!grid.valid(x2, y2)) return false;
    const r1 = grid.region(x, y), r2 = grid.region(x2, y2);
    if (PLAYER_BLOCK_REGIONS.includes(r2)) return false;
    if (SWITCH_PASS[r2]) return true;
    if (SWITCH_PASS[r1] && grid.passable(x2, y2, 10 - d)) return true;
    return grid.passable(x, y, d) && grid.passable(x2, y2, 10 - d);
  };
  // the player walks off the cell they arrive on, even when it is an exit (stepping back on is what
  // triggers it)
  const startCells = new Set();
  for (const [x, y] of starts) if (grid.valid(x, y)) startCells.add(idx(x, y));

  // ---- leaks
  // events the player has to get to (not the soul marker the game moves around, not scripts that run
  // wherever they are)
  const isSoul = ev => ev.id === 1 && ev.pages[0]?.list?.[0]?.code === 117 && ev.pages[0].list[0].parameters[0] === 32;
  const spatial = ev => !isSoul(ev) && ev.pages.some(p => p.trigger <= 2 &&
    (p.graphic?.character_name || p.graphic?.tile_id || p.list.some(c => ![0, 108, 408].includes(c.code))));
  const evCell = new Set();
  for (const [, ev] of map.events) if (grid.valid(ev.x, ev.y) && spatial(ev)) evCell.add(idx(ev.x, ev.y));
  const wallAt = (x, y) => isWallType(grid.tile(x, y, 0)) || isWallType(grid.tile(x, y, 1));
  const ladderAt = (x, y) => [0, 1, 2].some(z => grid.flag(grid.tile(x, y, z)) & F.LADDER);
  // cells stepped onto on purpose: an event, an exit, a fall, a jump, a region with its own common
  // event or one a switch opens
  const regionCalls = new Set(regionRules(map).map(r => r.region));
  const meant = k => {
    if (evCell.has(k) || stop[k] || ana.pits.has(k) || carry.has(k)) return true;
    const r = grid.region(k % w, (k / w) | 0);
    return r > 0 && (regionCalls.has(r) || !!SWITCH_PASS[r]);
  };
  // a step from open ground onto a wall (its top, or a face made passable by what is drawn on it)
  // that does not go straight on through it to ground: a doorway or a bridge end does
  const leakStep = (x, y, d) => {
    const [dx, dy] = STEP[d];
    let cx = x + dx, cy = y + dy;
    if (wallAt(x, y) || !wallAt(cx, cy) || ladderAt(cx, cy) || meant(idx(cx, cy))) return false;
    for (let n = 0; n < 6; n++) {
      if (!can(cx, cy, d)) return true;
      cx += dx; cy += dy;
      if (meant(idx(cx, cy)) || !wallAt(cx, cy) || ladderAt(cx, cy)) return false;
    }
    return true;
  };
  const flood = strict => {
    const reach = new Uint8Array(w * h);
    const q = [];
    const add = k => {
      if (reach[k] || stop[k] === 2) return;
      reach[k] = 1;
      q.push(k);
    };
    for (const k of startCells) if (!reach[k]) { reach[k] = 1; q.push(k); }
    while (q.length) {
      const k = q.pop();
      const x = k % w, y = (k / w) | 0;
      for (const [lx, ly] of carry.get(k) || []) add(idx(lx, ly));
      if ((stop[k] || ana.pits.has(k)) && !startCells.has(k)) continue;
      for (const d of [2, 4, 6, 8]) {
        if (can(x, y, d) && !(strict && leakStep(x, y, d))) add(idx(x + STEP[d][0], y + STEP[d][1]));
      }
    }
    return reach;
  };
  const full = flood(false), reach = flood(true);
  // what only a leak leads to stays reachable where it holds an event (a message left on the wall
  // tops, say): the game meant it
  const seen = new Uint8Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (!full[s] || reach[s] || seen[s]) continue;
    const cells = [s];
    seen[s] = 1;
    let busy = false;
    for (let head = 0; head < cells.length; head++) {
      const k = cells[head];
      if (evCell.has(k)) busy = true;
      const x = k % w, y = (k / w) | 0;
      for (const d of [2, 4, 6, 8]) {
        if (!can(x, y, d)) continue;
        const j = idx(x + STEP[d][0], y + STEP[d][1]);
        if (full[j] && !reach[j] && !seen[j]) { seen[j] = 1; cells.push(j); }
      }
    }
    if (busy) for (const k of cells) reach[k] = 1;
  }
  // the cells the leaks lead into, where the player may no longer step
  const blocked = new Set();
  for (let k = 0; k < w * h; k++) {
    if (!reach[k]) continue;
    const x = k % w, y = (k / w) | 0;
    for (const d of [2, 4, 6, 8]) {
      const j = idx(x + STEP[d][0], y + STEP[d][1]);
      if (can(x, y, d) && !reach[j] && full[j]) blocked.add(j);
    }
  }
  return { reach, blocked: [...blocked] };
}
