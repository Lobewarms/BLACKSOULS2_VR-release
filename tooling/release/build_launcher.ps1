$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$source = Join-Path $repoRoot 'apps/launcher'
$output = Join-Path $source 'dist'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$references = @('/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Web.Extensions.dll', '/r:System.Core.dll')
$sources = @((Join-Path $source 'GameDiscovery.cs'), (Join-Path $source 'Program.cs'))
& $compiler /nologo /codepage:65001 /warnaserror /optimize+ /target:winexe "/out:$output/BlacksoulsVR.exe" $references $sources
if ($LASTEXITCODE -ne 0) { throw 'Launcher build failed' }
& $compiler /nologo /codepage:65001 /warnaserror /optimize+ /target:exe /main:DiscoveryTests "/out:$output/DiscoveryTests.exe" $references $sources (Join-Path $source 'tests/DiscoveryTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Discovery test build failed' }
& (Join-Path $output 'DiscoveryTests.exe')
if ($LASTEXITCODE -ne 0) { throw 'Discovery tests failed' }
