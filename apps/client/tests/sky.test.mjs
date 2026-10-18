import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Sky } from '../src/world/sky.js';
import { areaProfile } from '../src/world/area-profiles.js';
import { G } from '../src/core/globals.js';

const noSky = { parallax_name: '', parallax_show: false, tileset_id: 25, note: '' };
const image = () => ({ width: 96, height: 80,
  pixel: (x, y) => y < 40 ? [60 + x, 110 + (y % 7) * 3, 130, 255] : [35, 70, 95, 255] });

// Synthetic pixel canvas supports the same crop/sample operations as Sky, so
// regressions inspect actual texture sources and geometry without original art.
function canvas() {
  let draw;
  const c = { width: 0, height: 0 };
  const pixel = (x, y) => {
    if (!draw) return [0, 0, 0, 0];
    const { source, sx, sy, sw, sh, dx, dy, dw, dh } = draw;
    const px = Math.max(0, Math.min(source.width - 1, Math.floor(sx + (x - dx) / dw * sw)));
    const py = Math.max(0, Math.min(source.height - 1, Math.floor(sy + (y - dy) / dh * sh)));
    return source.pixel ? source.pixel(px, py) : source.getContext('2d').pixel(px, py);
  };
  const ctx = {
    pixel,
    drawImage(source, ...args) {
      let sx = 0, sy = 0, sw = source.width, sh = source.height, dx = 0, dy = 0, dw = sw, dh = sh;
      if (args.length === 2) [dx, dy] = args;
      else if (args.length === 4) [dx, dy, dw, dh] = args;
      else [sx, sy, sw, sh, dx, dy, dw, dh] = args;
      draw = { source, sx, sy, sw, sh, dx, dy, dw, dh };
    },
    getImageData(sx, sy, w, h) {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(pixel(sx + x, sy + y), (y * w + x) * 4);
      return { data };
    },
  };
  c.getContext = () => ctx;
  return c;
}

function environment(t, loader = async () => image()) {
  const saved = { settings: G.settings, player: G.player, map: G.map }, document = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => { Object.assign(G, saved); if (document) Object.defineProperty(globalThis, 'document', document); else delete globalThis.document; });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: canvas } });
  G.settings = { ...G.settings, sky: true }; G.player = null;
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0, 20, 100);
  const calls = [], sky = new Sky(scene, { imageLoader: (folder, name) => { calls.push([folder, name]); return loader(folder, name); } });
  t.after(() => sky.clear());
  return { scene, sky, calls };
}

test('outdoor profiles choose existing cloud/night art using family and authored tone, with no indoor sky fallback', () => {
  const profile = (tileset_id, note = '', mapId = 0) => areaProfile({ ...noSky, tileset_id, note }, { mapId });
  assert.equal(profile(25, '<色調 -68,-68,0,68>').fallbackSky, 'StarlitSky');
  assert.equal(profile(25).fallbackSky, 'CloudySky1');
  assert.equal(profile(66, '<色調 34,-12,-12,0>').fallbackSky, 'CloudySky2');
  assert.equal(profile(122, '<天候 snow,3>').fallbackSky, 'CloudySky2');
  assert.equal(profile(38).fallbackSky, 'CloudySky1');
  assert.equal(profile(1, '', 291).fallbackSky, '64380033_p2_master1200');
  assert.equal(profile(122, '<色調 -68,-68,0,68>').fallbackSky, 'StarlitSky', 'authored blue night still wins over neutral snow');
  for (const [tileset, id] of [[35, 12], [87, 154], [5, 215], [133, 354], [47, 94], [1, 173], [999, 0]]) {
    assert.equal(profile(tileset, '<色調 -68,-68,0,68><天候 snow,9>', id).fallbackSky, '');
  }
});

test('shown authored skies always win; missing/floor/non-sky backgrounds use only the supplied safe original sky', async t => {
  const { sky, calls } = environment(t);
  for (const name of ['BlueSky', '月湖', 'Ocean1', '47261773_p0']) {
    await sky.setMap({ parallax_name: name, parallax_show: true }, { fallbackSky: 'CloudySky2' });
    assert.equal(sky.name, name); assert.equal(sky.isFallback, false); assert.deepEqual(calls.at(-1), ['Graphics/Parallaxes', name]);
  }
  for (const [name, shown] of [['', false], ['yuka101_Forest_Floor', true], ['water3', true], ['rad2', true], ['BlueSky', false]]) {
    await sky.setMap({ parallax_name: name, parallax_show: shown }, { fallbackSky: 'CloudySky2' });
    assert.equal(sky.name, 'CloudySky2'); assert.equal(sky.isFallback, true);
  }
  const before = calls.length;
  await sky.setMap(noSky, { fallbackSky: '../../arbitrary', background: 0x334455, fogColor: 0x223344 });
  assert.equal(calls.length, before); assert.equal(sky.group, null);
});

test('fallback clouds fill the sky with original image pixels, crop the plain lower half and preserve authored framing', async t => {
  const { sky } = environment(t);
  await sky.setMap(noSky, { fallbackSky: 'CloudySky1' });
  assert.equal(sky.group.children.length, 4, 'image wraps around the horizon and both poles');
  const band = sky.group.children[1], texture = band.material.map;
  assert.equal(texture.image.width, 96); assert.equal(texture.image.height, 40);
  assert.equal(texture.image.getContext('2d').getImageData(0, 39, 1, 1).data[2], 130, 'no plain lower-horizon pixels enter the sky texture');
  assert.equal(texture.colorSpace, THREE.SRGBColorSpace); assert.equal(texture.wrapS, THREE.MirroredRepeatWrapping);
  const uv = band.geometry.attributes.uv; let maxU = 0;
  for (let i = 0; i < uv.count; i++) { assert.ok(Number.isFinite(uv.getX(i)) && Number.isFinite(uv.getY(i))); maxU = Math.max(maxU, uv.getX(i)); }
  assert.ok(maxU >= 2 && maxU % 2 === 0, 'non-looping original edges mirror an even number of times without a rear seam');
  for (const mesh of sky.group.children) { assert.equal(mesh.material.depthWrite, false); assert.equal(mesh.material.fog, false); }
  const previous = sky.group;
  await sky.setMap({ parallax_name: 'CloudySky1', parallax_show: true }, { fallbackSky: 'CloudySky1' });
  assert.notEqual(sky.group, previous); assert.equal(sky.isFallback, false);
  assert.equal(sky.group.children.length, 2, 'an explicitly authored horizon retains its original band and framing');
  assert.equal(sky.group.children[1].material.map.image.height, 80);
});

test('disabled, unavailable and rejected sky images retain the area fog/background without inventing an indoor sky', async t => {
  let fail = false;
  const { sky, scene, calls } = environment(t, async () => { if (fail) throw new Error('unavailable'); return null; });
  for (const rejected of [false, true]) {
    fail = rejected;
    await sky.setMap(noSky, { fallbackSky: 'CloudySky2', background: 0xa8afb6, fogColor: 0x9aa1a8 });
    assert.equal(sky.group, null); assert.equal(scene.background.getHex(), 0xa8afb6); assert.equal(scene.fog.color.getHex(), 0x9aa1a8);
  }
  G.settings.sky = false; const count = calls.length;
  await sky.setMap({ parallax_name: 'BlueSky', parallax_show: true }, { fallbackSky: 'CloudySky2', background: 0x445566 });
  assert.equal(calls.length, count); assert.equal(sky.group, null); assert.equal(scene.background.getHex(), 0x445566);
  G.settings.sky = true;
  const indoor = areaProfile({ ...noSky, tileset_id: 35 });
  await sky.setMap(noSky, { fallbackSky: indoor.fallbackSky, background: indoor.background });
  assert.equal(calls.length, count); assert.equal(sky.group, null);
});

test('a late image from a departed area or cleared scene cannot replace the current sky', async t => {
  const pending = new Map(), { sky } = environment(t, (_folder, name) => new Promise(resolve => pending.set(name, resolve)));
  const first = sky.setMap(noSky, { fallbackSky: 'CloudySky1' });
  const second = sky.setMap(noSky, { fallbackSky: 'StarlitSky' });
  pending.get('StarlitSky')(image()); await second; const current = sky.group;
  pending.get('CloudySky1')(image()); await first; assert.equal(sky.group, current); assert.equal(sky.name, 'StarlitSky');
  const last = sky.setMap(noSky, { fallbackSky: 'CloudySky2' }); sky.clear();
  pending.get('CloudySky2')(image()); await last; assert.equal(sky.group, null); assert.equal(sky.name, '');
});

test('same-map rebuild reuses the loaded fallback and restores sampled horizon; refresh preserves its selection', async t => {
  const { sky, scene, calls } = environment(t);
  const options = { fallbackSky: 'CloudySky2', background: 0x556677, fogColor: 0x445566 };
  await sky.setMap(noSky, options); const group = sky.group, horizon = sky.horizon.clone();
  scene.background.set(0xff0000); scene.fog.color.set(0xff0000);
  await sky.setMap(noSky, options);
  assert.equal(sky.group, group); assert.equal(calls.length, 1); assert.ok(scene.background.equals(horizon)); assert.ok(scene.fog.color.equals(horizon));
  G.map = { map: noSky }; await sky.refresh();
  assert.equal(sky.name, 'CloudySky2'); assert.equal(sky.isFallback, true); assert.equal(calls.length, 2);
  G.settings.sky = false; await sky.refresh();
  assert.equal(sky.group, null); assert.equal(scene.background.getHex(), options.background); assert.equal(scene.fog.color.getHex(), options.fogColor);
});

test('sky dome follows world head position without rotating and disposes shared image textures only once', async t => {
  const { sky, scene } = environment(t); G.player = { headWorld: out => out.set(5, 1.6, 8) };
  await sky.setMap(noSky, { fallbackSky: 'CloudySky2' });
  assert.equal(sky.group.parent, scene); assert.deepEqual(sky.group.position.toArray(), [5, 1.6, 8]);
  assert.deepEqual(sky.group.quaternion.toArray(), [0, 0, 0, 1]);
  let textures = 0, geometries = 0, materials = 0;
  const map = sky.group.children[1].material.map;
  map.addEventListener('dispose', () => textures++);
  sky.group.traverse(object => { if (object.isMesh) {
    object.geometry.addEventListener('dispose', () => geometries++); object.material.addEventListener('dispose', () => materials++);
  } });
  sky.clear(); sky.clear();
  assert.equal(textures, 1); assert.equal(geometries, 4); assert.equal(materials, 4); assert.equal(scene.children.length, 0);
});
