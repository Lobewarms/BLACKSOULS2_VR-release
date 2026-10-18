// Camera-space hand motion: wind up, sweep across the view, then recover.
// The active part remains inside the combat system's existing hit window.
const REST = { p: [0.28, -0.3, -0.45], r: [0.92, 0.15, -0.12] };
const SWING = [
  { t: 0, ...REST },
  { t: 0.18, p: [0.4, -0.2, -0.38], r: [1.12, -0.65, -0.3] },
  { t: 0.48, p: [0.04, -0.22, -0.58], r: [0.75, 0.05, -0.8] },
  { t: 0.7, p: [-0.25, -0.42, -0.5], r: [0.25, 0.85, -1.25] },
  { t: 1, ...REST },
];

export function desktopRest(holder, hand = 'right', ranged = false) {
  if (!holder) return;
  const sign = hand === 'left' ? -1 : 1;
  holder.position.set(sign * REST.p[0], REST.p[1], REST.p[2]);
  if (ranged) holder.rotation.set(0.04, sign * 0.06, 0);
  else holder.rotation.set(...REST.r);
}

export function desktopSwing(holder, progress) {
  const k = Math.max(0, Math.min(1, progress));
  let segment = 1;
  while (segment < SWING.length - 1 && k > SWING[segment].t) segment++;
  const a = SWING[segment - 1], b = SWING[segment];
  const t = (k - a.t) / (b.t - a.t), eased = t * t * (3 - 2 * t);
  const mix = (x, y) => x + (y - x) * eased;
  holder.position.set(...a.p.map((value, i) => mix(value, b.p[i])));
  holder.rotation.set(...a.r.map((value, i) => mix(value, b.r[i])));
}
