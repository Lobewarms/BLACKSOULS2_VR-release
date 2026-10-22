// PC mouse look - the game's (input.js) and the map editor's (mapedit.html): raw movement where the browser gives it
// (unadjustedMovement - the mouse's own counts, no Windows pointer acceleration). Chrome on Windows otherwise works the
// movement out from its hidden cursor, which it keeps putting back in the window's middle - at a 125 / 150 % display
// scale that goes wrong now and then, and one movement comes as a jump of the cursor: the view whipped round. Where raw
// movement is not supported, the usual lock.
export function lockPointerRaw(dom) {
  const plain = () => { try { dom.requestPointerLock?.()?.catch?.(() => {}); } catch { /* not allowed here */ } };
  try {
    const p = dom.requestPointerLock?.({ unadjustedMovement: true });
    if (p?.catch) p.catch(err => { if (err?.name === 'NotSupportedError') plain(); });
  } catch { plain(); }
}

// and a movement that looks like the cursor jumping rather than the hand is dropped: a big one right after the lock, or
// one far bigger than all of the last few (a jump comes alone between small ones; a fast flick grows over several
// movements and goes on, so after one drop the next is always taken)
export class MouseFilter {
  constructor() {
    this.fresh = 0;                // movements right after the lock still to be checked
    this.last = [];                // sizes of the last few movements taken
    this.dropNext = true;          // (never two drops in a row: a fast flick is many big movements)
    this.dropped = [];             // (developer checks: the last movements dropped)
  }
  // the pointer locked, or let go
  reset(locked) { this.fresh = locked ? 2 : 0; this.last = []; this.dropNext = true; }
  // whether a movement (a mousemove while locked) is the hand's, to take
  take(e) {
    const m = Math.max(Math.abs(e.movementX), Math.abs(e.movementY));
    const recent = this.last.length ? Math.max(...this.last) : 0;
    const fresh = this.fresh > 0;
    if (fresh) this.fresh--;
    if (this.dropNext && ((fresh && m > 40) || (m > 250 && m > 8 * Math.max(recent, 12)))) {
      this.dropNext = false;
      this.dropped.push([Math.round(e.timeStamp), e.movementX, e.movementY, recent]);
      if (this.dropped.length > 20) this.dropped.shift();
      return false;
    }
    this.dropNext = true;
    this.last.push(m);
    if (this.last.length > 3) this.last.shift();
    return true;
  }
}
