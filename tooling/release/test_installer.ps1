param([Parameter(Mandatory)][string]$Installer)
$ErrorActionPreference = 'Stop'
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('blacksouls-install-test-' + [guid]::NewGuid())
$installPath = Join-Path $testRoot 'Installed Mod'
$shortcutGroup = 'BLACK SOULS II VR Test ' + [IO.Path]::GetFileName($testRoot)
New-Item -ItemType Directory -Path $testRoot | Out-Null
# Silent mode skips the optional launch of the upstream game launcher.
$process = Start-Process -FilePath $installerPath -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=`"$installPath`"", "/GROUP=`"$shortcutGroup`"", "/LOG=`"$testRoot\install.log`"") -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode); logs: $testRoot" }
$manifest = Get-Content -LiteralPath (Join-Path $installPath 'MANIFEST.json') -Raw | ConvertFrom-Json
foreach ($entry in $manifest.files.PSObject.Properties) {
    $relativePath = $entry.Name.Substring('BLACKSOULS_VR/'.Length)
    $installedFile = Join-Path $installPath $relativePath
    $actualDigest = (Get-FileHash -LiteralPath $installedFile -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualDigest -ne $entry.Value) { throw "Installed file differs: $relativePath" }
}
# The Start menu must use the installed community executable for its target and icon.
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Programs')) "$shortcutGroup\BLACK SOULS II VR.lnk"
if (-not (Test-Path -LiteralPath $shortcutPath)) { throw 'Installer did not create its Start menu shortcut' }
$shell = New-Object -ComObject WScript.Shell
try {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $launcherPath = Join-Path $installPath 'BlacksoulsVR.exe'
    if (-not [String]::Equals($shortcut.TargetPath, $launcherPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'Start menu shortcut targets a different application' }
    $iconLocation = $shortcut.IconLocation -split ','
    if (-not [String]::Equals($iconLocation[0].Trim(), $launcherPath, [StringComparison]::OrdinalIgnoreCase) -or $iconLocation[-1].Trim() -ne '0') { throw 'Start menu shortcut does not use the community launcher icon' }
} finally {
    if ($shortcut) { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) | Out-Null }
    [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) | Out-Null
}
# Exercise the actual installed entry assembly, including the hosted vendor form.
$preview = Join-Path $testRoot 'launcher.png'
$process = Start-Process -FilePath (Join-Path $installPath 'BlacksoulsVR.exe') -ArgumentList @('--lang', 'en', '--screenshot', "`"$preview`"") -WorkingDirectory $installPath -WindowStyle Hidden -PassThru
if (-not $process.WaitForExit(15000)) { Stop-Process -Id $process.Id -Force; throw 'Installed launcher did not open and render' }
if (-not (Test-Path -LiteralPath $preview)) { throw 'Installed launcher failed to render its form' }
# An upgrade must retain player-created saves, and uninstall must not delete them.
$savePath = Join-Path $installPath 'saves'
New-Item -ItemType Directory -Path $savePath | Out-Null
$sentinel = Join-Path $savePath 'installer-test-save.txt'
Set-Content -LiteralPath $sentinel -Value 'preserve player data'
# Simulate documents left by the older installer before upgrading.
foreach ($obsolete in @('FORK_README.md', 'FORK_VERSION.txt')) {
    Set-Content -LiteralPath (Join-Path $installPath $obsolete) -Value 'obsolete community document'
}
$process = Start-Process -FilePath $installerPath -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=`"$installPath`"", "/GROUP=`"$shortcutGroup`"") -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $sentinel)) { throw 'Upgrade failed or removed save' }
foreach ($obsolete in @('FORK_README.md', 'FORK_VERSION.txt')) {
    if (Test-Path -LiteralPath (Join-Path $installPath $obsolete)) { throw "Upgrade retained obsolete document: $obsolete" }
}
$process = Start-Process -FilePath (Join-Path $installPath 'unins000.exe') -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Uninstall failed: $($process.ExitCode)" }
if (-not (Test-Path -LiteralPath $sentinel)) { throw 'Uninstall deleted player-created save' }
if (Test-Path -LiteralPath (Join-Path $installPath 'BlacksoulsVR.exe')) { throw 'Uninstall did not remove launcher' }
if (Test-Path -LiteralPath $shortcutPath) { throw 'Uninstall retained the application shortcut' }
Write-Output "Verified installation checksums, community shortcut icon, upgrade, uninstall and save retention. Logs: $testRoot"
