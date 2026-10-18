using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace BlacksoulsCommunity
{
    internal static class Program
    {
        public static readonly string AppDirectory = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        public static string[] Arguments;

        [STAThread]
        private static void Main(string[] args)
        {
            Arguments = args;
            try { SetProcessDPIAware(); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            // Diagnostics do not show the player launcher and retain the upstream CLI.
            if (args.Any(a => a == "--selftest" || a == "--test-appconfig" || a == "--test-autovr"))
            { StartEngine(null); return; }
            if (args.Length > 0) { RunLauncher(null); return; }
            string remembered = GameDiscovery.Remembered(AppDirectory);
            if (remembered != null) { RunLauncher(remembered); return; }
            using (var discovery = new DiscoveryForm())
                if (discovery.ShowDialog() == DialogResult.OK) RunLauncher(discovery.SelectedGame);
        }

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        private static void RunLauncher(string game)
        {
            try
            {
                var args = new List<string>(Arguments ?? new string[0]);
                if (game != null) { args.Add("--game"); args.Add(game); }
                for (int i = 0; i + 1 < args.Count; i++)
                    if (args[i] == "--game") GameAssetCache.Prepare(args[i + 1], AppDirectory);
                int screenshotIndex = args.IndexOf("--screenshot");
                using (Form launcher = EngineHost.Create(AppDirectory, args.ToArray(), screenshotIndex < 0))
                {
                    if (screenshotIndex >= 0 && screenshotIndex + 1 < args.Count)
                    {
                        launcher.StartPosition = FormStartPosition.Manual;
                        launcher.Location = new Point(-20000, -20000);
                        launcher.Show();
                        Application.DoEvents();
                        using (var bitmap = new Bitmap(launcher.Width, launcher.Height))
                        {
                            launcher.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size));
                            bitmap.Save(args[screenshotIndex + 1], System.Drawing.Imaging.ImageFormat.Png);
                        }
                        launcher.Close();
                    }
                    else Application.Run(launcher);
                }
            }
            catch (Exception error)
            {
                MessageBox.Show("The game launcher could not open. Please reinstall BLACK SOULS II VR.\n\n" + error.GetBaseException().Message,
                    "BLACK SOULS II VR", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        public static string Quote(string argument)
        {
            var result = new StringBuilder("\"");
            int slashes = 0;
            foreach (char value in argument)
            {
                if (value == '\\') { slashes++; continue; }
                result.Append('\\', value == '"' ? slashes * 2 + 1 : slashes);
                result.Append(value);
                slashes = 0;
            }
            result.Append('\\', slashes * 2);
            return result.Append('"').ToString();
        }

        public static bool StartEngine(string game)
        {
            try
            {
                var args = new List<string>(Arguments ?? new string[0]);
                if (game != null) { args.Add("--game"); args.Add(game); }
                string assetGame = game;
                for (int i = 0; i + 1 < args.Count; i++)
                    if (String.Equals(args[i], "--game", StringComparison.OrdinalIgnoreCase)) assetGame = args[i + 1];
                if (!String.IsNullOrEmpty(assetGame)) GameAssetCache.Prepare(assetGame, AppDirectory);
                Process.Start(new ProcessStartInfo {
                    FileName = Path.Combine(AppDirectory, "BlacksoulsVR.Engine.exe"),
                    WorkingDirectory = AppDirectory,
                    Arguments = String.Join(" ", args.Select(Quote)),
                    UseShellExecute = false
                });
                return true;
            }
            catch (Exception error)
            {
                MessageBox.Show("The game launcher could not open. Please reinstall BLACK SOULS II VR.\n\n" + error.Message,
                    "BLACK SOULS II VR", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return false;
            }
        }
    }

    internal sealed class DiscoveryForm : Form
    {
        private readonly CancellationTokenSource cancel = new CancellationTokenSource();
        private readonly Label status = new Label();
        private readonly ComboBox choices = new ComboBox();
        private readonly Button browse = new Button();
        private readonly Button use = new Button();
        private readonly ProgressBar progress = new ProgressBar();
        private bool scanning = true;
        private bool browseRequested;
        public string SelectedGame { get; private set; }

        public DiscoveryForm()
        {
            Text = "BLACK SOULS II VR";
            Font = new Font("Segoe UI", 10);
            BackColor = Color.FromArgb(24, 22, 24);
            ForeColor = Color.FromArgb(230, 222, 210);
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(660, 270);
            MinimumSize = new Size(600, 310);
            AutoScaleMode = AutoScaleMode.Dpi;
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), ColumnCount = 1, RowCount = 6 };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            Controls.Add(layout);
            layout.Controls.Add(new Label { Text = "Find your game", Font = new Font("Segoe UI", 19, FontStyle.Bold),
                AutoSize = true, ForeColor = Color.FromArgb(214, 60, 60) });
            status.Text = "Looking for BLACK SOULS II in common game folders...";
            status.AutoSize = true;
            status.MaximumSize = new Size(600, 0);
            status.Margin = new Padding(0, 12, 0, 12);
            layout.Controls.Add(status);
            progress.Style = ProgressBarStyle.Marquee;
            progress.Dock = DockStyle.Top;
            layout.Controls.Add(progress);
            choices.DropDownStyle = ComboBoxStyle.DropDownList;
            choices.Dock = DockStyle.Top;
            choices.Visible = false;
            layout.Controls.Add(choices);
            var buttons = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft };
            browse.Text = "Browse...";
            browse.AutoSize = true;
            browse.Click += delegate {
                if (scanning) { browseRequested = true; browse.Enabled = false; cancel.Cancel(); }
                else Browse();
            };
            use.Text = "Use this folder";
            use.AutoSize = true;
            use.Visible = false;
            use.Click += delegate { if (choices.SelectedItem != null) Open((string)choices.SelectedItem); };
            buttons.Controls.Add(use);
            buttons.Controls.Add(browse);
            layout.Controls.Add(buttons);
            Shown += async delegate { await FindGame(); };
            FormClosing += delegate { cancel.Cancel(); };
        }

        private async Task FindGame()
        {
            List<string> found;
            try
            {
                found = await Task.Run(() => GameDiscovery.Scan(GameDiscovery.DefaultRoots(Program.AppDirectory), cancel.Token, null));
            }
            catch (Exception) { found = new List<string>(); }
            if (IsDisposed || Disposing) return;
            scanning = false;
            browse.Enabled = true;
            progress.Visible = false;
            if (browseRequested) { Browse(); return; }
            if (found.Count == 1) { Open(found[0]); return; }
            if (found.Count > 1)
            {
                status.Text = "Found more than one copy. Choose the game folder you want to use.";
                choices.Items.AddRange(found.ToArray());
                choices.SelectedIndex = 0;
                choices.Visible = true;
                use.Visible = true;
            }
            else status.Text = "We couldn't find your game automatically. Click Browse and choose your original BLACK SOULS II folder (the one containing Game.exe).";
        }

        private void Browse()
        {
            using (var dialog = new FolderBrowserDialog { Description = "Choose your original BLACK SOULS II game folder", ShowNewFolderButton = false })
            {
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                if (GameDiscovery.HasGameData(dialog.SelectedPath)) Open(dialog.SelectedPath);
                else MessageBox.Show(this, "This folder doesn't contain the game data. Choose the folder with Game.exe and Data or Game.rgss3a.",
                    "Choose your game folder", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }

        private void Open(string path)
        {
            SelectedGame = path;
            DialogResult = DialogResult.OK;
            Close();
        }
    }
}
