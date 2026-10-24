import test from 'node:test';
import assert from 'node:assert/strict';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { GameState } from '../src/game/state.js';
import { Interpreter } from '../src/game/interpreter.js';

const command = (code, parameters = [], indent = 0) => ({ code, parameters, indent });
const feature = (code, data_id) => ({ code, data_id, value: 1 });
const gear = (id, changes) => ({ id, note: '', name: `Synthetic gear ${id}`, params: Array(8).fill(0), features: [], ...changes });
const inventory = [['item', 1], ['weapon', 1], ['weapon', 2], ...[1, 2, 3, 4, 5].map(id => ['armor', id])];

function environment(t) {
  const previous = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, previous); Object.assign($data, data); });
  Object.assign($data, {
    actors: [null, ...[1, 2, 3].map(id => ({ id, name: `Synthetic actor ${id}`, class_id: 1, initial_level: 1,
      equips: [0, 0, 0, 0, 0], note: '', features: id === 1 ? [feature(53, 0)] : [] }))],
    classes: [null, { note: '', learnings: [], exp_params: [30, 20, 30, 30], features: [feature(51, 1), feature(52, 1)],
      params: { xsize: 8, ysize: 2, data: new Int16Array([100, 20, 10, 10, 10, 10, 10, 10, 100, 20, 10, 10, 10, 10, 10, 10]) } }],
    weapons: [null, gear(1, { wtype_id: 1 }), gear(2, { wtype_id: 1 })],
    armors: [null, ...[1, 2, 3, 4, 4].map((etype_id, i) => gear(i + 1, { etype_id, atype_id: 1 }))],
    items: [null, { id: 1, note: '', name: 'Synthetic item' }], states: [], system: {}, commonEvents: [],
  });
  Object.assign(G, { state: new GameState(), scripts: {}, coop: null, combat: null, ui: { notifyGain() {} },
    map: { mapId: 1, events: {}, requestRefresh() {} } });
  const errors = t.mock.method(console, 'error', () => {});
  const state = G.state, party = state.party;
  party.actors = [1]; state.actor(1); state.actor(2);
  state.actor(1).equips[0] = { kind: 'weapon', id: 1 };
  state.actor(1).equips[1] = { kind: 'armor', id: 1 };
  state.actor(1).equips[2] = { kind: 'armor', id: 2 };
  state.actor(1).equips[3] = { kind: 'armor', id: 3 };
  for (const slot of [4, 5, 6, 7]) state.actor(1).equips[slot] = { kind: 'armor', id: 4 };
  state.actor(2).equips[0] = { kind: 'weapon', id: 1 };
  party.gainItem('item', 1, 7); party.gainItem('weapon', 1, 2); party.gainItem('armor', 4, 3); party.gainGold(1234);

  // Neutral commands reproduce the authored sequence: remove original gear,
  // store bag counts, clear the bag, use a temporary actor, then restore counts.
  $data.commonEvents[40] = { list: [
    ...[1, 2].flatMap(id => Array.from({ length: 8 }, (_, slot) => command(slot ? 655 : 355, [`$game_actors[${id}].change_equip_by_id(${slot}, 0)`]))),
    ...inventory.map(([kind, id], i) => command(122, [100 + i, 100 + i, 0, 3, ['item', 'weapon', 'armor'].indexOf(kind), id, 0])),
    command(122, [120, 120, 0, 3, 7, 2, 0]), command(0),
  ] };
  $data.commonEvents[41] = { list: [command(125, [1, 0, 999999]),
    ...inventory.map(([kind, id]) => command(126 + ['item', 'weapon', 'armor'].indexOf(kind), [id, 1, 0, 99, true])), command(0)] };
  $data.commonEvents[42] = { list: [command(125, [0, 1, 120]),
    ...inventory.map(([kind, id], i) => command(126 + ['item', 'weapon', 'armor'].indexOf(kind), [id, 0, 1, 100 + i, false])), command(0)] };
  const entry = [command(117, [40]), command(117, [41]), command(129, [3, 0, 1]), command(129, [1, 1, 0]), command(0)];
  const exit = [command(314, [0, 0]), command(117, [42]),
    ...Array.from({ length: 8 }, (_, slot) => command(slot ? 655 : 355, [`$game_actors[3].change_equip_by_id(${slot}, 0)`])),
    command(129, [1, 0, 0]), command(129, [3, 1, 0]), command(0)];
  const run = list => {
    const it = new Interpreter(0, true); it.setup(list);
    for (let frame = 0; frame < 10 && it.running(); frame++) it.update();
    assert.equal(it.running(), false); assert.equal(errors.mock.callCount(), 0, 'the real interpreter must not swallow a script failure');
  };
  const totals = () => Object.fromEntries(inventory.map(([kind, id]) => [kind + ':' + id,
    G.state.party.itemCount(kind, id) + [...G.state.actorMap.values()].reduce((n, actor) => n + actor.equips.filter(e => e.kind === kind && e.id === id).length, 0)]));
  return { state, party, entry, exit, run, totals };
}

test('temporary dungeon death returns original equipment to the bag, without deletion, duplication or automatic re-equipping', t => {
  const { state, party, entry, exit, run, totals } = environment(t);
  const before = totals(), leader = party.leader(); run(entry);
  assert.equal(party.leader().id, 3); assert.equal(party.gold, 0);
  assert.equal(state.actor(1).equips.every(e => !e.id), true); assert.equal(state.actor(2).equips.every(e => !e.id), true);
  assert.equal([...party.items, ...party.weapons, ...party.armors].length, 0);
  state.actor(3).hp = 0; run(exit);
  assert.equal(party.leader(), leader); assert.equal(party.gold, 1234); assert.deepEqual(totals(), before);
  assert.equal(leader.equips.every(e => !e.id), true, 'the original mode restores the gear to inventory, not its previous slots');
  assert.equal(party.itemCount('weapon', 1), 4, 'bag copies and both original equipped copies are conserved');
  assert.equal(party.itemCount('armor', 4), 7, 'repeated accessory slots must all return exactly once');
  assert.equal(state.actor(1).equipChangeOk(0), false, 'authored unequip works even when the player cannot change a fixed slot');
});

test('voluntary temporary-dungeon exit retains earned equipment and repeated runs cannot duplicate the original stash', t => {
  const { entry, exit, run, totals } = environment(t); const before = totals();
  run(entry); const temporary = G.state.party.leader();
  G.state.party.gainItem('weapon', 2, 1); G.state.party.gainItem('armor', 5, 1);
  assert.equal(temporary.changeEquipById(0, 2), true); assert.equal(temporary.changeEquipById(4, 5), true);
  run(exit);
  assert.equal(temporary.equips.every(e => !e.id), true);
  assert.deepEqual(totals(), { ...before, 'weapon:2': 1, 'armor:5': 1 });
  const restored = totals(); run(entry); run(exit);
  assert.deepEqual(totals(), restored, 'a fresh entry records only the currently owned copies');
});

test('saving during the temporary run preserves original actor identity and stored inventory until its death exit', t => {
  const { entry, exit, run, totals } = environment(t), before = totals();
  G.state.actor(1).name = 'Original identity'; G.state.actor(1).level = 7; run(entry);
  const snapshot = JSON.parse(JSON.stringify(G.state.toJSON()));
  G.state = GameState.fromJSON(snapshot); assert.deepEqual(G.state.toJSON(), snapshot, 'loading the run cannot migrate or clear its stash');
  assert.equal(G.state.party.leader().id, 3); G.state.party.leader().hp = 0; run(exit);
  assert.deepEqual(totals(), before); assert.equal(G.state.party.leader().id, 1);
  assert.equal(G.state.party.leader().name, 'Original identity'); assert.equal(G.state.party.leader().level, 7);
});

test('ordinary dungeon death recovery keeps the current actor and loadout because no temporary-inventory commands run', t => {
  const { state, party, run, totals } = environment(t), leader = party.leader(), before = totals();
  const equipped = structuredClone(leader.equips); leader.hp = 0;
  run([command(314, [0, 0]), command(0)]);
  assert.equal(party.leader(), leader); assert.ok(leader.hp > 0);
  assert.deepEqual(leader.equips, equipped); assert.deepEqual(totals(), before);
  assert.equal(state.v(100), 0, 'the original stash is untouched outside the temporary mode');
});
