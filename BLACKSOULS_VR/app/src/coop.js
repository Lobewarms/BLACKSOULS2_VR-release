// Co-op, the Souls way: one player opens their world (the host) and others come into it (guests, phantoms) - as many
// as the server's rules allow (maxPlayers, 2-8). A guest walks the host's world with its own body, gear and things;
// only the host's world is real there - the guest's own world waits untouched (its game as it was, never saved while
// away) and it goes back to it when the visit ends: it leaves, the host ends it or goes, or nothing is heard from the
// host for a while.
// Players meet through the co-op server (coop_server.py: run on the host's PC, or elsewhere so that nobody learns the
// host's address), reached by address and PIN (coopnet.js HubLink).
// Everyone sees everyone else (coopavatar.js); a guest sees the host's world as the host's switches, variables and
// self switches make it (kept up as they change), its people where the host's are (the map's events stand, move, turn
// and change as the host's do - never moving on their own), its screen (tone, brightness) and music, and follows the
// host from map to map. A phantom's own events do not run - no talking, doors, traps or fights of its own. The host's
// enemies are there for it to fight (combat.js puppets), their moves played out as the host's go - a boss's too - and
// a boss fight's fog closes the way out for it as well. Each player judges the blows on itself by what it sees (the
// Souls way): the moves played out on a guest strike it there; its own blows on the host's enemies are reported to
// the host, which checks them and owns the enemies. What the host's events
// show - messages, pictures, their sounds - it sees and hears too, only to see: never the adult scenes (mirrorOk).
// Every message is small, checked field by field and only ever read as data; what steers a guest's world (welcome,
// world changes, transfers) is taken only from the host.
import { G } from './globals.js';
import { $data } from './data.js';
import { takeRules, SERVER_VERSION, WORLD_VERSION } from './coopnet.js';
import { guard } from './coopguard.js';
import { DEFAULT_PORT, DEFAULT_RULES, WORLD_RULES, WORLD_SAVE_EVERY, now } from './coop/common.js';
import { PlayersPart } from './coop/players.js';
import { HostPart } from './coop/host.js';
import { GuestPart } from './coop/guest.js';
import { PvpPart } from './coop/pvp.js';
import { WorldPart } from './coop/world.js';
import { ShotPart } from './coop/shots.js';

export class Coop {
  constructor(scene) {
    this.scene = scene;
    this.role = null;           // 'host' | 'guest' | null
    this.link = null;
    this.server = null;         // the co-op server this session is on ({ local, ip, port }) - none for the dev links
    this.peers = new Map();     // the others: id -> { id, host, heard, seq, avatar, pose }
    this.hostId = null;         // (guest) the host's id
    this.summoned = false;      // (guest) standing in the host's world
    this.home = null;           // (guest) its own world while it is away: { state, mapId, x, y, dir }
    this.flags = new Map();     // (host) the world's changes not sent yet
    this.follow = null;         // (guest) where the host went last
    this.lastError = '';        // why the last visit could not begin (the co-op menu says it)
    this.seq = 0; this.poseT = 0; this.lookT = 0; this.flagsT = 0; this.lookKey = ''; this.helloT = -99; this.tick = 0; this.startT = 0;
    this.evT = 0; this.scrT = 0; this.enT = 0; this.evMap = 0; this.evLast = new Map(); this.scrKey = '';
    this.handed = new Map();    // (host) cells lately given to guests coming in: cell -> { m, t, who }
    this.saying = null;         // (host) the message its guests are reading with it ({ msg, out })
    this.pics = new Map();      // (host) the pictures its guests see: number -> where the Show Picture stands (coopguard.js)
    this.evLook = new Map();    // (host) how each event of this map looked when last sent outside a scene (evState)
    this.guard = guard;         // (the checks of what a guest is shown - coopguard.js: for the tests)
    this.ownPics = new Set();   // (host) pictures a scene put up: never sent, nor what is done with them
    this.fxOut = [];            // (host) its events' sounds, animations and flashes to send
    this.arenaMsg = null;       // (host) the boss fight's fog, while it is up ('ar')
    this.localRules = { ...DEFAULT_RULES };   // (the rules where no server gives them: the dev links)
    this.bossAskAt = 0;         // (guest) when it last asked the host to begin a boss fight
    this.key = '';              // the random key this game keeps (myKey) - and, for the dev links, the tag made of it
    this.myTag = '';
    this.sentAway = new Set();  // (host, dev links) guests sent away: what they still send is not taken
    this.hostSt = null;         // (guest) the host's own numbers (the rule statSync)
    this.stKey = ''; this.stT = 0; this.bsT = 0; this.syncKey = ''; this.syncT = 0;
    // (a map the host is not on, led by one of the guests there - leaderOf): since when this player stands on its map,
    // whether it leads it now and who runs it as this player sees it; what its own fights and events there change of the
    // world (recording: their interpreters are running), on its way to the host; a boss fight it asked the host to come
    // to (bossCall), and the one it begins of its own (bossGo); the host's way to such a fight (hostTrip), there now
    // (tripNow), and the ask it is answering (callOpen)
    this.arrMap = 0; this.arrT = now(); this.leadsNow = false; this.authNow = undefined; this.scrOf = new Map();
    this.recording = 0; this.outFlags = new Map(); this.outGains = []; this.wfT = 0;
    // (the developer's world, its rule shareLoot) a fight's rewards being given (lootDepth: combat.js onBattleEnd), what
    // another player got being put in this bag (lootIn), what this player got on its way to the others (outLoot)
    this.lootDepth = 0; this.lootIn = false; this.outLoot = []; this.lootAt = new Map();
    this.bossCall = null; this.bossGo = null; this.hostTrip = null; this.tripNow = null; this.callOpen = null;
    this.leadNow = new Map(); this.leadKey = ''; this.leadT = 0;      // (who leads which map, as the host says - leaderOf)
    this.ledBy = new Map();     // (host) map -> the guest leading it last, and when (onWorldFlags)
    // (the developer's world - world_server.py) where this player is with it: 'connecting', 'choosing' (how it comes in),
    // 'prologue' (the opening alone: its own until its first bonfire), 'in'; the world as the server has it while this
    // player is not in it yet (null: empty), who is on which map (roster: [id, name, tag, map]), the events' locks it holds
    // and asks for, what of the world it changed not sent yet, a vote this player's event waits on
    this.devServers = [];       // the developer's servers this game came with (devserver.json: 1 and 2 - { ip, port, pin } each)
    this.wphase = ''; this.wworld = undefined; this.roster = []; this.locks = new Set(); this.lockWait = new Map(); this.lockNo = new Map();
    this.outWorld = new Map(); this.applying = false; this.cycling = false; this.myVote = null; this.voting = null; this.wsaveT = WORLD_SAVE_EVERY;
    this.atSent = undefined; this.pendingJoin = null;
    this.worldRules = { ...WORLD_RULES }; this.isAdmin = false; this.adminTry = null;   // (the rules the server says; admin PIN proved)
    this.myPvp = false;         // (the developer's world) this player's own PvP, turned on in the co-op menu - off at each coming in
    addEventListener('pagehide', () => this.end('closed', { stay: true }));
  }
  get active() { return !!this.role; }
  get defaultPort() { return DEFAULT_PORT; }
  // this session's rules (DEFAULT_RULES): the server's, or - over the dev links - as set here; the developer's world's own
  get rules() { return this.role === 'world' ? this.worldRules : this.link?.rules || this.localRules; }
  // in the developer's world (in it - not still choosing how to come in, nor in the opening alone)
  get world() { return this.role === 'world' && this.wphase === 'in'; }
  // in a world whose maps' monsters others may run: a guest in the host's, or anyone in the developer's
  get shared() { return this.phantom || this.world; }
  // (host) a rule changed in the co-op menu: the server takes it and tells everyone (over the dev links the host tells
  // its guests itself). Those already in stay even when fewer may come now
  setRule(key, value) {
    if (this.role !== 'host' || !(key in DEFAULT_RULES)) return false;
    const was = this.rules, r = takeRules({ ...was, [key]: value });
    if (this.link?.setRules) { if (!this.link.setRules(r)) return false; }
    else { this.localRules = r; this.send({ t: 'rules', r }); }
    this.onRules(r);
    // (the guests follow this player again: those elsewhere come to its side)
    if (r.guestsFollow && !was.guestsFollow && this.ready()) {
      const pc = G.map.playerChar, given = new Set();
      for (const p of this.guests()) if (p.pose?.m && p.pose.m !== G.map.mapId) this.send({ t: 'map', ...this.arrival(pc.x, pc.y, pc.direction || 2, p.id, given) }, p.id);
    }
    return true;
  }
  onRules(r) {
    console.info('[coop] rules:', JSON.stringify(r));
    if (this.phantom) this.syncStats();
    G.ui?.refreshCoopMenu?.();
  }
  // the co-op server is older than this game (coopnet.js SERVER_VERSION): its rules and their defaults are not this
  // game's - the co-op menu says so (its coop_server.py is to be replaced by this game's)
  // (the developer's world: its own version - world_server.py WORLD_VERSION, not the co-op server's)
  get serverOld() { const l = this.link; return !!l && l.open === true && 'serverVersion' in l && l.serverVersion < (this.role === 'world' ? WORLD_VERSION : SERVER_VERSION); }
  // (host) the server's join PIN, as the server told this host - and a new one for it (4-12 digits)
  get serverPin() { return this.role === 'host' ? this.link?.pin || null : null; }
  setPin(pin) { return this.role === 'host' && !!this.link?.setPin?.(String(pin)); }
  // (a guest running an event of the host's world - interpreter.js c117) the common events it leaves out: the adult scenes
  // (シーン - as none are ever shown to a guest) and the death ones (全滅処理: its own fall goes by the server's rules)
  skipsCommonEvent(id) {
    const name = $data.commonEvents?.[id]?.name || '';
    return /シーン|全滅処理/.test(name);
  }
  // a guest in the host's world: its own events do not run, nothing is saved
  get phantom() { return this.role === 'guest' && this.summoned; }
  guests() { return [...this.peers.values()].filter(p => !p.host); }

}
// Coop's methods, kept by what they are about in coop/*.js: each its own
for (const part of [PlayersPart, HostPart, GuestPart, PvpPart, WorldPart, ShotPart]) {
  for (const k of Object.getOwnPropertyNames(part.prototype)) {
    if (k !== 'constructor') Object.defineProperty(Coop.prototype, k, Object.getOwnPropertyDescriptor(part.prototype, k));
  }
}
