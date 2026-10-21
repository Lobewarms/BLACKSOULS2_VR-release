import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { Input } from '../src/core/input.js';
import { GameState } from '../src/game/state.js';
import { GameMap } from '../src/world/gamemap.js';
import { evalRuby } from '../src/game/rubyexpr.js';

globalThis.location = { search: '?lang=en' };
globalThis.addEventListener ||= () => {};
const { UI } = await import('../src/ui/ui.js');
const { CombatSystem } = await import('../src/combat/combat.js');
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} vs ${expected}`);

function environment(t, fighting = true) {
  const before = { ...G }, data = { ...$data }, descriptors = new Map(), listeners = new Map();
  const replace = (key, value) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  };
  const listen = (type, fn) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); };
  class Field {}
  const document = { activeElement: null, hasFocus: () => true, pointerLockElement: null, addEventListener: listen,
    body: { appendChild() {} }, createElement: type => {
      if (type !== 'canvas') return Object.assign(new Field(), { tagName: 'INPUT', style: {}, addEventListener() {},
        setAttribute() {}, focus() { document.activeElement = this; }, blur() { document.activeElement = null; } });
      const texts = [];
      const ctx = new Proxy({ clearRect() { texts.length = 0; }, fillText(text) { texts.push(String(text)); },
        measureText: text => ({ width: String(text).length * 12 }),
        createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
      }, { get: (object, key) => key in object ? object[key] : () => {} });
      return { width: 0, height: 0, texts, getContext: () => ctx };
    } };
  replace('document', document); replace('HTMLInputElement', Field); replace('addEventListener', listen);
  t.after(() => {
    Object.assign(G, before); Object.assign($data, data);
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  const params = [1000, 200, 80, 30, 100, 40, 50, 60];
  Object.assign($data, {
    actors: [null, { id: 1, name: 'Synthetic actor', class_id: 1, initial_level: 1, equips: [0, 0, 0, 0, 0],
      features: [], note: '', character_name: '', face_name: '' }],
    classes: [null, { name: 'Synthetic class', note: '', features: [{ code: 41, data_id: 1, value: 1 }], learnings: [],
      exp_params: [30, 20, 30, 30], params: { xsize: 8, ysize: 2, data: new Int16Array([...params, ...params]) } }],
    weapons: [], armors: [], items: [], states: [], skills: [], animations: [], commonEvents: [],
    system: { currency_unit: 'Souls', sounds: [], skill_types: ['', 'Skills'], terms: { params: [] } },
  });
  const skill = (id, note = '<クールタイム:4>') => ({ __class: 'RPG::Skill', id, name: `Synthetic skill ${id}`, description: '',
    note, icon_index: id, stype_id: 1, occasion: 0, scope: 11, hit_type: 0, repeats: 1, success_rate: 100,
    animation_id: 0, mp_cost: 10, tp_cost: 0, tp_gain: 0, damage: { type: 0 },
    effects: [{ code: 11, data_id: 0, value1: 0, value2: 25 }] });
  for (const id of [1, 2]) $data.skills[id] = skill(id);
  $data.skills[3] = skill(3, '');
  $data.skills[469] = skill(469, '<ステート変化:470,30>'); $data.skills[470] = skill(470, '');
  const state = G.state = new GameState(); state.party.actors = [1]; state.quickSlots = [{ kind: 'skill', id: 1 }];
  const actor = state.party.leader(); actor.hp = 200; actor.mp = 100;
  for (const id of [1, 2, 3, 469]) actor.learnSkill(id);
  const map = G.map = new GameMap(); map.mapId = 1;
  const rect = { left: 0, top: 0, width: 1366, height: 768, right: 1366, bottom: 768 };
  const dom = { style: {}, focus() { document.activeElement = this; }, addEventListener: listen, getBoundingClientRect: () => rect };
  const scene = new THREE.Scene(), rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(75, 1366 / 768, 0.1, 100);
  scene.add(rig); rig.add(camera); camera.position.set(0, 1.6, 0);
  Object.assign(G, { time: 10, frame: 0, vr: false, xrAway: false, settings: { ...G.settings, skillBrowser: {} },
    scripts: {}, coop: null, theater: null, arena: null, pictures: null,
    audio: { playSystemSe() {}, playSe() {} }, screen: { playAnimationOn() {} }, saveSettings() {},
    player: { headWorld: out => camera.getWorldPosition(out), forwardVec: () => new THREE.Vector3(0, 0, -1), dodge: { cooldown: 0 } },
    three: { camera, rig, renderer: { domElement: dom } } });
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), {
    root: scene, gen: 1, skillCD: {}, battles: fighting ? [{ done: false, enemies: [] }] : [],
    enemies: [], puppets: new Map(), symbols: new Map(), projectiles: [], sideInterps: [], stamina: 1,
    allies: { list: [], unitOf: () => null, showHeal() {} }, popupAtPlayer() {}, playerFollowUp() {},
  });
  const input = G.input = new Input({}, dom), ui = G.ui = new UI(scene, camera, rig); ui.attachHud(null);
  const frame = (dt = 1 / 60) => {
    G.time += dt; G.frame++; combat.updateBonusActions(dt, false); ui.update(dt);
    input.endFrame(); scene.updateMatrixWorld(true);
  };
  const key = code => {
    for (const type of ['keydown', 'keyup']) {
      for (const fn of listeners.get(type) || []) fn({ code, key: code, target: dom, repeat: false, preventDefault() {} });
      frame();
    }
  };
  const xr = (hand, button) => {
    input.btn[hand][button] = true; input.btnPrev[hand][button] = false; frame();
    input.btn[hand][button] = false; input.btnPrev[hand][button] = true; frame(); input.btnPrev[hand][button] = false;
  };
  const open = vr => {
    if (G.vr) { xr('left', 5); ui.onMenu('skills'); frame(); } else key('KeyR');
    assert.equal(ui.menuSection, 'skills'); assert.equal(ui.menuOpen, true);
    if (vr && !G.vr) {
      G.vr = true; input.transitionViewMode(true);
      input.controllers.right = { ray: new THREE.Group(), grip: new THREE.Group() };
      ui.transitionViewMode(true); frame();
    }
  };
  const close = () => {
    if (G.vr) { xr('left', 5); if (ui.menuOpen) xr('left', 5); } else key('KeyR');
    assert.equal(ui.menuOpen, false);
  };
  frame(0);
  return { actor, state, map, combat, ui, input, frame, key, xr, open, close, jump(dt) { G.time += dt; G.frame++; } };
}

test('R uses battle commands while an entrance disables the exploration menu, then respects the flag after battle', t => {
  const e = environment(t, false), troopId = 901;
  const previousTroops = $data.troops;
  t.after(() => { $data.troops = previousTroops; });
  $data.troops = []; $data.troops[troopId] = { id: troopId };
  const battle = { done: false, enemies: [] };
  e.combat.startBattle = () => { e.combat.battles.push(battle); return battle; };
  e.map.interpreter.setup([
    { code: 135, indent: 0, parameters: [0] },
    { code: 301, indent: 0, parameters: [0, troopId, false, true] },
    { code: 0, indent: 0, parameters: [] },
  ]);
  e.map.interpreter.update();
  assert.equal(e.state.system.menuDisabled, true);
  assert.equal(e.map.interpreter.waitMode, 'battle');
  assert.equal(e.combat.inCombat, true);
  e.open(false); e.close();
  e.ui.openMenu(); e.key('KeyR');
  assert.equal(e.ui.menuSection, 'skills', 'R also switches from the ordinary battle menu');
  e.close();
  assert.equal(e.state.system.menuDisabled, true, 'opening Skills must not clear the native flag');
  battle.done = true; battle.result = 0; e.map.interpreter.update();
  assert.equal(e.combat.inCombat, false);
  e.key('KeyR');
  assert.equal(e.ui.menuOpen, false, 'an ended battle does not bypass exploration-menu restrictions');
});

for (const blocked of ['dialogue', 'script', 'transfer', 'shop', 'prompt', 'dead', 'arena']) {
  test(`R retains the ${blocked} guard during a battle with the exploration menu disabled`, t => {
    const e = environment(t);
    e.state.system.menuDisabled = true;
    if (blocked === 'dialogue') e.ui.showMessage({ lines: ['Synthetic dialogue'], position: 2 });
    if (blocked === 'script') e.map.interpreter.setup([{ code: 230, indent: 0, parameters: [60] }]);
    if (blocked === 'transfer') e.map.transferring = true;
    if (blocked === 'shop') e.ui.sceneOpen = 'shop';
    if (blocked === 'prompt') e.ui.prompt = { shown: true, left: 10 };
    if (blocked === 'dead') e.combat.playerDead = true;
    if (blocked === 'arena') G.arena = { busy: true };
    assert.equal(e.ui.toggleSkillsMenu(), false);
    assert.equal(e.ui.menuOpen, false);
    assert.equal(e.state.system.menuDisabled, true);
  });
}

for (const vr of [false, true]) test(`${vr ? 'VR' : 'PC'} R Skills keeps the same cooldown and blocked quick slot throughout a long menu pause`, t => {
  const e = environment(t); e.combat.payUsable($data.skills[1], 'skill'); e.open(vr);
  e.ui.skillsBrowser.setQuery('Synthetic skill 1'); e.frame();
  const remaining = e.combat.skillCooling($data.skills[1]), mp = e.actor.mp;
  assert.ok(remaining > 5.9 && remaining <= 6);
  const reason = e.ui.grid.items[0].reason;
  e.frame(50);
  near(e.combat.skillCooling($data.skills[1]), remaining, 'menu pause cannot spend a skill cooldown');
  assert.equal(e.ui.grid.items[0].available, false); assert.equal(e.ui.grid.items[0].reason, reason);
  if (vr) e.xr('right', 4); else e.key('Enter');
  assert.equal(e.actor.mp, mp); assert.equal(e.ui.menuOpen, true);
  assert.equal(e.combat.useQuickEntry(e.state.quickSlots[0]), false, 'quick slot reads the same frozen cooldown');
  e.close(); const resumed = e.combat.skillCooling($data.skills[1]); e.frame(1.25);
  near(e.combat.skillCooling($data.skills[1]), resumed - 1.25, 'active play resumes the same countdown');
  e.frame(remaining + 1); assert.equal(e.combat.skillCooling($data.skills[1]), 0);
  assert.equal(e.combat.useQuickEntry(e.state.quickSlots[0]), true); assert.equal(e.actor.mp, mp - 10);
});

test('a cooldown created during an unobserved long pause starts now without inheriting the preceding paused elapsed', t => {
  const e = environment(t); e.combat.payUsable($data.skills[1], 'skill'); e.open(false);
  const old = e.combat.skillCooling($data.skills[1]); e.jump(100);
  e.combat.payUsable($data.skills[2], 'skill');
  near(e.combat.skillCooling($data.skills[1]), old, 'existing deadline catches up before a new write');
  near(e.combat.skillCooling($data.skills[2]), 6, 'new cooldown does not become106seconds');
  const deadlines = { ...e.combat.skillCD };
  for (let n = 0; n < 20; n++) {
    e.combat.skillCooling($data.skills[1]); e.combat.menuSkillUseStatus($data.skills[2]); e.ui.update(0);
  }
  assert.deepEqual(e.combat.skillCD, deadlines, 'many profile/browser getters in one frame cannot shift deadlines twice');
});

test('the synchronized setter uses elapsed seconds, preserves extendOnly maximum and never revives an expired cooldown', t => {
  const e = environment(t); e.open(false); e.combat.setSkillCooldown(1, 9);
  e.jump(40); e.combat.setSkillCooldown($data.skills[1], 6, { extendOnly: true });
  near(e.combat.skillCooling($data.skills[1]), 9, 'extendOnly compares against the caught-up old deadline');
  e.combat.setSkillCooldown(2, 0); e.jump(20);
  assert.equal(e.combat.skillCooling($data.skills[2]), 0, 'paused elapsed cannot revive a ready skill');
  e.combat.setSkillCooldown(1, 3); near(e.combat.skillCooling($data.skills[1]), 3, 'ordinary assignment replaces the caught-up deadline');
});

test('native stage-root cooldown remains frozen and a late stage write extends rather than truncating it', t => {
  const e = environment(t); e.open(false); e.combat.payUsable($data.skills[469], 'skill');
  near(e.combat.skillCooling($data.skills[469]), 6, 'native stage root has one full turn');
  e.frame(20); near(e.combat.skillCooling($data.skills[469]), 6, 'stage root pauses with the menu');
  e.combat.setSkillCooldown(469, 9); e.jump(50); e.combat.stageCool($data.skills[470]);
  near(e.combat.skillCooling($data.skills[469]), 9, 'later stage cannot truncate a longer existing root cooldown');
  assert.equal(e.combat.skillCooling($data.skills[470]), 0, 'the root owns the inter-stage lock');
});

test('original cooldown-removal scripts apply their explicit turn change while ordinary elapsed time stays paused', t => {
  const e = environment(t); e.combat.payUsable($data.skills[1], 'skill'); e.open(false);
  const before = e.combat.skillCooling($data.skills[1]); e.jump(50);
  evalRuby('$game_temp.actor_loss_cool_time(1)');
  near(e.combat.skillCooling($data.skills[1]), before - 1.5, 'only the explicit native turn reduction is applied');
  e.jump(20); evalRuby('$game_temp.actor_loss_cool_time(99)');
  assert.equal(e.combat.skillCooling($data.skills[1]), 0); e.frame(40);
  assert.equal(e.combat.skillCooling($data.skills[1]), 0, 'a deliberately cleared cooldown remains ready');
});

test('field skills without any active fight still pause in R and resume outside it', t => {
  const e = environment(t, false); e.combat.payUsable($data.skills[1], 'skill'); e.open(false);
  assert.equal(e.combat.inCombat, false); const remaining = e.combat.skillCooling($data.skills[1]);
  e.frame(100); near(e.combat.skillCooling($data.skills[1]), remaining, 'cooldown pause does not depend on bonus-combat state');
  e.close(); const resumed = e.combat.skillCooling($data.skills[1]); e.frame(1);
  near(e.combat.skillCooling($data.skills[1]), resumed - 1, 'field play resumes cooldowns');
});

for (const vr of [false, true]) test(`${vr ? 'VR' : 'PC'} accepted support resumes gameplay and reopening Skills freezes its complete shared recovery`, t => {
  const e = environment(t); e.combat.payUsable($data.skills[1], 'skill'); e.open(vr);
  e.ui.skillsBrowser.setQuery('Synthetic skill 3'); e.frame(); const remaining = e.combat.skillCooling($data.skills[1]);
  if (vr) e.xr('right', 4); else e.key('Enter');
  const mp = e.actor.mp; assert.equal(e.ui.menuOpen, false, 'a real support action returns the player to gameplay');
  assert.ok(e.combat.skillCooling($data.skills[1]) <= remaining);
  e.open(vr);
  const active = e.combat.playerActiveUntil - G.time, recovery = e.combat.playerRecoveryUntil - G.time;
  const cooldown = e.combat.skillCooling($data.skills[1]); assert.ok(active > 0 && recovery > active);
  assert.equal(e.ui.grid.items[0].available, false); const reason = e.ui.grid.items[0].reason;
  e.frame(100);
  near(e.combat.playerActiveUntil - G.time, active, 'menu-origin active phase no longer runs behind Skills');
  near(e.combat.playerRecoveryUntil - G.time, recovery, 'menu-origin shared recovery no longer runs behind Skills');
  near(e.combat.skillCooling($data.skills[1]), cooldown, 'the ordinary skill cooldown pauses as well');
  assert.equal(e.ui.grid.items[0].reason, reason);
  if (vr) e.xr('right', 4); else e.key('Enter');
  assert.equal(e.actor.mp, mp); assert.equal(e.ui.menuOpen, true, 'a blocked action never closes the menu or charges');
  e.close(); e.frame(0.91); e.open(vr); assert.equal(e.ui.grid.items[0].available, true);
  if (vr) e.xr('right', 4); else e.key('Enter');
  assert.equal(e.actor.mp, mp - 10); assert.equal(e.ui.menuOpen, false);
});

test('eligible field support also returns to gameplay, while genuine field utility remains an inspecting action', t => {
  const e = environment(t, false); e.open(false); e.ui.skillsBrowser.setQuery('Synthetic skill 3'); e.frame();
  e.key('Enter'); assert.equal(e.ui.menuOpen, false); const mp = e.actor.mp;
  e.open(false); const recovery = e.combat.playerRecoveryUntil - G.time; assert.ok(recovery > 0);
  e.frame(30); near(e.combat.playerRecoveryUntil - G.time, recovery, 'field support recovery freezes when R is reopened');
  e.close(); e.frame(1);
  $data.skills[3].effects = [{ code: 42, data_id: 2, value1: 1 }]; e.open(false); e.key('Enter');
  assert.equal(e.actor.atk, 81); assert.equal(e.actor.mp, mp - 10);
  assert.equal(e.ui.menuOpen, true, 'outside-combat permanent utility has no combat recovery to escape');
});

test('field action recovery, native Break cooldown and an armed Break deadline keep their remaining time during R', t => {
  const e = environment(t); e.combat.beginPlayerAction(false, { active: 0.3, recovery: 0.9 });
  e.combat.breakCooldown = G.time + 4; e.combat.breakArm = { skill: $data.skills[1], until: G.time + 3 };
  e.open(false);
  const active = e.combat.playerActiveUntil - G.time, recovery = e.combat.playerRecoveryUntil - G.time;
  const cooldown = e.combat.breakCooldown - G.time, armed = e.combat.breakArm.until - G.time;
  e.frame(20);
  near(e.combat.playerActiveUntil - G.time, active, 'ordinary active animation stays paused');
  near(e.combat.playerRecoveryUntil - G.time, recovery, 'ordinary field recovery stays paused');
  near(e.combat.breakCooldown - G.time, cooldown, 'native Break cooldown stays paused');
  near(e.combat.breakArm.until - G.time, armed, 'already armed Break retains its remaining native latch');
});
