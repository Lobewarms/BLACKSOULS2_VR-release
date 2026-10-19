@echo off
rem Builds BlacksoulsVR.exe from this folder's source with the C# compiler that comes with Windows (.NET Framework 4.x)
rem and puts it in the folder above, in place of the one that came in the package.
setlocal
cd /d "%~dp0"
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo The C# compiler of .NET Framework 4.x was not found.
  pause
  exit /b 1
)
"%CSC%" -nologo -target:winexe -codepage:65001 -optimize+ -platform:anycpu -out:"..\BlacksoulsVR.exe" -r:System.Windows.Forms.dll -r:System.Drawing.dll -r:System.Web.Extensions.dll -r:System.Management.dll BlacksoulsVR.cs BuildInfo.cs
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)
echo Built: %~dp0..\BlacksoulsVR.exe
pause
