// Read-only overview of the current area's collision grid and analysed exits.
import { G } from '../core/globals.js';
import { destinationName } from '../data/data.js';
import { tr } from './i18n.js';
import { fitLabel } from './battler-status.js';
import { TS } from '../world/tiles.js';
import { drawGameWindow } from './window-skin.js';

const wrap = (n, size) => ((n % size) + size) % size;
export function mapPosition(map) {
  const p = map.playerChar, { w, h } = map.grid;
  const x = Number.isFinite(p.fx) ? p.fx : p.x;
  const y = Number.isFinite(p.fy) ? p.fy : p.y;
  return { x: map.loopX ? wrap(x + 0.5, w) - 0.5 : Math.max(0, Math.min(w - 1, x)),
    y: map.loopY ? wrap(y + 0.5, h) - 0.5 : Math.max(0, Math.min(h - 1, y)) };
}

// Map coordinates use tile centres; raster coordinates use tile edges.
export function mapProjection(map, rect, full = false) {
  const p = mapPosition(map), { w, h } = map.grid;
  const cols = full ? w : Math.min(21, w), rows = full ? h : Math.min(21, h);
  const scale = Math.min(rect.w / cols, rect.h / rows);
  const origin = (v, size, span, loop) => full ? 0 : loop ? v + 0.5 - span / 2 : Math.max(0, Math.min(size - span, v + 0.5 - span / 2));
  const x = origin(p.x, w, cols, map.loopX), y = origin(p.y, h, rows, map.loopY);
  const left = rect.x + (rect.w - cols * scale) / 2, top = rect.y + (rect.h - rows * scale) / 2;
  return { x, y, cols, rows, scale, left, top, width: cols * scale, height: rows * scale,
    point(px, py) {
      if (!full && map.loopX) px += Math.round((x + cols / 2 - px - 0.5) / w) * w;
      if (!full && map.loopY) py += Math.round((y + rows / 2 - py - 0.5) / h) * h;
      return { x: left + (px + 0.5 - x) * scale, y: top + (py + 0.5 - y) * scale };
    } };
}

export function exitGroups(map, analysis) {
  const groups = new Map();
  for (const exit of analysis?.exits || []) {
    if (!map.grid.valid(exit.x, exit.y)) continue;
    const label = exit.label || (exit.mapId && exit.mapId !== map.mapId ? destinationName(exit.mapId) : tr('출구'));
    const key = `${exit.mapId || 0}/${label}`;
    if (!groups.has(key)) groups.set(key, { number: groups.size + 1, label, cells: [] });
    const group = groups.get(key);
    if (!group.cells.some(c => c.x === exit.x && c.y === exit.y)) group.cells.push({ x: exit.x, y: exit.y });
  }
  return [...groups.values()];
}

export class NavigationMap {
  constructor(Panel, root, camera, hud, font) {
    this.font = font; this.camera = camera; this.hud = hud;
    this.mini = new Panel(384, 440, 0.22);
    this.full = new Panel(1024, 1024, 1.15);
    root.add(this.full.mesh);
    this.open = false; this.page = 0; this.elapsed = 0;
    this.attach(false);
  }
  attach(wrist) {
    const mesh = this.mini.mesh;
    (wrist ? this.hud : this.camera).add(mesh);
    mesh.rotation.set(0, 0, 0); mesh.scale.setScalar(1);
    if (wrist) mesh.position.set(0, 0.225, 0.001);
    else mesh.position.set(0.34, 0.24, -0.72);
  }
  hide() { this.mini.mesh.visible = false; this.full.mesh.visible = false; }
  close() { this.open = false; this.full.mesh.visible = false; }
  analysis(map) { return G.view?.mapId === map.mapId ? G.view.analysis : null; }
  prepare(map) {
    const analysis = this.analysis(map);
    const drawer = G.view?.mapId === map.mapId ? G.view.mesh?.drawer : null;
    if (this.grid === map.grid && this.area === map.mapId && this.ana === analysis && this.drawer === drawer) return;
    this.grid = map.grid; this.area = map.mapId; this.ana = analysis;
    this.drawer = drawer;
    this.groups = exitGroups(map, analysis); this.page = 0;
    const { w, h } = map.grid;
    // One raster pixel per cell; the draw path scales it with nearest-neighbour filtering.
    this.base ||= document.createElement('canvas'); this.base.width = w; this.base.height = h;
    const ctx = this.base.getContext('2d');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const cell = x + y * w;
      ctx.fillStyle = analysis?.pits?.has(cell) ? '#080b12' : analysis?.doors?.has(cell) ? '#b59352'
        : map.walkable(x, y) ? '#777668' : '#292b33';
      ctx.fillRect(x, y, 1, 1);
    }
    this.art = null;
    if (drawer?.images?.some(Boolean)) {
      const art = document.createElement('canvas'), scale = Math.min(0.5, 2048 / (TS * Math.max(w, h)));
      art.width = Math.max(1, Math.ceil(w * TS * scale)); art.height = Math.max(1, Math.ceil(h * TS * scale));
      const a = art.getContext('2d'); a.imageSmoothingEnabled = false; a.scale(art.width / (w * TS), art.height / (h * TS));
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        drawer.draw(a, map.grid.tile(x, y, 0), x * TS, y * TS);
        drawer.draw(a, map.grid.tile(x, y, 1), x * TS, y * TS);
        drawer.drawShadow(a, map.grid.shadow(x, y), x * TS, y * TS);
        drawer.draw(a, map.grid.tile(x, y, 2), x * TS, y * TS);
      }
      this.art = art;
    }
    this.dirty = true;
  }
  update(dt, visible, miniAllowed = true) {
    const map = G.map;
    if (!visible || !map?.grid || !map.playerChar || map.transferring) { this.hide(); return; }
    this.prepare(map);
    this.mini.mesh.visible = miniAllowed && !this.open && G.settings.minimap !== false;
    this.full.mesh.visible = this.open;
    this.elapsed += dt;
    if (!this.dirty && this.elapsed < 0.1) return;
    this.elapsed = 0; this.dirty = false;
    if (this.mini.mesh.visible) this.draw(this.mini, map, false);
    if (this.full.mesh.visible) this.draw(this.full, map, true);
  }
  draw(panel, map, full) {
    const { ctx, canvas } = panel, W = canvas.width, H = canvas.height;
    panel.clear();
    if (!drawGameWindow(ctx, 2, 2, W - 4, H - 4, 0.95)) {
      ctx.fillStyle = 'rgba(13,14,20,0.92)'; ctx.fillRect(2, 2, W - 4, H - 4);
      ctx.strokeStyle = '#b8a47a'; ctx.lineWidth = 3; ctx.strokeRect(3, 3, W - 6, H - 6);
    }
    ctx.font = `bold ${full ? 34 : 24}px ${this.font}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillStyle = '#eee0b9'; ctx.fillText(fitLabel(ctx, destinationName(map.mapId), W - (full ? 320 : 100)), 20, full ? 34 : 27);
    ctx.fillStyle = '#b2e5ed'; ctx.fillText('N ↑', W - (full ? 250 : 72), full ? 34 : 27);
    if (full) { ctx.font = `28px ${this.font}`; ctx.fillStyle = '#eee0b9'; ctx.fillText('‹ ' + tr('뒤로'), 840, 34); }
    const rect = full ? { x: 28, y: 72, w: 968, h: 640 } : { x: 16, y: 54, w: 352, h: 314 };
    const view = mapProjection(map, rect, full), { w, h } = map.grid;
    ctx.save(); ctx.beginPath(); ctx.rect(view.left, view.top, view.width, view.height); ctx.clip();
    ctx.imageSmoothingEnabled = false;
    for (const dx of !full && map.loopX ? [-w, 0, w] : [0]) for (const dy of !full && map.loopY ? [-h, 0, h] : [0]) {
      const target = [view.left + (dx - view.x) * view.scale, view.top + (dy - view.y) * view.scale, w * view.scale, h * view.scale];
      ctx.drawImage(this.base, ...target);
      if (this.art) ctx.drawImage(this.art, ...target);
    }
    for (const group of this.groups) {
      const marked = [];
      for (const cell of group.cells) {
        const p = view.point(cell.x, cell.y);
        ctx.fillStyle = '#f5c45a'; ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
        if (marked.some(c => Math.hypot(c.x - p.x, c.y - p.y) < (full ? 30 : 22))) continue;
        marked.push(p);
        ctx.beginPath(); ctx.arc(p.x, p.y, full ? 12 : 10, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#191b22'; ctx.font = `bold ${full ? 17 : 15}px ${this.font}`; ctx.textAlign = 'center';
        ctx.fillText(String(group.number), p.x, p.y + 1);
      }
    }
    const player = mapPosition(map), p = view.point(player.x, player.y);
    const f = G.player?.forward2D?.();
    const angle = f ? Math.atan2(f.x, -f.z) : ({ 8: 0, 6: Math.PI / 2, 2: Math.PI, 4: -Math.PI / 2 }[map.playerChar.direction] || 0);
    ctx.translate(p.x, p.y); ctx.rotate(angle);
    ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(9, 10); ctx.lineTo(0, 6); ctx.lineTo(-9, 10); ctx.closePath();
    ctx.fillStyle = '#84eeff'; ctx.strokeStyle = '#07161f'; ctx.lineWidth = 3; ctx.fill(); ctx.stroke(); ctx.restore();
    ctx.textAlign = 'left'; ctx.font = `${full ? 30 : 21}px ${this.font}`; ctx.fillStyle = '#c8d9de';
    if (full) {
      ctx.fillText(tr('지도 범례'), 28, 746);
      ctx.fillStyle = '#84eeff'; ctx.fillText('▲ ' + tr('내 위치'), 240, 746);
      ctx.fillStyle = '#b4b4a6'; ctx.fillText(tr(this.art ? '원작 지도 · 금색 출구' : '바닥 · 어두운 벽'), 500, 746);
      const pages = Math.max(1, Math.ceil(this.groups.length / 8)); this.page = wrap(this.page, pages);
      for (const [i, group] of this.groups.slice(this.page * 8, this.page * 8 + 8).entries()) {
        ctx.fillStyle = '#f5c45a';
        ctx.fillText(fitLabel(ctx, `${group.number}. ${group.label}`, 465), 28 + (i % 2) * 490, 788 + Math.floor(i / 2) * 36);
      }
      if (!this.groups.length) { ctx.fillStyle = '#b9b8bb'; ctx.fillText(tr('표시할 출구가 없습니다'), 28, 788); }
      ctx.fillStyle = '#d3d0c7'; ctx.font = `26px ${this.font}`;
      ctx.fillText(tr(G.vr ? '닫기: B / Y' : '닫기: N / Esc'), 28, 968);
      if (pages > 1) { ctx.fillText('‹ ' + tr('이전'), 660, 968); ctx.fillText(tr('다음') + ' ›', 840, 968); }
      if (pages > 1) ctx.fillText(tr('출구 {n}/{total} · ↑↓ / 스틱', { n: this.page + 1, total: pages }), 28, 1000);
    } else {
      ctx.fillText('▲ ' + tr('내 위치') + '   ● ' + tr('출구'), 16, 394);
      ctx.fillStyle = '#b9b8bb'; ctx.font = `20px ${this.font}`; ctx.fillText(tr(G.vr ? 'Y: 메뉴 → 지도' : 'N: 지도 · Tab: 메뉴'), 16, 423);
    }
    panel.commit();
  }
}
