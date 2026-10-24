import * as THREE from 'three';
import { G } from '../core/globals.js';
import { resolve, gameUrl } from '../data/assets.js';
import { tr } from './i18n.js';
import { createMovieMedia } from './movie-codec.js';

const MOVIE_EXTENSIONS = ['.webm', '.ogv', '.ogg', '.mp4'];

// One original event movie, shared by PC and VR. A decoder may supply a canvas
// source behind the same media API; no game asset is copied into the app.
export class MoviePlayer {
  constructor(scene, camera, { document: doc = globalThis.document, createVideo, resolveMovie, onConsume, isAway } = {}) {
    this.scene = scene; this.camera = camera; this.document = doc;
    this.createVideo = createVideo || (options => createMovieMedia(options, { document: doc }));
    this.resolveMovie = resolveMovie || (name => resolve('Movies', name, MOVIE_EXTENSIONS));
    this.onConsume = onConsume || (() => G.input?.consumeActionEdges ? G.input.consumeActionEdges() : G.input?.endFrame?.());
    this.isAway = isAway || (() => G.vr && (G.xrAway || G.viewMode?.awaitingPose));
    this.active = null;
  }
  busy(handle = this.active) { return !!handle?.pending; }
  valid(h) {
    return this.active === h && G.state === h.state && G.map === h.map && G.map?.mapId === h.mapId &&
      (!h.owner || h.owner.list === h.list && h.owner.executionId === h.executionId && h.owner.running());
  }
  play(name, owner) {
    this.clear();
    const h = { pending: false, stage: 'ended' };
    if (!name) return h;
    let path;
    try { path = this.resolveMovie(name); } catch { path = null; }
    if (!path || !/^(?:rtp:)?Movies\//i.test(path)) { G.ui?.toast?.(tr('동영상을 재생할 수 없습니다')); return h; }
    Object.assign(h, { pending: true, stage: 'loading', owner, list: owner?.list, executionId: owner?.executionId,
      state: G.state, map: G.map, mapId: G.map?.mapId, ui: G.ui, previousScene: G.ui?.sceneOpen,
      listeners: [], mode: null, sourceTime: -1, path });
    this.active = h;
    if (h.ui) { h.ui._movieOwner = h; h.ui.sceneOpen = 'movie'; h.ui.unlockPointer?.(); }
    this.onConsume();
    try {
      const result = this.createVideo({ path, url: gameUrl(path) });
      if (result?.then) result.then(value => this.attach(h, value)).catch(() => this.fail(h));
      else this.attach(h, result);
    } catch { this.fail(h); }
    return h;
  }
  attach(h, playable) {
    const media = playable?.media || playable;
    if (!this.valid(h)) {
      try { media?.pause?.(); } finally { playable?.dispose?.(); }
      return;
    }
    if (!media) { this.fail(h); return; }
    h.media = media; h.playable = playable;
    h.source = playable.source || media;
    media.preload = 'auto'; media.loop = false; media.playsInline = true; media.controls = false;
    media.setAttribute?.('playsinline', '');
    const listen = (event, fn) => { media.addEventListener(event, fn); h.listeners.push([event, fn]); };
    listen('ended', () => this.finish(h, 'ended'));
    listen('error', () => this.fail(h));
    listen('loadedmetadata', () => this.size(h));
    listen('playing', () => { if (this.valid(h)) { h.stage = 'playing'; this.caption(h); } });
    const overlay = h.overlay = this.document.createElement('div');
    Object.assign(overlay.style, { position: 'fixed', inset: '0', zIndex: '10000', background: '#000', display: 'flex',
      alignItems: 'center', justifyContent: 'center', color: '#eee6d5' });
    overlay.tabIndex = -1; overlay.setAttribute?.('role', 'dialog');
    const element = playable.element || media;
    Object.assign(element.style, { width: '100%', height: '100%', objectFit: 'contain' }); overlay.appendChild(element);
    const buttons = this.document.createElement('div');
    Object.assign(buttons.style, { position: 'absolute', bottom: '24px', display: 'flex', gap: '16px' }); overlay.appendChild(buttons);
    for (const [kind, label, action] of [['playButton', '동영상 재생', () => this.resume(h)], ['skipButton', '건너뛰기', () => this.skip(h)]]) {
      const button = h[kind] = this.document.createElement('button'); button.textContent = tr(label); button.type = 'button';
      Object.assign(button.style, { padding: '12px 20px', background: '#282328', color: '#eee6d5', border: '1px solid #b9a77e', font: '18px sans-serif' });
      button.onclick = () => { if (this.active === h) { this.onConsume(); action(); } }; buttons.appendChild(button);
    }
    this.document.body.appendChild(overlay);
    h.group = new THREE.Group(); h.group.name = 'event-movie'; h.group.userData.worldTone = false;
    const canvasSource = String(h.source.tagName).toUpperCase() === 'CANVAS';
    h.texture = canvasSource ? new THREE.CanvasTexture(h.source) : new THREE.VideoTexture(h.source);
    h.texture.colorSpace = THREE.SRGBColorSpace; h.texture.generateMipmaps = false;
    const material = new THREE.MeshBasicMaterial({ map: h.texture, depthTest: false, depthWrite: false, toneMapped: false });
    h.screen = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material); h.screen.renderOrder = 4001; h.group.add(h.screen);
    h.back = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0, depthTest: false, depthWrite: false, toneMapped: false }));
    h.back.position.z = -0.01; h.back.renderOrder = 4000; h.group.add(h.back);
    h.captionCanvas = this.document.createElement('canvas'); h.captionCanvas.width = 1024; h.captionCanvas.height = 64;
    h.captionTexture = new THREE.CanvasTexture(h.captionCanvas); h.captionTexture.colorSpace = THREE.SRGBColorSpace;
    h.hint = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: h.captionTexture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    h.hint.renderOrder = 4002; h.group.add(h.hint); this.scene.add(h.group);
    this.size(h); this.mode(h); this.caption(h);
    media.src = gameUrl(h.path); media.load?.();
    if (playable.needsGesture) { h.stage = 'blocked'; this.caption(h); }
    else if (this.away()) { h.away = true; h.resumeWhenBack = true; } else this.resume(h);
  }
  away() { return !!this.isAway(); }
  size(h) {
    if (!h.screen) return;
    const width = h.media.videoWidth || h.source.width || 640, height = h.media.videoHeight || h.source.height || 480;
    const ratio = width > 0 && height > 0 ? width / height : 4 / 3;
    const w = Math.min(3.2, 2.2 * ratio), high = w / ratio;
    h.screen.scale.set(w, high, 1); h.back.scale.set(w + 0.12, high + 0.4, 1);
    h.hint.scale.set(w, w / 16, 1); h.hint.position.y = -high / 2 - 0.13;
  }
  mode(h) {
    if (!h.group) return;
    h.mode = !!G.vr; h.group.visible = h.mode; h.overlay.style.display = h.mode ? 'none' : 'flex';
    if (h.mode) {
      const head = G.player?.headWorld?.(new THREE.Vector3()) || this.camera.getWorldPosition(new THREE.Vector3());
      const forward = this.camera.getWorldDirection(new THREE.Vector3()); forward.y = 0;
      if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1); else forward.normalize();
      h.group.position.copy(head).addScaledVector(forward, 2.6);
      h.group.rotation.set(0, Math.atan2(-forward.x, -forward.z), 0);
    } else h.overlay.focus?.({ preventScroll: true });
  }
  caption(h) {
    if (!h.captionCanvas) return;
    const ctx = h.captionCanvas.getContext('2d'); ctx.clearRect(0, 0, 1024, 64);
    ctx.fillStyle = '#eee6d5'; ctx.font = '26px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(tr(h.stage === 'blocked' ? 'A / Enter: 재생 · B / Esc: 건너뛰기' : h.stage === 'loading' ? '동영상 불러오는 중…' : 'B / Esc: 건너뛰기'), 512, 32);
    h.captionTexture.needsUpdate = true;
    h.playButton.style.display = h.stage === 'blocked' ? '' : 'none';
  }
  resume(h = this.active) {
    if (!h?.media || !this.valid(h) || this.away()) return;
    const attempt = (h.attempt || 0) + 1; h.attempt = attempt;
    try {
      Promise.resolve(h.playable.play ? h.playable.play() : h.media.play()).then(() => {
        if (!this.valid(h) || h.attempt !== attempt) return;
        if (this.away()) { h.media.pause(); h.away = true; h.resumeWhenBack = true; return; }
        h.stage = 'playing'; this.caption(h);
      }, error => {
        if (!this.valid(h) || h.attempt !== attempt) return;
        if (error?.name === 'NotAllowedError') { h.stage = 'blocked'; this.caption(h); }
        else this.fail(h);
      });
    } catch (error) {
      if (error?.name === 'NotAllowedError') { h.stage = 'blocked'; this.caption(h); } else this.fail(h);
    }
  }
  update() {
    const h = this.active; if (!h) return;
    if (!this.valid(h)) { this.finish(h, 'cancelled'); return; }
    if (!this.away() && G.input?.cancel?.()) { this.skip(h); return; }
    if (!h.media) return;
    const away = this.away();
    if (away && !h.away) { h.resumeWhenBack = !h.media.paused; h.media.pause(); }
    if (!away && h.away && h.resumeWhenBack) { h.resumeWhenBack = false; this.resume(h); }
    h.away = away;
    if (h.mode !== !!G.vr) this.mode(h);
    if (away) return;
    if (h.stage === 'blocked' && (G.input?.confirm?.() || G.vr && G.input?.xrPressed?.('right', 0))) { this.onConsume(); this.resume(h); }
    if (h.source !== h.media && h.sourceTime !== h.media.currentTime) { h.sourceTime = h.media.currentTime; h.texture.needsUpdate = true; }
  }
  fail(h) { if (this.active === h) { G.ui?.toast?.(tr('동영상을 재생할 수 없습니다')); this.finish(h, 'failed'); } }
  skip(h = this.active) { if (this.active === h) { this.onConsume(); this.finish(h, 'skipped'); } }
  clear(h = this.active) { this.finish(h, 'cancelled'); }
  finish(h, stage) {
    if (!h || this.active !== h) return;
    this.active = null; h.pending = false; h.stage = stage;
    for (const [event, fn] of h.listeners) h.media?.removeEventListener(event, fn);
    try { h.media?.pause?.(); } catch { /* A failed decoder must still release its presentation. */ }
    try {
      if (h.playable?.dispose) h.playable.dispose();
      else { h.media?.removeAttribute?.('src'); h.media?.load?.(); }
    } catch { /* Continue disposing scene/UI ownership after media shutdown fails. */ }
    h.overlay?.remove(); this.scene.remove(h.group);
    h.group?.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); h.texture?.dispose(); h.captionTexture?.dispose();
    if (h.ui?._movieOwner === h) {
      delete h.ui._movieOwner;
      if (h.ui.sceneOpen === 'movie') h.ui.sceneOpen = h.previousScene || null;
    }
    this.onConsume();
  }
}
