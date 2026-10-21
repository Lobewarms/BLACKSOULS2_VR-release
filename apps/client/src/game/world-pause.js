import { G } from '../core/globals.js';

// A local inspection scene suspends its world's logic. A guest's inspection
// cannot stop the host-owned world or the events that guest leads for it.
export function worldMenuPaused(context = G) {
  return !context.coop?.phantom && !!(context.ui?.menuOpen || context.ui?.sceneOpen);
}
