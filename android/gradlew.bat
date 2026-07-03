@rem Gradle wrapper for Windows
@echo off
set JAVA_EXE=java.exe
set GRADLE_USER_HOME=%USERPROFILE%\.gradle

:: Find Gradle
for /d %%i in ("%GRADLE_USER_HOME%\wrapper\dists\gradle-8.4-bin\*") do (
    set GRADLE_HOME=%%i\gradle-8.4
)

if not exist "%GRADLE_HOME%" (
    echo Gradle not found. Please run BUILD_APK.bat first.
    exit /b 1
)

"%JAVA_EXE%" -classpath "%GRADLE_HOME%\lib\gradle-launcher-8.4.jar" org.gradle.launcher.GradleMain %*
