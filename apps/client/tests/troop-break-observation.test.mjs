import test from 'node:test';
import { combatMotion } from './helpers/combat-motion.mjs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { BattlerBase } from '../src/game/state.js';

globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');
const command = (code, parameters = [], indent = 0) => ({ code, parameters, indent });
const feature = (code, data_id, value) => ({ code, data_id, value });
const condition = extra => ({ turn_ending: true, turn_valid: false, enemy_valid: false,
  actor_valid: false, switch_valid: false, ...extra });
function observePage(variable, stateId = 8, { before = [], after = [], end = true } = {}) {
  return { span: 1, condition: condition(end ? {} : { turn_ending: false, switch_valid: true, switch_id: 1 }),
    list: [...before, command(111, [5, 0, 1, stateId]),
      command(122, [variable, variable, 1, 0, 1], 1), ...after,
      command(412), command(0)] };
}

class SyntheticBattler extends BattlerBase {
  constructor(enemyId) { super(); this.enemyId = enemyId; this.hp = this.mhp; this.mp = this.mmp; }
  get data() { return $data.enemies[this.enemyId]; }
  paramBase(id) { return this.data.params[id]; }
  featureObjects() { return [this.data, ...super.featureObjects()]; }
  get dead() { return this.isState(1); }
  solo() { return this; }
}

function environment(t) {
  const previous = { ...G }, saved = { ...$data }, random = Math.random;
  t.after(() => { Object.assign(G, previous); Object.assign($data, saved); Math.random = random; });
  Math.random = () => 0.5;
  const params = [1000, 100, 30, 30, 30, 30, 30, 30];
  Object.assign($data, { states: [], enemies: [null,
    { id: 1, note: '', name: 'Synthetic enemy', battler_name: 'Synthetic', params, features: [] },
    { id: 2, note: '', name: 'Synthetic form', battler_name: 'Synthetic form', params, features: [] }],
    skills: [], commonEvents: [], system: { sounds: [] } });
  $data.states[1] = { id: 1, note: '', features: [], restriction: 4 };
  for (const id of [7, 8]) $data.states[id] = { id, note: '', auto_removal_timing: 1,
    min_turns: 2, max_turns: 2, remove_by_restriction: false, restriction: 4,
    features: [feature(23, 6, id === 7 ? 3 : 2)] };
  for (const id of [13, 16]) $data.skills[id] = { id, name: 'Synthetic Break', note: '',
    scope: 1, hit_type: 0, success_rate: 100, animation_id: 0, damage: { type: 0 },
    effects: [{ code: 21, data_id: id === 13 ? 8 : 7, value1: 1 }] };
  const variables = [], switches = []; switches[1] = true;
  const actor = new SyntheticBattler(1);
  const root = new THREE.Group();
  Object.assign(G, { time: 0, vr: false, scripts: {}, settings: { breakRule: 'original' },
    coop: null, theater: null, arena: null, audio: { playSe() {}, playSystemSe() {} },
    screen: {}, input: { haptic() {} }, player: { headWorld: out => out.set(0, 1.6, 0) },
    map: { mapId: 1, playerChar: { fx: 0, fy: 0 } }, ui: { messageBusy: () => false },
    state: { v: id => variables[id] || 0, setV: (id, value) => { variables[id] = value; },
      sw: id => !!switches[id], setSw: (id, value) => { switches[id] = value; },
      actor: () => actor, system: { winCount: 0 },
      party: { leader: () => actor, members: () => [], partyAbility: () => false } } });
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), { ...combatMotion(),
    root, battles: [], enemies: [], symbols: new Map(), puppets: new Map(), sideInterps: [],
    projectiles: [], popups: [], fx: [], fadingMarkers: [], waves: [], hazards: [], detached: [],
    defeated: new Map(), quick: { close() {} }, allies: { reset() {} },
    heldBoss: () => false, dropMarker() {}, hideBlade() {}, groggyRefill() {}, updateDelayed() {},
    cancelReady() {}, cancelHeld() {},
  });
  const battle = (pages = [observePage(1)]) => {
    const b = { troop: { pages }, done: false, time: 0, turnSeen: 0, pageDone: new Set(), enemies: [] };
    const e = { b: new SyntheticBattler(1), memberIndex: 0, hidden: false,
      get alive() { return !this.hidden && !this.b.dead; }, state: 'idle', timer: 0,
      turn: 0, h: 1.6, hr: 0.2, r: 0.4, fx: 0, fy: 0, alertTime: 0, battle: b,
      data: $data.enemies[1], group: new THREE.Group(), drawBar() {}, remove() {}, build: async () => {},
      worldPos: out => out.set(0, 0, 0) };
    b.enemies.push(e); combat.enemies.push(e); combat.battles.push(b);
    return { b, e };
  };
  const flush = b => {
    for (let i = 0; i < 100; i++) {
      combat.updateTroopEvents(b);
      if (!b.turnEndPending && !b.troopInterp?.running()) return;
    }
    assert.fail('the synthetic native end-turn pages did not finish');
  };
  const poll = (b, at = 6) => { b.time = G.time = at; flush(b); };
  const expire = e => combat.enemyAI(e, e.timer + 0.01, { fx: 0, fy: 0 }, 0);
  const hitBreak = (e, stateId = 8) => combat.breakOnHit(e, $data.skills[stateId === 7 ? 16 : 13], new THREE.Vector3());
  return { combat, actor, battle, flush, poll, expire, hitBreak, value: id => variables[id] || 0 };
}

for (const stateId of [7, 8]) for (const at of [0.1, 5.8]) test(`${stateId === 7 ? 'Hard Break' : 'Break'} at ${at}s remains observable once by native end-turn conditions`, t => {
  const x = environment(t), { b, e } = x.battle([observePage(1, stateId)]);
  G.time = at; x.hitBreak(e, stateId);
  assert.equal(e.b.isState(stateId), true);
  assert.equal(e.timer, stateId === 7 ? 3.2 : 2.2);
  if (at < 1) {
    x.expire(e);
    assert.equal(e.b.isState(stateId), false); assert.equal(e.state, 'chase');
    assert.equal(e.b.pdr, 1, 'the actual damage/stagger window has ended normally');
  }
  x.poll(b); assert.equal(x.value(1), 1);
  if (e.state === 'stagger') x.expire(e);
  x.poll(b, 12); assert.equal(x.value(1), 1, 'historical evidence is not counted again next turn');
});

test('the real follow-up recovery clears combat Break immediately but leaves its end-turn observation', t => {
  const x = environment(t), { b, e } = x.battle();
  x.hitBreak(e); x.combat.endStagger(e);
  assert.equal(e.state, 'recover'); assert.equal(e.b.isState(8), false); assert.equal(e.b.pdr, 1);
  x.poll(b); assert.equal(x.value(1), 1);
});

test('ordinary troop pages and unrelated condition callers see only the current state', t => {
  const x = environment(t), { b, e } = x.battle([observePage(1, 8, { end: false }), observePage(2)]);
  x.hitBreak(e); x.expire(e);
  const unrelated = { troop: true, turnEnding: true, battleOwner: b };
  assert.equal(x.combat.enemyCondition(0, 1, 8, unrelated), false);
  x.poll(b); assert.equal(x.value(1), 0); assert.equal(x.value(2), 1);
});

test('all end-turn pages share evidence across an asynchronous wait and a later clock boundary', t => {
  const x = environment(t), { b, e } = x.battle([
    observePage(1, 8, { after: [command(230, [5], 1)] }), observePage(2),
  ]);
  x.hitBreak(e); x.expire(e); b.time = G.time = 6; x.combat.updateTroopEvents(b);
  assert.equal(x.value(1), 1); assert.equal(x.value(2), 0);
  assert.equal(b.troopInterp.running(), true);
  b.time = G.time = 12; x.flush(b);
  assert.equal(x.value(1), 1); assert.equal(x.value(2), 1);
  x.flush(b); assert.equal(x.value(1), 1); assert.equal(x.value(2), 1);
});

test('an unobserved Break arriving during an asynchronous sweep survives for the next turn', t => {
  const x = environment(t), { b, e } = x.battle([observePage(1, 8, { before: [command(230, [5])] })]);
  b.time = G.time = 6; x.combat.updateTroopEvents(b);
  x.hitBreak(e); x.expire(e); x.flush(b);
  assert.equal(x.value(1), 0, 'the current snapshot predates this already-expired Break');
  x.poll(b, 12); assert.equal(x.value(1), 1);
  x.poll(b, 18); assert.equal(x.value(1), 1);
});

test('a new Break actually read during the current sweep is shared by later pages and consumed once', t => {
  const x = environment(t), { b, e } = x.battle([
    observePage(1, 8, { before: [command(230, [2])], after: [command(230, [5], 1)] }), observePage(2),
  ]);
  b.time = G.time = 6; x.combat.updateTroopEvents(b); x.hitBreak(e);
  for (let i = 0; i < 5 && x.value(1) === 0; i++) x.combat.updateTroopEvents(b);
  assert.equal(x.value(1), 1); x.expire(e); x.flush(b);
  assert.equal(x.value(2), 1);
  x.poll(b, 12); assert.equal(x.value(1), 1); assert.equal(x.value(2), 1);
});

test('nested common-event conditions inherit only their own active turn-end page authority', t => {
  const x = environment(t), { b, e } = x.battle([{ span: 1, condition: condition({}),
    list: [command(117, [1]), command(0)] }]);
  $data.commonEvents[1] = { trigger: 0, list: [command(230, [2]),
    command(111, [5, 0, 1, 8]), command(122, [1, 1, 1, 0, 1], 1), command(412), command(0)] };
  x.hitBreak(e); x.expire(e); x.poll(b);
  assert.equal(x.value(1), 1);
});

test('concurrent battles never borrow Break observations from the same member index', t => {
  const x = environment(t), first = x.battle([observePage(1)]), second = x.battle([observePage(2)]);
  x.hitBreak(first.e); x.expire(first.e); x.poll(second.b); x.poll(first.b);
  assert.equal(x.value(1), 1); assert.equal(x.value(2), 0);
});

test('an explicit native state removal cancels only that Break observation', t => {
  const x = environment(t), { b, e } = x.battle([observePage(1, 7), observePage(2, 8)]);
  x.hitBreak(e, 7); x.combat.endStagger(e); x.hitBreak(e, 8); x.combat.endStagger(e);
  x.combat.troopCommand(333, [0, 1, 7], { battleOwner: b });
  x.poll(b); assert.equal(x.value(1), 0); assert.equal(x.value(2), 1);
});

test('a failed native Break roll creates no observed success', t => {
  const x = environment(t), { b, e } = x.battle();
  $data.enemies[1].features = [feature(13, 8, 0)];
  x.hitBreak(e); assert.equal(e.b.isState(8), false); assert.equal(e.state, 'idle');
  x.poll(b); assert.equal(x.value(1), 0);
});

for (const cleanup of ['death', 'transform', 'recover', 'reset', 'battle end']) test(`${cleanup} discards pending and current-sweep Break evidence`, t => {
  const x = environment(t), { b, e } = x.battle([observePage(1, 8, { before: [command(230, [5])] })]);
  x.hitBreak(e); x.expire(e); b.time = G.time = 6; x.combat.updateTroopEvents(b);
  x.hitBreak(e); x.combat.endStagger(e);
  assert.ok(b.turnBreakObservations.get(e)?.has(8)); assert.ok(b.breakObservations.get(e)?.has(8));
  if (cleanup === 'death') x.combat.killEnemy(e);
  if (cleanup === 'transform') x.combat.transformEnemy(e, 2);
  if (cleanup === 'recover') x.combat.troopCommand(334, [0], { battleOwner: b });
  if (cleanup === 'reset') x.combat.reset({ keepState: true });
  if (cleanup === 'battle end') { b.done = true; b.result = 0; x.combat.onBattleEnd(b); }
  assert.equal(b.turnBreakObservations.size, 0); assert.equal(b.breakObservations.size, 0);
  if (cleanup === 'transform' || cleanup === 'recover') { x.flush(b); x.poll(b, 12); assert.equal(x.value(1), 0); }
  if (cleanup === 'reset' || cleanup === 'battle end') assert.equal(x.combat.enemyCondition(0, 1, 8, b.troopInterp), false);
});
