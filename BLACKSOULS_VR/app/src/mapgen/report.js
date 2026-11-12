// Building a map for the developer's checks (opts.analysisOnly - meshcheck.html, mapedit): what the cells became - stacks,
// foot shadows, things lying low, boxes, the falls' counts - without building any geometry.

export function analysisReport(M) {
  const { bands, boxes, comp, fallStats, floorAt, footShadowAt, grid, idx, invisibleCells, isSolid, lyingCols, pieceAt,
      pit, raisedTop, stackConsumed, stacks, valid, w } = M;
  return {
    isSolid, floorAt, eventPieces: new Map([...pieceAt.values()].map(p => [p.id, p.tile])),
    isPit: (x, y) => valid(x, y) && pit[idx(x, y)] === 1,
    isStackCell: (x, y) => valid(x, y) && !!stackConsumed[idx(x, y)],
    isRaisedTop: (x, y) => valid(x, y) && !!raisedTop[idx(x, y)],
    stacks: stacks.map(st => ({ x: st.x, y: st.cellY, top: st.topY, foot: st.footY, elev: st.elev, againstWall: st.againstWall, drop: st.drop || 0, tiles: st.tiles, joined: !!st.joined, arch: st.arch ? (st.archFlat ? 'flat' : 'turning') : '' })),
    footShadows: [...footShadowAt.entries()].map(([i, t]) => [i % w, (i / w) | 0, t]),
    lying: lyingCols.map(c => ({ x: c.x, y: c.y1, top: c.y0, tiles: c.pieces })),
    boxes: boxes.map(b => b.line ? { line: b.line.map(st => [st.x, st.cellY, st.footY]), fixed: true } : { x0: b.x0, n: b.n, cy: b.cy, fixed: b.fixed, slab: !!b.slab }),
    stats: { invisibleCells: invisibleCells.map(i => [i % w, (i / w) | 0]), falls: fallStats,
      // (walls drawn between two walkable places that ended at one level: a terraced place laid flat?)
      faces: bands.filter(b => b.lowFloor).length,
      flatFaces: bands.filter(b => b.lowFloor && comp[b.uI] >= 0 && comp[b.uI] === comp[b.lI] && grid.anyPassable(b.uI % w, (b.uI / w) | 0) && grid.anyPassable(b.lI % w, (b.lI / w) | 0)).length },
    dispose() {},
  };
}
