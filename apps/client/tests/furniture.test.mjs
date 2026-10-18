import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MapGrid, T, buildMapMesh } from '../src/world/mapmesh.js';
import { furnitureFloor, furnitureGeometry, tileFurniture, isUprightFurnitureTile } from '../src/entities/furniture.js';
import { isLyingTile } from '../src/entities/lying.js';
import { CharacterSprite, layoutTilePictures } from '../src/entities/sprites.js';
import { G } from '../src/core/globals.js';
import { initAssets } from '../src/data/assets.js';

const names = ['', '', '', '', '', 'Inside_B', '', 'VXTileD', 'RoyalTileset-TileB'];
function pixels() {
  const px = new Uint8ClampedArray(32 * 32 * 4);
  for (let y = 2; y < 32; y++) for (let x = 5; x < 27; x++) {
    if (y >= 27 && x > 8 && x < 23) continue;
    const at = (y * 32 + x) * 4;
    px.set(y < 18 ? [220, 50, 50, 255] : y < 27 ? [40, 220, 60, 255] : [60, 60, 220, 255], at);
  }
  return px;
}

function grid() {
  const data = new Int16Array(3 * 3 * 4), flags = new Int16Array(8192);
  data.fill(2816, 0, 9); // ordinary floor
  flags[0] = 16; flags[578] = 15; flags[577] = 15;
  data[1 + 3 + 18] = 578; // red chair, facing south
  return new MapGrid({ width: 3, height: 3, data: { data } }, { tileset_names: names, flags: { data: flags } });
}

test('furniture shapes use sheet identity and direction, never passage flags alone', () => {
  for (const [id, direction] of [[578, 2], [579, 8], [586, 6], [587, 4], [995, 2], [996, 8]]) {
    assert.equal(tileFurniture(id, names)?.direction, direction);
  }
  assert.equal(tileFurniture(578, ['', '', '', '', '', '', '', 'UnrelatedArt']), null);
  assert.equal(tileFurniture(1536, names), null, 'A5 must not alias a B-E sheet');
  assert.equal(isLyingTile(80, names), true, 'single bed head');
  assert.equal(isLyingTile(96, names), true, 'round tabletop');
  for (const id of [58, 72, 102, 103, 110, 111, 224]) assert.equal(isLyingTile(id, names), false, 'cabinets, pianos and crates remain upright');
  for (const id of [58, 72, 102, 103, 110, 111, 224]) assert.equal(isUprightFurnitureTile(id, names), true);
  assert.equal(isUprightFurnitureTile(578, names), false, 'chairs use their own shape');
});

test('chair view exposes its floor without changing gameplay collision or tiles', () => {
  const original = grid(), { grid: view, cells } = furnitureFloor(original);
  assert.equal(cells.length, 1);
  assert.equal(view.tile(1, 1, 2), 0);
  assert.equal(view.anyPassable(1, 1), true);
  assert.equal(original.tile(1, 1, 2), 578);
  assert.equal(original.anyPassable(1, 1), false);
  assert.equal(view.passage(1, 1, 1, [577]), false, 'blocking event tile still wins');
  assert.equal(view.passage(4, 0, 1), false, 'out-of-bounds coordinates must not alias a chair cell');
  original.flags[2816] = 15; // a wall or impassable base below the artwork
  assert.equal(furnitureFloor(original).cells.length, 0);
});

test('a chair has a horizontal seat, upright back, feet and real depth from all sides', () => {
  const art = pixels(), profile = tileFurniture(578, names);
  const geometry = furnitureGeometry(profile, () => art);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  assert.ok(Math.abs(box.min.y) < 1e-6, 'feet touch the floor');
  assert.ok(box.max.y > T * 0.75 && box.max.y < T, 'human-sized backrest');
  assert.ok(box.max.z - box.min.z > T * 0.45, 'a chair must have a seat depth, not just a billboard');
  const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal');
  let seatTop = 0, backFace = 0;
  for (let i = 0; i < p.count; i++) {
    if (n.getY(i) > 0.99 && p.getY(i) > 0.4 && p.getY(i) < 0.55) seatTop++;
    if (Math.abs(n.getZ(i)) > 0.99 && p.getY(i) > 0.7) backFace++;
  }
  assert.ok(seatTop > 100); assert.ok(backFace > 100);
  const rotated = furnitureGeometry(tileFurniture(586, names), () => art);
  rotated.computeBoundingBox();
  assert.ok(Math.abs((rotated.boundingBox.max.x - rotated.boundingBox.min.x) - (box.max.z - box.min.z)) < 1e-6);
  assert.deepEqual(art, pixels(), 'building geometry must not change cached artwork');
  const padded = pixels();
  padded.fill(0, 30 * 32 * 4); // real sheets often leave transparent rows below feet
  const withMargin = furnitureGeometry(profile, () => padded);
  withMargin.computeBoundingBox();
  assert.ok(Math.abs(withMargin.boundingBox.min.y) < 1e-6, 'transparent margins must not lift feet off the floor');
  withMargin.dispose();
  geometry.dispose(); rotated.dispose();
});

function canvas() {
  const context = new Proxy({ getImageData: (_x, _y, w, h) => ({ data: w === 32 && h === 32 ? pixels() : new Uint8ClampedArray(w * h * 4) }) },
    { get: (target, key) => key in target ? target[key] : () => {} });
  return { width: 32, height: 32, getContext: () => context };
}
function environment(t) {
  const before = { map: G.map, floorAt: G.floorAt, combat: G.combat };
  t.after(() => Object.assign(G, before));
  G.map = { sceneActors: new Set() }; G.floorAt = () => 0; G.combat = { hidesEvent: () => false };
  const doc = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: canvas } });
  t.after(() => { if (doc) Object.defineProperty(globalThis, 'document', doc); else delete globalThis.document; });
}

test('tile-event furniture remains fixed from different viewpoints and follows page changes', async t => {
  environment(t);
  const ch = { isEvent: true, id: 1, tileId: 578, characterName: '', priorityType: 0, through: false,
    x: 1, y: 1, realX: 1, realY: 1, opacity: 255, page: {}, jumping: () => false };
  const sprite = new CharacterSprite(ch, new THREE.Group(), {
    tilesetNames: names, isWall: () => false, tileFlag: () => 15, drawer: { draw() {} },
  });
  for (const priority of [0, 1, 2]) {
    ch.priorityType = priority;
    await sprite.rebuild(sprite.graphicKey());
    sprite.place(new THREE.Vector3(5, 1.6, 5));
    sprite.mesh.updateMatrix();
    const matrix = sprite.mesh.matrix.clone();
    sprite.place(new THREE.Vector3(-5, 1.6, -5));
    sprite.mesh.updateMatrix();
    assert.equal(sprite.mode, 'furniture');
    assert.equal(sprite.mesh.rotation.y, 0);
    assert.deepEqual(sprite.mesh.matrix, matrix);
    assert.equal(sprite.mesh.position.y, 0, 'above-priority furniture must not float above the player');
    assert.equal(ch.priorityType, priority); assert.equal(ch.through, false);
  }
  ch.tileId = 80; // a bed drawn as an event, even with blocking priority
  await sprite.rebuild(sprite.graphicKey());
  sprite.mesh.geometry.computeBoundingBox();
  assert.ok(Math.abs(sprite.mesh.geometry.boundingBox.max.y - T * 0.45) < 1e-6);
  ch.tileId = 58; // page changes to a cupboard
  ch.priorityType = 1;
  await sprite.rebuild(sprite.graphicKey());
  assert.equal(sprite.mode, 'stand'); assert.equal(sprite.isFurniture, false);
  sprite.place(new THREE.Vector3(-5, 1.6, -5));
  assert.equal(sprite.mesh.rotation.y, 0, 'a cupboard should not follow the viewer');
  G.map.width = 3;
  const list = [sprite];
  layoutTilePictures(list, sprite.mapInfo);
  assert.equal(sprite.tp?.fixed, true, 'even a single cupboard event has fixed sides');
  ch.priorityType = 2;
  await sprite.rebuild(sprite.graphicKey()); sprite.place(new THREE.Vector3(5, 1.6, 5));
  layoutTilePictures(list, sprite.mapInfo);
  assert.equal(sprite.tp?.lift, 1.9, 'changing an event page must refresh the cached arrangement');
  sprite.dispose();
});

test('the full map renderer builds a fixed chair mesh without a duplicate standee', async t => {
  environment(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: [] }));
  await initAssets();
  const original = grid(), mesh = await buildMapMesh(original);
  const chair = mesh.group.getObjectByName('furniture');
  assert.ok(chair?.geometry.getAttribute('position').count > 100);
  assert.equal(chair.isInstancedMesh, true);
  const matrix = new THREE.Matrix4(); chair.getMatrixAt(0, matrix);
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(matrix).toArray(), [T * 1.5, 0, T * 1.5]);
  assert.equal(mesh.isSolid(1, 1), false, 'no wall should rise through the chair');
  assert.equal(mesh.isStackCell(1, 1), false, 'no second chair billboard');
  assert.equal(original.anyPassable(1, 1), false);
  let released = false; chair.addEventListener('dispose', () => { released = true; });
  mesh.dispose();
  assert.equal(released, true, 'instance buffers must be freed when leaving a map');
  original.data[22] = 58; original.flags[58] = 15;
  const cabinet = await buildMapMesh(original, { analysisOnly: true });
  assert.equal(cabinet.boxes.length, 1);
  assert.equal(cabinet.boxes[0].fixed, true, 'map cupboards also keep their orientation');
});
