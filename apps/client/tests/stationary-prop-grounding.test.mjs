import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { characterPropProfile } from '../src/entities/character-props.js';
import { CharacterSprite } from '../src/entities/sprites.js';
import { G } from '../src/core/globals.js';

function character(name = '!Other3', index = 2, changes = {}) {
  return { isEvent: true, id: 19, characterName: name, characterIndex: index, tileId: 0,
    direction: 4, pattern: 0, priorityType: 1, through: false, moveType: 0, stepAnime: false,
    x: 2, y: 3, realX: 2, realY: 3, opacity: 255, page: {}, jumping: () => false, ...changes };
}

test('only inspected physical stationary slots gain selected-frame grounding', () => {
  for (const [name, indices] of [['!$vardo', [0]], ['!$パラソル', [0]], ['!Other3', [1, 2, 3, 4]], ['!Map1_a', [1, 3, 5]]]) {
    for (const index of indices) for (const direction of [2, 4, 6, 8]) for (const pattern of [0, 1, 2]) {
      assert.equal(characterPropProfile(character(name, index, { direction, pattern }))?.kind, 'grounded');
    }
  }
  for (const [name, index] of [['!Other3', 0], ['!Other3', 7], ['!Map1_a', 0], ['!Map1_a', 2],
    ['!Map1_a', 7], ['!Flame', 1], ['!_篝火', 2], ['!objtate', 0], ['!Doorh3k', 6], ['!$_kuti', 0], ['!$vardo', 1],
    ['Other3', 2], ['!$Unrelatedvardo', 0]]) assert.equal(characterPropProfile(character(name, index)), null, name + '/' + index);
});

test('new physical profiles leave non-events, tile art, above/below, moving, animated and pass-through pages unchanged', () => {
  for (const changes of [{ isEvent: false }, { tileId: 1 }, { priorityType: 0 }, { priorityType: 2 },
    { moveType: 1 }, { moveType: 2 }, { moveType: 3 }, { stepAnime: true }, { through: true }]) {
    assert.equal(characterPropProfile(character('!Other3', 2, changes)), null, JSON.stringify(changes));
  }
});

test('verified water-ripple rocks stay on the water through animation and lose grounding when changing into moving characters', t => {
  const e = spriteEnvironment(t); G.floorAt = () => -6.675;
  e.ch.characterIndex = 4; e.ch.stepAnime = true; e.sprite.key = e.sprite.graphicKey();
  for (const pattern of [0, 1, 2, 0]) {
    e.ch.pattern = pattern; e.sprite.place(new THREE.Vector3(8, 1.6, 8));
    assert.equal(e.visibleBase(), -6.675);
    assert.equal(e.ch.stepAnime, true, 'the original ripple animation continues');
  }
  for (const changes of [{ characterName: '手_女' }, { moveType: 1 }, { priorityType: 2 }, { through: true }]) {
    assert.equal(characterPropProfile({ ...e.ch, ...changes }), null);
  }
});

test('prior torture tables and grounded profiles retain their existing eligibility', () => {
  assert.deepEqual(characterPropProfile(character('!$Map1_c', 0, { pattern: 1 })), { kind: 'table', height: 0.65 });
  assert.deepEqual(characterPropProfile(character('!Map1_b', 1, { direction: 8 })), { kind: 'table', height: 0.55 });
  for (const index of [0, 1, 4, 6]) assert.deepEqual(characterPropProfile(character('!Map1_b', index)), { kind: 'grounded' });
  assert.deepEqual(characterPropProfile(character('!三角木馬', 0)), { kind: 'grounded' });
  assert.equal(characterPropProfile(character('!Map1_b', 4, { stepAnime: true })), null);
  assert.equal(characterPropProfile(character('!三角木馬', 0, { moveType: 1 })), null);
});

function spriteEnvironment(t, spot = null) {
  const saved = { ...G }; t.after(() => Object.assign(G, saved));
  Object.assign(G, { map: {}, coop: null, combat: null, floorAt: () => 2.4 });
  const ch = character(), parent = new THREE.Group(), mapInfo = { isWall: () => false, spotOnSolid: () => spot };
  const sprite = new CharacterSprite(ch, parent, mapInfo);
  // A 32x64 physical frame ends at row39, while a neighbouring frame reaches59.
  // Those synthetic pixels reproduce a 20px/0.9375m visible gap with the old
  // twelve-frame minimum without embedding any original image or event data.
  sprite.info = { object: true, single: false, fw: 32, fh: 64, sheetW: 384, sheetH: 512 };
  sprite.bodyCanvas = { getContext: () => ({ getImageData(_x, _y, w, h) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 5; y < 40; y++) for (let x = 4; x < 28; x++) data.set([100, 120, 140, 255], (y * w + x) * 4);
    return { data };
  } }) };
  sprite.mode = 'stand'; sprite.key = sprite.graphicKey(); sprite.bodySize = [1.5, 3];
  sprite.footDrop = 4 / 64 * 3; sprite.propProfile = characterPropProfile(ch); sprite.facade = false;
  sprite.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 3).translate(0, 1.5, 0), new THREE.MeshLambertMaterial({ map: new THREE.Texture() }));
  sprite.group.add(sprite.mesh); t.after(() => sprite.dispose());
  return { sprite, ch, visibleBase: () => sprite.group.position.y + sprite.mesh.position.y + 24 / 64 * 3 };
}

test('real CharacterSprite places the inspected selected frame on floor and real top support instead of hovering', t => {
  const e = spriteEnvironment(t); e.sprite.place(new THREE.Vector3(8, 1.6, 8));
  assert.equal(e.visibleBase(), 2.4); assert.equal(e.sprite.mesh.position.y, -1.125);
  assert.equal(e.ch.priorityType, 1); assert.equal(e.ch.through, false, 'presentation never changes original collision');
});

test('grounded props keep original raised/table support rather than being forced down to map ground', t => {
  const e = spriteEnvironment(t, { x: 2.5, z: 3.5, y: 3, side: 'top', ground: false });
  e.sprite.place(new THREE.Vector3(8, 1.6, 8)); assert.equal(e.visibleBase(), 4.5);
  assert.deepEqual(e.ch.viewPos, { x: 3.75, y: 4.5, z: 5.25 });
});

test('freestanding and turning-picture support keeps its authored height and grounding from each view', t => {
  const support = { x: 2.5, z: 3.5, y: 3, side: 'S', ground: false, free: true };
  const e = spriteEnvironment(t, support);
  e.sprite.place(new THREE.Vector3(8, 1.6, 8)); assert.equal(e.visibleBase(), 4.5);
  support.free = false; support.about = [2.5, 3.5];
  for (const viewer of [new THREE.Vector3(8, 1.6, 8), new THREE.Vector3(-8, 1.6, -8)]) {
    e.sprite.place(viewer); assert.equal(e.visibleBase(), 4.5);
    assert.equal(e.ch.viewPos.y, 4.5, 'the original turning support remains the interaction height');
  }
});

test('mounted/facade props preserve authored wall-relative placement and transparent margins', t => {
  const e = spriteEnvironment(t, { x: 2.5, z: 3, y: 3, side: 'S', ground: false });
  e.sprite.place(new THREE.Vector3(8, 1.6, 8)); assert.equal(e.sprite.mesh.position.y, 0);
  e.sprite.mapInfo.spotOnSolid = () => null; e.sprite.spotX = undefined; e.sprite.facade = true;
  e.sprite.place(new THREE.Vector3(8, 1.6, 8)); assert.equal(e.sprite.mesh.position.y, -e.sprite.footDrop);
});

test('same-graphic page changes to animation or movement stop per-frame grounding without stale cached eligibility', t => {
  const e = spriteEnvironment(t); e.sprite.place(new THREE.Vector3(8, 1.6, 8)); assert.equal(e.visibleBase(), 2.4);
  const key = e.sprite.key; e.ch.stepAnime = true; e.sprite.place(new THREE.Vector3(8, 1.6, 8));
  assert.equal(e.sprite.key, key); assert.equal(e.sprite.mesh.position.y, -e.sprite.footDrop);
  e.ch.stepAnime = false; e.ch.moveType = 1; e.sprite.place(new THREE.Vector3(8, 1.6, 8));
  assert.equal(e.sprite.mesh.position.y, -e.sprite.footDrop);
});
