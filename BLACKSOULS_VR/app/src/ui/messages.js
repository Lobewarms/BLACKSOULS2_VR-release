// The UI's messages: the message window (text, faces, choices, number input), Show Scrolling Text, and - for a co-op guest -
// the host's message as it reads it.
import * as THREE from 'three';
import { loadCanvas } from '../assets.js';
import { $data } from '../data.js';
import { NAME_FONT, gameFont } from '../fonts.js';
import { G } from '../globals.js';
import { tr } from '../i18n.js';
import { LINE, PAD, drawPause, drawText, drawWindow, fittingHeight, fontSize } from '../rmwindow.js';
import { bannerOf, textColor } from '../uitext.js';
import { FRAME_S, MW, PPM, SCROLL_PIECE, SKIP_DWELL, TEXT_CPS, dimBack, drawOps, layoutText, screenH,
  screenW } from './common.js';

// (never made: its methods are UI's own - mixed into it in ui.js)
export class MessagePart {
  // ---------------------------------------------------------------- messages
  messageBusy() { return !!this.msg || !!this.banner?.blocking || !!G.arena?.busy; }
  sceneBusy() { return !!this.sceneOpen || this.menuOpen; }

  showMessage(msg) {
    if (msg.scroll) { this.msg = msg; msg.state = 'scroll'; this.startScroll(msg); return; }
    const banner = bannerOf(msg);
    if (banner) { this.showBanner(banner.text, banner.color, true); return; }
    this.msg = msg;
    msg.reveal = 0; msg.wait = 0; msg.fast = false; msg.state = 'typing';
    msg.ops = null;
    this.placeRoot(true);
    this.layoutMessage();
    this.drawMessage();
    this.msgPanel.mesh.visible = msg.lines.length > 0 || !msg.choices;
    if (msg.lines.length === 0) msg.state = 'done-typing';
  }
  speakerName(msg) {
    if (this.nextName) { const n = this.nextName; this.nextName = null; return n; }
    if (!this.nameWindowEnabled || !msg.face) return '';
    const names = G.scripts.names || {};
    let n = names[`${msg.face}_${msg.faceIndex}`] ?? names[msg.face] ?? '';
    const am = /^Actor\[(\d+)\]/.exec(n);
    if (am) n = G.state.actor(+am[1])?.name || '';
    return n.trim();
  }
  // The message window as the original's (Window_Message): the screen's width (BLACKSOULS II: 640) by 4 lines with its
  // padding (120), in the window skin - or its dim background (black at 160, fading at the top and foot), or nothing -;
  // the face (96 x 96) at its top left and the text 112 in from it (at the left with none), the game's font in its size
  // on 24-pixel lines; the pause sign at its foot while a key is awaited
  messageLayout(msg) {
    const W = screenW(), H = fittingHeight(4);
    return { W, H, x0: PAD + (msg?.face ? 112 : 0), y0: PAD, right: W - PAD };
  }
  // (msg: this player's own message, or the host's shown to a co-op guest - showRemoteMessage)
  layoutMessage(msg = this.msg) {
    const ctx = this.msgPanel.ctx;
    const L = this.messageLayout(msg);
    msg.ops = layoutText(msg.lines, L.x0 * MW, L.y0 * MW, MW, ctx, fontSize(), L.right * MW);
    msg.total = msg.ops.filter(o => o.k === 'ch' || o.k === 'icon').length;
    msg.name = msg.remote ? msg.name || '' : this.speakerName(msg);
    if (msg.face) loadCanvas('Graphics/Faces', msg.face).then(c => { msg.faceCanvas = c; if (this.msg === msg || (this.remote === msg && msg.shown)) this.drawMessage(msg); });
  }
  drawMessage(msg = this.msg) {
    if (!msg) return;
    const p = this.msgPanel, { ctx } = p, s = MW, { W, H } = this.messageLayout(msg);
    p.clear();
    if (msg.background === 1) dimBack(ctx, s, W, H);
    else if (msg.background !== 2) drawWindow(ctx, s, 0, 0, W, H);
    if (msg.faceCanvas) {
      const fi = msg.faceIndex || 0;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(msg.faceCanvas, (fi % 4) * 96, Math.floor(fi / 4) * 96, 96, 96, PAD * s, PAD * s, 96 * s, 96 * s);
    }
    drawOps(ctx, msg.ops, Math.floor(msg.reveal));
    if (msg.state === 'waitInput' || msg.state === 'pause') {
      msg.pauseAt ??= G.time;
      const f = (G.time - msg.pauseAt) * 60;
      drawPause(ctx, s, W, H, Math.floor(f / 8), Math.min(1, f / 8));
    } else msg.pauseAt = null;
    p.fit(W * s, H * s);
    p.commit();
    this.drawNameWindow(msg);
    this.layoutPanels(msg);
  }
  // the pause sign's frame (8 frames each, fading in over the first 8): the window drawn again when it changes
  pauseTick(msg) {
    const f = (G.time - (msg.pauseAt ?? G.time)) * 60;
    const key = f < 8 ? Math.floor(f / 2) : 4 + Math.floor(f / 8);
    if (key !== msg.pauseKey) { msg.pauseKey = key; this.drawMessage(msg); }
  }
  // The speaker's name (ネームウィンドウ, A1's): a window just round it - its letters (the script's NAME_FONT, 16 pixels)
  // and 8 more each way, 28 high -, the name white in its middle
  drawNameWindow(msg) {
    const np = this.namePanel, s = MW;
    np.clear();
    if (!msg.name) { np.mesh.visible = false; this.nameW = 0; return; }
    const ctx = np.ctx;
    ctx.font = gameFont(16 * s, NAME_FONT);
    const w = Math.min(320, Math.ceil(ctx.measureText(msg.name).width / s) + 16), h = 28;
    drawWindow(ctx, s, 0, 0, w, h);
    drawText(ctx, s, msg.name, 0, 0, w, h, 1, '#ffffff', { size: 16, font: NAME_FONT });
    np.fit(w * s, h * s);
    np.commit();
    np.mesh.visible = this.msgPanel.mesh.visible;
    this.nameW = w;
  }
  // the gold window (Window_Gold, opened by \$ in a message): the souls, the currency after them
  showGold() {
    const gp = this.goldPanel, s = MW, ctx = gp.ctx, unit = $data.system.currency_unit || '';
    gp.clear();
    drawWindow(ctx, s, 0, 0, 160, fittingHeight(1));
    ctx.font = gameFont(fontSize() * s);
    const cx = ctx.measureText(unit).width / s;
    drawText(ctx, s, G.state.party.gold, PAD + 4, PAD, 128 - cx - 2, LINE, 2, textColor(0));
    drawText(ctx, s, unit, PAD + 4, PAD, 128, LINE, 2, textColor(16));
    gp.commit();
    gp.mesh.visible = true;
    this.layoutPanels();
  }
  // Where the windows stand, as the original lays them: the message window at the screen's top, middle or foot (here
  // 0.22, -0.05 or -0.32 m from the eyes - the screen's 480 pixels so spread, 1.5 mm each); the name window beside the
  // face, 116 in, its top 16 over the window's (16 over the window's foot when that is at the top); the choices (and
  // this version's number input) at the right, over the window - under it when that is in the screen's top half -,
  // where it would be when only they are shown; the gold at the screen's top right (its foot right, the message
  // window at the top)
  layoutPanels(msg = this.msg) {
    const pos = msg?.position ?? 2, W = screenW(), H = fittingHeight(4), K = MW / PPM;
    const cy = pos === 0 ? 0.22 : pos === 1 ? -0.05 : -0.32;
    const left = -W * K / 2, top = cy + H * K / 2;
    const at = (mesh, x, y, w, h, z) => mesh.position.set(left + (x + w / 2) * K, top - (y + h / 2) * K, z);
    at(this.msgPanel.mesh, 0, 0, W, H, 0);
    if (this.nameW) at(this.namePanel.mesh, 116, pos === 0 ? H - 16 : -16, this.nameW, 28, 0.004);
    const [cw, ch] = this.choice.panel.shown.map(v => v / MW);
    at(this.choice.panel.mesh, W - cw, pos === 2 ? -ch : H, cw, ch, 0.01);
    const screenY = sy => 0.22 + (60 - sy) * 0.0015;
    this.goldPanel.mesh.position.set((W / 2 - 80) * K, screenY(pos === 0 ? screenH() - 24 : 24), 0.004);
  }
  closeMessage() {
    if (this.scroll?.msg === this.msg) this.endScroll();
    this.msg = null;
    this.msgPanel.mesh.visible = false;
    this.namePanel.mesh.visible = false;
    this.goldPanel.mesh.visible = false;
    this.choice.close();
    this.consumedConfirm = true;
    this.actionLockUntil = G.time + 0.25;
    if (this.remote) this.remote.shown = false;     // (the host's, if one is up, comes back on the window)
  }
  // ---- Show Scrolling Text (Window_ScrollText - the ending's staff roll, and three more): the whole screen's window,
  // unseen (no frame, no back), its lines in the game's font and codes 4 in from its padding, coming up from the
  // screen's foot and going off its top at speed / 2 pixels a frame - twice that while A (dash) or C (confirm) is held,
  // 25 while メッセージスキップ is held (PC Ctrl, VR A held - input.js skipHeld), unless the event says it may not be
  // hurried; the event goes on once the last line is gone. The screen here: 640 x 480 of the message windows' pixels,
  // its middle where the middle message window's is. The lines are drawn in pieces (SCROLL_PIECE high, only those in
  // sight) that rise together, cut to the window's inside by two clipping planes. (msg: this player's, or the host's
  // read by a co-op guest - its place kept: scrollOy)
  startScroll(msg) {
    this.endScroll();
    const s = MW, W = screenW();
    const ops = layoutText(msg.lines, (PAD + 4) * s, 0, s, this.msgPanel.ctx, fontSize(), (W - PAD - 4) * s);
    this.scroll = { msg, ops, height: ops.height / s + 1, oy: msg.scrollOy ?? -screenH(), pieces: new Map() };
    if (G.three?.renderer) G.three.renderer.localClippingEnabled = true;
    this.placeRoot(true);
    this.scrollGroup.visible = true;
    this.layoutScroll();
  }
  // one frame of it (fast: this player's own - it may hurry it); true once its last line has gone
  updateScroll(dt, fast = true) {
    const sc = this.scroll, msg = sc.msg, input = G.input;
    const hurry = fast && !msg.noFast;
    const skip = hurry && input.skipHeld();
    const rate = skip ? 25 : (msg.speed || 2) * (hurry && (input.rmButton(11) || input.rmButton(13)) ? 1 : 0.5);
    sc.oy += rate * 60 * Math.min(dt, 0.1);
    msg.scrollOy = sc.oy;
    this.layoutScroll();
    return sc.oy >= sc.height;
  }
  layoutScroll() {
    const sc = this.scroll, W = screenW(), H = screenH(), K = MW / PPM;
    // the screen's top left (its middle where the middle message window's is - layoutPanels), the lines' top 12 - oy under it
    this.scrollGroup.position.set(-W * K / 2, -0.05 + H * K / 2, 0.02);
    this.scrollMover.position.y = -(PAD - sc.oy) * K;
    const first = Math.max(0, Math.floor(sc.oy / SCROLL_PIECE)), last = Math.min(Math.ceil(sc.height / SCROLL_PIECE) - 1, Math.floor((sc.oy + H) / SCROLL_PIECE));
    for (const [k, mesh] of sc.pieces) if (k < first || k > last) { this.dropPiece(mesh); sc.pieces.delete(k); }
    for (let k = first; k <= last; k++) if (!sc.pieces.has(k)) sc.pieces.set(k, this.scrollPiece(k));
    // the window's inside: from its padding under the top to its padding over the foot (world planes, as it stands now)
    const g = this.scrollGroup;
    g.updateWorldMatrix(true, false);
    this.scrollClip[0].set(new THREE.Vector3(0, -1, 0), -PAD * K).applyMatrix4(g.matrixWorld);
    this.scrollClip[1].set(new THREE.Vector3(0, 1, 0), (H - PAD) * K).applyMatrix4(g.matrixWorld);
  }
  // the lines' piece k (SCROLL_PIECE original pixels from k times that)
  scrollPiece(k) {
    const sc = this.scroll, s = MW, W = screenW(), K = MW / PPM;
    const canvas = document.createElement('canvas');
    canvas.width = W * s; canvas.height = SCROLL_PIECE * s;
    const ctx = canvas.getContext('2d'), top = k * SCROLL_PIECE * s, bottom = top + SCROLL_PIECE * s;
    ctx.translate(0, -top);
    drawOps(ctx, sc.ops.filter(o => o.y !== undefined && o.y < bottom && o.y + 96 * s > top), Infinity);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W * K, SCROLL_PIECE * K),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, clippingPlanes: this.scrollClip }));
    mesh.renderOrder = 3100;
    mesh.position.set(W * K / 2, -(k + 0.5) * SCROLL_PIECE * K, 0);
    this.scrollMover.add(mesh);
    return mesh;
  }
  dropPiece(mesh) {
    this.scrollMover.remove(mesh);
    mesh.material.map.dispose(); mesh.material.dispose(); mesh.geometry.dispose();
  }
  endScroll() {
    const sc = this.scroll;
    this.scroll = null;
    this.scrollGroup.visible = false;
    if (sc) for (const mesh of sc.pieces.values()) this.dropPiece(mesh);
  }
  // ---- the host's message (a co-op guest - coop.js): what the host is reading shows here too, only to be read. It
  // types out and goes away as the host's does (its choices: the host picks), never holds this player up (walking, the
  // menu) and gives the window over to anything of this player's own meanwhile
  showRemoteMessage(m) {
    this.closeRemoteMessage();
    this.remote = { ...m, remote: true, reveal: 0, ops: null, total: 0, shown: false, choiceUp: false };
  }
  closeRemoteMessage() {
    const r = this.remote;
    this.remote = null;
    if (r && this.scroll?.msg === r) this.endScroll();
    if (!r?.shown) return;
    if (!this.msg) { this.msgPanel.mesh.visible = false; this.namePanel.mesh.visible = false; }
    if (r.choiceUp && this.msg?.state !== 'choice') this.choice.close();
  }
  updateRemote(dt = 0) {
    const r = this.remote;
    if (!r) return;
    if (this.msg || this.menuOpen || this.sceneOpen || this.prompt?.shown) {
      if (this.scroll?.msg === r) this.endScroll();
      if (r.shown && !r.scroll) {
        if (!this.msg) { this.msgPanel.mesh.visible = false; this.namePanel.mesh.visible = false; }
        if (r.choiceUp && this.msg?.state !== 'choice' && !this.prompt?.shown) this.choice.close();
      }
      r.shown = false; r.choiceUp = false;
      return;
    }
    // (the host's scrolling text: rising as there, from where it had got to - not hurried here; gone when it is gone)
    if (r.scroll) {
      if (!r.shown) { r.shown = true; this.startScroll(r); }
      else if (this.scroll?.msg === r && this.updateScroll(dt, false)) this.endScroll();
      return;
    }
    if (!r.shown) {
      r.shown = true;
      this.placeRoot(true);
      if (!r.ops) this.layoutMessage(r);
      this.msgPanel.mesh.visible = r.lines.length > 0 || !r.choices;
      this.drawMessage(r);
    }
    if (r.reveal < r.total) {
      r.typed = Math.min((r.typed || 0) + TEXT_CPS * dt, TEXT_CPS / 4);
      const n = Math.floor(r.typed);
      if (n > 0) { r.typed -= n; r.reveal = Math.min(r.total, r.reveal + n); this.drawMessage(r); }
    }
    else if (r.choices && !r.choiceUp) {
      r.choiceUp = true;
      this.choice.open('', r.choices.map(c => ({ text: c.text, enabled: true })), { index: -1, look: 'choice', onSelect: () => {}, onCancel: () => {} });
      this.choice.panel.mesh.visible = true;
      this.layoutPanels(r);
    }
  }
  updateMessage(dt = 0) {
    const msg = this.msg;
    const input = G.input;
    if (msg.state === 'scroll') {
      if (this.scroll?.msg !== msg || this.updateScroll(dt)) this.closeMessage();
      this.consumedConfirm = true;
      return;
    }
    // (the laser on the message window: the right trigger moves it on as A does - as on every other window)
    const ray = this.pointerRay();
    if (ray && (this.msgPanel.hit(ray) || this.namePanel.hit(ray))) this.pointerTarget = true;
    // (メッセージスキップ held: each message at once and on to the next - a choice or a number still waits)
    const skip = input.skipHeld();
    if (msg.state === 'typing') {
      if (input.advance() || skip) { this.consumedConfirm = true; msg.skip = true; msg.wait = 0; }
      if (msg.wait > 0) { msg.wait -= dt; if (msg.wait > 0) return; }
      msg.cursor ??= 0;
      // (the letters the time since the last frame types - what is over carried on; a long hitch a quarter second's at most)
      const fast = msg.skip || msg.instant;
      if (!fast) msg.typed = Math.min((msg.typed || 0) + TEXT_CPS * dt, TEXT_CPS / 4);
      let budget = fast ? Infinity : Math.floor(msg.typed);
      while (msg.cursor < msg.ops.length) {
        const o = msg.ops[msg.cursor];
        if (o.k === 'ch' || o.k === 'icon') {
          if (budget <= 0) break;
          msg.reveal++; budget--; msg.cursor++;
          if (!fast) msg.typed--;
          continue;
        }
        msg.cursor++;
        if (o.k === 'wait') { if (!msg.skip) { msg.wait = o.f * FRAME_S; break; } }
        else if (o.k === 'input') { msg.state = 'pause'; break; }
        else if (o.k === 'fast') msg.instant = o.on;
        else if (o.k === 'noinput') msg.noInput = true;
        else if (o.k === 'gold') this.showGold();
      }
      if (msg.cursor >= msg.ops.length && msg.state === 'typing') msg.state = 'done-typing';
      this.drawMessage();
      return;
    }
    if (msg.state === 'pause') {
      if (input.advance() || skip) { this.consumedConfirm = true; msg.state = 'typing'; msg.skip = skip; }
      else this.pauseTick(msg);
      return;
    }
    if (msg.state === 'done-typing') {
      if (msg.choices) {
        msg.state = 'choice';
        this.choice.open('', msg.choices.map(c => ({ text: c.text, enabled: c.enabled })), {
          index: -1, look: 'choice',
          onSelect: i => { msg.onChoice?.(i); this.closeMessage(); },
          onCancel: () => { if (msg.cancelable) { msg.onChoice?.(-1); this.closeMessage(); } },
        });
        this.choice.panel.mesh.visible = true;
        this.layoutPanels();
        return;
      }
      if (msg.number) { msg.state = 'number'; this.drawNumber(); return; }
      msg.state = 'waitInput';
      msg.waitAt = G.time;
      if (msg.noInput) { this.closeMessage(); return; }
    }
    if (msg.state === 'waitInput') {
      if (input.advance() || input.cancel() || (skip && G.time - (msg.waitAt ?? 0) >= SKIP_DWELL)) { this.closeMessage(); return; }
      this.pauseTick(msg);
      return;
    }
    if (msg.state === 'choice') {
      this.choice.update(this.pointerRay());
      this.consumedConfirm = true;
      return;
    }
    if (msg.state === 'number') { this.updateNumber(); this.consumedConfirm = true; }
  }
  // Number input (Input Number, e.g. how many souls to give at a level-up): like the original, the stick
  // picks a digit (left / right) and turns it (up / down, repeating while held); the laser can pick
  // "all" (the range's maximum), 0 or OK.
  drawNumber() {
    const n = this.msg.number;
    const [min, max] = n.range || [0, 10 ** n.digits - 1];
    n.min = min; n.max = Math.min(max, 10 ** n.digits - 1);
    n.value = Math.max(n.min, Math.min(n.max, n.value));
    if (n.cursor === undefined) n.cursor = Math.max(0, Math.min(n.digits - 1, Math.floor(Math.log10(Math.max(1, n.max)))));
    const digits = String(n.value).padStart(n.digits, '0').split('');
    const at = n.digits - 1 - n.cursor;
    // (in groups: an IP address's four numbers with dots between)
    const shown = digits.map((d, i) => (i === at ? `[${d}]` : ` ${d} `) + (n.group && i % n.group === n.group - 1 && i < n.digits - 1 ? '.' : '')).join('');
    // (a room code: only its digits and OK)
    const items = n.code ? [{ text: shown }, { text: tr('결정') }] : [
      { text: shown, right: `×${(10 ** n.cursor).toLocaleString()}` },
      { text: tr('최대 (전부)'), right: n.max.toLocaleString() },
      { text: '0', right: '' },
      { text: tr('결정'), right: n.value.toLocaleString() },
    ];
    const index = this.choice.visible && this.choice.items.length === items.length ? Math.max(0, this.choice.index) : 0;
    this.choice.open(n.code ? n.title || '' : tr('수량 / 숫자 입력'), items, {
      index,
      footer: G.vr ? tr('스틱 좌우: 자릿수 · 상하: 값 · A/트리거: 결정') : n.code ? tr('←→ 자릿수 · ↑↓ 값 · Enter 결정') : tr('←→ 자릿수 · ↑↓ 값 · Home 최대 · End 0 · Enter 결정'),
    });
    this.layoutPanels();
  }
  numberDone() {
    const n = this.msg.number;
    if (n.onDone) { this.closeMessage(); n.onDone(n.value); return; }
    G.state.setV(n.varId, n.value);
    this.closeMessage();
  }
  updateNumber() {
    const n = this.msg.number;
    const input = G.input;
    let move = 0, turn = 0;
    if (G.vr) {
      const [x, y] = input.axes.right;
      if (Math.abs(x) > 0.6 && Math.abs(x) > Math.abs(y)) { if (this.numReady) { move = Math.sign(x); this.numReady = false; } }
      else if (Math.abs(x) < 0.35) this.numReady = true;
      if (Math.abs(y) > 0.6 && Math.abs(y) >= Math.abs(x)) {
        const dir = -Math.sign(y);
        if (n.holdDir !== dir) { n.holdDir = dir; n.nextTurn = G.time + 0.35; turn = dir; }
        else if (G.time >= n.nextTurn) { n.nextTurn = G.time + 0.07; turn = dir; }
      } else if (Math.abs(y) < 0.35) n.holdDir = 0;
    } else {
      if (input.keyPressed('ArrowRight') || input.keyPressed('KeyD')) move = 1;
      if (input.keyPressed('ArrowLeft') || input.keyPressed('KeyA')) move = -1;
      if (input.keyPressed('ArrowUp') || input.keyPressed('KeyW')) turn = 1;
      if (input.keyPressed('ArrowDown') || input.keyPressed('KeyS')) turn = -1;
      if (input.keyPressed('Home')) { n.value = n.max; this.drawNumber(); }
      if (input.keyPressed('End')) { n.value = n.min; this.drawNumber(); }
    }
    let changed = false;
    if (move) { n.cursor = Math.max(0, Math.min(n.digits - 1, n.cursor - move)); changed = true; }
    if (turn) {
      // (a digit turns round by itself - 9 to 0, 0 to 9 - as the original's: the others stay as they are)
      const place = 10 ** n.cursor, d = Math.floor(n.value / place) % 10;
      n.value = Math.max(n.min, Math.min(n.max, n.value + ((((d + turn) % 10) + 10) % 10 - d) * place));
      changed = true;
    }
    // the laser: hover picks a row, the trigger uses it
    let pick = -1;
    const ray = this.pointerRay();
    if (ray) {
      const uv = this.choice.panel.hit(ray);
      if (uv) {
        this.pointerTarget = true;
        const r = this.choice.rowAt(uv);
        if (r >= 0 && r < this.choice.items.length) {
          if (r !== this.choice.index) { this.choice.index = r; changed = true; }
          if (input.xrPressed('right', 0)) pick = r;
        }
      }
    }
    if (changed) { this.drawNumber(); G.audio?.playSystemSe(0); }
    if (n.code) {
      if (pick >= 0 || input.xrPressed('right', 4) || (!G.vr && input.confirm())) { G.audio?.playSystemSe(1); this.numberDone(); return; }
      if (input.cancel()) { G.audio?.playSystemSe(2); this.closeMessage(); n.onCancel?.(); }
      return;
    }
    if (pick === 1) { n.value = n.max; this.drawNumber(); G.audio?.playSystemSe(1); return; }
    if (pick === 2) { n.value = n.min; this.drawNumber(); G.audio?.playSystemSe(1); return; }
    if (pick === 0 || pick === 3 || input.xrPressed('right', 4) || (!G.vr && input.confirm())) { G.audio?.playSystemSe(1); this.numberDone(); return; }
    if (input.cancel()) { G.audio?.playSystemSe(2); this.numberDone(); }
  }
}
