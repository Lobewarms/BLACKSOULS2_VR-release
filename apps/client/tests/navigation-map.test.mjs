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
  const saved = { ...G }, system = $data.system, classes = $data.classes, document = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => { for (const key of Object.keys(G)) if (!(key in saved)) delete G[key]; Object.assign(G, saved); $data.system = system; $data.classes = classes;
    if (document) Object.defineProperty(globalThis, 'document', document); else delete globalThis.document; });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: canvas } });
  const leader = { name: 'Grimm', level: 1, classId: 1, hp: 100, mhp: 100, mp: 20, mmp: 20, states: [], buffs: [], equips: [], partners: [], param: () => 10 };
  G.settings = { ...G.settings }; G.map = map(); G.vr = false; G.combat = null; G.theater = null; G.audio = null;
  G.scripts = {}; G.state = { system: {}, party: { leader: () => leader, gold: 0, spirits: [] } };
  G.player = { forward2D: () => ({ x: 1, z: 0 }) };
  G.view = { mapId: 901, analysis: { exits: [{ x: 5, y: 3, mapId: 902, label: 'Translated Garden' }], pits: new Set([6]), doors: new Set([7]) } };
  G.input = Object.assign(Object.create(Input.prototype), { keys: new Set(), keysPrev: new Set(), controllers: {},
    axes: { left: [0, 0], right: [0, 0] }, btn: { left: [], right: [] }, btnPrev: { left: [], right: [] } });
  $data.system = { currency_unit: 'souls', terms: { params: ['HP', 'MP', 'Attack', 'Defense', 'Magic', 'Resistance', 'Agility', 'Luck'] } };
  $data.classes = [null, { name: 'Hunter' }];
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100); camera.position.y = 1.6;
  const ui = new UI(new THREE.Scene(), camera, new THREE.Group()); ui.attachHud(null);
  G.ui = ui;
  return ui;
}
const text = panel => panel.canvas.record.texts.map(r => r.text);

function skillShortcutEnvironment(t) {
  const ui = environment(t), actor = G.state.party.leader();
  Object.assign(actor, { allSkills: () => [{ id: 101, name: 'Synthetic skill', description: '', icon_index: 0 }],
    skillMpCost: () => 0, skillHpCost: () => 0, skillTypeUsable: () => true, skillSealed: () => false });
  G.state.quickSlots = Array(8).fill(null);
  return ui;
}

test('R opens the real Skills grid, consumes the opening frame and toggles closed on a fresh press', t => {
  const ui = skillShortcutEnvironment(t), input = G.input;
  input.keys.add('KeyR'); input.keys.add('Enter'); ui.update(0.01);
  assert.equal(ui.menuOpen, true); assert.equal(ui.menuSection, 'skills'); assert.equal(ui.grid.visible, true);
  assert.equal(ui.grid.items[0].id, 101); assert.equal(ui.list.visible, false, 'the opening press cannot select a skill');
  assert.equal(ui.consumedConfirm, true);
  input.keysPrev = new Set(input.keys); ui.update(0.01);
  assert.equal(ui.menuOpen, true, 'holding R must not close or reopen the menu');
  input.keys.clear(); input.keysPrev.clear(); input.keys.add('KeyR'); ui.update(0.01);
  assert.equal(ui.menuOpen, false); assert.equal(ui.grid.visible, false);
});

test('R jumps from the classic main menu directly to Skills and keeps E as Examine/Talk', t => {
  const ui = skillShortcutEnvironment(t), input = G.input;
  input.keys.add('KeyE'); assert.equal(input.interact(), true); assert.equal(input.skillMenuPressed(), false);
  input.keys.clear(); ui.openMenu(); input.keys.add('KeyR'); ui.update(0.01);
  assert.equal(ui.menuSection, 'skills'); assert.equal(ui.grid.visible, true);
});

for (const blocked of ['typing', 'unfocused', 'VR', 'dialogue', 'script', 'transfer', 'disabled', 'shop', 'prompt', 'dead']) {
  test(`R cannot bypass ${blocked} while opening Skills`, t => {
    const ui = skillShortcutEnvironment(t), input = G.input;
    if (blocked === 'typing') document.activeElement = { tagName: 'TEXTAREA' };
    if (blocked === 'unfocused') input.pageFocused = false;
    if (blocked === 'VR') G.vr = true;
    if (blocked === 'dialogue') ui.showMessage({ lines: ['Synthetic dialogue'], position: 2 });
    if (blocked === 'script') G.map.interpreter.running = () => true;
    if (blocked === 'transfer') G.map.transferring = true;
    if (blocked === 'disabled') G.state.system.menuDisabled = true;
    if (blocked === 'shop') ui.sceneOpen = 'shop';
    if (blocked === 'prompt') ui.prompt = { shown: true, left: 10 };
    if (blocked === 'dead') G.combat = { playerDead: true };
    input.keys.add('KeyR');
    // Exercise the same shortcut guard without advancing an unrelated modal.
    if (input.skillMenuPressed()) assert.equal(ui.toggleSkillsMenu(), false);
    assert.equal(ui.menuOpen, false); assert.equal(ui.grid.visible, false);
  });
}

test('R remains available during the original interpreter battle wait', t => {
  const ui = skillShortcutEnvironment(t);
  G.map.interpreter = { running: () => true, waitMode: 'battle' };
  G.input.keys.add('KeyR'); ui.update(0.01);
  assert.equal(ui.menuSection, 'skills'); assert.equal(ui.grid.visible, true);
});

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
  assert.ok(text(nav.mini).some(s => s.includes('N: Map')));
  assert.equal(nav.base.record.fills[0].color, '#292b33'); assert.equal(nav.base.record.fills[1].color, '#777668');
  assert.equal(nav.base.record.fills[6].color, '#080b12'); assert.equal(nav.base.record.fills[7].color, '#b59352');
  assert.equal(nav.mini.canvas.record.rotations.at(-1), Math.PI / 2);
  const before = nav.mini.canvas.record.translations.at(-1), imageX = nav.mini.canvas.record.images.find(([source]) => source === nav.base)[1];
  const rasters = nav.base.record.fills.length, clears = nav.mini.canvas.record.clears;
  G.map.playerChar.fx += 1; ui.update(0.01); assert.equal(nav.mini.canvas.record.clears, clears);
  ui.update(0.1); assert.equal(nav.mini.canvas.record.translations.at(-1).x, before.x, 'the circular PC map keeps the player centred');
  assert.ok(nav.mini.canvas.record.images.find(([source]) => source === nav.base)[1] < imageX, 'terrain scrolls beneath the player as their actual map position changes');
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

test('N toggles the real map through gameplay frames and Mod tools → Map returns to its tools row', t => {
  const ui = environment(t), input = G.input;
  input.keys.add('KeyN'); ui.update(0.1);
  assert.equal(ui.navigation.full.mesh.visible, true); assert.equal(ui.navigation.mini.mesh.visible, false);
  assert.equal(ui.sceneBusy(), true); assert.equal(ui.blocksTurning(), true); assert.equal(ui.consumedConfirm, true);
  input.keysPrev = new Set(input.keys); ui.update(0.1); assert.equal(ui.navigation.open, true, 'holding N cannot repeatedly toggle');
  input.keysPrev.clear(); ui.update(0.1); assert.equal(ui.navigation.open, false); assert.equal(ui.menuOpen, false);
  input.keys.clear(); input.keys.add('Tab'); ui.update(0.1);
  assert.equal(ui.list.classic, true);
  assert.equal(ui.list.items.some(item => item.id === 'map'), false, 'the original command menu has no extra map command');
  input.keys.clear(); input.keys.add('F1'); ui.update(0.1);
  assert.equal(ui.list.classic, false); assert.ok(ui.list.title.includes('Mod tools'));
  const row = ui.list.items.findIndex(item => item.id === 'map'); assert.ok(row >= 0);
  ui.list.onSelect(row, ui.list.items[row]); input.keys.clear(); ui.update(0.1);
  assert.equal(ui.navigation.full.mesh.visible, true); assert.equal(ui.list.visible, false);
  input.keys.add('Escape'); ui.update(0.1);
  assert.equal(ui.navigation.full.mesh.visible, false); assert.equal(ui.list.visible, true); assert.equal(ui.list.items[ui.list.index].id, 'map');
  assert.ok(ui.list.title.includes('Mod tools'));
  ui.closeMenu(); G.map.interpreter.running = () => true; input.keys.clear(); input.keys.add('KeyN'); ui.update(0.1);
  assert.equal(ui.navigation.open, false, 'story events retain their input lock');
});

test('VR wrist map keeps its HUD anchor, opens from menu and closes with the controller B button', t => {
  const ui = environment(t); G.vr = true;
  const grip = new THREE.Group(); grip.position.set(0.2, 1, -0.4); ui.attachHud(grip); ui.update(0.1);
  assert.equal(ui.navigation.mini.mesh.parent, ui.hud.mesh); assert.ok(ui.navigation.mini.mesh.position.y > 0);
  assert.equal(ui.navigation.mini.mesh.material.depthTest, false);
  G.input.btn.left[5] = true; ui.update(0.1); assert.equal(ui.menuOpen, true);
  ui.showToolsMenu(); G.input.btn.left[5] = false; G.input.btn.right[4] = true;
  ui.update(0.1); assert.equal(ui.navigation.full.mesh.visible, true);
  G.input.btn.right[4] = false;
  G.input.btn.right[5] = true; ui.update(0.1); assert.equal(ui.navigation.open, false); assert.equal(ui.list.visible, true);
  assert.ok(ui.list.title.includes('Mod tools')); assert.equal(ui.list.items[ui.list.index].id, 'map');
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

test('classic menu keeps its seven direct commands, disabled actions and separate Mod tools parent paths', t => {
  const ui = environment(t); ui.openMenu();
  const core = ['items', 'skills', 'equip', 'status', 'oath', 'save', 'title'];
  assert.deepEqual(ui.list.items.map(item => item.id), core);
  assert.equal(ui.list.rows, 7); assert.equal(ui.list.top, 0); assert.equal(ui.list.classic, true);
  assert.equal(ui.list.items.find(item => item.id === 'oath').enabled, false);
  const actions = [];
  for (const [method, id] of [['showItems', 'items'], ['showSkills', 'skills'], ['showEquipSlots', 'equip'], ['showStatus', 'status'], ['showOath', 'oath']])
    t.mock.method(ui, method, () => actions.push(id));
  G.openSaveMenu = () => actions.push('save');
  G.input.keys.add('Enter'); ui.list.index = 4; ui.list.update(null);
  assert.equal(actions.length, 0, 'disabled Oath cannot be activated from keyboard');
  G.input.keys.clear(); G.state.party.spirits.push(1);
  for (const id of core.slice(0, -1)) {
    ui.showMainMenu();
    const row = ui.list.items.findIndex(item => item.id === id);
    ui.list.onSelect(row, ui.list.items[row]);
    assert.equal(actions.at(-1), id, `${id} opens its real destination directly instead of a grouped submenu`);
    ui.reopenMain(id); assert.equal(ui.list.items[ui.list.index].id, id);
    assert.deepEqual(ui.list.items.map(item => item.id), core);
  }
  G.state.system.saveDisabled = true; ui.showMainMenu();
  assert.equal(ui.list.items.find(item => item.id === 'save').enabled, false);
  const before = actions.length;
  G.input.keys.add('Enter'); ui.list.index = 5; ui.list.update(null);
  assert.equal(actions.length, before, 'disabled Save must not call the save screen');
  G.input.keys.clear();
  ui.reopenMain('status'); ui.showToolsMenu();
  assert.deepEqual(ui.list.items.map(item => item.id), ['map', 'load', 'coop', 'settings', 'adjust', 'back-main']);
  ui.list.onCancel();
  assert.deepEqual(ui.list.items.map(item => item.id), core);
  assert.equal(ui.list.items[ui.list.index].id, 'status', 'leaving Mod tools preserves the previous core selection');
  for (const id of ['map', 'load', 'coop', 'adjust', 'settings']) {
    ui.reopenMain(id); assert.ok(ui.list.title.includes('Mod tools'));
    assert.equal(ui.list.items[ui.list.index].id, id);
  }
  ui.onMenu('settings');
  for (const id of ['options', 'turn', 'speed', 'diff', 'spectator']) assert.ok(ui.list.items.some(item => item.id === id));
  let saved = 0; G.saveSettings = () => saved++;
  ui.onMenu('turn'); assert.equal(ui.list.items[ui.list.index].id, 'turn');
  ui.list.onCancel(); assert.ok(ui.list.title.includes('Mod tools')); assert.equal(ui.list.items[ui.list.index].id, 'settings');
  saved = 0;
  ui.showOptionsMenu(); const toggle = ui.list.items.findIndex(item => item.id === 'minimap');
  ui.list.onSelect(toggle, ui.list.items[toggle]); assert.equal(G.settings.minimap, false); assert.equal(saved, 1);
  ui.onMenu('title'); assert.equal(ui.list.index, 0, 'returning to title starts on Cancel');
});

test('asynchronous save opening cannot re-show the overview or dispatch a second request from stale commands', t => {
  const ui = environment(t); let requests = 0;
  G.openSaveMenu = () => { requests++; return new Promise(() => {}); };
  ui.openMenu(); ui.onMenu('save');
  G.input.keys.add('Enter'); ui.update(0.1); ui.update(0.1);
  assert.equal(requests, 1); assert.equal(ui.list.visible, false); assert.equal(ui.menuOverview.mesh.visible, false);
  ui.reopenMain('save'); assert.equal(ui.list.items[ui.list.index].id, 'save');
  assert.equal(ui.menuOverview.mesh.visible, true);
});

test('desktop pointer clicks the hovered menu row on its first frame and the visible Back button', t => {
  const ui = environment(t), input = G.input;
  Object.assign(input, { pointer: { seen: true, x: 0, y: 0 }, pointerLocked: false,
    mouse: { buttons: 1, prevButtons: 0 }, dom: { getBoundingClientRect: () => ({ left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 }) } });
  ui.camera.aspect = 1.5; ui.camera.updateProjectionMatrix(); ui.openMenu(); ui.placeRoot(true);
  const pointAt = (px, py, panel = ui.list.panel) => {
    const mesh = panel.mesh;
    ui.root.updateMatrixWorld(true);
    const p = mesh.localToWorld(new THREE.Vector3((px / panel.canvas.width - 0.5) * panel.widthM, (0.5 - py / panel.canvas.height) * panel.heightM, 0)).project(ui.camera);
    input.pointer.x = (p.x + 1) * 600; input.pointer.y = (1 - p.y) * 400;
  };
  const click = () => {
    input.mouse.buttons = 0; input.endFrame();
    input.mouse.buttons = 1; input.mousePresses = 1; ui.update(0.1); input.endFrame();
  };
  pointAt(200, ui.list.rowTop + 3 * ui.list.rowH + 25); click();
  assert.equal(ui.list.title, 'Status', 'first click opens Status directly instead of the old keyboard selection or a Character group');
  assert.equal(ui.list.classic, false); assert.equal(ui.menuOverview.mesh.visible, false);
  pointAt(ui.list.panel.canvas.width - 80, 48); click();
  assert.equal(ui.list.classic, true); assert.equal(ui.list.items[ui.list.index].id, 'status', 'clicking Back restores the original command and its selection');
  pointAt(100, 12); click();
  assert.equal(ui.list.items[ui.list.index].id, 'status', 'clicking the noninteractive top border cannot activate the selected command');
  pointAt(780, 890, ui.menuOverview); click();
  assert.ok(ui.list.title.includes('Mod tools'), 'the separate overview button opens Mod tools through real pointer input');
  assert.equal(ui.list.items[ui.list.index].id, 'map');
});
