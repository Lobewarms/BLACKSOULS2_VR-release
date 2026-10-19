import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { GameState } from '../src/game/state.js';
import { GameMap } from '../src/world/gamemap.js';
import { GameEvent } from '../src/entities/character.js';

globalThis.addEventListener ||= () => {};
const { ActionEnemy, CombatSystem } = await import('../src/combat/combat.js');
const cmd = (code, parameters = [], indent = 0) => ({ code, parameters, indent });
const page = (list, extra = {}) => ({ condition: {}, graphic: { tile_id: 0, character_name: 'Synthetic monster',
  character_index: 0, direction: 2, pattern: 1 }, move_type: 0, move_speed: 4, move_frequency: 3,
  move_route: { list: [cmd(45, ['enable_symbol_encount(1)'])] }, priority_type: 1, trigger: 2, list, ...extra });

async function environment(t, { damage = 100, delay = 0 } = {}) {
  const old = { ...G }, data = { ...$data }, doc = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const texture = new THREE.Texture(), glow = new THREE.Texture();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({
    width: 0, height: 0, getContext: () => new Proxy({ measureText: s => ({ width: String(s).length * 10 }) },
      { get: (o, k) => o[k] || (() => {}) }),
  }) } });
  t.mock.method(ActionEnemy.prototype, 'artwork', async () => ({ tex: texture, w: 100, h: 180, core: 25 }));
  t.mock.method(Math, 'random', () => 0.5);
  const stats = [500, 100, 30, 10, 10, 10, 10, 10];
  Object.assign($data, {
    actors: [null, { id: 1, class_id: 1, initial_level: 1, equips: [], features: [], note: '' }],
    classes: [null, { exp_params: [30, 20, 30, 30], learnings: [], note: '', features: [{ code: 22, data_id: 0, value: 1 }],
      params: { xsize: 8, ysize: 2, data: new Int16Array([...stats, ...stats]) } }],
    weapons: [], armors: [], skills: [null, { id: 1, note: '', scope: 1, repeats: 1, hit_type: 1,
      success_rate: 100, effects: [], animation_id: 0, damage: { type: 1, formula: String(damage), variance: 0, element_id: 0 } }],
    states: [null, { id: 1, features: [], note: '', restriction: 4 }],
    enemies: [null, { id: 1, name: 'Synthetic monster', battler_name: 'Synthetic battler', battler_hue: 0,
      params: [100, 20, 10, 10, 10, 10, 10, 10], features: [], note: '', actions: [], gold: 7, exp: 0, drop_items: [] }],
    troops: [null, { id: 1, members: [{ enemy_id: 1, x: 0, y: 0, hidden: false }], pages: [] }],
    system: { sounds: [] }, commonEvents: [],
  });
  const state = new GameState(), map = new GameMap(); map.mapId = 1;
  map.grid = { w: 20, h: 20, valid: (x, y) => x >= 0 && y >= 0 && x < 20 && y < 20,
    anyPassable: () => true, region: () => 0, passable: () => true };
  Object.assign(G, { state, map, time: 1, vr: false, scripts: {}, coop: null, arena: null, theater: null,
    settings: { respawn: 'map', difficulty: 'normal' }, audio: null, floorAt: () => 0, solidTopAt: null,
    input: { haptic() {}, disarmPressed: () => false, running: () => false },
    ui: { menuOpen: false, sceneOpen: null, messageBusy: () => false, dialogueActive: () => false, toast() {} },
    player: { headWorld: out => out.set(0.75, 1.6, 0.75), floatDown() {} }, screen: { playAnimationOn() {} },
  });
  state.party.actors = [1]; state.party.gold = 0;
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), {
    root: new THREE.Group(), enemies: [], symbols: new Map(), battles: [], puppets: new Map(), detached: [],
    sideInterps: [], defeated: new Map(), passing: new Set(), projectiles: [], fx: [], fadingMarkers: [],
    stamina: 1, rangedCooldown: 0, glowTexture: () => glow, heldBoss: () => false,
    slipsWithAnswer: () => null, popup() {}, popupAtPlayer() {}, groggyHit() {}, dropMarker() {},
    takeArmedSkill: () => null, afterPlayerAction() {}, isBossFight: () => false,
    battleMusicStart() {}, battleMusicEnd() {}, updateBreakCue() {}, ownCounter: () => 0,
    slipStance: () => false, allies: { pickTarget: () => null, walls: () => [], update() {} },
  });
  for (const method of ['refreshEquipment', 'alignHeldToRay', 'updateGuard', 'updateDeskShield', 'updateDesktopEquipment',
    'updateQuick', 'updateReady', 'updateHeld', 'updateFx', 'updateAreaMarks', 'updatePlayerAttack', 'updateWeaponGlow',
    'updateBreakReady', 'updateActorStates', 'updateGhost', 'updateWeaponFx', 'updateWaves', 'updateHazards', 'updatePopups']) combat[method] = () => {};
  const list = [...(delay ? [cmd(230, [delay])] : []), cmd(301, [0, 1, true, false]),
    cmd(601), cmd(123, ['D', 0], 1), cmd(604), cmd(0)];
  const ev = new GameEvent(1, { id: 2, name: 'Synthetic field encounter', x: 0, y: 9, pages: [page(list),
    page([cmd(0)], { condition: { self_switch_valid: true, self_switch_ch: 'D' }, trigger: 0, move_route: { list: [] } })] });
  map.events[2] = ev; map.eventList = [ev];
  const symbol = combat.symbols.get(ev), enemy = symbol.enemy; await enemy.ready;
  const tick = dt => { G.time += dt; combat.update(dt); combat.updateLogic(); };
  const arrow = () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.3), new THREE.MeshBasicMaterial());
    mesh.userData.look = 'arrow';
    combat.spawnProjectile(new THREE.Vector3(0.75, 1, 0.75), new THREE.Vector3(0, 0, 1),
      { owner: 'player', mesh, speed: 18, homing: 0, power: 1, one: true, align: true });
    for (let i = 0; i < 30 && !symbol.engaged; i++) { G.time += 0.05; combat.updateProjectiles(0.05, false); }
    assert.equal(symbol.engaged, true, 'a real distant arrow impact starts the original symbol event');
  };
  t.after(() => {
    for (const body of new Set([enemy, ...combat.enemies])) body.remove();
    texture.dispose(); glow.dispose(); Object.assign(G, old); Object.assign($data, data);
    if (doc) Object.defineProperty(globalThis, 'document', doc); else delete globalThis.document;
  });
  return { combat, state, map, symbol, enemy, ev, arrow, tick };
}

for (const delay of [0, 90]) test(`a distant lethal arrow preserves collapse through symbol battle startup${delay ? ' after an authored wait' : ''}`, async t => {
  const e = await environment(t, { delay }); e.arrow();
  assert.equal(e.enemy.b.hp, 0); assert.equal(e.enemy.state, 'dying');
  e.combat.updateEnemies(0.2, false);
  const opacity = e.enemy.mat.opacity; assert.ok(opacity > 0 && opacity < 1);
  for (let i = 0; i < delay + 8 && !e.combat.battles.length; i++) e.tick(1 / 60);
  const battle = e.combat.battles[0]; assert.ok(battle); assert.equal(battle.enemies[0], e.enemy);
  assert.ok(['dying', 'dead'].includes(e.enemy.state), 'promoting the field body cannot turn a dead battler back into a standing chase billboard');
  if (e.enemy.state === 'dying') assert.ok(e.enemy.mat.opacity <= opacity, 'battle startup cannot restore an already fading body');
  for (let i = 0; i < 180; i++) e.tick(1 / 60);
  assert.equal(e.enemy.state, 'dead'); assert.equal(e.enemy.group.visible, false);
  assert.equal(e.enemy.group.parent, null, 'the finished collapse disposes its original billboard');
  assert.equal(e.state.selfSw(1, e.ev.id, 'D'), true, 'the original victory branch completes');
  assert.equal(e.state.party.gold, 7); assert.equal(e.state.system.winCount, 1);
  assert.equal(e.symbol.interp, null); assert.equal(e.ev.locked, false);
  assert.equal(e.combat.engage(e.ev, true), false, 'the completed page cannot start another fight or pay a second reward');
  e.combat.updateLogic(); assert.equal(e.state.party.gold, 7); assert.equal(e.state.system.winCount, 1);
});

test('a nonlethal distant arrow carries its actual HP into a living chasing battle member', async t => {
  const e = await environment(t, { damage: 10 }); e.arrow();
  const hp = e.enemy.b.hp; assert.ok(hp > 0 && hp < e.enemy.b.mhp);
  e.combat.updateLogic();
  assert.equal(e.enemy.battle, e.combat.battles[0]); assert.equal(e.enemy.state, 'chase');
  assert.equal(e.enemy.alive, true); assert.equal(e.enemy.b.hp, hp); assert.equal(e.state.party.gold, 0);
});
