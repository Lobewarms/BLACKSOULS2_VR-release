// Real-time adaptation of feature 61's extra actions, using the same expected
// action-count rule as enemy actionPace. It changes recovery, never AGI, skill
// turn cooldowns, damage, hit counts, or the motion of a tracked VR hand.
export function playerRecoveryRate(actor) {
  let extra = 0;
  for (const feature of actor?.featuresWith?.(61) || []) {
    if (Number.isFinite(feature.value)) extra += Math.max(0, Math.min(1, feature.value));
  }
  return 1 + extra;
}
