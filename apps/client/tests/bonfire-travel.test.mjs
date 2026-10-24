import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { BonfireTravel } from '../src/ui/bonfire-travel.js';
import { placeDesktopRoot } from '../src/ui/desktop-layout.js';

function context() {
  const ctx = { images: [], texts: [], fills: [],
    clearRect() { this.images = []; this.texts = []; this.fills = []; },
    drawImage(...args) { this.images.push(args); },
    fillText(text, x, y) { this.texts.push({ text, x, y, font: this.font }); },
    fillRect(...args) { this.fills.push({ args, color: this.fillStyle }); },
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
  };
  return ctx;
}
class Panel {
  constructor(width, height, widthM) {
    this.canvas = { width, height }; this.ctx = context(); this.commits = 0;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
    this.mesh.visible = false; this.resize(width, height, widthM);
  }
  resize(width, height, widthM = this.widthM) {
    this.canvas.width = width; this.canvas.height = height; this.widthM = widthM; this.heightM = widthM * height / width;
    this.mesh.geometry.dispose(); this.mesh.geometry = new THREE.PlaneGeometry(this.widthM, this.heightM);
  }
  clear() { this.ctx.clearRect(); }
  commit() { this.commits++; }
}
const image = (name, width = 476, height = 360) => ({ name, width, height });
const destinations = () => [{ index: 9, name: 'First rest', desc: ['First description', 'Second description'] },
  { index: 22, name: 'Locked rest', desc: ['Locked first line', 'Locked second line'] }];
function environment(t, { load, config, width = 1280, height = 720 } = {}) {
  const saved = { ...G }; t.after(() => Object.assign(G, saved));
  const viewport = { width, height }, leader = { characterName: 'People', characterIndex: 5, hp: 100 };
  const switches = new Set(), actor = { characterName: '$Guide', characterIndex: 4 };
  Object.assign(G, { vr: false, combat: null, state: { sw: id => switches.has(id), actor: () => actor,
    party: { leader: () => leader } }, map: { mapId: 4, transferring: false },
    input: { dom: { getBoundingClientRect: () => viewport } }, three: null });
  const root = new THREE.Group(), ui = { sceneOpen: 'bonfire' }, list = { panel: new Panel(980, 678, 0.98),
    rows: 8, rowTop: 100, rowH: 64, index: 0, top: 0, items: [{ text: 'First' }, { text: 'Locked', enabled: false }],
    get visible() { return this.panel.mesh.visible; },
    draw() { this.draws = (this.draws || 0) + 1; if (this.index < this.top) this.top = this.index;
      if (this.index >= this.top + this.rows) this.top = this.index - this.rows + 1;
      this.top = Math.max(0, Math.min(this.top, Math.max(0, this.items.length - this.rows))); },
  };
  list.panel.mesh.visible = true; list.panel.mesh.position.set(-0.484, 0, 0); root.add(list.panel.mesh);
  const requests = [], controller = new BonfireTravel({ Panel, root, list, ui, font: 'SyntheticFont',
    windowBg: () => {}, fitLabel: (_ctx, text) => text,
    load: (folder, name) => { requests.push({ folder, name }); return load?.(folder, name) ?? Promise.resolve(null); } });
  controller.open(destinations(), config ?? { picture: 'Map', players: {}, icons: [] });
  return { controller, root, ui, list, requests, viewport, leader, actor, switches };
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`); }

test('shared artwork is contained and the selected marker uses its original MOVE index, including locked destinations and both description lines', async t => {
  const map = image('Map'), config = { picture: 'Map', players: {
    9: { type: 1, x: 238, y: 180, size: 10, color: [1, 2, 3] },
    22: { type: 1, x: 30, y: 40, size: 7, color: [4, 5, 6] },
  }, icons: [] };
  const e = environment(t, { config, load: () => Promise.resolve(map) }); await settle();
  const { ctx } = e.controller.panel, rect = e.controller.imageRect;
  near(rect.width / rect.height, 476 / 360); near(rect.height, 504);
  assert.equal(ctx.images[0][0], map);
  assert.deepEqual(ctx.texts.map(row => row.text), ['First rest', 'First description', 'Second description']);
  const marker = ctx.fills.find(row => row.color === 'rgb(1,2,3)'); assert.ok(marker);
  near(marker.args[0], rect.x + 233 * 1.4); near(marker.args[1], rect.y + 175 * 1.4);
  e.list.index = 1; e.controller.update();
  assert.deepEqual(ctx.texts.map(row => row.text), ['Locked rest', 'Locked first line', 'Locked second line']);
  assert.deepEqual(ctx.fills.map(row => row.color), ['rgb(4,5,6)']);
  assert.equal(e.list.items[1].enabled, false, 'previewing a locked row does not enable travel');
  assert.equal(e.requests.length, 1, 'selection does not reload shared artwork');
});

test('original character markers use down-row middle frames and bottom-centre anchors; optional Pictures remain top-left anchored', async t => {
  const map = image('Map'), people = image('People', 384, 256), guide = image('$Guide', 96, 128), flag = image('Flag', 18, 10);
  const assets = { Map: map, People: people, $Guide: guide, Flag: flag };
  const config = { picture: 'Map', players: { 9: { type: 0, x: 200, y: 180 } }, icons: [
    { type: 0, x: 100, y: 80, actorId: 2 }, { type: 2, x: 40, y: 50, picture: 'Flag' },
    { type: 1, x: 0, y: 0, showSwitch: 10, color: [9, 9, 9] },
    { type: 1, x: 1, y: 1, hideSwitch: 11, color: [8, 8, 8] },
  ] };
  const e = environment(t, { config, load: (_folder, name) => Promise.resolve(assets[name]) });
  e.switches.add(11); await settle();
  const rect = e.controller.imageRect, rows = e.controller.panel.ctx.images;
  const body = rows.find(row => row[0] === people), npc = rows.find(row => row[0] === guide), picture = rows.find(row => row[0] === flag);
  assert.deepEqual(body.slice(1, 5), [128, 128, 32, 32]);
  near(body[5], rect.x + (200 - 16) * 1.4); near(body[6], rect.y + (180 - 32) * 1.4);
  assert.deepEqual(npc.slice(1, 5), [32, 0, 32, 32]);
  assert.equal(rows.indexOf(body), rows.length - 1, 'the selected player is drawn after static overlays');
  near(picture[1], rect.x + 40 * 1.4); near(picture[2], rect.y + 50 * 1.4);
  assert.equal(e.controller.panel.ctx.fills.length, 0, 'show/hide switch rules apply to overlays');
  e.switches.add(10); e.switches.delete(11); e.controller.update();
  assert.equal(e.controller.panel.ctx.fills.length, 2);
  assert.ok(e.requests.some(row => row.folder === 'Graphics/Characters' && row.name === 'People'));
});

test('late shared-map arrival paints the current selected destination, never the initially captured row', async t => {
  const pending = deferred(), e = environment(t, { load: () => pending.promise }); await settle();
  assert.ok(e.controller.panel.ctx.texts.some(row => row.text.includes('불러오는') || row.text.includes('Loading')));
  e.list.index = 1; e.controller.update(); pending.resolve(image('Map')); await settle();
  assert.equal(e.controller.panel.ctx.texts[0].text, 'Locked rest');
  assert.ok(e.controller.imageRect);
});

test('close invalidates pending assets immediately, and close/reopen cannot let an earlier asset overwrite the new session', async t => {
  const first = deferred(), next = deferred(); let calls = 0;
  const e = environment(t, { load: () => (++calls === 1 ? first.promise : next.promise) }); await settle();
  const originalItems = e.list.items;
  e.controller.close(); assert.equal(e.controller.panel.mesh.visible, false);
  assert.deepEqual(e.list.panel.mesh.position.toArray(), [-0.484, 0, 0]);
  assert.deepEqual([e.list.panel.canvas.width, e.list.panel.canvas.height, e.list.panel.widthM], [980, 678, 0.98]);
  e.list.items = [{ text: 'Reopened' }];
  e.controller.open([{ index: 7, name: 'Reopened rest', desc: ['New first', 'New second'] }], { picture: 'Other', players: {}, icons: [] });
  await settle(); first.resolve(image('Stale')); await settle();
  assert.equal(e.controller.imageRect, null); assert.equal(e.controller.panel.mesh.visible, true);
  next.resolve(image('Current')); await settle();
  assert.equal(e.controller.panel.ctx.images[0][0].name, 'Current');
  assert.equal(e.controller.panel.ctx.texts[0].text, 'Reopened rest');
  assert.notEqual(e.list.items, originalItems);
});

for (const reason of ['transfer', 'map', 'mapId', 'state', 'dead', 'scene', 'list-hidden', 'list-replaced']) {
  test(`a ${reason} ownership change hides the preview and rejects its late load`, async t => {
    const pending = deferred(), e = environment(t, { load: () => pending.promise }); await settle();
    if (reason === 'transfer') G.map.transferring = true;
    if (reason === 'map') G.map = { ...G.map };
    if (reason === 'mapId') G.map.mapId++;
    if (reason === 'state') G.state = { ...G.state };
    if (reason === 'dead') G.combat = { playerDead: true };
    if (reason === 'scene') e.ui.sceneOpen = 'shop';
    if (reason === 'list-hidden') e.list.panel.mesh.visible = false;
    if (reason === 'list-replaced') { e.list.items = [{ text: 'Shop item' }]; e.list.panel.resize(777, 333, 0.77); }
    assert.equal(e.controller.update(), false); assert.equal(e.controller.panel.mesh.visible, false);
    const commits = e.controller.panel.commits;
    pending.resolve(image('Too late')); await settle();
    assert.equal(e.controller.panel.commits, commits); assert.equal(e.controller.session, null);
    if (reason === 'list-replaced') assert.equal(e.list.panel.canvas.width, 777, 'cleanup cannot resize a different scene\'s list');
  });
}

for (const failure of ['null', 'reject', 'invalid']) {
  test(`a ${failure} artwork result leaves the list and both description lines usable`, async t => {
    const e = environment(t, { load: () => failure === 'reject' ? Promise.reject(new Error('Synthetic missing asset'))
      : Promise.resolve(failure === 'invalid' ? image('Bad', 0, 0) : null) });
    await settle();
    assert.equal(e.controller.panel.mesh.visible, true); assert.equal(e.list.visible, true); assert.equal(e.controller.imageRect, null);
    const texts = e.controller.panel.ctx.texts.map(row => row.text);
    assert.ok(texts.some(text => /미리보기|unavailable/i.test(text)));
    assert.deepEqual(texts.slice(-2), ['First description', 'Second description']);
    e.list.index = 1; assert.equal(e.controller.update(), true);
    assert.equal(e.controller.panel.ctx.texts.at(-1).text, 'Locked second line');
    assert.equal(e.requests.length, 1, 'a failure does not cause one new request every frame');
  });
}

function bounds(panel, camera, viewport) {
  panel.mesh.updateWorldMatrix(true, false); camera.updateWorldMatrix(true, false);
  return [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([x, y]) => {
    const point = panel.mesh.localToWorld(new THREE.Vector3(x * panel.widthM / 2, y * panel.heightM / 2, 0)).project(camera);
    return { x: (point.x + 1) * viewport.width / 2, y: (1 - point.y) * viewport.height / 2 };
  });
}
test('wide/narrow layout and desktop/VR transitions preserve selection, scroll validity and visible panel bounds', async t => {
  const e = environment(t, { load: () => Promise.resolve(image('Map')) }); await settle();
  const many = Array.from({ length: 15 }, (_, index) => ({ index: index + 5, name: `Rest ${index}`, desc: ['Line one', 'Line two'] }));
  e.controller.close(); e.list.items = many.map(row => ({ text: row.name })); e.list.index = 12; e.list.top = 8;
  e.controller.open(many, { picture: 'Map', players: {}, icons: [] }); await settle();
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100); scene.add(camera, e.root);
  for (const [width, height] of [[1280, 720], [1920, 1080], [480, 800], [600, 500]]) {
    Object.assign(e.viewport, { width, height }); camera.aspect = width / height; camera.updateProjectionMatrix(); e.controller.update();
    placeDesktopRoot(e.root, camera, e.viewport);
    for (const panel of [e.list.panel, e.controller.panel]) for (const point of bounds(panel, camera, e.viewport)) {
      assert.ok(point.x >= 31 && point.x <= width - 31 && point.y >= 39 && point.y <= height - 39, JSON.stringify(point));
    }
    assert.equal(e.list.index, 12); assert.ok(e.list.top <= 12 && e.list.top + e.list.rows > 12);
    const commandBounds = bounds(e.list.panel, camera, e.viewport);
    const pixelHeight = Math.max(...commandBounds.map(point => point.y)) - Math.min(...commandBounds.map(point => point.y));
    assert.ok(pixelHeight / e.list.panel.canvas.height * 36 >= 18, 'responsive list text stays readable');
  }
  G.vr = true; e.controller.update(); e.root.scale.setScalar(1);
  assert.equal(e.list.rows, 8); assert.equal(e.list.panel.widthM, 0.6); assert.equal(e.controller.panel.widthM, 0.78);
  assert.equal(e.list.index, 12); assert.ok(e.list.panel.mesh.position.x < e.controller.panel.mesh.position.x);
  G.vr = false; e.controller.update(); assert.equal(e.list.rows, 2); assert.equal(e.list.index, 12);
  assert.ok(e.controller.panel.mesh.position.y > e.list.panel.mesh.position.y);
});
