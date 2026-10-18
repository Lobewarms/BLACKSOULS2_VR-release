import test from 'node:test';
import assert from 'node:assert/strict';
import { MarshalReader, loadMarshal, hashGet, tableGet, bytesToString } from '../src/data/marshal.js';

const marshal = (...body) => loadMarshal(Uint8Array.from([4, 8, ...body]));
test('reads Ruby Marshal primitives used by RPG Maker', () => {
  assert.equal(marshal(48), null);
  assert.equal(marshal(84), true);
  assert.equal(marshal(70), false);
  assert.equal(marshal(105, 0), 0);
  assert.equal(marshal(105, 47), 42);
  assert.equal(marshal(105, 214), -37);
});
test('reads long signed fixnums', () => {
  assert.equal(marshal(105, 2, 0, 1), 256);
  assert.equal(marshal(105, 254, 0, 255), -256);
});
test('reads strings, symbol references and recursive array object links', () => {
  assert.equal(marshal(34, 8, 97, 98, 99), 'abc');
  assert.deepEqual(marshal(91, 7, 58, 8, 102, 111, 111, 59, 0), ['foo', 'foo']);
  const recursive = marshal(91, 6, 64, 0);
  assert.equal(recursive[0], recursive);
});
test('rejects wrong file versions and unsupported tags', () => {
  assert.throws(() => new MarshalReader(Uint8Array.from([4, 7, 48])).load(), /version/);
  assert.throws(() => marshal(63), /[Uu]nknown|[Uu]nsupported/);
});
test('looks up Ruby hash keys with numeric/string compatibility', () => {
  assert.equal(hashGet(new Map([[1, 'one']]), 1), 'one');
  assert.equal(hashGet(new Map([[1, 'one']]), '1'), 'one');
  assert.equal(hashGet(new Map(), 'missing'), undefined);
});
test('table indexing returns zero outside RPG Maker map bounds', () => {
  const table = { xsize: 2, ysize: 2, zsize: 1, data: [10, 20, 30, 40] };
  assert.equal(tableGet(table, 1, 1), 40);
  assert.equal(tableGet(table, -1, 0), 0);
  assert.equal(tableGet(table, 2, 0), 0);
  assert.equal(tableGet(table, 0, 0, 1), 0);
});
test('decodes byte strings without requiring game assets', () => {
  assert.equal(bytesToString(Uint8Array.from([97, 98, 99])), 'abc');
  assert.equal(bytesToString('hello'), 'hello');
  assert.equal(bytesToString(null), '');
});
