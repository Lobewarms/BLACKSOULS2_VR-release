import test from 'node:test';
import assert from 'node:assert/strict';
import { G } from '../src/core/globals.js';
import { VoiceChat } from '../src/network/coopvoice.js';
import { encodeVoiceFrames, decodeVoiceFrames } from '../src/network/voice-packets.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
function fixture(t, options = {}) {
  const previous = { ...G }, descriptors = new Map(), decoders = [], sources = [], tracks = [];
  const set = (key, value) => { descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); };
  const node = () => ({ connect() {}, disconnect() { this.disconnected = true; } });
  const track = () => { const t = { stopped: 0, stop() { this.stopped++; } }; tracks.push(t); return t; };
  const stream = { getTracks: () => [tracks[0]] }; track();
  class Context {
    constructor() { this.currentTime = 0; this.listener = { positionX: { value: 0 }, positionY: { value: 1.7 }, positionZ: { value: 0 } }; }
    createGain() { return { ...node(), gain: { value: 1 } }; }
    createPanner() { return { ...node(), positionX: {}, positionY: {}, positionZ: {} }; }
    createDynamicsCompressor() { return { ...node(), context: this, ...Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map(k => [k, {}])) }; }
    createBuffer(_channels, size, rate) { return { duration: size / rate, getChannelData: () => new Float32Array(size) }; }
    createBufferSource() { const s = { ...node(), start() {}, stop() { this.stopped = true; } }; sources.push(s); return s; }
    createMediaStreamSource() { return node(); }
    createMediaStreamDestination() { const out = track(); return { stream: { getAudioTracks: () => [out] } }; }
    close() { this.closed = true; return Promise.resolve(); }
  }
  class Decoder {
    constructor(callbacks) { this.callbacks = callbacks; this.state = 'configured'; this.decoded = []; this.decodeQueueSize = 0; decoders.push(this); }
    configure() {} decode(chunk) { this.decoded.push(chunk); } close() { this.state = 'closed'; }
  }
  class Encoder { constructor(callbacks) { this.callbacks = callbacks; this.state = 'configured'; } configure() { if (options.encoderFails) throw new Error('unsupported encoder'); } close() { this.state = 'closed'; } }
  set('AudioEncoder', Encoder); set('AudioDecoder', Decoder); set('EncodedAudioChunk', class { constructor(value) { Object.assign(this, value); } });
  set('AudioContext', Context); set('MediaStreamTrackProcessor', class { constructor() { const pending = deferred(); this.readable = { getReader: () => ({ read: () => pending.promise, cancel: () => { pending.resolve({ done: true }); return Promise.resolve(); } }) }; } });
  let gets = 0; set('navigator', { mediaDevices: { getUserMedia: () => { gets++; return options.permission?.promise || Promise.resolve(stream); }, enumerateDevices: async () => [] } });
  const ctx = new Context(), sent = [];
  Object.assign(G, { settings: { voice: 'listen' }, vr: false, chat: { on: true }, coop: { link: {}, peers: new Map(), send: m => sent.push(m), muted: () => false },
    audio: { ctx, ensure: () => ctx, out: {} }, ui: { toast() {} } });
  const voice = G.voice = new VoiceChat(); t.mock.method(console, 'warn', () => {});
  t.after(() => { voice.dispose(); Object.assign(G, previous); for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  return { voice, stream, sent, decoders, sources, tracks, ctx, get gets() { return gets; } };
}
const packet = n => ({ d: encodeVoiceFrames([new Uint8Array([1, 2, 3])]), n });
const audioFrame = () => ({ numberOfFrames: 960, sampleRate: 48000, closed: false, copyTo() {}, close() { this.closed = true; } });

test('voice packets roundtrip the existing multi-frame wire format and reject entire malformed/oversized packets', () => {
  const frames = [new Uint8Array([0, 255, 7]), new Uint8Array([9])];
  assert.deepEqual(decodeVoiceFrames(encodeVoiceFrames(frames)), frames);
  for (const bad of ['', 'not-base64!', 'AAE=', btoa('\0\u0001x\0'), btoa('\0\u0001x\0\u0005x'), 'A'.repeat(6004)]) assert.equal(decodeVoiceFrames(bad), null);
  assert.equal(encodeVoiceFrames([]), null); assert.equal(encodeVoiceFrames([new Uint8Array(1201)]), null);
});

test('listen-only default receives voice without requesting microphone permission or requiring capture APIs', t => {
  const e = fixture(t); globalThis.AudioEncoder = undefined; globalThis.MediaStreamTrackProcessor = undefined;
  e.voice.update(); e.voice.onVoice('peer', packet(1), false);
  assert.equal(e.voice.mode, 'listen'); assert.equal(e.gets, 0); assert.equal(e.decoders[0].decoded.length, 1);
});

for (const reason of ['off', 'session', 'link', 'device']) test(`a late microphone permission result cannot start capture after ${reason} changed`, async t => {
  const permission = deferred(), e = fixture(t, { permission }); G.settings.voice = 'talk';
  const waiting = e.voice.startMic(); assert.equal(e.gets, 1); assert.equal(e.voice.starting, true);
  if (reason === 'off') G.settings.voice = 'off'; else if (reason === 'session') G.chat.on = false;
  else if (reason === 'link') G.coop.link = {}; else G.settings.voiceDevice = 'another';
  e.voice.update(); permission.resolve(e.stream); await waiting;
  assert.equal(e.voice.micLive, false); assert.equal(e.tracks[0].stopped, 1); assert.equal(e.voice.starting, false);
});

test('encoder initialization failures release capture tracks and cannot repeatedly request microphone access', async t => {
  const e = fixture(t, { encoderFails: true }); G.settings.voice = 'talk'; await e.voice.startMic();
  assert.equal(e.voice.micLive, false); assert.ok(e.tracks.every(t => t.stopped === 1));
  e.voice.update(); assert.equal(e.gets, 1); assert.ok(e.voice.failed);
});

test('muting stops already scheduled voice, closes decoder and ignores its late output callback', t => {
  const e = fixture(t); e.voice.onVoice('peer', packet(1), false); const decoder = e.decoders[0];
  decoder.callbacks.output(audioFrame()); assert.equal(e.sources.length, 1); G.coop.muted = () => true;
  e.voice.update(); assert.equal(e.sources[0].stopped, true); assert.equal(decoder.state, 'closed');
  const late = audioFrame(); decoder.callbacks.output(late); assert.equal(late.closed, true); assert.equal(e.sources.length, 1);
});

test('duplicate/out-of-order voice packets cannot replay audio and decoder queues remain bounded', t => {
  const e = fixture(t); e.voice.onVoice('peer', packet(65535), false); e.voice.onVoice('peer', packet(0), false);
  const decoder = e.decoders[0]; assert.equal(decoder.decoded.length, 2);
  e.voice.onVoice('peer', packet(0), false); e.voice.onVoice('peer', packet(65535), false); assert.equal(decoder.decoded.length, 2);
  decoder.decodeQueueSize = 24; e.voice.onVoice('peer', packet(1), false); assert.equal(decoder.decoded.length, 2);
  G.settings.voice = 'off'; e.voice.update(); assert.equal(decoder.state, 'closed');
});

test('microphone output never sends after mode-off or capture disposal and cleanup stops each owned track', async t => {
  const e = fixture(t); G.settings.voice = 'talk'; await e.voice.startMic(); const encoder = e.voice.mic.encoder;
  const chunk = { byteLength: 1, copyTo: out => { out[0] = 1; } };
  for (let n = 0; n < 3; n++) encoder.callbacks.output(chunk);
  assert.equal(e.sent.length, 1); G.settings.voice = 'off'; e.voice.update();
  for (let n = 0; n < 3; n++) encoder.callbacks.output(chunk);
  assert.equal(e.sent.length, 1); assert.ok(e.tracks.every(t => t.stopped === 1));
});
