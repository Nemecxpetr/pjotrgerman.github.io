param(
  [string]$OutputPath = "",
  [int]$Port = 4173,
  [int]$LoadBudgetMs = 12000,
  [ValidateSet("auto", "light", "dark")]
  [string]$PrintTheme = "dark"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-BrowserExecutable {
  $knownPaths = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe")
  )

  foreach ($candidate in $knownPaths) {
    if ($candidate -and (Test-Path $candidate)) {
      return (Resolve-Path $candidate).Path
    }
  }

  foreach ($name in @("msedge", "chrome", "chromium")) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) {
      return $cmd.Source
    }
  }

  throw "No supported Chromium browser found. Install Microsoft Edge or Google Chrome."
}

function Resolve-PythonLauncher {
  $candidates = @(
    @{ Name = "python"; Args = @() },
    @{ Name = "py"; Args = @("-3") }
  )

  foreach ($candidate in $candidates) {
    $cmd = Get-Command $candidate.Name -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) {
      return @{
        Command = $cmd.Source
        Args = [string[]]$candidate.Args
      }
    }
  }

  throw "Python is required to run a local static server. Install python or py launcher."
}

$repoRoot = (Resolve-Path $PSScriptRoot).Path
$resolvedOutputPath = $OutputPath
if ([string]::IsNullOrWhiteSpace($resolvedOutputPath)) {
  $resolvedOutputPath = "output/portfolio.pdf"
}

$fullOutputPath = if ([System.IO.Path]::IsPathRooted($resolvedOutputPath)) {
  $resolvedOutputPath
} else {
  Join-Path $repoRoot $resolvedOutputPath
}

$outputDir = Split-Path -Parent $fullOutputPath
if ($outputDir -and -not (Test-Path $outputDir)) {
  New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

$browserExe = Resolve-BrowserExecutable
$pythonLauncher = Resolve-PythonLauncher
$serverProcess = $null
$browserProfileDir = Join-Path $repoRoot ".tmp/pdf-browser-profile-$([System.Guid]::NewGuid().ToString('N'))"

try {
  New-Item -ItemType Directory -Path $browserProfileDir -Force | Out-Null

  $serverArgs = @()
  $serverArgs += $pythonLauncher.Args
  $serverArgs += @("-m", "http.server", $Port, "--bind", "127.0.0.1")

  $serverProcess = Start-Process `
    -FilePath $pythonLauncher.Command `
    -ArgumentList $serverArgs `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -PassThru

  $probeUrl = "http://127.0.0.1:$Port/"
  $serverReady = $false
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    Start-Sleep -Milliseconds 200
    try {
      $response = Invoke-WebRequest -Uri $probeUrl -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        $serverReady = $true
        break
      }
    } catch {
      # Keep probing until the server is up.
    }
  }

  if (-not $serverReady) {
    throw "Local server did not start on port $Port."
  }

  $queryParts = @(
    "print=1",
    "printStyle=screen"
  )
  if ($PrintTheme -ne "auto") {
    $queryParts += "printTheme=$PrintTheme"
  }
  $portfolioUrl = "http://127.0.0.1:$Port/?$($queryParts -join '&')"
  if (Test-Path $fullOutputPath) {
    Remove-Item -Path $fullOutputPath -Force
  }

  $commonArgs = @(
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--run-all-compositor-stages-before-draw",
    "--virtual-time-budget=$LoadBudgetMs",
    "--user-data-dir=$browserProfileDir",
    "--print-to-pdf=$fullOutputPath",
    $portfolioUrl
  )

  $attemptArgs = @(
    @("--headless=new", "--print-to-pdf-no-header"),
    @("--headless", "--print-to-pdf-no-header"),
    @("--headless")
  )

  $browserProc = $null
  $pdfCreated = $false
  foreach ($variant in $attemptArgs) {
    $browserArgs = @()
    $browserArgs += $variant
    $browserArgs += $commonArgs

    $browserProc = Start-Process `
      -FilePath $browserExe `
      -ArgumentList $browserArgs `
      -WindowStyle Hidden `
      -PassThru `
      -Wait

    if ($browserProc.ExitCode -eq 0 -and (Test-Path $fullOutputPath)) {
      $pdfCreated = $true
      break
    }
  }

  if (-not $pdfCreated) {
    $exitCode = if ($browserProc) { $browserProc.ExitCode } else { -1 }
    throw "Browser export failed with exit code $exitCode."
  }

  $pdfSizeBytes = (Get-Item $fullOutputPath).Length
  Write-Output "PDF exported: $fullOutputPath ($pdfSizeBytes bytes)"
} finally {
  if ($serverProcess -and -not $serverProcess.HasExited) {
    Stop-Process -Id $serverProcess.Id -Force
  }
  if (Test-Path $browserProfileDir) {
    Remove-Item -Path $browserProfileDir -Recurse -Force
  }
}
