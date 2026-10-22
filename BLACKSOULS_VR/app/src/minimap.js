// The map in a corner (setting 지도 - on until the player turns it off): in 3D where one is is hard to tell, so the
// original's own tiles round the player, with an arrow where the player stands and looks, in the original's window
// (rmwindow.js) - round (as it starts), or square. Turned with the view (as it starts), the player stays in its middle; north up it
// goes as the original's screen: it follows the player, but stops at the map's edges, where the player alone moves on
// (Game_Map#set_display_pos; a map smaller than it stays in its middle; a looping map goes on round). PC: a corner of
// the screen; VR: of the view, in front of everything. Its shape, turning, place, size, opacity and how much it shows
// are the player's (menu → 설정 → 지도). Hidden while an event, a message or a menu holds the player - but in its own
// menu, where it shows what the settings do.
import * as THREE from 'three';
import { G } from './globals.js';
import { render2D, loadTilesetImages } from './mapmesh.js';
import { loadImage } from './assets.js';
import { TS, TileDrawer } from './tiles.js';
import { drawWindow } from './rmwindow.js';

const PX = 320;                            // its canvas, square
const S = PX / 160;                        // canvas pixels per original pixel (a window of 160 x 160)
const INSET = 10;                          // the map inside the window's frame (original pixels)
export const MINIMAP_ZOOMS = [9, 13, 17, 25];     // tiles across (the original's screen showed 17 x 13)
export const MINIMAP_DEFAULTS = { size: 0.25, x: 1, y: 1, zoom: 2, opacity: 1, shape: 'round', rotate: true };
const REFRESH = 1 / 20;                    // s between redraws

export function minimapPlace() {
  const p = { ...MINIMAP_DEFAULTS, ...(G.settings.minimapPlace || {}) };
  const clamp = THREE.MathUtils.clamp;
  p.size = clamp(+p.size || MINIMAP_DEFAULTS.size, 0.15, 0.6);
  p.x = clamp(+p.x, -1, 1); p.y = clamp(+p.y, -1, 1);
  p.zoom = clamp(p.zoom | 0, 0, MINIMAP_ZOOMS.length - 1);
  p.opacity = clamp(+p.opacity || MINIMAP_DEFAULTS.opacity, 0.2, 1);
  p.shape = p.shape === 'square' ? 'square' : 'round';
  p.rotate = p.rotate !== false;
  return p;
}

export class Minimap {
  constructor(camera) {
    this.camera = camera;
    const c = this.canvas = document.createElement('canvas');
    c.width = c.height = PX;
    this.ctx = c.getContext('2d');
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
    this.mesh.renderOrder = 3000;          // (over the world and the screen's tone, under the menus' panels: 3100)
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    camera.add(this.mesh);
    this.mapId = -1; this.picture = null; this.drawer = null; this.scale = 0.5; this.token = 0;
    this.wait = 0;
    this.preview = false;                  // (its menu is open: shown over the menu)
  }
  hide() { this.mesh.visible = false; }
  // the map's own picture: its tiles at 16 pixels a tile (8 on a big map), over its floor picture (遠景床: tiled from the
  // corner, as the game lays it) or a picture that loops under it (the sea round a ship)
  async build() {
    const m = G.map, grid = m.grid, map = m.map;
    const token = ++this.token;
    this.mapId = m.mapId; this.picture = null; this.drawer = null;
    const scale = Math.max(8, Math.min(16, Math.floor(2048 / Math.max(grid.w, grid.h)))) / TS;
    const tiles = await render2D(grid, scale);
    const name = map.parallax_show ? map.parallax_name || '' : '';
    const under = name && (/^yuka/i.test(name) || map.parallax_loop_x || map.parallax_loop_y) ? await loadImage('Graphics/Parallaxes', name).catch(() => null) : null;
    const drawer = new TileDrawer(await loadTilesetImages(grid.tileset), grid.flags);
    if (token !== this.token) return;
    const c = document.createElement('canvas');
    c.width = tiles.width; c.height = tiles.height;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
    if (under) {
      const w = under.width * scale, h = under.height * scale;
      for (let y = 0; y < c.height; y += h) for (let x = 0; x < c.width; x += w) g.drawImage(under, x, y, w, h);
    }
    g.drawImage(tiles, 0, 0);
    this.picture = c; this.drawer = drawer; this.scale = scale;
    this.wait = 0;
  }
  // whether it shows now: turned on, in the game, the player free to move (or its own menu open)
  wanted() {
    const m = G.map, ui = G.ui;
    if (G.settings.minimap === false || !G.state || !m?.grid) return false;
    if (this.preview) return true;
    if (m.transferring || ui.messageBusy() || ui.menuOpen || ui.sceneOpen || ui.prompt?.shown) return false;
    if (m.playerChar.moveRouteForcing || G.combat?.playerDead) return false;
    if (m.interpreter.running() && m.interpreter.waitMode !== 'battle') return false;
    return true;
  }
  update(dt, inGame) {
    if (!inGame || !this.wanted()) { this.hide(); return; }
    const m = G.map;
    if (m.mapId !== this.mapId) this.build().catch(e => console.warn('[minimap]', e));
    if (!this.picture) { this.hide(); return; }
    const p = minimapPlace();
    this.place(p);
    this.mesh.material.opacity = p.opacity;
    this.mesh.visible = true;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = REFRESH;
    this.draw(p);
  }
  // PC: in the screen's corner (a share of its height, its x / y from -1 left / bottom to 1 right / top); VR: as far to
  // the side as a share of the view, a metre off, turned to the eyes
  place(p) {
    const mesh = this.mesh;
    if (!G.vr) {
      const cam = this.camera, d = 0.5;
      const h = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * d, w = h * cam.aspect, size = p.size * h, gap = 0.025 * h;
      mesh.scale.setScalar(size);
      mesh.position.set(p.x * (w / 2 - size / 2 - gap), p.y * (h / 2 - size / 2 - gap), -d);
      mesh.quaternion.identity();
    } else {
      const d = 1.0, size = p.size * 0.6;
      mesh.scale.setScalar(size);
      mesh.position.set(d * Math.tan(THREE.MathUtils.degToRad(p.x * 30)), d * Math.tan(THREE.MathUtils.degToRad(p.y * 24)), -d);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), mesh.position.clone().negate().normalize());
    }
  }
  // where on the map its middle is (in tiles): the player - or, north up, the original's screen's way at the edges
  centre(p, across, cx, cy) {
    const m = G.map, half = across / 2;
    if (p.rotate) return [cx, cy];
    const axis = (c, size, loop) => (loop ? c : size <= across ? size / 2 : THREE.MathUtils.clamp(c, half, size - half));
    return [axis(cx, m.grid.w, m.loopX), axis(cy, m.grid.h, m.loopY)];
  }
  draw(p = minimapPlace()) {
    const { ctx } = this, m = G.map, pc = m.playerChar;
    const round = p.shape === 'round', mid = PX / 2, inner = 80 - INSET;
    ctx.clearRect(0, 0, PX, PX);
    // the window: square as the original's, or round (its background inside a ring)
    if (round) {
      ctx.save();
      ctx.beginPath(); ctx.arc(mid, mid, mid - 1, 0, Math.PI * 2); ctx.clip();
      drawWindow(ctx, S, -16, -16, 192, 192);
      ctx.restore();
    } else drawWindow(ctx, S, 0, 0, 160, 160);
    const across = MINIMAP_ZOOMS[p.zoom], ppt = inner * 2 * S / across, src = TS * this.scale;
    // the player's continuous place (the middle of a cell is a whole number); the view's middle
    const cx = pc.fx + 0.5, cy = pc.fy + 0.5;
    const [vx, vy] = this.centre(p, across, cx, cy);
    const f = G.player?.forward2D?.() || { x: 0, z: 1 };
    const look = Math.atan2(f.z, f.x);
    ctx.save();
    ctx.beginPath();
    if (round) ctx.arc(mid, mid, inner * S, 0, Math.PI * 2);
    else ctx.rect(mid - inner * S, mid - inner * S, inner * 2 * S, inner * 2 * S);
    ctx.clip();
    ctx.fillStyle = '#000'; ctx.fill();
    ctx.translate(mid, mid);
    if (p.rotate) ctx.rotate(-Math.PI / 2 - look);      // (where the view looks: up)
    ctx.imageSmoothingEnabled = ppt < src;
    const mw = m.grid.w, mh = m.grid.h;
    // (a looping map goes on round its edges)
    for (const i of m.loopX ? [-1, 0, 1] : [0]) for (const j of m.loopY ? [-1, 0, 1] : [0]) {
      ctx.drawImage(this.picture, (i * mw - vx) * ppt, (j * mh - vy) * ppt, mw * ppt, mh * ppt);
    }
    // events drawn with a tile (a door, a chest, a lever's bridge - as their page is now)
    const reach = across * 0.75 + 1;
    for (const ev of m.eventList) {
      const id = ev.page?.graphic?.tile_id;
      if (!id || ev.erased || !this.drawer) continue;
      const ex = (ev.realX ?? ev.x) - vx, ey = (ev.realY ?? ev.y) - vy;
      if (Math.abs(ex) > reach || Math.abs(ey) > reach) continue;
      ctx.save();
      ctx.translate(ex * ppt, ey * ppt);
      ctx.scale(ppt / TS, ppt / TS);
      this.drawer.draw(ctx, id, 0, 0);
      ctx.restore();
    }
    // the player: an arrow where the view looks (turned with the map, it points up)
    const r = Math.max(7, ppt * 0.55);
    ctx.translate((cx - vx) * ppt, (cy - vy) * ppt);
    ctx.rotate(look);
    ctx.beginPath();
    ctx.moveTo(r, 0); ctx.lineTo(-r * 0.7, r * 0.65); ctx.lineTo(-r * 0.35, 0); ctx.lineTo(-r * 0.7, -r * 0.65); ctx.closePath();
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.stroke();
    ctx.restore();
    // a round one's rim: the frame's colours as a ring
    if (round) {
      ctx.save();
      ctx.beginPath(); ctx.arc(mid, mid, inner * S + 3, 0, Math.PI * 2);
      ctx.lineWidth = 6; ctx.strokeStyle = this.rimColour(); ctx.stroke();
      ctx.beginPath(); ctx.arc(mid, mid, inner * S, 0, Math.PI * 2);
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
      ctx.restore();
    }
    this.tex.needsUpdate = true;
  }
  // the window skin's frame colour - the brightest down the middle of its top edge -, for a round map's rim
  rimColour() {
    if (this.rim) return this.rim;
    const c = document.createElement('canvas');
    c.width = c.height = 160;
    const g = c.getContext('2d', { willReadFrequently: true });
    drawWindow(g, 1, 0, 0, 160, 160, { backOpacity: 0 });
    const d = g.getImageData(80, 0, 1, 16).data;
    let best = null, lum = -1;
    for (let k = 0; k < d.length; k += 4) {
      const l = d[k] * 0.299 + d[k + 1] * 0.587 + d[k + 2] * 0.114;
      if (d[k + 3] > 200 && l > lum) { lum = l; best = `rgb(${d[k]},${d[k + 1]},${d[k + 2]})`; }
    }
    this.rim = best || 'rgb(200,120,170)';
    return this.rim;
  }
}
