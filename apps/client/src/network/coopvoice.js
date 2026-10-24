// Voice between players. Listen only at first (co-op menu → 채팅·음성: off, listen only, or talk too) - only with talk chosen,
// and only while it is in a session with others, is its microphone opened (the device it picks; the browser asks it
// the first time - unless the launcher, starting the game window with its auto VR, allowed it already: AutoVr).
// What it says goes through the same server as everything else (no other way in, nothing else to
// open): Opus (WebCodecs, 24 kbps, mono 48 kHz) while it speaks - a level gate, so silence sends nothing -, three 20 ms
// frames a message (on the community server, to those on its map only). What the others say: each one's own decoder,
// played a moment behind (a small buffer against a late message), heard from where the speaker stands when it is on
// this map, else plainly - twice as loud as it came (LOUD: at its own level it was far too quiet beside the game), through
// one compressor so that a loud one does not crack -, its volume the player's; a muted player is not heard. Nothing of it
// is recorded or kept.
import { G } from '../core/globals.js';
import { tr } from '../ui/i18n.js';
import { encodeVoiceFrames as toB64, decodeVoiceFrames as fromB64, VOICE_MESSAGE_MAX } from './voice-packets.js';

const RATE = 48000;
const BITRATE = 24000;
const FRAMES_PER_MSG = 3;            // 20 ms Opus frames sent together
const GATE = 0.012;                  // RMS of the microphone above which it counts as speaking (about -38 dBFS)
const HOLD = 0.4;                    // s the gate stays open after the voice drops under it
const LEAD = 0.08;                   // s a voice is played behind its coming (the buffer)
const LOUD = 2;                      // the voices' 100% (the volume setting's): twice their own level
const nowS = () => performance.now() / 1000;
const supported = () => typeof AudioEncoder === 'function' && typeof AudioDecoder === 'function' && typeof MediaStreamTrackProcessor === 'function';
const canListen = () => typeof AudioDecoder === 'function' && typeof EncodedAudioChunk === 'function';

export class VoiceChat {
  constructor() {
    this.mic = null;                 // { stream, ctx, reader, encoder, ... } while the microphone is open
    this.starting = false;
    this.startToken = null;
    this.peers = new Map();          // sender -> { decoder, gain, panner, next, ts, heard }
    this.pending = [];
    this.seq = 0;
    this.speaking = false;
    this.lastVoice = 0;
    this.failed = '';
    this.stats = { frames: 0, loud: 0, sent: 0, heard: 0, level: 0 };     // (what it did: for its test, and the console)
  }
  get mode() { const v = G.settings?.voice; return v === 'talk' || v === 'off' ? v : 'listen'; }
  get micLive() { return !!this.mic; }
  // every frame: the microphone open exactly while it should be (talk, in a session); the voices of those gone let go
  update() {
    const want = this.mode === 'talk' && !!G.chat?.on && supported();
    if (want && !this.mic && !this.starting && !this.failed) this.startMic();
    else if (!want && (this.mic || this.startToken)) this.stopMic();
    else if (this.mic && this.mic.device !== (G.settings.voiceDevice || '')) this.stopMic();      // (another device picked: opened again)
    if (this.startToken && this.startToken.device !== (G.settings.voiceDevice || '')) this.startToken = null;
    if (this.mode === 'off' || !G.chat?.on) { if (this.peers.size) this.dropAll(); return; }
    // where each one speaking stands (heard from there on this map)
    for (const [id, p] of this.peers) {
      if (G.coop?.muted?.(id)) { this.drop(id); continue; }
      const av = G.coop?.peers?.get(id)?.avatar, c = av?.cur;
      const l = G.audio?.ctx?.listener;
      const at = c && av.root?.visible ? { x: c.x, y: c.y, z: c.z } : l?.positionX ? { x: l.positionX.value, y: l.positionY.value, z: l.positionZ.value } : null;
      if (at) { p.panner.positionX.value = at.x; p.panner.positionY.value = at.y; p.panner.positionZ.value = at.z; }
      if (nowS() - p.heard > 30) this.drop(id);
    }
  }
  // the devices it may listen with: [{ id, label, named }] (the system's own 'default' / 'communications' left out - '' is the
  // default). The browser names them, and tells them apart at all, only once the page may use a microphone: asked to (ask),
  // with none named it requests one a moment first (its question on the PC's screen in VR) and lists them again
  async devices(ask = false) {
    const all = async () => (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
    try {
      let list = await all();
      if (ask && !list.some(d => d.label)) {
        if (G.vr) G.ui?.toast?.(tr('마이크 권한은 PC 화면에서 허용해 주세요 (VR에 들어가기 전에 켜 두면 편합니다)'), 0, '#ffd870', 6);
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: true });
          for (const t of s.getTracks()) t.stop();
        } catch (e) { G.ui?.toast?.(e?.name === 'NotAllowedError' ? tr('마이크를 쓸 수 없습니다 (브라우저가 막았습니다)') : tr('마이크를 열지 못했습니다'), 0, '#ff9a9a', 5); }
        list = await all();
      }
      return list.filter(d => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d, i) => ({ id: d.deviceId, label: d.label || tr('마이크 {n}', { n: i + 1 }), named: !!d.label }));
    } catch { return []; }
  }
  async startMic() {
    if (this.starting || this.mic || this.mode !== 'talk' || !G.chat?.on || !supported()) return;
    this.starting = true;
    const device = G.settings.voiceDevice || '';
    const token = this.startToken = { device, coop: G.coop, link: G.coop?.link };
    const valid = () => this.startToken === token && this.mode === 'talk' && G.chat?.on && G.coop === token.coop && G.coop?.link === token.link && device === (G.settings.voiceDevice || '');
    let stream, ctx, reader, encoder, src, track;
    try {
      // (in VR the browser's question comes up on the PC's screen, not in the headset)
      if (G.vr) {
        const st = await navigator.permissions?.query?.({ name: 'microphone' }).catch(() => null);
        if (st?.state === 'prompt') G.ui?.toast?.(tr('마이크 권한은 PC 화면에서 허용해 주세요 (VR에 들어가기 전에 켜 두면 편합니다)'), 0, '#ffd870', 6);
      }
      const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
      if (!valid()) return;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { ...audio, deviceId: device ? { exact: device } : undefined } }); } catch (e) {
        // (the microphone picked is not there now - unplugged: the system's default instead)
        if (!device || !['OverconstrainedError', 'NotFoundError'].includes(e?.name)) throw e;
        if (!valid()) return;
        G.ui?.toast?.(tr('고른 마이크가 없어 기본 장치를 씁니다'), 0, '#ffd870', 4);
        stream = await navigator.mediaDevices.getUserMedia({ audio });
      }
      if (!valid()) return;
      // (through a context at 48 kHz: the encoder takes Opus's rates only)
      ctx = new AudioContext({ sampleRate: RATE });
      src = ctx.createMediaStreamSource(stream); const dest = ctx.createMediaStreamDestination();
      dest.channelCount = 1; dest.channelCountMode = 'explicit';      // (mono, as the encoder takes it - the node's own is two)
      src.connect(dest);
      track = dest.stream.getAudioTracks()[0];
      reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
      // (an encoder that cannot go on: shut, and not opened again until a setting is changed - no round of reopening)
      encoder = new AudioEncoder({ output: chunk => { if (this.mic?.encoder === encoder) this.onChunk(chunk); }, error: e => {
        console.warn('[voice] encoder', e);
        if (this.mic?.encoder !== encoder) return;
        this.failed = 'encoder'; this.stopMic();
        G.ui?.toast?.(tr('마이크를 열지 못했습니다'), 0, '#ff9a9a', 5);
      } });
      encoder.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: 1, bitrate: BITRATE });
      const mic = this.mic = { stream, ctx, reader, encoder, device, src, track };
      G.ui?.toast?.(tr('마이크가 켜졌습니다 (음성 채팅)'), 0, '#ffd870', 3);
      this.pump(mic);
    } catch (e) {
      console.warn('[voice] microphone', e);
      if (valid()) {
        this.failed = e?.name || 'error';
        G.ui?.toast?.(e?.name === 'NotAllowedError' ? tr('마이크를 쓸 수 없습니다 (브라우저가 막았습니다)') : tr('마이크를 열지 못했습니다'), 0, '#ff9a9a', 5);
      }
    } finally {
      if (this.mic?.stream !== stream) this.releaseMic({ stream, ctx, reader, encoder, src, track });
      if (this.startToken === token) this.startToken = null;
      this.starting = false;
    }
  }
  stopMic() {
    const m = this.mic;
    this.startToken = null; this.mic = null; this.speaking = false; this.pending = [];
    this.releaseMic(m);
  }
  releaseMic(m) {
    if (!m) return;
    try { m.reader?.cancel()?.catch?.(() => {}); } catch { /* cancelled native readers may already be closed */ }
    try { if (m.encoder && m.encoder.state !== 'closed') m.encoder.close(); } catch { /* already closed */ }
    for (const t of m.stream?.getTracks() || []) t.stop();
    m.track?.stop();
    try { m.src?.disconnect(); } catch { /* a partially created source may not be connected */ }
    try { m.ctx?.close()?.catch?.(() => {}); } catch { /* a failed native context may already be closed */ }
  }
  // a setting changed (its mode or its device): tried again
  retry() { this.failed = ''; }
  // the microphone's sound, a few milliseconds at a time: encoded while it speaks
  async pump(mic) {
    while (this.mic === mic) {
      let r;
      try { r = await mic.reader.read(); } catch { break; }
      if (r.done || this.mic !== mic) { r.value?.close(); break; }
      const a = r.value;
      try {
        const n = a.numberOfFrames, buf = new Float32Array(n);
        a.copyTo(buf, { planeIndex: 0, format: 'f32-planar' });
        let sum = 0;
        for (let i = 0; i < n; i++) sum += buf[i] * buf[i];
        const t = nowS(), level = Math.sqrt(sum / Math.max(1, n));
        this.stats.frames++; this.stats.level = level;
        if (level > GATE) { this.lastVoice = t; this.stats.loud++; }
        this.speaking = t - this.lastVoice < HOLD;
        if (this.speaking && mic.encoder.state === 'configured') mic.encoder.encode(a);
        else if (this.pending.length) this.flush();
      } catch (e) { console.warn('[voice] frame', e); }
      a.close();
    }
    if (this.mic === mic) { this.failed = 'ended'; this.stopMic(); }
  }
  onChunk(chunk) {
    const b = new Uint8Array(chunk.byteLength);
    chunk.copyTo(b);
    this.pending.push(b);
    if (this.pending.length >= FRAMES_PER_MSG) this.flush();
  }
  flush() {
    if (!this.pending.length) return;
    const d = toB64(this.pending);
    this.pending = [];
    if (d && this.mic && this.mode === 'talk' && G.chat?.on) { G.coop.send({ t: 'vo', d, n: this.seq++ & 0xffff }); this.stats.sent++; }
  }

  // ---- what the others say
  onVoice(from, m, muted) {
    if (this.mode === 'off' || !G.chat?.on || muted || typeof m?.d !== 'string' || m.d.length > VOICE_MESSAGE_MAX || !canListen()) return;
    if (m.n !== undefined && (!Number.isInteger(m.n) || m.n < 0 || m.n > 65535)) return;
    const chunks = fromB64(m.d);
    if (!chunks) return;
    const p = this.peer(from);
    if (!p) return;
    if (m.n !== undefined && p.seq !== undefined && ((m.n - p.seq + 65536) % 65536 === 0 || (m.n - p.seq + 65536) % 65536 > 32768)) return;
    if ((p.decoder.decodeQueueSize || 0) + chunks.length > 24 || p.next > G.audio.ctx.currentTime + 0.6) return;
    if (m.n !== undefined) p.seq = m.n;
    p.heard = nowS();
    this.stats.heard++;
    for (const data of chunks) {
      try { p.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: (p.ts += 20000), data })); } catch { this.drop(from); return; }
    }
  }
  peer(id) {
    let p = this.peers.get(id);
    if (p) return p;
    const ctx = G.audio?.ensure?.();
    if (!ctx || this.peers.size >= 16) return null;
    const gain = ctx.createGain(), panner = ctx.createPanner();
    panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.refDistance = 3; panner.rolloffFactor = 0.5;
    // (all the voices through one compressor: louder, but a shout does not crack)
    if (this.bus?.context !== ctx) {
      this.bus?.disconnect(); this.bus = ctx.createDynamicsCompressor();
      this.bus.threshold.value = -14; this.bus.knee.value = 10; this.bus.ratio.value = 6; this.bus.attack.value = 0.003; this.bus.release.value = 0.2;
      this.bus.connect(G.audio.out);
    }
    gain.connect(panner); panner.connect(this.bus);
    p = { gain, panner, next: 0, ts: 0, heard: nowS(), decoder: null, sources: new Set() };
    try {
      p.decoder = new AudioDecoder({ output: a => { if (this.peers.get(id) === p) this.play(p, a); else a.close(); }, error: () => this.drop(id) });
      p.decoder.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: 1 });
    } catch {
      try { p.decoder?.close(); } catch { /* unsupported decoder */ }
      gain.disconnect(); panner.disconnect(); return null;
    }
    this.peers.set(id, p);
    return p;
  }
  // a decoded bit of a voice, played after the one before it (or a moment from now, when it came late)
  play(p, a) {
    try {
      const ctx = G.audio.ctx, n = a.numberOfFrames;
      if (p.next > ctx.currentTime + 0.6 || p.sources.size >= 32 || this.mode === 'off') return;
      const buf = ctx.createBuffer(1, n, a.sampleRate);
      a.copyTo(buf.getChannelData(0), { planeIndex: 0, format: 'f32-planar' });
      const src = ctx.createBufferSource();
      src.buffer = buf;
      p.gain.gain.value = LOUD * Math.max(0, Math.min(2, G.settings.voiceVolume ?? 1));
      src.connect(p.gain);
      p.sources.add(src); src.onended = () => { p.sources.delete(src); src.disconnect(); };
      const t = p.next > ctx.currentTime + 0.005 ? p.next : ctx.currentTime + LEAD;
      src.start(t);
      p.next = t + buf.duration;
    } catch (e) { console.warn('[voice] play', e); }
    finally { a.close(); }
  }
  drop(id) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    for (const source of p.sources) { try { source.stop(); source.disconnect(); } catch { /* already ended */ } }
    p.sources.clear();
    try { if (p.decoder.state !== 'closed') p.decoder.close(); } catch { /* */ }
    try { p.gain.disconnect(); p.panner.disconnect(); } catch { /* */ }
  }
  dropAll() { for (const id of [...this.peers.keys()]) this.drop(id); }
  dispose() { this.stopMic(); this.dropAll(); this.bus?.disconnect(); this.bus = null; }
  // whether one is talking now (heard in the last moment) - for its name's mark
  talking(id) { const p = this.peers.get(id); return !!p && G.audio?.ctx && p.next > G.audio.ctx.currentTime - 0.15; }
}
