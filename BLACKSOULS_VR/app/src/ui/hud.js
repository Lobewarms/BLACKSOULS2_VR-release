// What the UI shows round the play: banners and toasts (VICTORY ACHIEVED, SEN up or down), the HUD (the status window, the
// co-op microphone), the pointer.
import { $data } from '../data.js';
import { FONT, gameFont } from '../fonts.js';
import { G } from '../globals.js';
import { tr } from '../i18n.js';
import { LINE, PAD, drawGauge, drawText, drawWindow, fontSize } from '../rmwindow.js';
import { itemData } from '../state.js';
import { drawIcon, textColor } from '../uitext.js';
import { drawVoiceMarks, voiceCode, voiceMarksReady, voiceMarksSize } from '../voicemarks.js';
import { HUD_ICONS, HUD_W, MS, VOICE_PIC, windowBg } from './common.js';

// (never made: its methods are UI's own - mixed into it in ui.js)
export class HudPart {
  // ---------------------------------------------------------------- banner / toasts
  showBanner(text, color = '#ddd', blocking = false, seconds = 2.6) {
    this.banner = { text, color, t: 0, dur: seconds, blocking };
    this.placeRoot(true);
    this.drawBanner();
  }
  drawBanner() {
    const p = this.bannerPanel;
    const b = this.banner;
    p.clear();
    if (b) {
      const { ctx, canvas } = p;
      const a = Math.min(1, b.t / 0.4, (b.dur - b.t) / 0.5);
      const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, `rgba(0,0,0,${0.75 * a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = Math.max(0, a);
      ctx.font = `120px "Times New Roman", ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = b.color;
      ctx.fillText(b.text, canvas.width / 2, canvas.height / 2);
      ctx.globalAlpha = 1; ctx.textAlign = 'left';
    }
    p.commit();
    p.mesh.visible = !!b;
    p.mesh.position.set(0, 0.02, -0.1);
  }
  toast(text, icon = 0, color = '#f0e6c8', life = 3.5) {
    this.toasts.push({ text, icon, color, t: 0, life });
    if (this.toasts.length > 4) this.toasts.splice(this.toasts.findIndex(t => !t.sticky), 1);
    this.drawToasts();
  }
  // a toast that stays until cleared (one at a time)
  setHint(text) {
    this.toasts = this.toasts.filter(t => !t.sticky);
    if (text) this.toasts.unshift({ text, icon: 0, color: '#bfe3ff', t: 0, sticky: true });
    this.drawToasts();
  }
  notifyGain(kind, id, n) {
    const d = itemData(kind, id);
    if (!d) return;
    this.toast(tr('{name} 획득', { name: d.name + (n > 1 ? ' ×' + n : '') }), d.icon_index);
    G.audio?.playSystemSe(22);
  }
  // SEN went up or down (BLACKSOULS II's SEN reminder, from its own script): its strip and its sound
  notifySen(delta) {
    const sen = G.scripts?.sen;
    if (!sen) return;
    const now = G.state.v(sen.variable);
    const color = textColor((sen.colors.find(([above]) => now > above) || [0, sen.color])[1]);
    this.toasts.push({ sen: { label: sen.labels[delta > 0 ? 0 : 1], note: `${sen.note}${now} (${delta > 0 ? '+' : ''}${delta})`, icon: sen.icon }, color, t: 0 });
    if (this.toasts.length > 4) this.toasts.splice(this.toasts.findIndex(t => !t.sticky), 1);
    this.drawToasts();
    const se = sen.se[delta > 0 ? 0 : 1];
    if (se) G.audio?.playSe(se);
  }
  // as the original draws it: a small tab with "SEN 상승" / "SEN 저하!" on top of a dark bar holding the icon and
  // the value now (with the change), coloured by how high it is
  drawSenStrip(ctx, w, y, t) {
    const { label, note, icon } = t.sen;
    ctx.textBaseline = 'middle';
    ctx.font = `22px ${FONT}`;
    ctx.fillStyle = 'rgba(0,0,0,0.63)';
    ctx.fillRect(4, y, ctx.measureText(label).width + 14, 24);
    ctx.fillRect(4, y + 24, w - 8, 42);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, 11, y + 13);
    if (icon) drawIcon(ctx, icon, 12, y + 26, 38);
    ctx.font = `30px ${FONT}`;
    ctx.fillStyle = t.color;
    ctx.fillText(note, icon ? 60 : 16, y + 46);
  }
  drawToasts() {
    const p = this.toastPanel;
    const { ctx } = p;
    p.clear();
    this.toasts.forEach((t, i) => {
      const a = t.sticky ? 1 : Math.min(1, ((t.life || 3.5) - t.t) / 0.5);
      if (a <= 0) return;
      ctx.globalAlpha = a;
      const y = 10 + i * 72;
      if (t.sen) { this.drawSenStrip(ctx, p.canvas.width, y, t); ctx.globalAlpha = 1; return; }
      windowBg(ctx, 4, y, p.canvas.width - 8, 64, 0.7);
      let x = 24;
      if (t.icon) { drawIcon(ctx, t.icon, x, y + 8, 48); x += 60; }
      ctx.font = `34px ${FONT}`; ctx.fillStyle = t.color; ctx.textBaseline = 'middle';
      const room = p.canvas.width - x - 16, w = ctx.measureText(t.text).width;          // (a long one: smaller)
      if (w > room) ctx.font = `${Math.max(18, Math.floor(34 * room / w))}px ${FONT}`;
      ctx.fillText(t.text, x, y + 34);
      ctx.globalAlpha = 1;
    });
    p.commit();
    p.mesh.visible = this.toasts.length > 0;
    p.mesh.position.set(0, -0.62, 0.02);
  }

  // ---------------------------------------------------------------- HUD
  // the status panel as the original's windows are drawn (rmwindow.js): the window skin in its tone, the game's font on
  // 24-pixel lines; HP and MP as Window_Base#draw_actor_hp / mp draw them (the label in the system colour over the gauge's
  // two skin colours, the numbers at the right - in the crisis / knocked-out colour when low), the stamina a gauge of its
  // own under them (TP's colours, half a line), the SEN (Window_Var: its title in the system colour) and the souls
  // (Window_Gold#draw_currency_value) on one line, and the states' icons under it while there are any
  drawHud() {
    const leader = G.state?.party.leader();
    this.hud.mesh.visible = !!leader;
    if (!leader) return;
    const mv = G.scripts?.menuVar, sen = mv && (!mv.switchId || G.state.sw(mv.switchId)) ? G.state.v(mv.variable) : null;
    // the player's states, by their icons as the original's battle status shows them (poison, a resin, a boss's rule
    // going round - 그랑・기뇰's 악랄영역): a row under the rest, only while there are any
    // (and its buffs / debuffs, by the original's arrows - 목수의 못, a curse), each with the seconds it has left on it (as
    // the original's ステート残りターン puts a state's turns left on its icon in a fight - here they run all the time)
    const timers = G.state.system.stateTimers || {}, buffT = leader.buffTimes();
    const marks = [...leader.states.map(id => [$data.states[id]?.icon_index || 0, timers[id]]), ...leader.buffIcons().map((ic, k) => [ic, buffT[k]])]
      .filter(([ic]) => ic > 0).slice(0, HUD_ICONS);
    const icons = marks.map(m => m[0]), lefts = marks.map(m => (m[1] > 0 ? Math.ceil(m[1]) : null));
    const s = MS, W = HUD_W, H = PAD * 2 + LINE * 3 + LINE / 2 + (icons.length ? LINE : 0);
    this.hudDrawn = H * s;                                     // (how much of its canvas the window takes: placeDeskHud)
    this.drawVoiceBadge();
    const stamina = G.combat?.stamina;
    const key = `${leader.hp}/${leader.mhp}/${leader.mp}/${leader.mmp}/${G.state.party.gold}/${stamina?.toFixed?.(2)}/${sen}/${icons.join(',')}/${lefts.join(',')}`;
    if (key === this.lastHud) return;
    this.lastHud = key;
    const p = this.hud, { ctx } = p;
    p.clear();
    drawWindow(ctx, s, 0, 0, W, H);
    const B = $data.system.terms?.basic || [], normal = textColor(0), system = textColor(16), x = PAD, w = W - PAD * 2;
    const gauge = (label, cur, max, c1, c2, color, y) => {
      drawGauge(ctx, s, x, y, w, max ? cur / max : 0, textColor(c1), textColor(c2), textColor(19));
      drawText(ctx, s, label, x, y, 30, LINE, 0, system);
      // (Window_Base#draw_current_and_max_values, its number fields as wide as seven figures)
      drawText(ctx, s, cur, x + w - 152, y, 70, LINE, 2, color);
      drawText(ctx, s, '/', x + w - 82, y, 12, LINE, 2, normal);
      drawText(ctx, s, max, x + w - 70, y, 70, LINE, 2, normal);
    };
    let y = PAD;
    gauge(B[3] || 'HP', leader.hp, leader.mhp, 20, 21, leader.hp <= 0 ? textColor(18) : leader.hp < leader.mhp / 4 ? textColor(17) : normal, y);
    y += LINE;
    gauge(B[5] || 'MP', leader.mp, leader.mmp, 22, 23, leader.mp < leader.mmp / 4 ? textColor(17) : normal, y);
    y += LINE;
    // (the stamina: its gauge alone, at the foot of half a line)
    if (stamina !== undefined) drawGauge(ctx, s, x, y - LINE / 2, w, stamina, textColor(28), textColor(29), textColor(19));
    y += LINE / 2;
    // (the SEN's and the souls' line all a little smaller than HP's and MP's)
    const small = Math.round(fontSize() * 0.84);
    ctx.font = gameFont(small * s);
    const width = t => ctx.measureText(String(t)).width / s;
    if (sen !== null) {
      const lw = width(`${mv.label} `), vw = width(sen);
      drawText(ctx, s, mv.label, x, y, lw, LINE, 0, system, { size: small });
      drawText(ctx, s, sen, x + lw, y, vw + 1, LINE, 0, normal, { size: small });
      if (mv.suffix) drawText(ctx, s, mv.suffix, x + lw + vw, y, width(mv.suffix) + 1, LINE, 0, system, { size: small });
    }
    const unit = $data.system.currency_unit || '';
    drawText(ctx, s, G.state.party.gold, x, y, w - width(unit) - 2, LINE, 2, normal, { size: small });
    drawText(ctx, s, unit, x, y, w, LINE, 2, system, { size: small });
    if (icons.length) {
      y += LINE;
      icons.forEach((ic, i) => drawIcon(ctx, ic, (x + i * 24) * s, y * s, 24 * s));
      // (the time left: over the icon's right side, bold, in the crisis colour - as the original draws a state's turns)
      ctx.font = `bold ${Math.round(fontSize() * s)}px ${FONT}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 2.5 * s; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.fillStyle = textColor(17);
      lefts.forEach((n, i) => { if (n === null) return; const tx = (x + i * 24 + 24) * s, ty = (y + LINE / 2) * s; ctx.strokeText(String(n), tx, ty); ctx.fillText(String(n), tx, ty); });
      ctx.textAlign = 'left';
    }
    p.commit();
  }
  // (co-op) beside the status window: the microphone (talking on / off) over the headphones (listening on / off), by the
  // voice setting, see-through - the microphone solid while this player speaks (voicemarks.js) - only in a session with
  // others, when voice goes anywhere
  drawVoiceBadge() {
    const v = G.voice, b = this.voiceBadge;
    const code = G.chat?.on && v && voiceMarksReady() ? voiceCode(v.mode) : -1;
    const speaking = code === 2 && v.micLive && v.speaking;
    const key = `${code}/${speaking}`;
    if (key === this.voiceBadgeKey) return;
    this.voiceBadgeKey = key;
    b.mesh.visible = code >= 0;
    if (code < 0) return;
    b.clear();
    const [w] = voiceMarksSize(VOICE_PIC, true);
    drawVoiceMarks(b.ctx, (b.canvas.width - w) / 2, 4, VOICE_PIC, code, speaking, true);
    b.commit();
  }

  // ---------------------------------------------------------------- pointer
  pointerRay() {
    const c = G.input.controllers.right;
    if (!G.vr || !c) return null;
    const m = c.ray.matrixWorld;
    this.raycaster.ray.origin.setFromMatrixPosition(m);
    this.raycaster.ray.direction.set(0, 0, -1).transformDirection(m);
    return this.raycaster;
  }
}
