// Capture Recording — native UIA helper (sidecar).
//
// A tiny, long-lived console process that the Electron main process talks to over
// stdio with line-delimited JSON. Given a physical screen point it returns the UI
// Automation element's bounding rectangle + control type + name, plus the top-level
// window rect and owning process name.
//
// Built with the Windows built-in .NET Framework 4.x csc.exe (no SDK required); the
// resulting exe runs on the .NET Framework 4.8 runtime shipped with Windows 10/11.
//
// Protocol (one JSON object per line):
//   ->  {"id":1,"cmd":"ping"}
//   <-  {"id":1,"ok":true,"pong":true}
//   ->  {"id":2,"cmd":"elementFromPoint","x":1280,"y":640}
//   <-  {"id":2,"ok":true,"element":{"x":..,"y":..,"w":..,"h":..,"controlType":"Button",
//         "name":"Save","editable":false},"window":{"x":..,"y":..,"w":..,"h":..,"process":"notepad"}}
//   <-  {"id":2,"ok":false,"error":"..."}
//
// All coordinates are PHYSICAL pixels (process is Per-Monitor-V2 DPI aware), matching
// the raw coordinates reported by the global mouse hook on the Electron side.

using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Automation;
using WpfPoint = System.Windows.Point;
using WpfRect = System.Windows.Rect;

internal static class NativeHelper
{
    private static void Main()
    {
        EnableDpiAwareness();

        var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
        Console.SetOut(stdout);
        var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));

        string line;
        while ((line = stdin.ReadLine()) != null)
        {
            if (line.Length == 0) continue;
            string response;
            int id = ExtractInt(line, "id") ?? 0;
            try
            {
                response = Handle(line, id);
            }
            catch (Exception ex)
            {
                response = "{\"id\":" + id + ",\"ok\":false,\"error\":" + Esc(ex.Message) + "}";
            }
            Console.Out.WriteLine(response);
        }
    }

    private static string Handle(string line, int id)
    {
        string cmd = ExtractString(line, "cmd") ?? "";
        switch (cmd)
        {
            case "ping":
                return "{\"id\":" + id + ",\"ok\":true,\"pong\":true}";
            case "elementFromPoint":
                int x = ExtractInt(line, "x") ?? 0;
                int y = ExtractInt(line, "y") ?? 0;
                return ElementFromPoint(id, x, y);
            case "focusedElement":
                return FocusedElement(id);
            case "capture":
                return CaptureScreen(
                    id,
                    ExtractInt(line, "x") ?? 0,
                    ExtractInt(line, "y") ?? 0,
                    ExtractInt(line, "w") ?? 0,
                    ExtractInt(line, "h") ?? 0
                );
            default:
                return "{\"id\":" + id + ",\"ok\":false,\"error\":\"unknown cmd\"}";
        }
    }

    private static string ElementFromPoint(int id, int x, int y)
    {
        AutomationElement el = null;
        try { el = AutomationElement.FromPoint(new WpfPoint(x, y)); } catch { }
        return BuildResponse(id, el, x, y);
    }

    private static string FocusedElement(int id)
    {
        AutomationElement el = null;
        int wx = 0, wy = 0;
        try
        {
            el = AutomationElement.FocusedElement;
            if (el != null)
            {
                WpfRect r = el.Current.BoundingRectangle;
                wx = (int)Math.Round(r.X + r.Width / 2);
                wy = (int)Math.Round(r.Y + r.Height / 2);
            }
        }
        catch { }
        return BuildResponse(id, el, wx, wy);
    }

    private static int captureSeq = 0;

    /** Fast GDI screen grab of a physical-pixel rect, written to a temp PNG. */
    private static string CaptureScreen(int id, int x, int y, int w, int h)
    {
        if (w <= 0 || h <= 0)
            return "{\"id\":" + id + ",\"ok\":false,\"error\":\"bad size\"}";
        try
        {
            using (var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb))
            using (var g = Graphics.FromImage(bmp))
            {
                g.CopyFromScreen(x, y, 0, 0, new Size(w, h), CopyPixelOperation.SourceCopy);
                int seq = captureSeq++ % 8; // rotate filenames to avoid unbounded temp files
                string path = Path.Combine(Path.GetTempPath(), "cr-grab-" + seq + ".png");
                bmp.Save(path, ImageFormat.Png);
                return "{\"id\":" + id + ",\"ok\":true,\"file\":" + Esc(path)
                    + ",\"x\":" + x + ",\"y\":" + y + ",\"w\":" + w + ",\"h\":" + h + "}";
            }
        }
        catch (Exception ex)
        {
            return "{\"id\":" + id + ",\"ok\":false,\"error\":" + Esc(ex.Message) + "}";
        }
    }

    private static string BuildResponse(int id, AutomationElement el, int winX, int winY)
    {
        var sb = new StringBuilder();
        sb.Append("{\"id\":").Append(id).Append(",\"ok\":true,\"element\":");
        AppendElement(sb, el);
        sb.Append(",\"window\":").Append(WindowAt(winX, winY));
        sb.Append("}");
        return sb.ToString();
    }

    private static void AppendElement(StringBuilder sb, AutomationElement el)
    {
        if (el == null) { sb.Append("null"); return; }
        try
        {
            WpfRect r = el.Current.BoundingRectangle;
            string ctrl = el.Current.ControlType != null
                ? el.Current.ControlType.ProgrammaticName.Replace("ControlType.", "")
                : "";
            string name = el.Current.Name ?? "";
            bool editable = IsEditable(el, ctrl);
            sb.Append("{\"x\":").Append(R(r.X))
              .Append(",\"y\":").Append(R(r.Y))
              .Append(",\"w\":").Append(R(r.Width))
              .Append(",\"h\":").Append(R(r.Height))
              .Append(",\"controlType\":").Append(Esc(ctrl))
              .Append(",\"name\":").Append(Esc(name))
              .Append(",\"editable\":").Append(editable ? "true" : "false")
              .Append("}");
        }
        catch
        {
            sb.Append("null");
        }
    }

    private static bool IsEditable(AutomationElement el, string ctrl)
    {
        if (ctrl == "Edit" || ctrl == "Document" || ctrl == "ComboBox") return true;
        try
        {
            object pattern;
            if (el.TryGetCurrentPattern(ValuePattern.Pattern, out pattern))
                return !((ValuePattern)pattern).Current.IsReadOnly;
        }
        catch { /* ignore */ }
        return false;
    }

    private static string WindowAt(int x, int y)
    {
        try
        {
            IntPtr hwnd = WindowFromPoint(new POINT { X = x, Y = y });
            if (hwnd == IntPtr.Zero) return "null";
            IntPtr root = GetAncestor(hwnd, GA_ROOT);
            if (root == IntPtr.Zero) root = hwnd;
            RECT rc;
            if (!GetWindowRect(root, out rc)) return "null";

            string proc = "";
            uint pid;
            GetWindowThreadProcessId(root, out pid);
            try { proc = Process.GetProcessById((int)pid).ProcessName; } catch { }

            return "{\"x\":" + rc.Left + ",\"y\":" + rc.Top
                 + ",\"w\":" + (rc.Right - rc.Left) + ",\"h\":" + (rc.Bottom - rc.Top)
                 + ",\"process\":" + Esc(proc) + "}";
        }
        catch
        {
            return "null";
        }
    }

    // ---- tiny JSON helpers (request parsing + response escaping) ----

    private static int? ExtractInt(string json, string key)
    {
        var m = Regex.Match(json, "\"" + key + "\"\\s*:\\s*(-?\\d+)");
        int v;
        if (m.Success && int.TryParse(m.Groups[1].Value, out v)) return v;
        return null;
    }

    private static string ExtractString(string json, string key)
    {
        var m = Regex.Match(json, "\"" + key + "\"\\s*:\\s*\"([^\"]*)\"");
        return m.Success ? m.Groups[1].Value : null;
    }

    private static string R(double d)
    {
        return ((int)Math.Round(d)).ToString(CultureInfo.InvariantCulture);
    }

    private static string Esc(string s)
    {
        if (s == null) return "null";
        var sb = new StringBuilder(s.Length + 2);
        sb.Append('"');
        foreach (char c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\b': sb.Append("\\b"); break;
                case '\f': sb.Append("\\f"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        sb.Append('"');
        return sb.ToString();
    }

    // ---- DPI awareness ----

    private static void EnableDpiAwareness()
    {
        try
        {
            // PER_MONITOR_AWARE_V2 = -4 (Windows 10 1703+)
            if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return;
        }
        catch { }
        try { SetProcessDpiAwareness(2 /* PROCESS_PER_MONITOR_DPI_AWARE */); return; }
        catch { }
        try { SetProcessDPIAware(); } catch { }
    }

    // ---- Win32 interop ----

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    private const uint GA_ROOT = 2;

    [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out RECT rc);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("shcore.dll")] private static extern int SetProcessDpiAwareness(int value);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
}
