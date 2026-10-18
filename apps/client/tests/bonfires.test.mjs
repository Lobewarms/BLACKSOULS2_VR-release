import test from 'node:test';
import assert from 'node:assert/strict';
import { bonfireList, bonfireShown, bonfirePickable, readScripts } from '../src/data/scriptdata.js';
import { UI } from '../src/ui/ui.js';
import { G } from '../src/core/globals.js';

const source = String.raw`
class Scene_ShortMove
MOVE_LIST [ 2 ] = [ [ 'Traveler\'s rest', 12, 13, 14 ], [ 20, 3, 4, 6 ] ]
MOVE_LIST[1] = [["Always available"], [10, 1, 2]]
# MOVE_LIST[9] = [["Commented out"], [99, 1, 2]]
EXPLAN [ 2 ] = [ 'First line', "Second line" ]
CALL_COMMON [ 2 ] = [ 4, 5, 0 ]
end`;

test('bonfires parse translated scripts, spacing, quotes, defaults and common events', () => {
  const list = bonfireList(source);
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], { index: 1, name: 'Always available', switchId: 0, selectSw: 0,
    eraseSw: 0, mapId: 10, x: 1, y: 2, dir: 2, desc: ['', ''], commons: [] });
  assert.deepEqual(list[1], { index: 2, name: "Traveler's rest", switchId: 12, selectSw: 13,
    eraseSw: 14, mapId: 20, x: 3, y: 4, dir: 6, desc: ['First line', 'Second line'], commons: [4, 5] });
});

test('renamed script sections load by content, with named sections taking precedence', () => {
  const others = [['Translated names', 'NAME_LIST = {\n"person" => "Person"\n}'],
    ['Translated symbols', 'SYMBOL_SETTING_LIST = {\n7 => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, [12]]\n}']];
  const data = readScripts([['Translated bonfire script', source], ...others]);
  assert.equal(data.bonfires.length, 2);
  assert.equal(data.names.person, 'Person');
  assert.deepEqual(data.symbols[7].blockedRegions, [12]);
  const named = readScripts([['Translated bonfire script', source], ['篝火移動', 'MOVE_LIST[3] = [["Named"], [30, 1, 2]]'], ...others]);
  assert.deepEqual(named.bonfires.map(b => b.index), [3]);
});

test('bonfire visibility and availability follow original switch rules', () => {
  const active = new Set(), sw = id => active.has(id);
  assert.equal(bonfireShown({ switchId: 0 }, sw), true);
  assert.equal(bonfireShown({ switchId: 12 }, sw), false);
  active.add(12);
  assert.equal(bonfireShown({ switchId: 12 }, sw), true);
  assert.equal(bonfireShown({ switchId: 99, eraseSw: 14 }, sw), true);
  active.add(14);
  assert.equal(bonfireShown({ switchId: 12, eraseSw: 14 }, sw), false);
  assert.equal(bonfirePickable({ selectSw: 13 }, sw), false);
  active.add(13);
  assert.equal(bonfirePickable({ selectSw: 13 }, sw), true);
  assert.equal(bonfirePickable({ selectSw: 0 }, sw), true);
});

test('travel menu shows unconditional destinations and disables locked choices', t => {
  const before = { scripts: G.scripts, state: G.state, map: G.map, coop: G.coop };
  t.after(() => Object.assign(G, before));
  G.scripts = { bonfires: bonfireList(source) };
  G.state = { sw: () => false };
  G.coop = null;
  const transfers = [], commons = [];
  G.map = { reserveTransfer: (...args) => transfers.push(args), reserveCommonEvent: id => commons.push(id) };
  let rows, callbacks;
  const ui = { placeRoot() {}, toast() { assert.fail('Destinations should exist'); }, list: {
    open(_title, entries, handlers) { rows = entries; callbacks = handlers; }, close() {},
  } };
  UI.prototype.openBonfireWarp.call(ui);
  assert.deepEqual(rows.map(r => r.enabled), [true, false]);
  assert.equal(rows[0].text, 'Always available');
  callbacks.onSelect(0);
  assert.deepEqual(transfers, [[10, 1, 2, 2, 0]]);
  assert.deepEqual(commons, []);
});
