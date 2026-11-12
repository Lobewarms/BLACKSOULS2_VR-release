// Macros (매크로): steps done one after another from one quick slot - any equipment worn or carried put on, any item the quick
// slots take used, any skill known used - in the order the player put them in (for example a staff, a buff item twice, then a
// spell: the staff in hand, the buff on twice, the spell in the hand to let go). Made in the menu (ui/macros.js: 매크로), set
// in a quick slot as { kind: 'macro', id } like an item or a skill, run by combat/macros.js. Kept with the game (state.js).
import { $data } from './data.js';
import { G } from './globals.js';
import { tr } from './i18n.js';
import { itemData } from './state.js';
import { stripEscapes } from './uitext.js';

export const MAX_MACROS = 8, MAX_STEPS = 12;
const KINDS = ['weapon', 'armor', 'item', 'skill'];

// the game's macros (made the first time they are asked for; a step of a kind or thing that is no more is dropped)
export function macros() {
  const st = G.state;
  if (!st) return [];
  if (!Array.isArray(st.macros)) st.macros = [];
  for (const m of st.macros) m.steps = (Array.isArray(m.steps) ? m.steps : []).filter(s => s && KINDS.includes(s.kind) && Number.isInteger(s.id) && s.id > 0);
  return st.macros;
}
export function macroOf(id) { return macros().find(m => m.id === id) || null; }
// a new one, numbered with the lowest number free (null: there are MAX_MACROS already)
export function newMacro() {
  const list = macros();
  if (list.length >= MAX_MACROS) return null;
  let id = 1;
  while (list.some(m => m.id === id)) id++;
  const m = { id, steps: [] };
  list.push(m);
  list.sort((a, b) => a.id - b.id);
  return m;
}
// gone, and out of the quick slots
export function deleteMacro(id) {
  const st = G.state;
  if (!st) return;
  st.macros = macros().filter(m => m.id !== id);
  if (Array.isArray(st.quickSlots)) st.quickSlots = st.quickSlots.map(s => (s && s.kind === 'macro' && s.id === id ? null : s));
}
export function macroName(m) { return tr('매크로 {n}', { n: m.id }); }
// what a step is: the weapon / armour / item / skill (null: none of that number)
export function stepData(s) {
  if (!s) return null;
  if (s.kind === 'skill') return $data.skills[s.id] || null;
  if (s.kind === 'item') return $data.items[s.id] || null;
  return itemData(s.kind, s.id) || null;
}
export function stepName(s) {
  const d = stepData(s);
  return d ? stripEscapes(d.name) : '?';
}
export function stepKindName(s) {
  return s.kind === 'skill' ? tr('스킬') : s.kind === 'item' ? tr('아이템') : tr('장비');
}
// its steps in a line (the menu's description of it)
export function macroSummary(m) {
  return m.steps.length ? m.steps.map(stepName).join(' › ') : tr('(비어 있음)');
}
// the icon it shows: its first step's
export function macroIcon(m) {
  return stepData(m.steps[0])?.icon_index || 0;
}
