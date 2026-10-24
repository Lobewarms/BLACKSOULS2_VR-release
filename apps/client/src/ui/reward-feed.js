import { anchorDesktopPanel } from './desktop-layout.js';

const ROW_HEIGHT = 84, PADDING = 18, WIDTH = 720;
const MAX_ROWS = 3, MAX_QUEUE = 24, MERGE_SECONDS = 2, ROW_SECONDS = 5.5, ADMIT_SECONDS = 0.35;
const positive = value => Number.isSafeInteger(value) && value > 0;

// Nonblocking pickup history. Artwork and translated item/currency names come
// from the caller's game database; this component never changes game state.
export class RewardFeed {
  constructor({ Panel, camera, hud = null, font = 'sans-serif', drawWindow = () => false, drawIcon = () => {},
    fitLabel = (_ctx, text) => text, assetRevision = () => 0, moreLabel = count => `+${count}…`, cleanName = text => text }) {
    Object.assign(this, { camera, hud, font, drawWindow, drawIcon, fitLabel, assetRevision, moreLabel, cleanName });
    this.panel = new Panel(WIDTH, PADDING * 2 + ROW_HEIGHT * MAX_ROWS, 0.3);
    this.mesh = this.panel.mesh; this.mesh.renderOrder = 900;
    this.rows = []; this.queue = []; this.omitted = 0; this.clock = 0; this.nextAdmission = 0;
    this.dirty = true; this.drawElapsed = 0; this.capacity = MAX_ROWS; this.blocking = false;
    this.attach(false);
  }
  attach(vr) {
    if (vr && this.hud) {
      this.hud.add(this.mesh); this.mesh.scale.setScalar(0.8); this.mesh.rotation.set(0, 0, 0);
      const hudHeight = this.hud.geometry?.parameters?.height || 0.2;
      this.mesh.position.set(0, -hudHeight / 2 - this.panel.heightM * 0.4 - 0.02, 0.001);
    } else if (this.camera) this.camera.add(this.mesh);
    this.vr = vr;
  }
  gain(kind, id, count, data) {
    if (!['item', 'weapon', 'armor'].includes(kind) || !positive(id)) return false;
    return this.add(`${kind}:${id}`, kind, id, count, data);
  }
  gold(amount, data) { return this.add('gold', 'gold', 0, amount, data); }
  add(key, kind, id, count, data) {
    if (!positive(count) || typeof data?.name !== 'string' || !data.name.trim()) return false;
    const name = this.cleanName(data.name).trim();
    if (!name) return false;
    const previous = [...this.rows, ...this.queue].reverse().find(row => row.key === key &&
      this.clock - row.updated <= MERGE_SECONDS && Number.isSafeInteger(row.count + count));
    if (previous) {
      previous.count += count; previous.updated = this.clock; previous.age = 0; this.dirty = true; return true;
    }
    const icon = data.icon_index ?? data.icon ?? 0;
    const row = { key, kind, id, count, name, icon: Number.isSafeInteger(icon) && icon >= 0 ? icon : 0,
      age: 0, updated: this.clock };
    if (this.queue.length >= MAX_QUEUE) {
      this.queue.shift();
      const summary = this.rows.find(entry => entry.kind === 'overflow');
      if (summary) { summary.count++; summary.name = this.moreLabel(summary.count); summary.age = 0; }
      else this.omitted++;
    }
    this.queue.push(row); this.dirty = true; return true;
  }
  hide() { this.mesh.visible = false; }
  clear() {
    this.rows = []; this.queue = []; this.omitted = 0; this.clock = 0; this.nextAdmission = 0;
    this.dirty = true; this.hide();
  }
  place({ vr = false, viewport = {} } = {}) {
    if (this.vr !== vr) this.attach(vr);
    if (vr) { this.capacity = MAX_ROWS; return !!this.hud; }
    const width = Math.max(1, viewport.width || globalThis.innerWidth || 1280);
    const height = Math.max(1, viewport.height || globalThis.innerHeight || 720);
    // Leave the middle of the view and the left-side HUD clear. Cosmetic gains
    // wait, with their timers paused, when a small window cannot fit them.
    if (width <= 700 || height < 260 || !this.camera) { this.capacity = 0; return false; }
    const cssWidth = Math.min(300, width * 0.35);
    this.capacity = Math.max(0, Math.min(MAX_ROWS,
      Math.floor(((height * 0.35 - 24) * WIDTH / cssWidth - PADDING * 2) / ROW_HEIGHT)));
    if (!this.capacity) return false;
    this.paintedHeight = PADDING * 2 + ROW_HEIGHT * Math.min(this.capacity, Math.max(1, this.rows.length));
    anchorDesktopPanel(this.panel, this.camera, { width, height },
      { width: cssWidth, x: 'right', y: 'bottom', paintedHeight: this.paintedHeight });
    return true;
  }
  update(dt, { paused = false, visible = true, vr = false, viewport } = {}) {
    const oldCapacity = this.capacity;
    const allowed = this.place({ vr, viewport });
    if (paused || !visible || !allowed) { this.hide(); return; }
    const elapsed = Number.isFinite(dt) && dt > 0 ? dt : 0;
    this.clock += elapsed; this.drawElapsed += elapsed;
    const visibleRows = this.rows.slice(0, this.capacity);
    for (const row of visibleRows) row.age += elapsed;
    const count = this.rows.length;
    this.rows = this.rows.filter(row => row.age < ROW_SECONDS);
    if (count !== this.rows.length) this.dirty = true;
    if (this.rows.length < this.capacity && this.clock >= this.nextAdmission && (this.queue.length || this.omitted)) {
      if (this.omitted) {
        this.rows.push({ key: 'overflow', kind: 'overflow', count: this.omitted, name: this.moreLabel(this.omitted), icon: 0, age: 0 });
        this.omitted = 0;
      } else this.rows.push(this.queue.shift());
      this.nextAdmission = this.clock + ADMIT_SECONDS; this.dirty = true;
    }
    this.mesh.visible = this.rows.length > 0;
    // Re-anchor after admission/removal so the painted portion stays above the
    // desktop bottom margin rather than reserving three blank rows.
    this.place({ vr, viewport });
    const revision = this.assetRevision();
    if (this.dirty || revision !== this.lastRevision || oldCapacity !== this.capacity || this.drawElapsed >= 0.1) {
      this.draw(); this.lastRevision = revision; this.drawElapsed = 0; this.dirty = false;
    }
  }
  draw() {
    const panel = this.panel, { ctx, canvas } = panel;
    panel.clear();
    const rows = this.rows.slice(0, this.capacity), height = PADDING * 2 + ROW_HEIGHT * rows.length;
    if (!rows.length) { panel.commit(); return; }
    if (!this.drawWindow(ctx, 4, 4, canvas.width - 8, height - 8, 0.22, 0.4)) {
      ctx.fillStyle = 'rgba(14,12,18,0.22)'; ctx.fillRect(4, 4, canvas.width - 8, height - 8);
    }
    rows.forEach((row, index) => {
      const y = PADDING + ROW_HEIGHT * (index + 0.5);
      ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, row.age / 0.2, ROW_SECONDS - row.age));
      if (row.icon > 0) this.drawIcon(ctx, row.icon, 24, y - 28, 56);
      const nameX = row.icon > 0 ? 104 : 24;
      if (row.kind !== 'overflow') {
        const quantity = `${row.kind === 'gold' ? '+' : '×'}${row.count.toLocaleString()}`;
        ctx.font = `bold 36px ${this.font}`;
        const measured = ctx.measureText(quantity).width;
        if (measured > 180) ctx.font = `bold ${Math.max(12, Math.floor(36 * 180 / measured))}px ${this.font}`;
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f0e2bc';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.92)'; ctx.strokeText(quantity, WIDTH - 24, y); ctx.fillText(quantity, WIDTH - 24, y);
      }
      ctx.font = `36px ${this.font}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f0f0f0';
      const label = this.fitLabel(ctx, row.name, WIDTH - nameX - (row.kind === 'overflow' ? 24 : 224));
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.92)'; ctx.strokeText(label, nameX, y); ctx.fillText(label, nameX, y);
      ctx.restore();
    });
    panel.commit();
  }
}
