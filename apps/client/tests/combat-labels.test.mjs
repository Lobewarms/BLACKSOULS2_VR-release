import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { packEnemyBuffs, readEnemyBuffs } from '../src/network/enemy-status.js';

globalThis.location = { search: '?lang=en' };
globalThis.addEventListener ||= () => {};
const { $data } = await import('../src/data/data.js');
const { BattlerBase } = await import('../src/game/state.js');
const { UI, loadUiAssets } = await import('../src/ui/ui.js');
const { battlerEffects } = await import('../src/ui/battler-status.js');
const { initAssets } = await import('../src/data/assets.js');

function canvas() {
  const record = { texts: [], icons: [], clears: 0 };
  const ctx = new Proxy({
    clearRect() { record.texts.length = 0; record.icons.length = 0; record.clears++; },
    fillText(text, x, y) { record.texts.push({ text, x, y }); },
    drawImage(...args) { record.icons.push(args); },
    measureText: text => ({ width: Array.from(String(text)).length * 12 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  return { width: 0, height: 0, getContext: () => ctx, record };
}

function environment(t) {
  const saved = { state: G.state, combat: G.combat, scripts: G.scripts, time: G.time,
    theater: G.theater, map: G.map, vr: G.vr };
  const data = { states: $data.states, system: $data.system, enemies: $data.enemies, classes: $data.classes };
  const document = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    Object.assign(G, saved); Object.assign($data, data);
    if (document) Object.defineProperty(globalThis, 'document', document); else delete globalThis.document;
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: canvas } });
  $data.states = [null, { id: 1, name: 'Death', icon_index: 1, features: [] }];
  for (let id = 2; id <= 9; id++) $data.states[id] = { id, name: id === 2 ? 'Poison' : id === 3 ? 'Curse' : `Effect ${id}`,
    icon_index: id === 3 ? 0 : 700 + id, priority: 100 - id, features: [] };
  $data.system = { currency_unit: 'souls', terms: { params: ['Max HP', 'Max MP', 'Attack', 'Defense', 'Magic', 'Magic defense', 'Agility', 'Luck'] } };
  $data.classes = [];
  $data.enemies = [null, { id: 1, name: 'Test Fiend', battler_name: '', params: [100, 50, 10, 10, 10, 10, 10, 10], features: [], note: '' }];
  class Actor extends BattlerBase { paramBase(id) { return [100, 50, 10, 10, 10, 10, 10, 10][id]; } }
  const actor = new Actor();
  Object.assign(actor, { hp: 100, mp: 50, name: 'Player', level: 1, equips: [], partners: [] });
  G.state = { party: { leader: () => actor, gold: 42 }, v: () => 0, sw: () => false };
  G.combat = { stamina: 1 }; G.scripts = {}; G.time = 0; G.theater = null; G.vr = false;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: [] }));
  return actor;
}

test('player HUD shows named effects without artwork, refreshes changes and lists overflow in Status', async t => {
  const actor = environment(t);
  actor.addState(2); actor.addState(3); actor.addBuff(2, 1); actor.addDebuff(3, 1);
  const ui = new UI(new THREE.Scene(), new THREE.PerspectiveCamera(), new THREE.Group());
  ui.drawHud();
  const text = () => ui.hud.canvas.record.texts.map(entry => entry.text);
  assert.ok(text().includes('Poison')); assert.ok(text().includes('Curse'), 'iconless effects must remain visible');
  assert.ok(text().includes('Attack ↑')); assert.ok(text().includes('Defense ↓'));
  assert.equal(ui.hud.mesh.material.depthTest, false, 'world geometry cannot hide the wrist HUD');
  ui.attachHud(null);
  assert.equal(ui.hud.mesh.parent, ui.camera);
  const controller = new THREE.Group(); controller.position.set(0.1, 1.2, -0.4);
  ui.attachHud(controller); ui.updateHudFollow();
  assert.equal(ui.hud.mesh.parent, ui.scene); assert.ok(ui.hud.mesh.position.y > controller.position.y);
  assert.ok(ui.hud.canvas.record.texts.every(entry => entry.y < ui.hud.canvas.height));
  let clears = ui.hud.canvas.record.clears;
  ui.drawHud(); assert.equal(ui.hud.canvas.record.clears, clears, 'unchanged HUD should reuse its texture');
  await initAssets(); await loadUiAssets();
  ui.drawHud(); assert.equal(ui.hud.canvas.record.clears, clears + 1, 'late icon assets must invalidate the cached HUD');
  actor.removeState(2); actor.tickBuffs(2); ui.drawHud();
  assert.ok(!text().includes('Poison') && !text().includes('Attack ↑') && !text().includes('Defense ↓'));
  assert.ok(text().includes('Curse'));
  for (let id = 4; id <= 9; id++) actor.addState(id);
  ui.drawHud(); assert.ok(text().some(value => value.includes('more effects')));
  const seen = new Set();
  for (G.time = 0; G.time < 8; G.time += 4) { ui.drawHud(); text().forEach(name => seen.add(name)); }
  assert.ok(battlerEffects(actor).every(effect => seen.has(effect.name)), 'overflow effects cycle into the HUD');
  let items;
  ui.list.open = (_title, rows) => { items = rows; };
  ui.showStatus();
  assert.ok(battlerEffects(actor).every(effect => items.some(row => row.text === effect.name)));
});

test('enemy nameplate appears before damage and updates states, buffs, pages, death and removal', async t => {
  environment(t); await initAssets();
  const { ActionEnemy, CombatSystem } = await import('../src/combat/combat.js');
  const glow = new THREE.Texture(); t.after(() => glow.dispose());
  const sys = { root: new THREE.Group(), skyHidden: () => false, glowTexture: () => glow, groggyMax: () => 100 };
  const enemy = new ActionEnemy(sys, null, 1, 0, 0, { dormant: true });
  await enemy.ready;
  const head = new THREE.Vector3(0, 1.6, 3);
  enemy.updateNameplate(head);
  assert.equal(enemy.bar.visible, true, 'undamaged roaming enemies need names too');
  const text = () => enemy.barCanvas.record.texts.map(entry => entry.text);
  assert.ok(text().includes('Test Fiend'));
  assert.equal(enemy.bar.material.depthTest, true, 'walls still occlude enemy labels');
  enemy.b.addState(2); enemy.b.addState(3); enemy.b.addBuff(2, 10);
  enemy.updateNameplate(head);
  assert.ok(text().includes('Poison') && text().includes('Curse') && text().includes('Attack ↑'));
  enemy.b.removeState(2); enemy.updateNameplate(head); assert.ok(!text().includes('Poison'));
  enemy.b.addState(2);
  for (let id = 4; id <= 9; id++) enemy.b.addState(id);
  const shown = new Set();
  for (G.time = 0; G.time < 9; G.time += 3) { enemy.updateNameplate(head); text().forEach(name => shown.add(name)); }
  assert.ok(battlerEffects(enemy.b).every(effect => shown.has(effect.name)), 'every effect should become readable across pages');
  const clears = enemy.barCanvas.record.clears;
  enemy.updateNameplate(head); assert.equal(enemy.barCanvas.record.clears, clears + 1, 'cycling back to the first page redraws');
  enemy.updateNameplate(head); assert.equal(enemy.barCanvas.record.clears, clears + 1, 'unchanged names/status reuse the texture');
  assert.ok(enemy.barCanvas.record.texts.every(entry => entry.x < enemy.barCanvas.width && entry.y < enemy.barCanvas.height));
  enemy.hidden = true; enemy.updateNameplate(head); assert.equal(enemy.bar.visible, false);
  enemy.hidden = false; enemy.updateNameplate(new THREE.Vector3(30, 2, 0)); assert.equal(enemy.bar.visible, false);
  enemy.noTarget = true; enemy.updateNameplate(head); assert.equal(enemy.bar.visible, false);
  enemy.noTarget = false;
  $data.enemies[2] = { ...$data.enemies[1], id: 2 };
  sys.dropMarker = () => {}; sys.hideBlade = () => {};
  CombatSystem.prototype.transformEnemy.call(sys, enemy, 2);
  await enemy.ready; enemy.updateNameplate(head);
  assert.ok(text().includes('Test Fiend'), 'a rebuilt form must paint even when its name and stats are unchanged');
  enemy.b.addState(1); enemy.updateNameplate(head); assert.equal(enemy.bar.visible, false);
  let disposed = 0;
  enemy.barTex.addEventListener('dispose', () => disposed++);
  enemy.bar.material.addEventListener('dispose', () => disposed++);
  enemy.remove(); assert.equal(disposed, 2); assert.equal(enemy.group.parent, null);
});

test('co-op status metadata carries buffs without changing legacy enemy tuples', async t => {
  environment(t);
  const { Coop } = await import('../src/network/coop.js');
  const enemy = { netId: 10, state: 'chase', fx: 1, fy: 2, group: { visible: true }, b: {
    enemyId: 1, hp: 100, mhp: 100, states: [2], buffs: [0, 0, 2, -1, 0, 0, 0, 0],
  } };
  G.map = { mapId: 1 };
  let received;
  G.combat = { symbols: new Map(), puppets: new Map(), netEnemies: () => [enemy], groggyMax: () => 0,
    applyPuppets(list) { received = list; } };
  const coop = Object.create(Coop.prototype);
  let packet;
  Object.assign(coop, { ready: () => true, guests: () => [{ id: 'guest', pose: { m: 1 } }],
    send(message) { packet = message; } });
  coop.sendEnemies();
  assert.equal(packet.e[0].length, 15);
  assert.deepEqual(packet.buffs, { 10: enemy.b.buffs });
  coop.onEnemies(packet); assert.deepEqual(received[0].statusBuffs, enemy.b.buffs);
  delete packet.buffs; coop.onEnemies(packet); assert.equal(received[0].statusBuffs, null, 'old hosts remain compatible');
  assert.deepEqual(readEnemyBuffs({}, 10), Array(8).fill(0), 'expired buffs clear on the next snapshot');
  for (const bad of [[1], Array(8).fill(3), Array(8).fill('1')]) assert.equal(readEnemyBuffs({ 10: bad }, 10), null);
  assert.deepEqual(packEnemyBuffs([{ ...enemy, b: { buffs: Array(8).fill(0) } }]), {});
});
