import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { GameMap } from '../src/world/gamemap.js';

globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');
const command = (code, parameters = [], indent = 0) => ({ code, parameters, indent });
const picture = [1, 'SyntheticMeter', 0, 0, 0, 0, 100, 100, 255, 0];
const tone = { red: 30, green: 0, blue: 0, gray: 0 };

function environment(t, list = [command(0)]) {
  const previous = { ...G }, data = { ...$data }, pictures = [], tones = [];
  t.after(() => { Object.assign(G, previous); Object.assign($data, data); });
  $data.commonEvents = [null, { id: 1, trigger: 0, list }];
  $data.skills = [null, null, { id: 2, effects: [] }];
  Object.assign(G, { time: 1, coop: null, scripts: {}, state: { sw: () => false, party: { leader: () => ({}) } },
    ui: { messageBusy: () => false }, screen: { showPicture: (...args) => pictures.push(args), startTone: (...args) => tones.push(args) },
    player: { headWorld: target => target.set(0, 1.6, 0), floatDown() {} },
  });
  const map = G.map = new GameMap(); map.mapId = 1;
  const enemy = () => ({ alive: true, memberIndex: 0, b: { buffs: [] }, worldPos: target => target.set(0, 0, 0) });
  const first = { done: false, enemies: [enemy()] }, owner = { done: false, enemies: [enemy()] };
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), { battles: [first, owner], sideInterps: [],
    heldBoss: () => false, certainHit: () => true, hitLands: () => true, slipsWithAnswer: () => false,
    applyBuffEffects: () => false, checkEnemyDeath() {}, targetHead: () => new THREE.Vector3(),
    releaseNewMove: () => true, enemyStrikePlayer() {}, liftFall() {}, liftInfo: () => ({ falls: new Set() }),
  });
  return { combat, map, first, owner, pictures, tones };
}

test('both side-event factories bind the actual battle rather than the first concurrent fight', t => {
  const e = environment(t, [command(231, picture), command(223, [tone, 0, false]), command(339, [0, 0, 2]), command(0)]);
  e.combat.fightCommonEvent(1, e.owner);
  e.combat.runSkillCommonEvents({ effects: [{ code: 44, data_id: 1 }] }, e.owner);
  assert.equal(e.combat.sideInterps.length, 2);
  for (const source of e.combat.sideInterps) {
    assert.equal(e.combat.battleOf(source), e.owner); source.update();
  }
  assert.equal(e.pictures.length, 2); assert.equal(e.tones.length, 2);
  assert.ok(e.pictures.every(([, owner]) => owner === e.owner));
  assert.ok(e.tones.every(([, , owner]) => owner === e.owner));
  assert.equal(e.owner.enemies[0].forcedSkill, $data.skills[2]);
  assert.equal(e.first.enemies[0].forcedSkill, undefined);
});

for (const factory of ['hit', 'enemy']) test(`a delayed ${factory} common event cannot attach to the next fight after its owner leaves`, t => {
  const e = environment(t, [command(230, [2]), command(231, picture), command(223, [tone, 0, false]), command(339, [0, 0, 2]), command(0)]);
  if (factory === 'hit') e.combat.fightCommonEvent(1, e.owner);
  else e.combat.runSkillCommonEvents({ effects: [{ code: 44, data_id: 1 }] }, e.owner);
  const source = e.combat.sideInterps[0]; source.update();
  assert.equal(source.waitCount, 1); e.owner.done = true; e.combat.battles = [e.first];
  source.update(); source.update();
  assert.equal(e.combat.battleOf(source), null);
  assert.equal(e.first.enemies[0].forcedSkill, undefined);
  assert.equal(e.owner.enemies[0].forcedSkill, undefined);
  assert.equal(e.pictures.length, 0); assert.equal(e.tones.length, 0);
});

test('an explicitly unowned side event stays unowned if another fight later starts', t => {
  const e = environment(t, [command(230, [1]), command(231, picture), command(223, [tone, 0, false]), command(339, [0, 0, 2]), command(0)]);
  e.combat.battles = []; e.combat.runSkillCommonEvents({ effects: [{ code: 44, data_id: 1 }] });
  const source = e.combat.sideInterps[0]; assert.equal(source.battleOwner, null);
  source.update(); e.combat.battles = [e.first]; source.update();
  assert.equal(e.combat.battleOf(source), null); assert.equal(e.pictures.length, 0); assert.equal(e.tones.length, 0);
  assert.equal(e.first.enemies[0].forcedSkill, undefined);
});

test('an ended battle retained in combat cannot receive delayed side-event commands', t => {
  const e = environment(t, [command(230, [2]), command(231, picture), command(223, [tone, 0, false]), command(339, [0, 0, 2]), command(0)]);
  e.combat.fightCommonEvent(1, e.owner);
  e.combat.runSkillCommonEvents({ effects: [{ code: 44, data_id: 1 }] }, e.owner);
  for (const source of e.combat.sideInterps) source.update();
  e.owner.done = true;
  assert.ok(e.combat.battles.includes(e.owner));
  for (const source of e.combat.sideInterps) {
    source.update(); source.update();
    assert.equal(e.combat.battleOf(source), null);
  }
  assert.equal(e.owner.enemies[0].forcedSkill, undefined);
  assert.equal(e.first.enemies[0].forcedSkill, undefined);
  assert.equal(e.pictures.length, 0); assert.equal(e.tones.length, 0);
});

test('ordinary reserved map common events retain map-owned pictures and tones during another fight', t => {
  const e = environment(t, [command(231, picture), command(223, [tone, 0, false]), command(0)]);
  e.map.reserveCommonEvent(1); assert.equal(e.map.setupStartingEvent(), true);
  e.map.interpreter.update();
  assert.notEqual(e.map.interpreter.troop, true);
  assert.deepEqual(e.pictures, [[picture, null]]); assert.deepEqual(e.tones, [[tone, 0, null]]);
});

for (const action of ['global', 'attack', 'boss', 'delayed', 'delayedLift']) test(`${action} effect44 forwards its own battle into the real side-event factory`, t => {
  const e = environment(t), skill = { id: 2, animation_id: 0, effects: [{ code: 44, data_id: 1 }] };
  const enemy = Object.assign(e.owner.enemies[0], { battle: e.owner, skill, plan: {}, puppet: false });
  if (action === 'global') {
    e.combat.itemGlobalEffects(skill, e.owner);
    for (let i = 0; i < 9; i++) e.combat.applyUsableToEnemy(enemy, skill, null);
  }
  else if (action === 'attack') e.combat.executeAttack(enemy, 1, 0, 0);
  else if (action === 'boss') e.combat.releaseBossMove(enemy);
  else {
    if (action === 'delayedLift') e.combat.liftInfo = () => ({ falls: new Set([skill.id]) });
    e.owner.delayed = [{ warned: true, e: enemy, skill, turn: 0 }]; e.owner.time = 12;
    e.combat.updateDelayed(e.owner, 2);
  }
  assert.equal(e.combat.sideInterps.length, 1); assert.equal(e.combat.battleOf(e.combat.sideInterps[0]), e.owner);
});
