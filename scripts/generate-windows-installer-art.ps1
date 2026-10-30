param(
  [string]$SourceIcon = (Join-Path $PSScriptRoot "../app/src-tauri/icons/icon.png"),
  [string]$OutputDir = (Join-Path $PSScriptRoot "../packaging/windows")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$iconPath = [System.IO.Path]::GetFullPath($SourceIcon)
$outPath = [System.IO.Path]::GetFullPath($OutputDir)
if (-not (Test-Path -LiteralPath $iconPath -PathType Leaf)) {
  throw "ZeluxDL source icon not found: $iconPath"
}
New-Item -ItemType Directory -Force -Path $outPath | Out-Null

$icon = [System.Drawing.Image]::FromFile($iconPath)
try {
  function New-BrandBitmap([int]$Width, [int]$Height, [string]$Kind) {
    $bitmap = [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $bounds = [System.Drawing.Rectangle]::new(0, 0, $Width, $Height)
    $background = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
      $bounds,
      [System.Drawing.Color]::FromArgb(11, 12, 23),
      [System.Drawing.Color]::FromArgb(27, 17, 48),
      0.0
    )
    $graphics.FillRectangle($background, $bounds)
    $background.Dispose()

    $scale = $Width / 493.0
    $accent = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
      [System.Drawing.Rectangle]::new(0, $Height - [Math]::Max(3, [int](3 * $scale)), $Width, [Math]::Max(3, [int](3 * $scale))),
      [System.Drawing.Color]::FromArgb(28, 203, 255),
      [System.Drawing.Color]::FromArgb(169, 63, 255),
      0.0
    )
    $graphics.FillRectangle($accent, 0, $Height - [Math]::Max(3, [int](3 * $scale)), $Width, [Math]::Max(3, [int](3 * $scale)))
    $accent.Dispose()

    $titleFont = [System.Drawing.Font]::new("Segoe UI Semibold", [Math]::Max(9, 27 * $scale), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $subFont = [System.Drawing.Font]::new("Segoe UI", [Math]::Max(6, 12 * $scale), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(243, 242, 255))
    $muted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(165, 171, 194))

    if ($Kind -eq "nsis-header") {
      $titleFont.Dispose()
      $subFont.Dispose()
      $titleFont = [System.Drawing.Font]::new("Segoe UI Semibold", 18, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
      $subFont = [System.Drawing.Font]::new("Segoe UI", 8, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
      $pad = 8
      $logoSize = 40
      $graphics.DrawImage($icon, $pad, 8, $logoSize, $logoSize)
      $textX = 56
      $graphics.DrawString("ZeluxDL", $titleFont, $white, $textX, 7)
      $graphics.DrawString("DOWNLOAD MANAGER", $subFont, $muted, $textX + 1, 32)
    } elseif ($Kind -eq "wix-banner") {
      $pad = 10
      $logoSize = 46
      $graphics.DrawImage($icon, $pad, 6, $logoSize, $logoSize)
      $graphics.DrawString("ZeluxDL", $titleFont, $white, 72, 3)
      $graphics.DrawString("DOWNLOAD MANAGER", $subFont, $muted, 74, 34)
    } elseif ($Kind -eq "nsis-sidebar") {
      $logoSize = 84
      $logoX = [int](($Width - $logoSize) / 2)
      $graphics.DrawImage($icon, $logoX, 52, $logoSize, $logoSize)
      $titleFont.Dispose()
      $centerTitle = [System.Drawing.Font]::new("Segoe UI Semibold", 18, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
      $centerSub = [System.Drawing.Font]::new("Segoe UI", 9, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
      $titleFormat = [System.Drawing.StringFormat]::new()
      $titleFormat.Alignment = [System.Drawing.StringAlignment]::Center
      $graphics.DrawString("ZeluxDL", $centerTitle, $white, [System.Drawing.RectangleF]::new(0, 150, $Width, 28), $titleFormat)
      $graphics.DrawString("DOWNLOAD MANAGER", $centerSub, $muted, [System.Drawing.RectangleF]::new(0, 180, $Width, 18), $titleFormat)
      $titleFormat.Dispose()
      $centerTitle.Dispose()
      $centerSub.Dispose()
    } else {
      $logoSize = 118
      $graphics.DrawImage($icon, [int](($Width - $logoSize) / 2), 45, $logoSize, $logoSize)
      $titleFormat = [System.Drawing.StringFormat]::new()
      $titleFormat.Alignment = [System.Drawing.StringAlignment]::Center
      $graphics.DrawString("ZeluxDL", $titleFont, $white, [System.Drawing.RectangleF]::new(0, 175, $Width, 36), $titleFormat)
      $graphics.DrawString("A faster way to download", $subFont, $muted, [System.Drawing.RectangleF]::new(0, 214, $Width, 22), $titleFormat)
      $graphics.DrawString("DOWNLOAD MANAGER", $subFont, $muted, [System.Drawing.RectangleF]::new(0, 251, $Width, 20), $titleFormat)
      $titleFormat.Dispose()
    }

    $titleFont.Dispose()
    $subFont.Dispose()
    $white.Dispose()
    $muted.Dispose()
    $graphics.Dispose()
    return $bitmap
  }

  $assets = @(
    @{ Name = "installer-header.bmp"; Width = 150; Height = 57; Kind = "nsis-header" },
    @{ Name = "installer-sidebar.bmp"; Width = 164; Height = 314; Kind = "nsis-sidebar" },
    @{ Name = "installer-banner.bmp"; Width = 493; Height = 58; Kind = "wix-banner" },
    @{ Name = "installer-dialog.bmp"; Width = 493; Height = 312; Kind = "wix-dialog" }
  )

  foreach ($asset in $assets) {
    $bitmap = New-BrandBitmap $asset.Width $asset.Height $asset.Kind
    try {
      $file = Join-Path $outPath $asset.Name
      $bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Bmp)
      Write-Output "Created $file ($($asset.Width)x$($asset.Height))"
    } finally {
      $bitmap.Dispose()
    }
  }
} finally {
  $icon.Dispose()
}
