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

$runtimeSupport = @()
Get-ChildItem -LiteralPath $InputDirectory -Filter '*.dll' -File | Sort-Object Name | ForEach-Object {
  $runtimeSupport += Copy-RegisteredFile $_.Name $_.Name
}
$fastpSupport = @($runtimeSupport)
$hisatSupport = @($runtimeSupport)
@('hisat2-align-s.exe', 'hisat2-align-l.exe', 'hisat2-build-s.exe', 'hisat2-build-l.exe') | ForEach-Object {
  $hisatSupport += Copy-RegisteredFile $_ $_
}

function LicenseSha256([string]$relativePath) {
  $path = Join-Path $InputDirectory $relativePath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing license file: $relativePath" }
  return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

$fastpLicense = 'licenses/fastp-MIT.txt'
$hisat2License = 'licenses/HISAT2-GPL-3.0.txt'
$subreadLicense = 'licenses/Subread-GPL-3.0.txt'
$workflowProvenance = '.github/workflows/windows-sidecars.yml'

$manifest = [ordered]@{
  target = $target
  sidecars = @(
    [ordered]@{ tool = 'Fastp'; file = $fastp.file; sha256 = $fastp.sha256; version = '0.23.4'; source_url = 'https://github.com/OpenGene/fastp/tree/v0.23.4'; source_revision = '1ffcaed6892832c09c4b4094c201cd4eff8fa622'; build_provenance = $workflowProvenance; license = 'MIT'; license_file = $fastpLicense; license_sha256 = (LicenseSha256 $fastpLicense); support_files = $fastpSupport },
    [ordered]@{ tool = 'Hisat2'; file = $hisat2.file; sha256 = $hisat2.sha256; version = '2.2.3'; source_url = 'https://github.com/DaehwanKimLab/hisat2/tree/v2.2.3'; source_revision = '0d244324f98de541bce04d45c75e83bc3522f7f4'; build_provenance = $workflowProvenance; license = 'GPL-3.0-or-later'; license_file = $hisat2License; license_sha256 = (LicenseSha256 $hisat2License); support_files = $hisatSupport },
    [ordered]@{ tool = 'Hisat2Build'; file = $hisat2Build.file; sha256 = $hisat2Build.sha256; version = '2.2.3'; source_url = 'https://github.com/DaehwanKimLab/hisat2/tree/v2.2.3'; source_revision = '0d244324f98de541bce04d45c75e83bc3522f7f4'; build_provenance = $workflowProvenance; license = 'GPL-3.0-or-later'; license_file = $hisat2License; license_sha256 = (LicenseSha256 $hisat2License); support_files = $hisatSupport },
    [ordered]@{ tool = 'FeatureCounts'; file = $featureCounts.file; sha256 = $featureCounts.sha256; version = '2.1.1'; source_url = 'https://sourceforge.net/projects/subread/files/subread-2.1.1/subread-2.1.1-Windows-x86_64.zip/download'; source_revision = 'subread-2.1.1-Windows-x86_64.zip'; build_provenance = $workflowProvenance; license = 'GPL-3.0-or-later'; license_file = $subreadLicense; license_sha256 = (LicenseSha256 $subreadLicense); support_files = @() }
  )
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'sidecars.windows-x86_64.json') -Encoding utf8NoBOM
