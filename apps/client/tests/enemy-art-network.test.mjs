import test from 'node:test';
import assert from 'node:assert/strict';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { initAssets } from '../src/data/assets.js';
import { packEnemyArt, readEnemyArt } from '../src/network/enemy-art.js';

globalThis.addEventListener ||= () => {};
const { Coop } = await import('../src/network/coop.js');
const names = ['Synthetic floor', '合成の背景'];

async function assets(t) {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: [
    `Graphics/Battlebacks1/${names[0]}.png`, `Graphics/Battlebacks2/${names[1]}.png`,
    'Graphics/Pictures/Not-a-battleback.png', 'Graphics/Battlebacks1/../Pictures/secret.png',
  ], rtp: ['Graphics/Battlebacks2/Synthetic RTP.png'] }));
  await initAssets();
}

async function environment(t) {
  await assets(t);
  const saved = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, saved); Object.assign($data, data); });
  $data.enemies = [null, { id: 1, features: [] }]; $data.states = [];
  const enemy = { netId: 10, state: 'chase', fx: 1, fy: 2, battlebacks: names.slice(),
    group: { visible: true }, b: { enemyId: 1, hp: 100, mhp: 100, mp: 0, states: [], buffs: Array(8).fill(0) } };
  const peer = { id: 'host', pose: { m: 1 }, hvm: 1, hv: new Set(['9:0']) };
  const packets = [], received = [], current = new Map();
  Object.assign(G, { map: { mapId: 1 }, theater: null, combat: {
    symbols: new Map(), puppets: current, netEnemies: () => [enemy], groggyMax: () => 0,
    applyPuppets(list, from) { received.push([list, from]); for (const entry of list) current.set(entry.id, entry); },
    hallGroups: () => new Map([['9:0', { enemies: [enemy], age: 2 }]]), hallKeysSeen: () => ['9:0'],
  } });
  const coop = Object.assign(Object.create(Coop.prototype), {
    role: 'guest', hostId: 'host', summoned: true, ready: () => true, guests: () => [peer],
    peers: new Map([[peer.id, peer]]), followHall: () => true, hostOn: () => true,
    send: (...args) => packets.push(args),
  });
  return { coop, enemy, peer, packets, received, current };
}

test('enemy art names resolve only in their fixed local layer while preserving Unicode, RTP and explicit empty layers', async t => {
  await assets(t);
  const source = { 10: names.slice() }, decoded = readEnemyArt(source, 10);
  assert.deepEqual(decoded, names); decoded[0] = ''; assert.equal(source[10][0], names[0], 'received metadata is copied');
  assert.deepEqual(readEnemyArt({ 10: ['', 'Synthetic RTP'] }, 10), ['', 'Synthetic RTP']);
  assert.deepEqual(readEnemyArt({ 10: ['', ''] }, 10), ['', '']);
  assert.equal(readEnemyArt({ 10: [names[1], names[0]] }, 10), null, 'a layer cannot select the other layer folder');
  assert.equal(readEnemyArt({ 10: ['Not-a-battleback', ''] }, 10), null, 'an installed picture is not a battleback');
});

test('enemy art rejects unsafe paths, malformed names and inherited metadata without trusting local lookalikes', async t => {
  await assets(t);
  for (const name of ['../Pictures/secret', '..', 'sub/floor', 'sub\\floor', 'C:floor', 'https://example.test/a',
    '//example.test/a', '%2e%2e%2ffile', 'floor?x', 'floor#x', 'floor\0x', 'floor\nx', 'x'.repeat(129), 1, null]) {
    assert.equal(readEnemyArt({ 10: [name, ''] }, 10), null, String(name));
  }
  for (const pair of [[], [''], ['', '', ''], null, names[0], { 0: names[0], 1: names[1] }]) {
    assert.equal(readEnemyArt({ 10: pair }, 10), null);
  }
  for (const meta of [undefined, null, [], {}, Object.create({ 10: names })]) assert.equal(readEnemyArt(meta, 10), null);
});

test('packing enemy art copies bounded known layers and omits legacy, unsafe and invalid-ID enemies', async t => {
  await assets(t);
  const source = names.slice();
  const packed = packEnemyArt([{ netId: 10, battlebacks: source }, { netId: 11, battlebacks: ['', ''] },
    { netId: 12 }, { netId: 13, battlebacks: ['missing', ''] }, { netId: '__proto__', battlebacks: names },
    { netId: 0, battlebacks: names }, { netId: 1.5, battlebacks: names }]);
  assert.deepEqual(packed, { 10: names, 11: ['', ''] }); packed[10][0] = ''; assert.equal(source[0], names[0]);
});

test('normal enemy snapshots retain their exact legacy tuple and dispatch art only from the authority', async t => {
  const { coop, enemy, packets, received, current } = await environment(t);
  const legacy = coop.enemyEntry(enemy); coop.sendEnemies();
  const packet = packets[0][0]; assert.deepEqual(packet.e[0], legacy); assert.equal(packet.e[0].length, 15);
  assert.deepEqual(packet.art, { 10: names });
  coop.receive(JSON.stringify(packet), 'stranger'); assert.equal(received.length, 0);
  coop.receive(JSON.stringify(packet), 'host'); assert.deepEqual(current.get(10).battlebacks, names);
  enemy.battlebacks = ['', '']; coop.sendEnemies();
  coop.receive(JSON.stringify(packets.at(-1)[0]), 'host'); assert.deepEqual(current.get(10).battlebacks, ['', '']);
  delete packet.art; coop.receive(JSON.stringify(packet), 'host');
  assert.equal(current.get(10).battlebacks, null, 'a legacy host clears a previously received override');
  packet.art = { 10: ['../Pictures/secret', ''] }; coop.receive(JSON.stringify(packet), 'host');
  assert.equal(current.get(10).battlebacks, null); assert.equal(received.at(-1)[0].length, 1, 'bad optional art cannot discard the enemy');
});

test('hallucination snapshots retain 17 fields, existing visibility authority and legacy override clearing', async t => {
  const { coop, peer, packets, received, current } = await environment(t);
  coop.role = 'world'; coop.wphase = 'in'; coop.sendHallucinations();
  const packet = packets[0][0]; assert.equal(packet.e[0].length, 17); assert.deepEqual(packet.art, { 10: names });
  coop.receive(JSON.stringify(packet), 'stranger'); assert.equal(received.length, 0);
  peer.pose.m = 2; coop.receive(JSON.stringify(packet), 'host'); assert.equal(received.length, 0);
  peer.pose.m = 1; coop.receive(JSON.stringify(packet), 'host');
  assert.deepEqual(current.get(10).battlebacks, names); assert.equal(received.at(-1)[1], 'host');
  delete packet.art; coop.receive(JSON.stringify(packet), 'host'); assert.equal(current.get(10).battlebacks, null);
  packet.art = { 10: ['', ''] }; coop.receive(JSON.stringify(packet), 'host'); assert.deepEqual(current.get(10).battlebacks, ['', '']);
});
