import test from 'node:test';
import assert from 'node:assert/strict';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { runRuby, evalRuby } from '../src/game/rubyexpr.js';
globalThis.addEventListener ||= () => {};
const { Interpreter } = await import('../src/game/interpreter.js');
const { CombatSystem } = await import('../src/combat/combat.js');

function environment(t, id = 17, quantity = 3) {
  const prior = { state: G.state, map: G.map, ui: G.ui, audio: G.audio, coop: G.coop };
  const itemsBefore = $data.items;
  t.after(() => { Object.assign(G, prior); $data.items = itemsBefore; });
  const bag = { [id]: quantity }, variables = { 14: 1, 38: 90, 204: 2 }, stats = Array(8).fill(0);
  const actor = { hp: 100, skills: [], add_param: (i, n) => { stats[i] += n; } };
  const party = { leader: () => actor, itemCount: (_kind, i) => bag[i] || 0,
    gain_item: (item, n) => { bag[item.id] = Math.max(0, (bag[item.id] || 0) + n); } };
  G.state = { party, v: i => variables[i] || 0, setV: (i, n) => { variables[i] = n; }, actor: () => actor };
  G.map = { mapId: 1, events: {}, reserved: [], reserveCommonEvent(id) { this.reserved.push(id); } };
  G.ui = { closeMenu() {}, messageBusy: () => false };
  G.audio = null; G.coop = null;
  const item = { __class: 'RPG::Item', id, name: 'Synthetic soul', consumable: false, effects: [{ code: 44, data_id: 221 }] };
  $data.items = []; $data.items[id] = item;
  return { item, bag, variables, stats };
}
const command = (code, indent, ...parameters) => ({ code, indent, parameters });
function soulScript(id, factor) {
  return `$game_party.gain_item($data_items[${id}], -\n$game_variables[204])
actor = $game_actors[$game_variables[14]]
actor.add_param(0, ${10 * factor} * $game_variables[204])
actor.add_param(1, ${5 * factor} * $game_variables[204])
for i in 2..7
  actor.add_param(i, ${factor} * $game_variables[204])
end`;
}

test('item-container queries and Black Soul stat loops consume the selected quantity', t => {
  const { bag, variables, stats } = environment(t);
  assert.equal(evalRuby('$game_party.item_container(RPG::Item)[17]'), 3);
  assert.equal(evalRuby('$game_party.item_container(RPG::Item)[79]'), 0);
  runRuby(soulScript(17, 1));
  assert.equal(bag[17], 1);
  assert.deepEqual(stats, [20, 10, 2, 2, 2, 2, 2, 2]);
  assert.equal(variables[204], 2);
});

test('a common-event item is consumed by its confirmed script exactly once, and cancel changes nothing', t => {
  const { item, bag, variables, stats } = environment(t, 79);
  const combat = Object.create(CombatSystem.prototype);
  combat.battles = [];
  combat.handUse = () => false; combat.applyBuffEffects = () => false;
  assert.equal(combat.useItem(item, 'menu'), true);
  assert.deepEqual(G.map.reserved, [221]);
  assert.equal(bag[79], 3, 'database non-consumable flag defers removal until confirmation');
  let choice = 1;
  G.ui.showMessage = msg => msg.onChoice(choice);
  const list = [command(102, 0, ['Accept', 'Cancel'], 2), command(402, 0, 0, 'Accept'),
    command(355, 1, soulScript(79, 3)), command(122, 1, 38, 38, 2, 0, 60),
    command(402, 0, 1, 'Cancel'), command(404, 0), command(0, 0)];
  const run = () => {
    const interpreter = new Interpreter(); interpreter.setup(list);
    for (let i = 0; i < 10 && interpreter.running(); i++) interpreter.update();
    assert.equal(interpreter.running(), false);
  };
  run();
  assert.equal(bag[79], 3); assert.deepEqual(stats, Array(8).fill(0)); assert.equal(variables[38], 90);
  choice = 0; run();
  assert.equal(bag[79], 1); assert.deepEqual(stats, [60, 30, 6, 6, 6, 6, 6, 6]); assert.equal(variables[38], 30);
});

test('integer Ruby ranges handle exclusive and empty ranges without changing unrelated formulas', t => {
  const { variables } = environment(t);
  runRuby('$game_variables[1] = 0\nfor i in 2...7\n$game_variables[1] += i\nend');
  assert.equal(variables[1], 20);
  runRuby('for i in 7..2\n$game_variables[1] += 100\nend');
  assert.equal(variables[1], 20);
  assert.equal(evalRuby('$game_variables[38] > 70 ? 3 : 6'), 3);
});
