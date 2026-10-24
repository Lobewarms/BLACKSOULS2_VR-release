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

const rubyText = (data, encoding) => [73, 34, data.length + 5, ...data, 6,
  58, 13, ...Buffer.from('encoding'), 34, encoding.length + 5, ...Buffer.from(encoding)];

test('honors Shift-JIS encoding even when its bytes are also valid UTF-8', () => {
  const wrapped = rubyText([0xc2, 0xa9], 'Windows-31J');
  const value = marshal(91, 7, ...wrapped, 64, 6);
  assert.deepEqual(value, ['ﾂｩ', 'ﾂｩ'], 'object links must refer to the decoded string');
});

test('encoding-wrapped UTF-8 text and binary data keep their original types', () => {
  assert.equal(marshal(...rubyText([0xc2, 0xa9], 'UTF-8')), '©');
  assert.deepEqual(marshal(...rubyText([0xff], 'UTF-8')), Uint8Array.from([0xff]));
});
