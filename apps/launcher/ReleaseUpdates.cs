using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace BlacksoulsCommunity
{
    internal sealed class ReleaseIdentity
    {
        public string Repository;
        public string Version;

        public static ReleaseIdentity Load(string directory)
        {
            var data = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(
                File.ReadAllText(Path.Combine(directory, "release.json")));
            string repository = Convert.ToString(data["repository"], CultureInfo.InvariantCulture);
            string version = Convert.ToString(data["version"], CultureInfo.InvariantCulture);
            if (Convert.ToInt32(data["schema"], CultureInfo.InvariantCulture) != 1 ||
                !Regex.IsMatch(repository, @"\A[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*\z") ||
                ReleaseUpdate.ParseVersion(version) == null)
                throw new InvalidDataException("The installation's release information is invalid. Please reinstall the app.");
            return new ReleaseIdentity { Repository = repository, Version = version };
        }

        public string LatestApi { get { return "https://api.github.com/repos/" + Repository + "/releases/latest"; } }
    }

    internal sealed class ReleaseUpdate
    {
        public string Version;
        public string InstallerUrl;
        public string ChecksumUrl;
        public string InstallerName;
        public long Size;

        // Stable releases use numeric SemVer; previews never replace a stable install.
        public static Version ParseVersion(string value)
        {
            if (value == null || !Regex.IsMatch(value, @"\A(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[A-Za-z0-9.-]+)?\z")) return null;
            Version parsed;
            return System.Version.TryParse(value.Split('-')[0], out parsed) ? parsed : null;
        }

        public static ReleaseUpdate Parse(string json, ReleaseIdentity current)
        {
            var release = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
            if (Convert.ToBoolean(release["draft"]) || Convert.ToBoolean(release["prerelease"])) return null;
            string tag = Convert.ToString(release["tag_name"], CultureInfo.InvariantCulture);
            string version = tag != null && tag.StartsWith("v", StringComparison.Ordinal) ? tag.Substring(1) : tag;
            Version available = ParseVersion(version), installed = ParseVersion(current.Version);
            if (available == null || installed == null || version.Contains("-") ||
                available < installed || (available == installed && !current.Version.Contains("-"))) return null;
            string name = "BLACKSOULS_VR_Setup_" + version + ".exe";
            string prefix = "https://github.com/" + current.Repository + "/releases/download/" + tag + "/";
            string installer = null, checksum = null;
            long size = 0;
            foreach (Dictionary<string, object> asset in (IEnumerable)release["assets"])
            {
                string assetName = Convert.ToString(asset["name"], CultureInfo.InvariantCulture);
                string url = Convert.ToString(asset["browser_download_url"], CultureInfo.InvariantCulture);
                if (url != prefix + assetName) continue;
                if (assetName == name) { installer = url; size = Convert.ToInt64(asset["size"], CultureInfo.InvariantCulture); }
                if (assetName == name + ".sha256") checksum = url;
            }
            if (installer == null || checksum == null || size <= 0 || size > 512L * 1024 * 1024)
                throw new InvalidDataException("The new release does not have a complete Windows installer yet. Please try again later.");
            return new ReleaseUpdate { Version = version, InstallerName = name, InstallerUrl = installer, ChecksumUrl = checksum, Size = size };
        }

        public void Verify(string path, string checksum)
        {
            var match = Regex.Match(checksum.Trim(), @"\A([a-fA-F0-9]{64})\s+\*?([^\r\n]+)\z");
            if (!match.Success || match.Groups[2].Value != InstallerName || new FileInfo(path).Length != Size)
                throw new InvalidDataException("The update download is incomplete. Please try again.");
            using (var algorithm = SHA256.Create())
            using (var stream = File.OpenRead(path))
            {
                string actual = BitConverter.ToString(algorithm.ComputeHash(stream)).Replace("-", "");
                if (!String.Equals(actual, match.Groups[1].Value, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("The update download failed its integrity check. Please try again.");
            }
        }
    }

    internal sealed class ReleaseClient : WebClient
    {
        public ReleaseClient()
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            Headers[HttpRequestHeader.UserAgent] = "BlacksoulsVR-Updater";
            Headers[HttpRequestHeader.Accept] = "application/vnd.github+json";
        }

        protected override WebRequest GetWebRequest(Uri address)
        {
            WebRequest request = base.GetWebRequest(address);
            request.Timeout = 30000;
            var http = request as HttpWebRequest;
            if (http != null) http.ReadWriteTimeout = 30000;
            return request;
        }

        public async Task<ReleaseUpdate> Check(ReleaseIdentity identity)
        {
            Task<string> request = DownloadStringTaskAsync(identity.LatestApi);
            await FinishWithin(request, 30000);
            return ReleaseUpdate.Parse(await request, identity);
        }

        private async Task FinishWithin(Task request, int milliseconds)
        {
            if (await Task.WhenAny(request, Task.Delay(milliseconds)) != request)
            {
                CancelAsync();
                try { await request; } catch (Exception) { }
                throw new TimeoutException("The update request timed out.");
            }
            await request;
        }

        public async Task<string> Download(ReleaseUpdate update, string directory)
        {
            Directory.CreateDirectory(directory);
            string path = Path.Combine(directory, update.InstallerName);
            try
            {
                Task<string> checksumRequest = DownloadStringTaskAsync(update.ChecksumUrl);
                await FinishWithin(checksumRequest, 30000);
                string checksum = await checksumRequest;
                await FinishWithin(DownloadFileTaskAsync(update.InstallerUrl, path), 600000);
                update.Verify(path, checksum);
                return path;
            }
            catch
            {
                if (File.Exists(path)) File.Delete(path);
                throw;
            }
        }
    }
}
