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
    internal enum ReleaseCheckFailure { Connection, Timeout, SecureConnection, Forbidden, RateLimited, NotFound, ServiceUnavailable, Http, InvalidResponse, IncompleteRelease }

    internal sealed class ReleaseCheckException : Exception
    {
        public readonly ReleaseCheckFailure Failure;
        public readonly int StatusCode;
        public readonly DateTime RetryAfterUtc;

        public ReleaseCheckException(ReleaseCheckFailure failure, Exception inner, int statusCode = 0, DateTime retryAfterUtc = default(DateTime))
            : base("The update check failed: " + failure, inner)
        {
            Failure = failure; StatusCode = statusCode; RetryAfterUtc = retryAfterUtc;
        }

        public string PlayerMessage(string language)
        {
            string text;
            switch (Failure)
            {
                case ReleaseCheckFailure.RateLimited: text = Choose(language,
                    "GitHub is temporarily limiting update checks. Please try again later.",
                    "GitHubにより更新確認が一時的に制限されています。しばらくしてから再試行してください。",
                    "GitHub가 업데이트 확인을 일시적으로 제한하고 있습니다. 잠시 후 다시 시도하세요.",
                    "GitHub暂时限制了更新检查，请稍后重试。"); break;
                case ReleaseCheckFailure.Forbidden: text = Choose(language,
                    "GitHub refused the update check (HTTP 403). Please try again later.",
                    "GitHubが更新確認を拒否しました（HTTP 403）。しばらくしてから再試行してください。",
                    "GitHub가 업데이트 확인을 거부했습니다(HTTP 403). 잠시 후 다시 시도하세요.",
                    "GitHub拒绝了更新检查（HTTP 403），请稍后重试。"); break;
                case ReleaseCheckFailure.NotFound: text = Choose(language,
                    "No published update was found for this app. Please try again later.",
                    "このアプリの公開済み更新が見つかりません。しばらくしてから再試行してください。",
                    "이 앱에 게시된 업데이트를 찾지 못했습니다. 잠시 후 다시 시도하세요.",
                    "未找到此应用已发布的更新，请稍后重试。"); break;
                case ReleaseCheckFailure.ServiceUnavailable: text = Choose(language,
                    "GitHub's update service is temporarily unavailable. Please try again later.",
                    "GitHubの更新サービスが一時的に利用できません。しばらくしてから再試行してください。",
                    "GitHub 업데이트 서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도하세요.",
                    "GitHub更新服务暂时不可用，请稍后重试。"); break;
                case ReleaseCheckFailure.Timeout: text = Choose(language,
                    "The update check timed out. Please try again.", "更新確認がタイムアウトしました。再試行してください。",
                    "업데이트 확인 시간이 초과되었습니다. 다시 시도하세요.", "更新检查超时，请重试。"); break;
                case ReleaseCheckFailure.SecureConnection: text = Choose(language,
                    "A secure connection to GitHub couldn't be established. Check your Windows date and network settings.",
                    "GitHubへの安全な接続を確立できませんでした。Windowsの日付とネットワーク設定を確認してください。",
                    "GitHub에 보안 연결을 설정하지 못했습니다. Windows 날짜와 네트워크 설정을 확인하세요.",
                    "无法与GitHub建立安全连接，请检查Windows日期和网络设置。"); break;
                case ReleaseCheckFailure.IncompleteRelease: text = Choose(language,
                    "The new version's Windows installer isn't ready yet. Please try again later.",
                    "新バージョンのWindowsインストーラーはまだ準備されていません。しばらくしてから再試行してください。",
                    "새 버전의 Windows 설치 프로그램이 아직 준비되지 않았습니다. 잠시 후 다시 시도하세요.",
                    "新版本的Windows安装程序尚未准备就绪，请稍后重试。"); break;
                case ReleaseCheckFailure.InvalidResponse: text = Choose(language,
                    "The update service returned an unreadable response. Please try again later.",
                    "更新サービスから読み取れない応答が返されました。しばらくしてから再試行してください。",
                    "업데이트 서비스에서 읽을 수 없는 응답을 받았습니다. 잠시 후 다시 시도하세요.",
                    "更新服务返回了无法读取的响应，请稍后重试。"); break;
                case ReleaseCheckFailure.Http: text = Choose(language,
                    "The update service returned HTTP ", "更新サービスの応答: HTTP ",
                    "업데이트 서비스 응답: HTTP ", "更新服务返回HTTP ") + StatusCode + "."; break;
                default: text = Choose(language,
                    "Couldn't connect to GitHub to check for updates. Check your connection and try again.",
                    "更新確認のためGitHubに接続できませんでした。接続を確認して再試行してください。",
                    "업데이트 확인을 위해 GitHub에 연결하지 못했습니다. 연결을 확인하고 다시 시도하세요.",
                    "无法连接GitHub检查更新，请检查网络连接后重试。"); break;
            }
            if (Failure == ReleaseCheckFailure.RateLimited && RetryAfterUtc != default(DateTime))
                text += " " + Choose(language, "Try after ", "再試行可能時刻: ", "다음 시간 이후 재시도: ", "可重试时间：") + RetryAfterUtc.ToLocalTime().ToString("t", CultureInfo.CurrentCulture) + ".";
            return text;
        }

        private static string Choose(string language, string en, string ja, string ko, string zh)
        {
            return language == "ja" ? ja : language == "ko" ? ko : language == "zh" ? zh : language == "ru" ? LauncherRussian.Text(en) : en;
        }
    }

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
        private DateTime retryAfterUtc;

        public ReleaseClient()
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
        }

        protected override WebRequest GetWebRequest(Uri address)
        {
            WebRequest request = base.GetWebRequest(address);
            request.Timeout = 30000;
            var http = request as HttpWebRequest;
            if (http != null)
            {
                http.ReadWriteTimeout = 30000;
                // Framework WebClient consumes restricted Headers (including User-Agent)
                // on the first request. Set them on every actual request, including downloads.
                http.UserAgent = "BlacksoulsVR-Updater";
                http.Accept = address.Host.Equals("api.github.com", StringComparison.OrdinalIgnoreCase) ? "application/vnd.github+json" : "*/*";
            }
            return request;
        }

        public Task<ReleaseUpdate> Check(ReleaseIdentity identity)
        {
            return CheckAt(identity, new Uri(identity.LatestApi));
        }

        // Separate the HTTP boundary so regression tests use a local server, not GitHub's quota.
        internal async Task<ReleaseUpdate> CheckAt(ReleaseIdentity identity, Uri endpoint)
        {
            if (DateTime.UtcNow < retryAfterUtc)
                throw new ReleaseCheckException(ReleaseCheckFailure.RateLimited, null, 0, retryAfterUtc);
            string json;
            try
            {
                Task<string> request = DownloadStringTaskAsync(endpoint);
                await FinishWithin(request, 30000);
                json = await request;
            }
            catch (WebException error)
            {
                var failure = Describe(error);
                if (failure.Failure == ReleaseCheckFailure.RateLimited) retryAfterUtc = failure.RetryAfterUtc;
                throw failure;
            }
            catch (TimeoutException error) { throw new ReleaseCheckException(ReleaseCheckFailure.Timeout, error); }
            try { return ReleaseUpdate.Parse(json, identity); }
            catch (InvalidDataException error) { throw new ReleaseCheckException(ReleaseCheckFailure.IncompleteRelease, error); }
            catch (Exception error)
            {
                if (error is ArgumentException || error is InvalidOperationException || error is KeyNotFoundException || error is InvalidCastException || error is FormatException || error is NullReferenceException || error is OverflowException)
                    throw new ReleaseCheckException(ReleaseCheckFailure.InvalidResponse, error);
                throw;
            }
        }

        internal static ReleaseCheckException Describe(WebException error)
        {
            var response = error.Response as HttpWebResponse;
            if (response != null)
            {
                int code = (int)response.StatusCode;
                if (code == 429 || (code == 403 && (response.Headers["X-RateLimit-Remaining"] == "0" || response.Headers["Retry-After"] != null)))
                {
                    DateTime retry = DateTime.UtcNow.AddMinutes(1);
                    long seconds;
                    DateTime date;
                    if (Int64.TryParse(response.Headers["X-RateLimit-Reset"], NumberStyles.None, CultureInfo.InvariantCulture, out seconds) && seconds > 0 && seconds < 253402300799L)
                        retry = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddSeconds(seconds);
                    if (Int64.TryParse(response.Headers["Retry-After"], NumberStyles.None, CultureInfo.InvariantCulture, out seconds) && seconds >= 0 && seconds < 86400)
                        retry = DateTime.UtcNow.AddSeconds(seconds);
                    else if (DateTime.TryParse(response.Headers["Retry-After"], CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out date)) retry = date;
                    // Avoid hammering an exhausted endpoint when a stale reset time is returned.
                    if (retry < DateTime.UtcNow.AddSeconds(1)) retry = DateTime.UtcNow.AddMinutes(1);
                    return new ReleaseCheckException(ReleaseCheckFailure.RateLimited, error, code, retry);
                }
                return new ReleaseCheckException(code == 403 ? ReleaseCheckFailure.Forbidden : code == 404 ? ReleaseCheckFailure.NotFound : code >= 500 ? ReleaseCheckFailure.ServiceUnavailable : ReleaseCheckFailure.Http, error, code);
            }
            return new ReleaseCheckException(error.Status == WebExceptionStatus.Timeout ? ReleaseCheckFailure.Timeout :
                error.Status == WebExceptionStatus.TrustFailure || error.Status == WebExceptionStatus.SecureChannelFailure ? ReleaseCheckFailure.SecureConnection : ReleaseCheckFailure.Connection, error);
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
