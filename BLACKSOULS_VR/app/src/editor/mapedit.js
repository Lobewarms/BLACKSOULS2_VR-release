// The rule editor (mapedit.html - in the share package too: the launcher's 규칙 편집기; map_editor.cmd here): the player's own
// rules, over BLACK SOULS II's own and the general ones, saved in the saves folder as user_rules.json (userrules.js; POST
// /api/userrules - server.py, the launcher). The game reads them as it starts and each time it goes to a map, and a game open in
// this browser takes them at once (the USER_RULES_CHANNEL: main.js).
// 맵: pick a map, fly round it as the game builds it (src/mapbuild.js) and change its rules - the map hints of src/maphints.js:
// heights, things standing as pictures, drops... - with the map built again at once. Steps on the page: 1 a map, 2 the cells
// (a click, a drag - in 2D or in 3D; with Ctrl more places at once), 3 a rule, 4 its values and 추가 (a rule for each place); rules
// picked from the list (Ctrl: more of one kind) take changed values at once. The 3D view turns with the wheel (middle button)
// held. 동료 / 적: roster.js; 장비·스킬: itemedit.js.
import * as THREE from 'three';
import { initAssets, loadImage } from '../assets.js';
import { $data, loadDatabase, loadMap } from '../data.js';
import { MapGrid, render2D, billboardUniforms, T, loadTilesetImages } from '../mapmesh.js';
import { TileDrawer, TS, TILE, isA5 } from '../tiles.js';
import { buildMapView } from '../mapbuild.js';
import { MAP_HINTS, BUILTIN_HINTS, hintsOf, ruleSource, setUserMap, setUserMaps, useBuiltinRules, builtinRules } from '../maphints.js';
import { loadUserRules, setUserRules, cleanRules, rulesText, USER_RULES_API, USER_RULES_CHANNEL } from '../userrules.js';
import { initRoster } from './roster.js';
import { initItems } from './itemedit.js';
import { lockPointerRaw, MouseFilter } from '../mouselook.js';

const $ = id => document.getElementById(id);
const clone = o => JSON.parse(JSON.stringify(o));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const fmt = n => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '-');
const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
// numbers typed as a list ("3, 4 11")
const parseList = s => String(s).split(/[,\s]+/).filter(Boolean).map(Number).filter(n => Number.isInteger(n) && n >= 0);

// ---------------------------------------------------------------- the rules
// over a rectangle of cells: [x0, y0, x1, y1, ...what it takes] - its name, what it asks for, how it is written and listed
const rectOf = (r, ...rest) => [r.x0, r.y0, r.x1, r.y1, ...rest];
const RECT = [
  { type: 'floors', key: 'floors', name: '바닥 높이', color: '#4aa3ff', match: e => e[6] !== 'x',
    desc: '걸을 수 있는 칸의 높이. 북쪽 끝에서 남쪽 끝까지 고르게 기울어집니다 (같은 값이면 평평, 다르면 남북으로 오르내리는 계단·경사).',
    params: [{ k: 'hN', label: '북쪽 끝' }, { k: 'hS', label: '남쪽 끝' }],
    make: (r, p) => rectOf(r, p.hN, p.hS), read: e => ({ hN: e[4], hS: e[5] }), text: e => `북 ${e[4]} → 남 ${e[5]}칸` },
  { type: 'floorsX', key: 'floors', name: '옆으로 난 계단', color: '#7ad0ff', match: e => e[6] === 'x',
    desc: '서쪽 끝에서 동쪽 끝까지 한 칸에 한 단씩 오르내리는 계단 (옆에서 그린 계단 - 그 그림은 단 위에 눕습니다).',
    params: [{ k: 'hW', label: '서쪽 끝' }, { k: 'hE', label: '동쪽 끝' }],
    make: (r, p) => rectOf(r, p.hW, p.hE, 'x'), read: e => ({ hW: e[4], hE: e[5] }), text: e => `서 ${e[4]} → 동 ${e[5]}칸` },
  { type: 'tops', key: 'tops', name: '블록 높이 정하기', color: '#ff8a4a',
    desc: '벽·건물 블록의 윗면 높이를 이 값으로 (올리거나 내림).',
    params: [{ k: 'top', label: '윗면' }], make: (r, p) => rectOf(r, p.top), read: e => ({ top: e[4] }), text: e => `윗면 ${e[4]}칸` },
  { type: 'caps', key: 'caps', name: '블록 높이 제한', color: '#ffb36b',
    desc: '블록이 이 높이보다 높으면 여기까지만 (높은 바닥의 앞벽이 그 바닥보다 솟을 때).',
    params: [{ k: 'top', label: '최대' }], make: (r, p) => rectOf(r, p.top), read: e => ({ top: e[4] }), text: e => `최대 ${e[4]}칸` },
  { type: 'lips', key: 'lips', name: '낮은 턱', color: '#c9a0ff',
    desc: '못 지나가는 칸을 블록 대신 낮은 턱으로 (무대의 앞단처럼). 높이는 옆의 높은 바닥에서 잽니다.',
    params: [{ k: 'h', label: '높이', def: 0.1 }], make: (r, p) => rectOf(r, p.h), read: e => ({ h: e[4] }), text: e => `높이 ${e[4]}칸` },
  { type: 'onWall', key: 'onWall', name: '벽에 그려진 대로', color: '#e0a060',
    desc: '벽 칸 위에 그려진 이벤트(교수대에 매달린 사람처럼)를 그 벽면 발치부터 그림대로 붙입니다 — 앞의 낮은 무대·턱이 그 앞면 위로 들어 올리지 않게. 띄우기: 발치에서 그만큼 위에 (무대 위로 매달리게). 앞으로: 벽에서 그만큼 앞에 (세워 둔 교수대 앞에).',
    params: [{ k: 'up', label: '띄우기', def: 0 }, { k: 'out', label: '앞으로', def: 0 }], make: (r, p) => rectOf(r, p.up, p.out), read: e => ({ up: e[4] || 0, out: e[5] || 0 }),
    text: e => [e[4] ? `${e[4]}칸 띄움` : '', e[5] ? `${e[5]}칸 앞` : ''].filter(Boolean).join(' · ') },
  { type: 'props', key: 'props', name: '블록 대신 그림으로', color: '#5fd38d',
    desc: '여기 그려진 물건들이 벽과 한 덩어리 블록이 되지 않고, 하나씩 그림으로 섭니다 (상자·통·놀이기구).',
    params: [], make: r => rectOf(r), read: () => ({}), text: () => '' },
  { type: 'whole', key: 'whole', name: '한 덩어리 그림', color: '#3cc0a0',
    desc: '여러 칸에 걸쳐 그린 큰 물건(회전목마, 텐트)의 모든 열을 맨 아랫줄에 세워 한 물건으로. 보통 "블록 대신 그림으로"와 함께 씁니다. "벽 위 그림도": 벽 칸 위에 그려진 부분(벽에 반쯤 걸쳐 그린 교수대)까지 함께 세움.',
    params: [{ k: 'all', label: '벽 위 그림도', type: 'check' }], make: (r, p) => (p.all ? rectOf(r, 'all') : rectOf(r)), read: e => ({ all: e[4] === 'all' }), text: e => (e[4] === 'all' ? '벽 위 그림도' : '') },
  { type: 'cabinets', key: 'cabinets', name: '몇 줄씩 끊어 세우기', color: '#9bd35f',
    desc: '앞뒤로 붙여 그린 가구(장식장)를 이 줄 수마다 따로 세웁니다. 보통 "블록 대신 그림으로"와 함께 씁니다.',
    params: [{ k: 'n', label: '줄 수', def: 2, step: 1 }], make: (r, p) => rectOf(r, p.n), read: e => ({ n: e[4] }), text: e => `${e[4]}줄씩` },
  { type: 'solids', key: 'solids', name: '블록에 넣기 (틈 메우기)', color: '#d35f5f',
    desc: '걸을 수 있거나 물 타일로 그려져 건물 정면에 틈으로 뚫린 칸을 블록에 넣습니다.',
    params: [], make: r => rectOf(r), read: () => ({}), text: () => '' },
  { type: 'wallFloors', key: 'wallFloors', name: '벽 타일을 바닥으로', color: '#5f8fd3',
    desc: '벽 타일로 그린 계단 같은 곳을 바닥으로 짓습니다 (높이는 "바닥 높이" 규칙으로 정하세요).',
    params: [], make: r => rectOf(r), read: () => ({}), text: () => '' },
  { type: 'hideArt', key: 'hideArt', name: '3D에서 빼는 그림 조각', color: '#b0b0ff',
    desc: '위층에 그린 조각 중 이 타일 번호들을 3D에서 뺍니다 (벽을 타고 그린 계단의 발치가 벽 앞에 튀어나와 공중에 뜬 판자로 서던 곳). 지나다니는 것은 원작 그대로.',
    params: [{ k: 'ids', label: '타일 번호', type: 'list' }], make: (r, p) => rectOf(r, p.ids), read: e => ({ ids: e[4] || [] }),
    text: e => `타일 ${(e[4] || []).join(', ')}` },
  { type: 'fightWays', key: 'fightWays', name: '보스전 동안 열리는 칸', color: '#ff5f8f',
    desc: '보스전이 벌어지는 동안 열리는 칸 (원작에서는 보이지 않는 타일로 막혀 있고, 전투는 전투 화면에서 했던 곳): 플레이어와 적 모두 양쪽으로 지나다니며 그 너머 땅으로 갑니다. 그 너머에서 블록으로 선 곳은 그대로 막힙니다.',
    params: [], make: r => rectOf(r), read: () => ({}), text: () => '' },
  { type: 'abyss', key: 'abyss', name: '낭떠러지', color: '#9a9a9a',
    desc: '검게 그린 곳을 막힌 벽 대신 아래로 트인 낭떠러지로. "닿지 않는 칸 전부"는 벽 위 타일·장식처럼 플레이어가 못 가는 곳까지 낭떠러지로 만듭니다. "옆에서 그린 낭떠러지"는 걸을 수 없는 칸을 모두 낭떠러지로 하되, 발판 아래에 그려진 그림(기둥 몸통 등)은 그 발판 아래로 그려진 만큼 매달립니다 (H루트 탈출２).',
    params: [{ k: 'depth', label: '깊이', def: 6 }, { k: 'all', label: '닿지 않는 칸 전부', type: 'check' }, { k: 'hang', label: '옆에서 그린 낭떠러지', type: 'check' }],
    make: (r, p) => (p.hang ? rectOf(r, p.depth, 'hang') : p.all ? rectOf(r, p.depth, 'all') : rectOf(r, p.depth)),
    read: e => ({ depth: e[4] ?? 6, all: e[5] === 'all', hang: e[5] === 'hang' }),
    text: e => `깊이 ${e[4] ?? 6}칸${e[5] === 'all' ? ' · 닿지 않는 칸 전부' : e[5] === 'hang' ? ' · 옆에서 그린 낭떠러지' : ''}` },
];
// at one cell: [x, y] (the selection's top-left cell)
const CELL = [
  { type: 'walkedTo', key: 'walkedTo', name: '걸을 수 있는 곳으로 치기', color: '#ffe36b', cell: true, params: [],
    desc: '장면이 플레이어를 걸어서 데려가는 곳처럼 걸어서는 못 가는 곳을, 걸을 수 있는 곳으로 지어 둡니다 (고른 영역의 왼쪽 위 칸에서 이어진 곳 전부).' },
  { type: 'doorTops', key: 'doorTops', name: '두 칸 높이 문의 윗칸', color: '#ff6bd5', cell: true, params: [],
    desc: '정면에 두 줄로 그린 문의 윗칸 (문 위로 벽이 이어지게).' },
];
const ALL = [...RECT, ...CELL];
// the rule list (3 규칙 고르기), in groups
const GROUPS = [['높이', ['floors', 'floorsX', 'tops', 'caps', 'lips']], ['그림으로 세우기', ['props', 'whole', 'cabinets', 'onWall', 'hideArt']],
  ['블록·바닥 바꾸기', ['solids', 'wallFloors', 'abyss']], ['보스전', ['fightWays']], ['한 칸 (고른 곳의 왼쪽 위 칸)', ['walkedTo', 'doorTops']]];
// set in the 맵 전체 section
const MAP_WIDE = ['wallCap', 'openSky', 'overlaps', 'massBackdrop', 'mounds', 'highGround', 'sideView', 'stairs', 'terraces', 'flatPictures', 'openFights'];
const KNOWN = new Set([...ALL.map(d => d.key), ...MAP_WIDE]);

// ---------------------------------------------------------------- state
const S = {
  tab: 'map',                         // 맵 / 동료 (ally) / 적 (foe) / 장비·스킬 (item)
  id: 0, map: null, grid: null, mesh: null, seeds: [],
  user: {}, comp: {}, foes: {},       // the player's rules as edited: maps, companions, enemies (userrules.js)
  items: { weapons: {}, armors: {}, skills: {} },          // ... weapons, armors, skills (itemedit.js)
  saved: { maps: {}, companions: {}, enemies: {}, weapons: {}, armors: {}, skills: {} },         // ... as saved
  sels: [],                           // the places picked: { x0, y0, x1, y1 } each (Ctrl adds one) - the last the main one
  pick: null,                         // the rules picked from the list, or just added: { key, indices: [...], type }
  img2d: null, zoom: 0.75, hover: null,
  showEvents: true, fog: false,
};
const mainSel = () => S.sels[S.sels.length - 1] || null;
const cellRect = c => ({ x0: c.x, y0: c.y, x1: c.x, y1: c.y });
const spanRect = (a, b) => ({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) });
const inRect = (r, c) => c.x >= r.x0 && c.x <= r.x1 && c.y >= r.y0 && c.y <= r.y1;
const unionSel = () => (S.sels.length ? S.sels.reduce((a, r) => ({ x0: Math.min(a.x0, r.x0), y0: Math.min(a.y0, r.y0), x1: Math.max(a.x1, r.x1), y1: Math.max(a.y1, r.y1) })) : null);
// the cells a rule of the list stands on
const itemRect = (d, it) => (d.cell ? { x0: it[0], y0: it[1], x1: it[0], y1: it[1] } : { x0: it[0], y0: it[1], x1: it[2], y1: it[3] });
const picked = (key, i) => !!S.pick && S.pick.key === key && S.pick.indices.includes(i);
let statusTimer = 0;
// the line at the 3D view's top left: kind 'bad' (red), 'ok' (green a moment: a change built - 반영됨)
const status = (t, kind = '') => {
  const s = $('status');
  s.textContent = t; s.style.color = kind === 'bad' ? 'var(--bad)' : ''; s.className = kind === 'ok' ? 'ok' : '';
  clearTimeout(statusTimer);
  if (kind === 'ok') statusTimer = setTimeout(() => { s.className = ''; }, 1500);
};
// the current map's rules, to change: they become the player's for it - starting from BLACK SOULS II's when those apply here
function entry() {
  if (!S.user[S.id]) { S.user[S.id] = ruleSource(S.id) === 'bs2' ? clone(BUILTIN_HINTS[S.id]) : {}; setUserMap(S.id, S.user[S.id]); }
  return S.user[S.id];
}
const current = () => hintsOf(S.id) || {};
const allRules = () => ({ maps: S.user, companions: S.comp, enemies: S.foes, ...S.items });
const anyUnsaved = () => rulesText(allRules()) !== rulesText(S.saved);
// the game's view of the player's rules (allies.js, combat/common.js read it) as edited
const syncRules = () => setUserRules(allRules());
// where a map's rules come from (maphints.js ruleSource)
const SOURCE_TEXT = {
  user: '내 규칙 (saves/user_rules.json) — 블랙소울 전용 규칙보다 먼저 적용',
  bs2: '블랙소울 전용 규칙 (src/maphints.js)',
  off: '블랙소울 전용 규칙이 있지만 끄고 보는 중 — 일반 규칙으로 지어짐',
  other: '블랙소울 전용 규칙이 있지만 이 게임의 맵이 아님 (크기·타일셋이 다름) — 일반 규칙으로 지어짐',
  '': '규칙 없음 — 원작 그림대로 일반 규칙으로 지어짐',
};

// ---------------------------------------------------------------- 3D
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
$('view').prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0b10);
const fog = new THREE.Fog(0x0b0b10, 200, 300);   // (the game's: only at the end of its view, 200-300 m - main.js)
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 600);
camera.rotation.order = 'YXZ';
scene.add(new THREE.HemisphereLight(0xc8c8e0, 0x403830, 1.8));
const torch = new THREE.PointLight(0xffd8a0, 30, 16, 1.4);
scene.add(torch);
const marks = new THREE.Group();          // the events, as small pillars
scene.add(marks);
let selBox = null;

function resize() {
  const el = $('view');
  renderer.setSize(el.clientWidth, el.clientHeight);
  camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

const keys = {};
let speed = 5;
addEventListener('keydown', e => {
  if (typing() || S.tab !== 'map') return;
  keys[e.code] = true;
  if (e.code === 'KeyF') pickAtCross(false);
  if (e.code === 'KeyG') pickAtCross(true);
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
// the 3D view: the right button held and the mouse moved turns it - the cursor hidden and held for it, so the view turns on
// and on, never stopped at the screen's edge (as in Unity / Blender), back when the button is let go; the game's mouse look
// (mouselook.js: raw movement, a jump of the hidden cursor dropped); no browser menu for that press, wherever it is let go.
// A click picks the cell under the cursor, a drag a rectangle of cells (Ctrl: one more place - pickStart)
const cv3 = renderer.domElement;
let turning = false, noMenu = false, mouse3 = null;   // (the view being turned; that press's menu to drop; the cursor over the 3D view, -1..1)
let locked = false;
const look = new MouseFilter();
const ndc = e => { const b = cv3.getBoundingClientRect(); return { x: (e.clientX - b.left) / b.width * 2 - 1, y: -((e.clientY - b.top) / b.height) * 2 + 1 }; };
const stopTurning = () => { turning = false; cv3.style.cursor = ''; if (document.pointerLockElement === cv3) document.exitPointerLock(); };
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === cv3;
  look.reset(locked);
  if (locked && !turning) document.exitPointerLock();     // (granted after the button was let go)
  if (!locked && turning && !document.hasFocus()) stopTurning();     // (lost to another window: the button let go there)
});
$('lookHint').innerHTML = '<b>우클릭 끌기</b> 둘러보기 · <b>클릭·끌기</b> 고르기 · <b>Ctrl</b> 여러 곳 · <b>WASD</b> <b>E</b>/<b>Q</b> 이동 · <b>Shift</b> 빠르게 · 휠 굴리기: 속도';
addEventListener('mousedown', () => { noMenu = false; }, true);     // (a right press anywhere else keeps its menu)
cv3.addEventListener('mousedown', e => {
  if (e.button === 2) { turning = noMenu = true; cv3.style.cursor = 'grabbing'; lockPointerRaw(cv3); return; }
  if (e.button !== 0) return;
  const c = cellAtCursor(ndc(e));
  if (c) pickStart(c, e.ctrlKey, '3d');
});
// (Windows sends the menu after the button is let go - over whatever is under the cursor then, the side panel too)
addEventListener('contextmenu', e => { if (noMenu) { e.preventDefault(); noMenu = false; } });
cv3.addEventListener('mousemove', e => { mouse3 = ndc(e); });
cv3.addEventListener('mouseleave', () => { mouse3 = null; });
addEventListener('mousemove', e => {
  if (turning) {
    // (the cursor held: every movement is the hand's - a raw one need not say which button is down - but a jump of the hidden
    // cursor; not held, before the lock or after Esc: only with the right button down)
    if (locked ? !look.take(e) : !(e.buttons & 2)) return;
    camera.rotation.y -= e.movementX * 0.0035;
    camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - e.movementY * 0.0035, -1.55, 1.55);
  } else if (drag.from && drag.view === '3d' && e.buttons & 1) {
    const c = cellAtCursor(ndc(e));
    if (c) pickMove(c);
  }
});
addEventListener('mouseup', e => {
  if (e.button === 2 && turning) stopTurning();
  if (e.button === 0) pickEnd();
});
addEventListener('blur', () => { if (!locked) stopTurning(); });     // (the cursor held, it is let go with the button)
renderer.domElement.addEventListener('wheel', e => {
  e.preventDefault();
  speed = THREE.MathUtils.clamp(speed * (e.deltaY < 0 ? 1.25 : 0.8), 0.5, 60);
  status(`이동 속도 ${fmt(speed)} m/s`);
}, { passive: false });

// W/S go where the view looks, up or down too (looking at the sky, W flies up and S back down), as in Unity / Blender; A/D
// level, E/Q (Space/C) straight up and down
const fwd = new THREE.Vector3(), right = new THREE.Vector3();
function move(dt) {
  if (typing()) return;
  const v = speed * (keys.ShiftLeft || keys.ShiftRight ? 3 : 1) * dt, yaw = camera.rotation.y, pitch = camera.rotation.x;
  fwd.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  right.set(Math.cos(yaw), 0, -Math.sin(yaw));
  if (keys.KeyW) camera.position.addScaledVector(fwd, v);
  if (keys.KeyS) camera.position.addScaledVector(fwd, -v);
  if (keys.KeyA) camera.position.addScaledVector(right, -v);
  if (keys.KeyD) camera.position.addScaledVector(right, v);
  if (keys.KeyE || keys.Space) camera.position.y += v;
  if (keys.KeyQ || keys.KeyC) camera.position.y -= v;
}

// what stands at a cell, in tiles: a block's top, the floor (fx, fy: the cell's centre at whole numbers), a hole far down
function surfaceAt(fx, fy) {
  const M = S.mesh, x = Math.round(fx), y = Math.round(fy);
  if (!M || !S.grid?.valid(x, y)) return -Infinity;
  if (M.isPit(x, y)) return -99;
  if (M.isSolid(x, y)) return M.solidTopAt(x, y);
  return M.floorAt(fx, fy);
}
// the cell a ray from the camera meets first: along it until it meets what stands there
const dirV = new THREE.Vector3(), probe = new THREE.Vector3();
function cellAlong(dir) {
  for (let d = 0.1; d < 90; d += 0.05) {
    probe.copy(camera.position).addScaledVector(dir, d);
    const fx = probe.x / T - 0.5, fy = probe.z / T - 0.5, x = Math.round(fx), y = Math.round(fy);
    if (!S.grid.valid(x, y)) continue;
    if (probe.y <= surfaceAt(fx, fy) * T + 1e-3) return { x, y };
  }
  return null;
}
// under the crosshair (the middle of the view)
function crossCell() {
  if (!S.mesh) return null;
  camera.getWorldDirection(dirV);
  return cellAlong(dirV);
}
// under the cursor (p: -1..1 across the 3D view)
function cellAtCursor(p) {
  if (!S.mesh || !p) return null;
  camera.updateMatrixWorld();
  dirV.set(p.x, p.y, 0.5).unproject(camera).sub(camera.position).normalize();
  return cellAlong(dirV);
}
// F: the cell under the crosshair; G: the main place stretched to it
function pickAtCross(extend) {
  const c = crossCell(), m = mainSel();
  if (!c) return;
  if (extend && m) setSels([...S.sels.slice(0, -1), spanRect({ x: Math.min(m.x0, c.x), y: Math.min(m.y0, c.y) }, { x: Math.max(m.x1, c.x), y: Math.max(m.y1, c.y) })]);
  else setSels([cellRect(c)]);
  show2D(mainSel());
}
function flyTo(x, y) {
  const f = surfaceAt(x, y);
  camera.position.set((x + 0.5) * T, (Number.isFinite(f) && f > -50 ? f : 0) * T + 1.6, (y + 0.5) * T);
}
// at a cell, facing the map's middle (where the player comes in is often at an edge, the map behind)
function lookFrom(x, y) {
  flyTo(x, y);
  const dx = S.grid.w / 2 - (x + 0.5), dz = S.grid.h / 2 - (y + 0.5);
  camera.rotation.set(-0.2, Math.hypot(dx, dz) > 2 ? Math.atan2(-dx, -dz) : 0, 0);
}
// the picked places seen whole: from south of them and above, looking down at them
function frameSel(r = unionSel()) {
  if (!r || !S.mesh) return;
  let top = -Infinity;
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) { const s = surfaceAt(x, y); if (s > -50) top = Math.max(top, s); }
  if (!Number.isFinite(top)) top = 0;
  const d = Math.max(4, Math.max(r.x1 - r.x0 + 1, r.y1 - r.y0 + 1) * 1.1 + 2) * T;
  camera.position.set((r.x0 + r.x1 + 1) / 2 * T, top * T + d * 0.75, (r.y0 + r.y1 + 1) / 2 * T + d);
  camera.rotation.set(-Math.atan2(0.75, 1), 0, 0);
}

// the picked places in 3D: a box over each, from the lowest ground there to its highest top
function updateSelBox() {
  if (selBox) { scene.remove(selBox); selBox.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); selBox = null; }
  if (!S.sels.length || !S.mesh) return;
  selBox = new THREE.Group();
  for (const r of S.sels) {
    let lo = Infinity, hi = -Infinity;
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const s = surfaceAt(x, y), f = S.mesh.isSolid(x, y) ? S.mesh.solidBaseAt(x, y) : s;
      if (s > -50) hi = Math.max(hi, s);
      if (f > -50) lo = Math.min(lo, f);
    }
    if (!Number.isFinite(lo)) { lo = 0; hi = 0; }
    const wx = (r.x1 - r.x0 + 1) * T, wz = (r.y1 - r.y0 + 1) * T, hy = (hi - lo) * T + 1.2;
    const geo = new THREE.BoxGeometry(wx, hy, wz);
    const box = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: 0.16, depthWrite: false, fog: false }));
    box.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffd040, fog: false })));
    box.position.set(r.x0 * T + wx / 2, lo * T - 0.02 + hy / 2, r.y0 * T + wz / 2);
    box.renderOrder = 10;
    selBox.add(box);
  }
  scene.add(selBox);
}

// the events: exits blue, the rest drawn with a picture white, the invisible ones grey
function buildMarks() {
  for (const m of [...marks.children]) { marks.remove(m); m.geometry.dispose(); m.material.dispose(); }
  marks.visible = S.showEvents;
  if (!S.map || !S.mesh) return;
  for (const [, ev] of S.map.events) {
    const p = ev.pages[0];
    const exit = ev.pages.some(pg => pg.list.some(c => c.code === 201));
    const drawn = !!(p?.graphic?.character_name || p?.graphic?.tile_id);
    const color = exit ? 0x4a8cff : drawn ? 0xffffff : 0x777777;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.3, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 }));
    const f = surfaceAt(ev.x, ev.y);
    m.position.set((ev.x + 0.5) * T, (f > -50 ? f : 0) * T + 0.65, (ev.y + 0.5) * T);
    marks.add(m);
  }
}

const clock = new THREE.Clock();
let lastCross = '';
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (S.tab !== 'map') return;
  move(dt);
  torch.position.copy(camera.position);
  billboardUniforms.uViewer.value.copy(camera.position);
  S.mesh?.update(clock.elapsedTime);
  // (the cell under the cursor while it is over the view, else under the crosshair)
  const at = mouse3 && !turning ? cellAtCursor(mouse3) : null, c = at || (mouse3 && !turning ? null : crossCell());
  const t = c ? (at ? '↖ ' : '+ ') + cellText(c.x, c.y) : '';
  if (t !== lastCross) { lastCross = t; $('cellInfo').textContent = t; }
  renderer.render(scene, camera);
});

// ---------------------------------------------------------------- the map
function cellText(x, y) {
  if (!S.grid?.valid(x, y)) return '';
  const M = S.mesh;
  let t = `(${x}, ${y})  ${S.grid.anyPassable(x, y) ? '지나갈 수 있음' : '못 지나감'}`;
  if (M) {
    if (M.isPit(x, y)) t += '  · 구멍';
    else if (M.isSolid(x, y)) t += `  · 블록 ${fmt(M.solidBaseAt(x, y))} → ${fmt(M.solidTopAt(x, y))}칸`;
    else t += `  · 바닥 ${fmt(M.floorAt(x, y))}칸`;
  }
  const r = S.grid.region(x, y);
  if (r) t += `  · 리전 ${r}`;
  const tiles = [0, 1, 2].map(z => S.grid.tile(x, y, z)).filter(Boolean).map(id => (isA5(id) ? `${id} (A5 ${id - TILE.A5})` : String(id)));
  for (const [, ev] of S.map?.events || []) if (ev.x === x && ev.y === y && ev.pages[0]?.graphic?.tile_id) tiles.push(`이벤트 ${ev.pages[0].graphic.tile_id}`);
  if (tiles.length) t += `  · 타일 ${tiles.join(', ')}`;
  return t;
}

let buildToken = 0, rebuildTimer = 0, pending = false;
function scheduleRebuild() { pending = true; clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuild, 250); }
async function rebuild() {
  if (!S.map) return;
  const token = ++buildToken, t0 = performance.now(), change = pending;
  pending = false;
  status('짓는 중...');
  try {
    const { mesh } = await buildMapView({ map: S.map, grid: S.grid, mapId: S.id, events: [...S.map.events.values()], seeds: S.seeds });
    if (token !== buildToken) { mesh.dispose(); return; }
    if (S.mesh) { scene.remove(S.mesh.group); S.mesh.dispose(); }
    S.mesh = mesh;
    scene.add(mesh.group);
    updateSelBox();
    buildMarks();
    const info = `${S.id} ${$data.mapInfos.get(S.id)?.name || ''}  ${S.grid.w}×${S.grid.h}  —  ${Math.round(performance.now() - t0)}ms`;
    status(change ? '반영됨 ✓  ' + info : info, change ? 'ok' : '');
  } catch (e) {
    console.error(e);
    status('짓기 실패: ' + e.message, 'bad');
  }
}

// where the player arrives on each map (every Transfer Player command, the start): what is walkable from there decides
// which wall tops stand solid, as in the game - kept in the browser after the first scan
let arrivals = null;
async function scanArrivals() {
  try {
    const kept = JSON.parse(localStorage.getItem('mapedit.arrivals.v1') || 'null');
    if (kept) return new Map(kept);
  } catch { /* none */ }
  const out = new Map();
  const put = (id, x, y) => { if (!out.has(id)) out.set(id, []); const l = out.get(id); if (!l.some(([a, b]) => a === x && b === y)) l.push([x, y]); };
  const scan = list => { for (const c of list || []) if (c.code === 201 && c.parameters[0] === 0) put(c.parameters[1], c.parameters[2], c.parameters[3]); };
  for (const ce of $data.commonEvents) if (ce) scan(ce.list);
  const sys = $data.system;
  if (sys) put(sys.start_map_id, sys.start_x, sys.start_y);
  const ids = [...$data.mapInfos.keys()];
  for (let n = 0; n < ids.length; n++) {
    try { const m = await loadMap(ids[n]); for (const [, ev] of m.events) for (const p of ev.pages) scan(p.list); } catch { /* a missing map */ }
    if (n % 10 === 0) status(`도착 지점 찾는 중... ${n}/${ids.length} (처음 한 번만)`);
  }
  try { localStorage.setItem('mapedit.arrivals.v1', JSON.stringify([...out])); } catch { /* full */ }
  return out;
}

async function openMap(id) {
  id = +id;
  const map = await loadMap(id);
  if (!map) return;
  S.id = id; S.map = map; map.__id = id;
  S.grid = new MapGrid(map, $data.tilesets[map.tileset_id]);
  S.sels = []; S.pick = null; S.hover = null; drag.from = null;
  status('도착 지점 확인 중...');
  const arr = await arrivals;
  S.seeds = arr.get(id)?.length ? arr.get(id) : [centerCell()];
  history.replaceState(null, '', '#map=' + id);
  unfoldTo(id);
  renderList();
  renderHead();
  renderRules();
  renderSettings();
  renderJson();
  renderForm();
  await build2D();
  pending = false;
  await rebuild();
  lookFrom(...S.seeds[0]);
}
function centerCell() {
  let best = [0, 0], bd = Infinity;
  for (let y = 0; y < S.grid.h; y++) for (let x = 0; x < S.grid.w; x++) {
    if (!S.grid.anyPassable(x, y)) continue;
    const d = (x - S.grid.w / 2) ** 2 + (y - S.grid.h / 2) ** 2;
    if (d < bd) { bd = d; best = [x, y]; }
  }
  return best;
}

// ---------------------------------------------------------------- 2D
async function build2D() {
  const base = await render2D(S.grid, 1);
  const c = document.createElement('canvas');
  c.width = base.width; c.height = base.height;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  // (a floor drawn as the map's background picture - yuka: under the tiles, from the corner, as the game lays it)
  const par = S.map.parallax_name || '';
  if (/^yuka/i.test(par)) {
    const img = await loadImage('Graphics/Parallaxes', par);
    if (img) for (let y = 0; y < c.height; y += img.height) for (let x = 0; x < c.width; x += img.width) g.drawImage(img, x, y);
  }
  g.drawImage(base, 0, 0);
  // (events drawn with a tile)
  const drawer = new TileDrawer(await loadTilesetImages(S.grid.tileset), S.grid.flags);
  for (const [, ev] of S.map.events) { const gr = ev.pages[0]?.graphic; if (gr?.tile_id) drawer.draw(g, gr.tile_id, ev.x * TS, ev.y * TS); }
  S.img2d = c;
  draw2D();
}
const rectsOf = () => {
  const out = [], e = current();
  for (const d of RECT) (e[d.key] || []).forEach((it, i) => { if (!d.match || d.match(it)) out.push({ d, i, r: { x0: it[0], y0: it[1], x1: it[2], y1: it[3] } }); });
  for (const d of CELL) (e[d.key] || []).forEach((it, i) => out.push({ d, i, r: { x0: it[0], y0: it[1], x1: it[0], y1: it[1] } }));
  return out;
};
function draw2D() {
  if (!S.img2d || !S.grid) return;
  const cv = $('c2d'), px = TS * S.zoom, W = S.grid.w, H = S.grid.h;
  cv.width = Math.round(W * px); cv.height = Math.round(H * px);
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(S.img2d, 0, 0, cv.width, cv.height);
  g.lineWidth = 1;
  for (let x = 0; x <= W; x++) { g.strokeStyle = x % 5 ? 'rgba(255,255,255,0.07)' : 'rgba(255,230,120,0.35)'; g.beginPath(); g.moveTo(x * px + 0.5, 0); g.lineTo(x * px + 0.5, cv.height); g.stroke(); }
  for (let y = 0; y <= H; y++) { g.strokeStyle = y % 5 ? 'rgba(255,255,255,0.07)' : 'rgba(255,230,120,0.35)'; g.beginPath(); g.moveTo(0, y * px + 0.5); g.lineTo(cv.width, y * px + 0.5); g.stroke(); }
  g.fillStyle = '#ffe680'; g.font = `bold ${Math.max(9, Math.round(px * 0.45))}px sans-serif`;
  for (let x = 0; x < W; x += 5) g.fillText(String(x), x * px + 2, Math.max(10, px * 0.5));
  for (let y = 5; y < H; y += 5) g.fillText(String(y), 2, y * px + Math.max(10, px * 0.5));
  const box = (r, stroke, fill, w = 2) => {
    const x = r.x0 * px, y = r.y0 * px, ww = (r.x1 - r.x0 + 1) * px, hh = (r.y1 - r.y0 + 1) * px;
    if (fill) { g.fillStyle = fill; g.fillRect(x, y, ww, hh); }
    g.strokeStyle = stroke; g.lineWidth = w; g.strokeRect(x + w / 2, y + w / 2, ww - w, hh - w);
  };
  for (const { d, i, r } of rectsOf()) {
    const on = picked(d.key, i);
    box(r, d.color, on ? d.color + '55' : d.color + '1c', on ? 3 : 1.5);
  }
  for (const r of S.sels) box(r, '#ffd040', 'rgba(255,208,64,0.18)', r === mainSel() ? 2.5 : 1.5);
  if (S.hover) box({ x0: S.hover.x, y0: S.hover.y, x1: S.hover.x, y1: S.hover.y }, '#fff', null, 1);
}
const cellAt2D = e => {
  const px = TS * S.zoom;
  return { x: THREE.MathUtils.clamp(Math.floor(e.offsetX / px), 0, S.grid.w - 1), y: THREE.MathUtils.clamp(Math.floor(e.offsetY / px), 0, S.grid.h - 1) };
};
$('c2d').addEventListener('mousedown', e => {
  if (!S.grid || e.button !== 0) return;
  pickStart(cellAt2D(e), e.ctrlKey, '2d');
});
$('c2d').addEventListener('mousemove', e => {
  if (!S.grid) return;
  const c = cellAt2D(e);
  S.hover = c;
  $('hover2d').textContent = cellText(c.x, c.y);
  if (drag.from && drag.view === '2d' && e.buttons & 1) pickMove(c);
  else draw2D();
});
$('c2d').addEventListener('mouseleave', () => { S.hover = null; $('hover2d').textContent = ''; draw2D(); });
$('c2d').addEventListener('dblclick', e => { const c = cellAt2D(e); flyTo(c.x, c.y); });
$('zoomIn').onclick = () => { S.zoom = Math.min(3, S.zoom * 1.25); draw2D(); };
$('zoomOut').onclick = () => { S.zoom = Math.max(0.25, S.zoom / 1.25); draw2D(); };

// ---------------------------------------------------------------- picking places
// in the 2D map and the 3D view alike: a click one cell, a drag a rectangle; with Ctrl one more place - a Ctrl click on a place
// picked takes it out. A drag in 2D ends with the 3D view on what was picked; one in 3D, with the 2D map on it
const drag = { from: null, add: false, moved: false, view: '' };
function pickStart(c, add, view) {
  Object.assign(drag, { from: c, add, moved: false, view });
  setSels(add ? [...S.sels, cellRect(c)] : [cellRect(c)]);
}
function pickMove(c) {
  if (!drag.from) return;
  if (c.x !== drag.from.x || c.y !== drag.from.y) drag.moved = true;
  setSels([...S.sels.slice(0, -1), spanRect(drag.from, c)]);
}
function pickEnd() {
  if (!drag.from) return;
  const { from, add, moved, view } = drag;
  drag.from = null;
  if (add && !moved) {
    const before = S.sels.slice(0, -1), hit = before.findIndex(r => inRect(r, from));
    if (hit >= 0) { before.splice(hit, 1); setSels(before); }
  }
  if (!S.sels.length) return;
  if (view === '2d') frameSel(); else show2D(mainSel());
}
// the places picked now (keepPick: the rules picked in the list stay picked - they are those rules' places)
function setSels(list, keepPick = false) {
  S.sels = list;
  if (!keepPick) { S.pick = null; renderRules(); prefill(); }
  renderSel();
  updateSelBox();
  draw2D();
}
// one place (null: none), the 2D map scrolled to it
function select(r, keepPick = false) {
  setSels(r ? [r] : [], keepPick);
  if (r) show2D(r);
}
// the 2D map scrolled to show the picked cells (picked in 3D, or a rule from the list)
function show2D(r) {
  const w = $('wrap2d'), px = TS * S.zoom;
  const x0 = r.x0 * px, y0 = r.y0 * px, x1 = (r.x1 + 1) * px, y1 = (r.y1 + 1) * px;
  if (x0 < w.scrollLeft || x1 > w.scrollLeft + w.clientWidth) w.scrollLeft = (x0 + x1 - w.clientWidth) / 2;
  if (y0 < w.scrollTop || y1 > w.scrollTop + w.clientHeight) w.scrollTop = (y0 + y1 - w.clientHeight) / 2;
}
function renderSel() {
  const box = $('selInfo'), n = S.sels.length;
  $('frameSel').disabled = $('clearSel').disabled = !n;
  box.className = n ? 'on' : '';
  if (!n) { box.textContent = '아직 고른 곳이 없습니다'; return; }
  const one = r => `(${r.x0}, ${r.y0}) ~ (${r.x1}, ${r.y1})  ${r.x1 - r.x0 + 1}×${r.y1 - r.y0 + 1}칸`;
  const r = S.sels[0];
  if (n === 1) box.textContent = one(r) + (r.x0 === r.x1 && r.y0 === r.y1 && S.mesh ? '  — ' + cellText(r.x0, r.y0) : '');
  else box.textContent = `${n}곳 — ` + S.sels.slice(0, 4).map(one).join(' · ') + (n > 4 ? ` 외 ${n - 4}곳` : '');
}
$('frameSel').onclick = () => frameSel();
$('clearSel').onclick = () => setSels([]);

// the maps as RPG Maker VX Ace's map tree (MapInfos: each under its parent, in the tree's own order - the user's wish: the list
// was flat, each with its path): a parent folded or unfolded by its triangle - at first as the original's editor left it
// (expanded), then as the player left it here (kept in this browser); a map opened is unfolded down to. A search shows every
// map it finds, with its path, instead
const TREE = { kids: new Map(), open: new Set() };
const OPEN_KEY = 'bsvr-mapedit-open';
function buildTree() {
  const infos = $data.mapInfos;
  TREE.kids.clear();
  for (const [id, m] of infos) {
    const p = infos.has(m.parent_id) ? m.parent_id : 0;
    if (!TREE.kids.has(p)) TREE.kids.set(p, []);
    TREE.kids.get(p).push(id);
  }
  for (const list of TREE.kids.values()) list.sort((a, b) => (infos.get(a).order ?? a) - (infos.get(b).order ?? b) || a - b);
  let kept = null;
  try { kept = JSON.parse(localStorage.getItem(OPEN_KEY) || 'null'); } catch { /* none kept */ }
  TREE.open = new Set(Array.isArray(kept) ? kept.filter(Number.isInteger) : [...infos].filter(([, m]) => m.expanded).map(([id]) => id));
}
function setOpen(id, on) {
  if (on) TREE.open.add(id); else TREE.open.delete(id);
  try { localStorage.setItem(OPEN_KEY, JSON.stringify([...TREE.open])); } catch { /* not kept */ }
}
// (a map opened: its parents unfolded, so it shows)
function unfoldTo(id) {
  const infos = $data.mapInfos;
  let p = infos.get(id)?.parent_id, changedAny = false;
  for (let g = 0; p && infos.has(p) && g < 64; g++) { if (!TREE.open.has(p)) { TREE.open.add(p); changedAny = true; } p = infos.get(p).parent_id; }
  if (changedAny) setOpen(0, false);                 // (kept as it now is)
}
function mapRow(id, label, depth, has, open) {
  const d = document.createElement('div');
  const tw = document.createElement('span');
  tw.className = 'tw' + (has ? ' has' : '');
  tw.textContent = has ? (open ? '▾' : '▸') : '';
  if (has) { tw.title = open ? '접기' : '펼치기'; tw.onclick = ev => { ev.stopPropagation(); setOpen(id, !open); renderList(); }; }
  d.style.paddingLeft = `${4 + depth * 14}px`;
  d.append(tw, label);
  d.title = MAPS.find(m => m.id === id)?.label || label;
  if (id === S.id) d.className = 'on';
  if (S.user[id]) d.classList.add('user');
  d.onclick = () => openMap(id);
  return d;
}
function renderList() {
  const f = $('mapFilter').value.trim().toLowerCase();
  const box = $('mapList');
  box.innerHTML = '';
  if (f) {
    for (const m of MAPS) {
      if (!m.label.toLowerCase().includes(f) && String(m.id) !== f) continue;
      box.appendChild(mapRow(m.id, m.label, 0, false, false));
    }
    return;
  }
  const names = $data.mapInfos;
  const walk = (pid, depth) => {
    for (const id of TREE.kids.get(pid) || []) {
      const has = TREE.kids.has(id), open = TREE.open.has(id);
      const d = mapRow(id, `${id}  ${names.get(id)?.name || ''}`, depth, has, open);
      box.appendChild(d);
      if (id === S.id) requestAnimationFrame(() => d.scrollIntoView({ block: 'nearest' }));
      if (has && open) walk(id, depth + 1);
    }
  };
  walk(0, 0);
}
$('mapFilter').addEventListener('input', renderList);

function renderHead() {
  $('dirty').textContent = anyUnsaved() ? '● 저장 안 됨' : '';
  let title = '맵을 고르세요', from = '', mine = false;
  if (S.tab !== 'map') ({ title, text: from, user: mine } = tabPart().head());
  else if (S.map) {
    title = `${S.id}  ${MAPS.find(m => m.id === S.id)?.label.replace(/^\d+\s+/, '') || ''}`;
    const src = ruleSource(S.id);
    from = SOURCE_TEXT[src]; mine = src === 'user';
  }
  $('mapTitle').textContent = title;
  $('mapTitle').title = from;
  $('saveMsg').className = mine ? 'ok' : '';
  $('saveMsg').textContent = from;
}

function renderRules() {
  const box = $('rules');
  box.innerHTML = '';
  const e = current();
  let n = 0;
  const row = (d, i, text) => {
    n++;
    const r = document.createElement('div');
    r.className = 'rule' + (picked(d.key, i) ? ' on' : '');
    const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = d.color;
    const t = document.createElement('span'); t.className = 'txt'; t.textContent = text;
    t.title = '눌러서 고르기 (값을 바꿀 수 있게 아래에 채워집니다) · Ctrl+클릭: 같은 종류 여럿을 함께 - 값을 한 번에 바꿈';
    t.onclick = e => pickRule(d, i, e.ctrlKey);
    const del = document.createElement('button'); del.textContent = '삭제';
    del.onclick = () => { const l = entry()[d.key]; l.splice(i, 1); if (!l.length) delete entry()[d.key]; S.pick = null; changed(); };
    r.append(sw, t, del);
    box.appendChild(r);
  };
  for (const d of RECT) (e[d.key] || []).forEach((it, i) => { if (!d.match || d.match(it)) row(d, i, `${d.name}  (${it[0]},${it[1]})~(${it[2]},${it[3]})  ${d.text(it)}`); });
  for (const d of CELL) (e[d.key] || []).forEach((it, i) => row(d, i, `${d.name}  (${it[0]},${it[1]})`));
  for (const k of Object.keys(e)) {
    if (KNOWN.has(k)) continue;
    n++;
    const r = document.createElement('div'); r.className = 'rule other';
    r.textContent = `${k} — JSON(고급)에서 고칠 수 있음`;
    box.appendChild(r);
  }
  if (!n) box.innerHTML = '<div class="other">규칙 없음 — 원작 그림대로 자동으로 지어집니다</div>';
  // (step 4: picked rules are changed in place, their values taken at once - by all of them)
  const np = S.pick?.indices.length || 0, ns = S.sels.length;
  $('step4').textContent = np > 1 ? `고른 규칙 ${np}개 고치기` : np ? '고른 규칙 고치기' : ns > 1 ? `값 정하고 ${ns}곳에 추가` : '값 정하고 추가';
  $('editNote').textContent = !np ? '' : (np > 1 ? `값을 바꾸면 고른 규칙 ${np}개에 같은 값으로 바로 반영됩니다.` : '값을 바꾸면 바로 반영됩니다.')
    + ' 종류를 바꿨다면 "고른 규칙을 이걸로 바꾸기"를 누르세요.';
  $('replaceRule').disabled = !np;
}
// a rule of the list picked (add - Ctrl: one more of the same kind, or one picked taken out); the places picked are theirs
function pickRule(d, i, add = false) {
  const list = current()[d.key], it = list[i];
  const def = d.cell ? d : RECT.find(x => x.key === d.key && (!x.match || x.match(it)));
  if (add && S.pick && S.pick.key === d.key && S.pick.type === def.type) {
    const indices = S.pick.indices.includes(i) ? S.pick.indices.filter(n => n !== i) : [...S.pick.indices, i];
    S.pick = indices.length ? { ...S.pick, indices } : null;
  } else {
    S.pick = { key: d.key, indices: [i], type: def.type };
    $('ruleType').value = def.type;
    renderForm(def.read ? def.read(it) : {});
  }
  setSels(S.pick ? S.pick.indices.map(n => itemRect(def, list[n])) : [], true);
  renderRules();
  if (S.sels.length) { show2D(mainSel()); frameSel(); }
}

for (const [label, types] of GROUPS) {
  const g = document.createElement('optgroup'); g.label = label;
  for (const t of types) { const d = ALL.find(x => x.type === t), o = document.createElement('option'); o.value = d.type; o.textContent = d.name; g.appendChild(o); }
  $('ruleType').appendChild(g);
}
$('ruleType').addEventListener('change', () => { renderForm(); prefill(); });
const defOf = () => ALL.find(d => d.type === $('ruleType').value);
function renderForm(values = {}) {
  const d = defOf();
  $('ruleDesc').textContent = d.desc;
  const box = $('ruleParams');
  box.innerHTML = '';
  for (const p of d.params || []) {
    const l = document.createElement('label');
    const inp = document.createElement('input');
    inp.dataset.k = p.k;
    inp.dataset.type = p.type || 'number';
    if (p.type === 'check') { inp.type = 'checkbox'; inp.checked = !!values[p.k]; l.append(inp, p.label); } else if (p.type === 'list') {
      inp.type = 'text'; inp.value = (values[p.k] || []).join(', '); inp.placeholder = '예: 132, 133'; inp.style.width = '150px';
      l.append(p.label + ' ', inp);
    } else {
      inp.type = 'number'; inp.step = p.step || 0.05; inp.value = values[p.k] ?? p.def ?? 0;
      l.append(p.label + ' ', inp, p.step === 1 ? '' : ' 칸');
    }
    box.appendChild(l);
  }
}
// the form's heights from what is there now (the main place's ends)
function prefill() {
  const d = defOf(), r = mainSel(), M = S.mesh;
  if (!r || !M || S.pick) return;
  const set = (k, v) => { const i = $('ruleParams').querySelector(`[data-k="${k}"]`); if (i && Number.isFinite(v)) i.value = Math.round(v * 100) / 100; };
  const fl = (x, y) => (M.isSolid(x, y) ? NaN : M.floorAt(x, y));
  if (d.type === 'floors') { set('hN', fl(r.x0, r.y0)); set('hS', fl(r.x0, r.y1)); }
  if (d.type === 'floorsX') { set('hW', fl(r.x0, r.y0)); set('hE', fl(r.x1, r.y0)); }
  if (d.type === 'tops' || d.type === 'caps') set('top', M.isSolid(r.x0, r.y0) ? M.solidTopAt(r.x0, r.y0) : NaN);
}
function formValues() {
  const v = {};
  for (const i of $('ruleParams').querySelectorAll('input')) v[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.dataset.type === 'list' ? parseList(i.value) : Number(i.value) || 0;
  return v;
}
// the rule of kind d on a place, with the form's values
const itemOn = (d, r, v = formValues()) => (d.cell ? [r.x0, r.y0] : d.make(r, v));
// 고른 곳에 추가: a rule for each place picked - all of them picked then, to change at once
$('addRule').onclick = () => {
  if (!S.map) return;
  if (!S.sels.length) { $('selInfo').textContent = '먼저 고칠 곳을 고르세요 (2D 지도나 3D에서 클릭·끌기)'; return; }
  const d = defOf(), list = (entry()[d.key] ||= []), v = formValues();
  const indices = S.sels.map(r => list.push(itemOn(d, r, v)) - 1);
  S.pick = { key: d.key, indices, type: d.type };
  changed();
};
// 고른 규칙을 이걸로 바꾸기: each picked rule made the kind and values of the form, on its own place
$('replaceRule').onclick = () => {
  if (!S.pick) return;
  const d = defOf(), e = entry(), from = e[S.pick.key] || [], old = ALL.find(x => x.type === S.pick.type), v = formValues();
  const live = S.pick.indices.filter(i => from[i]);
  if (d.key === S.pick.key) {
    for (const i of live) from[i] = itemOn(d, itemRect(old, from[i]), v);     // (in place: a later one of a kind wins)
    S.pick = { ...S.pick, indices: live, type: d.type };
  } else {
    const rects = live.map(i => itemRect(old, from[i]));
    for (const i of [...live].sort((a, b) => b - a)) from.splice(i, 1);
    if (!from.length) delete e[S.pick.key];
    const list = (e[d.key] ||= []);
    S.pick = { key: d.key, indices: rects.map(r => list.push(itemOn(d, r, v)) - 1), type: d.type };
  }
  changed();
};
// a value changed: every picked rule takes it at once, each on its own place
function liveApply() {
  if (!S.pick || defOf().type !== S.pick.type) return;
  const d = defOf(), list = entry()[S.pick.key], v = formValues();
  if (!list) return;
  let any = false;
  for (const i of S.pick.indices) {
    if (!list[i]) continue;
    const item = itemOn(d, itemRect(d, list[i]), v);
    if (!same(list[i], item)) { list[i] = item; any = true; }
  }
  if (any) changed();
}
$('ruleParams').addEventListener('input', liveApply);
$('ruleParams').addEventListener('change', liveApply);

function renderSettings() {
  const e = current();
  $('wallCap').value = e.wallCap || '';
  $('openSky').checked = !!e.openSky;
  $('overlaps').checked = !!e.overlaps;
  $('massBackdrop').checked = !!e.massBackdrop;
  $('moundKinds').value = e.mounds?.a2?.join(',') || '';
  $('moundH').value = e.mounds?.height ?? '';
  $('highH').value = e.highGround?.height ?? '';
  $('highFrom').value = e.highGround?.from?.join(',') || '';
  $('sideView').checked = !!e.sideView;
  $('openFights').checked = !!e.openFights;
  $('stairs').value = e.stairs?.join(', ') || '';
  $('flatPictures').value = e.flatPictures?.join(', ') || '';
  $('terrStairs').value = e.terraces?.stairs?.join(', ') || '';
  $('terrSide').value = e.terraces?.sideStairs?.join(', ') || '';
}
function settingsChanged() {
  if (!S.map) return;
  const e = entry();
  const cap = Math.round(Number($('wallCap').value));
  if (cap > 0) e.wallCap = cap; else delete e.wallCap;
  for (const k of ['openSky', 'overlaps', 'massBackdrop', 'sideView', 'openFights']) { if ($(k).checked) e[k] = true; else delete e[k]; }
  for (const k of ['stairs', 'flatPictures']) { const l = parseList($(k).value); if (l.length) e[k] = l; else delete e[k]; }
  const ts = parseList($('terrStairs').value), tsSide = parseList($('terrSide').value);
  if (ts.length || tsSide.length) e.terraces = { stairs: ts, sideStairs: tsSide }; else delete e.terraces;
  const kinds = parseList($('moundKinds').value).filter(n => n < 32);      // (an empty box: none - not kind 0)
  if (kinds.length) e.mounds = { a2: kinds, height: Number($('moundH').value) || 0.35 }; else delete e.mounds;
  // (그린 절벽: where the player walks - typed, or where the map is entered)
  const hh = Number($('highH').value), typed = $('highFrom').value.split(/[,\s]+/).filter(Boolean).map(Number);
  const from = typed.length === 2 && typed.every(Number.isInteger) ? typed : S.seeds[0];
  if (hh > 0 && from) e.highGround = { from: [...from], height: hh }; else delete e.highGround;
  changed();
}
for (const id of ['wallCap', 'openSky', 'overlaps', 'massBackdrop', 'moundKinds', 'moundH', 'highH', 'highFrom', 'sideView', 'openFights', 'stairs',
  'flatPictures', 'terrStairs', 'terrSide']) $(id).addEventListener('change', settingsChanged);

function renderJson() { $('json').value = JSON.stringify(current(), null, 1); $('jsonMsg').textContent = ''; }
$('applyJson').onclick = () => {
  try {
    const v = JSON.parse($('json').value);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('{ ... } 이어야 합니다');
    S.user[S.id] = v; setUserMap(S.id, v);
    S.pick = null;
    changed();
    $('jsonMsg').textContent = '적용했습니다';
  } catch (e) { $('jsonMsg').textContent = 'JSON 오류: ' + e.message; }
};

// a rule changed: listed again, drawn again, the map built again
function changed() {
  syncRules();
  renderHead();
  renderRules();
  renderSettings();
  renderJson();
  renderList();
  draw2D();
  scheduleRebuild();
}

// (a game open in this browser hears a save: main.js takes the rules again, building the map it is on again)
const rulesChannel = (() => { try { return new BroadcastChannel(USER_RULES_CHANNEL); } catch { return null; } })();
$('save').onclick = async () => {
  const msg = $('saveMsg');
  try {
    const r = await fetch(USER_RULES_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: rulesText(allRules()) });
    if (r.status === 404) throw new Error('서버가 예전 버전입니다 - 런처(또는 서버 창)를 닫고 다시 켠 뒤 저장하세요');
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    S.saved = clone(allRules());
    renderHead();
    renderList();
    try { rulesChannel?.postMessage({ t: 'saved' }); } catch { /* closed */ }
    msg.className = 'ok';
    msg.textContent = '저장했습니다 (saves/user_rules.json) - 이 브라우저에 열린 게임은 바로, 그 밖에는 맵에 다시 들어갈 때 적용됩니다';
  } catch (e) {
    msg.className = 'bad';
    msg.textContent = '저장 실패: ' + e.message;
  }
};
$('revert').onclick = () => {
  if (S.tab !== 'map') { tabPart().revert(); return; }
  if (!S.map) return;
  if (S.saved.maps[S.id]) { S.user[S.id] = clone(S.saved.maps[S.id]); setUserMap(S.id, S.user[S.id]); } else toBuiltin();
  S.pick = null;
  changed();
};
function toBuiltin() {
  delete S.user[S.id];
  setUserMap(S.id, null);
}
$('builtin').onclick = () => {
  if (S.tab !== 'map') { tabPart().clear(); return; }
  if (!S.map) return;
  toBuiltin();
  S.pick = null;
  changed();
  $('saveMsg').textContent = '내 규칙을 지웠습니다 - ' + SOURCE_TEXT[ruleSource(S.id)] + ' · 저장하면 게임에도 적용됩니다';
};
$('play').onclick = () => {
  if (!S.map) return;
  const m = mainSel(), [x, y] = m ? [m.x0, m.y0] : S.seeds[0];
  const lang = new URLSearchParams(location.search).get('lang');
  open(`index.html?map=${S.id}&x=${x}&y=${y}${lang ? '&lang=' + encodeURIComponent(lang) : ''}`, '_blank');
  if (!same(S.user[S.id], S.saved.maps[S.id])) { $('saveMsg').className = 'bad'; $('saveMsg').textContent = '저장하지 않은 변경은 게임에 나오지 않습니다 - 먼저 저장하세요'; }
};
// 블랙소울 전용 보정 켜고 보기: what the editor shows - a map, a companion with BLACK SOULS II's own rules or without them (rules
// made for that game's mode, or for another game; a map's new rule starts from that game's rules only when they are shown). The
// game itself follows the launcher's switch; at first the editor shows as it says (the manifest's mapRules - assets.js)
$('bs2View').addEventListener('change', () => {
  useBuiltinRules($('bs2View').checked);
  S.pick = null;
  if (S.map) changed(); else renderHead();
  if (S.tab === 'ally' || S.tab === 'foe') roster.show(S.tab);
});
// the tabs: 맵 / 동료 / 적
const roster = initRoster({ S, changed: () => { syncRules(); renderHead(); }, picked: () => renderHead() });
const items = initItems({ S, changed: () => { syncRules(); renderHead(); }, picked: () => renderHead() });
// (the tab's own part: 동료 / 적 - roster.js, 장비·스킬 - itemedit.js)
const tabPart = () => (S.tab === 'item' ? items : roster);
function setTab(t) {
  S.tab = t;
  document.body.dataset.tab = t;
  for (const b of document.querySelectorAll('.tabs button[data-tab]')) b.classList.toggle('on', b.dataset.tab === t);
  if (t === 'map') resize(); else if (t === 'item') items.show(); else roster.show(t);
  renderHead();
}
for (const b of document.querySelectorAll('.tabs button[data-tab]')) b.onclick = () => setTab(b.dataset.tab);
$('rebuild').onclick = () => rebuild();
$('toggle2d').onclick = () => { document.body.classList.toggle('no2d'); resize(); };
$('toggleEv').onclick = () => { S.showEvents = !S.showEvents; marks.visible = S.showEvents; };
$('toggleFog').onclick = () => { S.fog = !S.fog; scene.fog = S.fog ? fog : null; };
addEventListener('beforeunload', e => { if (anyUnsaved()) { e.preventDefault(); e.returnValue = ''; } });

// ---------------------------------------------------------------- start
let MAPS = [];
(async () => {
  resize();
  try {
    status('게임 파일 확인 중...');
    await initAssets();
    status('데이터베이스 로딩 중...');
    await loadDatabase();
    window.$data = $data;
    const all = (await loadUserRules()) || cleanRules(null);
    S.user = clone(all.maps); S.comp = clone(all.companions); S.foes = clone(all.enemies);
    S.items = { weapons: clone(all.weapons), armors: clone(all.armors), skills: clone(all.skills) };
    setUserMaps(S.user);
    S.saved = clone(allRules());
    syncRules();
    $('bs2View').checked = builtinRules();
    const infos = $data.mapInfos;
    const chain = id => { const out = []; let p = id; for (let g = 0; p && g < 12; g++) { out.unshift(infos.get(p)?.name || ''); p = infos.get(p)?.parent_id; } return out.join(' > '); };
    MAPS = [...infos.keys()].sort((a, b) => a - b).map(id => ({ id, label: `${id}  ${chain(id)}` }));
    buildTree();
    renderList();
    renderForm();
    arrivals = scanArrivals();
    const want = +(/map=(\d+)/.exec(location.hash)?.[1] || 0);
    if (want && infos.has(want)) await openMap(want);
    else { await arrivals; status('왼쪽 목록에서 맵을 고르세요'); }
    window.__mapedit = { S, openMap, select, setSels, rebuild, MAP_HINTS, camera, crossCell, cellAtCursor, frameSel, setTab, roster, items, TREE };     // (developer checks)
  } catch (e) {
    console.error(e);
    status('오류: ' + e.message, 'bad');
  }
})();
