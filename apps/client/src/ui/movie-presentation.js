// Hide only our presentation during an event movie. Restore each prior value
// before the next simulation frame so mode changes and normal UI own visibility.
export class MoviePresentation {
  constructor() { this.hidden = new Map(); }
  restore() {
    for (const [object, visible] of this.hidden) object.visible = visible;
    this.hidden.clear();
  }
  apply(context) {
    if (!context.movies?.busy()) return;
    const ui = context.ui, combat = context.combat;
    const objects = [ui?.root, ui?.backdrop, ui?.hud?.mesh, ui?.statusPanel?.mesh, ui?.toastPanel?.mesh,
      ui?.rewards?.mesh, ui?.navigation?.mini?.mesh, ui?.dungeonStatus?.mesh, ui?.pointerLine,
      combat?.root, combat?.weapon, combat?.shield, combat?.held?.fx, combat?.ready?.fx,
      ...(context.hands?.roots?.() || [])];
    for (const object of objects) if (object && !this.hidden.has(object)) {
      this.hidden.set(object, object.visible); object.visible = false;
    }
  }
}
