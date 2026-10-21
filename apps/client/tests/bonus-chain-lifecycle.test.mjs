import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { GameState } from '../src/game/state.js';
import { GameMap } from '../src/world/gamemap.js';

globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');

const support = {
  __class: 'RPG::Skill', id: 101, name: 'Synthetic recovery', note: '', occasion: 0,
  scope: 11, hit_type: 0, success_rate: 100, repeats: 1, stype_id: 0,
  animation_id: 0, mp_cost: 5, tp_cost: 0, tp_gain: 0, damage: { type: 0 },
  effects: [{ code: 11, data_id: 0, value1: 0, value2: 20 }],
};

function environment(t) {
  const saved = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, saved); Object.assign($data, data); });
  const stats = [1000, 200, 80, 30, 100, 30, 30, 30];
  Object.assign($data, {
    actors: [null, { id: 1, name: 'Synthetic actor', class_id: 1, initial_level: 1,
      equips: [], icon_index: 88, note: '', features: [{ code: 61, value: 0.5 }] }],
    classes: [null, { note: '', features: [], learnings: [], exp_params: [30, 20, 30, 30],
      params: { xsize: 8, ysize: 2, data: new Int16Array([...stats, ...stats]) } }],
    weapons: [], armors: [], items: [], states: [], animations: [], commonEvents: [],
    skills: [], troops: [], system: { sounds: [] },
  });
  $data.skills[1] = { ...support, id: 1, scope: 1, hit_type: 1, mp_cost: 0,
    effects: [], damage: { type: 1, formula: '10', variance: 0, element_id: 0 } };
  $data.skills[101] = support;
  const state = new GameState(), map = new GameMap(); map.mapId = 1; map.grid = {};
  G.state = state;
  state.party.actors = [1];
  const actor = state.party.leader(); actor.learnSkill(101); actor.hp = 400; actor.mp = 100;
  const root = new THREE.Group(), rig = new THREE.Group(), camera = new THREE.PerspectiveCamera();
  root.add(rig); rig.add(camera); camera.position.y = 1.6;
  const input = { pressed: false, blockHeld: false, attackPressed() { return this.pressed; },
    mouseHeld: () => false, breakPressed: () => false, disarmPressed: () => false,
    block() { return this.blockHeld; }, haptic() {}, controllers: {} };
  Object.assign(G, { state, map, time: 10, vr: false, xrAway: false,
    scripts: {}, settings: { swingLevel: 2 }, audio: null, coop: null, arena: null,
    theater: null, emotes: null, screen: { playAnimationOn() {} }, input,
    three: { rig, camera }, player: { rig, headWorld: out => camera.getWorldPosition(out),
      forwardVec: () => new THREE.Vector3(0, 0, -1) },
    ui: { menuOpen: false, sceneOpen: null, msg: null, pointerTarget: false,
      consumedConfirm: false, messageBusy: () => false, dialogueActive: () => false,
      toast() {}, closeMenu() { this.menuOpen = false; } } });
  const enemy = { alive: true, hidden: false, state: 'idle', hr: 0.2, h: 1.6,
    hitCooldown: 0, data: { note: '', gold: 0, exp: 0, drop_items: [] },
    worldPos: out => out.set(0, 0, -1) };
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), {
    root, weapon: new THREE.Group(), stamina: 1, staminaDelay: 0, skillCD: {},
    rangedCooldown: 0, battles: [], puppets: new Map(), symbols: new Map(),
    bonusPending: [], sideInterps: [], fadingMarkers: [], defeated: new Map(),
    prevBase: new THREE.Vector3(), prevTip: new THREE.Vector3(), prevRel: new THREE.Vector3(),
    allTargets: () => [enemy], weaponLength: () => 1, breakArmed: () => null,
    playerHitEnemy() {}, playerFollowUp() {}, popupAtPlayer() {},
    swingAtNpcs() {}, swingAtPlayers() {}, clashWithPlayers() {},
    allies: { list: [], unitOf: () => null, update() {} },
  });
  combat.weapon.userData.length = 1;
  // Keep the common frame, action timers, guard and battle-result checks real.
  // Rendering/AI are unrelated to the lifecycle under test.
  for (const name of ['refreshEquipment', 'alignHeldToRay', 'updateGripAdjust', 'updateDeskShield',
    'updateDesktopEquipment', 'updateQuick', 'updateReady', 'updateHeld', 'updateFx',
    'updateAreaMarks', 'updateSymbols', 'updateWeaponGlow', 'updateBreakReady',
    'updateActorStates', 'updateGhost', 'updateWeaponFx', 'updateEnemies',
    'updateProjectiles', 'updateWaves', 'updateHazards', 'updatePopups']) combat[name] = () => {};
  let rolls = 0;
  combat.bonusManager().random = () => { rolls++; return 0; };
  const fight = (enemies = []) => {
    const battle = { done: false, result: -1, enemies, time: 0, canEscape: false,
      finish(result) { this.done = true; this.result = result; combat.onBattleEnd(this); } };
    combat.battles.push(battle);
    return battle;
  };
  const advance = (dt, { frame = false } = {}) => {
    G.time += dt;
    if (frame) combat.update(dt); else combat.updateBonusActions(dt, false);
  };
  const earn = () => {
    const action = combat.beginPlayerAction(true);
    assert.ok(action?.ticket);
    combat.completePlayerAction(action);
    assert.equal(combat.bonusStatus()?.count, 1);
    return action;
  };
  return { combat, actor, enemy, input, fight, advance, earn, get rolls() { return rolls; } };
}

test('the final real battle-end hook clears unused extras and invalidates pending completion', t => {
  const e = environment(t), battle = e.fight();
  const pending = e.combat.beginPlayerAction(true);
  e.combat.finishPlayerAction(pending, 0.3);
  e.earn();
  assert.equal(e.combat.bonusPending.length, 1);
  const epoch = pending.ticket.epoch;
  battle.finish(0);
  assert.equal(G.state.system.winCount, 1, 'normal victory accounting still runs');
  assert.equal(e.combat.bonusStatus(), null);
  assert.equal(e.combat.bonusPending.length, 0);
  assert.ok(e.combat.bonusManager().epoch > epoch);
  e.fight(); e.combat.completePlayerAction(pending);
  assert.equal(e.combat.bonusStatus(), null, 'an old killing-action callback cannot grant into a fresh battle');
});

test('ending one of two concurrent battles preserves the active encounter chain and pending action', t => {
  const e = environment(t), first = e.fight(), second = e.fight();
  const pending = e.combat.beginPlayerAction(true);
  e.combat.finishPlayerAction(pending, 0.3);
  e.earn(); first.finish(0);
  assert.equal(e.combat.bonusStatus()?.count, 1);
  assert.equal(e.combat.bonusPending.length, 1);
  assert.equal(second.done, false);
  second.finish(0);
  assert.equal(e.combat.bonusStatus(), null);
  assert.equal(e.combat.bonusPending.length, 0);
});

test('common frames keep extras through the dying animation and clear them at the actual victory result', t => {
  const e = environment(t); e.enemy.alive = false; e.enemy.state = 'dying';
  const battle = e.fight([e.enemy]); e.earn();
  e.advance(0.01, { frame: true });
  assert.equal(battle.done, false); assert.equal(e.combat.bonusStatus()?.count, 1);
  e.enemy.state = 'dead'; e.advance(0.01, { frame: true });
  assert.equal(battle.done, true); assert.equal(battle.result, 0);
  assert.equal(e.combat.bonusStatus(), null);
});

test('common frames clean a directly ended or culled encounter without requiring onBattleEnd', t => {
  const e = environment(t), battle = e.fight(); e.earn();
  const pending = e.combat.beginPlayerAction(true, { recovery: 0.9 });
  e.combat.finishPlayerAction(pending, 0.3);
  battle.done = true; // Co-op ownership transfer can end a battle without normal rewards.
  e.advance(0.01, { frame: true });
  assert.equal(e.combat.bonusStatus(), null); assert.equal(e.combat.bonusPending.length, 0);
  assert.equal(G.state.system.winCount, 0);
  e.fight(); e.combat.completePlayerAction(pending);
  assert.equal(e.combat.bonusStatus(), null);
});

test('a guest engaged puppet permits a chain, retains it through dying and clears it when the host ends it', t => {
  const e = environment(t), puppet = { battle: { puppet: true }, state: 'idle', outOfFight: false };
  e.combat.puppets.set('host-enemy', puppet);
  assert.equal(e.combat.inCombat, false, 'guest combat need not own a local Battle');
  e.earn(); e.advance(30);
  assert.equal(e.combat.bonusStatus()?.count, 1, 'extras have no three-second expiry');
  const extra = e.combat.beginPlayerAction(true, { active: 0.3, recovery: 0.9, preferBonus: true });
  assert.equal(extra.ticket.bonus, true);
  e.combat.finishPlayerAction(extra, 0.3); e.advance(0.3);
  assert.equal(e.combat.bonusStatus(), null); assert.equal(e.rolls, 1, 'a guest extra does not reroll');
  e.advance(0.61); e.earn(); puppet.state = 'dying'; e.advance(0.01);
  assert.equal(e.combat.bonusStatus()?.count, 1);
  puppet.battle = null; e.advance(0.01);
  assert.equal(e.combat.bonusStatus(), null);
});

for (const excluded of ['dormant', 'out of fight']) test(`${excluded} guest puppets cannot prime support extras`, t => {
  const e = environment(t);
  e.combat.puppets.set('host-enemy', { battle: excluded === 'dormant' ? null : {},
    state: 'idle', outOfFight: excluded === 'out of fight' });
  assert.equal(e.combat.bonusFighting(), false);
  assert.equal(e.combat.useSkillFromMenu(support), true);
  assert.equal(e.actor.hp, 420); assert.equal(e.actor.mp, 95);
  assert.equal(e.combat.bonusStatus(), null); assert.equal(e.rolls, 0);
});

test('an opening desktop swing can roll after its actual hit starts the first battle', t => {
  const e = environment(t);
  let hits = 0;
  e.combat.playerHitEnemy = () => { hits++; if (!e.combat.inCombat) e.fight([e.enemy]); };
  e.input.pressed = true; e.combat.updatePlayerAttack(0); e.input.pressed = false;
  assert.equal(e.combat.inCombat, false); assert.ok(e.combat.swing.action.ticket);
  e.advance(0.1); e.combat.updatePlayerAttack(0.1);
  assert.equal(hits, 1); assert.equal(e.combat.inCombat, true); assert.equal(e.combat.bonusStatus(), null);
  e.advance(0.13); e.combat.updatePlayerAttack(0.13);
  assert.equal(e.combat.bonusStatus()?.count, 1); assert.equal(e.rolls, 1);
});

test('field healing cannot prime a future encounter even with the extra-action trait', t => {
  const e = environment(t);
  assert.equal(e.combat.useSkillFromMenu(support), true);
  assert.deepEqual([e.actor.hp, e.actor.mp], [420, 95]);
  e.advance(10); assert.equal(e.combat.bonusStatus(), null);
  e.fight(); e.advance(0.01);
  assert.equal(e.combat.bonusStatus(), null); assert.equal(e.rolls, 0);
});

test('canceled support retains its native cost but cannot roll an extra action', t => {
  const e = environment(t); e.fight(); e.actor.skillCanceled = () => true;
  assert.equal(e.combat.useSkillFromMenu(support), false);
  assert.deepEqual([e.actor.hp, e.actor.mp], [400, 95]);
  e.advance(1);
  assert.equal(e.combat.bonusStatus(), null); assert.equal(e.rolls, 0);
});

test('the shared desktop cast active phase holds guard down, then releases it before trailing recovery ends', t => {
  const e = environment(t); e.fight(); e.input.blockHeld = true;
  assert.equal(e.combat.performUsable(support, 'skill', 'quick'), true);
  assert.equal(e.combat.handsBusy(), true);
  e.combat.updateGuard(); assert.equal(!!e.combat.guardUp, false);
  e.advance(0.2); e.combat.updateGuard(); assert.equal(!!e.combat.guardUp, false);
  e.advance(0.11); assert.equal(e.combat.handsBusy(), false);
  e.combat.updateGuard(); assert.equal(e.combat.guardUp, true);
  assert.ok(e.combat.playerRecoveryUntil > G.time, 'guard does not wait for the entire recovery tail');
});
