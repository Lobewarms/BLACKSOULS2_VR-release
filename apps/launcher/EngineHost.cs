using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

namespace BlacksoulsCommunity
{
    // Host the verified upstream form so its game server, browser and VR behavior stay intact.
    // Its legacy update check is disabled before construction; our release controller owns updates.
    internal static class EngineHost
    {
        private const BindingFlags PrivateInstance = BindingFlags.Instance | BindingFlags.NonPublic;

        internal static object Field(Form form, string name)
        {
            return form.GetType().GetField(name, PrivateInstance).GetValue(form);
        }

        internal static Form Create(string directory, string[] arguments, bool checkOnShow)
        {
            ReleaseIdentity identity = ReleaseIdentity.Load(directory);
            Assembly engine = Assembly.LoadFrom(Path.Combine(directory, "BlacksoulsVR.Engine.exe"));
            Type optionsType = engine.GetType("BlacksoulsVR.Options", true);
            object options = optionsType.GetMethod("Parse").Invoke(null, new object[] { arguments });
            var screenshot = optionsType.GetField("Screenshot");
            object requestedScreenshot = screenshot.GetValue(options);
            screenshot.SetValue(options, "community-update-controller");
            optionsType.GetField("UpdateUrl").SetValue(options, null);
            Type formType = engine.GetType("BlacksoulsVR.LauncherForm", true);
            var form = (Form)Activator.CreateInstance(formType, new object[] { options });
            // Assert the integration contract instead of silently leaving the old checker enabled.
            if (formType.GetField("UpdateCheck").GetValue(form) != null)
            {
                form.Dispose();
                throw new InvalidOperationException("This engine's update integration is incompatible. Please reinstall the app.");
            }
            screenshot.SetValue(options, requestedScreenshot);
            var updates = new UpdateController(form, identity, directory, checkOnShow);
            LauncherPresentation.Apply(form, updates.UpdateButton, identity);
            SteamAchievementHost.Attach(form, directory);
            return form;
        }

        private sealed class UpdateController
        {
            private readonly Form form;
            private readonly ReleaseIdentity identity;
            private readonly string directory;
            private readonly Button button = new Button();
            private readonly ReleaseClient client = new ReleaseClient();
            private readonly TextBox log;
            private ReleaseUpdate update;
            private bool busy;
            private string language;
            private string lastCheckMessage;
            internal Button UpdateButton { get { return button; } }

            public UpdateController(Form form, ReleaseIdentity identity, string directory, bool checkOnShow)
            {
                this.form = form; this.identity = identity; this.directory = directory;
                log = (TextBox)Field(form, "logBox");
                var old = (Button)Field(form, "updateBtn");
                button.Name = "forkUpdateButton";
                button.AutoSize = true;
                button.MinimumSize = old.MinimumSize;
                button.Padding = old.Padding;
                button.FlatStyle = old.FlatStyle;
                button.BackColor = old.BackColor;
                button.ForeColor = old.ForeColor;
                old.Parent.Controls.Add(button);
                old.Parent.Controls.SetChildIndex(button, old.Parent.Controls.GetChildIndex(old));
                old.Visible = false;
                var languages = (ComboBox)Field(form, "langBox");
                Action texts = delegate {
                    language = Convert.ToString(engineLanguage(form));
                    form.Text = "BLACK SOULS II VR  v" + identity.Version;
                    if (!busy) button.Text = update == null ? Text("Check for updates", "更新を確認", "업데이트 확인", "检查更新") :
                        Text("Download update", "更新をダウンロード", "업데이트 받기", "下载更新") + " (" + update.Version + ")";
                };
                languages.SelectedIndexChanged += delegate { texts(); };
                texts();
                log.Text = System.Text.RegularExpressions.Regex.Replace(log.Text, @"\d{4}\.\d{2}\.\d{2}-\d+", identity.Version);
                button.Click += async delegate { if (update == null) await Check(); else await Install(); };
                client.DownloadProgressChanged += delegate(object sender, System.Net.DownloadProgressChangedEventArgs e) {
                    if (!form.IsDisposed && update != null) button.Text = Text("Downloading", "ダウンロード中", "다운로드 중", "下载中") + " " + e.ProgressPercentage + "%";
                };
                form.FormClosed += delegate { client.CancelAsync(); client.Dispose(); };
                if (checkOnShow) form.Shown += async delegate { await Check(); };
            }

            private static object engineLanguage(Form form)
            {
                return form.GetType().Assembly.GetType("BlacksoulsVR.Lang", true).GetField("Current").GetValue(null);
            }

            private string Text(string en, string ja, string ko, string zh)
            {
                return language == "ja" ? ja : language == "ko" ? ko : language == "zh" ? zh : language == "ru" ? LauncherRussian.Text(en) : en;
            }

            private void Log(string message) { if (!form.IsDisposed) log.AppendText(Environment.NewLine + message + Environment.NewLine); }

            private void LogCheck(string message)
            {
                if (message == lastCheckMessage) return;
                lastCheckMessage = message;
                Log(message);
            }

            private async System.Threading.Tasks.Task Check()
            {
                if (busy) return;
                busy = true; button.Enabled = false;
                button.Text = Text("Checking…", "確認中…", "확인 중…", "检查中…");
                try
                {
                    update = await client.Check(identity);
                    if (form.IsDisposed) return;
                    button.Text = update == null ? Text("Check for updates", "更新を確認", "업데이트 확인", "检查更新") :
                        Text("Download update", "更新をダウンロード", "업데이트 받기", "下载更新") + " (" + update.Version + ")";
                    LogCheck(update == null ? Text("You're up to date.", "最新バージョンです。", "최신 버전입니다.", "已是最新版本。") :
                        Text("An update is available: ", "更新があります: ", "새 버전이 있습니다: ", "有可用更新: ") + update.Version);
                }
                catch (Exception error)
                {
                    if (form.IsDisposed) return;
                    button.Text = Text("Retry update check", "更新の確認を再試行", "업데이트 확인 재시도", "重试检查更新");
                    var failure = error as ReleaseCheckException;
                    LogCheck(failure != null ? failure.PlayerMessage(language) : Text("The update check couldn't be completed. Please restart the launcher and try again.",
                        "更新確認を完了できませんでした。ランチャーを再起動して再試行してください。",
                        "업데이트 확인을 완료하지 못했습니다. 런처를 다시 시작하고 다시 시도하세요.",
                        "无法完成更新检查，请重新启动启动器后重试。"));
                }
                finally { busy = false; if (!form.IsDisposed) button.Enabled = true; }
            }

            private async System.Threading.Tasks.Task Install()
            {
                if (busy) return;
                busy = true; button.Enabled = false;
                try
                {
                    string staging = Path.Combine(Path.GetTempPath(), "BLACKSOULS-VR-updates", Guid.NewGuid().ToString("N"));
                    string setup = await client.Download(update, staging);
                    if (form.IsDisposed) return;
                    Log(Text("Update downloaded and verified.", "更新をダウンロードして検証しました。", "업데이트 다운로드 및 검증 완료.", "更新已下载并验证。"));
                    if (MessageBox.Show(form, Text("The update is ready. Close the game and open setup now? Your saves will be kept.",
                        "更新の準備ができました。ゲームを閉じてセットアップを開きますか？セーブは保持されます。",
                        "업데이트가 준비되었습니다. 게임을 닫고 설치를 시작할까요? 저장 데이터는 유지됩니다.",
                        "更新已准备就绪。现在关闭游戏并打开安装程序？存档将被保留。"), "BLACK SOULS II VR", MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes)
                    {
                        Process.Start(new ProcessStartInfo { FileName = setup, Arguments = Program.Quote("/DIR=" + directory) + " /NORESTART", UseShellExecute = true });
                        form.Close();
                    }
                }
                catch (Exception)
                {
                    Log(Text("The update couldn't be downloaded or verified. Please try again.", "更新のダウンロードまたは検証に失敗しました。再試行してください。", "업데이트 다운로드 또는 검증에 실패했습니다. 다시 시도하세요.", "更新下载或验证失败，请重试。"));
                }
                finally
                {
                    busy = false;
                    if (!form.IsDisposed) { button.Enabled = true; button.Text = Text("Download update", "更新をダウンロード", "업데이트 받기", "下载更新") + " (" + update.Version + ")"; }
                }
            }
        }
    }
}
