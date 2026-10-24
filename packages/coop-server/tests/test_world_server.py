"""Community protocol tests use only synthetic worlds and private loopback sockets."""
import asyncio
import base64
import hashlib
import hmac
import json
import struct
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from blacksouls_vr_coop import server, world_server as world


def config():
    return {'pin': '123456', 'adminPin': '123456789012', 'adminSalt': '01' * 16,
            'maxPlayers': 16, 'bans': [], **{key: key in world.RULE_ON for key in world.RULE_FLAGS}}


def player(pid, map_id=1, admin=False):
    p = SimpleNamespace(id=pid, map=map_id, arr=1, admin=admin, nonce='challenge-' + pid,
                        name=pid, tag='abcdef012345', address='127.0.0.1', messages=[], wf=[], wf_warned=False, fp='a' * 32)
    p.send = p.messages.append
    return p


class WorldTests(unittest.TestCase):
    def setUp(self):
        self.log = patch.object(world, 'say').start()
        self.addCleanup(patch.stopall)

    def test_snapshot_filters_private_and_malformed_data_and_oversized_seed_is_atomic(self):
        w = world.World(None)
        w.take({'sw': [1, 20, True, -1], 'vars': [[1, '日本語'], [2, float('nan')], [False, 5]],
                'self': ['1,2,A', '../bad'], 'seeded': True})
        self.assertEqual(w.snapshot(), {'sw': [1], 'vars': [[1, '日本語']], 'self': ['1,2,A']})
        previous = w.snapshot()
        for bad in [{'sw': None}, {'vars': {}}, {'self': [0] * (world.MAX_WORLD + 1)}]:
            with self.assertRaises(ValueError):
                w.take(bad)
            self.assertEqual(w.snapshot(), previous)

    def test_world_roundtrip_and_backups_are_confined_to_selected_temporary_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            w = world.World(directory)
            w.take({'sw': [8], 'vars': [[2, 17]], 'self': ['1,2,B'], 'seeded': True, 'fp': 'a' * 32})
            w.write()
            loaded = world.World(directory)
            self.assertTrue(loaded.load())
            self.assertEqual(loaded.snapshot(), w.snapshot())
            backup = w.backup('test')
            self.assertTrue(Path(backup).is_relative_to(Path(directory)))
            self.assertEqual(json.loads(Path(backup).read_text())['fp'], 'a' * 32)

    def test_admin_proof_is_bound_to_session_and_only_admin_changes_shared_loot_rule(self):
        hub = world.Hub(config(), world.World(None), save=False)
        hub.broadcast = lambda obj, but=None: None
        p = player('first')
        hub.set_rules(p, {'shareLoot': True})
        self.assertFalse(hub.cfg['shareLoot'])
        proof = hmac.new(hub.admin_key, (p.nonce + '|admin').encode(), hashlib.sha256).hexdigest()
        hub.admin(p, {'proof': proof})
        self.assertTrue(p.admin)
        hub.set_rules(p, {'shareLoot': True})
        self.assertTrue(hub.cfg['shareLoot'])
        other = player('second')
        hub.admin(other, {'proof': proof})
        self.assertFalse(other.admin)

    def test_leadership_stays_stable_and_moving_releases_only_the_departing_players_locks(self):
        hub = world.Hub(config(), world.World(None), save=False)
        hub.broadcast = lambda obj, but=None: None
        a, b = player('a'), player('b')
        hub.players = {'a': a, 'b': b}
        hub.update_leads()
        self.assertEqual(hub.leads, {1: 'a'})
        hub.lock(a, '1,3')
        hub.lock(b, '1,3')
        self.assertEqual(hub.locks['1,3'][0], 'a')
        hub.moved(a, 2)
        self.assertNotIn('1,3', hub.locks)
        self.assertEqual(hub.leads, {2: 'a', 1: 'b'})

    def test_next_cycle_needs_a_majority_and_cannot_be_triggered_by_duplicate_ballots(self):
        hub = world.Hub(config(), world.World(None), save=False)
        hub.broadcast = lambda obj, but=None: None
        a, b, c = [player(x) for x in 'abc']
        a.tag, b.tag, c.tag = 'a', 'b', 'c'
        hub.players = {p.id: p for p in (a, b, c)}
        hub.call_vote(a, {'k': 'cycle', 'c': 2})
        vid = hub.vote['id']
        hub.ballot(a, {'id': vid, 'yes': 1})
        self.assertEqual(hub.world.cycle, 0)
        hub.ballot(b, {'id': vid, 'yes': 1})
        self.assertEqual(hub.world.cycle, 3)
        self.assertIsNone(hub.vote)


def client_frame(obj):
    data = json.dumps(obj, ensure_ascii=False).encode()
    mask = b'abcd'
    head = b'\x81' + (bytes([0x80 | len(data)]) if len(data) < 126 else b'\xfe' + struct.pack('>H', len(data)))
    return head + mask + bytes(c ^ mask[i % 4] for i, c in enumerate(data))


async def read_frame(reader):
    head = await asyncio.wait_for(reader.readexactly(2), 2)
    length = head[1] & 127
    if length == 126:
        length = struct.unpack('>H', await reader.readexactly(2))[0]
    elif length == 127:
        length = struct.unpack('>Q', await reader.readexactly(8))[0]
    data = await reader.readexactly(length)
    return json.loads(data) if head[0] & 15 == 1 else None


class WorldWireTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.log = patch.object(world, 'say').start()
        self.addCleanup(patch.stopall)
        self.hub = world.Hub(config(), world.World(None), save=False)
        self.socket = await asyncio.start_server(self.hub.serve, '127.0.0.1', 0)
        self.port = self.socket.sockets[0].getsockname()[1]
        self.writers = []

    async def asyncTearDown(self):
        for writer in self.writers:
            writer.close()
            await writer.wait_closed()
        self.socket.close()
        await self.socket.wait_closed()

    async def connect(self, name, map_id=1):
        reader, writer = await asyncio.open_connection('127.0.0.1', self.port)
        self.writers.append(writer)
        key = base64.b64encode(b'0123456789abcdef').decode()
        writer.write(f'GET /coop HTTP/1.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: {key}\r\nOrigin: http://localhost:8150\r\n\r\n'.encode())
        await reader.readuntil(b'\r\n\r\n')
        challenge = await read_frame(reader)
        if challenge['t'] == 'deny':
            return reader, writer, challenge
        proof = hmac.new(b'123456', challenge['nonce'].encode(), hashlib.sha256).hexdigest()
        writer.write(client_frame({'t': 'auth', 'role': 'world', 'proof': proof, 'wv': world.WORLD_VERSION,
                                   'name': name, 'key': '0123456789abcdef', 'fp': 'a' * 32}))
        ready = await read_frame(reader)
        self.assertEqual(ready['t'], 'ready')
        writer.write(client_frame({'t': 'at', 'm': map_id}))
        return reader, writer, ready

    async def message(self, reader):
        for _ in range(20):
            message = await read_frame(reader)
            if message and message.get('t') == 'msg':
                return message
        self.fail('message was not delivered')

    async def test_real_community_transport_scopes_voice_to_map_but_chat_reaches_everyone(self):
        a, aw, aid = await self.connect('Alice', 1)
        b, _bw, _bid = await self.connect('Bob', 2)
        c, _cw, _cid = await self.connect('Cara', 1)
        for _ in range(50):
            if sorted(p.map for p in self.hub.players.values()) == [1, 1, 2]:
                break
            await asyncio.sleep(0.005)
        aw.write(client_frame({'t': 'msg', 'm': 1, 'data': json.dumps({'t': 'vo', 'd': 'synthetic'})}))
        voice = await self.message(c)
        self.assertEqual(voice['from'], aid['id'])
        aw.write(client_frame({'t': 'msg', 'data': json.dumps({'t': 'ch', 's': 'Привет 世界'})}))
        remote = await self.message(b)
        self.assertEqual(json.loads(remote['data'])['t'], 'ch', 'other maps must not receive the earlier voice packet')
        self.assertEqual(json.loads((await self.message(c))['data'])['s'], 'Привет 世界')

    async def test_a_temporarily_blocked_address_gets_explicit_deny_after_valid_handshake(self):
        self.hub.banned['127.0.0.1'] = time.monotonic() + 10
        _r, _w, response = await self.connect('Blocked')
        self.assertEqual(response, {'t': 'deny', 'why': 'blocked'})
