import test from 'node:test';
import assert from 'node:assert/strict';
import { initAssets, loadImage, loadCanvas } from '../src/data/assets.js';

async function images(t, name) {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: [`Graphics/Pictures/${name}.png`] }));
  await initAssets();
  let attempts = 0;
  const oldImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class {
    width = 2; height = 2;
    set src(_value) {
      const attempt = ++attempts;
      queueMicrotask(() => attempt === 1 ? this.onerror() : this.onload());
    }
  } });
  t.after(() => { if (oldImage) Object.defineProperty(globalThis, 'Image', oldImage); else delete globalThis.Image; });
  return () => attempts;
}

test('images retry after a transient failure and still share successful loads', async t => {
  const attempts = await images(t, 'retry-image');
  assert.equal(await loadImage('Graphics/Pictures', 'retry-image'), null);
  const [first, second] = await Promise.all([
    loadImage('Graphics/Pictures', 'retry-image'), loadImage('Graphics/Pictures', 'retry-image'),
  ]);
  assert.ok(first);
  assert.equal(first, second);
  assert.equal(attempts(), 2);
});

test('a failed canvas does not prevent its image from retrying', async t => {
  const attempts = await images(t, 'retry-canvas');
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => ({ getContext: () => ({ drawImage() {} }) }),
  } });
  t.after(() => { if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else delete globalThis.document; });
  assert.equal(await loadCanvas('Graphics/Pictures', 'retry-canvas'), null);
  assert.ok(await loadCanvas('Graphics/Pictures', 'retry-canvas'));
  assert.equal(attempts(), 2);
});
