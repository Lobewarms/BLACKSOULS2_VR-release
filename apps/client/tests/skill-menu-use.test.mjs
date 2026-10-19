import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';

globalThis.location = { search: '?lang=en' };
globalThis.addEventListener ||= () => {};
const { $data } = await import('../src/data/data.js');
const { GameState } = await import('../src/game/state.js');
const { GameMap } = await import('../src/world/gamemap.js');
const { CombatSystem } = await import('../src/combat/combat.js');
const { UI } = await import('../src/ui/ui.js');
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
      features: [feature(41, 1), feature(51, 1)],
      params: { xsize: 8, ysize: 2, data: new Int16Array([...stats, ...stats]) } }],
    weapons: [null, { id: 1, name: 'Synthetic blade', wtype_id: 1, note: '', features: [], params: Array(8).fill(0) }],
    armors: [], items: [], animations: [], states: [], skills: [], commonEvents: [],
    system: { currency_unit: 'Souls', sounds: [], skill_types: ['', 'Skills'] },
  });
  $data.states[9] = { id: 9, name: 'Synthetic transformation', note: '', features: [], restriction: 0 };
  $data.skills[obj.id] = obj;
  const state = new GameState(), map = new GameMap(); map.mapId = 1;
  Object.assign(G, { state, map, scripts: {}, settings: { difficulty: 1, fxBrightness: 0.5 },
    time: 10, coop: null, vr: false, audio: { playSystemSe() {}, playSe() {} },
    screen: { playAnimationOn() {} }, input: { controllers: {}, haptic() {} } });
  state.party.actors = [1]; state.quickSlots = [{ kind: 'item', id: 77 }, ...Array(7).fill(null)];
  const actor = state.party.leader(); actor.learnSkill(obj.id); actor.hp = 400; actor.mp = 100; actor.tp = 50;
  const root = new THREE.Group(), camera = new THREE.PerspectiveCamera(); root.add(camera);
  G.three = { camera }; G.player = { headWorld: out => out.set(0, 1.6, 0), dodge: { cooldown: 0 } };
  const toasts = [], bursts = [], glow = new THREE.Texture();
  const panel = () => ({ index: 0, visible: false,
    open(title, items, options) { Object.assign(this, { title, items, visible: true, ...options }); },
    close() { this.visible = false; } });
  const ui = G.ui = Object.assign(Object.create(UI.prototype), {
    menuOpen: true, sceneOpen: null, navigation: { close() {} }, menuOverview: { mesh: { visible: false } },
    list: panel(), grid: panel(), placeRoot() {}, toast: message => toasts.push(message),
  });
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), {
    root, battles: [], sideInterps: [], symbols: new Map(), skillCD: {},
    allies: { list: [], unitOf: () => null, showHeal() {} },
    glowTexture: () => glow, showArms() {}, popupAtPlayer() {}, spawnGlow() {},
    playerFollowUp() {}, restrainedBuzz() {}, weaponFx: { burst: (...args) => bursts.push(args) },
  });
  t.after(() => { combat.cancelReady(); glow.dispose(); });
  const selectUse = () => { ui.showSkillActions({ id: obj.id }); ui.list.onSelect(0, ui.list.items[0]); };
  return { actor, combat, ui, state, map, obj, toasts, bursts, selectUse };
}

test('menu support casts heal directly and pay HP, MP and TP once while leaving the menu open', t => {
  const e = environment(t, skill(101, { note: '<消費HP 30>', repeats: 2 }));
  e.ui.showSkillActions({ id: 101 }); assert.equal(e.ui.list.items[0].enabled, true);
  e.selectUse();
  assert.deepEqual([e.actor.hp, e.actor.mp, e.actor.tp], [610, 80, 43]);
  assert.equal(e.ui.menuOpen, true); assert.equal(e.combat.ready, undefined);
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

test('using an enemy skill from the real menu readies it without paying early or changing quick slots', t => {
  const e = environment(t, skill(101, { scope: 1, hit_type: 2,
    damage: { type: 1, formula: '100', element_id: 0, variance: 0, critical: false } }));
  const slots = structuredClone(e.state.quickSlots);
  e.ui.showSkillActions({ id: 101 });
  assert.equal(e.ui.list.items[0].enabled, true);
  assert.match(e.ui.list.items[0].desc, /aim|attack|click|trigger/i);
  e.selectUse();
  assert.equal(e.ui.menuOpen, false); assert.equal(e.combat.ready.obj, e.obj); assert.equal(e.combat.ready.kind, 'skill');
  assert.deepEqual([e.actor.mp, e.actor.tp], [100, 50]); assert.equal(e.combat.skillCD[101], undefined);
  assert.deepEqual(e.state.quickSlots, slots); assert.ok(e.combat.ready.fx.parent);
});

test('a menu weapon art arms the existing next-hit path and pays only when that hit is taken', t => {
  const e = environment(t, skill(101, { scope: 1, hit_type: 1,
    damage: { type: 1, formula: 'a.atk', element_id: 0, variance: 0, critical: false } }));
  e.selectUse();
  assert.equal(e.ui.menuOpen, false); assert.equal(e.combat.skillArm.skill, e.obj);
  assert.equal(e.combat.ready, undefined); assert.deepEqual([e.actor.mp, e.actor.tp], [100, 50]);
  assert.equal(e.bursts.length, 1); assert.equal(e.bursts[0][1], 'armed');
  assert.equal(e.combat.takeArmedSkill(e.actor), e.obj);
  assert.deepEqual([e.actor.mp, e.actor.tp], [80, 43]);
  assert.equal(e.combat.takeArmedSkill(e.actor), null); assert.equal(e.actor.mp, 80);
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
  assert.equal(e.ui.menuOpen, true);
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
  assert.deepEqual([e.actor.hp, e.actor.mp, e.actor.tp], [470, 91, 48]); assert.equal(e.ui.menuOpen, true);
});
