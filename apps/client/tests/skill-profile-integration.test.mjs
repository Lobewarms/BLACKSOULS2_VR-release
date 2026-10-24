import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { Input } from '../src/core/input.js';
import { GameState } from '../src/game/state.js';
import { GameMap } from '../src/world/gamemap.js';

globalThis.location = { search: '?lang=en' };
globalThis.addEventListener ||= () => {};
const { UI } = await import('../src/ui/ui.js');

function canvas() {
  const record = { texts: [], images: [] }, stack = [];
  const defaults = { font: '10px sans-serif', textAlign: 'left', textBaseline: 'alphabetic', globalAlpha: 1 };
  const measure = text => Array.from(String(text)).length * (Number(ctx.font.match(/([\d.]+)px/)?.[1]) || 10) * 0.52;
  const ctx = new Proxy({ ...defaults,
    clearRect() { record.texts = []; record.images = []; },
    fillText(text, x, y) { record.texts.push({ text: String(text), x, y, width: measure(text), align: ctx.textAlign, font: ctx.font }); },
    drawImage(...args) { record.images.push(args); },
    measureText: text => ({ width: measure(text) }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    save() { stack.push(Object.fromEntries(Object.keys(defaults).map(key => [key, ctx[key]]))); },
    restore() { if (stack.length) Object.assign(ctx, stack.pop()); },
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  let width = 0, height = 0;
  const reset = () => { Object.assign(ctx, defaults); stack.length = 0; record.texts = []; record.images = []; };
  return { record, getContext: () => ctx,
    get width() { return width; }, set width(value) { width = value; reset(); },
    get height() { return height; }, set height(value) { height = value; reset(); } };
}

function environment(t, width = 1366, height = 768) {
  const saved = { ...G }, data = { ...$data }, descriptors = new Map(), listeners = new Map();
  const replace = (key, value) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  };
  const listen = (type, fn) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); };
  class Field {}
  const document = { activeElement: null, pointerLockElement: null, hasFocus: () => true,
    addEventListener: listen, body: { appendChild(element) { element.parentNode = this; } },
    createElement(type) { return type === 'canvas' ? canvas() : Object.assign(new Field(), {
      tagName: 'INPUT', style: {}, value: '', addEventListener() {}, setAttribute() {}, remove() {}, select() {},
      focus() { document.activeElement = this; }, blur() { document.activeElement = null; } }); } };
  replace('document', document); replace('addEventListener', listen); replace('HTMLInputElement', Field);
  t.after(() => {
    Object.assign(G, saved); Object.assign($data, data);
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  const params = [1000, 200, 80, 30, 100, 40, 50, 60];
  Object.assign($data, {
    actors: [null, { id: 1, name: 'Synthetic hero', class_id: 1, initial_level: 1,
      character_name: '', face_name: '', equips: [], features: [], note: '' }],
    classes: [null, { name: 'Synthetic class', note: '', features: [{ code: 41, data_id: 1, value: 1 }],
      learnings: [], exp_params: [30, 20, 30, 30],
      params: { xsize: 8, ysize: 2, data: new Int16Array([...params, ...params]) } }],
    weapons: [], armors: [], items: [], states: [], skills: [], animations: [], commonEvents: [],
    system: { currency_unit: 'Souls', sounds: [], skill_types: ['', 'Skills'],
      terms: { basic: ['', 'Lv'], params: ['Max HP', 'Max MP', 'Attack', 'Defense', 'Magic', 'Magic defense', 'Agility', 'Luck'], etypes: [] } },
  });
  for (let id = 1; id <= 30; id++) $data.skills[id] = { __class: 'RPG::Skill', id,
    name: `Synthetic skill ${id}`, description: `Skill detail ${id}`, note: '', icon_index: id,
    stype_id: 1, occasion: 0, scope: 11, mp_cost: 0, tp_cost: 0, effects: [], damage: { type: 0 } };
  for (let id = 2; id <= 18; id++) $data.states[id] = { id, name: `Status ${id}`, description: `Effect detail ${id}`,
    note: '', icon_index: 100 + id, priority: 100 - id, restriction: 0,
    features: id === 2 ? [{ code: 21, data_id: 2, value: 1.5 }] : [] };
  const state = G.state = new GameState(); state.party.actors = [1];
  const actor = state.party.leader();
  for (let id = 1; id <= 30; id++) actor.learnSkill(id);
  for (let id = 2; id <= 18; id++) actor.addState(id);
  actor.hp = 427; actor.mp = 63;
  const map = new GameMap(); map.mapId = 1;
  const rect = { left: 0, top: 0, right: width, bottom: height, width, height };
  const dom = { style: {}, tabIndex: 0, addEventListener: listen, getBoundingClientRect: () => rect,
    focus() { document.activeElement = dom; } };
  const rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 100);
  const scene = new THREE.Scene(); scene.add(rig); rig.add(camera); camera.position.set(0, 1.6, 0);
  const casts = [];
  Object.assign(G, { state, map, time: 10, frame: 1, vr: false, xrAway: false,
    settings: { ...G.settings }, scripts: {}, coop: null, theater: null, arena: null, pictures: null,
    audio: { playSystemSe() {} }, player: null, combat: { stamina: 1,
      skillUseStatus: skill => ({ ok: true, skill }), useSkillFromMenu: skill => casts.push(skill.id) },
    three: { camera, rig, renderer: { domElement: dom } } });
  const input = G.input = new Input({}, dom);
  const ui = G.ui = new UI(scene, camera, rig); ui.attachHud(null);
  const emit = (type, values = {}) => {
    for (const fn of listeners.get(type) || []) fn({ target: dom, preventDefault() {}, repeat: false, ...values });
  };
  const frame = () => { G.time += 1 / 60; G.frame++; ui.update(1 / 60); input.endFrame(); scene.updateMatrixWorld(true); };
  const key = code => { emit('keydown', { code }); frame(); emit('keyup', { code }); frame(); };
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
  const resize = (w, h) => {
    Object.assign(rect, { right: w, bottom: h, width: w, height: h });
    camera.aspect = w / h; camera.updateProjectionMatrix(); frame();
  };
  return { ui, input, actor, state, casts, frame, key, emit, point, click, resize, camera, rect };
}

function collectProfile(e) {
  const profile = e.ui.skillProfile, result = new Set();
  for (let i = 0; i < profile.pageCount && profile.page !== 0; i++) e.key('PageUp');
  for (let page = 0, count = Math.max(1, profile.pageCount); page < count; page++) {
    for (const row of profile.panel.canvas.record.texts) result.add(row.text);
    e.key('PageDown');
  }
  return result;
}
function gridLayout(grid) {
  return { cols: grid.cols, rows: grid.rows, cellH: grid.cellH, top: grid.gridTop,
    width: grid.panel.canvas.width, height: grid.panel.canvas.height, widthM: grid.panel.widthM,
    position: grid.panel.mesh.position.toArray() };
}
function screenBounds(panel, camera, rect) {
  panel.mesh.updateWorldMatrix(true, false);
  const points = [-0.5, 0.5].flatMap(x => [-0.5, 0.5].map(y =>
    panel.mesh.localToWorld(new THREE.Vector3(x * panel.widthM, y * panel.heightM, 0)).project(camera)));
  return { left: Math.min(...points.map(p => (p.x + 1) * rect.width / 2)),
    right: Math.max(...points.map(p => (p.x + 1) * rect.width / 2)),
    top: Math.min(...points.map(p => (1 - p.y) * rect.height / 2)),
    bottom: Math.max(...points.map(p => (1 - p.y) * rect.height / 2)) };
}

test('the real R shortcut opens a live profile and PageDown reaches every effect and effective parameter', t => {
  const e = environment(t); e.key('KeyR');
  assert.equal(e.ui.menuOpen, true); assert.equal(e.ui.menuSection, 'skills');
  assert.equal(e.ui.skillProfile.panel.mesh.visible, true); assert.equal(e.ui.grid.visible, true);
  assert.ok(e.ui.skillProfile.pageCount > 1, 'the synthetic effects exceed the first profile page');
  const text = collectProfile(e);
  assert.ok(text.has('Synthetic hero'));
  for (const label of $data.system.terms.params) assert.ok(text.has(label), `${label} remains accessible`);
  for (let id = 2; id <= 18; id++) assert.ok([...text].some(line => line.includes(`Status ${id}`)), `Status ${id} remains accessible`);
  assert.deepEqual(e.casts, []); assert.equal(e.ui.list.visible, false);
});

test('real projected profile clicks cannot cast a skill, including while separate quick-slot assignment is visible', t => {
  const e = environment(t); e.key('KeyR');
  const profile = e.ui.skillProfile, selected = e.ui.grid.index;
  e.click(profile.panel, 40, 40);
  e.click(profile.panel, profile.panel.canvas.width / 2, profile.panel.canvas.height / 2);
  assert.equal(e.ui.grid.index, selected); assert.equal(e.ui.grid.visible, true);
  assert.equal(e.ui.list.visible, false); assert.deepEqual(e.casts, []);
  e.key('KeyQ');
  assert.equal(e.ui.grid.visible, false); assert.equal(e.ui.list.visible, true);
  assert.equal(profile.panel.mesh.visible, true);
  const actions = e.ui.list.items.map(item => item.id);
  e.click(profile.panel, 40, 40);
  e.click(profile.panel, profile.panel.canvas.width - 40, profile.panel.canvas.height - 30);
  assert.deepEqual(e.ui.list.items.map(item => item.id), actions);
  assert.equal(e.ui.list.visible, true); assert.deepEqual(e.casts, []);
});

test('resources, effective stats and removed effects refresh while the same skill menu remains open', t => {
  const e = environment(t); e.key('KeyR');
  const profile = e.ui.skillProfile;
  assert.equal(e.actor.atk, 120);
  e.actor.hp = 329; e.actor.mp = 37; e.actor.removeState(2); e.actor.addBuff(3, 10); e.frame();
  assert.equal(e.ui.menuOpen, true); assert.equal(e.ui.skillProfile, profile);
  const text = collectProfile(e), joined = [...text].join(' ');
  assert.match(joined, /329/); assert.match(joined, /37/);
  assert.equal(e.actor.atk, 80);
  assert.ok([...text].some(line => /\b80\b/.test(line)), 'the actual reduced ATK is repainted');
  assert.ok(![...text].some(line => /^Status 2(?:\s|$)/.test(line)), 'the removed state cannot remain on another cached page');
  assert.ok([...text].some(line => /Defense.*↑|↑.*Defense/.test(line)), 'a live native buff joins the effects');
  assert.deepEqual(e.casts, []);
});

test('leaving Skills restores the original inventory grid and main-menu command layout', t => {
  const e = environment(t), original = gridLayout(e.ui.grid);
  e.key('KeyR'); e.key('KeyR');
  assert.equal(e.ui.menuOpen, false); assert.equal(e.ui.skillProfile.panel.mesh.visible, false);
  e.key('Tab');
  assert.equal(e.ui.menuSection, 'main'); assert.equal(e.ui.list.classic, true);
  assert.equal(e.ui.list.panel.canvas.width, 320); assert.equal(e.ui.menuOverview.mesh.visible, true);
  e.ui.onMenu('items'); e.frame();
  assert.equal(e.ui.skillProfile.panel.mesh.visible, false);
  assert.deepEqual(gridLayout(e.ui.grid), original);
  e.ui.reopenMain('items'); e.frame();
  assert.equal(e.ui.list.panel.canvas.width, 320); assert.equal(e.ui.list.classic, true);
});

test('wide, short and narrow viewports fit distinct profile and skill panels and retain every effect page', t => {
  const e = environment(t); e.key('KeyR');
  for (const [width, height] of [[1366, 768], [800, 600], [390, 844], [900, 480]]) {
    e.resize(width, height);
    const profile = e.ui.skillProfile.panel, grid = e.ui.grid.panel;
    const a = screenBounds(profile, e.camera, e.rect), b = screenBounds(grid, e.camera, e.rect);
    for (const bounds of [a, b]) {
      assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.top >= 0 && bounds.bottom <= height,
        `${width}x${height}: ${JSON.stringify(bounds)}`);
    }
    assert.ok(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1,
      `${width}x${height}: profile and skills must not overlap`);
    const text = collectProfile(e);
    for (let id = 2; id <= 18; id++) assert.ok([...text].some(line => line.includes(`Status ${id}`)), `${width}x${height}: Status ${id}`);
  }
  assert.deepEqual(e.casts, []);
});

test('compact profile rows stay above the selected skill footer on every page', t => {
  const e = environment(t); e.key('KeyR');
  for (const [width, height] of [[800, 600], [390, 844]]) {
    e.resize(width, height);
    const profile = e.ui.skillProfile;
    for (let page = 0; page < profile.pageCount; page++) {
      const rows = profile.panel.canvas.record.texts;
      const footer = rows.find(row => row.text === 'Synthetic skill 1');
      assert.ok(footer);
      const footerTop = footer.y - Number(footer.font.match(/([\d.]+)px/)[1]) / 2;
      for (const row of rows.filter(row => row.y >= 100 && row.y < footer.y)) {
        const bottom = row.y + Number(row.font.match(/([\d.]+)px/)[1]) / 2;
        assert.ok(bottom + 2 <= footerTop, `${width}x${height}: ${row.text} overlaps the selected skill`);
      }
      e.key('PageDown');
    }
  }
});

test('a real VR controller ray can page the profile without activating the highlighted skill', t => {
  const e = environment(t); e.key('KeyR');
  G.vr = true;
  const ray = new THREE.Group(); e.ui.scene.add(ray);
  e.input.controllers.right = { ray };
  e.ui.transitionViewMode(true); e.frame();
  const profile = e.ui.skillProfile, before = profile.page;
  profile.panel.mesh.updateWorldMatrix(true, false);
  const destination = profile.panel.mesh.localToWorld(new THREE.Vector3(
    (600 / profile.panel.canvas.width - 0.5) * profile.panel.widthM,
    (0.5 - (profile.panel.canvas.height - 26) / profile.panel.canvas.height) * profile.panel.heightM, 0));
  ray.position.copy(e.camera.getWorldPosition(new THREE.Vector3()));
  ray.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), destination.sub(ray.position).normalize());
  ray.updateMatrixWorld(true);
  e.input.btn.right[0] = true; e.frame();
  assert.equal(profile.page, (before + 1) % profile.pageCount);
  assert.equal(e.ui.grid.visible, true); assert.equal(e.ui.list.visible, false);
  assert.deepEqual(e.casts, []);
});
