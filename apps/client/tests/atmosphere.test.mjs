import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { MapAtmosphere, mapAtmosphereNotes } from '../src/world/atmosphere.js';
import { Sky } from '../src/world/sky.js';

test('map entry retains full authored tone and weather, bounds bad values, and resets absent tags', () => {
  assert.deepEqual(mapAtmosphereNotes('<色調 -68, -68, 0, 68>\n<天候 snow,3>'), {
    tone: { red: -68, green: -68, blue: 0, gray: 68 }, weather: { type: 'snow', power: 3 },
  });
  assert.deepEqual(mapAtmosphereNotes('<色調 -999, 999, -12> <天候 storm,99>'), {
    tone: { red: -255, green: 255, blue: -12, gray: 0 }, weather: { type: 'storm', power: 9 },
  });
  assert.deepEqual(mapAtmosphereNotes(''), {
    tone: { red: 0, green: 0, blue: 0, gray: 0 }, weather: { type: 'none', power: 0 },
  });
});

function environment(t) {
  const scene = new THREE.Scene(), atmosphere = new MapAtmosphere(scene), tones = [], weather = [], skies = [], maps = [];
  const screen = { weatherDimness: 0, startTone: (...args) => tones.push(args),
    setWeather: (...args) => weather.push(args), clearWeather() { this.cleared = true; } };
  const effects = { setMap: map => maps.push(map), clear() { this.cleared = true; } };
  const sky = { setMap: (...args) => skies.push(args) };
  const set = (map, extra = {}) => atmosphere.setMap(map, { screen, sky, environment: effects, ...extra });
  t.after(() => atmosphere.dispose());
  return { scene, atmosphere, tones, weather, skies, maps, screen, effects, set };
}

test('real map presentation uses distinct area visibility and neutral fill without doubling negative tones', t => {
  const e = environment(t), map = { tileset_id: 25, note: '<色調 -68,-68,0,68>' };
  const p = e.set(map, { mapId: 5 });
  assert.equal(p.outdoor, true); assert.ok(e.scene.fog.far > 100);
  assert.equal(e.atmosphere.ambient.intensity, p.ambient);
  assert.equal(e.atmosphere.hemi.intensity, p.hemi, 'negative authored tone must not dim hemi again');
  assert.deepEqual(e.tones[0], [{ red: -68, green: -68, blue: 0, gray: 68 }, 0]);
  assert.deepEqual(e.skies[0], [map, { background: p.background, fogColor: p.fogColor, fallbackSky: p.fallbackSky }]);
  assert.equal(e.atmosphere.headlight.color.getHex(), 0xffffff);
  const cave = e.set({ tileset_id: 5, note: '' }, { mapId: 215 });
  assert.ok(e.scene.fog.far < p.fogFar); assert.ok(cave.ambient < p.ambient);
  assert.deepEqual(e.tones[1][0], { red: 0, green: 0, blue: 0, gray: 0 });
  assert.deepEqual(e.weather[1], ['none', 0, 0]);
});

test('geometry rebuild keeps scripted tone, weather and persistent regional effects', t => {
  const e = environment(t), map = { tileset_id: 35, note: '<色調 -34,-34,-34,0>' };
  e.set(map); e.screen.weatherDimness = 18;
  e.set(map, { rebuild: true });
  assert.equal(e.tones.length, 1); assert.equal(e.weather.length, 1); assert.equal(e.maps.length, 1);
  assert.equal(e.skies.length, 2);
});

test('cloud dimming composes once and local light follows the head without allocating more scene lights', t => {
  const e = environment(t), p = e.set({ tileset_id: 122, note: '<天候 snow,3>' });
  const lights = e.scene.children.length;
  e.screen.weatherDimness = 18;
  for (let i = 0; i < 120; i++) e.atmosphere.update({ x: 1, y: 1.6, z: 3 });
  assert.equal(e.scene.children.length, lights);
  assert.equal(e.atmosphere.ambient.intensity, p.ambient * (1 - 18 / 255));
  assert.deepEqual(e.atmosphere.headlight.position.toArray(), [1, 1.8, 3]);
  e.screen.weatherDimness = 0; e.atmosphere.update();
  assert.equal(e.atmosphere.ambient.intensity, p.ambient);
  e.atmosphere.clear();
  assert.equal(e.screen.cleared, true); assert.equal(e.effects.cleared, true);
});

test('absent or disabled sky preserves each area fallback and clear releases it for the title', async t => {
  const previous = G.settings.sky, map = { parallax_name: 'BlueSky', parallax_show: true };
  t.after(() => { G.settings.sky = previous; });
  G.settings.sky = false;
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0, 10, 100);
  const sky = new Sky(scene);
  G.map ||= {};
  const oldMap = G.map.map; G.map.map = map;
  t.after(() => { G.map.map = oldMap; sky.clear(); });
  await sky.setMap(map, { background: 0x556677, fogColor: 0x445566 });
  assert.equal(scene.background.getHex(), 0x556677); assert.equal(scene.fog.color.getHex(), 0x445566);
  sky.refresh();
  assert.equal(scene.background.getHex(), 0x556677); assert.equal(scene.fog.color.getHex(), 0x445566);
  sky.clear();
  assert.equal(scene.background.getHex(), 0x030305); assert.equal(scene.fog.color.getHex(), 0x030305);
});

test('verified moon-over-lake panorama remains a sky while water-floor textures stay excluded', t => {
  const previous = G.settings.sky; t.after(() => { G.settings.sky = previous; }); G.settings.sky = true;
  const sky = new Sky(new THREE.Scene()), map = name => ({ parallax_name: name, parallax_show: true });
  assert.equal(sky.wanted(map('月湖')), '月湖');
  assert.equal(sky.wanted(map('water3')), '');
  assert.equal(sky.wanted(map('yukaかまくら内装土台')), '');
});

test('a geometry rebuild restores a loaded sky horizon instead of retaining the area fallback fog', async t => {
  const previous = G.settings.sky; t.after(() => { G.settings.sky = previous; }); G.settings.sky = true;
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x556677, 10, 100);
  const sky = new Sky(scene); sky.name = 'BlueSky'; sky.group = new THREE.Group();
  sky.horizon = new THREE.Color(0x112244); scene.add(sky.group);
  t.after(() => sky.clear());
  await sky.setMap({ parallax_name: 'BlueSky', parallax_show: true }, { background: 0x556677, fogColor: 0x556677 });
  assert.equal(scene.background.getHex(), 0x112244);
  assert.equal(scene.fog.color.getHex(), 0x112244);
});
