import { G } from '../core/globals.js';

// A fixed-size transparent screen for native command105. Long credits retain
// their full layout, but only visible glyphs are painted/uploaded each frame.
export class ScrollText {
  constructor({ Panel, root, layoutText, drawOps }) {
    this.layoutText = layoutText; this.drawOps = drawOps;
    this.panel = new Panel(1280, 960, 1.45); root.add(this.panel.mesh);
  }
  open(message) {
    const width = G.scripts?.screen?.[0] || 544, height = G.scripts?.screen?.[1] || 416;
    const scale = 2;
    this.panel.resize(width * scale, height * scale, 1.45);
    this.panel.mesh.position.set(0, -0.05, 0.02);
    const ops = this.layoutText(message.lines || [], 16 * scale, 0, scale, this.panel.ctx,
      G.scripts?.fontSize || 24, (width - 16) * scale);
    this.scroll = { message, ops, width, height, scale, total: ops.height / scale + 1,
      offset: Number.isFinite(message.scrollOy) ? message.scrollOy : -height };
    this.panel.mesh.visible = true; this.draw();
  }
  close() { this.scroll = null; this.panel.mesh.visible = false; }
  update(dt, fast = true) {
    const current = this.scroll;
    if (!current) return true;
    const { message } = current, input = G.input;
    const hurry = fast && !message.noFast;
    const skip = hurry && input?.skipHeld?.();
    const held = hurry && (input?.rmButton?.(11) || input?.rmButton?.(13));
    const speed = Number.isFinite(message.speed) ? Math.max(0, message.speed) : 2;
    current.offset += (skip ? 25 : speed * (held ? 1 : 0.5)) * 60 * Math.max(0, Math.min(dt, 0.1));
    message.scrollOy = current.offset;
    this.draw(); return current.offset >= current.total;
  }
  draw() {
    const sc = this.scroll;
    if (!sc) return;
    const { ctx, canvas } = this.panel, y = (12 - sc.offset) * sc.scale;
    this.panel.clear(); ctx.save();
    ctx.beginPath(); ctx.rect(12 * sc.scale, 12 * sc.scale, canvas.width - 24 * sc.scale, canvas.height - 24 * sc.scale); ctx.clip();
    ctx.translate(0, y);
    const visible = sc.ops.filter(op => Number.isFinite(op.y) && op.y + y >= -96 * sc.scale && op.y + y <= canvas.height);
    this.drawOps(ctx, visible, Infinity);
    ctx.restore(); this.panel.commit();
  }
}
