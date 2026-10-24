// Chat between players (co-op: everyone in the host's world; the community server: everyone on it). A line in any language
// (80 letters at most - clipChatText: PC typed with the system's own input, VR with the game's keyboard, English or Korean -
// hangul.js) goes to everyone and comes up over its speaker's head
// as a balloon for a while (one's own over one's own head: looking up shows it), and into the log, with who came and
// went - those as notices too, gold as a boss beaten (coop.js noteMembers). PC: / opens the log and a line to type in
// (Enter sends, Esc closes); VR: the emote ring's chat slot or the co-op menu's 채팅 보내기 opens the game's keyboard,
// and the co-op menu's 채팅 기록 shows the log. A player muted (the co-op menu's members) is neither shown nor heard.
// Nothing of it is kept: the log is this page's and goes with it; the servers pass it on unread.
import * as THREE from 'three';
import { G } from '../core/globals.js';
import { tr } from '../ui/i18n.js';
import { FONT } from '../ui/fonts.js';

export const CHAT_LEN = 80;
const LOG_MAX = 60;
const BUBBLE_W = 1.1;               // m: a balloon's width over a head
// what a chat line may hold: letters and marks, digits, signs and spaces of any language - not control or format characters
// (a line break; ones that turn the text right to left or hide in it - the joiner inside an emoji kept), private-use,
// unassigned or broken ones, nor a heap of marks piled on one letter; spaces one at a time, max letters at most
const CHAT_DROP = /[\p{Cc}\p{Co}\p{Cn}\p{Cs}]|(?!\u200d)\p{Cf}/gu;
export function clipChatText(s, max = CHAT_LEN) {
  const t = String(s ?? '').normalize('NFD').replace(/[\t\n\r\v\f\u2028\u2029]/g, ' ').replace(CHAT_DROP, '')
    .replace(/(\p{M}{3})\p{M}+/gu, '$1').normalize('NFC').replace(/\s+/g, ' ').replace(/^ /, '');
  return [...t].slice(0, max).join('');
}
export function cleanChat(s) {
  if (typeof s !== 'string') return '';
  return clipChatText(s).trim();
}
// how long a line stays up over a head (s)
export const bubbleTime = text => Math.min(10, 4 + text.length * 0.06);
// how much bigger what stands over a player (its name, its PVP, its chat balloon - coopavatar.js) is drawn the farther off it
// is: as big to the eye as at TAG_NEAR m, up to TAG_MAX times its size
const TAG_NEAR = 3, TAG_MAX = 5;
export const tagScale = dist => Math.max(1, Math.min(TAG_MAX, dist / TAG_NEAR));
const nowS = () => performance.now() / 1000;

// a speech balloon of a line (white, its tail down) on a canvas - its height in lines
export function drawBubble(canvas, text, font) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `34px ${font}`;
  const maxW = canvas.width - 64, words = text.split(' '), lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width <= maxW || !line) line = t; else { lines.push(line); line = w; }
    while (ctx.measureText(line).width > maxW && [...line].length > 1) {     // (a word longer than a line - one with no spaces: cut)
      const cs = [...line];
      let k = cs.length;
      while (k > 1 && ctx.measureText(cs.slice(0, k).join('')).width > maxW) k--;
      lines.push(cs.slice(0, k).join('')); line = cs.slice(k).join('');
    }
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 3);
  if (lines.length > 3) shown[2] = shown[2].replace(/.?$/, '…');
  const lh = 42, h = shown.length * lh + 32, w = Math.min(canvas.width - 8, Math.max(...shown.map(l => ctx.measureText(l).width)) + 48);
  const x = (canvas.width - w) / 2, y = canvas.height - 26 - h;
  ctx.beginPath();
  const r = 22;
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.lineTo(canvas.width / 2 + 16, y + h); ctx.lineTo(canvas.width / 2, y + h + 22); ctx.lineTo(canvas.width / 2 - 16, y + h);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  ctx.fillStyle = 'rgba(250,248,240,0.94)'; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(40,30,30,0.85)'; ctx.stroke();
  ctx.fillStyle = '#1c1414'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  shown.forEach((l, i) => ctx.fillText(l, canvas.width / 2, y + 16 + lh * (i + 0.5)));
  return shown.length;
}
// a balloon sprite (over a head): its line, how long it stays
export class ChatBubble {
  constructor(scene, font) {
    const cv = document.createElement('canvas');
    cv.width = 640; cv.height = 220;
    this.tex = new THREE.CanvasTexture(cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, toneMapped: false }));
    this.sprite.scale.set(BUBBLE_W, BUBBLE_W * cv.height / cv.width, 1);
    this.sprite.renderOrder = 1410;
    this.sprite.visible = false;
    scene.add(this.sprite);
    this.font = font; this.until = 0;
  }
  say(text, seconds = bubbleTime(text)) {
    drawBubble(this.tex.image, text, this.font);
    this.tex.needsUpdate = true;
    this.until = nowS() + seconds;
  }
  get up() { return nowS() < this.until; }
  // over (x, top, z) - the top of a head, or of its name over it; farther than a few metres it grows with the distance
  // (up to three times), so a line said over there can still be read
  place(x, top, z, shown = true, dist = 0) {
    this.sprite.visible = shown && this.up;
    if (!this.sprite.visible) return;
    const k = tagScale(dist), img = this.tex.image;
    this.sprite.scale.set(BUBBLE_W * k, BUBBLE_W * k * img.height / img.width, 1);
    this.sprite.position.set(x, top + this.sprite.scale.y / 2, z);
  }
  dispose() {
    this.sprite.parent?.remove(this.sprite);
    this.tex.dispose(); this.sprite.material.dispose();
  }
}

export class CoopChat {
  constructor(scene, { events = globalThis } = {}) {
    this.scene = scene;
    this.log = [];                     // { kind: 'chat' | 'in' | 'out' | 'kill', name, text, mine, t }
    this.sentAt = [];
    this.heardAt = new Map();          // sender -> times of its last lines (more than this a while is dropped)
    this.mine = null;                  // my own balloon (over my head)
    this.el = null;                    // (PC) the log and the line typed in
    this.events = events;
    this.onKey = e => {
      if (e.key !== '/' || e.repeat || e.isComposing || /^(?:INPUT|TEXTAREA)$/.test(e.target?.tagName || '') || e.target?.isContentEditable || G.vr) return;
      if (this.canOpen()) { e.preventDefault(); this.openPanel(); }
    };
    events.addEventListener?.('keydown', this.onKey);
  }
  // in a session where others are (co-op: in the host's world, or hosting; the community server: in its world)
  get on() { const c = G.coop; return !!c?.active && (c.role === 'host' ? true : c.role === 'world' ? !!c.world : !!c.summoned); }
  canOpen() { return this.on && !this.el?.open && !G.ui?.menuOpen && !G.ui?.sceneOpen && !G.ui?.msg && !G.ui?.messageBusy?.() && !G.ui?.dialogueActive?.(); }

  // a line of mine: to everyone, over my own head, into the log (a few at a time at most)
  send(text) {
    const s = cleanChat(text);
    if (!s) return false;
    if (!this.on) { G.audio?.playSystemSe(3); return false; }
    const t = nowS();
    this.sentAt = this.sentAt.filter(x => t - x < 10);
    if (this.sentAt.length >= 5 || t - (this.sentAt.at(-1) ?? -9) < 0.8) { G.audio?.playSystemSe(3); return false; }
    this.sentAt.push(t);
    G.coop.send({ t: 'ch', s });
    this.ownBubble().say(s);
    this.add('chat', G.coop.myName(), s, true);
    return true;
  }
  // one of theirs (coop.js: from one this player sees): over its head when it is on this map, into the log
  onChat(from, m, name, avatar, muted) {
    const s = cleanChat(m?.s);
    if (!s || muted) return;
    const t = nowS(), times = (this.heardAt.get(from) || []).filter(x => t - x < 10);
    if (times.length >= 8) return;                  // (more than anyone types: let go)
    times.push(t);
    this.heardAt.set(from, times);
    avatar?.say?.(s);
    this.add('chat', name || '?', s, false);
    // (and as a notice too, unless turned off - 채팅·음성 → 채팅 알림)
    if (G.settings?.chatToasts !== false) G.ui?.toast?.(`${name || '?'}: ${s}`, 0, '#bfe3ff', bubbleTime(s));
  }
  // one came into the session, or went
  notePeer(name, on) {
    if (!name) return;
    G.ui?.toast?.(on ? tr('{name} 님이 접속했습니다', { name }) : tr('{name} 님이 나갔습니다', { name }), 0, '#ffd870', 5);
    this.add(on ? 'in' : 'out', name, '', false);
  }
  add(kind, name, text, mine) {
    this.log.push({ kind, name, text, mine, t: Date.now() });
    if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX);
    this.drawPanel();
  }
  // a log line as it reads
  lineOf(e) {
    if (e.kind === 'in') return tr('{name} 님이 접속했습니다', { name: e.name });
    if (e.kind === 'out') return tr('{name} 님이 나갔습니다', { name: e.name });
    if (e.kind === 'kill') return e.text;           // (who beat which boss: as its notice said it - coop.js onKill)
    return `${e.name}: ${e.text}`;
  }
  clear() {
    this.log = []; this.heardAt.clear(); this.sentAt = []; this.closePanel();
    if (this.mine) this.mine.until = 0;
    this.drawPanel();
  }

  // ---- my own balloon: over my head (main.js, each frame - looking up shows it)
  ownBubble() { return (this.mine ||= new ChatBubble(this.scene, FONT)); }
  update(head) {
    if (!this.on) this.closePanel();
    if (!this.mine) return;
    this.mine.place(head.x, head.y + 0.55, head.z, true);
  }

  // ---- VR (and the co-op menu): the game's keyboard
  openKeyboard(back) {
    if (!this.on) { G.audio?.playSystemSe(3); back?.(); return; }
    G.ui.askChat(tr('채팅'), CHAT_LEN).then(v => { if (v) this.send(v); back?.(); });
  }

  // ---- PC: the log and a line to type in, over the game's window at its lower left
  openPanel() {
    if (!this.canOpen()) return;
    const el = this.panelEl();
    el.open = true;
    el.box.style.display = 'block';
    G.input?.keys?.clear();                         // (no key left held: the player stands while typing)
    G.input?.consumeActionEdges?.();
    if (G.input?.suspendPointerForUi) G.input.suspendPointerForUi();
    else if (document.pointerLockElement) document.exitPointerLock?.();
    el.input.value = '';
    this.drawPanel();
    el.input.focus();
  }
  closePanel() {
    const el = this.el;
    if (!el?.open) return;
    el.open = false;
    el.input.blur();
    el.box.style.display = 'none';
    G.input?.consumeActionEdges?.(); G.input?.syncPointerUi?.(false);
  }
  get typing() { return !!this.el?.open; }
  panelEl() {
    if (this.el) return this.el;
    const box = document.createElement('div');
    box.id = 'coop-chat';
    box.style.cssText = 'position:fixed;left:16px;bottom:96px;width:min(560px,60vw);display:none;z-index:20;'
      + `font:15px ${FONT};color:#f0f0f0;text-shadow:0 1px 2px #000`;
    const log = document.createElement('div');
    log.style.cssText = 'max-height:260px;overflow-y:auto;background:rgba(10,6,8,0.62);border:1px solid rgba(220,140,180,0.55);'
      + 'border-radius:6px 6px 0 0;padding:6px 10px;white-space:pre-wrap;word-break:break-word';
    const input = Object.assign(document.createElement('input'), { type: 'text', maxLength: CHAT_LEN * 2, autocomplete: 'off', spellcheck: false });
    input.style.cssText = 'width:100%;box-sizing:border-box;background:rgba(0,0,0,0.75);color:#fff;border:1px solid rgba(220,140,180,0.55);'
      + 'border-top:none;border-radius:0 0 6px 6px;padding:7px 10px;font:inherit;outline:none';
    input.placeholder = tr('입력하고 Enter (Esc: 닫기)');
    // (what a line may hold - clipChatText -, not while the system's input is still putting a letter together: a Korean
    // syllable, a kana being turned into kanji - touching the field then breaks it)
    const tidy = () => { const v = clipChatText(input.value); if (v !== input.value) input.value = v; };
    input.oninput = e => { if (!e.isComposing) tidy(); };
    input.addEventListener('compositionend', tidy);
    input.onkeydown = e => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        const v = cleanChat(input.value);
        if (v && this.send(v)) input.value = '';
        else if (!v) this.closePanel();
      } else if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); this.closePanel(); }
    };
    input.onblur = () => setTimeout(() => { if (this.el?.open && document.activeElement !== input) this.closePanel(); }, 0);
    box.append(log, input);
    document.body.appendChild(box);
    this.el = { box, log, input, open: false };
    return this.el;
  }
  drawPanel() {
    const el = this.el;
    if (!el) return;
    el.log.replaceChildren(...this.log.slice(-30).map(e => {
      const d = document.createElement('div');
      d.textContent = this.lineOf(e);
      d.style.color = e.kind === 'chat' ? (e.mine ? '#ffe2a8' : '#f0f0f0') : '#ffd870';
      return d;
    }));
    el.log.scrollTop = el.log.scrollHeight;
  }
  dispose() {
    this.closePanel(); this.events.removeEventListener?.('keydown', this.onKey);
    this.el?.box.remove(); this.el = null; this.mine?.dispose(); this.mine = null;
  }
}
