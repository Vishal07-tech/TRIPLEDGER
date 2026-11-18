# Draws the fallback brand mark used until the final artwork is supplied.
# Output: assets/icon-source.png (1024x1024, square, no text).

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'assets\icon-source.png'
$size = 1024

$bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bitmap)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

function New-RoundedPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-Brush([string]$hex, [int]$alpha = 255) {
  $color = [System.Drawing.ColorTranslator]::FromHtml($hex)
  return New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($alpha, $color.R, $color.G, $color.B))
}

# Sky
$sky = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point(0, 0)),
  (New-Object System.Drawing.Point(0, $size)),
  [System.Drawing.ColorTranslator]::FromHtml('#BFE3F7'),
  [System.Drawing.ColorTranslator]::FromHtml('#FBDFAE')
)
$g.FillRectangle($sky, 0, 0, $size, $size)
$sky.Dispose()

# Sun glow and disc
$glow = New-Brush '#F59E0B' 90
$g.FillEllipse($glow, 560, 210, 380, 380)
$glow.Dispose()
$sunOuter = New-Brush '#F59E0B'
$g.FillEllipse($sunOuter, 620, 270, 260, 260)
$sunOuter.Dispose()
$sunInner = New-Brush '#FCD34D'
$g.FillEllipse($sunInner, 636, 286, 210, 210)
$sunInner.Dispose()

# Birds
$birdPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#1F2937'), 8)
$birdPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$birdPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawArc($birdPen, 720, 150, 54, 28, 200, 140)
$g.DrawArc($birdPen, 762, 150, 54, 28, 200, 140)
$g.DrawArc($birdPen, 820, 190, 44, 24, 200, 140)
$g.DrawArc($birdPen, 854, 190, 44, 24, 200, 140)
$birdPen.Dispose()

# Far mountain
$farPoints = @(
  (New-Object System.Drawing.Point(90, 700)),
  (New-Object System.Drawing.Point(390, 330)),
  (New-Object System.Drawing.Point(690, 700))
)
$far = New-Brush '#0E7490'
$g.FillPolygon($far, $farPoints)
$far.Dispose()

$farLight = New-Brush '#22B8CF'
$farLightPoints = @(
  (New-Object System.Drawing.Point(390, 330)),
  (New-Object System.Drawing.Point(470, 415)),
  (New-Object System.Drawing.Point(310, 415))
)
$g.FillPolygon($farLight, $farLightPoints)
$farLight.Dispose()

# Near mountain
$nearPoints = @(
  (New-Object System.Drawing.Point(430, 720)),
  (New-Object System.Drawing.Point(760, 400)),
  (New-Object System.Drawing.Point(1040, 720))
)
$near = New-Brush '#15803D'
$g.FillPolygon($near, $nearPoints)
$near.Dispose()

$nearLight = New-Brush '#4ADE80'
$nearLightPoints = @(
  (New-Object System.Drawing.Point(760, 400)),
  (New-Object System.Drawing.Point(848, 492)),
  (New-Object System.Drawing.Point(672, 492))
)
$g.FillPolygon($nearLight, $nearLightPoints)
$nearLight.Dispose()

# Ground
$ground = New-Brush '#65A30D'
$g.FillRectangle($ground, 0, 690, $size, $size - 690)
$ground.Dispose()

# Road
$roadPoints = @(
  (New-Object System.Drawing.Point(180, 1024)),
  (New-Object System.Drawing.Point(430, 760)),
  (New-Object System.Drawing.Point(620, 760)),
  (New-Object System.Drawing.Point(960, 1024))
)
$road = New-Brush '#4B5563'
$g.FillPolygon($road, $roadPoints)
$road.Dispose()

# Dashed centre line
$linePen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#FDE68A'), 16)
$linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$linePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($linePen, 525, 900, 528, 850)
$g.DrawLine($linePen, 532, 810, 534, 780)
$linePen.Dispose()

# Bushes
$bushBack = New-Brush '#3F6212'
$g.FillEllipse($bushBack, -60, 780, 300, 300)
$g.FillEllipse($bushBack, 830, 800, 320, 300)
$bushBack.Dispose()
$bushFront = New-Brush '#84CC16'
$g.FillEllipse($bushFront, 60, 880, 260, 220)
$g.FillEllipse($bushFront, 760, 900, 300, 220)
$bushFront.Dispose()

# Roof luggage
$rack = New-Brush '#7C2D12'
$g.FillRectangle($rack, 300, 560, 330, 22)
$rack.Dispose()
$caseTeal = New-RoundedPath 316 486 132 78 16
$teal = New-Brush '#14B8A6'
$g.FillPath($teal, $caseTeal)
$teal.Dispose()
$caseOrange = New-RoundedPath 466 506 118 58 14
$orange = New-Brush '#C2410C'
$g.FillPath($orange, $caseOrange)
$orange.Dispose()

# Van body
$body = New-RoundedPath 250 596 430 208 46
$bodyBrush = New-Brush '#F8FAFC'
$g.FillPath($bodyBrush, $body)
$bodyBrush.Dispose()

$stripe = New-RoundedPath 250 682 430 122 40
$stripeBrush = New-Brush '#EA580C'
$g.FillPath($stripeBrush, $stripe)
$stripeBrush.Dispose()

$beltPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#FDBA74'), 16)
$g.DrawLine($beltPen, 268, 690, 662, 690)
$beltPen.Dispose()

# Windows
$window = New-Brush '#0B1220'
$windowPathA = New-RoundedPath 292 622 112 78 18
$windowPathB = New-RoundedPath 418 622 112 78 18
$windowPathC = New-RoundedPath 544 622 108 78 18
$g.FillPath($window, $windowPathA)
$g.FillPath($window, $windowPathB)
$g.FillPath($window, $windowPathC)
$window.Dispose()
$windowPathA.Dispose(); $windowPathB.Dispose(); $windowPathC.Dispose()

# Headlight
$light = New-Brush '#FEF3C7'
$g.FillEllipse($light, 626, 720, 42, 36)
$light.Dispose()

# Wheels
$tyre = New-Brush '#111827'
$g.FillEllipse($tyre, 300, 752, 108, 108)
$g.FillEllipse($tyre, 520, 752, 108, 108)
$tyre.Dispose()
$hub = New-Brush '#F8FAFC'
$g.FillEllipse($hub, 336, 788, 36, 36)
$g.FillEllipse($hub, 556, 788, 36, 36)
$hub.Dispose()

$g.Dispose()

$directory = Split-Path -Parent $out
if (-not (Test-Path $directory)) { New-Item -ItemType Directory -Path $directory | Out-Null }
$bitmap.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

Write-Host "Wrote $out"
