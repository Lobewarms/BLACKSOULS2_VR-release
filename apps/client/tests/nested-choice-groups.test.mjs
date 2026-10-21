import test from 'node:test';
import assert from 'node:assert/strict';
import { G } from '../src/core/globals.js';
import { Interpreter } from '../src/game/interpreter.js';
const c = (code, indent = 0, ...parameters) => ({ code, indent, parameters });
const gain = (n, indent = 1) => c(122, indent, 1, 1, 1, 0, n);

function fixture(t) {
  const prior = { ...G }; t.after(() => Object.assign(G, prior));
  const values = {}, prompts = [];
  Object.assign(G, { map: { mapId: 1, events: {}, transferring: false }, coop: null, scripts: {},
    state: { v: n => values[n] || 0, setV: (n, v) => { values[n] = v; } },
    ui: { msg: null, messageBusy() { return !!this.msg; }, showMessage(m) { this.msg = m; prompts.push(m); } } });
  const it = new Interpreter();
  const answer = n => { const msg = G.ui.msg; assert.ok(msg?.choices); G.ui.msg = null; msg.onChoice(n); it.update(); };
  return { it, values, prompts, answer };
}
function nested({ loop = false, attached = false } = {}) {
  return [c(118, 0, 'again'), ...(attached ? [c(101, 0, '', 0, 0, 2), c(401, 0, 'Neutral instruction')] : []),
    c(102, 0, ['First'], 0), c(402, 0, 0), c(102, 1, ['Confirm', 'Decline'], 2), c(402, 1, 0), gain(1, 2),
    c(402, 1, 1), c(404, 1), c(404), c(102, 0, ['Second', 'Leave'], 2), c(402, 0, 0), gain(100),
    c(402, 0, 1), c(115, 1), c(404), ...(loop ? [c(230, 0, 1), c(119, 0, 'again')] : []), c(0)];
}

for (const attached of [false, true]) test(`nested confirmation retains the selected outer merged answer (${attached ? 'message-attached' : 'standalone'})`, t => {
  const e = fixture(t); e.it.setup(nested({ attached })); e.it.update();
  assert.equal(G.ui.msg.choices.length, 3); e.answer(0); assert.equal(G.ui.msg.choices.length, 2); e.answer(0);
  assert.equal(e.it.running(), false); assert.equal(e.prompts.length, 2); assert.equal(e.values[1], 1);
});

test('declining a nested confirmation does not reopen the later outer block', t => {
  const e = fixture(t); e.it.setup(nested()); e.it.update(); e.answer(0); e.answer(-1);
  assert.equal(e.it.running(), false); assert.equal(e.prompts.length, 2); assert.equal(e.values[1] || 0, 0);
});

test('a label loop asks the complete merged menu again after finishing its nested prompt', t => {
  const e = fixture(t); e.it.setup(nested({ loop: true })); e.it.update(); e.answer(0); e.answer(0);
  for (let i = 0; i < 5 && !G.ui.msg; i++) e.it.update();
  assert.equal(e.prompts.length, 3); assert.deepEqual(G.ui.msg.choices.map(x => x.text), ['First', 'Second', 'Leave']);
  e.answer(1); for (let i = 0; i < 5 && !G.ui.msg; i++) e.it.update();
  assert.equal(e.values[1], 101); e.answer(2); assert.equal(e.it.running(), false);
});

test('an old prompt callback cannot overwrite answers after interpreter setup starts a new execution', t => {
  const e = fixture(t); e.it.setup(nested()); e.it.update(); const stale = G.ui.msg;
  G.ui.msg = null; e.it.setup(nested()); e.it.update(); const current = G.ui.msg;
  stale.onChoice(1); assert.equal(e.it.choiceGroups.get(0).results, null);
  assert.equal(G.ui.msg, current); e.answer(2); assert.equal(e.it.running(), false);
});
