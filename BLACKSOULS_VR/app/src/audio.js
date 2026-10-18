// Audio: BGM/BGS streamed with <audio>, SE/ME decoded with Web Audio (SE optionally positional).
import { G } from './globals.js';
import { $data } from './data.js';
import { resolveAudio, gameUrl } from './assets.js';

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.bgm = null; this.bgs = null; this.savedBgm = null;
    this.master = 0.9;
    this.seVoices = [];
  }
  ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.out = this.ctx.createGain();
      this.out.gain.value = this.master;
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  // browsers block autoplay until a user gesture: retry paused loops then
  resumeAll() {
    this.ensure();
    for (const l of [this.bgm, this.bgs]) if (l && l.el.paused) l.el.play().catch(() => {});
  }

  // ---- streamed loops ----
  makeLoop(folder, audio) {
    const path = resolveAudio(folder, audio.name);
    if (!path || /\.mid$/i.test(path)) return null;
    const el = new Audio(gameUrl(path));
    el.loop = true;
    el.preservesPitch = false;
    el.playbackRate = (audio.pitch || 100) / 100;
    el.volume = Math.min(1, (audio.volume ?? 100) / 100 * this.master);
    el.play().catch(() => {});
    return { name: audio.name, volume: audio.volume, pitch: audio.pitch, el };
  }
  // a volume ramp on a streamed loop, run by a timer (a page's animation frames stop while its window is not
  // shown - with the headset on the desktop window often is not, and a fading loop would never finish)
  ramp(el, to, seconds, done) {
    if (el._ramp) clearInterval(el._ramp);
    const from = el.volume, t0 = performance.now();
    const tick = () => {
      const k = seconds > 0 ? Math.min(1, (performance.now() - t0) / (seconds * 1000)) : 1;
      el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k >= 1) { clearInterval(el._ramp); el._ramp = null; done?.(); }
    };
    el._ramp = setInterval(tick, 30);
    tick();
  }
  stopRamp(l) { if (l?.el._ramp) { clearInterval(l.el._ramp); l.el._ramp = null; } }
  fadeEl(el, seconds) { if (el) this.ramp(el, 0, seconds, () => { el.pause(); el.src = ''; }); }
  // Audioフェードイン (the A1 script: a comment right after Play BGM / BGS): the loop just started comes up from
  // silence to that volume over ms - a boss's next theme played at volume 0 and faded in (그랑・기뇰's last act,
  // 목을 사냥하는 비스트, 고문구의 여왕, 플로렌스, the child's room)
  fadeIn(kind, volume, ms) {
    const l = kind === 'bgs' ? this.bgs : this.bgm;
    if (!l) return;
    l.volume = volume;
    l.el.volume = 0;
    this.ramp(l.el, Math.min(1, volume / 100 * this.master), ms / 1000);
  }
  playBgm(audio) {
    if (!audio || !audio.name) { this.stopBgm(); return; }
    if (this.bgm && this.bgm.name === audio.name) {
      this.stopRamp(this.bgm);
      this.bgm.el.volume = Math.min(1, (audio.volume ?? 100) / 100 * this.master);
      this.bgm.el.playbackRate = (audio.pitch || 100) / 100;
      this.bgm.volume = audio.volume; this.bgm.pitch = audio.pitch;
      return;
    }
    if (this.bgm) this.fadeEl(this.bgm.el, 0.4);
    this.bgm = this.makeLoop('Audio/BGM', audio);
  }
  stopBgm() { if (this.bgm) { this.stopRamp(this.bgm); this.bgm.el.pause(); this.bgm = null; } }
  fadeOutBgm(sec) { if (this.bgm) { this.fadeEl(this.bgm.el, sec); this.bgm = null; } }
  saveBgm() { this.savedBgm = this.bgm ? { name: this.bgm.name, volume: this.bgm.volume, pitch: this.bgm.pitch, pos: this.bgm.el.currentTime } : null; }
  replayBgm() {
    if (!this.savedBgm) return;
    this.playBgm(this.savedBgm);
    if (this.bgm) this.bgm.el.currentTime = this.savedBgm.pos || 0;
  }
  // what is playing now (BattleManager.save_bgm_and_bgs), and putting it back where it was
  snapshot() {
    return {
      bgm: this.bgm ? { name: this.bgm.name, volume: this.bgm.volume, pitch: this.bgm.pitch, pos: this.bgm.el.currentTime } : null,
      bgs: this.bgs ? { name: this.bgs.name, volume: this.bgs.volume, pitch: this.bgs.pitch } : null,
    };
  }
  restore(s) {
    if (!s) return;
    if (!s.bgm) this.fadeOutBgm(0.6);
    else if (this.bgm?.name !== s.bgm.name) { this.playBgm(s.bgm); if (this.bgm) this.bgm.el.currentTime = s.bgm.pos || 0; }
    if (!s.bgs) this.stopBgs();
    else if (this.bgs?.name !== s.bgs.name) this.playBgs(s.bgs);
  }
  playBgs(audio) {
    if (!audio || !audio.name) { this.stopBgs(); return; }
    if (this.bgs && this.bgs.name === audio.name) {
      this.stopRamp(this.bgs);
      this.bgs.el.volume = Math.min(1, (audio.volume ?? 100) / 100 * this.master);
      return;
    }
    if (this.bgs) this.fadeEl(this.bgs.el, 0.4);
    this.bgs = this.makeLoop('Audio/BGS', audio);
  }
  stopBgs() { if (this.bgs) { this.stopRamp(this.bgs); this.bgs.el.pause(); this.bgs = null; } }
  fadeOutBgs(sec) { if (this.bgs) { this.fadeEl(this.bgs.el, sec); this.bgs = null; } }
  autoplayMap(map) {
    if (map.autoplay_bgm) this.playBgm(map.bgm);
    if (map.autoplay_bgs) this.playBgs(map.bgs);
  }

  // ---- one-shots ----
  async buffer(folder, name) {
    const path = resolveAudio(folder, name);
    if (!path || /\.mid$/i.test(path)) return null;
    if (!this.buffers.has(path)) {
      this.buffers.set(path, fetch(gameUrl(path)).then(r => r.arrayBuffer())
        .then(b => this.ensure().decodeAudioData(b)).catch(() => null));
    }
    return this.buffers.get(path);
  }
  // position: THREE.Vector3 world position for 3D sound, or an event character; ref: how far off it is still heard
  // at full volume (m) - a crowd far off is loud
  async playOneShot(folder, audio, position, ref = 1.5) {
    if (!audio || !audio.name) return;
    const ctx = this.ensure();
    const buf = await this.buffer(folder, audio.name);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (audio.pitch || 100) / 100;
    const gain = ctx.createGain();
    gain.gain.value = (audio.volume ?? 100) / 100;
    let node = gain;
    // (a place that is not a number - something not yet standing anywhere - plays as a sound with no place)
    if (position && !(Number.isFinite(position.x) && Number.isFinite(position.z) && Number.isFinite(position.y ?? 1.2))) position = null;
    if (position) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = ref; p.rolloffFactor = 1.2;
      p.positionX.value = position.x; p.positionY.value = position.y ?? 1.2; p.positionZ.value = position.z;
      gain.connect(p);
      node = p;
    }
    src.connect(gain);
    node.connect(this.out);
    src.start(0, Math.max(0, audio.from || 0));         // (from: where in the file it starts, s - a silent lead-in left out)
    if (audio.len > 0) {
      const t = ctx.currentTime + audio.len;
      gain.gain.setValueAtTime(gain.gain.value, Math.max(ctx.currentTime, t - 0.08));
      gain.gain.linearRampToValueAtTime(0.0001, t);
      src.stop(t + 0.02);
    }
    this.seVoices.push(src);
    src.onended = () => { this.seVoices = this.seVoices.filter(s => s !== src); };
  }
  playSe(audio, where, opts) {
    let pos = null;
    if (where && where.isVector3) pos = where;
    else if (where && where.isEvent) pos = { x: (where.realX + 0.5) * 1.5, y: 1.2, z: (where.realY + 0.5) * 1.5 };
    this.playOneShot('Audio/SE', audio, pos, opts?.ref);
  }
  playMe(audio) {
    if (this.bgm) {
      const el = this.bgm.el, v = el.volume;
      el.volume = v * 0.25;
      setTimeout(() => { if (this.bgm?.el === el) el.volume = v; }, 4000);
    }
    this.playOneShot('Audio/ME', audio);
  }
  stopSe() { for (const s of this.seVoices) { try { s.stop(); } catch { /* */ } } this.seVoices = []; }
  playSystemSe(i) { const se = $data.system?.sounds?.[i]; if (se) this.playOneShot('Audio/SE', se); }

  // listener follows the head
  updateListener(camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const e = camera.matrixWorld.elements;
    const px = e[12], py = e[13], pz = e[14];
    const fx = -e[8], fy = -e[9], fz = -e[10];
    const ux = e[4], uy = e[5], uz = e[6];
    // a broken pose for one frame must not throw out of the XR frame loop
    if (!Number.isFinite(px + py + pz + fx + fy + fz + ux + uy + uz)) return;
    if (l.positionX) {
      l.positionX.value = px; l.positionY.value = py; l.positionZ.value = pz;
      l.forwardX.value = fx; l.forwardY.value = fy; l.forwardZ.value = fz;
      l.upX.value = ux; l.upY.value = uy; l.upZ.value = uz;
    } else {
      l.setPosition(px, py, pz);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }
}

// what raising the shield sounds like (menu 전투·화면 설정 → 방패 드는 소리 - none unless one is chosen): the
// game's own metal and cloth sounds, cut short
// the shield coming up: a buckle's clink (RTP Equip3, cut short) - the one the user chose
export const SHIELD_SOUND = [{ name: 'Equip3', volume: 80, pitch: 100, len: 0.35 }];
export function seAt(name, volume = 90, pitch = 100) { return { name, volume, pitch }; }
G.seAt = seAt;
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => G.audio?.resumeAll(), { passive: true });
