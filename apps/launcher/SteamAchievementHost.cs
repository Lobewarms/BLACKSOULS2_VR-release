using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace BlacksoulsCommunity
{
    internal interface ISteamAchievementConnection : IDisposable
    {
        object Request(string command, string[] names);
    }

    // The upstream server has no extension API. A per-launch loopback endpoint
    // connects its browser to a separate x86 process using the player's own DLL.
    internal sealed class SteamAchievementHost : IDisposable
    {
        private readonly TcpListener listener;
        private readonly string configPath, configText;
        private readonly string token;
        private readonly Func<string, ISteamAchievementConnection> connect;
        private readonly object gate = new object();
        private readonly SemaphoreSlim requests = new SemaphoreSlim(4);
        private readonly Action<string> report;
        private ISteamAchievementConnection worker;
        private string workerGame, lastState;
        private volatile string game;
        private volatile int gamePort;
        private volatile bool stopped;
        internal int Port { get; private set; }
        internal string Token { get { return token; } }

        internal SteamAchievementHost(string appDirectory, string selectedGame, int port,
            Func<string, ISteamAchievementConnection> factory, Action<string> reportState)
        {
            game = selectedGame; gamePort = port; connect = factory; report = reportState;
            var random = new byte[32];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(random);
            token = BitConverter.ToString(random).Replace("-", "").ToLowerInvariant();
            listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start(8);
            Port = ((IPEndPoint)listener.LocalEndpoint).Port;
            configPath = Path.Combine(appDirectory, "app", "steam-session.json");
            configText = new JavaScriptSerializer().Serialize(new {
                schema = 1, endpoint = "http://127.0.0.1:" + Port + "/", token = token
            });
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(configPath));
                File.WriteAllText(configPath, configText, new UTF8Encoding(false));
                Task.Run((Action)Accept);
            }
            catch { listener.Stop(); throw; }
        }

        internal void Configure(string selectedGame, int port) { game = selectedGame; gamePort = port; }

        internal static void Attach(Form form, string directory)
        {
            try
            {
                var gameBox = (TextBox)EngineHost.Field(form, "gameBox");
                var portBox = (NumericUpDown)EngineHost.Field(form, "portBox");
                var log = (TextBox)EngineHost.Field(form, "logBox");
                var host = new SteamAchievementHost(directory, gameBox.Text, (int)portBox.Value,
                    selected => new SteamAchievementProcess(directory, selected), state => {
                        if (form.IsDisposed || !form.IsHandleCreated) return;
                        form.BeginInvoke((Action)delegate {
                            if (form.IsDisposed) return;
                            string language = Convert.ToString(form.GetType().Assembly.GetType("BlacksoulsVR.Lang").GetField("Current").GetValue(null));
                            bool ready = state == "ready";
                            string message = language == "ja" ? (ready ? "Steam実績に接続しました。" : "Steam実績は利用できません。Steamでログインし、ゲームの所有権を確認してください。") :
                                language == "ko" ? (ready ? "Steam 도전 과제에 연결되었습니다." : "Steam 도전 과제를 사용할 수 없습니다. Steam 로그인 및 게임 소유 여부를 확인하세요.") :
                                language == "zh" ? (ready ? "已连接Steam成就。" : "Steam成就暂不可用。请登录Steam并确认拥有游戏。") :
                                (ready ? "Steam achievements connected." : "Steam achievements unavailable. Sign in to Steam and make sure you own the game.");
                            log.AppendText(Environment.NewLine + message + Environment.NewLine);
                        });
                    });
                gameBox.TextChanged += delegate { host.Configure(gameBox.Text, (int)portBox.Value); };
                portBox.ValueChanged += delegate { host.Configure(gameBox.Text, (int)portBox.Value); };
                form.Disposed += delegate { host.Dispose(); };
                form.FormClosed += delegate { host.Dispose(); };
            }
            catch (Exception error) { Trace.WriteLine("Steam achievements unavailable: " + error.Message); }
        }

        private void Accept()
        {
            while (!stopped)
            {
                try {
                    var client = listener.AcceptTcpClient();
                    if (!requests.Wait(0)) { client.Close(); continue; }
                    Task.Run(() => { try { Handle(client); } finally { requests.Release(); } });
                }
                catch (SocketException) { if (!stopped) Dispose(); }
                catch (ObjectDisposedException) { return; }
            }
        }

        private void Handle(TcpClient client)
        {
            using (client)
            {
                client.ReceiveTimeout = 5000; client.SendTimeout = 5000;
                try
                {
                    var stream = client.GetStream();
                    var deadline = Stopwatch.StartNew();
                    string header = ReadHeader(stream, deadline);
                    string[] lines = header.Split(new[] { "\r\n" }, StringSplitOptions.None);
                    string[] first = lines[0].Split(' ');
                    var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    for (int i = 1; i < lines.Length; i++) {
                        int colon = lines[i].IndexOf(':');
                        if (colon <= 0) continue;
                        string name = lines[i].Substring(0, colon);
                        if (headers.ContainsKey(name)) throw new InvalidDataException("Duplicate header");
                        headers.Add(name, lines[i].Substring(colon + 1).Trim());
                    }
                    string origin, host, credential;
                    headers.TryGetValue("Origin", out origin); headers.TryGetValue("Host", out host);
                    if (first.Length != 3 || !AllowedOrigin(origin, gamePort) || host != "127.0.0.1:" + Port) {
                        Reply(stream, 403, null, new { state = "unavailable" }); return;
                    }
                    if (first[0] == "OPTIONS" && (first[1] == "/status" || first[1] == "/unlock")) {
                        Reply(stream, 204, origin, null); return;
                    }
                    headers.TryGetValue("X-BS-Steam-Token", out credential);
                    if (credential != token) { Reply(stream, 403, origin, new { state = "unavailable" }); return; }
                    string lengthText; int length;
                    headers.TryGetValue("Content-Length", out lengthText);
                    bool validLength = Int32.TryParse(lengthText, NumberStyles.None, CultureInfo.InvariantCulture, out length) && length >= 0 && length <= 32768;
                    byte[] data = validLength ? new byte[length] : new byte[0]; int read = 0;
                    while (read < data.Length) { SetReadDeadline(stream, deadline); int n = stream.Read(data, read, data.Length - read); if (n == 0) throw new EndOfStreamException(); read += n; }
                    if (headers.ContainsKey("Transfer-Encoding")) { Reply(stream, 403, origin, new { state = "unavailable" }); return; }
                    object result;
                    if (first[0] == "GET" && first[1] == "/status") result = Dispatch("status", new string[0]);
                    else if (first[0] == "POST" && first[1] == "/unlock") {
                        if (!validLength || length < 1) {
                            Reply(stream, 400, origin, new { state = "unavailable" }); return;
                        }
                        var body = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(new UTF8Encoding(false, true).GetString(data));
                        object values;
                        if (body == null || body.Count != 1 || !body.TryGetValue("names", out values) || !(values is ArrayList)) throw new InvalidDataException("Invalid names");
                        var names = new List<string>();
                        foreach (object value in (ArrayList)values) {
                            string name = value as string;
                            if (String.IsNullOrEmpty(name) || name.Length > 256 || name.IndexOf('\0') >= 0 || names.Count >= 256) throw new InvalidDataException("Invalid achievement");
                            if (!names.Contains(name)) names.Add(name);
                        }
                        result = Dispatch("unlock", names.ToArray());
                    }
                    else { Reply(stream, 404, origin, new { state = "unavailable" }); return; }
                    Reply(stream, 200, origin, result);
                }
                catch (Exception error) {
                    Trace.WriteLine("Steam bridge request: " + error.Message);
                    try { Reply(client.GetStream(), 400, null, new { state = "unavailable" }); } catch { }
                }
            }
        }

        internal static bool AllowedOrigin(string origin, int port)
        {
            return origin == "http://localhost:" + port || origin == "http://127.0.0.1:" + port;
        }

        private object Dispatch(string command, string[] names)
        {
            lock (gate)
            {
                if (stopped) return new { state = "unavailable" };
                string selected = game;
                if (worker != null && workerGame != selected) { worker.Dispose(); worker = null; }
                object response;
                try {
                    if (worker == null) { worker = connect(selected); workerGame = selected; }
                    response = worker.Request(command, names);
                }
                catch (Exception error) {
                    Trace.WriteLine("Steam worker unavailable: " + error.Message);
                    if (worker != null) worker.Dispose(); worker = null;
                    response = new Dictionary<string, object> { { "state", "unavailable" } };
                }
                var map = response as IDictionary<string, object>;
                object value; string state = map != null && map.TryGetValue("state", out value) ? value as string : null;
                // A player may start Steam or sign back in after launching. The
                // next discovery must establish a fresh, validated Steam context.
                if (state == "unavailable") CloseWorker();
                if ((state == "ready" || state == "unavailable") && state != lastState) { lastState = state; if (report != null) report(state); }
                return response;
            }
        }

        private static void SetReadDeadline(NetworkStream stream, Stopwatch elapsed)
        {
            int remaining = 5000 - (int)elapsed.ElapsedMilliseconds;
            if (remaining <= 0) throw new IOException("Request timed out");
            stream.ReadTimeout = remaining;
        }

        private static string ReadHeader(NetworkStream stream, Stopwatch elapsed)
        {
            var bytes = new List<byte>();
            while (bytes.Count < 8192) {
                SetReadDeadline(stream, elapsed);
                int b = stream.ReadByte(); if (b < 0) throw new EndOfStreamException(); bytes.Add((byte)b);
                int n = bytes.Count;
                if (n >= 4 && bytes[n - 4] == 13 && bytes[n - 3] == 10 && bytes[n - 2] == 13 && bytes[n - 1] == 10) return Encoding.ASCII.GetString(bytes.ToArray());
            }
            throw new InvalidDataException("Header too large");
        }

        private static void Reply(NetworkStream stream, int status, string origin, object body)
        {
            byte[] payload = body == null ? new byte[0] : Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(body));
            string cors = origin == null ? "" : "Access-Control-Allow-Origin: " + origin + "\r\nVary: Origin\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-BS-Steam-Token\r\nAccess-Control-Allow-Private-Network: true\r\n";
            byte[] header = Encoding.ASCII.GetBytes("HTTP/1.1 " + status + " " + (status == 200 ? "OK" : status == 204 ? "No Content" : "Rejected") +
                "\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\n" + cors + "Content-Length: " + payload.Length + "\r\n\r\n");
            stream.Write(header, 0, header.Length); stream.Write(payload, 0, payload.Length);
        }

        public void Dispose()
        {
            if (stopped) return; stopped = true; listener.Stop();
            try { if (File.Exists(configPath) && File.ReadAllText(configPath) == configText) File.Delete(configPath); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            // An in-flight Steam acknowledgement may take several seconds. Keep
            // closing the launcher responsive while its bounded request finishes.
            if (Monitor.TryEnter(gate)) { try { CloseWorker(); } finally { Monitor.Exit(gate); } }
            else Task.Run(() => { lock (gate) CloseWorker(); });
        }

        private void CloseWorker() { if (worker != null) { worker.Dispose(); worker = null; } }
    }

    internal sealed class SteamAchievementProcess : ISteamAchievementConnection
    {
        private readonly Process process;
        private readonly StreamWriter input;
        internal SteamAchievementProcess(string directory, string game)
        {
            if (String.IsNullOrEmpty(game) || !GameDiscovery.IsCandidate(game)) throw new InvalidDataException("No selected original game");
            process = Process.Start(new ProcessStartInfo {
                FileName = Path.Combine(directory, "SteamAchievements.exe"), WorkingDirectory = directory,
                Arguments = "--game " + Program.Quote(game) + " --parent " + Process.GetCurrentProcess().Id,
                UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true,
                StandardOutputEncoding = new UTF8Encoding(false)
            });
            input = new StreamWriter(process.StandardInput.BaseStream, new UTF8Encoding(false));
            input.AutoFlush = true;
        }
        public object Request(string command, string[] names)
        {
            input.WriteLine(new JavaScriptSerializer().Serialize(new { cmd = command, names = names }));
            var read = Task.Run(() => {
                string line;
                while ((line = process.StandardOutput.ReadLine()) != null) {
                    if (line.Length > 65536 || !line.StartsWith("{")) continue;
                    try { return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(line); } catch (ArgumentException) { }
                }
                throw new EndOfStreamException("Steam worker closed");
            });
            if (!read.Wait(12000)) throw new TimeoutException("Steam worker did not respond");
            return read.Result;
        }
        public void Dispose()
        {
            try { input.Close(); if (!process.WaitForExit(500)) process.Kill(); } catch (InvalidOperationException) { }
            process.Dispose();
        }
    }
}
