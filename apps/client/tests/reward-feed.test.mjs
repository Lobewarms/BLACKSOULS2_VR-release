import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RewardFeed } from '../src/ui/reward-feed.js';
import { fitLabel } from '../src/ui/battler-status.js';
import { drawGameWindow, setWindowSkin } from '../src/ui/window-skin.js';

function canvas() {
  const record = { images: [], texts: [] }, states = [];
  const ctx = new Proxy({
    globalAlpha: 1, font: '', textAlign: 'left',
    clearRect() { record.images.length = 0; record.texts.length = 0; },
    save() { states.push({ globalAlpha: ctx.globalAlpha, font: ctx.font, textAlign: ctx.textAlign }); },
    restore() { Object.assign(ctx, states.pop()); },
    drawImage(...args) { record.images.push({ args, alpha: ctx.globalAlpha }); },
    fillText(text, x, y) { record.texts.push({ text, x, y, alpha: ctx.globalAlpha, font: ctx.font, align: ctx.textAlign }); },
    measureText: text => ({ width: Array.from(String(text)).length * 18 }),
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  return { width: 0, height: 0, record, getContext: () => ctx };
}
class Panel {
  constructor(width, height, widthM) {
    this.canvas = canvas(); this.canvas.width = width; this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d'); this.widthM = widthM; this.heightM = widthM * height / width;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthM, this.heightM),
      new THREE.MeshBasicMaterial({ transparent: true, depthTest: false }));
    this.mesh.visible = false; this.commits = 0;
  }
  clear() { this.ctx.clearRect(); }
  commit() { this.commits++; }
}
const viewport = { width: 1280, height: 720 };
const item = (name = 'Game item', icon_index = 529) => ({ name, icon_index });
function setup(overrides = {}) {
  const camera = new THREE.PerspectiveCamera(75, viewport.width / viewport.height, 0.1, 100);
  const hud = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), new THREE.MeshBasicMaterial());
  const feed = new RewardFeed({ Panel, camera, hud, font: 'GameFont', fitLabel, moreLabel: n => `${n} more gains`, ...overrides });
  const update = (dt, options = {}) => feed.update(dt, { viewport, ...options });
  return { feed, camera, hud, update };
}

test('rewards merge recent identical game items and currency while preserving kinds and admission spacing', () => {
  const { feed, update } = setup();
  assert.equal(feed.gain('item', 1, 2, item('Original potion')), true);
  feed.gain('item', 1, 3, item('Original potion')); feed.gain('weapon', 1, 1, item('Original sword'));
  feed.gain('armor', 1, 1, item('Original shield')); feed.gold(7, item('Souls', 0)); feed.gold(5, item('Souls', 0));
  assert.equal(feed.queue.length, 4); assert.equal(feed.queue[0].count, 5); assert.equal(feed.queue[3].count, 12);
  update(0); assert.equal(feed.rows.length, 1); assert.equal(feed.rows[0].name, 'Original potion');
  update(0.2); assert.equal(feed.rows.length, 1, 'a pickup batch must not flood the screen at once');
  update(0.2); update(0.4); assert.equal(feed.rows.length, 3); assert.equal(feed.queue.length, 1);
  feed.gain('item', 1, 1, item('Original potion')); assert.equal(feed.rows[0].count, 6); assert.equal(feed.rows[0].age, 0);
  update(2.1); feed.gain('item', 1, 1, item('Original potion'));
  assert.equal(feed.queue.length, 2, 'a later pickup starts a new entry instead of reviving an unrelated old batch');
  assert.equal(feed.blocking, false);
});

test('invalid or nonpositive rewards are ignored, zero game icon IDs are allowed and the queue is bounded', () => {
  const { feed, update } = setup();
  for (const count of [0, -1, 0.5, Number.NaN, Infinity, '2', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(feed.gain('item', 1, count, item()), false); assert.equal(feed.gold(count, item('Souls', 0)), false);
  }
  assert.equal(feed.gain('other', 1, 1, item()), false); assert.equal(feed.gain('item', 0, 1, item()), false);
  assert.equal(feed.gain('item', 1, 1, null), false); assert.equal(feed.gain('item', 1, 1, item(' ')), false);
  assert.equal(feed.queue.length, 0);
  for (let id = 1; id <= 60; id++) feed.gain('item', id, 1, item('Original ' + id, 0));
  assert.equal(feed.queue.length, 24); assert.equal(feed.omitted, 36);
  update(0); assert.equal(feed.rows[0].name, '36 more gains'); assert.equal(feed.rows[0].kind, 'overflow');
  update(0.4); update(0.4); assert.equal(feed.rows.length, 3); assert.equal(feed.rows[1].icon, 0);
  assert.ok(feed.queue.length <= 24); assert.equal(feed.mesh.visible, true);
  feed.clear(); assert.equal(feed.rows.length, 0); assert.equal(feed.queue.length, 0); assert.equal(feed.omitted, 0);
  assert.equal(feed.mesh.visible, false);
});

test('menu, dialogue, death and hidden-window pauses preserve pending pickups and every visible timer', () => {
  const { feed, update } = setup(); feed.gain('item', 1, 1, item()); update(0); update(1);
  feed.gold(5, item('Souls', 0)); const clock = feed.clock, age = feed.rows[0].age, pending = feed.queue.length;
  for (const options of [{ paused: true }, { visible: false }, { viewport: { width: 640, height: 720 } },
    { viewport: { width: 1280, height: 200 } }]) {
    update(100, options);
    assert.equal(feed.mesh.visible, false); assert.equal(feed.clock, clock); assert.equal(feed.rows[0].age, age);
    assert.equal(feed.queue.length, pending);
  }
  update(0); assert.equal(feed.mesh.visible, true); assert.equal(feed.rows[0].age, age);
  const resumedClock = feed.clock; update(Number.NaN); update(-1); assert.equal(feed.clock, resumedClock);
});

function paintedRect(feed, camera, size) {
  camera.aspect = size.width / size.height; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  const point = (x, y) => {
    const ndc = feed.mesh.localToWorld(new THREE.Vector3(x, y, 0)).project(camera);
    return { x: (ndc.x + 1) * size.width / 2, y: (1 - ndc.y) * size.height / 2 };
  };
  const upper = point(-feed.panel.widthM / 2, feed.panel.heightM / 2);
  const lower = point(feed.panel.widthM / 2, feed.panel.heightM / 2 - feed.paintedHeight / feed.panel.canvas.height * feed.panel.heightM);
  return { left: upper.x, top: upper.y, right: lower.x, bottom: lower.y };
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} should equal ${expected}`);

test('desktop pickup artwork stays below the central view and within the lower-right safe margins', () => {
  for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 },
    { width: 900, height: 400 }, { width: 701, height: 260 }]) {
    const { feed, camera, update } = setup(); camera.aspect = size.width / size.height;
    camera.fov = 100; camera.zoom = 1.2; camera.rotation.set(0.4, 1.2, 0.15); camera.updateProjectionMatrix();
    for (let id = 1; id <= 3; id++) feed.gain('item', id, 1, item('Original ' + id));
    for (let i = 0; i < 3; i++) update(0.4, { viewport: size });
    const rect = paintedRect(feed, camera, size), width = rect.right - rect.left;
    assert.ok(rect.top >= size.height * 0.65, 'pickup text must leave the crosshair and centre unobstructed');
    assert.ok(width <= Math.min(300, size.width * 0.35) + 1e-5);
    near(rect.right, size.width - 24); near(rect.bottom, size.height - 20);
    assert.ok(rect.left >= 320, 'the pickup feed remains clear of the desktop player HUD on the left');
  }
});

test('rows concealed by a shorter window wait without ageing and VR placement stays beneath the wrist HUD', () => {
  const { feed, hud, update } = setup();
  for (let id = 1; id <= 3; id++) feed.gain('item', id, 1, item());
  update(0); update(0.4); update(0.4); const age = feed.rows[2].age;
  update(1, { viewport: { width: 1280, height: 400 } });
  assert.equal(feed.capacity, 2); assert.equal(feed.rows[2].age, age);
  update(0, { vr: true }); assert.equal(feed.mesh.parent, hud);
  const feedTop = feed.mesh.position.y + feed.panel.heightM * feed.mesh.scale.y / 2;
  assert.ok(feedTop <= -hud.geometry.parameters.height / 2 - 0.019);
  update(0); assert.equal(feed.mesh.parent, feed.camera);
});

test('pickup names and icons use game helpers, long names fit and late game art refreshes the feed', t => {
  const skin = { width: 128, height: 128 }, icons = { width: 384, height: 1300 }; let revision = 0, loaded = false;
  setWindowSkin(skin); t.after(() => setWindowSkin(null));
  const { feed, update } = setup({ drawWindow: drawGameWindow, assetRevision: () => revision,
    drawIcon(ctx, id, x, y, size) {
      if (loaded) ctx.drawImage(icons, id % 16 * 24, Math.floor(id / 16) * 24, 24, 24, x, y, size, size);
    } });
  feed.gain('item', 1, 2, item('Original very long translated pickup name 😀'.repeat(3))); update(0); update(0.2);
  let record = feed.panel.canvas.record;
  assert.ok(record.images.some(({ args: [source] }) => source === skin));
  const label = record.texts.find(entry => entry.align === 'left');
  assert.ok(label.text.endsWith('…')); assert.ok(Array.from(label.text).length * 18 <= 720 - 104 - 224);
  assert.ok(record.texts.some(entry => entry.text === '×2' && entry.align === 'right'));
  const commits = feed.panel.commits; loaded = true; revision++; update(0);
  assert.equal(feed.panel.commits, commits + 1);
  record = feed.panel.canvas.record;
  assert.ok(record.images.some(({ args: [source, x, y, w, h] }) => source === icons && x === 24 && y === 792 && w === 24 && h === 24),
    'the item database icon is drawn from its exact original game cell');
});

test('visible rewards fade before expiry and queued rewards remain eligible afterwards', () => {
  const { feed, update } = setup(); feed.gain('item', 1, 1, item()); update(0); update(0.2);
  assert.ok(feed.panel.canvas.record.texts.every(entry => entry.alpha === 1));
  update(4.6); assert.ok(feed.panel.canvas.record.texts.every(entry => entry.alpha > 0 && entry.alpha < 1));
  update(0.8); assert.equal(feed.rows.length, 0); assert.equal(feed.mesh.visible, false);
  feed.gold(3, item('Souls', 0)); update(0); update(0.2);
  assert.equal(feed.rows[0].kind, 'gold'); assert.ok(feed.panel.canvas.record.texts.some(entry => entry.text === '+3'));
});
