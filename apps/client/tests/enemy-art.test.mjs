import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { initAssets } from '../src/data/assets.js';

globalThis.addEventListener ||= () => {};
const { ActionEnemy, CombatSystem } = await import('../src/combat/combat.js');

function canvas() {
  const texts = [];
  const ctx = new Proxy({
    clearRect() { texts.length = 0; }, fillText(text) { texts.push(text); },
    drawImage() {}, measureText: text => ({ width: String(text).length * 12 }),
    getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }),
    createRadialGradient: () => ({ addColorStop() {} }),
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  return { width: 0, height: 0, texts, getContext: () => ctx };
}

const drawsBody = e => !!e.mesh && e.mesh.visible && e.mat.visible && e.mat.opacity > 0;
const enemyData = (id, name, image = '') => ({ id, name, battler_name: image, battler_hue: 0,
  params: [100, 20, 10, 10, 10, 10, 10, 10], features: [], note: '', actions: [] });

async function environment(t, { names = [], manual = false, failures = 0 } = {}) {
  const previous = { ...G }, data = { ...$data };
  const descriptors = ['document', 'Image'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const images = [], attempts = new Map();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: canvas } });
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class {
    width = 84; height = 168;
    set src(url) {
      this.url = url;
      const count = (attempts.get(url) || 0) + 1; attempts.set(url, count);
      images.push(this);
      if (!manual) queueMicrotask(() => count <= failures ? this.onerror() : this.onload());
    }
  } });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: names.map(name => `Graphics/Battlers/${name}.png`) }));
  await initAssets();
  Object.assign($data, { enemies: [null, enemyData(1, 'Controller')], states: [null, { id: 1, name: 'Death', features: [] }],
    system: { currency_unit: 'Souls' }, classes: [] });
  Object.assign(G, { state: { v: () => 0, sw: () => false }, scripts: {}, theater: null,
    time: 0, floorAt: () => 0, coop: null, map: null });
  const glow = new THREE.Texture();
  const combat = Object.assign(Object.create(CombatSystem.prototype), { root: new THREE.Group(), enemies: [],
    glowTexture: () => glow, skyHidden: () => false, groggyMax: () => 0, dropMarker() {}, hideBlade() {} });
  const bodies = [];
  const make = (id = 1, opts = {}) => {
    const body = new ActionEnemy(combat, null, id, 0, 0, { dormant: true, ...opts });
    bodies.push(body); combat.enemies.push(body); return body;
  };
  t.after(() => {
    for (const body of bodies) body.remove();
    glow.dispose(); Object.assign(G, previous); Object.assign($data, data);
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  const loaded = async count => {
    for (let i = 0; i < 15 && images.length < count; i++) await Promise.resolve();
    assert.equal(images.length, count, 'expected pending synthetic image requests');
  };
  return { combat, make, images, loaded, attempts };
}

test('an authored empty battler has no colored body while its original combat and nameplate remain', async t => {
  const { make, images } = await environment(t);
  const e = make(); await e.ready;
  assert.equal(drawsBody(e), false, 'VX Ace empty_bitmap is transparent, never a red placeholder');
  assert.equal(e.alive, true); assert.equal(e.b.hp, 100);
  assert.ok(e.r > 0 && e.hr > 0, 'the invisible controller retains combat dimensions');
  assert.equal(images.length, 0, 'a deliberate blank is not a missing asset request');
  e.updateNameplate(new THREE.Vector3(0, 1.6, 3));
  assert.equal(e.bar.visible, true); assert.ok(e.barCanvas.texts.includes('Controller'));
  $data.enemies[2] = enemyData(2, '');
  const unnamed = make(2); await unnamed.ready;
  assert.equal(drawsBody(unnamed), false); assert.equal(unnamed.alive, true);
});

test('unpairing, revival and ordinary material animation cannot reveal an authored blank', async t => {
  const { combat, make } = await environment(t);
  const e = make(); await e.ready;
  const rider = { pair: null }, pair = { horse: e, rider };
  e.pair = rider.pair = pair; e.mesh.visible = false;
  combat.unpairMount(pair);
  e.mat.opacity = 1; e.mat.color.setRGB(1, 1, 1); e.mat.emissive.setRGB(0.9, 0.9, 0.9);
  assert.equal(drawsBody(e), false, 'unpairMount must not expose the controller plane');
  combat.reviveEnemy(e);
  assert.equal(drawsBody(e), false, 'Recover All may revive combat without inventing visible art');
  assert.equal(e.alive, true);
});

test('inherited pictured forms and theater texture overrides retain their real art', async t => {
  const name = 'enemy-art-inherited';
  const { make } = await environment(t, { names: [name] });
  $data.enemies[2] = enemyData(2, 'Pictured form', name);
  const inherited = make(1, { lookAs: 2 }); await inherited.ready;
  assert.equal(drawsBody(inherited), true); assert.ok(inherited.mat.map?.isTexture);
  assert.equal(inherited.picW, 84);
  const tex = new THREE.Texture(); t.after(() => tex.dispose());
  G.theater = { battlerTexture: () => Promise.resolve({ tex, w: 50, h: 100, core: 20 }), scaleOf: () => 1 };
  const theater = make(); await theater.ready;
  assert.equal(drawsBody(theater), true); assert.equal(theater.mat.map, tex);
});

test('a transient named-image failure stays invisible and the next body retries, then shares success', async t => {
  const name = 'enemy-art-retry';
  const { make, images } = await environment(t, { names: [name], failures: 1 });
  $data.enemies[1].battler_name = name;
  const failed = make(); await failed.ready;
  assert.equal(drawsBody(failed), false, 'failed art must not become a solid rectangle');
  const recovered = make(); await recovered.ready;
  assert.equal(drawsBody(recovered), true); assert.equal(images.length, 2, 'a null battler texture must be evicted');
  const shared = make(); await shared.ready;
  assert.equal(shared.mat.map, recovered.mat.map); assert.equal(images.length, 2);
});

test('rejected battler texture work can retry without leaving a permanently rejected cache', async t => {
  const name = 'enemy-art-rejection';
  const { make, images } = await environment(t, { names: [name] });
  $data.enemies[1].battler_name = name;
  const original = document.createElement;
  let rejectOnce = true;
  document.createElement = () => {
    const c = original(); const get = c.getContext;
    c.getContext = () => {
      const ctx = get();
      const read = ctx.getImageData;
      ctx.getImageData = (...args) => { if (rejectOnce) { rejectOnce = false; throw new Error('Synthetic transient read failure'); } return read(...args); };
      return ctx;
    };
    return c;
  };
  const failed = make(); await failed.ready;
  assert.equal(drawsBody(failed), false);
  const recovered = make(); await recovered.ready;
  assert.equal(drawsBody(recovered), true); assert.equal(images.length, 1, 'the successful source image is reusable after texture analysis failed');
});

test('removing a loading enemy prevents its completed texture from building a detached body', async t => {
  const name = 'enemy-art-removed';
  const { make, images, loaded, combat } = await environment(t, { names: [name], manual: true });
  $data.enemies[1].battler_name = name;
  const e = make(), pending = e.ready, group = e.group;
  await loaded(1); e.remove(); images[0].onload(); await pending;
  assert.equal(combat.root.children.includes(group), false);
  assert.equal(group.children.length, 0, 'removed pending work must not allocate meshes, labels or effect sprites');
  assert.equal(e.mesh, undefined);
});

test('A to B to A transforms discard obsolete builds even when the final database ID matches', async t => {
  const a = 'enemy-art-race-a', b = 'enemy-art-race-b';
  const { make, images, loaded, combat } = await environment(t, { names: [a, b], manual: true });
  $data.enemies[1].battler_name = a; $data.enemies[2] = enemyData(2, 'Second form', b);
  const e = make(), first = e.ready, originalGroup = e.group;
  await loaded(1);
  combat.transformEnemy(e, 2); const middle = e.ready, middleGroup = e.group;
  await loaded(2);
  combat.transformEnemy(e, 1); const latest = e.ready, latestGroup = e.group;
  images[1].onload(); images[0].onload();
  await Promise.all([first, middle, latest]);
  assert.equal(e.group, latestGroup); assert.equal(e.b.enemyId, 1);
  assert.equal(originalGroup.children.length, 0); assert.equal(middleGroup.children.length, 0);
  assert.equal(latestGroup.children.filter(child => child.geometry?.type === 'PlaneGeometry').length, 1,
    'only the latest generation may add an enemy body');
  assert.equal(latestGroup.children.filter(child => child.isSprite && child.material.map === e.barTex).length, 1);
  assert.equal(drawsBody(e), true);
});

test('same-ID revival while art loads builds only the new attached group', async t => {
  const name = 'enemy-art-revive';
  const { make, images, loaded, combat } = await environment(t, { names: [name], manual: true });
  $data.enemies[1].battler_name = name;
  const e = make(), first = e.ready, oldGroup = e.group;
  await loaded(1); e.remove(); combat.reviveEnemy(e); const latest = e.ready;
  images[0].onload(); await Promise.all([first, latest]);
  assert.notEqual(e.group, oldGroup); assert.equal(oldGroup.children.length, 0);
  assert.equal(e.group.children.filter(child => child.geometry?.type === 'PlaneGeometry').length, 1);
  assert.equal(drawsBody(e), true); assert.equal(e.state, 'recover');
});
