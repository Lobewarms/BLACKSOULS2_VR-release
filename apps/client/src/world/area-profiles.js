import { skyPicture } from './maphints.js';

// Enclosure comes from the original game's authored tileset families, not the
// translated map title or the presence of a background/weather effect. These
// neutral lights leave the palette to the original textures and map tone.
const profiles = {
  neutral: { outdoor: false, fogNear: 18, fogFar: 65, background: 0x191a1c, fogColor: 0x191a1c, ambient: 0.34, hemi: 1.1, groundColor: 0xb8b8b8, headlightIntensity: 3, headlightRange: 11 },
  interior: { outdoor: false, fogNear: 18, fogFar: 64, background: 0x1c1d1f, fogColor: 0x1c1d1f, ambient: 0.36, hemi: 1.15, groundColor: 0xbdbdbd, headlightIntensity: 3, headlightRange: 12 },
  hospital: { outdoor: false, fogNear: 22, fogFar: 74, background: 0x232527, fogColor: 0x232527, ambient: 0.44, hemi: 1.22, groundColor: 0xc4c4c4, headlightIntensity: 2.2, headlightRange: 12 },
  library: { outdoor: false, fogNear: 22, fogFar: 78, background: 0x242425, fogColor: 0x242425, ambient: 0.4, hemi: 1.18, groundColor: 0xc0c0c0, headlightIntensity: 2.5, headlightRange: 12 },
  dream: { outdoor: false, fogNear: 30, fogFar: 110, background: 0x303035, fogColor: 0x303035, ambient: 0.48, hemi: 1.3, groundColor: 0xc8c8c8, headlightIntensity: 1, headlightRange: 10 },
  dungeon: { outdoor: false, fogNear: 12, fogFar: 44, background: 0x0d0e10, fogColor: 0x0d0e10, ambient: 0.24, hemi: 0.95, groundColor: 0x999999, headlightIntensity: 5, headlightRange: 13 },
  cave: { outdoor: false, fogNear: 14, fogFar: 52, background: 0x141518, fogColor: 0x141518, ambient: 0.28, hemi: 1.02, groundColor: 0xa3a3a3, headlightIntensity: 4, headlightRange: 13 },
  castle: { outdoor: false, fogNear: 22, fogFar: 82, background: 0x1c1d20, fogColor: 0x1c1d20, ambient: 0.34, hemi: 1.12, groundColor: 0xb4b4b4, headlightIntensity: 3, headlightRange: 12 },
  theater: { outdoor: false, fogNear: 14, fogFar: 56, background: 0x0d0e10, fogColor: 0x0d0e10, ambient: 0.24, hemi: 0.98, groundColor: 0x999999, headlightIntensity: 3.5, headlightRange: 12 },
  organic: { outdoor: false, fogNear: 13, fogFar: 46, background: 0x171719, fogColor: 0x171719, ambient: 0.29, hemi: 1.04, groundColor: 0xaaaaaa, headlightIntensity: 3.5, headlightRange: 12 },
  town: { outdoor: true, fogNear: 34, fogFar: 150, background: 0x4a4c50, fogColor: 0x4a4c50, ambient: 0.44, hemi: 1.38, groundColor: 0xc2c2c2, headlightIntensity: 0.6, headlightRange: 9 },
  forest: { outdoor: true, fogNear: 27, fogFar: 120, background: 0x454a47, fogColor: 0x454a47, ambient: 0.4, hemi: 1.3, groundColor: 0xbdbdbd, headlightIntensity: 0.8, headlightRange: 9 },
  'spore-forest': { outdoor: true, fogNear: 25, fogFar: 110, background: 0x50524e, fogColor: 0x50524e, ambient: 0.42, hemi: 1.34, groundColor: 0xc2c2c2, headlightIntensity: 0.6, headlightRange: 9 },
  'fuming-forest': { outdoor: true, fogNear: 27, fogFar: 120, background: 0x4c4948, fogColor: 0x4c4948, ambient: 0.42, hemi: 1.32, groundColor: 0xc0c0c0, headlightIntensity: 0.7, headlightRange: 9 },
  snow: { outdoor: true, fogNear: 38, fogFar: 155, background: 0xa8afb6, fogColor: 0xa8afb6, ambient: 0.6, hemi: 1.5, groundColor: 0xd0d0d0, headlightIntensity: 0.2, headlightRange: 7 },
  coast: { outdoor: true, fogNear: 42, fogFar: 175, background: 0x62696e, fogColor: 0x62696e, ambient: 0.46, hemi: 1.4, groundColor: 0xc4c4c4, headlightIntensity: 0.4, headlightRange: 8 },
  cemetery: { outdoor: true, fogNear: 28, fogFar: 115, background: 0x3c4042, fogColor: 0x3c4042, ambient: 0.38, hemi: 1.24, groundColor: 0xb8b8b8, headlightIntensity: 1, headlightRange: 10 },
  underwater: { outdoor: false, fogNear: 20, fogFar: 85, background: 0x242c34, fogColor: 0x242c34, ambient: 0.38, hemi: 1.2, groundColor: 0xb8b8b8, headlightIntensity: 1.5, headlightRange: 11 },
  'deep-sea': { outdoor: false, fogNear: 14, fogFar: 55, background: 0x0a1019, fogColor: 0x0a1019, ambient: 0.28, hemi: 1, groundColor: 0xa0a0a0, headlightIntensity: 2, headlightRange: 12 },
  cosmic: { outdoor: true, fogNear: 36, fogFar: 155, background: 0x0a0b12, fogColor: 0x0a0b12, ambient: 0.38, hemi: 1.2, groundColor: 0xb8b8b8, headlightIntensity: 0.6, headlightRange: 9 },
};

const tilesetKinds = new Map();
const family = (kind, ids) => { for (const id of ids) tilesetKinds.set(id, kind); };
family('interior', [7, 12, 16, 27, 41, 42, 48, 55, 59, 63, 92, 104, 105, 116, 135, 136]);
family('hospital', [35, 36, 37, 43, 123]);
family('library', [19, 20, 87]);
family('dream', [6, 99, 100]);
family('dungeon', [4, 5, 21, 22, 24, 28, 31, 32, 33, 34, 45, 50, 51, 69, 101, 106, 109, 118, 137]);
family('cave', [14, 15, 130]);
family('castle', [3, 30, 71, 72, 73, 74, 75, 77, 80, 85, 97]);
family('theater', [96]);
family('organic', [44, 46]);
family('town', [2, 25, 26, 40, 70, 78, 79, 82, 86, 91, 94, 95, 108, 110, 111, 112, 113, 114, 119]);
family('forest', [8, 17, 18, 23, 67, 68, 76, 84, 89, 90, 117]);
family('spore-forest', [38, 39, 49]);
family('fuming-forest', [65, 66]);
family('snow', [53, 54, 121, 122, 124, 125, 127, 129, 131, 132, 133, 134]);
family('coast', [47, 57, 93, 102, 103]);
family('cemetery', [29, 128]);
family('underwater', [13, 61, 62]);
family('deep-sea', [58, 60]);

// Small exceptions for reused tilesets. Keep the source tileset guard so an
// event changing the tileset does not retain a stale map-specific atmosphere.
const mapKinds = new Map([
  [17, { tileset: 1, kind: 'cosmic' }],              // Moon, not the generic Field placeholder.
  [94, { tileset: 47, kind: 'interior' }],          // Market storeroom reuses the wharf tileset.
  [101, { tileset: 19, kind: 'dream' }],            // Library Dream versus the ordinary library stairs.
  [152, { tileset: 3, kind: 'dungeon' }],
  [198, { tileset: 3, kind: 'dungeon' }],
  [171, { tileset: 2, kind: 'dream', outdoor: true }], // The World's Dream, its own open panorama.
  [173, { tileset: 1, kind: 'interior' }],          // Stuffed Toy Dump's authored interior.
  [174, { tileset: 1, kind: 'interior' }],          // Circus Tent, not the Field placeholder.
  [195, { tileset: 1, kind: 'dream' }],             // Enclosed escape/ending corridor.
  [207, { tileset: 1, kind: 'town' }],              // Open BlueSky arena using the generic Field set.
  [274, { tileset: 1, kind: 'theater' }],           // Lovecraft Cinema.
  [291, { tileset: 1, kind: 'cosmic' }],            // Cosmos and its Milky Way backdrop.
  [326, { tileset: 123, kind: 'town' }],            // Battlefield outside the nursing wards.
  [329, { tileset: 19, kind: 'dream' }],
  [341, { tileset: 1, kind: 'interior' }],          // Igloo's floor picture is not a sky.
  [345, { tileset: 124, kind: 'castle' }],
  [346, { tileset: 124, kind: 'castle' }],
  [354, { tileset: 133, kind: 'interior' }],
  [355, { tileset: 133, kind: 'interior' }],
  [372, { tileset: 19, kind: 'dream' }],
  [376, { tileset: 133, kind: 'interior' }],
  [377, { tileset: 133, kind: 'interior' }],
]);

// These are actual distant outdoor views in the installed game's map data.
// Cave/mental-world/gears images, water floor images and yuka floor pictures
// may be shown by Sky, but do not establish an open outdoor sky.
const openSkyPictures = new Set(['BlueSky', 'CloudySky2', 'StarlitSky', 'Ocean1', 'Ocean2', 'Ocean3', 'Mountains4',
  '月湖', '月面', '47261773_p0', 'cr', 'normandy-1827275_1280', 'mont-st-michel-1022830_1280', '64380033_p2_master1200']);

function fallbackSky(profile, note = '') {
  if (!profile.outdoor) return '';
  // These are existing original-game panoramas, loaded from the selected game.
  // The original cool-night tone identifies night without using translated names.
  const tone = /<色調\s+(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)/i.exec(note);
  const red = Number(tone?.[1] || 0), green = Number(tone?.[2] || 0), blue = Number(tone?.[3] || 0);
  if (profile.kind === 'cosmic') return '64380033_p2_master1200';
  if (red <= -24 && green <= -24 && blue >= Math.max(red, green) + 24) return 'StarlitSky';
  if (profile.kind === 'snow' || profile.kind === 'fuming-forest' || profile.kind === 'cemetery') return 'CloudySky2';
  return 'CloudySky1';
}

export function areaProfile(map, { mapId = 0, tileset = null } = {}) {
  const tilesetId = Number(tileset?.id ?? map?.tileset_id);
  const override = mapKinds.get(Number(mapId));
  const exception = override?.tileset === tilesetId ? override : null;
  const kind = exception?.kind || tilesetKinds.get(tilesetId) || 'neutral';
  const profile = { kind, ...profiles[kind] };
  if (exception?.outdoor != null) profile.outdoor = exception.outdoor;
  const parallax = map?.parallax_name || '';
  profile.openSky = profile.outdoor && !!map?.parallax_show && skyPicture(parallax) && openSkyPictures.has(parallax);
  profile.fallbackSky = fallbackSky(profile, map?.note);
  return profile;
}
