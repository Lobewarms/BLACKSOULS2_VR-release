import { $data } from '../data/data.js';
import { tr } from './i18n.js';

const PARAMS = ['MHP', 'MMP', 'ATK', 'DEF', 'MAT', 'MDF', 'AGI', 'LUK'];

// Keep text even when an effect has no icon or its artwork cannot be loaded.
export function battlerEffects(battler, buffs = battler?.buffs) {
  const states = [...new Set(battler?.states || [])].map(id => $data.states?.[id]).filter(Boolean)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.id - b.id);
  const effects = states.filter(state => state.name?.trim() || state.icon_index > 0).map(state => ({
    key: `state:${state.id}`, name: state.name?.trim() || tr('상태 효과'), icon: state.icon_index || 0,
    description: state.description || '',
  }));
  (buffs || []).forEach((level, id) => {
    if (!level) return;
    const param = $data.system?.terms?.params?.[id] || PARAMS[id];
    effects.push({ key: `buff:${id}`, name: `${param} ${level > 0 ? '↑' : '↓'}${Math.abs(level) > 1 ? ' ×2' : ''}`,
      icon: (level > 0 ? 64 : 80) + (Math.abs(level) - 1) * 8 + id, description: '' });
  });
  return effects;
}

export function effectsKey(effects) { return effects.map(e => `${e.key}:${e.icon}:${e.name}`).join('|'); }

export function fitLabel(ctx, text, width) {
  const chars = Array.from(String(text));
  if (ctx.measureText(text).width <= width) return text;
  while (chars.length && ctx.measureText(chars.join('') + '…').width > width) chars.pop();
  return chars.join('') + '…';
}
