$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$assetsDir = Join-Path $root "assets"
$promoDir = Join-Path $assetsDir "promo"
$packagePath = Join-Path $assetsDir "Petr_Nemec_PR_media_package.zip"
$stagingDir = Join-Path $assetsDir ".press-package-build"

$requiredFiles = @(
  (Join-Path $assetsDir "CV_2026.pdf"),
  (Join-Path $assetsDir "bio.txt")
)

foreach ($file in $requiredFiles) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    throw "Missing required press file: $file"
  }
}

if (-not (Test-Path -LiteralPath $promoDir -PathType Container)) {
  New-Item -ItemType Directory -Path $promoDir | Out-Null
}

$promoFiles = Get-ChildItem -LiteralPath $promoDir -File -Recurse |
  Where-Object { $_.Extension -match '^\.(jpg|jpeg|png|webp|tif|tiff)$' }

$resolvedAssetsDir = (Resolve-Path -LiteralPath $assetsDir).Path
$resolvedPromoDir = (Resolve-Path -LiteralPath $promoDir).Path.TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$resolvedStagingDir = [System.IO.Path]::GetFullPath($stagingDir)
if (-not $resolvedStagingDir.StartsWith($resolvedAssetsDir, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to use staging directory outside assets: $resolvedStagingDir"
}

if (Test-Path -LiteralPath $stagingDir) {
  Remove-Item -LiteralPath $stagingDir -Recurse -Force
}

New-Item -ItemType Directory -Path $stagingDir | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stagingDir "promo") | Out-Null

Copy-Item -LiteralPath (Join-Path $assetsDir "CV_2026.pdf") -Destination (Join-Path $stagingDir "CV_2026.pdf")
Copy-Item -LiteralPath (Join-Path $assetsDir "bio.txt") -Destination (Join-Path $stagingDir "bio.txt")

if ($promoFiles.Count -eq 0) {
  $fallbackVisual = Join-Path $assetsDir "background.jpg"
  if (Test-Path -LiteralPath $fallbackVisual -PathType Leaf) {
    Copy-Item -LiteralPath $fallbackVisual -Destination (Join-Path $stagingDir "promo\background.jpg")
  }
} else {
  foreach ($promoFile in $promoFiles) {
    $relativePromoPath = $promoFile.FullName.Substring($resolvedPromoDir.Length).TrimStart(
      [System.IO.Path]::DirectorySeparatorChar,
      [System.IO.Path]::AltDirectorySeparatorChar
    )
    $destinationPath = Join-Path (Join-Path $stagingDir "promo") $relativePromoPath
    $destinationDir = Split-Path -Parent $destinationPath

    if (-not (Test-Path -LiteralPath $destinationDir)) {
      New-Item -ItemType Directory -Path $destinationDir | Out-Null
    }

    Copy-Item -LiteralPath $promoFile.FullName -Destination $destinationPath
  }
}

$packageItems = Get-ChildItem -LiteralPath $stagingDir -Force
Compress-Archive -LiteralPath $packageItems.FullName -DestinationPath $packagePath -Force
$includedFileCount = (Get-ChildItem -LiteralPath $stagingDir -File -Recurse).Count
Remove-Item -LiteralPath $stagingDir -Recurse -Force

Write-Host "Built $packagePath"
Write-Host "Included $includedFileCount file(s)."
