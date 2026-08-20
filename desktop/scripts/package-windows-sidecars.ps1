[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InputDirectory,
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$target = 'x86_64-pc-windows-msvc'
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null

function Copy-RegisteredFile([string]$sourceName, [string]$destinationName) {
  $source = Join-Path $InputDirectory $sourceName
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing expected sidecar file: $sourceName" }
  $destination = Join-Path $OutputDirectory $destinationName
  Copy-Item -LiteralPath $source -Destination $destination -Force
  return [ordered]@{ file = $destinationName; sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() }
}

$fastp = Copy-RegisteredFile 'fastp.exe' "fastp-$target.exe"
$hisat2 = Copy-RegisteredFile 'hisat2.exe' "hisat2-$target.exe"
$hisat2Build = Copy-RegisteredFile 'hisat2-build.exe' "hisat2-build-$target.exe"
$featureCounts = Copy-RegisteredFile 'featureCounts.exe' "featureCounts-$target.exe"

$fastpSupport = @()
Get-ChildItem -LiteralPath $InputDirectory -Filter '*.dll' -File | Sort-Object Name | ForEach-Object {
  $fastpSupport += Copy-RegisteredFile $_.Name $_.Name
}
$hisatSupport = @()
@('hisat2-align-s.exe', 'hisat2-align-l.exe', 'hisat2-build-s.exe', 'hisat2-build-l.exe') | ForEach-Object {
  $hisatSupport += Copy-RegisteredFile $_ $_
}

$manifest = [ordered]@{
  target = $target
  sidecars = @(
    [ordered]@{ tool = 'Fastp'; file = $fastp.file; sha256 = $fastp.sha256; version = '0.23.4'; source_url = 'https://github.com/OpenGene/fastp/tree/v0.23.4'; license = 'MIT'; license_file = 'licenses/fastp-MIT.txt'; support_files = $fastpSupport },
    [ordered]@{ tool = 'Hisat2'; file = $hisat2.file; sha256 = $hisat2.sha256; version = '2.2.3'; source_url = 'https://github.com/DaehwanKimLab/hisat2/tree/v2.2.3'; license = 'GPL-3.0-or-later'; license_file = 'licenses/HISAT2-GPL-3.0.txt'; support_files = $hisatSupport },
    [ordered]@{ tool = 'Hisat2Build'; file = $hisat2Build.file; sha256 = $hisat2Build.sha256; version = '2.2.3'; source_url = 'https://github.com/DaehwanKimLab/hisat2/tree/v2.2.3'; license = 'GPL-3.0-or-later'; license_file = 'licenses/HISAT2-GPL-3.0.txt'; support_files = $hisatSupport },
    [ordered]@{ tool = 'FeatureCounts'; file = $featureCounts.file; sha256 = $featureCounts.sha256; version = '2.1.1'; source_url = 'https://sourceforge.net/projects/subread/files/subread-2.1.1/subread-2.1.1-Windows-x86_64.zip/download'; license = 'GPL-3.0-or-later'; license_file = 'licenses/Subread-GPL-3.0.txt'; support_files = @() }
  )
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'sidecars.windows-x86_64.json') -Encoding utf8NoBOM
