import test from 'node:test';
import assert from 'node:assert/strict';
import { randomTargetCount, usableRepeats } from '../src/combat/usable-counts.js';

test('valid seven- and nine-hit skills retain every authored repeat', () => {
  for (const count of [1, 2, 5, 6, 7, 8, 9, 32, 64]) assert.equal(usableRepeats({ repeats: count }), count);
});

test('malformed repeats default to one and oversized finite integer data is bounded', () => {
  for (const count of [undefined, null, false, true, '7', '', 0, -1, -8, 0.5, 7.5, NaN, Infinity, -Infinity]) {
    assert.equal(usableRepeats({ repeats: count }), 1);
  }
  for (const obj of [undefined, null, {}]) assert.equal(usableRepeats(obj), 1);
  for (const count of [65, 1000, 1e12, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE]) {
    assert.equal(usableRepeats({ repeats: count }), 64);
  }
});

test('only the four random-enemy scopes change the number of selected targets', () => {
  assert.deepEqual([3, 4, 5, 6].map(randomTargetCount), [1, 2, 3, 4]);
  for (const scope of [undefined, null, '4', true, -1, 0, 1, 2, 7, 8, 9, 10, 11, 3.5, NaN, Infinity]) {
    assert.equal(randomTargetCount(scope), 1);
  }
});

test('target selection and repeats stay independent so selecting four targets does not repeat each hit four times again', () => {
  const obj = Object.freeze({ scope: 6, repeats: 9 });
  const targets = Array.from({ length: randomTargetCount(obj.scope) }, (_, id) => ({ id, hits: 0 }));
  for (const target of targets) for (let hit = 0; hit < usableRepeats(obj); hit++) target.hits++;
  assert.deepEqual(targets.map(target => target.hits), [9, 9, 9, 9]);
  assert.equal(targets.reduce((count, target) => count + target.hits, 0), 36);
  assert.equal(obj.repeats, 9);
});
