import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';

globalThis.location = { search: '?lang=en' };
globalThis.addEventListener ||= () => {};
const { $data } = await import('../src/data/data.js');
const { BattlerBase } = await import('../src/game/state.js');
const { initAssets } = await import('../src/data/assets.js');
const { CombatSystem, ActionEnemy } = await import('../src/combat/combat.js');
const { duelCountdown } = await import('../src/ui/duel-countdown.js');
const state = (id, extra = {}) => ({ id, name: `Effect ${id}`, icon_index: id, priority: 50,
  features: [], note: '', restriction: 0, min_turns: 10, max_turns: 10, auto_removal_timing: 2, ...extra });
const immortal = id => state(id, { name: 'Shared ward', features: [{ code: 14, data_id: 1, value: 1 }] });

function canvas() {
  const record = { texts: [], rects: [], clears: 0 };
  const ctx = new Proxy({ clearRect() { record.texts = []; record.rects = []; record.clears++; },
    fillText(text, x, y) { record.texts.push({ text, x, y, font: this.font }); },
    fillRect(x, y, width, height) { record.rects.push({ x, y, width, height }); },
    measureText: text => ({ width: Array.from(String(text)).length * 12 }),
    createRadialGradient: () => ({ addColorStop() {} }),
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  return { width: 0, height: 0, record, getContext: () => ctx };
}

async function environment(t, remaining = 61.25) {
  const before = { ...G }, data = { ...$data }, document = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    Object.assign(G, before); Object.assign($data, data);
    if (document) Object.defineProperty(globalThis, 'document', document); else delete globalThis.document;
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: canvas } });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: [] })); await initAssets();
  Object.assign($data, { states: [], enemies: [null, { id: 1, name: 'Synthetic duelist', battler_name: '',
    params: [100, 50, 10, 10, 10, 10, 10, 10], features: [], actions: [], note: '' }],
    system: { sounds: [] }, skills: [], classes: [] });
  $data.states[1] = state(1, { name: 'Death', restriction: 4, auto_removal_timing: 0 });
  $data.states[42] = immortal(42);
  class Actor extends BattlerBase { paramBase(id) { return [100, 50, 10, 10, 10, 10, 10, 10][id]; } }
  const actor = new Actor(); actor.hp = 100; actor.mp = 50; actor.addState(42);
  const scene = new THREE.Scene(), combat = new CombatSystem(scene);
  const battle = { done: false, enemies: [], time: 0, canEscape: false };
  Object.assign(G, { state: { system: { stateTimers: { 42: remaining } }, party: { leader: () => actor } },
    map: { mapId: 1, grid: { anyPassable: () => true }, playerChar: { fx: 3, fy: 3 },
      interpreter: { running: () => false }, reservedCommon: [], nearX: value => value, nearY: value => value },
    combat, ui: { menuOpen: false, sceneOpen: null, msg: null }, scripts: {}, settings: {}, time: 10,
    input: { disarmPressed: () => false }, player: { headWorld: out => out.set(0, 1.6, 3), dodging: false },
    floorAt: () => 0, coop: null, arena: null, theater: null, screen: null, audio: null, emotes: null, xrAway: false });
  combat.skyHidden = () => false;
  combat.groggyMax = () => 100;
  // Preserve real Combat.update, pause decisions, actor/enemy state ticking and
  // nameplate updates; unrelated movement/weapon/particle work is isolated.
  for (const name of ['updateBonusActions', 'refreshEquipment', 'alignHeldToRay', 'updateGuard', 'updateDeskShield',
    'updateDesktopEquipment', 'updateQuick', 'updateReady', 'updateHeld', 'updateFx', 'updateAreaMarks',
    'updatePlayerAttack', 'updateSymbols', 'updateWeaponGlow', 'updateBreakReady', 'updateGhost', 'updateWeaponFx',
    'updateProjectiles', 'updateWaves', 'updateHazards', 'updatePopups', 'tickGroggy', 'updateBreakCue', 'updateMounts']) combat[name] = () => {};
  combat.enemyAI = (_enemy, _dt, _target, attacking) => attacking;
  Object.assign(combat.allies, { pickTarget: () => null, walls: () => [], update() {}, reset() {} });
  const enemy = new ActionEnemy(combat, battle, 1, 0, 0, { dormant: true });
  battle.enemies.push(enemy); combat.battles.push(battle); combat.enemies.push(enemy);
  await enemy.ready; enemy.b.addState(42); enemy.stateTimers = { 42: remaining };
  t.after(() => { if (enemy.group.parent) enemy.remove(); });
  const frame = dt => { G.time += dt; combat.update(dt); };
  const texts = () => enemy.barCanvas.record.texts.map(row => row.text);
  return { actor, combat, enemy, battle, frame, texts };
}

test('countdown formats the actual positive remaining lifetime with ceiling seconds and an optional native icon', () => {
  assert.deepEqual(duelCountdown({ remaining: 61.25, icon: 42 }), { seconds: 62, icon: 42, text: 'Shared immortality · 1:02', key: '62/42' });
  assert.equal(duelCountdown({ remaining: 1 / 60, icon: 0 }).text, 'Shared immortality · 0:01');
  assert.equal(duelCountdown({ remaining: 120, icon: -1 }).text, 'Shared immortality · 2:00');
  for (const remaining of [0, -1, NaN, Infinity, undefined]) assert.equal(duelCountdown({ remaining }), null);
});

test('shared duel detection retains native state criteria and reads the earlier actual lifetime rather than an independent duration', async t => {
  const e = await environment(t);
  assert.equal(e.combat.inDuel(e.enemy), true);
  e.enemy.stateTimers[42] = 49.5;
  assert.deepEqual(e.combat.duelStatus(e.enemy), { stateId: 42, remaining: 49.5, icon: 42 });
  G.state.system.stateTimers[42] = 27;
  assert.equal(e.combat.duelStatus(e.enemy).remaining, 27);
  $data.states[43] = immortal(43); e.actor.addState(43); e.enemy.b.addState(43);
  G.state.system.stateTimers[43] = 40; e.enemy.stateTimers[43] = 35;
  assert.equal(e.combat.duelStatus(e.enemy).remaining, 35, 'another shared immunity keeps the duel active until its own expiry');
  $data.states[44] = immortal(44); $data.states[44].auto_removal_timing = 0;
  e.actor.addState(44); e.enemy.b.addState(44); G.state.system.stateTimers[44] = 999;
  assert.ok(!e.combat.duelStates(e.enemy).includes(44), 'permanent Death immunity is not the timed shared phase');
});

test('actual combat frames pause both state clocks and the nameplate countdown, then resume and expire together', async t => {
  const e = await environment(t, 3.25); e.frame(0.25);
  assert.equal(e.combat.duelStatus(e.enemy).remaining, 3);
  assert.ok(e.texts().includes('Shared immortality · 0:03'));
  G.ui.menuOpen = true; const before = e.enemy.barCanvas.record.clears;
  e.frame(30);
  assert.equal(G.state.system.stateTimers[42], 3); assert.equal(e.enemy.stateTimers[42], 3);
  assert.ok(e.texts().includes('Shared immortality · 0:03')); assert.equal(e.enemy.barCanvas.record.clears, before);
  G.ui.menuOpen = false; e.frame(2.25);
  assert.equal(e.combat.duelStatus(e.enemy).remaining, 0.75); assert.ok(e.texts().includes('Shared immortality · 0:01'));
  e.frame(0.75);
  assert.equal(e.combat.inDuel(e.enemy), false); assert.equal(e.combat.duelStatus(e.enemy), null);
  assert.ok(!e.texts().some(text => text.startsWith('Shared immortality')));
});

test('the compact boss row retains HP, groggy and every effect within the existing PC/VR nameplate and paints only changed seconds', async t => {
  const e = await environment(t, 10.9);
  for (let id = 45; id <= 50; id++) { $data.states[id] = state(id); e.enemy.b.addState(id); }
  const shown = new Set();
  for (const vr of [false, true]) {
    G.vr = vr;
    for (const time of [0, 3, 6]) { G.time = time; e.enemy.updateNameplate(new THREE.Vector3(0, 1.6, 3)); e.texts().forEach(text => shown.add(text)); }
    const record = e.enemy.barCanvas.record;
    assert.ok(record.texts.every(row => row.y - 14 >= 0 && row.y + 14 < 184));
    assert.ok(record.rects.some(row => row.y === 50), 'HP bar is retained');
    assert.ok(record.rects.some(row => row.y === 74), 'groggy bar is retained');
    assert.ok(e.texts().includes('Shared immortality · 0:11'));
    const clears = record.clears; e.enemy.stateTimers[42] = 10.1; e.enemy.drawBar();
    assert.equal(record.clears, clears, 'subsecond changes do not upload an unchanged countdown');
    e.enemy.stateTimers[42] = 10; e.enemy.drawBar(); assert.equal(record.clears, clears + 1);
    e.enemy.stateTimers[42] = 10.9;
  }
  for (let id = 45; id <= 50; id++) assert.ok(shown.has(`Effect ${id}`), 'status paging remains complete');
  assert.deepEqual([e.enemy.barCanvas.width, e.enemy.barCanvas.height], [512, 184]);
});

for (const ending of ['player-death', 'enemy-death', 'hidden', 'private', 'battle-end', 'reset', 'transfer']) test(`countdown hides on ${ending} without changing original state lifetimes`, async t => {
  const e = await environment(t); const timer = G.state.system.stateTimers[42];
  if (ending === 'player-death') e.combat.playerDead = true;
  if (ending === 'enemy-death') e.enemy.state = 'dead';
  if (ending === 'hidden') e.enemy.hidden = true;
  if (ending === 'private') e.enemy.noTarget = true;
  if (ending === 'battle-end') e.battle.done = true;
  if (ending === 'reset') e.combat.reset({ keepState: true });
  if (ending === 'transfer') G.map.transferring = true;
  assert.equal(e.combat.duelStatus(e.enemy), null); assert.equal(G.state.system.stateTimers[42], timer);
});

test('expired or invalid authoritative timers never display time from the other side, and no timer is invented', async t => {
  const e = await environment(t);
  for (const value of [0, -1, NaN, Infinity]) { e.enemy.stateTimers[42] = value; assert.equal(e.combat.duelStatus(e.enemy), null); }
  delete e.enemy.stateTimers[42]; assert.equal(e.combat.duelStatus(e.enemy).remaining, 61.25, 'a known shared player lifetime is still authoritative');
  delete G.state.system.stateTimers[42]; assert.equal(e.combat.duelStatus(e.enemy), null);
});

test('asynchronous artwork and nameplates tolerate an uninitialized leader without battler state methods', async t => {
  const e = await environment(t);
  G.state.party.leader = () => ({ name: 'Loading player', hp: 100 });
  assert.equal(e.combat.duelStatus(e.enemy), null);
  assert.doesNotThrow(() => e.enemy.drawBar());
  assert.ok(e.texts().includes('Synthetic duelist')); assert.ok(!e.texts().some(text => text.startsWith('Shared immortality')));
});

test('shared immortality countdown is localized in every supported language', () => {
  const url = new URL('../src/ui/i18n.js', import.meta.url).href;
  for (const language of ['en', 'ja', 'ko', 'zh']) {
    const code = `globalThis.location={search:'?lang=${language}'};const {tr}=await import(${JSON.stringify(url)});console.log(tr('공유 불사 · {time}',{time:'1:23'}));`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.ok(result.stdout.includes('1:23')); assert.ok(!result.stdout.includes('{time}'));
    if (language !== 'ko') assert.ok(!/[가-힣]/.test(result.stdout));
  }
});
