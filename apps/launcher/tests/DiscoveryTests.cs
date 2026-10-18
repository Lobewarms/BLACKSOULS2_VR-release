using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Web.Script.Serialization;
using BlacksoulsCommunity;

internal static class DiscoveryTests
{
    private static int assertions;
    private static void Check(bool value, string message)
    {
        assertions++;
        if (!value) throw new Exception(message);
    }

    private static string Game(string root, string name)
    {
        string path = Path.Combine(root, name);
        Directory.CreateDirectory(Path.Combine(path, "Data"));
        File.WriteAllText(Path.Combine(path, "Game.exe"), "synthetic fixture; never executed");
        File.WriteAllText(Path.Combine(path, "Data", "System.rvdata2"), "synthetic fixture");
        return path;
    }

    public static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--echo")
        {
            Console.OutputEncoding = new System.Text.UTF8Encoding(false);
            Console.Write(new JavaScriptSerializer().Serialize(args.Skip(1).ToArray()));
            return 0;
        }
        string root = Path.Combine(Path.GetTempPath(), "blacksouls-discovery-test-" + Guid.NewGuid());
        Directory.CreateDirectory(root);
        try
        {
            string first = Game(root, "BLACK SOULS II v1.3");
            string other = Game(root, "Other RPG");
            Check(GameDiscovery.IsCandidate(first), "Recognize named game");
            Check(!GameDiscovery.IsCandidate(other), "Reject unrelated RPG Maker game");
            string byTitle = Game(Path.Combine(root, "Downloads"), "RJ999999");
            File.WriteAllText(Path.Combine(byTitle, "Game.ini"), "[Game]\nTitle=BLACK SOULS 2\n");
            Check(GameDiscovery.IsCandidate(byTitle), "Recognize product-code folder by game title");
            foreach (string name in new[] { "BLACKSOULS2_v1.3", "BLACK SOULS Ⅱ", "ブラックソウルⅡ" })
                Check(GameDiscovery.LooksLikeBlacksouls2(name), "Recognize sequel spelling: " + name);
            foreach (string name in new[] { "BLACK SOULS", "BLACK SOULS III", "BLACKSOULS20", "DARK SOULS II" })
                Check(!GameDiscovery.LooksLikeBlacksouls2(name), "Reject other title: " + name);
            var results = GameDiscovery.Scan(new[] { new SearchRoot(root, 3), new SearchRoot(root, 3) }, CancellationToken.None, null);
            Check(results.Count == 2 && results.Contains(first) && results.Contains(byTitle), "Deduplicate roots and find multiple copies");
            Check(GameDiscovery.Scan(new[] { new SearchRoot(root, 0) }, CancellationToken.None, null).Count == 0, "Honor depth limit");
            Check(GameDiscovery.Scan(new[] { new SearchRoot(root, 3) }, new CancellationToken(true), null).Count == 0, "Honor cancellation");
            Check(GameDiscovery.Scan(new[] { new SearchRoot(root, 3) }, CancellationToken.None, null, 0).Count == 0, "Honor directory limit");
            string broken = Game(root, "BLACKSOULS2 broken");
            File.Delete(Path.Combine(broken, "Data", "System.rvdata2"));
            File.WriteAllBytes(Path.Combine(broken, "Game.rgss3a"), new byte[] { 0, 1 });
            Check(!GameDiscovery.IsCandidate(broken), "Reject corrupt archive header");
            File.WriteAllBytes(Path.Combine(broken, "Game.rgss3a"), new byte[] { 82, 71, 83, 83, 65, 68, 0, 3 });
            Check(GameDiscovery.IsCandidate(broken), "Recognize packed game");
            string config = Path.Combine(root, "launcher.json");
            string json = new JavaScriptSerializer().Serialize(new { gameDir = other, browser = "edge", autoVr = false });
            File.WriteAllText(config, json);
            Check(GameDiscovery.Remembered(root) == other, "Honor previously selected game regardless of translated folder name");
            Check(File.ReadAllText(config) == json, "Never overwrite launcher settings during discovery");
            string steam = Path.Combine(root, "Steam");
            string library = Path.Combine(root, "Another Library");
            Directory.CreateDirectory(Path.Combine(steam, "steamapps"));
            File.WriteAllText(Path.Combine(steam, "steamapps", "libraryfolders.vdf"), "\"libraryfolders\" { \"1\" { \"path\" \"" + library.Replace("\\", "\\\\") + "\" } }");
            Check(GameDiscovery.SteamLibraries(steam).Contains(Path.Combine(library, "steamapps", "common")), "Read additional Steam libraries");
            string[] values = { "C:\\Games\\BLACK SOULS II", "C:\\", "embedded\"quote", "", "slashes\\\\\"quoted", "日本語のフォルダ" };
            var process = Process.Start(new ProcessStartInfo {
                FileName = typeof(DiscoveryTests).Assembly.Location,
                Arguments = "--echo " + String.Join(" ", values.Select(Program.Quote)),
                UseShellExecute = false, RedirectStandardOutput = true, CreateNoWindow = true,
                StandardOutputEncoding = System.Text.Encoding.UTF8
            });
            string output = process.StandardOutput.ReadToEnd();
            process.WaitForExit();
            string[] roundTrip = new JavaScriptSerializer().Deserialize<string[]>(output);
            Check(values.SequenceEqual(roundTrip), "Round-trip Windows command-line quoting");
            Console.WriteLine("Passed " + assertions + " discovery and command-line checks.");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        finally { Directory.Delete(root, true); }
    }
}
