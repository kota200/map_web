[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InputDirectory,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [Parameter(Mandatory = $true)][string]$StaticComponentsPath
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

function Copy-Sidecar([string]$sourceName, [string]$bundleName, [string]$runtimeName) {
  $bundled = Copy-RegisteredFile $sourceName $bundleName
  $runtimeDestination = Join-Path $OutputDirectory $runtimeName
  Copy-Item -LiteralPath (Join-Path $OutputDirectory $bundleName) -Destination $runtimeDestination -Force
  return [ordered]@{ file = $runtimeName; sha256 = $bundled.sha256 }
}

$fastp = Copy-Sidecar 'fastp.exe' "fastp-$target.exe" 'fastp.exe'
$kallisto = Copy-Sidecar 'kallisto.exe' "kallisto-$target.exe" 'kallisto.exe'
$hisat2 = Copy-Sidecar 'hisat2.exe' "hisat2-$target.exe" 'hisat2.exe'
$hisat2Build = Copy-Sidecar 'hisat2-build.exe' "hisat2-build-$target.exe" 'hisat2-build.exe'
$featureCounts = Copy-Sidecar 'featureCounts.exe' "featureCounts-$target.exe" 'featureCounts.exe'

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

$staticComponents = @(
  Import-Csv -LiteralPath $StaticComponentsPath -Delimiter "`t" | ForEach-Object {
    $licenseFiles = @(
      $_.license_files.Split(';', [System.StringSplitOptions]::RemoveEmptyEntries) | ForEach-Object {
        [ordered]@{ file = $_; sha256 = (LicenseSha256 $_) }
      }
    )
    $linkedInto = @($_.linked_into.Split(';', [System.StringSplitOptions]::RemoveEmptyEntries))
    if (
      [string]::IsNullOrWhiteSpace($_.package) -or
      [string]::IsNullOrWhiteSpace($_.package_version) -or
      [string]::IsNullOrWhiteSpace($_.source_url) -or
      [string]::IsNullOrWhiteSpace($_.license) -or
      $licenseFiles.Count -eq 0 -or
      $linkedInto.Count -eq 0
    ) {
      throw "Incomplete static-link component registration: $($_.package)"
    }
    [ordered]@{
      package = $_.package
      package_version = $_.package_version
      source_url = $_.source_url
      license = $_.license
      license_files = $licenseFiles
      linked_into = $linkedInto
    }
  }
)
if ($staticComponents.Count -eq 0) { throw 'No static-link components were registered.' }

$fastpLicense = 'licenses/fastp-MIT.txt'
$kallistoLicense = 'licenses/kallisto-BSD-2-Clause.txt'
$bifrostLicense = 'licenses/Bifrost-BSD-2-Clause.txt'
$zlibNgLicense = 'licenses/zlib-ng-zlib.txt'
$hisat2License = 'licenses/HISAT2-GPL-3.0.txt'
$subreadLicense = 'licenses/Subread-GPL-3.0.txt'
$workflowProvenance = '.github/workflows/windows-sidecars.yml'

$manifest = [ordered]@{
  target = $target
  static_link_components = $staticComponents
  sidecars = @(
    [ordered]@{ tool = 'Fastp'; file = $fastp.file; sha256 = $fastp.sha256; version = '0.23.4'; source_url = 'https://github.com/OpenGene/fastp/tree/v0.23.4'; source_revision = '1ffcaed6892832c09c4b4094c201cd4eff8fa622'; build_provenance = $workflowProvenance; license = 'MIT'; license_file = $fastpLicense; license_sha256 = (LicenseSha256 $fastpLicense); support_files = $fastpSupport },
    [ordered]@{
      tool = 'Kallisto'
      file = $kallisto.file
      sha256 = $kallisto.sha256
      version = '0.52.0'
      source_url = 'https://github.com/pachterlab/kallisto/tree/v0.52.0'
      source_revision = '4e9f29cf3b021260415430c057a22469ca081391'
      build_provenance = $workflowProvenance
      license = 'BSD-2-Clause'
      license_file = $kallistoLicense
      license_sha256 = (LicenseSha256 $kallistoLicense)
      support_files = @($runtimeSupport)
      bundled_components = @(
        [ordered]@{ name = 'Bifrost'; version = 'kallisto-v0.52.0-bundled'; source_url = 'https://github.com/pmelsted/bifrost'; license = 'BSD-2-Clause'; license_file = $bifrostLicense; license_sha256 = (LicenseSha256 $bifrostLicense) },
        [ordered]@{ name = 'zlib-ng'; version = '2.1.0.devel-kallisto-bundled'; source_url = 'https://github.com/zlib-ng/zlib-ng'; license = 'Zlib'; license_file = $zlibNgLicense; license_sha256 = (LicenseSha256 $zlibNgLicense) }
      )
    },
    [ordered]@{ tool = 'Hisat2'; file = $hisat2.file; sha256 = $hisat2.sha256; version = '2.2.3'; source_url = 'https://github.com/DaehwanKimLab/hisat2/tree/v2.2.3'; source_revision = '0d244324f98de541bce04d45c75e83bc3522f7f4'; build_provenance = $workflowProvenance; license = 'GPL-3.0-or-later'; license_file = $hisat2License; license_sha256 = (LicenseSha256 $hisat2License); support_files = $hisatSupport },
    [ordered]@{ tool = 'Hisat2Build'; file = $hisat2Build.file; sha256 = $hisat2Build.sha256; version = '2.2.3'; source_url = 'https://github.com/DaehwanKimLab/hisat2/tree/v2.2.3'; source_revision = '0d244324f98de541bce04d45c75e83bc3522f7f4'; build_provenance = $workflowProvenance; license = 'GPL-3.0-or-later'; license_file = $hisat2License; license_sha256 = (LicenseSha256 $hisat2License); support_files = $hisatSupport },
    [ordered]@{ tool = 'FeatureCounts'; file = $featureCounts.file; sha256 = $featureCounts.sha256; version = '2.1.1'; source_url = 'https://sourceforge.net/projects/subread/files/subread-2.1.1/subread-2.1.1-Windows-x86_64.zip/download'; source_revision = 'subread-2.1.1-Windows-x86_64.zip'; build_provenance = $workflowProvenance; license = 'GPL-3.0-or-later'; license_file = $subreadLicense; license_sha256 = (LicenseSha256 $subreadLicense); support_files = @() }
  )
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $OutputDirectory "sidecars.$target.json") -Encoding utf8NoBOM
