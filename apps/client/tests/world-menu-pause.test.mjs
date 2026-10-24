import test from 'node:test';
import assert from 'node:assert/strict';
import { G } from '../src/core/globals.js';
import { GameState } from '../src/game/state.js';
import { GameMap } from '../src/world/gamemap.js';
import { worldMenuPaused } from '../src/game/world-pause.js';

globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');
const cmd = (code, parameters = []) => ({ code, parameters, indent: 0 });

function environment(t) {
  const old = { ...G };
  t.after(() => Object.assign(G, old));
  Object.assign(G, { state: new GameState(), ui: { menuOpen: false, sceneOpen: null }, coop: null,
    scripts: {}, time: 0 });
  const map = G.map = new GameMap(); map.mapId = 1;
  map.updateRegionEvents = () => {};
  map.updateInterpreter = () => map.interpreter.update();
  map.commonParallel = [];
  map.interpreter.setup([cmd(122, [1, 1, 1, 0, 1]), cmd(230, [1]), cmd(413), cmd(0)], 0);
  G.state.system.timer = { working: true, count: 120 };
  let routes = 0;
  map.playerChar.update = () => routes++;
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), { carried: [], sideInterps: [],
    detached: [], symbols: new Map(), battles: [] });
  return { map, combat, routes: () => routes };
}

for (const scene of ['skills', 'shop', 'map', 'movie']) test(`local ${scene} pauses real map scripts, forced routes and timer`, t => {
  const e = environment(t);
  G.ui.menuOpen = scene === 'skills'; G.ui.sceneOpen = scene === 'skills' ? null : scene;
  for (let i = 0; i < 120; i++) e.map.update();
  assert.equal(G.state.v(1), 0); assert.equal(G.state.system.timer.count, 120); assert.equal(e.routes(), 0);
  G.ui.menuOpen = false; G.ui.sceneOpen = null; e.map.update();
  assert.equal(G.state.v(1), 1); assert.equal(G.state.system.timer.count, 119); assert.equal(e.routes(), 1);
});

test('local inspection also holds real carried, side and troop event interpreters', t => {
  const e = environment(t); let calls = 0;
  const interp = { update: () => calls++, running: () => true };
  e.combat.carried = [interp]; e.combat.sideInterps = [interp];
  e.combat.detached = [{ interp }];
  e.combat.symbols.set({}, { engaged: true, interp });
  e.combat.battles = [{}]; e.combat.updateTroopEvents = () => calls++;
  G.ui.menuOpen = true;
  for (let i = 0; i < 60; i++) e.combat.updateLogic();
  assert.equal(calls, 0);
  G.ui.menuOpen = false; e.combat.updateLogic(); assert.equal(calls, 5);
});

test('dialogue waits keep running, while a guest inspection does not freeze host-owned event logic', t => {
  const e = environment(t);
  G.ui.msg = {}; assert.equal(worldMenuPaused(), false); e.map.update();
  assert.equal(G.state.system.timer.count, 119);
  G.ui.menuOpen = true; G.coop = { phantom: true, leadsNow: true, recording: 0 };
  let leadFrames = 0; e.map.updateLeadInterpreter = () => leadFrames++;
  e.map.update(); assert.equal(leadFrames, 1); assert.equal(e.routes(), 2);
  assert.equal(G.state.system.timer.count, 118);
});

test('a scene opened by the map interpreter stops routes, unrelated parallel events and timer in that same tick', t => {
  const e = environment(t); let unrelated = 0;
  e.map.updateInterpreter = () => { G.ui.sceneOpen = 'movie'; };
  e.map.eventList.push({ update: () => unrelated++ });
  e.map.update();
  assert.equal(e.routes(), 0); assert.equal(unrelated, 0); assert.equal(G.state.system.timer.count, 120);
});

test('a scene opened by one parallel event does not advance later events or the world timer', t => {
  const e = environment(t); let unrelated = 0;
  e.map.eventList.push({ update: () => { G.ui.sceneOpen = 'shop'; } }, { update: () => unrelated++ });
  e.map.update();
  assert.equal(e.routes(), 1, 'the world update preceding the native scene already happened');
  assert.equal(unrelated, 0); assert.equal(G.state.system.timer.count, 120);
});
