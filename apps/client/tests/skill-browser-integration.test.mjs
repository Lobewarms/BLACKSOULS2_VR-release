import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { Input } from '../src/core/input.js';
import { GameState } from '../src/game/state.js';
import { GameMap } from '../src/world/gamemap.js';
import { tr } from '../src/ui/i18n.js';

globalThis.location = { search: '?lang=en' };
globalThis.addEventListener ||= () => {};
const { UI } = await import('../src/ui/ui.js');
const { CombatSystem } = await import('../src/combat/combat.js');

function canvas() {
  const record = { texts: [] };
  const ctx = new Proxy({ clearRect() { record.texts = []; },
    fillText(text, x, y) { record.texts.push({ text: String(text), x, y }); },
    measureText: text => ({ width: Array.from(String(text)).length * 14 }),
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  return { width: 0, height: 0, record, getContext: () => ctx };
}

function environment(t) {
  const before = { ...G }, data = { ...$data }, descriptors = new Map(), globals = new Map();
  const replace = (key, value) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  };
  const listen = (map, type, fn) => { if (!map.has(type)) map.set(type, []); map.get(type).push(fn); };
  class Field {
    constructor() { this.tagName = 'INPUT'; this.style = {}; this.value = ''; this.listeners = new Map(); }
    addEventListener(type, fn) { listen(this.listeners, type, fn); }
    setAttribute(key, value) { this[key] = value; }
    focus() { document.activeElement = this; for (const fn of this.listeners.get('focus') || []) fn({ target: this }); }
    blur() { if (document.activeElement === this) document.activeElement = null;
      this.onblur?.({ target: this }); for (const fn of this.listeners.get('blur') || []) fn({ target: this }); }
    remove() { this.parentNode = null; }
    select() {}
    setSelectionRange() {}
  }
  const document = { activeElement: null, pointerLockElement: null, hasFocus: () => true,
    addEventListener: (type, fn) => listen(globals, type, fn),
    body: { appendChild(field) { field.parentNode = this; }, removeChild(field) { field.parentNode = null; } },
    createElement: type => type === 'canvas' ? canvas() : new Field() };
  replace('document', document); replace('HTMLInputElement', Field);
  replace('addEventListener', (type, fn) => listen(globals, type, fn));
  t.after(() => {
    Object.assign(G, before); Object.assign($data, data);
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  const params = [1000, 200, 80, 30, 100, 40, 50, 60];
  Object.assign($data, {
    actors: [null, { id: 1, name: 'Synthetic hero', class_id: 1, initial_level: 1,
      character_name: '', face_name: '', equips: [1, 0, 0, 0, 0], features: [], note: '' },
      { id: 2, name: 'Other hero', class_id: 1, initial_level: 1, equips: [], features: [], note: '' }],
    classes: [null, { name: 'Synthetic class', note: '', features: [{ code: 41, data_id: 1, value: 1 },
      { code: 51, data_id: 1, value: 1 }], learnings: [], exp_params: [30, 20, 30, 30],
      params: { xsize: 8, ysize: 2, data: new Int16Array([...params, ...params]) } }],
    weapons: [null, { id: 1, name: 'Synthetic blade', wtype_id: 1, etype_id: 0, note: '',
      features: [{ code: 43, data_id: 5, value: 1 }], params: Array(8).fill(0) }],
    armors: [], items: [], states: [], skills: [], animations: [], commonEvents: [],
    system: { currency_unit: 'Souls', sounds: [], skill_types: ['', 'Skills'],
      terms: { basic: ['', 'Lv'], params: ['Max HP', 'Max MP', 'Attack', 'Defense', 'Magic', 'Magic defense', 'Agility', 'Luck'], etypes: [] } },
  });
  const skill = (id, name, extra = {}) => ({ __class: 'RPG::Skill', id, name,
    description: `Synthetic detail ${id}`, note: '', icon_index: id, stype_id: 1, occasion: 0,
    scope: 11, hit_type: 0, success_rate: 100, repeats: 1, animation_id: 0, mp_cost: 10, tp_cost: 0, tp_gain: 0,
    damage: { type: 0 }, effects: [{ code: 11, data_id: 0, value1: 0, value2: 25 }], ...extra });
  $data.skills[1] = skill(1, 'Mend', { note: '<クールタイム:1>' });
  $data.skills[2] = skill(2, '紺碧の祈り');
  $data.skills[3] = skill(3, 'RFAQ Remedy');
  $data.skills[4] = skill(4, 'Synthetic Ward', { effects: [{ code: 21, data_id: 30, value1: 1 }] });
  $data.skills[5] = skill(5, 'Granted Cut', { scope: 1, hit_type: 1, effects: [],
    damage: { type: 1, formula: '10', variance: 0, element_id: 0 } });
  $data.skills[6] = skill(6, 'Ritual', { scope: 0, effects: [{ code: 44, data_id: 1 }] });
  $data.skills[7] = skill(7, 'Hex', { scope: 1, effects: [{ code: 21, data_id: 31, value1: 1 }] });
  $data.skills[8] = skill(8, 'Burning Arc', { scope: 1, hit_type: 2, effects: [],
    damage: { type: 1, formula: '100', variance: 0, element_id: 3 } });
  for (const id of [30, 31]) $data.states[id] = { id, name: `Synthetic state ${id}`, icon_index: id,
    restriction: 0, features: [], note: '', auto_removal_timing: 0 };
  const state = G.state = new GameState(); state.party.actors = [1]; state.quickSlots = Array(8).fill(null);
  const actor = state.party.leader();
  for (const id of [1, 2, 3, 4, 6, 7, 8]) actor.learnSkill(id);
  actor.hp = 200; actor.mp = 100;
  const map = new GameMap(); map.mapId = 1;
  const local = new Map(), rect = { left: 0, top: 0, right: 1366, bottom: 768, width: 1366, height: 768 };
  const dom = { style: {}, tabIndex: 0, addEventListener: (type, fn) => listen(local, type, fn),
    focus() { document.activeElement = dom; }, getBoundingClientRect: () => rect };
  const scene = new THREE.Scene(), rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(75, rect.width / rect.height, 0.1, 100);
  scene.add(rig); rig.add(camera); camera.position.set(0, 1.6, 0);
  let writes = 0;
  Object.assign(G, { state, map, time: 10, frame: 1, vr: false, xrAway: false,
    settings: { ...G.settings, skillBrowser: {} }, scripts: {}, coop: null, theater: null, arena: null,
    pictures: null, audio: { playSystemSe() {}, playSe() {} }, screen: { playAnimationOn() {} },
    saveSettings: () => { writes++; }, player: { headWorld: out => camera.getWorldPosition(out),
      forwardVec: () => new THREE.Vector3(0, 0, -1), dodge: { cooldown: 0 } },
    three: { camera, rig, renderer: { domElement: dom } } });
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), {
    root: scene, battles: [{ done: false, enemies: [] }], sideInterps: [], symbols: new Map(),
    skillCD: {}, enemies: [], puppets: new Map(), projectiles: [], stamina: 1,
    allies: { list: [], unitOf: () => null, showHeal() {} },
    popupAtPlayer() {}, playerFollowUp() {},
  });
  const input = G.input = new Input({}, dom);
  const ui = G.ui = new UI(scene, camera, rig); ui.attachHud(null);
  const emit = (type, values = {}) => {
    const target = values.target || dom;
    const event = { target, preventDefault() {}, stopPropagation() { this.stopped = true; },
      repeat: false, isComposing: false, ...values };
    target['on' + type]?.(event);
    for (const fn of (target.listeners || local).get(type) || []) fn(event);
    if (!event.stopped) for (const fn of globals.get(type) || []) fn(event);
  };
  const frame = (dt = 1 / 60) => {
    G.time += dt; G.frame++; combat.updateBonusActions(dt, false); ui.update(dt);
    input.endFrame(); scene.updateMatrixWorld(true);
  };
  const key = (code, target = dom, values = {}) => {
    emit('keydown', { code, key: code, target, ...values }); frame(); emit('keyup', { code, target }); frame();
  };
  const point = (panel, x, y) => {
    scene.updateMatrixWorld(true);
    const p = panel.mesh.localToWorld(new THREE.Vector3((x / panel.canvas.width - 0.5) * panel.widthM,
      (0.5 - y / panel.canvas.height) * panel.heightM, 0)).project(camera);
    return { clientX: rect.left + (p.x + 1) * rect.width / 2, clientY: rect.top + (1 - p.y) * rect.height / 2 };
  };
  const click = (panel, x, y) => {
    const p = point(panel, x, y); emit('mousemove', p);
    emit('mousedown', { ...p, button: 0 }); emit('mouseup', { ...p, button: 0 }); frame();
  };
  return { ui, input, actor, state, map, combat, camera, rect, document, emit, frame, key, point, click, get writes() { return writes; } };
}

const ids = e => e.ui.grid.items.map(item => item.id);
const prefs = e => e.ui.skillsBrowser.session.prefs;
function clickSkill(e, name) {
  const p = e.ui.grid.panel;
  const row = p.canvas.record.texts.find(row => row.text.replace(/^★ /, '') === name
    && row.y >= e.ui.grid.gridTop && row.y < p.canvas.height - 52);
  assert.ok(row, `${name} must be painted as an actual selectable row`);
  e.click(p, row.x + 2, row.y);
}
function focusSearch(e) {
  e.click(e.ui.grid.panel, 100, e.ui.skillsBrowser.searchY + 18);
  const field = e.ui.skillsBrowser.searchInput;
  assert.equal(e.document.activeElement, field);
  return field;
}
function query(e, value) {
  const field = focusSearch(e); field.value = value;
  e.emit('input', { target: field }); e.frame(); return field;
}

test('a direct row click and fresh Enter use the actual skill once with native costs, cooldowns and recovery', t => {
  const e = environment(t); e.key('KeyR');
  assert.equal(e.writes, 0, 'opening and live redraws do not rewrite preferences');
  e.ui.skillsBrowser.setQuery('Mend'); e.frame(); clickSkill(e, 'Mend');
  assert.deepEqual([e.actor.hp, e.actor.mp], [225, 90]); assert.equal(e.ui.menuOpen, true);
  assert.equal(e.ui.list.visible, false, 'using a skill has no intermediate Use submenu');
  assert.ok(e.combat.skillCooling($data.skills[1]) > 0);
  e.key('Enter'); assert.deepEqual([e.actor.hp, e.actor.mp], [225, 90]);
  e.ui.skillsBrowser.setQuery('RFAQ'); e.frame();
  e.input.pointer.seen = false; e.key('Enter');
  assert.equal(e.actor.mp, 90, 'another skill cannot bypass the active cast');
  e.frame(0.31); e.key('Enter'); assert.equal(e.actor.mp, 90, 'ordinary trailing recovery still applies');
  e.frame(0.61); e.key('Enter'); assert.deepEqual([e.actor.hp, e.actor.mp], [250, 80]);
  e.ui.skillsBrowser.setQuery('Mend'); e.frame(e.combat.coolSeconds($data.skills[1]) + 1); e.key('Enter');
  assert.deepEqual([e.actor.hp, e.actor.mp], [275, 70]);
});

test('no-cooldown skill rows show shared recovery and live MP restrictions, then become usable again', t => {
  const e = environment(t); e.key('KeyR'); e.ui.skillsBrowser.setQuery('RFAQ'); e.frame();
  clickSkill(e, 'RFAQ Remedy'); assert.equal(e.actor.mp, 90);
  assert.equal(e.ui.grid.items[0].available, false, 'the row must not advertise ready during shared recovery');
  e.frame(0.95); assert.equal(e.ui.grid.items[0].available, true);
  e.actor.mp = 0; e.frame(); assert.equal(e.ui.grid.items[0].available, false);
  e.input.pointer.seen = false; e.key('Enter'); assert.equal(e.actor.hp, 225);
  e.actor.mp = 20; e.frame(); assert.equal(e.ui.grid.items[0].available, true);
  e.key('Enter'); assert.deepEqual([e.actor.hp, e.actor.mp], [250, 10]);
});

test('Favorites and native categories support empty lists without casting or assigning stale selection', t => {
  const e = environment(t); e.key('KeyR');
  e.click(e.ui.grid.panel, 70, 60); // Favorites category, not a skill row.
  assert.equal(prefs(e).tab, 'favorites'); assert.deepEqual(ids(e), []);
  assert.ok(!e.ui.skillsBrowser.selectedId); e.key('Enter'); e.key('KeyQ');
  assert.equal(e.ui.list.visible, false); assert.equal(e.actor.mp, 100);
  e.ui.skillsBrowser.setTab('all'); e.frame();
  e.click(e.ui.grid.panel, 100, e.ui.grid.panel.canvas.height - 28);
  assert.deepEqual(prefs(e).favorites, [1]); assert.equal(e.actor.mp, 100);
  const categories = { weapon: [5], attack: [5, 8], healing: [1, 2, 3], buffs: [4], debuffs: [7] };
  for (const [tab, expected] of Object.entries(categories)) {
    e.ui.skillsBrowser.setTab(tab); e.frame(); assert.deepEqual(ids(e), expected, tab);
  }
  e.ui.skillsBrowser.setTab('favorites'); e.frame(); assert.deepEqual(ids(e), [1]);
});

test('search focus consumes R, F, Q, Enter and Escape rather than casting or changing menu commands', t => {
  const e = environment(t); e.key('KeyR'); const field = query(e, 'RFAQ');
  assert.deepEqual(ids(e), [3]);
  for (const code of ['KeyR', 'KeyF', 'KeyQ']) e.key(code, field);
  assert.equal(e.ui.menuOpen, true); assert.equal(e.ui.list.visible, false);
  assert.deepEqual(prefs(e).favorites, []); assert.deepEqual([e.actor.hp, e.actor.mp], [200, 100]);
  assert.equal(e.input.quickHeld(), false, 'typing Q never arms a gameplay quick slot');
  e.key('Enter', field); assert.deepEqual([e.actor.hp, e.actor.mp], [200, 100]);
  e.ui.skillsBrowser.focusSearch(); e.key('Escape', field);
  assert.equal(e.ui.menuOpen, true); assert.equal(e.ui.grid.visible, true);
  assert.notEqual(e.document.activeElement, field);
  query(e, 'no matching synthetic skill'); e.key('Enter', field);
  assert.deepEqual(ids(e), []); assert.deepEqual([e.actor.hp, e.actor.mp], [200, 100]);
});

test('Unicode IME commits filter intact and its confirmation never doubles as a skill use', t => {
  const e = environment(t); e.key('KeyR'); const field = focusSearch(e);
  e.emit('compositionstart', { target: field }); field.value = '紺碧の祈り';
  e.emit('input', { target: field, isComposing: true }); e.frame();
  assert.ok(ids(e).length > 1, 'unfinished composition does not replace the live list');
  e.key('Enter', field, { isComposing: true, keyCode: 229 });
  assert.equal(e.document.activeElement, field); assert.equal(e.actor.mp, 100);
  e.emit('compositionend', { target: field, data: field.value }); e.emit('input', { target: field }); e.frame();
  assert.deepEqual(ids(e), [2]); assert.equal(prefs(e).query, '紺碧の祈り');
  e.key('Enter', field); assert.equal(e.actor.mp, 100);
  e.input.pointer.seen = false; e.key('Enter'); assert.deepEqual([e.actor.hp, e.actor.mp], [225, 90]);
});

test('fresh keyboard Enter casts the selected skill independently of the last pointer chrome or profile hit', t => {
  const e = environment(t); e.key('KeyR'); const field = query(e, 'Mend');
  e.key('Enter', field); assert.equal(e.actor.mp, 100);
  e.key('Enter'); assert.equal(e.actor.mp, 90, 'stale search hover must not reopen the text field');
  e.frame(e.combat.coolSeconds($data.skills[1]) + 1);
  const p = e.point(e.ui.skillProfile.panel, 40, 40); e.emit('mousemove', p); e.frame();
  e.key('Enter'); assert.equal(e.actor.mp, 80, 'a profile hover must not swallow an explicit keyboard cast');
  e.frame(e.combat.coolSeconds($data.skills[1]) + 1);
  e.emit('mousemove', e.point(e.ui.grid.panel, 100, e.ui.grid.panel.canvas.height - 28)); e.frame();
  e.key('Enter'); assert.equal(e.actor.mp, 70, 'a favorite footer hover must not swallow an explicit keyboard cast');
  assert.deepEqual(prefs(e).favorites, [], 'keyboard casting does not also toggle the hovered favorite button');
});

test('separate assignment and star controls never cast, and the real quick-slot choice returns to the same browser', t => {
  const e = environment(t); e.key('KeyR'); e.ui.skillsBrowser.setQuery('Mend'); e.frame();
  e.click(e.ui.skillProfile.panel, 40, 40); assert.equal(e.actor.mp, 100);
  e.key('KeyF'); assert.deepEqual(prefs(e).favorites, [1]); assert.equal(e.actor.mp, 100);
  e.key('KeyF'); assert.deepEqual(prefs(e).favorites, []); assert.equal(e.actor.mp, 100);
  e.click(e.ui.grid.panel, 100, e.ui.grid.panel.canvas.height - 28);
  assert.deepEqual(prefs(e).favorites, [1]); assert.equal(e.actor.mp, 100);
  e.click(e.ui.grid.panel, 500, e.ui.grid.panel.canvas.height - 28);
  assert.equal(e.ui.list.visible, true); assert.equal(e.ui.grid.visible, false);
  assert.equal(e.actor.mp, 100);
  e.click(e.ui.list.panel, 100, e.ui.list.rowTop + e.ui.list.rowH / 2);
  assert.deepEqual(e.state.quickSlots[0], { kind: 'skill', id: 1 });
  assert.equal(e.ui.grid.visible, true); assert.equal(prefs(e).query, 'Mend');
  assert.equal(e.ui.skillsBrowser.selectedId, 1); assert.equal(e.actor.mp, 100);
});

test('remembered category/query/selection survive reopen, and disappearing weapon-granted skills cannot be used', t => {
  const e = environment(t); e.key('KeyR'); e.key('ArrowDown');
  assert.equal(e.ui.skillsBrowser.selectedId, 2);
  e.key('KeyR'); e.key('KeyR'); assert.equal(e.ui.skillsBrowser.selectedId, 2);
  e.ui.skillsBrowser.setTab('healing');
  e.ui.skillsBrowser.setQuery('RFAQ'); e.frame(); e.key('KeyR'); e.key('KeyR');
  assert.equal(prefs(e).tab, 'healing'); assert.equal(prefs(e).query, 'RFAQ'); assert.equal(e.ui.skillsBrowser.selectedId, 3);
  e.ui.skillsBrowser.setQuery(''); e.ui.skillsBrowser.setTab('weapon'); e.frame();
  assert.equal(e.ui.skillsBrowser.selectedId, 5);
  e.actor.equips[0] = { kind: 'weapon', id: 0 }; e.frame();
  assert.deepEqual(ids(e), []); assert.ok(!e.ui.skillsBrowser.selectedId);
  e.input.pointer.seen = false; e.key('Enter'); assert.equal(e.actor.mp, 100);
  e.actor.equips[0] = { kind: 'weapon', id: 1 }; e.frame();
  assert.deepEqual(ids(e), [5]); assert.equal(e.ui.skillsBrowser.selectedId, 5);
});

test('opening and live resource rebuilds beneath a stationary pointer preserve remembered keyboard selection', t => {
  const e = environment(t); e.key('KeyR'); e.key('ArrowDown');
  assert.equal(e.ui.skillsBrowser.selectedId, 2);
  const point = e.point(e.ui.grid.panel, 100, e.ui.grid.gridTop + 24);
  e.key('KeyR'); e.emit('mousemove', point); e.frame(); e.key('KeyR');
  assert.equal(e.ui.skillsBrowser.selectedId, 2, 'opening under the old pointer does not silently replace the saved selection');
  e.actor.mp = 0; e.frame(); assert.equal(e.ui.skillsBrowser.selectedId, 2);
  e.actor.mp = 100; e.frame(); assert.equal(e.ui.skillsBrowser.selectedId, 2);
  assert.equal(e.actor.hp, 200);
  clickSkill(e, 'Mend');
  assert.equal(e.ui.skillsBrowser.selectedId, 1, 'a deliberate row click still selects and casts that row');
  assert.deepEqual([e.actor.hp, e.actor.mp], [225, 90]);
});

for (const change of ['state', 'map', 'leader']) test(`${change} ownership change closes focused search and cannot use the prior actor's skill`, t => {
  const e = environment(t); e.key('KeyR'); const field = query(e, 'Mend');
  if (change === 'state') G.state = new GameState();
  if (change === 'map') { G.map = new GameMap(); G.map.mapId = 2; }
  if (change === 'leader') e.state.party.actors = [2];
  e.frame();
  assert.equal(e.ui.menuOpen, false); assert.equal(e.ui.grid.visible, false);
  assert.equal(e.ui.skillsBrowser.active, false); assert.notEqual(e.document.activeElement, field);
  assert.equal(e.actor.mp, 100);
});

for (const scope of [2, 6]) test(`native equipped skill grants remain in Weapon for scope ${scope}, independently of melee-art execution`, t => {
  const e = environment(t);
  $data.skills[5].scope = scope;
  assert.equal(e.combat.isWeaponArt($data.skills[5]), false, 'all-enemy and random-four attacks are not melee-art entry paths');
  e.key('KeyR'); e.ui.skillsBrowser.setTab('weapon'); e.frame();
  assert.deepEqual(ids(e), [5]); assert.equal(e.ui.skillsBrowser.selectedId, 5);
  e.actor.equips[0] = { kind: 'weapon', id: 0 }; e.frame();
  assert.deepEqual(ids(e), [], 'an unequipped grant is no longer selectable');
  e.input.pointer.seen = false; e.key('Enter'); assert.equal(e.actor.mp, 100);
});

test('narrow desktop search hands off to actual VR rays without leaking confirmation or using profile chrome', t => {
  const e = environment(t); e.key('KeyR');
  Object.assign(e.rect, { width: 390, height: 844, right: 390, bottom: 844 });
  e.camera.aspect = 390 / 844; e.camera.updateProjectionMatrix(); e.frame();
  const field = query(e, 'Mend');
  assert.equal(e.ui.skillProfile.compact, true);
  for (const key of ['left', 'top', 'width', 'height']) assert.ok(Number.isFinite(Number.parseFloat(field.style[key])), key);
  assert.deepEqual(ids(e), [1]);

  G.vr = true; e.input.transitionViewMode(true);
  const ray = new THREE.Group(); e.ui.scene.add(ray); e.input.controllers.right = { ray };
  e.ui.transitionViewMode(true); e.frame();
  assert.notEqual(e.document.activeElement, field); assert.equal(field.style.display, 'none');
  assert.equal(e.ui.skillProfile.compact, false); assert.equal(prefs(e).query, 'Mend');
  assert.deepEqual([e.actor.hp, e.actor.mp], [200, 100], 'changing mode is not a skill action');
  const pull = (panel, x, y) => {
    e.ui.scene.updateMatrixWorld(true);
    const destination = panel.mesh.localToWorld(new THREE.Vector3((x / panel.canvas.width - 0.5) * panel.widthM,
      (0.5 - y / panel.canvas.height) * panel.heightM, 0));
    ray.position.copy(e.camera.getWorldPosition(new THREE.Vector3()));
    ray.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), destination.sub(ray.position).normalize());
    ray.updateMatrixWorld(true);
    e.input.btn.right[0] = true; e.input.btnPrev.right[0] = false; e.frame();
    e.input.btn.right[0] = false; e.input.btnPrev.right[0] = true; e.frame();
    e.input.btnPrev.right[0] = false;
  };
  pull(e.ui.skillProfile.panel, 40, 40);
  assert.equal(e.actor.mp, 100, 'an actual profile ray never casts the selected skill');
  pull(e.ui.grid.panel, 100, e.ui.grid.panel.canvas.height - 28);
  assert.deepEqual(prefs(e).favorites, [1]); assert.equal(e.actor.mp, 100);
  pull(e.ui.grid.panel, 100, e.ui.grid.gridTop + 24);
  assert.deepEqual([e.actor.hp, e.actor.mp], [225, 90]);
  G.vr = false; e.input.transitionViewMode(false); e.ui.transitionViewMode(false); e.frame();
  assert.equal(e.ui.skillProfile.compact, true); assert.equal(field.style.display, 'none');
  assert.equal(e.actor.mp, 90, 'returning to desktop does not repeat the controller confirmation');
});

function ownedArt(e, kind = 'weapon') {
  $data.skills[9] = { ...$data.skills[5], id: 9, name: 'Borrowed Tempest', description: 'Native borrowed art detail', mp_cost: 20,
    required_wtype_id1: kind === 'weapon' ? 2 : 0, required_wtype_id2: 0 };
  const item = { id: 2, name: kind === 'weapon' ? 'Silver source blade' : 'Silver source shield', icon_index: 201,
    wtype_id: 2, atype_id: 1, etype_id: kind === 'weapon' ? 0 : 1, note: '',
    params: [0, 0, 300, 0, 0, 0, 0, 0], features: [{ code: 43, data_id: 9, value: 1 }, { code: 23, data_id: 4, value: 0.5 }] };
  $data.classes[1].features.push({ code: kind === 'weapon' ? 51 : 52, data_id: kind === 'weapon' ? 2 : 1, value: 1 });
  (kind === 'weapon' ? $data.weapons : $data.armors)[2] = item;
  (kind === 'weapon' ? e.state.party.weapons : e.state.party.armors).set(2, 1);
  return item;
}

for (const kind of ['weapon', 'armor']) test(`real Skills browser previews an owned unequipped ${kind} art without changing normal gear or spending on no target`, t => {
  const e = environment(t), source = ownedArt(e, kind), gear = structuredClone(e.actor.equips), stats = Array.from({ length: 8 }, (_, id) => e.actor.param(id));
  e.key('KeyR'); e.ui.skillsBrowser.setQuery(source.name); e.frame();
  assert.deepEqual(ids(e), [9]); assert.equal(e.ui.grid.items[0].cost, 'MP 10');
  assert.equal(e.ui.grid.items[0].weapon.name, source.name); assert.equal(e.ui.grid.items[0].borrowed, true);
  assert.equal(e.ui.grid.items[0].requiresSwap, true); assert.equal(e.ui.grid.items[0].available, true);
  assert.deepEqual(e.actor.equips, gear); assert.deepEqual(Array.from({ length: 8 }, (_, id) => e.actor.param(id)), stats);
  assert.ok(e.ui.skillProfile.panel.canvas.record.texts.some(row => row.text.includes('MP 10')));
  assert.ok(e.ui.grid.panel.canvas.record.texts.some(row => row.text === tr('스킬 메뉴에서만 사용')));
  const slots = structuredClone(e.state.quickSlots);
  e.key('KeyQ'); assert.equal(e.ui.list.visible, false); assert.deepEqual(e.state.quickSlots, slots);
  e.click(e.ui.grid.panel, 500, e.ui.grid.panel.canvas.height - 28);
  assert.equal(e.ui.list.visible, false); assert.deepEqual(e.state.quickSlots, slots);
  e.key('KeyF'); assert.deepEqual(prefs(e).favorites, [9]);
  e.input.pointer.seen = false; e.key('Enter');
  assert.equal(e.actor.mp, 100); assert.equal(e.combat.skillCooling($data.skills[9]), 0); assert.equal(e.ui.menuOpen, true);
  assert.deepEqual(e.actor.equips, gear); assert.deepEqual(Array.from({ length: 8 }, (_, id) => e.actor.param(id)), stats);
  const bag = kind === 'weapon' ? e.state.party.weapons : e.state.party.armors;
  assert.equal(bag.get(2), 1); bag.delete(2); e.frame(); assert.deepEqual(ids(e), []);
  assert.deepEqual(prefs(e).favorites, [9]); bag.set(2, 1); e.frame();
  assert.deepEqual(ids(e), [9]); assert.equal(e.ui.grid.items[0].favorite, true);
});

test('a learned art that also needs an owned action weapon remains one skill and keeps ordinary quick-slot assignment', t => {
  const e = environment(t); ownedArt(e); e.actor.learnSkill(9);
  e.key('KeyR'); e.ui.skillsBrowser.setQuery('Borrowed Tempest'); e.frame();
  assert.deepEqual(ids(e), [9]); assert.equal(e.ui.grid.items[0].requiresSwap, true); assert.equal(e.ui.grid.items[0].borrowed, false);
  e.key('KeyQ'); assert.equal(e.ui.list.visible, true); assert.equal(e.ui.grid.visible, false);
  e.input.pointer.seen = false; e.key('Enter');
  assert.deepEqual(e.state.quickSlots[0], { kind: 'skill', id: 9 }); assert.equal(e.actor.mp, 100);
  assert.equal(e.ui.skillsBrowser.active, true); assert.equal(e.ui.skillsBrowser.selectedId, 9);
});
