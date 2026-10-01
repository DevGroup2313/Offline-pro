@echo off
setlocal EnableExtensions
title Inkwell 7.30: install or update
cd /d "%~dp0"
set "VER=7.30"
set "ROOT=%LOCALAPPDATA%\Inkwell"

echo ==================================================
echo   INKWELL %VER%: install or update on Windows
echo ==================================================
echo.
echo Your documents live in "%ROOT%\storage".
echo This installer never deletes that folder, or any folder.
echo.

REM ---- 1. package files ------------------------------------------------------
for %%F in (Inkwell.html inkwell_app.py server.py inkwell.png inkwell.ico) do (
  if not exist "%%F" (
    echo STOPPED: the file %%F is missing. Unzip the whole package and run this again from inside it.
    pause
    exit /b 1
  )
)
echo 1. All package files are present.

REM ---- 2. Inkwell must be closed; the old companion server is stopped ---------
:checkopen
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*inkwell_app.py*' -and $_.CommandLine -notlike '*--inkwell-engine*' -and $_.CommandLine -notlike '*--export-library*' }) { exit 1 } else { exit 0 }"
if errorlevel 1 (
  echo 2. Inkwell is open. Please close its window, then press any key here.
  pause >nul
  goto checkopen
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*--inkwell-engine*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo 2. Inkwell is closed. Its old companion server, if any, was stopped.

REM ---- 3. Python ---------------------------------------------------------------
set "PY="
py -3 -c "import sys; assert sys.version_info >= (3, 8)" >nul 2>&1
if not errorlevel 1 set "PY=py -3"
if defined PY goto havepy
python -c "import sys; assert sys.version_info >= (3, 8)" >nul 2>&1
if not errorlevel 1 set "PY=python"
if defined PY goto havepy
echo STOPPED: Python 3.8 or newer was not found.
echo Install it from python.org and tick "Add python.exe to PATH", then run this again.
pause
exit /b 1
:havepy
set "PYEXE="
for /f "usebackq delims=" %%i in (`%PY% -c "import sys; print(sys.executable)"`) do set "PYEXE=%%i"
if not defined PYEXE (
  echo STOPPED: Python could not report its own location.
  pause
  exit /b 1
)
for %%d in ("%PYEXE%") do set "PYDIR=%%~dpd"
set "PYW=%PYDIR%pythonw.exe"
if not exist "%PYW%" set "PYW=%PYEXE%"
echo 3. Python: %PYEXE%

"%PYEXE%" -c "import webview" >nul 2>&1
if errorlevel 1 (
  echo    Installing the window component, pywebview, once. This needs the internet.
  "%PYEXE%" -m pip install --user --upgrade pywebview
)
"%PYEXE%" -c "import webview" >nul 2>&1
if errorlevel 1 (
  echo    WARNING: pywebview is not available, so Inkwell will open in your browser instead.
) else (
  echo    Window component: pywebview is installed.
)

REM ---- 4. optional local Whisper ---------------------------------------------------
"%PYEXE%" -c "import transformers, torch, numpy" >nul 2>&1
if not errorlevel 1 goto whisperok
echo 4. Scriba transcribes on this PC with Whisper. That needs the libraries
echo    transformers and torch, a download of several hundred megabytes, once,
echo    and on first use a Whisper model of about 150 MB.
choice /c YN /n /m "   Install them now? [Y/N] "
if errorlevel 2 goto whisperskip
"%PYEXE%" -m pip install --user --upgrade transformers torch numpy
goto whisperdone
:whisperok
echo 4. Local transcription libraries are installed.
goto whisperdone
:whisperskip
echo    Skipped. Run this installer again later to add them.
:whisperdone

REM ---- 5. back up before anything is replaced ---------------------------------------
set "STAMP="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"`) do set "STAMP=%%i"
if not defined STAMP set "STAMP=backup"
set "BK=%ROOT%\backups\%STAMP%"
if not exist "%BK%" mkdir "%BK%"
if exist "%ROOT%\storage" (
  robocopy "%ROOT%\storage" "%BK%\storage" /E /R:1 /W:1 /NFL /NDL /NJH /NJS /XD Cache "Code Cache" GPUCache DawnCache GrShaderCache ShaderCache "Service Worker" >nul
  if errorlevel 8 (
    echo 5. WARNING: the raw copy of your web storage did not complete.
  ) else (
    echo 5. Raw copy of your web storage: %BK%\storage
  )
)
"%PYEXE%" "%~dp0inkwell_app.py" --export-library "%BK%\inkwell-library-backup.json"
echo    To restore from the raw copy, close Inkwell and copy the storage folder back.

REM ---- 6. program files, overwritten in place (same paths as before) ------------------
if not exist "%ROOT%\vendor" mkdir "%ROOT%\vendor"
for %%F in (Inkwell.html inkwell_app.py server.py inkwell.png inkwell.ico) do (
  copy /y "%%F" "%ROOT%\%%F" >nul
  if errorlevel 1 (
    echo STOPPED: could not copy %%F into %ROOT%. Is Inkwell still open?
    pause
    exit /b 1
  )
)
if exist "vendor" xcopy /y /q "vendor\*" "%ROOT%\vendor\" >nul
if exist "%ROOT%\server_v725.py" del /q "%ROOT%\server_v725.py"
if exist "%ROOT%\vendor\transformers.web.min.js" del /q "%ROOT%\vendor\transformers.web.min.js"
> "%ROOT%\Inkwell.bat" echo @echo off
>> "%ROOT%\Inkwell.bat" echo cd /d "%%~dp0"
>> "%ROOT%\Inkwell.bat" echo start "" "%PYW%" "%%~dp0inkwell_app.py"
> "%ROOT%\Inkwell with console.bat" echo @echo off
>> "%ROOT%\Inkwell with console.bat" echo cd /d "%%~dp0"
>> "%ROOT%\Inkwell with console.bat" echo "%PYEXE%" inkwell_app.py
>> "%ROOT%\Inkwell with console.bat" echo pause
echo 6. Program files updated in %ROOT%

REM ---- 7. shortcuts on the Desktop and in the Start menu -------------------------------
set "INK_PYW=%PYW%"
set "INK_APP=%ROOT%"
set "INK_ICO=%ROOT%\inkwell.ico"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$q=[char]34; $ws=New-Object -ComObject WScript.Shell; foreach($d in @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))){ $sc=$ws.CreateShortcut((Join-Path $d 'Inkwell.lnk')); $sc.TargetPath=$env:INK_PYW; $sc.Arguments=$q+(Join-Path $env:INK_APP 'inkwell_app.py')+$q; $sc.WorkingDirectory=$env:INK_APP; $sc.IconLocation=$env:INK_ICO; $sc.Description='Inkwell 7.30'; $sc.Save() }"
echo 7. Shortcuts: Desktop and Start menu.

echo.
echo ==================================================
echo   Inkwell %VER% is installed.
echo   Backup: %BK%
echo.
echo   Scriba: if Windows blocks the microphone, open Settings,
echo   Privacy and security, Microphone, and switch on both
echo   Microphone access and Let desktop apps access your microphone.
echo ==================================================
echo.
choice /c YN /n /m "Open Inkwell now? [Y/N] "
if errorlevel 2 goto end
start "" /D "%ROOT%" "%PYW%" "%ROOT%\inkwell_app.py"
:end
endlocal
