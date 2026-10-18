import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { Interpreter } from '../src/game/interpreter.js';
import { GameMap } from '../src/world/gamemap.js';
import { ScreenFx } from '../src/ui/screen.js';
import { ambientMapTone } from '../src/world/ambient-tone.js';
import { MapAtmosphere } from '../src/world/atmosphere.js';
import { WorldTone, worldTonePixel } from '../src/world/world-tone.js';

globalThis.addEventListener ||= () => {};
const { Coop } = await import('../src/network/coop.js');
const cmd = (code, parameters = [], indent = 0) => ({ code, parameters, indent });
const rawRed = Object.freeze({ red: -17, green: -136, blue: -136, gray: 68 });
const zero = { red: 0, green: 0, blue: 0, gray: 0 };
const asChannels = tone => ({ r: tone.red, g: tone.green, b: tone.blue, gray: tone.gray });
const luma = pixel => pixel[0] * 0.299 + pixel[1] * 0.587 + pixel[2] * 0.114;

function environment(t) {
  const saved = { ...G }, data = { ...$data }, document = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    for (const key of Object.keys(G)) if (!(key in saved)) delete G[key];
    Object.assign(G, saved); Object.assign($data, data);
    if (document) Object.defineProperty(globalThis, 'document', document); else delete globalThis.document;
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 0, height: 0,
    getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) } });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(); scene.add(camera);
  Object.assign(G, { three: { scene, camera }, worldTone: new WorldTone(scene), pictures: null, player: null,
    settings: { fxBrightness: 0.5 }, ui: { messageBusy: () => false }, audio: {}, coop: null, combat: null,
    state: { sw: () => false, party: { leader: () => ({ hp: 100, mhp: 100, isState: () => false }) } }, time: 0,
  });
  G.map = new GameMap(); G.map.mapId = 1;
  $data.commonEvents = []; $data.system = { sounds: [] };
  const screen = G.screen = new ScreenFx(camera);
  return { scene, camera, screen, map: G.map, tick: count => { for (let i = 0; i < count; i++) screen.updateLogic(); } };
}

test('strong environmental grades retain green foliage, white snow and brown wood palettes', () => {
  const leaf = [0.08, 0.48, 0.13, 0.37], snow = [0.93, 0.96, 1, 1], wood = [0.48, 0.27, 0.12, 0.8];
  for (const raw of [rawRed, { red: -68, green: -68, blue: 0, gray: 68 },
    { red: 255, green: -255, blue: -255, gray: 255 }, { red: -255, green: 255, blue: -255, gray: 255 }]) {
    const adapted = ambientMapTone(raw), forest = worldTonePixel(leaf, adapted), white = worldTonePixel(snow, adapted), brown = worldTonePixel(wood, adapted);
    assert.ok(forest[1] > forest[0] + 0.25 && forest[1] > forest[2] + 0.25, 'leaves remain recognizably green under a strong regional grade');
    assert.ok(Math.min(...white.slice(0, 3)) > 0.68 && Math.max(...white.slice(0, 3)) - Math.min(...white.slice(0, 3)) < 0.13,
      'snow stays bright and approximately neutral');
    assert.ok(brown[0] > brown[1] && brown[1] > brown[2], 'wood retains its warm brown channel ordering');
    assert.equal(forest[3], leaf[3]); assert.equal(brown[3], wood[3]);
  }
  const oldForest = worldTonePixel(leaf, rawRed);
  assert.ok(oldForest[0] > oldForest[1], 'the synthetic reported red wash would actually overpower this green sample without adaptation');
});

test('night remains darker with a restrained cool cue instead of erasing the source palette', () => {
  const surface = [0.7, 0.7, 0.7, 1], day = worldTonePixel(surface, ambientMapTone(zero));
  const night = worldTonePixel(surface, ambientMapTone({ red: -68, green: -68, blue: 0, gray: 68 }));
  assert.ok(luma(day) - luma(night) > 0.06 && luma(day) - luma(night) < 0.13);
  assert.ok(night[2] > night[0] && night[2] - night[0] <= 12 / 255 + 1e-12, 'night retains a small blue hint');
  assert.ok(Math.min(...night.slice(0, 3)) > 0.45, 'ordinary night surfaces remain readable');
  assert.deepEqual(ambientMapTone(zero), zero);
  assert.deepEqual(worldTonePixel(surface, ambientMapTone({ red: 255, green: 255, blue: 255, gray: 0 })), surface,
    'automatic all-channel brightness must not turn normal materials white');
});

test('environment normalization is finite and restrained over extreme and malformed channel combinations', () => {
  const values = [-1e20, -255, -68, 0, 68, 255, 1e20, NaN, Infinity, -Infinity, undefined, null];
  for (const red of values) for (const green of values) for (const blue of values) for (const gray of [-999, 0, 68, 999, NaN]) {
    const source = Object.freeze({ red, green, blue, gray }), result = ambientMapTone(source);
    const channels = [result.red, result.green, result.blue], mean = channels.reduce((sum, n) => sum + n, 0) / 3;
    assert.deepEqual(Object.keys(result).sort(), ['blue', 'gray', 'green', 'red']);
    assert.ok(channels.every(Number.isFinite) && Number.isFinite(result.gray));
    assert.ok(mean >= -24 - 1e-10 && mean <= 1e-10, 'environment brightness cannot blow out or black out the whole view');
    assert.ok(Math.max(...channels) - Math.min(...channels) <= 12 + 1e-10, 'environment hue cannot dominate original artwork');
    assert.ok(result.gray >= 0 && result.gray <= 12, 'original artwork must retain most of its saturation');
    assert.equal(source.red, red); assert.equal(source.green, green); assert.equal(source.blue, blue); assert.equal(source.gray, gray);
  }
  assert.deepEqual(ambientMapTone({ r: -17, g: -136, b: -136, gray: 68 }), ambientMapTone(rawRed), 'existing tone aliases have the same meaning');
});

test('actual map presentation adapts the automatic grade once before ScreenFx and WorldTone see it', t => {
  const e = environment(t), atmosphere = new MapAtmosphere(e.scene);
  t.after(() => atmosphere.dispose());
  const note = '<色調 -17,-136,-136,68>', map = Object.freeze({ tileset_id: 35, note });
  atmosphere.setMap(map, { mapId: 126, screen: e.screen, sky: { setMap() {} }, environment: { setMap() {}, clear() {} } });
  e.screen.apply();
  assert.deepEqual(e.screen.tone, asChannels(ambientMapTone(rawRed)));
  assert.deepEqual(G.worldTone.uniform.value.toArray(), [e.screen.tone.r / 255, e.screen.tone.g / 255, e.screen.tone.b / 255, e.screen.tone.gray / 255]);
  const green = worldTonePixel([0.08, 0.48, 0.13], e.screen.tone);
  assert.ok(green[1] > green[0] + 0.25 && green[1] > green[2] + 0.25);
  assert.equal(map.note, note, 'map notes remain original source data');
  e.screen.startTone({ red: 255, green: 255, blue: 255, gray: 0 }, 0);
  e.screen.apply(); assert.deepEqual(G.worldTone.uniform.value.toArray(), [1, 1, 1, 0], 'explicit scripted effects retain full screen semantics');
});

for (const entry of ['map', 'reserved', 'child']) test(`real CE290 ${entry} execution adapts atmosphere and retains transition duration and wait`, t => {
  const e = environment(t), list = [cmd(223, [rawRed, 4, true]), cmd(0)];
  $data.commonEvents[290] = { id: 290, trigger: 0, list };
  let source, active;
  if (entry === 'reserved') {
    e.map.reserveCommonEvent(290); assert.equal(e.map.setupStartingEvent(), true); source = active = e.map.interpreter;
  } else {
    source = new Interpreter(0, true);
    source.setup(entry === 'child' ? [cmd(117, [290]), cmd(0)] : list, 7);
  }
  source.update(); active ||= entry === 'child' ? source.child : source;
  assert.equal(active.list, list, 'the actual common-event list identity must survive each entry path');
  assert.deepEqual(e.screen.toneTarget, asChannels(ambientMapTone(rawRed)));
  // Interpreter.update has already consumed the first original wait tick in
  // the command's frame. Screen interpolation still keeps its full duration.
  assert.equal(e.screen.toneDur, 4); assert.equal(active.waitCount, 3); assert.equal(active.running(), true);
  e.tick(2); source.update();
  assert.equal(e.screen.toneDur, 2); assert.equal(active.waitCount, 2);
  assert.equal(source.running(), true, 'the original interpreter wait does not vanish when the colour policy changes');
  e.tick(2); for (let i = 0; i < 6; i++) source.update();
  assert.deepEqual(e.screen.tone, asChannels(ambientMapTone(rawRed))); assert.equal(source.running(), false);
  assert.deepEqual(list[0].parameters, [rawRed, 4, true]);
});

test('identical commands outside CE290 keep their full authored tone, including neighboring common events', t => {
  const e = environment(t), list = [cmd(223, [rawRed, 3, true]), cmd(0)];
  $data.commonEvents[290] = { list };
  for (const other of [list.slice(), structuredClone(list)]) {
    const source = new Interpreter(); source.setup(other, 8); source.update();
    assert.deepEqual(e.screen.toneTarget, asChannels(rawRed)); assert.equal(e.screen.toneDur, 3); assert.equal(source.waitCount, 2);
  }
  $data.commonEvents[289] = { list: list.slice() };
  const parent = new Interpreter(0, true); parent.setup([cmd(117, [289]), cmd(0)]); parent.update();
  assert.equal(parent.child.list, $data.commonEvents[289].list);
  assert.deepEqual(e.screen.toneTarget, asChannels(rawRed), 'matching command text is not sufficient to adapt another event');
});

test('troop-owned CE290 and its common-event children retain original battle tone and wait', t => {
  const e = environment(t), list = [cmd(223, [rawRed, 5, true]), cmd(0)], battle = { done: false };
  $data.commonEvents[290] = { list }; G.combat = { battleOf: () => battle };
  e.map.map = { note: '<色調 -17,-136,-136,68>' };
  for (const child of [false, true]) {
    const source = new Interpreter(); source.troop = true;
    source.setup(child ? [cmd(117, [290]), cmd(0)] : list); source.update();
    const active = child ? source.child : source;
    assert.deepEqual(e.screen.battleTones.get(battle).toneTarget, asChannels(rawRed));
    assert.equal(e.screen.battleTones.get(battle).toneDur, 5); assert.equal(active.waitCount, 4);
    assert.deepEqual(e.screen.tone, asChannels(zero), 'battle colour cannot replace map-owned state');
  }
});

test('a cinematic blackout stays strong, then its exact map-ambient reset restores the readable palette', t => {
  const e = environment(t), note = '<色調 -17,-136,-136,68>';
  e.map.map = { note };
  const blackout = Object.freeze({ red: -255, green: -255, blue: -255, gray: 0 });
  const list = [cmd(223, [blackout, 2, true]), cmd(223, [rawRed, 4, true]), cmd(0)];
  const scene = new Interpreter(0, true); scene.setup(list, 45); scene.update();
  assert.deepEqual(e.screen.toneTarget, asChannels(blackout), 'an explicit cinematic blackout is not softened');
  assert.equal(e.screen.toneDur, 2); assert.equal(scene.waitCount, 1);
  e.tick(1); scene.update(); e.tick(1);
  assert.deepEqual(e.screen.tone, asChannels(blackout), 'blackout reaches its authored full strength before the reset');
  scene.update();
  assert.deepEqual(e.screen.toneTarget, asChannels(ambientMapTone(rawRed)), 'returning to the exact map-note tone is returning to ambient presentation');
  assert.equal(e.screen.toneDur, 4); assert.equal(scene.waitCount, 3);
  e.tick(4);
  const forest = worldTonePixel([0.08, 0.48, 0.13], e.screen.tone);
  assert.ok(forest[1] > forest[0] + 0.25 && forest[1] > forest[2] + 0.25);
  assert.equal(e.map.map.note, note); assert.equal(list[1].parameters[0], rawRed);
});

test('co-op transports display-ready environmental colours once and still preserves strong scripted colours', t => {
  const e = environment(t), sender = { lastMusic: null, sceneOn: () => false, deathOn: () => false };
  e.screen.startTone(ambientMapTone(rawRed), 0);
  const packet = Coop.prototype.screenMsg.call(sender);
  const guest = Object.assign(Object.create(Coop.prototype), { scrOf: new Map(), authNow: 'host' });
  e.screen.startTone(zero, 0); guest.onScreen(packet, 'host');
  e.tick(20);
  assert.deepEqual(e.screen.tone, { r: packet.tone[0], g: packet.tone[1], b: packet.tone[2], gray: packet.tone[3] });
  guest.onScreen(packet, 'host'); assert.equal(e.screen.toneDur, 0, 'an unchanged remote environment does not restart a fade');
  guest.onScreen({ ...packet, tone: [255, 255, 255, 68] }, 'host'); e.tick(20);
  assert.deepEqual(e.screen.tone, { r: 255, g: 255, b: 255, gray: 68 }, 'the transport must not apply an ambient policy to explicit remote screen effects');
});
