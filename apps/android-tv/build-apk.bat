@echo off
rem Builds the Kinora Android TV / Fire TV APK (shell + Gradle), via scripts/tv-package-android.mjs.
rem
rem Without arguments it asks: debug or release, which device to install on (or none), whether to start it.
rem With arguments it asks nothing and passes them on:
rem   build-apk.bat --release --install --run --target 192.168.1.50:5555
rem Release signing: KINORA_RELEASE_* in %USERPROFILE%\.gradle\gradle.properties. See docs\tv\android-tv.md.
setlocal EnableDelayedExpansion
pushd "%~dp0..\.."

if not "%~1"=="" (
  set "ARGS=%*"
  goto build
)

rem ---------------------------------------------------------------- adb
set "ADB="
if defined ANDROID_HOME if exist "%ANDROID_HOME%\platform-tools\adb.exe" set "ADB=%ANDROID_HOME%\platform-tools\adb.exe"
if not defined ADB if defined ANDROID_SDK_ROOT if exist "%ANDROID_SDK_ROOT%\platform-tools\adb.exe" set "ADB=%ANDROID_SDK_ROOT%\platform-tools\adb.exe"
if not defined ADB if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"

echo.
echo  Kinora - Android TV APK
echo  =======================
echo.

rem ---------------------------------------------------------------- 1. variant
echo  Build:
echo    1. Debug   (sideload, signed with the debug key)
echo    2. Release (signed with your keystore)
choice /c 12 /n /m "  Choose [1-2]: "
set "ARGS="
if errorlevel 2 (
  set "ARGS=--release"
  call :ask_signing || goto end
)

rem ---------------------------------------------------------------- 2. device
echo.
if not defined ADB (
  echo  adb was not found ^(Android SDK platform-tools^): the APK is only built, not installed.
  goto build
)
"%ADB%" start-server >nul 2>&1

:devices
set /a COUNT=0
for /f "skip=1 tokens=1,2" %%a in ('"%ADB%" devices') do (
  if "%%b"=="device" (
    set /a COUNT+=1
    set "DEVICE_!COUNT!=%%a"
  )
)
echo  Install on:
echo    0. Nowhere, just build the APK
if %COUNT% gtr 0 for /l %%i in (1,1,%COUNT%) do echo    %%i. !DEVICE_%%i!
echo    C. Connect a device by IP address (adb connect)
echo    R. Refresh the list
set "PICK="
set /p "PICK=  Choose: "
if /i "%PICK%"=="R" (echo. & goto devices)
if /i "%PICK%"=="C" (
  set "IP="
  set /p "IP=  Device IP (port 5555 if left out): "
  if not "!IP!"=="" (
    if "!IP::=!"=="!IP!" set "IP=!IP!:5555"
    "%ADB%" connect !IP!
    echo  If the TV asks to allow debugging, accept it ^(Always allow^), then refresh.
  )
  echo.
  goto devices
)
if "%PICK%"=="" set "PICK=0"
if "%PICK%"=="0" goto build
set "TARGET="
if %PICK% geq 1 if %PICK% leq %COUNT% set "TARGET=!DEVICE_%PICK%!"
if not defined TARGET (
  echo  Not in the list.
  echo.
  goto devices
)
set "ARGS=%ARGS% --install --target %TARGET%"

rem ---------------------------------------------------------------- 3. start
choice /c YN /n /m "  Start Kinora on %TARGET% after installing? [Y/N]: "
if not errorlevel 2 set "ARGS=%ARGS% --run"

rem ---------------------------------------------------------------- build
:build
echo.
echo  ^> pnpm tv:package:android %ARGS%
echo.
call corepack pnpm tv:package:android -- %ARGS%
set "RESULT=%ERRORLEVEL%"
echo.
if "%RESULT%"=="0" (echo  Done. The APK is in apps\android-tv\dist\) else (echo  Build failed ^(exit code %RESULT%^).)

:end
if not defined RESULT set "RESULT=1"
popd
rem Opened from Explorer: keep the window open so the result can be read.
echo %CMDCMDLINE% | find /i "%~nx0" >nul && pause
exit /b %RESULT%

rem ---------------------------------------------------------------- release signing
rem The keystore settings normally live in ~/.gradle/gradle.properties (KINORA_RELEASE_*), which Gradle reads.
rem When they are not there, ask for them; they are then passed as environment variables, for this build only.
:ask_signing
echo.
set "GRADLE_PROPS=%USERPROFILE%\.gradle\gradle.properties"
if defined GRADLE_USER_HOME set "GRADLE_PROPS=%GRADLE_USER_HOME%\gradle.properties"
if exist "%GRADLE_PROPS%" findstr /b /c:"KINORA_RELEASE_STORE_FILE=" "%GRADLE_PROPS%" >nul && (
  echo  Signing with the keystore from %GRADLE_PROPS%
  exit /b 0
)
echo  No KINORA_RELEASE_* entries in %GRADLE_PROPS%.
echo  Add them there once ^(see docs\tv\android-tv.md^), or answer now for this build only.
if not defined KINORA_RELEASE_STORE_FILE set /p "KINORA_RELEASE_STORE_FILE=  Keystore file (.jks): "
if defined KINORA_RELEASE_STORE_FILE set "KINORA_RELEASE_STORE_FILE=%KINORA_RELEASE_STORE_FILE:"=%"
if not exist "%KINORA_RELEASE_STORE_FILE%" (
  echo  "%KINORA_RELEASE_STORE_FILE%" does not exist. To create one:
  echo    keytool -genkeypair -v -keystore kinora-tv-release.jks -alias kinora -keyalg RSA -keysize 4096 -validity 10000
  exit /b 1
)
if not defined KINORA_RELEASE_KEY_ALIAS set /p "KINORA_RELEASE_KEY_ALIAS=  Key alias: "
if not defined KINORA_RELEASE_STORE_PASSWORD (
  for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "$p = Read-Host '  Keystore password' -AsSecureString; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p))"`) do set "KINORA_RELEASE_STORE_PASSWORD=%%p"
)
if not defined KINORA_RELEASE_STORE_PASSWORD (
  echo  A password is needed to sign.
  exit /b 1
)
exit /b 0
