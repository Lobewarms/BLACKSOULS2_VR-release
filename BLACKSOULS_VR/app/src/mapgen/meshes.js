// Building a map, its last stage: the atlases drawn, the accumulated geometry made into meshes with their materials (the
// animated tiles' frames, billboards, objects), the parallax as a floor or a backdrop - and what the game reads of the map
// from then on: its group of meshes, the cells' heights and solids, where things stand, the frame update, dispose.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadImage, pixelTexture } from '../assets.js';
import { TS } from '../tiles.js';
import { SLAB_THICKNESS, voxelGeometryOf } from '../weapons.js';
import { T, makeBillboardMaterial } from './common.js';

export async function buildMeshes(M) {
  const { N4, OPEN_LEVEL, SOLID_LOW, SOLID_MASS, SOLID_RAIL, SOLID_VOID, animAtlas, baseH, bufs, clear, cliffTop,
      cliffWalls, compElev, connected, daises, doorways, drawer, fallStats, floorAt, floorE, gapTop, grid, h,
      hConnected, hangTop, idx, invisibleCells, isFloor, isSolid, lyingAt, lyingCols, onTopOf, onUpright, openVoid,
      opts, parKind, pending, pieceAt, pit, pits, railCount, raisedTop, shaft, shaftRowH, sideBox, sideRowH, slabPieces,
      slope, slopeBands, solid, solidBase, solidTop, stackConsumed, stacks, staticAtlas, surfN, surfS, terraceFit,
      uprightSpot, valid, w } = M;
  // ---- build atlases & meshes --------------------------------------------------
  staticAtlas.build();
  animAtlas.build();
  for (const op of pending) op();

  const group = new THREE.Group();
  group.name = 'map';
  const staticTex = pixelTexture(staticAtlas.canvas);
  const animTex = pixelTexture(animAtlas.canvas);
  animTex.wrapS = THREE.RepeatWrapping;
  // faces are built toward where the 2D view sees them; from behind (a market stall from its back, a
  // wall seen from inside a block) they still show, darker, instead of vanishing
  const matOpts = { vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide };
  const backShaded = mat => {
    mat.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
        '#include <color_fragment>\n  if (!gl_FrontFacing) diffuseColor.rgb *= 0.55;');
    };
    mat.customProgramCacheKey = () => 'map-backshaded';
    return mat;
  };
  const matStatic = backShaded(new THREE.MeshLambertMaterial({ ...matOpts, map: staticTex }));
  const matAnim = backShaded(new THREE.MeshLambertMaterial({ ...matOpts, map: animTex }));
  const matBbStatic = makeBillboardMaterial({ ...matOpts, map: staticTex, side: THREE.DoubleSide });
  const matBbAnim = makeBillboardMaterial({ ...matOpts, map: animTex, side: THREE.DoubleSide });
  // the boxes of upright pictures: a side shows only from outside, so through a clear part of the near
  // side you see what is behind the box, not its far sides
  const matObj = new THREE.MeshLambertMaterial({ ...matOpts, side: THREE.FrontSide, map: staticTex });
  const matObjAnim = new THREE.MeshLambertMaterial({ ...matOpts, side: THREE.FrontSide, map: animTex });
  const meshes = [
    [bufs.static, matStatic], [bufs.anim, matAnim], [bufs.bbStatic, matBbStatic], [bufs.bbAnim, matBbAnim],
    [bufs.obj, matObj], [bufs.objAnim, matObjAnim],
  ];
  for (const [buf, mat] of meshes) {
    if (!buf.n) continue;
    const mesh = new THREE.Mesh(buf.geometry(), mat);
    mesh.frustumCulled = buf.center === null;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  // the low wide pictures standing still: the edges of their pixels, as small blocks, in one mesh
  if (slabPieces.length) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = TS;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const byTile = new Map();
    const geos = [];
    for (const p of slabPieces) {
      let g = byTile.get(p.tid);
      if (g === undefined) {
        ctx.clearRect(0, 0, TS, TS);
        drawer.draw(ctx, p.tid, 0, 0);
        g = voxelGeometryOf(ctx.getImageData(0, 0, TS, TS).data, TS, TS, SLAB_THICKNESS, false, false);
        if (g) { g.translate(0, TS / 2, 0); g.scale(T / TS, T / TS, T / TS); }
        byTile.set(p.tid, g);
      }
      if (g) geos.push(g.clone().translate(p.x, p.y, p.z));
    }
    const merged = geos.length ? mergeGeometries(geos) : null;
    for (const g of geos) g.dispose();
    for (const g of byTile.values()) g?.dispose();
    if (merged) {
      const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
      mesh.matrixAutoUpdate = false;
      mesh.name = 'standing-pictures';
      group.add(mesh);
    }
  }

  // Parallax: in 2D it shows through transparent/empty floor, so in 3D it becomes the ground.
  //  "yuka*" images are pre-drawn floors aligned to the map (遠景床 script); others are tiled.
  const pname = grid.map.parallax_name || '';
  let parallaxFloor = null;
  if (pname && !opts.openSky) {                          // (open sky: the picture is the sky round the map - sky.js - with nothing under it)
    let img = await loadImage('Graphics/Parallaxes', pname);
    const backdrop = /ocean/i.test(pname) && img;
    if (backdrop) {
      // (a sky over the sea, drawn as a view: only the sea under the horizon lies under the map)
      const c = document.createElement('canvas');
      const top = Math.round(img.height * 0.56);
      c.width = img.width; c.height = img.height - top;
      c.getContext('2d').drawImage(img, 0, top, img.width, c.height, 0, 0, c.width, c.height);
      img = c;
    }
    if (img) {
      const tex = pixelTexture(img);
      const mw = w * T, mh = h * T;
      if (/^yuka/i.test(pname)) {
        // (the original's 遠景床 script fixes it to the map and, as a parallax plane does, repeats it from the
        // map's corner: a map-sized drawing lies once, a small one - a patch of forest floor, stone road, sand
        // - covers the whole ground. Laid once at its own size, a small one left the rest of the ground black
        // where the tiles are clear: the forest clearing of 71 ~ 80 77, the stone of 피눈물 웅덩이 1)
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        const rx = (w * TS) / img.width, ry = (h * TS) / img.height;
        tex.repeat.set(rx, ry);
        tex.offset.set(0, Math.ceil(ry) - ry);          // (the drawing's top-left corner at the map's)
        parallaxFloor = new THREE.Mesh(new THREE.PlaneGeometry(mw, mh), new THREE.MeshLambertMaterial({ map: tex }));
        parallaxFloor.position.set(mw / 2, -0.02, mh / 2);
      } else {
        tex.wrapS = tex.wrapT = backdrop ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
        const grow = parKind === 'sky' || backdrop ? 3 : 1;   // sky far below / the sea seen from a height: reach past the map edges
        tex.repeat.set((w * TS) * grow / img.width, (h * TS) * grow / img.height);
        const mat = new THREE.MeshLambertMaterial({ map: tex });
        if (parKind === 'water') mat.color.setRGB(0.75, 0.8, 0.85);
        parallaxFloor = new THREE.Mesh(new THREE.PlaneGeometry(mw * grow, mh * grow), mat);
        parallaxFloor.position.set(mw / 2, openVoid ? OPEN_LEVEL * T : -0.03, mh / 2);
        parallaxFloor.userData.scroll = [grid.map.parallax_sx || 0, grid.map.parallax_sy || 0];
      }
      parallaxFloor.rotation.x = -Math.PI / 2;
      group.add(parallaxFloor);
    }
  }

  let frame = 0;
  return {
    group,
    wallHeight: baseH,
    stats: {
      static: staticAtlas.draws.length, anim: animAtlas.draws.length, stacks: stacks.length, lying: lyingCols.length,
      atlasW: staticAtlas.W, atlasH: staticAtlas.H, doorways: doorways.length,
      mass: solid.reduce((n, v) => n + (v === SOLID_MASS ? 1 : 0), 0),
      void: solid.reduce((n, v) => n + (v === SOLID_VOID ? 1 : 0), 0),
      cliffs: slopeBands, cliffWalls, rails: solid.reduce((n, v) => n + (v === SOLID_RAIL ? 1 : 0), 0), open: parKind,
      invisible: invisibleCells.length, edgeRails: railCount, daises, low: solid.reduce((n, v) => n + (v === SOLID_LOW ? 1 : 0), 0), raisedTops: raisedTop.reduce((n, v) => n + v, 0), invisibleCells: invisibleCells.slice(0, 400).map(i => [i % w, (i / w) | 0]),
      slopes: slope.reduce((n, v) => n + v, 0), pits: pit.reduce((n, v) => n + v, 0),
      levels: [...new Set(compElev)].length,
      falls: fallStats,
      terraceFit: terraceFit.slice(0, 60).map(r => `${r[1]} k${r[2]} got ${r[3]} (${r[4]}>${r[5]})`),
    },
    staticAtlas, animAtlas, drawer,
    joinsBelow: connected, joinsBeside: hConnected,     // (upper, lower) / (left, right) tile ids: do their drawings meet
    eventPieces: new Map([...pieceAt.values()].map(p => [p.id, p.tile])),   // event id -> its tile, built here (opts.eventPieces)
    isSolid,
    isPit: (x, y) => valid(x, y) && pit[idx(x, y)] === 1,
    isSlope: (x, y) => valid(x, y) && slope[idx(x, y)] === 1,
    solidBaseAt: (x, y) => (isSolid(x, y) ? solidBase[idx(x, y)] : NaN),   // (developer checks)
    isCliffAt: (x, y) => valid(x, y) && !Number.isNaN(cliffTop[idx(x, y)]),
    isStackCell: (x, y) => valid(x, y) && !!stackConsumed[idx(x, y)],    // an upright object stands here
    lyingCells: [...lyingAt.keys()],                                     // beds, tables: low blocks nobody walks into
    isRaisedTop: (x, y) => valid(x, y) && !!raisedTop[idx(x, y)],        // a passable wall top / face out of reach, made solid
    // a way nobody can see (open sky: a clear tile walked on, a drop either side of it) and which way it runs: 'x' along
    // a row (drops north and south), 'y' along a column, '' none - player.js keeps a walk along it from drifting off
    hiddenWay(x, y) {
      if (!valid(x, y) || !clear[idx(x, y)] || pit[idx(x, y)] || !grid.anyPassable(x, y)) return '';
      const drop = (dx, dy) => valid(x + dx, y + dy) && !!pit[idx(x + dx, y + dy)];
      return drop(0, -1) && drop(0, 1) ? 'x' : drop(-1, 0) && drop(1, 0) ? 'y' : '';
    },
    solidHeight: (x, y) => (isSolid(x, y) ? solidTop[idx(x, y)] - solidBase[idx(x, y)] : 0),
    solidTopAt: (x, y) => (isSolid(x, y) ? solidTop[idx(x, y)] : -Infinity),   // tiles; walls stop shots below it
    isDoorway: (x, y) => doorways.some(d => d.x === x && d.y === y),
    floorAt,
    // where something drawn over a solid cell in 2D (an NPC set into a wall, a creature on a rock) shows in
    // 3D, in tiles: on the face the 2D view looks at (south), as far up it as it was drawn above the floor;
    // on top of the block when it sits on the roof part. Over an upright picture: in front of it (free:
    // still turning to the viewer; about: kept on the viewer's side of a picture turning about that
    // point). null for open cells
    // side view: drawn on the tower's wall (in the shaft or on a wall beside it), so it hangs there upright
    onSideWall(x, y) {
      if (!valid(x, y)) return false;
      if (shaft) return !!shaft[idx(x, y)] || (isSolid(x, y) && N4.some(([dx, dy]) => valid(x + dx, y + dy) && !!shaft[idx(x + dx, y + dy)]));
      if (!sideRowH || !sideBox) return false;
      if (x < sideBox[0] - 2 || x > sideBox[2] + 2 || y < sideBox[1] || y > sideBox[3]) return false;
      return !!pit[idx(x, y)] || isSolid(x, y);
    },
    spotOnSolid(x, y, lying = false, above = false) {
      // a side view: things drawn on the tower's wall hang on it at their row's height. Drawn in the shaft
      // (the wall behind it in 2D), they go onto the nearest wall: a tower wall beside them, else the face
      // under the ledge above (what the drawing shows above them), else the one below
      const hang = (i, hy) => {
        const x = i % w, y = (i / w) | 0;
        for (const [side, dx] of [['E', -1], ['W', 1]]) {
          if (valid(x + dx, y) && isSolid(x + dx, y) && !pit[idx(x + dx, y)]) return { x: x + 0.5 + dx * 0.5, y: hy, z: y + 0.5, side, ground: false };
        }
        for (const dir of [-1, 1]) {
          for (let d = 1; d <= 14; d++) {
            const yy = y + dir * d;
            if (!valid(x, yy)) break;
            if (pit[idx(x, yy)]) continue;
            const top = isSolid(x, yy) ? solidTop[idx(x, yy)] : floorE[idx(x, yy)];
            if (dir === -1 && hy > top - 0.2) break;          // the face below that ledge does not reach up here
            return dir === -1 ? { x: x + 0.5, y: hy, z: yy + 1, side: 'S', ground: false } : { x: x + 0.5, y: hy, z: yy, side: 'N', ground: false };
          }
        }
        return { x: x + 0.5, y: hy, z: y + 0.5, side: 'top', ground: false };
      };
      // other maps' drops: drawn in the drop, it hangs on the nearest wall at its row's height; on a wall
      // beside the drop, on that wall's face toward it
      if (shaft && valid(x, y)) {
        const i = idx(x, y);
        if (shaft[i]) return hang(i, shaftRowH[i]);
        if (isSolid(x, y)) {
          for (const [side, dx, dy] of [['S', 0, 1], ['E', 1, 0], ['W', -1, 0], ['N', 0, -1]]) {
            if (!valid(x + dx, y + dy) || !shaft[idx(x + dx, y + dy)]) continue;
            return { x: x + 0.5 + dx * 0.5, y: shaftRowH[idx(x + dx, y + dy)], z: y + 0.5 + dy * 0.5, side, ground: false };
          }
        }
      }
      if (sideRowH && sideBox && valid(x, y) && x >= sideBox[0] - 2 && x <= sideBox[2] + 2 && y >= sideBox[1] && y <= sideBox[3]) {
        const i = idx(x, y);
        const hy = sideRowH(y);
        if (pit[i]) {
          for (const [side, dx] of [['E', -1], ['W', 1]]) {
            if (valid(x + dx, y) && isSolid(x + dx, y) && !pit[idx(x + dx, y)]) return { x: x + 0.5 + dx * 0.5, y: hy, z: y + 0.5, side, ground: false };
          }
          for (const dir of [-1, 1]) {
            for (let d = 1; d <= 14; d++) {
              const yy = y + dir * d;
              if (!valid(x, yy)) break;
              if (pit[idx(x, yy)]) continue;
              const top = isSolid(x, yy) ? solidTop[idx(x, yy)] : floorE[idx(x, yy)];
              if (dir === -1 && hy > top - 0.2) break;          // the face below that ledge does not reach up here
              return dir === -1 ? { x: x + 0.5, y: hy, z: yy + 1, side: 'S', ground: false } : { x: x + 0.5, y: hy, z: yy, side: 'N', ground: false };
            }
          }
          return { x: x + 0.5, y: hy, z: y + 0.5, side: 'top', ground: false };
        }
        if (isSolid(x, y)) {
          for (const [side, dx, dy] of [['E', 1, 0], ['W', -1, 0], ['S', 0, 1], ['N', 0, -1]]) {
            if (!valid(x + dx, y + dy) || !pit[idx(x + dx, y + dy)]) continue;
            return { x: x + 0.5 + dx * 0.5, y: hy, z: y + 0.5 + dy * 0.5, side, ground: false };
          }
          // a wall beside the stairs (or behind the tower's edge): on the face toward the tower's inside
          for (const [side, dx] of [['E', 1], ['W', -1]]) {
            for (let d = 1; d <= 3; d++) {
              const xx = x + dx * d;
              if (!valid(xx, y) || xx < sideBox[0] || xx > sideBox[2]) break;
              if (isSolid(xx, y)) continue;
              return { x: xx + 0.5 - dx * 0.5, y: hy, z: y + 0.5, side, ground: false };
            }
          }
        }
      }
      // (abyss 'hang': drawn over a top's foundation, or across a gap in front of it - 탈출２'s beasts on the rocks under the
      // pillars: on that front, at its row's depth below the top)
      if (valid(x, y) && (hangTop[idx(x, y)] >= 0 || gapTop[idx(x, y)] >= 0)) {
        const top = hangTop[idx(x, y)] >= 0 ? hangTop[idx(x, y)] : gapTop[idx(x, y)], ty = (top / w) | 0;
        return { x: x + 0.5, y: surfS(top) - (y - ty), z: ty + 1, side: 'S', ground: false };
      }
      if (!isSolid(x, y)) return uprightSpot(x, y, lying, above);
      // (maphints onWall - 병든 시계탑's hanged: on their wall's face over the nooses drawn there, from its foot - or that many
      // tiles over it, hanging clear of the stage in front; the stage is no wall rising under them)
      const onWall = !lying && (opts.onWall || []).find(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
      if (onWall) {
        const j = valid(x, y + 1) ? idx(x, y + 1) : -1;
        const foot = j < 0 ? 0 : isSolid(x, y + 1) ? solidBase[j] : surfN(j);
        return { x: x + 0.5, y: foot + (onWall[4] || 0), z: y + 1 + (onWall[5] || 0), side: 'S', ground: false };
      }
      // drawn over the upper part of a thing that stands in front of the wall, that part taken off the wall into
      // the thing's picture (a ladder leant on it - 도마뱀 빌 climbing it in 리펀 대성당 -, a tall shelf): in front of
      // that part, at its height (on its lowest part - a fire in a hearth - it goes on as before)
      const up = stackConsumed[idx(x, y)] && onUpright.get(idx(x, y));
      if (up && y < up.st.topY + up.st.tiles.length - 1) {
        const s = uprightSpot(x, y, lying, true);
        if (s) return s;
      }
      const onTop = onTopOf(x, y);
      if (onTop) return onTop;
      const i = idx(x, y);
      if (lying) return { x: x + 0.5, y: solidTop[i], z: y + 0.5, side: 'top', ground: true };   // laid on top
      for (let d = 1; d <= 8; d++) {
        const yy = y + d;
        if (!valid(x, yy) || pit[idx(x, yy)]) break;
        if (isSolid(x, yy)) continue;
        if (!isFloor(x, yy)) break;
        // (over a doorway - a door in a notch of the wall's line: on the wall going on above it, flush with the front beside it, at
        // its row's height there - 도서관의 꿈's candles over the white door. On the notch's own face behind, it was hidden)
        const dw = doorways.find(dd => dd.x === x && dd.y === yy);
        if (dw && dw.base + d < solidTop[i] - 0.6) return { x: x + 0.5, y: dw.base + d, z: yy + 1, side: 'S', ground: false };
        const base = surfN(idx(x, yy)), up = base + d - 1;
        if (up > solidTop[i] - 0.6) return { x: x + 0.5, y: solidTop[i], z: y + 0.5, side: 'top', ground: true };
        return { x: x + 0.5, y: up, z: yy, side: 'S', ground: d === 1 };
      }
      for (const [side, dx, dy] of [['E', 1, 0], ['W', -1, 0], ['N', 0, -1]]) {
        if (!isFloor(x + dx, y + dy)) continue;
        const j = idx(x + dx, y + dy);
        return { x: x + 0.5 + dx * 0.5, y: Math.min(surfN(j), surfS(j)), z: y + 0.5 + dy * 0.5, side, ground: true };
      }
      return { x: x + 0.5, y: solidTop[i], z: y + 0.5, side: 'top', ground: true };
    },
    update(time) {
      // A1 animation: 0.5s per frame like RPG Maker (30 frames @60fps)
      const f = Math.floor(time * 2) % 3;
      if (f !== frame) { frame = f; animTex.offset.x = f / 3; }
      const sc = parallaxFloor?.userData.scroll;
      if (sc && (sc[0] || sc[1])) {
        const m = parallaxFloor.material.map;
        m.offset.set(-sc[0] * time * 0.004, sc[1] * time * 0.004);
      }
    },
    dispose() {
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      for (const m of [matStatic, matAnim, matBbStatic, matBbAnim, matObj, matObjAnim]) m.dispose();
      staticTex.dispose(); animTex.dispose();
    },
  };
}
