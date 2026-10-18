// Corrections for maps whose 2D layout cannot tell what is up.
//  sideView: the map is a tower drawn from the side, climbed by ledges and stairs. Heights come from its
//            fall events (a fall that carries the player n rows down lands n tiles lower) and every cell a
//            fall passes through is open air (mapmesh.js).
//  floors:   hand-made heights, rectangles of walkable cells [x0, y0, x1, y1, heightAtNorthEdge,
//            heightAtSouthEdge] in tiles, sloping north to south between the two. Later ones win. With 'x' after
//            them [x0, y0, x1, y1, heightAtWestEnd, heightAtEastEnd, 'x']: a flight drawn side-on, a flat step a cell
//  fallStairs: verified wide flights [x0, y0, x1, y1, rise in tiles] separating rooms placed by original fall
//            events. Keep these cells out of flat-room grouping and slope between the resulting landings.
//  tops:     solids' tops set by hand [x0, y0, x1, y1, top in tiles] (raised or lowered): a block between floors raised by
//            hand (a castle front up to the balcony behind it)
//  flatPictures: tile ids of small upright pictures that keep their 2D facing (one plane across the cell, seen
//            from the front and the back) instead of turning to the viewer
//  lips:     cells that cannot be walked on drawn as a low ledge [x0, y0, x1, y1, height above the higher floor
//            beside it, in tiles] instead of the block they would otherwise be (their own art on top)
//  openFights: fights here never close the map (no boss arena): the exits stay open and everyone stays in sight
//  terraces: a town of terraces and flat roofs climbed by stairs drawn as floor tiles (A5) - { stairs: [A5
//            tile numbers of flights drawn from the front], sideStairs: [... drawn side-on] }: those stairs are
//            climbs, not floor, and places only join into one level where the original lets you walk between
//            them (a roof's edge stops you): each roof / terrace is its own level, as high above the street as the
//            wall drawn under it (mapmesh.js)
//  hideArt:  upper-layer pieces left out of the 3D view [x0, y0, x1, y1, [tile ids]] - the foot of a staircase drawn up a
//            wall, sticking out in front of it: stood up, it was planks hanging in the air (the rest stays on the wall;
//            what can be walked on is as in the original)
//  massBackdrop: blocks of things piled up on the floor (heaps of books) show the nearest wall's art behind them on
//            their faces instead of the floor's
//  caps:     walls that are the front of a raised floor [x0, y0, x1, y1, top in tiles]: their top no higher than that
//  props:    things standing on the floor in a row along a wall's foot [x0, y0, x1, y1] (crates, barrels, pots): each
//            stands as its own picture instead of the cells joining into a block of the wall (their floor drawn
//            round them on its faces)
//  whole:    one round thing drawn over many rows and columns [x0, y0, x1, y1] (the pictures standing on its rows): all its
//            columns stand on its lowest row, one thing (a carousel, a circus tent) - not slices each on its own row
//  cabinets: things n rows tall set one behind another in a column [x0, y0, x1, y1, n] (shelves along a side wall, each drawn
//            facing south): each stands on its own (with props, not a block of the wall)
//  walkedTo: where a scene walks the player [[x, y], ...] that no walk of the player's own reaches: built as walkable from the
//            start (its floor, drawn with wall tiles, stood as a solid block the player was walked into)
//  parallaxWalls: a room drawn on its background picture, its walls tiles that draw nothing: their faces show the picture's
//            wall [x, y, w, h in pixels of the picture - its top row (a valance) at the walls' top, the rest stretched down to
//            the floor; along a wall it repeats every whole tile of w] - or { back, front, backdrop }: front for the room's south
//            wall, back for the rest, backdrop [yTop, yFloor]: the back wall shows the picture as drawn there (mapmesh.js)
//  openSky:  the background picture is the sky round the map and the land far below (병든 시계탑 3: towers high over the town at
//            night): what the map leaves untiled or draws with a clear tile (its bridge nobody can see, the drops beside it) is open
//            air, every drop going down as far as the deepest, with no ground drawn under it (mapmesh.js)
//  wallCap:  walls stand as tall as their drawing, up to this many tiles (otherwise 6): towers drawn whole from the front
//  doorTops: the top half of a door drawn two rows tall in a facade [[x, y], ...] (its bottom row is the way in): built as part of
//            that wall, drawn as itself, so the door is a doorway with the wall going on above it - not a slot up to the top
//  abyss:    a drop the map draws black beside a walkway [x0, y0, x1, y1, depth in tiles]: left open instead of
//            walled in like the black ceiling - the floor's edge goes down into the dark with a small curb along
//            it, and a wall face drawn there right under a floor hangs below that floor's edge (mapmesh.js). With 'all' after
//            the depth: everything there nobody can reach is that drop (the black drawn with wall-top tiles, its decorations)
//  solids:   cells kept in the block round them [x0, y0, x1, y1] - walkable in the map, or drawn with a water tile, but part of a
//            facade (its columns, a garland down it): otherwise slits in it
//  wallFloors: cells drawn with wall tiles that are a floor [x0, y0, x1, y1] (a staircase drawn with building tiles): built as
//            floor at the heights the floors hint gives them, their drawing lying on them
//  overlaps: things drawn over each other (one mushroom's cap over the next one's): a piece that runs on into the one beside it,
//            not into the one under it, is the one beside it's - each thing whole, not cut where they overlap
//  mounds:   { a2: [A2 autotile kinds, 0-31], height in tiles }: ground of those kinds nobody walks on (a thicket round a path) is a
//            low bed of that ground with what grows on it standing on top - not a block with its pictures on the faces
//  highGround: { from: [x, y], height in tiles }: cliffs painted on ground that is all one level (their faces B-E tiles): the ground
//            a walk from (x, y) never gets to is the top of the cliffs, that high, and what is drawn straight down from its edge that
//            nobody walks through is a cliff's face, standing from the ground at its foot up to it (mapmesh.js)
const LIBRARY_GALLERY = [[11, 11, 32, 14, 2, 2], [13, 15, 15, 17, 2, 0], [28, 15, 30, 17, 2, 0]];
const LIBRARY_FRONT = [[11, 15, 32, 17, 2]];      // (the gallery's front: no higher than the gallery)
export const MAP_HINTS = {
  1: { sideView: true },     // 추락의 방: ledges and stairs up a brick tower, falls down its shaft
  // 병든 시계탑 (the hall): the crates, barrels and pots under the staircase drawn on the back wall, and the
  // staircase's foot - they stood as a block with the plank floor round them on its faces
  24: { props: [[13, 13, 21, 14]], hideArt: [[13, 13, 16, 14, [132, 133, 140, 141, 148, 149]]] },
  // 퀸・랜드 (the way in): a bridge (x13-15) over the dark to the castle's gate, balloons floating round it - the dark (drawn with
  // wall-top tiles) stood as walls along it, the balloons on their tops: open now, as far down as the castle's foot. The castle's
  // front kept whole (its columns at x9-10 / x18-19 are drawn with a water tile, the garlands down it at x6 / x22 on walkable
  // cells: slits in it), the stairs up to the gate a climb
  46: { abyss: [[0, 9, 12, 22, 6, 'all'], [16, 9, 29, 22, 6, 'all']], solids: [[6, 0, 6, 8], [9, 0, 10, 8], [18, 0, 19, 8], [22, 0, 22, 8]],
    floors: [[13, 4, 15, 8, 3, 0], [14, 3, 14, 3, 3, 3]] },
  // 퀸・랜드 １: the rides in the courtyard under the castle - the carousel, the teacups, the teapot (and the crates
  // beside them) - drawn against the courtyard's back wall: they joined it into one block, a box with the carousel
  // wrapped round it. Each stands as its own picture - the carousel, and the circus tent on the fairground, whole.
  // Its heights as drawn (all of it lay flat, every stair a picture on the floor): the courtyard behind the six-row front
  // (rows 46-51) at the road's level, through its three ways in; the walks along its sides (x3-5, x26-28) and over its
  // back wall (rows 30-31) on top of that wall's three rows, the stairs at x3-4 / x27-28 up to them; the great stairs
  // from there up to the castle (rows 20-29), the castle's own stairs (x14-16) up its front to the balcony at its door
  // (row 7) - its front as high as that balcony, the towers beside it and its upper front above it
  57: { props: [[6, 35, 13, 39], [16, 35, 18, 36], [21, 35, 25, 35], [23, 38, 25, 39], [18, 39, 20, 40]], whole: [[7, 35, 13, 39], [21, 80, 25, 84]],
    floors: [[3, 30, 28, 31, 3, 3], [3, 32, 5, 45, 3, 3], [26, 32, 28, 45, 3, 3], [3, 46, 4, 52, 3, 0], [27, 46, 28, 52, 3, 0],
      [3, 20, 28, 29, 8, 3], [14, 8, 16, 19, 14, 8], [3, 7, 28, 7, 14, 14]],
    caps: [[6, 32, 25, 34, 3.5], [5, 32, 5, 45, 3.5], [26, 32, 26, 45, 3.5]],
    tops: [[5, 46, 26, 51, 6], [3, 8, 13, 19, 14.5], [17, 8, 28, 19, 14.5], [0, 0, 2, 19, 21], [29, 0, 31, 19, 21], [3, 0, 28, 6, 21]] },
  // 퀸・랜드 ２ (the castle's hall): its casino galleries (x5-11, x27-33) a storey over the hall and the red walks along the
  // walls (x1-4, x34-37) one more over them, reached only by the side-on stairs drawn between them (the galleries' edges
  // let nobody across anywhere else) - all of it lay flat. The tents on the galleries (the ways into ２－１ / ２－２) stand
  // whole (drawn over the gallery's back wall and floor, they had joined the wall's block)
  165: { floors: [[5, 6, 11, 31, 2, 2], [27, 6, 33, 31, 2, 2], [1, 2, 4, 31, 4, 4], [34, 2, 37, 31, 4, 4],
      [12, 7, 15, 11, 2, 0, 'x'], [12, 26, 15, 30, 2, 0, 'x'], [23, 7, 26, 11, 0, 2, 'x'], [23, 26, 26, 30, 0, 2, 'x'],
      [5, 15, 8, 19, 4, 2, 'x'], [30, 15, 33, 19, 2, 4, 'x']],
    whole: [[5, 4, 9, 8], [29, 4, 33, 7]], props: [[5, 4, 9, 8], [29, 4, 33, 7]] },
  // 퀸・랜드 ２－１ / ２－２ (inside the tents on ２'s galleries): rooms drawn as their background pictures (curtains, a checkered
  // floor) over tiles that draw nothing, as １－２'s ２－１ below - the walls stood dark: the curtain on them, the striped wall
  // with the way in on the south one. ２－２'s stage (rows 5-6) stands 0.9 m up, its two stairs (row 7) up to it, its front a
  // low edge; its chest (12, 5) is no pillar
  173: { parallaxWalls: { back: [448, 95, 128, 70], front: [144, 435, 224, 90], backdrop: [95, 215] } },
  174: { parallaxWalls: { back: [240, 45, 320, 100], front: [144, 528, 224, 90], backdrop: [45, 145] }, walkedTo: [[12, 5]],
    floors: [[5, 5, 20, 6, 0.6, 0.6], [7, 7, 8, 7, 0.6, 0], [16, 7, 17, 7, 0.6, 0]], caps: [[5, 7, 6, 7, 0.7], [9, 7, 15, 7, 0.7], [18, 7, 20, 7, 0.7]] },
  // 퀸・랜드 １－２: the big carousel and the circus tent (its door the way into ２－１) - and １－３: the swing ride - the same
  260: { props: [[8, 0, 15, 9], [16, 21, 20, 24]], whole: [[8, 0, 15, 9], [16, 19, 20, 24]] },
  275: { props: [[2, 16, 7, 21]], whole: [[1, 13, 8, 22]] },
  // 퀸・랜드 １－４: its floor carries the counter flag - the coffins, the organ, the rocks, the sofa and the cabinets on it stood on
  // blocks as on tables (the coffins inside theirs, unseen): they stand / lie on the floor
  276: { props: [[8, 5, 11, 15], [21, 5, 21, 7], [21, 10, 21, 15]] },
  // 퀸・랜드 ２－１: the circus tent's inside, drawn as its background picture (curtains round a checkered floor) over tiles
  // that draw nothing - the walls stood dark, and the room (only ever walked into by its scene, from the door's step) was one
  // block, the camera on its tripod in it (12, 9) a pillar. The room is floor, the walls are the picture's curtain
  274: { walkedTo: [[15, 10], [12, 9]], parallaxWalls: { back: [240, 93, 288, 100], front: [144, 435, 224, 90], backdrop: [93, 195] } },
  // 퀸・랜드 ３ (the theatre): the stage (rows 6-10, reached only through its door from ４) stands 0.9 m above the house, its front
  // row - kept off by a blocking tile drawn as more stage - its lip (as 하얀 성시 ７－１１ BOSS ２'s)
  167: { floors: [[3, 6, 34, 10, 0.6, 0.6]], lips: [[3, 11, 34, 11, 0.1]] },
  // 퀸・랜드 ５ (her bedroom): the cabinets in a row along the west wall, each its own (they stood as one block of the wall,
  // the wall's own colour on its face); the bed in the alcove and its curtains the same (with the alcove behind it they
  // made a block three tiles high, the quilt stacked up its face) - the bed lies, the curtains hang beside it
  169: { props: [[5, 10, 6, 17], [12, 11, 15, 12]], cabinets: [[5, 10, 6, 17, 2]] },
  // 퀸・랜드 ６ BOSS: the throne room's back wall stands as tall as drawn (14 rows: its windows, the rose window - a block 6 high
  // with the rest lying on its top); the stairs east (x34-36) go down to ７
  170: { wallCap: 14, floors: [[34, 14, 36, 17, 0, -2]] },
  // 퀸・랜드 ７: the long stairs from the throne room down to the garden (rows 0-11); the garden's potted plants and its fence
  // stand on the grass (the grass carries the counter flag: they stood on blocks of grass as on tables)
  60: { floors: [[18, 0, 20, 11, 6, 0]], props: [[5, 4, 9, 12]] },
  // 리델 묘지: the rows of gravestones (and the open graves at their feet) in the yard before the cathedral stood as walls two and three
  // tiles high, the gravestones' pictures on their faces: each gravestone stands on its own, the open graves lie in the ground
  33: { props: [[2, 10, 33, 31], [38, 10, 68, 31]] },
  // 리델 묘지 １: the long stairs down into the crypt are drawn with building tiles - they stood as tall walls of their own steps
  // either side of the way down their middle: a staircase going down to the crypt's floor (six tiles), the way down its middle
  184: { wallFloors: [[10, 0, 14, 18], [11, 19, 13, 19]], floors: [[10, 0, 14, 19, 6, 0]] },
  // 포자의 숲 and its １: the thickets round the paths (A2 ground kind 2, never walked on) stood as walls two tiles high, the mushrooms
  // growing in them painted on their faces: low beds of that ground, the mushrooms standing on them. The mushrooms are drawn over
  // each other (one's cap over the next one's stem): each stands whole (overlaps) - they were cut in slices where they overlapped
  38: { mounds: { a2: [2], height: 0.35 }, overlaps: true },
  71: { mounds: { a2: [2], height: 0.35 }, overlaps: true },
  // (and its ２, ３ BOSS, ４, ３－１: their mushrooms drawn over each other the same way)
  72: { overlaps: true }, 73: { overlaps: true }, 74: { overlaps: true },
  // 병든 시계탑 3: two towers over the town at night, a walkway along their fronts and between them a bridge nobody can see
  // (row 14 - a step off it either side is a fall): the background lay as a plane just under the walkways, so no drop looked like one.
  // The towers stand as tall as drawn (the clock whole, not cut at 6 tiles) and the two black doors under the clock are doorways
  159: { openSky: true, wallCap: 14, doorTops: [[41, 12], [52, 12]] },
  // 소녀의 악몽: the girls in their nightmare forms (도마뱀 빌, 도도, 그리피, 시부치...: twelve fights) roam and chase -
  // they can be left behind through the exits (the user's choice; the nightmare's later bosses keep their arenas)
  49: { openFights: true },
  134: { flatPictures: [912] },   // 홍성 프릿셀 6: the croquet hoops - walked through in order to open a door
  // 홍성 프릿셀 7 (개방형 홀), behind the croquet door: the bridge the axes swing across, over the dark the hall's
  // foundation drops into - its sides small curbs, not walls, so the axes are seen coming
  142: { abyss: [[3, 8, 10, 50, 6], [14, 8, 21, 50, 6]] },
  // 도서관의 꿈 and the libraries built on it (옥스・워드 대학교 ２ BOSS, 하얀 성시 ７－１１ BOSS and its １): the back of the
  // hall is a gallery two tiles up (its front the bookshelves of rows 15-16, its railing row 14), reached by the
  // stairs at x13-15 and x28-30 - all of it lay flat, the stairs drawn on the floor, the white door up there
  101: { floors: LIBRARY_GALLERY, caps: LIBRARY_FRONT, massBackdrop: true },
  154: { floors: LIBRARY_GALLERY, caps: LIBRARY_FRONT, massBackdrop: true },
  // Ox Ward University's first hall: original seven-row falls off the west
  // gallery establish its height. The two three-wide evilcastle_A5 flights
  // are stairs, not flat rooms that should all rise with that gallery. The
  // upper seven-row flight climbs its twelve-row book wall to the next door.
  155: { fallStairs: [[30, 14, 32, 21, 7], [30, 5, 32, 11, 7]],
    floors: [[54, 9, 54, 11, 3, 0], [54, 8, 54, 8, 3, 3]],
    caps: [[26, 14, 56, 21, 7.5]], tops: [[26, 0, 56, 11, 19]], wallCap: 14 },
  372: { floors: LIBRARY_GALLERY, caps: LIBRARY_FRONT, massBackdrop: true },
  373: { floors: LIBRARY_GALLERY, caps: LIBRARY_FRONT },
  // 하얀 성시 ７－１１ BOSS ２ (그랑・기뇰's theatre): the stage (rows 6-10) stands 0.9 m above the house; its front
  // row, kept off in the original by an invisible tile and drawn as more stage, is the stage's lip - not a wall
  // between the stage and the house
  374: { floors: [[3, 6, 31, 10, 0.6, 0.6]], lips: [[3, 11, 31, 11, 0.1]] },
  // 하얀 성시 ３: the way up through the castle - from the snowy yard (rows 42-48) up four flights of stairs drawn on the floor (x4-5,
  // x18-19, x4-5 with a landing at rows 15-16) to three corridors, each a storey over the last: all of it lay flat. The walls
  // between two corridors stand two tiles over the higher one (left to themselves they rose in steps, ledges up their faces)
  346: { floors: [[4, 7, 19, 10, 10, 10], [17, 10, 22, 11, 10, 10], [4, 11, 5, 14, 10, 8], [4, 15, 5, 16, 8, 8], [4, 17, 5, 21, 8, 5.5],
    [0, 22, 19, 23, 5.5, 5.5], [18, 24, 19, 27, 5.5, 5.5], [18, 28, 19, 32, 5.5, 3], [4, 33, 19, 35, 3, 3], [4, 36, 5, 41, 3, 0]],
    tops: [[0, 0, 3, 21, 12], [6, 10, 16, 21, 12], [17, 12, 22, 21, 12], [0, 24, 18, 26, 7.5], [0, 27, 17, 32, 7.5], [20, 22, 22, 35, 7.5]] },
  // 하얀 성시 ３－１ BOSS (흑기사 린다메아): from the castle's back door a canyon runs down between snow plateaus to the hollow where
  // she waits - the plateaus' rock faces painted on ground all at one level: it lay flat, the faces boards standing about on it
  350: { highGround: { from: [16, 7], height: 2 } },
  // 하얀 성시 ７ (윈터벨): white houses with flat roofs and terraces, stairs between them drawn as A5 floor tiles -
  // all of it one flat level otherwise (the stairs joined every level)
  353: { terraces: { stairs: [8, 9, 10, 16, 17, 18], sideStairs: [3, 4, 11, 12, 13, 22, 23, 30, 31, 37, 38, 43, 44] } },
  // 하얀 성시 ７－３: the same town along the shore (the street over the wall west of the garden, stairs up to the arches)
  356: { terraces: { stairs: [8, 9, 10, 16, 17, 18], sideStairs: [3, 4, 11, 12, 13, 22, 23, 30, 31, 37, 38, 43, 44] } },
};

// the rules as this file has them, before the map editor's (mapedit.html) are put over them
export const BUILTIN_HINTS = JSON.parse(JSON.stringify(MAP_HINTS));
// The map editor's rules (src/maphints.user.json - mapedit.html writes it): a map there has its rules from there, all of them
// (an empty {} - none); a map not there keeps this file's. Read as the game starts and again each time it goes to another map
// (main.js), so what the editor saved shows on going into the map again; a map taken out of the file has this file's back.
// -> the rules read (null: the file could not be read - those in use stay)
export const USER_HINTS_FILE = 'src/maphints.user.json';
let userApplied = [];
export async function loadUserHints() {
  let user;
  try {
    const r = await fetch(USER_HINTS_FILE, { cache: 'no-store' });
    if (!r.ok) return null;
    user = await r.json();
  } catch { return null; }
  if (!user || typeof user !== 'object' || Array.isArray(user)) return null;
  for (const id of userApplied) {
    if (BUILTIN_HINTS[id]) MAP_HINTS[id] = JSON.parse(JSON.stringify(BUILTIN_HINTS[id]));
    else delete MAP_HINTS[id];
  }
  userApplied = [];
  for (const [id, entry] of Object.entries(user)) {
    if (!/^\d+$/.test(id) || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    MAP_HINTS[id] = entry;
    userApplied.push(id);
  }
  return user;
}

export function floorHints(mapId) { return MAP_HINTS[mapId]?.floors || null; }
export function fallStairHints(mapId) { return MAP_HINTS[mapId]?.fallStairs || null; }
export function lipHints(mapId) { return MAP_HINTS[mapId]?.lips || null; }
export function abyssHints(mapId) { return MAP_HINTS[mapId]?.abyss || null; }
export function openFights(mapId) { return !!MAP_HINTS[mapId]?.openFights; }
export function isSideView(mapId) { return !!MAP_HINTS[mapId]?.sideView; }
export function flatPictures(mapId) { return MAP_HINTS[mapId]?.flatPictures || null; }
export function terraceHints(mapId) { return MAP_HINTS[mapId]?.terraces || null; }
export function propHints(mapId) { return MAP_HINTS[mapId]?.props || null; }
export function wholeHints(mapId) { return MAP_HINTS[mapId]?.whole || null; }
export function cabinetHints(mapId) { return MAP_HINTS[mapId]?.cabinets || null; }
export function walkedTo(mapId) { return MAP_HINTS[mapId]?.walkedTo || []; }
export function parallaxWalls(mapId) { return MAP_HINTS[mapId]?.parallaxWalls || null; }
export function hideArtHints(mapId) { return MAP_HINTS[mapId]?.hideArt || null; }
export function capHints(mapId) { return MAP_HINTS[mapId]?.caps || null; }
export function solidHints(mapId) { return MAP_HINTS[mapId]?.solids || null; }
export function wallFloorHints(mapId) { return MAP_HINTS[mapId]?.wallFloors || null; }
export function moundHints(mapId) { return MAP_HINTS[mapId]?.mounds || null; }
export function highGround(mapId) { return MAP_HINTS[mapId]?.highGround || null; }
export function overlapHints(mapId) { return !!MAP_HINTS[mapId]?.overlaps; }
export function topHints(mapId) { return MAP_HINTS[mapId]?.tops || null; }
export function massBackdrop(mapId) { return !!MAP_HINTS[mapId]?.massBackdrop; }
export function openSky(mapId) { return !!MAP_HINTS[mapId]?.openSky; }
export function wallCap(mapId) { return MAP_HINTS[mapId]?.wallCap || 0; }
export function doorTops(mapId) { return MAP_HINTS[mapId]?.doorTops || null; }

// Background pictures (parallaxes) not wrapped round the sky (sky.js) - the user's choice: 루트위지 시가지's stone
// street and 도지슨교's town under clouds, the book of 도서관의 꿈 (also 하얀 성시 ７－１１ BOSS), cave rock
// (도살장), flesh (무한음식), the clock face (병든 시계탑 1)
export const NOT_SKY = new Set(['rad2', 'rad3', 'book02', 'firecave', 'monster39', 'ijigen']);
export function skyPicture(name) { return !!name && !NOT_SKY.has(name); }
// ... and those that are the whole background in 2D, with no horizon - a sky, space, a texture (gears, the mental
// world's glass / wood / colour blots, blue flames): they cover the sky overhead too, not only a band round the
// horizon with plain colour above (sea views, the moon, towns and mountains far off keep their horizon at eye level)
export const SKY_ALL_OVER = new Set(['StarlitSky', 'CloudySky2', 'BlueSky', '64380033_p2_master1200', 'publicdomainq-0021126ule',
  'Cave3', '精神世界', '精神世界２', '精神世界３']);
export function skyAllOver(name) { return SKY_ALL_OVER.has(name); }
