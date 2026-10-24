// Asset lookup / loading from the original game folder (served under /game/).
import * as THREE from 'three';

let manifest = null;          // lowercased "Folder/Name.ext" -> real path
const byStem = new Map();      // lowercased "Folder/Name" -> [real paths]
const imageCache = new Map();
const canvasCache = new Map();
const missing = new Set();

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.bmp', '.gif'];
const AUDIO_EXT = ['.ogg', '.m4a', '.mp3', '.wav'];

// Share pending/successful loads, but allow the next request to retry a failure.
function cachedAsset(cache, key, load) {
  if (cache.has(key)) return cache.get(key);
  const forget = () => { if (cache.get(key) === pending) cache.delete(key); };
  const pending = Promise.resolve().then(load).then(value => {
    if (value == null) forget();
    return value;
  }, error => { forget(); throw error; });
  cache.set(key, pending);
  return pending;
}

export async function initAssets() {
  const res = await fetch('/api/manifest');
  const { files, rtp = [] } = await res.json();
  manifest = new Map();
  const add = (key, value) => {
    const lower = key.toLowerCase();
    if (manifest.has(lower)) return;
    manifest.set(lower, value);
    const stem = lower.replace(/\.[^./]+$/, '');
    if (!byStem.has(stem)) byStem.set(stem, []);
    byStem.get(stem).push(value);
  };
  for (const f of files) add(f, f);
  // RTP files fill in whatever the game folder does not ship (game files take priority)
  const gameStems = new Set(files.map(f => f.toLowerCase().replace(/\.[^./]+$/, '')));
  for (const f of rtp) {
    if (gameStems.has(f.toLowerCase().replace(/\.[^./]+$/, ''))) continue;
    add(f, 'rtp:' + f);
  }
  return files;
}

export function gameUrl(path) {
  if (path.startsWith('rtp:')) return '/rtp/' + path.slice(4).split('/').map(encodeURIComponent).join('/');
  return '/game/' + path.split('/').map(encodeURIComponent).join('/');
}

export function hasFile(path) {
  return manifest.has(path.toLowerCase());
}

export function listFiles(prefix) {
  const p = prefix.toLowerCase();
  const out = [];
  for (const [k, v] of manifest || []) if (k.startsWith(p)) out.push(v);
  return out;
}

// Resolve "Graphics/Characters", "$hero" -> real file path (or null)
export function resolve(folder, name, exts) {
  if (!name) return null;
  const key = `${folder}/${name}`.toLowerCase();
  if (manifest.has(key)) return manifest.get(key);
  const cands = byStem.get(key);
  if (!cands) return null;
  for (const e of exts) {
    const hit = cands.find(c => c.toLowerCase().endsWith(e));
    if (hit) return hit;
  }
  return cands[0];
}

export const resolveImage = (folder, name) => resolve(folder, name, IMAGE_EXT);
export const resolveAudio = (folder, name) => resolve(folder, name, AUDIO_EXT);

export function loadImage(folder, name) {
  const path = resolveImage(folder, name);
  if (!path) {
    const k = `${folder}/${name}`;
    if (name && !missing.has(k)) { missing.add(k); console.warn('missing image', k); }
    return Promise.resolve(null);
  }
  return cachedAsset(imageCache, path, () => new Promise(resolveP => {
    const img = new Image();
    img.onload = () => resolveP(img);
    img.onerror = () => { console.warn('failed image', path); resolveP(null); };
    img.src = gameUrl(path);
  }));
}

// Canvas copy of an image, optionally hue-rotated (RPG Maker battler hue).
export async function loadCanvas(folder, name, hue = 0) {
  const key = `${folder}/${name}#${hue}`;
  return cachedAsset(canvasCache, key, () => loadImage(folder, name).then(img => {
    if (!img) return null;
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    if (hue % 360) rotateHue(c, hue);
    return c;
  }));
}

function rotateHue(canvas, offset) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = d.data;
  offset = ((offset % 360) + 360) % 360;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const cmin = Math.min(r, g, b), cmax = Math.max(r, g, b);
    const l = (cmin + cmax) / 2, delta = cmax - cmin;
    if (delta <= 0) continue;
    let h;
    if (r === cmax) h = 60 * (((g - b) / delta + 6) % 6);
    else if (g === cmax) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
    const s = delta / (255 - Math.abs(2 * l - 255));
    h = (h + offset) % 360;
    const c = (255 - Math.abs(2 * l - 255)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2, cm = c + m, xm = x + m;
    let rgb;
    if (h < 60) rgb = [cm, xm, m];
    else if (h < 120) rgb = [xm, cm, m];
    else if (h < 180) rgb = [m, cm, xm];
    else if (h < 240) rgb = [m, xm, cm];
    else if (h < 300) rgb = [xm, m, cm];
    else rgb = [cm, m, xm];
    px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2];
  }
  ctx.putImageData(d, 0, 0);
}

// Pixel-art friendly texture
export function pixelTexture(source, { mipmaps = true } = {}) {
  const tex = new THREE.CanvasTexture(source);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.generateMipmaps = mipmaps;
  tex.anisotropy = 8;
  return tex;
}

export async function loadFont(name, file) {
  const path = resolve('Fonts', file, ['.ttf', '.otf']);
  if (!path) return false;
  try {
    const face = new FontFace(name, `url(${gameUrl(path)})`);
    await face.load();
    document.fonts.add(face);
    return true;
  } catch (e) {
    console.warn('font load failed', e);
    return false;
  }
}

export async function fetchBinary(path) {
  const res = await fetch(gameUrl(path));
  if (!res.ok) throw new Error(`fetch failed ${path}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
