; النوخذة — Windows installer (Inno Setup)
;
; Produces a single downloadable Setup .exe. Inno Setup is pre-installed on
; GitHub's windows-latest runners, so CI can build this without extra tooling.
;
; Deliberately per-user (PrivilegesRequired=lowest): النوخذة keeps a person's
; own records and needs nothing from the machine, so demanding an administrator
; prompt to install it would be asking for a privilege it has no use for.

#define AppName "النوخذة"
#define AppNameLatin "Nokhatha"
#define AppPublisher "المهلب كود — Almuhallab Code"
#define AppUrl "https://www.almuhallab-code.com/"
#define AppCopyright "Copyright © 2026 Almuhallab Code. All rights reserved."
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif

[Setup]
AppId={{7B2A9C31-4E5D-4A18-9C6F-8D1B0A3E5C42}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}
AppUpdatesURL={#AppUrl}
; Ownership, in the three places Windows reads it from: the Programs list,
; Setup.exe's own file properties, and the uninstall entry. Without these the
; installer inherits Inno's defaults and names nobody as its author.
AppCopyright={#AppCopyright}
VersionInfoCompany={#AppPublisher}
VersionInfoCopyright={#AppCopyright}
VersionInfoProductName={#AppName} ({#AppNameLatin})
VersionInfoDescription={#AppNameLatin} Setup — {#AppPublisher}
VersionInfoVersion={#AppVersion}
DefaultDirName={autopf}\{#AppNameLatin}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\..\dist
OutputBaseFilename=Nokhatha-Setup-{#AppVersion}
SetupIconFile=..\runner\resources\app_icon.ico
UninstallDisplayIcon={app}\nokhatha.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Windows 11 and 10: Flutter's Windows embedder does not support anything older.
MinVersion=10.0.17763
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "arabic"; MessagesFile: "compiler:Languages\Arabic.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; \
  GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; The whole Flutter release bundle: the exe, its DLLs, and the data folder.
Source: "..\..\build\windows\x64\runner\Release\*"; DestDir: "{app}"; \
  Flags: ignoreversion recursesubdirs createallsubdirs
; Ownership travels with the install, not only with the download page. No font
; licence is shipped here on purpose: this app bundles no typeface — it uses
; the platform's own Arabic face — and carrying the OFL beside no font would
; claim something untrue about what was installed.
Source: "..\..\..\LICENSE"; DestDir: "{app}"; DestName: "LICENSE.txt"; \
  Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\nokhatha.exe"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\nokhatha.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\nokhatha.exe"; \
  Description: "{cm:LaunchProgram,{#AppName}}"; \
  Flags: nowait postinstall skipifsilent
