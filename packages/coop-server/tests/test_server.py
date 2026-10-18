"""Exercise the real server parser using in-memory streams; never bind a public port."""
import asyncio
import hashlib
import struct
import unittest

from blacksouls_vr_coop import server


class Writer:
    def __init__(self):
        self.data = bytearray()

    def write(self, data):
        self.data.extend(data)

    async def drain(self):
        pass


def client_frame(payload, opcode=1, final=True):
    mask = b'abcd'
    n = len(payload)
    head = bytes([(0x80 if final else 0) | opcode])
    if n < 126:
        head += bytes([0x80 | n])
    elif n < 65536:
        head += b'\xfe' + struct.pack('>H', n)
    else:
        head += b'\xff' + struct.pack('>Q', n)
    return head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload))


class ProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def read(self, data, writer=None):
        reader = asyncio.StreamReader()
        reader.feed_data(data)
        reader.feed_eof()
        return await server.read_message(reader, writer or Writer())

    async def test_text_frames_and_extended_lengths(self):
        for text in ['hello', 'hello ' + '\u4e16\u754c', 'x' * 126, 'x' * 65536]:
            with self.subTest(length=len(text)):
                self.assertEqual(await self.read(client_frame(text.encode())), text)

    async def test_fragmented_text_with_interleaved_ping(self):
        writer = Writer()
        data = client_frame(b'hel', final=False) + client_frame(b'ping', opcode=9) + client_frame(b'lo', opcode=0)
        self.assertEqual(await self.read(data, writer), 'hello')
        self.assertEqual(writer.data, server.frame(10, b'ping'))

    async def test_rejects_unmasked_binary_invalid_utf8_and_oversized_frames(self):
        frames = [b'\x81\x01x', client_frame(b'x', opcode=2), client_frame(b'\xff'),
                  b'\x81\xff' + struct.pack('>Q', server.MAX_MESSAGE + 1)]
        for data in frames:
            with self.subTest(frame=data[:10]):
                with self.assertRaises(server.Closed):
                    await self.read(data)

    async def test_valid_websocket_handshake(self):
        reader = asyncio.StreamReader()
        reader.feed_data(b'GET /coop HTTP/1.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                         b'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n'
                         b'Origin: http://localhost:8080\r\n\r\n')
        writer = Writer()
        await server.handshake(reader, writer)
        self.assertIn(b'101 Switching Protocols', writer.data)
        self.assertIn(b's3pPLMBiTxaQ9kYGzzhZRbK+xOo=', writer.data)

    async def test_rejects_non_game_origin(self):
        reader = asyncio.StreamReader()
        reader.feed_data(b'GET /coop HTTP/1.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                         b'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n'
                         b'Origin: https://example.invalid\r\n\r\n')
        with self.assertRaises(server.Closed):
            await server.handshake(reader, Writer())


class IdentityTests(unittest.TestCase):
    def test_player_name_normalization_and_limits(self):
        self.assertEqual(server.clean_name('  Alice  <Bob> '), 'Alice Bob')
        self.assertEqual(len(server.clean_name('x' * 100)), server.NAME_LEN)
        self.assertEqual(server.clean_name(None), '')

    def test_player_tags_are_stable_and_reject_invalid_keys(self):
        key = 'abcdef0123456789'
        self.assertEqual(server.tag_of(key), hashlib.sha256(key.encode()).hexdigest()[:12])
        for invalid in [None, '', 'x' * 16, 'a' * 65]:
            self.assertEqual(server.tag_of(invalid), '')


if __name__ == '__main__':
    unittest.main()
