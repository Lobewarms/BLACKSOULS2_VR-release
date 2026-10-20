// Desktop combat information has a fixed resource card and a separate effect strip.
// The caller owns anchoring, visibility and caching; no time-based pages move either card.
// The combat action chain owns these charges; the HUD has no expiry clock.
export function bonusHudStatus(value, fallbackIcon = 0) {
  if (!Number.isSafeInteger(value?.count) || value.count <= 0) return null;
  const icon = [value.icon, fallbackIcon].find(index => Number.isSafeInteger(index) && index > 0) || 0;
  return { count: value.count, icon, key: `${value.count}/${icon}` };
}

export function paintDesktopHud({ hud, status, leader, stamina, sen, menuVar, currency, effects = [], faceCanvas, bonus: rawBonus, helpers }) {
  const { windowBg, drawIcon, textColor, fitLabel, stripEscapes, tr, FONT } = helpers;
  const bonus = bonusHudStatus(rawBonus);
  const W = hud.canvas.width, height = 256 + (bonus ? 44 : 0);
  const number = value => (Number.isFinite(Number(value)) ? Number(value) : 0).toLocaleString();
  const hp = Number(leader.hp), mhp = Number(leader.mhp);
  const critical = Number.isFinite(hp) && mhp > 0 && hp / mhp <= 0.25;
  const frame = (panel, h) => {
    panel.clear();
    const c = panel.ctx;
    // Keep the game's frame, with a quiet underlay so scenery and held weapons
    // cannot reduce the contrast of its resource values.
    c.fillStyle = 'rgba(8,9,12,0.08)'; c.fillRect(2, 2, panel.canvas.width - 4, h - 4);
    windowBg(c, 2, 2, panel.canvas.width - 4, h - 4, 0.15, 0.4);
    c.fillStyle = 'rgba(6,7,10,0.08)'; c.fillRect(18, 18, panel.canvas.width - 36, h - 36);
    c.textBaseline = 'middle';
  };
  const write = (c, text, x, y, room, size, { align = 'left', color = textColor(0), fit = false } = {}) => {
    text = String(text);
    c.font = `${size}px ${FONT}`;
    const width = c.measureText(text).width;
    if (width > room && !fit) c.font = `${Math.max(14, Math.floor(size * room / width))}px ${FONT}`;
    c.textAlign = align; c.fillStyle = color;
    const label = fit ? fitLabel(c, text, room) : text;
    c.lineWidth = 3; c.lineJoin = 'round'; c.strokeStyle = 'rgba(0,0,0,0.92)'; c.strokeText(label, x, y);
    c.fillText(label, x, y);
  };
  frame(hud, height);
  const ctx = hud.ctx;
  // The game's active battle script crops this eye strip from the selected
  // original 96px face cell. Missing portraits never borrow another actor's art.
  const faceIndex = Math.max(0, Math.trunc(leader.faceIndex || 0));
  const sx = faceIndex % 4 * 96, sy = Math.floor(faceIndex / 4) * 96 + 38;
  const hasFace = !!leader.faceName && faceCanvas?.width >= sx + 96 && faceCanvas?.height >= sy + 24;
  if (hasFace) {
    ctx.imageSmoothingEnabled = false;
    windowBg(ctx, 22, 12, 148, 40, 0.25, 0.4);
    ctx.drawImage(faceCanvas, sx, sy, 96, 24, 24, 14, 144, 36);
  }
  const level = leader.level == null ? '' : `Lv ${number(leader.level)}`;
  ctx.font = `20px ${FONT}`;
  const levelRoom = level ? Math.min(144, ctx.measureText(level).width + 20) : 0;
  const nameX = hasFace ? 184 : 24;
  write(ctx, stripEscapes(leader.name || tr('플레이어')), nameX, 28, W - 40 - nameX - levelRoom, 22, { fit: true });
  if (level) write(ctx, level, W - 24, 28, levelRoom, 20, { align: 'right', color: textColor(8), fit: true });
  ctx.globalAlpha = 0.35; ctx.fillStyle = textColor(21); ctx.fillRect(24, 64, W - 48, 1); ctx.globalAlpha = 1;

  const resource = (label, value, maximum, y, barY, barHeight, colors, percentage = false) => {
    const ratio = Number.isFinite(Number(value)) && maximum > 0 ? Math.max(0, Math.min(1, Number(value) / maximum)) : 0;
    const size = label === 'HP' ? 34 : 28;
    write(ctx, label, 24, y, 128, label === 'HP' ? 30 : 24, { color: textColor(colors[1]) });
    ctx.font = `24px ${FONT}`;
    const labelRoom = Math.min(150, ctx.measureText(label).width + 20);
    write(ctx, percentage ? `${Math.round(ratio * 100)}%` : `${number(value)} / ${number(maximum)}`,
      W - 24, y, W - 48 - labelRoom, size, { align: 'right', color: label === 'HP' && critical ? textColor(18) : textColor(0) });
    ctx.fillStyle = textColor(19); ctx.fillRect(24, barY, W - 48, barHeight);
    const gradient = ctx.createLinearGradient(24, barY, W - 24, barY);
    gradient.addColorStop(0, textColor(colors[0])); gradient.addColorStop(1, textColor(colors[1]));
    ctx.fillStyle = gradient; ctx.fillRect(24, barY, (W - 48) * ratio, barHeight);
  };
  resource('HP', hp, mhp, 86, 104, 16, [18, 10]);
  resource('MP', Number(leader.mp), Number(leader.mmp), 136, 154, 8, [9, 1]);
  if (stamina !== undefined) resource(tr('스태미나'), Number(stamina), 1, 180, 198, 8, [28, 29], true);
  if (critical) {
    ctx.globalAlpha = 0.65; ctx.strokeStyle = textColor(18); ctx.lineWidth = 1;
    ctx.strokeRect(18, 68, W - 36, 58); ctx.globalAlpha = 1;
  }
  ctx.globalAlpha = 0.22; ctx.fillStyle = textColor(21); ctx.fillRect(24, 218, W - 48, 1); ctx.globalAlpha = 1;
  const goldRoom = sen == null ? W - 48 : 290;
  write(ctx, `${number(currency?.amount ?? currency ?? 0)} ${stripEscapes(currency?.unit || '')}`.trim(),
    24, 230, goldRoom, 22, { color: textColor(16), fit: true });
  if (sen != null) write(ctx, `${menuVar?.label || 'SEN'} ${sen}${menuVar?.suffix || ''}`, W - 24, 230,
    W - 72 - goldRoom, 22, { align: 'right', fit: true });
  if (bonus) {
    ctx.globalAlpha = 0.22; ctx.fillStyle = textColor(21); ctx.fillRect(24, 252, W - 48, 1); ctx.globalAlpha = 1;
    if (bonus.icon) drawIcon(ctx, bonus.icon, 24, 260, 28);
    const x = bonus.icon ? 60 : 24;
    write(ctx, tr('보너스 행동 ×{n}', { n: bonus.count }), x, 273, W - x - 24, 24, { color: textColor(16), fit: true });
  }
  hud.commit();

  if (status) {
    if (!effects.length) { status.clear(); status.commit(); }
    else {
      frame(status, 128);
      const c = status.ctx, width = status.canvas.width, colWidth = (width - 48) / 2;
      effects.slice(0, 4).forEach((effect, i) => {
        const x = 20 + (i % 2) * (colWidth + 8), y = 14 + Math.floor(i / 2) * 36;
        drawIcon(c, effect.icon, x, y, 30);
        write(c, stripEscapes(effect.name), x + 38, y + 15, colWidth - 40, 24, { fit: true });
      });
      const extra = effects.length > 4 ? `+${effects.length - 4} · ` : '';
      write(c, extra + tr('전체 효과: 메뉴 → 상태'), 24, 103, width - 48, 18, { color: textColor(8), fit: true });
      status.commit();
    }
  }
  return { height, statusHeight: effects.length ? 128 : 0, statusVisible: effects.length > 0, critical };
}
