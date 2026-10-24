$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$source = Join-Path $repoRoot 'apps/launcher'
$output = Join-Path $source 'dist'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$references = @('/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Web.Extensions.dll', '/r:System.Core.dll')
$icon = Join-Path $source 'Assets/app-icon.ico'
$banner = Join-Path $source 'Assets/launcher-banner.png'
foreach ($asset in @($icon, $banner)) {
    if (-not (Test-Path -LiteralPath $asset -PathType Leaf)) { throw "Launcher artwork missing: $asset" }
}
$branding = @("/win32icon:$icon", "/resource:$icon,BlacksoulsCommunity.AppIcon.ico", "/resource:$banner,BlacksoulsCommunity.LauncherBanner.png")
# Compile the reviewed upstream engine sources; the historical vendor EXE is
# never a build or package fallback. Hash LF-normalized UTF-8 for Git checkouts.
$engineSource = Join-Path $repoRoot 'apps/engine'
$enginePin = Get-Content -LiteralPath (Join-Path $engineSource 'upstream.json') -Raw | ConvertFrom-Json
function Get-BytesSha256([byte[]] $bytes) {
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hasher.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $hasher.Dispose() }
}
$engineSources = @()
$sourceLines = @()
$sourceHashes = [ordered]@{}
if ($enginePin.schema -ne 1 -or $enginePin.normalization -ne 'utf8-lf') { throw 'Unsupported engine source provenance' }
foreach ($entry in @($enginePin.source_sha256.PSObject.Properties | Sort-Object Name)) {
    if ($entry.Name -notin @('BlacksoulsVR.cs', 'BuildInfo.cs')) { throw 'Unexpected engine source' }
    $engineFile = Join-Path $engineSource $entry.Name
    $canonical = [IO.File]::ReadAllText($engineFile).Replace("`r`n", "`n")
    $digest = Get-BytesSha256 ([Text.Encoding]::UTF8.GetBytes($canonical))
    if ($digest -ne $entry.Value) { throw "Engine source differs from its reviewed provenance: $($entry.Name)" }
    $sourceHashes[$entry.Name] = $digest
    $sourceLines += "$($entry.Name):$digest`n"
    $engineSources += $engineFile
}
if ($engineSources.Count -ne 2) { throw 'Incomplete engine source provenance' }
$engineOutput = Join-Path $output 'BlacksoulsVR.Engine.exe'
& $compiler /nologo /codepage:65001 /warnaserror /optimize+ /platform:anycpu /target:winexe /main:BlacksoulsVR.Program "/out:$engineOutput" $references /r:System.Management.dll "/win32icon:$icon" $engineSources
if ($LASTEXITCODE -ne 0) { throw 'Engine source build failed' }
$engineProvenance = [ordered]@{
    schema = 1
    upstream_commit = $enginePin.commit
    source_sha256 = $sourceHashes
    source_tree_sha256 = Get-BytesSha256 ([Text.Encoding]::UTF8.GetBytes(($sourceLines -join '')))
    engine_sha256 = (Get-FileHash -LiteralPath $engineOutput -Algorithm SHA256).Hash.ToLowerInvariant()
}
[IO.File]::WriteAllText((Join-Path $output 'engine-build.json'), ($engineProvenance | ConvertTo-Json -Depth 4) + "`n", [Text.UTF8Encoding]::new($false))
& $compiler /nologo /codepage:65001 /warnaserror /optimize+ /target:exe /main:EngineRuntimeTests "/out:$output/EngineRuntimeTests.exe" $references (Join-Path $source 'tests/EngineRuntimeTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Engine runtime tests build failed' }
& (Join-Path $output 'EngineRuntimeTests.exe')
if ($LASTEXITCODE -ne 0) { throw 'Source-built engine runtime tests failed' }
$sources = @(Get-ChildItem -LiteralPath $source -Filter '*.cs' | ForEach-Object FullName)
& $compiler /nologo /codepage:65001 /warnaserror /optimize+ /target:winexe /main:BlacksoulsCommunity.Program "/out:$output/BlacksoulsVR.exe" $references $branding $sources
if ($LASTEXITCODE -ne 0) { throw 'Launcher build failed' }
& $compiler /nologo /codepage:65001 /warnaserror /optimize+ /platform:x86 /target:exe /main:BlacksoulsCommunity.SteamAchievementWorker "/out:$output/SteamAchievements.exe" $references (Join-Path $source 'SteamAchievementWorker.cs')
if ($LASTEXITCODE -ne 0) { throw 'Steam achievement helper build failed' }
& $compiler /nologo /codepage:65001 /warnaserror /optimize+ /platform:x86 /target:exe /main:SteamAchievementTests "/out:$output/SteamAchievementTests.exe" $references (Join-Path $source 'SteamAchievementWorker.cs') (Join-Path $source 'tests/SteamAchievementTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Steam achievement tests build failed' }
& (Join-Path $output 'SteamAchievementTests.exe')
if ($LASTEXITCODE -ne 0) { throw 'Steam achievement tests failed' }
& $compiler /nologo /codepage:65001 /warnaserror /optimize+ /target:exe /main:SteamAchievementHostTests "/out:$output/SteamAchievementHostTests.exe" $references $branding $sources (Join-Path $source 'tests/SteamAchievementHostTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Steam bridge tests build failed' }
& (Join-Path $output 'SteamAchievementHostTests.exe')
if ($LASTEXITCODE -ne 0) { throw 'Steam bridge tests failed' }
& $compiler /nologo /codepage:65001 /warnaserror /optimize+ /target:exe /main:BrandingTests "/out:$output/BrandingTests.exe" $references $branding (Join-Path $source 'tests/BrandingTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Branding test build failed' }
& (Join-Path $output 'BrandingTests.exe') (Join-Path $output 'BlacksoulsVR.exe') $icon $banner
if ($LASTEXITCODE -ne 0) { throw 'Launcher branding tests failed' }
& $compiler /nologo /codepage:65001 /warnaserror /optimize+ /target:exe /main:DiscoveryTests "/out:$output/DiscoveryTests.exe" $references $branding $sources (Join-Path $source 'tests/DiscoveryTests.cs') (Join-Path $source 'tests/AssetCacheTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Discovery test build failed' }
& (Join-Path $output 'DiscoveryTests.exe')
if ($LASTEXITCODE -ne 0) { throw 'Discovery tests failed' }
& $compiler /nologo /codepage:65001 /warnaserror /optimize+ /target:exe /main:UpdateTests "/out:$output/UpdateTests.exe" $references $branding $sources (Join-Path $source 'tests/UpdateTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Update test build failed' }
# Run hosting tests in a fresh temporary installation, away from player settings.
$testDirectory = Join-Path ([IO.Path]::GetTempPath()) ('blacksouls-update-test-' + [guid]::NewGuid())
try {
    New-Item -ItemType Directory -Path $testDirectory | Out-Null
    Copy-Item -LiteralPath "$output/UpdateTests.exe" -Destination $testDirectory
    Copy-Item -LiteralPath $engineOutput -Destination (Join-Path $testDirectory 'BlacksoulsVR.Engine.exe')
    & (Join-Path $testDirectory 'UpdateTests.exe')
    if ($LASTEXITCODE -ne 0) { throw 'Update and engine hosting tests failed' }
} finally {
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $resolvedTest = [IO.Path]::GetFullPath($testDirectory)
    if (-not $resolvedTest.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid temporary test path' }
    if (Test-Path -LiteralPath $resolvedTest) { Remove-Item -LiteralPath $resolvedTest -Recurse -Force }
}
