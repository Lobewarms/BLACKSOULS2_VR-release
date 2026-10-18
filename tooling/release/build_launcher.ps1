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
$sources = @(Get-ChildItem -LiteralPath $source -Filter '*.cs' | ForEach-Object FullName)
& $compiler /nologo /codepage:65001 /warnaserror /optimize+ /target:winexe "/out:$output/BlacksoulsVR.exe" $references $branding $sources
if ($LASTEXITCODE -ne 0) { throw 'Launcher build failed' }
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
    Copy-Item -LiteralPath (Join-Path $repoRoot 'vendor/launcher/BlacksoulsVR.exe') -Destination (Join-Path $testDirectory 'BlacksoulsVR.Engine.exe')
    & (Join-Path $testDirectory 'UpdateTests.exe')
    if ($LASTEXITCODE -ne 0) { throw 'Update and engine hosting tests failed' }
} finally {
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $resolvedTest = [IO.Path]::GetFullPath($testDirectory)
    if (-not $resolvedTest.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid temporary test path' }
    if (Test-Path -LiteralPath $resolvedTest) { Remove-Item -LiteralPath $resolvedTest -Recurse -Force }
}
