using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace BlacksoulsCommunity
{
    // Some installations put a short RTP IconSet beside the complete archived one.
    // Cache only the missing archive sheet in the mod's own folder; never edit the game.
    internal static class GameAssetCache
    {
        private const int MaxIconBytes = 8 * 1024 * 1024;

        private static byte[] ReadIcons(string archive)
        {
            using (var stream = File.OpenRead(archive))
            using (var reader = new BinaryReader(stream))
            {
                if (Encoding.ASCII.GetString(reader.ReadBytes(8)) != "RGSSAD\0\x03") return null;
                uint key = unchecked(reader.ReadUInt32() * 9 + 3);
                for (int entry = 0; entry < 200000 && stream.Position + 16 <= stream.Length; entry++)
                {
                    uint offset = reader.ReadUInt32() ^ key;
                    if (offset == 0) return null;
                    uint size = reader.ReadUInt32() ^ key, fileKey = reader.ReadUInt32() ^ key;
                    uint length = reader.ReadUInt32() ^ key;
                    if (length > 4096 || stream.Position + length > stream.Length) return null;
                    byte[] name = reader.ReadBytes((int)length);
                    for (int i = 0; i < name.Length; i++) name[i] ^= (byte)(key >> (8 * (i % 4)));
                    if (!String.Equals(Encoding.UTF8.GetString(name).Replace('\\', '/'), "Graphics/System/IconSet.png", StringComparison.OrdinalIgnoreCase)) continue;
                    if (size == 0 || size > MaxIconBytes || (long)offset + size > stream.Length) return null;
                    stream.Position = offset;
                    byte[] bytes = reader.ReadBytes((int)size);
                    if (bytes.Length != size) return null;
                    for (int start = 0; start < bytes.Length; start += 4)
                    {
                        for (int i = 0; i < 4 && start + i < bytes.Length; i++) bytes[start + i] ^= (byte)(fileKey >> (8 * i));
                        fileKey = unchecked(fileKey * 7 + 3);
                    }
                    return bytes;
                }
                return null;
            }
        }

        private static void WriteAtomic(string path, byte[] bytes)
        {
            string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllBytes(temporary, bytes);
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }

        public static bool Prepare(string gameDirectory, string appDirectory)
        {
            try
            {
                string cache = Path.Combine(appDirectory, "app", "local-assets");
                Directory.CreateDirectory(cache);
                string manifest = Path.Combine(cache, "icons.json");
                string game = Path.GetFullPath(gameDirectory);
                // Invalidate the previous game's sheet even if this game needs no fallback.
                var info = new Dictionary<string, object> { { "game", game }, { "iconSet", null } };
                WriteAtomic(manifest, Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(info)));
                string loose = Path.Combine(game, "Graphics", "System", "IconSet.png");
                string archive = Path.Combine(game, "Game.rgss3a");
                if (!File.Exists(loose) || !File.Exists(archive)) return false;
                int width, height;
                using (var image = Image.FromFile(loose)) { width = image.Width; height = image.Height; }
                byte[] icons = ReadIcons(archive);
                if (icons == null) return false;
                using (var memory = new MemoryStream(icons))
                using (var image = Image.FromStream(memory))
                    if (image.Width != width || width != 384 || image.Height / 24 <= height / 24) return false;
                string digest;
                using (var hash = SHA256.Create()) digest = BitConverter.ToString(hash.ComputeHash(icons)).Replace("-", "").ToLowerInvariant();
                WriteAtomic(Path.Combine(cache, "IconSet.png"), icons);
                info["iconSet"] = "/local-assets/IconSet.png?revision=" + digest;
                WriteAtomic(manifest, Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(info)));
                return true;
            }
            catch (IOException) { return false; }
            catch (UnauthorizedAccessException) { return false; }
            catch (ArgumentException) { return false; }
            catch (OutOfMemoryException) { return false; } // GDI+ uses this for invalid image data.
            catch (System.Runtime.InteropServices.ExternalException) { return false; }
        }
    }
}
