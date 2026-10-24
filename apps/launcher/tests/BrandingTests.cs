using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;

internal static class BrandingTests
{
    private static int assertions;
    private static void Check(bool value, string message)
    {
        assertions++;
        if (!value) throw new Exception(message);
    }

    private delegate bool ResourceNameCallback(IntPtr module, IntPtr type, IntPtr name, IntPtr parameter);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadLibraryEx(string path, IntPtr file, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool EnumResourceNames(IntPtr module, IntPtr type, ResourceNameCallback callback, IntPtr parameter);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr FindResource(IntPtr module, IntPtr name, IntPtr type);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint SizeofResource(IntPtr module, IntPtr resource);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
    [DllImport("kernel32.dll")]
    private static extern IntPtr LockResource(IntPtr resource);
    [DllImport("kernel32.dll")]
    private static extern bool FreeLibrary(IntPtr module);

    private static byte[] NativeResource(IntPtr module, IntPtr type, IntPtr name)
    {
        IntPtr resource = FindResource(module, name, type);
        Check(resource != IntPtr.Zero, "Find native icon resource");
        uint size = SizeofResource(module, resource);
        IntPtr content = LockResource(LoadResource(module, resource));
        Check(size > 0 && size < 4 * 1024 * 1024 && content != IntPtr.Zero, "Read bounded native icon resource");
        var bytes = new byte[(int)size];
        Marshal.Copy(content, bytes, 0, bytes.Length);
        return bytes;
    }

    private static byte[] ManagedResource(Assembly assembly, string name)
    {
        using (Stream source = assembly.GetManifestResourceStream(name))
        {
            Check(source != null, "Find embedded launcher artwork: " + name);
            using (var target = new MemoryStream()) { source.CopyTo(target); return target.ToArray(); }
        }
    }

    public static int Main(string[] args)
    {
        IntPtr module = IntPtr.Zero;
        try
        {
            Check(args.Length == 3, "Supply built launcher, source icon and source banner");
            string executable = Path.GetFullPath(args[0]);
            byte[] icon = File.ReadAllBytes(args[1]), banner = File.ReadAllBytes(args[2]);
            Assembly assembly = Assembly.Load(File.ReadAllBytes(executable));
            Check(ManagedResource(assembly, "BlacksoulsCommunity.AppIcon.ico").SequenceEqual(icon), "Window/taskbar icon uses the source community icon");
            Check(ManagedResource(assembly, "BlacksoulsCommunity.LauncherBanner.png").SequenceEqual(banner), "Launcher banner is embedded unchanged");
            using (var source = new MemoryStream(banner))
            using (Image image = Image.FromStream(source))
                Check(image.Width >= 640 && image.Width > image.Height, "Launcher banner is a readable landscape image");
            Check(BitConverter.ToUInt16(icon, 0) == 0 && BitConverter.ToUInt16(icon, 2) == 1, "Source is a Windows icon");
            int count = BitConverter.ToUInt16(icon, 4);
            var frames = new Dictionary<int, byte[]>();
            for (int i = 0; i < count; i++)
            {
                int offset = 6 + i * 16;
                int width = icon[offset] == 0 ? 256 : icon[offset];
                int height = icon[offset + 1] == 0 ? 256 : icon[offset + 1];
                int size = BitConverter.ToInt32(icon, offset + 8), start = BitConverter.ToInt32(icon, offset + 12);
                Check(width == height && size > 0 && start >= 6 + count * 16 && start <= icon.Length - size, "Source icon frame is square and complete");
                frames.Add(width, icon.Skip(start).Take(size).ToArray());
            }
            Check(frames.Keys.OrderBy(value => value).SequenceEqual(new[] { 16, 24, 32, 48, 64, 128, 256 }),
                "Icon includes native sizes for Windows desktop, Start menu, taskbar and high DPI");
            module = LoadLibraryEx(executable, IntPtr.Zero, 2); // Read resources without running the launcher.
            Check(module != IntPtr.Zero, "Load compiled launcher resources");
            byte[] group = null;
            ResourceNameCallback firstGroup = (loaded, type, name, parameter) => {
                if (group == null) group = NativeResource(loaded, type, name);
                return true;
            };
            Check(EnumResourceNames(module, new IntPtr(14), firstGroup, IntPtr.Zero), "Launcher has a native Windows icon group");
            Check(group != null && BitConverter.ToUInt16(group, 4) == count, "Native icon group retains every source size");
            for (int i = 0; i < count; i++)
            {
                int offset = 6 + i * 14;
                int width = group[offset] == 0 ? 256 : group[offset];
                ushort id = BitConverter.ToUInt16(group, offset + 12);
                byte[] compiled = NativeResource(module, new IntPtr(3), new IntPtr(id));
                Check(frames.ContainsKey(width) && compiled.SequenceEqual(frames[width]), "Compiled Windows icon matches community artwork at size " + width);
            }
            Console.WriteLine("Passed " + assertions + " application icon and launcher artwork checks.");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        finally { if (module != IntPtr.Zero) FreeLibrary(module); }
    }
}
