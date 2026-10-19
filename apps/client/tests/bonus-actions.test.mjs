import test from 'node:test';
import assert from 'node:assert/strict';
import { BonusActions } from '../src/combat/bonus-actions.js';

const source = (value, icon_index = 0) => ({ icon_index, features: [{ code: 61, value }] });
function environment(objects = [source(1, 46)], random = () => 0.25) {
  const actor = { id: 1, featureObjects: () => objects };
  const context = { actor, map: { mapId: 1 }, state: {} };
  const manager = new BonusActions({ random });
  return { context, manager, objects, earn() { const ticket = manager.begin(context); return manager.complete(ticket, context); } };
}

test('each actual source rolls independently and retains its original icon, without averaging probabilities', () => {
  const rolls = [0.49, 0.5, 0.09], e = environment([source(0.5, 392), source(0.5, 513), source(0.1, 308)], () => rolls.shift());
  assert.equal(e.earn(), 2); assert.deepEqual(rolls, []);
  assert.deepEqual(e.manager.status(e.context), { count: 2, remaining: 3, duration: 3, icon: 392 });
  assert.equal(e.manager.begin(e.context).bonus, true);
  assert.equal(e.manager.status(e.context).icon, 308);
});

test('a guaranteed source grants one charge; completing the consumed bonus cannot generate another', () => {
  const e = environment(); assert.equal(e.earn(), 1);
  const bonus = e.manager.begin(e.context); assert.equal(bonus.bonus, true);
  assert.equal(e.manager.status(e.context), null);
  assert.equal(e.manager.complete(bonus, e.context), 0);
  assert.equal(e.manager.complete(bonus, e.context), 0);
  assert.equal(e.manager.available(e.context), false);
  assert.equal(e.earn(), 1, 'a later ordinary action can roll again');
});

test('stacked guaranteed sources grant distinct charges and every consumed extra action stays unable to chain', () => {
  const e = environment([source(1, 46), source(1, 308)]); assert.equal(e.earn(), 2);
  for (let n = 0; n < 2; n++) {
    const bonus = e.manager.begin(e.context); assert.equal(bonus.bonus, true);
    assert.equal(e.manager.complete(bonus, e.context), 0);
  }
  assert.equal(e.manager.status(e.context), null);
});

test('an entire action can complete only once, even if many recipients or volley rounds report it', () => {
  const e = environment(), ticket = e.manager.begin(e.context);
  for (let n = 0; n < 12; n++) assert.equal(e.manager.complete(ticket, e.context), n === 0 ? 1 : 0);
  assert.equal(e.manager.status(e.context).count, 1);
});

test('failed targets and ineligible utility actions neither spend an earned charge nor create one', () => {
  const e = environment(), invalid = e.manager.begin(e.context, { eligible: false });
  assert.equal(invalid, null); assert.equal(e.manager.complete(invalid, e.context), 0);
  assert.equal(e.earn(), 1);
  assert.equal(e.manager.begin(e.context, { eligible: false }), null);
  assert.equal(e.manager.status(e.context).count, 1);
});

test('three active seconds expire charges; menu or headset pauses do not use the window', () => {
  const e = environment(); e.earn(); e.manager.update(1, e.context);
  assert.equal(e.manager.status(e.context).remaining, 2);
  e.manager.update(60, e.context, { paused: true }); assert.equal(e.manager.status(e.context).remaining, 2);
  for (const dt of [-1, NaN, Infinity, 0]) e.manager.update(dt, e.context);
  assert.equal(e.manager.status(e.context).remaining, 2);
  e.manager.update(2, e.context); assert.equal(e.manager.status(e.context), null);
});

for (const change of ['actor', 'map', 'mapId', 'state', 'missing']) {
  test(`a ${change} ownership change clears charges and rejects a delayed completion`, () => {
    const e = environment(), normal = e.manager.begin(e.context); e.earn();
    const next = { ...e.context };
    if (change === 'actor') next.actor = { ...next.actor };
    if (change === 'map') next.map = { ...next.map };
    if (change === 'mapId') next.map.mapId++;
    if (change === 'state') next.state = {};
    if (change === 'missing') next.map = null;
    assert.equal(e.manager.status(next), null);
    assert.equal(e.manager.complete(normal, next), 0);
  });
}

test('explicit death/transfer reset cannot let an old action grant into a new lifecycle', () => {
  const e = environment(), old = e.manager.begin(e.context); e.earn();
  e.manager.update(0, e.context, { clear: true });
  assert.equal(e.manager.status(e.context), null); assert.equal(e.manager.complete(old, e.context), 0);
});

test('losing all extra-action traits clears earned charges and invalidates pending rolls', () => {
  const e = environment(), pending = e.manager.begin(e.context); e.earn();
  e.objects.length = 0; assert.equal(e.manager.status(e.context), null);
  e.objects.push(source(1, 392)); assert.equal(e.manager.complete(pending, e.context), 0);
});

test('sources are sampled at action start so gaining a trait during that action cannot roll it retroactively', () => {
  const e = environment([]), pending = e.manager.begin(e.context);
  e.objects.push(source(1, 392)); assert.equal(e.manager.complete(pending, e.context), 0);
  assert.equal(e.earn(), 1);
});

test('zero, negative and malformed chances are ignored, and trait-only actors work without fabricated icons', () => {
  const e = environment([source(0), source(-1), source(NaN), source(Infinity), source('1')]);
  assert.equal(e.earn(), 0); assert.equal(e.manager.status(e.context), null);
  e.context.actor = { id: 2, featuresWith: () => [{ value: 1 }] };
  assert.equal(e.earn(), 1); assert.equal(e.manager.status(e.context).icon, 0);
});
