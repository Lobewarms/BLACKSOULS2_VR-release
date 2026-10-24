#ifndef AppVersion
  #error AppVersion must be supplied by the release build
#endif
#ifndef PayloadDir
  #error PayloadDir must point to the verified extracted distribution
#endif
#ifndef InstallerOutput
  #error InstallerOutput must be supplied by the release build
#endif
#ifndef RepositoryURL
  #error RepositoryURL must be supplied by the release build
#endif
#ifndef AppIconFile
  #error AppIconFile must point to the application icon
#endif

[Setup]
AppId={{691EADBE-DDB2-4460-AD58-B32AD0B36620}
AppName=BLACK SOULS II VR
AppVersion={#AppVersion}
AppPublisher=Lobewarms
AppPublisherURL={#RepositoryURL}
AppSupportURL={#RepositoryURL}/issues
AppUpdatesURL={#RepositoryURL}/releases
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
SetupIconFile={#AppIconFile}
UninstallDisplayIcon={app}\BlacksoulsVR.exe
CloseApplications=yes
RestartApplications=no
SetupLogging=yes

[Messages]
WelcomeLabel2=This will install BLACK SOULS II VR on your PC.%n%nYou will need your own copy of BLACK SOULS II. After setup, the app will look for your game automatically. Confirm the folder and click Launch.%n%nFor VR, connect your headset to your PC before launching the game.

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; Superseded documents installed by earlier community releases.
Type: files; Name: "{app}\FORK_README.md"
Type: files; Name: "{app}\FORK_VERSION.txt"
Type: files; Name: "{app}\FORK_NOTICE.txt"

[Icons]
Name: "{group}\BLACK SOULS II VR"; Filename: "{app}\BlacksoulsVR.exe"; WorkingDir: "{app}"; IconFilename: "{app}\BlacksoulsVR.exe"; IconIndex: 0
Name: "{group}\Controls"; Filename: "{app}\CONTROLS_en.txt"
Name: "{group}\How to play"; Filename: "{app}\START_HERE.txt"
Name: "{group}\Uninstall BLACK SOULS II VR"; Filename: "{uninstallexe}"; IconFilename: "{app}\BlacksoulsVR.exe"; IconIndex: 0
Name: "{autodesktop}\BLACK SOULS II VR"; Filename: "{app}\BlacksoulsVR.exe"; WorkingDir: "{app}"; Tasks: desktopicon; IconFilename: "{app}\BlacksoulsVR.exe"; IconIndex: 0

[Run]
Filename: "{app}\BlacksoulsVR.exe"; WorkingDir: "{app}"; Description: "Open BLACK SOULS II VR"; Flags: nowait postinstall skipifsilent
