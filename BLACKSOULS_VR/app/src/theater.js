// 그랑・기뇰 - the true ending's last fight (troop 620, 하얀 성시 ７－１１ BOSS ２, map 374) is a play in seven acts,
// the most staged fight of the original: between the acts a curtain closes over the battle (CE 362 カーテン閉まる,
// pictures 幕１..幕８ and 幕), the act's players change behind it and the battle back turns into the next act's
// scenery, then it opens (CE 363 / 364) on the new act to applause and the act's title. The play is put on here on
// the stage the fight stands on (a troop whose events open and close that curtain is a play):
//  - the troop takes its places upstage, across the stage as the original lays it out on its battle screen;
//  - the curtain is the original's own pictures, hung as the stage's own curtain along its front edge: the picture as
//    big as it always was in the middle, the rest of the opening - out to its side walls, up to its back wall's top -
//    the same curtain's cloth, its folds standing as they hang (the user's wish - it came down before the player,
//    toward the act's lead; then the picture was stretched over the whole opening); while it is closed the act's new
//    players take their places upstage behind it, and nobody moves - the original's battle waits for its events too;
//  - the battle back is the act's scenery: a backdrop hung on the stage's back wall;
//  - a spotlight from the flies follows each of the act's leads;
//  - the applause and the laughter come from the house, beyond the stage's edge;
//  - the dark stage machine (対象不可 until its last form) hangs over the stage, and its seven parts - nothing to see
//    in the original, their picture is blank - are torn pieces of its own picture, hung from it on strings;
//  - its leads use their signature skills as moves of their own (FAMILY - combat.js bossFamily for the rest).
import * as THREE from 'three';
import { G } from './globals.js';
import { $data } from './data.js';
import { T } from './mapmesh.js';
import { loadImage, loadCanvas } from './assets.js';
import { resolveCircle } from './collision.js';
import { builtinRules } from './maphints.js';

const CURTAIN_CES = [362, 363, 364];
const CURTAIN_PIC = /^幕[１２３４５６７８]?$/;
// the curtain: the stage's own, in its opening (proscenium - its side walls looked for this many cells beside the
// stage's front row): its picture this wide (m; 4:3, the game's screen) at the foot of the opening's middle, the rest of
// the opening its cloth. No stage found: before the eyes, this far off, the cloth reaching on another picture's width to
// each side and 0.3 of its height above it
const CURTAIN = { sideReach: 4, w: 8.8, dist: 2.3, wings: 1, up: 0.3 };
// the curtain's cloth: its folds as they hang in the closed picture (幕, 640 x 480; px x0, y0, x1, y1 - below the
// valance's shadow, clear of the drapes at its sides and of the seam in its middle), laid side by side as wide as the
// picture's own, each next one turned over (no seam where they meet), drawn up the opening's whole height - standing.
// (Before, the picture's outermost column was drawn out sideways: the cloth's folds lay on their side)
const CLOTH = [100, 200, 310, 480];
// the next act's players stand this far behind the curtain (m), spread across up to this far either way
const BEHIND = { depth: 3.4, spread: 3.2 };
// the scenery on the back wall: at most this wide / high (m)
const BACKDROP = { maxW: 20, maxH: 15 };
// the original lays its troop out across its battle screen (x in px): the middle and how far either way
const SCREEN = { mid: 320, half: 240 };
// spotlights: hung this high over the stage, this wide on the floor (m)
const SPOT = { height: 9, radius: 1.9, color: 0xfff0d8, intensity: 160, n: 2 };
// the machine of the last act hangs this high over the stage (m), this much bigger than its picture; a stage
// machine in reach floats this high
const MACHINE = { hang: 4.6, scale: 1.6, float: 0.9, drop: 1.8 };
const BLANK = '【変身用】';
// the leads' signature skills as moves of their own (combat.js planBossMove): the playing cards (King fire all round,
// Jack thunder from above, Queen a cross of darkness, Joker a slow killing blow), the rose barrage raining down, the
// acid that pools, the dice (as many blasts as the face rolled), the voices of the white prison (a low wave, a burst,
// a scream), No-Face's scythes and its delayed spells (a swamp, orbs, flames, a meteor - their real blow is the one
// they leave behind), the Queen's 「목을 쳐라.」, the stage machine's sandbags from the flies, the checkmate on a
// chessboard, and the seven scrambled poems of the last act
const FAMILY = {
  431: 'rain', 426: 'nova', 427: 'rain', 428: 'cross', 512: 'execute',
  399: 'field', 772: 'grab',
  851: 'dice', 860: 'dice', 861: 'dice', 862: 'dice', 863: 'dice', 864: 'dice',
  989: 'sweep', 990: 'pursuit', 991: 'spin',
  976: 'thrust', 982: 'flurry', 983: 'rain',
  992: 'wave', 993: 'nova', 994: 'roar', 995: 'roar',
  449: 'sweep', 589: 'flurry', 653: 'nova', 80: 'rain', 776: 'quake', 831: 'rain', 773: 'sweep', 898: 'breath', 466: 'orbs',
  731: 'field', 729: 'orbs', 733: 'pursuit', 735: 'rain',
  794: 'rain', 525: 'execute', 806: 'field', 137: 'wave', 130: 'flurry', 389: 'orbs', 540: 'pursuit', 539: 'nova', 532: 'cross', 517: 'sweep', 799: 'execute', 912: 'leap',
  548: 'rain', 342: 'chess',
  917: 'orbs', 919: 'charge', 930: 'nova', 938: 'cross', 894: 'rain', 890: 'pursuit', 887: 'wave',
};
// those who hold their place: the white prison floats where the act put it, the stage machine hangs (or floats)
const STATIONARY = new Set([566, 579, 570, 571, 572, 573, 574, 575, 576, 577]);
// the pieces of the machine's picture (グラン・ギニョール, 700 x 300) its seven parts are made of (px)
const PIECES = [[0, 0, 165, 150], [380, 0, 160, 125], [530, 0, 170, 125], [55, 85, 210, 150], [185, 175, 165, 125], [375, 105, 185, 195], [540, 140, 160, 160]];

const tmp = new THREE.Vector3();
function seeded(seed) { let s = seed * 9301 + 49297; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); }
// a spotlight's beam: strong at the floor, gone toward the flies (alpha map)
let beamTex = null;
function beamTexture() {
  if (beamTex) return beamTex;
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, '#000'); g.addColorStop(0.45, '#333'); g.addColorStop(1, '#fff');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 64);
  beamTex = new THREE.CanvasTexture(c);
  return beamTex;
}
// rectangles in a plane facing +z (x across, y up): [x0, y0, x1, y1] each (an empty one left out), uv(x, y) at corners
function rects(list, uv) {
  const pos = [], uvs = [], idx = [];
  for (const [x0, y0, x1, y1] of list) {
    if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3) continue;
    const n = pos.length / 3;
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) { pos.push(x, y, 0); uvs.push(...uv(x, y)); }
    idx.push(n, n + 1, n + 2, n + 2, n + 1, n + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  return geo;
}
// a curtain picture with its outermost 2 rows and columns of pixels all round made the ones just inside them: along some
// frames' edges runs a line far lighter than the cloth (a top, bottom, left or right one - 幕８'s bottom two rows), unseen
// at the original's screen edge, a seam across the stage's curtain here where the cloth meets the picture
function edgeless(img) {
  const c = document.createElement('canvas'), w = c.width = img.width, h = c.height = img.height, ctx = c.getContext('2d'), k = 2;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  // (the rows first, then the columns their whole height - the corners too)
  for (let i = 0; i < k; i++) for (const [s, d] of [[k, i], [h - 1 - k, h - 1 - i]]) { ctx.clearRect(0, d, w, 1); ctx.drawImage(c, 0, s, w, 1, 0, d, w, 1); }
  for (let i = 0; i < k; i++) for (const [s, d] of [[k, i], [w - 1 - k, w - 1 - i]]) { ctx.clearRect(d, 0, 1, h); ctx.drawImage(c, s, 0, 1, h, d, 0, 1, h); }
  return c;
}
// the curtain's picture and its cloth: cut out along the picture's edges, lit by nothing (as on the original's screen)
function curtainMaterial() {
  const m = new THREE.MeshBasicMaterial({ alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false });
  m.color.setScalar(0.92);
  return m;
}

export class Theater {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.root = new THREE.Group(); this.root.name = 'theater';
    scene.add(this.root);
    this.tex = new Map();            // picture textures (curtain frames, scenery)
    this.spotPool = null;            // the spotlights, hung for the whole play
    this.strings = new Map();        // enemy -> its string up to the machine
  }
  // a play: a troop whose own events open and close the curtain - BLACK SOULS II's (its common events 362-364, its
  // pictures, its enemies): none with the launcher's switch for that game's own rules off (the user's wish - another game's
  // events of those numbers are something else), the fight then fought as any other
  isPlay(troop) {
    if (!troop || !builtinRules()) return false;
    if (troop._play === undefined) troop._play = !!troop.pages?.some(p => p.list?.some(c => c.code === 117 && CURTAIN_CES.includes(c.parameters[0])));
    return troop._play;
  }

  // ---- the play begins / ends -------------------------------------------------------------------------
  begin(battle) {
    if (this.active || !this.isPlay(battle.troop) || !G.map?.grid) return;
    this.active = true;
    this.battle = battle;
    // (measured once on a map: begun again - 그랑・기뇰's 재도전 - the play may find the player down in the house, where the
    // fight's ways let them go - arena.js openWays)
    if (this.measured?.mapId !== G.map.mapId) this.measured = { mapId: G.map.mapId, stage: this.measureStage() };
    this.stage = this.measured.stage;
    this.lastAnimated = null;
    // the curtain's pictures and the acts' scenery, loaded now so nothing waits as the acts change - one after
    // another, after what the fight itself needs (its players' pictures)
    const want = ['幕', ...'１２３４５６７８'.split('').map(d => '幕' + d)].map(n => ['Graphics/Pictures', n]);
    for (const p of battle.troop.pages) for (const c of p.list) if (c.code === 283 && c.parameters[0]) want.push(['Graphics/Battlebacks1', c.parameters[0]]);
    (async () => { for (const [f, n] of want) { if (!this.active) return; await this.texture(f, n).promise; } })();
    this.cloth();
    // the troop takes its places upstage
    if (this.stage) for (const e of battle.enemies) this.place(e, this.stageSpot(e));
    for (const e of battle.enemies) this.dress(e);
    this.hangLights();
    console.info(`[theater] ${battle.troop.name}: a play on the stage ${this.stage ? `${this.stage.minX}-${this.stage.maxX} x ${this.stage.minY}-${this.stage.maxY}, upstage ${this.stage.up}` : '(none found)'}`);
  }
  battleEnded(battle) {
    if (!this.active || battle !== this.battle) return;
    this.takeDown();
  }
  // a new map (or the fights gone): the stage is struck, its lights too - and hung again, dark, on a map where a play
  // is put on: a light coming makes the renderer rebuild every lit material, a hitch better had while the map loads
  // than as the play begins
  reset() {
    if (this.active) this.takeDown();
    this.measured = null;
    for (const s of this.spotPool || []) { this.root.remove(s.light, s.light.target, s.cone); s.cone.geometry.dispose(); s.cone.material.dispose(); s.light.dispose?.(); }
    this.spotPool = null;
  }
  prepare() {
    const m = G.map;
    if (!m?.eventList) return;
    const plays = ev => (ev.event?.pages || []).some(pg => (pg.list || []).some(c => c.code === 301 && c.parameters[0] === 0 && this.isPlay($data.troops[c.parameters[1]])));
    if (m.eventList.some(plays)) this.hangLights();
  }
  hangLights() { if (!this.spotPool) this.spotPool = Array.from({ length: SPOT.n }, () => this.makeSpot()); }
  takeDown() {
    this.active = false;
    this.battle = null;
    this.closed = false;
    this.up = false;
    this.curtainPic = null;
    const keep = new Set((this.spotPool || []).flatMap(s => [s.light, s.light.target, s.cone]));
    for (const o of [...this.root.children]) if (!keep.has(o)) this.root.remove(o);
    for (const s of this.spotPool || []) { s.e = null; s.k = 0; s.want = 0; s.light.intensity = 0; s.cone.visible = false; }
    for (const s of this.strings.values()) { s.geometry.dispose(); s.material.dispose(); }
    this.strings.clear();
    this.dropCurtain();
    this.backdrop = null; this.oldBackdrop = null;
  }

  // ---- the stage ----------------------------------------------------------------------------------------
  // the floor the fight stands on: the cells the player can walk to from where they stand (a stage walled in);
  // its long side's far edge from the player is upstage, where the back wall and its scenery are
  measureStage() {
    const m = G.map, g = m.grid, pc = m.playerChar;
    const sx = Math.round(pc.fx), sy = Math.round(pc.fy);
    if (!g.valid(sx, sy)) return null;
    const seen = new Set([sx + sy * g.w]), q = [[sx, sy]];
    let minX = sx, maxX = sx, minY = sy, maxY = sy;
    while (q.length && seen.size < 1200) {
      const [x, y] = q.shift();
      for (const [dx, dy, d] of [[0, 1, 2], [-1, 0, 4], [1, 0, 6], [0, -1, 8]]) {
        const nx = x + dx, ny = y + dy, k = nx + ny * g.w;
        if (seen.has(k) || !g.valid(nx, ny) || !m.walkable(nx, ny) || !g.passable(x, y, d)) continue;
        seen.add(k); q.push([nx, ny]);
        minX = Math.min(minX, nx); maxX = Math.max(maxX, nx); minY = Math.min(minY, ny); maxY = Math.max(maxY, ny);
      }
    }
    if (seen.size < 12 || seen.size >= 1200) return null;         // no stage there (a corridor, an open field)
    const wide = maxX - minX >= maxY - minY;
    let up;                                                       // 'n' | 's' | 'w' | 'e'
    if (wide) up = sy - minY >= maxY - sy ? 'n' : 's';
    else up = sx - minX >= maxX - sx ? 'w' : 'e';
    return { cells: seen, minX, maxX, minY, maxY, wide, up, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  }
  onStage(x, y) { return !!this.stage?.cells.has(Math.round(x) + Math.round(y) * G.map.grid.w); }
  // a troop member's place upstage (tile coords): across the stage by its x on the original's battle screen, a
  // row and a bit off the back wall
  stageSpot(e) {
    const s = this.stage, m = this.battle?.troop?.members?.[e.memberIndex];
    if (!s || !m) return null;
    const across = THREE.MathUtils.clamp((m.x - SCREEN.mid) / SCREEN.half, -1.3, 1.3) * Math.min(8, ((s.wide ? s.maxX - s.minX : s.maxY - s.minY) / 2) - 1);
    const depth = 1.1;
    if (s.up === 'n') return [s.cx + across, s.minY + depth];
    if (s.up === 's') return [s.cx - across, s.maxY - depth];
    if (s.up === 'w') return [s.minX + depth, s.cy - across];
    return [s.maxX - depth, s.cy + across];
  }
  place(e, spot) {
    if (!spot) return;
    let [x, y] = spot;
    [x, y] = resolveCircle(x, y, Math.min(e.r || 0.35, 0.45));
    if (this.stage && !this.onStage(x, y)) {
      // (nearest cell of the stage)
      let best = null, bd = Infinity;
      for (const k of this.stage.cells) { const cx = k % G.map.grid.w, cy = (k - cx) / G.map.grid.w, d = Math.hypot(cx - x, cy - y); if (d < bd) { bd = d; best = [cx, cy]; } }
      if (best) [x, y] = best;
    }
    e.fx = x; e.fy = y; e.lastFx = undefined;
    e.knock.x = 0; e.knock.y = 0;
  }
  // the back wall's face (world): where the scenery hangs, facing the stage
  backWall() {
    const s = this.stage;
    if (!s) return null;
    const y = G.floorAt ? G.floorAt(s.cx, s.cy) : 0;
    if (s.up === 'n') return { x: (s.cx + 0.5) * T, z: s.minY * T, y, ry: 0, width: (s.maxX - s.minX + 1) * T };
    if (s.up === 's') return { x: (s.cx + 0.5) * T, z: (s.maxY + 1) * T, y, ry: Math.PI, width: (s.maxX - s.minX + 1) * T };
    if (s.up === 'w') return { x: s.minX * T, z: (s.cy + 0.5) * T, y, ry: Math.PI / 2, width: (s.maxY - s.minY + 1) * T };
    return { x: (s.maxX + 1) * T, z: (s.cy + 0.5) * T, y, ry: -Math.PI / 2, width: (s.maxY - s.minY + 1) * T };
  }
  // where the audience sits: beyond the stage's front edge
  house() {
    const s = this.stage;
    if (!s) return null;
    const d = 6;
    const at = { n: [s.cx, s.maxY + d], s: [s.cx, s.minY - d], w: [s.maxX + d, s.cy], e: [s.minX - d, s.cy] }[s.up];
    return new THREE.Vector3((at[0] + 0.5) * T, 1.6, (at[1] + 0.5) * T);
  }

  // ---- the players ------------------------------------------------------------------------------------------
  // how a player of the play stands: the white prison and the stage machine hold their place (the machine hanging
  // high over the stage while nothing can reach it), the machine's seven parts float, stage hands (a blank picture
  // and next to no HP - they stand in for what comes on later) are not there at all
  dress(e) {
    if (!this.active) return;
    const id = e.b.enemyId, d = e.data;
    e.noTarget = false; e.noAct = false;
    e.stationary = STATIONARY.has(id);
    const blank = d?.battler_name === BLANK;
    if (blank && e.b.solo().mhp < 1000) { e.noTarget = true; e.noAct = true; e.stationary = true; }
    e.chimera = this.isPart(e);
    // (the parts dance round the stage on their strings - update - and cast from wherever the dance has them)
    if (e.chimera) e.stationary = true;
    e.hoverBase = this.hangs(e) ? MACHINE.hang : e.chimera ? 0.55 : e.stationary ? (id === 566 ? 0.7 : MACHINE.float) : 0;
    if (e.hover === undefined) e.hover = e.hoverBase;
    // the machine hangs over the stage's middle, at the back
    if (this.anchored(e) && this.stage) this.place(e, this.upstageMiddle());
  }
  // the stage machine out of reach (対象不可) hangs in the flies; it and its forms in reach keep the middle of the
  // stage, at the back
  hangs(e) { return !e.noTarget && e.untargetable; }
  anchored(e) { return this.hangs(e) || e.b.enemyId === 579 || e.b.enemyId === 577; }
  // one of the machine's seven parts: a blank picture, and HP enough to be fought (a stage hand has next to none)
  isPart(e) { return e.data?.battler_name === BLANK && e.b.solo().mhp >= 1000; }
  // (combat.js ActionEnemy.build) the stage machine is drawn bigger than its picture - here, and on a co-op guest's
  // copies of the host's play (inPlay)
  scaleOf(e) { return (this.active || e.inPlay) && e.b.enemyId >= 570 && e.b.enemyId <= 579 ? MACHINE.scale : 1; }
  upstageMiddle() {
    const s = this.stage, d = 0.7;
    return { n: [s.cx, s.minY + d], s: [s.cx, s.maxY - d], w: [s.minX + d, s.cy], e: [s.maxX - d, s.cy] }[s.up];
  }
  battlerTexture(e) {
    if (!(this.active || e.inPlay) || !this.isPart(e)) return null;
    const i = ((e.memberIndex ?? 0) % PIECES.length + PIECES.length) % PIECES.length;
    const key = `piece${i}`;
    if (!this.tex.has(key)) this.tex.set(key, this.tornPiece(i));
    return this.tex.get(key);
  }
  // a torn piece of the machine's picture: its crop, cut out along a ragged edge, drawn bigger
  async tornPiece(i) {
    const src = await loadCanvas('Graphics/Battlers', 'グラン・ギニョール');
    if (!src) return null;
    const [x, y, w, h] = PIECES[i], k = 1.9, pad = 6;
    const c = document.createElement('canvas');
    c.width = Math.round(w * k) + pad * 2; c.height = Math.round(h * k) + pad * 2;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const rnd = seeded(i + 3), W = c.width - pad * 2, H = c.height - pad * 2;
    const edge = (n, f) => { const pts = []; for (let j = 0; j < n; j++) pts.push(f(j / n, (rnd() * 0.09 + (rnd() < 0.15 ? 0.06 : 0)))); return pts; };
    const pts = [
      ...edge(14, (t, r) => [pad + t * W, pad + r * H]),
      ...edge(10, (t, r) => [pad + W - r * W, pad + t * H]),
      ...edge(14, (t, r) => [pad + W - t * W, pad + H - r * H]),
      ...edge(10, (t, r) => [pad + r * W, pad + H - t * H]),
    ];
    ctx.beginPath();
    pts.forEach(([px, py], j) => (j ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.save(); ctx.clip();
    ctx.drawImage(src, x, y, w, h, pad, pad, W, H);
    ctx.restore();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = 4;
    // (how wide it is drawn: the piece itself)
    return { tex, w: c.width, h: c.height, core: W * 0.4 };
  }
  onAppear(e) {
    if (!this.active) return;
    this.dress(e);
    if (this.curtainUp() && this.curtainAxis && !this.anchored(e)) this.place(e, this.behindCurtain(e));
  }
  onTransform(e) {
    if (!this.active) return;
    e.hover = undefined;
    this.dress(e);
    if (this.curtainUp() && this.curtainAxis && !this.anchored(e)) this.place(e, this.behindCurtain(e));
    // the machine's last form comes down from the flies to be fought
    if (e.b.enemyId === 577) { e.hover = MACHINE.hang; e.dropping = { t: 0 }; }
  }
  // the combat system's boss rule, for the last act: the machine's seven parts are its players (and the machine
  // itself once it can be reached)
  bossesOf(b, on) {
    if (!this.active || b !== this.battle) return undefined;
    const parts = on.filter(e => e.chimera);
    if (!parts.length) return undefined;
    return on.filter(e => e.chimera || e.b.enemyId === 577);
  }
  familyOf(e, s) {
    if (!this.active || !s || e.battle !== this.battle) return undefined;
    return Object.prototype.hasOwnProperty.call(FAMILY, s.id) ? FAMILY[s.id] : undefined;
  }
  // nobody moves while the curtain is up (the original's battle stands still while its events run)
  holds(e) { return this.active && e.battle === this.battle && (this.curtainUp() || e.noAct); }
  // a battle animation played on one of the players: the curtain that follows closes in front of that one
  animated(e) { if (this.active && e.battle === this.battle) this.lastAnimated = e; }

  // ---- the curtain ----------------------------------------------------------------------------------------------
  curtainUp() { return !!this.up; }
  takePicture(p) {
    if (!this.active || !CURTAIN_PIC.test(p?.[1] || '')) return false;
    this.curtainPic = p[0];
    this.showCurtain(p[1]);
    return true;
  }
  erasePicture(n) {
    if (!this.active || n !== this.curtainPic) return false;
    this.curtainPic = null;
    this.openCurtain();
    return true;
  }
  showCurtain(name) {
    if (!this.curtain) this.hangCurtain();
    const face = this.curtainFace, t = this.tex.get(`Graphics/Pictures/${name}`)?.ready;
    if (t && face.material.map !== t) { face.material.map = t; face.material.needsUpdate = true; }
    // (drawn once its picture is there - the cloth with it, once it is cut)
    face.visible = !!face.material.map;
    this.dressCloth();
    if (!this.up) this.stopTheAct();
    this.up = true;
    this.closed = name === '幕';
  }
  // the curtain comes down on the stage, in its opening, wherever the player is - before them from the house or the lip,
  // behind them up on the stage, as a theatre's: its picture as big as it always was at the foot of the opening's middle,
  // the cloth round it out to the side walls and up to the back wall's top. No stage found: between the player and where
  // they look, the act's last lead (the one its animation played on) behind it if it stands that way
  hangCurtain() {
    const at = this.proscenium(), group = new THREE.Group();
    let w, top;
    if (at) {
      group.position.set(at.x, at.y, at.z);
      group.rotation.y = at.ry;
      w = at.w; top = at.h;
      this.curtainAxis = { stage: true };
    } else {
      const head = G.player.headWorld(new THREE.Vector3());
      let f = G.player.forward2D();
      const lead = this.lastAnimated?.alive !== false ? this.lastAnimated : null;
      if (lead) {
        const p = lead.worldPos(tmp), dx = p.x - head.x, dz = p.z - head.z, d = Math.hypot(dx, dz);
        // (toward it when it is somewhere ahead; else where the player looks)
        if (d > 0.5 && (dx * f.x + dz * f.z) / d > 0.2) f = { x: dx / d, z: dz / d };
      }
      const cx = head.x + f.x * CURTAIN.dist, cz = head.z + f.z * CURTAIN.dist;
      group.position.set(cx, G.floorAt ? G.floorAt(cx / T - 0.5, cz / T - 0.5) : 0, cz);
      group.rotation.y = Math.atan2(-f.x, -f.z);
      w = CURTAIN.w * (1 + 2 * CURTAIN.wings); top = CURTAIN.w * 0.75 * (1 + CURTAIN.up);
      this.curtainAxis = { x: head.x, z: head.z, ux: f.x, uz: f.z };
    }
    // (the picture narrower on a stage too narrow for it; the cloth's folds as wide as the picture's own)
    const W = Math.min(CURTAIN.w, w), H = W * 0.75, fold = (CLOTH[2] - CLOTH[0]) * W / 640;
    top = Math.max(top, H);
    const face = new THREE.Mesh(rects([[-W / 2, 0, W / 2, H]], (x, y) => [(x + W / 2) / W, y / H]), curtainMaterial());
    const cloth = new THREE.Mesh(rects([[-w / 2, 0, -W / 2, top], [W / 2, 0, w / 2, top], [-W / 2, H, W / 2, top]],
      (x, y) => [x / fold, y / top]), curtainMaterial());
    for (const m of [face, cloth]) { m.renderOrder = 2; m.visible = false; group.add(m); }
    this.root.add(group);
    this.curtain = group; this.curtainFace = face; this.curtainCloth = cloth;
  }
  // the cloth round the picture, once it is cut - drawn with the picture
  dressCloth() {
    const m = this.curtainCloth, t = this.cloth().ready;
    if (!m || !t) return;
    if (m.material.map !== t) { m.material.map = t; m.material.needsUpdate = true; }
    m.visible = !!this.curtainFace?.visible;
  }
  // the curtain's cloth (CLOTH), cut out of the closed picture once it is there: { promise, ready }
  cloth() {
    if (!this.tex.has('cloth')) {
      const entry = { ready: null };
      entry.promise = this.texture('Graphics/Pictures', '幕').promise.then(pic => {
        if (!pic) return null;
        const img = pic.image, kx = img.width / 640, ky = img.height / 480, [x0, y0, x1, y1] = CLOTH;
        const c = document.createElement('canvas');
        c.width = Math.round((x1 - x0) * kx); c.height = Math.round((y1 - y0) * ky);
        c.getContext('2d').drawImage(img, x0 * kx, y0 * ky, c.width, c.height, 0, 0, c.width, c.height);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.MirroredRepeatWrapping;
        tex.anisotropy = 8;
        entry.ready = tex;
        this.dressCloth();
        return tex;
      });
      this.tex.set('cloth', entry);
    }
    return this.tex.get('cloth');
  }
  // the curtain taken down: its parts let go (their pictures stay loaded for the next time)
  dropCurtain() {
    if (!this.curtain) return;
    this.root.remove(this.curtain);
    for (const m of this.curtain.children) { m.geometry.dispose(); m.material.dispose(); }
    this.curtain = this.curtainFace = this.curtainCloth = null;
  }
  // the stage's opening (world): its front edge - the line between the stage and what lies before it (its lip, the
  // house) - from the wall beside its front row on one side to the one on the other (the stage's own sides when none
  // stands within reach), from the stage's floor up to its back wall's top (the picture's own height if it has none)
  proscenium() {
    const s = this.stage, mesh = G.view?.mesh, g = G.map?.grid;
    if (!s || !mesh || !g || !G.solidTopAt) return null;
    // (across the stage / its depth -> cell; the front row, the edge line before it, the back wall's row)
    const ns = s.up === 'n' || s.up === 's';
    const cell = (a, d) => (ns ? [a, d] : [d, a]);
    const solid = (a, d) => { const [x, y] = cell(a, d); return g.valid(x, y) && mesh.isSolid(x, y); };
    const a0 = ns ? s.minX : s.minY, a1 = ns ? s.maxX : s.maxY;
    const front = { n: s.maxY, s: s.minY, w: s.maxX, e: s.minX }[s.up];
    const line = { n: s.maxY + 1, s: s.minY, w: s.maxX + 1, e: s.minX }[s.up];
    const back = { n: s.minY - 1, s: s.maxY + 1, w: s.minX - 1, e: s.maxX + 1 }[s.up];
    let lo = a0, hi = a1 + 1;
    for (let k = 1; k <= CURTAIN.sideReach; k++) if (solid(a0 - k, front)) { lo = a0 - k + 1; break; }
    for (let k = 1; k <= CURTAIN.sideReach; k++) if (solid(a1 + k, front)) { hi = a1 + k; break; }
    const floor = G.floorAt ? G.floorAt(...cell((a0 + a1) / 2, front)) : 0;
    let top = 0;
    for (let a = a0; a <= a1; a++) if (solid(a, back)) top = Math.max(top, G.solidTopAt(...cell(a, back)) * T);
    const w = (hi - lo) * T, h = top > floor + 1 ? top - floor : w * 0.75;
    const mid = (lo + hi) / 2 * T, at = line * T;
    const up = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[s.up];
    return { x: ns ? mid : at, z: ns ? at : mid, y: floor, w, h, ry: Math.atan2(-up[0], -up[1]) };
  }
  openCurtain() {
    this.dropCurtain();
    this.up = false;
    this.closed = false;
    if (this.oldBackdrop) { this.root.remove(this.oldBackdrop); this.oldBackdrop = null; }
  }
  // the act is over: whatever was going on stops (a blow half wound up, shots in the air, pools on the floor)
  stopTheAct() {
    const C = G.combat;
    for (const e of this.battle?.enemies || []) {
      if (e.state === 'windup' || e.state === 'act') { C.dropMarker(e); C.hideBlade(e); e.move = null; e.act = null; e.state = 'recover'; e.timer = 0.6; }
    }
    C.clearEnemyFx?.(this.battle);
  }
  // a new player's place behind the curtain: the stage's - its place upstage, as the play began; else across it by its
  // place on the original's battle screen
  behindCurtain(e) {
    if (this.curtainAxis.stage) return this.stageSpot(e);
    const a = this.curtainAxis, m = this.battle?.troop?.members?.[e.memberIndex];
    const across = m ? THREE.MathUtils.clamp((m.x - SCREEN.mid) / SCREEN.half, -1.3, 1.3) * BEHIND.spread : 0;
    const d = CURTAIN.dist + BEHIND.depth;
    const x = a.x + a.ux * d - a.uz * across, z = a.z + a.uz * d + a.ux * across;
    let spot = [x / T - 0.5, z / T - 0.5];
    // (no room for it there - the stage ends: its own place upstage)
    if (this.stage && !this.onStage(...spot)) spot = this.stageSpot(e) || spot;
    return spot;
  }

  // ---- the scenery (Change Battle Back) -------------------------------------------------------------------------
  battleBack(name) {
    if (!this.active) return false;
    const wall = this.backWall();
    if (!wall || !name) return true;
    const entry = this.texture('Graphics/Battlebacks1', name);
    entry.promise.then(tex => {
      if (!tex || !this.active) return;
      const img = tex.image, aspect = img.width / img.height;
      let w = Math.min(BACKDROP.maxW, wall.width), h = w / aspect;
      if (h > BACKDROP.maxH) { h = BACKDROP.maxH; w = h * aspect; }
      const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, fog: false });
      mat.color.setScalar(0.85);
      const geo = new THREE.PlaneGeometry(w, h);
      // the original's battle screen (544 x 416) shows it centred, its enemies standing on it at y 296: that line of
      // the picture is the stage's floor (what is below it goes under the floor)
      const ground = THREE.MathUtils.clamp((296 + (img.height - 416) / 2) / img.height, 0.4, 0.9);
      geo.translate(0, h / 2 - (1 - ground) * h, 0);
      const mesh = new THREE.Mesh(geo, mat);
      // (just off the wall's face, toward the stage)
      const nx = Math.sin(wall.ry), nz = Math.cos(wall.ry);
      mesh.position.set(wall.x + nx * 0.06, wall.y, wall.z + nz * 0.06);
      mesh.rotation.y = wall.ry;
      mesh.renderOrder = 1;
      if (this.backdrop) {
        // (behind a closed curtain the change is not seen; otherwise the old one fades)
        if (this.curtainUp()) { this.root.remove(this.backdrop); } else { this.oldBackdrop = this.backdrop; this.fadeOld = 0; }
      }
      this.root.add(mesh);
      this.backdrop = mesh;
      this.backdropT = this.curtainUp() ? 1 : 0;
    });
    return true;
  }
  // a picture as a texture, loaded once: { promise, ready }
  texture(folder, name) {
    const key = `${folder}/${name}`;
    if (!this.tex.has(key)) {
      const entry = { ready: null };
      entry.promise = loadImage(folder, name).then(img => {
        if (!img) return null;
        // (the curtain's pictures without the light lines along their edges - edgeless)
        const t = new THREE.Texture(folder === 'Graphics/Pictures' && CURTAIN_PIC.test(name) ? edgeless(img) : img);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        t.needsUpdate = true;
        entry.ready = t;
        return t;
      });
      this.tex.set(key, entry);
    }
    return this.tex.get(key);
  }

  // ---- sounds from the house ------------------------------------------------------------------------------------
  playSe(se) {
    if (!this.active || !se?.name || !/Applause|Laughter|拍手|歓声|笑い/i.test(se.name)) return false;
    const h = this.house();
    if (!h) return false;
    // (two voices, a little apart, so it fills the house)
    const s = this.stage, side = s.wide ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    for (const k of [-1, 1]) G.audio?.playSe({ ...se, volume: (se.volume ?? 100) * 0.8 }, h.clone().addScaledVector(side, k * 5 * T), { ref: 8 });
    return true;
  }

  // ---- every frame -------------------------------------------------------------------------------------------------
  update(dt) {
    if (!this.active) { this.watchPlay(); return; }
    // a curtain left hanging (its event cut short): down after a while
    if (this.curtain && !G.combat.battles.some(b => b === this.battle && b.troopInterp?.running())) {
      this.curtainIdle = (this.curtainIdle || 0) + dt;
      if (this.curtainIdle > 4) { this.curtainPic = null; this.openCurtain(); }
    } else this.curtainIdle = 0;
    // the scenery fading in, the old one out
    if (this.backdrop && this.backdropT < 1) {
      this.backdropT = Math.min(1, this.backdropT + dt / 1.2);
      this.backdrop.material.transparent = this.backdropT < 1;
      this.backdrop.material.opacity = this.backdropT;
    }
    if (this.oldBackdrop) {
      this.fadeOld += dt / 1.2;
      this.oldBackdrop.material.transparent = true;
      this.oldBackdrop.material.opacity = Math.max(0, 1 - this.fadeOld);
      if (this.fadeOld >= 1) { this.root.remove(this.oldBackdrop); this.oldBackdrop = null; }
    }
    const enemies = this.battle?.enemies || [];
    const machine = enemies.find(e => e.alive && !e.hidden && e.b.enemyId >= 570 && e.b.enemyId <= 577);
    for (const e of enemies) {
      if (!e.mesh) continue;
      // floating, hanging, coming down from the flies
      if (e.dropping) {
        e.dropping.t += dt;
        const k = THREE.MathUtils.smootherstep(Math.min(1, e.dropping.t / MACHINE.drop), 0, 1);
        e.hover = MACHINE.hang + (MACHINE.float - MACHINE.hang) * k;
        if (k >= 1) e.dropping = null;
      } else if (e.hoverBase !== undefined) {
        const bob = e.chimera ? Math.sin(G.time * 1.7 + e.memberIndex * 1.3) * 0.12 : e.stationary ? Math.sin(G.time * 0.9 + e.memberIndex) * 0.06 : 0;
        e.hover = e.hoverBase + bob;
      }
      if (e.untargetable && e.bar) e.bar.visible = false;
    }
    this.dance(enemies, dt);
    this.updateStrings(enemies, machine);
    this.updateSpots(enemies, machine, dt);
  }
  // the machine's parts go round the stage in a ring (as wide as the stage lets it), slowly, evenly spaced - a dance
  // of marionettes; one making a move of its own goes where that takes it and comes back into the ring after
  dance(enemies, dt) {
    const s = this.stage;
    if (!s || this.curtainUp()) return;
    const parts = enemies.filter(e => e.chimera && e.alive && !e.hidden && e.mesh).sort((a, b) => a.memberIndex - b.memberIndex);
    if (!parts.length) return;
    const half = (s.wide ? s.maxX - s.minX : s.maxY - s.minY) / 2, thin = (s.wide ? s.maxY - s.minY : s.maxX - s.minX) / 2;
    const ra = Math.min(8, half - 1), rb = Math.max(0.6, thin - 0.5);
    this.danceT = (this.danceT || 0) + dt * 0.12;
    parts.forEach((e, i) => {
      if (e.state === 'windup' || e.state === 'act' || e.state === 'stagger') return;
      const a = this.danceT + i * Math.PI * 2 / parts.length;
      const [tx, ty] = s.wide ? [s.cx + Math.cos(a) * ra, s.cy + Math.sin(a) * rb] : [s.cx + Math.sin(a) * rb, s.cy + Math.cos(a) * ra];
      const dx = tx - e.fx, dy = ty - e.fy, d = Math.hypot(dx, dy), step = Math.min(d, 1.8 * dt);
      if (d > 0.01) { e.fx += dx / d * step; e.fy += dy / d * step; }
    });
  }
  // (a co-op guest: the host's play as its copies of the players show it - the machine's parts on their strings; the
  // rest of the staging - curtain, scenery, lights - is the host's own)
  watchPlay() {
    const cast = [];
    for (const e of G.combat?.puppets?.values() || []) if (e.inPlay) { e.chimera = this.isPart(e); cast.push(e); }
    if (!cast.length && !this.strings.size) return;
    this.updateStrings(cast, cast.find(e => e.alive && !e.hidden && e.b.enemyId >= 570 && e.b.enemyId <= 577));
  }
  // the machine up in the flies, out of reach (対象不可) - a co-op guest's copy of it: as the host's is (4)
  flown(m) { return !!m && (m.puppet ? !!(m.netFlags & 4) : m.untargetable); }
  // the parts hang from the machine on strings: a line from the top of each up to it
  updateStrings(enemies, machine) {
    const live = new Set();
    if (this.flown(machine)) {
      const top = machine.worldPos(new THREE.Vector3());
      top.y += (machine.hover || 0) + (machine.h || 2.8) * 0.35;
      for (const e of enemies) {
        if (!e.chimera || !e.alive || e.hidden || !e.mesh) continue;
        live.add(e);
        let s = this.strings.get(e);
        if (!s) {
          s = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 1, 5, 1, true),
            new THREE.MeshBasicMaterial({ color: 0xd8cfc0, transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false }));
          this.root.add(s);
          this.strings.set(e, s);
        }
        const from = e.worldPos(new THREE.Vector3());
        from.y += (e.hover || 0) + (e.h || 1.5) * 0.92;
        const to = top.clone().add(new THREE.Vector3((e.memberIndex - 3) * 0.6, 0, 0));
        const dir = to.clone().sub(from), len = dir.length();
        s.position.copy(from).addScaledVector(dir, 0.5);
        s.scale.set(1, Math.max(0.01, len), 1);
        s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      }
    }
    for (const [e, s] of this.strings) {
      if (live.has(e)) continue;
      // (cut: a part fallen; or the machine come down)
      this.root.remove(s); s.geometry.dispose(); s.material.dispose();
      this.strings.delete(e);
      if (this.flown(machine) && !e.alive) {
        const p = e.worldPos(new THREE.Vector3()); p.y += (e.h || 1.5);
        G.combat.spawnGlow?.(p, { color: 0xfff0d0, size: 0.4, life: 0.25, grow: 2 });
        G.audio?.playSe(G.seAt('Sword1', 70, 150), p);
      }
    }
  }
  // a spotlight from the flies on each of the act's leads (two at most; the machine alone in the last act), following
  // it. The lights are hung once for the whole play - a light coming or going would have the renderer rebuild every
  // lit material, a hitch in the headset - and only turned up and down
  updateSpots(enemies, machine, dt) {
    let leads = enemies.filter(e => e.boss && e.alive && !e.hidden && e.mesh);
    if (leads.length > SPOT.n) leads = machine ? [machine] : leads.slice(0, SPOT.n);
    if (!leads.length && machine) leads = [machine];
    if (this.curtainUp()) leads = [];
    if (!this.spotPool) this.spotPool = Array.from({ length: SPOT.n }, () => this.makeSpot());
    // (a lead keeps its light while it stays a lead)
    for (const s of this.spotPool) if (s.e && !leads.includes(s.e)) s.want = 0;
    for (const e of leads) {
      let s = this.spotPool.find(x => x.e === e);
      if (!s) s = this.spotPool.find(x => !x.e || x.k <= 0);
      if (!s) continue;
      if (s.e !== e) { s.e = e; s.k = 0; }
      s.want = 1;
    }
    for (const s of this.spotPool) {
      s.k = THREE.MathUtils.clamp(s.k + (s.want ? dt / 0.6 : -dt / 0.4), 0, 1);
      if (s.k <= 0 && !s.want) s.e = null;
      s.light.intensity = SPOT.intensity * s.k;
      s.cone.visible = s.k > 0;
      if (!s.e) continue;
      const p = s.e.worldPos(new THREE.Vector3());
      s.light.position.set(p.x, p.y + SPOT.height, p.z + 0.01);
      s.light.target.position.set(p.x, p.y, p.z);
      s.cone.position.set(p.x, p.y + SPOT.height / 2, p.z);
      s.cone.material.opacity = 0.055 * s.k;
    }
  }
  makeSpot() {
    const light = new THREE.SpotLight(SPOT.color, 0, SPOT.height * 2.2, Math.atan(SPOT.radius / SPOT.height) * 1.25, 0.55, 1.4);
    this.root.add(light); this.root.add(light.target);
    // the beam: a faint cone of light down from the flies, fading out toward the top
    const geo = new THREE.CylinderGeometry(0.12, SPOT.radius, SPOT.height, 24, 1, true);
    const cone = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: SPOT.color, alphaMap: beamTexture(), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false }));
    cone.renderOrder = 3;
    cone.visible = false;
    this.root.add(cone);
    return { light, cone, k: 0, want: 0, e: null };
  }
}
