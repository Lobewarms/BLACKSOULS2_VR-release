// BLACKSOULS VR - boot, title, map transfers and the frame loop.
import * as THREE from 'three';
import { G } from './globals.js';
import { tr, fmtDate } from '../ui/i18n.js';
import { createVRButton, prepareXR } from '../vr/vrbutton.js';
import { initAssets, loadFont, loadImage, fetchBinary, listFiles, hasFile } from '../data/assets.js';
import { $data, loadDatabase, mapName } from '../data/data.js';
import { MarshalReader } from '../data/marshal.js';
import { billboardUniforms, T } from '../world/mapmesh.js';
import { GameState } from '../game/state.js';
import { readSaveSlots, readSaveState, writeSaveFile } from '../game/savefiles.js';
import { prepareSaveLocations, saveLocation } from '../game/savepresentation.js';
import { GameMap } from '../world/gamemap.js';
import { Player } from '../entities/player.js';
import { Input } from './input.js';
import { UI, loadUiAssets, FONT } from '../ui/ui.js';
import { AudioManager } from '../ui/audio.js';
import { ScreenFx } from '../ui/screen.js';
import { CombatSystem } from '../combat/combat.js';
import { BossArena } from '../combat/arena.js';
import { Theater } from '../ui/theater.js';
import { Emotes } from '../ui/emotes.js';
import { CharacterSprite, layoutTilePictures } from '../entities/sprites.js';
import { Poke } from '../game/poke.js';
import { Sky } from '../world/sky.js';
import { BalloonIcon } from '../ui/balloons.js';
import { loadScriptData } from '../data/scriptdata.js';
import { buildMapView } from '../world/mapbuild.js';
import { clearEdgeCache } from '../world/collision.js';
import { TransferMarkers } from '../world/markers.js';
import { Spectator } from '../vr/spectator.js';
import { PictureLayer } from '../ui/pictures.js';
import { Hands } from '../vr/hands.js';
import { loadUserHints } from '../world/maphints.js';
import { adjustStore, replaceAdjustStore, onAdjustChange } from '../combat/weapons.js';
import { Coop } from '../network/coop.js';

const statusEl = document.getElementById('status');
const setStatus = t => { if (statusEl) statusEl.textContent = t; };
// the parts this VR version adds speak the launcher's language (src/i18n.js); the game's own text is untouched
// (the controls are explained in the README files, not on the page)
setStatus(tr('로딩 중...'));

// ------------------------------------------------------------------ three.js setup
const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030305);
scene.fog = new THREE.Fog(0x030305, 10, 38);
const rig = new THREE.Group();
scene.add(rig);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 300);
camera.position.set(0, G.settings.eyeHeight, 0);
rig.add(camera);
const hemi = new THREE.HemisphereLight(0xc8c4d8, 0x2a2018, 1.25);
scene.add(hemi);
const torch = new THREE.PointLight(0xffc890, 14, 13, 1.5);
scene.add(torch);
G.three = { renderer, scene, camera, rig };
const spectator = new Spectator(renderer, scene);
G.spectator = spectator;

function fitView() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  fitView();
});

// ------------------------------------------------------------------ settings
// Settings (menu options + weapon hold poses) are kept by the server in vr/saves/settings.json so every
// browser shares them; localStorage is only a fallback. Debug launches (?save= / ?map= / ?timer) never write.
const DEV_LAUNCH = ['save', 'map', 'timer', 'vrsave'].some(k => new URLSearchParams(location.search).has(k));
G.devLaunch = DEV_LAUNCH;
let localSettings = {};
try { localSettings = JSON.parse(localStorage.getItem('bsvr.settings') || '{}'); } catch { /* */ }
Object.assign(G.settings, localSettings);
let settingsTimer = 0;
function pushSettings() {
  clearTimeout(settingsTimer);
  if (DEV_LAUNCH) return;
  settingsTimer = setTimeout(() => {
    const body = JSON.stringify({ settings: G.settings, itemAdjust: adjustStore() });
    fetch('/api/settings', { method: 'POST', body }).catch(() => { /* old server: localStorage still has it */ });
  }, 400);
}
G.saveSettings = () => {
  try { localStorage.setItem('bsvr.settings', JSON.stringify(G.settings)); } catch { /* */ }
  pushSettings();
};
onAdjustChange(pushSettings);
async function loadServerSettings() {
  try {
    const r = await fetch('/api/settings');
    if (!r.ok) return;
    const data = await r.json();
    if (data && data.settings) {
      Object.assign(G.settings, data.settings);
      try { localStorage.setItem('bsvr.settings', JSON.stringify(G.settings)); } catch { /* */ }
      if (data.itemAdjust) replaceAdjustStore(data.itemAdjust);
      G.combat && (G.combat.equipKey = null);
    } else if (!DEV_LAUNCH && (Object.keys(localSettings).length || Object.keys(adjustStore()).length)) {
      pushSettings();     // first run with server-side settings: move this browser's copy over
    }
  } catch { /* old server without /api/settings */ }
}

// ------------------------------------------------------------------ subsystems
G.input = new Input(renderer, renderer.domElement);
G.input.setupXR(scene, rig);
G.audio = new AudioManager();
G.screen = new ScreenFx(camera);
G.ui = new UI(scene, camera, rig);
G.pictures = new PictureLayer(G.ui, camera);
G.player = new Player(rig, camera);
G.combat = new CombatSystem(scene);
G.arena = new BossArena(scene);
G.theater = new Theater(scene);
G.coop = new Coop(scene);                // (co-op: another player in this world, or this one in theirs - coop.js)
G.emotes = new Emotes();                 // (co-op: a balloon put up over this player's head - emotes.js)
const markers = new TransferMarkers(scene);
G.floorAt = () => 0;

// hands instead of the controller models (hidden while they hold the weapon / shield)
G.hands = new Hands();
G.poke = new Poke();
G.sky = new Sky(scene);
G.onControllerConnected = (hand, ctrl, grip) => {
  G.hands.attach(hand, ctrl);
  if (hand === 'left') G.ui.attachHud(grip);
  G.combat.equipKey = null;
};
renderer.xr.addEventListener('sessionstart', () => {
  G.vr = true;
  G.xrAway = false;
  spectator.start();
  camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
  G.combat.equipKey = null;
  G.audio.resumeAll();
  // keep the user standing where the desktop camera was
  const pc = G.map?.playerChar;
  setTimeout(() => { if (pc && G.map.grid) G.player.teleportTo(pc.fx, pc.fy); G.ui.placeRoot(true); }, 300);
});
// three r170 lets go of its headset render target when a session ends without freeing it: with projection layers
// (Chrome on PC) its multisampled colour and depth buffers - headset sized, 4x MSAA, hundreds of MB - stayed on the
// GPU after every session. They are freed here; the textures / framebuffer the headset lent it are not ours.
let xrTarget = null;
function freeXrTarget() {
  const rt = xrTarget;
  xrTarget = null;
  if (!rt) return;
  try {
    const props = renderer.properties, p = props.get(rt);
    if (p.__useDefaultFramebuffer !== undefined) p.__webglFramebuffer = undefined;     // an XRWebGLLayer's framebuffer
    if (p.__hasExternalTextures) {
      props.get(rt.texture).__webglTexture = undefined;
      if (rt.depthTexture) props.get(rt.depthTexture).__webglTexture = undefined;
    }
    rt.dispose();
  } catch (e) { console.warn('[xr] could not free the headset render target', e); }
}
renderer.xr.addEventListener('sessionend', () => {
  G.vr = false;
  G.xrAway = false;
  freeXrTarget();
  spectator.stop();
  camera.position.set(0, G.settings.eyeHeight, 0);
  G.ui.attachHud(null);
  G.combat.equipKey = null;
});
document.getElementById('vrbtn').appendChild(createVRButton(renderer, {
  restoreView: fitView,
  // the headset shows something else (the SteamVR dashboard or desktop, the system menu, the headset is off):
  // the game waits, as it does behind a menu
  onVisibility: v => { G.xrAway = v === 'visible-blurred' || v === 'hidden'; },
  // after a session the local server ends this browser's WebXR process, so the next ENTER VR starts a fresh one
  // (src/vrbutton.js); true when it did
  resetXr: async () => {
    const r = await fetch('/api/xr-reset', { method: 'POST' });
    if (!r.ok) return false;
    const j = await r.json().catch(() => ({}));
    console.info('[xr] XR process reset:', JSON.stringify(j));
    return (j.ended || 0) > 0;
  },
}));

// ------------------------------------------------------------------ map presentation
const view = { mesh: null, sprites: [], mapId: 0 };
G.view = view;   // (debug) current map mesh and sprites
function clearMapView() {
  markers.clear();
  G.floorAt = () => 0;
  if (view.mesh) { scene.remove(view.mesh.group); view.mesh.dispose(); view.mesh = null; }
  for (const c of view.loop?.copies || []) {
    scene.remove(c.obj);
    c.obj.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
  }
  view.loop = null;
  for (const s of view.sprites) s.dispose();
  view.sprites = [];
  G.poke?.reset();
}
function toneFromNote(note) {
  const m = /<色調\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)(?:,\s*(-?\d+))?>/.exec(note || '');
  return m ? { red: +m[1], green: +m[2], blue: +m[3], gray: +(m[4] || 0) } : null;
}
// seeds: where the player arrives (the cells walkable from there decide which wall tops are solid);
// rebuild: the same map again, the old view kept until the new one is ready (and dropped if a transfer
// came first); open: cells to build as open floor (the dark a boss fight opened - arena.js)
let presentToken = 0;
async function presentMap(seeds = [], rebuild = false, open = null) {
  const token = ++presentToken;
  if (!rebuild) clearMapView();
  const grid = G.map.grid;
  view.seeds = seeds;
  // (built as the map editor builds it - mapbuild.js: the hints, the grid it is built from, where the player can get to;
  // fall zones, doors and exits from the events' current pages)
  const { mesh, ana, walk } = await buildMapView({ map: G.map.map, grid, mapId: G.map.mapId, events: G.map.eventList.map(ev => ev.event),
    pageOf: rmEv => G.map.events[rmEv.id]?.page || null, seeds, open });
  if (token !== presentToken) { mesh.dispose(); return; }
  if (rebuild) clearMapView();
  // wall tops nobody reaches, and beds / tables lying as low blocks (their head row is walkable in RPG
  // Maker, under the drawing)
  const blocked = [...(walk?.blocked || []), ...(mesh.lyingCells || [])];
  G.map.blockedCells = blocked.length ? new Set(blocked) : null;
  view.analysis = ana;
  view.mesh = mesh;
  view.mapId = G.map.mapId;
  scene.add(mesh.group);
  // a looping map: copies of it all round (they share its geometry), kept around the player (updateLoopView)
  view.loop = null;
  if (G.map.loopX || G.map.loopY) {
    const copies = [];
    for (const i of G.map.loopX ? [-1, 0, 1] : [0]) {
      for (const j of G.map.loopY ? [-1, 0, 1] : [0]) {
        if (!i && !j) continue;
        const obj = mesh.group.clone();
        scene.add(obj);
        copies.push({ obj, i, j });
      }
    }
    view.loop = { copies, w: grid.w * T, h: grid.h * T };
  }
  G.floorAt = (fx, fy) => mesh.floorAt(G.map.wrapFX(fx), G.map.wrapFY(fy)) * T;
  G.solidTopAt = (x, y) => mesh.solidTopAt(G.map.wrapX(x), G.map.wrapY(y));
  markers.build(ana.exits);
  // events
  const mapInfo = {
    isWall: (x, y) => mesh.isSolid(x, y), spotOnSolid: (x, y, lying, above) => mesh.spotOnSolid(x, y, lying, above),
    onSideWall: (x, y) => mesh.onSideWall(x, y), isDoorway: (x, y) => mesh.isDoorway(x, y), drawer: mesh.drawer, tileFlag: id => grid.flag(id),
    joinsBelow: mesh.joinsBelow, joinsBeside: mesh.joinsBeside,
    tilesetNames: grid.tileset.tileset_names,
  };
  view.mapInfo = mapInfo;
  for (const ev of G.map.eventList) view.sprites.push(new CharacterSprite(ev, scene, mapInfo));
  // lighting / atmosphere per map
  const tone = toneFromNote(G.map.map.note);
  const dark = tone ? Math.max(0, -(tone.red + tone.green + tone.blue) / 3) : 0;
  hemi.intensity = THREE.MathUtils.clamp(1.35 - dark / 120, 0.55, 1.35);
  const outdoor = !!G.map.map.parallax_name && !/^yuka/i.test(G.map.map.parallax_name);
  scene.fog.near = outdoor ? 16 : 9;
  scene.fog.far = outdoor ? 70 : 36;
  G.sky.setMap(G.map.map);                 // (its background picture round the sky - sky.js)
  if (!rebuild) G.screen.startTone({ red: 0, green: 0, blue: 0, gray: 0 }, 0);
}

// the view again with the dark round a boss fight opened up (or closed again: null) - arena.js
G.rebuildMapView = open => presentMap(view.seeds || [], true, open).catch(e => console.error('map rebuild failed', e));
// an event laid a tile that opens the way (or took it away again) - gamemap.js onEventPageChanged: the view again, once for all
// that changed together (a lever's bridge is a few events)
let tilesChanging = false;
G.onMapTilesChanged = () => {
  if (tilesChanging) return;
  tilesChanging = true;
  setTimeout(() => {
    tilesChanging = false;
    clearEdgeCache();
    if (view.mesh && view.mapId === G.map.mapId && !transferBusy && !G.map.transferring) G.rebuildMapView(G.arena?.open || null);
  }, 0);
};

// the player got onto a wall top that was judged out of reach (moved there by a cutscene, say): the
// map is rebuilt counting that place as reachable too
let reseeding = false;
function checkReach() {
  const p = G.map.playerChar;
  if (reseeding || transferBusy || !view.mesh?.isRaisedTop?.(p.x, p.y)) return;
  reseeding = true;
  presentMap([...(view.seeds || []), [p.x, p.y]], true).catch(e => console.error('map rebuild failed', e)).finally(() => { reseeding = false; });
}

// ------------------------------------------------------------------ transfers
let transferBusy = false;
async function performTransfer() {
  if (transferBusy) return;
  transferBusy = true;
  const m = G.map;
  const t = m.transfer;
  G.coop?.beforeTransfer?.();          // (a co-op guest: what it changed of the host's world here goes to the host first)
  G.arena.release();                   // any transfer opens a closed boss arena (fog gone, events back)
  try {
    if (t.fade !== 2) {
      G.screen.fadeOut(12);
      await waitFrames(14);
    }
    const changed = t.mapId !== m.mapId || !view.mesh;
    if (changed) {
      G.combat.reset({ carry: true });  // the old map's enemies leave with the old map (an event's run past its fight goes on)
      setStatus(tr('맵 로딩: {map}', { map: mapName(t.mapId) }));
      G.screen.setBrightness(0);
      await m.load(t.mapId);
      await loadUserHints();            // (the map editor's rules as saved now - mapedit.html)
      await presentMap([[t.x, t.y]]);
      G.state.mapId = t.mapId;
      G.audio.autoplayMap(m.map);
    }
    m.playerChar.moveto(t.x, t.y);
    if (t.dir) m.playerChar.direction = t.dir;
    G.player.teleportTo(t.x, t.y, t.dir);
    m.afterTransfer();
    if (changed) G.combat.onMapLoaded();
    m.transfer = null;
    m.transferring = false;
    m.requestRefresh();
    G.coop.onTransfer(m.mapId, t.x, t.y, t.dir);
    setStatus(`${mapName(m.mapId)} (${m.mapId})`);
    if (t.fade !== 2) G.screen.fadeIn(16);
    else G.screen.setBrightness(255);
    if (changed) autosave();
  } catch (e) {
    console.error('transfer failed', e);
    setStatus(tr('맵 로딩 실패: {err}', { err: e.message }));
    m.transferring = false; m.transfer = null;
    G.screen.setBrightness(255);
  }
  transferBusy = false;
}
const frameWaiters = [];
function waitFrames(n) { return new Promise(r => frameWaiters.push({ n, r })); }

// ------------------------------------------------------------------ saves
// debug launches (?save= / ?map= / ?timer / ?vrsave=) never write save slots
const DEV_RUN = ['save', 'map', 'timer', 'vrsave'].some(k => new URLSearchParams(location.search).has(k));
// (the developer's world - coop.js: this player's character goes to its developer-server autosave instead; the opening
// alone, nothing)
async function autosave() {
  if (DEV_RUN || !G.state || G.state.system.saveDisabled) return false;
  if (G.coop.role === 'world') return G.coop.world ? saveVr(0, true, 'world') : false;
  return saveVr(0, true);
}
// kind 'world': a developer-server save (its own slots, saves/world/ - kept apart from the game's own)
async function saveVr(slot = 1, silent = false, kind = 'vr') {
  if (!G.state || !G.map?.grid) return false;
  if (G.coop.phantom) return false;       // (in another player's world: nothing there is this game's - coop.js)
  if ((kind === 'world') !== (G.coop.role === 'world')) return false;      // (never the one kind of save for the other)
  if (DEV_RUN) { if (!silent) G.ui.toast(tr('개발용 실행: 저장하지 않습니다')); return false; }
  const pc = G.map.playerChar;
  G.state.start = { x: pc.x, y: pc.y, dir: pc.direction };
  G.state.mapId = G.map.mapId;
  const leader = G.state.party.leader();
  const state = G.state.toJSON();
  // a fight an event started is on: saved as before that event began (its switches as they were), so once loaded its
  // scene plays from its start again instead of over what it already did - the game itself goes on as it is
  const undo = G.combat.pendingUndo?.() || [];
  if (undo.length) {
    state.switches = [...state.switches]; state.variables = [...state.variables];
    const self = new Set(state.selfSwitches);
    for (const [key, old] of undo) {
      const at = key.indexOf(':'), kind = key.slice(0, at), id = key.slice(at + 1);
      if (kind === 'S') state.switches[+id] = old;
      else if (kind === 'V') state.variables[+id] = old;
      else if (kind === 'SS') { if (old) self.add(id); else self.delete(id); }
    }
    state.selfSwitches = [...self];
  }
  const now = Date.now();
  const data = {
    meta: { map: saveLocation({ mapId: state.mapId }), mapId: state.mapId, date: fmtDate(now), time: now, level: leader?.level, hp: leader?.hp, gold: G.state.party.gold, imported: G.state.importedFrom },
    state,
  };
  try {
    await writeSaveFile(slot, data, kind);
    if (!silent) G.ui.toast(kind === 'world' ? tr('개발자 서버 세이브 {n}번에 저장했습니다', { n: slot }) : tr('세이브 {n}번에 저장했습니다', { n: slot }));
    return true;
  } catch {
    if (!silent) G.ui.toast(tr('저장 실패'));
    return false;
  }
}
G.saveVr = () => saveVr(1);
G.saveWorld = (slot = 0, silent = true) => saveVr(slot, silent, 'world');
// saving by hand: 16 slots like the original's Save01-16 (slot 0 is the autosave); a used slot asks first
const SAVE_SLOTS = 16;
let lastSaveSlot = 1;
// when a slot was saved, in the chosen language's format (older saves only kept the text of the day)
function metaDate(meta) { return meta?.time ? fmtDate(meta.time) : meta?.date || ''; }
function slotDesc(meta) {
  if (!meta) return '';
  const unit = $data.system.currency_unit || '';
  return [meta.level != null ? `Lv ${meta.level}` : '', meta.hp != null ? `HP ${meta.hp}` : '', meta.gold != null ? `${meta.gold} ${unit}` : ''].filter(Boolean).join(' · ');
}
async function showVrSaveMenu() {
  // (the developer's world: its own saves - in the opening alone, none yet)
  const kind = G.coop.role === 'world' ? 'world' : 'vr';
  if (G.state?.system.saveDisabled || G.coop.phantom || (kind === 'world' && !G.coop.world)) { G.ui.toast(tr('지금은 저장할 수 없습니다')); G.ui.reopenMain('save'); return; }
  let saves;
  try { saves = await listVrSaves(kind, true); }
  catch {
    G.ui.toast(tr('저장 목록을 읽지 못했습니다. 다시 시도해 주세요'));
    G.ui.reopenMain('save');
    return;
  }
  const have = new Map(saves.map(s => [s.slot, s.meta]));
  const items = [];
  for (let n = 1; n <= SAVE_SLOTS; n++) {
    const m = have.get(n);
    items.push(m ? { text: `${tr('슬롯 {n}', { n })}  ${saveLocation(m)}`, right: metaDate(m), desc: slotDesc(m), slot: n, used: true, map: saveLocation(m) }
      : { text: `${tr('슬롯 {n}', { n })}  ${tr('(비어 있음)')}`, slot: n, used: false });
  }
  const save = async n => {
    lastSaveSlot = n;
    G.ui.closeMenu();
    await saveVr(n, false, kind);
  };
  G.ui.menuOpen = true;
  G.ui.list.open(kind === 'world' ? tr('개발자 서버 세이브 — 저장할 슬롯') : tr('세이브 — 저장할 슬롯'), items, {
    onSelect: (i, it) => {
      if (!it.used) { save(it.slot); return; }
      G.ui.list.open(tr('슬롯 {n}에 덮어쓸까요?', { n: it.slot }), [
        { text: tr('덮어쓰기'), id: 'yes', desc: `${it.map}  ${it.right}` },
        { text: tr('취소'), id: 'no' },
      ], {
        onSelect: (j, c) => { if (c.id === 'yes') save(it.slot); else showVrSaveMenu(); },
        onCancel: () => showVrSaveMenu(),
      });
    },
    onCancel: () => G.ui.reopenMain('save'),
    index: lastSaveSlot - 1,
  });
}
G.openSaveMenu = () => showVrSaveMenu();
G.onBonfire = () => {
  // (the developer's world: the opening alone is over at its first bonfire - into the world from here, coop.js)
  if (G.coop.role === 'world' && G.coop.wphase === 'prologue') { G.coop.prologueDone(); return; }
  G.combat.restAtBonfire();      // every enemy comes back (resting resets them, as in a Souls game)
  setTimeout(() => autosave().then(ok => ok && G.ui.toast(tr('화톳불: 자동 저장됨'))), 1500);
};
async function listVrSaves(kind = 'vr', strict = false) {
  try {
    const saves = await readSaveSlots(kind);
    await prepareSaveLocations(saves);
    return saves;
  }
  catch (error) { if (strict) throw error; return []; }
}
async function loadVrSave(slot, kind = 'vr') {
  try { return GameState.fromJSON(await readSaveState(slot, kind)); }
  catch (error) {
    console.warn('Save load failed', error);
    G.ui.toast(tr('세이브를 불러오지 못했습니다. 다시 시도해 주세요'));
    return null;
  }
}
// (the developer's world - ui.js showWorldStart: a save of this game's own, or one of its developer-server saves)
G.listSaves = kind => listVrSaves(kind);
G.loadSave = (slot, kind) => loadVrSave(slot, kind);
G.saveMeta = m => ({ map: saveLocation(m), date: metaDate(m), desc: slotDesc(m) });
G.listRmSaves = async () => {
  const out = [];
  for (const f of listFiles('save').filter(f => /^save\d+\.rvdata2$/i.test(f)).sort()) {
    try {
      const { header, contents } = await readRmSave(f);
      out.push({ f, contents, label: f.replace('.rvdata2', ''), map: mapName(contents.get('map').map_id), time: header.get('playtime_s') || '' });
    } catch { /* (one that cannot be read is left out) */ }
  }
  return out;
};
G.stateOfRm = (contents, label) => { const s = new GameState(); s.importRmSave(contents, label); return s; };
async function readRmSave(file) {
  const bytes = await fetchBinary(file);
  const r = new MarshalReader(bytes);
  const header = r.load();
  const r2 = new MarshalReader(bytes.subarray(r.pos));
  return { header, contents: r2.load() };
}

// ------------------------------------------------------------------ game start / title
let mode = 'loading'; // loading | title | game | gameover
async function startGame(state, overridePos) {
  if (!state) return;
  G.coop.end('another game', { stay: true });       // (a save loaded or a new game: a co-op visit ends there)
  enterWorld(state, overridePos);
}
// the game goes on in this state, from its saved place or pos (also co-op's way into another player's world and back)
function enterWorld(state, overridePos) {
  G.state = state;
  G.pictures?.clear();
  G.map = G.map || new GameMap();
  G.combat.reset({ keepState: true });
  clearMapView();
  mode = 'game';
  G.ui.list.close();
  const pos = overridePos || { mapId: state.mapId, ...state.start };
  G.map.mapId = -1;
  G.map.reserveTransfer(pos.mapId, pos.x, pos.y, pos.dir || 2, 0);
  G.screen.setBrightness(0);
  showTitleArt(false);
}
G.enterWorld = enterWorld;
// (what was going on in the game left goes with it: an event's run, the common events waiting - else a new game took them on)
G.returnToTitle = () => {
  G.coop.end('title', { stay: true }); G.combat.reset(); G.pictures?.clear(); clearMapView(); G.sky.clear(); G.audio.stopBgm(); G.audio.stopBgs();
  if (G.map) { G.map.interpreter.clear(); G.map.reservedCommon = []; }
  if (gameOverPanel) gameOverPanel.visible = false;
  G.state = null; mode = 'title'; showTitle();
};

// The original's Game Over (event command 353 - Scene_Gameover): the game ends there and goes back to the title - the names
// the opening turns away, the boss fight of 아이 방 ３ that may not be lost, a bad end (BLACKSOULS II's own deaths are its
// common event, not this). The music stops, its game over ME plays (when the system names one), the map fades out and the
// game over picture (Graphics/System/GameOver - the RTP's: drawn here when the game's folder has none) fades in; a confirm goes
// to the title. (It was the souls-like death - YOU DIED, back to a bonfire - and the opening went on with no class chosen)
let gameOverPanel = null, gameOverReady = false;
async function gameOverArt() {
  if (gameOverPanel) return gameOverPanel;
  let img = await loadImage('Graphics/System', 'GameOver');
  if (!img) {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 768;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#d8d0c0';
    g.font = `bold 120px ${FONT}`;
    g.fillText('GAME OVER', c.width / 2, c.height / 2);
    img = c;
  }
  const tex = new THREE.Texture(img); tex.needsUpdate = true; tex.colorSpace = THREE.SRGBColorSpace;
  gameOverPanel = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2 * img.height / img.width), new THREE.MeshBasicMaterial({ map: tex, fog: false }));
  scene.add(gameOverPanel);
  return gameOverPanel;
}
G.gameOver = async () => {
  if (mode !== 'game') return;
  mode = 'gameover';
  G.ui.navigation.hide();
  gameOverReady = false;
  G.ui.closeMenu?.(); G.ui.list.close();
  if (G.map) { G.map.interpreter.clear(); G.map.reservedCommon = []; }
  G.audio.stopBgm(); G.audio.stopBgs();
  if ($data.system.gameover_me?.name) G.audio.playMe($data.system.gameover_me);
  G.screen.fadeOut(60);
  await waitFrames(62);
  if (mode !== 'gameover') return;
  G.combat.reset(); G.pictures?.clear(); clearMapView(); G.sky.clear();
  G.ui.hud.mesh.visible = false;
  const panel = await gameOverArt();
  const head = G.player.headWorld(new THREE.Vector3()), fwd = G.player.forwardVec();
  panel.position.set(head.x + fwd.x * 4.2, head.y, head.z + fwd.z * 4.2);
  panel.rotation.set(0, Math.atan2(-fwd.x, -fwd.z), 0);
  panel.visible = true;
  G.screen.fadeIn(120);
  await waitFrames(30);
  gameOverReady = mode === 'gameover';
};
G.openLoadMenu = () => showVrLoadMenu(() => G.ui.reopenMain('load'));

let titlePanel = null;
async function showTitleArt(on) {
  if (!titlePanel) {
    const name = $data.system.title1_name;
    const img = name ? await loadImage('Graphics/Titles1', name) : null;
    if (!img) return;
    const tex = new THREE.Texture(img); tex.needsUpdate = true; tex.colorSpace = THREE.SRGBColorSpace;
    titlePanel = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2 * img.height / img.width), new THREE.MeshBasicMaterial({ map: tex, fog: false }));
    scene.add(titlePanel);
  }
  titlePanel.visible = on;
  if (on) {
    const head = G.player.headWorld(new THREE.Vector3());
    titlePanel.position.set(head.x, head.y + 0.4, head.z - 4.2);
    titlePanel.rotation.set(0, 0, 0);
  }
}

async function showTitle() {
  mode = 'title';
  G.ui.navigation.close(); G.ui.navigation.hide();
  rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
  G.player.yaw = 0; G.player.pitch = 0;
  G.screen.setBrightness(255);
  await showTitleArt(true);
  if ($data.system.title_bgm?.name) G.audio.playBgm($data.system.title_bgm);
  const vrSlots = await listVrSaves();
  const auto = vrSlots.find(s => s.slot === 0);
  const items = [];
  if (auto) items.push({ text: tr('이어하기 (VR 오토세이브)'), id: 'continue', desc: `${saveLocation(auto.meta)}  ${metaDate(auto.meta)}` });
  items.push({ text: tr('원작 세이브 불러오기'), id: 'rm', desc: tr('원작의 Save01~16 진행 상황으로 VR에서 시작') });
  items.push({ text: tr('모드 세이브 불러오기'), id: 'vr', enabled: vrSlots.some(s => s.slot > 0) });
  // (a developer-server save played on here, in the game itself - saved as its own saves from then on)
  const worldSlots = await listVrSaves('world');
  if (worldSlots.length) items.push({ text: tr('개발자 서버 세이브 불러오기'), id: 'world', desc: tr('개발자 서버의 진행을 본편으로 가져옵니다') });
  items.push({ text: tr('새 게임'), id: 'new', desc: tr('오프닝부터 시작') });
  G.ui.placeRoot(true);
  G.ui.list.open('BLACK SOULS Ⅱ  VR', items, {
    onSelect: async (i, it) => {
      if (it.id === 'continue') startGame(await loadVrSave(0));
      if (it.id === 'rm') showRmSaveMenu();
      if (it.id === 'vr') showVrLoadMenu(showTitle);
      if (it.id === 'world') showVrLoadMenu(showTitle, 'world');
      if (it.id === 'new') { const s = new GameState(); s.newGame(); startGame(s); }
    },
    onCancel: () => {},
  });
  G.ui.list.panel.mesh.position.set(0, -0.15, 0);
  setStatus(tr('타이틀: 방향키/스틱으로 선택, Enter/A로 결정'));
}
async function showRmSaveMenu() {
  const files = listFiles('save').filter(f => /^save\d+\.rvdata2$/i.test(f)).sort();
  const entries = [];
  for (const f of files) {
    try {
      const { header, contents } = await readRmSave(f);
      const map = contents.get('map'); const party = contents.get('party');
      entries.push({ f, contents, label: f.replace('.rvdata2', ''), text: `${f.replace('.rvdata2', '')}  ${mapName(map.map_id)}`, right: header.get('playtime_s') || '', desc: `${party.gold} ${$data.system.currency_unit || ''}` });
    } catch (e) { entries.push({ f, text: tr('{f} (읽기 실패)', { f }), enabled: false }); }
  }
  G.ui.list.open(tr('원작 세이브'), entries, {
    onSelect: (i, it) => { const s = new GameState(); s.importRmSave(it.contents, it.label); startGame(s); },
    onCancel: () => showTitle(),
  });
}
async function showVrLoadMenu(back, kind = 'vr') {
  const slots = (await listVrSaves(kind)).sort((a, b) => a.slot - b.slot);
  G.ui.menuOpen = G.ui.menuOpen || mode === 'game';
  G.ui.list.open(kind === 'world' ? tr('개발자 서버 세이브 불러오기') : tr('모드 세이브 불러오기'), slots.map(s => ({ text: `${s.slot === 0 ? tr('오토') : tr('슬롯 {n}', { n: s.slot })}  ${saveLocation(s.meta)}`, right: metaDate(s.meta), desc: slotDesc(s.meta), slot: s.slot })), {
    onSelect: async (i, it) => {
      const state = await loadVrSave(it.slot, kind);
      if (state) { G.ui.closeMenu(); startGame(state); }
    },
    onCancel: back,
  });
}

// ------------------------------------------------------------------ frame loop
const clock = new THREE.Clock();
let acc = 0;
const STEP = 1 / 60;
const headTmp = new THREE.Vector3();
// the player's own balloon icon. One it put up itself (an emote - emotes.js) sits right over its head, as the others
// see it there: it goes along with it, and looking up shows it (it covers nothing in front). One an event put on it
// shows in front, a little above the eyes, where the player was looking as it came up (it stays there while it shows)
const OVER = { size: 0.5, up: 0.3 };      // m: an emote over the player's own head - how big, how far over the eyes
const playerBalloon = { icon: null, over: null, id: 0, emote: false, anchor: new THREE.Group(), overAnchor: new THREE.Group(), dir: new THREE.Vector3() };
G.playerBalloon = playerBalloon;
function updatePlayerBalloon(head) {
  const b = playerBalloon, pc = G.map.playerChar;
  if (!b.icon) { scene.add(b.anchor, b.overAnchor); b.icon = new BalloonIcon(b.anchor, 0.35); b.over = new BalloonIcon(b.overAnchor, OVER.size); }
  if (pc.balloonId > 0 && pc.balloonId !== b.id) {
    // (which it is, settled as it comes up)
    b.emote = !!G.emotes && G.emotes.up === pc.balloonId;
    if (!b.emote) {
      camera.getWorldDirection(b.dir);
      b.dir.y = 0;
      if (b.dir.lengthSq() < 1e-6) b.dir.set(0, 0, -1);
      b.dir.normalize();
      b.anchor.position.set(head.x + b.dir.x * 1.2, head.y + 0.12, head.z + b.dir.z * 1.2);
    }
  }
  b.id = pc.balloonId;
  if (b.emote) b.overAnchor.position.set(head.x, head.y + OVER.up, head.z);
  b.icon.update(b.emote ? 0 : pc.balloonId, pc.balloonTime, 0);
  b.over.update(b.emote ? pc.balloonId : 0, pc.balloonTime, 0);
}
let lastFrameError = '';
function frame() {
  try { frameBody(); } catch (e) {
    const msg = String(e?.message || e);
    if (msg !== lastFrameError) {
      lastFrameError = msg;
      console.error('frame error', e);
      try { G.ui?.toast?.(tr('오류: {msg}', { msg: msg.slice(0, 70) }), 0, '#ff9a9a'); } catch { /* */ }
    }
    try { G.input.endFrame(); } catch { /* */ }
    try { renderer.render(scene, camera); } catch { /* */ }
  }
}
// a looping map: the map and its copies sit around the one the player is on; a copy is drawn only while it can be
// seen (within the fog / the camera's reach of it)
function updateLoopView(head) {
  const L = view.loop;
  if (!L || !view.mesh) return;
  const kx = G.map.loopX ? Math.floor(head.x / L.w) : 0, kz = G.map.loopY ? Math.floor(head.z / L.h) : 0;
  view.mesh.group.position.set(kx * L.w, 0, kz * L.h);
  const reach = Math.min(camera.far, scene.fog?.far ?? Infinity) + 3;
  const inX = head.x - kx * L.w, inZ = head.z - kz * L.h;
  for (const c of L.copies) {
    c.obj.position.set((kx + c.i) * L.w, 0, (kz + c.j) * L.h);
    const dx = c.i < 0 ? inX : c.i > 0 ? L.w - inX : 0, dz = c.j < 0 ? inZ : c.j > 0 ? L.h - inZ : 0;
    c.obj.visible = Math.hypot(dx, dz) < reach;
  }
}
function frameBody() {
  if (renderer.xr.isPresenting) { const rt = renderer.getRenderTarget(); if (rt?.isXRRenderTarget) xrTarget = rt; }
  const dt = Math.min(clock.getDelta(), 0.1);
  G.time += dt;
  G.input.update();
  for (const w of frameWaiters.splice(0)) { if (--w.n <= 0) w.r(); else frameWaiters.push(w); }

  if (mode === 'title') {
    if (!G.vr) {
      G.player.yaw -= G.input.mouse.dx * 0.002;
      camera.rotation.set(0, G.player.yaw, 0, 'YXZ');
    }
    G.ui.pointerTarget = false;
    if (G.ui.list.visible) G.ui.list.update(G.ui.pointerRay());
    G.ui.placeRoot();
    G.ui.updateHudFollow();
    G.ui.updatePointerLine?.();
    G.hands.update(dt);
    G.screen.updateLogic(); G.screen.apply();
  } else if (mode === 'gameover') {
    // (the game over picture until a confirm, then the title - G.gameOver)
    if (!G.vr) {
      G.player.yaw -= G.input.mouse.dx * 0.002;
      camera.rotation.set(G.player.pitch, G.player.yaw, 0, 'YXZ');
    }
    G.hands.update(dt);
    G.screen.updateLogic(); G.screen.apply();
    if (gameOverReady && (G.input.confirm() || G.input.advance() || (G.vr && (G.input.xrPressed('right', 0) || G.input.xrPressed('left', 0))))) {
      gameOverReady = false;
      G.returnToTitle();
    }
  } else if (mode === 'game' && G.map) {
    const m = G.map;
    if (m.transferring && !transferBusy) performTransfer();
    // the headset shows something else (SteamVR dashboard, desktop, system menu): the map and the fights wait
    const away = G.vr && G.xrAway;
    if (m.grid && view.mesh) {
      if (!away) acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 4) {
        for (const ev of m.eventList) { ev.prevRealX = ev.realX; ev.prevRealY = ev.realY; }
        m.update();
        G.combat.updateLogic();
        G.screen.updateLogic();
        G.frame++;
        G.state.system.playFrames++;
        acc -= STEP; steps++;
      }
      if (steps === 4) acc = 0;
      if (!away) {
        G.player.update(dt);
        checkReach();
        G.combat.update(dt);
        G.arena.update();
        G.theater.update(dt);
      }
      G.hands.update(dt);
      const head = G.player.headWorld(headTmp);
      updateLoopView(head);
      billboardUniforms.uViewer.value.copy(head);
      const alpha = acc / STEP;
      layoutTilePictures(view.sprites, view.mapInfo);
      for (const s of view.sprites) s.update(head, alpha);
      G.poke.update(dt, view.sprites);       // (bare hands pressing / pulling people: after they are placed)
      G.sky.update();
      updatePlayerBalloon(head);
      markers.update(dt, head);
      view.mesh.update(G.time);
      torch.position.set(head.x, head.y + 0.2, head.z);
      G.coop.update(dt, head);               // (last: a visit that ends here sends the player elsewhere at once)
    } else {
      G.screen.updateLogic();
      G.coop.update(dt, null);
    }
    G.screen.apply();
    G.ui.update(dt);
  }
  G.audio.updateListener(camera);
  G.input.endFrame();
  G.screen.beginShake(G.three?.rig, dt);
  renderer.render(scene, camera);
  spectator.render();
  G.screen.endShake(G.three?.rig);
}
// ?timer drives the loop without requestAnimationFrame (for testing in a hidden browser tab)
if (new URLSearchParams(location.search).has('timer')) {
  setInterval(() => { if (!renderer.xr.isPresenting) frame(); }, 16);
  renderer.xr.addEventListener('sessionstart', () => renderer.setAnimationLoop(frame));
  renderer.xr.addEventListener('sessionend', () => renderer.setAnimationLoop(null));
} else {
  renderer.setAnimationLoop(frame);
}

// ------------------------------------------------------------------ boot
(async () => {
  try {
    // two-GPU laptops: the browser moves to the headset's GPU here, before anything is loaded (src/vrbutton.js)
    setStatus(tr('VR 장치 준비 중...'));
    await prepareXR(renderer);
    setStatus(tr('게임 파일 확인 중...'));
    await loadServerSettings();
    // (the developer's server this game came with - devserver.json beside it: its co-op menu's 개발자 서버)
    try { const r = await fetch('/devserver.json'); if (r.ok) G.coop.setDevServers(await r.json()); } catch { /* none */ }
    await loadUserHints();              // (the map rules changed in the map editor - mapedit.html, src/maphints.user.json)
    await initAssets();
    if (!hasFile('Data/System.rvdata2')) throw new Error(tr('Data/System.rvdata2를 찾을 수 없습니다. 게임 폴더 설정을 확인하세요'));
    setStatus(tr('데이터베이스 로딩 중...'));
    await loadDatabase((p, name) => setStatus(tr('데이터베이스 로딩 중... {p}% ({name})', { p: Math.round(p * 100), name })));
    await Promise.all([loadScriptData(), loadUiAssets(), loadFont('GameFont', 'NanumGothic')]);
    G.ui.attachHud(null);
    window.G = G; window.$data = $data;
    G.startGame = startGame; G.GameState = GameState;
    const p = new URLSearchParams(location.search);
    if (p.has('vrsave')) {
      // debug: continue from a VR save slot (read only: dev launches never write saves)
      startGame(await loadVrSave(+p.get('vrsave') || 0));
    } else if (p.has('map')) {
      // debug: jump straight into a map, optionally with an original save's state
      const s = new GameState();
      if (p.has('save')) {
        const { contents } = await readRmSave(`Save${String(p.get('save')).padStart(2, '0')}.rvdata2`);
        s.importRmSave(contents, 'Save' + p.get('save'));
      } else s.newGame();
      startGame(s, { mapId: +p.get('map'), x: +(p.get('x') || 0), y: +(p.get('y') || 0), dir: 2 });
    } else if (p.has('save')) {
      const { contents } = await readRmSave(`Save${String(p.get('save')).padStart(2, '0')}.rvdata2`);
      const s = new GameState(); s.importRmSave(contents, 'Save' + p.get('save'));
      startGame(s);
    } else {
      await showTitle();
    }
    // debug: co-op between two windows of this browser (?coop=host / ?coop=join, &room= to pair them) - coop.js
    // (or through a co-op server: &hub=address:port&pin=..&hostpin=..)
    if (['host', 'join'].includes(p.get('coop'))) {
      const role = p.get('coop') === 'host' ? 'host' : 'guest', room = (p.get('room') || 'dev').slice(0, 40);
      const hub = /^([0-9.]{7,15}):(\d{1,5})$/.exec(p.get('hub') || '');
      if (hub) {
        // (a host PIN given: hosting as from another PC, with it)
        const server = { ip: hub[1], port: +hub[2], pin: p.get('pin') || '', hostPin: p.get('hostpin') || '', local: hub[1] === '127.0.0.1' && role === 'host' && !p.get('hostpin') };
        if (role === 'host') G.coop.openWorld(server); else G.coop.visit(server);
      } else G.coop.startLocal(role, room, p.get('link') === 'rtc');
    }
  } catch (e) {
    console.error(e);
    setStatus(tr('오류: {msg}', { msg: e.message }));
  }
})();
