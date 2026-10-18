import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { Input } from '../src/core/input.js';

globalThis.location = { search: '?lang=en' };
globalThis.addEventListener ||= () => {};
const { UI, loadUiAssets, getIconSet } = await import('../src/ui/ui.js');
const { $data } = await import('../src/data/data.js');
const { initAssets } = await import('../src/data/assets.js');
const { BattlerBase, GameParty } = await import('../src/game/state.js');
const { CombatSystem } = await import('../src/combat/combat.js');

function canvas() {
  const record = { texts: [], images: [], clears: 0 };
  const ctx = new Proxy({
    clearRect() { record.texts.length = 0; record.images.length = 0; record.clears++; },
    fillText(text, x, y) { record.texts.push({ text, x, y }); },
    drawImage(...args) { record.images.push(args); },
    measureText: text => ({ width: Array.from(String(text)).length * 12 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }),
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  return { width: 0, height: 0, record, getContext: () => ctx };
}
function environment(t) {
  const before = { ...G }, data = { items: $data.items, weapons: $data.weapons, armors: $data.armors,
    states: $data.states, system: $data.system };
  const document = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const image = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  t.after(() => {
    Object.assign(G, before); Object.assign($data, data);
    if (document) Object.defineProperty(globalThis, 'document', document); else delete globalThis.document;
    if (image) Object.defineProperty(globalThis, 'Image', image); else delete globalThis.Image;
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: canvas } });
  $data.items = [null, { id: 1, name: 'Original \\C[2]Potion', icon_index: 529 }];
  $data.weapons = []; $data.armors = []; $data.states = [null];
  $data.system = { currency_unit: 'souls', terms: { params: ['HP', 'MP', 'ATK', 'DEF', 'MAT', 'MDF', 'AGI', 'LUK'] } };
  class Actor extends BattlerBase { paramBase(id) { return id === 0 ? 100 : 20; } }
  const leader = new Actor(); Object.assign(leader, { hp: 100, mp: 20, name: 'Player', level: 1, equips: [], partners: [] });
  const party = new GameParty(); party.actors = [1];
  G.state = { party, actor: () => leader, system: { winCount: 0 }, v: () => 0, sw: () => false };
  G.settings = { ...G.settings }; G.time = 0; G.frame = 1; G.vr = false; G.scripts = {}; G.map = null;
  G.player = { floatDown() {} }; G.coop = null; G.arena = null; G.theater = null; G.three = null;
  G.combat = { stamina: 1 }; const sounds = []; G.audio = { playSystemSe: id => sounds.push(id) };
  const size = { width: 1280, height: 720 };
  G.input = Object.assign(Object.create(Input.prototype), {
    dom: { getBoundingClientRect: () => ({ left: 0, top: 0, ...size }) },
    pointer: { seen: false }, pointerLocked: false, keys: new Set(), keysPrev: new Set(),
    mouse: { buttons: 0, prevButtons: 0, wheel: 0 }, mousePresses: 0,
    controllers: {}, axes: { left: [0, 0], right: [0, 0] }, btn: { left: [], right: [] }, btnPrev: { left: [], right: [] },
  });
  const camera = new THREE.PerspectiveCamera(75, size.width / size.height, 0.1, 100);
  const ui = G.ui = new UI(new THREE.Scene(), camera, new THREE.Group()); ui.attachHud(null);
  return { ui, leader, party, sounds, size };
}

test('real UI gain notifications go to the corner feed without blocking play or recentering menu panels', t => {
  const { ui, sounds } = environment(t);
  ui.update(0); const anchor = () => [...ui.root.position.toArray(), ...ui.root.quaternion.toArray(), ...ui.root.scale.toArray()];
  const before = anchor();
  ui.notifyGain('item', 1, 1); ui.notifyGain('item', 1, 2); ui.notifyGold(8);
  assert.equal(ui.rewards.queue.length, 2); assert.equal(ui.rewards.queue[0].count, 3);
  assert.equal(ui.rewards.queue[0].name, 'Original Potion', 'game formatting escapes are removed from the display name');
  assert.equal(ui.toasts.length, 0); assert.equal(ui.toastPanel.mesh.visible, false);
  ui.update(0.2); assert.equal(ui.rewards.mesh.visible, true); assert.equal(ui.rewards.mesh.parent, ui.camera);
  assert.deepEqual(anchor(), before, 'adding pickup art must not change the central menu anchor');
  assert.equal(ui.sceneBusy(), false); assert.equal(ui.messageBusy(), false); assert.equal(ui.consumedConfirm, false);
  assert.ok(ui.rewards.panel.canvas.record.texts.some(entry => entry.text === '×3'));
  assert.deepEqual(sounds, [22, 22]);
  ui.notifyGain('item', 999, 1); ui.notifyGain('item', 1, 0); ui.notifyGold(-1);
  assert.equal(ui.rewards.queue.length, 1); assert.deepEqual(sounds, [22, 22]);
});

test('real UI frames pause reward timers for dialogue, menus and defeat, then resume pending gains', t => {
  const { ui } = environment(t); ui.notifyGain('item', 1, 1); ui.update(0); ui.update(1);
  ui.notifyGold(5);
  const clock = ui.rewards.clock, age = ui.rewards.rows[0].age;
  const paused = () => {
    ui.update(1); assert.equal(ui.rewards.mesh.visible, false);
    assert.equal(ui.rewards.clock, clock); assert.equal(ui.rewards.rows[0].age, age); assert.equal(ui.rewards.queue.length, 1);
  };
  ui.showMessage({ lines: ['Dialogue stays visible while the player reads.'], position: 2 }); paused();
  ui.msg = null; ui.msgPanel.mesh.visible = false;
  ui.menuOpen = true; ui.list.open('Menu', [{ text: 'Resume' }]); paused();
  ui.closeMenu(); G.combat.playerDead = true; paused();
  G.combat.playerDead = false; ui.update(0.4);
  assert.equal(ui.rewards.mesh.visible, true); assert.ok(ui.rewards.rows[0].age > age); assert.equal(ui.rewards.rows.length, 2);
});

test('actual combat rewards still update inventory and currency while displaying gains through the corner feed', t => {
  const { ui, party } = environment(t);
  const combat = Object.assign(Object.create(CombatSystem.prototype), { music: null, battles: [], fightStates: null, defeated: new Map() });
  G.combat = combat;
  const reward = { note: '', gold: 17, exp: 0, drop_items: [{ kind: 1, data_id: 1, denominator: 1 }] };
  combat.onBattleEnd({ result: 0, enemies: [{ data: reward }, { escaped: true, data: { ...reward, gold: 999 } }] });
  assert.equal(party.itemCount('item', 1), 1); assert.equal(party.gold, 17); assert.equal(G.state.system.winCount, 1);
  assert.deepEqual(ui.rewards.queue.map(row => [row.kind, row.count]), [['item', 1], ['gold', 17]]);
  assert.equal(ui.toasts.length, 0, 'combat reward currency must not recreate a central toast');
  ui.update(0); ui.update(0.4); assert.equal(ui.rewards.rows.length, 2); assert.equal(ui.rewards.mesh.parent, ui.camera);
});

test('late original game icon assets refresh an already visible real pickup notification', async t => {
  const { ui } = environment(t);
  t.mock.method(globalThis, 'fetch', async url => url === '/api/manifest' ? Response.json({ files: [] }) : new Response('', { status: 404 }));
  await initAssets(); await loadUiAssets();
  ui.notifyGain('item', 1, 1); ui.update(0); ui.update(0.2);
  assert.ok(ui.rewards.panel.canvas.record.texts.some(entry => entry.text === 'Original Potion'));
  assert.equal(ui.rewards.panel.canvas.record.images.length, 0);
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class {
    set src(_url) { this.width = 384; this.height = 1440; queueMicrotask(() => this.onload()); }
  } });
  t.mock.method(globalThis, 'fetch', async url => url === '/api/manifest' ?
    Response.json({ files: ['Graphics/System/IconSet.png'] }) : new Response('', { status: 404 }));
  await initAssets(); await loadUiAssets(); ui.update(0);
  const sheet = getIconSet(529);
  assert.ok(ui.rewards.panel.canvas.record.images.some(([source, x, y, w, h]) =>
    source === sheet && x === 24 && y === 792 && w === 24 && h === 24));
  assert.equal(ui.toasts.length, 0);
});
