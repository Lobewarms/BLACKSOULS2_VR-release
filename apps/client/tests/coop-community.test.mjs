import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { GameState } from '../src/game/state.js';
import { Interpreter } from '../src/game/interpreter.js';
import { cleanChat, clipChatText, tagScale, CoopChat } from '../src/network/coopchat.js';
import { CoopAvatar } from '../src/network/coopavatar.js';

globalThis.addEventListener ||= () => {};
const { Coop } = await import('../src/network/coop.js');
const cmd = (code, ...parameters) => ({ code, parameters, indent: 0 });
function environment(t) {
  const previous = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, previous); Object.assign($data, data); });
  Object.assign($data, { system: { currency_unit: 'Souls' }, actors: [], classes: [], states: [],
    items: [null, { id: 1, name: 'Synthetic herb', note: '', features: [] }], weapons: [], armors: [], commonEvents: [] });
  const packets = [], toasts = [];
  Object.assign(G, { settings: {}, scripts: {}, map: { mapId: 1, playerChar: {}, events: { 1: {} }, requestRefresh() {} },
    ui: { toast: (...args) => toasts.push(args), messageBusy: () => false }, state: new GameState(), voice: null, chat: null });
  const coop = G.coop = new Coop(new THREE.Scene()); coop.role = 'world'; coop.wphase = 'in';
  coop.worldRules.shareLoot = true; coop.roster = [['peer', 'Друг', 'abcdef012345', 1]];
  coop.send = (...args) => packets.push(args);
  return { coop, packets, toasts };
}

test('chat retains multilingual and emoji text while bounding length and stripping invisible/control payloads', () => {
  assert.equal(cleanChat('  Привет 世界 안녕 日本語 👩‍🚀  '), 'Привет 世界 안녕 日本語 👩‍🚀');
  assert.equal(cleanChat('A\nB\tC\u202eD\u0000\ue001'), 'A B CD');
  assert.equal([...clipChatText('😀'.repeat(100))].length, 80);
  assert.equal(cleanChat(null), ''); assert.equal(cleanChat({ toString: () => 'bad' }), '');
  assert.ok([...cleanChat('a' + '\u0301'.repeat(100))].length < 6);
});

test('distance text scale remains readable and bounded for near and remote avatars', () => {
  assert.equal(tagScale(0), 1); assert.equal(tagScale(3), 1); assert.equal(tagScale(9), 3); assert.equal(tagScale(1000), 5);
});

test('actual co-op chat dispatch honors session membership and player mute tags', t => {
  const { coop } = environment(t), heard = [], voice = [];
  G.chat = { onChat: (...args) => heard.push(args) }; G.voice = { onVoice: (...args) => voice.push(args) };
  coop.role = 'host'; coop.peers.set('peer', { id: 'peer', tag: 'abcdef012345', name: 'Друг' });
  coop.receive(JSON.stringify({ t: 'ch', s: 'こんにちは' }), 'stranger'); assert.equal(heard.length, 0);
  G.settings.chatMuted = ['abcdef012345']; coop.receive(JSON.stringify({ t: 'ch', s: 'こんにちは' }), 'peer');
  coop.receive(JSON.stringify({ t: 'vo', d: 'AAAA', n: 1 }), 'peer');
  assert.equal(heard[0][2], 'Друг'); assert.equal(heard[0][4], true); assert.equal(voice[0][2], true);
});

test('only authored constant map-event rewards or explicit battle rewards enter shared loot, never consumables or variable returns', t => {
  const { coop } = environment(t);
  const run = (list, main = true, event = 1) => { const it = new Interpreter(0, main); it.setup([...list, cmd(0)], event); it.update(); };
  run([cmd(126, 1, 0, 0, 2), cmd(125, 0, 0, 20)]);
  assert.deepEqual(coop.outLoot, [['item', 1, 2], ['gold', 0, 20]]);
  coop.outLoot = []; G.state.setV(5, 3); run([cmd(126, 1, 0, 1, 5)]);
  run([cmd(126, 1, 0, 0, 1)], false, 0); G.state.party.gainItem('item', 1, 1);
  assert.deepEqual(coop.outLoot, []);
  coop.lootDepth++; G.state.party.gainItem('item', 1, 1); coop.lootDepth--;
  assert.deepEqual(coop.outLoot, [['item', 1, 1]]);
});

test('received shared loot validates amounts and IDs, updates the real bag once and never echoes rewards', t => {
  const { coop } = environment(t);
  coop.onLoot({ g: [['item', 1, 4], ['gold', 0, 100], ['item', 1, -1], ['item', 999, 1], ['item', 1, 1.5]] }, 'peer');
  assert.equal(G.state.party.itemCount('item', 1), 4); assert.equal(G.state.party.gold, 100);
  assert.deepEqual(coop.outLoot, []); assert.equal(coop.lootIn, false);
  coop.worldRules.shareLoot = false; coop.onLoot({ g: [['item', 1, 2]] }, 'peer'); assert.equal(G.state.party.itemCount('item', 1), 4);
});

test('speaking/lowered-shield pose fields reject malformed values but legacy poses remain compatible', t => {
  const { coop } = environment(t), poses = [], p = { id: 'peer', seq: -1, avatar: { setPose: v => poses.push(v) } };
  coop.peers.set('peer', p); coop.avatarOf = () => p.avatar; coop.aimMarkOf = () => {};
  const base = { t: 'p', s: 1, m: 1, h: [0, 1.7, 0, 0], R: {}, L: {} };
  coop.onPose(base, 'peer'); assert.equal(poses[0].v, 0); assert.equal(poses[0].L.lo, 0);
  coop.onPose({ ...base, s: 2, v: 1, L: { lo: 1 } }, 'peer'); assert.equal(poses[1].v, 1); assert.equal(poses[1].L.lo, 1);
  for (const bad of [{ v: 2 }, { v: '1' }, { L: { lo: true } }]) coop.onPose({ ...base, s: 3, ...bad }, 'peer');
  assert.equal(poses.length, 2);
});

test('a lowered remote shield is visible but cannot participate in blade collision', t => {
  environment(t); const avatar = new CoopAvatar(new THREE.Scene()); t.after(() => avatar.dispose());
  const h = avatar.hands.left; h.kind = 'shield'; h.lowered = true; h.item.visible = true;
  h.item.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.1), new THREE.MeshBasicMaterial()));
  assert.deepEqual(avatar.heldShapes(), []); h.lowered = false; assert.equal(avatar.heldShapes().length, 1);
});

test('PC slash opens chat only in gameplay and cannot steal Skills search or IME composition', t => {
  environment(t); let key, opens = 0;
  const chat = new CoopChat(new THREE.Scene(), { events: { addEventListener: (_type, fn) => { key = fn; }, removeEventListener() {} } });
  chat.openPanel = () => { opens++; }; t.after(() => chat.dispose());
  const press = options => key({ key: '/', preventDefault() {}, ...options });
  press(); assert.equal(opens, 1); G.ui.menuOpen = true; press(); assert.equal(opens, 1);
  G.ui.menuOpen = false; press({ isComposing: true }); press({ target: { tagName: 'INPUT' } }); assert.equal(opens, 1);
});

test('PvP bounce acknowledgements apply only once to a recent authorized swing on the same map', t => {
  const { coop, packets } = environment(t); let bounces = 0;
  coop.peers.set('peer', { id: 'peer', pose: { m: 1 } }); coop.pvpWith = () => true; coop.ready = () => true;
  G.combat = { bounce: () => { bounces++; } };
  const actor = Object.fromEntries(['atk', 'def', 'mat', 'mdf', 'agi', 'luk', 'hp', 'mhp', 'mp', 'mmp', 'level'].map(k => [k, 10]));
  actor.atkElements = () => [1]; coop.sendPvp('peer', 1, 1, false, actor, false, 0.75);
  assert.equal(packets[0][0].sa, 0.75); coop.onBounced('stranger'); assert.equal(bounces, 0);
  coop.onBounced('peer'); coop.onBounced('peer'); assert.equal(bounces, 1);
  coop.sendPvp('peer', 1, 1, false, actor, false, 0.75); coop.peers.get('peer').pose.m = 2;
  coop.onBounced('peer'); assert.equal(bounces, 1);
});

test('validated PvP super-armor data reaches combat and shield guards acknowledge bounce without accepting invalid pressure', t => {
  const { coop, packets } = environment(t), hits = [];
  $data.skills = [null, { id: 1 }]; coop.peers.set('peer', { id: 'peer', pose: { m: 1 } }); coop.pvpWith = () => true; coop.ready = () => true;
  G.combat = { pvpStruck: (...args) => { hits.push(args); return 'guard'; }, hasShield: true, shieldOut: true };
  const stats = Object.fromEntries(['atk', 'def', 'mat', 'mdf', 'agi', 'luk', 'hp', 'mhp', 'mp', 'mmp', 'level'].map(k => [k, 10]));
  const valid = { s: 1, a: stats, el: [1], m: 1, sa: 0.5 };
  for (const sa of [-1, 6, Infinity, '1']) coop.onPvp({ ...valid, sa }, 'peer'); assert.equal(hits.length, 0);
  coop.onPvp(valid, 'peer'); assert.equal(hits[0][4], 0.5); assert.deepEqual(packets.at(-1), [{ t: 'bn' }, 'peer']);
  delete valid.sa; coop.onPvp(valid, 'peer'); assert.equal(hits[1][4], 0, 'legacy clients have no invented super-armor pressure');
});
