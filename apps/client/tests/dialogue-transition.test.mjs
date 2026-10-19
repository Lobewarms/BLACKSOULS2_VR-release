import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { Input } from '../src/core/input.js';
import { Interpreter } from '../src/game/interpreter.js';
import { GameMap } from '../src/world/gamemap.js';
import { MapGrid } from '../src/world/mapmesh.js';
import { $data } from '../src/data/data.js';
import { desktopEquipmentHidden } from '../src/combat/desktop-weapon.js';

globalThis.location = { search: '?lang=en' };
globalThis.addEventListener ||= () => {};
const { UI } = await import('../src/ui/ui.js');
const { tr } = await import('../src/ui/i18n.js');
const { CombatSystem } = await import('../src/combat/combat.js');

const command = (code, parameters = [], indent = 0) => ({ code, parameters, indent });
const message = (text, indent = 0) => [command(101, ['', 0, 0, 2], indent), command(401, [text], indent)];
const end = () => command(0);

function canvas() {
  const record = { texts: [] };
  const ctx = new Proxy({
    clearRect() { record.texts = []; },
    fillText(text) { record.texts.push(String(text)); },
    measureText: text => ({ width: String(text).length * (Number.parseFloat(ctx.font) || 28) * 0.55 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  return { width: 0, height: 0, record, getContext: () => ctx };
}

function environment(t) {
  const saved = { ...G }, data = { ...$data };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    Object.assign(G, saved); Object.assign($data, data);
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete globalThis.document;
  });
  const document = { createElement: canvas, hasFocus: () => true };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  $data.system = { currency_unit: 'Souls', terms: { basic: ['Level', 'Lv', 'Health', 'HP', 'Magic', 'MP'] } };
  $data.states = []; $data.commonEvents = []; $data.troops = [null, { id: 1 }]; $data.mapInfos = new Map();
  const actor = { name: 'Grimm', level: 12, hp: 100, mhp: 100, mp: 30, mmp: 50, states: [], buffs: Array(8).fill(0) };
  Object.assign(G, { vr: false, scripts: { fontSize: 19, screen: [640, 480] }, settings: { minimap: true },
    state: { party: { leader: () => actor, gold: 100 }, system: { timer: { working: false } }, sw: () => false, v: () => 0 },
    combat: { stamina: 1, playerDead: false }, coop: null, arena: null, theater: null, audio: null, view: null,
    frame: 1, time: 0,
  });
  let resumes = 0;
  const input = G.input = Object.assign(Object.create(Input.prototype), {
    keys: new Set(), keysPrev: new Set(), mouse: { dx: 0, dy: 0, wheel: 0, buttons: 0, prevButtons: 0 }, mousePresses: 0,
    axes: { left: [0, 0], right: [0, 0] }, btn: { left: [], right: [] }, btnPrev: { left: [], right: [] }, controllers: {},
    pointerLocked: false, desktopLookWanted: true, softLook: true, pointerUiPaused: false, pageFocused: true,
    dom: { style: {}, focus() {}, getBoundingClientRect: () => ({ left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 }) },
    lockPointer() { resumes++; },
  });
  const map = G.map = new GameMap();
  map.mapId = 1;
  map.map = { width: 4, height: 4, display_name: 'A quiet room', data: { data: new Uint16Array(64) } };
  map.grid = new MapGrid(map.map, { flags: { data: new Uint16Array(8192) }, tileset_names: [] });
  Object.assign(map.playerChar, { x: 1, y: 1, realX: 1, realY: 1, fx: 1, fy: 1 });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100);
  camera.position.y = 1.6; scene.add(camera);
  G.player = { headWorld: out => out.copy(camera.position), forward2D: () => ({ x: 0, z: -1 }) };
  const ui = G.ui = new UI(scene, camera, new THREE.Group()); ui.attachHud(null);
  const frames = [];
  // This is the actual application order: map/interpreters run first, the UI
  // can close a message afterwards, then input edges are retired before render.
  const frame = (keys = [], { logic = true } = {}) => {
    input.keys = new Set(keys);
    if (logic) map.update();
    ui.update(1 / 60);
    ui.msgPanel.mesh.updateWorldMatrix(true, false);
    const state = { active: ui.dialogueActive(), busy: ui.messageBusy(), hud: ui.hud.mesh.visible,
      mini: ui.navigation.mini.mesh.visible, backdrop: ui.backdrop.visible, panel: ui.msgPanel.mesh.visible,
      equipmentHidden: desktopEquipmentHidden(ui, map.transferring), pointerPaused: input.pointerUiPaused,
      panelMatrix: ui.msgPanel.mesh.matrixWorld.toArray(), resumes,
      text: ui.msg?.lines.join('\n') || null, messageState: ui.msg?.state || null };
    frames.push(state); input.endFrame(); G.frame++; G.time += 1 / 60;
    return state;
  };
  const until = predicate => {
    for (let i = 0; i < 200; i++) { if (predicate()) return; frame(); }
    assert.fail('dialogue did not reach its expected state');
  };
  const waitInput = () => until(() => ui.msg?.state === 'waitInput');
  return { ui, input, map, actor, frame, frames, until, waitInput, get resumes() { return resumes; } };
}

function conversation(frame, { panel = true, resumes = 0 } = {}) {
  assert.equal(frame.active, true); assert.equal(frame.hud, false); assert.equal(frame.mini, false);
  assert.equal(frame.backdrop, true); assert.equal(frame.equipmentHidden, true); assert.equal(frame.pointerPaused, true);
  assert.equal(frame.resumes, resumes); assert.equal(frame.panel, panel);
}
function exploration(frame) {
  assert.equal(frame.active, false); assert.equal(frame.busy, false); assert.equal(frame.panel, false);
  assert.equal(frame.hud, true); assert.equal(frame.mini, true); assert.equal(frame.backdrop, false);
  assert.equal(frame.equipmentHidden, false); assert.equal(frame.pointerPaused, false);
}

test('desktop speaker focus starts once per real conversation and leaves later pages under manual control', t => {
  const { ui, map, frame, waitInput } = environment(t), calls = [];
  G.player.dialogueCamera = { begin(source) { calls.push(source); }, cancel() {} };
  map.interpreter.setup([...message('The first page.'), ...message('A second page.'), end()]);
  frame(); assert.deepEqual(calls, [map.interpreter]);
  assert.equal(ui.dialogueLookAllowed(), true);
  waitInput(); frame(['Enter']); frame();
  assert.deepEqual(calls, [map.interpreter], 'a new page must not pull the view back after the player looks away');
  waitInput(); frame(); frame(['Enter']); frame();
  assert.equal(ui.dialogueLookAllowed(), false);
  map.interpreter.setup([...message('Another conversation.'), end()]); frame();
  assert.equal(calls.length, 2, 'a fresh event execution can introduce its speaker again');
  G.vr = true; assert.equal(ui.dialogueLookAllowed(), false);
  G.vr = false; ui.menuOpen = true; assert.equal(ui.dialogueLookAllowed(), false);
  ui.menuOpen = false; ui.msg.number = {}; assert.equal(ui.dialogueLookAllowed(), false);
});

test('dragging to look cannot hover a dialogue choice, and the hint occupies the message bottom margin', t => {
  const { ui, input, map, frame } = environment(t);
  map.interpreter.setup([...message('One.\nTwo.\nThree.\nFour.'), end()]); frame();
  const p = ui.msgPanel, hint = tr('오른쪽 버튼을 누른 채 드래그: 둘러보기');
  assert.ok(p.canvas.record.texts.includes(hint));
  const L = ui.messageLayout();
  assert.ok(L.top + 4 * 24 * L.k < p.canvas.height - 36, 'the normal four-line block leaves space above the hint');
  input.pointer = { x: 640, y: 360, seen: true };
  input.dialogueLooking = () => true;
  assert.equal(ui.pointerRay(), null);
  input.dialogueLooking = () => false;
  assert.ok(ui.pointerRay());
});

test('the native dungeon counter updates through the real UI, independently of the minimap setting, and hides at native transitions', t => {
  const { ui, frame } = environment(t);
  let show = true, layer = 8;
  G.scripts.regularWindow = { map: { enabled: true, switchId: 88 }, battle: { enabled: false, switchId: 90 },
    typeVariable: 0, items: { 0: [{ variable: 18, switchId: 88, label: 'Layer:', suffix: '', color: 16 }] } };
  G.state.sw = id => id === 88 && show;
  G.state.v = id => id === 18 ? layer : 0;
  const panel = ui.dungeonStatus.panel;
  frame(); assert.equal(panel.mesh.visible, true); assert.ok(panel.canvas.record.texts.includes('8'));
  const top = mesh => mesh.position.y + mesh.geometry.parameters.height * mesh.scale.y / 2;
  const bottom = mesh => mesh.position.y - mesh.geometry.parameters.height * mesh.scale.y / 2;
  assert.ok(top(panel.mesh) < bottom(ui.navigation.mini.mesh), 'counter sits below the map without covering it');
  layer = 9; frame(); assert.ok(panel.canvas.record.texts.includes('9')); assert.ok(!panel.canvas.record.texts.includes('8'));
  G.settings.minimap = false; frame();
  assert.equal(ui.navigation.mini.mesh.visible, false); assert.equal(panel.mesh.visible, true);
  assert.equal(panel.mesh.parent, ui.camera);
  G.combat.inCombat = true; frame(); assert.equal(panel.mesh.visible, false);
  G.combat.inCombat = false; frame(); assert.equal(panel.mesh.visible, true);
  show = false; frame(); assert.equal(panel.mesh.visible, false);
  show = true; G.vr = true; const wrist = new THREE.Group(); ui.scene.add(wrist); ui.attachHud(wrist); frame();
  assert.equal(panel.mesh.parent, ui.hud.mesh); assert.equal(panel.mesh.visible, true);
  assert.ok(panel.mesh.position.x - panel.widthM / 2 > ui.hud.widthM / 2, 'wrist counter leaves the health panel readable');
  G.combat.playerDead = true; frame(); assert.equal(panel.mesh.visible, false);
});

test('consecutive real event messages never expose the HUD, map, equipment or resumed mouse look between UI and map frames', t => {
  const env = environment(t), { ui, map, frame, waitInput } = env;
  exploration(frame());
  map.interpreter.setup([...message('First complete sentence.'), ...message('Second complete sentence.'), end()]);
  conversation(frame()); waitInput();
  const panelMatrix = env.frames.at(-1).panelMatrix;
  const closed = frame(['Enter']); conversation(closed); assert.equal(closed.busy, false); assert.equal(ui.msg, null);
  assert.deepEqual(closed.panelMatrix, panelMatrix, 'the acknowledged message keeps its screen position while logic catches up');
  const index = map.interpreter.index;
  for (let i = 0; i < 3; i++) {
    const renderOnly = frame(['Enter'], { logic: false }); conversation(renderOnly);
    assert.deepEqual(renderOnly.panelMatrix, panelMatrix);
    assert.equal(map.interpreter.index, index, 'high-refresh renders must not execute or clear the waiting event');
  }
  const second = frame(['Enter']); conversation(second);
  assert.equal(second.text, 'Second complete sentence.'); assert.equal(second.messageState, 'typing');
  assert.equal(ui.msg.reveal, 2, 'the key that closed the first line cannot fast-forward the next message');
  waitInput(); conversation(frame(['Enter']));
  exploration(frame()); assert.equal(env.resumes, 1, 'mouse look resumes once when the event actually ends');
});

test('owned VR dialogue keeps the wrist HUD visible and never applies desktop equipment hiding between messages', t => {
  const env = environment(t), { ui, input, map, frame, waitInput } = env;
  G.vr = true; const wrist = new THREE.Group(); ui.scene.add(wrist); ui.attachHud(wrist);
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), G.combat, {
    weapon: new THREE.Group(), shield: new THREE.Group(), hasShield: true,
  });
  const vrDialogue = state => {
    assert.equal(state.active, true); assert.equal(state.hud, true); assert.equal(state.mini, false);
    assert.equal(state.backdrop, false); assert.equal(state.panel, true); assert.equal(state.pointerPaused, false);
    assert.equal(ui.hudFollow, wrist); assert.equal(env.resumes, 0);
    combat.showArms(); assert.equal(combat.weapon.visible, true); assert.equal(combat.shield.visible, true);
  };
  map.interpreter.setup([...message('The first wrist conversation.'), ...message('The second wrist conversation.'), end()]);
  vrDialogue(frame()); waitInput();
  input.btn.right[4] = true; input.btnPrev.right[4] = false;
  vrDialogue(frame()); assert.equal(ui.msg, null);
  input.btnPrev.right[4] = true; const index = map.interpreter.index;
  for (let i = 0; i < 3; i++) {
    vrDialogue(frame([], { logic: false })); assert.equal(map.interpreter.index, index);
  }
  vrDialogue(frame()); assert.equal(ui.msg.lines[0], 'The second wrist conversation.'); assert.equal(ui.msg.reveal, 2);
  input.btn.right[4] = false; input.btnPrev.right[4] = false; waitInput();
  input.btn.right[4] = true; vrDialogue(frame()); input.btnPrev.right[4] = true;
  const ended = frame(); assert.equal(ended.active, false); assert.equal(ended.hud, true); assert.equal(ended.mini, true);
  assert.equal(ended.panel, false); assert.equal(ended.backdrop, false); assert.equal(env.resumes, 0);
  combat.showArms(); assert.equal(combat.weapon.visible, true); assert.equal(combat.shield.visible, true);
});

test('scripted waits keep dialogue presentation owned while hiding stale text, then restore the next message normally', t => {
  const { ui, map, frame, waitInput } = environment(t);
  map.interpreter.setup([...message('Before a scripted pause.'), command(230, [3]), ...message('After the pause.'), end()]);
  frame(); waitInput(); conversation(frame(['Enter']));
  const pause = frame(); conversation(pause, { panel: false });
  assert.equal(ui.msg, null); assert.equal(map.interpreter.waitMode, ''); assert.ok(map.interpreter.waitCount > 0);
  conversation(frame(), { panel: false }); conversation(frame(), { panel: false });
  conversation(frame()); assert.equal(ui.msg.lines[0], 'After the pause.');
});

test('inline message pauses and first-choice focus require distinct input without flashing presentation', t => {
  const { ui, map, frame, until } = environment(t);
  map.interpreter.setup([...message('Wait here.\\!Now choose.'), command(102, [['Stay', 'Leave'], 0]),
    command(402, [0, 'Stay']), ...message('You stayed.', 1),
    command(402, [1, 'Leave']), ...message('You left.', 1), command(404), end()]);
  frame(); until(() => ui.msg?.state === 'pause');
  conversation(frame()); conversation(frame(['Enter'])); assert.equal(ui.msg.state, 'typing');
  conversation(frame(['Enter'])); assert.equal(ui.msg.skip, false);
  until(() => ui.msg?.state === 'choice');
  assert.equal(ui.choice.index, 0); assert.equal(map.interpreter.branch[0], undefined);
  conversation(frame()); assert.equal(ui.choice.index, 0, 'passive input cannot consume the first answer');
  conversation(frame(['Enter'])); assert.equal(ui.msg, null); assert.equal(map.interpreter.branch[0], 0);
  conversation(frame(['Enter'])); assert.equal(ui.msg.lines[0], 'You stayed.'); assert.equal(ui.msg.reveal, 2);
});

test('a common-event child and its parent share presentation until the whole interpreter tree ends', t => {
  const env = environment(t), { ui, map, frame, waitInput } = env;
  $data.commonEvents[7] = { list: [...message('Inside the common event.'), end()] };
  map.interpreter.setup([...message('Before the common event.'), command(117, [7]), ...message('Back in the parent event.'), end()]);
  frame(); waitInput(); conversation(frame(['Enter']));
  conversation(frame()); assert.equal(ui.msg.lines[0], 'Inside the common event.'); assert.ok(map.interpreter.child instanceof Interpreter);
  waitInput(); conversation(frame(['Enter']));
  conversation(frame()); assert.equal(ui.msg.lines[0], 'Back in the parent event.'); assert.equal(map.interpreter.child, null);
  waitInput(); conversation(frame(['Enter'])); exploration(frame()); assert.equal(env.resumes, 1);
});

test('a real battle wait releases retained dialogue instead of suppressing battle HUD indefinitely', t => {
  const { ui, map, frame, waitInput } = environment(t);
  G.combat.startBattle = () => ({ done: false, result: 0 });
  map.interpreter.setup([...message('Let us fight.'), command(301, [0, 1, true, false]), end()]);
  frame(); waitInput(); conversation(frame(['Enter']));
  exploration(frame()); assert.equal(map.interpreter.waitMode, 'battle'); assert.equal(ui.dialogueActive(), false);
});

test('transfers, death, a replaced map and a reused interpreter cannot retain the previous dialogue presentation', t => {
  const { ui, map, frame, waitInput, actor } = environment(t);
  const hold = () => {
    map.interpreter.setup([...message('Owned by this execution only.'), command(230, [20]), end()]);
    frame(); waitInput(); frame(['Enter']); assert.equal(ui.dialogueActive(), true);
  };
  hold(); map.transferring = true; frame([], { logic: false }); assert.equal(ui.dialogueActive(), false); assert.equal(ui.msgPanel.mesh.visible, false);
  map.transferring = false; hold(); G.combat.playerDead = true; actor.hp = 0;
  frame([], { logic: false }); assert.equal(ui.dialogueActive(), false); assert.equal(ui.msgPanel.mesh.visible, false);
  G.combat.playerDead = false; actor.hp = 100; hold();
  G.map = Object.assign(Object.create(GameMap.prototype), map); frame([], { logic: false });
  assert.equal(ui.dialogueActive(), false); assert.equal(ui.msgPanel.mesh.visible, false); G.map = map;
  hold(); const oldExecution = map.interpreter.executionId;
  map.interpreter.setup([command(230, [20]), end()]); assert.notEqual(map.interpreter.executionId, oldExecution);
  exploration(frame([], { logic: false }));
});

test('source-less messages still close immediately and explicit title cleanup discards retained presentation', t => {
  const { ui, map, frame, waitInput } = environment(t);
  ui.showMessage({ lines: ['A direct UI prompt.'], position: 2 });
  ui.msg.state = 'waitInput'; frame(['Enter']);
  assert.equal(ui.msg, null); assert.equal(ui.dialogueActive(), false); assert.equal(ui.msgPanel.mesh.visible, false);
  map.interpreter.setup([...message('A scene left behind.'), end()]);
  frame(); waitInput(); conversation(frame(['Enter']), { resumes: 1 });
  ui.clearDialoguePresentation(); frame([], { logic: false });
  assert.equal(ui.dialogueActive(), false); assert.equal(ui.msgPanel.mesh.visible, false);
});
