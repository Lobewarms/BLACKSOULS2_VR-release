"""BLACK SOULS II VR co-op server - the server launcher.

Run it on the host's own PC (friends connect to this PC's address) or on a server elsewhere (then nobody learns the
host's address - only the server's). It does one thing: lets in players who know its PIN and passes their messages
on, to one player or to all. The worlds themselves run in the players' games (the host's is the real one).

    python coop_server.py                 (Windows: double-click coop_server.cmd; Linux: python3 coop_server.py)
    options: --port N  --pin 123456  --host-pin 654321  --max-players 4  --no-save  --local-pin

Settings are kept in coop_server.json next to this file (made on the first run - a random join PIN and host PIN):
    port        TCP port to listen on (default 28471) - for friends over the internet, forward it on the router
    pin         what every player enters to join (random at first - the host may change it in its game's co-op menu,
                kept here)
    hostPin     what the host enters when its game is not on this PC (a host on this PC needs none) - random, this
                server's own
    The rules of the worlds opened here (every player is told them; the host's game keeps them; the host may change
    them in its game's co-op menu - kept here):
    maxPlayers       players at once, the host included (2-8)
    guestStartsBoss  true: a guest may start a boss fight before the host; false: the host goes in first (default)
    pvp              true: players can strike each other (a host brought down loses its souls, at the bonfire)
    guestRespawn     true (the default): a guest brought down is not sent home - it comes back at the last bonfire
    bossSpectate     true (the default): one brought down in a boss fight watches it, unseen and untouchable, until
                     everyone in it is down (a guest only with guestRespawn on); won, they are up again
    statSync         true (the default): a guest's own numbers (its level's and what it grew - not its equipment or
                     oaths) are brought to the host's
    guestsFollow     true (the default): the guests go with the host from map to map; false: each goes its own way
    bossScale        true (the default): a boss's HP, MP and groggy gauge grow by 0.6 times for each player past one in
                     its fight (the most that were ever in it)
The host may send a player away (kick) or ban it, from its co-op menu. A player is known by a tag the server makes from
the random key its game keeps (the key itself is never passed on) - the host keeps its own list of the banned and tells
it to the server it opens its world on; a ban also shuts that player's address out until the server stops (never this
PC's own).

Safety: it opens this one port only (nothing of the game, its files or saves is reachable through it), speaks only
this small protocol (WebSocket, checked byte by byte, size and rate limited - what one player makes it send out, and
what waits for a slow one, so a flood can neither run up a cloud server's traffic nor fill its memory), never runs or
stores anything it is sent, and bans an address for a while after repeated wrong PINs. The PIN is never sent: a
player proves it with an HMAC of a one-time challenge. Messages are not encrypted on the way (play data only).
"""
import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import os
import secrets
import socket
import struct
import sys
import time

VERSION = 1
HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, 'coop_server.json')
WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
MAX_MESSAGE = 4 * 1024 * 1024        # bytes in one message (a host's welcome carries its whole world's switches)
MAX_HEADER = 8192                    # bytes of the opening HTTP request
AUTH_WAIT = 10                       # s a new connection has to prove its PIN
SEND_QUEUE = 512                     # messages waiting for a slow player before it is dropped ...
QUEUE_BYTES = 16 * 1024 * 1024       # ... or bytes
RATE_MSGS = 1500                     # messages a second one player may send (a host sends each guest its world: with seven, ~200)
RATE_BYTES = 1024 * 1024             # bytes a second one player may make this server send out (to each it goes to),
BURST_BYTES = 12 * 1024 * 1024       # on the whole - and at once (a host's welcome carries its whole world's switches)
FAILS = 5                            # wrong PINs from one address ...
FAIL_WINDOW = 600                    # ... within this many seconds ...
BAN = 600                            # ... ban it for this long
PER_ADDRESS = 8                      # connections at once from one address (players behind one router: as many as may play)
# why one could not come in, as the window says it
REFUSED = {'bad': '접속이 잘못됨', 'pin': 'PIN이 틀림', 'version': 'VR 모드(또는 서버) 버전이 다름', 'banned': '차단된 사람',
           'full': '인원이 다 참', 'game': '게임 판본(버전·번역)이 다름', 'blocked': 'PIN을 여러 번 틀려 잠시 막힌 주소'}
MAX_CONNECTIONS = 32
PING_EVERY = 20                      # s between the server's pings (a browser answers them by itself)
IDLE = 60                            # s without a word from a player (not even a pong): its connection is dead
MAX_BANS = 200                       # tags in a host's list of the banned
NAME_LEN = 16                        # characters of a player's name
ORIGIN_OK = ('http://localhost', 'http://127.0.0.1')   # the game's page is served by each player's own launcher


NAME_CHARS = set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 _-')


def clean_name(s):
    """A player's name as it says it - English letters, digits, space, - and _ (what the game's keyboard types),
    short; '' for none."""
    if not isinstance(s, str):
        return ''
    return ' '.join(''.join(c for c in s if c in NAME_CHARS).split())[:NAME_LEN].strip()


def tag_of(key):
    """The tag a player is known by: made from the random key its game keeps (the key itself is never passed on)."""
    if isinstance(key, str) and 16 <= len(key) <= 64 and all(c in '0123456789abcdef' for c in key):
        return hashlib.sha256(key.encode()).hexdigest()[:12]
    return ''


def is_loopback(address):
    return address.startswith('127.') or address == '::1' or address.startswith('::ffff:127.')


def say(ko, en=''):
    stamp = time.strftime('%H:%M:%S')
    print(f'[{stamp}] {ko}' + (f'  /  {en}' if en else ''), flush=True)


RULE_FLAGS = ('guestStartsBoss', 'pvp', 'guestRespawn', 'bossSpectate', 'statSync', 'guestsFollow', 'bossScale')   # the yes / no rules
RULE_ON = ('statSync', 'guestsFollow', 'bossScale', 'guestRespawn', 'bossSpectate')                                 # (those on unless set off)
RULES_VERSION = 2      # 2: guestRespawn and bossSpectate on by default - a coop_server.json from before gets them on, once
SERVER_VERSION = 4     # told to every player that comes in ('ready' sv): a game finds an older server by it and says so
                       # (4: a random join PIN at first, the host's changes kept, traffic and memory limits)


def load_config(args):
    cfg = {'port': 28471, 'pin': '', 'hostPin': '', 'maxPlayers': 4, **{k: k in RULE_ON for k in RULE_FLAGS}, 'rulesVersion': RULES_VERSION}
    try:
        with open(CONFIG_PATH, encoding='utf-8') as f:
            saved = json.load(f)
        if isinstance(saved, dict):
            cfg.update({k: saved[k] for k in cfg if k in saved})
            if not isinstance(saved.get('rulesVersion'), int) or saved['rulesVersion'] < 2:
                cfg['guestRespawn'] = cfg['bossSpectate'] = True      # (the new defaults, once)
            cfg['rulesVersion'] = RULES_VERSION
    except (OSError, ValueError):
        pass
    if args.port: cfg['port'] = args.port
    if args.pin: cfg['pin'] = args.pin
    if args.host_pin: cfg['hostPin'] = args.host_pin
    if args.max_players: cfg['maxPlayers'] = args.max_players
    if args.guest_boss: cfg['guestStartsBoss'] = True
    for k in RULE_FLAGS:
        if not isinstance(cfg[k], bool):
            cfg[k] = str(cfg[k]).strip().lower() in ('1', 'true', 'yes', 'on')
    for k in ('pin', 'hostPin'):
        if not (isinstance(cfg[k], str) and cfg[k].isdigit() and 4 <= len(cfg[k]) <= 12):
            cfg[k] = f'{secrets.randbelow(10 ** 6):06d}'           # (a random one at first)
    try:
        cfg['port'] = int(cfg['port']) if 1024 <= int(cfg['port']) <= 65535 else 28471
    except (TypeError, ValueError):
        cfg['port'] = 28471
    try:
        cfg['maxPlayers'] = max(2, min(8, int(cfg['maxPlayers'])))
    except (TypeError, ValueError):
        cfg['maxPlayers'] = 4
    if not args.no_save:
        save_config(cfg)
    return cfg


def save_config(cfg):
    try:
        with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    except OSError:
        pass


# ---- WebSocket (RFC 6455), only as much as this needs ------------------------------------------------------------
class Closed(Exception):
    pass


def frame(opcode, payload=b''):
    n = len(payload)
    head = bytes([0x80 | opcode])
    if n < 126:
        head += bytes([n])
    elif n < 65536:
        head += bytes([126]) + struct.pack('>H', n)
    else:
        head += bytes([127]) + struct.pack('>Q', n)
    return head + payload


async def read_message(reader, writer, idle=None):
    """The next text message (str); answers pings, raises Closed on a close or anything out of order - or when
    nothing at all (not even a pong) came for idle seconds."""
    parts, size = [], 0
    while True:
        b1, b2 = await (asyncio.wait_for(reader.readexactly(2), idle) if idle else reader.readexactly(2))
        fin, rsv, opcode, masked, n = b1 & 0x80, b1 & 0x70, b1 & 0x0F, b2 & 0x80, b2 & 0x7F
        if rsv or not masked:
            raise Closed('bad frame')
        if n == 126:
            n = struct.unpack('>H', await reader.readexactly(2))[0]
        elif n == 127:
            n = struct.unpack('>Q', await reader.readexactly(8))[0]
        if opcode >= 8 and (n > 125 or not fin):
            raise Closed('bad control frame')
        if size + n > MAX_MESSAGE:
            raise Closed('too long')
        mask = await reader.readexactly(4)
        data = await reader.readexactly(n)
        if n:
            key = (mask * (n // 4 + 1))[:n]
            data = (int.from_bytes(data, 'big') ^ int.from_bytes(key, 'big')).to_bytes(n, 'big')
        if opcode == 8:
            raise Closed('closed')
        if opcode == 9:
            writer.write(frame(10, data))
            continue
        if opcode == 10:
            continue
        if opcode == 2 or (opcode == 0 and not parts) or (opcode == 1 and parts) or opcode not in (0, 1):
            raise Closed('unexpected frame')
        parts.append(data)
        size += n
        if fin:
            try:
                return b''.join(parts).decode('utf-8')
            except UnicodeDecodeError:
                raise Closed('not text')


async def handshake(reader, writer):
    """The opening HTTP request: a WebSocket upgrade to /coop from the game's page, or nothing."""
    raw = await reader.readuntil(b'\r\n\r\n')
    if len(raw) > MAX_HEADER:
        raise Closed('header too long')
    lines = raw.decode('latin-1').split('\r\n')
    method, path, *_ = (lines[0].split(' ') + ['', ''])[:3]
    headers = {}
    for line in lines[1:]:
        if ':' in line:
            k, v = line.split(':', 1)
            headers[k.strip().lower()] = v.strip()
    origin = headers.get('origin', '')
    origin_ok = not origin or any(origin == o or origin.startswith(o + ':') for o in ORIGIN_OK)
    key = headers.get('sec-websocket-key', '')
    try:
        key_ok = len(base64.b64decode(key, validate=True)) == 16
    except ValueError:
        key_ok = False
    if (method != 'GET' or path != '/coop' or headers.get('upgrade', '').lower() != 'websocket'
            or 'upgrade' not in headers.get('connection', '').lower() or headers.get('sec-websocket-version') != '13'
            or not key_ok or not origin_ok):
        writer.write(b'HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
        raise Closed('not a co-op connection')
    accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
    writer.write(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                  f'Sec-WebSocket-Accept: {accept}\r\n\r\n').encode())
    await writer.drain()


# ---- the server ---------------------------------------------------------------------------------------------------
class Player:
    def __init__(self, hub, pid, role, address, writer, name='', tag=''):
        self.hub, self.id, self.role, self.address, self.writer = hub, pid, role, address, writer
        self.name, self.tag = name, tag
        self.dropping = False
        self.cut = False                 # (let go for being too slow: nothing more goes to it)
        self.queue = asyncio.Queue(SEND_QUEUE)
        self.queued = 0                  # bytes waiting in it
        self.sender = asyncio.create_task(self.drain())
        self.pinger = asyncio.create_task(self.ping())
        self.window, self.msgs = time.monotonic(), 0
        self.allowance, self.filled = BURST_BYTES, time.monotonic()

    def send(self, obj):
        self.put(frame(1, json.dumps(obj, ensure_ascii=False).encode('utf-8')))

    def put(self, data):
        """Bytes to go out to this player: one too slow to take what waits for it (that many messages or bytes) is
        let go at once - what waits for it with it (a close would wait for it to take that first)."""
        if self.cut:
            return
        try:
            if self.queued + len(data) > QUEUE_BYTES:
                raise asyncio.QueueFull
            self.queue.put_nowait(data)
            self.queued += len(data)
        except asyncio.QueueFull:
            self.cut = True
            say(f'너무 느려서 끊음: {self.role} {self.id}', 'dropped (too slow)')
            self.writer.transport.abort()

    async def drain(self):
        try:
            while True:
                data = await self.queue.get()
                if data is None:                 # (sent away: what was queued before it went first)
                    self.writer.close()
                    return
                self.queued -= len(data)
                self.writer.write(data)
                await self.writer.drain()
        except (ConnectionError, asyncio.CancelledError, OSError):
            pass

    async def ping(self):
        """A ping now and then: a connection gone dead without a word (a dropped line) is found out by its silence."""
        try:
            while True:
                await asyncio.sleep(PING_EVERY)
                self.put(frame(9))
        except (asyncio.CancelledError, asyncio.QueueFull):
            pass

    def drop(self, why):
        """Sent away (kicked / banned): told why, then the connection ends."""
        if self.dropping:
            return
        self.dropping = True
        self.send({'t': 'deny', 'why': why})
        try:
            self.queue.put_nowait(None)
        except asyncio.QueueFull:
            self.writer.transport.abort()

    def info(self):
        return {'id': self.id, 'role': self.role, 'name': self.name, 'tag': self.tag}

    def over_rate(self, n):
        """One more message from this player, making this server send n bytes out (each player it goes to counted):
        too many a second, or more bytes than its allowance (refilled by RATE_BYTES a second, up to BURST_BYTES)."""
        t = time.monotonic()
        if t - self.window >= 1:
            self.window, self.msgs = t, 0
        self.msgs += 1
        self.allowance = min(BURST_BYTES, self.allowance + (t - self.filled) * RATE_BYTES) - n
        self.filled = t
        return self.msgs > RATE_MSGS or self.allowance < 0


class Hub:
    def __init__(self, cfg, local_pin=False, save=True):
        self.cfg = cfg
        self.local_pin = local_pin        # a host on this PC proves the host PIN too (a PC others use as well)
        self.save = save                  # rules the host changes in its game are kept in coop_server.json
        self.players = {}                 # id -> Player
        self.fails = {}                   # address -> [times of wrong PINs]
        self.banned = {}                  # address -> until
        self.per_address = {}             # address -> open connections
        self.connections = 0
        self.ban_tags = set()             # the players banned from the world opened here (its host's list)
        self.ban_addresses = {}           # tag -> the address it was banned from (shut out until the server stops)

    def host(self):
        return next((p for p in self.players.values() if p.role == 'host'), None)

    def rules(self):
        """The rules of the worlds opened here, as every player is told them."""
        return {'maxPlayers': self.cfg['maxPlayers'], **{k: self.cfg[k] for k in RULE_FLAGS}}

    def set_rules(self, r, player):
        """The host changed the rules in its game's co-op menu: taken as far as they make sense, told to everyone,
        kept in coop_server.json (a host from elsewhere proved the host PIN: the server is its to set as well)."""
        if not isinstance(r, dict):
            return
        changed = False
        n = r.get('maxPlayers')
        if isinstance(n, int) and not isinstance(n, bool) and 2 <= n <= 8 and n != self.cfg['maxPlayers']:
            self.cfg['maxPlayers'] = n
            changed = True
        for k in RULE_FLAGS:
            b = r.get(k)
            if isinstance(b, bool) and b != self.cfg[k]:
                self.cfg[k] = b
                changed = True
        if not changed:
            return
        if self.save:
            save_config(self.cfg)
        say('규칙 바뀜 (호스트): ' + ', '.join(f'{k}={self.cfg[k]}' for k in ('maxPlayers',) + RULE_FLAGS), 'rules changed by the host')
        for p in self.players.values():
            p.send({'t': 'rules', 'rules': self.rules()})

    def set_pin(self, pin, player):
        """The host changed the join PIN in its co-op menu (4-12 digits): those in stay, the next must know the new
        one. Kept in coop_server.json; told back to the host only."""
        if not (isinstance(pin, str) and pin.isdigit() and 4 <= len(pin) <= 12) or pin == self.cfg['pin']:
            return
        self.cfg['pin'] = pin
        if self.save:
            save_config(self.cfg)
        say(f'접속 PIN 바뀜 (호스트): {pin}', 'join PIN changed by the host')
        player.send({'t': 'pin', 'pin': pin})

    def kick(self, pid, ban=False):
        """The host sends a guest away - with ban, for good: its tag goes on the list, and its address is shut out
        until the server stops (never this PC's own)."""
        p = self.players.get(pid) if isinstance(pid, str) else None
        if not p or p.role != 'guest':
            return
        if ban:
            if p.tag:
                self.ban_tags.add(p.tag)
                if not is_loopback(p.address):
                    self.ban_addresses[p.tag] = p.address
            say(f'차단 (호스트): {p.name or "?"} [{p.tag or "-"}]', 'banned by the host')
        else:
            say(f'내보냄 (호스트): {p.name or "?"} [{p.tag or "-"}]', 'kicked by the host')
        p.drop('banned' if ban else 'kicked')

    def set_bans(self, tags):
        """The host's list of the banned (its game keeps it): those on it may not come in - one in now is sent away."""
        if not isinstance(tags, list):
            return
        new = {x for x in tags[:MAX_BANS] if isinstance(x, str) and len(x) == 12 and all(c in '0123456789abcdef' for c in x)}
        self.ban_tags = new
        self.ban_addresses = {k: v for k, v in self.ban_addresses.items() if k in new}
        for p in list(self.players.values()):
            if p.role == 'guest' and p.tag in new and not p.dropping:
                say(f'차단 목록에 있어 내보냄: {p.name or "?"} [{p.tag}]', 'on the ban list: sent away')
                p.drop('banned')

    def note_fail(self, address, loopback=False):
        if loopback:                      # (this PC itself is never shut out of its own server)
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
            writer.write(frame(1, json.dumps({'t': 'challenge', 'nonce': nonce, 'v': VERSION}).encode()))
            await writer.drain()
            auth = json.loads(await asyncio.wait_for(read_message(reader, writer), AUTH_WAIT))
            role = auth.get('role') if isinstance(auth, dict) else None
            proof = auth.get('proof') if isinstance(auth, dict) else None
            name = clean_name(auth.get('name')) if isinstance(auth, dict) else ''
            tag = tag_of(auth.get('key')) if isinstance(auth, dict) else ''
            why = None
            if role not in ('host', 'guest') or not isinstance(proof, str) or len(proof) > 128:
                why = 'bad'
            elif not (role == 'host' and loopback and not self.local_pin) and not hmac.compare_digest(
                    proof, hmac.new(self.cfg['hostPin' if role == 'host' else 'pin'].encode(), nonce.encode(), hashlib.sha256).hexdigest()):
                why = 'pin'
                self.note_fail(address, loopback)
            elif role == 'guest' and ((tag and tag in self.ban_tags) or address in self.ban_addresses.values()):
                why = 'banned'
            elif len(self.players) - (1 if role == 'host' and self.host() else 0) >= self.cfg['maxPlayers']:      # (a host coming back takes its old place)
                why = 'full'
            if why:
                # (said here too: whoever runs the server sees why one could not come in - it heard only the buzzer)
                say(f'들어오지 못함: {name or "?"} [{tag or "-"}] ({address}) - {REFUSED.get(why, why)}', f'refused: {why}')
                writer.write(frame(1, json.dumps({'t': 'deny', 'why': why}).encode()))
                await writer.drain()
                return
            old = self.host() if role == 'host' else None
            if old:                  # (the host coming back after its line dropped - its old connection is let go)
                say(f'호스트가 다시 연결해 이전 연결을 끊음: {old.id}', 'the host connected again: its old connection is dropped')
                old.drop('replaced')
                del self.players[old.id]
                old.pinger.cancel()
                for p in self.players.values():
                    p.send({'t': 'peer', **old.info(), 'on': False})
            pid = secrets.token_hex(4)
            player = Player(self, pid, role, address, writer, name, tag)
            ready = {'t': 'ready', 'id': pid, 'peers': [p.info() for p in self.players.values()], 'rules': self.rules(),
                     'tag': tag, 'sv': SERVER_VERSION}
            if role == 'host':
                ready['pin'] = self.cfg['pin']         # (the host is shown it, to tell its friends - and may change it)
            player.send(ready)
            for p in self.players.values():
                p.send({'t': 'peer', **player.info(), 'on': True})
            self.players[pid] = player
            say(f'접속: {"호스트" if role == "host" else "게스트"} {name or "?"} [{tag or "-"}] {pid} ({address}) - 지금 {len(self.players)}명',
                f'joined: {role} {pid}, {len(self.players)} now')
            while True:
                text = await read_message(reader, writer, IDLE)
                try:
                    m = json.loads(text)
                except ValueError:
                    break
                to = m.get('to') if isinstance(m, dict) else None
                if player.over_rate(len(text) * (max(1, len(self.players) - 1) if to is None else 1)):
                    say(f'너무 많이 보내서 끊음: {pid}', 'dropped (flooding)')
                    break
                if isinstance(m, dict) and m.get('t') in ('rules', 'pin', 'kick', 'ban', 'bans'):
                    if role == 'host':           # (only the host sets the rules and the PIN, or sends one away; anyone else's word is not taken)
                        if m['t'] == 'rules':
                            self.set_rules(m.get('rules'), player)
                        elif m['t'] == 'pin':
                            self.set_pin(m.get('pin'), player)
                        elif m['t'] == 'bans':
                            self.set_bans(m.get('tags'))
                        else:
                            self.kick(m.get('id'), ban=m['t'] == 'ban')
                    continue
                if not isinstance(m, dict) or m.get('t') != 'msg' or not isinstance(m.get('data'), str):
                    break
                data = frame(1, json.dumps({'t': 'msg', 'from': pid, 'data': m['data']}, ensure_ascii=False).encode('utf-8'))
                if to is None:
                    for p in list(self.players.values()):
                        if p is not player:
                            p.put(data)
                elif isinstance(to, str) and to in self.players and to != pid:
                    self.players[to].put(data)
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError, ConnectionError,
                Closed, ValueError, OSError):
            pass
        except Exception as e:                    # (anything else: that one connection ends, the server goes on)
            say(f'연결 오류: {type(e).__name__}', 'connection error')
        finally:
            self.connections -= 1
            self.per_address[address] -= 1
            if not self.per_address[address]:
                del self.per_address[address]
            if player and self.players.get(player.id) is player:
                del self.players[player.id]
                player.sender.cancel(); player.pinger.cancel()
                for p in self.players.values():
                    p.send({'t': 'peer', **player.info(), 'on': False})
                say(f'나감: {player.role} {player.id} - 지금 {len(self.players)}명', f'left, {len(self.players)} now')
            try:
                writer.close()
            except Exception:
                pass


def lan_addresses():
    found = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith('127.'):
                found.add(ip)
    except OSError:
        pass
    return sorted(found)


async def main():
    ap = argparse.ArgumentParser(description='BLACK SOULS II VR co-op server')
    ap.add_argument('--port', type=int)
    ap.add_argument('--pin')
    ap.add_argument('--host-pin')
    ap.add_argument('--max-players', type=int)
    ap.add_argument('--no-save', action='store_true', help='do not write coop_server.json')
    ap.add_argument('--bind', default='0.0.0.0', help='address to listen on (127.0.0.1: this PC only)')
    ap.add_argument('--local-pin', action='store_true', help='a host on this PC needs the host PIN too')
    ap.add_argument('--guest-boss', action='store_true', help='rule: a guest may start a boss fight before the host')
    args = ap.parse_args()
    cfg = load_config(args)
    hub = Hub(cfg, args.local_pin, save=not args.no_save)
    server = await asyncio.start_server(hub.serve, args.bind, cfg['port'], limit=MAX_HEADER)
    say(f'BLACK SOULS II VR 협력 서버가 열렸습니다 (v{SERVER_VERSION})', f'co-op server is up (v{SERVER_VERSION})')
    print(f'    포트 / port      : {cfg["port"]} (TCP)')
    print(f'    접속 PIN / PIN   : {cfg["pin"]}   (친구에게 알려 줄 번호 / give this to your friends)')
    print(f'    호스트 PIN       : {cfg["hostPin"]}   (이 PC가 아닌 곳에서 호스트로 열 때만 / only to host from another PC)')
    if cfg['pin'] == '000000':
        print('    ! 접속 PIN이 000000입니다 - 주소를 아는 누구나 들어옵니다. 게임의 메뉴 → 협력 → 접속 PIN이나 --pin으로 바꾸세요.')
        print('    ! The join PIN is 000000 - anyone who knows the address can come in. Change it in the game (menu -> Co-op)')
        print('      or with --pin.')
    print(f'    최대 인원 / max  : {cfg["maxPlayers"]}   (규칙 maxPlayers)')
    boss = ('게스트도 먼저 시작할 수 있음 / guests may start it' if cfg['guestStartsBoss']
            else '호스트가 먼저 / the host goes in first')
    print(f'    보스전 / boss    : {boss}   (규칙 guestStartsBoss)')
    onoff = lambda k: '켬 / on' if cfg[k] else '끔 / off'
    print(f'    PvP              : {onoff("pvp")}   (규칙 pvp)')
    print(f'    게스트 부활      : {onoff("guestRespawn")}   (규칙 guestRespawn - 쓰러져도 나가지 않고 화톳불로)')
    print(f'    보스전 관전      : {onoff("bossSpectate")}   (규칙 bossSpectate - 보스전에서 쓰러지면 관전)')
    print(f'    스펙 보정        : {onoff("statSync")}   (규칙 statSync - 게스트의 능력치를 호스트에 맞춤)')
    print(f'    함께 맵 이동     : {onoff("guestsFollow")}   (규칙 guestsFollow - 끄면 게스트는 맵을 따로 이동)')
    print(f'    보스 강화        : {onoff("bossScale")}   (규칙 bossScale - 참가 인원 1명당 보스 HP·MP·그로기 +0.6배)')
    print(f'    규칙과 접속 PIN은 {os.path.basename(CONFIG_PATH)}에서, 게임 중에는 호스트의 메뉴 → 협력에서 바꿉니다 (내보내기·차단도).')
    print(f'    Rules and the join PIN: {os.path.basename(CONFIG_PATH)}, or in game the host\'s menu -> Co-op (kick / ban too).')
    for ip in lan_addresses():
        print(f'    이 PC의 주소     : {ip}   (같은 공유기 안의 친구 / friends on the same router)')
    print('    인터넷의 친구에게는 공인 IP(공유기 관리 화면 등에서 확인)를 알려 주고, 공유기에서 이 포트를 이 PC로 열어 주세요.')
    print('    Windows 방화벽 창이 뜨면 "공용 네트워크"도 체크하고 허용을 누르세요 (개인 네트워크만 체크하면 밖에서 못 들어올 수 있음).')
    print('    공유기 관리 화면의 외부(WAN) IP가 공인 IP와 다르면 포트를 열어도 들어올 수 없는 회선입니다 - 외부 서버를 쓰세요.')
    print('    Over the internet: your public IP, this port forwarded to this PC, Python allowed through the firewall on public networks too.')
    print('    인터넷의 친구는 이 PC의 공인 IP로 접속합니다. 공유기에서 위 포트(TCP)를 이 PC로 열어 주세요.')
    print('    Friends over the internet use this PC\'s public IP - forward the port above (TCP) to this PC.')
    print('    끄려면 이 창을 닫으세요. / Close this window to stop.', flush=True)
    async with server:
        await server.serve_forever()


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
