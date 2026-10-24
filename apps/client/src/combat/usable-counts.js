// VX Ace repeats are per selected target. Random target scopes select their
// targets separately; callers must not multiply that count a second time.
export function usableRepeats(obj) {
  const count = obj?.repeats;
  return Number.isFinite(count) && Number.isInteger(count) && count > 0 ? Math.min(64, count) : 1;
}

export function randomTargetCount(scope) {
  return Number.isInteger(scope) && scope >= 3 && scope <= 6 ? scope - 2 : 1;
}
