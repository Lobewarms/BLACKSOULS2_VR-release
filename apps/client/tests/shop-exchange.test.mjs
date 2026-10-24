import test from 'node:test';
import assert from 'node:assert/strict';
import { exchangeRequirements, exchangeMax, purchaseQuantityValid } from '../src/game/shop-exchange.js';

function database() {
  const values = new Map([['item:7', { id: 7, name: 'Token' }], ['item:8', { id: 8, name: 'Crystal' }],
    ['weapon:7', { id: 7, name: 'Blade' }], ['armor:7', { id: 7, name: 'Shield' }]]);
  return (kind, id) => values.get(`${kind}:${id}`);
}
const config = { word: 'Trade' };
const parse = (note, settings = config, lookup = database()) => exchangeRequirements({ note }, settings, lookup);

test('inactive exchanges ignore material tags without looking up or charging inventory', () => {
  const lookup = () => assert.fail('inactive shops must not resolve material prices');
  for (const settings of [null, undefined, { active: false, word: 'Trade' }]) {
    const requirements = exchangeRequirements({ note: '<Trade:0,7,-5>' }, settings, lookup);
    assert.deepEqual(requirements, { materials: [], valid: true });
    assert.equal(exchangeMax(requirements, () => assert.fail('no material charge')), Infinity);
  }
});

test('all database material kinds and omitted counts use the configured note keyword and colon forms', () => {
  const lookup = database(), requirements = parse('<Trade:0,7>\n<Trade：1,7,2>\r\n<Trade:2,7,3>', config, lookup);
  assert.equal(requirements.valid, true);
  assert.deepEqual(requirements.materials, [
    { kind: 'item', id: 7, count: 1, data: lookup('item', 7) },
    { kind: 'weapon', id: 7, count: 2, data: lookup('weapon', 7) },
    { kind: 'armor', id: 7, count: 3, data: lookup('armor', 7) },
  ]);
  assert.equal(exchangeMax(requirements, (kind, id) => ({ item: 9, weapon: 7, armor: 8 })[kind] + (id - 7)), 2);
});

test('note keywords are literal, case-sensitive and safe when containing regular-expression syntax', () => {
  const word = 'Trade.[x](a)+?^$|\\';
  const requirements = parse(`<TradeXxa:0,8,99>\n<${word}:0,7,4>\n<trade.[x](a)+?^$|\\:0,8,99>`, { word });
  assert.equal(requirements.valid, true);
  assert.deepEqual(requirements.materials.map(({ kind, id, count }) => ({ kind, id, count })), [{ kind: 'item', id: 7, count: 4 }]);
});

test('each line contributes its first tag, while a later line replaces the same kind and material ID', () => {
  const requirements = parse('<Trade:0,7,2> <Trade:0,8,100>\n<Trade:1,7,3>\n<Trade:0,7,5>');
  assert.equal(requirements.valid, true);
  assert.deepEqual(requirements.materials.map(({ kind, id, count }) => ({ kind, id, count })),
    [{ kind: 'item', id: 7, count: 5 }, { kind: 'weapon', id: 7, count: 3 }]);
  assert.equal(exchangeMax(requirements, kind => kind === 'item' ? 14 : 20), 2,
    'duplicates replace their old price rather than charging both or preserving the first');
});

test('unsupported kinds, absent database objects and invalid material IDs are ignored like original unknown requirements', () => {
  const requirements = parse('<Trade:3,7,2>\n<Trade:0,999,2>\n<Trade:x,7,2>\n<Trade:0,0,2>\n<Trade:0,7x,2>\n<Trade:0,8,3>');
  assert.equal(requirements.valid, true);
  assert.deepEqual(requirements.materials.map(({ kind, id, count }) => ({ kind, id, count })), [{ kind: 'item', id: 8, count: 3 }]);
});

for (const raw of ['0', '-1', '1.5', '1e2', 'x', '5x', '', '+2', 'NaN', 'Infinity', '９', '9007199254740992']) {
  test(`material count ${JSON.stringify(raw)} cannot create a free or negative-cost purchase`, () => {
    const requirements = parse(`<Trade:0,7,${raw}>\n<Trade:0,8,1>`);
    assert.equal(requirements.valid, false);
    assert.equal(exchangeMax(requirements, () => 99), 0);
    assert.equal(purchaseQuantityValid(1, exchangeMax(requirements, () => 99)), false);
  });
}

test('multiple materials limit purchases in the inventory container selected by the caller, without mutating it', () => {
  const requirements = parse('<Trade:0,7,4>\n<Trade:0,8,2>\n<Trade:2,7,3>');
  const bag = new Map([['item:7', 20], ['item:8', 9], ['armor:7', 6]]);
  const kept = new Map([['item:7', 1], ['item:8', 100], ['armor:7', 30]]);
  const originalBag = new Map(bag), originalKept = new Map(kept);
  const count = inventory => (kind, id) => inventory.get(`${kind}:${id}`) || 0;
  assert.equal(exchangeMax(requirements, count(bag)), 2);
  assert.equal(exchangeMax(requirements, count(kept)), 0, 'materials cannot be borrowed from the other container');
  assert.deepEqual(bag, originalBag); assert.deepEqual(kept, originalKept);
  bag.set('armor:7', 15);
  assert.equal(exchangeMax(requirements, count(bag)), 4, 'the next bottleneck is the second material, rounded down');
  bag.delete('item:8');
  assert.equal(exchangeMax(requirements, count(bag)), 0);
});

test('requirements preserve source note/config/database records and resolve prices without hardcoded material IDs', () => {
  const item = Object.freeze({ note: '<Different:0,8,02>' }), settings = Object.freeze({ word: 'Different' });
  const record = Object.freeze({ id: 8, name: 'Original material' });
  const requirements = exchangeRequirements(item, settings, (kind, id) => kind === 'item' && id === 8 ? record : null);
  assert.equal(requirements.valid, true); assert.equal(requirements.materials[0].count, 2);
  assert.equal(requirements.materials[0].data, record);
  assert.equal(item.note, '<Different:0,8,02>'); assert.equal(settings.word, 'Different');
});

test('ordinary gold-only goods impose no material limit, while broken configuration and invalid inventories fail closed', () => {
  for (const item of [null, {}, { note: '' }, { note: '<Unrelated:0,7,3>' }]) {
    const requirements = exchangeRequirements(item, config, database());
    assert.deepEqual(requirements, { materials: [], valid: true });
    assert.equal(exchangeMax(requirements, () => assert.fail('no materials')), Infinity);
  }
  for (const settings of [{}, { word: '' }, { word: 12 }]) assert.equal(exchangeMax(parse('<Trade:0,7,5>', settings), () => 99), 0);
  for (const count of [-1, 1.5, NaN, Infinity, '10', undefined, 9007199254740992]) {
    assert.equal(exchangeMax(parse('<Trade:0,7,5>'), () => count), 0);
  }
  assert.equal(exchangeMax({ valid: true, materials: [{ kind: 'item', id: 7, count: 0 }] }, () => 99), 0);
  assert.equal(exchangeMax(null, () => 99), 0);
});

test('purchase quantities must be positive safe integers within the current material and shop maximum', () => {
  for (const n of [1, 2, 99, Number.MAX_SAFE_INTEGER]) assert.equal(purchaseQuantityValid(n, Infinity), true);
  assert.equal(purchaseQuantityValid(2, 2), true); assert.equal(purchaseQuantityValid(3, 2), false);
  for (const n of [0, -1, 1.5, NaN, Infinity, '2', null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(purchaseQuantityValid(n, Infinity), false);
  }
  for (const max of [0, -1, NaN, '2', undefined]) assert.equal(purchaseQuantityValid(1, max), false);
});
