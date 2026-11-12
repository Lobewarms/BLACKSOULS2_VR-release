// A macro (macros.js) run from its quick slot: its steps one after another, each as it would be from its own quick slot
// (useQuickEntry) or the equipment menu, the next one only once the one before is done - a spell or a throwable in the
// hand till it is let go, a bottle / syringe / resin in the hand (VR) till used, a weapon art on the weapon till its blow
// lands, a drink till drunk; a piece of equipment put on in the slot of its kind (a moment for it to be in hand). A step
// that cannot be done now (none left, MP short, cooling, not to be worn) is passed over - its own message says why. The
// quick button (VR: X, PC: Q) stops it (and puts away what it put in the hand), as do death, a transfer, the menu, a
// message or scene, or another quick slot used meanwhile.
import { G } from '../globals.js';
import { tr } from '../i18n.js';
import { macroOf, stepData } from '../macros.js';
import { stripEscapes } from '../uitext.js';

const GAP = 0.3;            // s between two steps that are over at once (an item drunk in a gulp, a buff)
const EQUIP_GAP = 0.4;      // s after putting a piece on (the weapon in hand, its look)

// (never made: its methods are CombatSystem's own - mixed into it in combat.js)
export class MacroPart {
  runMacro(id) {
    const m = macroOf(id);
    if (!m || !m.steps.length || this.playerDead) { G.audio?.playSystemSe(3); return false; }
    this.macroRun = { m, i: 0, wait: null, until: 0, fired: 0 };
    G.input.haptic('left', 0.3, 30);
    this.macroStep();
    return true;
  }
  stopMacro() { this.macroRun = null; }
  // each frame: on to the next step once this one is done
  updateMacro(paused) {
    const r = this.macroRun;
    if (!r) return;
    if (this.playerDead || this.spectating || G.map?.transferring || G.ui.menuOpen || G.ui.msg || G.ui.sceneOpen) { this.stopMacro(); return; }
    if (paused || G.time < r.until || !this.macroStepDone(r)) return;
    if (++r.i >= r.m.steps.length) { this.macroRun = null; return; }
    this.macroStep();
  }
  macroStepDone(r) {
    switch (r.wait) {
      case 'ready': return !this.ready || (this.readyFired || 0) > r.fired;      // (a knife stays in the hand: one thrown)
      case 'held': return !this.held;
      case 'drink': return !this.healing;
      case 'arm': return !this.skillArm;
      default: return true;
    }
  }
  macroStep() {
    const r = this.macroRun, s = r.m.steps[r.i];
    r.wait = null; r.until = G.time + GAP;
    const d = stepData(s);
    if (!d) return;
    if (s.kind === 'weapon' || s.kind === 'armor') { this.macroEquip(s, d); return; }
    r.fired = this.readyFired || 0;
    if (!this.useQuickEntry({ kind: s.kind, id: s.id })) return;
    if (this.ready) r.wait = 'ready';
    else if (this.held) r.wait = 'held';
    else if (this.healing) r.wait = 'drink';
    else if (this.skillArm) r.wait = 'arm';
  }
  // a piece of equipment put on, as the equipment menu does: a weapon in the first slot, armour in the slot of its kind
  // (on already: nothing to do)
  macroEquip(s, d) {
    const a = G.state.party.leader(), r = this.macroRun;
    if (!a) return;
    const fail = msg => { G.ui.toast(`${stripEscapes(d.name)}: ${msg}`, d.icon_index); G.audio?.playSystemSe(3); };
    if (a.equips.some(e => e && e.kind === s.kind && e.id === s.id)) return;
    const etype = slot => (slot === 0 ? 0 : Math.min(slot, 4));
    const slot = s.kind === 'weapon' ? 0 : a.equips.findIndex((e, i) => i > 0 && etype(i) === d.etype_id);
    const wears = s.kind === 'weapon' ? a.featuresSet(51).includes(d.wtype_id) : a.featuresSet(52).includes(d.atype_id);
    if (slot < 0 || !wears) return fail(tr('장착할 수 없습니다'));
    if (G.state.party.itemCount(s.kind, s.id) <= 0) return fail(tr('가지고 있지 않습니다'));
    a.changeEquipById(slot, s.id);
    this.equipKey = null;                          // (the hands' models made again - gear.js)
    G.audio?.playSystemSe(4);
    r.until = G.time + EQUIP_GAP;
  }
}
