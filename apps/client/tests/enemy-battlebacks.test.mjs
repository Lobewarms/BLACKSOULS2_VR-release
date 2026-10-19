import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { initAssets } from '../src/data/assets.js';
import { GameMap } from '../src/world/gamemap.js';
import { Interpreter } from '../src/game/interpreter.js';

globalThis.addEventListener ||= () => {};
const { CombatSystem } = await import('../src/combat/combat.js');
const command = (code, parameters = []) => ({ code, parameters, indent: 0 });
const drawsBody = e => !!e.mesh && e.mesh.visible && e.mat.visible && e.mat.opacity > 0;
const imageOf = e => e.mat.map?.image?.sourceUrl;
let sequence = 0;

function canvas() {
  const c = { width: 0, height: 0, sourceUrl: '' };
  const ctx = new Proxy({
    drawImage(image) { c.sourceUrl = image.url || image.sourceUrl || ''; },
    measureText: text => ({ width: String(text).length * 12 }),
    createRadialGradient: () => ({ addColorStop() {} }),
    getImageData(x, y, w, h) {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const visible = c.sourceUrl.includes('opaque') || (x + i >= 15 && x + i < c.width - 15 && y + j >= 8 && y + j < c.height - 8);
        const at = (i + j * w) * 4; data[at] = 100; data[at + 1] = 130; data[at + 2] = 90; data[at + 3] = visible ? 255 : 0;
      }
      return { data };
    },
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  c.getContext = () => ctx;
  return c;
}

async function environment(t, { manual = false } = {}) {
  const old = { ...G }, data = { ...$data };
  const descriptors = ['document', 'Image'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const tag = `battleback-${++sequence}`, names = { first: `${tag}-cutout1`, second: `${tag}-cutout2`, opaque: `${tag}-opaque`, pictured: `${tag}-pictured` };
  const files = [`Graphics/Battlebacks1/${names.first}.png`, `Graphics/Battlebacks1/${names.second}.png`,
    `Graphics/Battlebacks1/${names.opaque}.png`, `Graphics/Battlebacks2/${names.second}.png`, `Graphics/Battlers/${names.pictured}.png`];
  const images = [];
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files }));
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: canvas } });
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class {
    width = 160; height = 200;
    set src(url) { this.url = url; images.push(this); if (!manual) queueMicrotask(() => this.onload()); }
  } });
  await initAssets();
  const enemy = (id, image) => ({ id, name: `Synthetic enemy ${id}`, battler_name: image, battler_hue: 0,
    params: [100, 20, 10, 10, 10, 10, 10, 10], features: [], note: '', actions: [] });
  const member = (id, hidden = false) => ({ enemy_id: id, hidden, x: id === 1 ? 300 : 340, y: 220 });
  Object.assign($data, { enemies: [null, enemy(1, ''), enemy(2, names.pictured)],
    states: [null, { id: 1, name: 'Death', features: [] }], skills: [], classes: [],
    system: { currency_unit: 'Souls' },
    troops: [null, { id: 1, members: [member(1)], pages: [] },
      { id: 2, members: [member(1), member(2, true)], pages: [] },
      { id: 3, members: [member(1), member(2)], pages: [] },
      { id: 4, members: [member(2)], pages: [] }], commonEvents: [] });
  const leader = { hp: 100, featureObjects: () => [] };
  Object.assign(G, { state: { v: () => 0, sw: () => false, system: { battleCount: 0 }, party: { leader: () => leader } },
    scripts: {}, time: 0, floorAt: () => 0, theater: null, coop: null, arena: null, audio: null,
    ui: { messageBusy: () => false }, player: { forward2D: () => ({ x: 0, z: -1 }) } });
  const map = G.map = new GameMap(); map.mapId = 1;
  map.grid = { w: 40, h: 40, valid: (x, y) => x >= 0 && y >= 0 && x < 40 && y < 40,
    anyPassable: () => true, passable: () => true, region: () => 0 };
  Object.assign(map.playerChar, { fx: 20, fy: 20 });
  const glow = new THREE.Texture();
  const combat = G.combat = Object.assign(Object.create(CombatSystem.prototype), { root: new THREE.Group(), battles: [], enemies: [], symbols: new Map(),
    puppets: new Map(), puppetBattle: { done: false, puppet: true, enemies: [] }, puppetMoves: () => false,
    glowTexture: () => glow, skyHidden: () => false, groggyMax: () => 0,
    isBossFight: () => false, battleStart() {}, battleMusicStart() {}, dropMarker() {}, hideBlade() {} });
  const source = () => { const it = new Interpreter(); it.setup([command(0)]); return it; };
  const change = (it, backs) => { it.params = backs; it.c283(); };
  const begin = async (backs, troop = 1) => {
    const it = source(); change(it, backs); it.params = [0, troop, false, false]; it.c301();
    const battle = it.battle; await Promise.all(battle.enemies.map(e => e.ready));
    return { it, battle, e: battle.enemies.find(e => e.memberIndex === 0) };
  };
  t.after(() => {
    for (const e of new Set([...combat.enemies, ...combat.puppets.values()])) e.remove();
    glow.dispose(); Object.assign(G, old); Object.assign($data, data);
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  const loaded = async count => {
    for (let i = 0; i < 20 && images.length < count; i++) await Promise.resolve();
    assert.equal(images.length, count, 'expected pending synthetic image requests');
  };
  return { names, map, combat, source, change, begin, images, loaded };
}

test('original pre-battle command 283 preserves both names and renders a transparent authored creature', async t => {
  const { names, map, begin } = await environment(t);
  const backs = [names.first, names.second], { battle, e } = await begin(backs);
  assert.deepEqual(map.battlebacks, backs); assert.deepEqual(battle.battlebacks, backs);
  assert.equal(drawsBody(e), true); assert.equal(imageOf(e), `/game/Graphics/Battlebacks1/${names.first}.png`);
  assert.ok(e.alive && e.b.hp === 100, 'authored presentation does not replace the original battler');
});

test('a delayed encounter captures its own event override rather than a concurrent event background', async t => {
  const { names, source, change, combat } = await environment(t);
  const it = source(); it.setup([command(283, [names.first, '']), command(230, [1]), command(301, [0, 1, false, false]), command(0)]);
  it.update();
  const other = source(); change(other, [names.second, '']);
  it.update();
  const battle = it.battle; assert.ok(combat.battles.includes(battle));
  await Promise.all(battle.enemies.map(e => e.ready));
  assert.deepEqual(battle.battlebacks, [names.first, '']);
  assert.equal(imageOf(battle.enemies[0]), `/game/Graphics/Battlebacks1/${names.first}.png`);
});

test('separate fights keep captured art and live troop changes address only their own battle', async t => {
  const { names, begin, source, change } = await environment(t);
  const first = await begin([names.first, '']), second = await begin([names.second, '']);
  const before = first.e.mat.map;
  const troop = source(); troop.troop = true; troop.battleOwner = second.battle;
  const child = source(); child.root = troop;
  change(child, [names.first, '']); await second.e.ready;
  assert.equal(first.e.mat.map, before); assert.deepEqual(first.battle.battlebacks, [names.first, '']);
  assert.deepEqual(second.battle.battlebacks, [names.first, '']);
  assert.equal(imageOf(second.e), `/game/Graphics/Battlebacks1/${names.first}.png`);
  assert.equal(second.e.group.children.filter(x => x.geometry?.type === 'PlaneGeometry').length, 1);
});

test('an ended troop common event cannot redirect another active encounter artwork', async t => {
  const { names, begin, source, change } = await environment(t);
  const first = await begin([names.first, '']), second = await begin([names.second, '']);
  first.battle.done = true;
  const stale = source(); stale.troop = true; stale.battleOwner = first.battle;
  const art = second.e.mat.map;
  change(stale, ['', '']); await second.e.ready;
  assert.deepEqual(second.battle.battlebacks, [names.second, '']); assert.equal(second.e.mat.map, art);
});

test('battleback layer two can supply the cutout while an opaque landscape never becomes enemy art', async t => {
  const { names, begin } = await environment(t);
  const landscape = await begin([names.opaque, '']);
  assert.equal(drawsBody(landscape.e), false);
  const layered = await begin([names.opaque, names.second]);
  assert.equal(drawsBody(layered.e), true);
  assert.equal(imageOf(layered.e), `/game/Graphics/Battlebacks2/${names.second}.png`);
});

test('a sole original boss retains artwork when an initially hidden minion appears', async t => {
  const { names, begin, combat } = await environment(t);
  const { battle, e } = await begin([names.first, ''], 2);
  assert.equal(drawsBody(e), true);
  battle.enemies[1].hidden = false;
  combat.changeBattleBack(battle, [names.second, '']); await e.ready;
  assert.equal(drawsBody(e), true, 'later minions must not invalidate the original presentation context');
  assert.equal(imageOf(e), `/game/Graphics/Battlebacks1/${names.second}.png`);
});

test('a blank shared mount does not duplicate the rider or backdrop into a separate monster', async t => {
  const { names, begin } = await environment(t);
  const { battle, e } = await begin([names.first, ''], 3);
  assert.equal(drawsBody(e), false);
  assert.equal(drawsBody(battle.enemies[1]), true);
  assert.equal(imageOf(battle.enemies[1]), `/game/Graphics/Battlers/${names.pictured}.png`);
});

test('a backdrop-backed blank phase supersedes sky inheritance while a genuine aerial phase preserves it', async t => {
  const { names, begin, combat } = await environment(t);
  const authored = await begin([names.first, ''], 4);
  combat.transformEnemy(authored.e, 1); await authored.e.ready;
  assert.equal(authored.e.sky, false); assert.equal(authored.e.lookAs, 0);
  assert.equal(imageOf(authored.e), `/game/Graphics/Battlebacks1/${names.first}.png`);
  const aerial = await begin(['', ''], 4);
  combat.transformEnemy(aerial.e, 1); await aerial.e.ready;
  assert.equal(aerial.e.sky, true); assert.equal(aerial.e.lookAs, 2);
  assert.equal(imageOf(aerial.e), `/game/Graphics/Battlers/${names.pictured}.png`);
});

const puppetPacket = changes => ({ id: 77, enemyId: 1, fx: 20, fy: 16, hp: 100, mp: 10, states: [],
  state: 'chase', flags: 2, k: 1, grog: 100, hover: 0, lift: 0, aim: null, mi: 0, ...changes });

test('real guest puppets render authored cutouts and unchanged metadata reuses the same body', async t => {
  const { names, combat } = await environment(t);
  const packet = puppetPacket({ battlebacks: [names.first, ''] });
  combat.applyPuppets([packet]);
  const e = combat.puppets.get(77); await e.ready;
  assert.equal(e.puppet, true); assert.equal(e.battle, combat.puppetBattle);
  assert.equal(drawsBody(e), true); assert.equal(imageOf(e), `/game/Graphics/Battlebacks1/${names.first}.png`);
  const group = e.group, ready = e.ready;
  combat.applyPuppets([{ ...packet, battlebacks: [names.first, ''], hp: 70 }]); await e.ready;
  assert.equal(combat.puppets.get(77), e); assert.equal(e.group, group); assert.equal(e.ready, ready);
  assert.equal(e.b.hp, 70); assert.equal(group.children.filter(x => x.geometry?.type === 'PlaneGeometry').length, 1);
});

test('late same-ID guest art replaces one body, and legacy metadata clears the previous art without repeated rebuilds', async t => {
  const { names, combat } = await environment(t);
  const legacy = puppetPacket(); combat.applyPuppets([legacy]);
  const e = combat.puppets.get(77); await e.ready;
  assert.equal(drawsBody(e), false);
  const legacyGroup = e.group;
  combat.applyPuppets([puppetPacket({ battlebacks: [names.first, ''] })]); await e.ready;
  assert.equal(combat.puppets.get(77), e); assert.notEqual(e.group, legacyGroup);
  assert.equal(legacyGroup.parent, null); assert.equal(drawsBody(e), true);
  const picturedGroup = e.group;
  combat.applyPuppets([legacy]); await e.ready;
  assert.equal(combat.puppets.get(77), e); assert.notEqual(e.group, picturedGroup);
  assert.equal(picturedGroup.parent, null); assert.equal(drawsBody(e), false);
  const clearedGroup = e.group, ready = e.ready;
  combat.applyPuppets([legacy]); combat.applyPuppets([puppetPacket({ battlebacks: null })]); await e.ready;
  assert.equal(e.group, clearedGroup); assert.equal(e.ready, ready, 'undefined and null both mean legacy absent metadata');
  assert.equal(combat.root.children.filter(x => x.userData.enemy).length, 1);
});

test('late guest texture generations cannot duplicate or resurrect art after a newer legacy snapshot', async t => {
  const { names, combat, images, loaded } = await environment(t, { manual: true });
  combat.applyPuppets([puppetPacket({ battlebacks: [names.first, ''] })]);
  const e = combat.puppets.get(77), first = e.ready, firstGroup = e.group;
  await loaded(1);
  combat.applyPuppets([puppetPacket({ battlebacks: [names.second, ''] })]);
  const second = e.ready, secondGroup = e.group;
  await loaded(2);
  combat.applyPuppets([puppetPacket()]); const latest = e.ready, latestGroup = e.group;
  images[1].onload(); images[0].onload(); await Promise.all([first, second, latest]);
  assert.equal(e.group, latestGroup); assert.equal(firstGroup.children.length, 0); assert.equal(secondGroup.children.length, 0);
  assert.equal(drawsBody(e), false, 'an obsolete cutout must not reappear after absent metadata');
  assert.equal(latestGroup.children.filter(x => x.geometry?.type === 'PlaneGeometry').length, 1);
  combat.applyPuppets([puppetPacket({ battlebacks: [names.first, ''] })]); await e.ready;
  assert.equal(drawsBody(e), true); assert.equal(imageOf(e), `/game/Graphics/Battlebacks1/${names.first}.png`);
  assert.equal(images.length, 2, 'valid loaded images remain reusable after discarded builds');
  assert.equal(combat.root.children.filter(x => x.userData.enemy).length, 1);
  assert.equal(e.group.children.filter(x => x.geometry?.type === 'PlaneGeometry').length, 1);
});

test('a live troop phase changes its owner without seeding an unrelated future encounter', async t => {
  const { names, map, source, change, begin } = await environment(t);
  const first = await begin([names.first, '']);
  const phase = source(); phase.troop = true; phase.battleOwner = first.battle;
  change(phase, [names.second, '']); await first.e.ready;
  assert.deepEqual(first.battle.battlebacks, [names.second, '']);
  assert.deepEqual(map.battlebacks, [names.first, ''], 'a troop phase is local to its concurrent fight');
  const next = source(); next.params = [0, 1, false, false]; next.c301();
  await Promise.all(next.battle.enemies.map(e => e.ready));
  assert.deepEqual(next.battle.battlebacks, [names.first, '']);
  assert.equal(imageOf(next.battle.enemies[0]), `/game/Graphics/Battlebacks1/${names.first}.png`);
  assert.equal(imageOf(first.e), `/game/Graphics/Battlebacks1/${names.second}.png`);
});

test('map backdrop changes prepare future fights while only the owning troop can repaint the active theater', async t => {
  const { names, map, source, change, begin } = await environment(t);
  const first = await begin([names.first, '']);
  const calls = [];
  G.theater = { active: true, battle: first.battle, battleBack: name => calls.push(name) };
  const other = source(); change(other, [names.second, '']);
  assert.deepEqual(map.battlebacks, [names.second, '']);
  assert.deepEqual(other.battlebacks, [names.second, '']);
  assert.deepEqual(first.battle.battlebacks, [names.first, '']);
  assert.deepEqual(calls, [], 'an unrelated map interpreter cannot repaint the active stage');
  const phase = source(); phase.troop = true; phase.battleOwner = first.battle;
  change(phase, [names.second, '']); await first.e.ready;
  assert.deepEqual(calls, [names.second], 'the active stage receives its own troop change');
  assert.deepEqual(first.battle.battlebacks, [names.second, '']);
  assert.deepEqual(map.battlebacks, [names.second, '']);
});
