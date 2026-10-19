import test from 'node:test';
import assert from 'node:assert/strict';
import { readScripts } from '../src/data/scriptdata.js';

const config = (extra = '') => `module Nana
  STATE_KONJO = 73
  KONJO_DAMAGE = 50000
  KONJO_DAMAGE_PER = false
  KONJO_HP = 2
  KONJO_HP_PER = false
  KONJO_MODE = true
  ${extra}
end`;
function parse(t, sources) {
  t.mock.method(console, 'warn', () => {});
  return readScripts([sources].flat().map(source => ['Synthetic survival settings', source])).guts;
}

test('survival settings come from the installed static module rather than a fixed state ID or HP limit', t => {
  assert.deepEqual(parse(t, config()), {
    stateId: 73, limit: 50000, limitPercent: false, hp: 2, hpPercent: false, canDieAtOne: true,
  });
});

test('survival percentage flags preserve the original distinct numeric and boolean comparisons', t => {
  assert.deepEqual(parse(t, config('KONJO_DAMAGE_PER = 1\nKONJO_HP = 5\nKONJO_HP_PER = true\nKONJO_MODE = false')), {
    stateId: 73, limit: 50000, limitPercent: true, hp: 5, hpPercent: true, canDieAtOne: false,
  });
  assert.equal(parse(t, config('KONJO_DAMAGE_PER = true')).limitPercent, false,
    'the original numeric == 1 comparison does not treat Ruby true as 1');
});

test('commented, unrelated and similarly named modules cannot enable the survival effect', t => {
  assert.equal(parse(t, `# ${config().replaceAll('\n', '\n# ')}\n=begin\n${config()}\n=end`), null);
  assert.equal(parse(t, config().replace('module Nana', 'module NanaExtra')), null);
  assert.equal(parse(t, 'module Nana\nOTHER_SETTING = 1\nend'), null);
  const source = config('STATE_KONJO = 74 # STATE_KONJO = 99');
  assert.equal(parse(t, source).stateId, 74);
});

test('the last installed survival configuration and duplicate literal assignment win', t => {
  assert.equal(parse(t, [config(), config('STATE_KONJO = 81\nKONJO_HP = 3')]).stateId, 81);
  assert.equal(parse(t, [config(), config('STATE_KONJO = 81\nKONJO_HP = 3')]).hp, 3);
});

for (const override of [
  'STATE_KONJO = 0', 'STATE_KONJO = 1.5', 'STATE_KONJO = state_id()',
  'KONJO_DAMAGE = -1', 'KONJO_DAMAGE = 1e999', 'KONJO_DAMAGE = runtime_limit()',
  'KONJO_HP = -1', 'KONJO_HP = hp_floor()', 'KONJO_MODE = runtime_mode()',
  'KONJO_HP_PER = 1', 'KONJO_DAMAGE_PER = runtime_percent()',
  'if runtime_condition\nSTATE_KONJO = 3\nend',
]) test(`unsupported survival setting ${override.split('\n')[0]} cannot reuse stale configuration`, t => {
  assert.equal(parse(t, [config(), config(override)]), null);
});
