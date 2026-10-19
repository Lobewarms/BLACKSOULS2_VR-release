import { G } from '../core/globals.js';
import { loadCanvas } from '../data/assets.js';
import { desktopViewport } from './desktop-layout.js';
import { tr } from './i18n.js';

// Scene_ShortMove's map is artwork shared by every destination. Its marker
// coordinates stay in that artwork's space, even when the UI is resized.
export class BonfireTravel {
  constructor({ Panel, root, list, ui, font = 'sans-serif', windowBg, fitLabel = (_ctx, text) => text, load = loadCanvas }) {
    Object.assign(this, { root, list, ui, font, windowBg, fitLabel, load });
    this.panel = new Panel(780, 678, 0.78);
    root.add(this.panel.mesh);
    this.generation = 0;
    this.session = null;
  }
  open(destinations, config) {
    this.close();
    const panel = this.list.panel;
    this.session = { generation: ++this.generation, destinations, config, items: this.list.items,
      state: G.state, map: G.map, mapId: G.map?.mapId, assets: new Map(), revision: 0,
      original: { width: panel.canvas.width, height: panel.canvas.height, widthM: panel.widthM,
        position: panel.mesh.position.clone(), rows: this.list.rows, rowTop: this.list.rowTop,
        rowH: this.list.rowH, choiceFont: this.list.choiceFont } };
    this.layoutKey = this.drawKey = null;
    this.panel.mesh.visible = true;
    this.update();
  }
  owns(session = this.session) {
    return !!session && session === this.session && session.generation === this.generation
      && session.state === G.state && session.map === G.map && session.mapId === G.map?.mapId
      && !G.map?.transferring && !G.combat?.playerDead && this.ui.sceneOpen === 'bonfire'
      && this.list.visible && this.list.items === session.items;
  }
  close() {
    const session = this.session;
    this.generation++;
    this.session = null;
    this.panel.mesh.visible = false;
    this.layoutKey = this.drawKey = null;
    if (!session || this.list.items !== session.items) return;
    const original = session.original;
    this.list.rows = original.rows; this.list.rowTop = original.rowTop; this.list.rowH = original.rowH;
    this.list.choiceFont = original.choiceFont;
    this.list.panel.resize(original.width, original.height, original.widthM);
    this.list.panel.mesh.position.copy(original.position);
    if (this.list.visible) this.list.draw();
  }
  asset(folder, name) {
    const session = this.session;
    if (!session || typeof name !== 'string' || !name) return null;
    const key = `${folder}/${name}`;
    if (!session.assets.has(key)) {
      const entry = { image: null, done: false };
      session.assets.set(key, entry);
      Promise.resolve().then(() => this.load(folder, name)).then(image => {
        if (!this.owns(session)) return;
        entry.image = image?.width > 0 && image?.height > 0 ? image : null;
        entry.done = true; session.revision++; this.update();
      }, () => {
        if (!this.owns(session)) return;
        entry.done = true; session.revision++; this.update();
      });
    }
    return session.assets.get(key);
  }
  layout() {
    const viewport = desktopViewport(G.input, G.three?.renderer);
    const narrow = !G.vr && viewport.width < 760;
    const rows = narrow ? Math.min(this.session.original.rows, viewport.height < 640 ? 2 : 3) : this.session.original.rows;
    const key = `${G.vr}/${narrow}/${rows}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    this.list.rows = rows;
    this.list.rowTop = 100; this.list.rowH = 64; this.list.choiceFont = 36;
    if (narrow) {
      const listHeight = 110 + rows * 64 + 56, previewHeight = 450, gap = 0.016;
      this.list.panel.resize(640, listHeight, 0.64);
      this.panel.resize(640, previewHeight, 0.64);
      this.panel.mesh.position.set(0, (listHeight / 1000 + gap) / 2, 0);
      this.list.panel.mesh.position.set(0, -(previewHeight / 1000 + gap) / 2, 0);
    } else {
      const height = 110 + rows * 64 + 56;
      this.list.panel.resize(600, height, 0.6);
      this.panel.resize(780, height, 0.78);
      this.list.panel.mesh.position.set(-0.398, 0, 0);
      this.panel.mesh.position.set(0.308, 0, 0);
    }
    this.narrow = narrow;
    // draw() clamps scrolling against the new row count without losing focus.
    this.list.draw();
    this.drawKey = null;
  }
  markers() {
    const session = this.session, config = session.config, selected = session.destinations[this.list.index];
    const icons = (config?.icons || []).filter(marker =>
      (!marker.showSwitch || session.state.sw(marker.showSwitch)) && (!marker.hideSwitch || !session.state.sw(marker.hideSwitch)));
    const player = selected && config?.players?.[selected.index];
    return [...icons.map(marker => ({ ...marker, actor: marker.type === 0 ? session.state.actor?.(marker.actorId) : null })),
      ...(player ? [{ ...player, actor: player.type === 0 ? session.state.party?.leader?.() : null }] : [])];
  }
  update() {
    if (!this.session) return false;
    if (!this.owns()) { this.close(); return false; }
    this.layout();
    const session = this.session, selected = session.destinations[this.list.index], markers = this.markers();
    const map = this.asset('Graphics/Pictures', session.config?.picture);
    const prepared = markers.map(marker => ({ ...marker, image: marker.type === 0
      ? this.asset('Graphics/Characters', marker.actor?.characterName)?.image
      : marker.type === 2 ? this.asset('Graphics/Pictures', marker.picture)?.image : null }));
    const key = JSON.stringify([this.layoutKey, this.list.index, session.revision, selected?.name, selected?.desc,
      prepared.map(marker => [marker.type, marker.x, marker.y, marker.size, marker.color, marker.picture,
        marker.actor?.characterName, marker.actor?.characterIndex])]);
    if (key !== this.drawKey) { this.drawKey = key; this.draw(selected, map, prepared); }
    return true;
  }
  draw(selected, map, markers) {
    const { panel, font } = this, { ctx, canvas } = panel;
    panel.clear();
    this.windowBg?.(ctx, 4, 4, canvas.width - 8, canvas.height - 8, G.vr ? 0.9 : 0.25, G.vr ? 1 : 0.65);
    ctx.save(); ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.imageSmoothingEnabled = false;
    const area = { x: 24, y: 20, width: canvas.width - 48, height: this.narrow ? 272 : canvas.height - 174 };
    const image = map?.image;
    if (image) {
      const scale = Math.min(area.width / image.width, area.height / image.height);
      const rect = { x: area.x + (area.width - image.width * scale) / 2,
        y: area.y + (area.height - image.height * scale) / 2, width: image.width * scale, height: image.height * scale };
      this.imageRect = rect;
      ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
      ctx.save(); ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.width, rect.height); ctx.clip();
      for (const marker of markers) this.drawMarker(marker, rect, scale);
      ctx.restore();
    } else {
      this.imageRect = null;
      ctx.fillStyle = '#e8d8a8'; ctx.font = `30px ${font}`; ctx.textAlign = 'center';
      ctx.fillText(this.fitLabel(ctx, tr(map && !map.done ? '지도를 불러오는 중입니다' : '지도 미리보기를 사용할 수 없습니다'), area.width), canvas.width / 2, area.y + area.height / 2);
      ctx.textAlign = 'left';
    }
    const y = this.narrow ? 320 : canvas.height - 120;
    ctx.fillStyle = '#e8d8a8'; ctx.font = `36px ${font}`;
    ctx.fillText(this.fitLabel(ctx, String(selected?.name || ''), canvas.width - 48), 24, y);
    ctx.fillStyle = '#f0f0f0'; ctx.font = `${this.narrow ? 34 : 30}px ${font}`;
    for (let i = 0; i < 2; i++) ctx.fillText(this.fitLabel(ctx, String(selected?.desc?.[i] || ''), canvas.width - 48), 24, y + 46 + i * 42);
    ctx.restore(); panel.commit();
  }
  drawMarker(marker, rect, scale) {
    if (![marker.x, marker.y].every(Number.isFinite)) return;
    const ctx = this.panel.ctx, x = rect.x + marker.x * scale, y = rect.y + marker.y * scale;
    if (marker.type === 1) {
      const size = Number.isFinite(marker.size) ? Math.max(0, marker.size) : 7;
      const color = marker.color || [0, 0, 0];
      ctx.fillStyle = `rgb(${color.join(',')})`;
      ctx.fillRect(rect.x + (marker.x - Math.floor(size / 2)) * scale,
        rect.y + (marker.y - Math.floor(size / 2)) * scale, size * scale, size * scale);
    } else if (marker.type === 2 && marker.image) {
      ctx.drawImage(marker.image, x, y, marker.image.width * scale, marker.image.height * scale);
    } else if (marker.type === 0 && marker.image) {
      const single = /^[!]*\$/.test(marker.actor?.characterName || ''), image = marker.image;
      const cw = image.width / (single ? 3 : 12), ch = image.height / (single ? 4 : 8);
      const raw = marker.actor?.characterIndex, index = single ? 0 : Number.isInteger(raw) ? Math.max(0, Math.min(7, raw)) : 0;
      ctx.drawImage(image, (index % 4 * 3 + 1) * cw, Math.floor(index / 4) * 4 * ch, cw, ch,
        x - cw * scale / 2, y - ch * scale, cw * scale, ch * scale);
    }
  }
}
