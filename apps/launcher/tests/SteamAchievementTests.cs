using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using BlacksoulsCommunity;

internal static class SteamAchievementTests
{
    private static int checks;
    private static readonly Func<bool> Alive = delegate { return true; };
    private static void Check(bool value, string description)
    {
        if (!value) throw new Exception(description);
        checks++; Console.WriteLine("PASS " + description);
    }

    private sealed class Clock : ISteamAchievementClock
    {
        public long Time;
        public long Milliseconds { get { return Time; } }
        public void Sleep(int amount) { Time += amount; }
    }

    private sealed class Native : ISteamAchievementsNative
    {
        internal string Failure;
        internal uint Application = SteamAchievementWorker.AppId;
        internal ulong User = 76561198000000001;
        internal bool Online = true, Owner = true, AutoReceive = true, AutoStore = true, RequestOk = true, StoreOk = true;
        internal int StoreResult = 1, RequestCount, StoreCount, PumpCount, DisposeCount;
        internal string FailSet, FailGet;
        internal uint? ReportedCount;
        internal string[] Names = { "First Step", "【　　】", "Last Door" };
        internal readonly HashSet<string> Cache = new HashSet<string>(StringComparer.Ordinal);
        internal readonly HashSet<string> Server = new HashSet<string>(StringComparer.Ordinal);
        internal readonly List<string> Set = new List<string>();
        internal readonly Queue<SteamAchievementCallback> Events = new Queue<SteamAchievementCallback>();
        private readonly int thread = Thread.CurrentThread.ManagedThreadId;
        private void SameThread() { if (Thread.CurrentThread.ManagedThreadId != thread) throw new Exception("Native call left pump thread"); }
        public string Initialize(string game) { SameThread(); return Failure; }
        public uint AppId { get { SameThread(); return Application; } }
        public ulong UserId { get { SameThread(); return User; } }
        public bool LoggedOn { get { SameThread(); return Online; } }
        public bool Subscribed { get { SameThread(); return Owner; } }
        internal SteamAchievementCallback Received(uint app, ulong user, int result) { return new SteamAchievementCallback { Kind = 1101, GameId = app, UserId = user, Result = result }; }
        internal SteamAchievementCallback Stored(uint app, int result) { return new SteamAchievementCallback { Kind = 1102, GameId = app, Result = result }; }
        public bool RequestCurrentStats()
        {
            SameThread(); RequestCount++;
            if (AutoReceive && RequestOk) Events.Enqueue(Received(Application, User, 1));
            return RequestOk;
        }
        public uint GetNumAchievements() { SameThread(); return ReportedCount ?? (uint)Names.Length; }
        public string GetAchievementName(uint index) { SameThread(); return Names[index]; }
        public bool GetAchievement(string name, out bool achieved) { SameThread(); achieved = Cache.Contains(name); return name != FailGet; }
        public bool SetAchievement(string name)
        {
            SameThread(); Set.Add(name);
            if (name == FailSet) return false;
            Cache.Add(name); return true;
        }
        public bool StoreStats()
        {
            SameThread(); StoreCount++;
            if (AutoStore && StoreOk) Events.Enqueue(Stored(Application, StoreResult));
            return StoreOk;
        }
        public void Pump(Action<SteamAchievementCallback> receive)
        {
            SameThread(); PumpCount++;
            while (Events.Count > 0) {
                var value = Events.Dequeue();
                if (value.Kind == 1102 && value.GameId == Application && value.Result == 1) Server.UnionWith(Cache);
                receive(value);
            }
        }
        public void Dispose() { SameThread(); DisposeCount++; }
    }

    private static SteamAchievementSession Session(Native native, Clock clock)
    {
        return new SteamAchievementSession(native, "synthetic original game", clock);
    }

    private static void ReadinessAndValidation()
    {
        var native = new Native { AutoReceive = false }; var clock = new Clock();
        using (var session = Session(native, clock))
        {
            Check(session.Status(100, Alive).state == "pending" && native.Set.Count == 0 && native.StoreCount == 0,
                "Pending stats and read-only status never write achievements");
            Check(session.Unlock(new[] { "First Step" }, Alive).state == "pending" && native.Set.Count == 0,
                "Unlock cannot mutate local cache before stats readiness");
            native.Events.Enqueue(native.Received(999, native.User, 1));
            native.Events.Enqueue(native.Received(native.Application, native.User + 1, 1));
            Check(session.Status(0, Alive).state == "pending", "Other app and other user callbacks cannot authorize this session");
            native.Events.Enqueue(native.Received(native.Application, native.User, 1));
            var ready = session.Status(0, Alive);
            Check(ready.state == "ready" && ready.achievements.SequenceEqual(native.Names) && native.Set.Count == 0,
                "Matching successful stats callback exposes exact runtime schema including spaces and Unicode");
            var rejected = session.Unlock(new[] { "First Step", "not in runtime schema" }, Alive);
            Check(rejected.unlocked.Length == 0 && rejected.reason == "invalid_achievement" && native.Set.Count == 0 && native.StoreCount == 0,
                "Validate the whole batch against runtime schema before any native mutation");
            rejected = session.Unlock(new[] { "First Step\0suffix" }, Alive);
            Check(rejected.reason == "invalid_achievement" && native.Set.Count == 0, "Embedded NUL cannot alias an allowlisted native achievement");
            var unlocked = session.Unlock(new[] { "【　　】", "First Step", "【　　】" }, Alive);
            Check(unlocked.state == "ready" && unlocked.unlocked.SequenceEqual(new[] { "【　　】", "First Step" }) && native.Set.Count == 2 && native.StoreCount == 1 && native.Server.Count == 2,
                "Deduplicate exact IDs and batch one store with positive callback confirmation");
            unlocked = session.Unlock(new[] { "First Step", "【　　】" }, Alive);
            Check(unlocked.unlocked.Length == 2 && native.StoreCount == 1 && native.Set.Count == 2,
                "Confirmed achievements are idempotent without another Set or Store");
            Check(session.Unlock(new string[0], Alive).unlocked.Length == 0 && native.StoreCount == 1,
                "Empty unlock command performs no store");
        }
        Check(native.DisposeCount == 1, "Session disposes native library once");

        native = new Native(); clock = new Clock(); native.Cache.Add("Last Door"); native.Server.Add("Last Door");
        using (var session = Session(native, clock)) {
            Check(session.Unlock(new[] { "Last Door" }, Alive).unlocked.SequenceEqual(new[] { "Last Door" }) && native.Set.Count == 0 && native.StoreCount == 0,
                "Already unlocked achievement is acknowledged only after successful native read from downloaded stats");
        }
    }

    private static void PersistenceFailures()
    {
        var native = new Native { StoreOk = false }; var clock = new Clock();
        using (var session = Session(native, clock))
        {
            var failed = session.Unlock(new[] { "First Step" }, Alive);
            Check(failed.unlocked.Length == 0 && failed.reason == "store_failed" && native.Cache.Contains("First Step") && native.Server.Count == 0,
                "Store false leaves a local true cache value unacknowledged");
            var held = session.Unlock(new[] { "First Step" }, Alive);
            Check(held.state == "pending" && held.unlocked.Length == 0 && native.StoreCount == 1,
                "Retry cooldown cannot promote unconfirmed in-memory GetAchievement true");
            clock.Time += 2000; native.StoreOk = true;
            var recovered = session.Unlock(new[] { "First Step" }, Alive);
            Check(recovered.unlocked.Length == 1 && native.StoreCount == 2 && native.Set.Count == 1 && native.Server.Contains("First Step"),
                "Explicit later unlock retries dirty batch and acknowledges only successful Store callback");
        }

        native = new Native { StoreResult = 2 }; clock = new Clock();
        using (var session = Session(native, clock)) {
            Check(session.Unlock(new[] { "First Step" }, Alive).unlocked.Length == 0 && native.Server.Count == 0,
                "Negative1102 callback cannot certify persistence despite StoreStats true");
            clock.Time += 2000; native.StoreResult = 1;
            Check(session.Unlock(new[] { "First Step" }, Alive).unlocked.Length == 1 && native.StoreCount == 2,
                "Failed callback can recover through a later explicit retry");
        }

        native = new Native { AutoStore = false }; clock = new Clock();
        using (var session = Session(native, clock))
        {
            var timeout = session.Unlock(new[] { "First Step" }, Alive);
            Check(timeout.state == "pending" && timeout.reason == "store_pending" && timeout.unlocked.Length == 0 && clock.Time >= 8000,
                "Missing store callback times out without a persisted acknowledgement");
            native.Events.Enqueue(native.Stored(999, 1));
            Check(session.Unlock(new[] { "Last Door" }, Alive).state == "pending" && native.StoreCount == 1 && native.Set.Count == 1,
                "Outstanding store and unrelated positive callback cannot start or certify a different batch");
            native.Events.Enqueue(native.Stored(native.Application, 1));
            session.Status(0, Alive);
            var completed = session.Unlock(new[] { "First Step" }, Alive);
            Check(completed.unlocked.Length == 1 && native.StoreCount == 1,
                "Late matching positive callback confirms original timed-out batch without a duplicate store");
        }

        native = new Native { FailSet = "Last Door" }; clock = new Clock();
        using (var session = Session(native, clock)) {
            var partial = session.Unlock(new[] { "First Step", "Last Door" }, Alive);
            Check(partial.unlocked.SequenceEqual(new[] { "First Step" }) && partial.reason == "achievement_failed" && !native.Server.Contains("Last Door"),
                "Partially rejected Set batch acknowledges only achievements positively persisted");
        }
        native = new Native(); clock = new Clock();
        using (var session = Session(native, clock)) {
            session.Status(0, Alive); native.FailGet = "First Step";
            Check(session.Unlock(new[] { "First Step" }, Alive).unlocked.Length == 0 && native.Set.Count == 0 && native.StoreCount == 0,
                "Failed native GetAchievement cannot be treated as unlocked or blindly written");
        }
    }

    private static void ContextAndRetries()
    {
        foreach (string reason in new[] { "wrong_game", "steam_signed_out", "game_not_owned", "steam_account_changed" })
        {
            var native = new Native(); var clock = new Clock();
            using (var session = Session(native, clock)) {
                session.Status(0, Alive);
                if (reason == "wrong_game") native.Application = 999;
                else if (reason == "steam_signed_out") native.Online = false;
                else if (reason == "game_not_owned") native.Owner = false;
                else native.User++;
                var rejected = session.Unlock(new[] { "First Step" }, Alive);
                Check(rejected.state == "unavailable" && rejected.reason == reason && native.Set.Count == 0 && native.StoreCount == 0,
                    "Context guard blocks writes for " + reason);
            }
        }
        var unavailable = new Native { Failure = "steam_not_running" };
        using (var session = Session(unavailable, new Clock())) {
            Check(session.Status(0, Alive).reason == "steam_not_running" && unavailable.RequestCount == 0,
                "Initialization failure is player-readable and performs no stats calls");
        }
        var retry = new Native { RequestOk = false }; var time = new Clock();
        using (var session = Session(retry, time)) {
            session.Status(0, Alive); session.Status(0, Alive);
            Check(retry.RequestCount == 1, "Repeated status does not hammer RequestCurrentStats");
            time.Time = 2000; session.Status(0, Alive); time.Time = 4000;
            Check(session.Status(0, Alive).state == "unavailable" && retry.RequestCount == 3, "Stats retries are bounded at three with backoff");
            time.Time = 20000; session.Status(0, Alive);
            Check(retry.RequestCount == 3, "Unavailable stats do not retry forever");
        }
        retry = new Native { AutoReceive = false }; time = new Clock();
        using (var session = Session(retry, time)) {
            time.Time = 10000; retry.AutoReceive = true;
            Check(session.Status(20, Alive).state == "ready" && retry.RequestCount == 2,
                "Timed-out initial stats request recovers only through bounded status retry");
        }
        foreach (string[] invalid in new[] { new[] { "Same", "Same" }, new[] { "" }, new[] { new String('a', 128) } }) {
            var api = new Native { Names = invalid };
            using (var session = Session(api, new Clock())) {
                Check(session.Status(0, Alive).reason == "invalid_achievement_schema" && api.Set.Count == 0,
                    "Invalid runtime schema is rejected without writes");
            }
        }
        var excessive = new Native { ReportedCount = 257 };
        using (var session = Session(excessive, new Clock())) {
            Check(session.Status(0, Alive).state == "unavailable", "Runtime schema enumeration is bounded before indexing names");
        }
    }

    private static void ProtocolAndAbi()
    {
        Check(IntPtr.Size == 4 && Marshal.SizeOf(typeof(NativeSteamAchievements.CallbackMessage)) == 16,
            "Worker tests run as x86 and match native CallbackMsg_t layout");
        Check(Marshal.SizeOf(typeof(NativeSteamAchievements.StatsReceived)) == 24 &&
            Marshal.OffsetOf(typeof(NativeSteamAchievements.StatsReceived), "User").ToInt32() == 12 &&
            Marshal.SizeOf(typeof(NativeSteamAchievements.StatsStored)) == 16,
            "Stats callbacks preserve outer Windows pack8 and packed native CSteamID at12");
        byte[] payload = new byte[24];
        Array.Copy(BitConverter.GetBytes((ulong)SteamAchievementWorker.AppId), 0, payload, 0, 8);
        Array.Copy(BitConverter.GetBytes(1), 0, payload, 8, 4);
        Array.Copy(BitConverter.GetBytes((ulong)76561198000000001), 0, payload, 12, 8);
        IntPtr callbackBytes = Marshal.AllocHGlobal(payload.Length);
        try {
            Marshal.Copy(payload, 0, callbackBytes, payload.Length);
            var callback = (NativeSteamAchievements.StatsReceived)Marshal.PtrToStructure(callbackBytes, typeof(NativeSteamAchievements.StatsReceived));
            Check(callback.Game == SteamAchievementWorker.AppId && callback.Result == 1 && callback.User == 76561198000000001,
                "Actual callback byte layout decodes complete user identity without reading trailing padding");
        }
        finally { Marshal.FreeHGlobal(callbackBytes); }
        string name = "【　　】"; byte[] bytes = SteamAchievementWorker.NameBytes(name);
        IntPtr pointer = Marshal.AllocHGlobal(bytes.Length);
        try { Marshal.Copy(bytes, 0, pointer, bytes.Length); Check(SteamAchievementWorker.NameAt(pointer) == name && bytes.Last() == 0 && bytes.Length == 13,
            "Exact UTF8 name survives explicit native pointer roundtrip including full-width spaces"); }
        finally { Marshal.FreeHGlobal(pointer); }
        Check(SteamAchievementWorker.ValidName(new String('a', 127)) && !SteamAchievementWorker.ValidName(new String('a', 128)) &&
            !SteamAchievementWorker.ValidName(new String('あ', 43)) && !SteamAchievementWorker.ValidName("\ud800"),
            "Native name bounds count UTF8 bytes and reject invalid surrogate encoding");
        string game; int parent; bool probe;
        Check(SteamAchievementWorker.ParseArguments(new[] { "--game", "C:\\ゲーム", "--probe" }, out game, out parent, out probe) && probe && game == "C:\\ゲーム" && parent == 0,
            "Read-only probe supports Unicode selected game path without a parent");
        Check(!SteamAchievementWorker.ParseArguments(new[] { "--game", "anything" }, out game, out parent, out probe) &&
            !SteamAchievementWorker.ParseArguments(new[] { "--game", "anything", "--parent", "-1" }, out game, out parent, out probe),
            "Interactive worker requires a valid parent process argument");

        var native = new Native();
        using (var session = Session(native, new Clock())) {
            foreach (string line in new[] { "null", "[]", "{}", "{\"cmd\":\"reset\"}", "{\"cmd\":\"unlock\",\"names\":[12]}", "{\"cmd\":\"unlock\",\"names\":null}" }) {
                Check(session.Command(line, Alive).reason == "invalid_command" && native.Set.Count == 0,
                    "Malformed or unsupported protocol command has no native mutation");
            }
            string lineInput = "{\"cmd\":\"status\"}\n{\"cmd\":\"unlock\",\"names\":[\"【　　】\"]}\n";
            var output = new StringWriter();
            SteamAchievementWorker.Run(new StringReader(lineInput), output, session, Alive);
            string[] lines = output.ToString().Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            var parsed = lines.Select(line => new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(line)).ToArray();
            Check(parsed.Length == 2 && (string)parsed[0]["state"] == "ready" && (string)parsed[1]["state"] == "ready" && native.Set.SequenceEqual(new[] { "【　　】" }),
                "JSON-lines loop drains commands then exits on EOF and runs every native call on the pump thread");
            int pumps = native.PumpCount;
            SteamAchievementWorker.Run(new StringReader("{\"cmd\":\"unlock\",\"names\":[\"Last Door\"]}\n"), new StringWriter(), session, delegate { return false; });
            Check(native.Set.Count == 1 && native.PumpCount == pumps, "Dead parent exits before pending commands can write");
        }
        bool oversized = false;
        try { SteamAchievementWorker.ReadLine(new StringReader(new String('x', 65537))); } catch (InvalidDataException) { oversized = true; }
        Check(oversized, "Input command memory is bounded before JSON parsing");
    }

    public static int Main()
    {
        try {
            ReadinessAndValidation(); PersistenceFailures(); ContextAndRetries(); ProtocolAndAbi();
            Console.WriteLine(checks + " Steam achievement checks passed (fake native only; no Steam writes)."); return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}
