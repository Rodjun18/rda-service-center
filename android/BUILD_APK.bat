@echo off
title RDA Service Center — Build Android APK
color 0A
echo.
echo  =========================================================
echo   RDA SERVICE CENTER — ANDROID APK BUILDER
echo  =========================================================
echo.
echo  This script builds the Android APK on your laptop.
echo  Requirements: Java JDK 11+ and internet connection.
echo.

:: ── Check Java ──────────────────────────────────────────────
java -version >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo  ERROR: Java JDK is not installed!
    echo.
    echo  Please download JDK from:
    echo  https://www.oracle.com/java/technologies/downloads/
    echo  or: https://adoptium.net  (free, recommended)
    echo.
    echo  Install JDK, then run this script again.
    pause
    exit /b 1
)
echo  [OK] Java found.

:: ── Check Gradle ────────────────────────────────────────────
set GRADLE_DIR=%USERPROFILE%\.gradle\wrapper\dists
set GRADLE_ZIP=gradle-8.4-bin.zip
set GRADLE_URL=https://services.gradle.org/distributions/gradle-8.4-bin.zip

if exist "%GRADLE_DIR%\gradle-8.4-bin" (
    echo  [OK] Gradle found.
) else (
    echo  Downloading Gradle build tool (one time only)...
    powershell -Command "Invoke-WebRequest -Uri '%GRADLE_URL%' -OutFile '%TEMP%\%GRADLE_ZIP%'"
    if %errorlevel% neq 0 (
        echo  ERROR: Could not download Gradle. Check your internet connection.
        pause
        exit /b 1
    )
    mkdir "%GRADLE_DIR%\gradle-8.4-bin" 2>nul
    powershell -Command "Expand-Archive -Path '%TEMP%\%GRADLE_ZIP%' -DestinationPath '%GRADLE_DIR%\gradle-8.4-bin'"
    echo  [OK] Gradle installed.
)

:: ── Copy latest HTML to Android assets ──────────────────────
echo.
echo  Copying latest app to Android assets...
copy /Y "..\app\index.html" "app\src\main\assets\index.html" >nul
echo  [OK] Assets updated.

:: ── Build APK ───────────────────────────────────────────────
echo.
echo  Building APK (this may take 2-5 minutes first time)...
echo.

call gradlew.bat assembleDebug
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo  ERROR: Build failed!
    echo  Check the error messages above.
    echo.
    echo  Common fixes:
    echo  - Make sure you have internet for first build (downloads Android SDK)
    echo  - Make sure Java JDK (not JRE) is installed
    echo  - Try running as Administrator
    pause
    exit /b 1
)

:: ── Copy APK to easy location ───────────────────────────────
set APK_SRC=app\build\outputs\apk\debug\app-debug.apk
set APK_DEST=..\RDA_ServiceCenter.apk

if exist "%APK_SRC%" (
    copy /Y "%APK_SRC%" "%APK_DEST%" >nul
    echo.
    color 0A
    echo  =========================================================
    echo   APK BUILD SUCCESSFUL!
    echo  =========================================================
    echo.
    echo   File: RDA_ServiceCenter.apk
    echo   Location: %~dp0..\RDA_ServiceCenter.apk
    echo.
    echo   HOW TO INSTALL ON ANDROID:
    echo   1. Copy RDA_ServiceCenter.apk to your Android device
    echo      (via USB cable, WhatsApp, or shared folder)
    echo   2. On the Android device, tap the APK file
    echo   3. If prompted, tap "Allow from this source"
    echo   4. Tap "Install"
    echo   5. Open the app and set your server IP
    echo.
    echo   NOTE: First, enable "Unknown sources" or "Install unknown apps"
    echo   in Android Settings > Security (or Apps > Special access)
    echo  =========================================================
) else (
    echo  APK not found at expected path. Check build output above.
)

echo.
pause
