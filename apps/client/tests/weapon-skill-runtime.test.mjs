import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { GameState, BattlerBase } from '../src/game/state.js';
import { withActorEquipment } from '../src/game/actor-equipment.js';
import { withMenuSkillPreview, menuKnowsSkill, menuOwnedGear } from '../src/combat/menu-weapon-skills.js';
import { GameMap } from '../src/world/gamemap.js';
import { clearEdgeCache } from '../src/world/collision.js';
import { T } from '../src/world/mapmesh.js';
import { initAssets } from '../src/data/assets.js';

globalThis.location = { search: '?lang=en' };
globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');
const { loadUiAssets } = await import('../src/ui/ui.js');
const trait = (code, data_id, value = 1) => ({ code, data_id, value });
const skill = (id, extra = {}) => ({ __class: 'RPG::Skill', id, name: `Art ${id}`, description: 'Synthetic art',
  note: '', icon_index: id, stype_id: 1, occasion: 0, scope: 1, hit_type: 1, success_rate: 100,
  repeats: 1, animation_id: -1, mp_cost: 20, tp_cost: 0, tp_gain: 0, required_wtype_id1: 0, required_wtype_id2: 0,
  damage: { type: 1, formula: 'a.atk', element_id: 0, variance: 0, critical: false }, effects: [], ...extra });

function environment(t, extra = {}) {
  const previous = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, previous); Object.assign($data, data); });
  const params = [1000, 200, 80, 30, 100, 30, 30, 30];
  const weapon = (id, features, plus = 0) => ({ __class: 'RPG::Weapon', id, name: `Weapon ${id}`, note: '',
    wtype_id: id === 1 ? 1 : 2, icon_index: id, etype_id: 0, animation_id: id + 10,
    features, params: [0, 0, plus, 0, 0, 0, 0, 0] });
  Object.assign($data, {
    actors: [null, { id: 1, name: 'Synthetic actor', class_id: 1, initial_level: 1,
      equips: [1, 0, 0, 0, 0], note: '', features: [] },
      { id: 2, name: 'Other actor', class_id: 1, initial_level: 1, equips: [4, 0, 0, 0, 0], features: [], note: '' }],
    classes: [null, { exp_params: [30, 20, 30, 30], learnings: [], note: '',
      features: [trait(41, 1), trait(51, 1), trait(51, 2), trait(52, 1), trait(22, 0)],
      params: { xsize: 8, ysize: 2, data: new Int16Array([...params, ...params]) } }],
    weapons: [null, weapon(1, []), weapon(2, [trait(43, 101), trait(23, 4, 0.5)], 120),
      weapon(3, [trait(43, 101)], 400), weapon(4, [trait(43, 104)])],
    armors: [], items: [], skills: [], states: [], animations: [], commonEvents: [],
    system: { currency_unit: 'Souls', sounds: [], skill_types: ['', 'Skills'] },
  });
  $data.skills[101] = skill(101, extra); $data.skills[102] = skill(102, { mp_cost: 4 });
  $data.skills[104] = skill(104); $data.skills[105] = skill(105);
  $data.states[30] = { id: 30, name: 'Synthetic effect', features: [], note: '', restriction: 0,
    auto_removal_timing: 0, min_turns: 1, max_turns: 1 };
  const state = G.state = new GameState(); state.party.actors = [1, 2];
  state.party.weapons.set(2, 1); state.quickSlots = Array(8).fill(null);
  const actor = state.party.leader(); actor.hp = 500; actor.mp = 100; actor.tp = 50;
  const map = G.map = new GameMap(); map.mapId = 1;
  const blocked = new Set();
  map.grid = { w: 40, h: 40, region: () => 0,
    valid: (x, y) => x >= 0 && x < 40 && y >= 0 && y < 40,
    passable: (x, y, d) => !blocked.has(`${x},${y},${d}`) };
  map.playerChar.fx = 3; map.playerChar.fy = 4; map.playerChar.syncFromContinuous(); clearEdgeCache();
  const root = new THREE.Group(), camera = new THREE.PerspectiveCamera(); root.add(camera);
  camera.position.set(3.5 * T, 1.6, 4.5 * T);
  const animations = [], toasts = [], gains = [];
  Object.assign(G, { time: 10, scripts: {}, settings: { difficulty: 1, breakRule: 'original', fxBrightness: 0.5 },
    coop: { noteGain: (...args) => gains.push(args) }, vr: false, three: { camera },
    input: { controllers: {}, haptic() {}, breakHeld: () => false },
    player: { headWorld: out => out.copy(camera.position), forwardVec: () => new THREE.Vector3(0, 0, -1), dodge: { cooldown: 0 } },
    audio: { playSystemSe() {}, playSe() {} }, screen: { playAnimationOn: (...args) => animations.push(args), hurtFlash() {} },
    floorAt: () => 0, solidTopAt: () => 0, arena: null, theater: null,
    ui: { menuOpen: true, toast: text => toasts.push(text), closeMenu() { this.menuOpen = false; } } });
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), {
    root, gen: 1, battles: [], symbols: new Map(), puppets: new Map(), skillCD: {}, enemies: [], projectiles: [], sideInterps: [],
    stamina: 1, allies: { list: [], unitOf: () => null, showHeal() {} },
    showArms() {}, popup() {}, popupAtPlayer() {}, spawnGlow() {},
  });
  class Target extends BattlerBase { paramBase(id) { return [10000, 200, 80, 30, 100, 30, 30, 30][id]; } }
  const addTarget = (fx = 3, fy = 2) => {
    const b = new Target(); b.hp = b.mhp; b.mp = b.mmp;
    const battle = { done: false, enemies: [] };
    const enemy = { b, fx, fy, h: 1.8, r: 0.3, hr: 0.3, state: 'chase', battle, hidden: false, untargetable: false,
      mesh: new THREE.Group(), knock: { x: 0, y: 0 }, stateTimers: {}, drawBar() {},
      get alive() { return b.hp > 0 && !b.isState(1); },
      worldPos: out => out.set((enemy.fx + 0.5) * T, 0, (enemy.fy + 0.5) * T) };
    battle.enemies.push(enemy); combat.battles.push(battle); combat.enemies.push(enemy); return enemy;
  };
  const snapshot = () => JSON.stringify({ actor: actor.toJSON(), party: state.party.toJSON(), slots: state.quickSlots, cd: combat.skillCD });
  const advance = milliseconds => { const dt = milliseconds / 1000; G.time += dt; combat.updateDelayedActions(dt, false); };
  return { actor, state, map, combat, root, camera, addTarget, blocked, animations, toasts, gains, snapshot, advance, art: $data.skills[101] };
}

test('owned menu arts use bag weapons and combat offhands without teaching skills or borrowing storage/other actors', t => {
  const e = environment(t);
  $data.armors[1] = { id: 1, name: 'Offhand', etype_id: 1, atype_id: 1, features: [trait(43, 105)], params: Array(8).fill(0) };
  $data.armors[2] = { id: 2, name: 'Ring', etype_id: 4, features: [trait(43, 104)] };
  e.state.party.armors.set(1, 1); e.state.party.armors.set(2, 1); e.state.party.kept.weapon.set(4, 1);
  const before = e.snapshot();
  assert.deepEqual(e.combat.menuSkills().map(s => s.id), [101, 105]);
  assert.deepEqual(e.actor.allSkills(), []); assert.equal(e.combat.skillUseStatus(e.art).ok, false);
  const status = e.combat.menuSkillUseStatus(e.art);
  assert.equal(status.ok, true); assert.equal(status.weapon, $data.weapons[2]); assert.equal(status.requiresSwap, true);
  assert.deepEqual(status.costs, { hp: 0, mp: 10, tp: 0 }); assert.equal(e.snapshot(), before);
  assert.deepEqual(e.gains, []);
});

test('scoped weapon calculations preserve actor identity, serializable equipment and nested restoration even on exceptions', t => {
  const e = environment(t), original = e.actor.equips, before = e.snapshot();
  const equips = original.map(x => ({ ...x })); equips[0] = { kind: 'weapon', id: 2 };
  assert.throws(() => withActorEquipment(e.actor, equips, () => {
    assert.equal(e.state.actor(1), e.actor); assert.equal(e.actor.atk, 200); assert.equal(e.actor.skillMpCost(e.art), 10);
    assert.equal(e.actor.equips, original); assert.equal(e.snapshot(), before, 'a save during an action serializes normal equipment');
    withActorEquipment(e.actor, null, () => assert.equal(e.actor.atk, 80));
    assert.equal(e.actor.atk, 200); throw new Error('synthetic failure');
  }), /synthetic failure/);
  assert.equal(e.actor.atk, 80); assert.equal(e.snapshot(), before);
});

test('one menu preview shares equipment compatibility while borrowed grants and resource checks stay live', t => {
  const e = environment(t), before = e.snapshot();
  const original = e.actor.canEquipItem; let checks = 0;
  t.mock.method(e.actor, 'canEquipItem', function(...args) { checks++; return original.apply(this, args); });
  withMenuSkillPreview(e.actor, e.state.party, () => {
    for (let n = 0; n < 20; n++) assert.equal(e.combat.menuSkillUseStatus(e.art).ok, true);
    assert.equal(checks, 2, 'the same source is checked once, including its scoped replacement permissions');
    assert.equal(menuKnowsSkill(e.actor, e.art.id), false, 'borrowed arts never become normal known skills');
    e.actor.mp = 0;
    assert.equal(e.combat.menuSkillUseStatus(e.art).ok, false, 'cost authority is not cached');
    e.actor.mp = 100;
    assert.equal(e.combat.menuSkillUseStatus(e.art).ok, true);
  });
  assert.equal(e.snapshot(), before);
  e.state.party.weapons.delete(2);
  assert.equal(e.combat.menuSkillUseStatus(e.art).ok, false, 'actual actions do not reuse preview ownership');
  withMenuSkillPreview(e.actor, e.state.party, () => assert.equal(e.combat.menuSkillUseStatus(e.art).ok, false));
});

test('menu preview scopes isolate actor equipment overlays, nested ownership and exception cleanup', t => {
  const e = environment(t), equips = e.actor.equips.map(entry => ({ ...entry }));
  equips[0] = { kind: 'weapon', id: 2 };
  withMenuSkillPreview(e.actor, e.state.party, () => {
    assert.equal(menuKnowsSkill(e.actor, 101), false);
    withActorEquipment(e.actor, equips, () => assert.equal(menuKnowsSkill(e.actor, 101), true));
    assert.equal(menuKnowsSkill(e.actor, 101), false);
    e.state.party.weapons.set(3, 1);
    assert.throws(() => withMenuSkillPreview(e.actor, e.state.party, () => {
      assert.ok(menuOwnedGear(e.actor, e.state.party).some(entry => entry.weapon.id === 3));
      throw new Error('preview failed');
    }), /preview failed/);
    assert.equal(menuOwnedGear(e.actor, e.state.party).some(entry => entry.weapon.id === 3), false, 'outer snapshot restored');
  });
  assert.ok(menuOwnedGear(e.actor, e.state.party).some(entry => entry.weapon.id === 3));
  assert.throws(() => withMenuSkillPreview(e.actor, e.state.party, () => { throw new Error('outer failed'); }), /outer failed/);
  e.actor.learnSkill(101);
  assert.equal(menuKnowsSkill(e.actor, 101), true, 'a failed preview leaves no stale knowledge');
});

test('a borrowed melee art keeps source ATK, elements, on-hit traits and animation through delayed repeats', t => {
  const e = environment(t, { repeats: 3, damage: { type: 1, formula: 'a.atk', element_id: -1, variance: 0 },
    effects: [{ code: 21, data_id: 0, value1: 1 }] });
  $data.weapons[2].features.push(trait(31, 3), trait(32, 30));
  const enemy = e.addTarget();
  enemy.b.featureObjects = () => [{ features: [trait(11, 3, 0.5)] }];
  const gear = JSON.stringify(e.actor.equips), bag = JSON.stringify(e.state.party.toJSON());
  const compute = e.combat.computeDamage;
  t.mock.method(e.combat, 'computeDamage', function(actor, ...args) {
    assert.equal(actor, e.actor); assert.equal(actor.atk, 200); assert.equal(JSON.stringify(actor.toJSON().equips), gear);
    return compute.call(this, actor, ...args);
  });
  assert.equal(e.combat.useSkillFromMenu(e.art), true);
  assert.equal(enemy.b.hp, 9900); assert.equal(enemy.b.isState(30), true);
  assert.equal(e.actor.atk, 80); assert.equal(e.actor.mp, 90); assert.equal(e.animations[0][1], 12);
  assert.equal(e.combat.heldSpecs().weapon.item, $data.weapons[2]);
  e.advance(240);
  assert.equal(enemy.b.hp, 9700); assert.equal(e.actor.mp, 90);
  assert.equal(JSON.stringify(e.actor.equips), gear); assert.equal(JSON.stringify(e.state.party.toJSON()), bag);
  G.time += 1; assert.equal(e.combat.heldSpecs().weapon.item, $data.weapons[1]);
  assert.equal(e.combat.useQuickEntry({ kind: 'skill', id: 101 }), false, 'borrowed grants do not become quick-slot skills');
});

test('a borrowed projectile uses source magic and costs after usual equipment is restored', t => {
  const e = environment(t, { hit_type: 2, repeats: 2,
    damage: { type: 1, formula: 'a.mat', element_id: 0, variance: 0 } });
  $data.weapons[2].params[4] = 50;
  const enemy = e.addTarget();
  assert.equal(e.combat.useSkillFromMenu(e.art), true); assert.equal(e.actor.mp, 90);
  assert.equal(e.actor.mat, 100); assert.equal(e.combat.projectiles.length, 1);
  for (let n = 0; n < 90 && e.combat.projectiles.length; n++) { e.combat.updateProjectiles(1 / 60, false); e.advance(1000 / 60); }
  e.advance(120);
  assert.equal(enemy.b.hp, 9700); assert.equal(e.actor.mp, 90); assert.equal(e.actor.mat, 100);
});

test('native delayed followups retain the borrowed source and pay their own cost only once', t => {
  const e = environment(t, { note: '<使用後追加行動:102,0,100>' }); const enemy = e.addTarget();
  $data.skills[102].repeats = 2;
  assert.equal(e.combat.useSkillFromMenu(e.art), true); assert.equal(enemy.b.hp, 9800);
  e.advance(320); e.advance(120);
  assert.equal(enemy.b.hp, 9400); assert.equal(e.actor.mp, 88, 'main cost10 and followup cost2 use the source MCR');
  assert.equal(e.actor.atk, 80); assert.deepEqual(e.actor.skills, []);
});

test('a reflected borrowed spell uses source offense against the normal real caster and mutates its actual HP', t => {
  const e = environment(t, { hit_type: 2, damage: { type: 1, formula: 'a.atk - b.def', element_id: 0, variance: 0 } });
  $data.weapons[2].params[3] = 200;
  const enemy = e.addTarget(); enemy.b.featureObjects = () => [{ features: [trait(22, 5)] }];
  const calculations = [], compute = e.combat.computeDamage;
  t.mock.method(e.combat, 'computeDamage', function(user, target, ...args) {
    calculations.push([user.atk, target.def, target === e.actor]); return compute.call(this, user, target, ...args);
  });
  assert.equal(e.combat.useSkillFromMenu(e.art), true);
  for (let n = 0; n < 90 && e.combat.projectiles.length; n++) { e.combat.updateProjectiles(1 / 60, false); e.advance(1000 / 60); }
  assert.deepEqual(calculations, [[200, 30, true]]);
  assert.equal(e.actor.hp, 330, 'borrowed ATK200 minus normal DEF30 is reflected; temporary DEF230 cannot protect it');
  assert.equal(enemy.b.hp, 10000); assert.equal(e.actor.def, 30); assert.equal(e.actor.mp, 90);
});

test('offhand combat gear borrows its native slot while preserving the usual main hand and saved shield', t => {
  const e = environment(t);
  e.state.party.weapons.clear();
  $data.armors[1] = { id: 1, name: 'Usual shield', etype_id: 1, atype_id: 1, features: [], params: Array(8).fill(0) };
  $data.armors[2] = { id: 2, name: 'Offhand gun', etype_id: 1, atype_id: 1, icon_index: 2,
    features: [trait(43, 101), trait(23, 4, 0.25)], params: [0, 0, 70, 0, 0, 0, 0, 0] };
  e.actor.equips[1] = { kind: 'armor', id: 1 }; e.state.party.armors.set(2, 1);
  const before = JSON.stringify(e.actor.equips), enemy = e.addTarget();
  const status = e.combat.menuSkillUseStatus(e.art);
  assert.equal(status.ok, true); assert.equal(status.weaponKind, 'armor'); assert.equal(status.weapon, $data.armors[2]);
  assert.equal(status.costs.mp, 5); assert.equal(e.combat.useSkillFromMenu(e.art), true);
  assert.equal(enemy.b.hp, 9850); assert.equal(e.actor.mp, 95); assert.equal(JSON.stringify(e.actor.equips), before);
  const view = e.combat.heldSpecs(); assert.equal(view.weapon.item.id, 1); assert.equal(view.offhand.item.id, 2);
});

test('current usable equipment wins, while known weapon-restricted arts may choose a compatible owned type', t => {
  const e = environment(t); e.actor.learnSkill(101);
  let status = e.combat.menuSkillUseStatus(e.art);
  assert.equal(status.ok, true); assert.equal(status.requiresSwap, false); assert.equal(status.costs.mp, 20);
  e.art.required_wtype_id1 = 2; $data.weapons[2].features = [];
  status = e.combat.menuSkillUseStatus(e.art);
  assert.equal(status.ok, true); assert.equal(status.requiresSwap, true); assert.equal(status.weapon.id, 2);
});

test('native equipment compatibility rejects fixed/sealed slots and swaps that would dislodge other gear', t => {
  const e = environment(t);
  for (const feature of [trait(53, 0), trait(54, 0)]) {
    $data.actors[1].features = [feature];
    const before = e.snapshot(), status = e.combat.menuSkillUseStatus(e.art);
    assert.equal(status.ok, false); assert.equal(status.weapon.id, 2); assert.equal(status.requiresSwap, true);
    assert.equal(e.combat.useSkillFromMenu(e.art), false); assert.equal(e.snapshot(), before);
  }
  $data.actors[1].features = [];
  $data.armors[1] = { id: 1, etype_id: 1, atype_id: 1, features: [], params: Array(8).fill(0) };
  e.actor.equips[1] = { kind: 'armor', id: 1 }; $data.weapons[2].features.push(trait(55, 1));
  assert.equal(e.combat.menuSkillUseStatus(e.art).ok, false, 'a borrowed dual-wield weapon cannot discard the equipped shield');
  e.state.party.weapons.set(3, 1);
  assert.equal(e.combat.menuSkillUseStatus(e.art).weapon.id, 3, 'a genuinely compatible alternative is chosen deterministically');
});

test('a blocked current grant keeps its native cost/cooldown reason even with a fixed equipped weapon', t => {
  const e = environment(t); e.actor.equips[0] = { kind: 'weapon', id: 2 }; e.state.party.weapons.clear();
  $data.actors[1].features = [trait(53, 0)]; e.combat.skillCD[101] = G.time + 3;
  const status = e.combat.menuSkillUseStatus(e.art);
  assert.equal(status.ok, false); assert.equal(status.requiresSwap, false); assert.match(status.reason, /3\.0/);
  assert.equal(status.costs.mp, 10);
});

test('matching native refinement families prefer the highest owned level, with valid base fallback', t => {
  const e = environment(t); e.state.party.weapons.set(3, 1);
  $data.weapons[2].name = 'Synthetic Sword'; $data.weapons[3].name = 'Synthetic Sword＋５';
  assert.equal(e.combat.menuSkillUseStatus(e.art).weapon.id, 3);
  $data.weapons[3].wtype_id = 3;
  assert.equal(e.combat.menuSkillUseStatus(e.art).weapon.id, 2, 'an unusable refinement does not hide a valid base');
  $data.weapons[3].wtype_id = 2; $data.weapons[3].features.push(trait(23, 4, 2)); e.actor.mp = 30;
  assert.equal(e.combat.menuSkillUseStatus(e.art).weapon.id, 2, 'an unaffordable refinement falls back to a usable base');
  e.actor.learnSkill(101);
  assert.equal(e.combat.menuSkillUseStatus(e.art).requiresSwap, false, 'a currently usable art keeps the current weapon first');
});

test('borrowed stages preserve both native source and effective requirements and charge the effective cost', t => {
  const e = environment(t, { note: '<ステート変化:102,30>' }); e.actor.addState(30);
  $data.skills[102].required_wtype_id1 = 2; $data.skills[102].mp_cost = 30;
  let status = e.combat.menuSkillUseStatus(e.art);
  assert.equal(status.ok, true); assert.equal(status.skill.id, 102); assert.equal(status.costs.mp, 15);
  e.art.required_wtype_id1 = 1;
  status = e.combat.menuSkillUseStatus(e.art);
  assert.equal(status.ok, false, 'the transformed stage cannot bypass its root weapon requirement');
  e.art.required_wtype_id1 = 0; e.combat.skillCD[102] = G.time + 2;
  assert.equal(e.combat.menuSkillUseStatus(e.art).ok, false, 'the effective skill still observes its native cooldown');
  e.combat.skillCD[102] = 0; const enemy = e.addTarget();
  assert.equal(e.combat.useSkillFromMenu(e.art), true); assert.equal(enemy.b.hp, 9800); assert.equal(e.actor.mp, 85);
});

for (const reason of ['no target', 'wall', 'recovery', 'unaffordable', 'sealed', 'lost item']) test(`failed borrowed action (${reason}) never trades gear, spends resources or starts cooldown`, t => {
  const e = environment(t, { note: '<クールタイム:2>' });
  if (reason !== 'no target') e.addTarget();
  if (reason === 'wall') e.blocked.add('3,3,8');
  if (reason === 'recovery') e.combat.playerRecoveryUntil = G.time + 3;
  if (reason === 'unaffordable') e.actor.mp = 9;
  if (reason === 'sealed') $data.actors[1].features.push(trait(44, 101));
  if (reason === 'lost item') e.state.party.weapons.clear();
  const before = e.snapshot();
  assert.equal(e.combat.useSkillFromMenu(e.art), false); assert.equal(e.snapshot(), before);
  assert.equal(e.combat.menuWeaponVisual, undefined); assert.deepEqual(e.gains, []);
});

for (const reason of ['generation', 'map', 'leader', 'state', 'death', 'transfer']) test(`borrowed delayed hits are canceled by ${reason} changes and cannot leak into another action owner`, t => {
  const e = environment(t, { repeats: 3 }); const enemy = e.addTarget();
  assert.equal(e.combat.useSkillFromMenu(e.art), true); assert.equal(enemy.b.hp, 9800);
  if (reason === 'generation') e.combat.gen++;
  if (reason === 'map') e.map.mapId = 2;
  if (reason === 'leader') e.state.party.actors = [2, 1];
  if (reason === 'state') G.state = new GameState();
  if (reason === 'death') e.combat.playerDead = true;
  if (reason === 'transfer') e.map.transferring = true;
  e.advance(500);
  assert.equal(enemy.b.hp, 9800); assert.equal(e.actor.equips[0].id, 1);
  e.combat.heldSpecs(); assert.equal(e.combat.menuWeaponVisual, null);
});

test('a borrowed native Break retains its original armed timing and source calculation until the actual hit', t => {
  const e = environment(t, { name: 'Synthetic Break', effects: [{ code: 21, data_id: 8, value1: 1 }] });
  const enemy = e.addTarget();
  assert.equal(e.combat.useSkillFromMenu(e.art), true); assert.equal(enemy.b.hp, 10000);
  assert.equal(e.combat.breakArm.until, G.time + 3); assert.equal(e.combat.breakArmed(), e.art);
  const before = e.actor.mp;
  t.mock.method(e.combat, 'breakRoll', () => 0); t.mock.method(e.combat, 'hitPoint', () => new THREE.Vector3());
  e.combat.breakOnHit(enemy, e.art, e.camera.position);
  assert.equal(enemy.b.hp, 9800); assert.equal(e.actor.mp, before, 'the native Break path retains its existing no-payment behavior');
  assert.equal(e.combat.breakArm, null); assert.equal(e.actor.atk, 80);
  G.time += 4; assert.equal(e.combat.heldSpecs().weapon.item.id, 1);
});

test('real combat reset removes borrowed projectiles, visuals and all pending repeat ownership', t => {
  const e = environment(t, { repeats: 3 }); const enemy = e.addTarget();
  assert.equal(e.combat.useSkillFromMenu(e.art), true); assert.equal(enemy.b.hp, 9800);
  Object.assign(e.combat, { detached: [], popups: [], fx: [], fadingMarkers: [], waves: [], hazards: [], defeated: new Set(),
    quick: { close() {} }, hideBlade() {} });
  e.combat.allies.reset = () => {}; enemy.remove = () => {};
  e.combat.reset({ keepState: true }); e.advance(500);
  assert.equal(enemy.b.hp, 9800); assert.equal(e.combat.menuWeaponVisual, null); assert.equal(e.combat._menuWeaponContext, null);
  assert.deepEqual(e.combat.projectiles, []); assert.equal(e.actor.atk, 80); assert.equal(e.actor.equips[0].id, 1);
});

test('co-op PvP sends every delayed hit with borrowed stats and normal serializable gear', t => {
  const e = environment(t, { repeats: 3 });
  const plan = e.combat.menuSkillPlan(e.art), sent = [], gear = JSON.stringify(e.actor.equips);
  G.coop.sendPvp = (_id, _skill, _mult, _crit, actor) => sent.push([actor === e.actor, actor.atk, JSON.stringify(actor.toJSON().equips)]);
  G.ui.closeMenu();
  e.combat.withMenuWeapon(plan.context, () => e.combat.strikePlayerWith({ id: 'peer', x: 3, y: 0, z: 2 }, e.art));
  e.advance(240);
  assert.deepEqual(sent, Array(3).fill([true, 200, gear])); assert.equal(e.actor.atk, 80);
});

test('borrowed Break expires or disarms without leaving gear or a free attack behind', t => {
  const e = environment(t, { name: 'Synthetic Break', effects: [{ code: 21, data_id: 8, value1: 1 }] });
  const enemy = e.addTarget(), before = e.snapshot();
  assert.equal(e.combat.useSkillFromMenu(e.art), true); G.time += 4;
  assert.equal(e.combat.breakArmed(), null); assert.equal(e.combat.heldSpecs().weapon.item.id, 1);
  assert.equal(e.combat.useSkillFromMenu(e.art), true); e.combat.toggleDisarm(true);
  assert.equal(e.combat.breakArm, null); assert.equal(e.combat.menuWeaponVisual, null);
  assert.equal(enemy.b.hp, 10000); assert.equal(e.snapshot(), before);
});

test('real PC and VR source/restore builds retire each owned model resource once while preserving shared textures and hands', async t => {
  const e = environment(t), descriptors = new Map();
  const replace = (key, value) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  };
  t.after(() => { for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  } });
  replace('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {},
    getImageData: (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4).fill(255) }) }) }) });
  replace('Image', class {
    set src(_url) { this.width = 384; this.height = 48; queueMicrotask(() => this.onload()); }
  });
  t.mock.method(globalThis, 'fetch', async url => Response.json(String(url).includes('/api/manifest')
    ? { files: ['Graphics/System/IconSet.png'] } : {}));
  await initAssets(); await loadUiAssets();
  $data.weapons[1].wtype_id = 10; $data.classes[1].features.push(trait(51, 10));
  $data.armors[1] = { id: 1, name: 'Fallback shield', etype_id: 1, atype_id: 1, icon_index: -1, features: [], params: Array(8).fill(0) };
  e.actor.equips[1] = { kind: 'armor', id: 1 }; e.addTarget();
  const shared = new THREE.Texture(); let textureDisposals = 0;
  shared.addEventListener('dispose', () => textureDisposals++);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  let handDisposals = 0; hand.geometry.addEventListener('dispose', () => handDisposals++);
  const watch = groups => {
    const counts = new Map();
    for (const group of groups) group?.traverse(object => {
      for (const resource of [object.geometry, ...[object.material].flat()]) if (resource && !counts.has(resource)) {
        counts.set(resource, 0); resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1));
      }
    });
    assert.ok(counts.size > 0); return counts;
  };
  for (const vr of [false, true]) {
    G.vr = vr; G.time += 2;
    G.input.controllers = { right: { grip: new THREE.Group(), ray: new THREE.Group() },
      left: { grip: new THREE.Group(), ray: new THREE.Group() } };
    G.input.controllers.right.grip.add(hand);
    e.combat.refreshEquipment();
    const original = [e.combat.weapon, e.combat.shield];
    let voxel;
    original[0].traverse(object => { if (object.userData.source === 'icon') voxel = object; });
    assert.ok(voxel, 'the actual per-build icon voxel path must be exercised');
    const mesh = voxel.children.find(object => object.isMesh); mesh.material.map = shared;
    original[0].add(new THREE.Mesh(mesh.geometry, [mesh.material, mesh.material]));
    if (vr) assert.ok(original[0].userData.laser, 'the retired VR gun includes its separately allocated laser');
    const originalCounts = watch(original);
    assert.equal(e.combat.useSkillFromMenu(e.art), true); e.combat.refreshEquipment();
    for (const group of original) assert.equal(group.parent, null);
    for (const count of originalCounts.values()) assert.equal(count, 1);
    const borrowed = [e.combat.weapon, e.combat.shield], borrowedCounts = watch(borrowed);
    e.combat.refreshEquipment();
    assert.deepEqual([e.combat.weapon, e.combat.shield], borrowed, 'unchanged equip key must not rebuild');
    for (const count of borrowedCounts.values()) assert.equal(count, 0);
    G.time += 1; e.combat.refreshEquipment();
    for (const group of borrowed) assert.equal(group.parent, null);
    for (const count of originalCounts.values()) assert.equal(count, 1, 'a later retirement cannot redispose a previous build');
    for (const count of borrowedCounts.values()) assert.equal(count, 1);
    assert.equal(e.combat.heldSpecs().weapon.item.id, 1);
    const currentCounts = watch([e.combat.weapon, e.combat.shield]); e.combat.refreshEquipment();
    for (const count of currentCounts.values()) assert.equal(count, 0, 'live restored models remain usable');
    assert.equal(handDisposals, 0); assert.equal(textureDisposals, 0);
  }
});

test('an offhand-only weapon cannot become a duplicate discount, while a real second bag copy may be used', t => {
  const e = environment(t); $data.classes[1].features.push(trait(55, 1));
  e.actor.equips[1] = { kind: 'weapon', id: 2 }; e.state.party.weapons.clear(); e.actor.mp = 6;
  assert.equal(e.actor.skillMpCost(e.art), 10); assert.ok(e.actor.allSkills().some(s => s.id === 101));
  assert.ok(e.combat.menuSkills().some(s => s.id === 101), 'the actual offhand grant remains in the native skill list');
  const before = e.snapshot(), blocked = e.combat.menuSkillUseStatus(e.art);
  assert.equal(blocked.ok, false); assert.equal(blocked.costs.mp, 10); assert.equal(blocked.requiresSwap, false);
  assert.equal(e.combat.useSkillFromMenu(e.art), false); assert.equal(e.snapshot(), before);
  e.state.party.weapons.set(2, 1);
  const allowed = e.combat.menuSkillUseStatus(e.art);
  assert.equal(allowed.ok, true); assert.equal(allowed.costs.mp, 5); assert.equal(allowed.requiresSwap, true);
  const gear = JSON.stringify(e.actor.equips), enemy = e.addTarget();
  assert.equal(e.combat.useSkillFromMenu(e.art), true); assert.equal(enemy.b.hp, 9680); assert.equal(e.actor.mp, 1);
  assert.equal(e.state.party.itemCount('weapon', 2), 1); assert.equal(JSON.stringify(e.actor.equips), gear);
});
