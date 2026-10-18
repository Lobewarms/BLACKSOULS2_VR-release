// Furniture drawn as seen from above (beds, tables with their top drawn, coffins lying on the floor,
// bathtubs): stood up like other pictures they look like a bed standing on end, so they lie as low blocks
// with the drawing on top. RPG Maker keeps no such mark, so this list was made by looking at every
// object of two or three rows in all maps, and every bed-like one of any size or with its head drawn on
// the wall above it: tileset image -> tile indexes on that image (0-255, as in the tileset's B-E sheets)
export const LYING_TILES = {
  'PirateShipInv-Cove': [240, 241, 242, 243, 248, 249, 250, 251],                      // round tables with stools
  '食肉園 (5)': [128, 129, 130, 131, 133, 134, 135, 136, 137, 138, 139, 141, 142, 143, 144, 145, 146, 147, 149, 150, 151], // beds
  '食肉園 (7)': [0, 1, 8, 10, 16, 18, 161, 162, 165, 169, 170, 172, 173, 177, 178, 180, 181],       // beds, coffins
  '食肉園 (8)': [226, 227, 228, 234, 235, 236, 242, 243, 244],                           // lace-covered table
  'クインランド (2)': [179, 180, 181, 182, 187, 188, 189, 190, 195, 196, 197, 198, 203, 204, 205, 206, 211, 212, 213, 214,
    216, 217, 218, 219, 224, 225, 226, 227, 232, 233, 234, 235, 236, 237, 238, 240, 241, 242, 243, 244, 245, 246], // billiard and casino tables (195-198: the roulette table's legs, walkable)
  'クインランド (3)': [128, 129, 136, 137, 144, 145],                                     // card tables (144-145: the stools in front, walkable)
  'VXTileD': [144, 145, 146, 147, 152, 153, 154, 155, 160, 161, 162, 163, 174, 175, 182, 183, 190, 191], // beds, canopy bed
  'B_おばけ改変①': [9, 17, 48, 49, 56, 57, 64, 65],                                     // beds, table with food
  'B_おばけ改変②': [81, 83, 84, 89, 91, 92, 244, 252],                                   // beds
  '地中海Tile_B': [20, 21, 28, 29, 30, 31, 36, 37, 38, 39, 46, 47, 50, 51, 52, 58, 59, 60, 66, 67, 68], // beds (46-47: a bed's foot, walkable), oval tables (66-68: a round one's foot, walkable)
  'FW_Horror_Tile-C': [81, 82, 83, 89, 90, 91, 146, 147, 154, 155],                      // stone beds, bathtubs
  'ラドウィッジ下層 (4)': [16, 24, 32, 42, 43, 50, 51, 57, 58, 59, 65, 238, 239, 254, 255], // beds (32, 58-59: their feet, walkable), bathtub (238-239: its rim, drawn above the player)
  'evilcastle_B': [202, 203, 210, 211],                                                  // coffins
  '病棟': [80, 81],                                                                      // hospital bed
  'クリミア (4)': [174, 182, 190],                                                        // hospital bed (190: its foot, walkable)
  'Inside_B': [81, 82, 88, 89, 90, 94],                                                  // beds (81-90: the green double bed, 퀸・랜드 ５)
  '子供部屋2': [8, 16],                                                                   // bed (16: its foot, walkable)
};
