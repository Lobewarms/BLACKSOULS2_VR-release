import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { Input } from '../src/core/input.js';

globalThis.location = { search: '?lang=en' };
globalThis.addEventListener ||= () => {};
const { UI } = await import('../src/ui/ui.js');
const { $data } = await import('../src/data/data.js');
function environment(t, width = 1280, height = 720) {
  const saved = { ...G }, data = $data.system, descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => { Object.assign(G, saved); $data.system = data;
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete globalThis.document; });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => {
    const record = { texts: [] };
    const measure = text => Array.from(String(text)).reduce((sum, c) => sum + (c.charCodeAt(0) > 255 ? 1 : 0.5), 0)
      * (Number(ctx.font?.match?.(/([\d.]+)px/)?.[1]) || 36);
    const ctx = new Proxy({ measureText: s => ({ width: measure(s) }),
      clearRect() { record.texts = []; }, fillText(text, x, y) { record.texts.push({ text, x, y, width: measure(text), font: ctx.font }); },
      createLinearGradient: () => ({ addColorStop() {} }),
    }, { get: (o, k) => k in o ? o[k] : () => {} });
    return { width: 0, height: 0, record, getContext: () => ctx };
  } } });
  $data.system = { currency_unit: 'Souls' };
  Object.assign(G, { vr: false, scripts: { fontSize: 19, screen: [640, 480] }, state: null,
    map: null, combat: null, coop: null, theater: null, arena: null, time: 0, frame: 1 });
  const input = G.input = Object.assign(Object.create(Input.prototype), { keys: new Set(), keysPrev: new Set(),
    mouse: { buttons: 0, prevButtons: 0, wheel: 0 }, mousePresses: 0, pointerLocked: false,
    axes: { left: [0, 0], right: [0, 0] }, btn: { left: [], right: [] }, btnPrev: { left: [], right: [] }, controllers: {},
    dom: { getBoundingClientRect: () => ({ width, height }) },
  });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 100);
  scene.add(camera); camera.position.y = 1.6;
  const ui = G.ui = new UI(scene, camera, new THREE.Group()); ui.attachHud(null);
  return { ui, input, camera, get width() { return width; }, get height() { return height; },
    resize(w, h) { width = w; height = h; camera.aspect = w / h; camera.updateProjectionMatrix(); } };
}
function box(panel, { camera, width, height }) {
  camera.updateWorldMatrix(true, false); panel.mesh.updateWorldMatrix(true, false);
  const points = [-1, 1].flatMap(x => [-1, 1].map(y => panel.mesh.localToWorld(new THREE.Vector3(x * panel.widthM / 2,
    y * panel.heightM / 2, 0)).project(camera)));
  return { left: Math.min(...points.map(p => (p.x + 1) * width / 2)), right: Math.max(...points.map(p => (p.x + 1) * width / 2)),
    top: Math.min(...points.map(p => (1 - p.y) * height / 2)), bottom: Math.max(...points.map(p => (1 - p.y) * height / 2)) };
}
test('short shop choices fit their actual content and stay to the side above bottom-anchored dialogue', t => {
  const env = environment(t), { ui } = env;
  ui.nextName = 'Reception';
  ui.showMessage({ lines: ['What a fine morning we have today.'], choices: [
    { text: 'Buy Medicine' }, { text: 'Kill' }, { text: 'Leave' },
  ], position: 2 });
  ui.msg.state = 'done-typing'; ui.update(0.01);
  const message = box(ui.msgPanel, env), choices = box(ui.choice.panel, env);
  assert.equal(ui.choice.rows, 3); assert.ok(ui.choice.panel.canvas.height < 300, 'three options do not reserve six empty rows');
  assert.ok(ui.choice.panel.canvas.width < 760, 'short options do not reserve a full-width menu');
  assert.ok(choices.left > env.width / 2, 'short shop choices leave the central NPC view clear');
  assert.ok(choices.bottom < message.top);
  assert.ok(message.bottom >= env.height - 46 && message.bottom <= env.height - 39, JSON.stringify(message));
  assert.ok(ui.namePanel.canvas.width < 512, 'speaker names do not reserve a large empty strip');
  assert.equal(ui.choice.index, 0); assert.equal(ui.backdrop.material.opacity, 0.08);
});
test('compact choices keep first, last and disabled mouse targets aligned with their painted rows', t => {
  const { ui, input } = environment(t), selected = [];
  ui.choice.open('', [{ text: 'First' }, { text: 'Disabled', enabled: false }, { text: 'Last' }], { onSelect: index => selected.push(index) });
  const point = row => { ui.choice.panel.hit = () => new THREE.Vector2(0.5,
    1 - (ui.choice.rowTop + ui.choice.rowH * (row + 0.5)) / ui.choice.panel.canvas.height);
    input.mousePresses = 1; ui.choice.update({}); input.endFrame(); ui.pointerTarget = false; };
  point(0); point(1); point(2); assert.deepEqual(selected, [0, 2]);
  assert.ok(ui.choice.panel.canvas.record.texts.some(r => r.text === '03'));
});
test('long choices remain scrollable and PC/VR changes restore the correct canvas without losing selection', t => {
  const { ui } = environment(t);
  const rows = Array.from({ length: 12 }, (_, i) => ({ text: 'A longer option ' + i }));
  ui.choice.open('', rows, { index: 8 }); ui.choice.draw();
  assert.equal(ui.choice.index, 8); assert.equal(ui.choice.rows, 6); assert.ok(ui.choice.scrollbar.geometry);
  G.vr = true; ui.attachHud(new THREE.Group());
  assert.equal(ui.choice.panel.canvas.width, 760); assert.equal(ui.choice.rowTop, 100); assert.equal(ui.choice.index, 8);
  G.vr = false; ui.attachHud(null); assert.equal(ui.choice.rowTop, 24); assert.equal(ui.choice.index, 8);
});
test('dialogue background conventions survive polish and notices cannot move an open conversation', t => {
  const env = environment(t), { ui } = env;
  ui.showMessage({ lines: ['A quiet room.'], background: 2, position: 2 }); ui.update(0.01);
  const before = box(ui.msgPanel, env);
  ui.toast('Not enough MP'); ui.update(0.01);
  assert.deepEqual(box(ui.msgPanel, env), before, 'a peripheral notice must not rescale or recenter dialogue');
  assert.equal(ui.toastPanel.mesh.parent, ui.camera);
  assert.equal(ui.msg.background, 2, 'transparent scripted dialogue remains transparent');
});

const fullAnswers = [
  "I'm going to Alice's home, where I will ask her about the story and decide whether to return to the library tonight.",
  '図書館に戻る前にアリスの家を訪ねて、今日の出来事とこれから向かう場所について詳しく話したいです。もう少しここで待っていてください。',
  '我想先去爱丽丝的家里询问今天发生的事情，然后再决定是否回到图书馆。请把完整的选项显示出来，让我能够知道这个选择的全部含义。',
  'Leave now without asking another question, taking the northern path and returning only after the evening bell has sounded.',
];
const normal = text => String(text).replace(/\s+/gu, ' ').trim();

test('full English and CJK options wrap without ellipsis or lost words and every painted line stays inside its row', t => {
  const { ui } = environment(t);
  ui.showMessage({ lines: ['Where are you going?'], choices: fullAnswers.map(text => ({ text })), position: 2 });
  ui.msg.state = 'done-typing'; ui.update(0.01);
  const choice = ui.choice;
  assert.ok(choice.rowH > 64); assert.equal(choice.index, 0);
  for (let index = 0; index < fullAnswers.length; index++) {
    choice.index = index; choice.draw();
    const row = index - choice.top, top = choice.rowTop + row * choice.rowH;
    const lines = choice.panel.canvas.record.texts.filter(r => r.x === 84 && r.y >= top && r.y < top + choice.rowH);
    const joined = lines.map(r => r.text).join(/\s/u.test(fullAnswers[index]) ? ' ' : '');
    assert.equal(normal(joined), normal(fullAnswers[index]), `all of option ${index + 1} must be painted`);
    assert.ok(lines.every(r => !r.text.includes('…')));
    assert.ok(lines.every(r => r.x + r.width <= choice.panel.canvas.width - 44 - 24));
    assert.ok(lines.every(r => r.y - choice.choiceFont / 2 >= top && r.y + choice.choiceFont / 2 < top + choice.rowH));
  }
});

test('four long answers and a face dialogue remain within wide and narrow viewports at readable projected sizes', t => {
  const env = environment(t), { ui } = env;
  ui.showMessage({ lines: ['What will you do when you leave this place?'], choices: fullAnswers.map(text => ({ text })), position: 2 });
  ui.msg.face = 'SyntheticFace'; ui.msg.faceCanvas = { width: 384, height: 192 };
  ui.msg.state = 'done-typing'; ui.update(0.01);
  for (const [w, h] of [[1280, 720], [1920, 1080], [480, 800], [900, 500], [360, 640]]) {
    env.resize(w, h); ui.update(0.01);
    const message = box(ui.msgPanel, env), choices = box(ui.choice.panel, env);
    assert.ok(choices.left >= 30 && choices.right <= w - 30, JSON.stringify({ w, h, choices }));
    assert.ok(choices.top >= 38 && choices.bottom < message.top, JSON.stringify({ w, h, choices, message }));
    assert.ok(message.bottom <= h - 38);
    const projectedFont = ui.choice.choiceFont * (choices.bottom - choices.top) / ui.choice.panel.canvas.height;
    assert.ok(projectedFont >= 17.5, `option text at ${w}×${h} must remain readable (${projectedFont}px)`);
    assert.ok(ui.choice.rows >= 1 && ui.choice.rows <= 4);
    if (ui.choice.rows < fullAnswers.length) assert.ok(ui.choice.scrollbar.geometry, 'remaining full answers must stay reachable');
  }
});

test('wrapped-row mouse targets cover every line and preserve disabled answers, initial focus, scrolling and Escape', t => {
  const { ui, input } = environment(t, 900, 500), selected = []; let cancelled = 0;
  ui.choice.open('', fullAnswers.map((text, i) => ({ text, enabled: i !== 1 })), {
    index: -1, onSelect: i => selected.push(i), onCancel: () => cancelled++,
  });
  const choice = ui.choice;
  const point = (index, click = true) => {
    choice.scrollTo(index); choice.draw();
    const row = index - choice.top;
    choice.panel.hit = () => new THREE.Vector2(0.4,
      1 - (choice.rowTop + row * choice.rowH + choice.rowH - 18) / choice.panel.canvas.height);
    input.mousePresses = click ? 1 : 0; ui.pointerTarget = false; choice.update({}); input.endFrame();
  };
  point(0, false); assert.equal(choice.index, -1, 'initial passive hover cannot select an answer');
  point(1); assert.deepEqual(selected, [], 'disabled multiline answers cannot run');
  point(2); assert.deepEqual(selected, [2], 'clicking the last line selects its own complete row');
  input.keys.add('Escape'); input.mouse.wheel = 3; choice.update(null); assert.equal(cancelled, 1);
});

test('number input and VR retain their original uniform rows after wrapped PC dialogue', t => {
  const { ui } = environment(t);
  ui.choice.open('', fullAnswers.map(text => ({ text }))); assert.ok(ui.choice.rowH > 64);
  ui.msg = { lines: [], state: 'number', number: { digits: 3, value: 15, range: [0, 200] } };
  ui.drawNumber(); assert.equal(ui.choice.rowH, 64); assert.equal(ui.choice.rowTop, 100); assert.equal(ui.choice.choiceLines, null);
  ui.msg = null; ui.choice.open('', fullAnswers.map(text => ({ text })), { index: 2 });
  G.vr = true; ui.attachHud(new THREE.Group());
  assert.equal(ui.choice.rowH, 64); assert.equal(ui.choice.panel.canvas.width, 760); assert.equal(ui.choice.choiceLines, null);
  assert.equal(ui.choice.index, 2);
  G.vr = false; ui.attachHud(null); assert.ok(ui.choice.rowH > 64); assert.equal(ui.choice.index, 2);
});

test('wide wrapped answers clear a long speaker badge and retain three readable rows plus scrolling at 720p', t => {
  const env = environment(t), { ui } = env;
  const answers = [
    "I'm going to Alice's house to ask about the strange events that happened this morning.",
    'I want to visit the library and speak to the person who knows about this place.',
    'Tell me everything you remember before I decide which path to take this evening.',
    'I would rather stay here a little longer and ask you another question about Alice.',
  ];
  ui.nextName = 'Bunny Girl Mary';
  ui.showMessage({ lines: ['Where are you going?'], choices: answers.map(text => ({ text })), position: 2 });
  ui.msg.skip = true; ui.update(0.01); ui.update(0.01);
  assert.equal(ui.choice.rows, 3); assert.ok(ui.choice.scrollbar.geometry);
  for (const [w, h] of [[1280, 720], [480, 800]]) {
    env.resize(w, h); ui.update(0.01);
    const choices = box(ui.choice.panel, env), name = box(ui.namePanel, env), message = box(ui.msgPanel, env);
    assert.ok(choices.left < name.right, 'the fixture must exercise horizontal badge overlap');
    assert.ok(choices.bottom < name.top - 2, JSON.stringify({ choices, name }));
    assert.ok(choices.top >= 38 && choices.right <= w - 30 && choices.left >= 30);
    assert.ok(message.bottom <= h - 38);
    const projectedFont = ui.choice.choiceFont * (choices.bottom - choices.top) / ui.choice.panel.canvas.height;
    assert.ok(projectedFont >= 17.5);
  }
});

test('explicit line breaks and unbroken translated tokens preserve every character without clipping', t => {
  const { ui } = environment(t), text = 'A complete first line.\n' + '不思議な世界へのとても長い招待状'.repeat(8) + '🙂';
  ui.choice.open('', [{ text }, { text: 'Return' }]);
  const row = ui.choice.panel.canvas.record.texts.filter(r => r.x === 84 && r.y < ui.choice.rowTop + ui.choice.rowH);
  assert.equal(row.map(r => r.text).join('').replace(/\s/gu, ''), text.replace(/\s/gu, ''));
  assert.ok(row.every(r => !r.text.includes('…') && r.x + r.width <= ui.choice.panel.canvas.width - 68));
});
