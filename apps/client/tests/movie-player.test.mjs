import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { MoviePlayer } from '../src/ui/movie-player.js';
import { Interpreter } from '../src/game/interpreter.js';
import { initAssets } from '../src/data/assets.js';

class Element {
  constructor(tagName) { this.tagName = tagName.toUpperCase(); this.style = {}; this.children = []; this.parentElement = null; this.attributes = {}; this.texts = []; }
  appendChild(child) { child.parentElement = this; this.children.push(child); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(x => x !== this); this.parentElement = null; }
  setAttribute(k, v) { this.attributes[k] = v; }
  removeAttribute(k) { delete this.attributes[k]; if (k === 'src') this.src = ''; }
  focus() {}
  getContext() { return { clearRect: () => { this.texts = []; }, fillText: text => this.texts.push(text) }; }
}
class Media extends Element {
  constructor() { super('video'); this.listeners = new Map(); this.videoWidth = 640; this.videoHeight = 480; this.paused = true; this.playCalls = 0; this.pauseCalls = 0; }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type) { for (const fn of [...(this.listeners.get(type) || [])]) fn(); }
  play() { this.playCalls++; if (this.denied) return Promise.reject(Object.assign(new Error('activation'), { name: 'NotAllowedError' })); this.paused = false; return Promise.resolve(); }
  pause() { this.pauseCalls++; this.paused = true; }
  load() {}
}
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const command = (code, ...parameters) => ({ code, indent: 0, parameters });
function fixture(t, options = {}) {
  const previous = { ...G }; t.after(() => Object.assign(G, previous));
  const doc = { body: new Element('body'), createElement: tag => new Element(tag) };
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100); camera.position.set(2, 1.7, 3); camera.updateMatrixWorld();
  const video = new Media(), values = {}, toasts = []; let consumes = 0, cancel = false, confirm = false, away = false;
  Object.assign(G, { vr: false, state: { v: id => values[id] || 0, setV: (id, n) => { values[id] = n; } },
    map: { mapId: 1, events: {}, transferring: false }, scripts: {}, coop: null,
    ui: { sceneOpen: null, toast: text => toasts.push(text), messageBusy: () => false },
    input: { cancel: () => cancel, confirm: () => confirm, endFrame: () => { consumes++; cancel = confirm = false; } } });
  const player = G.movies = new MoviePlayer(scene, camera, { document: doc, createVideo: () => video,
    resolveMovie: () => 'Movies/Neutral movie.ogv', isAway: () => away, ...options });
  t.after(() => player.clear());
  return { player, video, doc, scene, camera, values, toasts, get consumes() { return consumes; },
    cancel: () => { cancel = true; }, confirm: () => { confirm = true; }, away: v => { away = v; } };
}

test('actual event movie waits for playback completion before running the next command and releases owned resources', async t => {
  const e = fixture(t), it = new Interpreter();
  it.setup([command(261, 'Neutral movie'), command(122, 1, 1, 1, 0, 1), command(0)]); it.update();
  assert.equal(it.waitMode, 'movie'); assert.equal(e.values[1] || 0, 0); assert.equal(G.ui.sceneOpen, 'movie');
  assert.equal(e.video.src, '/game/Movies/Neutral%20movie.ogv'); await settle();
  const h = e.player.active, resources = [h.texture, h.captionTexture], disposed = new Map();
  h.group.traverse(o => { if (o.geometry) resources.push(o.geometry); if (o.material) resources.push(o.material); });
  for (const r of resources) { disposed.set(r, 0); r.addEventListener('dispose', () => disposed.set(r, disposed.get(r) + 1)); }
  it.update(); assert.equal(e.values[1] || 0, 0); e.video.emit('ended'); it.update();
  assert.equal(e.values[1], 1); assert.equal(it.running(), false); assert.equal(e.player.busy(), false);
  assert.equal(e.doc.body.children.length, 0); assert.equal(e.scene.children.length, 0); assert.equal(G.ui.sceneOpen, null);
  assert.equal(e.video.src, ''); assert.ok(e.video.paused); assert.ok(e.consumes >= 2);
  assert.ok([...disposed.values()].every(n => n === 1)); assert.equal([...e.video.listeners.values()].reduce((n, set) => n + set.size, 0), 0);
});

test('autoplay denial shows a reachable Play action and Escape skips without leaking its input edge', async t => {
  const e = fixture(t); e.video.denied = true; const h = e.player.play('Neutral'); await settle();
  assert.equal(h.stage, 'blocked'); assert.equal(h.playButton.style.display, ''); assert.equal(e.player.busy(), true);
  e.video.denied = false; h.playButton.onclick(); await settle(); assert.equal(h.stage, 'playing');
  e.cancel(); const before = e.consumes; e.player.update();
  assert.equal(h.pending, false); assert.equal(h.stage, 'skipped'); assert.ok(e.consumes > before); assert.equal(G.input.cancel(), false);
});

test('concurrent original event interpreters wait without replacing a live movie or advancing behind it', async t => {
  const e = fixture(t), first = new Interpreter(), second = new Interpreter(), parallel = new Interpreter(1, false, 'parallel');
  first.setup([command(261, 'First'), command(122, 1, 1, 1, 0, 1), command(0)]);
  second.setup([command(261, 'Second'), command(122, 2, 2, 1, 0, 1), command(0)]);
  parallel.setup([command(122, 3, 3, 1, 0, 1), command(0)]);
  first.update(); const h = e.player.active; second.update(); parallel.update();
  assert.equal(e.player.active, h); assert.equal(h.pending, true); assert.equal(second.index, 0);
  assert.equal(e.values[1] || 0, 0); assert.equal(e.values[3] || 0, 0);
  e.video.emit('ended'); first.update(); assert.equal(e.values[1], 1);
  second.update(); const next = e.player.active; assert.notEqual(next, h); assert.equal(next.pending, true);
  parallel.update(); assert.equal(e.values[3] || 0, 0);
  e.player.skip(); second.update(); parallel.update();
  assert.equal(e.values[2], 1); assert.equal(e.values[3], 1); assert.equal(e.player.busy(), false);
});

test('VR movie uses original aspect and fixed world screen; headset-away pauses rather than cancelling it', async t => {
  const e = fixture(t); G.vr = true; const h = e.player.play('Neutral'); await settle();
  assert.equal(h.overlay.style.display, 'none'); assert.equal(h.group.visible, true);
  assert.ok(Math.abs(h.screen.scale.x / h.screen.scale.y - 4 / 3) < 1e-8);
  const position = h.group.position.clone(); e.camera.position.x += 1; e.camera.updateMatrixWorld(); e.player.update();
  assert.ok(h.group.position.equals(position), 'looking or moving must not attach the cinematic to the eyes');
  const played = e.video.playCalls; e.away(true); e.player.update();
  assert.ok(e.video.paused); assert.equal(h.pending, true); assert.equal(e.player.active, h);
  e.away(false); e.player.update(); await settle(); assert.equal(e.video.playCalls, played + 1); assert.equal(h.pending, true);
  G.vr = false; e.player.update(); assert.equal(h.group.visible, false); assert.equal(h.overlay.style.display, 'flex');
});

test('decoder canvas can request an explicit VR play gesture and uploads only changed frame times', async t => {
  let video, canvas, plays = 0, cleanups = 0;
  const e = fixture(t, { createVideo: () => {
    video = new Media(); canvas = new Element('canvas'); canvas.width = 512; canvas.height = 384;
    return { media: video, source: canvas, needsGesture: true, play: () => { plays++; return video.play(); }, dispose: () => { cleanups++; } };
  } });
  G.vr = true; const h = e.player.play('Neutral'); assert.equal(h.stage, 'blocked'); assert.equal(plays, 0); assert.ok(h.texture.isCanvasTexture);
  e.confirm(); e.player.update(); await settle(); assert.equal(plays, 1); assert.equal(G.input.confirm(), false);
  video.currentTime = 1; e.player.update(); const version = h.texture.version;
  e.player.update(); assert.equal(h.texture.version, version); video.currentTime = 2; e.player.update(); assert.ok(h.texture.version > version);
  e.player.clear(); e.player.clear(); assert.equal(cleanups, 1);
});

test('termination and interpreter replacement cancel the old movie without altering a newer owner', async t => {
  const e = fixture(t), it = new Interpreter(); it.setup([command(261, 'Neutral'), command(0)]); it.update(); await settle();
  const old = e.player.active; it.setup([command(261, 'Next'), command(0)]); it.update(); await settle();
  const fresh = e.player.active; assert.notEqual(fresh, old); assert.equal(old.pending, false); e.player.clear(old); assert.equal(e.player.active, fresh);
  const before = e.consumes; old.skipButton.onclick(); assert.equal(e.consumes, before); assert.equal(e.player.active, fresh);
  it.terminate(); assert.equal(e.player.busy(), false); assert.equal(G.ui.sceneOpen, null);
});

test('late decoder creation is disposed after cancellation, and a changed map cannot keep an orphan movie alive', async t => {
  let resolve, cleaned = 0;
  const e = fixture(t, { createVideo: () => new Promise(r => { resolve = r; }) });
  const h = e.player.play('Neutral'); e.player.clear();
  resolve({ media: e.video, source: new Element('canvas'), dispose: () => { cleaned++; } }); await settle();
  assert.equal(h.pending, false); assert.equal(cleaned, 1); assert.equal(e.doc.body.children.length, 0);
  const live = fixture(t); live.player.play('Neutral'); await settle(); G.map.mapId = 2; live.player.update();
  assert.equal(live.player.busy(), false); assert.equal(live.video.src, '');
});

test('Escape cancels pending codec loading and consumes action edges before any late decoder can mount', async t => {
  let resolve, consumed = 0, cleaned = 0;
  const e = fixture(t, { createVideo: () => new Promise(r => { resolve = r; }) });
  G.input.consumeActionEdges = () => { consumed++; G.input.endFrame(); };
  const h = e.player.play('Neutral'); e.cancel(); e.player.update();
  assert.equal(h.pending, false); assert.equal(h.stage, 'skipped'); assert.equal(G.ui.sceneOpen, null);
  assert.equal(consumed, 3, 'opening, skipping and finishing retire keyboard, mouse and controller actions');
  resolve({ media: e.video, dispose: () => { cleaned++; } }); await settle();
  assert.equal(cleaned, 1); assert.equal(e.doc.body.children.length, 0);
});

test('decoder shutdown failure still releases the event wait, scene and presentation owner', async t => {
  const e = fixture(t, { createVideo: () => ({ media: new Media(), dispose: () => { throw new Error('decoder already closed'); } }) });
  const it = new Interpreter(); it.setup([command(261, 'Neutral'), command(122, 1, 1, 1, 0, 1), command(0)]); it.update(); await settle();
  e.player.skip(); it.update();
  assert.equal(e.values[1], 1); assert.equal(e.scene.children.length, 0); assert.equal(e.doc.body.children.length, 0);
  assert.equal(G.ui.sceneOpen, null); assert.equal(e.player.busy(), false);
});

test('missing or failed original movie reports a failure and never leaves an interpreter waiting forever', async t => {
  const e = fixture(t, { resolveMovie: () => null });
  let it = new Interpreter(); it.setup([command(261, 'Missing'), command(122, 1, 1, 1, 0, 1), command(0)]); it.update();
  assert.equal(e.values[1], 1); assert.equal(it.running(), false); assert.equal(e.toasts.length, 1);
  e.player.resolveMovie = () => 'Movies/Neutral.ogv'; it = new Interpreter(); it.setup([command(261, 'Neutral'), command(0)]); it.update();
  e.video.emit('error'); it.update(); assert.equal(it.running(), false); assert.equal(e.toasts.length, 2);
  assert.equal(e.player.busy(), false); assert.equal(G.ui.sceneOpen, null);
});

test('real original asset resolver preserves Unicode and trailing spaces and accepts .ogg video paths', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: ['Movies/Neutral Ω .ogv', 'Movies/Trailer.ogg'] })); await initAssets();
  const e = fixture(t); delete e.player.resolveMovie;
  const real = new MoviePlayer(e.scene, e.camera, { document: e.doc, createVideo: () => e.video }); t.after(() => real.clear());
  real.play('Neutral Ω '); assert.equal(e.video.src, '/game/Movies/Neutral%20%CE%A9%20.ogv'); real.clear();
  real.play('Trailer'); assert.equal(e.video.src, '/game/Movies/Trailer.ogg');
});
