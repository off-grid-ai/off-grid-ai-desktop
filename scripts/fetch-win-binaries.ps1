# Fetch the Windows (x64) native runner binaries into resources/bin for the
# Windows package. The repo ships macOS binaries (Git LFS); this populates the
# win64 equivalents from upstream official releases at build time — laid out to
# match exactly what the app's resolvers expect:
#
#   resources/bin/llama/llama-server.exe   (+ ggml/llama DLLs)   <- src/main/llm.ts
#   resources/bin/sd/sd-cli.exe            (+ DLLs)              <- src/main/imagegen.ts
#   resources/bin/whisper/whisper-cli.exe  (+ DLLs)             <- src/main/rag/extractors.ts
#   resources/bin/ffmpeg.exe                                     <- src/main/rag/extractors.ts
#
# On Windows the DLL loader searches the directory of the .exe first, so each
# runtime's DLLs MUST sit next to its .exe (hence the per-runtime subdirs).
#
# Versions are resolved DYNAMICALLY from each project's latest GitHub release, so
# this script does not go stale. Set OFFGRID_GH_TOKEN (or GITHUB_TOKEN) to avoid
# the unauthenticated API rate limit (CI sets GITHUB_TOKEN automatically).

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # makes Invoke-WebRequest downloads fast

$bin = Join-Path $PSScriptRoot '..\resources\bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$tmpBase = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$tmp = Join-Path $tmpBase 'ogbin'
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$ghHeaders = @{ 'User-Agent' = 'offgrid-fetch-win' }
$token = if ($env:OFFGRID_GH_TOKEN) { $env:OFFGRID_GH_TOKEN } elseif ($env:GITHUB_TOKEN) { $env:GITHUB_TOKEN } else { $null }
if ($token) { $ghHeaders['Authorization'] = "Bearer $token" }

# Find the download URL of the latest-release asset whose name matches $pattern.
function Get-LatestAssetUrl($repo, $pattern) {
  $rel = Invoke-RestMethod -Headers $ghHeaders -Uri "https://api.github.com/repos/$repo/releases/latest"
  $asset = $rel.assets | Where-Object { $_.name -match $pattern } | Select-Object -First 1
  if (-not $asset) { throw "no asset matching /$pattern/ in $repo @ $($rel.tag_name)" }
  Write-Host "  $repo @ $($rel.tag_name) -> $($asset.name)"
  return $asset.browser_download_url
}

# Download + extract a zip asset, return the extraction dir.
function Expand-Asset($repo, $pattern) {
  $url = Get-LatestAssetUrl $repo $pattern
  $zip = Join-Path $tmp ([System.IO.Path]::GetRandomFileName() + '.zip')
  Write-Host "  downloading $url"
  Invoke-WebRequest -Headers $ghHeaders -Uri $url -OutFile $zip
  $out = Join-Path $tmp ([System.IO.Path]::GetFileNameWithoutExtension($zip))
  Expand-Archive -Path $zip -DestinationPath $out -Force
  return $out
}

# Copy every .exe/.dll found anywhere under $srcDir into $destSubdir (flattened).
function Copy-Runtime($srcDir, $destName) {
  $dest = Join-Path $bin $destName
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Get-ChildItem -Path $srcDir -Recurse -Include *.exe, *.dll |
    Copy-Item -Destination $dest -Force
  return $dest
}

# --- llama.cpp (server + CLIs + ggml DLLs), CPU x64 baseline -----------------
Write-Host '== llama.cpp =='
try {
  $x = Expand-Asset 'ggml-org/llama.cpp' 'bin-win-cpu-x64\.zip$'
  Copy-Runtime $x 'llama' | Out-Null
} catch { Write-Warning "llama.cpp fetch failed: $_" }

# --- whisper.cpp (whisper-cli.exe + DLLs) ------------------------------------
Write-Host '== whisper.cpp =='
try {
  $x = Expand-Asset 'ggml-org/whisper.cpp' '^whisper-bin-x64\.zip$'
  $dest = Copy-Runtime $x 'whisper'
  # Older releases ship the CLI as main.exe; the app expects whisper-cli.exe.
  $wc = Join-Path $dest 'whisper-cli.exe'
  $mn = Join-Path $dest 'main.exe'
  if (-not (Test-Path $wc) -and (Test-Path $mn)) { Copy-Item $mn $wc -Force }
} catch { Write-Warning "whisper.cpp fetch failed: $_" }

# --- stable-diffusion.cpp (image gen), avx2 x64 ------------------------------
Write-Host '== stable-diffusion.cpp =='
try {
  $x = Expand-Asset 'leejet/stable-diffusion.cpp' 'bin-win-avx2-x64\.zip$'
  $dest = Copy-Runtime $x 'sd'
  # Upstream names the binary sd.exe; the app resolves sd/sd-cli(.exe).
  $cli = Join-Path $dest 'sd-cli.exe'
  $sd = Join-Path $dest 'sd.exe'
  if (-not (Test-Path $cli) -and (Test-Path $sd)) { Copy-Item $sd $cli -Force }
} catch { Write-Warning "stable-diffusion.cpp fetch failed: $_" }

# --- ffmpeg (GPL, win64) — single ffmpeg.exe flat in resources/bin -----------
Write-Host '== ffmpeg =='
try {
  $zip = Join-Path $tmp 'ffmpeg.zip'
  Invoke-WebRequest -Headers @{ 'User-Agent' = 'offgrid-fetch-win' } `
    -Uri 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip' `
    -OutFile $zip
  $out = Join-Path $tmp 'ffmpeg'
  Expand-Archive -Path $zip -DestinationPath $out -Force
  Get-ChildItem -Path $out -Recurse -Filter 'ffmpeg.exe' |
    Select-Object -First 1 | Copy-Item -Destination (Join-Path $bin 'ffmpeg.exe') -Force
} catch { Write-Warning "ffmpeg fetch failed: $_" }

Write-Host ''
Write-Host 'resources/bin now contains (win64):'
Get-ChildItem -Path $bin -Recurse -Include *.exe |
  ForEach-Object { Write-Host "  $($_.FullName.Substring($bin.Length + 1))" }
