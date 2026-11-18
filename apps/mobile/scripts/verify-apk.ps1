# Verifies the release APK before it is handed out for testing.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\verify-apk.ps1 -Apk path\to\app-release.apk

param(
  [Parameter(Mandatory = $true)][string]$Apk
)

$ErrorActionPreference = 'Stop'
$aapt = 'D:\Android\Sdk\build-tools\37.0.0\aapt.exe'
$apksigner = 'D:\Android\Sdk\build-tools\37.0.0\apksigner.bat'

if (-not (Test-Path $Apk)) { throw "APK not found: $Apk" }
$Apk = (Resolve-Path $Apk).Path
$failures = New-Object System.Collections.Generic.List[string]

function Check([string]$name, [bool]$ok, [string]$detail) {
  if ($ok) { Write-Host "[PASS] $name $detail" -ForegroundColor Green }
  else { Write-Host "[FAIL] $name $detail" -ForegroundColor Red; $failures.Add($name) }
}

$size = (Get-Item $Apk).Length
$hash = (Get-FileHash $Apk -Algorithm SHA256).Hash
Write-Host "APK: $Apk"
Write-Host ("Size: {0:N1} MB" -f ($size / 1MB))
Write-Host "SHA-256: $hash"
Write-Host ''

$badging = & $aapt dump badging $Apk 2>&1
$label = ($badging | Select-String "application-label:" | Select-Object -First 1).Line
$package = ($badging | Select-String "^package: name=" | Select-Object -First 1).Line
$sdk = ($badging | Select-String "sdkVersion:|targetSdkVersion:" | ForEach-Object { $_.Line.Trim() }) -join '; '

Check 'Label is Sutrula Payanam' ($label -match "Sutrula Payanam") $label
Check 'Package id kept' ($package -match "com\.tripledger\.mobile") $package
Write-Host "SDK: $sdk"
Write-Host ''

$permissions = & $aapt dump permissions $Apk 2>&1
$permissionText = $permissions -join "`n"
Check 'Fine location declared' ($permissionText -match 'ACCESS_FINE_LOCATION') ''
Check 'Coarse location declared' ($permissionText -match 'ACCESS_COARSE_LOCATION') ''
Check 'Internet declared' ($permissionText -match 'android\.permission\.INTERNET') ''
Check 'No background location' (-not ($permissionText -match 'ACCESS_BACKGROUND_LOCATION')) ''
Check 'No foreground-service location' (-not ($permissionText -match 'FOREGROUND_SERVICE_LOCATION')) ''
Write-Host ''

$manifest = & $aapt dump xmltree $Apk AndroidManifest.xml 2>&1
$manifestText = $manifest -join "`n"
if ($manifestText -match 'usesCleartextTraffic') {
  $line = ($manifest | Select-String 'usesCleartextTraffic' | Select-Object -First 1).Line.Trim()
  Check 'Cleartext traffic disabled' ($line -match '0x0|false') $line
} else {
  Check 'Cleartext traffic not enabled' $true '(attribute absent => platform default false)'
}
Check 'Round icon present' ([bool]($badging -match 'round-icon')) ''
Write-Host ''

# Inspect the bundled JS to prove the release points at production HTTPS.
$temp = Join-Path $env:TEMP ("apk-verify-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($Apk)
  $entry = $zip.Entries | Where-Object { $_.FullName -eq 'assets/index.android.bundle' } | Select-Object -First 1
  if (-not $entry) { throw 'assets/index.android.bundle missing from the APK' }
  $bundlePath = Join-Path $temp 'index.android.bundle'
  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $bundlePath, $true)
  $zip.Dispose()

  $bundle = Get-Content $bundlePath -Raw
  Check 'Bundle calls production API' ($bundle.Contains('https://api-fawn-xi-49.vercel.app')) ''
  Check 'Bundle loads OSM tiles' ($bundle.Contains('tile.openstreetmap.org')) ''
  Check 'Bundle contains Live location copy' ($bundle.Contains('Share my location')) ''
  Check 'Bundle contains welcome tour' ($bundle.Contains('Your trips, all in one place')) ''
  Check 'Bundle has new app name' ($bundle.Contains('Sutrula Payanam')) ''
  Check 'No LAN IP baked in' (-not ($bundle -match 'https?://(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\.')) ''
} finally {
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
$abis = & $aapt dump badging $Apk 2>&1 | Select-String "native-code" | Select-Object -First 1
Write-Host "Native code: $($abis.Line)"
Check 'Universal APK has all four ABIs' (($abis.Line -match "armeabi-v7a") -and ($abis.Line -match "arm64-v8a") -and ($abis.Line -match "x86") -and ($abis.Line -match "x86_64")) ''

Write-Host ''
& $apksigner verify --verbose --print-certs $Apk 2>&1 | Select-Object -First 12
Write-Host ''

if ($failures.Count -gt 0) {
  Write-Host "VERIFY FAILED: $($failures -join ', ')" -ForegroundColor Red
  exit 1
}

Write-Host 'ALL CHECKS PASSED' -ForegroundColor Green
Write-Host "SHA-256: $hash"
