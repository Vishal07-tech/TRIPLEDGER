# Rebuilds every launcher icon and splash asset from one square source image.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/make-brand-icons.ps1 [-Source path\to\logo.png]

param(
  [string]$Source = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root 'assets'
$res = Join-Path $root 'android\app\src\main\res'

if (-not $Source) {
  $candidates = @('sutrula-logo.png', 'sutrula-logo.jpg', 'logo.png', 'logo.jpg') |
    ForEach-Object { Join-Path (Split-Path -Parent $root) $_ }
  $candidates += @(
    (Join-Path $assets 'icon-source.png'),
    (Join-Path $assets 'icon-source.jpg'),
    (Join-Path $assets 'icon-source.webp')
  )
  $Source = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if (-not $Source -or -not (Test-Path $Source)) {
  throw 'No logo source found. Save the image as D:\TRIP APP\sutrula-logo.png and run again.'
}

Write-Host "Source: $Source"
$sourceImage = [System.Drawing.Image]::FromFile((Resolve-Path $Source))

# --- helpers ---------------------------------------------------------------
function New-SquareBitmap([System.Drawing.Image]$image, [int]$size, [double]$inset = 1.0, [System.Drawing.Color]$background, [switch]$Round) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  if ($background.A -gt 0) {
    $graphics.Clear($background)
  } else {
    $graphics.Clear([System.Drawing.Color]::Transparent)
  }

  $side = [int]($size * $inset)
  $offset = [int](($size - $side) / 2)
  $target = New-Object System.Drawing.Rectangle($offset, $offset, $side, $side)

  # Centre-crop the source so it stays square without stretching.
  $edge = [Math]::Min($image.Width, $image.Height)
  $cropX = [int](($image.Width - $edge) / 2)
  $cropY = [int](($image.Height - $edge) / 2)

  if ($Round) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse($target)
    $graphics.SetClip($path)
  }

  $graphics.DrawImage($image, $target, $cropX, $cropY, $edge, $edge, [System.Drawing.GraphicsUnit]::Pixel)
  $graphics.Dispose()

  return $bitmap
}

function Save-Icon([System.Drawing.Bitmap]$bitmap, [string]$path) {
  $directory = Split-Path -Parent $path
  if (-not (Test-Path $directory)) { New-Item -ItemType Directory -Path $directory | Out-Null }
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
}

$cream = [System.Drawing.Color]::FromArgb(255, 255, 247, 237)
$transparent = [System.Drawing.Color]::FromArgb(0, 0, 0, 0)

# --- Expo / store assets ---------------------------------------------------
Save-Icon (New-SquareBitmap $sourceImage 1024 1.0 $cream) (Join-Path $assets 'icon.png')
Save-Icon (New-SquareBitmap $sourceImage 1024 0.68 $transparent) (Join-Path $assets 'adaptive-icon.png')
Save-Icon (New-SquareBitmap $sourceImage 512 0.78 $cream) (Join-Path $assets 'splash.png')
Save-Icon (New-SquareBitmap $sourceImage 384 1.0 $transparent) (Join-Path $assets 'logo.png')

# --- Android launcher icons ------------------------------------------------
$densities = @{
  'mdpi'    = @{ launcher = 48; foreground = 108; splash = 288 }
  'hdpi'    = @{ launcher = 72; foreground = 162; splash = 432 }
  'xhdpi'   = @{ launcher = 96; foreground = 216; splash = 576 }
  'xxhdpi'  = @{ launcher = 144; foreground = 324; splash = 864 }
  'xxxhdpi' = @{ launcher = 192; foreground = 432; splash = 1152 }
}

foreach ($density in $densities.Keys) {
  $sizes = $densities[$density]
  $folder = Join-Path $res "mipmap-$density"

  # Legacy square and round icons (the round one is used by some launchers).
  Save-Icon (New-SquareBitmap $sourceImage $sizes.launcher 1.0 $cream) (Join-Path $folder 'ic_launcher.png')
  Save-Icon (New-SquareBitmap $sourceImage $sizes.launcher 1.0 $transparent -Round) (Join-Path $folder 'ic_launcher_round.png')

  # Adaptive foreground: artwork must sit inside the 66/108 safe zone.
  Save-Icon (New-SquareBitmap $sourceImage $sizes.foreground 0.72 $transparent) (Join-Path $folder 'ic_launcher_foreground.png')

  # Old .webp files would win over the new .png ones on some builds.
  Get-ChildItem $folder -Filter '*.webp' -ErrorAction SilentlyContinue | Remove-Item -Force

  $drawable = Join-Path $res "drawable-$density"
  Save-Icon (New-SquareBitmap $sourceImage $sizes.splash 0.9 $transparent) (Join-Path $drawable 'splashscreen_logo.png')
}

$sourceImage.Dispose()
Write-Host 'Icons rebuilt: assets/icon.png, assets/adaptive-icon.png, assets/logo.png, assets/splash.png and all Android densities.'
