// The menu's 매크로 (macros.js): the macros there are - each one's steps under it - and a new one; for one: steps put in
// (three tabs as the item menu has: equipment, items, skills - the one picked goes on the end, and the tab stays open for
// the next), their order changed or one taken out, the quick slot it is in, deleted.
import { $data } from '../data.js';
import { G } from '../globals.js';
import { tr } from '../i18n.js';
import { MAX_MACROS, MAX_STEPS, deleteMacro, macroIcon, macroName, macroOf, macroSummary, macros, newMacro, stepData, stepKindName,
  stepName } from '../macros.js';
import { quickSlotOf } from '../quickslots.js';
import { itemData } from '../state.js';
import { stripEscapes } from '../uitext.js';

// (never made: its methods are UI's own - mixed into it in ui.js)
export class MacroMenuPart {
  showMacros(index = 0) {
    const list = macros();
    const items = list.map(m => {
      const slot = quickSlotOf({ kind: 'macro', id: m.id });
      return { text: macroName(m), icon: macroIcon(m) || undefined, id: m.id, desc: macroSummary(m),
        right: `${slot >= 0 ? `[${slot + 1}] ` : ''}${tr('{n}단계', { n: m.steps.length })}` };
    });
    items.push({ text: tr('새 매크로 만들기'), id: 'new', enabled: list.length < MAX_MACROS, desc: tr('장비·아이템·스킬을 넣은 순서대로 한 번에 쓰는 퀵슬롯') });
    this.grid.close();
    this.list.open(tr('매크로'), items, {
      index,
      onSelect: (i, it) => {
        if (it.id !== 'new') { this.showMacroActions(it.id); return; }
        const m = newMacro();
        if (m) this.showMacroAdd(m.id);
      },
      onCancel: () => this.reopenMain('macros'),
    });
  }
  showMacroActions(id, index = 0) {
    const m = macroOf(id);
    if (!m) { this.showMacros(); return; }
    const entry = { kind: 'macro', id };
    const slot = quickSlotOf(entry);
    const back = () => { if (this.menuOpen) this.showMacroActions(id, 2); };
    const sum = macroSummary(m);
    this.grid.close();
    this.list.open(tr('{name}  ({n}단계)', { name: macroName(m), n: m.steps.length }), [
      { text: tr('단계 추가'), id: 'add', enabled: m.steps.length < MAX_STEPS, desc: sum },
      { text: tr('순서 바꾸기·빼기'), id: 'steps', enabled: m.steps.length > 0, desc: sum },
      { text: slot >= 0 ? tr('퀵슬롯 ({n}번에 등록됨)', { n: slot + 1 }) : tr('퀵슬롯에 등록'), id: 'quick', enabled: m.steps.length > 0,
        desc: tr('퀵슬롯에서 쓰면 넣은 순서대로 씁니다 · 쓰는 동안 퀵슬롯 버튼(VR: X, PC: Q)을 누르면 멈춥니다') },
      { text: tr('매크로 지우기'), id: 'delete' },
      { text: tr('취소'), id: 'back' },
    ], {
      index,
      onSelect: (i, a) => {
        if (a.id === 'add') this.showMacroAdd(id);
        else if (a.id === 'steps') this.showMacroSteps(id);
        else if (a.id === 'quick') this.showQuickPicker(entry, back);
        else if (a.id === 'delete') this.showMacroDelete(id);
        else this.showMacros(macros().indexOf(m));
      },
      onCancel: () => this.showMacros(macros().indexOf(m)),
    });
  }
  // what can be put in: the equipment on and in the bag that can be worn, the items the quick slots take, the skills known
  showMacroAdd(id, tab = 0, index = 0) {
    const m = macroOf(id), a = G.state.party.leader();
    if (!m || !a) { this.showMacros(); return; }
    const party = G.state.party;
    const wears = (kind, d) => (kind === 'weapon' ? a.featuresSet(51).includes(d.wtype_id) : d.etype_id >= 1 && d.etype_id <= 4 && a.featuresSet(52).includes(d.atype_id));
    const equip = [];
    for (const e of a.equips) {
      const d = e?.id ? itemData(e.kind, e.id) : null;
      if (d?.name) equip.push({ text: d.name, icon: d.icon_index, kind: e.kind, id: e.id, right: tr('장비 중'), desc: stripEscapes(d.description || '') });
    }
    for (const kind of ['weapon', 'armor']) {
      for (const [eid, n] of [...party.container(kind)].sort((x, y) => x[0] - y[0])) {
        const d = itemData(kind, eid);
        if (!d?.name || !wears(kind, d) || equip.some(q => q.kind === kind && q.id === eid)) continue;
        equip.push({ text: d.name, icon: d.icon_index, kind, id: eid, right: `${n}`, desc: stripEscapes(d.description || '') });
      }
    }
    const items = [];
    for (const [iid, n] of [...party.container('item')].sort((x, y) => x[0] - y[0])) {
      const d = $data.items[iid];
      if (d?.name && this.quickable(d)) items.push({ text: d.name, icon: d.icon_index, kind: 'item', id: iid, right: `${n}`, desc: stripEscapes(d.description || '') });
    }
    const skills = a.allSkills().filter(s => s.occasion !== 3).map(s => {
      const cost = a.skillMpCost(s), hp = a.skillHpCost(s);
      return { text: s.name, icon: s.icon_index, kind: 'skill', id: s.id, right: cost ? `MP${cost}` : hp ? `HP${hp}` : '', desc: stripEscapes(s.description || '') };
    });
    this.list.close();
    this.grid.open(tr('{name} 단계 추가  ({n}/{max})', { name: macroName(m), n: m.steps.length, max: MAX_STEPS }),
      [{ label: tr('장비'), items: equip }, { label: tr('아이템'), items }, { label: tr('스킬'), items: skills }], {
        tab, index,
        onSelect: (it) => {
          if (m.steps.length >= MAX_STEPS) { G.audio?.playSystemSe(3); return; }
          m.steps.push({ kind: it.kind, id: it.id });
          this.showMacroAdd(id, this.grid.tab, this.grid.index);
        },
        onCancel: () => { this.grid.close(); this.showMacroActions(id); },
      });
  }
  // its steps in order: one picked - up, down, out
  showMacroSteps(id, index = 0) {
    const m = macroOf(id);
    if (!m) { this.showMacros(); return; }
    if (!m.steps.length) { this.showMacroActions(id, 1); return; }
    this.grid.close();
    this.list.open(tr('{name}  순서', { name: macroName(m) }), m.steps.map((s, i) => ({ text: `${i + 1}.  ${stepName(s)}`, icon: stepData(s)?.icon_index, right: stepKindName(s), at: i })), {
      index,
      onSelect: (i, it) => this.showMacroStep(id, it.at),
      onCancel: () => this.showMacroActions(id, 1),
    });
  }
  showMacroStep(id, at) {
    const m = macroOf(id);
    if (!m || !m.steps[at]) { this.showMacroSteps(id); return; }
    const move = to => { const [s] = m.steps.splice(at, 1); m.steps.splice(to, 0, s); this.showMacroSteps(id, to); };
    this.list.open(`${at + 1}.  ${stepName(m.steps[at])}`, [
      { text: tr('위로'), id: 'up', enabled: at > 0 },
      { text: tr('아래로'), id: 'down', enabled: at < m.steps.length - 1 },
      { text: tr('빼기'), id: 'out' },
      { text: tr('취소'), id: 'back' },
    ], {
      onSelect: (i, a) => {
        if (a.id === 'up') move(at - 1);
        else if (a.id === 'down') move(at + 1);
        else if (a.id === 'out') { m.steps.splice(at, 1); this.showMacroSteps(id, Math.min(at, m.steps.length - 1)); }
        else this.showMacroSteps(id, at);
      },
      onCancel: () => this.showMacroSteps(id, at),
    });
  }
  showMacroDelete(id) {
    const m = macroOf(id);
    if (!m) { this.showMacros(); return; }
    this.list.open(tr('{name}을(를) 지울까요?', { name: macroName(m) }), [
      { text: tr('지운다'), id: 'yes', desc: macroSummary(m) },
      { text: tr('취소'), id: 'no' },
    ], {
      index: 1,
      onSelect: (i, a) => {
        if (a.id !== 'yes') { this.showMacroActions(id, 3); return; }
        deleteMacro(id);
        G.audio?.playSystemSe(4);
        this.showMacros();
      },
      onCancel: () => this.showMacroActions(id, 3),
    });
  }
}
