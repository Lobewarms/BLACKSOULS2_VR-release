import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { initAssets } from '../src/data/assets.js';
import { PictureLayer } from '../src/ui/pictures.js';
import { ScreenFx } from '../src/ui/screen.js';

const show = (id, name, x = 0) => [id, name, 0, 0, x, 0, 100, 100, 255, 0];
const move = (id, x, frames = 2) => [id, null, 0, 0, x, 0, 100, 100, 255, 0, frames];
let serial = 0;
async function environment(t, { delayed = false } = {}) {
  const saved = { ...G }, prefix = `PictureScope${++serial}`, draws = [], pending = new Map();
  const names = ['Map', 'BattleA', 'BattleB', 'NewA', 'ResetPending'].map(name => prefix + name);
  const context = record => new Proxy({
    clearRect() { if (record) draws.length = 0; }, drawImage(image, x, y) { if (record) draws.push({ name: image.name, x, y }); },
    createRadialGradient: () => ({ addColorStop() {} }),
    getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }),
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  let canvases = 0;
  for (const [name, value] of Object.entries({
    addEventListener: globalThis.addEventListener || (() => {}),
    document: { createElement: () => { const record = ++canvases === 1; return { width: 0, height: 0, getContext: () => context(record) }; } },
    Image: class { width = 640; height = 480; set src(url) {
      this.name = decodeURIComponent(url).split('/').at(-1).replace(/\.png$/, ''); pending.set(this.name, this);
      if (!delayed) queueMicrotask(() => this.onload());
    } },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; });
  }
  t.after(() => Object.assign(G, saved));
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: names.map(name => `Graphics/Pictures/${name}.png`) }));
  await initAssets();
  const camera = new THREE.PerspectiveCamera(), ui = { root: new THREE.Group(), placeRoot() {} };
  Object.assign(G, { theater: null, vr: false, player: null, state: null, worldTone: null, settings: {}, time: 0 });
  const pictures = G.pictures = new PictureLayer(ui, camera), screen = G.screen = new ScreenFx(camera);
  const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  const painted = () => { screen.apply(); return draws.map(draw => draw.name); };
  return { pictures, screen, names, draws, pending, settle, painted };
}

const command = (code, parameters = []) => ({ code, parameters, indent: 0 });
async function interpreterEnvironment(t) {
  const e = await environment(t), data = { ...$data };
  t.after(() => Object.assign($data, data));
  const { Interpreter } = await import('../src/game/interpreter.js');
  const { CombatSystem } = await import('../src/combat/combat.js');
  Object.assign(G, { coop: null, theater: null, arena: null, audio: null,
    player: { floatDown() {} }, map: { mapId: 45, events: {}, transferring: false }, scripts: {},
    ui: { messageBusy: () => false }, state: { system: { winCount: 0, escapeCount: 0 },
      party: { leader: () => null, members: () => [], partyAbility: () => false } },
  });
  $data.commonEvents = []; $data.states = []; $data.system = { sounds: [] };
  const combat = G.combat = new CombatSystem(new THREE.Scene());
  const battle = { done: false, result: -1, enemies: [] }; combat.battles.push(battle);
  $data.commonEvents[2] = { list: [command(231, show(1, e.names[1])), command(232, [...move(1, 80), true]),
    command(230, [1]), command(235, [1]), command(231, show(1, e.names[1])), command(0)] };
  const source = new Interpreter(1); source.troop = true;
  source.setup([command(117, [2]), command(230, [3]), command(231, show(1, e.names[2])), command(0)]);
  source.battleOwner = battle; battle.troopInterp = source;
  return { ...e, combat, battle, source };
}

test('map and troop picture numbers are separate, scoped moves/erases preserve the map and battle end restores it immediately', async t => {
  const e = await environment(t), [map, first] = e.names, battle = { done: false };
  e.screen.showPicture(show(1, map, 12)); await e.settle(); assert.deepEqual(e.painted(), [map]);
  const mapPicture = e.pictures.pics.get(1);
  e.screen.showPicture(show(1, first), battle); await e.settle(); assert.deepEqual(e.painted(), [first]);
  assert.equal(e.pictures.pics.get(1), mapPicture);
  e.screen.movePicture(move(1, 80), battle); e.screen.updateLogic(); e.screen.updateLogic();
  assert.equal(mapPicture.x, 12); assert.equal(e.pictures.battlePics.get(battle).get(1).x, 80);
  e.screen.erasePicture(1, battle); assert.deepEqual(e.painted(), []);
  assert.equal(e.pictures.mesh.visible, false); assert.equal(e.pictures.backdrop.visible, false);
  assert.equal(e.pictures.pics.get(1), mapPicture, 'an empty battle screen still cannot erase the map picture');
  e.screen.endBattlePictures(battle);
  assert.equal(e.pictures.mesh.visible, true); assert.equal(e.pictures.backdrop.visible, true);
  assert.deepEqual(e.draws.map(draw => draw.name), [map]); assert.equal(e.draws[0].x, 12);
  assert.equal(e.pictures.battlePics.size, 0);
});

test('overlapping battle lifetimes restore only the latest still-live screen and discard completed scopes before rendering', async t => {
  const e = await environment(t), [map, first, second] = e.names, a = { done: false }, b = { done: false };
  e.screen.showPicture(show(1, map)); e.screen.showPicture(show(1, first), a); e.screen.showPicture(show(1, second), b);
  await e.settle(); assert.deepEqual(e.painted(), [second]);
  e.screen.endBattlePictures(b); assert.deepEqual(e.draws.map(draw => draw.name), [first]);
  a.done = true; assert.deepEqual(e.painted(), [map]);
  assert.equal(e.pictures.battlePics.size, 0);
  e.screen.showPicture(show(2, second), a); e.screen.showPicture(show(2, second), b);
  assert.deepEqual(e.painted(), [map], 'an ended owner cannot recreate a picture scope, even before its done field changes');
});

test('reset hides the last troop image/backdrop synchronously and leaves map records available for later display', async t => {
  const e = await environment(t), [, first] = e.names, battle = { done: false };
  e.screen.showPicture(show(1, first), battle); await e.settle(); e.painted();
  assert.equal(e.pictures.mesh.visible, true); assert.equal(e.pictures.backdrop.visible, true);
  e.screen.clearBattlePictures();
  assert.equal(e.pictures.mesh.visible, false); assert.equal(e.pictures.backdrop.visible, false);
  e.screen.showPicture(show(1, first), battle); assert.equal(e.pictures.battlePics.size, 0);
  const next = { done: false }; e.screen.showPicture(show(1, first), next); await e.settle();
  assert.deepEqual(e.painted(), [first], 'a new fight can use the same original picture ID and asset normally');
  e.pictures.clear(); e.pictures.render(); assert.equal(e.pictures.mesh.visible, false);
});

test('late image completions from ended, reset, replaced and erased troop pictures cannot resurrect them', async t => {
  const e = await environment(t, { delayed: true }), [map, first, second, replacement] = e.names;
  const a = { done: false }, b = { done: false };
  e.screen.showPicture(show(1, map)); e.screen.showPicture(show(1, first), a); await e.settle();
  e.screen.endBattlePictures(a); e.pending.get(first).onload(); await e.settle();
  assert.deepEqual(e.painted(), []); assert.equal(e.pictures.battlePics.size, 0);
  e.pending.get(map).onload(); await e.settle(); assert.deepEqual(e.painted(), [map]);
  e.screen.showPicture(show(1, second), b); await e.settle();
  e.screen.showPicture(show(1, replacement), b); await e.settle(); e.pending.get(second).onload(); await e.settle();
  assert.deepEqual(e.painted(), [], 'replaced image cannot leak through the new pending picture');
  e.screen.erasePicture(1, b); e.pending.get(replacement).onload(); await e.settle();
  assert.deepEqual(e.painted(), []); e.screen.clearBattlePictures(); assert.deepEqual(e.painted(), [map]);
  const c = { done: false }; e.screen.showPicture(show(2, e.names[4]), c); await e.settle();
  e.screen.clearBattlePictures(); e.pending.get(e.names[4]).onload(); await e.settle();
  assert.deepEqual(e.painted(), [map]); assert.equal(e.pictures.backdrop.visible, true);
});

test('battle decorative pictures bypass another theatre but the matching original theatre curtain path is preserved', async t => {
  const e = await environment(t), [, first] = e.names, theatreBattle = { done: false }, other = { done: false };
  let shown = 0, erased = 0;
  G.theater = { battle: theatreBattle, takePicture() { shown++; return true; }, erasePicture() { erased++; } };
  e.screen.showPicture(show(1, first), other); await e.settle(); assert.deepEqual(e.painted(), [first]);
  assert.equal(shown, 0); e.screen.erasePicture(1, other); assert.equal(erased, 0);
  e.screen.endBattlePictures(other);
  e.screen.showPicture(show(1, first), theatreBattle); assert.equal(shown, 1);
  e.screen.erasePicture(1, theatreBattle); assert.equal(erased, 1);
  e.screen.showPicture(show(2, first)); assert.equal(shown, 2, 'existing map curtain interception remains compatible');
});

test('temporarily hidden map viewers cannot receive a cancel intended for a battle picture screen', async t => {
  const e = await environment(t), [map, first] = e.names, battle = { done: false };
  let cancels = 0; G.input = { requestRmCancel: () => cancels++ };
  G.map = { eventList: [{ page: {}, trigger: 3, list: [
    { code: 111, indent: 0, parameters: [11, 12] }, { code: 235, indent: 1, parameters: [1] },
  ] }] };
  e.screen.showPicture(show(1, map)); e.screen.showPicture(show(1, first), battle);
  assert.equal(e.pictures.requestViewerCancel(), false); assert.equal(cancels, 0);
  e.screen.endBattlePictures(battle);
  assert.equal(e.pictures.requestViewerCancel(), true); assert.equal(cancels, 1);
});

test('real troop common-event children share scoped show/move/erase and actual combat end removes their last picture', async t => {
  const e = await interpreterEnvironment(t), [map, first] = e.names;
  e.screen.showPicture(show(1, map, 12)); e.source.update();
  assert.equal(e.source.child.waitCount, 1, 'Move Picture wait belongs to the real child interpreter after its first tick');
  assert.equal(e.pictures.battlePics.get(e.battle).get(1).d, 2);
  await e.settle(); assert.deepEqual(e.painted(), [first]);
  for (let i = 0; i < 5; i++) { e.screen.updateLogic(); e.source.update(); }
  await e.settle(); e.painted();
  assert.equal(e.pictures.pics.get(1).x, 12); assert.equal(e.pictures.battlePics.get(e.battle).get(1).name, first);
  e.battle.done = true; e.battle.result = 1; e.combat.onBattleEnd(e.battle);
  assert.deepEqual(e.draws.map(draw => draw.name), [map], 'the original end hook restores the map in the same render');
  assert.equal(e.pictures.battlePics.size, 0);
  const next = { done: false, enemies: [] }; e.combat.battles.push(next);
  for (let i = 0; i < 12; i++) e.source.update();
  assert.deepEqual(e.painted(), [map]); assert.equal(e.pictures.battlePics.size, 0,
    'a stale child/root cannot rebind its picture commands to a different active fight');
});

test('actual combat reset clears a live troop picture scope and blocks its delayed interpreter continuation', async t => {
  const e = await interpreterEnvironment(t), [map, first] = e.names;
  e.screen.showPicture(show(1, map)); e.source.update(); await e.settle(); assert.deepEqual(e.painted(), [first]);
  e.combat.reset();
  assert.deepEqual(e.draws.map(draw => draw.name), [map]); assert.equal(e.pictures.battlePics.size, 0);
  for (let i = 0; i < 12; i++) { e.source.update(); e.screen.updateLogic(); }
  await e.settle(); assert.deepEqual(e.painted(), [map]); assert.equal(e.pictures.battlePics.size, 0);
});

test('only map picture commands reach co-op transport when a troop uses the same show/move/erase IDs', async t => {
  const e = await interpreterEnvironment(t), records = [], { Interpreter } = await import('../src/game/interpreter.js');
  G.coop = { onPicture: (_source, code, params) => records.push([code, params[0]]) };
  const mapSource = new Interpreter(0, true);
  mapSource.setup([command(231, show(1, e.names[0])), command(232, move(1, 12)), command(235, [1]), command(0)]);
  mapSource.update(); assert.deepEqual(records, [[231, 1], [232, 1], [235, 1]]);
  for (let i = 0; i < 12; i++) { e.source.update(); e.screen.updateLogic(); }
  assert.deepEqual(records, [[231, 1], [232, 1], [235, 1]], 'troop commands cannot serialize or erase the map picture IDs');
});

test('reset before a troop first shows a picture cannot create a new scope from its old delayed command', async t => {
  const e = await interpreterEnvironment(t), [map, first] = e.names;
  e.screen.showPicture(show(1, map)); await e.settle(); assert.deepEqual(e.painted(), [map]);
  e.source.setup([command(230, [5]), command(231, show(1, first)), command(0)]);
  e.source.battleOwner = e.battle; e.source.update();
  assert.equal(e.pictures.battlePics.size, 0); e.combat.reset();
  for (let i = 0; i < 12; i++) e.source.update();
  await e.settle(); assert.deepEqual(e.painted(), [map]); assert.equal(e.pictures.battlePics.size, 0);
});
