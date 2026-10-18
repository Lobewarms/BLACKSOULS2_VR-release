import test from 'node:test';
import assert from 'node:assert/strict';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { GameState } from '../src/game/state.js';
import { GameEvent } from '../src/entities/character.js';
import { GameMap } from '../src/world/gamemap.js';

globalThis.addEventListener ||= () => {};
const { UI } = await import('../src/ui/ui.js');
const feature = (code, data_id, value = 0) => ({ code, data_id, value });
const stats = [100, 20, 10, 10, 10, 10, 10, 10];
const equipment = (id, changes = {}) => ({ id, name: `Gear ${id}`, note: '', description: '',
  params: Array(8).fill(0), features: [], ...changes });

function environment(t) {
  const previous = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, previous); Object.assign($data, data); });
  Object.assign($data, {
    actors: [null, ...[1, 2, 3].map(id => ({ id, name: `Actor ${id}`, class_id: 1,
      initial_level: 1, equips: [0, 0, 0, 0, 0], note: '', features: [] }))],
    classes: [null, { exp_params: [30, 20, 30, 30], learnings: [], note: '',
      features: [feature(51, 1), feature(52, 1)],
      params: { xsize: 8, ysize: 2, data: new Int16Array([...stats, ...stats]) } }],
    weapons: [null, equipment(1, { wtype_id: 1 }), equipment(2, { wtype_id: 1 })],
    armors: [null, equipment(1, { etype_id: 2, atype_id: 1 }),
      equipment(2, { etype_id: 3, atype_id: 1, features: [feature(54, 2)] }),
      equipment(3, { etype_id: 4, atype_id: 1 }), equipment(4, { etype_id: 1, atype_id: 1 })],
    items: [null, { id: 1, name: 'Synthetic key', note: '' }], states: [], commonEvents: [],
    system: { terms: { params: ['HP', 'MP', 'ATK', 'DEF', 'MAT', 'MDF', 'AGI', 'LUK'], etypes: [] } },
  });
  const sounds = [];
  Object.assign(G, { state: new GameState(), map: null, scripts: {}, coop: null,
    combat: { equipKey: 'before' }, audio: { playSystemSe: id => sounds.push(id) } });
  G.state.party.actors = [1, 2];
  const ui = Object.assign(Object.create(UI.prototype), {
    list: { close() {}, open(title, items, options) { Object.assign(this, { title, items, options }); } },
    grid: { close() {}, open(title, tabs, options) { Object.assign(this, { title, tabs, options }); } },
  });
  return { state: G.state, party: G.state.party, actor: G.state.actor(1), ui, sounds };
}

test('include-equipped loss consumes the bag first without deleting an extra equipped copy', t => {
  const { party, actor } = environment(t);
  actor.equips[0] = { kind: 'weapon', id: 1 }; party.gainItem('weapon', 1, 1);
  party.gainItem('weapon', 1, -1, true);
  assert.equal(party.itemCount('weapon', 1), 0); assert.equal(actor.equips[0].id, 1);
  party.gainItem('weapon', 1, 3); party.gainItem('weapon', 1, -2, true);
  assert.equal(party.itemCount('weapon', 1), 1); assert.equal(actor.equips[0].id, 1);
});

test('include-equipped loss removes precisely the shortage across repeated slots and party members', t => {
  const { state, party, actor } = environment(t), second = state.actor(2), reserve = state.actor(3);
  for (const a of [actor, second, reserve]) for (const slot of [4, 5]) a.equips[slot] = { kind: 'armor', id: 3 };
  party.gainItem('armor', 3, 1); party.gainItem('armor', 3, -4, true);
  assert.deepEqual([actor.equips[4].id, actor.equips[5].id, second.equips[4].id, second.equips[5].id], [0, 0, 0, 3]);
  assert.deepEqual([reserve.equips[4].id, reserve.equips[5].id], [3, 3], 'actors outside the party are untouched');
  party.gainItem('armor', 3, -99, true);
  assert.equal(second.equips[5].id, 0); assert.equal(party.itemCount('armor', 3), 0);
});

test('ordinary inventory loss never takes equipped copies or another equipment kind', t => {
  const { party, actor } = environment(t);
  actor.equips[0] = { kind: 'weapon', id: 1 }; actor.equips[2] = { kind: 'armor', id: 1 };
  party.gainItem('weapon', 1, -99);
  assert.equal(actor.equips[0].id, 1);
  party.gainItem('weapon', 1, -1, true);
  assert.equal(actor.equips[0].id, 0); assert.equal(actor.equips[2].id, 1);
});

test('item gain and loss refresh actual inventory-gated event pages before another event can start', t => {
  const { party } = environment(t), map = G.map = new GameMap(); map.mapId = 5; map.loading = true;
  G.combat = null;
  const page = { condition: {}, graphic: { tile_id: 0, character_name: '', direction: 2, pattern: 1 },
    move_type: 0, move_speed: 3, move_frequency: 3, priority_type: 1, trigger: 0,
    list: [{ code: 0, indent: 0, parameters: [] }] };
  const keyPage = { ...page, condition: { item_valid: true, item_id: 1 }, priority_type: 0, through: true };
  const door = new GameEvent(5, { id: 2, x: 1, y: 1, name: 'Key gate', pages: [page, keyPage] });
  map.events[2] = door; map.eventList.push(door); map.loading = false;
  assert.equal(door.page, page);
  party.gainItem('item', 1, 1); map.setupStartingEvent();
  assert.equal(door.page, keyPage); assert.equal(door.through, true);
  party.gainItem('item', 1, -1); map.setupStartingEvent();
  assert.equal(door.page, page); assert.equal(door.priorityType, 1);
});

test('unowned, invalid and wrong-slot equipment changes leave both inventory and equipped gear intact', t => {
  const { party, actor } = environment(t);
  actor.equips[0] = { kind: 'weapon', id: 1 }; party.gainItem('armor', 1, 1);
  const before = JSON.stringify({ equipment: actor.equips, party: party.toJSON() });
  for (const [slot, id] of [[0, 2], [0, 500], [3, 1], [-1, 1], [8, 1], [1.5, 1], [0, -1]]) {
    assert.equal(actor.changeEquipById(slot, id), false);
    assert.equal(JSON.stringify({ equipment: actor.equips, party: party.toJSON() }), before);
  }
});

test('legitimate equipment trades one owned copy for the old gear and clearing returns exactly once', t => {
  const { party, actor } = environment(t);
  actor.equips[0] = { kind: 'weapon', id: 1 }; party.gainItem('weapon', 2, 2);
  assert.equal(actor.changeEquipById(0, 2), true);
  assert.equal(actor.equips[0].id, 2); assert.equal(party.itemCount('weapon', 1), 1); assert.equal(party.itemCount('weapon', 2), 1);
  assert.equal(actor.change_equip_by_id(0, 0), true); assert.equal(party.itemCount('weapon', 2), 2);
  actor.changeEquipById(0, 0); assert.equal(party.itemCount('weapon', 2), 2);
});

test('equipping attire that seals the head releases the headgear and disables its actual menu slot', t => {
  const { party, actor, ui, sounds } = environment(t);
  actor.equips[2] = { kind: 'armor', id: 1 }; party.gainItem('armor', 2, 1);
  assert.equal(actor.changeEquipById(3, 2), true);
  assert.equal(actor.equips[2].id, 0); assert.equal(party.itemCount('armor', 1), 1);
  ui.showEquipSlots(); assert.equal(ui.list.items[2].enabled, false); assert.equal(ui.list.items[3].enabled, true);
  assert.equal(ui.canEquip(actor, 'armor', $data.armors[1], 2), false);
  ui.showEquipChoices(2); assert.deepEqual(sounds, [3]); assert.equal(ui.grid.tabs, undefined);
  actor.changeEquipById(3, 0); assert.equal(ui.canEquip(actor, 'armor', $data.armors[1], 2), true);
});

test('fixed equipment is locked for the player while original event commands may still remove it', t => {
  const { actor, party, ui } = environment(t);
  $data.actors[1].features.push(feature(53, 0)); actor.equips[0] = { kind: 'weapon', id: 1 };
  ui.showEquipSlots(); assert.equal(ui.list.items[0].enabled, false);
  assert.equal(ui.canEquip(actor, 'weapon', $data.weapons[2], 0), false);
  assert.equal(actor.change_equip_by_id(0, 0), true);
  assert.equal(actor.equips[0].id, 0); assert.equal(party.itemCount('weapon', 1), 1);
});

test('equipment release repeats when losing later gear removes an earlier slot permission', t => {
  const { actor, party } = environment(t);
  $data.classes[1].features = [feature(52, 1)];
  $data.armors[5] = equipment(5, { etype_id: 3, atype_id: 1, features: [feature(51, 1)] });
  actor.equips[0] = { kind: 'weapon', id: 1 };
  actor.equips[4] = { kind: 'armor', id: 5 };
  party.gainItem('armor', 1, 1);
  assert.equal(actor.changeEquipById(2, 1), true);
  assert.equal(actor.equips[0].id, 0, 'the later removed item cannot keep an earlier weapon equipped');
  assert.equal(actor.equips[4].id, 0);
  assert.equal(actor.equips[2].id, 1);
  assert.equal(party.itemCount('weapon', 1), 1);
  assert.equal(party.itemCount('armor', 5), 1);
  actor.releaseUnequippableItems();
  assert.equal(party.itemCount('weapon', 1), 1, 'stable passes must not return duplicate copies');
  assert.equal(party.itemCount('armor', 5), 1);
});

test('equipment preview includes automatically released gear without moving items or changing the actor', t => {
  const { actor, party, ui } = environment(t);
  $data.armors[1].params[2] = 10; actor.equips[2] = { kind: 'armor', id: 1 };
  const saved = actor.equips;
  assert.match(ui.paramDelta(actor, 3, 'armor', 2), /ATK −10/);
  assert.equal(actor.equips, saved); assert.equal(actor.equips[2].id, 1);
  assert.equal(party.itemCount('armor', 1), 0); assert.equal(party.itemCount('armor', 2), 0);
});

test('slot type controls second-hand item kind and changing a typed shield slot cannot create a weapon', t => {
  const { actor, party, ui } = environment(t);
  party.gainItem('armor', 4, 1); assert.equal(actor.changeEquipById(1, 4), true);
  $data.actors[1].features.push(feature(55, 1)); party.gainItem('weapon', 2, 1);
  assert.equal(actor.equipSlotType(1), 0); assert.equal(ui.slotEtype(1), 0);
  assert.equal(actor.changeEquipById(1, 2), true);
  assert.deepEqual(actor.equips[1], { kind: 'weapon', id: 2 });
  assert.equal(party.itemCount('armor', 4), 1); assert.equal(party.itemCount('weapon', 2), 0);
  $data.actors[1].features.pop(); party.gainItem('armor', 4, 1);
  assert.equal(actor.changeEquipById(1, 4), true);
  assert.equal(party.itemCount('weapon', 2), 1); assert.deepEqual(actor.equips[1], { kind: 'armor', id: 4 });
});

test('an inventory change while equipment choices are open cannot equip a stale unowned selection', t => {
  const { actor, party, ui, sounds } = environment(t);
  actor.equips[0] = { kind: 'weapon', id: 1 }; party.gainItem('weapon', 2, 1);
  ui.showEquipChoices(0); const select = ui.grid.options.onSelect;
  assert.ok(ui.grid.tabs[0].items.some(item => item.id === 2));
  party.gainItem('weapon', 2, -1); select({ id: 2 });
  assert.equal(actor.equips[0].id, 1); assert.equal(party.itemCount('weapon', 1), 0);
  assert.deepEqual(sounds, [3]); assert.equal(G.combat.equipKey, 'before');
});

test('forced equipment retains original no-trade behavior and saved equipment has no automatic migration', t => {
  const { actor, party } = environment(t);
  actor.forceChangeEquip(0, 'weapon', 2);
  assert.equal(actor.equips[0].id, 2); assert.equal(party.itemCount('weapon', 2), 0);
  actor.forceChangeEquip(2, 'armor', 2);
  assert.equal(actor.equips[2].id, 0, 'a forced wrong-slot item is released without granting inventory');
  assert.equal(party.itemCount('armor', 2), 0);
  actor.equips[2] = { kind: 'armor', id: 2 };
  const saved = JSON.parse(JSON.stringify(G.state.toJSON()));
  assert.deepEqual(GameState.fromJSON(saved).toJSON(), saved, 'loading existing gear is not a destructive migration');
});
