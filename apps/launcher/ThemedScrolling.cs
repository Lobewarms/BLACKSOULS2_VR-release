using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace BlacksoulsCommunity
{
    internal sealed class ThemedScrollBar : Control
    {
        private int extent, viewport, position, wheelRemainder, dragOffset;
        private bool dragging, hover;
        internal event EventHandler ValueChanged;
        internal int Maximum { get { return Math.Max(0, extent - viewport); } }
        internal int Value { get { return position; } }
        internal int ViewportExtent { get { return viewport; } }
        internal bool HasOverflow { get { return Maximum > 0; } }
        internal int SmallChange = 40;
        internal Rectangle ThumbBounds
        {
            get
            {
                int track = Math.Max(0, Height - 4);
                int thumb = Math.Min(track, Math.Max(Math.Min(track, 24), extent <= 0 ? track : (int)((long)track * viewport / extent)));
                int offset = Maximum == 0 ? 0 : (int)((long)(track - thumb) * position / Maximum);
                return new Rectangle(2, 2 + offset, Math.Max(0, Width - 4), thumb);
            }
        }

        internal ThemedScrollBar()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.Selectable | ControlStyles.ResizeRedraw, true);
            Width = 12; TabStop = true; Cursor = Cursors.Hand;
            AccessibleRole = AccessibleRole.ScrollBar;
            AccessibleName = "Scroll";
            BackColor = Color.FromArgb(18, 17, 21);
        }

        internal void SetMetrics(int content, int visible, int value)
        {
            extent = Math.Max(0, content); viewport = Math.Max(0, visible);
            SetValue(value); Invalidate();
        }

        internal void SetValue(int value)
        {
            int next = Math.Max(0, Math.Min(Maximum, value));
            if (next == position) return;
            position = next; Invalidate();
            var changed = ValueChanged; if (changed != null) changed(this, EventArgs.Empty);
        }

        internal void ScrollWheel(int delta)
        {
            wheelRemainder += delta;
            int notches = wheelRemainder / 120;
            wheelRemainder %= 120;
            if (notches != 0) SetValue(position - notches * SmallChange);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(BackColor);
            using (var track = new SolidBrush(Color.FromArgb(35, 30, 37))) e.Graphics.FillRectangle(track, 2, 2, Math.Max(0, Width - 4), Math.Max(0, Height - 4));
            Rectangle thumb = ThumbBounds;
            using (var fill = new SolidBrush(dragging || hover ? Color.FromArgb(224, 192, 132) : Color.FromArgb(154, 128, 88))) e.Graphics.FillRectangle(fill, thumb);
            if (Focused && thumb.Width > 0 && thumb.Height > 0) ControlPaint.DrawFocusRectangle(e.Graphics, thumb, Color.FromArgb(244, 234, 218), BackColor);
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button != MouseButtons.Left || !HasOverflow) return;
            Focus();
            Rectangle thumb = ThumbBounds;
            if (thumb.Contains(e.Location)) { dragging = true; dragOffset = e.Y - thumb.Top; Capture = true; }
            else SetValue(position + (e.Y < thumb.Top ? -viewport : viewport));
            Invalidate();
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            hover = ThumbBounds.Contains(e.Location);
            if (dragging)
            {
                int travel = Math.Max(0, Height - 4 - ThumbBounds.Height);
                int offset = Math.Max(0, Math.Min(travel, e.Y - dragOffset - 2));
                SetValue(travel == 0 ? 0 : (int)((long)offset * Maximum / travel));
            }
            Invalidate();
        }

        protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseUp(MouseEventArgs e) { dragging = false; Capture = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnMouseCaptureChanged(EventArgs e) { if (!Capture) dragging = false; base.OnMouseCaptureChanged(e); }
        protected override void OnMouseWheel(MouseEventArgs e) { ScrollWheel(e.Delta); var handled = e as HandledMouseEventArgs; if (handled != null) handled.Handled = true; base.OnMouseWheel(e); }
        protected override bool IsInputKey(Keys keyData)
        {
            Keys key = keyData & Keys.KeyCode;
            return key == Keys.Up || key == Keys.Down || key == Keys.PageUp || key == Keys.PageDown || key == Keys.Home || key == Keys.End || base.IsInputKey(keyData);
        }
        protected override void OnKeyDown(KeyEventArgs e)
        {
            switch (e.KeyCode)
            {
                case Keys.Up: SetValue(position - SmallChange); break;
                case Keys.Down: SetValue(position + SmallChange); break;
                case Keys.PageUp: SetValue(position - viewport); break;
                case Keys.PageDown: SetValue(position + viewport); break;
                case Keys.Home: SetValue(0); break;
                case Keys.End: SetValue(Maximum); break;
                default: base.OnKeyDown(e); return;
            }
            e.Handled = e.SuppressKeyPress = true;
        }
    }

    // A clipped viewport with a source-controlled scrollbar. No hidden native
    // scrollbar or OS theme manipulation is needed to keep the dark appearance.
    internal sealed class ThemedScrollPanel : Panel
    {
        private readonly Panel clip = new Panel();
        internal readonly ThemedScrollBar ScrollBar = new ThemedScrollBar();
        private Control content;
        private bool arranging;
        internal int ScrollPosition { get { return ScrollBar.Value; } }
        internal int ScrollMaximum { get { return ScrollBar.Maximum; } }
        internal Rectangle ViewportBounds { get { return clip.Bounds; } }

        internal ThemedScrollPanel()
        {
            AutoScroll = false;
            clip.Name = "launcherScrollClip"; clip.Margin = Padding.Empty;
            ScrollBar.Name = "launcherBodyScrollBar";
            Controls.Add(clip); Controls.Add(ScrollBar);
            ScrollBar.ValueChanged += delegate { PositionContent(); };
            clip.MouseWheel += RouteWheel;
        }

        internal void SetContent(Control value)
        {
            content = value;
            content.Dock = DockStyle.None;
            content.AutoSize = false;
            clip.Controls.Add(content);
            content.Layout += delegate { Arrange(); };
            content.SizeChanged += delegate { Arrange(); };
            content.MouseWheel += RouteWheel;
            WatchFocus(content);
            Arrange();
        }

        private void WatchFocus(Control control)
        {
            if (control.TabStop && !(control is Panel) && !(control is Label))
                control.Enter += delegate { EnsureVisible(control); };
            control.ControlAdded += delegate(object sender, ControlEventArgs e) { WatchFocus(e.Control); };
            foreach (Control child in control.Controls) WatchFocus(child);
        }

        private void EnsureVisible(Control control)
        {
            if (content == null || !control.IsHandleCreated || !content.IsHandleCreated) return;
            Rectangle rect = content.RectangleToClient(control.RectangleToScreen(control.ClientRectangle));
            int next = ScrollBar.Value;
            if (rect.Top < next) next = rect.Top;
            else if (rect.Bottom > next + clip.Height) next = rect.Bottom - clip.Height;
            ScrollBar.SetValue(next);
        }

        private void RouteWheel(object sender, MouseEventArgs e)
        {
            var handled = e as HandledMouseEventArgs;
            if (handled != null && handled.Handled) return;
            if (!ScrollBar.HasOverflow) return;
            ScrollBar.ScrollWheel(e.Delta);
            if (handled != null) handled.Handled = true;
        }

        protected override void OnMouseWheel(MouseEventArgs e) { RouteWheel(this, e); base.OnMouseWheel(e); }
        protected override void OnLayout(LayoutEventArgs e) { base.OnLayout(e); Arrange(); }
        protected override void OnBackColorChanged(EventArgs e) { base.OnBackColorChanged(e); if (clip != null) clip.BackColor = BackColor; if (ScrollBar != null) ScrollBar.BackColor = BackColor; }

        private int MeasureContent(int width)
        {
            content.Width = width;
            content.PerformLayout();
            return Math.Max(content.MinimumSize.Height, content.GetPreferredSize(new Size(width, 0)).Height);
        }

        private void Arrange()
        {
            if (arranging || content == null || IsDisposed) return;
            arranging = true;
            try
            {
                int width = Math.Max(0, ClientSize.Width - Padding.Horizontal);
                int height = Math.Max(0, ClientSize.Height - Padding.Vertical);
                int extent = MeasureContent(width);
                bool overflow = extent > height;
                int gutter = overflow ? Math.Max(14, Font.Height) : 0;
                width = Math.Max(0, width - gutter);
                if (overflow) extent = MeasureContent(width);
                clip.Bounds = new Rectangle(Padding.Left, Padding.Top, width, height);
                ScrollBar.Bounds = new Rectangle(Padding.Left + width + 3, Padding.Top, Math.Max(10, gutter - 4), height);
                ScrollBar.Visible = overflow;
                ScrollBar.SmallChange = Math.Max(32, Font.Height * 3);
                ScrollBar.SetMetrics(extent, height, ScrollBar.Value);
                content.Size = new Size(width, extent);
                PositionContent();
            }
            finally { arranging = false; }
        }

        private void PositionContent() { if (content != null) content.Location = new Point(0, -ScrollBar.Value); }
    }

    // Keep the engine's exact TextBox instance and its copy/select/keyboard behavior.
    // The scrollbar only scrolls its native edit viewport and follows its first line.
    internal sealed class ThemedLogScroll : Panel
    {
        private readonly TextBox log;
        internal readonly ThemedScrollBar ScrollBar = new ThemedScrollBar();
        private readonly Timer sync = new Timer { Interval = 120 };
        private bool arranging;

        internal ThemedLogScroll(TextBox log)
        {
            this.log = log; Name = "launcherLogScroll"; Dock = DockStyle.Fill;
            log.ScrollBars = ScrollBars.None; log.Dock = DockStyle.None;
            ScrollBar.Name = "launcherLogScrollBar"; ScrollBar.SmallChange = 3;
            Controls.Add(log); Controls.Add(ScrollBar);
            ScrollBar.ValueChanged += delegate {
                if (!arranging && log.IsHandleCreated)
                {
                    int first = (int)SendMessage(log.Handle, 0xCE, IntPtr.Zero, IntPtr.Zero);
                    SendMessage(log.Handle, 0xB6, IntPtr.Zero, new IntPtr(ScrollBar.Value - first));
                    Sync();
                }
            };
            log.TextChanged += delegate { Sync(); };
            log.HandleCreated += delegate { Sync(); };
            log.Resize += delegate { Sync(); };
            log.MouseWheel += delegate(object sender, MouseEventArgs e) {
                if (!ScrollBar.HasOverflow) return;
                ScrollBar.ScrollWheel(e.Delta);
                var handled = e as HandledMouseEventArgs; if (handled != null) handled.Handled = true;
            };
            sync.Tick += delegate { Sync(); };
            VisibleChanged += delegate { sync.Enabled = Visible; if (Visible) Sync(); };
        }

        protected override void OnLayout(LayoutEventArgs e) { base.OnLayout(e); Sync(); }

        private void Sync()
        {
            if (arranging || IsDisposed || log == null) return;
            arranging = true;
            try
            {
                int visible = Math.Max(1, (Height - 2 * SystemInformation.BorderSize.Height) / Math.Max(1, log.Font.Height));
                int count = log.IsHandleCreated ? (int)SendMessage(log.Handle, 0xBA, IntPtr.Zero, IntPtr.Zero) : log.Lines.Length;
                int first = log.IsHandleCreated ? (int)SendMessage(log.Handle, 0xCE, IntPtr.Zero, IntPtr.Zero) : 0;
                bool overflow = count > visible;
                int gutter = overflow ? Math.Max(14, Font.Height) : 0;
                log.Bounds = new Rectangle(0, 0, Math.Max(0, Width - gutter), Height);
                ScrollBar.Bounds = new Rectangle(Math.Max(0, Width - gutter + 3), 0, Math.Max(10, gutter - 4), Height);
                ScrollBar.Visible = overflow;
                ScrollBar.SetMetrics(count, visible, first);
            }
            finally { arranging = false; }
        }

        protected override void Dispose(bool disposing) { if (disposing) sync.Dispose(); base.Dispose(disposing); }
        [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
    }
}
