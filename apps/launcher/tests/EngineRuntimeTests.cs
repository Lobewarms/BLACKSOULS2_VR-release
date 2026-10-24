using System;
using System.Collections;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;

internal static class EngineRuntimeTests
{
    private static int checks;
    private static void Check(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
        checks++; Console.WriteLine("PASS " + message);
    }

    private static void Archive(string filename, string entry, byte[] content)
    {
        byte[] name = Encoding.UTF8.GetBytes(entry);
        const uint seed = 17, key = seed * 9 + 3;
        uint fileKey = 0x12345678;
        using (var writer = new BinaryWriter(File.Create(filename)))
        {
            writer.Write(Encoding.ASCII.GetBytes("RGSSAD\0")); writer.Write((byte)3); writer.Write(seed);
            writer.Write((uint)(12 + 16 + name.Length + 4) ^ key);
            writer.Write((uint)content.Length ^ key); writer.Write(fileKey ^ key); writer.Write((uint)name.Length ^ key);
            for (int i = 0; i < name.Length; i++) writer.Write((byte)(name[i] ^ (byte)(key >> (8 * (i % 4)))));
            writer.Write(key);
            for (int i = 0; i < content.Length; i++)
            {
                writer.Write((byte)(content[i] ^ (byte)(fileKey >> (8 * (i % 4)))));
                if (i % 4 == 3) fileKey = unchecked(fileKey * 7 + 3);
            }
        }
    }

    [STAThread]
    private static int Main()
    {
        string temporary = Path.Combine(Path.GetTempPath(), "blacksouls-engine-test-" + Guid.NewGuid().ToString("N"));
        object server = null;
        try
        {
            string game = Path.Combine(temporary, "original"), app = Path.Combine(temporary, "app"), saves = Path.Combine(temporary, "saves");
            Directory.CreateDirectory(Path.Combine(game, "Data")); Directory.CreateDirectory(Path.Combine(game, "Graphics"));
            Directory.CreateDirectory(app);
            byte[] original = { 4, 8, 91, 0, 255 }, art = { 137, 80, 78, 71, 1, 2 }, archived = { 137, 80, 78, 71, 9, 8 };
            File.WriteAllBytes(Path.Combine(game, "Data", "System.rvdata2"), original);
            File.WriteAllBytes(Path.Combine(game, "Graphics", "тест.png"), art);
            File.WriteAllText(Path.Combine(app, "index.html"), "<title>BLACK SOULS synthetic test</title>", Encoding.UTF8);
            var assembly = Assembly.LoadFrom(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "BlacksoulsVR.Engine.exe"));
            Type options = assembly.GetType("BlacksoulsVR.Options", true);
            Check(options.GetMethod("Parse").Invoke(null, new object[] { new[] { "--lang", "ru" } }) != null, "Compiled engine retains the real Options.Parse hosting contract");
            Type lang = assembly.GetType("BlacksoulsVR.Lang", true);
            Check(((string[])lang.GetField("Codes").GetValue(null)).Contains("ru"), "Compiled native engine advertises Russian");
            Type filesType = assembly.GetType("BlacksoulsVR.GameFiles", true);
            object[] arguments = { game, null };
            object files = filesType.GetMethod("Open").Invoke(null, arguments);
            Check(files != null, "Compiled engine opens synthetic original loose data read-only");
            Check(((byte[])filesType.GetMethod("Read").Invoke(files, new object[] { "Graphics/тест.png" })).SequenceEqual(art), "Loose assets work when no original archive exists");
            Archive(Path.Combine(game, "Game.rgss3a"), "Graphics/тест.png", archived);
            files = filesType.GetMethod("Open").Invoke(null, arguments);
            Check(((byte[])filesType.GetMethod("Read").Invoke(files, new object[] { "Graphics/тест.png" })).SequenceEqual(archived), "The original archive takes priority over a same-name loose asset");
            var portProbe = new TcpListener(IPAddress.Loopback, 0); portProbe.Start();
            int port = ((IPEndPoint)portProbe.LocalEndpoint).Port; portProbe.Stop();
            Type serverType = assembly.GetType("BlacksoulsVR.GameServer", true);
            server = Activator.CreateInstance(serverType, new[] { files, null, saves, app, (object)port });
            serverType.GetMethod("Start").Invoke(server, null);
            using (var client = new WebClient { Proxy = null, Encoding = Encoding.UTF8 })
            {
                string url = "http://localhost:" + port + "/";
                Check(client.DownloadString(url + "api/ping").Contains("BlacksoulsVR"), "Source-built engine serves its live loopback API");
                Check(client.DownloadString(url).Contains("synthetic test"), "Source-built engine serves the supplied app entry");
                Check(client.DownloadData(url + "game/Data/System.rvdata2").SequenceEqual(original), "Game file response preserves original bytes");
                Check(client.DownloadData(url + "game/Graphics/" + Uri.EscapeDataString("тест.png")).SequenceEqual(archived), "Unicode asset paths preserve original archive bytes");
                Check(client.DownloadString(url + "api/manifest").Contains("System.rvdata2"), "Manifest exposes original data through the existing frontend contract");
                client.Headers[HttpRequestHeader.ContentType] = "application/json";
                client.UploadString(url + "api/settings", "{\"synthetic\":true}");
                Check(client.DownloadString(url + "api/settings") == "{\"synthetic\":true}", "Settings use the explicitly isolated test save folder");
                Check(File.Exists(Path.Combine(saves, "settings.json")) && Directory.GetFiles(game, "*", SearchOption.AllDirectories).Length == 3
                    && File.ReadAllBytes(Path.Combine(game, "Data", "System.rvdata2")).SequenceEqual(original)
                    && File.ReadAllBytes(Path.Combine(game, "Graphics", "тест.png")).SequenceEqual(art), "Backend writes no original game data");
            }
            Check(((IEnumerable)filesType.GetMethod("List").Invoke(files, null)).Cast<object>().Count() == 2, "Game manifest remains free of test save files");
            Console.WriteLine("Passed " + checks + " source-built engine checks."); return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        finally
        {
            if (server != null) server.GetType().GetMethod("Stop").Invoke(server, null);
            if (Directory.Exists(temporary)) Directory.Delete(temporary, true);
        }
    }
}
