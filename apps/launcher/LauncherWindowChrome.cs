using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace BlacksoulsCommunity
{
    internal sealed class LauncherWindowChrome : NativeWindow
    {
        private readonly Form form;

        private LauncherWindowChrome(Form form)
        {
            this.form = form;
            form.HandleCreated += delegate { AssignHandle(form.Handle); };
            form.HandleDestroyed += delegate { ReleaseHandle(); };
            if (form.IsHandleCreated) AssignHandle(form.Handle);
        }

        internal static void Apply(Form form, Control viewport, Func<string, string, string, string, string> text)
        {
            form.FormBorderStyle = FormBorderStyle.None;
            form.Padding = new Padding(6);
            form.MaximizeBox = true;
            form.MinimizeBox = true;
            new LauncherWindowChrome(form);
            var frame = new TableLayoutPanel { Name = "launcherWindowFrame", Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2, Margin = Padding.Empty, Padding = Padding.Empty };
            frame.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            frame.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
            frame.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            var caption = new TableLayoutPanel { Name = "launcherTitleBar", Dock = DockStyle.Fill, Margin = Padding.Empty, Padding = Padding.Empty, BackColor = form.BackColor, ColumnCount = 2, RowCount = 1 };
            caption.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            caption.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 138));
            caption.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            var captionText = new Label { Name = "launcherWindowCaption", Dock = DockStyle.Fill, AutoEllipsis = true, TextAlign = ContentAlignment.MiddleLeft,
                Margin = Padding.Empty, Padding = new Padding(8, 0, 0, 0), ForeColor = Color.FromArgb(190, 179, 172), Font = new Font("Segoe UI", 9) };
            var actions = new FlowLayoutPanel { Name = "launcherWindowActions", Dock = DockStyle.Fill, Width = 138, WrapContents = false, Margin = Padding.Empty, Padding = Padding.Empty };
            var minimize = CaptionButton("minimizeWindow", "−");
            var maximize = CaptionButton("maximizeWindow", "□");
            var close = CaptionButton("closeWindow", "×");
            close.FlatAppearance.MouseOverBackColor = Color.FromArgb(139, 35, 51);
            actions.Controls.Add(minimize); actions.Controls.Add(maximize); actions.Controls.Add(close);
            caption.Controls.Add(captionText, 0, 0); caption.Controls.Add(actions, 1, 0);
            Action labels = null;
            minimize.Click += delegate { form.WindowState = FormWindowState.Minimized; labels(); };
            maximize.Click += delegate { ToggleMaximize(form); labels(); };
            close.Click += delegate { form.Close(); };
            labels = delegate {
                captionText.Text = form.Text;
                minimize.AccessibleName = text("Minimize window", "ウィンドウを最小化", "창 최소화", "最小化窗口");
                maximize.Text = form.WindowState == FormWindowState.Maximized ? "❐" : "□";
                maximize.AccessibleName = form.WindowState == FormWindowState.Maximized ? text("Restore window", "ウィンドウを元に戻す", "창 복원", "还原窗口") : text("Maximize window", "ウィンドウを最大化", "창 최대화", "最大化窗口");
                close.AccessibleName = text("Close launcher", "ランチャーを閉じる", "런처 닫기", "关闭启动器");
            };
            form.TextChanged += delegate { labels(); };
            form.Resize += delegate { labels(); };
            labels();
            MakeDraggable(form, caption); MakeDraggable(form, captionText);
            frame.Controls.Add(caption, 0, 0);
            viewport.Dock = DockStyle.Fill;
            frame.Controls.Add(viewport, 0, 1);
            form.Controls.Add(frame);
            frame.BringToFront();
            FitToWorkArea(form, Screen.FromControl(form).WorkingArea);
            form.Shown += delegate { FitToWorkArea(form, Screen.FromControl(form).WorkingArea); };
        }

        private static Button CaptionButton(string name, string symbol)
        {
            var button = new Button { Name = name, Text = symbol, Width = 46, Height = 34, Margin = Padding.Empty, Padding = Padding.Empty,
                TabStop = true, FlatStyle = FlatStyle.Flat, UseVisualStyleBackColor = false, ForeColor = Color.FromArgb(244, 234, 218), BackColor = Color.FromArgb(18, 17, 21), Font = new Font("Segoe UI", 12) };
            button.FlatAppearance.BorderSize = 0;
            button.FlatAppearance.MouseOverBackColor = Color.FromArgb(49, 39, 45);
            return button;
        }

        internal static void MakeDraggable(Form form, Control area)
        {
            area.MouseDown += delegate(object sender, MouseEventArgs e) {
                if (e.Button != MouseButtons.Left || e.Clicks > 1) return;
                ReleaseCapture();
                SendMessage(form.Handle, 0xA1, new IntPtr(2), IntPtr.Zero);
            };
            area.MouseDoubleClick += delegate(object sender, MouseEventArgs e) { if (e.Button == MouseButtons.Left) ToggleMaximize(form); };
        }

        internal static void ToggleMaximize(Form form)
        {
            if (form.WindowState == FormWindowState.Maximized) form.WindowState = FormWindowState.Normal;
            else form.WindowState = FormWindowState.Maximized;
        }

        internal static Rectangle MaximizeWorkArea(Rectangle monitor, Rectangle work)
        {
            return new Rectangle(work.X - monitor.X, work.Y - monitor.Y, work.Width, work.Height);
        }

        internal static void FitToWorkArea(Form form, Rectangle area)
        {
            if (area.Width <= 0 || area.Height <= 0) return;
            form.MinimumSize = new Size(Math.Min(form.MinimumSize.Width, area.Width), Math.Min(form.MinimumSize.Height, area.Height));
            form.Size = new Size(Math.Min(form.Width, area.Width), Math.Min(form.Height, area.Height));
        }

        internal static int ResizeHitTest(Point point, Size size, int grip)
        {
            if (point.X < 0 || point.Y < 0 || point.X >= size.Width || point.Y >= size.Height) return 1;
            bool left = point.X < grip, right = point.X >= size.Width - grip;
            bool top = point.Y < grip, bottom = point.Y >= size.Height - grip;
            if (top) return left ? 13 : right ? 14 : 12;
            if (bottom) return left ? 16 : right ? 17 : 15;
            return left ? 10 : right ? 11 : 1;
        }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == 0x24)
            {
                base.WndProc(ref message);
                Screen screen = Screen.FromControl(form);
                Rectangle work = MaximizeWorkArea(screen.Bounds, screen.WorkingArea);
                var limits = (MinMaxInfo)Marshal.PtrToStructure(message.LParam, typeof(MinMaxInfo));
                limits.MaxPosition.X = work.X; limits.MaxPosition.Y = work.Y;
                limits.MaxSize.X = work.Width; limits.MaxSize.Y = work.Height;
                Marshal.StructureToPtr(limits, message.LParam, false);
                message.Result = IntPtr.Zero;
                return;
            }
            if (message.Msg == 0x84 && form.WindowState == FormWindowState.Normal)
            {
                long packed = message.LParam.ToInt64();
                Point local = form.PointToClient(new Point(unchecked((short)packed), unchecked((short)(packed >> 16))));
                int hit = ResizeHitTest(local, form.ClientSize, Math.Max(6, form.Font.Height / 2));
                if (hit != 1) { message.Result = new IntPtr(hit); return; }
            }
            base.WndProc(ref message);
        }

        [StructLayout(LayoutKind.Sequential)] private struct NativePoint { public int X, Y; }
        [StructLayout(LayoutKind.Sequential)] private struct MinMaxInfo
        {
            public NativePoint Reserved, MaxSize, MaxPosition, MinTrackSize, MaxTrackSize;
        }

        [DllImport("user32.dll")] private static extern bool ReleaseCapture();
        [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
    }
}
