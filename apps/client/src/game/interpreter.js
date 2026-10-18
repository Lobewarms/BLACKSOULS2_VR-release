// Event command interpreter (Game_Interpreter port, VX Ace command codes).
import { G, SCENE_REQUESTS } from '../core/globals.js';
import { BALLOON_TIME } from '../ui/balloons.js';
import { tr } from '../ui/i18n.js';
import { $data } from '../data/data.js';
import { runRuby, evalRuby } from './rubyexpr.js';
import { commonEventList } from '../entities/character.js';
import { itemData } from './state.js';
import { steamAchievementName } from './steam-achievements.js';
import { ambientMapTone, isMapAmbientTone } from '../world/ambient-tone.js';

// the interpreter running a command right now (the innermost): what kind of run made a change to the world
// (coopworld.js writeSyncs)
let running = null;
export const runningInterpreter = () => running;

export class Interpreter {
  // kind: what kind of run it is - 'main', the map's own (what a player began, a cutscene, a fight an event began);
  // 'parallel', a parallel process; 'symbol', a roaming monster's fight; '' a fight's own (its troop's pages, a skill's
  // common event)
  constructor(depth = 0, main = false, kind = '') {
    this.depth = depth;
    this.main = main;
    this.kind = kind || (main ? 'main' : '');
    this.clear();
  }
  clear() {
    this.killMode = false;
    this.mapId = 0; this.eventId = 0; this.list = null; this.index = 0;
    this.waitCount = 0; this.waitMode = ''; this.child = null; this.branch = {};
    this.saveRequest = null;
    this.indent = 0; this.params = null; this.choiceGroup = null; this.battle = null;
    this.battleBgmBefore = undefined;
    this.undo = null;
  }
  // what an event's run changed (switches, variables, self switches: key -> the value before), kept on its root so a
  // fight it starts and that is never finished can be undone with all of it (combat.js undoFightEvent): its scene then
  // plays again from its start, not over what it already did (살인귀 잭's scene killing the girl a second time while she
  // was already gone - the move route's picture stayed on her, and she stood up again when the fight was over)
  noteUndo(key, old) {
    const r = this.root || this;
    if (!(r.eventId > 0)) return;
    if (!r.undo) r.undo = new Map();
    if (!r.undo.has(key)) r.undo.set(key, old);
  }
  setup(list, eventId = 0) {
    this.clear();
    this.executionId = (this.executionId || 0) + 1;
    this.mapId = G.map.mapId;
    this.eventId = eventId;
    this.list = list;
  }
  running() { return !!this.list; }
  terminate() { this.list = null; this.child = null; }
  event() { return this.eventId > 0 && this.mapId === G.map.mapId ? G.map.events[this.eventId] : null; }
  isMainTree() { return (this.root || this).main; }

  update() {
    const was = running;
    running = this;
    try {
      let guard = 0;
      while (this.running()) {
        if (this.updateChild() || this.updateWait()) break;
        if (G.map.transferring) break;
        if (!this.executeCommand()) break;
        if (++guard > 5000) { console.warn('interpreter: too many commands in one frame', this.eventId); break; }
      }
    } finally { running = was; }
  }
  updateChild() {
    if (!this.child) return false;
    this.child.update();
    if (this.child.running()) return true;
    this.child = null;
    return false;
  }
  updateWait() {
    if (this.waitCount > 0) { this.waitCount--; return true; }
    switch (this.waitMode) {
      case 'message': if (G.ui.messageBusy()) return true; break;
      case 'route': {
        const c = this.waitChar;
        if (c && c.moveRouteForcing) return true;
        break;
      }
      case 'routeAll':
        if (G.map.anyForcedRoute()) return true;
        break;
      case 'battle': if (this.battle && !this.battle.done) return true; break;
      case 'transfer': if (G.map.transferring) return true; break;
      case 'balloon':
        if (this.waitChar && this.waitChar.balloonId && (this.balloonGuard = (this.balloonGuard || 0) + 1) < 120) return true;
        this.balloonGuard = 0;
        break;
      case 'scene': if (G.ui.sceneBusy()) return true; break;
      case 'save': if (this.saveRequest?.pending || G.ui.sceneBusy()) return true; break;
      default: break;
    }
    this.waitMode = '';
    return false;
  }
  wait(frames) { this.waitCount = Math.max(0, Math.floor(frames)); }
  current() { return this.list[this.index]; }
  nextCode() { return this.list[this.index + 1]?.code ?? 0; }
  skipBranch() { while (this.list[this.index + 1] && this.list[this.index + 1].indent > this.indent) this.index++; }

  executeCommand() {
    const cmd = this.list[this.index];
    if (!cmd) { this.terminate(); return true; }
    this.params = cmd.parameters;
    this.indent = cmd.indent;
    const fn = this['c' + cmd.code];
    if (fn) {
      let r;
      try { r = fn.call(this); } catch (e) { console.error('command error', cmd.code, cmd.parameters, e); r = true; }
      if (r === false) return false;
    }
    this.index++;
    return true;
  }

  character(param) {
    if (param < 0) return G.map.playerChar;
    if (param === 0) return this.event() || null;
    return G.map.events[param] || null;
  }

  // ---------------------------------------------------------------- messages
  // killMode (NPC cut down with the sword): messages before the kill choice are skipped and the
  // "살해한다" option is chosen automatically; everything after it runs normally.
  killChoice() {
    const msg = { lines: [] };
    this.setupChoices(msg);
    const i = msg.choices.findIndex(c => /살해|殺害|殺す|殺し|杀害|杀死|\bkill/i.test(c.text));
    if (i < 0) { this.killMode = false; return false; }
    msg.onChoice(i);
    this.killMode = false;
    return true;
  }
  c101() {
    if (G.ui.messageBusy()) return false;
    if (this.killMode) {
      const start = this.index;
      while (this.nextCode() === 401) this.index++;
      if (this.nextCode() === 102) {
        this.index++;
        if (this.resolveChoiceGroup()) return true;
        if (this.killChoice()) return true;
        this.index = start;      // no kill option here: show the message normally
      } else return true;
    }
    const [faceName, faceIndex, background, position] = this.params;
    const lines = [], at = this.index;          // (at: where it stands - co-op guests put it up from their own copy, coop.js onSay)
    while (this.nextCode() === 401) { this.index++; lines.push(this.list[this.index].parameters[0]); }
    const msg = { face: faceName, faceIndex, background, position, lines, choices: null, number: null, at };
    switch (this.nextCode()) {
      case 102: this.index++; this.setupChoices(msg); break;
      case 103: this.index++; this.setupNumberInput(msg, this.list[this.index].parameters); break;
      default: break;
    }
    G.ui.showMessage(msg, this);
    G.coop?.onSay?.(this, msg);            // (co-op: the guests in this world read it too - coop.js)
    this.index++;
    this.waitMode = 'message';
    return false;
  }
  c102() {
    if (G.ui.messageBusy()) return false;
    if (this.resolveChoiceGroup()) return true;
    if (this.killMode && this.killChoice()) return true;
    const msg = { face: '', faceIndex: 0, background: 0, position: 2, lines: [], choices: null, at: this.index };
    this.setupChoices(msg);
    G.ui.showMessage(msg, this);
    G.coop?.onSay?.(this, msg);
    this.index++;
    this.waitMode = 'message';
    return false;
  }
  // 選択肢拡張: consecutive "Show Choices" blocks merge into one list; "if(cond)" hides items.
  setupChoices(msg) {
    const groupIdx = [];
    let i = this.index;
    const indent = this.list[i].indent;
    while (i < this.list.length && this.list[i].code === 102 && this.list[i].indent === indent) {
      groupIdx.push(i);
      let j = i + 1;
      while (j < this.list.length && !(this.list[j].code === 404 && this.list[j].indent === indent)) j++;
      i = j + 1;
    }
    const items = []; // {text, block, local, enabled}
    let cancelType = 0, cancelBlock = -1;
    groupIdx.forEach((ci, b) => {
      const [choices, ct] = this.list[ci].parameters;
      choices.forEach((raw, k) => {
        let text = String(raw);
        let visible = true, enabled = true;
        text = text.replace(/if\((.+?)\)/g, (_, cond) => { visible = visible && this.choiceCond(cond); return ''; });
        text = text.replace(/en\((.+?)\)/g, (_, cond) => { enabled = enabled && this.choiceCond(cond); return ''; });
        if (visible) items.push({ text: text.trim(), block: b, local: k, enabled });
      });
      if (ct > 0) { cancelType = ct; cancelBlock = b; }
    });
    this.choiceGroup = { indices: groupIdx, results: null };
    msg.choices = items.map(it => ({ text: it.text, enabled: it.enabled }));
    msg.choiceAt = items.map(it => [it.block, it.local]);        // (which of them show - co-op guests, coop.js onSay)
    msg.cancelable = cancelType > 0;
    msg.onChoice = n => {
      const results = new Map();
      groupIdx.forEach(ci => results.set(ci, -1));
      if (n < 0) {
        // cancel: branch value is (cancel_type - 1); 4 means the dedicated cancel branch
        if (cancelBlock >= 0) results.set(groupIdx[cancelBlock], cancelType - 1 >= 4 ? 4 : cancelType - 1);
      } else {
        const it = items[n];
        results.set(groupIdx[it.block], it.local);
      }
      this.choiceGroup.results = results;
      this.branch[indent] = results.get(groupIdx[0]);
      // The first block resumes directly after this callback. Only later
      // merged blocks still need their answer; a label loop must ask anew.
      results.delete(groupIdx[0]);
    };
  }
  choiceCond(cond) {
    const js = cond.replace(/\bs\[(\d+)\]/g, '$game_switches[$1]').replace(/\bv\[(\d+)\]/g, '$game_variables[$1]');
    return !!evalRuby(js);
  }
  resolveChoiceGroup() {
    const g = this.choiceGroup;
    if (!g || !g.results || !g.results.has(this.index)) return false;
    this.branch[this.indent] = g.results.get(this.index);
    g.results.delete(this.index);
    return true;
  }
  c402() { if (this.branch[this.indent] !== this.params[0]) this.skipBranch(); return true; }
  c403() { if (this.branch[this.indent] !== 4) this.skipBranch(); return true; }
  setupNumberInput(msg, params) {
    const [varId, digits] = params;
    msg.number = { varId, digits, value: G.state.v(varId), range: G.ui.numberRange };
    G.ui.numberRange = null;
  }
  c103() {
    if (G.ui.messageBusy()) return false;
    const msg = { face: '', lines: [], position: 2 };
    this.setupNumberInput(msg, this.params);
    G.ui.showMessage(msg, this);
    this.waitMode = 'message';
    this.index++;
    return false;
  }
  // Select Key Item: the key items in the bag to pick one from (the library's 소울 연성 takes a soul this way); the
  // variable gets its id, 0 when none is picked
  c104() {
    if (G.ui.messageBusy()) return false;
    G.ui.openKeyItemChoice(this.params[0]);
    this.waitMode = 'scene';
    return true;
  }
  c105() {
    if (G.ui.messageBusy()) return false;
    const lines = [], at = this.index;
    while (this.nextCode() === 405) { this.index++; lines.push(this.list[this.index].parameters[0]); }
    const msg = { face: '', lines, position: 1, scroll: true, at };
    G.ui.showMessage(msg, this);
    G.coop?.onSay?.(this, msg);
    this.index++;
    this.waitMode = 'message';
    return false;
  }
  c108() {
    // comments: name window control (A1 ネームウィンドウ), BGM / BGS fade-in (A1 Audioフェードイン)
    const prev = this.list[this.index - 1];
    const text = [this.params[0]];
    while (this.nextCode() === 408) { this.index++; text.push(this.list[this.index].parameters[0]); }
    for (const t of text) {
      let m;
      if ((m = /^ネームウィンドウ\s*(on|off)/i.exec(t))) G.ui.nameWindowEnabled = m[1].toLowerCase() === 'on';
      else if ((m = /^NW名前指定\s*(.+)$/.exec(t))) G.ui.nextName = m[1].trim();
      else if ((m = /^NWインデックス\s*(\d+)/.exec(t))) G.ui.nextNameIndex = +m[1];
      // (only right after Play BGM / BGS, as the script checks: that one comes up from silence to the volume)
      else if ((m = /^Audioフェードイン\s*(\d+)\s*,\s*(\d+)/.exec(t)) && (prev?.code === 241 || prev?.code === 245)) {
        const kind = prev.code === 241 ? 'bgm' : 'bgs', audio = prev.parameters[0];
        if (this.mapMusicDeferred()) G.combat.deferMapMusic(kind, audio?.name ? { ...audio, volume: +m[1] } : audio);
        else G.audio.fadeIn(kind, +m[1], +m[2]);
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- flow
  c111() {
    const p = this.params;
    const st = G.state;
    let result = false;
    switch (p[0]) {
      case 0: result = st.sw(p[1]) === (p[2] === 0); break;
      case 1: {
        const v1 = st.v(p[1]);
        const v2 = p[2] === 0 ? p[3] : st.v(p[3]);
        result = [v1 === v2, v1 >= v2, v1 <= v2, v1 > v2, v1 < v2, v1 !== v2][p[4]];
        break;
      }
      case 2:
        if (this.eventId > 0) result = st.selfSw(this.mapId, this.eventId, p[1]) === (p[2] === 0);
        break;
      case 3: {
        if (st.system.timer.working) {
          const sec = Math.floor(st.system.timer.count / 60);
          result = p[2] === 0 ? sec >= p[1] : sec <= p[1];
        }
        break;
      }
      case 4: {
        const a = st.actor(p[1]);
        if (a) {
          switch (p[2]) {
            case 0: result = st.party.actors.includes(p[1]); break;
            case 1: result = a.name === p[3]; break;
            case 2: result = a.classId === p[3]; break;
            case 3: result = a.skills.includes(p[3]); break;
            case 4: result = a.isEquipped('weapon', p[3]); break;
            case 5: result = a.isEquipped('armor', p[3]); break;
            case 6: result = a.isState(p[3]); break;
            default: break;
          }
        }
        break;
      }
      case 5: result = G.combat?.enemyCondition?.(p[1], p[2], p[3], this) ?? false; break;
      case 6: { const c = this.character(p[1]); result = !!c && c.direction === p[2]; break; }
      case 7: {
        const g = st.party.gold;
        result = [g >= p[1], g <= p[1], g < p[1]][p[2]];
        break;
      }
      case 8: result = st.party.hasItem('item', p[1]); break;
      case 9: result = st.party.hasItem('weapon', p[1], p[2]); break;
      case 10: result = st.party.hasItem('armor', p[1], p[2]); break;
      case 11: result = G.input?.rmButton?.(p[1]) ?? false; break;
      case 12: result = !!evalRuby(p[1], { self: this.event() }); break;
      case 13: result = false; break;
      default: break;
    }
    this.branch[this.indent] = result;
    if (!result) this.skipBranch();
    return true;
  }
  c411() { if (this.branch[this.indent] !== false) this.skipBranch(); return true; }
  c112() { return true; }
  c413() {
    do { this.index--; } while (this.list[this.index].indent !== this.indent);
    return true;
  }
  c113() {
    let depth = 0;
    while (this.index < this.list.length - 1) {
      this.index++;
      const c = this.list[this.index];
      if (c.code === 413 && c.indent < this.indent) break;
      if (c.indent < this.indent && c.code !== 413) { /* keep scanning */ }
    }
    void depth;
    return true;
  }
  c115() { this.index = this.list.length; return true; }
  c117() {
    const id = this.params[0];
    // (a co-op guest running an event of the host's world - a boss fight its guests run: its scenes and its deaths stay out)
    if (G.coop?.phantom && G.coop.skipsCommonEvent?.(id)) return true;
    // (the developer's world: the scenes stay out; the next cycle's preparation (周回プレイ準備) is everyone's to say -
    // a vote, this run waiting for it: passed, it goes on as the original's; else nothing - coop.js cycleVote)
    if (G.coop?.role === 'world') {
      if (G.coop.worldSkips?.(id)) return true;
      const v = G.coop.cycleVote?.(this, id);
      if (v === 'wait') { this.waitCount = 6; return false; }
      if (v === 'no') return true;
    }
    if (id === 11) {
      // 全滅処理 (death -> bonfire) must survive the map change: always run it on the main interpreter
      if (!this.isMainTree()) { G.combat?.onPartyDead(); this.terminate(); return false; }
      G.combat?.onDeathCommonEvent();
    }
    if (id === 1 && !G.coop?.phantom) G.onBonfire?.();   // 篝火: resting at a bonfire -> every enemy back, VR autosave
    const list = commonEventList(id);
    if (list) {
      this.child = new Interpreter(this.depth + 1);
      this.child.root = this.root || this;
      this.child.setup(list, this.eventId);
      this.child.mapId = this.mapId;
    }
    return true;
  }
  c118() { return true; }
  c119() {
    const label = this.params[0];
    for (let i = 0; i < this.list.length; i++) {
      const c = this.list[i];
      if (c.code === 118 && c.parameters[0] === label) { this.index = i; break; }
    }
    return true;
  }

  // ---------------------------------------------------------------- state
  c121() {
    for (let i = this.params[0]; i <= this.params[1]; i++) { this.noteUndo(`S:${i}`, G.state.sw(i)); G.state.setSw(i, this.params[2] === 0); }
    return true;
  }
  operateValue(op, type, operand) {
    const v = type === 0 ? operand : G.state.v(operand);
    return op === 0 ? v : -v;
  }
  c122() {
    const p = this.params;
    let value = 0;
    switch (p[3]) {
      case 0: value = p[4]; break;
      case 1: value = G.state.v(p[4]); break;
      case 2: value = p[4] + Math.floor(Math.random() * (p[5] - p[4] + 1)); break;
      case 3: value = this.gameDataOperand(p[4], p[5], p[6]); break;
      case 4: value = evalRuby(p[4], { self: this.event() }); break;
      default: break;
    }
    for (let i = p[0]; i <= p[1]; i++) this.operateVariable(i, p[2], value);
    return true;
  }
  operateVariable(id, op, value) {
    const before = G.state.v(id);
    let v = before;
    switch (op) {
      case 0: v = value; break;
      case 1: v += value; break;
      case 2: v -= value; break;
      case 3: v *= value; break;
      case 4: v = value !== 0 ? Math.trunc(v / value) : 0; break;
      case 5: v = value !== 0 ? v % value : 0; break;
      default: break;
    }
    if (typeof v === 'number') v = Math.max(-99999999, Math.min(99999999, v));
    this.noteUndo(`V:${id}`, before);
    G.state.setV(id, v);
    // BLACKSOULS II's SEN reminder (its own script): the SEN switches follow every change of SEN, and a change -
    // not the reset to full - shows
    const sen = G.scripts?.sen;
    if (sen && id === sen.variable) {
      const now = G.state.v(id);
      if (!(op === 0 && value === sen.reset) && typeof now === 'number' && typeof before === 'number' && now !== before) G.ui?.notifySen?.(now - before);
      for (const [sw, at] of sen.switches) { this.noteUndo(`S:${sw}`, G.state.sw(sw)); G.state.setSw(sw, now <= at); }
    }
  }
  gameDataOperand(type, p1, p2) {
    const st = G.state;
    switch (type) {
      case 0: return st.party.itemCount('item', p1);
      case 1: return st.party.itemCount('weapon', p1);
      case 2: return st.party.itemCount('armor', p1);
      case 3: {
        const a = st.actor(p1);
        if (!a) return 0;
        if (p2 === 0) return a.level;
        if (p2 === 1) return a.currentExp;
        if (p2 === 2) return a.hp;
        if (p2 === 3) return a.mp;
        if (p2 >= 4 && p2 <= 11) return a.param(p2 - 4);
        return 0;
      }
      case 4: return G.combat?.enemyParam?.(p1, p2, this) ?? 0;
      case 5: {
        const c = this.character(p1);
        if (!c) return 0;
        if (p2 === 0) return c.x;
        if (p2 === 1) return c.y;
        if (p2 === 2) return c.direction;
        return 0;
      }
      case 6: return st.party.actors[p1] || 0;
      case 7:
        switch (p1) {
          case 0: return G.map.mapId;
          case 1: return st.party.actors.length;
          case 2: return st.party.gold;
          case 3: return st.party.steps;
          case 4: return Math.floor(st.system.playFrames / 60);
          case 5: return Math.floor(st.system.timer.count / 60);
          case 6: return st.system.saveCount;
          case 7: return st.system.battleCount;
          default: return 0;
        }
      default: return 0;
    }
  }
  c123() {
    if (this.eventId > 0) {
      this.noteUndo(`SS:${G.state.selfKey(this.mapId, this.eventId, this.params[0])}`, G.state.selfSw(this.mapId, this.eventId, this.params[0]));
      G.state.setSelfSw(this.mapId, this.eventId, this.params[0], this.params[1] === 0);
    }
    return true;
  }
  c124() {
    const t = G.state.system.timer;
    if (this.params[0] === 0) { t.working = true; t.count = this.params[1] * 60; } else t.working = false;
    return true;
  }
  c125() { G.state.party.gainGold(this.operateValue(this.params[0], this.params[1], this.params[2])); return true; }
  c126() {
    const n = this.operateValue(this.params[1], this.params[2], this.params[3]);
    G.state.party.gainItem('item', this.params[0], n);
    if (n > 0) G.ui.notifyGain?.('item', this.params[0], n);
    return true;
  }
  c127() {
    const n = this.operateValue(this.params[1], this.params[2], this.params[3]);
    G.state.party.gainItem('weapon', this.params[0], n, this.params[4]);
    if (n > 0) G.ui.notifyGain?.('weapon', this.params[0], n);
    return true;
  }
  c128() {
    const n = this.operateValue(this.params[1], this.params[2], this.params[3]);
    G.state.party.gainItem('armor', this.params[0], n, this.params[4]);
    if (n > 0) G.ui.notifyGain?.('armor', this.params[0], n);
    return true;
  }
  c129() {
    const [actorId, op, init] = this.params;
    if (!$data.actors[actorId]) return true;
    if (op === 0) {
      if (init) G.state.actorMap.delete(actorId);
      G.state.party.addActor(actorId);
    } else G.state.party.removeActor(actorId);
    G.map.requestRefresh();
    return true;
  }
  // Change Battle BGM (what it was before the event's first change is kept: a fight the event starts that is left
  // unfinished - the player walking off the map in the middle of it - gives it back, combat.reset)
  c132() {
    const root = this.root || this;
    if (root.battleBgmBefore === undefined) root.battleBgmBefore = G.state.system.battleBgm || null;
    G.state.system.battleBgm = this.params[0] || null;
    return true;
  }
  c133() { G.state.system.battleEndMe = this.params[0] || null; return true; }   // Change Battle End ME
  c134() { G.state.system.saveDisabled = this.params[0] === 0; return true; }
  c135() { G.state.system.menuDisabled = this.params[0] === 0; return true; }
  c136() { G.state.system.encounterDisabled = this.params[0] === 0; return true; }
  c137() { G.state.system.formationDisabled = this.params[0] === 0; return true; }
  c138() { return true; } // window color

  // ---------------------------------------------------------------- movement
  c201() {
    if (G.map.transferring || G.ui.messageBusy()) return false;
    const p = this.params;
    let mapId, x, y;
    if (p[0] === 0) { [mapId, x, y] = [p[1], p[2], p[3]]; }
    else { mapId = G.state.v(p[1]); x = G.state.v(p[2]); y = G.state.v(p[3]); }
    G.map.reserveTransfer(mapId, x, y, p[4], p[5]);
    this.waitMode = 'transfer';
    this.index++;
    return false;
  }
  c202() { return true; } // vehicle location
  c203() {
    const c = this.character(this.params[0]);
    if (!c || !c.isEvent) return true;
    const p = this.params;
    if (p[1] === 0) c.moveto(p[2], p[3]);
    else if (p[1] === 1) c.moveto(G.state.v(p[2]), G.state.v(p[3]));
    else {
      const o = this.character(p[2]);
      if (o) { const [ox, oy] = [o.x, o.y]; o.moveto(c.x, c.y); c.moveto(ox, oy); }
    }
    if (p[4] > 0) c.setDirection(p[4]);
    return true;
  }
  c204() { return true; } // scroll map
  c205() {
    const c = this.character(this.params[0]);
    if (c) {
      c.forceMoveRoute(this.params[1]);
      if (this.params[1].wait) { this.waitMode = 'route'; this.waitChar = c; }
    }
    return true;
  }
  c206() { return true; }
  c211() { G.map.playerChar.transparent = this.params[0] === 0; return true; }
  c212() {
    const c = this.character(this.params[0]);
    if (c) {
      G.screen?.playAnimationOn?.(c, this.params[1]);
      G.coop?.onFx?.(this, ['an', c === G.map.playerChar ? 0 : c.id | 0, this.params[1] | 0]);
      if (this.params[2]) this.wait(Math.min(120, G.screen?.animationFrames?.(this.params[1]) ?? 40));
    }
    return true;
  }
  c213() {
    const c = this.character(this.params[0]);
    if (c) {
      c.balloonId = this.params[1];
      c.balloonTime = BALLOON_TIME;
      if (this.params[2]) { this.waitMode = 'balloon'; this.waitChar = c; }
    }
    return true;
  }
  c214() { if (this.main && this.eventId > 0) this.event()?.erase(); else this.event()?.erase(); return true; }
  c216() { G.state.system.followers = this.params[0] === 0; return true; }   // followers (allies.js)
  c217() { return true; }

  // ---------------------------------------------------------------- screen
  c221() {
    if (G.ui.messageBusy()) return false;
    G.screen.fadeOut(30);
    this.wait(30);
    this.index++;
    return false;
  }
  c222() {
    if (G.ui.messageBusy()) return false;
    G.screen.fadeIn(30);
    this.wait(30);
    this.index++;
    return false;
  }
  c223() {
    const troop = (this.root || this).troop;
    const battle = troop ? G.combat?.battleOf?.(this) : null;
    // The original random BGM/weather common event also selects a persistent
    // environmental grade. Exact map-note restores after cutscenes do too.
    // Identify the actual common-event list, never a similar-looking cutscene.
    const environment = !troop && ((!!this.list && this.list === $data.commonEvents[290]?.list)
      || isMapAmbientTone(this.params[0], G.map?.map?.note));
    const tone = environment ? ambientMapTone(this.params[0]) : this.params[0];
    if (!troop || battle && !battle.done) G.screen.startTone(tone, this.params[1], battle);
    if (this.params[2]) this.wait(this.params[1]);
    return true;
  }
  c224() {
    G.screen.startFlash(this.params[0], this.params[1]);
    const fc = this.params[0] || {};
    G.coop?.onFx?.(this, ['fl', ...[fc.red, fc.green, fc.blue, fc.alpha].map(v => Math.round(+v || 0)), Math.max(1, this.params[1] | 0)]);
    if (this.params[2]) this.wait(this.params[1]);
    return true;
  }
  c225() {
    G.screen.startShake(this.params[0], this.params[1], this.params[2]);
    if (this.params[3]) this.wait(this.params[2]);
    return true;
  }
  c230() { this.wait(this.params[0]); return true; }
  // Co-op's existing picture transport owns map IDs only.
  pictureCommand(code) {
    const troop = (this.root || this).troop;
    const battle = troop ? G.combat?.battleOf?.(this) : null;
    // VX Ace gives the troop its own Game_Screen. Common-event children share
    // that owner; an ended troop must never write into the map's picture IDs.
    if (troop && (!battle || battle.done)) return;
    if (code === 231) G.screen.showPicture?.(this.params, battle);
    else if (code === 232) G.screen.movePicture?.(this.params, battle);
    else G.screen.erasePicture?.(this.params[0], battle);
    if (!troop) G.coop?.onPicture?.(this, code, this.params);
  }
  c231() { this.pictureCommand(231); return true; }
  c232() {
    this.pictureCommand(232);
    if (this.params[11]) this.wait(this.params[10]);
    return true;
  }
  c233() { return true; }
  c234() { if (this.params[3]) this.wait(this.params[2]); return true; }
  c235() { this.pictureCommand(235); return true; }
  c236() {
    G.screen.setWeather?.(this.params[0], this.params[1], this.params[2]);
    if (this.params[3]) this.wait(this.params[2]);
    return true;
  }

  // ---------------------------------------------------------------- audio
  // while battle music plays, map events (a field BGM keeper running every frame) only change what comes
  // back after the fight: the original freezes the map during battles. The troop's events (boss phases) play.
  mapMusicDeferred() { return !!G.combat?.music?.played && !(this.root || this).troop; }
  c241() { if (this.mapMusicDeferred()) G.combat.deferMapMusic('bgm', this.params[0]); else G.audio.playBgm(this.params[0]); return true; }
  c242() { if (this.mapMusicDeferred()) G.combat.deferMapMusic('bgm', null); else G.audio.fadeOutBgm(this.params[0]); return true; }
  c243() { G.audio.saveBgm(); return true; }
  c244() { G.audio.replayBgm(); return true; }
  c245() { if (this.mapMusicDeferred()) G.combat.deferMapMusic('bgs', this.params[0]); else G.audio.playBgs(this.params[0]); return true; }
  c246() { if (this.mapMusicDeferred()) G.combat.deferMapMusic('bgs', null); else G.audio.fadeOutBgs(this.params[0]); return true; }
  c249() { G.audio.playMe(this.params[0]); this.mirrorSound('me', this.params[0]); return true; }
  c250() { if (!G.theater?.playSe(this.params[0])) G.audio.playSe(this.params[0]); this.mirrorSound('se', this.params[0]); return true; }
  // (co-op: the guests in this world hear it too - coop.js onFx)
  mirrorSound(kind, a) { if (a?.name) G.coop?.onFx?.(this, [kind, String(a.name), Math.round(+a.volume || 0), Math.round(+a.pitch || 100)]); }
  c251() { G.audio.stopSe(); return true; }
  c261() { return true; } // movie

  // ---------------------------------------------------------------- map
  c281() { return true; }
  c282() { G.map.changeTileset?.(this.params[0]); return true; }
  // Change Battle Back: the fight stands on the map itself; a stage play hangs it as the act's scenery (src/theater.js)
  c283() { G.theater?.battleBack(this.params[0]); return true; }
  c284() { G.map.changeParallax?.(this.params[0]); return true; }
  c285() {
    const [varId, type, desig, px, py] = this.params;
    const x = desig === 0 ? px : G.state.v(px), y = desig === 0 ? py : G.state.v(py);
    const g = G.map.grid;
    let v = 0;
    if (type === 0) v = g.terrainTag(x, y);
    else if (type === 1) v = G.map.eventIdXy(x, y);
    else if (type >= 2 && type <= 4) v = g.tile(x, y, type - 2);
    else if (type === 5) v = g.region(x, y);
    G.state.setV(varId, v);
    return true;
  }

  // ---------------------------------------------------------------- battle
  c301() {
    if (this.battle) {
      // battle finished: branch by result (0 win, 1 escape, 2 lose)
      if (!this.battle.done) return false;
      this.branch[this.indent] = this.battle.result;
      this.battle = null;
      this.foughtOut = true;              // (past its fight: its win / lose branch goes on even to another map - combat.reset)
      return true;
    }
    const p = this.params;
    let troopId = p[0] === 0 ? p[1] : p[0] === 1 ? G.state.v(p[1]) : 0;
    if (p[0] === 2) troopId = G.combat?.randomEncounterTroop?.() || 0;
    if (!$data.troops[troopId]) { this.branch[this.indent] = 0; return true; }
    this.battle = G.combat.startBattle({
      troopId, canEscape: p[2], canLose: p[3], event: this.event(), interpreter: this,
    });
    this.waitMode = 'battle';
    // a fight started by touching / talking to an event no longer holds the map: the event's commands
    // wait for the result on their own while menus, exits and other events stay usable
    const root = this.root || this;
    const ev = root.event();
    if (root === G.map.interpreter && ev && [0, 1, 2].includes(ev.trigger) && !this.battle.done) G.combat.detachInterpreter(root, this.battle);
    return false;
  }
  c601() { if (this.branch[this.indent] !== 0) this.skipBranch(); return true; }
  c602() { if (this.branch[this.indent] !== 1) this.skipBranch(); return true; }
  c603() { if (this.branch[this.indent] !== 2) this.skipBranch(); return true; }
  c302() {
    const goods = [this.params];
    while (this.nextCode() === 605) { this.index++; goods.push(this.list[this.index].parameters); }
    G.ui.openShop?.(goods, this.params[4]);
    this.waitMode = 'scene';
    return true;
  }
  c303() {
    // name input: the hero's is typed in the game's keyboard - English (it is this player's name over its head in
    // co-op too; the co-op menu changes that one later); others: desktop gets a prompt, VR keeps (or defaults) the name
    const a = G.state.actor(this.params[0]);
    if (!a) return true;
    if (this.params[0] === 1) {
      G.ui.openNameInput(a, this.params[1]);
      this.waitMode = 'scene';
      return true;
    }
    if (!G.vr && typeof prompt === 'function') {
      const n = prompt(tr('이름을 입력하세요'), a.name || '');
      if (n && n.trim()) a.name = n.trim().slice(0, Math.max(1, this.params[1] || 8));
    }
    if (!a.name) a.name = tr('이름 없는 자');
    return true;
  }

  // ---------------------------------------------------------------- actors
  iterateActors(desig, id, fn) {
    const st = G.state;
    if (desig === 0) {
      if (id === 0) st.party.members().forEach(fn);
      else { const a = st.actor(id); if (a) fn(a); }
    } else { const a = st.actor(st.v(id)); if (a) fn(a); }
  }
  c311() {
    const v = this.operateValue(this.params[2], this.params[3], this.params[4]);
    this.iterateActors(this.params[0], this.params[1], a => {
      if (!this.params[5] && a.hp + v <= 0) a.hp = 1; else a.hp = Math.max(0, Math.min(a.mhp, a.hp + v));
      if (a.hp <= 0) a.addState(1);
    });
    if (!G.combat?.eventDeathCheck?.(this) && G.state.party.allDead()) G.combat?.onPartyDead?.();
    return true;
  }
  c312() {
    const v = this.operateValue(this.params[2], this.params[3], this.params[4]);
    this.iterateActors(this.params[0], this.params[1], a => { a.mp = Math.max(0, Math.min(a.mmp, a.mp + v)); });
    return true;
  }
  c313() {
    this.iterateActors(this.params[0], this.params[1], a => {
      if (this.params[2] === 0) { a.addState(this.params[3]); G.combat?.eventStateAdded?.(a, this.params[3], this); }
      else a.removeState(this.params[3]);
    });
    // (co-op: a boss fight's rule on the whole party - the others in that fight get it too)
    if (this.params[0] === 0 && this.params[1] === 0) G.coop?.shareEventState?.(this.params[2] === 0, this.params[3], this);
    G.combat?.eventDeathCheck?.(this);
    return true;
  }
  c314() { this.iterateActors(this.params[0], this.params[1], a => a.recoverAll()); return true; }
  c315() {
    const v = this.operateValue(this.params[2], this.params[3], this.params[4]);
    this.iterateActors(this.params[0], this.params[1], a => a.changeExp(a.currentExp + v));
    return true;
  }
  c316() {
    const v = this.operateValue(this.params[2], this.params[3], this.params[4]);
    this.iterateActors(this.params[0], this.params[1], a => a.changeLevel(a.level + v));
    return true;
  }
  c317() {
    const v = this.operateValue(this.params[3], this.params[4], this.params[5]);
    this.iterateActors(this.params[0], this.params[1], a => a.addParam(this.params[2], v));
    return true;
  }
  c318() {
    this.iterateActors(this.params[0], this.params[1], a => {
      if (this.params[2] === 0) a.learnSkill(this.params[3]); else a.forgetSkill(this.params[3]);
    });
    return true;
  }
  c319() {
    const a = G.state.actor(this.params[0]);
    if (a) {
      const slot = this.params[1];
      const kind = slot === 0 ? 'weapon' : 'armor';
      if (itemData(kind, this.params[2]) || this.params[2] === 0) a.changeEquipById(slot, this.params[2]);
    }
    return true;
  }
  c320() { const a = G.state.actor(this.params[0]); if (a) a.name = this.params[1]; return true; }
  c321() { const a = G.state.actor(this.params[0]); if (a) a.classId = this.params[1]; return true; }
  c322() {
    const a = G.state.actor(this.params[0]);
    if (a) {
      a.characterName = this.params[1]; a.characterIndex = this.params[2];
      a.faceName = this.params[3]; a.faceIndex = this.params[4];
    }
    G.map.playerChar?.refreshGraphic?.();
    return true;
  }
  c323() { return true; }
  c324() { const a = G.state.actor(this.params[0]); if (a) a.nickname = this.params[1]; return true; }
  // enemy commands (only meaningful inside action battles)
  c331() { G.combat?.troopCommand?.(331, this.params, this); return true; }
  c332() { G.combat?.troopCommand?.(332, this.params, this); return true; }
  c333() { G.combat?.troopCommand?.(333, this.params, this); return true; }
  c334() { G.combat?.troopCommand?.(334, this.params, this); return true; }
  c335() { G.combat?.troopCommand?.(335, this.params, this); return true; }
  c336() { G.combat?.troopCommand?.(336, this.params, this); return true; }
  c337() { G.combat?.troopCommand?.(337, this.params, this); return true; }
  c339() { G.combat?.troopCommand?.(339, this.params, this); return true; }
  c340() { G.combat?.troopCommand?.(340, this.params, this); return true; }

  // Open Menu Screen: the event goes on once the menu is closed (the original's Scene_Menu; none in battle) -
  // 그랑・기뇰's 준비 opens it before 재도전 is asked again
  c351() {
    if ((this.root || this).troop) return true;
    G.ui.openMenu?.();
    this.waitMode = 'scene';
    return true;
  }
  c352() {
    if ((this.root || this).troop) return true;
    const request = this.saveRequest = { pending: true };
    this.waitMode = 'save';
    try {
      Promise.resolve(G.openSaveMenu({ event: true })).then(
        () => { request.pending = false; },
        error => { console.warn('Event save menu failed', error); request.pending = false; },
      );
    } catch (error) { request.pending = false; throw error; }
    return true;
  }
  // Game Over: the game ends there and goes to the title (main.js G.gameOver) - its run stops here. A co-op guest falls by the
  // server's rules instead
  c353() {
    if (G.coop?.phantom || !G.gameOver) { G.combat?.gameOver?.(); return true; }
    G.gameOver();
    return false;
  }
  c354() { G.ui.returnToTitle?.(); return true; }
  c355() {
    const commandIndex = this.index;
    let src = this.params[0];
    while (this.nextCode() === 655) { this.index++; src += '\n' + this.list[this.index].parameters[0]; }
    const achievement = steamAchievementName(src);
    if (achievement !== null) {
      G.steamAchievements?.record(achievement, { interpreter: this, commandIndex, source: src });
      return true;
    }
    const before = SCENE_REQUESTS.length;
    runRuby(src, { self: this.event(), interpreter: this });
    if (SCENE_REQUESTS.length > before) {
      const scene = SCENE_REQUESTS.splice(0).pop();
      G.ui.openScene?.(scene);
      this.waitMode = 'scene';
    }
    return true;
  }
}

// (a co-op guest - coop.js phantomExit) where a door, a stair or a map's edge of the host's world takes the player, as
// its event would: its branches on this world's switches and variables, a choice's first answer, up to its first
// Transfer Player - { m, x, y, d, fade, se } - or null. Nothing else of the event runs
export function exitOf(list, eventId = 0) {
  const it = new Interpreter();
  it.list = list; it.mapId = G.map.mapId; it.eventId = eventId;
  let se = null;
  for (let guard = 0; guard < 500 && it.list && it.index < list.length; guard++) {
    const cmd = list[it.index];
    if (!cmd) break;
    it.params = cmd.parameters; it.indent = cmd.indent;
    const p = cmd.parameters;
    switch (cmd.code) {
      case 111: it.c111(); break;
      case 411: it.c411(); break;
      case 102: it.branch[cmd.indent] = 0; break;
      case 402: it.c402(); break;
      case 403: it.c403(); break;
      case 250: se ||= p[0]; break;
      case 115: return null;
      case 201: {
        const [m, x, y] = p[0] === 0 ? [p[1], p[2], p[3]] : [G.state.v(p[1]), G.state.v(p[2]), G.state.v(p[3])];
        return { m, x, y, d: p[4] || 0, fade: p[5] || 0, se };
      }
      default: break;
    }
    it.index++;
  }
  return null;
}
