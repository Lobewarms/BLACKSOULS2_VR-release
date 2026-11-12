// What the stages of building a map (mapgen/*.js, run by mapmesh.js buildMapMesh) share: the tile's size in the world, the
// texture atlas tiles are composited onto, the geometry accumulator, the billboard material, the tileset's images.
import * as THREE from 'three';
import { TS } from '../tiles.js';
import { loadImage } from '../assets.js';

export const T = 1.5; // meters per tile

// ---------------------------------------------------------------------------
// Texture atlas of composited 32x32 tiles (with extruded padding for mipmaps)
// ---------------------------------------------------------------------------
export const PAD = 8;
export const SLOT = TS + PAD * 2;

export class Atlas {
  constructor(frames = 1) {
    this.frames = frames;
    this.index = new Map();
    this.draws = [];
  }
  request(key, drawFn) {
    let i = this.index.get(key);
    if (i === undefined) {
      i = this.draws.length;
      this.index.set(key, i);
      this.draws.push(drawFn);
    }
    return i;
  }
  build() {
    const n = Math.max(1, this.draws.length);
    this.cols = Math.ceil(Math.sqrt(n));
    this.rows = Math.ceil(n / this.cols);
    this.regionW = this.cols * SLOT;
    const c = document.createElement('canvas');
    c.width = this.regionW * this.frames;
    c.height = this.rows * SLOT;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    // each tile is drawn and its edges extruded into the padding on a small canvas, then copied in once
    // (copying a big canvas onto itself is slow, and the atlas of a large map is big)
    const slot = document.createElement('canvas');
    slot.width = SLOT; slot.height = SLOT;
    const sctx = slot.getContext('2d');
    sctx.imageSmoothingEnabled = false;
    for (let f = 0; f < this.frames; f++) {
      this.draws.forEach((fn, i) => {
        sctx.clearRect(0, 0, SLOT, SLOT);
        fn(sctx, PAD, PAD, f);
        sctx.drawImage(slot, PAD, PAD, 1, TS, 0, PAD, PAD, TS);
        sctx.drawImage(slot, PAD + TS - 1, PAD, 1, TS, PAD + TS, PAD, PAD, TS);
        sctx.drawImage(slot, 0, PAD, SLOT, 1, 0, 0, SLOT, PAD);
        sctx.drawImage(slot, 0, PAD + TS - 1, SLOT, 1, 0, PAD + TS, SLOT, PAD);
        ctx.drawImage(slot, f * this.regionW + (i % this.cols) * SLOT, Math.floor(i / this.cols) * SLOT);
      });
    }
    this.canvas = c;
    this.W = c.width; this.H = c.height;
    return c;
  }
  // [u0, vTop, u1, vBottom] (flipY texture coordinates) for frame 0
  uv(i, x0 = 0, y0 = 0, x1 = TS, y1 = TS) {
    const px = (i % this.cols) * SLOT + PAD;
    const py = Math.floor(i / this.cols) * SLOT + PAD;
    return [(px + x0) / this.W, 1 - (py + y0) / this.H, (px + x1) / this.W, 1 - (py + y1) / this.H];
  }
}

// ---------------------------------------------------------------------------
// Geometry accumulator
// ---------------------------------------------------------------------------
export class GeoBuf {
  constructor(billboard = false) {
    this.pos = []; this.uv = []; this.col = []; this.nrm = []; this.idx = [];
    this.center = billboard ? [] : null;
    this.n = 0;
  }
  // corners: [[x,y,z] x4] in order TL, BL, BR, TR as seen from the front
  quad(c, uv, shade = [1, 1, 1, 1], normal = [0, 1, 0], center = null) {
    const [u0, vt, u1, vb] = uv;
    const uvs = [[u0, vt], [u0, vb], [u1, vb], [u1, vt]];
    for (let k = 0; k < 4; k++) {
      this.pos.push(c[k][0], c[k][1], c[k][2]);
      this.uv.push(uvs[k][0], uvs[k][1]);
      const s = shade[k];
      this.col.push(s, s, s);
      this.nrm.push(normal[0], normal[1], normal[2]);
      if (this.center) this.center.push(center[0], center[1], center[2]);
    }
    const n = this.n;
    this.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    this.n += 4;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    if (this.center) g.setAttribute('center', new THREE.Float32BufferAttribute(this.center, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// Shared uniform: viewer (head) position for cylindrical billboards
export const billboardUniforms = { uViewer: { value: new THREE.Vector3() } };

export function makeBillboardMaterial(params) {
  const mat = new THREE.MeshLambertMaterial(params);
  mat.onBeforeCompile = shader => {
    shader.uniforms.uViewer = billboardUniforms.uViewer;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 center;
        uniform vec3 uViewer;`)
      .replace('#include <beginnormal_vertex>', `
        vec2 bbDir = uViewer.xz - (modelMatrix * vec4(center, 1.0)).xz;   // (where the map stands: a looping map moves it)
        float bbLen = length(bbDir);
        bbDir = bbLen > 0.0001 ? bbDir / bbLen : vec2(0.0, 1.0);
        vec3 objectNormal = vec3(bbDir.x, 0.0, bbDir.y);`)
      .replace('#include <begin_vertex>', `
        vec3 bbRight = vec3(bbDir.y, 0.0, -bbDir.x);
        vec3 transformed = center + bbRight * position.x + vec3(0.0, position.y, 0.0);`);
  };
  mat.customProgramCacheKey = () => 'billboard';
  return mat;
}

// ---------------------------------------------------------------------------
// Map building
// ---------------------------------------------------------------------------
export const DIRS = { S: [0, 1], N: [0, -1], E: [1, 0], W: [-1, 0] };

export async function loadTilesetImages(tileset) {
  return Promise.all(tileset.tileset_names.map(n => (n ? loadImage('Graphics/Tilesets', n) : null)));
}
