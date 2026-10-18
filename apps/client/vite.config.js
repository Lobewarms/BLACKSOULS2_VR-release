import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const threeRoot = dirname(dirname(require.resolve('three')));
const profilesRoot = dirname(require.resolve('@webxr-input-profiles/assets/package.json'));
const backend = process.env.BLACKSOULS_VR_BACKEND;

const runtimeAssets = {
  'models/hands/left.glb': join(profilesRoot, 'dist/profiles/generic-hand/left.glb'),
  'models/hands/right.glb': join(profilesRoot, 'dist/profiles/generic-hand/right.glb'),
  'licenses/three.LICENSE': join(threeRoot, 'LICENSE'),
  'licenses/webxr-input-profiles-assets.LICENSE.md': join(profilesRoot, 'LICENSE.md'),
};

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
  }],
  build: {
    target: 'es2022',
    // Game scripts use dynamic formulas. Preserve readable names during the source migration.
    minify: false,
    emptyOutDir: true,
  },
});
