import test from 'node:test';
import assert from 'node:assert/strict';
import { initAssets } from '../src/data/assets.js';
import { MapGrid, buildMapMesh, T } from '../src/world/mapmesh.js';

async function environment(t) {
  const descriptors = Object.fromEntries(['document', 'Image'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of Object.entries(descriptors)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  } });
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class {
    set src(url) { this.name = decodeURIComponent(url); this.width = 256; this.height = 512; queueMicrotask(() => this.onload()); }
  } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => {
    let alpha = 0;
    const ctx = new Proxy({
      clearRect() { alpha = 0; },
      drawImage(image, sx, sy) {
        const tileAlpha = image.name?.includes('SupportA5') && sy === 32 ? sx === 0 ? 0 : sx === 32 ? 120 : 255 : 255;
        alpha = Math.max(alpha, tileAlpha);
      },
      getImageData(_x, _y, width, height) {
        const data = new Uint8ClampedArray(width * height * 4);
        if (alpha) for (let i = 0; i < data.length; i += 4) data.set([120, 110, 90, alpha], i);
        return { data };
      },
    }, { get: (object, key) => key in object ? object[key] : () => {} });
    return { width: 32, height: 32, getContext: () => ctx };
  } } });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: ['Graphics/Tilesets/SupportA5.png', 'Graphics/Parallaxes/water-support.png'] }));
  await initAssets();
}

function river({ transparent = false, parallax = 'water-support', missing = false } = {}) {
  const width = 10, height = 9, data = new Int16Array(width * height * 4), flags = new Int16Array(8192);
  flags[0] = 16; flags[1544] = flags[1545] = 15;
  for (let y = 0; y < 3; y++) for (let x = 0; x < width; x++) data[x + y * width] = 1536;
  if (transparent) for (let y = 4; y < 7; y++) for (let x = 3; x < 7; x++) data[x + y * width] = transparent === 'translucent' ? 1545 : 1544;
  const names = Array(9).fill(''); names[4] = missing ? 'UnavailableSupportSheet' : 'SupportA5';
  const grid = new MapGrid({ width, height, data: { data }, parallax_name: parallax, parallax_show: true },
    { tileset_names: names, flags: { data: flags } });
  return { grid, data, flags, options: { floorHints: [[0, 0, 9, 2, -4, -4]] } };
}

test('empty water support matches the rendered river surface rather than zero or a neighboring elevated shore', async t => {
  await environment(t); const { grid, options } = river();
  const mesh = await buildMapMesh(grid, options); t.after(() => mesh.dispose());
  const water = mesh.group.children.find(child => child.geometry?.type === 'PlaneGeometry');
  assert.ok(water, 'the original water picture must still be rendered');
  assert.ok(Math.abs(water.position.y - -4.45 * T) < 1e-5);
  for (const [x, y] of [[5, 3], [5, 4], [0, 8], [9, 8]]) {
    assert.ok(Math.abs(mesh.floorAt(x, y) * T - water.position.y) < 1e-5, 'boats and scenery share the actual water height');
    assert.equal(mesh.spotOnSolid(x, y), null);
  }
  assert.equal(mesh.floorAt(5, 2), -4, 'the pier remains above the river');
  assert.equal(grid.anyPassable(5, 4), false, 'the original water still blocks walking');
});

test('transparent impassable water markers never become invisible mass walls that suspend boats', async t => {
  await environment(t); const { grid, options, data, flags } = river({ transparent: true });
  const source = data.slice(), passage = flags.slice(), mesh = await buildMapMesh(grid, options); t.after(() => mesh.dispose());
  const water = mesh.group.children.find(child => child.geometry?.type === 'PlaneGeometry');
  for (let y = 4; y < 7; y++) for (let x = 3; x < 7; x++) {
    assert.equal(mesh.isSolid(x, y), false);
    assert.equal(mesh.spotOnSolid(x, y), null);
    assert.ok(Math.abs(mesh.floorAt(x, y) * T - water.position.y) < 1e-5);
    assert.equal(grid.anyPassable(x, y), false);
  }
  assert.deepEqual(data, source); assert.deepEqual(flags, passage);
});

test('missing tile images cannot be mistaken for confirmed transparent water markers', async t => {
  await environment(t); const { grid, options } = river({ transparent: true, missing: true });
  const mesh = await buildMapMesh(grid, { ...options, analysisOnly: true });
  assert.equal(mesh.isSolid(4, 5), true, 'unreadable original art keeps conservative geometry');
});

test('visible translucent artwork over water never qualifies as an invisible blocking marker', async t => {
  await environment(t); const { grid, options } = river({ transparent: 'translucent' });
  const mesh = await buildMapMesh(grid, { ...options, analysisOnly: true });
  assert.equal(mesh.isSolid(4, 5), true, 'pixels visible above the material cutoff must retain their geometry');
});

test('ordinary interior void and sky maps retain their existing placement rules', async t => {
  await environment(t);
  for (const parallax of ['', 'sky-support']) {
    const { grid, options } = river({ parallax });
    const mesh = await buildMapMesh(grid, { ...options, analysisOnly: true });
    assert.equal(mesh.floorAt(5, 7), 0);
    assert.equal(mesh.floorAt(5, 2), -4);
  }
});
