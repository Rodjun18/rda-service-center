@echo off
title RDA Service Center Server
color 0A

:: Go to exact folder where this bat file is located
cd /d "%~dp0"

echo.
echo  Current folder: %~dp0
echo.
echo  =========================================================
echo   RDA MOBILE PHONE SERVICE CENTER - SERVER STARTING...
echo  =========================================================
echo.

:: Use exact known path to node.exe
"C:\Program Files\nodejs\node.exe" --version >nul 2>&1
if %errorlevel% equ 0 (
    echo  [OK] Node.js found!
    "C:\Program Files\nodejs\node.exe" --version
    echo.
    echo  =========================================================
    echo  Server starting... Open Chrome to the address below.
    echo  KEEP THIS WINDOW OPEN while using the system!
    echo  =========================================================
    echo.
    "C:\Program Files\nodejs\node.exe" "%~dp0server.js"
) else (
    color 0C
    echo  ERROR: Node.js not found at C:\Program Files\nodejs\
    echo  Contact support.
)

echo.
pause
