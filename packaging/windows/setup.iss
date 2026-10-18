#ifndef AppVersion
  #error AppVersion must be supplied by the release build
#endif
#ifndef PayloadDir
  #error PayloadDir must point to the verified extracted distribution
#endif
#ifndef InstallerOutput
  #error InstallerOutput must be supplied by the release build
#endif

[Setup]
AppId={{691EADBE-DDB2-4460-AD58-B32AD0B36620}
AppName=BLACK SOULS II VR Community Fork
AppVersion={#AppVersion}
AppPublisher=dimasma0305; original mod by Lobewarms
AppPublisherURL=https://github.com/dimasma0305/BLACKSOULS2_VR-release
AppSupportURL=https://github.com/dimasma0305/BLACKSOULS2_VR-release/issues
AppUpdatesURL=https://github.com/dimasma0305/BLACKSOULS2_VR-release/releases
DefaultDirName={localappdata}\Programs\BLACKSOULS-VR
DefaultGroupName=BLACK SOULS II VR
PrivilegesRequired=lowest
MinVersion=10.0
LicenseFile={#PayloadDir}\LICENSE
DisableWelcomePage=no
OutputDir={#InstallerOutput}
OutputBaseFilename=BLACKSOULS_VR_Setup_{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\BlacksoulsVR.exe
CloseApplications=yes
RestartApplications=no
SetupLogging=yes

[Messages]
WelcomeLabel2=This will install BLACK SOULS II VR on your PC.%n%nYou will need your own copy of BLACK SOULS II. After setup, the app will look for your game automatically. Confirm the folder and click Launch.%n%nFor VR, connect your headset to your PC before launching the game.%n%nModified community version by dimasma0305. Original VR mod by Lobewarms.

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; Superseded documents installed by earlier community releases.
Type: files; Name: "{app}\FORK_README.md"
Type: files; Name: "{app}\FORK_VERSION.txt"

[Icons]
Name: "{group}\BLACK SOULS II VR"; Filename: "{app}\BlacksoulsVR.exe"; WorkingDir: "{app}"
Name: "{group}\Controls"; Filename: "{app}\CONTROLS_en.txt"
Name: "{group}\How to play"; Filename: "{app}\START_HERE.txt"
Name: "{group}\Uninstall BLACK SOULS II VR"; Filename: "{uninstallexe}"
Name: "{autodesktop}\BLACK SOULS II VR"; Filename: "{app}\BlacksoulsVR.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\BlacksoulsVR.exe"; WorkingDir: "{app}"; Description: "Open BLACK SOULS II VR"; Flags: nowait postinstall skipifsilent
