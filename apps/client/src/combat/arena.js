// Boss fights close off the arena, like a Souls fog gate (the user's design):
//  - while it lasts, the other events on the map are out of sight and out of reach - nothing can be talked to,
//    touched or bumped (pieces of map pictures drawn with tiles - windows, statues - stay as they are; events
//    that run by themselves keep running);
//  - every way out (transfer events and regions) is walled off with fog that cannot be crossed - the door of a
//    way out stays where it is, behind its fog (someone standing there as the way out does not);
//  - won: when the game's own "VICTORY ACHIEVED" (CE 12) goes away, the view goes dark, the player is put back
//    where the fight began (an event coming back could otherwise stand where the player is) and the view comes
//    back; without that banner the same happens once the boss event has finished;
//  - lost, a transfer, a rest at a bonfire, a new map: everything is simply back at once.
// A boss fight is combat.isBossFight with a boss in it; started by a roaming enemy (symbol) only when that is a
// one-off boss (combat.oneOffSymbol).
import * as THREE from 'three';
import { G } from '../core/globals.js';
import { T } from '../world/mapmesh.js';
import { clearEdgeCache } from '../world/collision.js';

const FOG_H = 2.4;                   // tiles
// A fight in the dark: where the original draws nothing at all round a narrow way (pure black, no parallax - the
// child's room, 아이 방: its boss stands at the end of a path one cell wide through the dark), the dark round the
// fight opens up for it - DARK_R cells round where the player stands - and closes again when it is over. Narrow:
// fewer than DARK_NARROW cells to stand on within 4 of the player; dark: DARK_SHARE of the cells round it show
// nothing (every tile on them blank)
const DARK_R = 7, DARK_NARROW = 20, DARK_SHARE = 0.9;

// a curtain of fog: drifting light wisps, thick at the floor, thinning out toward the top. A dense sheet at
// the edge of the fogged cell and a thin one just before it, each drifting its own way - dense enough that
// the walls and floor inside the fog do not show through as behind a pane of glass. Where a sheet ends in the
// open (a stair or a hole standing on open floor, not a passage between walls) its edge thins out softly,
// so the fog there is a column of mist rather than a box.
// where the sheets stand, from the cell's middle toward the open side: just in front of the cell's edge, where
// a wall's face is and a door in it is drawn (0.51) - the dense one first, the thin one drifting before it
const SLICES = [0.54, 0.6];
const OPACITY = [0.95, 0.5];
let wisps = null;                        // the two drifting textures, one per sheet
const fogMats = new Map();               // soft edges (1 left, 2 right) / how wide -> the two sheets' materials
const WING = 0.6;                        // tiles: the fog beside a door, over the wall
function wispTextures() {
  if (wisps) return wisps;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(196,203,218,0.72)';
  ctx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * c.width, y = Math.random() * c.height, r = 8 + Math.random() * 30;
    const a = 0.12 + Math.random() * 0.3;
    for (const dx of [-c.width, 0, c.width]) for (const dy of [-c.height, 0, c.height]) {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      g.addColorStop(0, `rgba(250,252,255,${a})`);
      g.addColorStop(1, 'rgba(250,252,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    }
  }
  wisps = [[0.05, 0], [-0.07, 0.37]].map(([speed, phase]) => {
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, FOG_H);
    tex.userData = { speed, phase };
    return tex;
  });
  return wisps;
}
function fogMaterials(soft, span = 0.4) {
  const key = `${soft}/${span}`;
  if (!fogMats.has(key)) {
    const alpha = fadeTexture(soft, span);
    fogMats.set(key, wispTextures().map((map, i) => new THREE.MeshBasicMaterial({ map, alphaMap: alpha, transparent: true,
      opacity: OPACITY[i], depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false })));
  }
  return fogMats.get(key);
}
// strong at the bottom, gone at the top; soft edges thin out over a part of the width (alpha map: green channel,
// not repeated)
function fadeTexture(soft, span) {
  const W = 32, H = 64;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const ease = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;                 // 0 at the top
    const up = v < 0.3 ? v / 0.3 * 0.667 : v < 0.55 ? 0.667 + (v - 0.3) / 0.25 * 0.333 : 1;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const a = up * (soft & 1 ? ease(u / span) : 1) * (soft & 2 ? ease((1 - u) / span) : 1);
      const o = (x + y * W) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.round(a * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // no mipmaps: seen from above, the foot of a sheet would take a small level where its soft edges are
  // averaged away, and draw a bright outline round the fog on the floor
  const tex = new THREE.CanvasTexture(c);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}
// mist lying on the floor of a fogged cell and a little beyond it: from above, the foot of the curtains is
// a pool of mist instead of a hard line round the cell
const POOL = 1.6;                        // tiles across
let poolMat = null;
function poolMaterial() {
  if (poolMat) return poolMat;
  const N = 64;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = Math.max(Math.abs((x + 0.5) / N - 0.5), Math.abs((y + 0.5) / N - 0.5)) * 2;   // 0 middle, 1 rim
    const t = Math.min(1, Math.max(0, (d - 0.5) / 0.5));
    const o = (x + y * N) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.round((1 - t * t * (3 - 2 * t)) * 255);
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const alpha = new THREE.CanvasTexture(c);
  alpha.generateMipmaps = false;
  alpha.minFilter = THREE.LinearFilter;
  poolMat = new THREE.MeshBasicMaterial({ map: wispTextures()[0], alphaMap: alpha, transparent: true, opacity: 0.85,
    depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  return poolMat;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(test, ms) { const t0 = performance.now(); while (!test() && performance.now() - t0 < ms) await sleep(30); }

export class BossArena {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.state = '';            // fight | won | returning
    this.busy = false;          // the dark return after a win: the event waits (ui.messageBusy)
    this.hidden = new Set();
    this.blocked = new Set();
    this.sleeping = [];
    this.fog = [];
    this.token = 0;
  }
  hides(ev) { return this.active && this.hidden.has(ev); }
  // a cell of the dark opened for the fight (openDark)
  opens(x, y) { return !!this.open && this.open.has(x + y * G.map.grid.w); }
  // talking, touching, bumping: only the fight's own event
  blocksTrigger(ev) { return this.active && ev !== this.battle?.event; }
  blocksCell(x, y) { return this.active && this.blocked.has(x + y * G.map.grid.w); }

  // (a co-op guest: the host's fight closes the arena here too - battle.remote, at: where the host began it; coop.js)
  begin(battle, at = null) {
    if (this.active || !G.map) return;
    const m = G.map, pc = m.playerChar;
    this.active = true;
    this.state = 'fight';
    this.battle = battle;
    this.mapId = m.mapId;
    this.entry = at ? { fx: at.fx, fy: at.fy } : { fx: pc.fx, fy: pc.fy };
    // the bodies of roaming enemies standing on the map
    for (const [ev, s] of G.combat.symbols) {
      if (ev === battle.event || !s.enemy || s.enemy.battle || !s.enemy.group) continue;
      s.enemy.group.visible = false;
      this.sleeping.push(s.enemy);
    }
    const g = m.grid, w = g.w, h = g.h;
    for (const ex of G.view?.analysis?.exits || []) this.blocked.add(ex.x + ex.y * w);
    // an exit at the edge of the map in a passage wider than the exit (도지슨교: a strip of pavement beside
    // the three exit cells): the fog fills the rest of that mouth too, up to 3 cells - a longer open stretch
    // is open ground, not a passage, and is left alone
    const walk = (x, y) => g.valid(x, y) && g.anyPassable(x, y);
    const step = (x, y, d, nx, ny) => walk(nx, ny) && g.passable(x, y, d) && g.passable(nx, ny, 10 - d);
    for (const k of [...this.blocked]) {
      const x = k % w, y = (k - x) / w;
      const along = x === 0 || x === w - 1 ? [[0, -1, 8], [0, 1, 2]] : y === 0 || y === h - 1 ? [[-1, 0, 4], [1, 0, 6]] : [];
      for (const [dx, dy, d] of along) {
        const cells = [];
        let cx = x, cy = y;
        while (cells.length <= 3 && step(cx, cy, d, cx + dx, cy + dy) && !this.blocked.has(cx + dx + (cy + dy) * w)) {
          cx += dx; cy += dy;
          cells.push(cx + cy * w);
        }
        if (cells.length && cells.length <= 3) for (const c of cells) this.blocked.add(c);
      }
    }
    // the door of a way out (a door picture, or one set into the wall) stays, seen through its fog
    const doors = new Set((G.view?.sprites || []).filter(sp => sp.facade || sp.isDoorGraphic?.()).map(sp => sp.ch));
    for (const ev of m.eventList) {
      if (ev === battle.event || ev.tileId > 0 || !ev.characterName) continue;
      if (doors.has(ev) && this.blocked.has(ev.x + ev.y * w)) continue;
      this.hidden.add(ev);
    }
    // a curtain on each side of a fogged cell that the player can walk up to (several sides for a stair or a
    // hole standing in the open, one wall of fog for a row across a passage), standing on that side's floor
    const geo = new THREE.PlaneGeometry(T, FOG_H * T);
    const wingGeo = new THREE.PlaneGeometry(WING * T, FOG_H * T);
    const poolGeo = new THREE.PlaneGeometry(POOL * T, POOL * T).rotateX(-Math.PI / 2);
    const open = (x, y) => walk(x, y) && !this.blocked.has(x + y * w);
    const wall = (x, y) => g.valid(x, y) && !walk(x, y) && !this.blocked.has(x + y * w);
    const add = mesh => { this.scene.add(mesh); this.fog.push(mesh); };
    for (const k of this.blocked) {
      const x = k % w, y = (k - x) / w;
      let pool = false;
      for (const [dx, dy, d] of [[0, 1, 2], [-1, 0, 4], [1, 0, 6], [0, -1, 8]]) {
        const nx = x + dx, ny = y + dy;
        if (!walk(nx, ny) || this.blocked.has(nx + ny * w) || !g.passable(nx, ny, 10 - d)) continue;
        const floor = G.floorAt ? G.floorAt(nx, ny) : 0;
        if (!pool) {
          pool = new THREE.Mesh(poolGeo, poolMaterial());
          pool.position.set((x + 0.5) * T, floor + 0.02, (y + 0.5) * T);
          pool.renderOrder = 4;
          add(pool);
        }
        // the cells at the sheet's two ends (its texture's left and right): open floor there = a soft edge
        const [lx, ly, rx, ry] = dx ? [x, y + 1, x, y - 1] : [x - 1, y, x + 1, y];
        const soft = (open(lx, ly) ? 1 : 0) | (open(rx, ry) ? 2 : 0);
        fogMaterials(soft).forEach((mat, i) => {
          const fog = new THREE.Mesh(geo, mat);
          fog.position.set((x + 0.5 + dx * SLICES[i]) * T, floor + FOG_H * T / 2, (y + 0.5 + dy * SLICES[i]) * T);
          if (dx) fog.rotation.y = Math.PI / 2;
          fog.renderOrder = 5;
          add(fog);
        });
        // beside a door set in a wall: a short wing of fog over the wall on each side, thinning out away from
        // the door (a door's picture is often wider than its cell - a double door). In a passage it stands
        // inside the side walls, out of sight.
        for (const [sx, sy, side, bit] of [[lx, ly, -1, 1], [rx, ry, 1, 2]]) {
          if (!wall(sx, sy)) continue;
          const along = side * (0.5 + WING / 2);              // along the sheet: world +x, or -z when turned
          fogMaterials(bit, 1).forEach((mat, i) => {
            const fog = new THREE.Mesh(wingGeo, mat);
            fog.position.set((x + 0.5 + dx * SLICES[i] + (dx ? 0 : along)) * T, floor + FOG_H * T / 2,
              (y + 0.5 + dy * SLICES[i] - (dx ? along : 0)) * T);
            if (dx) fog.rotation.y = Math.PI / 2;
            fog.renderOrder = 5;
            add(fog);
          });
        }
      }
    }
    console.info(`[arena] boss fight: ${this.hidden.size} events out of sight, ${this.blocked.size} cells of ways out in fog`);
    this.openDark();
    if (!battle.remote && !battle.private) G.coop?.onArena?.(true, battle, this.entry);     // (its co-op guests' fog closes too)
  }
  // (round where the fight began)
  openDark() {
    const m = G.map, g = m.grid, w = g.w, drawer = G.view?.mesh?.drawer;
    if (!drawer || (m.map.parallax_name && m.map.parallax_show)) return;
    const cx = Math.round(this.entry.fx), cy = Math.round(this.entry.fy);
    let near = 0;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (dx * dx + dy * dy <= 20 && g.valid(cx + dx, cy + dy) && g.anyPassable(cx + dx, cy + dy)) near++;
    if (near >= DARK_NARROW) return;
    // (a tile shows something when any of its pixels does)
    const shows = new Map(), cv = document.createElement('canvas');
    cv.width = cv.height = 32;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const tileShows = id => {
      if (!(id > 0)) return false;
      if (!shows.has(id)) {
        ctx.clearRect(0, 0, 32, 32);
        drawer.draw(ctx, id, 0, 0, 0);
        const d = ctx.getImageData(0, 0, 32, 32).data;
        let any = false;
        for (let k = 3; k < d.length && !any; k += 4) if (d[k] > 16) any = true;
        shows.set(id, any);
      }
      return shows.get(id);
    };
    const cells = [];
    let all = 0;
    for (let dy = -DARK_R; dy <= DARK_R; dy++) for (let dx = -DARK_R; dx <= DARK_R; dx++) {
      const x = cx + dx, y = cy + dy;
      if (dx * dx + dy * dy > DARK_R * DARK_R + DARK_R || !g.valid(x, y)) continue;
      all++;
      if (![0, 1, 2].some(z => tileShows(g.tile(x, y, z)))) cells.push(x + y * w);
    }
    if (!all || cells.length < all * DARK_SHARE) return;
    this.open = new Set(cells);
    clearEdgeCache();
    G.rebuildMapView?.(this.open);
    console.info(`[arena] a fight in the dark: ${cells.length} cells opened round (${cx},${cy})`);
  }

  battleEnded(battle) {
    if (!this.active || battle !== this.battle) return;
    if (battle.result === 0) { this.state = 'won'; this.wonAt = G.time; }
    else this.release();
  }
  // a blocking banner went away (ui): after a won boss fight that is VICTORY ACHIEVED
  onBannerEnd() { if (this.active && this.state === 'won') this.victoryReturn(); }

  update() {
    if (!this.active) return;
    for (const tex of wisps || []) { const { speed, phase } = tex.userData; tex.offset.set((G.time * speed * 0.3 + phase) % 1, (G.time * speed + phase) % 1); }
    for (const e of this.sleeping) if (e.group) e.group.visible = false;    // (whatever else shows them)
    if (this.state !== 'won') return;
    // no banner came (a boss that does not call CE 12): once the boss event is done
    const interp = this.battle?.interpreter;
    const quiet = !G.ui.banner && !G.ui.msg, idle = quiet && !interp?.running?.();
    // (an event that keeps running - a parallel one - would never be idle: then after a while, between messages)
    if ((idle && G.time - this.wonAt > 1.5) || (quiet && G.time - this.wonAt > 20)) this.victoryReturn();
  }

  async victoryReturn() {
    if (this.state !== 'won') return;
    // (a co-op host that never joined the fight is not brought anywhere: only the fog lifts)
    if (this.battle?.coopIn && !this.battle.coopIn.has('host')) { this.release(); return; }
    this.state = 'returning';
    this.busy = true;
    const token = this.token, entry = this.entry, mapId = this.mapId;
    G.screen.fadeOut(18);
    await until(() => G.screen.brightness <= 1, 1500);
    if (token !== this.token) return;          // released meanwhile (a transfer)
    this.release();
    const mine = this.token;
    this.busy = true;
    if (G.map?.mapId === mapId && !G.map.transferring) G.player.teleportTo(entry.fx, entry.fy);
    await sleep(250);
    if (mine === this.token) G.screen.fadeIn(18);   // (a transfer meanwhile brings the view back itself)
    this.busy = false;
  }

  // everything back as it was
  release() {
    this.token++;
    this.busy = false;
    if (!this.active) return;
    if (!this.battle?.remote && !this.battle?.private) G.coop?.onArena?.(false);
    this.active = false;
    this.state = '';
    this.battle = null;
    // the dark closes again (not when the map is being left anyway)
    if (this.open) {
      this.open = null;
      clearEdgeCache();
      if (G.map?.mapId === this.mapId && !G.map.transferring) G.rebuildMapView?.(null);
    }
    this.hidden.clear();
    this.blocked.clear();
    for (const e of this.sleeping) if (e.group) e.group.visible = true;
    this.sleeping = [];
    for (const f of this.fog) this.scene.remove(f);
    for (const geo of new Set(this.fog.map(f => f.geometry))) geo.dispose();   // (the materials are kept)
    this.fog = [];
  }
}
