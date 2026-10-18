import test from 'node:test';
import assert from 'node:assert/strict';
import { G } from '../src/core/globals.js';
import { showManualSaveMenu } from '../src/game/manual-save-menu.js';

globalThis.addEventListener ||= () => {};
const { Interpreter } = await import('../src/game/interpreter.js');
const command = (code, indent, ...parameters) => ({ code, indent, parameters });
const tick = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function environment(t, overrides = {}) {
  const prior = { ui: G.ui, state: G.state, map: G.map, coop: G.coop, openSaveMenu: G.openSaveMenu };
  t.after(() => Object.assign(G, prior));
  const messages = [], notices = [], reopened = [], writes = [];
  const ui = G.ui = {
    menuOpen: false, msg: null,
    list: { visible: false, open(title, items, options) { Object.assign(this, { visible: true, title, items, ...options }); }, close() { this.visible = false; } },
    closeMenu() { this.menuOpen = false; this.list.close(); },
    reopenMain(id) { reopened.push(id); this.menuOpen = true; },
    sceneBusy() { return this.menuOpen; }, messageBusy() { return !!this.msg; },
    showMessage(msg) { this.msg = msg; messages.push(msg); }, toast(message) { notices.push(message); },
  };
  G.state = { system: { saveDisabled: false } };
  G.map = { mapId: 271, events: {}, transferring: false };
  G.coop = { role: '', phantom: false };
  let selected = 1;
  const options = { listSaves: async () => [], saveSlot: async (...args) => { writes.push(args); return true; },
    selectedSlot: () => selected, rememberSlot: n => { selected = n; }, metaDate: () => 'Date', slotDesc: () => 'Description', ...overrides };
  G.openSaveMenu = request => showManualSaveMenu({ ...options, ...request });
  // Synthetic Save -> choice continuation, without distributing original game
  // event data or writing real saves. Consecutive choice merging is separate.
  const interpreter = new Interpreter();
  interpreter.setup([command(352, 0), command(102, 0, ['Skip the Boss Room', 'Leave'], 2), command(402, 0, 0, 'Skip the Boss Room'), command(0, 1),
    command(402, 0, 1, 'Leave'), command(0, 1), command(404, 0), command(0, 0)]);
  const start = () => interpreter.update();
  const select = index => ui.list.onSelect(index, ui.list.items[index]);
  const assertWaiting = () => { interpreter.update(); assert.equal(messages.length, 0, 'the following choice must not overlap saving'); assert.equal(interpreter.waitMode, 'save'); };
  const assertContinued = () => { interpreter.update(); assert.equal(messages.length, 1); assert.deepEqual(ui.msg.choices.map(c => c.text), ['Skip the Boss Room', 'Leave']); };
  return { ui, interpreter, messages, notices, reopened, writes, options, start, select, assertWaiting, assertContinued };
}

test('event Save calls the real global save flow, waits for slot loading, and resumes after cancel', async t => {
  const read = deferred(); const e = environment(t, { listSaves: () => read.promise });
  e.start(); e.assertWaiting(); assert.equal(e.ui.menuOpen, true); assert.equal(e.ui.list.visible, false);
  read.resolve([]); await tick(); e.assertWaiting(); assert.equal(e.ui.list.items.length, 16);
  e.ui.list.onCancel(); await tick();
  assert.equal(e.ui.menuOpen, false); assert.deepEqual(e.reopened, []); assert.deepEqual(e.writes, []);
  e.assertContinued();
});

test('event Save holds through the write and only then continues the original choices', async t => {
  const write = deferred(); let calls = 0;
  const e = environment(t, { saveSlot: (...args) => { assert.deepEqual(args, [1, false, 'vr']); calls++; return write.promise; } });
  e.start(); await tick(); const saving = e.select(0);
  e.assertWaiting(); assert.equal(e.ui.menuOpen, true); assert.equal(e.ui.list.visible, false);
  write.resolve(true); await saving; await tick(); assert.equal(calls, 1); assert.equal(e.ui.menuOpen, false);
  e.assertContinued();
});

test('failed event save allows retry or Back without advancing or reopening the main menu', async t => {
  let calls = 0; const e = environment(t, { saveSlot: async () => ++calls > 1 });
  e.start(); await tick(); await e.select(0); await tick();
  e.assertWaiting(); assert.equal(e.ui.list.visible, true); assert.deepEqual(e.reopened, []);
  await e.select(1); await tick(); assert.equal(calls, 2); e.assertContinued();
});

test('unreadable event slots offer a retry and Back while holding the event', async t => {
  let reads = 0; const e = environment(t, { listSaves: async () => { if (++reads === 1) throw new Error('Synthetic read failure'); return []; } });
  e.start(); await tick(); e.assertWaiting();
  assert.deepEqual(e.ui.list.items.map(item => item.id), ['retry', 'back']); assert.equal(e.notices.length, 1);
  await e.select(0); e.assertWaiting(); assert.equal(e.ui.list.items.length, 16);
  e.ui.list.onCancel(); await tick(); e.assertContinued(); assert.deepEqual(e.reopened, []);
});

test('overwrite cancellation stays in the event save screen and a failed write can be left', async t => {
  const e = environment(t, { listSaves: async () => [{ slot: 1, meta: { map: 'Synthetic room' } }], saveSlot: async () => false });
  e.start(); await tick(); e.select(0); e.assertWaiting();
  assert.deepEqual(e.ui.list.items.map(item => item.id), ['yes', 'no']);
  await e.select(1); e.assertWaiting(); assert.equal(e.ui.list.items.length, 16);
  e.select(0); await e.select(0); await tick(); e.assertWaiting();
  e.ui.list.onCancel(); await tick(); e.assertContinued();
});

test('normal menu Save preserves return-to-main behavior, including listing errors', async t => {
  const e = environment(t);
  await G.openSaveMenu(); assert.equal(e.ui.menuOpen, true); e.ui.list.onCancel();
  assert.deepEqual(e.reopened, ['save']);
  e.options.listSaves = async () => { throw new Error('Synthetic read failure'); };
  await G.openSaveMenu(); assert.deepEqual(e.reopened, ['save', 'save']); assert.equal(e.notices.length, 1);
});

test('an event slot response from a departed map never reopens that map’s save panel', async t => {
  const read = deferred(); const e = environment(t, { listSaves: () => read.promise });
  e.start(); G.map.mapId = 5; e.ui.closeMenu(); read.resolve([]); await tick();
  assert.equal(e.ui.list.visible, false); assert.equal(e.ui.menuOpen, false); assert.equal(e.interpreter.saveRequest.pending, false);
});

test('battle event Save is ignored as in the original interpreter', t => {
  const e = environment(t); let opened = 0; G.openSaveMenu = () => { opened++; };
  e.interpreter.troop = {}; e.start(); assert.equal(opened, 0); assert.equal(e.messages.length, 1);
});

test('boss-skull adjacent choice blocks keep their merged choices and finish Save without selecting a transfer', async t => {
  const e = environment(t);
  e.interpreter.setup([command(102, 0, ['Save'], 0), command(402, 0, 0, 'Save'), command(352, 1), command(0, 1), command(404, 0),
    command(102, 0, ['Skip the Boss Room', 'Leave'], 2), command(402, 0, 0, 'Skip the Boss Room'), command(201, 1, 0, 999, 1, 1, 2, 0),
    command(402, 0, 1, 'Leave'), command(0, 1), command(404, 0), command(0, 0)]);
  e.interpreter.update(); assert.deepEqual(e.ui.msg.choices.map(c => c.text), ['Save', 'Skip the Boss Room', 'Leave']);
  e.ui.msg.onChoice(0); e.ui.msg = null; e.interpreter.update(); await tick();
  assert.equal(e.interpreter.waitMode, 'save'); assert.equal(e.ui.list.visible, true);
  e.ui.list.onCancel(); await tick(); e.interpreter.update();
  assert.equal(e.interpreter.running(), false); assert.equal(e.messages.length, 1); assert.equal(G.map.transferring, false);
});
