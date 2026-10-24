import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
globalThis.location = { search: '?lang=en' }; globalThis.addEventListener ||= () => {};
const { UI } = await import('../src/ui/ui.js');
const { FONT } = await import('../src/ui/fonts.js');
const { $data } = await import('../src/data/data.js');
const { windowTone, tintWindowPixels, setWindowSkin, drawGameWindow } = await import('../src/ui/window-skin.js');
const { readScripts } = await import('../src/data/scriptdata.js');

function environment(t) {
  const saved = { ...G }, system = $data.system, oldDocument = globalThis.document;
  t.after(() => { Object.assign(G, saved); $data.system = system; globalThis.document = oldDocument; setWindowSkin(null); });
  const document = { body: { appendChild(el) { el.parentNode = this; } }, createElement(kind) {
    if (kind !== 'canvas') return { style: {}, focus() { document.activeElement = this; }, blur() { document.activeElement = null; } };
    const canvas = { width: 0, height: 0, calls: [] };
    const ctx = new Proxy({
      clearRect() { canvas.calls = []; }, measureText: text => ({ width: [...String(text)].length * 12 }),
      fillText(text, x, y) { canvas.calls.push({ text, x, y }); },
      drawImage(...args) { canvas.calls.push({ image: args[0], args }); },
      getImageData: () => ({ data: new Uint8ClampedArray([180, 160, 140, 128]) }),
      createLinearGradient: () => ({ addColorStop() {} }),
    }, { get: (o, key) => key in o ? o[key] : () => {} });
    canvas.getContext = () => ctx; return canvas;
  } };
  globalThis.document = document;
  Object.assign(G, { state: { system: {}, v: () => 0 }, map: null, scripts: { screen: [640, 480], fontSize: 19 },
    vr: false, time: 0, frame: 1, coop: null, theater: null, combat: null, arena: null, settings: {}, audio: null,
    input: { controllers: {}, consumeActionEdges() {}, skipHeld: () => false, rmButton: () => false } });
  $data.system = { currency_unit: 'S', window_tone: { red: -40, green: -70, blue: -100, gray: 0 } };
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(); scene.add(camera);
  const ui = G.ui = new UI(scene, camera, new THREE.Group());
  return { ui, document };
}

test('native window tone affects background pixels only, retains alpha/transparency and caches each skin/tone', t => {
  const { document } = environment(t);
  const source = document.createElement('canvas'); source.width = source.height = 128; setWindowSkin(source);
  assert.deepEqual(windowTone(), $data.system.window_tone);
  const pixels = tintWindowPixels(new Uint8ClampedArray([100, 150, 200, 73]), { red: 40, green: -30, blue: -100, gray: 255 });
  assert.deepEqual([...pixels], [124, 124, 124, 73]);
  const target = document.createElement('canvas'), ctx = target.getContext('2d');
  drawGameWindow(ctx, 0, 0, 200, 160, 0.15, 0.4);
  const back = target.calls[0].image; assert.notEqual(back, source); assert.equal(target.calls.at(-1).image, source);
  drawGameWindow(ctx, 0, 0, 200, 160); assert.equal(target.calls.filter(x => x.args?.[1] === 1).at(-1).image, back);
  G.state.system.windowTone = { red: 0, green: 0, blue: 0, gray: 0 };
  drawGameWindow(ctx, 0, 0, 200, 160); assert.equal(target.calls.filter(x => x.args?.[1] === 1).at(-1).image, source);
});

test('a native window-color command invalidates visible menu/profile/HUD caches without changing ownership', t => {
  const { ui } = environment(t); const items = [{ text: 'Unchanged selection', desc: 'First line\nSecond line' }];
  ui.list.open('Synthetic menu', items, {}); ui.lastHud = ui.lastMainOverview = 'cached'; ui.skillProfile.paintKey = 'cached';
  const originalItems = ui.list.items;
  ui.setWindowTone({ red: 12, green: 20, blue: 30, gray: 8 });
  assert.deepEqual(G.state.system.windowTone, { red: 12, green: 20, blue: 30, gray: 8 });
  assert.equal(ui.lastHud, ''); assert.equal(ui.skillProfile.paintKey, null); assert.equal(ui.list.items, originalItems);
  const labels = ui.list.panel.canvas.calls.filter(x => x.text).map(x => x.text);
  assert.ok(labels.includes('First line')); assert.ok(labels.includes('Second line'));
});

test('fonts loaded after early UI construction reach every cached panel controller before the title is shown', t => {
  const { ui } = environment(t), views = [ui.skillsBrowser, ui.skillProfile, ui.bonfireTravel, ui.navigation, ui.dungeonStatus, ui.rewards];
  for (const view of views) view.font = 'Stale font';
  ui.lastHud = 'cached'; ui.refreshFonts();
  for (const view of views) assert.equal(view.font, FONT);
  assert.equal(ui.lastHud, ''); assert.equal(ui.skillProfile.paintKey, null); assert.equal(ui.navigation.dirty, true);
});

test('native menu parsing reads installed oath/location labels and ignores commented substitutes', () => {
  const result = readScripts([['Synthetic', `# add_command('Wrong', :partner)\nadd_command('Native oath', :partner)\nclass Window_Mapname < Window_Base\n def window_width\n return 210\n end\n def window_height\n return 72\n end\n draw_text(0, 0, 100, 24, 'Native place')\nend\n@map_window.x = 430\n@map_window.y = 390`]]);
  assert.equal(result.partnerCommand, 'Native oath');
  assert.deepEqual(result.placeWindow, { label: 'Native place', x: 430, y: 390, w: 210, h: 72 });
});

test('original installed command names keep the seven-command order while party resources stay live', t => {
  const { ui } = environment(t);
  const members = Array.from({ length: 4 }, (_, id) => ({ id: id + 1, name: `Party ${id}`, level: 4, classId: 1,
    hp: 50 + id, mhp: 100, mp: 20, mmp: 30, states: [], buffs: [], equips: [] }));
  G.state.party = { leader: () => members[0], members: () => members, spirits: [], gold: 100 };
  const commands = []; for (const id of [4, 5, 6, 7, 9, 10]) commands[id] = `Native ${id}`;
  $data.system.terms = { commands }; G.scripts.partnerCommand = 'Installed oath';
  ui.showMainMenu();
  assert.deepEqual(ui.list.items.map(row => row.id), ['items', 'skills', 'equip', 'status', 'oath', 'save', 'title']);
  assert.deepEqual(ui.list.items.map(row => row.text), ['Native 4', 'Native 5', 'Native 6', 'Native 7', 'Installed oath', 'Native 9', 'Native 10']);
  assert.equal(ui.menuOverview.canvas.calls.filter(call => /Party \d/.test(call.text || '')).length, 4);
  members[2].hp = 9; ui.paintMainOverview();
  assert.ok(ui.menuOverview.canvas.calls.some(call => call.text === '9 / 100'));
});

test('native scroll text uses authored speed, no-fast and elapsed frames, then releases its original message wait', t => {
  const { ui } = environment(t), msg = { lines: ['FIRST', 'SECOND'], scroll: true, speed: 4, noFast: true, position: 1 };
  ui.showMessage(msg); assert.equal(ui.scrollText.panel.mesh.visible, true); assert.equal(ui.msgPanel.mesh.visible, false);
  assert.equal(ui.scrollText.scroll.offset, -480); assert.equal(ui.messageBusy(), true);
  G.input.skipHeld = () => true;
  ui.updateMessage(1 / 120); ui.updateMessage(1 / 120); assert.equal(ui.scrollText.scroll.offset, -478);
  msg.noFast = false; ui.updateMessage(1 / 60); assert.equal(ui.scrollText.scroll.offset, -453);
  for (let i = 0; i < 100 && ui.msg; i++) ui.updateMessage(0.1);
  assert.equal(ui.msg, null); assert.equal(ui.scrollText.panel.mesh.visible, false); assert.equal(ui.messageBusy(), false);
});

test('scrolling layout retains all lines and local messages supersede remote scrolling without stale restoration', t => {
  const { ui } = environment(t);
  const lines = Array.from({ length: 200 }, (_, i) => `Line ${i}`);
  ui.showRemoteMessage({ lines, scroll: true, speed: 2 }); ui.updateRemote(1 / 60);
  assert.ok(ui.scrollText.scroll.total > 4000); assert.equal(ui.scrollText.panel.canvas.height, 960);
  const remote = ui.remote; ui.showMessage({ lines: ['Local'], face: '', position: 2 });
  assert.equal(ui.scrollText.panel.mesh.visible, false); ui.closeRemoteMessage(); assert.equal(ui.remote, null);
  assert.notEqual(ui.msg, remote); assert.equal(ui.msg.lines[0], 'Local');
});

test('chat keyboard composes Korean within the limit, preserves PC IME, and Enter submits exactly once', async t => {
  const { ui } = environment(t); let edgeFlushes = 0; G.input.consumeActionEdges = () => edgeFlushes++;
  const result = ui.askChat('Chat', 2), keyboard = ui.chatKeyboard;
  keyboard.press('lang'); for (const key of ['g', 'k', 's', 'r', 'm', 'f']) keyboard.press(key);
  assert.equal(keyboard.shown, '한글'); keyboard.press('k'); assert.equal(keyboard.shown, '한글', 'a migrated final cannot exceed the limit');
  keyboard.input.value = '가나'; keyboard.input.oninput({ isComposing: true }); assert.equal(keyboard.shown, '가나');
  keyboard.input.onkeydown({ key: 'Enter', isComposing: true, preventDefault() {}, stopPropagation() {} });
  assert.equal(keyboard.visible, true); keyboard.input.oncompositionend();
  keyboard.input.onkeydown({ key: 'Enter', isComposing: false, preventDefault() {}, stopPropagation() {} });
  assert.equal(await result, '가나'); assert.equal(keyboard.visible, false); assert.equal(ui.sceneOpen, null); assert.equal(edgeFlushes, 1);
});

test('late microphone enumeration cannot replace a later Skills/menu owner', async t => {
  const { ui } = environment(t); let finish;
  ui.menuOpen = true; ui.list.open('Original', [], {});
  G.voice = { devices: () => new Promise(resolve => { finish = resolve; }) }; G.coop = {};
  const request = ui.showChatMenu();
  const rows = [{ text: 'New menu' }]; ui.list.open('Skills', rows, {});
  finish([]); await request; assert.equal(ui.list.items, rows); assert.equal(ui.list.title, 'Skills');
});

test('voice HUD badge follows actual session/microphone state and does not upload unchanged status every frame', async t => {
  const { ui } = environment(t), oldImage = globalThis.Image;
  t.after(() => { globalThis.Image = oldImage; });
  globalThis.Image = class { constructor() { this.width = this.height = 4; } set src(_value) { queueMicrotask(() => this.onload?.()); } };
  G.chat = { on: true }; G.voice = { mode: 'talk', micLive: true, speaking: false };
  ui.drawVoiceBadge(); await Promise.resolve(); ui.drawVoiceBadge();
  assert.equal(ui.voiceBadge.mesh.visible, true); assert.equal(ui.voiceBadge.mesh.parent, ui.hud.mesh);
  const version = ui.voiceBadge.tex.version; ui.drawVoiceBadge(); assert.equal(ui.voiceBadge.tex.version, version);
  G.voice.speaking = true; ui.drawVoiceBadge(); assert.ok(ui.voiceBadge.tex.version > version);
  G.chat.on = false; ui.drawVoiceBadge(); assert.equal(ui.voiceBadge.mesh.visible, false);
});

test('emote chat control reuses the original silence balloon without moving the existing emote slots', async t => {
  const { document } = environment(t), { EmoteRing } = await import('../src/ui/emotes.js');
  const ring = new EmoteRing(), canvas = document.createElement('canvas');
  ring.build({ canvas, cols: 8, rows: 10 });
  const positions = ring.slots.map(slot => slot.mesh.position.clone());
  const chat = ring.chatSlot(); chat.mesh.visible = true; ring.redraw();
  assert.equal(chat.canvas.calls.find(call => call.image)?.image, canvas);
  assert.equal(chat.canvas.calls.find(call => call.image)?.args[2], 7 * 32);
  ring.slots.forEach((slot, index) => assert.deepEqual(slot.mesh.position, positions[index]));
  assert.ok(chat.mesh.position.y < Math.min(...positions.map(point => point.y)));
});

test('VR weapon weight exposes all four native levels, persists each choice and refreshes the held-weapon model', t => {
  const { ui } = environment(t); let saves = 0, updates = 0;
  G.saveSettings = () => saves++;
  G.combat = { weaponLag: { setSway(value) { assert.equal(value, 'Synthetic profile'); updates++; } }, weaponSway: () => 'Synthetic profile' };
  ui.showOptionsMenu(); assert.equal(ui.list.items.some(item => item.id === 'weight'), false);
  G.vr = true; ui.showOptionsMenu();
  assert.equal(ui.list.items.find(item => item.id === 'weight').right, 'Normal');
  for (const level of [3, 0, 1, 2]) {
    const i = ui.list.items.findIndex(item => item.id === 'weight'); ui.list.onSelect(i, ui.list.items[i]);
    assert.equal(G.settings.weaponWeight, level);
  }
  assert.equal(updates, 4); assert.equal(saves, 4);
});
