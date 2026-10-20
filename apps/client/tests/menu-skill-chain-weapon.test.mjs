import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { GameState, BattlerBase } from '../src/game/state.js';
import { GameMap } from '../src/world/gamemap.js';
import { clearEdgeCache } from '../src/world/collision.js';
import { T } from '../src/world/mapmesh.js';

globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');
const trait = (code, data_id, value = 1) => ({ code, data_id, value });
const skill = (id, extra = {}) => ({ __class: 'RPG::Skill', id, name: `Synthetic art ${id}`, description: '', note: '',
  icon_index: id, stype_id: 1, occasion: 0, scope: 1, hit_type: 1, success_rate: 100,
  repeats: 1, animation_id: 0, mp_cost: 20, tp_cost: 0, tp_gain: 0,
  required_wtype_id1: 0, required_wtype_id2: 0,
  damage: { type: 1, formula: 'a.atk', element_id: 0, variance: 0, critical: false }, effects: [], ...extra });

function environment(t, { normalSources = true, borrowedSources = false } = {}) {
  const previous = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, previous); Object.assign($data, data); });
  const stats = [1000, 200, 80, 30, 100, 30, 30, 30];
  const weapon = (id, features, attack = 0) => ({ __class: 'RPG::Weapon', id, name: `Synthetic weapon ${id}`,
    note: '', icon_index: id * 10, etype_id: 0, wtype_id: id === 1 ? 1 : 2, animation_id: 0,
    params: [0, 0, attack, 0, 0, 0, 0, 0], features });
  Object.assign($data, {
    actors: [null, { id: 1, name: 'Synthetic actor', class_id: 1, initial_level: 1, equips: [1, 0, 0, 0, 0], features: [], note: '' }],
    classes: [null, { exp_params: [30, 20, 30, 30], learnings: [], note: '',
      features: [trait(41, 1), trait(51, 1), trait(51, 2), trait(22, 0)],
      params: { xsize: 8, ysize: 2, data: new Int16Array([...stats, ...stats]) } }],
    weapons: [null, weapon(1, normalSources ? [trait(61, 0, 0.5), trait(61, 0, 0.5)] : []),
      weapon(2, [trait(43, 101), trait(43, 102), trait(23, 4, 0.5), ...(borrowedSources ? [trait(61, 0, 0.5)] : [])], 120)],
    armors: [], items: [], skills: [], states: [], animations: [], commonEvents: [], system: { sounds: [] },
  });
  $data.skills[101] = skill(101); $data.skills[102] = skill(102);
  $data.skills[201] = skill(201, { scope: 11, mp_cost: 0, hit_type: 0, damage: { type: 0 },
    effects: [{ code: 11, data_id: 0, value1: 0, value2: 20 }] });
  const state = G.state = new GameState(); state.party.actors = [1]; state.party.weapons.set(2, 1);
  const actor = state.party.leader(); actor.learnSkill(201); actor.hp = 400; actor.mp = 100;
  const map = new GameMap(); map.mapId = 1;
  map.grid = { w: 40, h: 40, valid: () => true, region: () => 0, terrainTag: () => 0, passable: () => true };
  clearEdgeCache();
  map.playerChar.fx = 3; map.playerChar.fy = 4;
  const root = new THREE.Group(), camera = new THREE.PerspectiveCamera(); root.add(camera);
  camera.position.set(3.5 * T, 1.6, 4.5 * T);
  Object.assign(G, { state, map, time: 10, vr: false, xrAway: false, scripts: {},
    settings: { difficulty: 1, breakRule: 'original', fxBrightness: 0.5 }, coop: null,
    input: { controllers: {}, haptic() {} }, audio: null, three: { camera },
    player: { headWorld: out => out.copy(camera.position), forwardVec: () => new THREE.Vector3(0, 0, -1) },
    screen: { playAnimationOn() {} }, floorAt: () => 0, solidTopAt: () => 0,
    ui: { menuOpen: false, menuSection: 'skills', toast() {}, messageBusy: () => false, dialogueActive: () => false,
      closeMenu() { this.menuOpen = false; } } });
  const jobs = [], actions = [];
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), {
    gen: 1, root, battles: [], enemies: [], symbols: new Map(), puppets: new Map(), skillCD: {}, projectiles: [], sideInterps: [],
    stamina: 1, allies: { list: [], unitOf: () => null, showHeal() {} },
    showArms() {}, popup() {}, popupAtPlayer() {}, spawnGlow() {},
    later: (ms, run) => jobs.push({ ms, run }),
  });
  class Target extends BattlerBase { paramBase(id) { return [10000, 200, 80, 30, 100, 30, 30, 30][id]; } }
  const battler = new Target(); battler.hp = battler.mhp;
  const battle = { done: false, enemies: [] };
  const enemy = { b: battler, fx: 3, fy: 2, h: 1.8, r: 0.3, hr: 0.3, state: 'chase', battle, hidden: false,
    mesh: new THREE.Group(), knock: { x: 0, y: 0 }, stateTimers: {}, drawBar() {},
    get alive() { return battler.hp > 0; }, worldPos: out => out.set(3.5 * T, 0, 2.5 * T) };
  battle.enemies.push(enemy); combat.battles.push(battle); combat.enemies.push(enemy);
  let rolls = 0; combat.bonusManager().random = () => { rolls++; return 0; };
  const finish = combat.finishPlayerAction;
  t.mock.method(combat, 'finishPlayerAction', function(action, delay) { if (action) actions.push(action); return finish.call(this, action, delay); });
  const advance = dt => { G.time += dt; combat.updateBonusActions(dt, false); };
  const prime = () => { assert.equal(combat.useSkillFromMenu($data.skills[201]), true); assert.equal(combat.bonusStatus()?.count, 2); };
  const queue = () => {
    G.ui.menuOpen = true;
    assert.equal(combat.queueMenuSkill($data.skills[101]), true); assert.equal(combat.queueMenuSkill($data.skills[102]), true);
    assert.equal(combat.releaseMenuSkillChain(), true); G.ui.closeMenu();
  };
  return { combat, actor, state, map, enemy, battle, actions, jobs, prime, queue, advance, get rolls() { return rolls; } };
}

for (const ready of [false, true]) test(`queued borrowed arts spend existing extras ${ready ? 'after full recovery' : 'during trailing recovery'} without a normal fallback`, t => {
  const e = environment(t); e.prime(); e.advance(ready ? 1 : 0.31);
  const epoch = e.combat.bonusManager().epoch, gear = JSON.stringify(e.actor.equips), inventory = JSON.stringify(e.state.party.toJSON());
  e.queue(); e.advance(0);
  assert.equal(e.enemy.b.hp, 9800, 'the first action lands with borrowed ATK200');
  assert.equal(e.actor.mp, 90, 'the source MCR pays10MP instead of the normal20MP');
  assert.equal(e.actions.at(-1).ticket.bonus, true, 'a released queue must never silently perform an ordinary action');
  assert.equal(e.combat.bonusStatus()?.count, 1); assert.equal(e.combat.menuSkillChain?.skills.length, 1);
  e.advance(0.301);
  assert.equal(e.enemy.b.hp, 9600); assert.equal(e.actor.mp, 80);
  assert.equal(e.actions.at(-1).ticket.bonus, true); assert.equal(e.combat.menuSkillChain, null);
  e.advance(0.301); assert.equal(e.combat.bonusStatus(), null); assert.equal(e.rolls, 2, 'earned follow-ups cannot reroll');
  assert.equal(e.combat.bonusManager().epoch, epoch, 'temporary action equipment never invalidates the real encounter');
  assert.equal(e.actor.atk, 80); assert.equal(JSON.stringify(e.actor.equips), gear); assert.equal(JSON.stringify(e.state.party.toJSON()), inventory);
  assert.equal(e.combat.playerActionReady(true), false, 'the final action keeps its own recovery');
});

test('status reads and frame updates inside borrowed equipment cannot erase normal-source extras or change cast authority', t => {
  const e = environment(t); e.prime(); e.advance(0.31);
  const plan = e.combat.menuSkillPlan($data.skills[101]), epoch = e.combat.bonusManager().epoch;
  e.combat.withMenuWeapon(plan.context, () => {
    assert.equal(e.actor.atk, 200); assert.equal(e.actor.skillMpCost($data.skills[101]), 10);
    assert.equal(e.combat.bonusStatus()?.count, 2);
    e.combat.updateBonusActions(0, false); assert.equal(e.combat.bonusStatus()?.count, 2);
    assert.equal(e.actor.atk, 200, 'normal-gear synchronization must restore the active action overlay');
  });
  assert.equal(e.combat.bonusStatus()?.count, 2); assert.equal(e.combat.bonusManager().epoch, epoch);
  assert.equal(e.actor.atk, 80); assert.equal(e.rolls, 2);
});

test('an ordinary borrowed action rolls its own native sources and icon rather than normal equipment sources', t => {
  const e = environment(t, { borrowedSources: true });
  assert.equal(e.combat.useSkillFromMenu($data.skills[101]), true); assert.equal(e.enemy.b.hp, 9800);
  assert.equal(e.combat.bonusStatus(), null); e.advance(0.301);
  assert.equal(e.combat.bonusStatus()?.count, 1); assert.equal(e.combat.bonusStatus()?.icon, 20);
  assert.equal(e.rolls, 1); assert.deepEqual(e.actions[0].ticket.sources, [{ chance: 0.5, icon: 20 }]);
  assert.equal(e.actor.atk, 80); assert.equal(e.actor.mp, 90);
});

test('borrowing a weapon without feature61 cannot inherit the usual weapon sources for a new roll', t => {
  const e = environment(t);
  assert.equal(e.combat.useSkillFromMenu($data.skills[101]), true); e.advance(0.301);
  assert.equal(e.enemy.b.hp, 9800); assert.equal(e.combat.bonusStatus(), null); assert.equal(e.rolls, 0);
  assert.deepEqual(e.actions[0].ticket.sources, []);
});

test('a borrowed feature61 source can earn extras with no normal source, then spend them without rerolling', t => {
  const e = environment(t, { normalSources: false, borrowedSources: true });
  assert.equal(e.combat.useSkillFromMenu($data.skills[101]), true); e.advance(0.301);
  assert.equal(e.combat.bonusStatus()?.count, 1); assert.equal(e.combat.bonusStatus()?.icon, 20); assert.equal(e.rolls, 1);
  G.ui.menuOpen = true; assert.equal(e.combat.queueMenuSkill($data.skills[102]), true);
  assert.equal(e.combat.releaseMenuSkillChain(), true); G.ui.closeMenu(); e.advance(0);
  assert.equal(e.actions.at(-1).ticket.bonus, true); assert.equal(e.enemy.b.hp, 9600); assert.equal(e.actor.mp, 80);
  e.advance(0.301); assert.equal(e.combat.bonusStatus(), null); assert.equal(e.rolls, 1);
});

test('genuinely removing all normal sources invalidates queued work and pending completions', t => {
  const e = environment(t); e.prime(); e.advance(0.31); e.queue(); e.advance(0);
  assert.equal(e.actions.at(-1).ticket.bonus, true); assert.equal(e.enemy.b.hp, 9800);
  const epoch = e.combat.bonusManager().epoch;
  e.actor.equips[0] = { kind: 'weapon', id: 0 }; e.advance(0.301);
  assert.ok(e.combat.bonusManager().epoch > epoch); assert.equal(e.combat.bonusStatus(), null);
  assert.equal(e.combat.menuSkillChain, null); assert.equal(e.enemy.b.hp, 9800); assert.equal(e.actor.mp, 90);
  assert.equal(e.rolls, 2, 'stale completions do not restore the removed source');
});

test('removing real loadout sources also rejects a pending ordinary borrowed-source roll', t => {
  const e = environment(t, { borrowedSources: true });
  assert.equal(e.combat.useSkillFromMenu($data.skills[101]), true);
  const ticket = e.actions[0].ticket; assert.equal(ticket.bonus, false); assert.equal(ticket.sources.length, 1);
  e.actor.equips[0] = { kind: 'weapon', id: 0 }; e.advance(0.301);
  assert.ok(e.combat.bonusManager().epoch > ticket.epoch);
  assert.equal(e.combat.bonusStatus(), null); assert.equal(e.rolls, 0);
});
