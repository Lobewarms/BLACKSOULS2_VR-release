// VX Ace movement speeds are exponential: index 4 is normal, 5 is twice as
// fast. Free locomotion retains the player's chosen PC/VR and sprint settings.
export function normalizeMoveSpeed(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 6 ? value : 4;
}

export function validSceneMoveSpeed(snapshot, character) {
  return !!snapshot && snapshot.character === character && snapshot.revision === character?.moveSpeedRevision
    && snapshot.scriptedSpeed === character?.moveSpeed;
}

// Native battles stop map locomotion. A pre-battle backstep may slow its route
// without restoring it until after the battle; keep that speed on the cutscene,
// but retain the pre-scene speed for first-person combat. Speed-only routes
// (such as Normal/Fast choices) remain persistent player settings.
export function captureSceneMoveSpeed(character, route, previous) {
  const commands = route?.list || [];
  if (!commands.some(c => c.code === 29) || !commands.some(c => c.code >= 1 && c.code <= 14)) return null;
  return { character, speed: normalizeMoveSpeed(validSceneMoveSpeed(previous, character) ? previous.speed : character.moveSpeed),
    revision: character.moveSpeedRevision, scriptedSpeed: character.moveSpeed };
}

export function movementSpeedRate(character, battles) {
  const snapshot = battles?.find(b => !b.done && validSceneMoveSpeed(b.sceneMoveSpeed, character))?.sceneMoveSpeed;
  return 2 ** (normalizeMoveSpeed(snapshot ? snapshot.speed : character?.moveSpeed) - 4);
}
