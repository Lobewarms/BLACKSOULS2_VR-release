using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace BlacksoulsCommunity
{
    // Only this x86 child loads the selected game's Steam library. The launcher and
    // browser never load it, and status/probe cannot write achievements.
    internal static class SteamAchievementWorker
    {
        internal const uint AppId = 3855540;
        internal const int MaximumNames = 256;
        internal const int MaximumLine = 65536;
        internal static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);

        public static int Main(string[] args)
        {
            Console.InputEncoding = Utf8;
            Console.OutputEncoding = new UTF8Encoding(false);
            try
            {
                string game; int parent; bool probe;
                if (!ParseArguments(args, out game, out parent, out probe)) {
                    Write(new SteamAchievementReply("unavailable", "invalid_arguments", false)); return 2;
                }
                using (var native = new NativeSteamAchievements())
                using (var session = new SteamAchievementSession(native, game, new SteamAchievementClock()))
                {
                    Func<bool> alive = delegate { return parent == 0 || ParentAlive(parent); };
                    if (probe) { Write(session.Status(7000, alive)); return 0; }
                    Run(Console.In, Console.Out, session, alive);
                }
                return 0;
            }
            catch (Exception error)
            {
                // Never log DLL output or implementation exceptions to the JSON channel.
                Console.Error.WriteLine("Steam achievements: " + error.GetType().Name);
                Write(new SteamAchievementReply("unavailable", "steam_unavailable", false)); return 1;
            }
        }

        internal static bool ParseArguments(string[] args, out string game, out int parent, out bool probe)
        {
            game = null; parent = 0; probe = false;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--probe" && !probe) probe = true;
                else if (args[i] == "--game" && game == null && i + 1 < args.Length) game = args[++i];
                else if (args[i] == "--parent" && parent == 0 && i + 1 < args.Length) {
                    if (!Int32.TryParse(args[++i], out parent) || parent <= 0) return false;
                }
                else return false;
            }
            return !String.IsNullOrEmpty(game) && (probe || parent > 0);
        }

        internal static bool ParentAlive(int id)
        {
            try { using (var process = Process.GetProcessById(id)) return !process.HasExited; }
            catch (ArgumentException) { return false; }
            catch (InvalidOperationException) { return false; }
        }

        internal static void Run(TextReader input, TextWriter output, SteamAchievementSession session, Func<bool> alive)
        {
            // ReadLine must not block callback pumping or parent-exit detection. This
            // background reader does no native work and has a bounded queue/line size.
            using (var lines = new BlockingCollection<string>(16))
            {
                var reader = new Thread(delegate() {
                    try {
                        string line;
                        while ((line = ReadLine(input)) != null) {
                            while (!lines.TryAdd(line, 100)) if (!alive()) return;
                        }
                    }
                    catch (IOException) { }
                    catch (InvalidDataException) { }
                    catch (ObjectDisposedException) { }
                    finally { try { lines.CompleteAdding(); } catch (ObjectDisposedException) { } }
                });
                reader.IsBackground = true; reader.Start();
                while (alive())
                {
                    string line;
                    if (lines.TryTake(out line, 50)) {
                        output.WriteLine(new JavaScriptSerializer().Serialize(session.Command(line, alive)));
                        output.Flush();
                    }
                    else if (lines.IsCompleted) break;
                    session.Pump();
                }
            }
        }

        internal static string ReadLine(TextReader reader)
        {
            var text = new StringBuilder();
            int value;
            while ((value = reader.Read()) >= 0) {
                if (value == '\n') return text.ToString().TrimEnd('\r');
                if (text.Length >= MaximumLine) throw new InvalidDataException("Command too long");
                text.Append((char)value);
            }
            return text.Length == 0 ? null : text.ToString();
        }

        private static void Write(object reply) { Console.WriteLine(new JavaScriptSerializer().Serialize(reply)); }

        internal static bool ValidName(string name)
        {
            if (String.IsNullOrEmpty(name) || name.IndexOf('\0') >= 0) return false;
            try { return Utf8.GetByteCount(name) <= 127; }
            catch (EncoderFallbackException) { return false; }
        }

        internal static byte[] NameBytes(string name)
        {
            if (!ValidName(name)) throw new InvalidDataException("Invalid achievement name");
            return Utf8.GetBytes(name + "\0");
        }

        internal static string NameAt(IntPtr pointer)
        {
            if (pointer == IntPtr.Zero) throw new InvalidDataException("Missing achievement name");
            int count = 0;
            while (count < 128 && Marshal.ReadByte(pointer, count) != 0) count++;
            if (count == 128) throw new InvalidDataException("Unterminated achievement name");
            var bytes = new byte[count]; Marshal.Copy(pointer, bytes, 0, count);
            string name = Utf8.GetString(bytes);
            if (!ValidName(name)) throw new InvalidDataException("Invalid achievement name");
            return name;
        }
    }

    internal sealed class SteamAchievementReply
    {
        public string state;
        public string reason;
        public string[] achievements;
        public string[] unlocked;
        internal SteamAchievementReply(string status, string why, bool unlock)
        {
            state = status; reason = why;
            if (unlock) unlocked = new string[0]; else achievements = new string[0];
        }
    }

    internal sealed class SteamAchievementCallback
    {
        internal int Kind;
        internal ulong GameId;
        internal ulong UserId;
        internal int Result;
    }

    internal interface ISteamAchievementsNative : IDisposable
    {
        string Initialize(string game);
        uint AppId { get; }
        ulong UserId { get; }
        bool LoggedOn { get; }
        bool Subscribed { get; }
        bool RequestCurrentStats();
        uint GetNumAchievements();
        string GetAchievementName(uint index);
        bool GetAchievement(string name, out bool achieved);
        bool SetAchievement(string name);
        bool StoreStats();
        void Pump(Action<SteamAchievementCallback> callback);
    }

    internal interface ISteamAchievementClock
    {
        long Milliseconds { get; }
        void Sleep(int milliseconds);
    }

    internal sealed class SteamAchievementClock : ISteamAchievementClock
    {
        private readonly Stopwatch watch = Stopwatch.StartNew();
        public long Milliseconds { get { return watch.ElapsedMilliseconds; } }
        public void Sleep(int milliseconds) { Thread.Sleep(milliseconds); }
    }

    internal sealed class SteamAchievementSession : IDisposable
    {
        private readonly ISteamAchievementsNative native;
        private readonly ISteamAchievementClock clock;
        private readonly HashSet<string> allowed = new HashSet<string>(StringComparer.Ordinal);
        private readonly HashSet<string> persisted = new HashSet<string>(StringComparer.Ordinal);
        // SetAchievement changes Steam's local cache. Never mistake that cache for
        // server confirmation after StoreStats failed or its callback timed out.
        private readonly HashSet<string> dirty = new HashSet<string>(StringComparer.Ordinal);
        private string[] names = new string[0];
        private readonly ulong user;
        private string problem;
        private string statsProblem = "stats_pending";
        private bool ready, requestPending, storePending;
        private int requests;
        private long requestedAt, retryAt, nextStoreAt;
        private string storeProblem;

        internal SteamAchievementSession(ISteamAchievementsNative api, string game, ISteamAchievementClock time)
        {
            native = api; clock = time;
            problem = native.Initialize(game);
            if (problem != null) return;
            user = native.UserId;
            problem = ContextProblem();
            if (problem == null) RequestStats();
        }

        private string ContextProblem()
        {
            if (native.AppId != SteamAchievementWorker.AppId) return "wrong_game";
            if (!native.LoggedOn || native.UserId == 0) return "steam_signed_out";
            if (native.UserId != user) return "steam_account_changed";
            if (!native.Subscribed) return "game_not_owned";
            return null;
        }

        private void RequestStats()
        {
            requests++; requestedAt = clock.Milliseconds;
            requestPending = native.RequestCurrentStats();
            retryAt = requestedAt + 2000;
            statsProblem = requestPending ? "stats_pending" : "stats_request_failed";
        }

        internal void Pump()
        {
            if (problem != null) return;
            string context = ContextProblem();
            if (context != null) { problem = context; return; }
            native.Pump(OnCallback);
            if (requestPending && !ready && clock.Milliseconds - requestedAt >= 10000) {
                requestPending = false; statsProblem = "stats_timeout";
            }
        }

        private void OnCallback(SteamAchievementCallback value)
        {
            if (value.GameId != SteamAchievementWorker.AppId) return;
            if (value.Kind == 1101 && value.UserId == user && requestPending)
            {
                requestPending = false;
                if (value.Result != 1) { statsProblem = "stats_unavailable"; return; }
                try
                {
                    uint count = native.GetNumAchievements();
                    if (count == 0 || count > SteamAchievementWorker.MaximumNames) throw new InvalidDataException();
                    var found = new List<string>(); var known = new HashSet<string>(StringComparer.Ordinal);
                    for (uint i = 0; i < count; i++) {
                        string name = native.GetAchievementName(i);
                        if (!SteamAchievementWorker.ValidName(name) || !known.Add(name)) throw new InvalidDataException();
                        bool achieved;
                        if (!native.GetAchievement(name, out achieved)) throw new InvalidDataException();
                        found.Add(name);
                        if (achieved && !dirty.Contains(name)) persisted.Add(name);
                    }
                    names = found.ToArray(); allowed.UnionWith(names); ready = true; statsProblem = null;
                }
                catch (InvalidDataException) { problem = "invalid_achievement_schema"; }
            }
            else if (value.Kind == 1102 && storePending)
            {
                storePending = false;
                if (value.Result != 1) { storeProblem = "store_failed"; nextStoreAt = clock.Milliseconds + 2000; return; }
                storeProblem = null;
                foreach (string name in dirty.ToArray()) {
                    bool achieved;
                    if (native.GetAchievement(name, out achieved) && achieved) { persisted.Add(name); dirty.Remove(name); }
                }
            }
        }

        internal SteamAchievementReply Status(int wait, Func<bool> alive)
        {
            Pump();
            if (problem == null && !ready && !requestPending && requests < 3 && clock.Milliseconds >= retryAt) RequestStats();
            long until = clock.Milliseconds + wait;
            while (problem == null && !ready && requestPending && clock.Milliseconds < until && alive()) { clock.Sleep(20); Pump(); }
            var reply = new SteamAchievementReply(problem != null ? "unavailable" : ready ? "ready" : requests >= 3 && !requestPending ? "unavailable" : "pending",
                problem ?? (ready ? null : statsProblem), false);
            if (ready && problem == null) reply.achievements = names.ToArray();
            return reply;
        }

        internal SteamAchievementReply Unlock(string[] requested, Func<bool> alive)
        {
            var status = Status(2000, alive);
            var reply = new SteamAchievementReply(status.state, status.reason, true);
            if (status.state != "ready") return reply;
            if (requested == null || requested.Length > SteamAchievementWorker.MaximumNames ||
                requested.Any(name => !SteamAchievementWorker.ValidName(name) || !allowed.Contains(name))) {
                reply.reason = "invalid_achievement"; return reply;
            }
            string[] batch = requested.Distinct(StringComparer.Ordinal).ToArray();
            if (batch.Length == 0) return reply;
            if (batch.All(persisted.Contains)) { reply.unlocked = batch; return reply; }
            if (storePending || clock.Milliseconds < nextStoreAt) {
                reply.state = "pending"; reply.reason = storePending ? "store_pending" : "store_retry_later"; return reply;
            }
            if (!alive()) { reply.state = "unavailable"; reply.reason = "launcher_closed"; return reply; }
            bool setFailed = false;
            foreach (string name in batch)
            {
                if (persisted.Contains(name)) continue;
                bool achieved;
                if (!native.GetAchievement(name, out achieved)) { setFailed = true; continue; }
                if (dirty.Contains(name)) continue;
                // A true read is acknowledged only if it came from initial downloaded
                // stats or a successful store, never merely from an in-memory set.
                if (achieved) { persisted.Add(name); continue; }
                if (native.SetAchievement(name)) dirty.Add(name); else setFailed = true;
            }
            if (dirty.Count > 0)
            {
                storeProblem = null; storePending = true;
                if (!native.StoreStats()) { storePending = false; storeProblem = "store_failed"; nextStoreAt = clock.Milliseconds + 2000; }
                long until = clock.Milliseconds + 8000;
                while (storePending && problem == null && clock.Milliseconds < until && alive()) { clock.Sleep(20); Pump(); }
            }
            // Even successful SetAchievement/StoreStats return values do not certify
            // persistence. Only the matching positive1102 callback promotes dirty IDs.
            reply.unlocked = batch.Where(persisted.Contains).ToArray();
            if (problem != null) { reply.state = "unavailable"; reply.reason = problem; }
            else if (storePending) { reply.state = "pending"; reply.reason = "store_pending"; }
            else reply.reason = storeProblem ?? (setFailed || reply.unlocked.Length != batch.Length ? "achievement_failed" : null);
            return reply;
        }

        internal SteamAchievementReply Command(string line, Func<bool> alive)
        {
            try
            {
                var serializer = new JavaScriptSerializer { MaxJsonLength = SteamAchievementWorker.MaximumLine, RecursionLimit = 8 };
                var data = serializer.Deserialize<Dictionary<string, object>>(line);
                object command;
                if (data == null || !data.TryGetValue("cmd", out command)) throw new InvalidDataException();
                if ((command as string) == "status" && data.Keys.All(key => key == "cmd" || key == "names")) return Status(2000, alive);
                object items;
                if ((command as string) != "unlock" || data.Count != 2 || !data.TryGetValue("names", out items) || !(items is ArrayList)) throw new InvalidDataException();
                var values = (ArrayList)items;
                if (values.Count > SteamAchievementWorker.MaximumNames || values.Cast<object>().Any(value => !(value is string))) throw new InvalidDataException();
                return Unlock(values.Cast<string>().ToArray(), alive);
            }
            catch (ArgumentException) { return new SteamAchievementReply("unavailable", "invalid_command", true); }
            catch (InvalidOperationException) { return new SteamAchievementReply("unavailable", "invalid_command", true); }
            catch (InvalidDataException) { return new SteamAchievementReply("unavailable", "invalid_command", true); }
        }

        public void Dispose() { native.Dispose(); }
    }

    internal sealed class NativeSteamAchievements : ISteamAchievementsNative
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
        [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true)]
        private static extern IntPtr GetProcAddress(IntPtr module, string name);
        [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool FreeLibrary(IntPtr module);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] [return: MarshalAs(UnmanagedType.I1)] private delegate bool Init();
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void VoidCall();
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int HandleCall();
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate IntPtr InterfaceCall(int user, [MarshalAs(UnmanagedType.LPStr)] string version);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate IntPtr Accessor();
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] [return: MarshalAs(UnmanagedType.I1)] private delegate bool BoolSelf(IntPtr self);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate uint UIntSelf(IntPtr self);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate ulong ULongSelf(IntPtr self);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] [return: MarshalAs(UnmanagedType.I1)] private delegate bool Owned(IntPtr self, uint app);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate IntPtr NameCall(IntPtr self, uint index);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] [return: MarshalAs(UnmanagedType.I1)] private delegate bool GetCall(IntPtr self, IntPtr name, [MarshalAs(UnmanagedType.I1)] out bool achieved);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] [return: MarshalAs(UnmanagedType.I1)] private delegate bool SetCall(IntPtr self, IntPtr name);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void FrameCall(int pipe);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] [return: MarshalAs(UnmanagedType.I1)] private delegate bool CallbackCall(int pipe, out CallbackMessage callback);
        // Valve Windows ABI packs callbacks at8; x86 CallbackMsg_t is16bytes.
        [StructLayout(LayoutKind.Sequential, Pack = 8)]
        internal struct CallbackMessage { public int User; public int Kind; public IntPtr Data; public int Size; }
        // CSteamID is a native class with pack1, not a naturally aligned uint64.
        // The surrounding callback still has24bytes (Windows pack8); its user
        // starts immediately after EResult at12. Sequential ulong would read16.
        [StructLayout(LayoutKind.Explicit, Size = 24)]
        internal struct StatsReceived
        {
            [FieldOffset(0)] public ulong Game;
            [FieldOffset(8)] public int Result;
            [FieldOffset(12)] public ulong User;
        }
        [StructLayout(LayoutKind.Sequential, Pack = 8)]
        internal struct StatsStored { public ulong Game; public int Result; }

        private IntPtr library, stats, apps, steamUser, utils;
        private bool initialized;
        private int pipe;
        private VoidCall shutdown;
        private BoolSelf loggedOn, subscribed, request, store;
        private Owned owns;
        private UIntSelf appId, count;
        private ULongSelf userId;
        private NameCall nameAt;
        private GetCall get;
        private SetCall set;
        private FrameCall runFrame, freeCallback;
        private CallbackCall nextCallback;

        private T Export<T>(string name) where T : class
        {
            IntPtr address = GetProcAddress(library, name);
            if (address == IntPtr.Zero) throw new EntryPointNotFoundException(name);
            return (T)(object)Marshal.GetDelegateForFunctionPointer(address, typeof(T));
        }

        public string Initialize(string game)
        {
            if (IntPtr.Size != 4) return "steam_requires_32bit_helper";
            try
            {
                string folder = Path.GetFullPath(game);
                string dll = Path.Combine(folder, "steam_api.dll");
                if (!File.Exists(Path.Combine(folder, "Game.exe")) || !File.Exists(dll) ||
                    (!File.Exists(Path.Combine(folder, "Game.rgss3a")) && !File.Exists(Path.Combine(folder, "Data", "System.rvdata2")))) return "steam_game_not_found";
                // Process-local only: do not create steam_appid.txt or alter Steam/game settings.
                Environment.SetEnvironmentVariable("SteamAppId", SteamAchievementWorker.AppId.ToString(System.Globalization.CultureInfo.InvariantCulture));
                Environment.SetEnvironmentVariable("SteamGameId", SteamAchievementWorker.AppId.ToString(System.Globalization.CultureInfo.InvariantCulture));
                library = LoadLibraryEx(dll, IntPtr.Zero, 0x00001100); // DLL_LOAD_DIR | DEFAULT_DIRS
                if (library == IntPtr.Zero) return "steam_library_unavailable";
                shutdown = Export<VoidCall>("SteamAPI_Shutdown");
                var init = Export<Init>("SteamAPI_Init");
                if (!init()) return "steam_not_running";
                initialized = true;
                Export<VoidCall>("SteamAPI_ManualDispatch_Init")();
                pipe = Export<HandleCall>("SteamAPI_GetHSteamPipe")();
                int handle = Export<HandleCall>("SteamAPI_GetHSteamUser")();
                if (pipe == 0 || handle == 0) return "steam_unavailable";
                var find = Export<InterfaceCall>("SteamInternal_FindOrCreateUserInterface");
                stats = find(handle, "STEAMUSERSTATS_INTERFACE_VERSION011");
                apps = find(handle, "STEAMAPPS_INTERFACE_VERSION008");
                steamUser = find(handle, "SteamUser019");
                utils = Export<Accessor>("SteamAPI_SteamUtils_v010")();
                if (stats == IntPtr.Zero || apps == IntPtr.Zero || steamUser == IntPtr.Zero || utils == IntPtr.Zero) return "steam_interface_unavailable";
                loggedOn = Export<BoolSelf>("SteamAPI_ISteamUser_BLoggedOn");
                userId = Export<ULongSelf>("SteamAPI_ISteamUser_GetSteamID");
                subscribed = Export<BoolSelf>("SteamAPI_ISteamApps_BIsSubscribed");
                owns = Export<Owned>("SteamAPI_ISteamApps_BIsSubscribedApp");
                appId = Export<UIntSelf>("SteamAPI_ISteamUtils_GetAppID");
                request = Export<BoolSelf>("SteamAPI_ISteamUserStats_RequestCurrentStats");
                count = Export<UIntSelf>("SteamAPI_ISteamUserStats_GetNumAchievements");
                nameAt = Export<NameCall>("SteamAPI_ISteamUserStats_GetAchievementName");
                get = Export<GetCall>("SteamAPI_ISteamUserStats_GetAchievement");
                set = Export<SetCall>("SteamAPI_ISteamUserStats_SetAchievement");
                store = Export<BoolSelf>("SteamAPI_ISteamUserStats_StoreStats");
                runFrame = Export<FrameCall>("SteamAPI_ManualDispatch_RunFrame");
                nextCallback = Export<CallbackCall>("SteamAPI_ManualDispatch_GetNextCallback");
                freeCallback = Export<FrameCall>("SteamAPI_ManualDispatch_FreeLastCallback");
                return null;
            }
            catch (EntryPointNotFoundException) { return "steam_interface_unavailable"; }
            catch (BadImageFormatException) { return "steam_library_unavailable"; }
            catch (IOException) { return "steam_game_not_found"; }
            catch (UnauthorizedAccessException) { return "steam_game_not_found"; }
            catch (ArgumentException) { return "steam_game_not_found"; }
        }

        public uint AppId { get { return appId(utils); } }
        public ulong UserId { get { return userId(steamUser); } }
        public bool LoggedOn { get { return loggedOn(steamUser); } }
        public bool Subscribed { get { return subscribed(apps) && owns(apps, SteamAchievementWorker.AppId); } }
        public bool RequestCurrentStats() { return request(stats); }
        public uint GetNumAchievements() { return count(stats); }
        public string GetAchievementName(uint index) { return SteamAchievementWorker.NameAt(nameAt(stats, index)); }
        public bool GetAchievement(string name, out bool achieved)
        {
            var pin = GCHandle.Alloc(SteamAchievementWorker.NameBytes(name), GCHandleType.Pinned);
            try { return get(stats, pin.AddrOfPinnedObject(), out achieved); }
            finally { pin.Free(); }
        }
        public bool SetAchievement(string name)
        {
            var pin = GCHandle.Alloc(SteamAchievementWorker.NameBytes(name), GCHandleType.Pinned);
            try { return set(stats, pin.AddrOfPinnedObject()); }
            finally { pin.Free(); }
        }
        public bool StoreStats() { return store(stats); }
        public void Pump(Action<SteamAchievementCallback> receive)
        {
            runFrame(pipe);
            CallbackMessage callback;
            for (int i = 0; i < 256 && nextCallback(pipe, out callback); i++)
            {
                try
                {
                    if (callback.Data == IntPtr.Zero) continue;
                    if (callback.Kind == 1101 && callback.Size >= Marshal.SizeOf(typeof(StatsReceived))) {
                        var value = (StatsReceived)Marshal.PtrToStructure(callback.Data, typeof(StatsReceived));
                        receive(new SteamAchievementCallback { Kind = 1101, GameId = value.Game, Result = value.Result, UserId = value.User });
                    }
                    else if (callback.Kind == 1102 && callback.Size >= Marshal.SizeOf(typeof(StatsStored))) {
                        var value = (StatsStored)Marshal.PtrToStructure(callback.Data, typeof(StatsStored));
                        receive(new SteamAchievementCallback { Kind = 1102, GameId = value.Game, Result = value.Result });
                    }
                }
                finally { freeCallback(pipe); }
            }
        }
        public void Dispose()
        {
            if (initialized) { initialized = false; shutdown(); }
            if (library != IntPtr.Zero) { FreeLibrary(library); library = IntPtr.Zero; }
        }
    }
}
