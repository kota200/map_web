[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$SourceDirectory,
  [Parameter(Mandatory = $true)][string]$Target,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [Parameter(Mandatory = $true)][string]$BuildProvenance
)

$ErrorActionPreference = 'Stop'
foreach ($path in @($Executable, $SourceDirectory)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Required path is missing: $path" }
}
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$licenseDirectory = Join-Path $OutputDirectory 'licenses'
New-Item -ItemType Directory -Force $licenseDirectory | Out-Null

$suffix = if ($Target -like '*-windows-*') { '.exe' } else { '' }
$bundleFileName = "kallisto-$Target$suffix"
$bundleDestination = Join-Path $OutputDirectory $bundleFileName
$runtimeFileName = "kallisto$suffix"
$runtimeDestination = Join-Path $OutputDirectory $runtimeFileName
Copy-Item -LiteralPath $Executable -Destination $bundleDestination -Force
Copy-Item -LiteralPath $Executable -Destination $runtimeDestination -Force

$licenseSources = [ordered]@{
  'kallisto-BSD-2-Clause.txt' = (Join-Path $SourceDirectory 'license.txt')
  'Bifrost-BSD-2-Clause.txt' = (Join-Path $SourceDirectory 'ext/bifrost/LICENSE')
  'zlib-ng-zlib.txt' = (Join-Path $SourceDirectory 'ext/zlib-ng/LICENSE.md')
}
foreach ($item in $licenseSources.GetEnumerator()) {
  if (-not (Test-Path -LiteralPath $item.Value -PathType Leaf)) { throw "License file is missing: $($item.Value)" }
  Copy-Item -LiteralPath $item.Value -Destination (Join-Path $licenseDirectory $item.Key) -Force
}

function Hash([string]$Path) {
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

$manifest = [ordered]@{
  target = $Target
  sidecars = @(
    [ordered]@{
      tool = 'Kallisto'
      file = $runtimeFileName
      sha256 = (Hash $runtimeDestination)
      version = '0.52.0'
      source_url = 'https://github.com/pachterlab/kallisto/tree/v0.52.0'
      source_revision = '4e9f29cf3b021260415430c057a22469ca081391'
      build_provenance = $BuildProvenance
      license = 'BSD-2-Clause'
      license_file = 'licenses/kallisto-BSD-2-Clause.txt'
      license_sha256 = (Hash (Join-Path $licenseDirectory 'kallisto-BSD-2-Clause.txt'))
      support_files = @()
      bundled_components = @(
        [ordered]@{ name = 'Bifrost'; version = 'kallisto-v0.52.0-bundled'; source_url = 'https://github.com/pmelsted/bifrost'; license = 'BSD-2-Clause'; license_file = 'licenses/Bifrost-BSD-2-Clause.txt'; license_sha256 = (Hash (Join-Path $licenseDirectory 'Bifrost-BSD-2-Clause.txt')) },
        [ordered]@{ name = 'zlib-ng'; version = '2.1.0.devel-kallisto-bundled'; source_url = 'https://github.com/zlib-ng/zlib-ng'; license = 'Zlib'; license_file = 'licenses/zlib-ng-zlib.txt'; license_sha256 = (Hash (Join-Path $licenseDirectory 'zlib-ng-zlib.txt')) }
      )
    }
  )
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $OutputDirectory "sidecars.$Target.json") -Encoding utf8NoBOM

$hashLines = Get-ChildItem -LiteralPath $OutputDirectory -File -Recurse | Sort-Object FullName | ForEach-Object {
  $relative = [IO.Path]::GetRelativePath($OutputDirectory, $_.FullName).Replace('\', '/')
  "$(Hash $_.FullName)  $relative"
}
$hashLines | Set-Content -LiteralPath (Join-Path $OutputDirectory 'SHA256SUMS') -Encoding utf8NoBOM
