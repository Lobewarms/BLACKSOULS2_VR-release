import { tr } from './i18n.js';

// Presentation reads the combat state's remaining lifetime; it owns no clock.
export function duelCountdown(value) {
  const seconds = Math.ceil(value?.remaining);
  if (!Number.isFinite(value?.remaining) || value.remaining <= 0 || !Number.isSafeInteger(seconds)) return null;
  const icon = Number.isSafeInteger(value.icon) && value.icon > 0 ? value.icon : 0;
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return { seconds, icon, text: tr('공유 불사 · {time}', { time }), key: `${seconds}/${icon}` };
}
