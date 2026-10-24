import test from 'node:test';
import assert from 'node:assert/strict';
import { bonfireList, bonfireMap, bonfireShown, bonfirePickable, readScripts } from '../src/data/scriptdata.js';
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

test('selected travel scripts retain original destination indices for preview markers', () => {
  const preview = `${source}\nMAPDATA = 'Travel diagram'\nPLAYER_ICON[1] = [0, 80, 25]\nPLAYER_ICON[2] = [0, 12, 70]`;
  const parsed = readScripts([['Translated travel', preview]]);
  assert.deepEqual(parsed.bonfires, bonfireList(source), 'the existing travel data contract remains unchanged');
  assert.deepEqual(parsed.bonfireMap, { picture: 'Travel diagram',
    players: { 1: { type: 0, x: 80, y: 25 }, 2: { type: 0, x: 12, y: 70 } }, icons: [] });
  const shown = parsed.bonfires.filter(b => bonfireShown(b, id => id === 14));
  assert.equal(shown.length, 1);
  assert.deepEqual(parsed.bonfireMap.players[shown[0].index], { type: 0, x: 80, y: 25 });
  const named = readScripts([['Translated travel', preview], ['篝火移動', `${source}\nMAPDATA='Named diagram'`]]);
  assert.deepEqual(named.bonfireMap, { picture: 'Named diagram', players: {}, icons: [] });
  assert.equal(readScripts([['篝火移動', source]]).bonfireMap, null, 'a missing constant does not invent an artwork name');
});

test('travel previews parse native character, centered square and picture marker forms', () => {
  const parsed = bonfireMap(String.raw`
MAPDATA = "Travel #1"
PLAYER_ICON = [ [0, 11, 22], [1, 30, 40], [2, -4, 8, 'Pin'] ]
PLAYER_ICON [ 9 ] = [1, 12.5, 18, [10, 0, 120, 255]]
ICONLIST = [ [0, 40, 50, 7, 8, 3], [1, 60, 70, 0, 0, [8, 20, 30, 40]], [2, 80, 90, 9, 10, "Marker"] ]
ICONLIST[5] = [1, 100, 110, 0, 0]
ICONLIST[6] = [1, 120, 130, 0, 0, [9, 100]]
`);
  assert.deepEqual(parsed, { picture: 'Travel #1', players: {
    0: { type: 0, x: 11, y: 22 },
    1: { type: 1, x: 30, y: 40, size: 7, color: [0, 0, 0] },
    2: { type: 2, x: -4, y: 8, picture: 'Pin' },
    9: { type: 1, x: 12.5, y: 18, size: 10, color: [0, 120, 255] },
  }, icons: [
    { type: 0, x: 40, y: 50, showSwitch: 7, hideSwitch: 8, actorId: 3 },
    { type: 1, x: 60, y: 70, showSwitch: 0, hideSwitch: 0, size: 8, color: [20, 30, 40] },
    { type: 2, x: 80, y: 90, showSwitch: 9, hideSwitch: 10, picture: 'Marker' },
    { type: 1, x: 100, y: 110, showSwitch: 0, hideSwitch: 0, size: 7, color: [0, 0, 0] },
    { type: 1, x: 120, y: 130, showSwitch: 0, hideSwitch: 0, size: 9, color: [0, 0, 0] },
  ] });
});

test('travel preview literals honor comments, escaped names and resets without parsing quoted code', () => {
  const parsed = bonfireMap(String.raw`
# MAPDATA = 'Commented diagram'
=begin
MAPDATA = 'Block comment'
PLAYER_ICON[1] = [0, 900, 900]
=end
note = "Unrelated text
MAPDATA = 'Inside a string'
PLAYER_ICON[4] = [0, 100, 100]
"
MAPDATA = 'Traveler\'s # diagram' # Keep the hash inside the name.
PLAYER_ICON[9] = [0, 30, 30]
PLAYER_ICON = []
PLAYER_ICON[2] = [2, 12, 15, "Pins/Star\"light"]
ICONLIST[4] = [1, 0, 0, 0, 0]
ICONLIST = []
`);
  assert.deepEqual(parsed, { picture: "Traveler's # diagram", players: {
    2: { type: 2, x: 12, y: 15, picture: 'Pins/Star"light' },
  }, icons: [] });
});

test('invalid or executable preview configuration is bounded and never evaluated', () => {
  for (const value of ['load_picture()', '"left" + "right"', '"#{run_code}"', '"../outside"', '"C:/outside"'])
    assert.equal(bonfireMap(`MAPDATA = ${value}`), null);
  assert.equal(bonfireMap('MAPDATA="valid"\n'.padEnd(2_000_001, ' ')), null);
  const parsed = bonfireMap(String.raw`
MAPDATA = 'Valid'
PLAYER_ICON[0] = [0, 1, 2]
PLAYER_ICON[5000] = [0, 1, 2]
PLAYER_ICON[1] = [0, 1e309, 2]
PLAYER_ICON[2] = [1, 1, 2, [7, 0, 0, 256]]
PLAYER_ICON[3] = [2, 1, 2, "#{dynamic}"]
PLAYER_ICON[4] = [0, 1, call()]
PLAYER_ICON[5] = [[[[[[0]]]]]]
ICONLIST[0] = [0, 1, 2, 0, 0, 0]
ICONLIST[1] = [2, 1, 2, 0, 0, '../../outside']
ICONLIST[2] = [1, 1, 2, -1, 0]
ICONDATA = [2, 1, 2, 'Not a native table']
`);
  assert.deepEqual(parsed, { picture: 'Valid', players: { 0: { type: 0, x: 1, y: 2 } }, icons: [] });
});
