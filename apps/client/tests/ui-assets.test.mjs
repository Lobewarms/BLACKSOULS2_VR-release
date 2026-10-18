import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { setWindowSkin, drawGameWindow, drawGameCursor } from '../src/ui/window-skin.js';

globalThis.location = { search: '?lang=en' };
globalThis.addEventListener ||= () => {};
const { $data } = await import('../src/data/data.js');
const { BattlerBase } = await import('../src/game/state.js');
const { UI, loadUiAssets, getIconSet } = await import('../src/ui/ui.js');
const { initAssets, loadCanvas } = await import('../src/data/assets.js');
const { ActionEnemy } = await import('../src/combat/combat.js');

function canvas() {
  const record = { texts: [], images: [], gradients: 0, fills: 0 };
  const ctx = new Proxy({
    clearRect() { record.texts.length = 0; record.images.length = 0; record.gradients = 0; record.fills = 0; },
    fillText(text) { record.texts.push(text); },
    drawImage(...args) { record.images.push(args); },
    fill() { record.fills++; },
    measureText: text => ({ width: Array.from(String(text)).length * 12 }),
    createLinearGradient() { record.gradients++; return { addColorStop() {} }; },
    createRadialGradient: () => ({ addColorStop() {} }),
    getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }),
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  return { width: 0, height: 0, getContext: () => ctx, record };
}

function environment(t) {
  const saved = { state: G.state, combat: G.combat, scripts: G.scripts, time: G.time, theater: G.theater,
    map: G.map, vr: G.vr, player: G.player, floorAt: G.floorAt, coop: G.coop, ui: G.ui };
  const data = { states: $data.states, system: $data.system, enemies: $data.enemies, classes: $data.classes };
  const document = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const image = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  t.after(() => {
    Object.assign(G, saved); Object.assign($data, data); setWindowSkin(null);
    if (document) Object.defineProperty(globalThis, 'document', document); else delete globalThis.document;
    if (image) Object.defineProperty(globalThis, 'Image', image); else delete globalThis.Image;
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: canvas } });
  $data.states = [null, { id: 1, name: 'Death', icon_index: 1, features: [] },
    { id: 2, name: 'Poison', icon_index: 702, priority: 90, features: [] }];
  $data.system = { currency_unit: 'souls', terms: { params: ['Max HP', 'Max MP', 'Attack', 'Defense', 'Magic', 'Magic defense', 'Agility', 'Luck'] } };
  $data.classes = [];
  $data.enemies = [null, { id: 1, name: 'Test Fiend', battler_name: '', params: [100, 50, 10, 10, 10, 10, 10, 10], features: [], note: '' }];
  class Actor extends BattlerBase { paramBase(id) { return [100, 50, 10, 10, 10, 10, 10, 10][id]; } }
  const actor = new Actor();
  Object.assign(actor, { hp: 100, mp: 50, name: 'Player', level: 1, equips: [], partners: [] });
  G.state = { party: { leader: () => actor, gold: 42 }, v: () => 0, sw: () => false };
  G.combat = { stamina: 1 }; G.scripts = {}; G.time = 0; G.theater = null; G.vr = false; G.ui = null;
  G.map = { mapId: 1, playerChar: { fx: 20, fy: 20 }, nearX: x => x, nearY: y => y };
  G.floorAt = () => 0; G.coop = null;
  return actor;
}

function createUI(t) {
  const ui = new UI(new THREE.Scene(), new THREE.PerspectiveCamera(), new THREE.Group());
  G.ui = ui;
  t.after(() => ui.scene.traverse(object => {
    object.geometry?.dispose();
    if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      material.map?.dispose(); material.dispose();
    }
  }));
  return ui;
}

test('missing game artwork keeps readable menus and status labels through the fallback', async t => {
  const actor = environment(t);
  t.mock.method(globalThis, 'fetch', async url => url === '/api/manifest' ? Response.json({ files: [] }) : new Response('', { status: 404 }));
  await initAssets(); await loadUiAssets();
  actor.addState(2);
  const ui = createUI(t);
  ui.drawHud(); ui.showStatus();
  assert.ok(ui.hud.canvas.record.texts.includes('Poison'));
  assert.ok(ui.list.panel.canvas.record.texts.includes('Poison'));
  assert.equal(ui.list.panel.canvas.record.images.length, 0, 'missing art must not turn into fabricated icons');
  assert.ok(ui.list.panel.canvas.record.gradients > 0 && ui.list.panel.canvas.record.fills > 1,
    'the menu background and selected-row fallback remain visible');
});

test('game window and cursor preserve source corners when stretched and avoid invalid tiny slices', t => {
  const skin = { width: 128, height: 128 }, target = canvas(), ctx = target.getContext('2d');
  setWindowSkin(skin); t.after(() => setWindowSkin(null));
  assert.equal(drawGameWindow(ctx, 10, 20, 220, 140), true);
  const corner = source => target.record.images.find(args => args.slice(1, 5).every((value, index) => value === source[index]));
  assert.deepEqual(corner([64, 0, 16, 16]).slice(5), [10, 20, 16, 16]);
  assert.deepEqual(corner([112, 48, 16, 16]).slice(5), [214, 144, 16, 16]);
  assert.equal(corner([80, 16, 32, 32]), undefined,
    'the frame centre contains scroll arrows and must never be stretched over the window content');
  ctx.clearRect();
  assert.equal(drawGameCursor(ctx, 30, 40, 180, 56), true);
  assert.equal(target.record.images.length, 9);
  assert.deepEqual(corner([64, 64, 4, 4]).slice(5), [30, 40, 4, 4]);
  assert.deepEqual(corner([92, 92, 4, 4]).slice(5), [206, 92, 4, 4]);
  assert.deepEqual(corner([68, 68, 24, 24]).slice(5), [34, 44, 172, 48],
    'the cursor centre must still fill its selected row');
  ctx.clearRect(); drawGameCursor(ctx, 0, 0, 5, 3);
  assert.ok(target.record.images.every(args => args.slice(3, 5).every(n => n > 0) && args.slice(7, 9).every(n => n > 0)));
  setWindowSkin({ width: 64, height: 64 }); ctx.clearRect();
  assert.equal(drawGameWindow(ctx, 0, 0, 220, 140), false);
  assert.equal(drawGameCursor(ctx, 0, 0, 180, 56), false);
  assert.equal(target.record.images.length, 0, 'undersized or missing skin must allow the UI fallback');
});

test('player, enemy and Status menu use the exact game icon cells while menus use the original window and cursor', async t => {
  const actor = environment(t);
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class {
    set src(url) {
      this.width = url.includes('Window') ? 128 : 384;
      this.height = url.includes('Window') ? 128 : url.includes('local-assets') ? 1600 : 1440;
      queueMicrotask(() => this.onload());
    }
  } });
  t.mock.method(globalThis, 'fetch', async url => {
    if (url === '/api/manifest') return Response.json({ files: ['Graphics/System/IconSet.png', 'Graphics/System/Window.png'] });
    if (url.includes('icons.json')) return Response.json({ game: 'C:\\Game', iconSet: '/local-assets/IconSet.png?revision=' + 'a'.repeat(64) });
    return Response.json({ game: 'c:/game/' });
  });
  await initAssets(); await loadUiAssets();
  const glow = new THREE.Texture(), system = { root: new THREE.Group(), glowTexture: () => glow, groggyMax: () => 100, skyHidden: () => false };
  const enemy = new ActionEnemy(system, null, 1, 0, 0, { dormant: true });
  t.after(() => { enemy.remove(); glow.dispose(); });
  await enemy.ready;
  actor.addState(2); actor.addBuff(2, 2); enemy.b.addState(2); enemy.b.addBuff(2, 2);
  const ui = createUI(t);
  ui.drawHud(); enemy.updateNameplate(new THREE.Vector3(0, 1.6, 3));
  const sheet = getIconSet(702), skin = await loadCanvas('Graphics/System', 'Window');
  assert.equal(sheet.height, 1440, 'the installed game sheet must win over a larger archived sheet when its icon exists');
  const drawnIcon = (record, id) => record.images.some(([source, x, y, w, h]) =>
    source === sheet && x === id % 16 * 24 && y === Math.floor(id / 16) * 24 && w === 24 && h === 24);
  for (const id of [702, 66]) {
    assert.ok(drawnIcon(ui.hud.canvas.record, id), `player must show game icon ${id}`);
    assert.ok(drawnIcon(enemy.barCanvas.record, id), `enemy must show game icon ${id}`);
  }
  ui.menuOpen = true; ui.showStatus();
  const menu = ui.list.panel.canvas.record;
  for (const id of [702, 66]) assert.ok(drawnIcon(menu, id), `Status must show game icon ${id}`);
  assert.ok(menu.images.some(([source, x, y, w, h]) => source === skin && x === 64 && y === 0 && w === 16 && h === 16),
    'the actual menu must use Window.png frame corners');
  assert.ok(menu.images.some(([source, x, y, w, h, , dy]) => source === skin && x === 64 && y === 64 && w === 4 && h === 4 && dy === 100),
    'the selected menu row must use the game cursor');
  assert.equal(menu.gradients, 0, 'available game window art must replace the generated menu background');
});
