// Shared runtime context (the $game_* globals of RPG Maker).
export const G = {
  state: null,     // GameState: switches, variables, party, actors
  map: null,       // GameMap: current map, events, interpreter
  player: null,    // Player (first-person)
  ui: null,        // UI (message, choices, HUD)
  audio: null,     // AudioManager
  screen: null,    // ScreenFx (tone, fade, flash)
  movies: null,    // Original event-movie playback (PC and VR)
  combat: null,    // CombatSystem
  input: null,     // Input
  three: null,     // { renderer, scene, camera, rig }
  settings: {
    minimap: true,
    snapTurn: true, snapAngle: 30, smoothTurnSpeed: 120, moveSpeed: 3.2, runMultiplier: 1.7,
    vignette: true, difficulty: 1.0, showDamage: true, eyeHeight: 1.6, handedness: 'right',
    spectator: true,       // show the headset view on the PC monitor for people watching
    spectatorLevel: false, // keep the spectator horizon level (ignore head roll)
    spectatorSmooth: 0,    // 0 off, 1 light, 2 medium, 3 strong
    spectatorFov: 80,
    swingLevel: 2,           // how hard a VR swing must be to hit: 0 light, 1 normal, 2 strong, 3 very strong
    weaponWeight: 2,         // VR blade follow-through: 0 off, 1 light, 2 normal, 3 heavy
    fxBrightness: 0.5,       // flashes, glows and animation sprites (0.25 .. 1)
    skillAnims: 'all',       // RPG Maker animation sprites: 'all' | 'skills' (not plain attacks) | 'off'
    enemyThroughWalls: true, // chasing enemies pass through walls and props instead of getting stuck
    respawn: 'map',          // defeated field enemies: 'map' (back after leaving the map) | 'slow' | 'original' (10 s)
    battleBgm: 'boss',       // battle music: 'boss' (only fights with their own BGM) | 'all' (every fight, like the original)
    breakRule: 'original',   // Break: 'original' (the enemy's rate; most open up only while charging / guarding) | 'easy'
    hitFlash: true,          // being hit: the edges of the view flush red
    hitShake: true,          // being hit: the view is knocked a little (it can make some people sick in a headset)
  },
  frame: 0,          // logic frame counter (60 Hz)
  time: 0,           // seconds since start
  vr: false,         // in an immersive XR session
  scripts: {},       // data extracted from the game's RGSS scripts
  log: (...a) => console.log('[game]', ...a),
};

// Scene names that a script call may ask for; handled by the VR menu layer
export const SCENE_REQUESTS = [];
