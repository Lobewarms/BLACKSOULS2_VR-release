import test from 'node:test';
import assert from 'node:assert/strict';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { packEnemyMp, readEnemyMp } from '../src/network/enemy-resources.js';

globalThis.addEventListener ||= () => {};
const { Coop } = await import('../src/network/coop.js');

function environment(t) {
  const saved = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, saved); Object.assign($data, data); });
  $data.enemies = [null, { id: 1, params: [100, 100, 10, 10, 10, 10, 10, 10], features: [] }];
  $data.states = [];
  const enemy = { netId: 10, state: 'chase', fx: 1, fy: 2, group: { visible: true }, b: {
    enemyId: 1, hp: 100, mhp: 100, mp: 75, mmp: 100, states: [], buffs: Array(8).fill(0),
  } };
  const peer = { id: 'guest', host: false, pose: { m: 1 }, hvm: 1, hv: new Set(['9:0']) };
  const packets = [], received = [], hits = [];
  Object.assign(G, { map: { mapId: 1 }, theater: null, scripts: {}, coop: null, combat: {
    symbols: new Map(), puppets: new Map(), netEnemies: () => [enemy], groggyMax: () => 0,
    applyPuppets: (...args) => received.push(args), applyGuestHit: (...args) => hits.push(args),
    hallGroups: () => new Map([['9:0', { enemies: [enemy], age: 2 }]]), hallKeysSeen: () => ['9:0'],
  } });
  const coop = Object.assign(Object.create(Coop.prototype), {
    ready: () => true, guests: () => [peer], peers: new Map([[peer.id, peer]]), followHall: () => true,
    send: (...args) => packets.push(args),
  });
  return { coop, enemy, peer, packets, received, hits };
}

test('optional enemy MP metadata preserves zero and rejects absent, inherited or malformed values', () => {
  assert.equal(readEnemyMp({ 10: 0 }, 10), 0);
  assert.equal(readEnemyMp({ 10: 100 }, 10), 100);
  for (const value of [-1, 1.5, Infinity, NaN, '50', null, 1e8 + 1]) assert.equal(readEnemyMp({ 10: value }, 10), null);
  for (const value of [undefined, null, [], {}, Object.create({ 10: 50 })]) assert.equal(readEnemyMp(value, 10), null);
  assert.deepEqual(packEnemyMp([{ netId: 10, b: { mp: 0 } }, { netId: 11, b: { mp: 50 } },
    { netId: 12, b: {} }, { netId: 13, b: { mp: -1 } }]), { 10: 0, 11: 50 });
});

test('real co-op enemy send/receive carries current MP without changing the legacy tuple', t => {
  const { coop, enemy, packets, received } = environment(t);
  coop.sendEnemies();
  const packet = packets[0][0];
  assert.equal(packet.e[0].length, 15); assert.deepEqual(packet.mp, { 10: 75 });
  coop.onEnemies(packet); assert.equal(received.at(-1)[0][0].mp, 75);
  enemy.b.mp = 0; coop.sendEnemies();
  coop.onEnemies(packets.at(-1)[0]); assert.equal(received.at(-1)[0][0].mp, 0);
  delete packet.mp; coop.onEnemies(packet); assert.equal(received.at(-1)[0][0].mp, null, 'legacy hosts remain readable');
  packet.mp = { 10: -100 }; coop.onEnemies(packet);
  assert.equal(received.at(-1)[0][0].mp, null); assert.equal(received.at(-1)[0].length, 1, 'bad optional metadata cannot discard a valid enemy');
});

test('private enemy snapshots retain their 17-field tuple and carry the same validated MP metadata', t => {
  const { coop, packets, received } = environment(t);
  coop.sendHallucinations();
  const packet = packets[0][0]; assert.equal(packet.e[0].length, 17); assert.deepEqual(packet.mp, { 10: 75 });
  coop.onHallEnemies(packet, 'guest');
  assert.equal(received.at(-1)[0][0].mp, 75); assert.equal(received.at(-1)[1], 'guest');
  delete packet.mp; coop.onHallEnemies(packet, 'guest'); assert.equal(received.at(-1)[0][0].mp, null);
});

test('validated guest MP losses and gains reach authority while legacy reports default to zero', t => {
  const { coop, hits } = environment(t);
  const report = { id: 10, d: 0, add: [], rm: [], g: 0, brk: 0, big: false };
  for (const md of [30, -20, 0]) { coop.onHit({ ...report, md }, 'guest'); assert.equal(hits.at(-1)[0].md, md); }
  coop.onHit(report, 'guest'); assert.equal(hits.at(-1)[0].md, 0); assert.equal(hits.at(-1)[1], 'guest');
  const count = hits.length;
  for (const md of [1.5, '30', NaN, Infinity, null, 1e7 + 1, -1e7 - 1]) coop.onHit({ ...report, md }, 'guest');
  assert.equal(hits.length, count);
});

test('MP reports preserve existing peer and map authority checks', t => {
  const { coop, peer, hits } = environment(t), report = { id: 10, d: 0, add: [], rm: [], g: 0, brk: 0, big: false, md: 10 };
  coop.onHit(report, 'stranger'); assert.equal(hits.length, 0);
  peer.pose.m = 2; coop.onHit(report, 'guest'); assert.equal(hits.length, 0);
  peer.pose.m = 1; peer.host = true; coop.onHit(report, 'guest'); assert.equal(hits.length, 0);
});
