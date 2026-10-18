import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CharacterSprite } from '../src/entities/sprites.js';
import { UI } from '../src/ui/ui.js';
import { G } from '../src/core/globals.js';
import { initAssets } from '../src/data/assets.js';
import { $data } from '../src/data/data.js';

function canvas() {
  const context = new Proxy({
    measureText: text => ({ width: String(text).length * 12 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }),
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  return { width: 96, height: 128, getContext: () => context };
}

function environment(t) {
  const before = { map: G.map, input: G.input, ui: G.ui, floorAt: G.floorAt, combat: G.combat, audio: G.audio };
  t.after(() => Object.assign(G, before));
  const system = $data.system;
  $data.system = { currency_unit: '' };
  t.after(() => { $data.system = system; });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: canvas } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete globalThis.document; });
  G.map = { sceneActors: new Set() }; G.combat = null; G.audio = null; G.floorAt = () => 0;
}

const character = name => ({ isEvent: true, id: 1, characterName: name, characterIndex: 0,
  tileId: 0, priorityType: 1, through: false, moveType: 0, acting: false,
  x: 1, y: 2, realX: 1, realY: 2, direction: 2, pattern: 1, opacity: 255,
  page: {}, jumping: () => false });
const mapInfo = { isWall: () => false };

test('corpse graphics lie flat regardless of blocking priority or scene movement', t => {
  environment(t);
  for (const name of ['$Damage1', '!死体', '$骸骨擬態', '$Corpse1', '$DeadBody']) {
    for (const priority of [0, 1, 2]) {
      const ch = { ...character(name), priorityType: priority, acting: true };
      G.map.sceneActors.add(ch.id);
      const sprite = new CharacterSprite(ch, new THREE.Group(), mapInfo);
      assert.equal(sprite.layMode(), 'lie', `${name} at priority ${priority}`);
      assert.equal(ch.priorityType, priority, 'rendering must not alter collision priority');
      assert.equal(ch.through, false);
      sprite.dispose();
    }
  }
});

test('living actors, walking skeletons and doors retain their upright rendering', t => {
  environment(t);
  for (const ch of [character('Actor1'), character('UndeadKnight'),
    { ...character('骸骨'), moveType: 1 }, { ...character('!Door'), priorityType: 0 }]) {
    const sprite = new CharacterSprite(ch, new THREE.Group(), { isWall: () => true });
    assert.equal(sprite.layMode(), 'stand', ch.characterName);
  }
});

test('a corpse mesh stays horizontal from different views and can stand again after revival', async t => {
  environment(t);
  const names = ['$Damage1Regression', '$AliveRegression'];
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: names.map(n => `Graphics/Characters/${n}.png`) }));
  await initAssets();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class {
    width = 96; height = 128;
    set src(_value) { queueMicrotask(() => this.onload()); }
  } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'Image', descriptor); else delete globalThis.Image; });
  const ch = character(names[0]);
  const sprite = new CharacterSprite(ch, new THREE.Group(), mapInfo);
  await sprite.rebuild(sprite.graphicKey());
  sprite.mesh.geometry.computeBoundingBox();
  const box = sprite.mesh.geometry.boundingBox;
  assert.ok(Math.abs(box.max.y - box.min.y) < 1e-6, 'a body must occupy a horizontal plane');
  const normal = sprite.mesh.geometry.getAttribute('normal');
  assert.ok(normal.getY(0) > 0.99, 'the drawing must face upward');
  sprite.place(new THREE.Vector3(5, 2, 1));
  const row = sprite.mesh.material.map.offset.y;
  sprite.place(new THREE.Vector3(-5, 2, -1));
  assert.equal(sprite.mesh.rotation.y, 0, 'the body must not turn toward the viewer');
  assert.equal(sprite.mesh.material.map.offset.y, row, 'the selected corpse drawing must remain unchanged');
  ch.characterName = names[1];
  await sprite.rebuild(sprite.graphicKey());
  assert.equal(sprite.mode, 'stand');
  assert.ok(sprite.mesh.geometry.getAttribute('normal').getZ(0) > 0.99);
  sprite.dispose();
});

function dialogue(t, choices) {
  environment(t);
  const input = { confirm: () => false, cancel: () => false, navY: () => 0, navX: () => 0, xrPressed: () => false };
  G.input = input;
  const ui = new UI(new THREE.Scene(), new THREE.PerspectiveCamera(), new THREE.Group());
  G.ui = ui;
  ui.pointerRay = () => null;
  ui.msg = { state: 'done-typing', choices, lines: [], position: 2 };
  return { ui, input };
}

test('dialogue initially highlights the first option without selecting it on the opening frame', t => {
  const { ui, input } = dialogue(t, [{ text: 'First', enabled: true }, { text: 'Second', enabled: true }]);
  let selected = null;
  ui.msg.onChoice = index => { selected = index; };
  input.confirm = () => true;
  ui.updateMessage();
  assert.equal(ui.choice.index, 0);
  assert.equal(selected, null, 'opening/advancing a message must not also choose an answer');
  ui.updateMessage();
  assert.equal(selected, 0);
});

test('opening a new choice resets old selection and respects disabled answers', t => {
  const { ui, input } = dialogue(t, [{ text: 'Locked', enabled: false }, { text: 'Allowed', enabled: true }]);
  let selected = null;
  ui.choice.index = 1;
  ui.msg.onChoice = index => { selected = index; };
  ui.updateMessage();
  assert.equal(ui.choice.index, 0);
  input.confirm = () => true;
  ui.updateMessage();
  assert.equal(selected, null);
  input.navY = () => 1;
  ui.updateMessage();
  assert.equal(selected, 1);
});
