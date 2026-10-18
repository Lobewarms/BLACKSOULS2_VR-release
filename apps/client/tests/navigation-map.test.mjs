import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { Input } from '../src/core/input.js';

globalThis.location = { search: '?lang=en' };
globalThis.addEventListener ||= () => {};
const { UI } = await import('../src/ui/ui.js');
const { MapGrid } = await import('../src/world/mapmesh.js');
const { TileDrawer } = await import('../src/world/tiles.js');
const { mapPosition, mapProjection, exitGroups } = await import('../src/ui/navigation-map.js');
const { $data, loadMapNames } = await import('../src/data/data.js');
const { initAssets } = await import('../src/data/assets.js');

function canvas() {
  const record = { texts: [], images: [], fills: [], translations: [], rotations: [], clears: 0 };
  const ctx = new Proxy({
    clearRect() { for (const value of Object.values(record)) if (Array.isArray(value)) value.length = 0; record.clears++; },
    fillText(text, x, y) { record.texts.push({ text, x, y }); },
    drawImage(...args) { record.images.push(args); },
    fillRect(...args) { record.fills.push({ color: ctx.fillStyle, args }); },
    translate(x, y) { record.translations.push({ x, y }); },
    rotate(n) { record.rotations.push(n); },
    measureText: s => ({ width: Array.from(String(s)).length * 12 }),
    createLinearGradient: () => ({ addColorStop() {} }),
  }, { get: (o, k) => k in o ? o[k] : () => {} });
  return { width: 0, height: 0, record, getContext: () => ctx };
}
function map(w = 40, h = 30, mapId = 901) {
  const data = new Int16Array(w * h * 4); data.fill(1, 0, w * h);
  const flags = new Int16Array(8192); flags[0] = 16; flags[2] = 15;
  const raw = { width: w, height: h, data: { data } }, grid = new MapGrid(raw, { flags: { data: flags } });
  return { grid, map: raw, mapId, playerChar: { x: 2, y: 3, fx: 2, fy: 3, direction: 8 },
    walkable: (x, y) => grid.anyPassable(x, y), interpreter: { running: () => false } };
}
function environment(t) {
  const saved = { ...G }, system = $data.system, document = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => { Object.assign(G, saved); $data.system = system;
    if (document) Object.defineProperty(globalThis, 'document', document); else delete globalThis.document; });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: canvas } });
  const leader = { hp: 100, mhp: 100, mp: 20, mmp: 20, states: [], buffs: [] };
  G.settings = { ...G.settings }; G.map = map(); G.vr = false; G.combat = null; G.theater = null; G.audio = null;
  G.scripts = {}; G.state = { system: {}, party: { leader: () => leader, gold: 0, spirits: [] } };
  G.player = { forward2D: () => ({ x: 1, z: 0 }) };
  G.view = { mapId: 901, analysis: { exits: [{ x: 5, y: 3, mapId: 902, label: 'Translated Garden' }], pits: new Set([6]), doors: new Set([7]) } };
  G.input = Object.assign(Object.create(Input.prototype), { keys: new Set(), keysPrev: new Set(), controllers: {},
    axes: { left: [0, 0], right: [0, 0] }, btn: { left: [], right: [] }, btnPrev: { left: [], right: [] } });
  $data.system = { currency_unit: 'souls' };
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100); camera.position.y = 1.6;
  const ui = new UI(new THREE.Scene(), camera, new THREE.Group()); ui.attachHud(null);
  G.ui = ui;
  return ui;
}
const text = panel => panel.canvas.record.texts.map(r => r.text);

test('north-up projection centres tiles, preserves aspect ratio and clamps only non-looping windows', () => {
  const m = map(), rect = { x: 10, y: 20, w: 300, h: 200 };
  let v = mapProjection(m, rect, true);
  assert.equal(v.scale, 200 / 30); assert.equal(v.top, 20);
  assert.ok(v.left > rect.x); assert.deepEqual(v.point(0, 0), { x: v.left + v.scale / 2, y: v.top + v.scale / 2 });
  assert.ok(v.point(1, 0).x > v.point(0, 0).x && v.point(0, 1).y > v.point(0, 0).y);
  v = mapProjection(m, rect); assert.equal(v.x, 0); assert.equal(v.y, 0);
  m.playerChar.fx = 39; m.playerChar.fy = 29;
  v = mapProjection(m, rect); assert.equal(v.x, 19); assert.equal(v.y, 9);
  const small = mapProjection(map(5, 3), rect);
  assert.equal(small.cols, 5); assert.equal(small.rows, 3); assert.equal(small.scale, 60);
});

test('looping maps keep smooth positions and show exits across both seams', () => {
  const m = map(); m.loopX = m.loopY = true; m.playerChar.fx = -40.25; m.playerChar.fy = 60;
  assert.deepEqual(mapPosition(m), { x: -0.25, y: 0 });
  const v = mapProjection(m, { x: 0, y: 0, w: 210, h: 210 });
  assert.deepEqual(v.point(-0.25, 0), { x: 105, y: 105 });
  assert.ok(Math.abs(v.point(39, 29).x - 105) < 11 && Math.abs(v.point(39, 29).y - 105) < 11);
  m.playerChar.fx = Number.NaN; m.playerChar.fy = Number.NaN;
  assert.deepEqual(mapPosition(m), { x: 2, y: 3 }, 'logical position is available before continuous coordinates initialise');
});

test('map legend resolves translated destination titles and deduplicates region cells', async t => {
  environment(t);
  const previous = $data.mapInfos; t.after(() => { $data.mapInfos = previous; });
  $data.mapInfos = new Map([[902, { name: '内部编辑名', parent_id: 0 }]]);
  const string = (tag, s) => { const b = Buffer.from(s); return [tag, b.length + 5, ...b]; };
  const bytes = Uint8Array.from([4, 8, 111, ...string(58, 'RPG::Map'), 6,
    ...string(58, '@display_name'), ...string(34, 'Translated Garden')]);
  t.mock.method(globalThis, 'fetch', async url => url === '/api/manifest' ? Response.json({ files: ['Data/Map902.rvdata2'] }) : new Response(bytes));
  await initAssets(); await loadMapNames([902]);
  const exits = [{ x: 2, y: 3, mapId: 902 }, { x: 2, y: 3, mapId: 902 }, { x: 3, y: 3, mapId: 902 }, { x: -1, y: 3, mapId: 999 }];
  const before = JSON.stringify(exits), groups = exitGroups(G.map, { exits });
  assert.equal(groups.length, 1); assert.equal(groups[0].label, 'Translated Garden');
  assert.equal(groups[0].cells.length, 2); assert.equal(groups[0].number, 1); assert.equal(JSON.stringify(exits), before);
});

test('real map canvases update position and facing, cache terrain and discard stale exits after transfers', t => {
  const ui = environment(t), nav = ui.navigation, data = Array.from(G.map.grid.data);
  G.map.grid.data[0] = 2; data[0] = 2;
  ui.update(0.1);
  assert.equal(nav.mini.mesh.visible, true); assert.equal(nav.full.mesh.visible, false);
  assert.ok(text(nav.mini).some(s => s.includes('N / Menu')));
  assert.equal(nav.base.record.fills[0].color, '#292b33'); assert.equal(nav.base.record.fills[1].color, '#777668');
  assert.equal(nav.base.record.fills[6].color, '#080b12'); assert.equal(nav.base.record.fills[7].color, '#b59352');
  assert.equal(nav.mini.canvas.record.rotations.at(-1), Math.PI / 2);
  const before = nav.mini.canvas.record.translations.at(-1), rasters = nav.base.record.fills.length, clears = nav.mini.canvas.record.clears;
  G.map.playerChar.fx += 1; ui.update(0.01); assert.equal(nav.mini.canvas.record.clears, clears);
  ui.update(0.1); assert.ok(nav.mini.canvas.record.translations.at(-1).x > before.x);
  assert.equal(nav.base.record.fills.length, rasters, 'movement must not rebuild the terrain raster');
  assert.deepEqual(Array.from(G.map.grid.data), data, 'drawing must never change game tiles');
  G.view.analysis = { ...G.view.analysis, exits: [{ x: 5, y: 3, mapId: 903, label: 'New Exit' }] };
  ui.update(0.01); assert.equal(nav.groups[0].label, 'New Exit', 'event-page rebuild refreshes destinations');
  G.map.transferring = true; ui.update(0.1); assert.equal(nav.mini.mesh.visible, false);
  G.map = map(12, 10, 904); ui.update(0.1);
  assert.equal(nav.base.width, 12); assert.equal(nav.base.height, 10); assert.equal(nav.groups.length, 0, 'old area exits cannot leak into a new map');
  G.settings.minimap = false; ui.update(0.1); assert.equal(nav.mini.mesh.visible, false);
  ui.showMap(); ui.update(0.1); assert.equal(nav.full.mesh.visible, true, 'full map remains usable with minimap disabled');
  nav.hide(); assert.equal(nav.full.mesh.visible, false);
});

test('N toggles the real map through gameplay frames and Menu → Map returns to its menu row', t => {
  const ui = environment(t), input = G.input;
  input.keys.add('KeyN'); ui.update(0.1);
  assert.equal(ui.navigation.full.mesh.visible, true); assert.equal(ui.navigation.mini.mesh.visible, false);
  assert.equal(ui.sceneBusy(), true); assert.equal(ui.blocksTurning(), true); assert.equal(ui.consumedConfirm, true);
  input.keysPrev = new Set(input.keys); ui.update(0.1); assert.equal(ui.navigation.open, true, 'holding N cannot repeatedly toggle');
  input.keysPrev.clear(); ui.update(0.1); assert.equal(ui.navigation.open, false); assert.equal(ui.menuOpen, false);
  input.keys.clear(); input.keys.add('Tab'); ui.update(0.1);
  const row = ui.list.items.findIndex(item => item.id === 'map'); assert.ok(row > 0);
  ui.list.onSelect(row, ui.list.items[row]); input.keys.clear(); ui.update(0.1);
  assert.equal(ui.navigation.full.mesh.visible, true); assert.equal(ui.list.visible, false);
  input.keys.add('Escape'); ui.update(0.1);
  assert.equal(ui.navigation.full.mesh.visible, false); assert.equal(ui.list.visible, true); assert.equal(ui.list.items[ui.list.index].id, 'map');
  ui.closeMenu(); G.map.interpreter.running = () => true; input.keys.clear(); input.keys.add('KeyN'); ui.update(0.1);
  assert.equal(ui.navigation.open, false, 'story events retain their input lock');
});

test('VR wrist map keeps its HUD anchor, opens from menu and closes with the controller B button', t => {
  const ui = environment(t); G.vr = true;
  const grip = new THREE.Group(); grip.position.set(0.2, 1, -0.4); ui.attachHud(grip); ui.update(0.1);
  assert.equal(ui.navigation.mini.mesh.parent, ui.hud.mesh); assert.ok(ui.navigation.mini.mesh.position.y > 0);
  assert.equal(ui.navigation.mini.mesh.material.depthTest, false);
  G.input.btn.left[5] = true; ui.update(0.1); assert.equal(ui.menuOpen, true);
  ui.onMenu('map'); G.input.btn.left[5] = false; ui.update(0.1); assert.equal(ui.navigation.full.mesh.visible, true);
  G.input.btn.right[5] = true; ui.update(0.1); assert.equal(ui.navigation.open, false); assert.equal(ui.list.visible, true);
  ui.attachHud(null); assert.equal(ui.navigation.mini.mesh.parent, ui.camera);
  ui.closeMenu(); G.combat = { playerDead: true }; ui.update(0.1); assert.equal(ui.navigation.mini.mesh.visible, false);
});

test('every exit remains accessible across legend pages instead of being silently omitted', t => {
  const ui = environment(t);
  G.view.analysis.exits = Array.from({ length: 19 }, (_, i) => ({ x: i + 1, y: 4, mapId: i + 1000, label: `Destination ${i}` }));
  ui.showMap(); ui.update(0.1);
  const seen = new Set(text(ui.navigation.full));
  for (let i = 0; i < 2; i++) {
    G.input.keysPrev.clear(); G.input.keys.add('ArrowDown'); ui.update(0.1);
    text(ui.navigation.full).forEach(s => seen.add(s));
  }
  assert.ok(G.view.analysis.exits.every((exit, i) => seen.has(`${i + 1}. ${exit.label}`)));
  assert.ok(text(ui.navigation.full).some(s => s.includes('3/3')));
  G.input.keysPrev.clear(); ui.update(0.1); assert.equal(ui.navigation.page, 0, 'legend pages wrap');
});

test('navigation controls are translated in all four supported languages', () => {
  const url = new URL('../src/ui/i18n.js', import.meta.url).href;
  for (const [language, expected] of [['en', 'Map'], ['ko', '지도'], ['ja', 'マップ'], ['zh', '地图']]) {
    const code = `globalThis.location={search:'?lang=${language}'};const {tr}=await import(${JSON.stringify(url)});console.log(JSON.stringify([tr('지도'),tr('출구 {n}/{total} · ↑↓ / 스틱',{n:2,total:3}),tr('N / 메뉴 → 지도')]));`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const strings = JSON.parse(result.stdout); assert.equal(strings[0], expected);
    assert.ok(strings[1].includes('2/3')); assert.ok(!strings.some(s => s.includes('{')));
  }
});

test('navigation reuses the actual game tile drawer and bounds its cached artwork size', t => {
  const ui = environment(t), source = canvas(); source.width = source.height = 512;
  G.map = map(300, 1); const images = Array(9).fill(null); images[5] = source;
  G.view.mesh = { drawer: new TileDrawer(images, G.map.grid.flags) };
  ui.update(0.1);
  const art = ui.navigation.art;
  assert.ok(art && art.width <= 2048 && art.height <= 2048);
  assert.ok(art.record.images.some(([image, x, y, w, h]) => image === source && x === 32 && y === 0 && w === 32 && h === 32));
  assert.ok(ui.navigation.mini.canvas.record.images.some(([image]) => image === art));
  ui.update(0.1); assert.equal(ui.navigation.art, art, 'moving frames reuse the cached original artwork');
  G.view.mesh = { drawer: new TileDrawer(Array(9).fill(null), G.map.grid.flags) };
  ui.update(0.1); assert.equal(ui.navigation.art, null, 'missing images retain the readable grid fallback');
});

test('main menu fits one screen and grouped menus keep Back and disabled saves working', t => {
  const ui = environment(t); ui.openMenu();
  assert.ok(ui.list.items.length <= ui.list.rows);
  for (const id of ['map', 'items', 'character', 'saves', 'coop', 'settings']) assert.ok(ui.list.items.some(item => item.id === id));
  ui.onMenu('character'); assert.ok(ui.list.title.includes('Character'));
  for (const id of ['status', 'skills', 'equip', 'oath', 'adjust']) assert.ok(ui.list.items.some(item => item.id === id));
  assert.equal(ui.list.items.find(item => item.id === 'oath').enabled, false);
  ui.list.onCancel(); assert.equal(ui.list.items[ui.list.index].id, 'character');
  G.state.system.saveDisabled = true; ui.onMenu('saves'); assert.equal(ui.list.items.find(item => item.id === 'save').enabled, false);
  ui.reopenMain('load'); assert.equal(ui.list.items[ui.list.index].id, 'load');
  ui.list.onCancel(); ui.onMenu('settings');
  for (const id of ['options', 'turn', 'speed', 'diff', 'spectator']) assert.ok(ui.list.items.some(item => item.id === id));
  ui.onMenu('turn'); assert.equal(ui.list.items[ui.list.index].id, 'turn');
  ui.list.onCancel(); assert.equal(ui.list.items[ui.list.index].id, 'settings');
  let saved = 0; G.saveSettings = () => saved++;
  ui.showOptionsMenu(); const toggle = ui.list.items.findIndex(item => item.id === 'minimap');
  ui.list.onSelect(toggle, ui.list.items[toggle]); assert.equal(G.settings.minimap, false); assert.equal(saved, 1);
  ui.onMenu('title'); assert.equal(ui.list.index, 0, 'returning to title starts on Cancel');
});

test('desktop pointer clicks the hovered menu row on its first frame and the visible Back button', t => {
  const ui = environment(t), input = G.input;
  Object.assign(input, { pointer: { seen: true, x: 0, y: 0 }, pointerLocked: false,
    mouse: { buttons: 1, prevButtons: 0 }, dom: { getBoundingClientRect: () => ({ left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 }) } });
  ui.camera.aspect = 1.5; ui.camera.updateProjectionMatrix(); ui.openMenu(); ui.placeRoot(true);
  const pointAt = (px, py) => {
    const panel = ui.list.panel, mesh = panel.mesh;
    ui.root.updateMatrixWorld(true);
    const p = mesh.localToWorld(new THREE.Vector3((px / panel.canvas.width - 0.5) * panel.widthM, (0.5 - py / panel.canvas.height) * panel.heightM, 0)).project(ui.camera);
    input.pointer.x = (p.x + 1) * 600; input.pointer.y = (1 - p.y) * 400;
  };
  pointAt(200, 100 + 3 * 64 + 25); ui.update(0.1);
  assert.ok(ui.list.title.includes('Character'), 'first click opens the pointed row rather than the old keyboard selection');
  pointAt(ui.list.panel.canvas.width - 80, 48); ui.update(0.1);
  assert.equal(ui.list.items[ui.list.index].id, 'character', 'clicking Back restores the parent selection');
  pointAt(100, 84); ui.update(0.1); assert.equal(ui.list.items[ui.list.index].id, 'character', 'clicking a noninteractive header cannot activate the selected row');
});
