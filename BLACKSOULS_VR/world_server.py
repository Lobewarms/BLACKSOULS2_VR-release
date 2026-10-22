"""BLACK SOULS II VR - the community server (world server): one world, shared, with no host.

Everyone who comes in walks the same world. Its switches, variables and self switches are kept here (world.json, with
backups) and passed on to everyone as they change; each player's game runs everything itself - its own character is
kept on its own PC - and tells this server what of the world it changed. On each map one player runs the monsters for
the others there (the one there longest - this server says who: 'lead'); an event that changes the world is run by one
player at a time (a lock). The first player to come into an empty world brings it: its game's world becomes this one.

    python3 world_server.py              (coop_server.py must be beside it: the connection code is that one's)
    options: --port N  --pin 123456  --admin-pin 654321  --max-players N  --no-save  --dir FOLDER  --reset  --restore FILE

Settings in world_server.json beside it (made on the first run):
    port        TCP port (default 28472) - open it on the server's firewall
    pin         what every player's game proves to come in (given in the game: 협력 -> 커뮤니티 서버 추가)
    adminPin    what one proves in the game's co-op menu to change the rules there: 12 digits (random at first - the
                developer's). Proved by a key made slowly from it (PBKDF2, adminSalt) - never sent, and a proof overheard
                on the way is no help in guessing it
    The rules (every player is told them; changed here, or in the game by one who proved the admin PIN - kept here):
    maxPlayers   players at once (2-16, default 16)
    pvp          true: players can strike each other (default false)
    bossSpectate true (the default): one who falls in a boss fight another runs watches it until it is over
    bossScale    true (the default): a boss's HP, MP and groggy gauge grow by 0.6 times for each player past one in its fight
    shareLoot    true: what one player gets from the world - a chest's or another event's gift, a fight's drops and souls -
                 everyone on the server then gets as well (default false: only the one who got it)
    bans        tags of players kept out (a tag is shown in this window as each one comes in)
--reset puts the world aside (a backup) and starts an empty one; --restore FILE takes a backup back as the world.
The world is saved a few seconds after each change and backed up every ten minutes (backups/, the last 72 kept).

Safety: as coop_server.py (one port, this small protocol only, size and rate limited, PIN proved by HMAC, nothing it
is sent is ever run). What a player's game says it changed is taken as it is - checked for form and amount, not for
whether the game would have done it: keep backups, and ban by tag.
"""
import argparse
import asyncio
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))      # (coop_server.py beside it - however it is run)
from coop_server import (frame, read_message, handshake, Closed, clean_name, tag_of, is_loopback, say, Player,
                         lan_addresses, AUTH_WAIT, IDLE, FAILS, FAIL_WINDOW, BAN, MAX_HEADER)

WORLD_VERSION = 2                    # told to every player ('ready' sv); the game's world protocol (2: the rules, the admin)
RULE_FLAGS = ('pvp', 'bossSpectate', 'bossScale', 'shareLoot')     # the yes / no rules (maxPlayers besides)
ADMIN_ROUNDS = 200000                                 # PBKDF2-SHA256 rounds of the admin key (the game makes it the same)
RULE_ON = ('bossSpectate', 'bossScale')               # (those on unless set off)
HERE = os.path.dirname(os.path.abspath(__file__))
MAX_PLAYERS = 16
MAX_CONNECTIONS = 40
PER_ADDRESS = 16                     # connections at once from one address (players behind one router)
# why one could not come in, as the window says it
REFUSED = {'bad': '접속이 잘못됨', 'pin': 'PIN이 틀림', 'version': 'VR 모드(또는 서버) 버전이 다름', 'banned': '차단된 사람',
           'full': '인원이 다 참', 'game': '게임 판본(버전·번역)이 다름', 'blocked': 'PIN을 여러 번 틀려 잠시 막힌 주소'}
NO_H_SWITCH = 20                     # Hシーン表示しない: never the world's - each game keeps it on itself
MAX_ID = 99999
SELF_KEY = re.compile(r'^\d{1,5},\d{1,5},[ABCD]$')
WF_ENTRIES = 2000                    # world changes in one message
WF_PER_MINUTE = 4000                 # ... and from one player in a minute (more are dropped, and said)
MAX_WORLD = 200000                   # switches / variables / self switches in a world
SAVE_AFTER = 3                       # s after a change the world is written
BACKUP_EVERY = 600                   # s between backups (only when it changed)
BACKUPS_KEPT = 72
LOCK_LIFE = 900                      # s a lock is kept at most (an event that never said it ended)
FP_LEN = 32
VOTE_TIME = 60                       # s a vote is open
VOTE_GAP = 3600                      # s before one who called a vote may call another
VOTES = ('cycle',)                   # what may be voted on: going on to the next cycle (周回)


def is_value(v):
    return (isinstance(v, bool) or (isinstance(v, (int, float)) and not isinstance(v, bool) and abs(v) <= 1e12 and v == v)
            or (isinstance(v, str) and len(v) <= 2000))


def ok_id(i):
    return isinstance(i, int) and not isinstance(i, bool) and 1 <= i <= MAX_ID


class World:
    """The world's switches (those on), variables (those set) and self switches (those on), as the players' games
    told them; written to world.json (none with --no-save)."""
    def __init__(self, folder):
        self.folder = folder
        self.sw, self.vars, self.self = set(), {}, set()
        self.seeded = False
        self.fp = ''                 # the game data's fingerprint (a different game could not be this world)
        self.cycle = 0               # the cycle (周回) a world brought after a vote for the next one must be in (0: none
                                     # pending) - until then the world stays as it was
        self.changed = 0.0           # when it last changed (0: written)
        self.backed = time.monotonic()
        self.dirty_backup = False

    def path(self):
        return os.path.join(self.folder, 'world.json') if self.folder else None

    def snapshot(self):
        return {'sw': sorted(self.sw), 'vars': [[k, v] for k, v in sorted(self.vars.items())], 'self': sorted(self.self)}

    def to_json(self):
        return {'version': 1, 'seeded': self.seeded, 'fp': self.fp, 'cycle': self.cycle, 'savedAt': time.strftime('%Y-%m-%d %H:%M:%S'), **self.snapshot()}

    def take(self, o):
        """A world as written (world.json, a backup): taken as far as it makes sense."""
        if not isinstance(o, dict):
            raise ValueError('not a world')
        sw = {i for i in o.get('sw', []) if ok_id(i) and i != NO_H_SWITCH}
        vs = {e[0]: e[1] for e in o.get('vars', []) if isinstance(e, list) and len(e) == 2 and ok_id(e[0]) and is_value(e[1])}
        ss = {k for k in o.get('self', []) if isinstance(k, str) and SELF_KEY.match(k)}
        self.sw, self.vars, self.self = sw, vs, ss
        self.seeded = bool(o.get('seeded', True))
        self.fp = o.get('fp', '') if isinstance(o.get('fp', ''), str) else ''
        self.cycle = o.get('cycle', 0) if ok_id(o.get('cycle', 0)) else 0

    def load(self):
        p = self.path()
        if not p or not os.path.exists(p):
            return False
        with open(p, encoding='utf-8') as f:
            self.take(json.load(f))
        return True

    def write(self, p=None):
        p = p or self.path()
        if not p:
            return
        tmp = p + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(self.to_json(), f, ensure_ascii=False, separators=(',', ':'))
        os.replace(tmp, p)

    def backup(self, why='auto'):
        if not self.folder:
            return None
        d = os.path.join(self.folder, 'backups')
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, f'world-{time.strftime("%Y%m%d-%H%M%S")}-{why}.json')
        self.write(p)
        old = sorted(f for f in os.listdir(d) if f.startswith('world-') and f.endswith('.json'))
        for f in old[:-BACKUPS_KEPT]:
            try:
                os.remove(os.path.join(d, f))
            except OSError:
                pass
        return p

    def size(self):
        return len(self.sw) + len(self.vars) + len(self.self)

    def apply(self, S, V, SS):
        """Changes from one player's game: each checked; those taken are given back (to be passed on)."""
        s2, v2, ss2 = [], [], []
        for e in S:
            if isinstance(e, list) and len(e) == 2 and ok_id(e[0]) and e[0] != NO_H_SWITCH and e[1] in (0, 1) and not isinstance(e[1], bool):
                if e[1]:
                    self.sw.add(e[0])
                else:
                    self.sw.discard(e[0])
                s2.append(e)
        for e in V:
            if isinstance(e, list) and len(e) == 2 and ok_id(e[0]) and is_value(e[1]):
                if e[1] == 0 and not isinstance(e[1], bool):
                    self.vars.pop(e[0], None)
                else:
                    self.vars[e[0]] = e[1]
                v2.append(e)
        for e in SS:
            if isinstance(e, list) and len(e) == 2 and isinstance(e[0], str) and SELF_KEY.match(e[0]) and e[1] in (0, 1) and not isinstance(e[1], bool):
                if e[1]:
                    self.self.add(e[0])
                else:
                    self.self.discard(e[0])
                ss2.append(e)
        if s2 or v2 or ss2:
            self.changed = time.monotonic()
            self.dirty_backup = True
        return s2, v2, ss2


class Hub:
    def __init__(self, cfg, world, save=True, cfg_path=None):
        self.cfg, self.world, self.save, self.cfg_path = cfg, world, save, cfg_path
        self.players = {}                 # id -> Player (with .map, .arr, .wf)
        self.fails, self.banned, self.per_address = {}, {}, {}
        self.connections = 0
        self.leads = {}                   # map -> the id of the one running its monsters
        self.locks = {}                   # 'map,event' -> (player id, since)
        self.roster_due = False
        # (the admin key: made slowly from the admin PIN - what the game proves, the PIN itself never sent)
        self.admin_key = hashlib.pbkdf2_hmac('sha256', cfg['adminPin'].encode(), bytes.fromhex(cfg['adminSalt']), ADMIN_ROUNDS)
        self.vote = None                  # the vote open now: {id, k, c, by, yes, no, voters, until}
        self.voted_at = {}                # who called one (tag, else id) -> when

    # ---- the rules: every player is told them; one who proved the admin PIN may change them (kept in
    # world_server.json) -----------------------------------------------------------------------------------------
    def rules(self):
        return {'maxPlayers': self.cfg['maxPlayers'], **{k: self.cfg[k] for k in RULE_FLAGS}}

    def admin(self, p, m):
        proof = m.get('proof')
        ok = isinstance(proof, str) and len(proof) <= 128 and hmac.compare_digest(
            proof, hmac.new(self.admin_key, (p.nonce + '|admin').encode(), hashlib.sha256).hexdigest())
        if not ok:
            self.note_fail(p.address, is_loopback(p.address))
            p.send({'t': 'admin', 'ok': 0})
            return
        p.admin = True
        say(f'관리자: {p.name or "?"} [{p.tag or "-"}]', 'admin')
        p.send({'t': 'admin', 'ok': 1})

    def set_rules(self, p, r):
        if not p.admin or not isinstance(r, dict):
            return
        changed = False
        n = r.get('maxPlayers')
        if isinstance(n, int) and not isinstance(n, bool) and 2 <= n <= MAX_PLAYERS and n != self.cfg['maxPlayers']:
            self.cfg['maxPlayers'] = n
            changed = True
        for k in RULE_FLAGS:
            b = r.get(k)
            if isinstance(b, bool) and b != self.cfg[k]:
                self.cfg[k] = b
                changed = True
        if not changed:
            return
        if self.save and self.cfg_path:
            try:
                with open(self.cfg_path, 'w', encoding='utf-8') as f:
                    json.dump(self.cfg, f, ensure_ascii=False, indent=2)
            except OSError:
                pass
        say('규칙 바뀜 (관리자): ' + ', '.join(f'{k}={v}' for k, v in self.rules().items()), 'rules changed by the admin')
        self.broadcast({'t': 'rules', 'r': self.rules()})

    # ---- who is where, and who runs each map ------------------------------------------------------------------
    def roster(self):
        return [[p.id, p.name, p.tag, p.map] for p in self.players.values()]

    def update_leads(self):
        """The one running a map's monsters: the one doing it stays while it is there; else the one there longest
        (the lowest id among those come at once). Told to everyone when it changes."""
        on = {}
        for p in self.players.values():
            if p.map > 0:
                on.setdefault(p.map, []).append(p)
        leads = {}
        for m, ps in on.items():
            cur = self.leads.get(m)
            if cur and any(p.id == cur for p in ps):
                leads[m] = cur
            else:
                leads[m] = min(ps, key=lambda p: (p.arr, p.id)).id
        if leads != self.leads:
            self.leads = leads
            self.broadcast({'t': 'lead', 'l': sorted([m, i] for m, i in leads.items())})

    def broadcast(self, obj, but=None):
        data = frame(1, json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
        for p in list(self.players.values()):
            if p is not but:
                p.put(data)

    def moved(self, p, m):
        """A player came onto a map (0: between maps): its locks elsewhere go; who runs the maps, and the list."""
        if not (isinstance(m, int) and not isinstance(m, bool) and 0 <= m <= 9999) or m == p.map:
            return
        p.map, p.arr = m, time.monotonic()
        for k, (owner, _) in list(self.locks.items()):
            if owner == p.id and int(k.split(',')[0]) != m:
                del self.locks[k]
        self.update_leads()
        self.roster_due = True

    # ---- the world ----------------------------------------------------------------------------------------------
    def world_flags(self, p, m):
        S, V, SS = m.get('S', []), m.get('V', []), m.get('SS', [])
        if not all(isinstance(a, list) for a in (S, V, SS)):
            return
        n = len(S) + len(V) + len(SS)
        if not n:
            return
        t = time.monotonic()
        p.wf = [x for x in p.wf if t - x[0] < 60]
        used = sum(x[1] for x in p.wf)
        if n > WF_ENTRIES or used + n > WF_PER_MINUTE or self.world.size() + n > MAX_WORLD:
            if not p.wf_warned:
                p.wf_warned = True
                say(f'세계 변경이 너무 많아 버림: {p.name or "?"} [{p.tag or "-"}] ({n})', 'too many world changes from one player: dropped')
            return
        p.wf.append((t, n))
        s2, v2, ss2 = self.world.apply(S, V, SS)
        if s2 or v2 or ss2:
            self.broadcast({'t': 'wf', 'from': p.id, 'S': s2, 'V': v2, 'SS': ss2}, but=p)

    def seed(self, p, m):
        """The first one into an empty world brings it (its game's world as it is) - and after a vote for the next
        cycle, the first one to come through to it (its game in that cycle: c, its count of cycles). Told back whether
        it was taken; one that was not gets the world as it is."""
        w, c = m.get('w'), m.get('c')
        w_ = self.world
        ok = isinstance(w, dict) and (not w_.seeded or (w_.cycle > 0 and ok_id(c) and c >= w_.cycle))
        if ok:
            try:
                w_.take({**w, 'seeded': True, 'fp': p.fp, 'cycle': 0})
            except ValueError:
                ok = False
        if not ok:
            p.send({'t': 'seeded', 'ok': 0, 'w': w_.snapshot() if w_.seeded else None})
            return
        w_.changed = time.monotonic()
        w_.dirty_backup = True
        say(f'세계가 생겼습니다 ({p.name or "?"}의 게임에서): 스위치 {len(w_.sw)} · 변수 {len(w_.vars)} · 셀프 스위치 {len(w_.self)}',
            'the world was brought in')
        p.send({'t': 'seeded', 'ok': 1})
        self.broadcast({'t': 'world', 'w': w_.snapshot()}, but=p)

    # ---- votes: going on to the next cycle is everyone's to say (more than half of those here) ------------------
    def call_vote(self, p, m):
        k, c = m.get('k'), m.get('c', 0)
        who = p.tag or p.id
        t = time.monotonic()
        if k not in VOTES or not (c == 0 or ok_id(c)):
            return
        if self.vote:
            p.send({'t': 'voteno', 'why': 'busy'})
            return
        last = self.voted_at.get(who)
        if last is not None and t - last < VOTE_GAP:
            p.send({'t': 'voteno', 'why': 'wait', 'left': int(VOTE_GAP - (t - last))})
            return
        self.voted_at[who] = t
        vid = secrets.token_hex(3)
        self.vote = {'id': vid, 'k': k, 'c': c, 'by': p.id, 'yes': {p.id}, 'no': set(), 'voters': set(self.players), 'until': t + VOTE_TIME}
        say(f'투표 시작 ({k}): {p.name or "?"} - {len(self.vote["voters"])}명', 'a vote begins')
        self.broadcast({'t': 'vote', 'id': vid, 'k': k, 'from': p.id, 'by': p.name, 'n': len(self.vote['voters']), 's': VOTE_TIME})
        self.count_vote()

    def ballot(self, p, m):
        v = self.vote
        if not v or m.get('id') != v['id'] or p.id not in v['voters'] or p.id in v['yes'] or p.id in v['no']:
            return
        (v['yes'] if m.get('yes') == 1 else v['no']).add(p.id)
        self.count_vote()

    def count_vote(self, timeout=False):
        """More than half of those here when it began say yes: it passes; once that cannot be (or the time is up),
        it does not. Those who say nothing, or leave, count as no."""
        v = self.vote
        if not v:
            return
        n, yes, no = len(v['voters']), len(v['yes']), len(v['no'])
        passed = yes * 2 > n
        if not passed and not timeout and (n - no) * 2 > n:
            return
        self.vote = None
        say(f'투표 {"통과" if passed else "부결"} ({v["k"]}): 찬성 {yes} / {n}', 'the vote passed' if passed else 'the vote failed')
        self.broadcast({'t': 'voted', 'id': v['id'], 'k': v['k'], 'pass': 1 if passed else 0, 'yes': yes, 'n': n})
        if passed and v['k'] == 'cycle':
            # (the world as it was is kept aside; it stays the world until the first one through to the next cycle
            # brings that one - seed)
            if self.save:
                try:
                    say(f'세계를 백업했습니다: {self.world.backup("cycle")}', 'the world was backed up')
                except OSError:
                    pass
            self.world.cycle = (v['c'] or 0) + 1
            self.world.changed = time.monotonic()
            self.broadcast({'t': 'cycle', 'id': v['id'], 'c': self.world.cycle})

    # ---- one event at a time --------------------------------------------------------------------------------------
    def lock(self, p, k):
        if not (isinstance(k, str) and re.match(r'^\d{1,4},\d{1,5}$', k)) or int(k.split(',')[0]) != p.map:
            p.send({'t': 'lockno', 'k': k if isinstance(k, str) and len(k) < 20 else ''})
            return
        t = time.monotonic()
        held = self.locks.get(k)
        if held and held[0] != p.id and held[0] in self.players and t - held[1] < LOCK_LIFE:
            p.send({'t': 'lockno', 'k': k, 'by': held[0]})
            return
        self.locks[k] = (p.id, t)
        p.send({'t': 'lockok', 'k': k})

    def unlock(self, p, k):
        if isinstance(k, str) and self.locks.get(k, (None,))[0] == p.id:
            del self.locks[k]

    def note_fail(self, address, loopback=False):
        if loopback:
            return
        t = time.monotonic()
        times = [x for x in self.fails.get(address, []) if t - x < FAIL_WINDOW] + [t]
        self.fails[address] = times
        if len(times) >= FAILS:
            self.banned[address] = t + BAN
            self.fails.pop(address, None)
            say(f'PIN을 여러 번 틀려 {BAN // 60}분 차단: {address}', f'banned for {BAN // 60} min (wrong PINs)')

    async def serve(self, reader, writer):
        peer = writer.get_extra_info('peername') or ('?', 0)
        address = peer[0]
        loopback = is_loopback(address)
        if self.connections >= MAX_CONNECTIONS or self.per_address.get(address, 0) >= PER_ADDRESS:
            writer.close()
            return
        self.connections += 1
        self.per_address[address] = self.per_address.get(address, 0) + 1
        player = None
        try:
            await asyncio.wait_for(handshake(reader, writer), AUTH_WAIT)
            if self.banned.get(address, 0) > time.monotonic():
                # (shut out for a while - a few wrong PINs from this address: told so; it heard only that the server did
                # not answer, and so did everyone else behind the same router)
                say(f'들어오지 못함: ({address}) - {REFUSED["blocked"]}', 'refused: blocked (wrong PINs)')
                writer.write(frame(1, json.dumps({'t': 'deny', 'why': 'blocked'}).encode()))
                await writer.drain()
                return
            nonce = secrets.token_hex(16)
            writer.write(frame(1, json.dumps({'t': 'challenge', 'nonce': nonce, 'v': WORLD_VERSION, 'world': 1}).encode()))
            await writer.drain()
            auth = json.loads(await asyncio.wait_for(read_message(reader, writer), AUTH_WAIT))
            if not isinstance(auth, dict):
                return
            proof = auth.get('proof')
            name = clean_name(auth.get('name'))
            tag = tag_of(auth.get('key'))
            fp = auth.get('fp') if isinstance(auth.get('fp'), str) and len(auth.get('fp')) <= FP_LEN else ''
            why = None
            if auth.get('role') != 'world' or not isinstance(proof, str) or len(proof) > 128:
                why = 'bad'
            elif not hmac.compare_digest(proof, hmac.new(self.cfg['pin'].encode(), nonce.encode(), hashlib.sha256).hexdigest()):
                why = 'pin'
                self.note_fail(address, loopback)
            elif auth.get('wv') != WORLD_VERSION:
                why = 'version'
            elif tag and tag in self.cfg['bans']:
                why = 'banned'
            elif self.world.seeded and self.world.fp and fp != self.world.fp:
                why = 'game'
            elif len(self.players) >= self.cfg['maxPlayers']:
                why = 'full'
            if why:
                # (said here too: whoever runs the server sees why one could not come in - it heard only the buzzer)
                say(f'들어오지 못함: {name or "?"} [{tag or "-"}] ({address}) - {REFUSED.get(why, why)}', f'refused: {why}')
                writer.write(frame(1, json.dumps({'t': 'deny', 'why': why}).encode()))
                await writer.drain()
                return
            pid = secrets.token_hex(4)
            player = Player(self, pid, 'world', address, writer, name, tag)
            player.map, player.arr, player.wf, player.wf_warned, player.fp = 0, time.monotonic(), [], False, fp
            player.nonce, player.admin = nonce, False
            player.send({'t': 'ready', 'id': pid, 'sv': WORLD_VERSION, 'tag': tag, 'max': self.cfg['maxPlayers'], 'rules': self.rules(),
                         'as': self.cfg['adminSalt'], 'ar': ADMIN_ROUNDS,
                         'peers': [p.info() for p in self.players.values()], 'roster': self.roster(),
                         'leads': sorted([m, i] for m, i in self.leads.items()),
                         'world': self.world.snapshot() if self.world.seeded else None})
            for p in self.players.values():
                p.send({'t': 'peer', **player.info(), 'on': True})
            self.players[pid] = player
            self.roster_due = True
            say(f'접속: {name or "?"} [{tag or "-"}] {pid} ({address}) - 지금 {len(self.players)}명', f'joined: {pid}, {len(self.players)} now')
            while True:
                text = await read_message(reader, writer, IDLE)
                try:
                    m = json.loads(text)
                except ValueError:
                    break
                if not isinstance(m, dict):
                    break
                kind = m.get('t')
                to = m.get('to')
                scoped = m.get('m') == 1
                fan = 1 if to is not None else max(1, sum(1 for p in self.players.values() if p is not player and (not scoped or p.map == player.map)))
                if player.over_rate(len(text) * fan):
                    say(f'너무 많이 보내서 끊음: {pid}', 'dropped (flooding)')
                    break
                if kind == 'msg' and isinstance(m.get('data'), str):
                    data = frame(1, json.dumps({'t': 'msg', 'from': pid, 'data': m['data']}, ensure_ascii=False).encode('utf-8'))
                    if to is None:
                        for p in list(self.players.values()):
                            if p is not player and (not scoped or (p.map == player.map and p.map > 0)):
                                p.put(data)
                    elif isinstance(to, str) and to in self.players and to != pid:
                        self.players[to].put(data)
                elif kind == 'at':
                    self.moved(player, m.get('m'))
                elif kind == 'wf':
                    self.world_flags(player, m)
                elif kind == 'seed':
                    self.seed(player, m)
                elif kind == 'admin':
                    self.admin(player, m)
                elif kind == 'rules':
                    self.set_rules(player, m.get('r'))
                elif kind == 'vote':
                    self.call_vote(player, m)
                elif kind == 'ballot':
                    self.ballot(player, m)
                elif kind == 'lock':
                    self.lock(player, m.get('k'))
                elif kind == 'unlock':
                    self.unlock(player, m.get('k'))
                else:
                    break
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError, ConnectionError,
                Closed, ValueError, OSError):
            pass
        except Exception as e:
            say(f'연결 오류: {type(e).__name__}', 'connection error')
        finally:
            self.connections -= 1
            self.per_address[address] -= 1
            if not self.per_address[address]:
                del self.per_address[address]
            if player and self.players.get(player.id) is player:
                del self.players[player.id]
                player.sender.cancel(); player.pinger.cancel()
                for k, (owner, _) in list(self.locks.items()):
                    if owner == player.id:
                        del self.locks[k]
                for p in self.players.values():
                    p.send({'t': 'peer', **player.info(), 'on': False})
                self.update_leads()
                self.roster_due = True
                say(f'나감: {player.name or "?"} {player.id} - 지금 {len(self.players)}명', f'left, {len(self.players)} now')
            try:
                writer.close()
            except Exception:
                pass

    async def tick(self):
        """Every half second: the list of who is where (when it changed); the world written a while after it changed,
        and backed up now and then."""
        w = self.world
        while True:
            await asyncio.sleep(0.5)
            if self.roster_due:
                self.roster_due = False
                self.broadcast({'t': 'roster', 'l': self.roster()})
            if self.vote and time.monotonic() > self.vote['until']:
                self.count_vote(timeout=True)
            t = time.monotonic()
            if self.save and w.changed and t - w.changed > SAVE_AFTER:
                w.changed = 0.0
                try:
                    w.write()
                except OSError as e:
                    say(f'세계를 저장하지 못했습니다: {e}', 'could not write the world')
            if self.save and w.dirty_backup and t - w.backed > BACKUP_EVERY:
                w.dirty_backup, w.backed = False, t
                try:
                    w.backup()
                except OSError:
                    pass


def load_config(args, path):
    cfg = {'port': 28472, 'pin': '', 'adminPin': '', 'adminSalt': '', 'maxPlayers': MAX_PLAYERS, **{k: k in RULE_ON for k in RULE_FLAGS}, 'bans': []}
    try:
        with open(path, encoding='utf-8') as f:
            saved = json.load(f)
        if isinstance(saved, dict):
            cfg.update({k: saved[k] for k in cfg if k in saved})
    except (OSError, ValueError):
        pass
    if args.port: cfg['port'] = args.port
    if args.pin: cfg['pin'] = args.pin
    if args.admin_pin: cfg['adminPin'] = args.admin_pin
    if args.max_players: cfg['maxPlayers'] = args.max_players
    if not (isinstance(cfg['pin'], str) and cfg['pin'].isdigit() and 4 <= len(cfg['pin']) <= 12):
        cfg['pin'] = f'{secrets.randbelow(10 ** 6):06d}'           # (a random one at first)
    if not (isinstance(cfg['adminPin'], str) and cfg['adminPin'].isdigit() and len(cfg['adminPin']) == 12):
        if args.admin_pin:
            say('--admin-pin은 12자리 숫자여야 합니다 - 무작위로 정했습니다', 'the admin PIN must be 12 digits: a random one was made')
        cfg['adminPin'] = f'{secrets.randbelow(10 ** 12):012d}'    # (12 digits, random at first)
    if not (isinstance(cfg['adminSalt'], str) and re.match(r'^[0-9a-f]{32}$', cfg['adminSalt'])):
        cfg['adminSalt'] = secrets.token_hex(16)
    for k in RULE_FLAGS:
        if not isinstance(cfg[k], bool):
            cfg[k] = str(cfg[k]).strip().lower() in ('1', 'true', 'yes', 'on')
    try:
        cfg['port'] = int(cfg['port']) if 1024 <= int(cfg['port']) <= 65535 else 28472
    except (TypeError, ValueError):
        cfg['port'] = 28472
    try:
        cfg['maxPlayers'] = max(2, min(MAX_PLAYERS, int(cfg['maxPlayers'])))
    except (TypeError, ValueError):
        cfg['maxPlayers'] = MAX_PLAYERS
    cfg['bans'] = [b for b in cfg['bans'] if isinstance(b, str) and re.match(r'^[0-9a-f]{12}$', b)] if isinstance(cfg['bans'], list) else []
    return cfg


async def main():
    ap = argparse.ArgumentParser(description='BLACK SOULS II VR community server (one shared world)')
    ap.add_argument('--port', type=int)
    ap.add_argument('--pin')
    ap.add_argument('--admin-pin')
    ap.add_argument('--max-players', type=int)
    ap.add_argument('--no-save', action='store_true', help='keep the world in memory only (nothing is written)')
    ap.add_argument('--dir', help='folder for world.json, backups and world_server.json (default: beside this file)')
    ap.add_argument('--reset', action='store_true', help='put the world aside (a backup) and begin an empty one')
    ap.add_argument('--restore', help='take this backup back as the world')
    ap.add_argument('--bind', default='0.0.0.0')
    args = ap.parse_args()
    folder = None if args.no_save else os.path.abspath(args.dir or HERE)
    cfg_path = os.path.join(folder, 'world_server.json') if folder else None
    cfg = load_config(args, cfg_path) if cfg_path else load_config(args, os.devnull)
    if cfg_path:
        os.makedirs(folder, exist_ok=True)
        with open(cfg_path, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    world = World(folder)
    try:
        world.load()
    except (OSError, ValueError) as e:
        say(f'world.json을 읽지 못했습니다 ({e}) - 백업에서 되살리려면 --restore', 'could not read world.json')
        sys.exit(1)
    if args.reset and folder:
        if world.seeded:
            say(f'지금 세계를 백업했습니다: {world.backup("reset")}', 'the world was backed up')
        world = World(folder)
        world.write()
    if args.restore:
        with open(args.restore, encoding='utf-8') as f:
            world.take(json.load(f))
        if folder:
            world.write()
        say(f'백업을 세계로 되살렸습니다: {args.restore}', 'restored the world from a backup')
    hub = Hub(cfg, world, save=bool(folder), cfg_path=cfg_path)
    server = await asyncio.start_server(hub.serve, args.bind, cfg['port'], limit=MAX_HEADER)
    asyncio.create_task(hub.tick())
    say(f'BLACK SOULS II VR 커뮤니티 서버가 열렸습니다 (세계 v{WORLD_VERSION})', f'community server is up (world v{WORLD_VERSION})')
    print(f'    포트 / port      : {cfg["port"]} (TCP)')
    print(f'    접속 PIN / PIN   : {cfg["pin"]}   (게임의 협력 → 커뮤니티 서버 추가에 넣는 번호 / the PIN players add the server with)')
    print(f'    관리자 PIN       : {cfg["adminPin"]}   (게임의 협력 메뉴에서 규칙을 바꿀 때 / to change the rules in the game)')
    onoff = lambda k: '켬 / on' if cfg[k] else '끔 / off'
    print(f'    최대 인원 / max  : {cfg["maxPlayers"]}   PvP: {onoff("pvp")}   보스전 관전: {onoff("bossSpectate")}   보스 강화: {onoff("bossScale")}')
    print(f'    아이템 공유      : {onoff("shareLoot")}   (규칙 shareLoot - 켜면 누가 얻은 아이템·소울이든 접속한 모두가 같이 받음)')
    print(f'    세계 / world     : ' + (f'스위치 {len(world.sw)} · 변수 {len(world.vars)} · 셀프 스위치 {len(world.self)}' if world.seeded
                                       else '비어 있음 - 처음 들어오는 사람의 세계로 시작합니다 / empty: the first player brings it'))
    print(f'    저장 / saved in  : {folder or "(저장하지 않음 / not saved)"}')
    for ip in lan_addresses():
        print(f'    이 PC의 주소     : {ip}   (같은 공유기 안의 사람 / players on the same router)')
    print('    인터넷의 사람에게는 공인 IP를 알려 주고, 공유기(또는 클라우드의 방화벽)에서 이 포트를 열어 주세요.')
    print('    Windows 방화벽 창이 뜨면 "공용 네트워크"도 체크하고 허용을 누르세요.')
    print('    Players over the internet: the public IP, this port open on the router (or the cloud firewall), Python allowed through the firewall.')
    print('    끄려면 이 창을 닫으세요 (Ctrl+C). / Close this window to stop.', flush=True)
    try:
        async with server:
            await server.serve_forever()
    finally:
        if folder and world.changed:
            world.write()


if __name__ == '__main__':
    if sys.platform == 'win32':
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except Exception:
            pass
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    except OSError as e:
        say(f'서버를 열지 못했습니다: {e}', 'could not open the server (is the port in use?)')
        sys.exit(1)
