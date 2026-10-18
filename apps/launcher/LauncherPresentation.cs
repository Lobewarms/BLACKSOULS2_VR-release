using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace BlacksoulsCommunity
{
    // Presentation only: the verified engine keeps game validation, configuration,
    // browser/server launch, saves and its original control event handlers.
    internal sealed class LauncherPresentation
    {
        private static readonly Color Background = Color.FromArgb(18, 17, 21);
        private static readonly Color Card = Color.FromArgb(30, 27, 32);
        private static readonly Color Inset = Color.FromArgb(23, 21, 26);
        private static readonly Color Edge = Color.FromArgb(76, 60, 65);
        private static readonly Color Ink = Color.FromArgb(244, 234, 218);
        private static readonly Color Muted = Color.FromArgb(190, 179, 172);
        private static readonly Color Gold = Color.FromArgb(216, 178, 103);
        private static readonly Color Crimson = Color.FromArgb(139, 35, 51);
        private readonly Form form;
        private readonly string version;
        private readonly Button update;
        private readonly CheckBox autoVr;
        private readonly CheckBox steamRuntime;
        private readonly Button launch;
        private readonly ComboBox languages;
        private readonly Label gameLabel;
        private readonly Label languageLabel;
        private readonly Label modeHeading = Label();
        private readonly Label helperHeading = Label();
        private readonly Label modeHelp = Label();
        private readonly Label statusHeading = Label();
        private readonly Label status = Label();
        private readonly Button pc = new Button();
        private readonly Button vr = new Button();
        private readonly Button advancedToggle = new Button();
        private readonly Button detailsToggle = new Button();
        private readonly TableLayoutPanel advanced;
        private readonly Panel details;
        private readonly ToolTip tips = new ToolTip();
        private bool expandedAdvanced;
        private bool expandedDetails;
        private bool selectingMode;
        private bool hasActivity;

        internal static void Apply(Form form, Button update, ReleaseIdentity identity)
        {
            new LauncherPresentation(form, update, identity);
        }

        private LauncherPresentation(Form form, Button update, ReleaseIdentity identity)
        {
            this.form = form; this.update = update; version = identity.Version;
            autoVr = Field<CheckBox>("autoVrBox");
            steamRuntime = Field<CheckBox>("steamRtBox");
            launch = Field<Button>("launchBtn");
            languages = Field<ComboBox>("langBox");
            gameLabel = Field<Label>("gameLabel");
            languageLabel = Field<Label>("langLabel");
            form.SuspendLayout();
            form.BackColor = Background;
            form.ForeColor = Ink;
            form.ClientSize = new Size(1060, 760);
            form.MinimumSize = new Size(900, 650);
            form.StartPosition = FormStartPosition.CenterScreen;
            form.AutoScaleMode = AutoScaleMode.Dpi;
            SetIcon();

            // Keep unpresented engine controls alive: ApplyTexts still refers to them.
            var hidden = new Panel { Name = "engineHiddenOptions", Visible = false, Size = Size.Empty };
            hidden.Controls.Add(autoVr);
            hidden.Controls.Add(Field<Button>("updateBtn"));
            foreach (Control old in form.Controls) old.Visible = false;
            form.Controls.Add(hidden);

            var scroll = new Panel { Name = "launcherViewport", Dock = DockStyle.Fill, AutoScroll = true, BackColor = Background, Padding = new Padding(24, 18, 24, 18), TabIndex = 0 };
            var content = Table("launcherContent", 1);
            content.Dock = DockStyle.Top;
            content.Margin = Padding.Empty;
            content.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            scroll.Controls.Add(content);
            form.Controls.Add(scroll);
            scroll.BringToFront();

            var header = new BannerSurface { Name = "launcherBanner", Height = 116, Dock = DockStyle.Fill, Margin = new Padding(0, 0, 0, 16), Padding = new Padding(18, 15, 18, 15) };
            var title = Label();
            title.Name = "launcherTitle"; title.Text = "BLACK SOULS II"; title.Dock = DockStyle.None;
            title.Font = new Font("Georgia", 25, FontStyle.Bold);
            title.ForeColor = Ink; title.Bounds = new Rectangle(18, 16, 610, 44);
            title.Anchor = AnchorStyles.Left | AnchorStyles.Top;
            var subtitle = Label();
            subtitle.Name = "launcherEdition"; subtitle.Text = "VR  /  COMMUNITY EDITION     v" + identity.Version; subtitle.Dock = DockStyle.None;
            subtitle.Font = new Font("Segoe UI", 9, FontStyle.Bold); subtitle.ForeColor = Gold;
            subtitle.Bounds = new Rectangle(21, 67, 600, 24);
            header.Controls.Add(title); header.Controls.Add(subtitle);
            LauncherWindowChrome.MakeDraggable(form, header);
            LauncherWindowChrome.MakeDraggable(form, title);
            LauncherWindowChrome.MakeDraggable(form, subtitle);
            content.Controls.Add(header, 0, 0);

            var body = Table("launcherMain", 2);
            body.Dock = DockStyle.Fill; body.AutoSize = false; body.Height = 362;
            body.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 64));
            body.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 36));
            body.Margin = new Padding(0, 0, 0, 10);
            content.Controls.Add(body, 0, 1);
            var primary = Table("launcherPrimary", 1);
            primary.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            primary.Dock = DockStyle.Fill; primary.Margin = new Padding(0, 0, 16, 0);
            body.Controls.Add(primary, 0, 0);

            var game = Table("gameFolderCard", 2);
            game.BackColor = Card; game.Padding = new Padding(16, 12, 16, 10); game.Margin = new Padding(0, 0, 0, 12);
            game.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            game.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 114));
            StyleLabel(gameLabel, true); gameLabel.Margin = new Padding(0, 0, 0, 8);
            game.Controls.Add(gameLabel, 0, 0); game.SetColumnSpan(gameLabel, 2);
            var gameBox = Field<TextBox>("gameBox"); StyleInput(gameBox); gameBox.Name = "gameFolderPath"; gameBox.TabIndex = 0;
            game.Controls.Add(gameBox, 0, 1);
            var browse = Field<Button>("gameBrowse"); StyleButton(browse); browse.Name = "browseGameFolder"; browse.TabIndex = 1; browse.Height = 34;
            game.Controls.Add(browse, 1, 1);
            var readiness = Field<Label>("gameState"); readiness.Name = "gameState"; StyleLabel(readiness, false); readiness.MaximumSize = new Size(0, 0); readiness.Margin = new Padding(0, 8, 0, 0);
            game.Controls.Add(readiness, 0, 2); game.SetColumnSpan(readiness, 2);
            primary.Controls.Add(game);

            var modes = Table("playModeCard", 2);
            modes.BackColor = Card; modes.Padding = new Padding(16, 12, 16, 12); modes.Margin = new Padding(0, 0, 0, 12);
            modes.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50)); modes.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
            StyleLabel(modeHeading, true); modeHeading.Margin = new Padding(0, 0, 0, 10);
            modes.Controls.Add(modeHeading, 0, 0); modes.SetColumnSpan(modeHeading, 2);
            StyleButton(pc); StyleButton(vr);
            pc.Name = "playPcMode"; vr.Name = "playVrMode";
            pc.UseMnemonic = false; vr.UseMnemonic = false;
            pc.Font = new Font("Segoe UI", 12, FontStyle.Bold); vr.Font = pc.Font;
            pc.AutoSize = vr.AutoSize = false; pc.Height = vr.Height = 74;
            pc.Margin = new Padding(0, 0, 6, 0); vr.Margin = new Padding(6, 0, 0, 0);
            pc.TabIndex = 0; vr.TabIndex = 1;
            pc.Click += delegate { SelectMode(false); };
            vr.Click += delegate { SelectMode(true); };
            modes.Controls.Add(pc, 0, 1); modes.Controls.Add(vr, 1, 1);
            primary.Controls.Add(modes);
            StyleButton(launch); launch.Name = "launchGameButton"; launch.AutoSize = false; launch.Height = 56;
            launch.Font = new Font("Segoe UI", 14, FontStyle.Bold); launch.BackColor = Crimson;
            launch.FlatAppearance.MouseOverBackColor = Color.FromArgb(166, 43, 61);
            launch.FlatAppearance.BorderColor = Color.FromArgb(182, 69, 81);
            launch.Margin = Padding.Empty; launch.TabIndex = 2;
            primary.Controls.Add(launch);
            form.AcceptButton = launch;

            var side = Table("launcherSidebar", 1);
            side.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); side.Dock = DockStyle.Fill;
            side.Padding = new Padding(16, 12, 16, 12); side.BackColor = Card; side.Margin = Padding.Empty;
            body.Controls.Add(side, 1, 0);
            var languageRow = Table("launcherLanguage", 2);
            languageRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 40)); languageRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 60));
            languageRow.Margin = new Padding(0, 0, 0, 14);
            StyleLabel(languageLabel, false); languageLabel.Anchor = AnchorStyles.Left;
            languages.Dock = DockStyle.Fill; languages.Margin = Padding.Empty; languages.TabIndex = 0;
            StyleCombo(languages);
            languageRow.Controls.Add(languageLabel, 0, 0); languageRow.Controls.Add(languages, 1, 0);
            side.Controls.Add(languageRow);
            StyleLabel(helperHeading, true); side.Controls.Add(helperHeading);
            StyleLabel(modeHelp, false); modeHelp.MinimumSize = new Size(0, 64); modeHelp.Margin = new Padding(0, 4, 0, 12); side.Controls.Add(modeHelp);
            var saves = Field<Button>("savesBtn"); StyleButton(saves); saves.Name = "openSavesButton"; saves.TabIndex = 1; saves.Height = 40;
            side.Controls.Add(saves);
            StyleButton(update); update.Height = 40; update.TabIndex = 2; update.ForeColor = Gold;
            side.Controls.Add(update);
            StyleLabel(statusHeading, true); statusHeading.Margin = new Padding(0, 12, 0, 4); side.Controls.Add(statusHeading);
            StyleLabel(status, false); status.Name = "launcherSessionStatus"; status.AutoSize = false; status.Height = 66; status.AutoEllipsis = true;
            side.Controls.Add(status);

            StyleButton(advancedToggle); advancedToggle.Name = "toggleAdvanced"; advancedToggle.TextAlign = ContentAlignment.MiddleLeft;
            advancedToggle.Height = 38; advancedToggle.Margin = new Padding(0, 0, 0, 6);
            advancedToggle.Click += delegate { expandedAdvanced = !expandedAdvanced; SetDisclosure(); };
            content.Controls.Add(advancedToggle, 0, 2);
            advanced = BuildAdvanced();
            content.Controls.Add(advanced, 0, 3);
            StyleButton(detailsToggle); detailsToggle.Name = "toggleDetails"; detailsToggle.TextAlign = ContentAlignment.MiddleLeft;
            detailsToggle.Height = 36; detailsToggle.Margin = new Padding(0, 0, 0, 6);
            detailsToggle.Click += delegate { expandedDetails = !expandedDetails; SetDisclosure(); };
            content.Controls.Add(detailsToggle, 0, 4);
            details = new Panel { Name = "launcherDetails", AutoSize = false, Height = 156, Dock = DockStyle.Fill, Margin = new Padding(0, 0, 0, 10) };
            var log = Field<TextBox>("logBox"); log.Dock = DockStyle.Fill; log.Margin = Padding.Empty; log.Font = new Font("Consolas", 9);
            log.BackColor = Inset; log.ForeColor = Muted; log.AccessibleName = "Launcher details";
            details.Controls.Add(log); content.Controls.Add(details, 0, 5);
            log.TextChanged += delegate { RefreshStatus(log); };
            var note = Field<Label>("subLabel"); StyleLabel(note, false); note.Font = new Font("Segoe UI", 8.5f);
            note.Margin = new Padding(0, 7, 0, 0); note.MaximumSize = Size.Empty;
            content.Controls.Add(note, 0, 6);

            languages.SelectedIndexChanged += delegate { ApplyTexts(); };
            autoVr.CheckedChanged += delegate { if (!selectingMode) ApplyTexts(); };
            steamRuntime.CheckedChanged += delegate { ApplyTexts(); };
            form.FormClosed += delegate { tips.Dispose(); };
            ApplyTexts();
            LauncherWindowChrome.Apply(form, scroll, Text);
            form.ResumeLayout(true);
        }

        private T Field<T>(string name) where T : Control { return (T)EngineHost.Field(form, name); }

        private static TableLayoutPanel Table(string name, int columns)
        {
            return new TableLayoutPanel { Name = name, ColumnCount = columns, RowCount = 0, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Dock = DockStyle.Top, Margin = Padding.Empty, Padding = Padding.Empty, GrowStyle = TableLayoutPanelGrowStyle.AddRows };
        }

        private static Label Label() { return new Label { AutoSize = true, Dock = DockStyle.Fill, BackColor = Color.Transparent, Margin = Padding.Empty, ForeColor = Muted }; }

        private static void StyleLabel(Label label, bool heading)
        {
            label.AutoSize = true; label.Dock = DockStyle.Fill; label.Margin = new Padding(0, 0, 0, 3);
            label.BackColor = Color.Transparent;
            if (heading) { label.Font = new Font("Segoe UI", 10, FontStyle.Bold); label.ForeColor = Ink; }
            else if (label.Name != "gameState") label.ForeColor = Muted;
        }

        private static void StyleInput(TextBox box)
        {
            box.Dock = DockStyle.Fill; box.Margin = new Padding(0, 5, 10, 0);
            box.BackColor = Inset; box.ForeColor = Ink; box.BorderStyle = BorderStyle.FixedSingle;
        }

        private static void StyleCombo(ComboBox box)
        {
            // Native themed drop-downs do not consistently paint custom dark
            // backgrounds (including WM_PRINT). Keep the selection legible there.
            box.DrawMode = DrawMode.Normal; box.FlatStyle = FlatStyle.Standard;
            box.BackColor = Color.FromArgb(234, 226, 210);
            box.ForeColor = Color.FromArgb(36, 29, 34);
        }

        private static void StyleButton(Button button)
        {
            button.AutoSize = false; button.Dock = DockStyle.Fill; button.MinimumSize = new Size(0, 34);
            button.Margin = new Padding(0, 0, 0, 8); button.Padding = new Padding(10, 4, 10, 4);
            button.FlatStyle = FlatStyle.Flat; button.UseVisualStyleBackColor = false;
            button.BackColor = Inset; button.ForeColor = Ink; button.FlatAppearance.BorderColor = Edge;
            button.FlatAppearance.BorderSize = 1; button.FlatAppearance.MouseOverBackColor = Color.FromArgb(49, 39, 45);
        }

        private TableLayoutPanel BuildAdvanced()
        {
            var panel = Table("launcherAdvanced", 3);
            panel.BackColor = Card; panel.Padding = new Padding(16); panel.Margin = new Padding(0, 0, 0, 10);
            panel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 132));
            panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            panel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 114));
            var browserLabel = Field<Label>("browserLabel"); StyleLabel(browserLabel, false); browserLabel.Anchor = AnchorStyles.Left;
            var browser = Field<ComboBox>("browserBox"); browser.Dock = DockStyle.Fill; browser.Margin = new Padding(0, 0, 10, 10);
            StyleCombo(browser);
            panel.Controls.Add(browserLabel, 0, 0); panel.Controls.Add(browser, 1, 0); panel.SetColumnSpan(browser, 2);
            var portLabel = Field<Label>("portLabel"); StyleLabel(portLabel, false); portLabel.Anchor = AnchorStyles.Left;
            var port = Field<NumericUpDown>("portBox"); port.Width = 110; port.Dock = DockStyle.Left; port.Margin = new Padding(0, 0, 0, 12); port.BackColor = Inset; port.ForeColor = Ink;
            panel.Controls.Add(portLabel, 0, 1); panel.Controls.Add(port, 1, 1);
            var rtpLabel = Field<Label>("rtpLabel"); StyleLabel(rtpLabel, false); rtpLabel.Margin = new Padding(0, 0, 0, 6);
            panel.Controls.Add(rtpLabel, 0, 2); panel.SetColumnSpan(rtpLabel, 3);
            var rtp = Field<TextBox>("rtpBox"); StyleInput(rtp);
            panel.Controls.Add(rtp, 0, 3); panel.SetColumnSpan(rtp, 2);
            var rtpBrowse = Field<Button>("rtpBrowse"); StyleButton(rtpBrowse); rtpBrowse.Height = 34;
            panel.Controls.Add(rtpBrowse, 2, 3);
            var rtpState = Field<Label>("rtpState"); StyleLabel(rtpState, false); rtpState.Margin = new Padding(0, 4, 0, 12);
            panel.Controls.Add(rtpState, 0, 4); panel.SetColumnSpan(rtpState, 3);
            steamRuntime.AutoSize = true; steamRuntime.Dock = DockStyle.Fill; steamRuntime.ForeColor = Ink; steamRuntime.Margin = new Padding(0, 0, 0, 10);
            steamRuntime.FlatStyle = FlatStyle.Flat; steamRuntime.UseVisualStyleBackColor = false; steamRuntime.BackColor = Card;
            steamRuntime.Paint += delegate(object sender, PaintEventArgs e) {
                if (!steamRuntime.Enabled)
                {
                    // Windows' disabled checkbox label can be black on dark cards.
                    int inset = Math.Max(16, steamRuntime.Font.Height);
                    var text = new Rectangle(inset, 0, Math.Max(0, steamRuntime.Width - inset), steamRuntime.Height);
                    using (var fill = new SolidBrush(Card)) e.Graphics.FillRectangle(fill, text);
                    TextRenderer.DrawText(e.Graphics, steamRuntime.Text, steamRuntime.Font, text, Muted, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
                }
            };
            panel.Controls.Add(steamRuntime, 0, 5); panel.SetColumnSpan(steamRuntime, 3);
            var steam = Field<Button>("steamBtn"); StyleButton(steam); steam.Height = 40;
            panel.Controls.Add(steam, 0, 6); panel.SetColumnSpan(steam, 3);
            var xr = Field<Label>("xrLabel"); StyleLabel(xr, false); xr.MaximumSize = Size.Empty; xr.Margin = new Padding(0, 5, 0, 0);
            panel.Controls.Add(xr, 0, 7); panel.SetColumnSpan(xr, 3);
            return panel;
        }

        private void SelectMode(bool headset)
        {
            selectingMode = true;
            autoVr.Checked = headset;
            // The engine also ORs the --vr flag into its saved setting at launch.
            object options = EngineHost.Field(form, "opt");
            options.GetType().GetField("Vr").SetValue(options, headset);
            if (!headset)
            {
                options.GetType().GetField("Launch").SetValue(options, false);
                steamRuntime.Checked = false;
            }
            selectingMode = false;
            ApplyTexts();
        }

        private string Text(string en, string ja, string ko, string zh)
        {
            string language = Convert.ToString(form.GetType().Assembly.GetType("BlacksoulsVR.Lang", true).GetField("Current").GetValue(null));
            return language == "ja" ? ja : language == "ko" ? ko : language == "zh" ? zh : en;
        }

        private void ApplyTexts()
        {
            form.Text = "BLACK SOULS II VR  v" + version;
            gameLabel.Text = Text("Game folder", "ゲームフォルダー", "게임 폴더", "游戏文件夹");
            Field<TextBox>("gameBox").AccessibleName = gameLabel.Text;
            Field<Button>("gameBrowse").AccessibleName = Text("Choose game folder", "ゲームフォルダーを選択", "게임 폴더 선택", "选择游戏文件夹");
            languageLabel.Text = Text("Language", "言語", "언어", "语言");
            languages.AccessibleName = languageLabel.Text;
            modeHeading.Text = Text("Choose how to play", "プレイ方法を選択", "플레이 방식 선택", "选择游玩方式");
            pc.Text = Text("Play on PC\nKeyboard & mouse", "PCでプレイ\nキーボード・マウス", "PC에서 플레이\n키보드 및 마우스", "在PC上游玩\n键盘和鼠标");
            vr.Text = Text("Play in VR\nHeadset & controllers", "VRでプレイ\nヘッドセット・コントローラー", "VR에서 플레이\n헤드셋 및 컨트롤러", "在VR中游玩\n头显和控制器");
            pc.AccessibleName = Text("Play on PC", "PCでプレイ", "PC에서 플레이", "在PC上游玩");
            vr.AccessibleName = Text("Play in VR", "VRでプレイ", "VR에서 플레이", "在VR中游玩");
            launch.Text = autoVr.Checked ? Text("Launch in VR", "VRで起動", "VR로 실행", "启动VR模式") : Text("Launch on PC", "PCで起動", "PC로 실행", "启动PC模式");
            launch.AccessibleName = launch.Text;
            helperHeading.Text = autoVr.Checked ? Text("Before you enter VR", "VRを始める前に", "VR을 시작하기 전에", "进入VR之前") : Text("Ready for PC play", "PCでのプレイ", "PC 플레이 준비", "准备在PC上游玩");
            modeHelp.Text = autoVr.Checked ? Text("Connect your headset with Meta Quest Link or SteamVR, then launch. Keep your headset and controllers ready.",
                "Meta Quest LinkまたはSteamVRで接続してから起動してください。ヘッドセットとコントローラーを準備してください。",
                "Meta Quest Link 또는 SteamVR로 헤드셋을 연결한 후 실행하세요. 헤드셋과 컨트롤러를 준비하세요.",
                "通过Meta Quest Link或SteamVR连接头显后再启动，并准备好头显和控制器。") : Text("Play in a normal game window. A VR headset is optional. Your saves work in both modes.",
                "通常のゲームウィンドウでプレイします。ヘッドセットは不要です。両モードでセーブを使えます。",
                "일반 게임 창에서 플레이합니다. VR 헤드셋은 선택 사항입니다. 저장 데이터는 두 모드에서 사용할 수 있습니다.",
                "在普通游戏窗口中游玩，无需VR头显。两种模式可共用存档。");
            statusHeading.Text = Text("Status", "状態", "상태", "状态");
            Field<TextBox>("logBox").AccessibleName = Text("Launcher details", "ランチャーの詳細", "런처 상세 정보", "启动器详细信息");
            if (!hasActivity) status.Text = Text("Choose a mode, then launch.", "モードを選択して起動してください。", "모드를 선택한 후 실행하세요.", "选择模式后启动。");
            tips.SetToolTip(Field<TextBox>("gameBox"), Text("Choose the BLACK SOULS II folder containing Game.exe.", "Game.exeがあるBLACK SOULS IIフォルダーを選択してください。", "Game.exe가 있는 BLACK SOULS II 폴더를 선택하세요.", "选择包含Game.exe的BLACK SOULS II文件夹。"));
            pc.FlatAppearance.BorderColor = autoVr.Checked ? Edge : Gold;
            vr.FlatAppearance.BorderColor = autoVr.Checked ? Gold : Edge;
            pc.BackColor = autoVr.Checked ? Inset : Color.FromArgb(59, 43, 39);
            vr.BackColor = autoVr.Checked ? Color.FromArgb(59, 43, 39) : Inset;
            pc.AccessibleDescription = autoVr.Checked ? "" : Text("Selected", "選択中", "선택됨", "已选择");
            vr.AccessibleDescription = autoVr.Checked ? Text("Selected", "選択中", "선택됨", "已选择") : "";
            SetDisclosure();
        }

        private void SetDisclosure()
        {
            advanced.Visible = expandedAdvanced;
            details.Visible = expandedDetails;
            advancedToggle.Text = (expandedAdvanced ? "▾  " : "▸  ") + Text("Advanced options", "詳細設定", "고급 옵션", "高级选项");
            detailsToggle.Text = (expandedDetails ? "▾  " : "▸  ") + Text("Details", "詳細ログ", "상세 정보", "详细信息");
            advancedToggle.AccessibleName = advancedToggle.Text.TrimStart('▸', '▾', ' ');
            detailsToggle.AccessibleName = detailsToggle.Text.TrimStart('▸', '▾', ' ');
            advancedToggle.AccessibleDescription = expandedAdvanced ? Text("Expanded", "展開中", "펼쳐짐", "已展开") : Text("Collapsed", "折りたたみ中", "접힘", "已折叠");
            detailsToggle.AccessibleDescription = expandedDetails ? Text("Expanded", "展開中", "펼쳐짐", "已展开") : Text("Collapsed", "折りたたみ中", "접힘", "已折叠");
        }

        private void RefreshStatus(TextBox log)
        {
            hasActivity = true;
            string[] lines = log.Text.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            status.Text = lines.Length == 0 ? "" : Regex.Replace(lines[lines.Length - 1], @"^\[\d{2}:\d{2}:\d{2}\]\s*", "");
            tips.SetToolTip(status, status.Text);
        }

        private void SetIcon()
        {
            using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("BlacksoulsCommunity.AppIcon.ico"))
                if (stream != null) using (var icon = new Icon(stream)) form.Icon = (Icon)icon.Clone();
        }

        private sealed class BannerSurface : Panel
        {
            private readonly Image artwork;
            public BannerSurface()
            {
                DoubleBuffered = true; BackColor = Background;
                using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("BlacksoulsCommunity.LauncherBanner.png"))
                    if (stream != null) using (Image original = Image.FromStream(stream)) artwork = new Bitmap(original);
            }
            protected override void OnPaint(PaintEventArgs e)
            {
                base.OnPaint(e);
                if (artwork != null)
                {
                    float scale = Height * 1.5f / artwork.Height;
                    int width = (int)Math.Ceiling(artwork.Width * scale), height = (int)Math.Ceiling(artwork.Height * scale);
                    e.Graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    e.Graphics.DrawImage(artwork, new Rectangle(Width - width, (Height - height) / 2, width, height));
                    using (var shade = new LinearGradientBrush(ClientRectangle, Background, Color.FromArgb(0, Background), LinearGradientMode.Horizontal))
                        e.Graphics.FillRectangle(shade, ClientRectangle);
                }
                using (var border = new Pen(Edge)) e.Graphics.DrawRectangle(border, 0, 0, Width - 1, Height - 1);
            }
            protected override void Dispose(bool disposing) { if (disposing && artwork != null) artwork.Dispose(); base.Dispose(disposing); }
        }
    }
}
