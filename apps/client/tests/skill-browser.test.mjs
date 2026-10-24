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
  const canvas = { width: 1260, height: 726 }, texts = [], painted = [], icons = [], cursors = [];
  const ctx = new Proxy({ clearRect: () => { texts.length = painted.length = icons.length = cursors.length = 0; },
    fillText: (text, x, y) => { texts.push(text); painted.push({ text, x, y, font: ctx.font }); },
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
  const browser = new SkillBrowser({ grid, ui, font: 'Synthetic', windowBg() {}, drawIcon: (...args) => icons.push(args.slice(1)),
    drawGameCursor: (...args) => cursors.push(args.slice(1)),
    fitLabel: (_ctx, text) => text, clean: String }); ui.skillsBrowser = browser; browser.open();
  return { browser, actor, skills, grid, texts, painted, icons, cursors, ui, casts, toasts, assignments, get saves() { return saves; },
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

function borrowedArt(e) {
  const art = skill(8, { name: 'Owned arc', scope: 2 }), weapon = { id: 2, name: 'Silver crescent', icon_index: 201,
    features: [{ code: 43, data_id: art.id }] };
  $data.skills[art.id] = art; $data.weapons = [null, null, weapon];
  G.state.party.weapons = new Map([[weapon.id, 1]]);
  G.combat.menuSkills = actor => [...actor.allSkills(), art, art];
  G.combat.menuSkillUseStatus = selected => ({ ok: true, skill: selected, reason: '', costs: { hp: 0, mp: 2, tp: 4 },
    weapon: selected.id === art.id ? weapon : null, requiresSwap: selected.id === art.id });
  e.browser.rebuild(true); return { art, weapon };
}

test('owned menu arts deduplicate by stable skill ID and preview action costs without changing learned skills or settings', t => {
  const e = environment(t), { art, weapon } = borrowedArt(e);
  const row = e.grid.items.find(item => item.id === art.id);
  assert.equal(e.grid.items.filter(item => item.id === art.id).length, 1);
  assert.deepEqual(row.weapon, { id: weapon.id, name: weapon.name, icon: weapon.icon_index });
  assert.equal(row.cost, 'MP 2 · TP 4'); assert.equal(row.borrowed, true); assert.equal(row.requiresSwap, true);
  assert.ok(!e.actor.allSkills().includes(art)); assert.equal(e.saves, 0);
  e.browser.setTab('weapon'); assert.ok(e.grid.items.some(item => item.id === art.id));
  e.browser.setQuery(weapon.name); assert.deepEqual(e.grid.items.map(item => item.id), [art.id]);
  e.browser.toggleFavorite(); assert.deepEqual(G.settings.skillBrowser[1].favorites, [art.id]);
});

test('weapon-name search covers all owned granting sources while excluding storage and other characters', t => {
  const e = environment(t), { art, weapon } = borrowedArt(e);
  for (const [id, name] of [[3, 'Azure alternate'], [4, 'Stored source'], [5, 'Other hero source']]) {
    $data.weapons[id] = { ...weapon, id, name };
  }
  G.state.party.weapons.set(3, 1); G.state.party.weapons.set(5, 0);
  G.state.party.kept = { weapon: new Map([[4, 1]]) };
  G.state.party.members = () => [e.actor, { weapons: () => [$data.weapons[5]] }];
  e.browser.setQuery('Azure'); assert.deepEqual(e.grid.items.map(item => item.id), [art.id]);
  e.browser.setQuery('Stored'); assert.deepEqual(e.grid.items, []);
  e.browser.setQuery('Other hero'); assert.deepEqual(e.grid.items, []);
  $data.armors = [null, null, { ...weapon, name: 'Native shield source', etype_id: 1 }, { ...weapon, id: 3, name: 'Helmet source', etype_id: 2 }];
  G.state.party.armors = new Map([[2, 1], [3, 1]]);
  e.browser.setQuery('Native shield'); assert.deepEqual(e.grid.items.map(item => item.id), [art.id], 'weapon and offhand IDs do not collide');
  e.browser.setQuery('Helmet'); assert.deepEqual(e.grid.items, []);
  assert.equal(G.state.party.weapons.get(2), 1);
});

test('borrowed-only Q and pointer assignment explain the limitation without creating an unusable slot', t => {
  const e = environment(t), { art } = borrowedArt(e);
  e.browser.setQuery('Owned arc');
  assert.ok(e.texts.includes('Skills menu only'));
  e.input({ key: 'KeyQ' }); e.browser.handleInput(null);
  assert.deepEqual(e.assignments, []); assert.match(e.toasts.at(-1), /Equip this item to assign/);
  G.vr = true; e.browser.draw(); e.hit(500, e.grid.panel.canvas.height - 28);
  e.input({ confirm: true }); e.browser.handleInput({}); assert.deepEqual(e.assignments, []); assert.deepEqual(e.casts, []);
  e.skills.push(art); e.browser.rebuild(true); e.browser.draw();
  assert.equal(e.grid.items[0].requiresSwap, true, 'known skills can still need an action weapon');
  assert.equal(e.grid.items[0].borrowed, false);
  e.input({ key: 'KeyQ' }); G.vr = false; e.browser.handleInput(null);
  assert.deepEqual(e.assignments[0].entry, { kind: 'skill', id: art.id });
});

test('a removed source cannot cast from a stale row and its favorite survives loss and reacquisition', t => {
  const e = environment(t), { art } = borrowedArt(e);
  e.browser.setQuery('Owned arc'); e.browser.toggleFavorite();
  G.state.party.weapons.delete(2);
  G.combat.menuSkills = actor => actor.allSkills();
  G.combat.menuSkillUseStatus = selected => ({ ok: selected.id !== art.id, skill: selected, reason: 'Weapon no longer owned' });
  assert.equal(e.browser.useSelected(), false); assert.deepEqual(e.casts, []); assert.equal(e.grid.items.length, 0);
  assert.deepEqual(G.settings.skillBrowser[1].favorites, [art.id]);
  borrowedArt(e); assert.equal(e.grid.items[0].id, art.id); assert.equal(e.grid.items[0].favorite, true);
});

function bonusChain(t, count = 2) {
  const e = environment(t), draft = []; let remaining = count, released = false, active = 0.3, icon = 91, commits = 0;
  e.actor.mp = 50;
  G.combat.menuSkillChainStatus = () => ({ remaining, queued: draft.length, capacity: remaining, icon,
    activeRemaining: active, recoveryRemaining: 0.9, ready: active <= 0, released,
    skills: draft.map(id => ({ id, name: $data.skills[id].name, icon: $data.skills[id].icon_index })) });
  G.combat.queueMenuSkill = selected => {
    if (released || draft.length >= remaining) return false;
    draft.push(selected.id); return true;
  };
  G.combat.removeMenuSkill = () => draft.pop();
  G.combat.clearMenuSkillChain = () => { draft.length = 0; };
  G.combat.playerAttackSkill = () => ({ icon_index: 83 });
  e.ui.castSkillChain = () => { commits++; released = true; return true; };
  e.ready(false); e.browser.update();
  return { ...e, draft, get commits() { return commits; }, set remaining(value) { remaining = value; },
    set active(value) { active = value; }, set icon(value) { icon = value; } };
}

test('Skills reports actual follow-ups and shared active time without rolling, casting, paying or saving settings', t => {
  const e = bonusChain(t), random = Math.random; Math.random = () => assert.fail('Viewing Skills must not roll Bonus Actions');
  t.after(() => { Math.random = random; });
  for (let i = 0; i < 8; i++) e.browser.update();
  assert.ok(e.texts.includes('Bonus Action ×2 · Queued skills 0/2'));
  assert.ok(e.texts.some(text => text.includes('Next action in 0.3 s')));
  e.active = 0.3000000000000007; e.browser.update(); assert.equal(e.browser.chain.activeRemaining, 0.3, 'floating deadlines do not add a spurious tenth');
  assert.ok(e.icons.some(([icon]) => icon === 91)); assert.equal(e.browser.footerHeight, 260);
  assert.equal(e.actor.hp, 100); assert.equal(e.actor.mp, 50); assert.equal(e.saves, 0); assert.deepEqual(e.casts, []); assert.deepEqual(e.draft, []);
  e.icon = 0; e.browser.update(); assert.ok(e.icons.some(([icon]) => icon === 83), 'icon fallback is the original normal attack artwork');
  G.combat.playerAttackSkill = () => ({ icon_index: NaN }); e.browser.update(); assert.equal(e.browser.chain.icon, 0, 'no invented replacement icon');
  e.remaining = 0; e.browser.update(); assert.equal(e.browser.chain, null); assert.equal(e.browser.footerHeight, 140);
  assert.ok(!e.texts.some(text => text.includes('Bonus Action')));
});

test('Enter queues several skills during shared active time but preserves native restrictions and queue capacity', t => {
  const e = bonusChain(t);
  e.input({ confirm: true }); e.browser.handleInput(null);
  e.grid.index = 1; e.input({ confirm: true }); e.browser.handleInput(null);
  assert.deepEqual(e.draft, [1, 2]); assert.deepEqual(e.casts, []); assert.equal(e.actor.mp, 50);
  assert.equal(e.browser.useSelected(), false); assert.equal(e.toasts.at(-1), 'Queue full');
  assert.ok(e.texts.includes('Bonus Action ×2 · Queued skills 2/2'));
  e.browser.editChain(true); e.allowed(false);
  assert.equal(e.browser.useSelected(), false); assert.equal(e.toasts.at(-1), 'Sealed'); assert.deepEqual(e.draft, [1]);
  e.remaining = 0; e.browser.update(); assert.equal(e.browser.castChain(), false); assert.equal(e.commits, 0);
  e.browser.editChain(true); assert.deepEqual(e.draft, [], 'a stale over-capacity draft can still be corrected');
});

test('PC and VR control hints say Queue only during real Bonus Action planning, including a full queue', t => {
  const e = bonusChain(t);
  for (const vr of [false, true]) {
    G.vr = vr; e.browser.draw();
    assert.ok(e.texts.includes(vr ? 'Stick: Select · A / trigger: Queue · B: Back' : 'Enter: Queue · F: Favorite · Q: Quick slot'));
    assert.ok(!e.texts.some(text => text.startsWith('Enter: Use') || text.includes('trigger: Confirm')));
  }
  e.browser.useSelected(); e.browser.useSelected(); e.browser.draw();
  assert.ok(e.texts.includes('Stick: Select · A / trigger: Queue · B: Back'), 'capacity does not silently change confirm back to immediate Use');
  e.browser.editChain(); e.remaining = 0; e.browser.update();
  for (const vr of [false, true]) {
    G.vr = vr; e.browser.draw();
    assert.ok(e.texts.includes(vr ? 'Stick: Select · A / trigger: Confirm · B: Back' : 'Enter: Use · F: Favorite · Q: Quick slot'));
  }
});

test('queue planning does not bypass per-skill cooldowns or queue Dodge, Break and pure utility', t => {
  const e = bonusChain(t);
  G.combat.menuSkillUseStatus = selected => ({ ok: selected.id !== 2, skill: selected, reason: selected.id === 2 ? 'Ready in 3.0 s' : '' });
  e.grid.index = 1; assert.equal(e.browser.useSelected(), false); assert.deepEqual(e.draft, []);
  for (const selected of [skill(12), skill(88), skill(89, { scope: 0 })]) {
    if (selected.id === 88) G.combat.isBreakSkill = candidate => candidate.id === 88;
    $data.skills[selected.id] = selected; e.skills.push(selected); e.browser.rebuild(true);
    e.grid.index = e.grid.items.findIndex(row => row.id === selected.id);
    e.browser.useSelected();
    assert.deepEqual(e.draft, [], `${selected.id} must keep its native immediate/preparation route`);
  }
  e.grid.index = e.grid.items.findIndex(row => row.id === 1); assert.equal(e.browser.useSelected(), true);
  const casts = [...e.casts];
  for (const id of [12, 88, 89]) {
    e.grid.index = e.grid.items.findIndex(row => row.id === id);
    assert.equal(e.browser.useSelected(), false); assert.equal(e.toasts.at(-1), 'This skill cannot be added to the chain');
    assert.deepEqual(e.draft, [1]); assert.deepEqual(e.casts, casts, 'an incompatible immediate cast cannot silently discard the draft');
  }
});

for (const vr of [false, true]) test(`${vr ? 'VR trigger' : 'mouse'} queue controls remove, clear and commit without also selecting a skill`, t => {
  const e = bonusChain(t, 3); G.vr = vr; e.browser.useSelected(); e.grid.index = 1; e.browser.useSelected();
  const press = x => { e.hit(x, e.grid.panel.canvas.height - 172); e.input(vr ? { confirm: true } : { mouse: true }); e.browser.handleInput({}); };
  press(90); assert.deepEqual(e.draft, [1]); assert.equal(e.commits, 0);
  press(280); assert.deepEqual(e.draft, []); assert.equal(e.commits, 0);
  e.browser.useSelected(); press(480); assert.equal(e.commits, 1); assert.deepEqual(e.draft, [2]);
  press(480); press(90); assert.equal(e.commits, 1); assert.deepEqual(e.draft, [2], 'released queue cannot be edited or committed twice');
  assert.deepEqual(e.casts, []); assert.equal(e.actor.mp, 50);
});

test('fresh keyboard Enter queues the selected skill even while the old mouse position is over queue chrome', t => {
  const e = bonusChain(t, 3);
  for (const x of [90, 280, 480]) {
    e.hit(x, e.grid.panel.canvas.height - 172); e.input({ confirm: true }); e.browser.handleInput({});
  }
  assert.deepEqual(e.draft, [1, 1, 1]); assert.equal(e.commits, 0); assert.deepEqual(e.casts, []);
});

test('bonus footer reserves compact/VR rows, descriptions and favorite controls and refreshes count live', t => {
  const e = bonusChain(t);
  for (const [compact, vr, height] of [[true, false, 464], [true, false, 572], [false, true, 960]]) {
    e.ui.skillProfile.compact = compact; G.vr = vr; e.grid.panel.resize(640, height, 0.64); e.browser.draw();
    const lastRowBottom = e.grid.gridTop + e.grid.rows * 108 - 6;
    assert.ok(lastRowBottom <= height - e.browser.footerHeight, 'skill row/cursor cannot overlap the queue strip');
    const title = e.painted.find(row => row.text.startsWith('Bonus Action'));
    assert.equal(title.y, height - 246);
    for (const [x, y, width, controlHeight] of e.cursors.filter(([, y]) => y === height - 192)) {
      assert.ok(x >= 20 && x + width <= 620); assert.equal(controlHeight, 40);
      assert.ok(y + controlHeight < height - 134, 'queue buttons clear the native description');
    }
    if (vr) assert.ok(!e.texts.some(text => text.includes('close R')));
  }
  e.remaining = 1; e.browser.update(); assert.ok(e.texts.includes('Bonus Action ×1 · Queued skills 0/1'));
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
