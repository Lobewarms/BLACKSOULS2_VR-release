param(
    [Parameter(Mandatory)][string]$Archive,
    [Parameter(Mandatory)][string]$Version,
    [string]$OutputDirectory = 'dist',
    [string]$Compiler = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$archivePath = (Resolve-Path -LiteralPath $Archive).Path
python (Join-Path $PSScriptRoot 'package_release.py') --verify $archivePath --version $Version
if ($LASTEXITCODE -ne 0) { throw 'Distribution verification failed' }
if (-not (Test-Path -LiteralPath $Compiler)) { throw "Install Inno Setup 6 first: compiler missing at $Compiler" }
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
$stagingPath = Join-Path ([IO.Path]::GetTempPath()) ('blacksouls-installer-' + [guid]::NewGuid())
try {
    Expand-Archive -LiteralPath $archivePath -DestinationPath $stagingPath
    $payloadPath = Join-Path $stagingPath 'BLACKSOULS_VR'
    & $Compiler "/DAppVersion=$Version" "/DPayloadDir=$payloadPath" "/DInstallerOutput=$outputPath" (Join-Path $repoRoot 'packaging/windows/setup.iss')
    if ($LASTEXITCODE -ne 0) { throw 'Inno Setup compilation failed' }
    $installer = Join-Path $outputPath "BLACKSOULS_VR_Setup_$Version.exe"
    $digest = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText("$installer.sha256", "$digest  $([IO.Path]::GetFileName($installer))`n")
    Write-Output "Built $installer"
} finally {
    # Only remove the unique temporary directory created by this invocation.
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $resolvedStaging = [IO.Path]::GetFullPath($stagingPath)
    if (-not $resolvedStaging.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid staging path' }
    if (Test-Path -LiteralPath $resolvedStaging) { Remove-Item -LiteralPath $resolvedStaging -Recurse -Force }
}
