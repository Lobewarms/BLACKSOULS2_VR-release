import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { WorldWeather } from '../src/world/weather.js';
import { ScreenFx } from '../src/ui/screen.js';
import { Interpreter } from '../src/game/interpreter.js';

const head = () => new THREE.Vector3(2, 1.6, 3);
function weather(t) {
  const scene = new THREE.Scene(), system = new WorldWeather(scene, { random: () => 0.5 });
  t.after(() => system.dispose()); return { scene, system };
}

test('weather strength uses original frame interpolation, ten particles per power and six-level dimness', t => {
  const { system } = weather(t); system.set('rain', 9, 3);
  assert.equal(system.power, 0); assert.equal(system.count, 0);
  for (const expected of [3, 6, 9]) {
    system.updateLogic(); system.update(head(), () => 0);
    assert.equal(system.power, expected); assert.equal(system.count, expected * 10);
    assert.equal(system.dimness, expected * 6); assert.equal(system.group.visible, true);
  }
  system.set('none', 9, 3);
  for (const expected of [6, 3]) {
    system.updateLogic(); system.update(head(), () => 0);
    assert.equal(system.type, 'rain', 'stopping keeps the old particle kind while it fades'); assert.equal(system.power, expected);
  }
  system.updateLogic(); system.update(head(), () => 0);
  assert.equal(system.type, 'none'); assert.equal(system.power, 0); assert.equal(system.count, 0); assert.equal(system.group.visible, false);
  system.set('rain', 1, 4); system.updateLogic(); assert.equal(system.dimness, 1, 'original dimness truncates fractional RGB levels');
});

test('zero, none and malformed weather inputs clear safely and cannot allocate unbounded particles or durations', t => {
  const { system } = weather(t);
  system.set('storm', 1e9, 1e9); assert.equal(system.target, 9); assert.equal(system.duration, 36000);
  system.set('snow', 1e9, 0); system.update(head(), () => 0);
  assert.equal(system.count, 90); assert.equal(system.snowGeometry.drawRange.count, 90);
  assert.equal(system.rainGeometry.drawRange.count, 0); assert.ok(system.count <= system.positions.length / 3);
  for (const [type, power] of [['rain', 0], ['none', 9], ['unknown', 9], ['snow', NaN], ['storm', Infinity], ['snow', -9]]) {
    system.set(type, power, 0); system.update(head(), () => 0);
    assert.equal(system.power, 0); assert.equal(system.count, 0); assert.equal(system.group.visible, false);
    assert.equal(system.rainGeometry.drawRange.count, 0); assert.equal(system.snowGeometry.drawRange.count, 0);
  }
});

test('rain, storm and snow reuse world geometry, remain depth-tested and never create per-particle lights or image assets', t => {
  const { scene, system } = weather(t);
  const rain = system.rain.geometry, snow = system.snow.geometry;
  for (const type of ['rain', 'storm', 'snow', 'none', 'rain']) {
    system.set(type, 5, 0); system.update(head(), () => 0);
    assert.equal(system.group.parent, scene); assert.equal(system.rain.geometry, rain); assert.equal(system.snow.geometry, snow);
    assert.deepEqual(system.group.position.toArray(), [0, 0, 0]);
    for (const material of [system.rain.material, system.snow.material]) {
      assert.equal(material.depthTest, true); assert.equal(material.depthWrite, false); assert.equal(material.fog, true);
      assert.equal(material.map || null, null);
    }
  }
  let lights = 0; system.group.traverse(object => { if (object.isLight) lights++; }); assert.equal(lights, 0);
  assert.equal(system.group.children.length, 2);
});

test('particles move only on logic ticks, storm has stronger wind and extra VR renders do not accelerate them', t => {
  const { system } = weather(t); system.set('rain', 1, 0); system.update(head(), () => 0);
  const initial = system.positions.slice(0, 3);
  for (let i = 0; i < 5; i++) system.update(head(), () => 0);
  assert.deepEqual(system.positions.slice(0, 3), initial, 'high-refresh rendering cannot advance simulation');
  system.updateLogic(); const rain = system.positions.slice(0, 3);
  assert.ok(rain[0] < initial[0]); assert.ok(rain[1] < initial[1]); assert.equal(rain[2], initial[2]);
  system.set('storm', 1, 0); system.update(head(), () => 0); const stormStart = system.positions.slice(0, 3);
  system.updateLogic(); assert.ok(stormStart[0] - system.positions[0] > (initial[0] - rain[0]) * 2.9);
  system.set('snow', 1, 0); system.update(head(), () => 0); const snowStart = system.positions.slice(0, 3);
  system.updateLogic(); assert.ok(snowStart[1] - system.positions[1] < (initial[1] - rain[1]) / 2);
});

test('particles use actual map floor heights and recycle after a teleport without attaching to the camera', t => {
  const { scene, system } = weather(t); const camera = new THREE.PerspectiveCamera(); scene.add(camera);
  system.set('rain', 9, 0); const eye = new THREE.Vector3(20, 5.6, 30), calls = [];
  const floor = (x, y) => { calls.push([x, y]); return 4; };
  system.update(eye, floor);
  for (let i = 0; i < system.count; i++) {
    const at = i * 3;
    assert.ok(system.positions[at + 1] > 4); assert.ok(system.positions[at + 1] <= eye.y + 6);
    assert.ok(Math.hypot(system.positions[at] - eye.x, system.positions[at + 2] - eye.z) >= 0.55);
  }
  assert.ok(calls.length >= system.count); assert.ok(calls.every(pair => pair.every(Number.isFinite)));
  const position = system.positions.slice(); camera.rotation.set(1, 2, 0); system.update(eye, floor);
  assert.deepEqual(system.positions, position, 'turning the head does not rotate the weather volume');
  system.positions[1] = 0; system.update(eye, floor); assert.ok(system.positions[1] > 4, 'snow/rain never continue under raised floors');
  eye.set(2000, 5.6, -3000); system.update(eye, floor);
  for (let i = 0; i < system.count; i++) assert.ok(Math.hypot(system.positions[i * 3] - eye.x, system.positions[i * 3 + 2] - eye.z) <= 11.001);
  assert.equal(system.group.parent, scene); assert.notEqual(system.group.parent, camera);
});

test('weather disposal releases both geometries and materials once and removes its scene group', t => {
  const { system } = weather(t); let disposals = 0;
  for (const resource of [system.rain.geometry, system.snow.geometry, system.rain.material, system.snow.material]) resource.addEventListener('dispose', () => disposals++);
  system.set('snow', 9, 0); system.update(head(), () => 0); system.dispose(); system.dispose();
  assert.equal(disposals, 4); assert.equal(system.group.parent, null); assert.equal(system.group.visible, false);
  system.set('rain', 9, 0); system.updateLogic(); system.update(head(), () => 0); assert.equal(system.count, 0);
});

function screenEnvironment(t) {
  const saved = { ...G }, descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => { Object.assign(G, saved);
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete globalThis.document; });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 0, height: 0,
    getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) } });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(); camera.position.copy(head()); scene.add(camera);
  Object.assign(G, { three: { scene, camera }, player: { headWorld: out => out.copy(camera.position) }, floorAt: () => 0,
    state: null, pictures: null, settings: {}, time: 0, map: { mapId: 1, transferring: false }, ui: { messageBusy: () => false } });
  const screen = G.screen = new ScreenFx(camera); t.after(() => screen.clearWeather());
  return { screen, scene, camera };
}

test('real command236 starts weather, retains its original interpreter wait and renders through ScreenFx in PC and VR', t => {
  const { screen, scene, camera } = screenEnvironment(t), interpreter = new Interpreter();
  interpreter.setup([{ code: 236, indent: 0, parameters: ['rain', 9, 3, true] }, { code: 0, indent: 0, parameters: [] }]);
  interpreter.update(); assert.equal(interpreter.waitCount, 2); assert.equal(screen.weather.power, 0);
  for (const [power, mode] of [[3, false], [6, true], [9, true]]) {
    G.vr = mode; screen.updateLogic(); screen.apply();
    assert.equal(screen.weather.power, power); assert.equal(screen.weather.group.parent, scene);
    assert.notEqual(screen.weather.group.parent, camera); assert.equal(screen.weather.group.visible, true);
  }
  assert.equal(screen.weatherDimness, 54); assert.equal(interpreter.running(), true);
  interpreter.update(); interpreter.update(); interpreter.update(); assert.equal(interpreter.running(), false);
  assert.equal(screen.fadeSphere.visible, false); assert.equal(screen.toneMul.visible, false, 'weather does not introduce a second dark overlay');
});

test('an immediate map weather reset wins over an old event fade and explicit cleanup permits a fresh scene lifecycle', t => {
  const { screen, scene } = screenEnvironment(t);
  screen.setWeather('storm', 9, 0); screen.setWeather('none', 0, 60); screen.updateLogic();
  assert.ok(screen.weather.power > 0); screen.setWeather('snow', 4, 0); screen.apply();
  assert.equal(screen.weather.type, 'snow'); assert.equal(screen.weather.power, 4); assert.equal(screen.weather.duration, 0);
  screen.setWeather('none', 0, 0); screen.apply(); assert.equal(screen.weather.group.visible, false); assert.equal(screen.weatherDimness, 0);
  const old = screen.weather; screen.clearWeather(); assert.equal(old.group.parent, null); assert.equal(screen.weather, null);
  screen.setWeather('rain', 1, 0); screen.apply(); assert.notEqual(screen.weather, old); assert.equal(screen.weather.group.parent, scene);
});
