import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { characterPropProfile, characterPropFrame, characterTableGeometry } from '../src/entities/character-props.js';
import { CharacterSprite } from '../src/entities/sprites.js';
import { initAssets } from '../src/data/assets.js';
import { G } from '../src/core/globals.js';

function environment(t) {
  const saved = { ...G }, descriptors = Object.fromEntries(['document', 'Image'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  t.after(() => { Object.assign(G, saved); for (const [name, descriptor] of Object.entries(descriptors)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  } });
  Object.assign(G, { map: {}, combat: null, coop: null, floorAt: () => 0 });
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class {
    set src(url) { this.name = decodeURIComponent(url); this.width = this.name.includes('Map1_c') ? 96 : 384;
      this.height = this.name.includes('Map1_c') ? 384 : 512; queueMicrotask(() => this.onload()); }
  } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => {
    let name = '';
    const ctx = new Proxy({ drawImage(image) { name = image.name || ''; },
      getImageData(sx, sy, w, h) {
        const pixels = new Uint8ClampedArray(w * h * 4), fh = name.includes('Map1_c') ? 96 : 64;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const fx = (sx + x) % 32, fy = (sy + y) % fh;
          const bottom = name.includes('Map1_c') ? Math.floor((sx + x) / 32) === 1 ? 80 : 90
            : sx === 64 && sy === 320 ? 40 : 64;
          if (fx >= 2 && fx < 30 && fy >= 4 && fy < bottom) pixels.set([112, 128, 140, 255], (y * w + x) * 4);
        }
        return { data: pixels };
      },
      createRadialGradient: () => ({ addColorStop() {} }),
    }, { get: (object, key) => key in object ? object[key] : () => {} });
    return { width: 0, height: 0, getContext: () => ctx };
  } } });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: ['!$Map1_c', '!Map1_b'].map(name => `Graphics/Characters/${name}.png`) }));
  return initAssets();
}
function character(name, index = 0, direction = 8, pattern = 1) {
  return { isEvent: true, id: 3, characterName: name, characterIndex: index, direction, pattern, tileId: 0,
    priorityType: 1, through: false, moveType: 0, stepAnime: false, directionFix: true, x: 27, y: 17, realX: 27, realY: 17,
    opacity: 255, page: {}, jumping: () => false };
}

test('only the verified torture rack and bed frames become tables; hanging shackles and upright instruments remain intact', () => {
  for (const direction of [2, 4, 6, 8]) assert.equal(characterPropProfile(character('!$Map1_c', 0, direction, 1))?.kind, 'table');
  for (const pattern of [0, 2]) assert.equal(characterPropProfile(character('!$Map1_c', 0, 8, pattern)), null);
  assert.equal(characterPropProfile(character('!Map1_b', 1, 8, 1))?.kind, 'table');
  assert.equal(characterPropProfile(character('!Map1_b', 6, 4, 1))?.kind, 'grounded');
  assert.equal(characterPropProfile(character('!Map1_b', 1, 2, 1))?.kind, 'grounded', 'upper cupboard frames stay upright');
  assert.equal(characterPropProfile(character('!$UnrelatedMap1_c')), null);
  assert.equal(characterPropProfile({ ...character('!Map1_b', 4), stepAnime: true }), null);
});

test('table geometry uses the exact selected source frame, lies horizontally and has floor-reaching solid supports', async t => {
  await environment(t);
  const ch = character('!$Map1_c'), parent = new THREE.Group();
  const sprite = new CharacterSprite(ch, parent, { isWall: () => false });
  await sprite.rebuild(sprite.graphicKey()); sprite.place(new THREE.Vector3(40, 1.6, 28));
  assert.equal(sprite.mode, 'prop'); assert.equal(sprite.propGeometry, true); assert.equal(sprite.mesh.material.vertexColors, true);
  const geometry = sprite.mesh.geometry; geometry.computeBoundingBox(); const box = geometry.boundingBox;
  assert.ok(Math.abs(box.min.y) < 1e-6, 'the supports must reach the floor');
  assert.ok(box.max.y > 0.65 && box.max.y < 0.71);
  assert.ok(box.max.z - box.min.z > 3.4, 'the long rack lies along the floor instead of standing four metres high');
  assert.deepEqual(geometry.userData.frame, [32, 288, 32, 96]);
  const before = sprite.group.position.clone();
  sprite.place(new THREE.Vector3(-40, 1.6, -28));
  assert.equal(sprite.mesh.rotation.y, 0); assert.deepEqual(sprite.group.position, before); assert.equal(sprite.mesh.geometry, geometry);
  assert.equal(ch.priorityType, 1); assert.equal(ch.through, false); sprite.dispose();
});

test('freestanding tables reject projected wall mounts but retain real tabletop support height', async t => {
  await environment(t); G.floorAt = () => 0.25;
  const ch = character('!$Map1_c'), mapInfo = { isWall: () => true,
    spotOnSolid: () => ({ x: 27.5, z: 18, y: 2, side: 'S', ground: false }) };
  const sprite = new CharacterSprite(ch, new THREE.Group(), mapInfo);
  await sprite.rebuild(sprite.graphicKey()); sprite.place(new THREE.Vector3(40, 1.6, 28));
  assert.equal(sprite.spot, null); assert.equal(sprite.group.position.y, 0.25);
  mapInfo.spotOnSolid = () => ({ x: 27.5, z: 17.5, y: 0.5, side: 'top', ground: false });
  sprite.spotX = undefined; sprite.place(new THREE.Vector3(40, 1.6, 28));
  assert.equal(sprite.group.position.y, 0.75, 'existing support units remain metres per tile'); sprite.dispose();
});

test('static props ground the selected short frame instead of the lowest unrelated frame, while wall mounts remain hanging', async t => {
  await environment(t);
  const ch = character('!Map1_b', 4, 4, 2), sprite = new CharacterSprite(ch, new THREE.Group(), { isWall: () => false });
  await sprite.rebuild(sprite.graphicKey()); sprite.place(new THREE.Vector3(40, 1.6, 28));
  assert.equal(sprite.mode, 'stand'); assert.equal(sprite.footDrop, 0, 'the old all-frame margin includes full-height neighbouring props');
  assert.ok(Math.abs(sprite.mesh.position.y + 1.125) < 1e-6, 'the selected 24 empty bottom rows no longer float');
  ch.pattern = 1; sprite.place(new THREE.Vector3(40, 1.6, 28)); assert.equal(sprite.mesh.position.y, 0, 'a full-height selected frame keeps its original base');
  ch.pattern = 2; sprite.mapInfo.spotOnSolid = () => ({ x: 27.5, y: 1, z: 18, side: 'S', ground: false });
  sprite.spotX = undefined; sprite.place(new THREE.Vector3(40, 1.6, 28));
  assert.equal(sprite.mesh.position.y, 0, 'wall pictures must not be shifted down to the ground'); sprite.dispose();
});

test('table frame/page changes rebuild and dispose original geometry without changing event interaction state', async t => {
  await environment(t); const ch = character('!$Map1_c'), sprite = new CharacterSprite(ch, new THREE.Group(), { isWall: () => false });
  await sprite.rebuild(sprite.graphicKey()); const old = sprite.mesh.geometry; let disposed = false; old.addEventListener('dispose', () => { disposed = true; });
  ch.pattern = 0; await sprite.rebuild(sprite.graphicKey()); sprite.place(new THREE.Vector3(40, 1.6, 28));
  assert.equal(disposed, true); assert.equal(sprite.mode, 'stand'); assert.equal(sprite.propGeometry, false);
  assert.ok(sprite.mesh.material.map, 'the original hanging-shackle frame keeps its artwork');
  assert.equal(ch.priorityType, 1); assert.equal(ch.pattern, 0); sprite.dispose();
});

test('empty or unreadable table frames fall back without fabricating artwork', () => {
  assert.equal(characterTableGeometry(null, 0.65, 1.5 / 32), null);
  const frame = characterPropFrame(character('!$Map1_c'), { getContext: () => ({ getImageData: () => { throw new Error('unreadable'); } }) },
    { single: true, fw: 32, fh: 96 });
  assert.equal(frame, null);
});
