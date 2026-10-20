import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { billboardGeometryChunks, ordinaryGeometryChunks } from '../src/world/map-geometry.js';
import { MapGrid, buildMapMesh, makeBillboardMaterial, T } from '../src/world/mapmesh.js';
import { initAssets } from '../src/data/assets.js';

function source(quads) {
  const attributes = Object.fromEntries([['position', 3], ['uv', 2], ['color', 3], ['normal', 3], ['center', 3]]
    .map(([name, itemSize]) => [name, { array: [], itemSize }]));
  const indices = [];
  quads.forEach(({ center, left = -1, right = 1, bottom = 0, top = 2 }, q) => {
    [[left, top, 0], [left, bottom, 0], [right, bottom, 0], [right, top, 0]].forEach((p, k) => {
      attributes.position.array.push(...p); attributes.center.array.push(...center);
      attributes.uv.array.push(q / 10 + k / 100, 1 - k / 4);
      attributes.color.array.push(1, 0.4 + q / 100, 0.7 + k / 100);
      attributes.normal.array.push(0, 0, 1);
    });
    const first = q * 4;
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  });
  return { attributes, indices };
}
function shaderPoint(geometry, i, viewer, matrix = new THREE.Matrix4()) {
  const c = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('center'), i);
  const p = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'), i);
  const worldCenter = c.clone().applyMatrix4(matrix);
  const direction = new THREE.Vector2(viewer.x - worldCenter.x, viewer.z - worldCenter.z);
  if (direction.length() > 0.0001) direction.normalize(); else direction.set(0, 1);
  return c.add(new THREE.Vector3(direction.y * p.x, p.y, -direction.x * p.x)).applyMatrix4(matrix);
}
function frustum(camera) {
  camera.updateMatrixWorld(true);
  return new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
}
const closeArray = values => Array.from(new Float32Array(values));

function ordinarySource(quads) {
  const input = source(quads);
  for (let i = 0; i < input.attributes.position.array.length; i++) input.attributes.position.array[i] += input.attributes.center.array[i];
  delete input.attributes.center;
  return input;
}

test('billboard chunks preserve complete indexed quads and every attribute in source order within each chunk', () => {
  const input = source([
    { center: [23.9, 3, 4] }, { center: [24.1, -2, 4] },
    { center: [2, 0, 4], left: -15, right: 15, top: 20 }, { center: [-0.1, 5, -0.1] },
  ]);
  const before = structuredClone(input), geometries = billboardGeometryChunks(input.attributes, input.indices, 24);
  assert.equal(geometries.length, 3);
  assert.deepEqual(geometries.map(g => g.getAttribute('position').count), [8, 4, 4]);
  assert.equal(geometries.reduce((n, g) => n + g.index.count / 3, 0), input.indices.length / 3);
  for (const [chunk, sourceQuads] of geometries.map((g, i) => [g, [[0, 2], [1], [3]][i]])) {
    assert.deepEqual(Object.keys(chunk.attributes).sort(), Object.keys(input.attributes).sort());
    for (const [name, attribute] of Object.entries(input.attributes)) {
      const expected = sourceQuads.flatMap(q => attribute.array.slice(q * 4 * attribute.itemSize, (q + 1) * 4 * attribute.itemSize));
      assert.equal(chunk.getAttribute(name).itemSize, attribute.itemSize);
      assert.deepEqual(Array.from(chunk.getAttribute(name).array), closeArray(expected), name);
    }
    assert.deepEqual(Array.from(chunk.index.array), sourceQuads.flatMap((_, q) => [0, 1, 2, 0, 2, 3].map(i => i + q * 4)));
  }
  assert.deepEqual(input, before, 'chunk creation must not change the atlas inputs or geometry source');
  geometries.forEach(g => g.dispose());
});

test('wide and tall billboard bounds contain all shader rotations even beyond a chunk edge and with loop translations', () => {
  const input = source([
    { center: [23.99, 10, 23.99], left: -37, right: 29, bottom: -8, top: 65 },
    { center: [-24.01, -15, -0.01], left: -2, right: 2, bottom: -5, top: 45 },
  ]);
  const geometries = billboardGeometryChunks(input.attributes, input.indices, 24);
  for (const geometry of geometries) for (const offset of [[0, 0, 0], [144, 0, -96], [-288, 0, 192]]) {
    const matrix = new THREE.Matrix4().makeTranslation(...offset);
    const box = geometry.boundingBox.clone().applyMatrix4(matrix), sphere = geometry.boundingSphere.clone().applyMatrix4(matrix);
    for (let angle = 0; angle < 360; angle += 5) {
      const viewer = new THREE.Vector3(offset[0] + Math.cos(angle * Math.PI / 180) * 100,
        angle % 2 ? -50 : 150, offset[2] + Math.sin(angle * Math.PI / 180) * 100);
      for (let i = 0; i < geometry.getAttribute('position').count; i++) {
        const point = shaderPoint(geometry, i, viewer, matrix);
        assert.ok(box.containsPoint(point), `box omitted angle ${angle}, vertex ${i}`);
        assert.ok(sphere.containsPoint(point), `sphere omitted angle ${angle}, vertex ${i}`);
      }
    }
    const c = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('center'), 0).applyMatrix4(matrix);
    for (let i = 0; i < 4; i++) assert.ok(box.containsPoint(shaderPoint(geometry, i, c, matrix)), 'zero-distance shader fallback remains bounded');
  }
  geometries.forEach(g => g.dispose());
});

test('actual Three frustum tests retain visible canopy edges at every yaw and translated loop copy', () => {
  const input = source([{ center: [23.9, 2, 23.9], left: -35, right: 35, bottom: 0, top: 45 }]);
  const [geometry] = billboardGeometryChunks(input.attributes, input.indices, 24);
  const material = makeBillboardMaterial({ alphaTest: 0.5 });
  const group = new THREE.Group(); group.add(new THREE.Mesh(geometry, material));
  const loop = group.clone(); loop.position.set(-192, 0, 144);
  assert.equal(loop.children[0].geometry, geometry); assert.equal(loop.children[0].material, material);
  let visibleOutsideCenters = 0;
  for (const parent of [group, loop]) {
    parent.updateMatrixWorld(true); const mesh = parent.children[0];
    const center = new THREE.Vector3(23.9, 2, 23.9).applyMatrix4(mesh.matrixWorld);
    for (let angle = 0; angle < 360; angle += 15) {
      const theta = angle * Math.PI / 180;
      const camera = new THREE.PerspectiveCamera(15, 1, 0.1, 200);
      camera.position.copy(center).add(new THREE.Vector3(Math.sin(theta) * 70, 15, Math.cos(theta) * 70));
      const point = shaderPoint(geometry, 3, camera.position, mesh.matrixWorld);
      camera.lookAt(point); const visible = frustum(camera);
      assert.ok(visible.containsPoint(point));
      if (!visible.containsPoint(center)) visibleOutsideCenters++;
      assert.equal(mesh.frustumCulled, true);
      assert.ok(visible.intersectsObject(mesh), `visible canopy edge culled at ${angle} degrees`);
    }
  }
  assert.equal(visibleOutsideCenters, 48, 'a center-only or chunk-cell-only bound would clip this canopy');
  geometry.dispose(); material.dispose();
});

test('spatial billboard chunks reject distant geometry while keeping the nearby quad', () => {
  const input = source(Array.from({ length: 12 }, (_, i) => ({ center: [12 + i * 48, 0, 12] })));
  const geometries = billboardGeometryChunks(input.attributes, input.indices, 24);
  const material = new THREE.MeshBasicMaterial(), group = new THREE.Group();
  for (const geometry of geometries) group.add(new THREE.Mesh(geometry, material));
  group.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 30);
  camera.position.set(12, 1, 20); camera.lookAt(12, 1, 12);
  const visible = group.children.filter(mesh => frustum(camera).intersectsObject(mesh));
  assert.equal(visible.length, 1); assert.equal(visible[0], group.children[0]);
  assert.equal(visible[0].geometry.index.count / 3, 2);
  assert.equal(geometries.reduce((n, geometry) => n + geometry.index.count / 3, 0), 24);
  geometries.forEach(g => g.dispose()); material.dispose();
});

test('quad validation cannot silently discard incomplete billboard data', () => {
  const input = source([{ center: [0, 0, 0] }]);
  assert.throws(() => billboardGeometryChunks(input.attributes, input.indices, 0), RangeError);
  assert.throws(() => billboardGeometryChunks(input.attributes, input.indices.slice(1), 24), RangeError);
  assert.throws(() => billboardGeometryChunks(input.attributes, input.indices, 24, Infinity), RangeError);
  assert.throws(() => billboardGeometryChunks(input.attributes, input.indices, 24, -1), RangeError);
  const crossing = [...input.indices]; crossing[3] = 4;
  assert.throws(() => billboardGeometryChunks(input.attributes, crossing, 24), RangeError);
  assert.deepEqual(billboardGeometryChunks(source([]).attributes, [], 24), []);
});

test('the billboard minimum keeps 2047 quads together with correct bounds and spatially splits 2048 quads', () => {
  for (const count of [2047, 2048]) {
    const input = source(Array.from({ length: count }, (_, i) => ({ center: [12 + i % 64 * 1.5, 0, 12 + Math.floor(i / 64) * 1.5] })));
    const geometries = billboardGeometryChunks(input.attributes, input.indices, 32 * T, 2048);
    assert.equal(geometries.length, count < 2048 ? 1 : 6);
    assert.equal(geometries.reduce((sum, g) => sum + g.index.count / 3, 0), count * 2);
    for (const geometry of geometries) {
      const viewer = new THREE.Vector3(80, 2, 80);
      for (let i = 0; i < geometry.getAttribute('position').count; i++) {
        const point = shaderPoint(geometry, i, viewer);
        assert.ok(geometry.boundingBox.containsPoint(point)); assert.ok(geometry.boundingSphere.containsPoint(point));
      }
    }
    if (count < 2048) {
      const mesh = new THREE.Mesh(geometries[0], new THREE.MeshBasicMaterial()); mesh.updateMatrixWorld(true);
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 15);
      camera.position.set(12, 1, 18); camera.lookAt(12, 1, 12);
      assert.ok(frustum(camera).intersectsObject(mesh), 'small batch bounds contain centers far from local vertex offsets');
      mesh.material.dispose();
    }
    geometries.forEach(g => g.dispose());
  }
});

test('ordinary chunks retain complete wide and tall quads, exact attributes, indices, and full bounds', () => {
  const input = ordinarySource([
    { center: [23.9, 0, 3], left: -35, right: 35, bottom: -2, top: 50 },
    { center: [24.1, -5, 4] }, { center: [2, 10, 3] },
  ]);
  const before = structuredClone(input), geometries = ordinaryGeometryChunks(input.attributes, input.indices, 24);
  assert.equal(geometries.length, 2);
  for (const [geometry, sourceQuads] of geometries.map((g, i) => [g, [[0, 2], [1]][i]])) {
    for (const [name, attribute] of Object.entries(input.attributes)) {
      const expected = sourceQuads.flatMap(q => attribute.array.slice(q * 4 * attribute.itemSize, (q + 1) * 4 * attribute.itemSize));
      assert.deepEqual(Array.from(geometry.getAttribute(name).array), closeArray(expected), name);
    }
    assert.deepEqual(Array.from(geometry.index.array), sourceQuads.flatMap((_, q) => [0, 1, 2, 0, 2, 3].map(i => i + q * 4)));
    for (let i = 0; i < geometry.getAttribute('position').count; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'), i);
      assert.ok(geometry.boundingBox.containsPoint(point));
      assert.ok(geometry.boundingSphere.containsPoint(point));
    }
  }
  assert.ok(geometries[0].boundingBox.min.x < 0 && geometries[0].boundingBox.max.x > 48,
    'a wall crossing several chunk cells cannot be clipped to its centroid cell');
  assert.deepEqual(input, before);
  assert.equal(geometries.reduce((n, g) => n + g.index.count, 0), input.indices.length);
  geometries.forEach(g => g.dispose());
});

test('ordinary full-vertex bounds survive angular and translated loop frustum tests while rejecting distant chunks', () => {
  const input = ordinarySource([
    { center: [23.9, 0, 3], left: -35, right: 35, bottom: -2, top: 50 },
    { center: [240, 0, 3] }, { center: [480, 0, 3] },
  ]);
  const geometries = ordinaryGeometryChunks(input.attributes, input.indices, 24), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const group = new THREE.Group(); geometries.forEach(g => group.add(new THREE.Mesh(g, material)));
  const loop = group.clone(); loop.position.set(192, 0, -144);
  for (const parent of [group, loop]) {
    parent.updateMatrixWorld(true); const mesh = parent.children[0];
    for (let angle = 0; angle < 360; angle += 30) {
      const theta = angle * Math.PI / 180, camera = new THREE.PerspectiveCamera(15, 1, 0.1, 150);
      const point = new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'), 3).applyMatrix4(mesh.matrixWorld);
      camera.position.copy(parent.position).add(new THREE.Vector3(23.9 + Math.sin(theta) * 70, 20, 3 + Math.cos(theta) * 70));
      camera.lookAt(point); const visible = frustum(camera);
      assert.ok(visible.containsPoint(point)); assert.ok(visible.intersectsObject(mesh));
      assert.equal(visible.intersectsObject(parent.children[1]), false);
      assert.equal(visible.intersectsObject(parent.children[2]), false);
    }
  }
  assert.equal(loop.children[0].geometry, group.children[0].geometry);
  assert.equal(loop.children[0].material, material);
  geometries.forEach(g => g.dispose()); material.dispose();
});

function syntheticCanvas() {
  const context = new Proxy({
    getImageData(_x, _y, width, height) {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (width === 32 && height === 32 && (x < 8 || x > 23)) continue;
        data.set([80, 150, 60, 255], (x + y * width) * 4);
      }
      return { data };
    },
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  return { width: 32, height: 32, getContext: () => context };
}

test('real small map keeps single billboard and floor batches with valid bounds, shared art, collision, and once-only disposal', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: syntheticCanvas } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: [] })); await initAssets();
  const w = 48, h = 7, data = new Int16Array(w * h * 4), flags = new Int16Array(8192);
  data.fill(1536, 0, w * h); flags[0] = 16; flags[1] = 15;
  for (const x of [2, 20, 38]) data[x + 3 * w + 2 * w * h] = 1;
  const grid = new MapGrid({ width: w, height: h, data: { data }, parallax_name: '' },
    { tileset_names: Array(9).fill(''), flags: { data: flags } });
  const before = data.slice(), beforeFlags = flags.slice(), view = await buildMapMesh(grid);
  const billboards = view.group.children.filter(mesh => mesh.geometry?.hasAttribute('center'));
  assert.equal(billboards.length, 1, 'a small billboard batch avoids extra draws');
  assert.equal(billboards.reduce((n, mesh) => n + mesh.geometry.index.count / 3, 0), 6);
  assert.ok(billboards.every(mesh => mesh.material === billboards[0].material && mesh.frustumCulled));
  assert.ok(billboards.every(mesh => mesh.geometry.boundingBox && mesh.geometry.boundingSphere));
  const ordinary = view.group.children.filter(mesh => mesh.geometry && !mesh.geometry.hasAttribute('center'));
  assert.equal(ordinary.length, 1, 'the floor buffer remains a single draw');
  assert.equal(ordinary[0].geometry.index.count / 3, w * h * 2);
  for (const x of [2, 20, 38]) { assert.equal(grid.anyPassable(x, 3), false); assert.equal(view.isSolid(x, 3), false); }
  assert.equal(grid.anyPassable(10, 3), true); assert.deepEqual(data, before); assert.deepEqual(flags, beforeFlags);
  const loop = view.group.clone(); loop.position.set(w * T, 0, -h * T); loop.updateMatrixWorld(true);
  assert.equal(loop.children.length, view.group.children.length);
  for (let i = 0; i < loop.children.length; i++) {
    assert.equal(loop.children[i].geometry, view.group.children[i].geometry);
    assert.equal(loop.children[i].material, view.group.children[i].material);
  }
  const geometries = new Set(), materials = new Set(), textures = new Set(), disposed = new Map();
  view.group.traverse(mesh => {
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) materials.add(mesh.material);
    if (mesh.material?.map) textures.add(mesh.material.map);
  });
  for (const resource of [...geometries, ...materials, ...textures]) {
    disposed.set(resource, 0); resource.addEventListener('dispose', () => disposed.set(resource, disposed.get(resource) + 1));
  }
  view.dispose();
  for (const resource of [...geometries, ...materials, ...textures]) assert.equal(disposed.get(resource), 1);
  assert.equal(geometries.size, 2); assert.equal(materials.size, 2);
});

test('large real map floors use spatial chunks at 2048 quads while smaller ordinary batches stay single', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: syntheticCanvas } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: [] })); await initAssets();
  for (const [w, h, expected] of [[63, 32, 1], [64, 32, 2], [64, 48, 4]]) {
    const data = new Int16Array(w * h * 4), flags = new Int16Array(8192);
    data.fill(1536, 0, w * h); flags[0] = 16;
    const grid = new MapGrid({ width: w, height: h, data: { data }, parallax_name: '' },
      { tileset_names: Array(9).fill(''), flags: { data: flags } });
    const before = data.slice(), beforeFlags = flags.slice(), view = await buildMapMesh(grid);
    const meshes = view.group.children.filter(mesh => mesh.geometry);
    assert.equal(meshes.length, expected, `${w}x${h} floor chunk count`);
    assert.ok(meshes.every(mesh => mesh.material === meshes[0].material && mesh.frustumCulled));
    assert.equal(meshes.reduce((n, mesh) => n + mesh.geometry.index.count / 3, 0), w * h * 2);
    assert.equal(meshes.reduce((n, mesh) => n + mesh.geometry.getAttribute('position').count, 0), w * h * 4);
    const cells = new Set(), attributeQuads = new Map();
    for (const mesh of meshes) {
      const geometry = mesh.geometry, p = geometry.getAttribute('position');
      for (let first = 0; first < p.count; first += 4) {
        const points = Array.from({ length: 4 }, (_, i) => new THREE.Vector3().fromBufferAttribute(p, first + i));
        const box = new THREE.Box3().setFromPoints(points), x = box.min.x / T, z = box.min.z / T;
        const key = `${x},${z}`; assert.equal(cells.has(key), false); cells.add(key);
        assert.equal(box.max.x - box.min.x, T); assert.equal(box.max.z - box.min.z, T);
        assert.equal(box.min.y, 0); assert.equal(box.max.y, 0);
        assert.ok(x >= 0 && x < w && z >= 0 && z < h);
        for (const [name, size] of [['uv', 2], ['normal', 3], ['color', 3]]) {
          const values = Array.from(geometry.getAttribute(name).array.slice(first * size, (first + 4) * size));
          if (!attributeQuads.has(name)) attributeQuads.set(name, values); else assert.deepEqual(values, attributeQuads.get(name), name);
        }
      }
    }
    assert.equal(cells.size, w * h);
    assert.deepEqual(data, before); assert.deepEqual(flags, beforeFlags);
    assert.equal(grid.anyPassable(17, 17), true); assert.equal(view.isSolid(17, 17), false); assert.equal(view.floorAt(17, 17), 0);
    if (expected > 1) {
      assert.ok(meshes.every(mesh => mesh.geometry.boundingBox && mesh.geometry.boundingSphere));
      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 12);
      camera.position.set(6, 4, 8); camera.lookAt(6, 0, 2); view.group.updateMatrixWorld(true);
      const visible = meshes.filter(mesh => frustum(camera).intersectsObject(mesh));
      assert.ok(visible.length > 0 && visible.length < meshes.length);
      assert.ok(visible.reduce((n, mesh) => n + mesh.geometry.index.count / 3, 0) < w * h * 2);
    }
    const loop = view.group.clone(); loop.position.set(w * T, 0, -h * T); loop.updateMatrixWorld(true);
    meshes.forEach((mesh, i) => { assert.equal(loop.children[i].geometry, mesh.geometry); assert.equal(loop.children[i].material, mesh.material); });
    const resources = new Set(meshes.flatMap(mesh => [mesh.geometry, mesh.material, mesh.material.map]));
    const disposed = new Map([...resources].map(resource => [resource, 0]));
    for (const resource of resources) resource.addEventListener('dispose', () => disposed.set(resource, disposed.get(resource) + 1));
    view.dispose(); for (const count of disposed.values()) assert.equal(count, 1);
  }
});
