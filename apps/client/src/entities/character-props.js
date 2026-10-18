import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { voxelGeometryOf } from '../combat/weapons.js';

const sheetName = ch => String(ch.characterName || '').replace(/^[!$]+/, '');
const frameCache = new WeakMap();

// These exact frames were checked against the original Torture Chambers art.
// Adjacent columns contain hanging shackles, cupboards and upright instruments.
export function characterPropProfile(ch) {
  if (!ch.isEvent || ch.tileId > 0) return null;
  const name = sheetName(ch), index = ch.characterIndex || 0, pattern = ch.pattern < 3 ? ch.pattern : 1;
  if (name === 'Map1_c' && index === 0 && pattern === 1) return { kind: 'table', height: 0.65 };
  if (name === 'Map1_b' && [0, 1].includes(index) && [6, 8].includes(ch.direction)) return { kind: 'table', height: 0.55 };
  if ((name === 'Map1_b' && [0, 1, 4, 6].includes(index) || name === '三角木馬')
    && !ch.stepAnime && !ch.moveType) return { kind: 'grounded' };
  return null;
}

export function characterPropFrame(ch, canvas, info) {
  let cache = frameCache.get(canvas);
  if (!cache) { cache = new Map(); frameCache.set(canvas, cache); }
  const row = Math.max(0, Math.min(3, (ch.direction - 2) / 2)), pattern = ch.pattern < 3 ? ch.pattern : 1;
  const key = `${ch.characterIndex || 0}/${row}/${pattern}`;
  if (cache.has(key)) return cache.get(key);
  const bx = info.single ? 0 : (ch.characterIndex % 4) * 3, by = info.single ? 0 : Math.floor(ch.characterIndex / 4) * 4;
  const x = (bx + pattern) * info.fw, y = (by + row) * info.fh;
  let frame = null;
  try {
    const pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, info.fw, info.fh).data;
    let left = info.fw, right = 0, top = info.fh, bottom = 0;
    for (let py = 0; py < info.fh; py++) for (let px = 0; px < info.fw; px++) {
      if (pixels[(py * info.fw + px) * 4 + 3] <= 100) continue;
      left = Math.min(left, px); right = Math.max(right, px + 1); top = Math.min(top, py); bottom = Math.max(bottom, py + 1);
    }
    if (right > left && bottom > top) frame = { pixels, x, y, width: info.fw, height: info.fh, left, right, top, bottom };
  } catch { /* An unreadable asset keeps its existing presentation. */ }
  cache.set(key, frame); return frame;
}

export function characterTableGeometry(frame, height, unit) {
  if (!frame) return null;
  const w = frame.right - frame.left, h = frame.bottom - frame.top, pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) pixels.set(frame.pixels.subarray(((y + frame.top) * frame.width + frame.left) * 4,
    ((y + frame.top) * frame.width + frame.right) * 4), y * w * 4);
  const thickness = 2.2 * unit, top = voxelGeometryOf(pixels, w, h, 2.2);
  if (!top) return null;
  top.rotateX(-Math.PI / 2).scale(unit, unit, unit).translate(0, height, 0);
  const parts = [top], color = new THREE.Color();
  const sample = pixels.findIndex((value, i) => i % 4 === 3 && value > 100) - 3;
  color.setRGB(pixels[sample] / 255, pixels[sample + 1] / 255, pixels[sample + 2] / 255, THREE.SRGBColorSpace).multiplyScalar(0.7);
  const legHeight = height - thickness / 2, legWidth = Math.min(0.11, w * unit / 6);
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const leg = new THREE.BoxGeometry(legWidth, legHeight, legWidth); leg.deleteAttribute('uv');
    const colors = Array.from({ length: leg.getAttribute('position').count }, () => color.toArray()).flat();
    leg.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    leg.translate(x * Math.max(0, w * unit / 2 - legWidth), legHeight / 2, z * Math.max(0, h * unit / 2 - legWidth));
    parts.push(leg);
  }
  const geometry = mergeGeometries(parts); parts.forEach(part => part.dispose());
  geometry.userData = { source: 'character-prop-frame', frame: [frame.x, frame.y, frame.width, frame.height], supportHeight: height };
  return geometry;
}
