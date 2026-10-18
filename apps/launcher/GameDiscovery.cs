using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace BlacksoulsCommunity
{
    internal sealed class SearchRoot
    {
        public readonly string Path;
        public readonly int Depth;
        public SearchRoot(string path, int depth) { Path = path; Depth = depth; }
    }

    internal static class GameDiscovery
    {
        public static bool HasGameData(string path)
        {
            try
            {
                return File.Exists(System.IO.Path.Combine(path, "Game.exe")) &&
                    (File.Exists(System.IO.Path.Combine(path, "Data", "System.rvdata2")) ||
                     Directory.GetFiles(path, "*.rgss3a").Any(IsArchive));
            }
            catch (IOException) { return false; }
            catch (UnauthorizedAccessException) { return false; }
            catch (ArgumentException) { return false; }
        }

        private static bool IsArchive(string path)
        {
            using (var stream = File.OpenRead(path))
            {
                var header = new byte[8];
                return stream.Read(header, 0, 8) == 8 &&
                    Encoding.ASCII.GetString(header, 0, 7) == "RGSSAD\0" && header[7] == 3;
            }
        }

        public static bool LooksLikeBlacksouls2(string text)
        {
            string normalized = Regex.Replace((text ?? "").Normalize(NormalizationForm.FormKC).ToLowerInvariant(), @"[\s_\-\[\]()]", "");
            return Regex.IsMatch(normalized, @"blacksouls?(?:ii(?!i)|2(?![0-9]))") ||
                Regex.IsMatch(normalized, @"ブラックソウルズ?(?:ii(?!i)|2(?![0-9]))") ||
                Regex.IsMatch(normalized, @"블랙소울(?:ii(?!i)|2(?![0-9]))");
        }

        public static bool IsCandidate(string path)
        {
            if (!HasGameData(path)) return false;
            if (LooksLikeBlacksouls2(new DirectoryInfo(path).Name)) return true;
            string ini = System.IO.Path.Combine(path, "Game.ini");
            try
            {
                if (!File.Exists(ini) || new FileInfo(ini).Length > 65536) return false;
                return File.ReadAllLines(ini).Any(line =>
                    Regex.IsMatch(line, @"^\s*Title\s*=", RegexOptions.IgnoreCase) &&
                    LooksLikeBlacksouls2(line.Substring(line.IndexOf('=') + 1)));
            }
            catch (IOException) { return false; }
            catch (UnauthorizedAccessException) { return false; }
        }

        public static string Remembered(string appDirectory)
        {
            foreach (string directory in new[] { appDirectory, System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BlacksoulsVR") })
            {
                try
                {
                    string config = System.IO.Path.Combine(directory, "launcher.json");
                    if (!File.Exists(config) || new FileInfo(config).Length > 1048576) continue;
                    var values = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(config));
                    object value;
                    if (values != null && values.TryGetValue("gameDir", out value) && value is string && HasGameData((string)value))
                        return System.IO.Path.GetFullPath((string)value);
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
                catch (ArgumentException) { }
                catch (InvalidOperationException) { }
            }
            return null;
        }

        public static List<string> Scan(IEnumerable<SearchRoot> roots, CancellationToken cancel,
            Action<int> progress, int maxDirectories = 12000, int maxMilliseconds = 8000)
        {
            var found = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var visited = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            var queue = new Queue<SearchRoot>(roots);
            var clock = Stopwatch.StartNew();
            int count = 0;
            while (queue.Count > 0 && count < maxDirectories && clock.ElapsedMilliseconds < maxMilliseconds)
            {
                if (cancel.IsCancellationRequested) break;
                var item = queue.Dequeue();
                try
                {
                    string path = System.IO.Path.GetFullPath(item.Path);
                    int previousDepth;
                    if (visited.TryGetValue(path, out previousDepth) && previousDepth >= item.Depth) continue;
                    visited[path] = item.Depth;
                    if (!Directory.Exists(path) || (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) continue;
                    count++;
                    if (count % 100 == 0 && progress != null) progress(count);
                    if (IsCandidate(path)) { found.Add(path); continue; }
                    if (item.Depth <= 0) continue;
                    foreach (string child in Directory.GetDirectories(path))
                    {
                        string name = System.IO.Path.GetFileName(child);
                        if (name.StartsWith(".") || new[] { "Windows", "node_modules", "$Recycle.Bin", "System Volume Information", "AppData" }
                            .Contains(name, StringComparer.OrdinalIgnoreCase)) continue;
                        queue.Enqueue(new SearchRoot(child, item.Depth - 1));
                    }
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
                catch (ArgumentException) { }
                catch (System.Security.SecurityException) { }
            }
            return found.OrderBy(path => path, StringComparer.OrdinalIgnoreCase).ToList();
        }

        public static IEnumerable<string> SteamLibraries(string steamDirectory)
        {
            var paths = new List<string> { System.IO.Path.Combine(steamDirectory, "steamapps", "common") };
            try
            {
                string file = System.IO.Path.Combine(steamDirectory, "steamapps", "libraryfolders.vdf");
                if (File.Exists(file) && new FileInfo(file).Length < 1048576)
                    foreach (Match match in Regex.Matches(File.ReadAllText(file), "\"(?:path|[0-9]+)\"\\s+\"([^\"]+)\""))
                    {
                        string library = match.Groups[1].Value.Replace("\\\\", "\\");
                        if (System.IO.Path.IsPathRooted(library)) paths.Add(System.IO.Path.Combine(library, "steamapps", "common"));
                    }
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            return paths.Distinct(StringComparer.OrdinalIgnoreCase);
        }

        public static IEnumerable<SearchRoot> DefaultRoots(string appDirectory)
        {
            var roots = new List<SearchRoot>();
            string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            foreach (string path in new[] { System.IO.Path.Combine(home, "Downloads"),
                Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), System.IO.Path.Combine(home, "Games"),
                appDirectory, Directory.GetParent(appDirectory).FullName })
                if (!String.IsNullOrWhiteSpace(path)) roots.Add(new SearchRoot(path, 3));
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders"))
                {
                    var downloads = key == null ? null : key.GetValue("{374DE290-123F-4565-9164-39C4925E467B}") as string;
                    if (!String.IsNullOrEmpty(downloads)) roots.Add(new SearchRoot(Environment.ExpandEnvironmentVariables(downloads), 3));
                }
            }
            catch (System.Security.SecurityException) { }
            var steamDirectories = new List<string> {
                System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Steam") };
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam"))
                {
                    var steam = key == null ? null : key.GetValue("SteamPath") as string;
                    if (!String.IsNullOrEmpty(steam)) steamDirectories.Add(steam);
                }
            }
            catch (System.Security.SecurityException) { }
            foreach (string steam in steamDirectories)
                roots.AddRange(SteamLibraries(steam).Select(path => new SearchRoot(path, 2)));
            foreach (var drive in DriveInfo.GetDrives())
            {
                try
                {
                    if (drive.DriveType != DriveType.Fixed || !drive.IsReady) continue;
                    string root = drive.RootDirectory.FullName;
                    roots.Add(new SearchRoot(root, 1));
                    foreach (string suffix in new[] { "Games", "SteamLibrary/steamapps/common", "Steam/steamapps/common", "DLsite" })
                        roots.Add(new SearchRoot(System.IO.Path.Combine(root, suffix.Replace('/', System.IO.Path.DirectorySeparatorChar)), 3));
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
            return roots;
        }
    }
}
