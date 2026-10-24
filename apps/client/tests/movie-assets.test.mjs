import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import config from '../vite.config.js';

const require = createRequire(import.meta.url);
const ogvRoot = dirname(require.resolve('ogv/package.json'));

test('the actual build plugin packages the pinned Theora/Ogg/audio workers, valid WASM and applicable licenses', async () => {
  const assets = new Map(), plugin = config.plugins.find(p => p.name === 'runtime-models-and-licenses');
  plugin.buildStart.call({ emitFile: asset => assets.set(asset.fileName, asset.source) });
  assert.equal(JSON.parse(readFileSync(join(ogvRoot, 'package.json'))).version, '1.9.0');
  const codecAssets = [...assets].filter(([name]) => name.startsWith('codecs/ogv/'));
  assert.equal(codecAssets.length, 10); assert.ok(codecAssets.every(([name]) => !/vp8|vp9|av1|webm/.test(name)));
  for (const stem of ['ogv-demuxer-ogg', 'ogv-decoder-video-theora', 'ogv-decoder-audio-opus', 'ogv-decoder-audio-vorbis']) {
    const js = assets.get(`codecs/ogv/${stem}-wasm.js`), wasm = assets.get(`codecs/ogv/${stem}-wasm.wasm`);
    assert.ok(js.length > 1000); assert.ok(js.toString().includes(`${stem}-wasm.wasm`));
    assert.equal(wasm.readUInt32LE(0), 0x6d736100); await WebAssembly.compile(wasm);
    assert.deepEqual(wasm, readFileSync(join(ogvRoot, 'dist', `${stem}-wasm.wasm`)));
  }
  for (const file of ['ogv-worker-audio.js', 'ogv-worker-video.js']) assert.ok(assets.get(`codecs/ogv/${file}`).length > 1000);
  for (const file of ['COPYING', 'COPYING-ogg.txt', 'COPYING-theora.txt', 'COPYING-vorbis.txt', 'COPYING-opus.txt'])
    assert.deepEqual(assets.get(`licenses/ogv/${file}`), readFileSync(join(ogvRoot, 'dist', file)));
  const notices = assets.get('licenses/ogv/BUNDLED-DEPENDENCIES.txt').toString();
  for (const component of ['audio-feeder', 'stream-file', 'yuv-canvas', '@babel/runtime']) assert.ok(notices.includes(component));
  for (const author of ['Brion Vibber', 'Sebastian McKenzie']) assert.ok(notices.includes(author));
  assert.ok(codecAssets.reduce((sum, [, data]) => sum + data.length, 0) < 600000);
});

test('development serves the same local decoder resources with valid MIME and ignores unrelated paths', () => {
  let middleware, next = 0, bytes; const headers = {};
  config.plugins.find(p => p.name === 'runtime-models-and-licenses').configureServer({ middlewares: { use: fn => { middleware = fn; } } });
  const response = { setHeader: (key, value) => { headers[key] = value; }, end: data => { bytes = data; } };
  middleware({ url: '/codecs/ogv/ogv-decoder-video-theora-wasm.wasm?version=test' }, response, () => { next++; });
  assert.equal(headers['Content-Type'], 'application/wasm'); assert.equal(bytes.readUInt32LE(0), 0x6d736100);
  middleware({ url: '/codecs/ogv/ogv-worker-video.js' }, response, () => { next++; });
  assert.equal(headers['Content-Type'], 'text/javascript'); assert.ok(bytes.length > 1000);
  middleware({ url: '/codecs/ogv/../../outside' }, response, () => { next++; }); assert.equal(next, 1);
});
