# Builds the MSU Water System Android app without opening Android Studio.
#
# Usage, from the project root in PowerShell:
#     powershell -ExecutionPolicy Bypass -File mobile\build-apk.ps1            # debug APK for testing
#     powershell -ExecutionPolicy Bypass -File mobile\build-apk.ps1 -Release   # signed AAB for the Play Store
#
# Requires Android Studio (for its bundled Java) and the Android SDK, both in
# their default install locations. Output:
#     mobile\MSU-Water-System-debug.apk     (debug)
#     mobile\MSU-Water-System-release.aab   (release)
#
# The first -Release run creates the Play Store upload key in
# mobile\android\upload-key.jks and its passwords in mobile\android\keystore.properties.
# Both are git-ignored. Back them up: every future update must be signed with this key.

param([switch]$Release)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$androidDir = Join-Path $PSScriptRoot 'android'

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

if ($Release) {
    $propsFile = Join-Path $androidDir 'keystore.properties'
    $keyFile = Join-Path $androidDir 'upload-key.jks'
    if (-not (Test-Path $propsFile)) {
        if (Test-Path $keyFile) { throw "$keyFile exists but keystore.properties is missing. Restore keystore.properties from your backup." }
        Write-Host 'Creating the Play Store upload key (first release build only)...'
        $chars = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
        $password = -join (1..24 | ForEach-Object { $chars | Get-Random })
        & "$jbr\bin\keytool.exe" -genkeypair -v -keystore $keyFile -alias upload -keyalg RSA -keysize 2048 -validity 10000 `
            -storepass $password -keypass $password -dname 'CN=MSU Water System, O=MSU Water System, C=PH'
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the upload key.' }
        @(
            'storeFile=upload-key.jks'
            "storePassword=$password"
            'keyAlias=upload'
            "keyPassword=$password"
        ) | Set-Content -Encoding ascii $propsFile
        Write-Host "Created $keyFile"
        Write-Host 'BACK UP upload-key.jks and keystore.properties now. You need them for every app update.'
    }
}

Write-Host '1/3 Building the web app...'
Push-Location $root
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'Web build failed.' }

Write-Host '2/3 Syncing into the Android project...'
npm run cap:sync
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'Capacitor sync failed.' }
Pop-Location

$task = if ($Release) { 'bundleRelease' } else { 'assembleDebug' }
Write-Host "3/3 Building ($task; the first run downloads Gradle and takes several minutes)..."
Push-Location $androidDir
.\gradlew.bat $task --console=plain --no-daemon
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { throw 'Android build failed. See the output above.' }

if ($Release) {
    $built = Join-Path $androidDir 'app\build\outputs\bundle\release\app-release.aab'
    $out = Join-Path $PSScriptRoot 'MSU-Water-System-release.aab'
} else {
    $built = Join-Path $androidDir 'app\build\outputs\apk\debug\app-debug.apk'
    $out = Join-Path $PSScriptRoot 'MSU-Water-System-debug.apk'
}
Copy-Item $built $out -Force
Write-Host "Done: $out"
