import test from 'node:test';
import assert from 'node:assert/strict';
import { createMovieMedia } from '../src/ui/movie-codec.js';

test('native supported movies avoid loading the fallback and keep the original video element', async () => {
  const video = { canPlayType: () => 'probably' }; let loads = 0;
  for (const path of ['Movies/Native.webm', 'Movies/Native.mp4', 'Movies/Supported.ogv']) {
    assert.equal(await createMovieMedia({ path }, { document: { createElement: () => video }, loadOgv: () => { loads++; } }), video);
  }
  assert.equal(loads, 0);
});

test('unsupported Theora uses bundled decoder public canvas and closes owned media/audio once', async () => {
  let context, stops = 0, plays = 0, lost = 0;
  const canvas = { getContext: () => ({ getExtension: () => ({ loseContext: () => { lost++; } }) }) };
  class Context { constructor() { context = this; this.resumes = this.closes = 0; } resume() { this.resumes++; return Promise.resolve(); } close() { this.closes++; return Promise.resolve(); } }
  class Player {
    constructor(options) { this.options = options; }
    getCanvas() { return canvas; } play() { plays++; } stop() { stops++; } removeAttribute() {}
  }
  const ogv = { OGVLoader: {}, OGVPlayer: Player };
  const result = await createMovieMedia({ path: 'Movies/Native.ogg' }, { document: { createElement: () => ({ canPlayType: () => '' }) },
    loadOgv: async () => ({ default: ogv }), AudioContext: Context, base: 'http://localhost/codecs/ogv/' });
  assert.equal(ogv.OGVLoader.base, 'http://localhost/codecs/ogv'); assert.equal(result.source, canvas);
  assert.equal(result.media.options.audioContext, context); assert.equal(result.needsGesture, true);
  await result.play(); assert.equal(context.resumes, 1); assert.equal(plays, 1);
  result.dispose(); result.dispose(); assert.equal(stops, 1); assert.equal(context.closes, 1); assert.equal(lost, 1);
});

test('a delayed audio resume cannot restart a disposed decoder', async () => {
  let resolve, plays = 0;
  class Context { resume() { return new Promise(r => { resolve = r; }); } close() {} }
  class Player { getCanvas() { return { getContext: () => null }; } play() { plays++; } stop() {} removeAttribute() {} }
  const result = await createMovieMedia({ path: 'Movies/Native.ogv' }, { document: { createElement: () => ({ canPlayType: () => '' }) },
    loadOgv: async () => ({ OGVLoader: {}, OGVPlayer: Player }), AudioContext: Context });
  const pending = result.play(); result.dispose(); resolve(); await pending; assert.equal(plays, 0);
});

test('failed decoder construction closes its owned audio context without leaking rejected close promises', async () => {
  let closes = 0;
  class Context { close() { closes++; return Promise.reject(new Error('audio unavailable')); } }
  class Player { constructor() { throw new Error('decoder unavailable'); } }
  await assert.rejects(createMovieMedia({ path: 'Movies/Native.ogv' }, { document: { createElement: () => ({ canPlayType: () => '' }) },
    loadOgv: async () => ({ OGVLoader: {}, OGVPlayer: Player }), AudioContext: Context }), /decoder unavailable/);
  assert.equal(closes, 1); await Promise.resolve();
});
