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
if not defined VS_PATH (
  if exist "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools" set "VS_PATH=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools"
)

if not defined VS_PATH (
  echo Error: Visual Studio not found. Install "Desktop development with C++" workload.
  exit /b 1
)

set "VCVARS=%VS_PATH%\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" (
  echo Error: vcvars64.bat not found at %VCVARS%
  exit /b 1
)

call "%VCVARS%"
npx tauri %*
