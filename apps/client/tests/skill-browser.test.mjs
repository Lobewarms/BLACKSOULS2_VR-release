import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
globalThis.location = { search: '?lang=en' };
const { $data } = await import('../src/data/data.js');
const { SkillBrowser, skillBrowserPreferences, skillCategories, SKILL_TABS } = await import('../src/ui/skill-browser.js');
const skill = (id, extra = {}) => ({ id, name: `Skill ${id}`, description: '', icon_index: id, scope: 1,
  hit_type: 2, damage: { type: 1 }, effects: [], tp_cost: 3, ...extra });
function environment(t, stored) {
  const saved = { ...G }, old = { ...$data }; t.after(() => { Object.assign(G, saved); Object.assign($data, old); });
  const skills = [skill(1, { hit_type: 1, effects: [{ code: 21, data_id: 8 }] }), skill(2),
    skill(3, { scope: 11, damage: { type: 3 } }), skill(4, { scope: 11, damage: { type: 0 }, effects: [{ code: 31 }] }),
    skill(5, { damage: { type: 0 }, effects: [{ code: 32 }] }), skill(6, { scope: 0, occasion: 3, damage: { type: 0 } }),
    skill(7, { name: '癒し・生命 회복', description: '生命の光', scope: 11, damage: { type: 3 } })];
  $data.skills = []; for (const row of skills) $data.skills[row.id] = row;
  const actor = { id: 1, hp: 100, allSkills: () => skills, skillHpCost: () => 5, skillMpCost: () => 7,
    weapons: () => [{ features: [{ code: 43, data_id: 2 }] }] };
  const canvas = { width: 1260, height: 726 }, texts = [];
  const ctx = new Proxy({ clearRect: () => { texts.length = 0; }, fillText: text => texts.push(text),
    measureText: text => ({ width: String(text).length * 9 }) }, { get: (o, key) => key in o ? o[key] : () => {} });
  const panel = { canvas, ctx, widthM: 1.2, heightM: 0.726, mesh: new THREE.Group(),
    clear: () => ctx.clearRect(), commit() {}, resize(w, h, widthM) { canvas.width = w; canvas.height = h; this.widthM = widthM; }, hit: () => hit };
  let hit = null;
  const grid = { panel, cols: 3, rows: 6, gridTop: 150, cellH: 76, tabs: [], index: 0, top: 0, visible: true,
    get items() { return this.tabs[0]?.items || []; },
    open(_title, tabs, options) { this.tabs = tabs; this.index = options.index; this.top = 0; this.onCancel = options.onCancel; this.visible = true; },
    close() { this.visible = false; }, draw() { this.skillBrowser?.draw(); },
    scrollbar: { update: () => ({ handled: false, over: false }), draw() {}, reset() {} } };
  let key = '', mouse = false, confirm = false, dx = 0, dy = 0, allowed = true, ready = true, fighting = false;
  const casts = [], toasts = [], assignments = []; let saves = 0;
  const ui = { menuOpen: true, menuSection: 'skills', pointerTarget: false, skillProfile: { compact: false }, toast: text => toasts.push(text),
    showQuickPicker: (entry, back) => assignments.push({ entry, back }), showSkills() {}, reopenMain() {} };
  Object.assign(G, { vr: false, time: 10, frame: 1, audio: null, state: { party: { leader: () => actor } }, map: { mapId: 4 },
    settings: { skillBrowser: stored ?? {} }, saveSettings: () => saves++,
    input: { controllers: {}, mouse: {}, keyPressed: value => key === value, mousePressed: () => mouse,
      confirm: () => confirm || mouse && ui.pointerTarget, cancel: () => false, menu: () => false, navX: () => dx, navY: () => dy },
    combat: { isWeaponArt: s => s.id === 1, bonusSkillEligible: s => !!s.scope, bonusFighting: () => fighting,
      playerActionReady: () => ready, playerRecoveryUntil: 10.9, skillCooling: () => 0,
      skillUseStatus: s => ({ ok: allowed && s.id !== 6, skill: s, reason: allowed && s.id !== 6 ? '' : 'Sealed' }),
      useSkillFromMenu: s => { casts.push(s.id); return true; } } });
  const browser = new SkillBrowser({ grid, ui, font: 'Synthetic', windowBg() {}, drawIcon() {}, drawGameCursor() {},
    fitLabel: (_ctx, text) => text, clean: String }); ui.skillsBrowser = browser; browser.open();
  return { browser, actor, skills, grid, texts, casts, toasts, assignments, get saves() { return saves; },
    input: (value = {}) => { ({ key = '', mouse = false, confirm = false, dx = 0, dy = 0 } = value); G.frame++; },
    hit: (x, y) => { hit = x == null ? null : new THREE.Vector2(x / 640, 1 - y / canvas.height); },
    allowed: value => { allowed = value; }, ready: value => { ready = value; }, fighting: value => { fighting = value; } };
}

test('preferences sanitize malformed state, deduplicate bounded native favorites and pick a safe initial tab', t => {
  environment(t);
  assert.deepEqual(skillBrowserPreferences(null), { favorites: [], tab: 'all', query: '', selectedId: 0 });
  const prefs = skillBrowserPreferences({ favorites: [2, 2, -1, '3', 999, 1], tab: 'arbitrary', query: '生命'.repeat(200), selectedId: Infinity });
  assert.deepEqual(prefs.favorites, [1, 2]); assert.equal(prefs.tab, 'favorites'); assert.equal([...prefs.query].length, 120); assert.equal(prefs.selectedId, 0);
});

test('native categories overlap and include equipped all/random weapon grants and required weapon types', t => {
  const e = environment(t);
  assert.deepEqual(skillCategories(e.skills[0], G.combat, e.actor), ['all', 'weapon', 'attack', 'debuffs']);
  assert.ok(skillCategories({ ...e.skills[1], scope: 2 }, G.combat, e.actor).includes('weapon'));
  assert.ok(skillCategories(skill(99, { scope: 4, required_wtype_id2: 5 }), {}, e.actor).includes('weapon'));
  assert.ok(skillCategories(e.skills[2], G.combat, e.actor).includes('healing'));
  assert.ok(skillCategories(e.skills[3], G.combat, e.actor).includes('buffs'));
  assert.ok(skillCategories(e.skills[4], G.combat, e.actor).includes('debuffs'));
  $data.states = [null, { features: [{ code: 22, data_id: 7, value: 0.05 }] }, { features: [{ code: 22, data_id: 8, value: -0.05 }] }];
  const cleanse = skill(98, { scope: 7, damage: { type: 0 }, effects: [{ code: 22, data_id: 7 }] });
  assert.deepEqual(skillCategories(cleanse, {}, e.actor), ['all', 'healing', 'buffs']);
  assert.deepEqual(skillCategories({ ...cleanse, effects: [{ code: 21, data_id: 1 }] }, {}, e.actor), ['all', 'healing', 'buffs']);
  assert.deepEqual(skillCategories({ ...cleanse, effects: [{ code: 21, data_id: 2 }] }, {}, e.actor), ['all', 'buffs']);
  assert.deepEqual(skillCategories(e.skills[5], G.combat, e.actor), ['all']);
  assert.deepEqual(SKILL_TABS, ['favorites', 'all', 'weapon', 'attack', 'healing', 'buffs', 'debuffs']);
});

test('opening, inspecting and live resource refresh never persist settings or roll/cast a skill', t => {
  const e = environment(t); assert.equal(e.saves, 0);
  for (let i = 0; i < 10; i++) e.browser.update();
  assert.equal(e.saves, 0); assert.deepEqual(e.casts, []);
  assert.equal(e.grid.items.length, 7, 'All retains unavailable and unclassified learned skills');
  assert.equal(e.grid.items.find(row => row.id === 6).enabled, true); assert.equal(e.grid.items.find(row => row.id === 6).available, false);
});

test('favorite-first order is stable, selected skill survives reordering and actor preferences stay isolated', t => {
  const e = environment(t, { 1: { tab: 'all', favorites: [5, 2], selectedId: 4 }, 2: { tab: 'healing', query: '生命', favorites: [7], selectedId: 7 } });
  assert.deepEqual(e.grid.items.map(row => row.id), [2, 5, 1, 3, 4, 6, 7]); assert.equal(e.browser.selectedId, 4);
  e.browser.toggleFavorite(); assert.equal(e.browser.selectedId, 4); assert.equal(e.saves, 1);
  assert.deepEqual(e.grid.items.map(row => row.id), [2, 4, 5, 1, 3, 6, 7]);
  assert.deepEqual(G.settings.skillBrowser[2], { tab: 'healing', query: '生命', favorites: [7], selectedId: 7 });
  e.browser.close(); e.actor.id = 2; e.browser.open();
  assert.equal(e.browser.session.prefs.tab, 'healing'); assert.equal(e.browser.session.prefs.query, '生命'); assert.equal(e.browser.selectedId, 7);
});

test('an empty Favorites category retains reachable All and never falls back to an automatic use', t => {
  const e = environment(t); e.browser.setTab('favorites');
  assert.equal(e.grid.items.length, 0); assert.ok(e.texts.some(text => /Favorites|즐겨찾기/.test(text)));
  e.input({ confirm: true }); e.browser.handleInput(null); assert.deepEqual(e.casts, []);
  e.browser.setTab('all'); assert.equal(e.grid.items.length, 7);
});

test('Unicode search matches installed names/descriptions and persists only explicit query changes', t => {
  const e = environment(t); e.browser.setQuery('生命'); assert.deepEqual(e.grid.items.map(row => row.id), [7]);
  e.browser.setQuery('회복'); assert.deepEqual(e.grid.items.map(row => row.id), [7]);
  e.browser.setQuery('ＳＫＩＬＬ ２'); assert.deepEqual(e.grid.items.map(row => row.id), [2]);
  const saves = e.saves; e.browser.setQuery('ＳＫＩＬＬ ２'); e.browser.update(); assert.equal(e.saves, saves);
  e.browser.setQuery(''); assert.equal(e.grid.items.length, 7);
});

test('direct Enter rechecks costs/restrictions, shared recovery and uses authoritative combat once', t => {
  const e = environment(t); e.grid.index = 0;
  assert.equal(e.grid.items[0].cost, 'HP 5 · MP 7 · TP 3');
  e.ready(false); e.browser.update(); assert.equal(e.grid.items[0].available, false); assert.match(e.grid.items[0].reason, /0\.9/);
  assert.equal(e.browser.useSelected(), false); assert.deepEqual(e.casts, []);
  e.ready(true); e.allowed(false); assert.equal(e.browser.useSelected(), false); assert.deepEqual(e.casts, []);
  e.allowed(true); e.input({ confirm: true }); e.browser.handleInput(null); assert.deepEqual(e.casts, [1]);
});

test('combat utility shares recovery while pure field utility retains its original exemption', t => {
  const e = environment(t); e.ready(false); e.skills[5].occasion = 0; G.combat.skillUseStatus = s => ({ ok: true, skill: s });
  e.fighting(false); assert.equal(e.browser.status(e.skills[5]).ok, true);
  e.fighting(true); assert.equal(e.browser.status(e.skills[5]).ok, false);
});

test('visible favorite/assignment chrome consumes mouse and VR confirms without casting', t => {
  const e = environment(t); e.browser.draw();
  e.hit(100, e.grid.panel.canvas.height - 28); e.input({ mouse: true }); e.browser.handleInput({});
  assert.deepEqual(e.casts, []); assert.ok(e.browser.session.prefs.favorites.includes(1));
  e.hit(500, e.grid.panel.canvas.height - 28); e.input({ mouse: true }); e.browser.handleInput({});
  assert.deepEqual(e.casts, []); assert.deepEqual(e.assignments[0].entry, { kind: 'skill', id: 1 });
  e.browser.open(); G.vr = true; e.browser.draw();
  for (const [x, y] of [[10, 20], [10, 180], [20, 60]]) { e.hit(x, y); e.input({ confirm: true }); e.browser.handleInput({}); }
  assert.deepEqual(e.casts, []);
  assert.ok(e.texts.every(text => !/\([FQ]\)/.test(text)), 'VR chrome has native controls, not desktop shortcut labels');
});

test('keyboard Enter ignores stale search/category/favorite pointer locations while actual pointer clicks remain chrome', t => {
  const e = environment(t); e.browser.draw();
  for (const [x, y] of [[80, 158], [40, 60], [100, e.grid.panel.canvas.height - 28]]) {
    e.hit(x, y); e.input({ confirm: true }); e.browser.handleInput({});
  }
  assert.deepEqual(e.casts, [1, 1, 1]); assert.deepEqual(e.browser.session.prefs.favorites, []);
});

test('browser close restores original grid geometry and never changes a replacement inventory', t => {
  const e = environment(t); e.grid.panel.resize(640, 960, 0.64); e.grid.cols = 1; e.grid.rows = 7;
  e.browser.close(); assert.deepEqual([e.grid.cols, e.grid.rows, e.grid.gridTop, e.grid.cellH], [3, 6, 150, 76]);
  assert.deepEqual([e.grid.panel.canvas.width, e.grid.panel.canvas.height, e.grid.panel.widthM], [1260, 726, 1.2]);
  e.browser.open(); e.grid.tabs = [{ items: [] }]; e.grid.panel.resize(500, 700, 0.5); e.browser.close();
  assert.equal(e.grid.panel.canvas.width, 500);
});

test('opening or rebuilding beneath a stationary pointer preserves remembered selection until a deliberate click or movement', t => {
  const e = environment(t, { 1: { tab: 'all', selectedId: 4 } }); e.browser.draw();
  e.hit(100, e.grid.gridTop + 24); e.input(); e.browser.handleInput({});
  assert.equal(e.browser.selectedId, 4); assert.equal(e.saves, 0);
  e.browser.rebuild(true); e.input(); e.browser.handleInput({});
  assert.equal(e.browser.selectedId, 4); assert.equal(e.saves, 0);
  const firstVisible = e.grid.items[e.grid.top].id;
  e.input({ mouse: true }); e.browser.handleInput({});
  assert.equal(e.browser.selectedId, firstVisible); assert.deepEqual(e.casts, [firstVisible]);
});

test('Slash opens desktop search without casting, favoriting or assigning, and is ignored in VR', t => {
  const e = environment(t); let focused = 0; e.browser.focusSearch = () => focused++;
  e.input({ key: 'Slash', confirm: true }); assert.equal(e.browser.handleInput(null), true);
  assert.equal(focused, 1); assert.deepEqual(e.casts, []); assert.deepEqual(e.assignments, []); assert.equal(e.saves, 0);
  G.vr = true; e.input({ key: 'Slash' }); e.browser.handleInput(null); assert.equal(focused, 1);
});

test('selected installed descriptions get two visible lines while full text remains intact for profile paging', t => {
  const e = environment(t);
  e.skills[0].description = 'First complete description line.\nSecond complete description line.\nA third line remains in native metadata for the companion profile.';
  e.browser.rebuild(true); e.browser.draw();
  assert.ok(e.texts.some(text => text === 'First complete description line.'));
  assert.ok(e.texts.some(text => text.startsWith('Second complete description line.')));
  assert.equal(e.grid.items[0].desc, e.skills[0].description);
});

for (const reason of ['transfer', 'death', 'state', 'leader', 'menu']) test(`browser ${reason} cleanup keeps pending search/navigation from changing another game`, t => {
  const e = environment(t);
  if (reason === 'transfer') G.map.transferring = true;
  if (reason === 'death') G.combat.playerDead = true;
  if (reason === 'state') G.state = { ...G.state };
  if (reason === 'leader') G.state.party.leader = () => ({ ...e.actor });
  if (reason === 'menu') e.browser.ui.menuSection = 'items';
  assert.equal(e.browser.update(), false); assert.equal(e.browser.session, null);
  e.browser.setQuery('stale'); e.browser.toggleFavorite(); assert.equal(e.saves, 0); assert.deepEqual(e.casts, []);
});
