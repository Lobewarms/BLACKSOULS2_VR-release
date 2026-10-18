using System;
using System.Collections.Generic;
using System.IO;
using System.Diagnostics;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using BlacksoulsCommunity;

internal static class SteamAchievementHostTests
{
    private static int checks;
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); checks++; Console.WriteLine("PASS " + message); }
    private sealed class FakeSteam : ISteamAchievementConnection
    {
        internal int Requests;
        internal bool Closed;
        internal string[] Names;
        internal string State = "ready";
        public object Request(string command, string[] names) {
            Requests++; Names = names;
            return new Dictionary<string, object> { { "state", State }, { command == "status" ? "achievements" : "unlocked", command == "status" ? new[] { "Exact Case", "【　　】" } : names } };
        }
        public void Dispose() { Closed = true; }
    }
    private sealed class WaitingSteam : ISteamAchievementConnection
    {
        internal readonly ManualResetEvent Entered = new ManualResetEvent(false), Finish = new ManualResetEvent(false);
        internal volatile bool Closed;
        public object Request(string command, string[] names) { Entered.Set(); Finish.WaitOne(3000); return new { state = "ready", achievements = new string[0] }; }
        public void Dispose() { Closed = true; }
    }
    private static string Send(SteamAchievementHost host, string method, string path, string origin, string token, string body, string hostHeader = null, string extra = "")
    {
        using (var client = new TcpClient("127.0.0.1", host.Port)) {
            client.ReceiveTimeout = 4000;
            var stream = client.GetStream();
            byte[] bytes = Encoding.UTF8.GetBytes(body ?? "");
            string header = method + " " + path + " HTTP/1.1\r\nHost: " + (hostHeader ?? "127.0.0.1:" + host.Port) + "\r\n";
            if (origin != null) header += "Origin: " + origin + "\r\n";
            if (token != null) header += "X-BS-Steam-Token: " + token + "\r\n";
            header += "Content-Length: " + bytes.Length + "\r\n" + extra + "\r\n";
            byte[] head = Encoding.ASCII.GetBytes(header);
            stream.Write(head, 0, head.Length); stream.Write(bytes, 0, bytes.Length);
            // Respect HTTP message framing; a rejection may leave request bytes
            // unread, so waiting for EOF can observe the peer's reset afterwards.
            var responseHeader = new StringBuilder();
            while (!responseHeader.ToString().EndsWith("\r\n\r\n")) {
                int value = stream.ReadByte(); if (value < 0) throw new EndOfStreamException();
                responseHeader.Append((char)value);
            }
            string response = responseHeader.ToString(); int responseLength = 0;
            foreach (string line in response.Split(new[] { "\r\n" }, StringSplitOptions.None))
                if (line.StartsWith("Content-Length: ")) responseLength = Int32.Parse(line.Substring(16));
            var payload = new byte[responseLength]; int received = 0;
            while (received < payload.Length) { int n = stream.Read(payload, received, payload.Length - received); if (n == 0) throw new EndOfStreamException(); received += n; }
            return response + Encoding.UTF8.GetString(payload);
        }
    }
    private static int Main()
    {
        string directory = Path.Combine(Path.GetTempPath(), "blacksouls-steam-host-" + Guid.NewGuid().ToString("N"));
        try {
            var workers = new List<FakeSteam>();
            string selected = null; int reports = 0;
            string config = Path.Combine(directory, "app", "steam-session.json");
            using (var host = new SteamAchievementHost(directory, "game-one", 8150, game => {
                selected = game; var worker = new FakeSteam(); workers.Add(worker); return worker;
            }, state => { reports++; })) {
                var metadata = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(config));
                Check((string)metadata["token"] == host.Token && host.Token.Length == 64 && (string)metadata["endpoint"] == "http://127.0.0.1:" + host.Port + "/", "Fresh per-launch secret and loopback endpoint are discoverable by the game");
                Check(workers.Count == 0, "Opening the launcher never initializes Steam or awards anything");
                string origin = "http://localhost:8150";
                foreach (string denied in new[] { "https://example.com", "null", "http://localhost:5204", "http://127.0.0.1:8150.evil.example", "http://localhost:8150/", null })
                    Check(Send(host, "GET", "/status", denied, host.Token, null).StartsWith("HTTP/1.1 403"), "Reject non-game origin " + denied);
                Check(Send(host, "GET", "/status", origin, null, null).StartsWith("HTTP/1.1 403") && workers.Count == 0, "Requests without a session secret cannot initialize or access Steam");
                Check(Send(host, "GET", "/status", origin, host.Token, null, "evil.example:" + host.Port).StartsWith("HTTP/1.1 403"), "Reject DNS rebinding hosts even with a matching origin");
                string preflight = Send(host, "OPTIONS", "/unlock", origin, null, null);
                Check(preflight.StartsWith("HTTP/1.1 204") && preflight.Contains("Access-Control-Allow-Origin: " + origin) && workers.Count == 0, "Browser preflight authorizes only the selected local game origin without touching Steam");
                string status = Send(host, "GET", "/status", origin, host.Token, null);
                Check(status.StartsWith("HTTP/1.1 200") && status.Contains("Exact Case") && status.Contains("【　　】") && selected == "game-one", "Authenticated status preserves UTF8 IDs and selects the launcher's game");
                string result = Send(host, "POST", "/unlock", origin, host.Token, "{\"names\":[\"Exact Case\",\"【　　】\",\"Exact Case\"]}");
                Check(result.StartsWith("HTTP/1.1 200") && workers[0].Names.Length == 2 && workers[0].Names[1] == "【　　】", "Only requested exact names reach the worker, with duplicates removed and Unicode intact");
                Check(reports == 1, "Stable ready status is logged once");
                int before = workers[0].Requests;
                foreach (string body in new[] { "{\"names\":\"all\"}", "{\"names\":[1]}", "{\"names\":[\"\"]}", "{\"names\":[\"x\"],\"reset\":true}" })
                    Check(Send(host, "POST", "/unlock", origin, host.Token, body).StartsWith("HTTP/1.1 400"), "Reject malformed or expanded mutation request " + body);
                Check(Send(host, "POST", "/reset", origin, host.Token, "{}").StartsWith("HTTP/1.1 404") && workers[0].Requests == before, "No reset, clear or arbitrary Steam command is exposed");
                Check(Send(host, "POST", "/unlock", origin, host.Token, "{}", null, "Transfer-Encoding: chunked\r\n").StartsWith("HTTP/1.1 403"), "Reject ambiguous transfer framing before dispatching mutations");
                host.Configure("game-two", 8250);
                Check(Send(host, "GET", "/status", origin, host.Token, null).StartsWith("HTTP/1.1 403"), "Changing game port invalidates the old origin");
                Check(Send(host, "GET", "/status", "http://127.0.0.1:8250", host.Token, null).StartsWith("HTTP/1.1 200") && workers[0].Closed && selected == "game-two", "Changing selected game closes the old worker before starting a new one");
            }
            Check(workers[workers.Count - 1].Closed && !File.Exists(config), "Launcher disposal closes Steam and removes its session secret");
            var offline = new FakeSteam { State = "unavailable" }; int attempts = 0;
            using (var host = new SteamAchievementHost(directory, "game", 8150, game => ++attempts == 1 ? offline : new FakeSteam(), null)) {
                Check(Send(host, "GET", "/status", "http://localhost:8150", host.Token, null).Contains("unavailable") && offline.Closed,
                    "An unavailable or signed-out worker is discarded instead of caching a broken Steam context");
                Check(Send(host, "GET", "/status", "http://localhost:8150", host.Token, null).Contains("Exact Case") && attempts == 2,
                    "The next attempt can reconnect after Steam starts without restarting the launcher");
            }
            var waiting = new WaitingSteam();
            using (var host = new SteamAchievementHost(directory, "game", 8150, game => waiting, null)) {
                var inFlight = Task.Run(() => Send(host, "GET", "/status", "http://localhost:8150", host.Token, null));
                Check(waiting.Entered.WaitOne(3000), "A native acknowledgement can be in progress during launcher close");
                var closeTime = Stopwatch.StartNew(); host.Dispose();
                Check(closeTime.ElapsedMilliseconds < 500 && !File.Exists(config), "Closing removes credentials immediately without waiting for a native callback");
                waiting.Finish.Set();
                Check(inFlight.Wait(3000) && SpinWait.SpinUntil(() => waiting.Closed, 3000), "The bounded in-flight request completes and its native worker is released");
            }
            using (var first = new SteamAchievementHost(directory, "game", 8150, game => new FakeSteam(), null)) {
                using (var second = new SteamAchievementHost(directory, "game", 8151, game => new FakeSteam(), null)) {
                    Check(first.Token != second.Token, "Separate launcher sessions never share credentials");
                    first.Dispose();
                    Check(File.Exists(config) && File.ReadAllText(config).Contains(second.Token), "An old launcher cannot delete another launcher's session metadata");
                }
            }
            Console.WriteLine("Passed " + checks + " Steam bridge checks."); return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        finally {
            string temporary = Path.GetFullPath(Path.GetTempPath());
            string target = Path.GetFullPath(directory);
            if (target.StartsWith(temporary, StringComparison.OrdinalIgnoreCase) && Directory.Exists(target)) Directory.Delete(target, true);
        }
    }
}
