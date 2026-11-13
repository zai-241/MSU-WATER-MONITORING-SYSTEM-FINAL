# Builds the MSU Water System Android app (debug APK) without opening Android Studio.
#
# Usage, from the project root in PowerShell:
#     powershell -ExecutionPolicy Bypass -File mobile\build-apk.ps1
#
# Requires Android Studio (for its bundled Java) and the Android SDK, both in
# their default install locations. The APK is written to
#     mobile\MSU-Water-System-debug.apk

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$jbr = 'C:\Program Files\Android\Android Studio\jbr'
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
if (-not (Test-Path "$jbr\bin\java.exe")) { throw "Android Studio's Java was not found at $jbr. Install Android Studio first." }
if (-not (Test-Path $sdk)) { throw "Android SDK was not found at $sdk. Open Android Studio once to install it." }

$env:JAVA_HOME = $jbr
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk

# Java opens a local socket in its temp folder. On Windows that fails with
# "Unable to establish loopback connection" when the temp path is long or has
# spaces, so point it at a short folder instead.
$socketDir = Join-Path $env:SystemDrive 'msu-gradle-tmp'
New-Item -ItemType Directory -Force $socketDir | Out-Null
$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=$socketDir -Djava.net.preferIPv4Stack=true"

Write-Host '1/3 Building the web app...'
Push-Location $root
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'Web build failed.' }

Write-Host '2/3 Syncing into the Android project...'
npm run cap:sync
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'Capacitor sync failed.' }
Pop-Location

Write-Host '3/3 Building the APK (the first run downloads Gradle and takes several minutes)...'
Push-Location (Join-Path $PSScriptRoot 'android')
.\gradlew.bat assembleDebug --console=plain --no-daemon
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { throw 'Android build failed. See the output above.' }

$apk = Join-Path $PSScriptRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
$out = Join-Path $PSScriptRoot 'MSU-Water-System-debug.apk'
Copy-Item $apk $out -Force
Write-Host "Done: $out"
