// The map's background picture (parallax) round the sky. In 2D it shows wherever the map draws nothing; in VR
// there is no screen edge for it to sit behind, so on maps whose background is a view - sky, sea, space, a town
// far off - it wraps round the viewer at eye level, far away (it moves with the head, as a sky does), repeating
// round as the original loops it, with the colours of its top and bottom edge above and below; the distance fog
// takes its horizon colour so far walls fade into it. Water surfaces (the open water below) and floor pictures
// (yuka: the 遠景床 script) stay floors, pictures that are no sky (a wall, a texture - maphints.js NOT_SKY) are
// left out. Outdoor area profiles can provide an original sky when the map has
// none; indoor maps retain their safe background colour. Setting: 하늘 배경
import * as THREE from 'three';
import { G } from '../core/globals.js';
import { loadImage } from '../data/assets.js';
import { skyPicture, skyAllOver } from './maphints.js';

const R = 200;                              // m: its corners stay inside the camera's far plane
const REACH = Math.tan(40 * Math.PI / 180); // the band reaches about 40° up and down from eye level
const FOG = 0x030305;                       // the fog / background without a sky (main.js)
const FALLBACK_SKIES = new Set(['CloudySky1', 'CloudySky2', 'StarlitSky', '64380033_p2_master1200']);

// Safe sky-only portions of the original horizon panoramas. The moon/lake
// image's right-hand stars exclude its moon, flare and reflected water.
const HORIZON_CAP_CROPS = {
  月湖: [0.7, 0, 0.3, 256 / 720],
  CloudySky1: [0, 0, 1, 0.25],
  Ocean1: [0, 0, 1, 0.4],
  Ocean2: [0, 0, 1, 0.4],
  Ocean3: [0, 0, 1, 0.4],
  '47261773_p0': [0, 0, 1, 0.35],
  cr: [0.5, 0, 0.5, 0.075],
  'normandy-1827275_1280': [0, 0, 0.375, 0.24],
  'mont-st-michel-1022830_1280': [0, 0, 0.35, 0.4],
  Mountains4: [0, 0, 1, 0.3],
};

function fallbackClouds(name, img, fallback) {
  if (!fallback || name !== 'CloudySky1') return img;
  // This original panorama's lower half is a plain horizon/ground fade. Its
  // detailed upper clouds make a continuous sky without a giant flat lower band.
  const c = document.createElement('canvas');
  c.width = img.width; c.height = Math.max(1, Math.floor(img.height / 2));
  c.getContext('2d').drawImage(img, 0, 0, img.width, c.height, 0, 0, c.width, c.height);
  return c;
}

// the picture without a border line drawn round it (a black column or a few black rows at its edge): repeated or
// mirrored round the sky, that line showed as a dark seam
function trimBorders(img) {
  const W = img.width, H = img.height;
  const c0 = document.createElement('canvas');
  c0.width = W; c0.height = H;
  const x0 = c0.getContext('2d', { willReadFrequently: true });
  x0.drawImage(img, 0, 0);
  const d = x0.getImageData(0, 0, W, H).data;
  const lum = (i, j) => { const k = (j * W + i) * 4; return d[k] + d[k + 1] + d[k + 2]; };
  const col = i => { let s = 0; for (let j = 0; j < H; j++) s += lum(i, j); return s / H; };
  const row = j => { let s = 0; for (let i = 0; i < W; i++) s += lum(i, j); return s / W; };
  // how many lines at an edge are a border: much darker or brighter than the picture just inside them
  const border = (line, from, dir, max) => {
    let k = 0;
    const inner = [1, 2, 3, 4, 5].map(t => line(from + dir * (max + t))).reduce((a, b) => a + b, 0) / 5;
    while (k < max) {
      const v = line(from + dir * k);
      if (!(v < inner * 0.45 || v > inner * 1.8 + 30)) break;
      k++;
    }
    return k;
  };
  const MAX = 8;
  const l = border(col, 0, 1, MAX), r = border(col, W - 1, -1, MAX), t = border(row, 0, 1, MAX), b = border(row, H - 1, -1, MAX);
  if (!l && !r && !t && !b) return c0;
  const c = document.createElement('canvas');
  c.width = W - l - r; c.height = H - t - b;
  c.getContext('2d', { willReadFrequently: true }).drawImage(c0, l, t, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

// whether a picture meets itself across its left / right and top / bottom edges (made to loop): the mean pixel step
// across that edge against the mean step between neighbouring pixels inside
function seams(cx, W, H) {
  const d = cx.getImageData(0, 0, W, H).data;
  const at = (i, j) => (j * W + i) * 4;
  const step = (a, b) => Math.abs(d[a] - d[b]) + Math.abs(d[a + 1] - d[b + 1]) + Math.abs(d[a + 2] - d[b + 2]);
  let eh = 0, ih = 0, ev = 0, iv = 0;
  for (let j = 0; j < H; j++) { eh += step(at(W - 1, j), at(0, j)); ih += (step(at(W >> 1, j), at((W >> 1) + 1, j)) + step(at(W >> 2, j), at((W >> 2) + 1, j))) / 2; }
  for (let i = 0; i < W; i++) { ev += step(at(i, H - 1), at(i, 0)); iv += (step(at(i, H >> 1), at(i, (H >> 1) + 1)) + step(at(i, H >> 2), at(i, (H >> 2) + 1))) / 2; }
  return { seamH: eh / H < 2 * (ih / H + 1), seamV: ev / W < 2 * (iv / W + 1) };
}

export class Sky {
  constructor(scene, { imageLoader = loadImage } = {}) {
    this.scene = scene;
    this.imageLoader = imageLoader;
    this.group = null;
    this.name = '';
    this.token = 0;
    this.offset = 0;
    this.fallback = { background: FOG, fogColor: FOG, fallbackSky: '' };
    this.horizon = null;
    this.isFallback = false;
  }
  // the picture this map shows round its sky ('' none)
  wanted(map) {
    if (G.settings?.sky === false) return '';
    const name = map?.parallax_name || '';
    if (!name || !map.parallax_show || /^yuka/i.test(name)) return '';
    // This original panorama shows a moon above the lake, not a water floor.
    if (name !== '月湖' && /water|sea|river|lake|海|水|川|湖/i.test(name)) return '';
    if (!skyPicture(name)) return '';            // (a wall, a texture, a thing: no sky - maphints.js)
    return name;
  }
  async setMap(map, { background = FOG, fogColor = background, fallbackSky = '' } = {}) {
    const authored = this.wanted(map);
    const name = authored || (G.settings?.sky !== false && FALLBACK_SKIES.has(fallbackSky) ? fallbackSky : '');
    const isFallback = !!name && !authored;
    this.fallback = { background, fogColor, fallbackSky };
    if (name && name === this.name && this.group && this.isFallback === isFallback) {
      this.scene.fog?.color.copy(this.horizon);
      this.scene.background = this.horizon.clone();
      return;
    }
    this.clear();
    this.fallback = { background, fogColor, fallbackSky };
    this.scene.fog?.color.set(fogColor);
    this.scene.background = new THREE.Color(background);
    if (!name) return;
    const token = ++this.token;
    const img = await this.imageLoader('Graphics/Parallaxes', name).catch(() => null);
    if (token !== this.token || !img) return;
    this.build(name, img, { fallback: isFallback });
  }
  refresh() { const m = G.map?.map, fallback = this.fallback; this.clear(); if (m) return this.setMap(m, fallback); }
  build(name, img, { fallback = false } = {}) {
    const cv = trimBorders(fallbackClouds(name, img, fallback));
    this.isFallback = fallback;
    const W = cv.width, H = cv.height;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    const avg = (x0, y0, w, h) => {
      const d = cx.getImageData(x0, Math.max(0, y0), Math.max(1, w), Math.max(1, h)).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      return [r / n, g / n, b / n];
    };
    const color = c => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
    // (RTP's sea views put the horizon a little under the middle)
    const horizon = /ocean/i.test(name) ? 0.44 : 0.5;
    const edge = Math.max(1, Math.round(H * 0.03));
    const top = color(avg(0, 0, W, edge)), bottom = color(avg(0, H - edge, W, edge));
    const hor = color(avg(0, Math.round(H * (1 - horizon)) - 2, W, 4));
    // a picture made to loop runs on round; one whose ends do not meet goes on mirrored (an even number of times,
    // so it meets itself again behind)
    const { seamH, seamV } = seams(cx, W, H);
    let n = Math.max(2, Math.round(2 * Math.PI / (2 * REACH) * H / W));
    if (!seamH && n % 2) n++;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = seamH ? THREE.RepeatWrapping : THREE.MirroredRepeatWrapping;
    tex.repeat.set(n, 1);
    tex.anisotropy = 4;
    if (fallback || skyAllOver(name)) { this.buildDome(name, cv, tex, seamH, seamV, avg, color); return; }
    const bandH = 2 * Math.PI * R / n * H / W;
    const bandGeo = new THREE.CylinderGeometry(R, R, bandH, 160, 1, true);
    bandGeo.scale(-1, 1, 1);                   // seen from inside, the right way round
    const band = new THREE.Mesh(bandGeo, new THREE.MeshBasicMaterial({ map: tex, fog: false, depthWrite: false }));
    const fillGeo = new THREE.SphereGeometry(R * 1.04, 48, 24);
    const cols = [], pos = fillGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const c = pos.getY(i) > 0 ? top : bottom; cols.push(c.r, c.g, c.b); }
    fillGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    fill.renderOrder = -10; band.renderOrder = -9;
    const cap = this.horizonCap(name, cv, bandH, n);
    for (const m of [fill, band, cap].filter(Boolean)) m.frustumCulled = false;
    this.group = new THREE.Group();
    this.group.name = 'sky';
    this.group.add(fill, band);
    if (cap) this.group.add(cap);
    this.scene.add(this.group);
    this.offset = bandH * (0.5 - horizon);    // the horizon row at eye level
    this.name = name;
    this.horizon = hor.clone();
    this.scene.fog?.color.copy(hor);
    this.scene.background = hor.clone();
    this.update();
  }
  horizonCap(name, image, bandH, repeats) {
    const crop = HORIZON_CAP_CROPS[name];
    if (!crop) return null;
    const [x, y, w, h] = crop, cv = document.createElement('canvas');
    const sx = Math.round(image.width * x), sy = Math.round(image.height * y);
    cv.width = Math.max(1, Math.round(image.width * w)); cv.height = Math.max(1, Math.round(image.height * h));
    cv.getContext('2d').drawImage(image, sx, sy, cv.width, cv.height, 0, 0, cv.width, cv.height);
    const texture = new THREE.CanvasTexture(cv);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping;
    texture.anisotropy = 4;
    const edge = Math.atan2(bandH / 2, R);
    const start = Math.max(0, edge - 12 * Math.PI / 180), end = Math.max(start + 0.01, edge - 2 * Math.PI / 180);
    const geometry = new THREE.SphereGeometry(R * 0.999, 128, 48, 0, 2 * Math.PI, 0, Math.PI / 2 - start);
    geometry.scale(-1, 1, 1);
    const pos = geometry.attributes.position, uv = geometry.attributes.uv, rgba = [];
    const tileU = Math.max(0.7, 2 * Math.PI / repeats * cv.width / image.width), tileV = Math.max(0.7, bandH / R * cv.height / image.height);
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i), radius = Math.hypot(px, pz);
      const angle = Math.atan2(radius, py), elevation = Math.PI / 2 - angle;
      const u = radius > 1e-6 ? angle * px / radius : 0, v = radius > 1e-6 ? angle * pz / radius : 0;
      uv.setXY(i, 0.5 + u / tileU, 0.5 + v / tileV);
      rgba.push(1, 1, 1, THREE.MathUtils.smoothstep(elevation, start, end));
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(rgba, 4));
    const cap = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture, vertexColors: true,
      transparent: true, fog: false, depthWrite: false }));
    cap.name = 'horizon-sky-cap'; cap.renderOrder = -8;
    return cap;
  }
  // a picture that is the whole background (a sky, space, a texture): all over the sky. Round the horizon it lies
  // as on a globe; over the head (and under the feet) flat round the pole instead, so it does not crowd into a
  // point there - the two crossfade between 40° and 58°. A picture made to loop is tiled at about the size it has
  // round the horizon; one whose edges do not meet is drawn big, one copy over the head (centred there) and one
  // tall enough round the horizon, so its mirrored edges stay out of sight
  buildDome(name, cv, tex, seamH, seamV, avg, color) {
    const W = cv.width, H = cv.height;
    const E0 = 40 * Math.PI / 180, E1 = 58 * Math.PI / 180, NEED = 2 * 62 * Math.PI / 180;
    let n = Math.max(1, Math.round(2 * Math.PI / (2 * REACH) * H / W));
    if (!seamV) n = Math.max(1, Math.floor(2 * Math.PI * H / W / NEED));   // (no top / bottom edge in sight)
    if (!seamH && n % 2) n = n > 1 ? n - 1 : 2;                        // (mirrored: an even number round)
    const tileU = 2 * Math.PI / n, tileV = Math.max(tileU * H / W, seamV ? 0 : NEED);
    tex.wrapT = seamV ? THREE.RepeatWrapping : THREE.MirroredRepeatWrapping;
    tex.repeat.set(1, 1);
    const mat = alpha => new THREE.MeshBasicMaterial({ map: tex, fog: false, depthWrite: false, vertexColors: alpha, transparent: alpha });
    // round the horizon
    const bandGeo = new THREE.SphereGeometry(R, 128, 48, 0, 2 * Math.PI, Math.PI / 2 - E1, 2 * E1);
    bandGeo.scale(-1, 1, 1);
    {
      const pos = bandGeo.attributes.position, uv = bandGeo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * n, 0.5 + Math.asin(THREE.MathUtils.clamp(pos.getY(i) / R, -1, 1)) / tileV);
    }
    const band = new THREE.Mesh(bandGeo, mat(false));
    // over the head and under the feet: flat round the pole (azimuthal), coming in over the band
    const cap = up => {
      const g = new THREE.SphereGeometry(R * 0.999, 128, 32, 0, 2 * Math.PI, up ? 0 : Math.PI / 2 + E0, Math.PI / 2 - E0);
      g.scale(-1, 1, 1);
      const pos = g.attributes.position, uv = g.attributes.uv, rgba = [];
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const e = Math.asin(THREE.MathUtils.clamp(Math.abs(y) / R, 0, 1)), d = Math.PI / 2 - e, rho = Math.hypot(x, z);
        const px = rho > 1e-6 ? d * x / rho : 0, pz = rho > 1e-6 ? d * z / rho : 0;
        uv.setXY(i, 0.5 + px / tileU, 0.5 + pz / tileV);
        rgba.push(1, 1, 1, THREE.MathUtils.smoothstep(e, E0, E1));
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(rgba, 4));
      return new THREE.Mesh(g, mat(true));
    };
    const top = cap(true), bottom = cap(false);
    const all = color(avg(0, 0, W, H));
    const fill = new THREE.Mesh(new THREE.SphereGeometry(R * 1.04, 32, 16), new THREE.MeshBasicMaterial({ color: all, side: THREE.BackSide, fog: false, depthWrite: false }));
    fill.renderOrder = -10; band.renderOrder = -9; top.renderOrder = bottom.renderOrder = -8;
    for (const m of [fill, band, top, bottom]) m.frustumCulled = false;
    this.group = new THREE.Group();
    this.group.name = 'sky';
    this.group.add(fill, band, top, bottom);
    this.scene.add(this.group);
    this.offset = 0;
    this.name = name;
    this.horizon = all.clone();
    this.scene.fog?.color.copy(all);
    this.scene.background = all.clone();
    this.update();
  }
  clear() {
    this.token++;
    if (this.group) {
      this.scene.remove(this.group);
      const geometries = new Set(), textures = new Set(), materials = new Set();
      this.group.traverse(o => { if (o.isMesh) { geometries.add(o.geometry); materials.add(o.material); if (o.material.map) textures.add(o.material.map); } });
      for (const geometry of geometries) geometry.dispose();
      for (const texture of textures) texture.dispose();
      for (const material of materials) material.dispose();
      this.group = null;
    }
    this.name = '';
    this.fallback = { background: FOG, fogColor: FOG, fallbackSky: '' };
    this.horizon = null;
    this.isFallback = false;
    this.scene.fog?.color.setHex(FOG);
    this.scene.background = new THREE.Color(FOG);
  }
  // every frame: round the head
  update() {
    if (!this.group) return;
    const h = G.player?.headWorld ? G.player.headWorld(this.group.position) : null;
    if (h) this.group.position.y += this.offset;
  }
}
