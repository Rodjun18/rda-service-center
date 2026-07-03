@echo off
title RDA Diagnosis
cd /d "%~dp0"
echo.
echo =====================================================
echo  RDA DIAGNOSIS - Finding Node.js
echo =====================================================
echo.

echo [1] Checking PATH...
where node 2>nul
if %errorlevel% equ 0 (echo FOUND in PATH!) else (echo Not in PATH)
echo.

echo [2] Searching Program Files...
dir /s /b "C:\Program Files\node.exe" 2>nul
dir /s /b "C:\Program Files (x86)\node.exe" 2>nul
echo.

echo [3] Searching C drive root folders...
dir /s /b "C:\node.exe" 2>nul
echo.

echo [4] Checking environment variables...
echo PATH=%PATH%
echo.

echo [5] Checking registry for Node install...
reg query "HKLM\SOFTWARE\Node.js" 2>nul
reg query "HKCU\SOFTWARE\Node.js" 2>nul
echo.

echo =====================================================
echo  SCREENSHOT THIS AND SEND IT
echo =====================================================
pause
