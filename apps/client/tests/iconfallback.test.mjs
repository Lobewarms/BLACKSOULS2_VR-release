import test from 'node:test';
import assert from 'node:assert/strict';
import { sheetForIcon } from '../src/data/iconfallback.js';

// Synthetic RGBA sheets only: cells are read through the canvas pixel API.
function sheet(height = 936) {
  const width = 384, pixels = new Uint8ClampedArray(width * height * 4), reads = [];
  return { width, height, reads,
    paint(index, color = [0, 0, 0, 255]) {
      const x = index % 16 * 24 + 23, y = Math.floor(index / 16) * 24 + 23;
      pixels.set(color, (y * width + x) * 4); // Include the final pixel in the scan.
    },
    getContext: () => ({ getImageData(x, y, w, h) {
      reads.push([x, y, w, h]);
      const data = new Uint8ClampedArray(w * h * 4);
      for (let row = 0; row < h; row++) {
        const offset = ((y + row) * width + x) * 4;
        data.set(pixels.subarray(offset, offset + w * 4), row * w * 4);
      }
      return { data };
    } }),
  };
}

test('transparent in-bounds status cells use archive art with one alpha read per sheet and icon', () => {
  const primary = sheet(), archive = sheet(1300);
  for (const id of [529, 530, 561]) {
    // RGB values without alpha are not visible artwork.
    primary.paint(id, [255, 200, 100, 0]); archive.paint(id);
    for (let frame = 0; frame < 20; frame++) assert.equal(sheetForIcon(primary, archive, id), archive);
  }
  const expected = [529, 530, 561].map(id => [id % 16 * 24, Math.floor(id / 16) * 24, 24, 24]);
  assert.deepEqual(primary.reads, expected);
  assert.deepEqual(archive.reads, expected, 'repeated HUD and enemy frames must reuse cached alpha checks');
});

test('even a single translucent primary pixel wins over archived art and canvas caches stay independent', () => {
  const primary = sheet(), archive = sheet(1300), otherPrimary = sheet();
  primary.paint(529, [0, 0, 0, 1]); archive.paint(529);
  for (let frame = 0; frame < 20; frame++) assert.equal(sheetForIcon(primary, archive, 529), primary);
  assert.equal(primary.reads.length, 1);
  assert.equal(archive.reads.length, 0, 'available primary artwork requires no archived pixel read');
  assert.equal(sheetForIcon(otherPrimary, archive, 529), archive, 'another loaded sheet must not inherit an occupied-cell result');
  assert.equal(otherPrimary.reads.length, 1);
});

test('a missing or blank archive preserves the original cell without substituting unrelated artwork', () => {
  const primary = sheet(), blankArchive = sheet(1300);
  assert.equal(sheetForIcon(primary, null, 529), primary);
  assert.equal(primary.reads.length, 0, 'no pixel work is needed when no fallback is available');
  assert.equal(sheetForIcon(primary, blankArchive, 529), primary);
  assert.equal(sheetForIcon(primary, blankArchive, 529), primary);
  assert.equal(primary.reads.length, 1); assert.equal(blankArchive.reads.length, 1);
  assert.equal(sheetForIcon(null, null, 529), null);
  assert.equal(sheetForIcon(primary, blankArchive, 706), blankArchive, 'out-of-bounds icons retain existing archive selection');
  assert.equal(sheetForIcon(primary, blankArchive, 2000), null);
  for (const invalid of [-1, 1.5, Number.NaN]) assert.equal(sheetForIcon(primary, blankArchive, invalid), null);
});

test('unreadable canvas pixels conservatively preserve primary artwork and cache read failures', () => {
  const archive = sheet(1300); archive.paint(529);
  let failures = 0;
  const unreadable = { width: 384, height: 936, getContext: () => ({ getImageData() {
    failures++; throw new Error('Synthetic SecurityError');
  } }) };
  for (let frame = 0; frame < 20; frame++) assert.equal(sheetForIcon(unreadable, archive, 529), unreadable);
  assert.equal(failures, 1); assert.equal(archive.reads.length, 0);
  for (const unsupported of [
    { width: 384, height: 936 },
    { width: 384, height: 936, getContext: () => null },
    { width: 384, height: 936, getContext: () => ({ getImageData: () => ({ data: [] }) }) },
  ]) assert.equal(sheetForIcon(unsupported, archive, 529), unsupported);
  const blank = sheet();
  assert.equal(sheetForIcon(blank, unreadable, 529), blank,
    'an unreadable archive cannot replace the primary with unverified artwork');
});
