using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using BlacksoulsCommunity;

internal static class UpdateTests
{
    private static int checks;
    private static void Check(bool ok, string name)
    {
        if (!ok) throw new Exception(name);
        checks++;
        Console.WriteLine("PASS " + name);
    }
    private static void Reject(Action action, string name)
    {
        try { action(); } catch (InvalidDataException) { Check(true, name); return; }
        throw new Exception(name);
    }
    private static string Release(string tag, bool preview, string owner, bool checksum)
    {
        string name = "BLACKSOULS_VR_Setup_" + tag.TrimStart('v') + ".exe";
        string prefix = "https://github.com/" + owner + "/releases/download/" + tag + "/";
        var assets = new List<object> { new { name = name, browser_download_url = prefix + name, size = 3 } };
        if (checksum) assets.Add(new { name = name + ".sha256", browser_download_url = prefix + name + ".sha256", size = 100 });
        return new JavaScriptSerializer().Serialize(new { tag_name = tag, draft = false, prerelease = preview, assets = assets });
    }

    private sealed class Reply
    {
        public int Status = 200;
        public byte[] Body;
        public string Headers = "";
        public Reply(string body) { Body = Encoding.UTF8.GetBytes(body); }
    }

    // TcpListener needs no HTTP URL reservation/admin permission and stays entirely local.
    private sealed class LocalUpdates : IDisposable
    {
        private readonly TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
        private readonly Task serving;
        public readonly Uri Endpoint;
        public readonly List<Dictionary<string, string>> Requests = new List<Dictionary<string, string>>();

        public LocalUpdates(params Reply[] replies)
        {
            listener.Start();
            Endpoint = new Uri("http://127.0.0.1:" + ((IPEndPoint)listener.LocalEndpoint).Port + "/latest");
            serving = Task.Run(delegate {
                foreach (Reply reply in replies)
                {
                    using (TcpClient peer = listener.AcceptTcpClient())
                    using (NetworkStream stream = peer.GetStream())
                    {
                        peer.ReceiveTimeout = 5000;
                        var reader = new StreamReader(stream, Encoding.ASCII, false, 1024, true);
                        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                        reader.ReadLine();
                        string line;
                        while (!String.IsNullOrEmpty(line = reader.ReadLine()))
                        {
                            int colon = line.IndexOf(':');
                            if (colon > 0) headers[line.Substring(0, colon)] = line.Substring(colon + 1).Trim();
                        }
                        Requests.Add(headers);
                        bool identified = headers.ContainsKey("User-Agent") && headers["User-Agent"] == "BlacksoulsVR-Updater";
                        byte[] body = identified ? reply.Body : Encoding.UTF8.GetBytes("User-Agent required");
                        byte[] head = Encoding.ASCII.GetBytes("HTTP/1.1 " + (identified ? reply.Status : 403) + " Test\r\nContent-Length: " + body.Length + "\r\nConnection: close\r\n" + reply.Headers + "\r\n");
                        stream.Write(head, 0, head.Length);
                        stream.Write(body, 0, body.Length);
                    }
                }
            });
        }

        public void Dispose()
        {
            listener.Stop();
            try { serving.GetAwaiter().GetResult(); } catch (SocketException) { }
        }
    }

    private static ReleaseCheckException Failure(Func<ReleaseUpdate> action, ReleaseCheckFailure expected, string name)
    {
        try { action(); }
        catch (ReleaseCheckException error) { Check(error.Failure == expected, name); return error; }
        throw new Exception(name);
    }

    private static T Named<T>(Form form, string name) where T : Control
    {
        return Descendants(form).OfType<T>().Single(c => c.Name == name);
    }

    private static void Click(Button button)
    {
        // Exercise the real attached handlers without showing the engine form or
        // starting its Shown/Steam integration in this isolated installation.
        typeof(Button).GetMethod("OnClick", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(button, new object[] { EventArgs.Empty });
    }

    private static void Layout(Control parent)
    {
        parent.PerformLayout();
        foreach (Control child in parent.Controls) Layout(child);
    }

    private static void PresentationChecks(Form form)
    {
        var pc = Named<Button>(form, "playPcMode");
        var vr = Named<Button>(form, "playVrMode");
        var launch = Named<Button>(form, "launchGameButton");
        var autoVr = (CheckBox)EngineHost.Field(form, "autoVrBox");
        var options = EngineHost.Field(form, "opt");
        Check(form.FormBorderStyle == FormBorderStyle.None && Named<Button>(form, "closeWindow").TabStop && !String.IsNullOrWhiteSpace(Named<Button>(form, "closeWindow").AccessibleName), "Launcher uses borderless chrome with accessible window actions");
        Check(Object.ReferenceEquals(launch, EngineHost.Field(form, "launchBtn")) && Object.ReferenceEquals(Named<Button>(form, "openSavesButton"), EngineHost.Field(form, "savesBtn")), "Redesign reuses the original engine launch and saves controls");
        Check(form.AcceptButton == launch && pc.TabStop && vr.TabStop && !String.IsNullOrWhiteSpace(pc.AccessibleName), "Primary launch and mode choices support keyboard and accessible names");
        options.GetType().GetField("Vr").SetValue(options, true);
        options.GetType().GetField("Launch").SetValue(options, true);
        Click(pc);
        Check(!autoVr.Checked && !(bool)options.GetType().GetField("Vr").GetValue(options) && !(bool)options.GetType().GetField("Launch").GetValue(options) && !((CheckBox)EngineHost.Field(form, "steamRtBox")).Checked, "Choosing PC clears checkbox and hidden CLI headset overrides");
        Check(launch.Text == "PCで起動", "Primary action describes the selected PC mode in Japanese");
        Click(vr);
        Check(autoVr.Checked && (bool)options.GetType().GetField("Vr").GetValue(options) && launch.Text == "VRで起動", "Choosing VR reaches the engine's actual automatic-VR setting");
        var languages = (ComboBox)EngineHost.Field(form, "langBox");
        languages.SelectedIndex = 1;
        Check(launch.Text == "Launch in VR" && pc.Text.Contains("Play on PC"), "Mode cards and primary action follow language changes");
        Check(new[] { languages, (ComboBox)EngineHost.Field(form, "browserBox") }.All(box => box.DrawMode == DrawMode.Normal && box.FlatStyle == FlatStyle.Standard && box.ForeColor.GetBrightness() < 0.25 && box.BackColor.GetBrightness() > 0.75) && !String.IsNullOrWhiteSpace(languages.Text), "Language and browser selections retain native high-contrast text rendering");
        languages.SelectedIndex = 0;
        Check(launch.Text == "VR로 실행" && !String.IsNullOrWhiteSpace(pc.AccessibleName), "Korean mode controls and accessible names are translated");
        languages.SelectedIndex = 3;
        Check(launch.Text == "启动VR模式" && languages.AccessibleName == "语言", "Chinese mode controls and language selector are translated");
        languages.SelectedIndex = 1;
        var content = Named<TableLayoutPanel>(form, "launcherContent");
        var details = Named<Panel>(form, "launcherDetails");
        var advanced = Named<TableLayoutPanel>(form, "launcherAdvanced");
        var advancedToggle = Named<Button>(form, "toggleAdvanced");
        var detailsToggle = Named<Button>(form, "toggleDetails");
        Layout(form);
        Check(content.GetRowHeights()[content.GetRow(details)] == 0 && content.GetRowHeights()[content.GetRow(advanced)] == 0, "Details and advanced settings start collapsed");
        Click(advancedToggle); Layout(form);
        Check(content.GetRowHeights()[content.GetRow(advanced)] > 100, "Advanced options reveal the original RTP browser port and Steam controls");
        Check(Object.ReferenceEquals(((Control)EngineHost.Field(form, "rtpBox")).Parent, advanced) && Object.ReferenceEquals(((Control)EngineHost.Field(form, "steamBtn")).Parent, advanced), "Advanced settings retain the original engine event-bound controls");
        Click(advancedToggle); Click(detailsToggle); Layout(form);
        Check(content.GetRowHeights()[content.GetRow(details)] >= 156 && ((TextBox)EngineHost.Field(form, "logBox")).Parent == details, "Details reveal the original read-only launcher log");
        Click(detailsToggle);
        ((TextBox)EngineHost.Field(form, "logBox")).AppendText(Environment.NewLine + "[13:00:19] Test update service response" + Environment.NewLine);
        Check(Named<Label>(form, "launcherSessionStatus").Text == "Test update service response", "New launcher messages remain visible when details are collapsed");
        foreach (Size size in new[] { new Size(900, 650), new Size(1060, 760), new Size(1280, 800) })
        {
            form.ClientSize = size; Layout(form);
            var main = Named<TableLayoutPanel>(form, "launcherMain");
            var primary = Named<TableLayoutPanel>(form, "launcherPrimary");
            var sidebar = Named<TableLayoutPanel>(form, "launcherSidebar");
            var title = Named<Label>(form, "launcherTitle");
            var edition = Named<Label>(form, "launcherEdition");
            Check(primary.Right <= sidebar.Left && sidebar.Right <= main.ClientSize.Width && pc.Right <= vr.Left &&
                !title.Bounds.IntersectsWith(edition.Bounds) && launch.Width > 300 && Named<Button>(form, "forkUpdateButton").Width > 150 &&
                Named<Label>(form, "launcherWindowCaption").Right <= Named<FlowLayoutPanel>(form, "launcherWindowActions").Left &&
                Named<Label>(form, "launcherWindowCaption").Bottom <= Named<TableLayoutPanel>(form, "launcherTitleBar").ClientSize.Height,
                "Launcher layout keeps primary controls separate at " + size.Width + "x" + size.Height);
        }
        form.ClientSize = new Size(1060, 760);
        Rectangle normal = form.Bounds;
        Click(Named<Button>(form, "maximizeWindow"));
        Check(form.WindowState == FormWindowState.Maximized && Named<Button>(form, "maximizeWindow").AccessibleName == "Restore window" &&
            LauncherWindowChrome.MaximizeWorkArea(new Rectangle(-1920, 0, 1920, 1080), new Rectangle(-1920, 0, 1920, 1040)) == new Rectangle(0, 0, 1920, 1040), "Custom maximize uses the monitor work area and exposes Restore");
        Click(Named<Button>(form, "maximizeWindow"));
        Check(form.WindowState == FormWindowState.Normal && form.Bounds.Size == normal.Size, "Custom Restore returns to the original window size");
        Click(Named<Button>(form, "minimizeWindow"));
        Check(form.WindowState == FormWindowState.Minimized, "Custom minimize reaches the real form state");
        form.WindowState = FormWindowState.Normal;
        bool closing = false;
        FormClosingEventHandler cancelClose = delegate(object sender, FormClosingEventArgs e) { closing = true; e.Cancel = true; };
        form.FormClosing += cancelClose;
        Click(Named<Button>(form, "closeWindow"));
        Check(closing && !form.IsDisposed, "Custom Close follows the engine form's existing close and cleanup lifecycle");
        form.FormClosing -= cancelClose;
        var edges = new[] {
            new { Point = new Point(1, 1), Expected = 13 }, new { Point = new Point(500, 1), Expected = 12 },
            new { Point = new Point(999, 1), Expected = 14 }, new { Point = new Point(1, 350), Expected = 10 },
            new { Point = new Point(999, 350), Expected = 11 }, new { Point = new Point(1, 699), Expected = 16 },
            new { Point = new Point(500, 699), Expected = 15 }, new { Point = new Point(999, 699), Expected = 17 },
            new { Point = new Point(500, 350), Expected = 1 }
        };
        Check(edges.All(edge => LauncherWindowChrome.ResizeHitTest(edge.Point, new Size(1000, 700), 8) == edge.Expected), "Borderless hit testing supports all eight resize directions and leaves center controls interactive");
        form.Scale(new SizeF(1.5f, 1.5f)); Layout(form);
        Check(launch.Height >= 80 && pc.Width > 350 && Named<TableLayoutPanel>(form, "launcherSidebar").Right <= Named<TableLayoutPanel>(form, "launcherMain").ClientSize.Width,
            "Launcher controls retain their separation and usable sizes at simulated 150 percent scaling");
        LauncherWindowChrome.FitToWorkArea(form, new Rectangle(0, 0, 1200, 700));
        Check(form.Width <= 1200 && form.Height <= 700 && form.MinimumSize.Width <= 1200 && form.MinimumSize.Height <= 700 && Named<Panel>(form, "launcherViewport").AutoScroll,
            "Scaled launcher fits a laptop work area while retaining scrolling access to every setting");
    }

    private static void HttpChecks(ReleaseIdentity identity, ReleaseUpdate update, string digest, string directory)
    {
        using (var server = new LocalUpdates(new Reply(Release("v2.9.0", false, identity.Repository, true)),
            new Reply(Release("v2.9.0", false, identity.Repository, true)), new Reply(digest), new Reply("") { Body = new byte[] { 1, 2, 3 } }))
        using (var client = new ReleaseClient())
        {
            Check(client.CheckAt(identity, server.Endpoint).GetAwaiter().GetResult() == null, "First HTTP check finds the installed version");
            Check(client.CheckAt(identity, server.Endpoint).GetAwaiter().GetResult() == null, "Repeated HTTP check retains its required User-Agent");
            update.ChecksumUrl = new Uri(server.Endpoint, "/checksum").AbsoluteUri;
            update.InstallerUrl = new Uri(server.Endpoint, "/setup").AbsoluteUri;
            string downloaded = client.Download(update, Path.Combine(directory, "http-download")).GetAwaiter().GetResult();
            Check(File.ReadAllBytes(downloaded).SequenceEqual(new byte[] { 1, 2, 3 }) && server.Requests.Count == 4 &&
                server.Requests.All(h => h["User-Agent"] == "BlacksoulsVR-Updater"), "Check, recheck, checksum and installer all send the required identity");
        }
        using (var server = new LocalUpdates(new Reply("limited") { Status = 403, Headers = "X-RateLimit-Remaining: 0\r\nRetry-After: 120\r\n" }))
        using (var client = new ReleaseClient())
        {
            var error = Failure(() => client.CheckAt(identity, server.Endpoint).GetAwaiter().GetResult(), ReleaseCheckFailure.RateLimited, "GitHub quota failures are distinguished from offline errors");
            Check(error.RetryAfterUtc > DateTime.UtcNow.AddSeconds(110), "Rate-limit response preserves the server retry time");
            var repeated = Failure(() => client.CheckAt(identity, server.Endpoint).GetAwaiter().GetResult(), ReleaseCheckFailure.RateLimited, "Retry during cooldown returns the quota explanation");
            Check(server.Requests.Count == 1 && repeated.RetryAfterUtc == error.RetryAfterUtc, "Repeated clicks do not hit a rate-limited endpoint again");
            foreach (string language in new[] { "en", "ja", "ko", "zh" })
                Check(!String.IsNullOrWhiteSpace(error.PlayerMessage(language)) && (language == "en" || error.PlayerMessage(language) != error.PlayerMessage("en")), "Localized quota explanation: " + language);
            Check(!error.PlayerMessage("en").Contains("internet connection"), "Online quota failures never blame the player's internet");
        }
        var cases = new[] {
            new { Reply = new Reply("denied") { Status = 403 }, Kind = ReleaseCheckFailure.Forbidden },
            new { Reply = new Reply("missing") { Status = 404 }, Kind = ReleaseCheckFailure.NotFound },
            new { Reply = new Reply("unavailable") { Status = 503 }, Kind = ReleaseCheckFailure.ServiceUnavailable },
            new { Reply = new Reply("<html>not release JSON</html>"), Kind = ReleaseCheckFailure.InvalidResponse },
            new { Reply = new Reply(Release("v3.0.0", false, identity.Repository, false)), Kind = ReleaseCheckFailure.IncompleteRelease },
            new { Reply = new Reply("limited") { Status = 429 }, Kind = ReleaseCheckFailure.RateLimited }
        };
        foreach (var item in cases)
            using (var server = new LocalUpdates(item.Reply))
            using (var client = new ReleaseClient())
                Failure(() => client.CheckAt(identity, server.Endpoint).GetAwaiter().GetResult(), item.Kind, "HTTP update error classification: " + item.Kind);
        Check(ReleaseClient.Describe(new WebException("timeout", WebExceptionStatus.Timeout)).Failure == ReleaseCheckFailure.Timeout, "Timeout is not reported as offline");
        Check(ReleaseClient.Describe(new WebException("TLS", WebExceptionStatus.TrustFailure)).Failure == ReleaseCheckFailure.SecureConnection, "Certificate failure identifies the secure connection");
        Check(ReleaseClient.Describe(new WebException("DNS", WebExceptionStatus.NameResolutionFailure)).Failure == ReleaseCheckFailure.Connection, "DNS failure keeps the connection explanation");
    }

    [STAThread]
    private static int Main()
    {
        string directory = AppDomain.CurrentDomain.BaseDirectory;
        try
        {
            var identity = new ReleaseIdentity { Repository = "sample-owner/sample-fork", Version = "2.9.0" };
            Check(identity.LatestApi == "https://api.github.com/repos/sample-owner/sample-fork/releases/latest", "Repository determines release API");
            var update = ReleaseUpdate.Parse(Release("v2.10.0", false, identity.Repository, true), identity);
            Check(update != null && update.Version == "2.10.0", "Numeric versions compare correctly");
            Check(update.InstallerUrl.Contains("/sample-owner/sample-fork/releases/download/v2.10.0/"), "Download belongs to the build's repository");
            Check(ReleaseUpdate.Parse(Release("v2.9.0", false, identity.Repository, true), identity) == null, "Same version needs no update");
            Check(ReleaseUpdate.Parse(Release("v2.8.9", false, identity.Repository, true), identity) == null, "Never downgrade");
            Check(ReleaseUpdate.Parse(Release("v3.0.0", true, identity.Repository, true), identity) == null, "Skip prereleases");
            Reject(() => ReleaseUpdate.Parse(Release("v3.0.0", false, "original-author/original-mod", true), identity), "Reject other repository downloads");
            Reject(() => ReleaseUpdate.Parse(Release("v3.0.0", false, identity.Repository, false), identity), "Require published checksum");
            Check(ReleaseUpdate.Parse(Release("v2.9.0", false, identity.Repository, true),
                new ReleaseIdentity { Repository = identity.Repository, Version = "2.9.0-beta.1" }) != null, "Stable release upgrades its preview");
            Check(ReleaseUpdate.Parse(Release("v2026.10.18-1", false, identity.Repository, true), identity) == null &&
                ReleaseUpdate.ParseVersion("bad") == null, "Skip incompatible release formats");

            string source = Path.Combine(directory, "source.exe");
            File.WriteAllBytes(source, new byte[] { 1, 2, 3 });
            string hash;
            using (var algorithm = SHA256.Create()) hash = BitConverter.ToString(algorithm.ComputeHash(File.ReadAllBytes(source))).Replace("-", "").ToLowerInvariant();
            string digest = hash + "  " + update.InstallerName + "\n";
            update.Verify(source, digest);
            Check(true, "Verify full downloaded file");
            File.WriteAllBytes(source, new byte[] { 3, 2, 1 });
            Reject(() => update.Verify(source, digest), "Reject same-size corrupted installer");
            File.WriteAllBytes(source, new byte[] { 1, 2 });
            Reject(() => update.Verify(source, digest), "Reject truncated installer");
            File.WriteAllBytes(source, new byte[] { 1, 2, 3 });
            Reject(() => update.Verify(source, hash + "  unexpected.exe"), "Reject checksum for another file");
            update.InstallerUrl = new Uri(source).AbsoluteUri;
            string checksumPath = Path.Combine(directory, "source.sha256");
            update.ChecksumUrl = new Uri(checksumPath).AbsoluteUri;
            File.WriteAllText(checksumPath, digest);
            using (var client = new ReleaseClient())
            {
                string targetDir = Path.Combine(directory, "download");
                string downloaded = client.Download(update, targetDir).GetAwaiter().GetResult();
                Check(File.ReadAllBytes(downloaded).SequenceEqual(new byte[] { 1, 2, 3 }), "Download and verify installer end to end");
                File.WriteAllText(checksumPath, new string('0', 64) + "  " + update.InstallerName);
                Reject(() => client.Download(update, targetDir).GetAwaiter().GetResult(), "Corrupt download fails");
                Check(!File.Exists(downloaded), "Remove failed installer download");
            }
            HttpChecks(identity, update, digest, directory);
            File.WriteAllText(Path.Combine(directory, "release.json"), new JavaScriptSerializer().Serialize(new { schema = 1, repository = identity.Repository, version = identity.Version }));
            Check(ReleaseIdentity.Load(directory).Version == identity.Version, "Load CI release metadata");
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (Form form = EngineHost.Create(directory, new[] { "--lang", "en", "--update-url", "https://should-never-be-requested.invalid" }, false))
            {
                Check(form.GetType().GetField("UpdateCheck").GetValue(form) == null, "Legacy network update check is disabled before construction");
                Check(!((Button)EngineHost.Field(form, "updateBtn")).Visible, "Legacy upstream update button is hidden");
                Check(form.Text.Contains(identity.Version), "Launcher displays fork version");
                var languages = (ComboBox)EngineHost.Field(form, "langBox");
                languages.SelectedIndex = 2;
                Check(form.Text.Contains(identity.Version), "Language changes retain fork version");
                var buttons = Descendants(form).OfType<Button>().ToList();
                Check(buttons.Any(b => b.Text == "更新を確認"), "New update button follows selected language");
                var engine = form.GetType().Assembly;
                Check((string)engine.GetType("BlacksoulsVR.AppPaths").GetField("AppDir").GetValue(null) == Path.Combine(directory.TrimEnd(Path.DirectorySeparatorChar), "app"), "Hosted engine uses the actual install's app folder");
                var options = EngineHost.Field(form, "opt");
                Check(options.GetType().GetField("Screenshot").GetValue(options) == null, "Normal launch is restored after suppressing legacy checker");
                PresentationChecks(form);
            }
            Console.WriteLine("Passed " + checks + " update and engine hosting checks.");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }

    private static IEnumerable<Control> Descendants(Control parent)
    {
        foreach (Control control in parent.Controls)
        {
            yield return control;
            foreach (Control nested in Descendants(control)) yield return nested;
        }
    }
}
