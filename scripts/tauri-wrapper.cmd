@echo off
setlocal

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "VS_PATH="

if not exist "%VSWHERE%" goto :fallbacks
rem -products * is required to find Build Tools (vswhere default is full VS only)
"%VSWHERE%" -latest -products * -property installationPath > "%TEMP%\wmqtt-vspath.txt" 2>nul
set /p VS_PATH=<"%TEMP%\wmqtt-vspath.txt"
del "%TEMP%\wmqtt-vspath.txt" >nul 2>&1

:fallbacks
if not defined VS_PATH (
  if exist "C:\Program Files\Microsoft Visual Studio\2022\Community" set "VS_PATH=C:\Program Files\Microsoft Visual Studio\2022\Community"
)
if not defined VS_PATH (
  if exist "C:\Program Files\Microsoft Visual Studio\2022\Professional" set "VS_PATH=C:\Program Files\Microsoft Visual Studio\2022\Professional"
)
if not defined VS_PATH (
  if exist "C:\Program Files\Microsoft Visual Studio\2022\Enterprise" set "VS_PATH=C:\Program Files\Microsoft Visual Studio\2022\Enterprise"
)
if not defined VS_PATH (
  if exist "C:\Program Files\Microsoft Visual Studio\2022\BuildTools" set "VS_PATH=C:\Program Files\Microsoft Visual Studio\2022\BuildTools"
)
rem no parens around this one: the ) in %ProgramFiles(x86)% breaks cmd block parsing
if defined VS_PATH goto :detected
if exist "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools" set "VS_PATH=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools"
:detected

if not defined VS_PATH (
  echo Error: Visual Studio not found. Install "Desktop development with C++" workload.
  exit /b 1
)

set "VCVARS=%VS_PATH%\VC\Auxiliary\Build\vcvars64.bat"
rem no parens here either: expanded %VCVARS% may contain (x86)
if exist "%VCVARS%" goto :runtauri
echo Error: vcvars64.bat not found at "%VCVARS%"
exit /b 1

:runtauri
call "%VCVARS%"
rem Build the audio-watcher sidecar here (only for `build`) so its `cargo build`
rem inherits the vcvars MSVC environment. Running it earlier from Node (Git Bash)
rem misses kernel32.lib and hits the same LNK1181 failure as Tauri would.
rem No parens block: a ) inside expanded paths breaks cmd parsing (see above).
if /I not "%~1"=="build" goto :tauri
node "%~dp0build-audio-watcher.js"
if errorlevel 1 exit /b 1
:tauri
npx tauri %*
