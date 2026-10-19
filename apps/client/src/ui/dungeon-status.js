// The original persistent dungeon indicator is a W_REGULAR row. Its label,
// variable and visibility come from the selected game's installed scripts.
export function dungeonStatus(config, state, { scene = 'map' } = {}) {
  const mode = config?.[scene];
  if (!mode?.enabled || !state || !state.sw(mode.switchId)) return null;
  const type = state.v(config.typeVariable);
  if (!Number.isSafeInteger(type)) return null;
  const rows = (config.items[type] || []).filter(row => row.switchId === null || state.sw(row.switchId)).map(row => {
    const raw = state.v(row.variable), value = row.noValue ? '' : String(raw ?? 0) + row.suffix;
    return { ...row, value, text: [row.label, value].filter(Boolean).join(' ') };
  });
  if (!rows.length) return null;
  const text = rows.map(row => row.text).join(' · ');
  return { type, rows, text, key: JSON.stringify([scene, type, rows]) };
}

// Placement is left to the UI's minimap/wrist anchors. This class does not read
// globals or infer dungeon membership from names, maps, difficulty or save data.
export class DungeonStatus {
  constructor(Panel, { font = 'sans-serif', textColor = () => '#fff', windowBg, drawIcon = () => {}, fitLabel = (_ctx, text) => text } = {}) {
    this.panel = new Panel(512, 80, 0.22);
    this.mesh = this.panel.mesh;
    this.helpers = { font, textColor, windowBg, drawIcon, fitLabel };
    this.key = null;
  }
  update(config, state, { scene = 'map', visible = true, assetRevision = 0 } = {}) {
    const status = visible ? dungeonStatus(config, state, { scene }) : null;
    this.mesh.visible = !!status;
    if (!status) return null;
    const key = `${assetRevision}/${status.key}`;
    if (this.key === key) return status;
    this.key = key;
    const { panel } = this, { ctx, canvas } = panel, { font, textColor, windowBg, drawIcon, fitLabel } = this.helpers;
    const height = Math.max(80, status.rows.length * 56 + 24);
    panel.resize(512, height); panel.clear();
    windowBg?.(ctx, 0, 0, canvas.width, canvas.height, 0.15, 0.4);
    ctx.save(); ctx.textBaseline = 'middle'; ctx.lineWidth = 4; ctx.strokeStyle = '#08080b';
    status.rows.forEach((row, index) => {
      const y = 40 + index * 56, x = row.icon ? 64 : 24;
      if (row.icon) drawIcon(ctx, row.icon, 22, y - 16, 32);
      ctx.font = `32px ${font}`;
      const value = fitLabel(ctx, row.value, 220), valueWidth = ctx.measureText(value).width;
      const label = fitLabel(ctx, row.label, Math.max(0, 464 - x - valueWidth));
      ctx.textAlign = 'left'; ctx.fillStyle = textColor(row.color);
      ctx.strokeText(label, x, y); ctx.fillText(label, x, y);
      ctx.textAlign = 'right'; ctx.fillStyle = textColor(0);
      ctx.strokeText(value, 488, y); ctx.fillText(value, 488, y);
    });
    ctx.restore(); panel.commit();
    return status;
  }
  hide() { this.mesh.visible = false; }
}
