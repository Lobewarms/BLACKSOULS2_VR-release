import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { Interpreter } from '../src/game/interpreter.js';
import { ScreenFx } from '../src/ui/screen.js';
import { WorldTone } from '../src/world/world-tone.js';

globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');
const cmd = (code, parameters = [], indent = 0) => ({ code, parameters, indent });
const tone = (red = 0, green = red, blue = red, gray = 0) => ({ red, green, blue, gray });
const channel = (red = 0, green = red, blue = red, gray = 0) => ({ r: red, g: green, b: blue, gray });

function environment(t) {
  const saved = { ...G }, data = { ...$data }, document = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => { for (const key of Object.keys(G)) if (!(key in saved)) delete G[key]; Object.assign(G, saved); Object.assign($data, data);
    if (document) Object.defineProperty(globalThis, 'document', document); else delete globalThis.document; });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 0, height: 0,
    getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) } });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(); scene.add(camera);
  const leader = { hp: 1000, mhp: 1000, isState: () => false };
  Object.assign(G, { three: { scene, camera }, player: { floatDown() {} }, pictures: null, time: 0,
    settings: { fxBrightness: 0.5 }, vr: false, coop: null, arena: null, theater: null, audio: null,
    ui: { messageBusy: () => false }, map: { mapId: 158, transferring: false, events: {} },
    state: { system: { winCount: 0, escapeCount: 0 }, party: { leader: () => leader, partyAbility: () => false, members: () => [] } },
  });
  $data.system = { sounds: [] }; $data.states = []; $data.commonEvents = [];
  const screen = G.screen = new ScreenFx(camera), worldTone = G.worldTone = new WorldTone(scene);
  const combat = G.combat = new CombatSystem(scene);
  const pages = [
    { condition: { turn_valid: true, turn_a: 1, turn_b: 20 }, span: 1, list: [cmd(223, [tone(255), 30, true]), cmd(0)] },
    { condition: { turn_valid: true, turn_a: 10, turn_b: 20 }, span: 1, list: [cmd(223, [tone(), 30, true]), cmd(0)] },
  ];
  const battle = { done: false, result: -1, time: 6, pageDone: new Set(), troop: { pages },
    enemies: [{ alive: true, hidden: false, b: { hp: 100, mhp: 100 }, data: { gold: 0, exp: 0 }, state: 'chase' }] };
  combat.battles.push(battle);
  const tick = (count = 1) => { for (let i = 0; i < count; i++) { combat.updateTroopEvents(battle); screen.updateLogic(); screen.apply(); } };
  const finish = result => { battle.done = true; battle.result = result; combat.onBattleEnd(battle); screen.apply(); };
  return { screen, worldTone, combat, battle, tick, finish };
}

// Original Troop187 makes its view white at turns1+20n and restores it at
// turns10+20n. Game_Map/Game_Troop each own Game_Screen: an early victory must
// discard only the battle tone, even before the reset page can run.
test('real troop command223 keeps its authored blind, then an early victory restores map tone in the same render', t => {
  const { screen, worldTone, tick, finish } = environment(t);
  screen.startTone(tone(-51, -26, 0, 68), 0);
  tick(30); assert.deepEqual(screen.displayTone(), channel(255));
  assert.deepEqual(worldTone.uniform.value.toArray(), [1, 1, 1, 0]);
  assert.deepEqual(screen.tone, channel(-51, -26, 0, 68), 'the troop did not replace map-owned state');
  finish(0);
  assert.deepEqual(worldTone.uniform.value.toArray(), [-51 / 255, -26 / 255, 0, 68 / 255]);
  assert.equal(G.state.system.winCount, 1); assert.equal(screen.battleTones.size, 0);
  screen.apply(); screen.apply(); assert.deepEqual(screen.displayTone(), channel(-51, -26, 0, 68), 'render-only frames cannot bring the white screen back');
});

test('the original later troop reset still fades white to normal instead of expiring the intended blind early', t => {
  const { screen, battle, tick } = environment(t);
  tick(40); battle.time = 54; tick(40);
  assert.deepEqual(screen.displayTone(), channel(255), 'turn9 remains blinded as authored');
  battle.time = 60; tick();
  assert.ok(screen.displayTone().r < 255 && screen.displayTone().r > 240);
  tick(29); assert.deepEqual(screen.displayTone(), channel());
  assert.equal(battle.pageDone.has('1:10'), true);
});

test('battle common-event children share their owner, but a completed troop cannot tint the map from a stale continuation', t => {
  const { screen, battle, combat, finish } = environment(t);
  $data.commonEvents[1] = { list: [cmd(223, [tone(255), 1, false]), cmd(230, [1]), cmd(223, [tone(255), 0, false]), cmd(0)] };
  const source = new Interpreter(1); source.troop = true; source.setup([cmd(117, [1]), cmd(0)]);
  battle.troopInterp = source; source.update(); screen.updateLogic(); screen.apply();
  assert.deepEqual(screen.displayTone(), channel(255));
  screen.startTone(tone(0, -34, -68), 0);
  finish(1); source.update(); source.update(); screen.apply();
  assert.deepEqual(screen.displayTone(), channel(0, -34, -68)); assert.equal(screen.battleTones.size, 0);
  assert.equal(combat.inCombat, false);
});

test('overlapping battle tones retain a live owner and discard ended owners before any PC or VR render', t => {
  const { screen, worldTone, battle } = environment(t), other = { done: false };
  screen.startTone(tone(-17, -34, -51), 0);
  screen.startTone(tone(255), 0, battle); screen.startTone(tone(0, 0, 102), 0, other);
  battle.done = true; screen.apply(); assert.deepEqual(worldTone.uniform.value.toArray(), [0, 0, 0.4, 0]);
  assert.equal(screen.battleTones.has(battle), false);
  G.vr = true; other.done = true; screen.apply();
  assert.deepEqual(worldTone.uniform.value.toArray(), [-17 / 255, -34 / 255, -51 / 255, 0]);
  assert.equal(screen.battleTones.size, 0);
});

test('actual combat reset clears only battle-owned tones, preserving map tint, flashes and their original duration', t => {
  const { screen, combat, tick } = environment(t);
  screen.startTone(tone(17, -34, -34, 68), 0); tick(12);
  screen.startFlash({ red: 255, green: 153, blue: 68, alpha: 255 }, 30);
  const flash = screen.flash;
  combat.reset(); screen.apply();
  assert.deepEqual(screen.displayTone(), channel(17, -34, -34, 68));
  assert.equal(screen.flash, flash); assert.equal(screen.flash.t, 30); assert.equal(screen.flashSphere.visible, true);
  for (let i = 0; i < 30; i++) screen.updateLogic(); screen.apply();
  assert.equal(screen.flash, null); assert.equal(screen.flashSphere.visible, false);
  screen.startTone(tone(-68, -68, 0), 0); screen.apply();
  assert.deepEqual(screen.displayTone(), channel(-68, -68, 0), 'new map initialization remains authoritative');
});
