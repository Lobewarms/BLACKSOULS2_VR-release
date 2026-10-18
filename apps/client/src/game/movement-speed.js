// VX Ace movement speeds are exponential: index 4 is normal, 5 is twice as
// fast. Free locomotion retains the player's chosen PC/VR and sprint settings.
export function normalizeMoveSpeed(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 6 ? value : 4;
}

export function movementSpeedRate(character) {
  return 2 ** (normalizeMoveSpeed(character?.moveSpeed) - 4);
}
