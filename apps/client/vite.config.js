import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const threeRoot = dirname(dirname(require.resolve('three')));
const profilesRoot = dirname(require.resolve('@webxr-input-profiles/assets/package.json'));
const ogvRoot = dirname(require.resolve('ogv/package.json'));
const backend = process.env.BLACKSOULS_VR_BACKEND;

const runtimeAssets = {
  'models/hands/left.glb': join(profilesRoot, 'dist/profiles/generic-hand/left.glb'),
  'models/hands/right.glb': join(profilesRoot, 'dist/profiles/generic-hand/right.glb'),
  'licenses/three.LICENSE': join(threeRoot, 'LICENSE'),
  'licenses/webxr-input-profiles-assets.LICENSE.md': join(profilesRoot, 'LICENSE.md'),
  'licenses/ogv/BUNDLED-DEPENDENCIES.txt': new URL('./licenses/ogv-bundled-dependencies.LICENSE.txt', import.meta.url),
};
for (const file of ['ogv-demuxer-ogg-wasm.js', 'ogv-demuxer-ogg-wasm.wasm',
  'ogv-decoder-video-theora-wasm.js', 'ogv-decoder-video-theora-wasm.wasm',
  'ogv-decoder-audio-vorbis-wasm.js', 'ogv-decoder-audio-vorbis-wasm.wasm',
  'ogv-decoder-audio-opus-wasm.js', 'ogv-decoder-audio-opus-wasm.wasm',
  'ogv-worker-audio.js', 'ogv-worker-video.js']) runtimeAssets[`codecs/ogv/${file}`] = join(ogvRoot, 'dist', file);
for (const file of ['COPYING', 'COPYING-ogg.txt', 'COPYING-theora.txt', 'COPYING-vorbis.txt', 'COPYING-opus.txt'])
  runtimeAssets[`licenses/ogv/${file}`] = join(ogvRoot, 'dist', file);

export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    proxy: backend ? Object.fromEntries(['/api', '/game', '/rtp', '/local-assets'].map(path => [path, { target: backend, changeOrigin: true }])) : undefined,
  },
  plugins: [{
    name: 'runtime-models-and-licenses',
    buildStart() {
      for (const [fileName, sourcePath] of Object.entries(runtimeAssets)) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(sourcePath) });
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const file = (request.url || '').split('?')[0].replace(/^\//, '');
        const sourcePath = runtimeAssets[file];
        if (!sourcePath) { next(); return; }
        response.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        response.end(readFileSync(sourcePath));
      });
    },
  }],
  build: {
    target: 'es2022',
    // Game scripts use dynamic formulas. Preserve readable names during the source migration.
    minify: false,
    emptyOutDir: true,
  },
});
