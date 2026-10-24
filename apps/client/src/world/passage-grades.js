// A walkway that briefly widens is still a passage. The fall solver's flat
// room groups can otherwise compress its entire climb into one narrow row.
// Extend only an excessive inferred ramp through unanchored degree-two groups,
// retaining the original endpoint rooms and all authored stairs/fall heights.
export function gradePassageChains({ w, h, node, runs, anchored, walk, link, protectedCell,
  floor, north, south, slope }) {
  const adjacent = new Map(), cellsByNode = new Map(), protectedNodes = new Set();
  for (const run of runs) {
    if (run.top < 0 || run.bot < 0 || run.top === run.bot) continue;
    for (const [a, b] of [[run.top, run.bot], [run.bot, run.top]]) {
      if (!adjacent.has(a)) adjacent.set(a, new Set());
      adjacent.get(a).add(b);
    }
  }
  for (let i = 0; i < node.length; i++) {
    const id = node[i];
    if (id < 0) continue;
    if (!cellsByNode.has(id)) cellsByNode.set(id, []);
    cellsByNode.get(id).push(i);
    if (protectedCell(i)) protectedNodes.add(id);
  }
  let repaired = 0;
  const used = new Set();
  for (const seed of runs) {
    if (seed.top < 0 || seed.bot < 0 || seed.top === seed.bot || seed.ladder || seed.rise !== null) continue;
    const first = seed.x + seed.y0 * w, last = seed.x + seed.y1 * w;
    if (Math.abs(north[first] - south[last]) <= (seed.y1 - seed.y0 + 1) * 1.25) continue;
    const interior = new Set(), visited = new Set();
    const expand = (id, previous) => {
      for (let count = 0; count < 64; count++) {
        if (anchored.has(id) || protectedNodes.has(id) || adjacent.get(id)?.size !== 2) return id;
        if (visited.has(id)) return -1;
        visited.add(id); interior.add(id);
        const next = [...adjacent.get(id)].find(other => other !== previous);
        previous = id; id = next;
      }
      return -1;
    };
    const a = expand(seed.top, seed.bot), b = expand(seed.bot, seed.top);
    if (a < 0 || b < 0 || a === b || !interior.size) continue;
    const all = new Set([a, b, ...interior]);
    const passages = runs.filter(run => run.top !== run.bot && all.has(run.top) && all.has(run.bot)
      && (interior.has(run.top) || interior.has(run.bot)));
    if (passages.some(run => run.ladder || run.rise !== null)) continue;
    const cells = new Set([...interior].flatMap(id => cellsByNode.get(id) || []));
    for (const run of passages) for (let y = run.y0; y <= run.y1; y++) cells.add(run.x + y * w);
    if ([...cells].some(i => used.has(i) || protectedCell(i) || !walk(i))) continue;
    let y0 = h, y1 = -1, x0 = w, x1 = -1;
    for (const i of cells) { const x = i % w, y = Math.floor(i / w); y0 = Math.min(y0, y); y1 = Math.max(y1, y); x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    const length = y1 - y0 + 1;
    // A long north–south corridor, rather than a broad room or sideways route.
    if (length * length < 2 * cells.size || length <= x1 - x0) continue;
    const ends = { north: [], south: [] };
    let valid = true;
    for (const i of cells) {
      const x = i % w, y = Math.floor(i / w);
      for (const [dx, dy, direction] of [[-1, 0, 4], [1, 0, 6], [0, -1, 8], [0, 1, 2]]) {
        const nx = x + dx, ny = y + dy, next = nx + ny * w;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h || cells.has(next) || !walk(next) || !link(x, y, dx, dy, direction)) continue;
        if (![a, b].includes(node[next]) || dx || dy < 0 && y !== y0 || dy > 0 && y !== y1) { valid = false; break; }
        ends[dy < 0 ? 'north' : 'south'].push({ id: node[next], height: floor[next] });
      }
      if (!valid) break;
    }
    if (!valid || !ends.north.length || !ends.south.length) continue;
    const top = ends.north[0], bottom = ends.south[0];
    if (top.id === bottom.id || ends.north.some(end => end.id !== top.id || Math.abs(end.height - top.height) > 0.01)
      || ends.south.some(end => end.id !== bottom.id || Math.abs(end.height - bottom.height) > 0.01)
      || Math.abs(top.height - bottom.height) / length > 1.25) continue;
    for (const i of cells) {
      const row = Math.floor(i / w) - y0;
      north[i] = top.height + (bottom.height - top.height) * row / length;
      south[i] = top.height + (bottom.height - top.height) * (row + 1) / length;
      floor[i] = (north[i] + south[i]) / 2; slope[i] = 1; used.add(i);
    }
    repaired++;
  }
  return repaired;
}

// Vertical runs do not visit sideways alcoves or winding one-cell water/grass
// edges. Leaving them at zero creates a wall against the corridor they join.
// Inherit only an unambiguous flat boundary; mixed-level/slope connections need
// their existing stair rules and are deliberately left untouched here.
export function completePassagePockets({ w, h, node, resolved, walk, link, protectedCell,
  floor, north, south, slope }) {
  const seen = new Uint8Array(w * h);
  const eligible = i => node[i] < 0 && !resolved[i] && !protectedCell(i) && walk(i);
  let placed = 0;
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || !eligible(start)) continue;
    const cells = [start]; seen[start] = 1;
    let height = null, valid = true;
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k], x = i % w, y = Math.floor(i / w);
      for (const [dx, dy, direction] of [[-1, 0, 4], [1, 0, 6], [0, -1, 8], [0, 1, 2]]) {
        const nx = x + dx, ny = y + dy, next = nx + ny * w;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h || !walk(next) || !link(x, y, dx, dy, direction)) continue;
        if (eligible(next)) {
          if (!seen[next]) { seen[next] = 1; cells.push(next); }
          continue;
        }
        if (!resolved[next] || Math.abs(north[next] - south[next]) > 0.01 || !Number.isFinite(floor[next])) { valid = false; continue; }
        if (height === null) height = floor[next];
        else if (Math.abs(height - floor[next]) > 0.01) valid = false;
      }
    }
    if (!valid || height === null) continue;
    for (const i of cells) { floor[i] = north[i] = south[i] = height; slope[i] = 0; resolved[i] = 1; }
    placed += cells.length;
  }
  return placed;
}
