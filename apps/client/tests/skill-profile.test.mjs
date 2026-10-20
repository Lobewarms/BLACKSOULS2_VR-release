import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { spawnSync } from 'node:child_process';
import { G } from '../src/core/globals.js';
globalThis.location = { search: '?lang=en' };
const { $data } = await import('../src/data/data.js');
const { BattlerBase } = await import('../src/game/state.js');
const { skillProfileModel, SkillProfile } = await import('../src/ui/skill-profile.js');
const { UI } = await import('../src/ui/ui.js');

class Actor extends BattlerBase {
  constructor() { super(); Object.assign(this, { id: 1, name: 'Hero', classId: 1, level: 7, hp: 500, mp: 100, tp: 42, faceName: 'FaceA', faceIndex: 5 }); }
  paramBase(id) { return [1000, 200, 100, 80, 90, 70, 60, 50][id]; }
  skillHpCost() { return 30; }
  skillMpCost() { return 7; }
}
function data(t) {
  const saved = { ...G }, old = { ...$data }; t.after(() => { Object.assign(G, saved); Object.assign($data, old); });
  Object.assign($data, { states: [], skills: [], classes: [null, { name: 'Scholar' }], system: {
    terms: { params: ['Max HP', 'Max MP', 'Attack', 'Defense', 'Magic', 'Magic Def', 'Agility', 'Luck'] }, skill_types: ['', 'Magic'] } });
  $data.skills[9] = { id: 9, name: 'Original skill', tp_cost: 8 };
  return new Actor();
}
const state = (id, extra = {}) => ({ id, name: `State ${id}`, note: '', icon_index: id + 100, features: [], ...extra });
const feature = (code, data_id, value = 1) => ({ code, data_id, value });

test('profile reports real effective resources, all eight parameters and native suppression/healing modifiers without rolling or mutating gameplay', t => {
  const actor = data(t);
  $data.states[42] = state(42, { note: '<HP回復反転:100>', features: [feature(21, 2, 0.1), feature(21, 4, 0.2), feature(23, 2, 0.5)] });
  actor.states = [42]; actor.buffs[7] = -1;
  actor.param(0); // Native param getters lazily cache original limit-note parsing.
  const before = structuredClone($data.states), originalRandom = Math.random; Math.random = () => { throw new Error('Profile must not roll healing'); };
  t.after(() => { Math.random = originalRandom; });
  const model = skillProfileModel(actor, { stamina: 0.65 });
  assert.equal(model.params.length, 8); assert.equal(model.params[2].value, 10); assert.equal(model.params[4].value, 18); assert.equal(model.params[7].value, 37);
  assert.deepEqual(model.resources.map(row => row.value), ['500 / 1000', '100 / 200', '42 / 100', '65%']);
  assert.ok(model.effects[0].details.includes('Attack 10%')); assert.ok(model.effects[0].details.includes('Magic 20%'));
  assert.ok(model.warnings.some(row => row.name === 'HP healing becomes damage 100%'));
  assert.ok(model.warnings.some(row => row.name === 'Healing received 50%'));
  assert.deepEqual($data.states, before); assert.deepEqual(actor.states, [42]); assert.equal(actor.hp, 500);
});

test('healing warnings combine installed feature sources and preserve native disable-before-inversion precedence', t => {
  const actor = data(t);
  $data.states[55] = state(55, { note: '<HP回復無効：100><HP回復反転:100><MP回復反転:25>' }); actor.states = [55];
  const model = skillProfileModel(actor, {});
  assert.ok(model.warnings.some(row => row.name === 'HP healing blocked 100%'));
  assert.ok(!model.warnings.some(row => row.name.startsWith('HP healing becomes damage')));
  assert.ok(model.warnings.some(row => row.name === 'MP healing becomes damage 25%'));
  assert.ok(model.effects[0].details.includes('HP healing becomes damage 100%'), 'source traits remain inspectable separately from combined warnings');
});

test('native regeneration/slip damage, state immunity, skill/type seals and action restrictions have meaningful labels', t => {
  const actor = data(t); $data.states[77] = state(77, { name: 'Sleep' });
  $data.states[63] = state(63, { restriction: 4, features: [feature(22, 7, -0.1), feature(22, 8, 0.05), feature(22, 9, 0.02),
    feature(14, 77), feature(42, 1), feature(44, 9)] }); actor.states = [63];
  const rows = skillProfileModel(actor, {}).effects[0].details;
  for (const label of ['HP regeneration -10%', 'MP regeneration 5%', 'TP regeneration 2%', 'Immune: Sleep', 'Sealed: Magic', 'Sealed: Original skill', 'Cannot act']) assert.ok(rows.includes(label), label);
});

test('unnamed and iconless states stay visible alongside every native buff/debuff with original icons', t => {
  const actor = data(t); $data.states[81] = state(81, { name: '', icon_index: 0 }); actor.states = [81, 81];
  actor.buffs[2] = 2; actor.buffs[7] = -1;
  const rows = skillProfileModel(actor, {}).effects;
  assert.equal(rows.length, 3); assert.equal(rows[0].name, 'Effect #81');
  assert.deepEqual(rows.slice(1).map(row => [row.name, row.icon, row.details]), [['Attack ↑ ×2', 74, ['150%']], ['Luck ↓', 87, ['75%']]]);
});

test('selected effective skill shows HP, MP and TP costs together plus its live blocked reason', t => {
  const actor = data(t), stage = { id: 10, name: 'Stage', tp_cost: 11 };
  const combat = { skillUseStatus: () => ({ ok: false, skill: stage, reason: 'Sealed' }), skillCooling: () => 1.25 };
  let model = skillProfileModel(actor, combat, $data.skills[9]);
  assert.equal(model.costs, 'HP 30 · MP 7 · TP 11'); assert.equal(model.reason, 'Sealed');
  combat.skillUseStatus = () => ({ ok: false, skill: stage, reason: '' });
  model = skillProfileModel(actor, combat, $data.skills[9]); assert.equal(model.reason, 'Ready in 1.3 s');
});

class Panel {
  constructor(width, height, widthM) {
    this.canvas = { width, height }; this.rows = []; this.images = []; this.commits = 0;
    this.ctx = { clearRect: () => { this.rows = []; this.images = []; }, save() {}, restore() {},
      strokeText() {}, fillText: (text, x, y) => this.rows.push({ text, x, y, font: this.ctx.font }),
      measureText: text => ({ width: String(text).length * 13 }), drawImage: (...args) => this.images.push(args) };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()); this.mesh.visible = false; this.resize(width, height, widthM);
  }
  resize(width, height, widthM = this.widthM) { Object.assign(this.canvas, { width, height }); this.widthM = widthM; this.heightM = widthM * height / width; }
  clear() { this.ctx.clearRect(); } commit() { this.commits++; } hit() { return null; }
}
function environment(t, { load = () => Promise.resolve(null), width = 1280, height = 720 } = {}) {
  const actor = data(t), viewport = { width, height }, ui = { menuOpen: true, menuSection: 'skills' };
  const grid = { panel: new Panel(1260, 726, 1.2), cols: 3, rows: 6, tabs: [], index: 0, items: [{ id: 9 }], draw() {},
    get visible() { return this.panel.mesh.visible; } };
  grid.panel.mesh.visible = true;
  const list = { panel: new Panel(980, 678, 0.98), rows: 8, items: [], draw() {}, get visible() { return this.panel.mesh.visible; } };
  Object.assign(G, { state: { party: { leader: () => actor } }, map: { mapId: 7 }, vr: false,
    input: { controllers: {}, mouse: {}, dom: { getBoundingClientRect: () => viewport } }, three: null,
    combat: { stamina: 0.6, skillUseStatus: () => ({ ok: true, skill: $data.skills[9], reason: '' }) } });
  let revision = 0;
  const controller = new SkillProfile({ Panel, root: new THREE.Group(), grid, list, ui, font: 'Synthetic', windowBg() {}, drawIcon() {},
    drawGameCursor() {}, textColor: () => '#fff', assetRevision: () => revision, load });
  controller.open();
  return { controller, actor, grid, list, ui, viewport, revision: () => revision++ };
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('late portrait uses its actual original face cell and cannot return after close/reopen or a face-name change', async t => {
  const first = deferred(), second = deferred(), requests = [];
  const e = environment(t, { load: (_folder, name) => { requests.push(name); return name === 'FaceA' ? first.promise : second.promise; } }); await settle();
  e.controller.close(); e.actor.faceName = 'FaceB'; e.controller.open(); await settle();
  first.resolve({ name: 'Stale', width: 384, height: 192 }); await settle(); assert.equal(e.controller.panel.images.length, 0);
  const face = { name: 'Current', width: 384, height: 192 }; second.resolve(face); await settle();
  assert.deepEqual(e.controller.panel.images[0], [face, 96, 96, 96, 96, 24, 20, 128, 128]);
  assert.deepEqual(requests, ['FaceA', 'FaceB']);
});

test('failed portrait loads stay text-only without repeated retries; original icon arrival invalidates the paint cache', async t => {
  let loads = 0;
  const e = environment(t, { load: () => { loads++; return Promise.reject(new Error('Synthetic missing face')); } }); await settle();
  const commits = e.controller.panel.commits;
  for (let i = 0; i < 12; i++) e.controller.update();
  assert.equal(loads, 1); assert.equal(e.controller.panel.commits, commits); assert.equal(e.controller.panel.images.length, 0);
  e.revision(); e.controller.update(); assert.equal(e.controller.panel.commits, commits + 1);
});

for (const reason of ['transfer', 'map', 'state', 'actor', 'death', 'other-menu']) test(`profile ${reason} cleanup cannot be resurrected by an old portrait`, async t => {
  const pending = deferred(), e = environment(t, { load: () => pending.promise }); await settle();
  if (reason === 'transfer') G.map.transferring = true;
  if (reason === 'map') G.map = { mapId: 7 };
  if (reason === 'state') G.state = { ...G.state };
  if (reason === 'actor') G.state.party.leader = () => new Actor();
  if (reason === 'death') G.combat.playerDead = true;
  if (reason === 'other-menu') { e.ui.menuSection = 'items'; e.grid.tabs = []; e.grid.panel.resize(888, 444, 0.8); }
  assert.equal(e.controller.update(), false); assert.equal(e.controller.panel.mesh.visible, false);
  const commits = e.controller.panel.commits;
  pending.resolve({ width: 384, height: 192 }); await settle(); assert.equal(e.controller.panel.commits, commits);
  if (reason === 'other-menu') assert.equal(e.grid.panel.canvas.width, 888, 'old profile cannot resize a replacement inventory');
  else assert.deepEqual([e.grid.cols, e.grid.rows, e.grid.panel.canvas.width], [3, 6, 1260]);
});

test('all long effect names and modifiers remain reachable without ellipsis and short layout reserves the skill footer', t => {
  const e = environment(t, { width: 640, height: 500 });
  const fullName = 'An unusually long native effect name must remain available through its continued rows';
  const skillDescription = 'A long selected skill description remains fully accessible beyond both summary lines, including this final sentence.';
  $data.skills[9].description = skillDescription;
  $data.states[61] = state(61, { name: fullName, description: 'The complete installed description is also reachable.', features: [feature(21, 4, 0.1)] });
  e.actor.states = [61]; e.controller.update();
  const rows = [];
  for (let i = 0; i < e.controller.pageCount; i++) {
    const text = e.controller.panel.rows.filter(row => row.y >= 100 && row.y < 188);
    assert.ok(text.every(row => row.y <= 146), 'body rows do not overlap the selected skill at188');
    rows.push(...text.map(row => row.text)); e.controller.changePage(1);
  }
  const compact = rows.join(''); assert.ok(compact.includes(fullName)); assert.ok(compact.includes('Magic 10%'));
  assert.ok(compact.includes('The complete installed description is also reachable.')); assert.ok(!compact.includes('…'));
  assert.ok(compact.includes(skillDescription), 'selected skill description remains complete across profile pages');
});

test('profile warnings and interaction hints are localized in every supported language', () => {
  const url = new URL('../src/ui/i18n.js', import.meta.url).href;
  const keys = ['HP 회복 반전 {p}', 'HP 회복 무효 {p}', 'HP 재생 {p}', '면역: {name}', '행동 불가', '전체 활성 효과 {n}', 'PageUp/PageDown · 효과 위에서 스크롤'];
  for (const language of ['en', 'ko', 'ja', 'zh']) {
    const code = `globalThis.location={search:'?lang=${language}'};const {tr}=await import(${JSON.stringify(url)});console.log(JSON.stringify(${JSON.stringify(keys)}.map(key=>tr(key,{p:'100%',name:'Sleep',n:3}))));`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
    const labels = JSON.parse(result.stdout); assert.ok(labels.every(label => label.length && !/\{[pn]|\{name/.test(label)));
    if (language !== 'ko') assert.ok(labels.every(label => !/[가-힣]/.test(label)));
  }
});

test('long selected skill names and combined resource/restriction text stay inside wide and compact footers', t => {
  const e = environment(t);
  $data.skills[9].name = 'A long translated skill title '.repeat(30);
  $data.skills[9].tp_cost = 987654321;
  G.combat.skillUseStatus = () => ({ ok: false, skill: $data.skills[9], reason: 'An unusually long native restriction explanation '.repeat(30) });
  for (const [width, height] of [[1280, 720], [640, 500], [480, 800]]) {
    Object.assign(e.viewport, { width, height }); e.controller.update();
    const H = e.controller.panel.canvas.height;
    const rows = e.controller.panel.rows.filter(row => row.y === H - 112 || row.y === H - 78);
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.ok(row.x >= 24 && row.x + e.controller.panel.ctx.measureText(row.text).width <= 616);
      assert.ok(Number.parseFloat(row.font) >= 18); assert.ok(row.text.endsWith('…'));
    }
    assert.match(rows[1].text, /HP 30 · MP 7 · TP 987654321/);
  }
});

test('the existing Use row follows live availability without casting or changing quick-slot controls', t => {
  data(t); let ready = false, draws = 0;
  G.combat = { skillUseStatus: () => ({ ok: ready, reason: ready ? '' : 'Sealed', skill: $data.skills[9] }) };
  $data.skills[9].description = 'Original support description';
  const use = { id: 'use', enabled: true, desc: 'Old text' }, quick = { id: 'quick', enabled: true, desc: 'Keep quick slots' };
  const ui = { skillProfile: { session: { kind: 'list', skillId: 9 }, update: () => true },
    list: { items: [use, quick], draw: () => draws++ } };
  UI.prototype.updateSkillProfile.call(ui);
  assert.equal(use.enabled, false); assert.equal(use.desc, 'Sealed'); assert.equal(draws, 1);
  ready = true; UI.prototype.updateSkillProfile.call(ui);
  assert.equal(use.enabled, true); assert.equal(use.desc, 'Original support description'); assert.equal(draws, 2);
  UI.prototype.updateSkillProfile.call(ui); assert.equal(draws, 2, 'unchanged availability does not repaint each frame');
  assert.deepEqual(quick, { id: 'quick', enabled: true, desc: 'Keep quick slots' });
});

test('a changing seal/type refreshes grid eligibility while low resources and cooldowns still allow skill inspection', t => {
  const actor = data(t); let sealed = true, typeAllowed = true, draws = 0;
  actor.skillSealed = () => sealed; actor.skillTypeUsable = () => typeAllowed;
  actor.skillCostPayable = () => { assert.fail('Grid eligibility must not add a resource restriction'); };
  G.state = { party: { leader: () => actor } }; actor.mp = 0;
  const item = { id: 9, enabled: true };
  const ui = { skillProfile: { session: { kind: 'grid' }, update: () => true },
    grid: { items: [item], draw: () => draws++ } };
  UI.prototype.updateSkillProfile.call(ui); assert.equal(item.enabled, false); assert.equal(draws, 1);
  sealed = false; UI.prototype.updateSkillProfile.call(ui); assert.equal(item.enabled, true); assert.equal(draws, 2);
  typeAllowed = false; UI.prototype.updateSkillProfile.call(ui); assert.equal(item.enabled, false); assert.equal(draws, 3);
  typeAllowed = true; UI.prototype.updateSkillProfile.call(ui); assert.equal(item.enabled, true); assert.equal(draws, 4);
  UI.prototype.updateSkillProfile.call(ui); assert.equal(draws, 4);
});


test('the selected profile agrees with the browser shared-action recovery reason instead of showing Available', t => {
  const e = environment(t);
  G.combat.skillUseStatus = skill => ({ ok: true, skill, reason: '' });
  let ready = false;
  e.grid.skillBrowser = { active: true, status: skill => ({ ok: ready, skill, reason: ready ? '' : 'Ready in 0.8 s' }) };
  e.controller.update();
  assert.ok(e.controller.panel.rows.some(row => String(row.text).includes('Ready in 0.8 s')));
  ready = true; e.controller.update();
  assert.ok(!e.controller.panel.rows.some(row => String(row.text).includes('Ready in 0.8 s')));
  assert.ok(e.controller.panel.rows.some(row => String(row.text).includes('Available')));
});
