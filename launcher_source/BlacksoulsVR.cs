// BLACK SOULS II VR - the launcher that goes into the share package.
//
// It asks for the original game folder, serves the VR mod (app\ next to this exe) and the game's own files on
// http://localhost:<port>/ - read only: nothing in the game folder is ever written - opens the game in Chrome or
// Edge (WebXR), can enter VR by itself (it clicks the page's VR button through the browser's DevTools port) and
// can add itself to the SteamVR library. VR saves and settings go to saves\ next to this exe.
// "Run with SteamVR" makes only the game's own browser use SteamVR's OpenXR runtime (XR_RUNTIME_JSON), whatever
// runtime the PC has active - inside VR the SteamVR dashboard then shows the desktop.
// The browser's WebXR cannot make a VR controller vibrate; while SteamVR runs the launcher does it for the page
// (SteamVrHaptics).
// As its window opens it reads the share page's version.json once (Update): a newer version there shows a button
// to its page. Nothing is sent and nothing downloaded.
//
// The routes are the same as vr/server.py (the dev server): keep the two in step.
// Built by vr/tools/build_share.py with the C# compiler that ships with Windows (.NET Framework 4.x, C# 5).
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Management;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace BlacksoulsVR
{
    static class Program
    {
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

        [STAThread]
        static int Main(string[] args)
        {
            Options opt = Options.Parse(args);
            if (opt.SelfTest) return SelfTest.Run(opt);
            if (opt.TestAutoVr > 0)
            {
                StringBuilder sb = new StringBuilder();
                bool ok = new AutoVr(s => { lock (sb) sb.AppendLine(s); }).Run(opt.TestAutoVr, opt.Url ?? "http://localhost:8150/").GetAwaiter().GetResult();
                if (opt.Log != null) File.WriteAllText(opt.Log, sb.ToString() + (ok ? "RESULT OK" : "RESULT FAILED") + Environment.NewLine, new UTF8Encoding(false));
                return ok ? 0 : 1;
            }
            try { SetProcessDPIAware(); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if (opt.Screenshot != null)
            {
                using (LauncherForm f = new LauncherForm(opt))
                {
                    f.StartPosition = FormStartPosition.Manual;
                    f.Location = new Point(-4000, -4000);
                    f.Show();
                    Application.DoEvents();
                    for (int i = 0; i < 500 && f.UpdateCheck != null && !f.UpdateCheck.IsCompleted; i++) { Thread.Sleep(20); Application.DoEvents(); }
                    Application.DoEvents();
                    using (Bitmap b = new Bitmap(f.Width, f.Height))
                    {
                        f.DrawToBitmap(b, new Rectangle(0, 0, f.Width, f.Height));
                        b.Save(opt.Screenshot, System.Drawing.Imaging.ImageFormat.Png);
                    }
                }
                return 0;
            }
            Application.Run(new LauncherForm(opt));
            return 0;
        }
    }

    // ------------------------------------------------------------------ command line
    class Options
    {
        public bool Launch, Vr, SelfTest;
        public string Game, Saves, Log, TestAppConfig, Screenshot, Url, ExpectDir, LangOpt, UpdateUrl;
        public int Port, TestAutoVr;

        public static Options Parse(string[] a)
        {
            Options o = new Options();
            for (int i = 0; i < a.Length; i++)
            {
                string s = a[i].ToLowerInvariant();
                string next = i + 1 < a.Length ? a[i + 1] : null;
                if (s == "--launch") o.Launch = true;                 // start at once with the saved settings (SteamVR)
                else if (s == "--vr") o.Vr = true;                    // and enter VR by itself
                else if (s == "--selftest") o.SelfTest = true;        // build check, no window
                else if (s == "--game" && next != null) { o.Game = next; i++; }
                else if (s == "--saves" && next != null) { o.Saves = next; i++; }
                else if (s == "--log" && next != null) { o.Log = next; i++; }
                else if (s == "--test-appconfig" && next != null) { o.TestAppConfig = next; i++; }
                else if (s == "--screenshot" && next != null) { o.Screenshot = next; i++; }   // the window as a PNG (build check)
                else if (s == "--test-autovr" && next != null) { int.TryParse(next, out o.TestAutoVr); i++; }   // auto-VR against a browser's DevTools port
                else if (s == "--url" && next != null) { o.Url = next; i++; }
                else if (s == "--lang" && next != null) { o.LangOpt = next.ToLowerInvariant(); i++; }
                else if (s == "--expect-dir" && next != null) { o.ExpectDir = next; i++; }   // self-test: files to compare with
                else if (s == "--update-url" && next != null) { o.UpdateUrl = next; i++; }   // test: another version.json (also file:///)
                else if (s == "--port" && next != null) { int.TryParse(next, out o.Port); i++; }
            }
            return o;
        }
    }

    static class Util
    {
        public static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 512 };

        // join and make sure the result stays inside the base folder (no path traversal)
        public static string SafeJoin(string baseDir, string rel)
        {
            if (string.IsNullOrEmpty(baseDir) || rel == null) return null;
            try
            {
                string b = Path.GetFullPath(baseDir).TrimEnd('\\', '/') + "\\";
                string full = Path.GetFullPath(Path.Combine(b, rel.Replace('/', '\\').TrimStart('\\')));
                return full.StartsWith(b, StringComparison.OrdinalIgnoreCase) ? full : null;
            }
            catch { return null; }
        }

        public static Dictionary<string, object> Dict(object o)
        {
            return o as Dictionary<string, object> ?? new Dictionary<string, object>();
        }

        public static string Str(Dictionary<string, object> d, string k, string def)
        {
            object v;
            return d.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : def;
        }

        public static int FreePort()
        {
            TcpListener l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int p = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return p;
        }

        public static string HttpGet(string url, int timeoutMs)
        {
            HttpWebRequest r = (HttpWebRequest)WebRequest.Create(url);
            r.Timeout = timeoutMs;
            r.Proxy = null;
            using (WebResponse resp = r.GetResponse())
            using (StreamReader sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                return sr.ReadToEnd();
        }
    }

    // ------------------------------------------------------------------ a newer version?
    // The share page (the public repository) keeps version.json - { "version": "YYYY.MM.DD-n", "url": its page } -
    // updated with every package put there. Read once as the window opens; offline or unreachable, nothing changes.
    static class NewVersion
    {
        public const string Page = "https://github.com/Lobewarms/BLACKSOULS2_VR-release";
        public const string Source = "https://raw.githubusercontent.com/Lobewarms/BLACKSOULS2_VR-release/main/version.json";

        // the version there and its page ({ version, page }), or null
        public static string[] Latest(string url)
        {
            try { ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12; } catch { }
            WebRequest r = WebRequest.Create(url);
            r.Timeout = 8000;
            HttpWebRequest h = r as HttpWebRequest;
            if (h != null)
            {
                h.ReadWriteTimeout = 8000;
                h.UserAgent = "BlacksoulsVR-launcher/" + BuildInfo.Version;
                h.CachePolicy = new System.Net.Cache.RequestCachePolicy(System.Net.Cache.RequestCacheLevel.NoCacheNoStore);
            }
            string text;
            using (WebResponse resp = r.GetResponse())
            using (StreamReader sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
            {
                char[] buf = new char[16384];
                text = new string(buf, 0, sr.ReadBlock(buf, 0, buf.Length));
            }
            Dictionary<string, object> d = Util.Dict(Util.Json.DeserializeObject(text));
            string v = Util.Str(d, "version", "").Trim(), page = Util.Str(d, "url", Page).Trim();
            if (Key(v) < 0) return null;
            // (only a page of the share's own)
            if (!page.StartsWith("https://github.com/Lobewarms/", StringComparison.Ordinal)) page = Page;
            return new[] { v, page };
        }

        // YYYY.MM.DD-n as one number to compare (-1: not a version)
        public static long Key(string v)
        {
            Match m = Regex.Match(v ?? "", @"^(\d{4})\.(\d{2})\.(\d{2})-(\d{1,3})$");
            if (!m.Success) return -1;
            return ((long.Parse(m.Groups[1].Value) * 100 + long.Parse(m.Groups[2].Value)) * 100 + long.Parse(m.Groups[3].Value)) * 1000 + long.Parse(m.Groups[4].Value);
        }
    }

    // ------------------------------------------------------------------ language
    // Of this launcher and of the VR version's own menus / notices (passed to the game as ?lang=); the game's own
    // text is never translated. Keys are the Korean text; {0}, {1} as in string.Format.
    static class Lang
    {
        public static readonly string[] Codes = { "ko", "en", "ja", "zh" };
        public static readonly string[] Names = { "한국어", "English", "日本語", "中文 (简体)" };
        public static string Current = "ko";

        static readonly Dictionary<string, string[]> T = new Dictionary<string, string[]>
        {
            { "BLACK SOULS II VR 런처  v{0}", new[] { "BLACK SOULS II VR Launcher  v{0}", "BLACK SOULS II VR ランチャー  v{0}", "BLACK SOULS II VR 启动器  v{0}" } },
            { "원작 게임 폴더는 읽기만 합니다 (아무것도 바꾸거나 저장하지 않음). VR 세이브·설정은 이 프로그램 폴더의 saves에 저장됩니다.", new[] {
                "The original game folder is only read (nothing in it is changed or saved). VR saves and settings go to the saves folder of this program.",
                "原作のゲームフォルダは読み込むだけです (何も変更・保存しません)。VRのセーブと設定はこのプログラムの saves フォルダに保存されます。",
                "只读取原作游戏文件夹 (不会修改或保存任何东西)。VR 存档和设置保存在本程序的 saves 文件夹中。" } },
            { "언어 (Language)", new[] { "Language", "言語 (Language)", "语言 (Language)" } },
            { "블랙소울2 게임 폴더 (Game.exe가 있는 폴더)", new[] { "BLACK SOULS II game folder (the one with Game.exe)", "ブラックソウルズ2のゲームフォルダ (Game.exe があるフォルダ)", "黑魂2 (BLACK SOULS II) 游戏文件夹 (Game.exe 所在的文件夹)" } },
            { "찾아보기...", new[] { "Browse...", "参照...", "浏览..." } },
            { "블랙소울2 게임 폴더를 고르세요", new[] { "Choose the BLACK SOULS II game folder", "ブラックソウルズ2のゲームフォルダを選んでください", "请选择黑魂2的游戏文件夹" } },
            { "RPG Maker VX Ace RTP 폴더 (선택: 일부 맵의 기본 타일. 없어도 실행됩니다)", new[] {
                "RPG Maker VX Ace RTP folder (optional: stock tiles a few maps use; it runs without)",
                "RPG Maker VX Ace RTP フォルダ (任意: 一部マップの標準タイル。なくても動きます)",
                "RPG Maker VX Ace RTP 文件夹 (可选：部分地图的默认图块，没有也能运行)" } },
            { "RPG Maker VX Ace RTP 폴더(RPGVXAce)를 고르세요", new[] { "Choose the RPG Maker VX Ace RTP folder (RPGVXAce)", "RPG Maker VX Ace RTP フォルダ (RPGVXAce) を選んでください", "请选择 RPG Maker VX Ace RTP 文件夹 (RPGVXAce)" } },
            { "브라우저", new[] { "Browser", "ブラウザ", "浏览器" } },
            { "자동 (Chrome, 없으면 Edge)", new[] { "Auto (Chrome, else Edge)", "自動 (Chrome、なければ Edge)", "自动 (Chrome，没有则用 Edge)" } },
            { "포트", new[] { "Port", "ポート", "端口" } },
            { "게임 창이 뜨면 VR 자동 시작", new[] { "Enter VR by itself when the game window opens", "ゲームウィンドウが開いたら自動で VR 開始", "游戏窗口打开后自动进入 VR" } },
            { "실행 (Launch)", new[] { "Launch", "起動 (Launch)", "启动 (Launch)" } },
            { "SteamVR 라이브러리에 등록", new[] { "Add to the SteamVR library", "SteamVR ライブラリに登録", "添加到 SteamVR 库" } },
            { "SteamVR 등록 해제", new[] { "Remove from SteamVR", "SteamVR 登録を解除", "从 SteamVR 移除" } },
            { "세이브 폴더 열기", new[] { "Open the saves folder", "セーブフォルダを開く", "打开存档文件夹" } },
            { "VR 런타임(OpenXR): {0}   ·   게임은 브라우저의 WebXR로 이 런타임을 씁니다", new[] {
                "VR runtime (OpenXR): {0}   ·   the game uses it through the browser's WebXR",
                "VR ランタイム (OpenXR): {0}   ·   ゲームはブラウザの WebXR でこのランタイムを使います",
                "VR 运行时 (OpenXR)：{0}   ·   游戏通过浏览器的 WebXR 使用它" } },
            { "없음 (VR 런타임이 설치되지 않았거나 지정되지 않음)", new[] { "none (no VR runtime installed or set)", "なし (VR ランタイムが未インストールまたは未設定)", "无 (未安装或未设置 VR 运行时)" } },
            { "알 수 없음", new[] { "unknown", "不明", "未知" } },
            { "버전 {0}   ·   세이브 폴더: {1}", new[] { "Version {0}   ·   saves folder: {1}", "バージョン {0}   ·   セーブフォルダ: {1}", "版本 {0}   ·   存档文件夹：{1}" } },
            { "새 버전 받기 ({0})", new[] { "Get the new version ({0})", "新しいバージョンを入手 ({0})", "获取新版本 ({0})" } },
            { "새 버전이 나왔습니다: {0} (지금 {1}). '새 버전 받기'를 누르면 받는 곳이 열립니다.", new[] {
                "A new version is out: {0} (this one: {1}). 'Get the new version' opens its download page.",
                "新しいバージョンが出ています: {0} (現在 {1})。「新しいバージョンを入手」でダウンロードページが開きます。",
                "有新版本：{0} (当前 {1})。点击“获取新版本”打开下载页面。" } },
            { "최신 버전입니다.", new[] { "This is the latest version.", "最新バージョンです。", "已是最新版本。" } },
            { "최신 버전인지 확인하지 못했습니다 (인터넷에 연결되지 않았거나 받는 곳에 닿지 않음).", new[] {
                "Could not check for a new version (no internet, or the download page could not be reached).",
                "最新バージョンか確認できませんでした (インターネット未接続、またはダウンロードページに届かない)。",
                "无法检查新版本 (未连接互联网，或无法访问下载页面)。" } },
            { "블랙소울2 게임 폴더를 지정해 주세요.", new[] { "Choose the BLACK SOULS II game folder.", "ブラックソウルズ2のゲームフォルダを指定してください。", "请指定黑魂2的游戏文件夹。" } },
            { "폴더가 없습니다: {0}", new[] { "Folder not found: {0}", "フォルダがありません: {0}", "文件夹不存在：{0}" } },
            { "게임 데이터(Data\\System.rvdata2)를 찾지 못했습니다: {0}", new[] { "Game data (Data\\System.rvdata2) not found: {0}", "ゲームデータ (Data\\System.rvdata2) が見つかりません: {0}", "找不到游戏数据 (Data\\System.rvdata2)：{0}" } },
            { "이 폴더에서 블랙소울2를 찾지 못했습니다.\nGame.exe와 Data 폴더(또는 Game.rgss3a)가 있는 폴더를 골라 주세요.", new[] {
                "BLACK SOULS II was not found in this folder.\nChoose the folder that has Game.exe and the Data folder (or Game.rgss3a).",
                "このフォルダにブラックソウルズ2が見つかりません。\nGame.exe と Data フォルダ (または Game.rgss3a) があるフォルダを選んでください。",
                "在此文件夹中找不到黑魂2。\n请选择包含 Game.exe 和 Data 文件夹 (或 Game.rgss3a) 的文件夹。" } },
            { "RGSS3A 형식이 아닙니다: {0}", new[] { "Not an RGSS3A archive: {0}", "RGSS3A 形式ではありません: {0}", "不是 RGSS3A 格式：{0}" } },
            { "RGSS3A 목록이 깨져 있습니다", new[] { "The RGSS3A index is broken", "RGSS3A の目録が壊れています", "RGSS3A 目录已损坏" } },
            { "게임 데이터 확인됨 (압축 파일 {0}에서 읽음)", new[] { "Game data found (read from the archive {0})", "ゲームデータを確認 (アーカイブ {0} から読み込み)", "已找到游戏数据 (从压缩包 {0} 读取)" } },
            { "게임 데이터 확인됨", new[] { "Game data found", "ゲームデータを確認しました", "已找到游戏数据" } },
            { "RTP 확인됨", new[] { "RTP found", "RTP を確認しました", "已找到 RTP" } },
            { "RTP 없음 (일부 맵의 기본 타일이 비어 보일 수 있음 - 무료 'RPG Maker VX Ace RTP'를 설치하면 자동으로 찾습니다)", new[] {
                "No RTP (stock tiles on a few maps may look empty - install the free 'RPG Maker VX Ace RTP' and it is found by itself)",
                "RTP なし (一部マップの標準タイルが空に見えることがあります - 無料の「RPG Maker VX Ace RTP」を入れると自動で見つけます)",
                "没有 RTP (部分地图的默认图块可能显示为空 - 安装免费的「RPG Maker VX Ace RTP」后会自动找到)" } },
            { "이 폴더에 RTP(Graphics 폴더)가 없습니다", new[] { "No RTP (Graphics folder) in this folder", "このフォルダに RTP (Graphics フォルダ) がありません", "此文件夹中没有 RTP (Graphics 文件夹)" } },
            { "Steam을 찾지 못했습니다.", new[] { "Steam was not found.", "Steam が見つかりません。", "找不到 Steam。" } },
            { "SteamVR이 켜져 있습니다. SteamVR을 완전히 끈 뒤 다시 눌러 주세요.\n(켜져 있는 동안 바꾸면 SteamVR이 종료될 때 되돌려 버립니다)", new[] {
                "SteamVR is running. Quit SteamVR completely, then press again.\n(Changes made while it runs are undone when it quits)",
                "SteamVR が起動しています。SteamVR を完全に終了してからもう一度押してください。\n(起動中に変更すると SteamVR の終了時に元に戻されます)",
                "SteamVR 正在运行。请完全退出 SteamVR 后再按一次。\n(运行时修改会在 SteamVR 退出时被还原)" } },
            { "SteamVR 라이브러리에서 뺐습니다.", new[] { "Removed from the SteamVR library.", "SteamVR ライブラリから外しました。", "已从 SteamVR 库移除。" } },
            { "참고: SteamVR이 설치되어 있지 않은 것 같습니다. 설치 후 라이브러리에 나타납니다.", new[] {
                "Note: SteamVR does not seem to be installed. It shows up in the library once it is.",
                "注意: SteamVR がインストールされていないようです。インストール後にライブラリに表示されます。",
                "注意：似乎没有安装 SteamVR。安装后会出现在库中。" } },
            { "SteamVR 라이브러리에 'BLACK SOULS II VR'을 등록했습니다. SteamVR에서 실행하면 서버와 게임 창이 뜨고 VR로 들어갑니다. (이 폴더를 옮기면 이 런처를 한 번 다시 실행하세요)", new[] {
                "Added 'BLACK SOULS II VR' to the SteamVR library. Started from there, it opens the server and the game window and enters VR. (If you move this folder, run this launcher once again)",
                "SteamVR ライブラリに「BLACK SOULS II VR」を登録しました。SteamVR から起動するとサーバーとゲームウィンドウが開き、VR に入ります。(このフォルダを移動したら、このランチャーを一度起動してください)",
                "已将「BLACK SOULS II VR」添加到 SteamVR 库。从 SteamVR 启动时会打开服务器和游戏窗口并进入 VR。(移动此文件夹后请再运行一次本启动器)" } },
            { "SteamVR 설정을 바꾸지 못했습니다: {0}", new[] { "Could not change the SteamVR settings: {0}", "SteamVR の設定を変更できませんでした: {0}", "无法修改 SteamVR 设置：{0}" } },
            { "설정을 저장하지 못했습니다: {0}", new[] { "Could not save the settings: {0}", "設定を保存できませんでした: {0}", "无法保存设置：{0}" } },
            { "게임 폴더", new[] { "Game folder", "ゲームフォルダ", "游戏文件夹" } },
            { "서버 실행: {0}  (게임 폴더 {1})", new[] { "Server running: {0}  (game folder {1})", "サーバー起動: {0}  (ゲームフォルダ {1})", "服务器已启动：{0}  (游戏文件夹 {1})" } },
            { "이미 실행 중인 런처가 포트 {0}에서 게임을 열고 있습니다 - 그 서버를 씁니다.", new[] {
                "A launcher already serves the game on port {0} - using that server.",
                "起動中のランチャーがポート {0} でゲームを開いています - そのサーバーを使います。",
                "已有启动器在端口 {0} 上提供游戏 - 将使用该服务器。" } },
            { "포트 {0}을(를) 열지 못했습니다 ({1}).\n다른 프로그램이 쓰고 있다면 포트 번호를 바꿔 보세요.", new[] {
                "Could not open port {0} ({1}).\nIf another program uses it, try another port number.",
                "ポート {0} を開けませんでした ({1})。\n他のプログラムが使っている場合はポート番号を変えてみてください。",
                "无法打开端口 {0} ({1})。\n如果被其他程序占用，请换一个端口号。" } },
            { "서버", new[] { "Server", "サーバー", "服务器" } },
            { "app 폴더가 없습니다. 공유 파일을 압축을 푼 그대로 두고 실행해 주세요.", new[] {
                "The app folder is missing. Keep the files exactly as they came out of the zip.",
                "app フォルダがありません。解凍したファイルをそのままの構成で置いて起動してください。",
                "缺少 app 文件夹。请保持解压后的文件结构不变再运行。" } },
            { "파일 누락", new[] { "Missing files", "ファイル不足", "文件缺失" } },
            { "Chrome 또는 Edge를 찾지 못했습니다. 둘 중 하나를 설치해 주세요 (VR은 브라우저의 WebXR로 돌아갑니다).", new[] {
                "Chrome or Edge was not found. Install one of them (VR runs on the browser's WebXR).",
                "Chrome または Edge が見つかりません。どちらかをインストールしてください (VR はブラウザの WebXR で動きます)。",
                "找不到 Chrome 或 Edge。请安装其中之一 (VR 通过浏览器的 WebXR 运行)。" } },
            { "{0}로 게임 창을 열었습니다.", new[] { "Opened the game window in {0}.", "{0} でゲームウィンドウを開きました。", "已用 {0} 打开游戏窗口。" } },
            { " VR 자동 시작을 기다립니다...", new[] { " Waiting to enter VR...", " VR の自動開始を待っています...", " 正在等待自动进入 VR..." } },
            { " 창 아래쪽의 VR 버튼을 누르면 헤드셋 모드로 들어갑니다.", new[] { " Press the VR button at the bottom of the window to enter the headset.", " ウィンドウ下の VR ボタンを押すとヘッドセットモードに入ります。", " 按窗口下方的 VR 按钮即可进入头显模式。" } },
            { "브라우저를 열지 못했습니다: {0}", new[] { "Could not open the browser: {0}", "ブラウザを開けませんでした: {0}", "无法打开浏览器：{0}" } },
            { "VR 자동 시작: 게임 창에 연결하지 못했습니다 (게임 창이 이미 열려 있었다면 닫고 다시 실행하세요). 창의 VR 버튼을 눌러 주세요.", new[] {
                "Auto VR: could not connect to the game window (if one was already open, close it and launch again). Press the VR button in the window.",
                "VR 自動開始: ゲームウィンドウに接続できませんでした (すでに開いていた場合は閉じてから起動し直してください)。ウィンドウの VR ボタンを押してください。",
                "自动进入 VR：无法连接到游戏窗口 (如果之前已打开，请关闭后重新启动)。请按窗口中的 VR 按钮。" } },
            { "VR 자동 시작: 다시 시도합니다...", new[] { "Auto VR: trying again...", "VR 自動開始: もう一度試します...", "自动进入 VR：再试一次..." } },
            { "VR 자동 시작: 헤드셋 모드로 들어갔습니다.", new[] { "Auto VR: entered the headset.", "VR 自動開始: ヘッドセットモードに入りました。", "自动进入 VR：已进入头显模式。" } },
            { "VR 자동 시작: 버튼을 눌렀지만 헤드셋 세션이 시작되지 않았습니다. 창의 VR 버튼을 직접 눌러 보세요.", new[] {
                "Auto VR: pressed the button but no headset session started. Try the VR button in the window yourself.",
                "VR 自動開始: ボタンを押しましたがヘッドセットのセッションが始まりませんでした。ウィンドウの VR ボタンを直接押してみてください。",
                "自动进入 VR：已按下按钮，但头显会话没有开始。请自己按窗口中的 VR 按钮。" } },
            { "VR 자동 시작: 브라우저가 VR 장치를 찾지 못했습니다 ({0}). SteamVR 또는 Meta Quest Link를 먼저 켜고, OpenXR 런타임을 확인한 뒤 게임 창을 다시 여세요.", new[] {
                "Auto VR: the browser found no VR device ({0}). Start SteamVR or Meta Quest Link first, check the OpenXR runtime, then open the game window again.",
                "VR 自動開始: ブラウザが VR 機器を見つけられませんでした ({0})。先に SteamVR か Meta Quest Link を起動し、OpenXR ランタイムを確認してからゲームウィンドウを開き直してください。",
                "自动进入 VR：浏览器找不到 VR 设备 ({0})。请先启动 SteamVR 或 Meta Quest Link，确认 OpenXR 运行时后重新打开游戏窗口。" } },
            { "VR 자동 시작: 게임 로딩이 끝나지 않았습니다. 창의 VR 버튼을 눌러 주세요.", new[] {
                "Auto VR: the game did not finish loading. Press the VR button in the window.",
                "VR 自動開始: ゲームの読み込みが終わりませんでした。ウィンドウの VR ボタンを押してください。",
                "自动进入 VR：游戏没有加载完成。请按窗口中的 VR 按钮。" } },
            { "VR 자동 시작 실패: {0} - 창의 VR 버튼을 눌러 주세요.", new[] { "Auto VR failed: {0} - press the VR button in the window.", "VR 自動開始に失敗: {0} - ウィンドウの VR ボタンを押してください。", "自动进入 VR 失败：{0} - 请按窗口中的 VR 按钮。" } },
            { "SteamVR로 실행 (VR 안에서 SteamVR 대시보드로 데스크톱 보기)", new[] {
                "Run with SteamVR (see the desktop in VR through the SteamVR dashboard)",
                "SteamVR で実行 (VR の中で SteamVR ダッシュボードからデスクトップを見る)",
                "用 SteamVR 运行 (在 VR 中通过 SteamVR 仪表板查看桌面)" } },
            { "VR 런타임(OpenXR): SteamVR (이 게임만 - 위 설정)   ·   PC 기본: {0}", new[] {
                "VR runtime (OpenXR): SteamVR (this game only - the option above)   ·   PC default: {0}",
                "VR ランタイム (OpenXR): SteamVR (このゲームのみ - 上の設定)   ·   PC の既定: {0}",
                "VR 运行时 (OpenXR)：SteamVR (仅本游戏 - 上方设置)   ·   电脑默认：{0}" } },
            { "VR 런타임: SteamVR (이 게임 창만). SteamVR이 꺼져 있으면 게임 창이 열릴 때 켜집니다.", new[] {
                "VR runtime: SteamVR (this game window only). If SteamVR is off, it starts when the game window opens.",
                "VR ランタイム: SteamVR (このゲームウィンドウのみ)。SteamVR が起動していなければゲームウィンドウが開くときに起動します。",
                "VR 运行时：SteamVR (仅本游戏窗口)。若 SteamVR 未运行，游戏窗口打开时会自动启动。" } },
            { "SteamVR을 찾지 못해 PC 기본 VR 런타임으로 실행합니다.", new[] {
                "SteamVR was not found: running with the PC's default VR runtime.",
                "SteamVR が見つからないため、PC の既定の VR ランタイムで実行します。",
                "找不到 SteamVR，将使用电脑默认的 VR 运行时。" } },
            { "게임 창이 이미 열려 있어 VR 런타임 설정이 그 창에는 적용되지 않습니다. 게임 창을 닫고 다시 실행하세요.", new[] {
                "The game window is already open, so the VR runtime option does not apply to it. Close the game window and launch again.",
                "ゲームウィンドウがすでに開いているため、VR ランタイムの設定はそのウィンドウに適用されません。ゲームウィンドウを閉じてから起動し直してください。",
                "游戏窗口已经打开，VR 运行时设置不会应用到该窗口。请关闭游戏窗口后重新启动。" } },
        };

        public static string S(string ko)
        {
            int i = Array.IndexOf(Codes, Current);
            string[] t;
            return i > 0 && T.TryGetValue(ko, out t) ? t[i - 1] : ko;
        }

        public static string F(string ko, params object[] args) { return string.Format(S(ko), args); }

        // Windows' display language, when nothing was chosen yet
        public static string Default()
        {
            string two = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName.ToLowerInvariant();
            return Array.IndexOf(Codes, two) >= 0 ? two : "en";
        }
    }

    // ------------------------------------------------------------------ where things live
    static class AppPaths
    {
        // this exe as the file system has it. Not Application.ExecutablePath: that goes through a file:// address
        // (Assembly.CodeBase) and back, so a folder named with '%' and two hex digits ("...%20...", "...%41...") came
        // back as another folder (" ", "A") - no app\ there, and the launcher said the app folder was missing
        public static readonly string ExePath = OwnPath();
        public static readonly string ExeDir = Path.GetDirectoryName(ExePath);
        public static readonly string AppDir = Path.Combine(ExeDir, "app");
        public static readonly string LocalDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BlacksoulsVR");
        static string dataDir;

        // next to the exe (a portable folder), or the user's AppData when that folder cannot be written
        public static string DataDir
        {
            get
            {
                if (dataDir == null) dataDir = Writable(ExeDir) ? ExeDir : LocalDir;
                Directory.CreateDirectory(dataDir);
                return dataDir;
            }
        }
        public static string SavesDir { get { return Path.Combine(DataDir, "saves"); } }
        public static string ConfigPath { get { return Path.Combine(DataDir, "launcher.json"); } }
        public static string ProfileDir { get { return Path.Combine(LocalDir, "browser-profile"); } }

        static string OwnPath()
        {
            try
            {
                System.Reflection.Assembly a = System.Reflection.Assembly.GetEntryAssembly();
                if (a != null && !string.IsNullOrEmpty(a.Location)) return a.Location;
            }
            catch { }
            try { return Process.GetCurrentProcess().MainModule.FileName; } catch { }
            return Application.ExecutablePath;
        }

        static bool Writable(string dir)
        {
            try
            {
                string p = Path.Combine(dir, ".write_test_" + Guid.NewGuid().ToString("N"));
                File.WriteAllText(p, "x");
                File.Delete(p);
                return true;
            }
            catch { return false; }
        }
    }

    class LauncherConfig
    {
        public string GameDir = "", RtpDir = "", Browser = "auto", Lang = "";
        public int Port = 8150;
        public bool AutoVr = true;
        public bool SteamVrRuntime;          // the game's browser uses SteamVR's OpenXR runtime

        public static LauncherConfig Load()
        {
            LauncherConfig c = new LauncherConfig();
            try
            {
                if (!File.Exists(AppPaths.ConfigPath)) return c;
                Dictionary<string, object> d = Util.Dict(Util.Json.DeserializeObject(File.ReadAllText(AppPaths.ConfigPath, Encoding.UTF8)));
                c.GameDir = Util.Str(d, "gameDir", "");
                c.RtpDir = Util.Str(d, "rtpDir", "");
                c.Browser = Util.Str(d, "browser", "auto");
                c.Lang = Util.Str(d, "lang", "");
                int p;
                if (int.TryParse(Util.Str(d, "port", "8150"), out p) && p > 0 && p < 65536) c.Port = p;
                c.AutoVr = Util.Str(d, "autoVr", "True").ToLowerInvariant() != "false";
                c.SteamVrRuntime = Util.Str(d, "steamVrRuntime", "False").ToLowerInvariant() == "true";
            }
            catch { }
            return c;
        }

        public void Save()
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["gameDir"] = GameDir; d["rtpDir"] = RtpDir; d["browser"] = Browser; d["port"] = Port; d["autoVr"] = AutoVr; d["lang"] = Lang;
            d["steamVrRuntime"] = SteamVrRuntime;
            File.WriteAllText(AppPaths.ConfigPath, Util.Json.Serialize(d), new UTF8Encoding(false));
        }
    }

    // ------------------------------------------------------------------ the game's files (read only)
    // RPG Maker VX Ace archive (Game.rgss3a), for copies of the game that ship one: read in memory, never unpacked
    class Rgss3a
    {
        public class Entry { public long Offset; public int Size; public uint Key; }
        public readonly string FilePath;
        readonly Dictionary<string, Entry> entries = new Dictionary<string, Entry>(StringComparer.OrdinalIgnoreCase);
        public readonly List<string> Names = new List<string>();

        public Rgss3a(string path)
        {
            FilePath = path;
            using (FileStream fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (BinaryReader br = new BinaryReader(fs))
            {
                byte[] magic = br.ReadBytes(8);
                if (magic.Length < 8 || Encoding.ASCII.GetString(magic, 0, 6) != "RGSSAD" || magic[7] != 3)
                    throw new InvalidDataException(Lang.F("RGSS3A 형식이 아닙니다: {0}", Path.GetFileName(path)));
                uint key = unchecked(br.ReadUInt32() * 9 + 3);
                while (fs.Position + 16 <= fs.Length)
                {
                    uint offset = br.ReadUInt32() ^ key;
                    if (offset == 0) break;
                    uint size = br.ReadUInt32() ^ key;
                    uint fkey = br.ReadUInt32() ^ key;
                    uint nlen = br.ReadUInt32() ^ key;
                    if (nlen > 4096) throw new InvalidDataException(Lang.S("RGSS3A 목록이 깨져 있습니다"));
                    byte[] nb = br.ReadBytes((int)nlen);
                    for (int i = 0; i < nb.Length; i++) nb[i] = (byte)(nb[i] ^ (byte)(key >> (8 * (i % 4))));
                    string name = Encoding.UTF8.GetString(nb).Replace('\\', '/');
                    if (!entries.ContainsKey(name)) Names.Add(name);
                    entries[name] = new Entry { Offset = offset, Size = (int)size, Key = fkey };
                }
            }
        }

        public bool Has(string name) { return entries.ContainsKey(name.Replace('\\', '/')); }

        public byte[] Read(string name)
        {
            Entry e;
            if (!entries.TryGetValue(name.Replace('\\', '/'), out e)) return null;
            byte[] data = new byte[e.Size];
            using (FileStream fs = new FileStream(FilePath, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                fs.Seek(e.Offset, SeekOrigin.Begin);
                int got = 0;
                while (got < data.Length)
                {
                    int n = fs.Read(data, got, data.Length - got);
                    if (n <= 0) break;
                    got += n;
                }
            }
            uint k = e.Key;
            for (int i = 0; i < data.Length; i += 4)
            {
                for (int j = 0; j < 4 && i + j < data.Length; j++) data[i + j] ^= (byte)(k >> (8 * j));
                k = unchecked(k * 7 + 3);
            }
            return data;
        }
    }

    class GameFiles
    {
        public readonly string Dir;
        public readonly Rgss3a Archive;
        static readonly string[] Subs = { "Graphics", "Audio", "Data", "Fonts", "Movies" };

        GameFiles(string dir, Rgss3a archive) { Dir = dir; Archive = archive; }

        // the folder the user picked, or the game folder right inside it; null + a reason when it is not the game
        public static GameFiles Open(string dir, out string problem)
        {
            problem = null;
            if (string.IsNullOrWhiteSpace(dir)) { problem = Lang.S("블랙소울2 게임 폴더를 지정해 주세요."); return null; }
            dir = dir.Trim().Trim('"');
            if (!Directory.Exists(dir)) { problem = Lang.F("폴더가 없습니다: {0}", dir); return null; }
            List<string> cands = new List<string> { dir };
            try { cands.AddRange(Directory.GetDirectories(dir)); } catch { }
            foreach (string c in cands)
            {
                string arc = null;
                try { arc = Directory.GetFiles(c, "*.rgss3a").FirstOrDefault(); } catch { }
                bool data = File.Exists(Path.Combine(c, "Data", "System.rvdata2"));
                if (!data && arc == null) continue;
                Rgss3a archive = null;
                if (arc != null)
                {
                    try { archive = new Rgss3a(arc); }
                    catch (Exception e) { if (!data) { problem = e.Message; return null; } }
                }
                if (!data && (archive == null || !archive.Has("Data/System.rvdata2")))
                {
                    problem = Lang.F("게임 데이터(Data\\System.rvdata2)를 찾지 못했습니다: {0}", c);
                    return null;
                }
                return new GameFiles(Path.GetFullPath(c), archive);
            }
            problem = Lang.S("이 폴더에서 블랙소울2를 찾지 못했습니다.\nGame.exe와 Data 폴더(또는 Game.rgss3a)가 있는 폴더를 골라 주세요.");
            return null;
        }

        public string Describe()
        {
            return Archive != null ? Lang.F("게임 데이터 확인됨 (압축 파일 {0}에서 읽음)", Path.GetFileName(Archive.FilePath)) : Lang.S("게임 데이터 확인됨");
        }

        public List<string> List()
        {
            List<string> list = new List<string>();
            HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            string root = Dir.TrimEnd('\\') + "\\";
            foreach (string sub in Subs)
            {
                string top = Path.Combine(Dir, sub);
                if (!Directory.Exists(top)) continue;
                foreach (string f in Directory.EnumerateFiles(top, "*", SearchOption.AllDirectories))
                {
                    string rel = f.Substring(root.Length).Replace('\\', '/');
                    if (seen.Add(rel)) list.Add(rel);
                }
            }
            foreach (string f in Directory.GetFiles(Dir))
            {
                string n = Path.GetFileName(f);
                if (Regex.IsMatch(n, @"^save\d+\.rvdata2$", RegexOptions.IgnoreCase) && seen.Add(n)) list.Add(n);
            }
            if (Archive != null) foreach (string n in Archive.Names) if (seen.Add(n)) list.Add(n);
            return list;
        }

        public byte[] Read(string rel)
        {
            string p = Util.SafeJoin(Dir, rel);
            if (p != null && File.Exists(p)) return File.ReadAllBytes(p);
            if (Archive != null) return Archive.Read(rel);
            return null;
        }
    }

    // RPG Maker VX Ace RTP: the stock tiles a few maps use (the game runs without it, those tiles stay empty)
    static class Rtp
    {
        public static bool Valid(string d) { return !string.IsNullOrWhiteSpace(d) && Directory.Exists(Path.Combine(d.Trim().Trim('"'), "Graphics")); }

        public static string Find()
        {
            foreach (RegistryKey hive in new[] { Registry.LocalMachine, Registry.CurrentUser })
                foreach (string key in new[] { @"SOFTWARE\WOW6432Node\Enterbrain\RGSS3\RTP", @"SOFTWARE\Enterbrain\RGSS3\RTP" })
                {
                    try
                    {
                        using (RegistryKey k = hive.OpenSubKey(key))
                        {
                            string p = k == null ? null : k.GetValue("RPGVXAce") as string;
                            if (Valid(p)) return Path.GetFullPath(p);
                        }
                    }
                    catch { }
                }
            string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            foreach (string g in new[] { Path.Combine(pf86, @"Common Files\Enterbrain\RGSS3\RPGVXAce"), Path.Combine(pf, @"Common Files\Enterbrain\RGSS3\RPGVXAce") })
                if (Valid(g)) return g;
            // the RTP that comes with RPG Maker VX Ace on Steam
            foreach (string lib in SteamVr.SteamLibraries())
            {
                string g = Path.Combine(lib, @"steamapps\common\RPGVXAce\rtp");
                if (Valid(g)) return g;
            }
            return null;
        }

        public static List<string> List(string dir)
        {
            List<string> list = new List<string>();
            if (!Valid(dir)) return list;
            string root = Path.GetFullPath(dir).TrimEnd('\\') + "\\";
            foreach (string sub in new[] { "Graphics", "Audio", "Fonts" })
            {
                string top = Path.Combine(dir, sub);
                if (!Directory.Exists(top)) continue;
                foreach (string f in Directory.EnumerateFiles(top, "*", SearchOption.AllDirectories))
                    list.Add(f.Substring(root.Length).Replace('\\', '/'));
            }
            return list;
        }
    }

    // ------------------------------------------------------------------ the local server
    class GameServer
    {
        public const string AppName = "BlacksoulsVR";
        public readonly int Port;
        public readonly GameFiles Game;
        readonly string rtpDir, savesDir, appDir;
        readonly HttpListener listener = new HttpListener();
        public string Url { get { return "http://localhost:" + Port + "/"; } }

        static readonly Dictionary<string, string> Mime = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { ".html", "text/html; charset=utf-8" }, { ".js", "text/javascript; charset=utf-8" },
            { ".mjs", "text/javascript; charset=utf-8" }, { ".css", "text/css; charset=utf-8" },
            { ".json", "application/json; charset=utf-8" }, { ".png", "image/png" }, { ".jpg", "image/jpeg" },
            { ".jpeg", "image/jpeg" }, { ".bmp", "image/bmp" }, { ".gif", "image/gif" }, { ".ogg", "audio/ogg" },
            { ".mp3", "audio/mpeg" }, { ".wav", "audio/wav" }, { ".m4a", "audio/mp4" }, { ".mid", "audio/midi" },
            { ".ttf", "font/ttf" }, { ".otf", "font/otf" }, { ".rvdata2", "application/octet-stream" },
            { ".ogv", "video/ogg" }, { ".webm", "video/webm" }, { ".txt", "text/plain; charset=utf-8" },
            { ".svg", "image/svg+xml" }, { ".ico", "image/x-icon" },
        };

        public GameServer(GameFiles game, string rtp, string saves, string app, int port)
        {
            Game = game; rtpDir = Rtp.Valid(rtp) ? Path.GetFullPath(rtp) : null; savesDir = saves; appDir = app; Port = port;
            listener.Prefixes.Add(Url);
        }

        public void Start()
        {
            listener.Start();
            Thread t = new Thread(Loop) { IsBackground = true, Name = "http" };
            t.Start();
        }

        public void Stop() { try { listener.Stop(); listener.Close(); } catch { } }

        void Loop()
        {
            while (listener.IsListening)
            {
                HttpListenerContext ctx;
                try { ctx = listener.GetContext(); }
                catch { break; }
                ThreadPool.QueueUserWorkItem(_ => Handle(ctx));
            }
        }

        // is a launcher of ours already serving on this port
        public static bool Ours(int port)
        {
            try { return Util.HttpGet("http://localhost:" + port + "/api/ping", 1500).Contains(AppName); }
            catch { return false; }
        }

        void Handle(HttpListenerContext ctx)
        {
            HttpListenerResponse res = ctx.Response;
            try
            {
                string raw = ctx.Request.RawUrl ?? "/";
                int q = raw.IndexOf('?');
                string path = Uri.UnescapeDataString(q >= 0 ? raw.Substring(0, q) : raw);
                if (ctx.Request.HttpMethod == "POST")
                {
                    // only the game's own page saves: a POST another web page sends (its Origin, Sec-Fetch-Site) is refused
                    string origin = ctx.Request.Headers["Origin"], site = ctx.Request.Headers["Sec-Fetch-Site"];
                    if ((origin != null && !string.Equals(origin, "http://localhost:" + Port, StringComparison.OrdinalIgnoreCase))
                        || (site != null && site != "same-origin" && site != "none"))
                    {
                        Send(res, Encoding.ASCII.GetBytes("forbidden"), "text/plain", 403);
                        return;
                    }
                    Post(path, ctx.Request, res);
                    return;
                }
                if (path == "/api/ping")
                {
                    SendJson(res, Util.Json.Serialize(new Dictionary<string, object> { { "app", AppName }, { "version", BuildInfo.Version }, { "game", Game.Dir } }));
                }
                else if (path == "/api/manifest")
                {
                    Dictionary<string, object> m = new Dictionary<string, object>();
                    m["files"] = Game.List();
                    m["rtp"] = Rtp.List(rtpDir);
                    SendJson(res, Util.Json.Serialize(m));
                }
                else if (path == "/api/vrsaves" || path == "/api/worldsaves") SendJson(res, Util.Json.Serialize(new Dictionary<string, object> { { "slots", Slots(SaveFolder(path)) } }));
                else if (path.StartsWith("/api/vrsave/") || path.StartsWith("/api/worldsave/"))
                {
                    string slot = Regex.Replace(path.Substring(path.LastIndexOf('/') + 1), @"\D", "");
                    SendFile(res, slot.Length > 0 ? Path.Combine(SaveFolder(path), "slot" + slot + ".json") : null);
                }
                else if (path == "/api/settings")
                {
                    string p = Path.Combine(savesDir, "settings.json");
                    if (File.Exists(p)) SendFile(res, p); else SendJson(res, "{}");
                }
                else if (path.StartsWith("/game/"))
                {
                    byte[] data = Game.Read(path.Substring("/game/".Length));
                    if (data == null) NotFound(res); else Send(res, data, MimeOf(path));
                }
                else if (path.StartsWith("/rtp/") && rtpDir != null) SendFile(res, Util.SafeJoin(rtpDir, path.Substring("/rtp/".Length)));
                else
                {
                    string rel = path.TrimStart('/');
                    if (rel == "") rel = "index.html";
                    if (rel.EndsWith("/")) rel += "index.html";
                    SendFile(res, Util.SafeJoin(appDir, rel));
                }
            }
            catch (HttpListenerException) { }
            catch (Exception e)
            {
                try { Send(res, Encoding.UTF8.GetBytes(e.Message), "text/plain; charset=utf-8", 500); } catch { }
            }
            finally { try { res.Close(); } catch { } }
        }

        // the developer-server saves are kept apart from the game's own (saves\world)
        string SaveFolder(string path) { return path.StartsWith("/api/world") ? Path.Combine(savesDir, "world") : savesDir; }

        List<object> Slots(string folder)
        {
            List<object> slots = new List<object>();
            if (!Directory.Exists(folder)) return slots;
            foreach (string f in Directory.GetFiles(folder, "slot*.json").OrderBy(x => x, StringComparer.OrdinalIgnoreCase))
            {
                Match m = Regex.Match(Path.GetFileName(f), @"^slot(\d+)\.json$", RegexOptions.IgnoreCase);
                if (!m.Success) continue;
                object meta = new Dictionary<string, object>();
                try { meta = Util.Dict(Util.Json.DeserializeObject(File.ReadAllText(f, Encoding.UTF8)))["meta"]; } catch { }
                slots.Add(new Dictionary<string, object> { { "slot", int.Parse(m.Groups[1].Value) }, { "meta", meta ?? new Dictionary<string, object>() } });
            }
            return slots;
        }

        void Post(string path, HttpListenerRequest req, HttpListenerResponse res)
        {
            if (path == "/api/haptic")
            {
                double v = 0; int ms = 60;
                double.TryParse(req.QueryString["v"] ?? "0", NumberStyles.Float, CultureInfo.InvariantCulture, out v);
                int.TryParse(req.QueryString["ms"] ?? "60", NumberStyles.Integer, CultureInfo.InvariantCulture, out ms);
                string st = SteamVrHaptics.Vibrate(req.QueryString["h"] ?? "r", v, ms);
                SendJson(res, Util.Json.Serialize(new Dictionary<string, object> { { "ok", SteamVrHaptics.Ready }, { "status", st } }));
                return;
            }
            if (path == "/api/xr-reset")
            {
                int ended = 0;
                try { ended = BrowserXr.Reset(req.RemoteEndPoint, Port); } catch { }
                SendJson(res, "{\"ended\": " + ended + "}");
                return;
            }
            string target = null;
            if (path == "/api/settings") target = Path.Combine(savesDir, "settings.json");
            else if (path.StartsWith("/api/vrsave/") || path.StartsWith("/api/worldsave/"))
            {
                string slot = Regex.Replace(path.Substring(path.LastIndexOf('/') + 1), @"\D", "");
                if (slot.Length > 0) target = Path.Combine(SaveFolder(path), "slot" + slot + ".json");
            }
            if (target == null) { NotFound(res); return; }
            byte[] body;
            using (MemoryStream ms = new MemoryStream()) { req.InputStream.CopyTo(ms); body = ms.ToArray(); }
            try { Util.Json.DeserializeObject(Encoding.UTF8.GetString(body)); }
            catch { Send(res, Encoding.UTF8.GetBytes("{\"ok\": false, \"error\": \"bad json\"}"), Mime[".json"], 400); return; }
            Directory.CreateDirectory(Path.GetDirectoryName(target));
            // one previous generation is kept (slotN.json.bak) in case a save goes wrong
            if (File.Exists(target)) File.Copy(target, target + ".bak", true);
            File.WriteAllBytes(target, body);
            SendJson(res, "{\"ok\": true}");
        }

        static string MimeOf(string path)
        {
            string t;
            return Mime.TryGetValue(Path.GetExtension(path) ?? "", out t) ? t : "application/octet-stream";
        }

        static void Send(HttpListenerResponse res, byte[] data, string type, int code = 200)
        {
            res.StatusCode = code;
            res.ContentType = type;
            res.Headers["Cache-Control"] = "no-store";
            res.ContentLength64 = data.Length;
            res.OutputStream.Write(data, 0, data.Length);
        }

        static void SendJson(HttpListenerResponse res, string json) { Send(res, new UTF8Encoding(false).GetBytes(json), Mime[".json"]); }

        static void NotFound(HttpListenerResponse res) { Send(res, Encoding.ASCII.GetBytes("not found"), "text/plain", 404); }

        static void SendFile(HttpListenerResponse res, string path)
        {
            if (path == null || !File.Exists(path)) { NotFound(res); return; }
            Send(res, File.ReadAllBytes(path), MimeOf(path));
        }
    }

    // ------------------------------------------------------------------ the browser (WebXR lives there)
    static class Browser
    {
        static string AppPath(string exe)
        {
            foreach (RegistryKey hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
            {
                try
                {
                    using (RegistryKey k = hive.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + exe))
                    {
                        string p = k == null ? null : k.GetValue("") as string;
                        if (!string.IsNullOrEmpty(p) && File.Exists(p.Trim('"'))) return p.Trim('"');
                    }
                }
                catch { }
            }
            return null;
        }

        static IEnumerable<string> Chrome()
        {
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            yield return Path.Combine(pf, @"Google\Chrome\Application\chrome.exe");
            yield return Path.Combine(pf86, @"Google\Chrome\Application\chrome.exe");
            yield return Path.Combine(local, @"Google\Chrome\Application\chrome.exe");
            yield return AppPath("chrome.exe");
        }

        static IEnumerable<string> Edge()
        {
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            yield return Path.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe");
            yield return Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe");
            yield return AppPath("msedge.exe");
        }

        // pref: auto (Chrome, else Edge) / chrome / edge
        public static string Find(string pref, out string name)
        {
            List<KeyValuePair<string, IEnumerable<string>>> order = new List<KeyValuePair<string, IEnumerable<string>>>
            {
                new KeyValuePair<string, IEnumerable<string>>("Chrome", Chrome()),
                new KeyValuePair<string, IEnumerable<string>>("Edge", Edge()),
            };
            if (pref == "edge") order.Reverse();
            foreach (KeyValuePair<string, IEnumerable<string>> b in order)
                foreach (string p in b.Value)
                    if (!string.IsNullOrEmpty(p) && File.Exists(p)) { name = b.Key; return p; }
            name = null;
            return null;
        }

        // a window of its own (no tabs or address bar) with a profile of its own, so the game's settings stay apart
        // from the user's browsing; devtoolsPort > 0 opens the local DevTools port the auto-VR click goes through
        // xrRuntimeJson: an OpenXR runtime manifest for this browser only (the OpenXR loader in its WebXR process
        // takes XR_RUNTIME_JSON over the PC's active runtime); null = the PC's own
        public static Process Launch(string exe, string url, int devtoolsPort, string xrRuntimeJson = null)
        {
            Directory.CreateDirectory(AppPaths.ProfileDir);
            string args = "--app=\"" + url + "\" --user-data-dir=\"" + AppPaths.ProfileDir + "\" --no-first-run --no-default-browser-check --window-size=1280,800";
            if (devtoolsPort > 0) args += " --remote-debugging-port=" + devtoolsPort;
            ProcessStartInfo psi = new ProcessStartInfo(exe, args) { UseShellExecute = false };
            if (xrRuntimeJson != null) psi.EnvironmentVariables["XR_RUNTIME_JSON"] = xrRuntimeJson;
            return Process.Start(psi);
        }

        // is a browser already running on the game's profile (a new launch would only hand it the address)
        public static bool GameWindowOpen()
        {
            try
            {
                using (ManagementObjectSearcher q = new ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE Name='chrome.exe' OR Name='msedge.exe'"))
                    foreach (ManagementObject o in q.Get())
                    {
                        string c = Convert.ToString(o["CommandLine"]) ?? "";
                        if (c.IndexOf(AppPaths.ProfileDir, StringComparison.OrdinalIgnoreCase) >= 0 && c.IndexOf("--type=", StringComparison.Ordinal) < 0) return true;
                    }
            }
            catch { }
            return false;
        }
    }

    // ------------------------------------------------------------------ the browser's WebXR process
    // Chrome / Edge start only the first WebXR session after the browser started reliably on an OpenXR runtime
    // (crbug.com/40859047: later ones end at once, flicker or stop being shown) - on Windows they keep one OpenXR
    // instance for the whole life of their WebXR process. That process starts again at once when it ends, so after
    // every session the page asks for /api/xr-reset and the WebXR process of THAT browser is ended: found from the
    // request's own TCP connection, owned by the browser's network process (or the browser itself). Nothing else of
    // the browser is touched. Same as vr/server.py.
    static class BrowserXr
    {
        [DllImport("iphlpapi.dll")] static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool sort, int family, int tableClass, uint reserved);
        [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
        [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr h, uint code);
        [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

        // the pid owning the client end (clientPort -> serverPort) of a local TCP connection
        static int TcpOwner(int clientPort, int serverPort)
        {
            // address family, row size, local port, remote port and owner pid offsets (MIB_TCPROW / MIB_TCP6ROW_OWNER_PID)
            foreach (int[] f in new[] { new[] { 2, 24, 8, 16, 20 }, new[] { 23, 56, 20, 44, 52 } })
            {
                int size = 0;
                GetExtendedTcpTable(IntPtr.Zero, ref size, false, f[0], 5, 0);       // 5: TCP_TABLE_OWNER_PID_ALL
                if (size <= 0) continue;
                IntPtr buf = Marshal.AllocHGlobal(size);
                try
                {
                    if (GetExtendedTcpTable(buf, ref size, false, f[0], 5, 0) != 0) continue;
                    byte[] raw = new byte[size];
                    Marshal.Copy(buf, raw, 0, size);
                    int n = BitConverter.ToInt32(raw, 0);
                    for (int i = 0; i < n; i++)
                    {
                        int b = 4 + i * f[1];
                        if (b + f[1] > raw.Length) break;
                        int lp = raw[b + f[2]] << 8 | raw[b + f[2] + 1], rp = raw[b + f[3]] << 8 | raw[b + f[3] + 1];
                        if (lp == clientPort && rp == serverPort) return BitConverter.ToInt32(raw, b + f[4]);
                    }
                }
                finally { Marshal.FreeHGlobal(buf); }
            }
            return 0;
        }

        static bool Alive(int pid)
        {
            IntPtr h = OpenProcess(0x1000, false, pid);                  // PROCESS_QUERY_LIMITED_INFORMATION
            if (h == IntPtr.Zero) return false;
            try { uint code; return GetExitCodeProcess(h, out code) && code == 259; }   // STILL_ACTIVE
            finally { CloseHandle(h); }
        }

        static bool End(int pid)
        {
            IntPtr h = OpenProcess(0x0001, false, pid);                  // PROCESS_TERMINATE
            if (h != IntPtr.Zero) { try { TerminateProcess(h, 1); } finally { CloseHandle(h); } }
            for (int i = 0; i < 30 && Alive(pid); i++) Thread.Sleep(100);
            return !Alive(pid);
        }

        // ends the WebXR process of the browser on the other end of a request; how many were ended
        public static int Reset(IPEndPoint client, int serverPort)
        {
            if (client == null) return 0;
            int owner = TcpOwner(client.Port, serverPort);
            if (owner == 0) return 0;
            Dictionary<int, KeyValuePair<int, string>> procs = new Dictionary<int, KeyValuePair<int, string>>();
            using (ManagementObjectSearcher q = new ManagementObjectSearcher("SELECT ProcessId, ParentProcessId, CommandLine FROM Win32_Process WHERE Name='chrome.exe' OR Name='msedge.exe'"))
                foreach (ManagementObject o in q.Get())
                    procs[Convert.ToInt32(o["ProcessId"])] = new KeyValuePair<int, string>(Convert.ToInt32(o["ParentProcessId"]), Convert.ToString(o["CommandLine"]) ?? "");
            KeyValuePair<int, string> me;
            if (!procs.TryGetValue(owner, out me)) return 0;
            int browser = me.Value.IndexOf("--type=", StringComparison.Ordinal) >= 0 ? me.Key : owner;
            int ended = 0;
            foreach (KeyValuePair<int, KeyValuePair<int, string>> pr in procs)
                if (pr.Value.Key == browser && pr.Value.Value.IndexOf("device.mojom.XRDeviceService", StringComparison.Ordinal) >= 0 && End(pr.Key)) ended++;
            return ended;
        }
    }

    // Enter VR by itself: WebXR only starts a headset session from a real click, so the page's own VR button is
    // clicked through the browser's DevTools port (local only, on the game's own browser profile)
    class AutoVr
    {
        ClientWebSocket ws;
        int nextId = 1;
        readonly Action<string> log;

        public AutoVr(Action<string> log) { this.log = log; }

        // waitNotSupported: how many half seconds "VR NOT SUPPORTED" may last (SteamVR starting up from cold takes a while;
        // the browser looks for the headset again every 5 s)
        public async Task<bool> Run(int devtoolsPort, string pageUrl, int waitNotSupported = 40)
        {
            try
            {
                string wsUrl = null;
                for (int i = 0; i < 60 && wsUrl == null; i++)
                {
                    await Task.Delay(500);
                    try
                    {
                        object[] targets = Util.Json.DeserializeObject(Util.HttpGet("http://127.0.0.1:" + devtoolsPort + "/json/list", 1500)) as object[];
                        if (targets == null) continue;
                        foreach (object t in targets)
                        {
                            Dictionary<string, object> d = Util.Dict(t);
                            if (Util.Str(d, "type", "") == "page" && Util.Str(d, "url", "").StartsWith(pageUrl, StringComparison.OrdinalIgnoreCase))
                            { wsUrl = Util.Str(d, "webSocketDebuggerUrl", null); break; }
                        }
                    }
                    catch { }
                }
                if (wsUrl == null) { log(Lang.S("VR 자동 시작: 게임 창에 연결하지 못했습니다 (게임 창이 이미 열려 있었다면 닫고 다시 실행하세요). 창의 VR 버튼을 눌러 주세요.")); return false; }
                ws = new ClientWebSocket();
                await ws.ConnectAsync(new Uri(wsUrl), CancellationToken.None);
                const string probe = "(() => { const b = document.querySelector('#vrbtn button'); if (!b || !window.G || !G.ui) return null; const r = b.getBoundingClientRect(); return { text: b.textContent || '', x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()";
                // up to three clicks: the page first moves the browser onto the headset's GPU (a few seconds on laptops
                // with two GPUs) and puts the button back to ENTER VR when a start fails
                int clicks = 0, notFound = 0;
                for (int i = 0; i < 360; i++)
                {
                    Dictionary<string, object> v = Util.Dict(await Eval(probe));
                    string text = Util.Str(v, "text", "");
                    if (text.IndexOf("ENTER VR", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        if (clicks == 3) break;
                        if (clicks > 0) log(Lang.S("VR 자동 시작: 다시 시도합니다..."));
                        clicks++;
                        double x = Convert.ToDouble(v["x"]), y = Convert.ToDouble(v["y"]);
                        foreach (string type in new[] { "mouseMoved", "mousePressed", "mouseReleased" })
                        {
                            Dictionary<string, object> p = new Dictionary<string, object> { { "type", type }, { "x", x }, { "y", y }, { "button", "left" }, { "clickCount", 1 } };
                            await Call("Input.dispatchMouseEvent", p);
                        }
                        for (int k = 0; k < 60; k++)
                        {
                            await Task.Delay(500);
                            if (Convert.ToString(await Eval("!!(window.G && G.vr)")) == "True") { log(Lang.S("VR 자동 시작: 헤드셋 모드로 들어갔습니다.")); return true; }
                            if (k >= 2 && Util.Str(Util.Dict(await Eval(probe)), "text", "").IndexOf("ENTER VR", StringComparison.OrdinalIgnoreCase) >= 0) break;
                        }
                        await Task.Delay(1000);
                        continue;
                    }
                    // "VR NOT SUPPORTED" can still turn into ENTER VR when the headset connects a little later
                    bool waitMore = text.IndexOf("NOT SUPPORTED", StringComparison.OrdinalIgnoreCase) >= 0 && ++notFound < waitNotSupported;
                    if (!waitMore && (text.IndexOf("NOT", StringComparison.OrdinalIgnoreCase) >= 0 || text.IndexOf("NEEDS", StringComparison.OrdinalIgnoreCase) >= 0))
                    {
                        log(Lang.F("VR 자동 시작: 브라우저가 VR 장치를 찾지 못했습니다 ({0}). SteamVR 또는 Meta Quest Link를 먼저 켜고, OpenXR 런타임을 확인한 뒤 게임 창을 다시 여세요.", text));
                        return false;
                    }
                    await Task.Delay(500);
                }
                log(Lang.S(clicks > 0 ? "VR 자동 시작: 버튼을 눌렀지만 헤드셋 세션이 시작되지 않았습니다. 창의 VR 버튼을 직접 눌러 보세요."
                    : "VR 자동 시작: 게임 로딩이 끝나지 않았습니다. 창의 VR 버튼을 눌러 주세요."));
                return false;
            }
            catch (Exception e)
            {
                log(Lang.F("VR 자동 시작 실패: {0} - 창의 VR 버튼을 눌러 주세요.", e.Message));
                return false;
            }
            finally
            {
                try { if (ws != null) ws.Abort(); } catch { }
            }
        }

        async Task<object> Eval(string expr)
        {
            Dictionary<string, object> r = await Call("Runtime.evaluate", new Dictionary<string, object> { { "expression", expr }, { "returnByValue", true } });
            Dictionary<string, object> res = Util.Dict(Util.Dict(r.ContainsKey("result") ? r["result"] : null).ContainsKey("result") ? Util.Dict(r["result"])["result"] : null);
            return res.ContainsKey("value") ? res["value"] : null;
        }

        async Task<Dictionary<string, object>> Call(string method, Dictionary<string, object> prms)
        {
            int id = nextId++;
            Dictionary<string, object> msg = new Dictionary<string, object> { { "id", id }, { "method", method }, { "params", prms } };
            byte[] bytes = Encoding.UTF8.GetBytes(Util.Json.Serialize(msg));
            await ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
            using (CancellationTokenSource cts = new CancellationTokenSource(15000))
            {
                while (true)
                {
                    Dictionary<string, object> obj = Util.Dict(Util.Json.DeserializeObject(await Receive(cts.Token)));
                    object rid;
                    if (obj.TryGetValue("id", out rid) && Convert.ToInt32(rid) == id) return obj;
                }
            }
        }

        async Task<string> Receive(CancellationToken token)
        {
            byte[] buf = new byte[65536];
            using (MemoryStream ms = new MemoryStream())
            {
                WebSocketReceiveResult r;
                do
                {
                    r = await ws.ReceiveAsync(new ArraySegment<byte>(buf), token);
                    ms.Write(buf, 0, r.Count);
                } while (!r.EndOfMessage);
                return Encoding.UTF8.GetString(ms.ToArray());
            }
        }
    }

    // ------------------------------------------------------------------ SteamVR
    // An app manifest (.vrmanifest) listed in Steam\config\appconfig.json shows up in the SteamVR library; starting
    // it there runs this exe with --launch --vr (start the server and the game window, then enter VR)
    // Controller vibration through SteamVR. Chrome / Edge on PC cannot make a VR controller vibrate (their WebXR has
    // no haptics at all), so the page sends its vibrations here (POST /api/haptic?h=l|r&v=0..1&ms=n) and a background
    // OpenVR client of SteamVR (openvr_api.dll from the SteamVR install) pulses the controller with
    // IVRSystem::TriggerHapticPulse while a vibration lasts. Only while SteamVR runs (tried again every 5 s);
    // SteamVR's quit event lets it go at once. The same as SteamVrHaptics in vr/server.py.
    static class SteamVrHaptics
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr LoadLibrary(string path);
        [DllImport("openvr_api.dll", CallingConvention = CallingConvention.Cdecl)] static extern uint VR_InitInternal2(ref int err, int type, IntPtr startupInfo);
        [DllImport("openvr_api.dll", CallingConvention = CallingConvention.Cdecl)] static extern IntPtr VR_GetGenericInterface([MarshalAs(UnmanagedType.LPStr)] string version, ref int err);
        [DllImport("openvr_api.dll", CallingConvention = CallingConvention.Cdecl)] static extern void VR_ShutdownInternal();

        [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate uint RoleToIndexFn(int role);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int DeviceClassFn(uint device);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int IntPropFn(uint device, int prop, ref int err);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] [return: MarshalAs(UnmanagedType.I1)] delegate bool PollEventFn(IntPtr ev, uint size);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void PulseFn(uint device, uint axis, ushort micros);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void AckQuitFn();

        // VR_IVRSystem_FnTable of IVRSystem_026 (openvr_capi.h): where the functions used here sit
        const int FnRoleToIndex = 18, FnDeviceClass = 20, FnIntProp = 24, FnPollEvent = 30, FnPulse = 39, FnAckQuit = 47;
        const int EventSize = 64, EventQuit = 700, MaxDevices = 64, ClassController = 2, PropRoleHint = 3007;
        const uint NoDevice = 0xFFFFFFFF;

        static readonly object gate = new object();
        static readonly double[] until = new double[3];                 // controller role (1 left, 2 right) -> end (ms)
        static readonly float[] strength = { 0.5f, 0.5f, 0.5f };
        static readonly Stopwatch clock = Stopwatch.StartNew();
        static Thread thread;
        static volatile bool ready;
        static volatile string status = "starting";
        static bool loaded;
        static RoleToIndexFn roleToIndex;
        static DeviceClassFn deviceClass;
        static IntPropFn intProp;
        static PollEventFn pollEvent;
        static PulseFn pulse;
        static AckQuitFn ackQuit;

        public static bool Ready { get { return ready; } }

        // a vibration in a hand ("l" / "r"), strength 0..1, for ms; 0 strength: only how it is
        public static string Vibrate(string hand, double v, int ms)
        {
            if (v <= 0) return status;
            int role = hand != null && hand.StartsWith("l") ? 1 : 2;
            lock (gate)
            {
                double t = clock.Elapsed.TotalMilliseconds;
                until[role] = Math.Max(until[role], t + Math.Max(5, Math.Min(2000, ms)));
                strength[role] = (float)Math.Max(0.05, Math.Min(1.0, v));
                if (thread == null) { thread = new Thread(Run) { IsBackground = true, Name = "haptics" }; thread.Start(); }
            }
            return status;
        }

        static string DllPath()
        {
            string rt = SteamVr.RuntimeJson();
            if (rt == null) return null;
            string p = Path.Combine(Path.GetDirectoryName(rt), "bin", Environment.Is64BitProcess ? "win64" : "win32", "openvr_api.dll");
            return File.Exists(p) ? p : null;
        }

        static T Fn<T>(IntPtr table, int index) where T : class
        {
            return Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(table, index * IntPtr.Size), typeof(T)) as T;
        }

        static bool Connect()
        {
            if (!loaded)
            {
                string dll = DllPath();
                if (dll == null) { status = "SteamVR (openvr_api.dll) not found"; return false; }
                if (LoadLibrary(dll) == IntPtr.Zero) { status = "openvr_api.dll could not be loaded"; return false; }
                loaded = true;
            }
            int err = 0;
            VR_InitInternal2(ref err, 3, IntPtr.Zero);                  // 3: VRApplication_Background
            if (err != 0) { status = err == 121 ? "SteamVR is not running" : "SteamVR refused (" + err + ")"; return false; }
            IntPtr table = VR_GetGenericInterface("FnTable:IVRSystem_026", ref err);
            if (table == IntPtr.Zero || err != 0) { VR_ShutdownInternal(); status = "SteamVR has no IVRSystem_026 (" + err + ")"; return false; }
            roleToIndex = Fn<RoleToIndexFn>(table, FnRoleToIndex);
            deviceClass = Fn<DeviceClassFn>(table, FnDeviceClass);
            intProp = Fn<IntPropFn>(table, FnIntProp);
            pollEvent = Fn<PollEventFn>(table, FnPollEvent);
            pulse = Fn<PulseFn>(table, FnPulse);
            ackQuit = Fn<AckQuitFn>(table, FnAckQuit);
            status = "connected";
            return true;
        }

        // controller role (1 left, 2 right) -> device (NoDevice: none). SteamVR gives a background client no roles
        // (GetTrackedDeviceIndexForControllerRole: none), so each controller's own role hint is asked too
        static uint[] Controllers()
        {
            uint[] found = { NoDevice, roleToIndex(1), roleToIndex(2) };
            if (found[1] != NoDevice && found[2] != NoDevice) return found;
            for (uint d = 0; d < MaxDevices; d++)
            {
                if (deviceClass(d) != ClassController) continue;
                int err = 0;
                int hint = intProp(d, PropRoleHint, ref err);
                if ((hint == 1 || hint == 2) && found[hint] == NoDevice) found[hint] = d;
            }
            return found;
        }

        static void Run()
        {
            double lastTry = -10000, seen = -10000;
            uint[] devices = { NoDevice, NoDevice, NoDevice };
            IntPtr ev = Marshal.AllocHGlobal(256);
            while (true)
            {
                try
                {
                    if (!ready)
                    {
                        Thread.Sleep(200);
                        if (clock.Elapsed.TotalMilliseconds - lastTry < 5000) continue;
                        lastTry = clock.Elapsed.TotalMilliseconds;
                        if (!SteamVr.Running()) { status = "SteamVR is not running"; continue; }
                        ready = Connect();
                        continue;
                    }
                    Thread.Sleep(5);
                    bool quit = false;
                    while (pollEvent(ev, EventSize)) if (Marshal.ReadInt32(ev) == EventQuit) quit = true;
                    if (quit)
                    {
                        // SteamVR is closing: let it go (and look for it again later)
                        ackQuit(); VR_ShutdownInternal(); ready = false; status = "SteamVR closed";
                        continue;
                    }
                    double t = clock.Elapsed.TotalMilliseconds;
                    if (t - seen > 1000)
                    {
                        // the controllers (they come and go), and which ones there are for the status
                        seen = t;
                        devices = Controllers();
                        List<string> found = new List<string>();
                        if (devices[1] != NoDevice) found.Add("left");
                        if (devices[2] != NoDevice) found.Add("right");
                        status = "connected, controllers: " + (found.Count > 0 ? string.Join(", ", found) : "none");
                    }
                    for (int role = 1; role <= 2; role++)
                    {
                        bool on; float sv;
                        lock (gate) { on = t < until[role]; sv = strength[role]; }
                        if (on && devices[role] != NoDevice) pulse(devices[role], 0, (ushort)(1000 + 2999 * sv));
                    }
                }
                catch (Exception e) { status = "error: " + e.Message; ready = false; Thread.Sleep(1000); }
            }
        }

        // the launcher is closing: let SteamVR go
        public static void Shutdown()
        {
            try { if (ready) { ready = false; VR_ShutdownInternal(); } } catch { }
        }
    }

    static class SteamVr
    {
        public const string AppKey = "user.blacksoulsvr.launcher";
        public static string ManifestPath { get { return Path.Combine(AppPaths.DataDir, "BlacksoulsVR.vrmanifest"); } }
        public static string ThumbPath { get { return Path.Combine(AppPaths.DataDir, "steamvr_thumb.png"); } }

        public static string SteamDir()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam"))
                {
                    string p = k == null ? null : k.GetValue("SteamPath") as string;
                    if (!string.IsNullOrEmpty(p) && Directory.Exists(p)) return Path.GetFullPath(p.Replace('/', '\\'));
                }
            }
            catch { }
            return null;
        }

        public static List<string> SteamLibraries()
        {
            List<string> libs = new List<string>();
            string steam = SteamDir();
            if (steam == null) return libs;
            libs.Add(steam);
            try
            {
                string vdf = Path.Combine(steam, @"steamapps\libraryfolders.vdf");
                if (File.Exists(vdf))
                    foreach (Match m in Regex.Matches(File.ReadAllText(vdf), "\"path\"\\s+\"([^\"]+)\""))
                    {
                        string p = m.Groups[1].Value.Replace("\\\\", "\\");
                        if (Directory.Exists(p) && !libs.Contains(p, StringComparer.OrdinalIgnoreCase)) libs.Add(p);
                    }
            }
            catch { }
            return libs;
        }

        public static string AppConfigPath()
        {
            string s = SteamDir();
            return s == null ? null : Path.Combine(s, @"config\appconfig.json");
        }

        public static bool SteamVrInstalled()
        {
            return SteamLibraries().Any(l => Directory.Exists(Path.Combine(l, @"steamapps\common\SteamVR")));
        }

        public static bool Running()
        {
            return Process.GetProcessesByName("vrserver").Length > 0 || Process.GetProcessesByName("vrmonitor").Length > 0;
        }

        // SteamVR's own OpenXR runtime manifest (steamapps\common\SteamVR\steamxr_win64.json), or null
        public static string RuntimeJson()
        {
            foreach (string l in SteamLibraries())
            {
                string p = Path.Combine(l, @"steamapps\common\SteamVR\steamxr_win64.json");
                if (File.Exists(p)) return p;
            }
            return null;
        }

        // the OpenXR runtime the browser's WebXR uses (SteamVR, Meta/Oculus, ...)
        public static string OpenXrRuntime()
        {
            try
            {
                using (RegistryKey k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Khronos\OpenXR\1"))
                {
                    string p = k == null ? null : k.GetValue("ActiveRuntime") as string;
                    if (string.IsNullOrEmpty(p)) return Lang.S("없음 (VR 런타임이 설치되지 않았거나 지정되지 않음)");
                    string l = p.ToLowerInvariant();
                    if (l.Contains("steamvr") || l.Contains("steamxr")) return "SteamVR";
                    if (l.Contains("oculus") || l.Contains("meta")) return "Meta (Oculus)";
                    if (l.Contains("mixedreality")) return "Windows Mixed Reality";
                    if (l.Contains("virtual desktop") || l.Contains("virtualdesktop")) return "Virtual Desktop";
                    return p;
                }
            }
            catch { return Lang.S("알 수 없음"); }
        }

        public static void WriteManifest()
        {
            MakeThumb();
            Dictionary<string, object> app = new Dictionary<string, object>
            {
                { "app_key", AppKey },
                { "launch_type", "binary" },
                { "binary_path_windows", AppPaths.ExePath },
                { "working_directory", AppPaths.ExeDir },
                { "arguments", "--launch --vr" },
                { "is_dashboard_overlay", false },
                { "image_path", ThumbPath },
                { "strings", new Dictionary<string, object> {
                    { "en_us", new Dictionary<string, object> { { "name", "BLACK SOULS II VR" }, { "description", "BLACK SOULS II in VR (needs your own copy of the game)" } } },
                    { "ko_kr", new Dictionary<string, object> { { "name", "BLACK SOULS II VR" }, { "description", "블랙소울2 VR (원작 게임 필요)" } } },
                    { "ja_jp", new Dictionary<string, object> { { "name", "BLACK SOULS II VR" }, { "description", "ブラックソウルズ2 VR (原作ゲームが必要)" } } },
                    { "zh_cn", new Dictionary<string, object> { { "name", "BLACK SOULS II VR" }, { "description", "黑魂2 VR (需要原作游戏)" } } },
                } },
            };
            Dictionary<string, object> root = new Dictionary<string, object> { { "source", "user" }, { "applications", new List<object> { app } } };
            File.WriteAllText(ManifestPath, Util.Json.Serialize(root), new UTF8Encoding(false));
        }

        // a title card drawn here (no game art is shipped)
        static void MakeThumb()
        {
            using (Bitmap bmp = new Bitmap(460, 215))
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                using (LinearGradientBrush bg = new LinearGradientBrush(new Rectangle(0, 0, 460, 215), Color.FromArgb(18, 6, 8), Color.FromArgb(70, 8, 14), 70f))
                    g.FillRectangle(bg, 0, 0, 460, 215);
                using (Font f1 = new Font("Georgia", 34, FontStyle.Bold))
                using (Font f2 = new Font("Georgia", 46, FontStyle.Bold))
                using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center })
                {
                    g.DrawString("BLACK SOULS II", f1, new SolidBrush(Color.FromArgb(230, 220, 205)), new RectangleF(0, 38, 460, 60), sf);
                    g.DrawString("VR", f2, new SolidBrush(Color.FromArgb(200, 30, 40)), new RectangleF(0, 98, 460, 80), sf);
                }
                bmp.Save(ThumbPath, System.Drawing.Imaging.ImageFormat.Png);
            }
        }

        static List<object> Paths(Dictionary<string, object> root)
        {
            object v;
            List<object> list = new List<object>();
            if (root.TryGetValue("manifest_paths", out v) && v is IEnumerable && !(v is string))
                foreach (object x in (IEnumerable)v) list.Add(x);
            return list;
        }

        static Dictionary<string, object> ReadConfig(string cfg)
        {
            if (!File.Exists(cfg)) return new Dictionary<string, object>();
            return Util.Dict(Util.Json.DeserializeObject(File.ReadAllText(cfg, Encoding.UTF8)));
        }

        static bool Same(object a, string b)
        {
            return a != null && string.Equals(Convert.ToString(a).Replace('/', '\\'), b.Replace('/', '\\'), StringComparison.OrdinalIgnoreCase);
        }

        public static bool IsRegistered(string cfg)
        {
            try { return cfg != null && Paths(ReadConfig(cfg)).Any(x => Same(x, ManifestPath)); } catch { return false; }
        }

        public static void Register(string cfg)
        {
            WriteManifest();
            Dictionary<string, object> root = ReadConfig(cfg);
            List<object> list = Paths(root);
            if (!list.Any(x => Same(x, ManifestPath))) list.Add(ManifestPath);
            root["manifest_paths"] = list;
            Directory.CreateDirectory(Path.GetDirectoryName(cfg));
            // the file as Steam had it, once, in case anything goes wrong
            if (File.Exists(cfg) && !File.Exists(cfg + ".blacksoulsvr.bak")) File.Copy(cfg, cfg + ".blacksoulsvr.bak");
            File.WriteAllText(cfg, Util.Json.Serialize(root), new UTF8Encoding(false));
        }

        public static void Unregister(string cfg)
        {
            if (!File.Exists(cfg)) return;
            Dictionary<string, object> root = ReadConfig(cfg);
            List<object> list = Paths(root).Where(x => !Same(x, ManifestPath)).ToList();
            root["manifest_paths"] = list;
            File.WriteAllText(cfg, Util.Json.Serialize(root), new UTF8Encoding(false));
        }
    }

    // ------------------------------------------------------------------ the window
    class LauncherForm : Form
    {
        readonly Options opt;
        readonly LauncherConfig cfg = LauncherConfig.Load();
        GameServer server;
        Process browser;
        DateTime browserStart;
        readonly TextBox gameBox = new TextBox(), rtpBox = new TextBox(), logBox = new TextBox();
        readonly Label gameState = new Label(), rtpState = new Label(), xrLabel = new Label();
        readonly Label subLabel = new Label(), langLabel = new Label(), gameLabel = new Label(), rtpLabel = new Label(), browserLabel = new Label(), portLabel = new Label();
        readonly ComboBox browserBox = new ComboBox(), langBox = new ComboBox();
        readonly NumericUpDown portBox = new NumericUpDown();
        readonly CheckBox autoVrBox = new CheckBox(), steamRtBox = new CheckBox();
        readonly Button launchBtn = new Button(), steamBtn = new Button(), savesBtn = new Button(), updateBtn = new Button();
        string[] newer;                 // a newer version on the share page and that page ({ version, page }), or null
        public Task UpdateCheck;
        Button gameBrowse, rtpBrowse;
        readonly System.Windows.Forms.Timer watch = new System.Windows.Forms.Timer();

        public LauncherForm(Options o)
        {
            opt = o;
            Lang.Current = Array.IndexOf(Lang.Codes, opt.LangOpt) >= 0 ? opt.LangOpt : Array.IndexOf(Lang.Codes, cfg.Lang) >= 0 ? cfg.Lang : Lang.Default();
            AutoScaleDimensions = new SizeF(96f, 96f);
            AutoScaleMode = AutoScaleMode.Dpi;
            Font = new Font(FontFamilyFor(Lang.Current), 9.5f);
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(840, 720);
            MinimumSize = new Size(720, 620);
            BackColor = Color.FromArgb(24, 22, 24);
            ForeColor = Color.FromArgb(230, 222, 210);
            try { Icon = Icon.ExtractAssociatedIcon(AppPaths.ExePath); } catch { }

            TableLayoutPanel t = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(14), ColumnCount = 2, RowCount = 12, AutoSize = false };
            t.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            t.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            Controls.Add(t);

            Label title = new Label { Text = "BLACK SOULS II  VR", Font = new Font("Georgia", 18, FontStyle.Bold), ForeColor = Color.FromArgb(214, 60, 60), AutoSize = true, Margin = new Padding(0, 0, 0, 2) };
            t.Controls.Add(title, 0, 0);
            // the language of this window and of the VR version's own menus (the game's own text stays as it is)
            FlowLayoutPanel langRow = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Anchor = AnchorStyles.Top | AnchorStyles.Right, Margin = new Padding(0, 4, 0, 0) };
            langLabel.AutoSize = true; langLabel.Margin = new Padding(3, 7, 3, 3); langLabel.ForeColor = Color.FromArgb(214, 200, 176);
            langBox.DropDownStyle = ComboBoxStyle.DropDownList;
            langBox.Items.AddRange(Lang.Names);
            langBox.SelectedIndex = Array.IndexOf(Lang.Codes, Lang.Current);
            langBox.Width = 130;
            langBox.SelectedIndexChanged += (s, e) =>
            {
                if (langBox.SelectedIndex < 0) return;
                Lang.Current = Lang.Codes[langBox.SelectedIndex];
                ApplyTexts();
                SaveConfig();
            };
            langRow.Controls.Add(langLabel); langRow.Controls.Add(langBox);
            t.Controls.Add(langRow, 1, 0);
            subLabel.AutoSize = true; subLabel.MaximumSize = new Size(800, 0); subLabel.ForeColor = Color.FromArgb(170, 162, 150); subLabel.Margin = new Padding(0, 0, 0, 10);
            t.Controls.Add(subLabel, 0, 1); t.SetColumnSpan(subLabel, 2);

            StyleLabel(gameLabel);
            t.Controls.Add(gameLabel, 0, 2); t.SetColumnSpan(gameLabel, 2);
            Style(gameBox); gameBox.Text = !string.IsNullOrEmpty(opt.Game) ? opt.Game : cfg.GameDir;
            gameBox.TextChanged += (s, e) => CheckGame();
            t.Controls.Add(gameBox, 0, 3);
            gameBrowse = MakeButton((s, e) => Browse(gameBox, Lang.S("블랙소울2 게임 폴더를 고르세요")));
            t.Controls.Add(gameBrowse, 1, 3);
            gameState.AutoSize = true; gameState.MaximumSize = new Size(800, 0); gameState.Margin = new Padding(3, 2, 3, 10);
            t.Controls.Add(gameState, 0, 4); t.SetColumnSpan(gameState, 2);

            StyleLabel(rtpLabel);
            t.Controls.Add(rtpLabel, 0, 5); t.SetColumnSpan(rtpLabel, 2);
            Style(rtpBox); rtpBox.Text = string.IsNullOrEmpty(cfg.RtpDir) ? (Rtp.Find() ?? "") : cfg.RtpDir;
            rtpBox.TextChanged += (s, e) => CheckRtp();
            t.Controls.Add(rtpBox, 0, 6);
            rtpBrowse = MakeButton((s, e) => Browse(rtpBox, Lang.S("RPG Maker VX Ace RTP 폴더(RPGVXAce)를 고르세요")));
            t.Controls.Add(rtpBrowse, 1, 6);
            rtpState.AutoSize = true; rtpState.MaximumSize = new Size(800, 0); rtpState.Margin = new Padding(3, 2, 3, 10);
            t.Controls.Add(rtpState, 0, 7); t.SetColumnSpan(rtpState, 2);

            FlowLayoutPanel opts = new FlowLayoutPanel { AutoSize = true, WrapContents = true, Margin = new Padding(0, 0, 0, 8) };
            browserLabel.AutoSize = true; browserLabel.Margin = new Padding(3, 7, 3, 3);
            opts.Controls.Add(browserLabel);
            browserBox.DropDownStyle = ComboBoxStyle.DropDownList;
            browserBox.Width = 330;
            opts.Controls.Add(browserBox);
            portLabel.AutoSize = true; portLabel.Margin = new Padding(3, 7, 3, 3);
            opts.Controls.Add(portLabel);
            portBox.Minimum = 1024; portBox.Maximum = 65535; portBox.Width = 80;
            portBox.Value = Math.Min(65535, Math.Max(1024, opt.Port > 0 ? opt.Port : cfg.Port));
            opts.Controls.Add(portBox);
            autoVrBox.AutoSize = true; autoVrBox.Checked = cfg.AutoVr || opt.Vr; autoVrBox.Margin = new Padding(16, 6, 3, 3);
            opts.Controls.Add(autoVrBox);
            // only the game's own window uses SteamVR: the PC's active runtime (Virtual Desktop, Meta...) stays as it is
            steamRtBox.AutoSize = true; steamRtBox.Checked = cfg.SteamVrRuntime; steamRtBox.Margin = new Padding(16, 6, 3, 3);
            steamRtBox.Enabled = SteamVr.RuntimeJson() != null || cfg.SteamVrRuntime;
            steamRtBox.CheckedChanged += (s, e) => { SaveConfig(); ApplyTexts(); };
            opts.Controls.Add(steamRtBox);
            t.Controls.Add(opts, 0, 8); t.SetColumnSpan(opts, 2);

            FlowLayoutPanel btns = new FlowLayoutPanel { AutoSize = true, WrapContents = true, Margin = new Padding(0, 0, 0, 6) };
            launchBtn.Font = new Font(FontFamilyFor(Lang.Current), 12f, FontStyle.Bold);
            launchBtn.AutoSize = true; launchBtn.MinimumSize = new Size(200, 48); launchBtn.Padding = new Padding(10, 0, 10, 0);
            launchBtn.BackColor = Color.FromArgb(150, 24, 30); launchBtn.ForeColor = Color.White;
            launchBtn.FlatStyle = FlatStyle.Flat;
            launchBtn.Click += async (s, e) => await LaunchAsync();
            btns.Controls.Add(launchBtn);
            steamBtn.AutoSize = true; steamBtn.MinimumSize = new Size(200, 48); steamBtn.Padding = new Padding(8, 0, 8, 0); steamBtn.FlatStyle = FlatStyle.Flat;
            steamBtn.Click += (s, e) => ToggleSteamVr();
            btns.Controls.Add(steamBtn);
            savesBtn.AutoSize = true; savesBtn.MinimumSize = new Size(150, 48); savesBtn.Padding = new Padding(8, 0, 8, 0); savesBtn.FlatStyle = FlatStyle.Flat;
            savesBtn.Click += (s, e) => { Directory.CreateDirectory(AppPaths.SavesDir); Process.Start("explorer.exe", "\"" + AppPaths.SavesDir + "\""); };
            btns.Controls.Add(savesBtn);
            updateBtn.AutoSize = true; updateBtn.MinimumSize = new Size(150, 48); updateBtn.Padding = new Padding(8, 0, 8, 0); updateBtn.FlatStyle = FlatStyle.Flat;
            updateBtn.BackColor = Color.FromArgb(176, 132, 40); updateBtn.ForeColor = Color.White; updateBtn.Visible = false;
            updateBtn.Click += (s, e) => { if (newer != null) try { Process.Start(newer[1]); } catch (Exception x) { Log(x.Message); } };
            btns.Controls.Add(updateBtn);
            t.Controls.Add(btns, 0, 9); t.SetColumnSpan(btns, 2);

            xrLabel.AutoSize = true; xrLabel.MaximumSize = new Size(800, 0); xrLabel.ForeColor = Color.FromArgb(170, 162, 150); xrLabel.Margin = new Padding(3, 0, 3, 6);
            t.Controls.Add(xrLabel, 0, 10); t.SetColumnSpan(xrLabel, 2);

            logBox.Multiline = true; logBox.ReadOnly = true; logBox.ScrollBars = ScrollBars.Vertical; logBox.Dock = DockStyle.Fill;
            logBox.BackColor = Color.FromArgb(12, 11, 12); logBox.ForeColor = Color.FromArgb(200, 194, 182); logBox.BorderStyle = BorderStyle.FixedSingle;
            t.RowStyles.Clear();
            for (int i = 0; i < 11; i++) t.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            t.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            t.Controls.Add(logBox, 0, 11); t.SetColumnSpan(logBox, 2);

            browserBox.Items.AddRange(new object[] { "", "Chrome", "Edge" });
            browserBox.SelectedIndex = cfg.Browser == "chrome" ? 1 : cfg.Browser == "edge" ? 2 : 0;
            ApplyTexts();
            Log(Lang.F("버전 {0}   ·   세이브 폴더: {1}", BuildInfo.Version, AppPaths.SavesDir));
            // (not for the build's own picture of the window, unless a test gives its version.json)
            if (opt.Screenshot == null || opt.UpdateUrl != null) UpdateCheck = CheckUpdateAsync(opt.UpdateUrl ?? NewVersion.Source);

            watch.Interval = 2000;
            watch.Tick += (s, e) => WatchBrowser();
            FormClosing += (s, e) => { if (server != null) server.Stop(); SteamVrHaptics.Shutdown(); };
            Shown += async (s, e) =>
            {
                ActiveControl = launchBtn;
                // keep the SteamVR entry pointing at this exe if the folder was moved
                try { if (File.Exists(SteamVr.ManifestPath)) SteamVr.WriteManifest(); } catch { }
                if (opt.Launch && opt.Screenshot == null)
                {
                    WindowState = FormWindowState.Minimized;
                    await LaunchAsync();
                }
            };
        }

        // the share page's version: newer than this one - the button to its page
        async Task CheckUpdateAsync(string url)
        {
            string[] latest = null;
            try { latest = await Task.Run(() => NewVersion.Latest(url)); } catch { }
            if (IsDisposed) return;
            if (latest == null) { Log(Lang.S("최신 버전인지 확인하지 못했습니다 (인터넷에 연결되지 않았거나 받는 곳에 닿지 않음).")); return; }
            if (NewVersion.Key(latest[0]) <= NewVersion.Key(BuildInfo.Version)) { Log(Lang.S("최신 버전입니다.")); return; }
            newer = latest;
            ApplyTexts();
            updateBtn.Visible = true;
            Log(Lang.F("새 버전이 나왔습니다: {0} (지금 {1}). '새 버전 받기'를 누르면 받는 곳이 열립니다.", newer[0], BuildInfo.Version));
        }

        // every text of the window in the chosen language
        void ApplyTexts()
        {
            string fam = FontFamilyFor(Lang.Current);
            if (Font.Name != fam) { Font = new Font(fam, 9.5f); launchBtn.Font = new Font(fam, 12f, FontStyle.Bold); }
            Text = Lang.F("BLACK SOULS II VR 런처  v{0}", BuildInfo.Version);
            subLabel.Text = Lang.S("원작 게임 폴더는 읽기만 합니다 (아무것도 바꾸거나 저장하지 않음). VR 세이브·설정은 이 프로그램 폴더의 saves에 저장됩니다.");
            langLabel.Text = Lang.S("언어 (Language)");
            gameLabel.Text = Lang.S("블랙소울2 게임 폴더 (Game.exe가 있는 폴더)");
            rtpLabel.Text = Lang.S("RPG Maker VX Ace RTP 폴더 (선택: 일부 맵의 기본 타일. 없어도 실행됩니다)");
            gameBrowse.Text = rtpBrowse.Text = Lang.S("찾아보기...");
            browserLabel.Text = Lang.S("브라우저");
            browserBox.Items[0] = Lang.S("자동 (Chrome, 없으면 Edge)");
            portLabel.Text = "   " + Lang.S("포트");
            autoVrBox.Text = Lang.S("게임 창이 뜨면 VR 자동 시작");
            steamRtBox.Text = Lang.S("SteamVR로 실행 (VR 안에서 SteamVR 대시보드로 데스크톱 보기)");
            launchBtn.Text = Lang.S("실행 (Launch)");
            savesBtn.Text = Lang.S("세이브 폴더 열기");
            if (newer != null) updateBtn.Text = Lang.F("새 버전 받기 ({0})", newer[0]);
            xrLabel.Text = steamRtBox.Checked && SteamVr.RuntimeJson() != null
                ? Lang.F("VR 런타임(OpenXR): SteamVR (이 게임만 - 위 설정)   ·   PC 기본: {0}", SteamVr.OpenXrRuntime())
                : Lang.F("VR 런타임(OpenXR): {0}   ·   게임은 브라우저의 WebXR로 이 런타임을 씁니다", SteamVr.OpenXrRuntime());
            UpdateSteamButton();
            CheckGame(); CheckRtp();
        }

        static void Style(TextBox b)
        {
            b.Dock = DockStyle.Fill; b.Margin = new Padding(3, 3, 6, 3);
            b.BackColor = Color.FromArgb(40, 37, 40); b.ForeColor = Color.FromArgb(235, 228, 216); b.BorderStyle = BorderStyle.FixedSingle;
        }

        // a UI font that has that language's letters in their own shapes (Japanese kanji in a Japanese font, ...)
        static string FontFamilyFor(string lang)
        {
            string[] want = lang == "ja" ? new[] { "Yu Gothic UI", "Meiryo UI", "MS UI Gothic" }
                : lang == "zh" ? new[] { "Microsoft YaHei UI", "Microsoft YaHei", "SimHei" }
                : lang == "en" ? new[] { "Segoe UI" } : new[] { "Malgun Gothic" };
            foreach (string f in want)
                using (Font t = new Font(f, 9.5f)) if (string.Equals(t.Name, f, StringComparison.OrdinalIgnoreCase)) return f;
            return "Malgun Gothic";
        }

        static void StyleLabel(Label l)
        {
            l.AutoSize = true; l.MaximumSize = new Size(800, 0); l.Margin = new Padding(3, 4, 3, 2); l.ForeColor = Color.FromArgb(214, 200, 176);
        }

        static Button MakeButton(EventHandler click)
        {
            Button b = new Button { AutoSize = true, FlatStyle = FlatStyle.Flat, Margin = new Padding(0, 2, 3, 3) };
            b.Click += click;
            return b;
        }

        void Browse(TextBox box, string desc)
        {
            using (FolderBrowserDialog d = new FolderBrowserDialog { Description = desc, ShowNewFolderButton = false })
            {
                if (Directory.Exists(box.Text.Trim().Trim('"'))) d.SelectedPath = box.Text.Trim().Trim('"');
                if (d.ShowDialog(this) == DialogResult.OK) box.Text = d.SelectedPath;
            }
        }

        GameFiles CheckGame()
        {
            string problem;
            GameFiles g = GameFiles.Open(gameBox.Text, out problem);
            if (g != null)
            {
                gameState.Text = "✔ " + g.Describe() + (string.Equals(g.Dir, Path.GetFullPath(gameBox.Text.Trim().Trim('"')), StringComparison.OrdinalIgnoreCase) ? "" : " - " + g.Dir);
                gameState.ForeColor = Color.FromArgb(120, 200, 120);
            }
            else
            {
                gameState.Text = "✘ " + problem.Replace("\n", " ");
                gameState.ForeColor = Color.FromArgb(230, 110, 100);
            }
            return g;
        }

        void CheckRtp()
        {
            bool ok = Rtp.Valid(rtpBox.Text);
            rtpState.Text = ok ? "✔ " + Lang.S("RTP 확인됨") : rtpBox.Text.Trim() == "" ? "· " + Lang.S("RTP 없음 (일부 맵의 기본 타일이 비어 보일 수 있음 - 무료 'RPG Maker VX Ace RTP'를 설치하면 자동으로 찾습니다)") : "✘ " + Lang.S("이 폴더에 RTP(Graphics 폴더)가 없습니다");
            rtpState.ForeColor = ok ? Color.FromArgb(120, 200, 120) : Color.FromArgb(200, 170, 110);
        }

        void UpdateSteamButton()
        {
            bool reg = SteamVr.IsRegistered(SteamVr.AppConfigPath());
            steamBtn.Text = reg ? Lang.S("SteamVR 등록 해제") : Lang.S("SteamVR 라이브러리에 등록");
            steamBtn.Enabled = SteamVr.SteamDir() != null;
        }

        void ToggleSteamVr()
        {
            string cfgPath = SteamVr.AppConfigPath();
            if (cfgPath == null) { MessageBox.Show(this, Lang.S("Steam을 찾지 못했습니다."), "SteamVR"); return; }
            if (SteamVr.Running())
            {
                MessageBox.Show(this, Lang.S("SteamVR이 켜져 있습니다. SteamVR을 완전히 끈 뒤 다시 눌러 주세요.\n(켜져 있는 동안 바꾸면 SteamVR이 종료될 때 되돌려 버립니다)"), "SteamVR");
                return;
            }
            try
            {
                if (SteamVr.IsRegistered(cfgPath))
                {
                    SteamVr.Unregister(cfgPath);
                    Log(Lang.S("SteamVR 라이브러리에서 뺐습니다."));
                }
                else
                {
                    if (!SteamVr.SteamVrInstalled()) Log(Lang.S("참고: SteamVR이 설치되어 있지 않은 것 같습니다. 설치 후 라이브러리에 나타납니다."));
                    SaveConfig();
                    SteamVr.Register(cfgPath);
                    Log(Lang.S("SteamVR 라이브러리에 'BLACK SOULS II VR'을 등록했습니다. SteamVR에서 실행하면 서버와 게임 창이 뜨고 VR로 들어갑니다. (이 폴더를 옮기면 이 런처를 한 번 다시 실행하세요)"));
                }
            }
            catch (Exception e) { MessageBox.Show(this, Lang.F("SteamVR 설정을 바꾸지 못했습니다: {0}", e.Message), "SteamVR"); }
            UpdateSteamButton();
        }

        void SaveConfig()
        {
            cfg.GameDir = gameBox.Text.Trim().Trim('"');
            cfg.RtpDir = rtpBox.Text.Trim().Trim('"');
            cfg.Browser = browserBox.SelectedIndex == 1 ? "chrome" : browserBox.SelectedIndex == 2 ? "edge" : "auto";
            cfg.Port = (int)portBox.Value;
            cfg.AutoVr = autoVrBox.Checked;
            cfg.SteamVrRuntime = steamRtBox.Checked;
            cfg.Lang = Lang.Current;
            try { cfg.Save(); } catch (Exception e) { Log(Lang.F("설정을 저장하지 못했습니다: {0}", e.Message)); }
        }

        async Task LaunchAsync()
        {
            GameFiles game = CheckGame();
            if (game == null)
            {
                WindowState = FormWindowState.Normal;
                MessageBox.Show(this, gameState.Text.TrimStart('✘', ' '), Lang.S("게임 폴더"));
                return;
            }
            SaveConfig();
            int port = cfg.Port;
            string rtp = Rtp.Valid(rtpBox.Text) ? rtpBox.Text.Trim().Trim('"') : null;
            if (server != null && (server.Port != port || !string.Equals(server.Game.Dir, game.Dir, StringComparison.OrdinalIgnoreCase)))
            {
                server.Stop(); server = null;
            }
            string url = "http://localhost:" + port + "/";
            if (server == null)
            {
                try
                {
                    server = new GameServer(game, rtp, AppPaths.SavesDir, AppPaths.AppDir, port);
                    server.Start();
                    Log(Lang.F("서버 실행: {0}  (게임 폴더 {1})", url, game.Dir + (rtp != null ? ", RTP " + rtp : "")));
                }
                catch (Exception e)
                {
                    server = null;
                    if (GameServer.Ours(port)) Log(Lang.F("이미 실행 중인 런처가 포트 {0}에서 게임을 열고 있습니다 - 그 서버를 씁니다.", port));
                    else
                    {
                        WindowState = FormWindowState.Normal;
                        MessageBox.Show(this, Lang.F("포트 {0}을(를) 열지 못했습니다 ({1}).\n다른 프로그램이 쓰고 있다면 포트 번호를 바꿔 보세요.", port, e.Message), Lang.S("서버"));
                        return;
                    }
                }
            }
            if (!File.Exists(Path.Combine(AppPaths.AppDir, "index.html")))
            {
                MessageBox.Show(this, Lang.S("app 폴더가 없습니다. 공유 파일을 압축을 푼 그대로 두고 실행해 주세요."), Lang.S("파일 누락"));
                return;
            }
            string bname;
            string exe = Browser.Find(cfg.Browser, out bname);
            if (exe == null)
            {
                WindowState = FormWindowState.Normal;
                MessageBox.Show(this, Lang.S("Chrome 또는 Edge를 찾지 못했습니다. 둘 중 하나를 설치해 주세요 (VR은 브라우저의 WebXR로 돌아갑니다)."), Lang.S("브라우저"));
                return;
            }
            bool autoVr = cfg.AutoVr || opt.Vr;
            int devtools = autoVr ? Util.FreePort() : 0;
            // SteamVR: the option, or started from the SteamVR library (SteamVR is what is running then)
            string runtime = null;
            if (cfg.SteamVrRuntime || opt.Launch)
            {
                runtime = SteamVr.RuntimeJson();
                if (runtime != null) Log(Lang.S("VR 런타임: SteamVR (이 게임 창만). SteamVR이 꺼져 있으면 게임 창이 열릴 때 켜집니다."));
                else if (cfg.SteamVrRuntime) Log(Lang.S("SteamVR을 찾지 못해 PC 기본 VR 런타임으로 실행합니다."));
                if (runtime != null && Browser.GameWindowOpen()) Log(Lang.S("게임 창이 이미 열려 있어 VR 런타임 설정이 그 창에는 적용되지 않습니다. 게임 창을 닫고 다시 실행하세요."));
            }
            try
            {
                // the game's own menus and notices follow the launcher's language (its dialogue never changes)
                browser = Browser.Launch(exe, url + "?lang=" + Lang.Current, devtools, runtime);
                browserStart = DateTime.Now;
                watch.Start();
                Log(Lang.F("{0}로 게임 창을 열었습니다.", bname) + (autoVr ? Lang.S(" VR 자동 시작을 기다립니다...") : Lang.S(" 창 아래쪽의 VR 버튼을 누르면 헤드셋 모드로 들어갑니다.")));
            }
            catch (Exception e) { Log(Lang.F("브라우저를 열지 못했습니다: {0}", e.Message)); return; }
            if (autoVr) await new AutoVr(Log).Run(devtools, url, runtime != null ? 120 : 40);
        }

        // started from SteamVR: when its game window is closed, the launcher goes too
        void WatchBrowser()
        {
            if (browser == null || !opt.Launch) return;
            try
            {
                if (browser.HasExited && (DateTime.Now - browserStart).TotalSeconds > 10) Close();
            }
            catch { }
        }

        void Log(string s)
        {
            if (InvokeRequired) { BeginInvoke(new Action<string>(Log), s); return; }
            logBox.AppendText("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + s + Environment.NewLine);
        }
    }

    // ------------------------------------------------------------------ build check (no window)
    // BlacksoulsVR.exe --selftest --game <game folder> --saves <temp folder> --log <file> [--port n] [--test-appconfig <file>]
    static class SelfTest
    {
        public static int Run(Options o)
        {
            StringBuilder log = new StringBuilder();
            bool ok = true;
            Action<bool, string> check = (pass, what) => { log.AppendLine((pass ? "PASS " : "FAIL ") + what); if (!pass) ok = false; };
            GameServer server = null;
            try
            {
                string problem;
                GameFiles game = GameFiles.Open(o.Game, out problem);
                check(game != null, "game folder: " + (game != null ? game.Describe() : problem));
                if (game == null) return Finish(o, log, false);
                // the game folder must not change at all
                Dictionary<string, string> before = Snapshot(game.Dir);
                string saves = o.Saves ?? Path.Combine(Path.GetTempPath(), "bsvr_selftest_" + Guid.NewGuid().ToString("N"));
                int port = o.Port > 0 ? o.Port : 8159;
                server = new GameServer(game, Rtp.Find(), saves, AppPaths.AppDir, port);
                server.Start();
                string url = server.Url;
                WebClient wc = new WebClient { Encoding = Encoding.UTF8, Proxy = null };
                check(wc.DownloadString(url + "api/ping").Contains(GameServer.AppName), "ping");
                check(wc.DownloadString(url).Contains("BLACK SOULS"), "index.html from app\\");
                // the bundled libraries (no internet needed): three.js and the hand models
                check(wc.DownloadData(url + "vendor/three/build/three.module.js").Length > 1000000 && wc.DownloadData(url + "vendor/webxr-hands/generic-hand/left.glb").Length > 10000,
                      "bundled three.js and hand models served from app\\vendor");
                Dictionary<string, object> man = Util.Dict(Util.Json.DeserializeObject(wc.DownloadString(url + "api/manifest")));
                List<string> files = ((IEnumerable)man["files"]).Cast<object>().Select(x => Convert.ToString(x)).ToList();
                int rtpCount = ((IEnumerable)man["rtp"]).Cast<object>().Count();
                check(files.Any(f => f.Equals("Data/System.rvdata2", StringComparison.OrdinalIgnoreCase)), "manifest: " + files.Count + " game files, " + rtpCount + " RTP files");
                string sys = files.First(f => f.Equals("Data/System.rvdata2", StringComparison.OrdinalIgnoreCase));
                check(wc.DownloadData(url + "game/" + Uri.EscapeDataString(sys).Replace("%2F", "/")).SequenceEqual(game.Read(sys)), "game file bytes: " + sys);
                string intl = files.FirstOrDefault(f => f.Any(ch => ch > 127) && f.StartsWith("Graphics/", StringComparison.OrdinalIgnoreCase));
                if (intl != null)
                    check(wc.DownloadData(url + "game/" + string.Join("/", intl.Split('/').Select(Uri.EscapeDataString))).SequenceEqual(game.Read(intl)), "non-ASCII file name: " + intl);
                if (o.ExpectDir != null)
                {
                    // what the server hands out (from an archive, say) must be the original files byte for byte
                    int same = 0, diff = 0;
                    foreach (string f in files)
                    {
                        string orig = Util.SafeJoin(o.ExpectDir, f);
                        if (orig == null || !File.Exists(orig)) continue;
                        byte[] got = wc.DownloadData(url + "game/" + string.Join("/", f.Split('/').Select(Uri.EscapeDataString)));
                        if (got.SequenceEqual(File.ReadAllBytes(orig))) same++; else { diff++; log.AppendLine("     differs: " + f); }
                    }
                    check(same > 0 && diff == 0, "served files match the originals: " + same + " same, " + diff + " different");
                }
                bool blocked;
                try { wc.DownloadData(url + "game/..%2F..%2FWindows%2Fwin.ini"); blocked = false; } catch (WebException) { blocked = true; }
                check(blocked, "path traversal refused");
                string save = "{\"meta\":{\"map\":\"테스트\",\"level\":3},\"state\":{\"x\":1}}";
                check(wc.UploadString(url + "api/vrsave/97", save).Contains("true"), "save slot 97 written");
                check(wc.DownloadString(url + "api/vrsave/97") == save, "save slot 97 read back");
                check(wc.DownloadString(url + "api/vrsaves").Contains("테스트"), "save list shows slot 97");
                string wsave = "{\"meta\":{\"map\":\"개발자\",\"level\":5},\"state\":{\"x\":2}}";
                check(wc.UploadString(url + "api/worldsave/97", wsave).Contains("true") && wc.DownloadString(url + "api/worldsave/97") == wsave
                      && wc.DownloadString(url + "api/worldsaves").Contains("개발자") && !wc.DownloadString(url + "api/vrsaves").Contains("개발자")
                      && File.Exists(Path.Combine(saves, "world", "slot97.json")) && wc.DownloadString(url + "api/vrsave/97") == save,
                      "developer-server save slot 97: written, read back, listed apart (saves\\world)");
                check(wc.UploadString(url + "api/settings", "{\"moveSpeed\":5}").Contains("true") && wc.DownloadString(url + "api/settings") == "{\"moveSpeed\":5}", "settings round trip");
                check(wc.UploadString(url + "api/xr-reset", "").Contains("\"ended\": 0"), "WebXR process reset: answers, ends nothing for a non-browser client");
                check(wc.UploadString(url + "api/haptic?h=r&v=0&ms=0", "").Contains("\"status\""), "controller vibration (SteamVR): answers (a status query does not connect)");
                bool bad;
                try { wc.UploadString(url + "api/vrsave/96", "not json"); bad = false; } catch (WebException) { bad = true; }
                check(bad, "bad save refused");
                // another web page's POST (a site open in a browser while this runs): refused, nothing written
                Func<string, string, bool> foreign = (header, value) =>
                {
                    WebClient f = new WebClient { Encoding = Encoding.UTF8, Proxy = null };
                    f.Headers.Add(header, value);
                    try { f.UploadString(url + "api/vrsave/95", save); return false; } catch (WebException) { return true; }
                };
                check(foreign("Origin", "https://example.com") && foreign("Sec-Fetch-Site", "cross-site") && !File.Exists(Path.Combine(saves, "slot95.json")),
                      "another web page's save refused (Origin, Sec-Fetch-Site)");
                WebClient own = new WebClient { Encoding = Encoding.UTF8, Proxy = null };
                own.Headers.Add("Origin", url.TrimEnd('/'));
                check(own.UploadString(url + "api/vrsave/95", save).Contains("true"), "the game page's own save taken (its Origin)");
                check(File.Exists(Path.Combine(saves, "slot97.json")) && !Directory.EnumerateFiles(game.Dir, "slot97*", SearchOption.AllDirectories).Any(), "saves go to the saves folder, not the game folder");
                if (o.Saves == null) try { Directory.Delete(saves, true); } catch { }
                Dictionary<string, string> after = Snapshot(game.Dir);
                check(before.Count == after.Count && before.All(kv => after.ContainsKey(kv.Key) && after[kv.Key] == kv.Value), "game folder unchanged (" + before.Count + " files checked)");
                if (o.TestAppConfig != null)
                {
                    SteamVr.Register(o.TestAppConfig);
                    check(SteamVr.IsRegistered(o.TestAppConfig) && File.Exists(SteamVr.ManifestPath), "SteamVR register (test copy)");
                    string text = File.ReadAllText(o.TestAppConfig);
                    SteamVr.Unregister(o.TestAppConfig);
                    check(!SteamVr.IsRegistered(o.TestAppConfig), "SteamVR unregister (test copy): " + text.Length + " bytes while registered");
                }
            }
            catch (Exception e) { check(false, "exception: " + e); }
            finally { if (server != null) server.Stop(); }
            return Finish(o, log, ok);
        }

        static Dictionary<string, string> Snapshot(string dir)
        {
            Dictionary<string, string> d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (string f in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
            {
                FileInfo i = new FileInfo(f);
                d[f] = i.Length + "|" + i.LastWriteTimeUtc.Ticks;
            }
            return d;
        }

        static int Finish(Options o, StringBuilder log, bool ok)
        {
            log.AppendLine(ok ? "RESULT OK" : "RESULT FAILED");
            if (o.Log != null) File.WriteAllText(o.Log, log.ToString(), new UTF8Encoding(false));
            return ok ? 0 : 1;
        }
    }
}
