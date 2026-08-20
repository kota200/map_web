[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$OutputPath = (Join-Path $PSScriptRoot '..\src-tauri\icons\icon.ico')
)

$ErrorActionPreference = 'Stop'

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = [System.IO.Path]::GetDirectoryName($resolvedOutput)
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

# A deterministic 32 x 32, 32-bit ICO. Building the small binary directly keeps
# CI independent of image-conversion tools while providing the Windows resource
# required by tauri-build.
$width = 32
$height = 32
$xorBytes = $width * $height * 4
$andStride = [int](($width + 31) / 32) * 4
$andBytes = $andStride * $height
$bitmapBytes = 40 + $xorBytes + $andBytes

$stream = [System.IO.File]::Open(
  $resolvedOutput,
  [System.IO.FileMode]::Create,
  [System.IO.FileAccess]::Write,
  [System.IO.FileShare]::None
)
$writer = [System.IO.BinaryWriter]::new($stream)

try {
  # ICONDIR and ICONDIRENTRY.
  $writer.Write([uint16]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]1)
  $writer.Write([byte]$width)
  $writer.Write([byte]$height)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]32)
  $writer.Write([uint32]$bitmapBytes)
  $writer.Write([uint32]22)

  # BITMAPINFOHEADER. ICO height includes both the XOR and AND masks.
  $writer.Write([uint32]40)
  $writer.Write([int32]$width)
  $writer.Write([int32]($height * 2))
  $writer.Write([uint16]1)
  $writer.Write([uint16]32)
  $writer.Write([uint32]0)
  $writer.Write([uint32]$xorBytes)
  $writer.Write([int32]0)
  $writer.Write([int32]0)
  $writer.Write([uint32]0)
  $writer.Write([uint32]0)

  # Opaque BGRA pixels, stored bottom-up. The central crossing strands form a
  # simple RNA/mapping mark without depending on fonts or rendering libraries.
  for ($sourceY = $height - 1; $sourceY -ge 0; $sourceY--) {
    for ($x = 0; $x -lt $width; $x++) {
      $dx1 = [math]::Abs($x - $sourceY)
      $dx2 = [math]::Abs($x - (($width - 1) - $sourceY))
      $isStrand = ($dx1 -le 2) -or ($dx2 -le 2)

      if ($isStrand) {
        $red = [byte]214
        $green = [byte]247
        $blue = [byte]255
      } else {
        $red = [byte]18
        $green = [byte]83
        $blue = [byte]113
      }

      $writer.Write($blue)
      $writer.Write($green)
      $writer.Write($red)
      $writer.Write([byte]255)
    }
  }

  # All-zero AND mask: every pixel is opaque.
  $writer.Write([byte[]]::new($andBytes))
} finally {
  $writer.Dispose()
  $stream.Dispose()
}

$hash = (Get-FileHash -LiteralPath $resolvedOutput -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "Created deterministic Windows icon: $resolvedOutput (sha256: $hash)"
