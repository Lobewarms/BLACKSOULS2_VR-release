param([Parameter(Mandatory)][string]$Installer)
$ErrorActionPreference = 'Stop'
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('blacksouls-install-test-' + [guid]::NewGuid())
$installPath = Join-Path $testRoot 'Installed Mod'
New-Item -ItemType Directory -Path $testRoot | Out-Null
# Silent mode skips the optional launch of the upstream game launcher.
$process = Start-Process -FilePath $installerPath -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=`"$installPath`"", "/LOG=`"$testRoot\install.log`"") -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode); logs: $testRoot" }
$manifest = Get-Content -LiteralPath (Join-Path $installPath 'MANIFEST.json') -Raw | ConvertFrom-Json
foreach ($entry in $manifest.files.PSObject.Properties) {
    $relativePath = $entry.Name.Substring('BLACKSOULS_VR/'.Length)
    $installedFile = Join-Path $installPath $relativePath
    $actualDigest = (Get-FileHash -LiteralPath $installedFile -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualDigest -ne $entry.Value) { throw "Installed file differs: $relativePath" }
}
# An upgrade must retain player-created saves, and uninstall must not delete them.
$savePath = Join-Path $installPath 'saves'
New-Item -ItemType Directory -Path $savePath | Out-Null
$sentinel = Join-Path $savePath 'installer-test-save.txt'
Set-Content -LiteralPath $sentinel -Value 'preserve player data'
$process = Start-Process -FilePath $installerPath -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=`"$installPath`"") -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $sentinel)) { throw 'Upgrade failed or removed save' }
$process = Start-Process -FilePath (Join-Path $installPath 'unins000.exe') -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Uninstall failed: $($process.ExitCode)" }
if (-not (Test-Path -LiteralPath $sentinel)) { throw 'Uninstall deleted player-created save' }
if (Test-Path -LiteralPath (Join-Path $installPath 'BlacksoulsVR.exe')) { throw 'Uninstall did not remove launcher' }
Write-Output "Verified installation checksums, upgrade, uninstall and save retention. Logs: $testRoot"
