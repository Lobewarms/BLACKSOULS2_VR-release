import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { Interpreter } from '../src/game/interpreter.js';
import { sayAt } from '../src/network/coopguard.js';

globalThis.location = { search: '?lang=en' };
globalThis.addEventListener ||= () => {};
const { UI } = await import('../src/ui/ui.js');
const command = (code, parameters = [], indent = 0) => ({ code, parameters, indent });
const sourceName = '受付ゴースト', translatedName = 'Ghost Receptionist';

function environment(t) {
  const saved = { ...G }, data = { ...$data }, document = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => { Object.assign(G, saved); Object.assign($data, data);
    if (document) Object.defineProperty(globalThis, 'document', document); else delete globalThis.document; });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => {
    const record = { texts: [] }, ctx = new Proxy({
      clearRect() { record.texts.length = 0; }, fillText(text) { record.texts.push(String(text)); },
      measureText: text => ({ width: String(text).length * 18 }),
      createLinearGradient: () => ({ addColorStop() {} }),
    }, { get: (object, key) => key in object ? object[key] : () => {} });
    return { width: 0, height: 0, record, getContext: () => ctx };
  } } });
  const actor = { name: sourceName };
  Object.assign(G, { vr: false, time: 0, frame: 1, input: { dom: { getBoundingClientRect: () => ({ width: 1280, height: 720 }) } },
    scripts: { fontSize: 19, screen: [640, 480], names: { RoleFace_0: sourceName, HeroFace: 'Actor[1]', 'シロクマ': 'Polar Bear' },
      nameAliases: { [sourceName]: translatedName, 'Synthetic role': 'Installed role name', constructor: 'Synthetic Constructor' } },
    state: { v: () => 0, sw: () => true, actor: () => actor, party: { actors: [1] } },
    map: { mapId: 276, events: {}, transferring: false }, coop: null, combat: null, theater: null, arena: null });
  $data.system = { currency_unit: 'Souls' }; $data.commonEvents = []; $data.actors = [];
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(75, 1280 / 720, 0.08, 300);
  scene.add(camera); camera.position.y = 1.6;
  const ui = G.ui = new UI(scene, camera, new THREE.Group()); ui.attachHud(null);
  return { ui, actor };
}

test('an original NW name override uses the installed speaker translation and stays translated across reflow', t => {
  const { ui } = environment(t), source = new Interpreter(0, true);
  source.setup([command(108, ['NW名前指定 ' + sourceName]), command(101, ['', 0, 0, 2]),
    command(401, ['Synthetic greeting.']), command(0)]);
  source.update();
  assert.equal(ui.msg.name, translatedName); assert.equal(ui.nextName, null);
  assert.ok(ui.namePanel.canvas.record.texts.includes(translatedName));
  assert.ok(!ui.namePanel.canvas.record.texts.includes(sourceName));
  for (const vr of [false, true, false]) {
    G.vr = vr; ui.layoutMessage(); ui.drawMessage();
    assert.equal(ui.msg.name, translatedName, 'a consumed one-shot override must survive layout changes');
    assert.ok(ui.namePanel.canvas.record.texts.includes(translatedName));
  }
  ui.showMessage({ lines: ['Another speakerless message.'], face: '', position: 2 });
  assert.equal(ui.msg.name, '', 'the previous override must not leak to the next message');
});

test('face/index speaker tables use the same aliases while actor and unknown names remain intact', t => {
  const { ui, actor } = environment(t);
  assert.equal(ui.speakerName({ face: 'RoleFace', faceIndex: 0 }), translatedName);
  assert.equal(ui.speakerName({ face: 'HeroFace', faceIndex: 0 }), actor.name,
    'the player can choose a name that happens to equal an original role');
  ui.nextName = 'Actor[1]'; assert.equal(ui.speakerName({ face: '' }), 'Actor[1]', 'direct overrides do not become actor expressions');
  ui.nextName = 'An unknown proper name'; assert.equal(ui.speakerName({ face: '' }), 'An unknown proper name');
  ui.nextName = 'Synthetic role'; assert.equal(ui.speakerName({ face: '' }), 'Installed role name');
  ui.nextName = 'シロクマ'; assert.equal(ui.speakerName({ face: '' }), 'Polar Bear', 'known literal overrides can reuse a localized face-table label');
  ui.nameWindowEnabled = false; assert.equal(ui.speakerName({ face: 'RoleFace', faceIndex: 0 }), '');
  ui.nextName = sourceName; assert.equal(ui.speakerName({ face: '' }), translatedName, 'explicit overrides retain original enable semantics');
  ui.nextName = 'toString'; assert.equal(ui.speakerName({ face: '' }), 'toString', 'prototype properties are never name aliases');
});

function remoteList() {
  return [command(108, ['NW名前指定 ' + sourceName]), command(101, ['', 0, 0, 2]),
    command(401, ['Synthetic network greeting.']), command(0)];
}

test('co-op accepts only installed translations of recognized speakers and localizes legacy source labels', async t => {
  environment(t);
  const list = remoteList(); $data.commonEvents[971] = { id: 971, name: 'Synthetic message', list };
  for (const name of [sourceName, translatedName]) {
    const msg = await sayAt(['c', 971, 1], { name });
    assert.equal(msg.name, translatedName);
  }
  for (const name of ['Invented host label', 'Installed role name', 'toString']) {
    const msg = await sayAt(['c', 971, 1], { name });
    assert.equal(msg.name, '', 'unrelated aliases or arbitrary host text are not added to the name allowlist');
  }
});

test('co-op preserves validated player names even when a custom name matches an original role', async t => {
  environment(t);
  $data.commonEvents[972] = { id: 972, name: 'Synthetic actor message', list: remoteList() };
  const msg = await sayAt(['c', 972, 1], { name: sourceName, names: { N1: sourceName } });
  assert.equal(msg.name, sourceName);
});
