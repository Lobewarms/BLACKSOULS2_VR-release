import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
globalThis.location = { search: '?lang=en' };
const { NavigationMap, mapProjection, mapPosition } = await import('../src/ui/navigation-map.js');
const { MapGrid } = await import('../src/world/mapmesh.js');
const { TileDrawer } = await import('../src/world/tiles.js');

function canvas() {
  const record = { images: [], texts: [], fills: [], arcs: [], clips: [], strokes: [], translations: [], clears: 0 };
  const stack = []; let path = [];
  const ctx = new Proxy({
    globalAlpha: 1, clipPath: null,
    clearRect() { for (const value of Object.values(record)) if (Array.isArray(value)) value.length = 0; record.clears++; },
    save() { stack.push({ globalAlpha: ctx.globalAlpha, clipPath: ctx.clipPath, strokeStyle: ctx.strokeStyle,
      fillStyle: ctx.fillStyle, shadowColor: ctx.shadowColor, shadowBlur: ctx.shadowBlur }); },
    restore() { Object.assign(ctx, stack.pop()); },
    beginPath() { path = []; },
    arc(...args) { path.push({ kind: 'circle', args }); record.arcs.push({ args, clip: ctx.clipPath, alpha: ctx.globalAlpha }); },
    rect(...args) { path.push({ kind: 'rect', args }); },
    clip() { ctx.clipPath = [...path]; record.clips.push(ctx.clipPath); },
    fillRect(...args) { record.fills.push({ args, clip: ctx.clipPath, alpha: ctx.globalAlpha }); },
    fill() { record.fills.push({ path: [...path], clip: ctx.clipPath, alpha: ctx.globalAlpha }); },
    stroke() { record.strokes.push({ path: [...path], clip: ctx.clipPath, alpha: ctx.globalAlpha, color: ctx.strokeStyle }); },
    drawImage(...args) { record.images.push({ args, clip: ctx.clipPath, alpha: ctx.globalAlpha }); },
    fillText(text, x, y) { record.texts.push({ text, x, y, clip: ctx.clipPath, alpha: ctx.globalAlpha, shadow: ctx.shadowColor }); },
    translate(x, y) { record.translations.push({ x, y }); },
    measureText: text => ({ width: Array.from(String(text)).length * 12 }),
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  return { width: 0, height: 0, record, getContext: () => ctx };
}
class Panel {
  constructor(w, h, widthM) {
    this.canvas = canvas(); this.canvas.width = w; this.canvas.height = h; this.ctx = this.canvas.getContext('2d');
    this.widthM = widthM; this.heightM = widthM * h / w;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.widthM, this.heightM), new THREE.MeshBasicMaterial());
  }
  clear() { this.ctx.clearRect(); }
  commit() {}
}
function environment(t, { loop = false, small = false, art = false } = {}) {
  const before = { ...G }, descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => { Object.assign(G, before);
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete globalThis.document; });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: canvas } });
  G.vr = false; G.settings = { ...G.settings, minimap: true }; G.player = { forward2D: () => ({ x: 1, z: 0 }) };
  const w = small ? 5 : 40, h = small ? 3 : 30, data = new Int16Array(w * h * 4); data.fill(1, 0, w * h);
  const flags = new Int16Array(8192), raw = { width: w, height: h, data: { data } }, grid = new MapGrid(raw, { flags: { data: flags } });
  const map = G.map = { mapId: 995, map: raw, grid, loopX: loop, loopY: loop,
    playerChar: { x: 2, y: 3, fx: small ? 0 : 2, fy: small ? 0 : 3, direction: 6 }, walkable: (x, y) => grid.anyPassable(x, y) };
  const source = canvas(); source.width = source.height = 512;
  const images = Array(9).fill(null); if (art) images[5] = source;
  G.view = { mapId: 995, analysis: { exits: [{ x: 3, y: 3, mapId: 996, label: 'Garden' }], doors: new Set(), pits: new Set() },
    mesh: { drawer: new TileDrawer(images, flags) } };
  const nav = new NavigationMap(Panel, new THREE.Group(), new THREE.PerspectiveCamera(), new THREE.Group(), 'GameFont',
    { textColor: index => index === 0 ? '#ececec' : '#778899' });
  return { nav, map, source };
}
const circleClip = entry => entry.clip?.length === 1 && entry.clip[0].kind === 'circle';
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} should equal ${expected}`);

test('PC minimap is a true circle with transparent outside pixels and translucent original tile art', t => {
  const { nav, source } = environment(t, { art: true }); nav.update(0.1, true);
  const { record } = nav.mini.canvas, clip = record.clips[0];
  assert.deepEqual(clip, [{ kind: 'circle', args: [192, 192, 180, 0, Math.PI * 2] }]);
  near(nav.mini.widthM / nav.mini.canvas.width, nav.mini.heightM / nav.mini.canvas.height);
  assert.ok(nav.art.record.images.some(({ args: [image] }) => image === source), 'the map cache uses the actual tile drawer source');
  assert.equal(record.images.length, 1, 'a second opaque raster cannot defeat terrain translucency');
  assert.equal(record.images[0].args[0], nav.art); assert.equal(record.images[0].alpha, 0.6); assert.ok(circleClip(record.images[0]));
  assert.ok(record.fills.every(circleClip), 'no full-window fill or opaque caption plate may cover pixels outside the circle');
  assert.ok(record.strokes.some(entry => entry.color === '#ececec' && entry.alpha === 0.42 && !entry.clip),
    'the subtle ring follows the supplied original game palette');
  assert.ok(record.texts.some(entry => entry.text === 'N' && entry.alpha === 1 && entry.shadow === '#000000'));
  assert.ok(record.texts.some(entry => entry.text.includes('N: Map')));
  assert.ok(record.texts.every(entry => !entry.text.includes('You') && !entry.text.includes('Exit')),
    'the compact map omits the full-map legend');
});

test('the circular view centres the actual player at map boundaries and clips out-of-circle exits', t => {
  const { nav, map } = environment(t); map.playerChar.fx = map.playerChar.fy = 0;
  G.view.analysis.exits = [{ x: 10, y: 10, mapId: 996, label: 'Corner outside circle' }];
  nav.update(0.1, true); let record = nav.mini.canvas.record;
  near(record.translations.at(-1).x, 192); near(record.translations.at(-1).y, 192);
  const marker = record.arcs.find(entry => entry.args[2] === 8);
  assert.ok(Math.hypot(marker.args[0] - 192, marker.args[1] - 192) > 180);
  assert.ok(circleClip(marker), 'an exit in the square corner must remain under the circular clipping mask');
  assert.ok(record.texts.filter(entry => entry.text === '1').every(circleClip), 'exit labels cannot escape the clip either');
  const x = record.images[0].args[1]; map.playerChar.fx = 1; nav.update(0.1, true); record = nav.mini.canvas.record;
  near(record.translations.at(-1).x, 192); assert.ok(record.images[0].args[1] < x);
  const rect = { x: 12, y: 12, w: 360, h: 360 }, view = mapProjection(map, rect, false, true), player = mapPosition(map);
  near(view.point(player.x, player.y).x, 192); near(view.point(player.x, player.y).y, 192);
});

test('looping and small maps retain correct circular positions and wrapping without mutating map data', t => {
  const { nav, map } = environment(t, { loop: true }), before = Array.from(map.grid.data);
  map.playerChar.fx = -0.25; map.playerChar.fy = -0.25;
  G.view.analysis.exits = [{ x: 39, y: 29, mapId: 996, label: 'Across seam' }];
  nav.update(0.1, true);
  const record = nav.mini.canvas.record, marker = record.arcs.find(entry => entry.args[2] === 8);
  assert.equal(record.images.length, 9); assert.ok(record.images.every(entry => entry.alpha === 0.6 && circleClip(entry)));
  assert.ok(Math.abs(marker.args[0] - 192) < 14 && Math.abs(marker.args[1] - 192) < 14);
  assert.deepEqual(Array.from(map.grid.data), before);
  const small = { ...map, grid: { ...map.grid, w: 5, h: 3 }, loopX: false, loopY: false,
    playerChar: { ...map.playerChar, fx: 0, fy: 0 } };
  const v = mapProjection(small, { x: 12, y: 12, w: 360, h: 360 }, false, true);
  near(v.point(0, 0).x, 192); near(v.point(0, 0).y, 192);
  near(v.width / 5, v.height / 3);
});

test('VR wrist minimap and full area map retain their existing rectangular window and legend', t => {
  const { nav, map } = environment(t);
  G.vr = true; nav.attach(true); nav.update(0.1, true);
  let record = nav.mini.canvas.record;
  assert.ok(record.clips.some(clip => clip[0]?.kind === 'rect'));
  assert.ok(record.images.every(entry => entry.alpha === 1));
  assert.ok(record.texts.some(entry => entry.text.includes('You') && entry.text.includes('Exit')));
  G.vr = false; nav.prepare(map); nav.draw(nav.full, map, true); record = nav.full.canvas.record;
  assert.ok(record.clips.some(clip => clip[0]?.kind === 'rect'));
  assert.ok(record.texts.some(entry => entry.text === 'Map key'));
  assert.ok(record.texts.some(entry => entry.text.includes('Garden')));
});
