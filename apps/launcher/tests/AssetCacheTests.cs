using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using BlacksoulsCommunity;

internal static class AssetCacheTests
{
    private static byte[] Png(int height)
    {
        using (var image = new Bitmap(384, height))
        using (var graphics = Graphics.FromImage(image))
        using (var stream = new MemoryStream())
        {
            graphics.Clear(Color.CornflowerBlue);
            image.Save(stream, ImageFormat.Png);
            return stream.ToArray();
        }
    }

    private static void Archive(string file, byte[] content, uint? claimedSize = null)
    {
        byte[] name = Encoding.UTF8.GetBytes("Graphics\\System\\IconSet.png");
        const uint seed = 17, key = seed * 9 + 3;
        uint fileKey = 0x12345678;
        using (var writer = new BinaryWriter(File.Create(file)))
        {
            writer.Write(Encoding.ASCII.GetBytes("RGSSAD\0")); writer.Write((byte)3); writer.Write(seed);
            writer.Write((uint)(12 + 16 + name.Length + 4) ^ key);
            writer.Write((claimedSize ?? (uint)content.Length) ^ key); writer.Write(fileKey ^ key);
            writer.Write((uint)name.Length ^ key);
            for (int i = 0; i < name.Length; i++) writer.Write((byte)(name[i] ^ (byte)(key >> (8 * (i % 4)))));
            writer.Write(key); // terminal zero offset, encrypted
            for (int i = 0; i < content.Length; i++)
            {
                writer.Write((byte)(content[i] ^ (byte)(fileKey >> (8 * (i % 4)))));
                if (i % 4 == 3) fileKey = unchecked(fileKey * 7 + 3);
            }
        }
    }

    public static void Run(string root, Action<bool, string> check)
    {
        string game = Path.Combine(root, "Game With Short Icons"), mod = Path.Combine(root, "Mod Cache");
        string directory = Path.Combine(game, "Graphics", "System");
        Directory.CreateDirectory(directory);
        byte[] small = Png(936), full = Png(1296);
        string loose = Path.Combine(directory, "IconSet.png"), archive = Path.Combine(game, "Game.rgss3a");
        File.WriteAllBytes(loose, small); Archive(archive, full);
        check(GameAssetCache.Prepare(game, mod), "Recover archived icons shadowed by a short loose sheet");
        string cache = Path.Combine(mod, "app", "local-assets");
        check(File.ReadAllBytes(Path.Combine(cache, "IconSet.png")).SequenceEqual(full), "Cached icons exactly match archive artwork");
        check(File.ReadAllBytes(loose).SequenceEqual(small), "Original game graphics remain unchanged");
        var serializer = new JavaScriptSerializer();
        var info = serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(cache, "icons.json")));
        check((string)info["game"] == Path.GetFullPath(game) && ((string)info["iconSet"]).StartsWith("/local-assets/IconSet.png?revision="), "Bind cached icons to the selected game");
        string other = Path.Combine(root, "Other Game"); Directory.CreateDirectory(other);
        check(!GameAssetCache.Prepare(other, mod), "No archive means no fallback");
        info = serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(cache, "icons.json")));
        check(info["iconSet"] == null && (string)info["game"] == Path.GetFullPath(other), "Switching games invalidates old artwork");
        File.WriteAllBytes(loose, full);
        check(!GameAssetCache.Prepare(game, mod), "Keep a complete loose icon sheet");
        File.WriteAllBytes(loose, small); Archive(archive, full, UInt32.MaxValue);
        check(!GameAssetCache.Prepare(game, mod), "Reject oversized archive entries without allocating them");
        File.WriteAllBytes(archive, new byte[] { 0, 1 });
        check(!GameAssetCache.Prepare(game, mod), "Truncated archives do not prevent launcher startup");
    }
}
