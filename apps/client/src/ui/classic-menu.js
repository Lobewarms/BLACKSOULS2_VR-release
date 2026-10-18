// The original pause-menu arrangement: commands/economy at left, real party
// members at right. The caller owns command drawing, asset loading and selection.
export function paintClassicMenu({ overview, commandPanel, leader, members, gold, sen, menuVar, currencyUnit,
  effects = [], faceCanvas, helpers }) {
  const { windowBg, drawIcon, textColor, fitLabel, stripEscapes, tr, FONT } = helpers;
  const number = value => (Number.isFinite(Number(value)) ? Number(value) : 0).toLocaleString();
  const write = (ctx, text, x, y, room, size = 30, align = 'left', color = textColor(0), shorten = true) => {
    text = String(text); ctx.font = `${size}px ${FONT}`;
    const measured = ctx.measureText(text).width;
    if (!shorten && measured > room) ctx.font = `${Math.max(16, Math.floor(size * room / measured))}px ${FONT}`;
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
    const label = shorten ? fitLabel(ctx, text, room) : text;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.92)'; ctx.lineJoin = 'round'; ctx.strokeText(label, x, y);
    ctx.fillText(label, x, y);
  };
  const frame = (ctx, x, y, w, h) => {
    ctx.fillStyle = 'rgba(8,9,12,0.12)'; ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    windowBg(ctx, x, y, w, h, 0.25, 0.65);
    ctx.fillStyle = 'rgba(6,7,10,0.08)'; ctx.fillRect(x + 18, y + 18, w - 36, h - 36);
  };
  const party = (members?.length ? members : leader ? [leader] : []).filter(Boolean).slice(0, 4);
  overview.clear();
  const c = overview.ctx, W = overview.canvas.width;
  frame(c, 2, 2, W - 4, overview.canvas.height - 4);
  const gauge = (label, current, maximum, y, colors) => {
    const x = W - 336, right = W - 32, value = Number(current), max = Number(maximum);
    const ratio = Number.isFinite(value) && max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    write(c, label, x, y, 60, 28, 'left', textColor(colors[1]));
    write(c, `${number(current)} / ${number(maximum)}`, right, y, right - x - 68, 28, 'right', textColor(0), false);
    c.fillStyle = textColor(19); c.fillRect(x, y + 22, right - x, 12);
    const gradient = c.createLinearGradient(x, y + 22, right, y + 22);
    gradient.addColorStop(0, textColor(colors[0])); gradient.addColorStop(1, textColor(colors[1]));
    c.fillStyle = gradient; c.fillRect(x, y + 22, (right - x) * ratio, 12);
  };
  party.forEach((actor, index) => {
    const top = index * 240;
    const sheet = faceCanvas instanceof Map ? faceCanvas.get(actor.faceName) : actor === leader ? faceCanvas
      : actor.faceName && actor.faceName === leader?.faceName ? faceCanvas : null;
    const faceIndex = Math.max(0, Math.trunc(actor.faceIndex || 0)), sx = faceIndex % 4 * 96, sy = Math.floor(faceIndex / 4) * 96;
    if (sheet?.width >= sx + 96 && sheet?.height >= sy + 96) {
      c.imageSmoothingEnabled = false; c.drawImage(sheet, sx, sy, 96, 96, 32, top + 32, 176, 176);
    }
    write(c, stripEscapes(actor.name || tr('플레이어')), 240, top + 48, W - 610, 36);
    const className = helpers.className?.(actor) || helpers.classes?.[actor.classId]?.name || actor.className || '';
    if (className) write(c, stripEscapes(className), W - 32, top + 48, 328, 30, 'right', textColor(16));
    if (actor.level != null) write(c, `${helpers.levelLabel || 'Lv'} ${number(actor.level)}`, 240, top + 94, 328, 30);
    gauge('HP', actor.hp, actor.mhp, top + 102, [18, 10]);
    gauge('MP', actor.mp, actor.mmp, top + 154, [9, 1]);
    const states = actor === leader ? effects : helpers.battlerEffects?.(actor) || [];
    states.slice(0, 4).forEach((effect, i) => {
      const x = 240 + (i % 2) * 174, y = top + 124 + Math.floor(i / 2) * 40;
      drawIcon(c, effect.icon, x, y, 28);
      write(c, stripEscapes(effect.name), x + 34, y + 14, 130, 24);
    });
    if (states.length > 4) write(c, `+${states.length - 4} · ${tr('상태 보기')}`, 240, top + 214, 340, 22, 'left', textColor(8));
    if (index < party.length - 1) {
      c.globalAlpha = 0.3; c.fillStyle = textColor(21); c.fillRect(32, top + 238, W - 64, 1); c.globalAlpha = 1;
    }
  });
  // Optional original equipment data can fill the otherwise unused area for a
  // single real actor; absent data never produces synthetic party placeholders.
  if (party.length === 1 && helpers.itemData) {
    const equipment = (party[0].equips || []).map(entry => helpers.itemData(entry.kind, entry.id)).filter(Boolean);
    if (equipment.length) {
      c.globalAlpha = 0.3; c.fillStyle = textColor(21); c.fillRect(32, 272, W - 64, 1); c.globalAlpha = 1;
      write(c, tr('장비'), 32, 310, W - 64, 30, 'left', textColor(16));
      equipment.slice(0, 12).forEach((item, index) => {
        const x = 32 + index % 2 * (W / 2), y = 348 + Math.floor(index / 2) * 64;
        drawIcon(c, item.icon_index || 0, x, y, 36);
        write(c, stripEscapes(item.name), x + 48, y + 18, W / 2 - 96, 30);
      });
    }
  }
  const toolBounds = { x: 640, y: 860, width: 280, height: 60 };
  frame(c, toolBounds.x, toolBounds.y, toolBounds.width, toolBounds.height);
  helpers.drawGameCursor?.(c, toolBounds.x + 4, toolBounds.y + 4, toolBounds.width - 8, toolBounds.height - 8);
  write(c, `${helpers.vr ? '' : 'F1 · '}${tr('모드 도구')}`, toolBounds.x + toolBounds.width / 2,
    toolBounds.y + toolBounds.height / 2, toolBounds.width - 32, 26, 'center', textColor(0));
  overview.commit();

  if (commandPanel) {
    const ctx = commandPanel.ctx, width = commandPanel.canvas.width;
    // Append beneath the command rows. Never clear or redraw their selection.
    if (sen != null) {
      frame(ctx, 4, 730, width - 8, 94);
      write(ctx, stripEscapes(menuVar?.label || 'SEN'), 24, 756, width - 48, 22, 'left', textColor(16));
      write(ctx, `${sen}${menuVar?.suffix || ''}`, width - 24, 792, width - 48, 32, 'right', textColor(0), false);
    }
    frame(ctx, 4, 850, width - 8, 86);
    if (currencyUnit) write(ctx, stripEscapes(currencyUnit), 24, 874, width - 48, 22, 'left', textColor(16));
    write(ctx, number(gold), width - 24, 907, width - 48, 32, 'right', textColor(0), false);
    commandPanel.commit();
  }
  return { membersDrawn: party.length, overviewHeight: overview.canvas.height, summaryTop: sen == null ? 850 : 730, toolBounds };
}
