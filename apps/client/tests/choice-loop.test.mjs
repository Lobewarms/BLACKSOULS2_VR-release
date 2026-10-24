import test from 'node:test';
import assert from 'node:assert/strict';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';

globalThis.addEventListener ||= () => {};
const { Interpreter } = await import('../src/game/interpreter.js');
const cmd = (code, indent = 0, ...parameters) => ({ code, indent, parameters });
const gain = (amount, variable = 86, indent = 1) => cmd(122, indent, variable, variable, 1, 0, amount);
const loopEnd = () => [cmd(230, 0, 1), cmd(119, 0, 'repeat'), cmd(0)];

function environment(t) {
  const prior = { ...G }, commonEvents = $data.commonEvents;
  t.after(() => {
    for (const key of Object.keys(G)) if (!(key in prior)) delete G[key];
    Object.assign(G, prior); $data.commonEvents = commonEvents;
  });
  const variables = {}, switches = {}, messages = [], pictures = [];
  G.state = { v: id => variables[id] || 0, setV: (id, value) => { variables[id] = value; },
    sw: id => !!switches[id], setSw: (id, value) => { switches[id] = value; } };
  G.map = { mapId: 1, events: {}, transferring: false };
  G.ui = { msg: null, messageBusy() { return !!this.msg; }, showMessage(msg) { this.msg = msg; messages.push(msg); } };
  G.screen = { showPicture: parameters => pictures.push(parameters) };
  G.coop = null; G.scripts = {};
  $data.commonEvents = [];
  const interpreter = new Interpreter();
  const start = list => { interpreter.setup(list); interpreter.update(); assert.ok(G.ui.msg); };
  const answer = index => {
    const msg = G.ui.msg;
    assert.ok(msg, 'an answer requires a currently displayed prompt');
    if (index >= 0) assert.notEqual(msg.choices[index]?.enabled, false, 'disabled rows remain unavailable');
    msg.onChoice(index); G.ui.msg = null;
  };
  const nextPrompt = () => {
    const previous = messages.length;
    for (let tick = 0; tick < 12 && messages.length === previous && interpreter.running(); tick++) interpreter.update();
    assert.equal(messages.length, previous + 1, 'returning to a choice must show a fresh prompt instead of replaying an old answer');
    return G.ui.msg;
  };
  return { variables, switches, messages, pictures, interpreter, start, answer, nextPrompt };
}

test('a standalone choice asks again after Jump to Label and only the next answer changes the result', t => {
  const e = environment(t);
  e.start([cmd(118, 0, 'repeat'), cmd(102, 0, ['Gain', 'Leave'], 2), cmd(402, 0, 0), gain(1),
    cmd(402, 0, 1), cmd(115, 1), cmd(404), ...loopEnd()]);
  e.answer(0); e.nextPrompt();
  assert.equal(e.variables[86], 1);
  for (let i = 0; i < 5; i++) e.interpreter.update();
  assert.equal(e.variables[86], 1, 'waiting for another answer never automatically repeats the action');
  e.answer(1); e.interpreter.update();
  assert.equal(e.interpreter.running(), false); assert.equal(e.variables[86], 1);
});

test('consecutive choice blocks still merge, apply one selected branch, and reopen after a label loop', t => {
  const e = environment(t);
  e.start([cmd(118, 0, 'repeat'), cmd(102, 0, ['One'], 0), cmd(402, 0, 0), gain(1), cmd(404),
    cmd(102, 0, ['Two', 'Leave'], 2), cmd(402, 0, 0), gain(2), cmd(402, 0, 1), cmd(115, 1), cmd(404), ...loopEnd()]);
  assert.deepEqual(G.ui.msg.choiceAt, [[0, 0], [1, 0], [1, 1]]);
  e.answer(1); e.nextPrompt(); assert.equal(e.variables[86], 2, 'the earlier merged block is skipped');
  e.answer(0); e.nextPrompt(); assert.equal(e.variables[86], 3, 'the later merged block is skipped on a different answer');
  e.answer(2); e.interpreter.update(); assert.equal(e.interpreter.running(), false);
  assert.equal(e.variables[86], 3); assert.equal(e.messages.length, 3);
});

test('looped merged choices reevaluate hidden and disabled rows without changing branch mappings', t => {
  const e = environment(t); e.variables[9] = 1;
  e.start([cmd(118, 0, 'repeat'), cmd(102, 0, ['One if(s[1])', 'Blocked en(s[2])'], 0),
    cmd(402, 0, 0), gain(1), cmd(402, 0, 1), gain(100), cmd(404),
    cmd(102, 0, ['Two if(v[9] >= 1)', 'Leave'], 2), cmd(402, 0, 0), gain(2), cmd(402, 0, 1), cmd(115, 1), cmd(404), ...loopEnd()]);
  assert.deepEqual(G.ui.msg.choices, [{ text: 'Blocked', enabled: false }, { text: 'Two', enabled: true }, { text: 'Leave', enabled: true }]);
  assert.deepEqual(G.ui.msg.choiceAt, [[0, 1], [1, 0], [1, 1]]);
  e.answer(1); e.switches[1] = true; e.switches[2] = true; e.variables[9] = 0;
  const next = e.nextPrompt(); assert.equal(e.variables[86], 2);
  assert.deepEqual(next.choices, [{ text: 'One', enabled: true }, { text: 'Blocked', enabled: true }, { text: 'Leave', enabled: true }]);
  assert.deepEqual(next.choiceAt, [[0, 0], [0, 1], [1, 1]]);
  e.answer(0); e.nextPrompt(); assert.equal(e.variables[86], 3, 'neither a hidden nor a disabled branch is applied by stale selection');
});

test('dedicated cancellation of a merged choice is consumed once and the next loop asks again', t => {
  const e = environment(t);
  e.start([cmd(118, 0, 'repeat'), cmd(102, 0, ['One'], 0), cmd(402, 0, 0), gain(1), cmd(404),
    cmd(102, 0, ['Two'], 5), cmd(402, 0, 0), gain(2), cmd(403), gain(1, 87), cmd(404), ...loopEnd()]);
  assert.equal(G.ui.msg.cancelable, true);
  e.answer(-1); e.nextPrompt(); assert.equal(e.variables[86] || 0, 0); assert.equal(e.variables[87], 1);
  e.answer(0); e.nextPrompt(); assert.equal(e.variables[86], 1); assert.equal(e.variables[87], 1);
});

test('cancel mapped to an ordinary answer preserves that branch without replaying an earlier selection', t => {
  const e = environment(t);
  e.start([cmd(118, 0, 'repeat'), cmd(102, 0, ['Gain', 'Leave'], 2), cmd(402, 0, 0), gain(1),
    cmd(402, 0, 1), cmd(115, 1), cmd(404), ...loopEnd()]);
  e.answer(0); e.nextPrompt(); e.answer(-1); e.interpreter.update();
  assert.equal(e.interpreter.running(), false); assert.equal(e.variables[86], 1);
});

test('message-attached choices retain their text and reopen on each label-loop visit', t => {
  const e = environment(t);
  e.start([cmd(118, 0, 'repeat'), cmd(101, 0, '', 0, 0, 2), cmd(401, 0, 'Synthetic instruction'),
    cmd(102, 0, ['Gain', 'Leave'], 2), cmd(402, 0, 0), gain(1), cmd(402, 0, 1), cmd(115, 1), cmd(404), ...loopEnd()]);
  e.answer(0); const next = e.nextPrompt();
  assert.deepEqual(next.lines, ['Synthetic instruction']); assert.equal(e.variables[86], 1);
  e.answer(1); e.interpreter.update(); assert.equal(e.interpreter.running(), false);
});

function stageEvent(amount) {
  const picture = stage => cmd(231, 2, stage, `Synthetic stage ${stage}`, 0, 0, 0, 0, 100, 100, 255, 0);
  return { list: [gain(amount, 86, 0), cmd(111, 0, 1, 86, 0, 5, 1), cmd(111, 1, 1, 86, 0, 10, 1),
    picture(3), cmd(411, 1), picture(2), cmd(412, 1), cmd(411), { ...picture(1), indent: 1 }, cmd(412), cmd(0)] };
}

test('choice-driven numeric progress advances once per answer through 0, 5 and 10 with child events', t => {
  const e = environment(t);
  // Synthetic event/asset names exercise the original numeric controller shape
  // without including its dialogue, scene imagery or original event data.
  $data.commonEvents[183] = stageEvent(1); $data.commonEvents[301] = stageEvent(2);
  e.start([cmd(231, 0, 1, 'Synthetic stage 1', 0, 0, 0, 0, 100, 100, 255, 0), cmd(118, 0, 'repeat'),
    cmd(102, 0, ['One', 'Two', 'Leave'], 3), cmd(402, 0, 0), cmd(117, 1, 183),
    cmd(402, 0, 1), cmd(117, 1, 301), cmd(402, 0, 2), cmd(115, 1), cmd(404), ...loopEnd()]);
  assert.equal(e.variables[86] || 0, 0); assert.equal(e.pictures.at(-1)[0], 1);
  for (const [answer, value, stage] of [[0, 1, 1], [0, 2, 1], [0, 3, 1], [1, 5, 2], [1, 7, 2], [1, 9, 2], [0, 10, 3]]) {
    e.answer(answer); e.nextPrompt(); assert.equal(e.variables[86], value); assert.equal(e.pictures.at(-1)[0], stage);
  }
  e.answer(2); e.interpreter.update(); assert.equal(e.interpreter.running(), false); assert.equal(e.variables[86], 10);
});
