; INKWELL  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
; The Windows installer, built by Inno Setup on GitHub's Windows machine.
; It installs for the current user only (no administrator needed) into
; %LOCALAPPDATA%\Programs\Inkwell, and registers an uninstaller in
; Settings, Apps. Your documents stay in %LOCALAPPDATA%\Inkwell\storage, a
; different folder that neither installing nor uninstalling ever touches.

#ifndef AppVersion
  #define AppVersion "7.41"
#endif
#ifndef SourceDir
  #define SourceDir "..\dist\Inkwell"
#endif
#ifndef OutputDir
  #define OutputDir "..\dist"
#endif

[Setup]
AppId={{6E1B7C52-8F3A-4C1D-9B7E-2A5D4F0C9E31}
AppName=Inkwell
AppVersion={#AppVersion}
AppVerName=Inkwell {#AppVersion}
AppPublisher=Yannie D. Forest
DefaultDirName={localappdata}\Programs\Inkwell
DefaultGroupName=Inkwell
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=Inkwell-{#AppVersion}-Windows-Setup
SetupIconFile=..\inkwell.ico
UninstallDisplayIcon={app}\Inkwell.exe
UninstallDisplayName=Inkwell
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
ArchitecturesInstallIn64BitMode=x64compatible

[Tasks]
; 7.38: the Desktop shortcut is now unticked unless the writer ticks it. The
; task has a new name because Inno Setup otherwise reuses the earlier answer
; on an update; [InstallDelete] below removes the old shortcut first, so an
; update with the box unticked clears the Desktop. The Start menu entry stays.
Name: "desktopshortcut"; Description: "Also put Inkwell on the Desktop"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\Inkwell"; Filename: "{app}\Inkwell.exe"; WorkingDir: "{app}"; Comment: "Inkwell {#AppVersion}"
Name: "{userdesktop}\Inkwell"; Filename: "{app}\Inkwell.exe"; WorkingDir: "{app}"; Comment: "Inkwell {#AppVersion}"; Tasks: desktopshortcut

[InstallDelete]
; The program files of the older installer, which ran Inkwell through Python.
; Only program files: the storage and backups folders are never named here.
Type: files; Name: "{localappdata}\Inkwell\Inkwell.html"
Type: files; Name: "{localappdata}\Inkwell\inkwell_app.py"
Type: files; Name: "{localappdata}\Inkwell\server.py"
Type: files; Name: "{localappdata}\Inkwell\inkwell.png"
Type: files; Name: "{localappdata}\Inkwell\inkwell.ico"
Type: files; Name: "{localappdata}\Inkwell\Inkwell.bat"
Type: files; Name: "{localappdata}\Inkwell\Inkwell with console.bat"
Type: filesandordirs; Name: "{localappdata}\Inkwell\vendor"
; Its shortcuts pointed at Python, which may no longer be there. The Desktop
; one goes on every update too, and comes back only if the box is ticked.
Type: files; Name: "{userdesktop}\Inkwell.lnk"
Type: files; Name: "{userprograms}\Inkwell.lnk"

[Run]
Filename: "{app}\Inkwell.exe"; Description: "Open Inkwell now"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Stop Inkwell's companion server (it is Inkwell.exe too) before removing files.
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM Inkwell.exe /T"; Flags: runhidden; RunOnceId: "StopInkwell"

[Code]
{ Before anything changes: stop a running Inkwell, and copy the documents'
  folder to backups\setup-<date>. A copy only; nothing is moved or deleted. }
procedure CurStepChanged(CurStep: TSetupStep);
var
  Code: Integer;
  Src, Dst: String;
begin
  if CurStep = ssInstall then
  begin
    Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM Inkwell.exe /T', '', SW_HIDE, ewWaitUntilTerminated, Code);
    Src := ExpandConstant('{localappdata}\Inkwell\storage');
    if DirExists(Src) then
    begin
      Dst := ExpandConstant('{localappdata}\Inkwell\backups\setup-') + GetDateTimeString('yyyymmdd-hhnnss', #0, #0) + '\storage';
      Exec(ExpandConstant('{sys}\robocopy.exe'), '"' + Src + '" "' + Dst + '" /E /R:1 /W:1 /NFL /NDL /NJH /NJS /XD Cache "Code Cache" GPUCache DawnCache GrShaderCache ShaderCache',
           '', SW_HIDE, ewWaitUntilTerminated, Code);
    end;
  end;
end;
