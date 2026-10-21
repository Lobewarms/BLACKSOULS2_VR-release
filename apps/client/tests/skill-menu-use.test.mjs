import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';

globalThis.location = { search: '?lang=en' };
globalThis.addEventListener ||= () => {};
const { $data } = await import('../src/data/data.js');
const { GameState, BattlerBase } = await import('../src/game/state.js');
const { GameMap } = await import('../src/world/gamemap.js');
const { CombatSystem } = await import('../src/combat/combat.js');
const { UI } = await import('../src/ui/ui.js');
const { T } = await import('../src/world/mapmesh.js');
const { clearEdgeCache } = await import('../src/world/collision.js');
const feature = (code, data_id, value = 0) => ({ code, data_id, value });
const skill = (id = 101, extra = {}) => ({ __class: 'RPG::Skill', id, name: `Synthetic skill ${id}`,
  description: 'Synthetic skill description.', note: '', icon_index: 0, stype_id: 1,
  occasion: 0, scope: 11, hit_type: 0, success_rate: 100, repeats: 1, animation_id: 0,
  mp_cost: 20, tp_cost: 7, tp_gain: 0, required_wtype_id1: 0, required_wtype_id2: 0,
  damage: { type: 3, formula: '120', element_id: 0, variance: 0, critical: false }, effects: [], ...extra });
const command = (code, parameters = []) => ({ code, parameters, indent: 0 });

function environment(t, obj = skill()) {
  const saved = { ...G }, old = { ...$data };
  t.after(() => { Object.assign(G, saved); Object.assign($data, old); });
  const stats = [1000, 200, 80, 30, 100, 30, 30, 30];
  Object.assign($data, {
    actors: [null, { id: 1, name: 'Synthetic actor', class_id: 1, initial_level: 1,
      equips: [1, 0, 0, 0, 0], note: '', features: [] }],
    classes: [null, { exp_params: [30, 20, 30, 30], learnings: [], note: '',
      features: [feature(41, 1), feature(51, 1), feature(22, 0, 1)],
      params: { xsize: 8, ysize: 2, data: new Int16Array([...stats, ...stats]) } }],
    weapons: [null, { id: 1, name: 'Synthetic blade', wtype_id: 1, note: '', features: [], params: Array(8).fill(0) }],
    armors: [], items: [], animations: [], states: [], skills: [], commonEvents: [],
    system: { currency_unit: 'Souls', sounds: [], skill_types: ['', 'Skills'] },
  });
  $data.states[9] = { id: 9, name: 'Synthetic transformation', note: '', features: [], restriction: 0 };
  $data.skills[obj.id] = obj;
  const state = new GameState(), map = new GameMap(); map.mapId = 1;
  const blockedEdges = new Set();
  map.grid = { w: 40, h: 40, valid: (x, y) => x >= 0 && x < 40 && y >= 0 && y < 40,
    region: () => 0, passable: (x, y, d) => !blockedEdges.has(`${x},${y},${d}`) };
  map.playerChar.fx = 3; map.playerChar.fy = 4;
  clearEdgeCache();
  Object.assign(G, { state, map, scripts: {}, settings: { difficulty: 1, fxBrightness: 0.5 },
    time: 10, coop: null, vr: false, audio: { playSystemSe() {}, playSe() {} },
    screen: { playAnimationOn() {} }, input: { controllers: {}, haptic() {} },
    floorAt: () => 0, solidTopAt: () => 0, arena: null });
  map.playerChar.syncFromContinuous();
  state.party.actors = [1]; state.quickSlots = [{ kind: 'item', id: 77 }, ...Array(7).fill(null)];
  const actor = state.party.leader(); actor.learnSkill(obj.id); actor.hp = 400; actor.mp = 100; actor.tp = 50;
  const root = new THREE.Group(), camera = new THREE.PerspectiveCamera(); root.add(camera);
  camera.position.set(3.5 * T, 1.6, 4.5 * T);
  G.three = { camera }; G.player = { headWorld: out => out.copy(camera.position), forwardVec: () => new THREE.Vector3(0, 0, -1), dodge: { cooldown: 0 } };
  const toasts = [], bursts = [], animations = [], glow = new THREE.Texture();
  G.screen.playAnimationOn = (...args) => animations.push(args);
  const panel = () => ({ index: 0, visible: false,
    open(title, items, options) { Object.assign(this, { title, items, visible: true, ...options }); },
    close() { this.visible = false; } });
  const ui = G.ui = Object.assign(Object.create(UI.prototype), {
    menuOpen: true, sceneOpen: null, navigation: { close() {} }, menuOverview: { mesh: { visible: false } },
    list: panel(), grid: panel(), placeRoot() {}, toast: message => toasts.push(message),
  });
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), {
    root, battles: [], sideInterps: [], symbols: new Map(), skillCD: {}, enemies: [], puppets: new Map(), projectiles: [], stamina: 1,
    allies: { list: [], unitOf: () => null, showHeal() {} },
    glowTexture: () => glow, showArms() {}, popup() {}, popupAtPlayer() {}, spawnGlow() {},
    playerFollowUp() {}, restrainedBuzz() {}, weaponFx: { burst: (...args) => bursts.push(args) },
  });
  t.after(() => { combat.cancelReady(); glow.dispose(); });
  class TargetBattler extends BattlerBase {
    paramBase(i) { return [1000, 200, 80, 30, 100, 30, 30, 30][i]; }
  }
  const addTarget = (fx = 3, fy = 2) => {
    const b = new TargetBattler(); b.hp = b.mhp; b.mp = b.mmp;
    const battle = { done: false, enemies: [] };
    const enemy = { b, fx, fy, h: 1.8, r: 0.3, hr: 0.3, state: 'chase', battle, hidden: false, untargetable: false,
      mesh: new THREE.Group(), knock: { x: 0, y: 0 }, stateTimers: {},
      get alive() { return b.hp > 0 && !b.isState(1); },
      worldPos: out => out.set((enemy.fx + 0.5) * T, 0, (enemy.fy + 0.5) * T), drawBar() {},
    };
    battle.enemies.push(enemy); combat.battles.push(battle); combat.enemies.push(enemy); return enemy;
  };
  const selectUse = () => { ui.showSkillActions({ id: obj.id }); ui.list.onSelect(0, ui.list.items[0]); };
  const advance = seconds => {
    for (let left = seconds; left > 1e-9;) {
      const dt = Math.min(left, 1 / 60); left -= dt; G.time += dt;
      combat.updateBonusActions(dt, false); combat.updateProjectiles(dt, false);
    }
  };
  return { actor, combat, ui, state, map, obj, toasts, bursts, animations, selectUse, addTarget, blockedEdges, advance };
}

test('menu support casts heal directly and pay HP, MP and TP once before resuming the field action', t => {
  const e = environment(t, skill(101, { note: '<消費HP 30>', repeats: 2 }));
  e.ui.showSkillActions({ id: 101 }); assert.equal(e.ui.list.items[0].enabled, true);
  e.selectUse();
  assert.deepEqual([e.actor.hp, e.actor.mp, e.actor.tp], [610, 80, 43]);
  assert.equal(e.ui.menuOpen, false); assert.equal(e.combat.ready, undefined);
});

test('a menu common-event skill closes the menu and runs its original interpreter exactly once per use', t => {
  const e = environment(t, skill(101, { scope: 0, repeats: 5, damage: { type: 0 }, effects: [{ code: 44, data_id: 1 }] }));
  $data.commonEvents[1] = { id: 1, trigger: 0, list: [command(122, [88, 88, 1, 0, 1]), command(0)] };
  e.selectUse();
  assert.equal(e.ui.menuOpen, false); assert.deepEqual(e.map.reservedCommon, [1]);
  assert.deepEqual([e.actor.mp, e.actor.tp], [80, 43]);
  assert.equal(e.map.setupStartingEvent(), true); e.map.interpreter.update();
  assert.equal(e.state.v(88), 1); assert.deepEqual(e.map.reservedCommon, []);
});

test('battle-only support can be used from the menu and returns to the ongoing fight', t => {
  const e = environment(t, skill(101, { occasion: 1 }));
  e.combat.battles = [{ done: false, enemies: [] }];
  e.selectUse(); assert.equal(e.actor.hp, 520); assert.equal(e.actor.mp, 80); assert.equal(e.ui.menuOpen, false);
});

test('using a spell from the real menu immediately launches at a valid target and pays once without changing quick slots', t => {
  const e = environment(t, skill(101, { scope: 1, hit_type: 2,
    damage: { type: 1, formula: '100', element_id: 0, variance: 0, critical: false } }));
  const enemy = e.addTarget();
  const slots = structuredClone(e.state.quickSlots);
  e.ui.showSkillActions({ id: 101 });
  assert.equal(e.ui.list.items[0].enabled, true);
  assert.match(e.ui.list.items[0].desc, /immediately|visible|target/i);
  e.selectUse();
  assert.equal(e.ui.menuOpen, false); assert.equal(e.combat.ready, undefined); assert.equal(e.combat.skillArm, null);
  assert.equal(e.combat.projectiles.length, 1); assert.equal(e.combat.projectiles[0].usable, e.obj);
  assert.equal(e.combat.projectiles[0].target, enemy);
  assert.deepEqual([e.actor.mp, e.actor.tp], [80, 43]);
  e.advance(1);
  assert.equal(enemy.b.hp, 900); assert.deepEqual([e.actor.mp, e.actor.tp], [80, 43]);
  assert.deepEqual(e.state.quickSlots, slots);
});

test('a menu weapon art immediately lands all authored repeats and uses the original weapon animation without arming', t => {
  const e = environment(t, skill(101, { scope: 1, hit_type: 1, repeats: 3, animation_id: -1, note: '<クールタイム:2>',
    damage: { type: 1, formula: 'a.atk', element_id: 0, variance: 0, critical: false } }));
  $data.weapons[1].animation_id = 17;
  const enemy = e.addTarget();
  e.selectUse();
  assert.equal(e.ui.menuOpen, false); assert.equal(e.combat.skillArm, null); assert.equal(e.combat.ready, undefined);
  assert.equal(enemy.b.hp, 920); assert.equal(e.bursts.length, 0);
  assert.deepEqual([e.actor.mp, e.actor.tp], [80, 43]);
  const cooldown = e.combat.skillCD[101];
  e.advance(0.24);
  assert.equal(enemy.b.hp, 760); assert.deepEqual([e.actor.mp, e.actor.tp], [80, 43]);
  assert.equal(e.combat.skillCD[101], cooldown);
  assert.ok(Math.abs(cooldown - G.time - (e.combat.coolSeconds(e.obj) - 0.24)) < 1e-8);
  assert.equal(e.animations.length, 1); assert.equal(e.animations[0][1], 17);
});

const invalidTargets = [
  ['no enemy', () => {}],
  ['behind the player', e => { e.addTarget(3, 8); }],
  ['out of range', e => { e.addTarget(3, 35); }],
  ['blocked by a wall', e => { e.addTarget(); e.blockedEdges.add('3,3,8'); }],
  ['hidden enemy', e => { e.addTarget().hidden = true; }],
  ['untargetable enemy', e => { e.addTarget().untargetable = true; }],
  ['unjoined co-op fight', e => { const enemy = e.addTarget(); enemy.puppet = true; enemy.outOfFight = true; }],
  ['invalid enemy position', e => { e.addTarget(NaN, 2); }],
  ['dead enemy', e => { e.addTarget().b.hp = 0; }],
];
for (const vr of [false, true]) for (const [reason, arrange] of invalidTargets) {
  test(`${vr ? 'VR' : 'desktop'} immediate menu skill with ${reason} keeps resources, cooldowns and menu unchanged`, t => {
    const e = environment(t, skill(101, { scope: 1, hit_type: 1, note: '<消費HP 30>\n<クールタイム:2>',
      damage: { type: 1, formula: '100', element_id: 0, variance: 0, critical: false }, effects: [{ code: 44, data_id: 1 }] }));
    G.vr = vr; arrange(e);
    $data.commonEvents[1] = { id: 1, trigger: 0, list: [command(122, [88, 88, 1, 0, 1]), command(0)] };
    e.combat.disarmed = true;
    const previousArm = e.combat.skillArm = { skill: skill(102) };
    const slots = structuredClone(e.state.quickSlots);
    e.selectUse();
    assert.equal(e.ui.menuOpen, true); assert.deepEqual([e.actor.hp, e.actor.mp, e.actor.tp], [400, 100, 50]);
    assert.equal(e.combat.skillCD[101], undefined); assert.equal(e.combat.disarmed, true);
    assert.equal(e.combat.skillArm, previousArm); assert.equal(e.combat.ready, undefined);
    assert.equal(e.combat.projectiles.length, 0); assert.deepEqual(e.map.reservedCommon, []); assert.equal(e.combat.sideInterps.length, 0);
    assert.ok(e.toasts.some(message => /no target/i.test(message))); assert.deepEqual(e.state.quickSlots, slots);
  });
}

test('all-enemy immediate casts preserve targets, repeats and one cost/common event for the complete action', t => {
  const e = environment(t, skill(101, { scope: 2, hit_type: 1, repeats: 3, note: '<クールタイム:2>',
    damage: { type: 1, formula: '100', element_id: 0, variance: 0, critical: false }, effects: [{ code: 44, data_id: 1 }] }));
  const first = e.addTarget(), second = e.addTarget(4, 2), behind = e.addTarget(3, 8);
  $data.commonEvents[1] = { id: 1, trigger: 0, list: [command(122, [88, 88, 1, 0, 1]), command(0)] };
  e.selectUse();
  assert.deepEqual([first.b.hp, second.b.hp, behind.b.hp], [900, 900, 1000]);
  assert.equal(e.combat.sideInterps.length, 1); e.combat.sideInterps[0].update(); assert.equal(e.state.v(88), 1);
  const cooldown = e.combat.skillCD[101];
  e.advance(0.24);
  assert.deepEqual([first.b.hp, second.b.hp, behind.b.hp], [700, 700, 1000]);
  assert.deepEqual([e.actor.mp, e.actor.tp], [80, 43]); assert.equal(e.combat.sideInterps.length, 1);
  assert.equal(e.combat.skillCD[101], cooldown); assert.equal(e.ui.menuOpen, false);
});

test('random-target immediate casts keep the authored target count and repeats without multiplying action costs', t => {
  t.mock.method(Math, 'random', () => 0);
  const e = environment(t, skill(101, { scope: 4, hit_type: 1, repeats: 2,
    damage: { type: 1, formula: '100', element_id: 0, variance: 0, critical: false } }));
  const first = e.addTarget(), second = e.addTarget(4, 2);
  e.selectUse(); e.advance(0.12);
  assert.deepEqual([first.b.hp, second.b.hp], [600, 1000], 'two random targets each receive two repeats');
  assert.deepEqual([e.actor.mp, e.actor.tp], [80, 43]); assert.equal(e.ui.menuOpen, false);
});

for (const vr of [false, true]) test(`${vr ? 'VR' : 'desktop'} quick slots still prepare spells and weapon arts without spending early`, t => {
  const e = environment(t, skill(101, { scope: 1, hit_type: 2,
    damage: { type: 1, formula: '100', element_id: 0, variance: 0, critical: false } }));
  G.vr = vr; e.ui.closeMenu();
  assert.equal(e.combat.useQuickEntry({ kind: 'skill', id: 101 }), true);
  assert.equal(e.combat.ready.obj, e.obj); assert.ok(e.combat.ready.fx.parent);
  assert.equal(e.combat.projectiles.length, 0); assert.deepEqual([e.actor.mp, e.actor.tp], [100, 50]);
  e.combat.cancelReady();
  const art = $data.skills[102] = skill(102, { scope: 1, hit_type: 1,
    damage: { type: 1, formula: 'a.atk', element_id: 0, variance: 0, critical: false } });
  e.actor.learnSkill(102);
  assert.equal(e.combat.useQuickEntry({ kind: 'skill', id: 102 }), true);
  assert.equal(e.combat.skillArm.skill, art); assert.deepEqual([e.actor.mp, e.actor.tp], [100, 50]);
  assert.equal(e.combat.takeArmedSkill(e.actor), art); assert.deepEqual([e.actor.mp, e.actor.tp], [80, 43]);
});

test('an accepted immediate cast cancels older prepared visuals without charging them or changing registered slots', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const e = environment(t, skill(101, { scope: 1, hit_type: 2,
    damage: { type: 1, formula: '100', element_id: 0, variance: 0, critical: false } }));
  e.combat.useQuickEntry({ kind: 'skill', id: 101 }); const previous = e.combat.ready;
  e.addTarget();
  assert.equal(e.combat.useSkillFromMenu(e.obj), true);
  assert.equal(e.combat.ready, null); assert.equal(previous.fx.parent, null); assert.equal(e.combat.projectiles.length, 1);
  assert.deepEqual([e.actor.mp, e.actor.tp], [80, 43]); assert.equal(e.ui.menuOpen, false);
});

test('menu Dodge and Break retain their dedicated native control paths', t => {
  const e = environment(t, skill(12, { occasion: 1, mp_cost: 0, tp_cost: 0, damage: { type: 0 } }));
  e.selectUse(); assert.equal(G.player.wantDodge, true); assert.equal(e.ui.menuOpen, false);
  const brk = $data.skills[13] = skill(13, { name: 'Synthetic Break', occasion: 1, scope: 1, hit_type: 1,
    mp_cost: 0, tp_cost: 0, damage: { type: 0 }, effects: [{ code: 21, data_id: 8, value1: 1 }] });
  e.actor.learnSkill(13); e.ui.menuOpen = true;
  assert.equal(e.combat.useSkillFromMenu(brk), true);
  assert.equal(e.combat.breakArm.skill, brk); assert.equal(e.combat.breakArm.until, G.time + 3);
  assert.equal(e.combat.projectiles.length, 0); assert.equal(e.ui.menuOpen, false);
  assert.deepEqual([e.actor.mp, e.actor.tp], [100, 50]);
});

test('a skill action that becomes unaffordable after opening the menu cannot charge or close it', t => {
  const e = environment(t);
  e.ui.showSkillActions({ id: 101 }); assert.equal(e.ui.list.items[0].enabled, true);
  e.actor.mp = 19;
  e.ui.list.onSelect(0, e.ui.list.items[0]);
  assert.deepEqual([e.actor.hp, e.actor.mp, e.actor.tp], [400, 19, 50]);
  assert.equal(e.ui.menuOpen, true); assert.equal(e.combat.skillCD[101], undefined);
  assert.equal(e.combat.ready, undefined); assert.deepEqual(e.map.reservedCommon, []);
});

test('a death-immune zero-HP actor retains the original ability to use skills', t => {
  const e = environment(t);
  $data.actors[1].features.push(feature(14, 1)); e.actor.hp = 0;
  assert.equal(e.actor.stateResist(1), true); assert.equal(e.combat.skillUseStatus(e.obj).ok, true);
  e.selectUse();
  assert.deepEqual([e.actor.hp, e.actor.mp, e.actor.tp], [120, 80, 43]);
  assert.equal(e.ui.menuOpen, false);
});

const blocked = [
  ['unknown skill', e => { e.actor.forgetSkill(e.obj.id); }],
  ['dead caster', e => { e.actor.hp = 0; }],
  ['passive skill', e => { e.obj.occasion = 3; }],
  ['menu-only skill in combat', e => { e.obj.occasion = 2; e.combat.battles = [{ done: false }]; }],
  ['insufficient MP', e => { e.actor.mp = 19; }],
  ['insufficient TP', e => { e.actor.tp = 6; }],
  ['insufficient HP', e => { e.obj.note = '<消費HP 30>'; e.actor.hp = 30; }],
  ['sealed skill', e => { $data.actors[1].features.push(feature(44, e.obj.id)); }],
  ['sealed skill type', () => { $data.actors[1].features.push(feature(42, 1)); }],
  ['wrong equipment', e => { e.obj.required_wtype_id1 = 2; }],
  ['cooldown', e => { e.combat.skillCD[e.obj.id] = G.time + 3; }],
  ['spectator', e => { e.combat.spectating = true; }],
  ['restrained caster', e => { e.combat.restrained = true; }],
  ['another consumable in use', e => { e.combat.healing = { id: 4 }; }],
];
for (const [label, change] of blocked) test(`menu and quick use both reject ${label} without payment or closing`, t => {
  const e = environment(t); change(e);
  const before = [e.actor.hp, e.actor.mp, e.actor.tp];
  assert.equal(e.combat.skillUseStatus(e.obj).ok, false);
  e.ui.showSkillActions({ id: e.obj.id }); assert.equal(e.ui.list.items[0].enabled, false);
  e.ui.list.onSelect(0, e.ui.list.items[0]);
  assert.equal(e.combat.useQuickEntry({ kind: 'skill', id: e.obj.id }), false);
  assert.equal(e.ui.menuOpen, true); assert.deepEqual([e.actor.hp, e.actor.mp, e.actor.tp], before);
  assert.equal(e.combat.ready, undefined); assert.equal(e.combat.skillArm, undefined);
  assert.deepEqual(e.map.reservedCommon, []);
});

const transformedBlocks = [
  ['passive result', s => { s.occasion = 3; }],
  ['menu-only result in combat', s => { s.occasion = 2; }],
  ['sealed result', s => { $data.actors[1].features.push(feature(44, s.id)); }],
  ['unaffordable result', s => { s.mp_cost = 101; }],
  ['wrong result equipment', s => { s.required_wtype_id1 = 2; }],
  ['cooling result', (s, e) => { e.combat.skillCD[s.id] = G.time + 5; }],
];
for (const [label, change] of transformedBlocks) test(`state-transformed menu skills reject ${label} without charging the source`, t => {
  const e = environment(t, skill(101, { note: '<ステート変化:102,9>' }));
  const transformed = $data.skills[102] = skill(102); e.actor.addState(9); e.combat.battles = [{ done: false }];
  change(transformed, e);
  assert.equal(e.combat.skillUseStatus(e.obj).ok, false);
  assert.equal(e.combat.useSkillFromMenu(e.obj), false); assert.equal(e.ui.menuOpen, true);
  assert.deepEqual([e.actor.hp, e.actor.mp, e.actor.tp], [400, 100, 50]); assert.deepEqual(e.map.reservedCommon, []);
});

test('equipment-granted and state-transformed known skills use the effective skill without learning it separately', t => {
  const e = environment(t, skill(101, { note: '<ステート変化:102,9>' }));
  e.actor.forgetSkill(101); $data.weapons[1].features.push(feature(43, 101));
  const transformed = $data.skills[102] = skill(102, { mp_cost: 9, tp_cost: 2, damage: { type: 3, formula: '70', variance: 0, element_id: 0 } });
  e.actor.addState(9);
  assert.equal(e.actor.skills.includes(102), false); assert.equal(e.combat.skillUseStatus(e.obj).skill, transformed);
  assert.equal(e.combat.useSkillFromMenu(e.obj), true);
  assert.deepEqual([e.actor.hp, e.actor.mp, e.actor.tp], [470, 91, 48]); assert.equal(e.ui.menuOpen, false);
});
