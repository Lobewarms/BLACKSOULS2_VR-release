import test from 'node:test';
import assert from 'node:assert/strict';
import { initAssets } from '../src/data/assets.js';
import { MapGrid, buildMapMesh } from '../src/world/mapmesh.js';
import { FoliageTileDrawer, isFoliageTile, maskFoliageVoid } from '../src/world/foliage.js';
import { meshHintOptions } from '../src/world/mapbuild.js';

const namesFor = (sheet, slot = 6) => { const names = Array(9).fill(''); names[slot] = sheet; return names; };
function canvas() {
  // Synthetic leafy silhouette: continuous edges for neighboring crown pieces,
  // with clear upper corners. No original game images are test fixtures.
  const context = new Proxy({
    getImageData(_x, _y, width, height) {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (width === 32 && height === 32 && y < 3 && (x < 3 || x > 28)) continue;
        data.set([80, 130, 60, 255], (x + y * width) * 4);
      }
      return { data };
    },
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  return { width: 32, height: 32, getContext: () => context };
}
async function environment(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: canvas } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: [] }));
  await initAssets();
}
function forest({ sheet = 'do2', blockedGround = false } = {}) {
  const w = 10, h = 7, data = new Int16Array(w * h * 4), flags = new Int16Array(8192);
  const ground = 2816, blocked = 2912;
  data.fill(ground, 0, w * h); flags[0] = 16; flags[blocked] = 15;
  const crown = 401, branch = 409, trunk = 417;
  flags[crown] = 16; flags[branch] = flags[trunk] = 15;
  for (let x = 1; x <= 8; x++) {
    for (const [y, tile] of [[1, crown], [2, branch], [3, trunk]]) {
      data[x + y * w + 2 * w * h] = tile;
      if (blockedGround) data[x + y * w] = blocked;
    }
  }
  const grid = new MapGrid({ width: w, height: h, data: { data }, parallax_name: '' }, { tileset_names: namesFor(sheet), flags: { data: flags } });
  return { grid, data, flags, w, h, crown, branch, trunk };
}

test('foliage classification uses verified original sheet cells and excludes adjacent architecture and rocks', () => {
  for (const cell of [128, 129, 144, 153, 161, 194, 203, 214]) assert.equal(isFoliageTile(256 + cell, namesFor('do2')), true);
  for (const cell of [0, 24, 64, 104, 127, 216, 240]) assert.equal(isFoliageTile(256 + cell, namesFor('do2')), false);
  for (const cell of [10, 17, 24, 29, 49, 58, 60]) assert.equal(isFoliageTile(256 + cell, namesFor('雪国 (2)')), true);
  for (const cell of [74, 97, 130, 156, 177, 240]) assert.equal(isFoliageTile(256 + cell, namesFor('雪国 (2)')), false);
  for (const cell of [16, 25, 36, 49, 65, 74, 63, 71, 79]) assert.equal(isFoliageTile(cell, namesFor('雪国 (10)', 5)), true);
  for (const cell of [7, 15, 23, 31, 38, 46, 80, 89, 200]) assert.equal(isFoliageTile(cell, namesFor('雪国 (10)', 5)), false);
  assert.equal(isFoliageTile(401, namesFor('Unrelated art')), false);
  assert.equal(isFoliageTile(1536 + 144, namesFor('do2', 4)), false, 'A5 ground cannot alias the same tree sheet');
});

test('a large connected forest retains complete upright crown/trunk art instead of becoming a mass wall', async t => {
  await environment(t); const { grid, data, flags, w, h, crown, branch, trunk } = forest();
  const before = data.slice(), beforeFlags = flags.slice();
  const mesh = await buildMapMesh(grid);
  t.after(() => mesh.dispose());
  assert.equal(mesh.stats.mass, 0);
  for (let x = 1; x <= 8; x++) for (const y of [1, 2, 3]) {
    assert.equal(mesh.isSolid(x, y), false, 'there must be no opaque block through the tree');
    assert.equal(mesh.isStackCell(x, y), true, 'each canopy and trunk piece must survive');
  }
  for (const tile of [crown, branch, trunk]) {
    assert.ok([...mesh.staticAtlas.index.keys()].some(key => key === tile + '|0' || key === 'U' + tile));
    assert.equal([...mesh.staticAtlas.index.keys()].some(key => key.startsWith('O') && key.split('|')[0].slice(1).split(',').includes(String(tile))), false,
      'tree alpha must never be filled with an opaque dark wall backing');
  }
  assert.ok(mesh.stats.stacks >= 8); assert.equal(mesh.isPit(5, 5), false);
  assert.equal(grid.anyPassable(4, 2), false); assert.equal(grid.anyPassable(4, 4), true);
  assert.deepEqual(data, before); assert.deepEqual(flags, beforeFlags);
  assert.equal(data.length, w * h * 4);
});

test('impassable A2 support does not reintroduce a cube under alpha canopy while player collision stays blocked', async t => {
  await environment(t); const { grid } = forest({ blockedGround: true });
  const mesh = await buildMapMesh(grid, { analysisOnly: true });
  for (const [x, y] of [[2, 1], [2, 2], [2, 3], [7, 2]]) {
    assert.equal(mesh.isSolid(x, y), false); assert.equal(mesh.isStackCell(x, y), true);
    assert.equal(grid.anyPassable(x, y), false, 'the original forest boundary still stops movement');
  }
  assert.equal(mesh.floorAt(2, 2), 0);
});

test('unrelated connected art still becomes a solid mass; source identity limits the change', async t => {
  await environment(t); const { grid } = forest({ sheet: 'Synthetic building' });
  const mesh = await buildMapMesh(grid, { analysisOnly: true });
  assert.equal(mesh.isSolid(4, 2), true); assert.equal(mesh.isStackCell(4, 2), false);
});

test('real wall autotiles and tall architecture remain solid even with tree artwork over them', async t => {
  await environment(t); const { grid, data, flags, w, h } = forest();
  const wall = 6272; flags[wall] = 15;
  for (let y = 0; y <= 3; y++) data[5 + y * w] = wall;
  const mesh = await buildMapMesh(grid, { wallTiles: 4, wallCap: 14 });
  t.after(() => mesh.dispose());
  assert.equal(mesh.isSolid(5, 2), true); assert.ok(mesh.solidHeight(5, 2) >= 4);
  assert.equal(grid.anyPassable(5, 2), false); assert.equal(mesh.isSolid(4, 2), false);
  assert.equal(data[5 + 2 * w + 2 * w * h], 409, 'the original upper graphic stays intact');
});

test('existing Spore Forest low beds and original cliff walls are preserved', async t => {
  await environment(t); const { grid, data, flags, w } = forest({ sheet: 'Synthetic mushroom art' });
  const thicket = 2816 + 2 * 48, cliff = 6272;
  flags[thicket] = flags[cliff] = 15; data[7 + 5 * w] = thicket; data[8 + 5 * w] = cliff;
  const mesh = await buildMapMesh(grid, { ...meshHintOptions(38), analysisOnly: true });
  assert.equal(mesh.isSolid(7, 5), false); assert.ok(Math.abs(mesh.floorAt(7, 5) - 0.35) < 1e-6);
  assert.equal(grid.anyPassable(7, 5), false); assert.equal(mesh.isSolid(8, 5), true);
});

test('only edge-connected exact forest matte becomes transparent, preserving enclosed dark details and original pixels', () => {
  const width = 8, height = 8, pixels = new Uint8ClampedArray(width * height * 4);
  const put = (x, y, color) => pixels.set(color, (x + y * width) * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) put(x, y, [80, 45, 25, 255]);
  for (let y = 0; y < 5; y++) put(1, y, [8, 9, 22, 255]);
  put(5, 5, [8, 9, 22, 255]); // enclosed original detail is not a matte border
  put(0, 0, [9, 9, 22, 255]); // a different dark shade must not be chroma-keyed
  put(7, 7, [0, 0, 0, 255]); // black bark/detail on an edge survives too
  const before = pixels.slice(), masked = maskFoliageVoid(256 + 137, namesFor('do2'), pixels, width, height);
  assert.notEqual(masked, pixels); assert.deepEqual(pixels, before);
  for (let y = 0; y < 5; y++) assert.equal(masked[(1 + y * width) * 4 + 3], 0);
  for (const [x, y] of [[5, 5], [0, 0], [7, 7], [4, 4]]) assert.equal(masked[(x + y * width) * 4 + 3], 255);
  assert.equal(maskFoliageVoid(256 + 137, namesFor('Other art'), pixels, width, height), pixels);
  assert.equal(maskFoliageVoid(256 + 24, namesFor('do2'), pixels, width, height), pixels, 'adjacent cliffs retain their exact source');
  assert.equal(maskFoliageVoid(256 + 195, namesFor('do2'), pixels, width, height), pixels, 'standalone tree artwork is not part of the border matte');
});

test('a fully matte forest cell leaves no dark panel and the drawer caches its alpha treatment', () => {
  const pixels = new Uint8ClampedArray(32 * 32 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([8, 9, 22, 255], i);
  let reads = 0, writes = 0; const source = { name: 'Synthetic original sheet' }, target = [];
  const makeCanvas = () => ({ getContext: () => ({ drawImage() {}, getImageData() { reads++; return { data: pixels.slice() }; },
    putImageData(image) { writes++; assert.equal(image.data.some((value, i) => i % 4 === 3 && value), false); } }) });
  const images = Array(9).fill(null); images[6] = source;
  const drawer = new FoliageTileDrawer(images, new Int16Array(8192), namesFor('do2'), makeCanvas);
  const ctx = { drawImage: (...args) => target.push(args) };
  drawer.draw(ctx, 256 + 137, 10, 20); drawer.draw(ctx, 256 + 137, 40, 50);
  assert.equal(reads, 1); assert.equal(writes, 1); assert.equal(target[0][0], target[1][0]);
  assert.notEqual(target[0][0], source); assert.deepEqual(target[0].slice(1), [10, 20]);
  drawer.draw(ctx, 256 + 24, 0, 0); assert.equal(target.at(-1)[0], source);
  assert.equal(reads, 1, 'ordinary cliff art bypasses the filter entirely');
  assert.ok(pixels.every((value, i) => i % 4 !== 3 || value === 255));
});

test('unreadable forest pixels conservatively preserve the source drawing', () => {
  const source = {}, images = Array(9).fill(null); images[6] = source;
  let reads = 0; const calls = [];
  const drawer = new FoliageTileDrawer(images, new Int16Array(8192), namesFor('do2'), () => ({ getContext: () => ({
    drawImage() {}, getImageData() { reads++; throw new Error('Synthetic unavailable pixels'); },
  }) }));
  for (let n = 0; n < 3; n++) drawer.draw({ drawImage: (...args) => calls.push(args) }, 256 + 137, 0, 0);
  assert.equal(reads, 1); assert.ok(calls.every(args => args[0] === source));
});

test('masked forest render alpha never splits the original canopy joins or gives each column its own pivot', async t => {
  await environment(t);
  const previousImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class {
    width = 512; height = 512;
    set src(_url) { queueMicrotask(() => this.onload()); }
  } });
  t.after(() => { if (previousImage) Object.defineProperty(globalThis, 'Image', previousImage); else delete globalThis.Image; });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: ['Graphics/Tilesets/do2.png'] }));
  await initAssets();
  let maskedDraws = 0, sourceJoinReads = 0;
  document.createElement = () => {
    const cv = { width: 32, height: 32, masked: false };
    let source = null;
    const ctx = new Proxy({
      clearRect() { source = null; },
      drawImage(image) { source = image; if (image.masked) maskedDraws++; },
      getImageData(_x, _y, width, height) {
        const data = new Uint8ClampedArray(width * height * 4);
        if (source && !source.masked) {
          for (let i = 0; i < data.length; i += 4) data.set([8, 9, 22, 255], i);
          if (width === 2 || height === 2) sourceJoinReads++;
        }
        return { data };
      },
      putImageData(image) { cv.masked = !image.data.some((value, i) => i % 4 === 3 && value); },
    }, { get: (target, key) => key in target ? target[key] : () => {} });
    cv.getContext = () => ctx; return cv;
  };
  const { grid } = forest();
  const mesh = await buildMapMesh(grid);
  t.after(() => mesh.dispose());
  assert.equal(mesh.joinsBelow(401, 409), true, 'source-alpha vertical seams remain connected');
  assert.equal(mesh.joinsBeside(409, 409), true, 'source-alpha horizontal seams remain connected');
  assert.equal(mesh.stats.stacks, 8, 'each complete three-row column keeps its canopy and trunk');
  assert.equal(mesh.stats.mass, 0); assert.ok(maskedDraws > 0, 'rendering still uses the alpha-cleaned artwork');
  assert.ok(sourceJoinReads > 0, 'logical joins read the original artwork separately');
  const bb = mesh.group.children.filter(child => child.geometry?.getAttribute('center'));
  assert.equal(bb.length, 0, 'a continuous eight-column border is fixed as one group, never separate rotating fragments');
});
