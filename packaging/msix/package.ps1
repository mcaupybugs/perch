# Wraps the built Windows app into an MSIX package for the Microsoft Store.
# Run on Windows after `npx tauri build --no-bundle`. The package is left unsigned:
# the Store signs it after certification.
#
# Identity comes from the environment (set as GitHub repository variables):
#   MSIX_IDENTITY_NAME, MSIX_PUBLISHER, MSIX_PUBLISHER_DISPLAY_NAME
# Without them a placeholder identity is used, which is only good for checking the build.

$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot/../.."

$conf = Get-Content "$root/src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json
$version = "$($conf.version).0" # the Store needs four parts, with the last one 0

$identity = if ($env:MSIX_IDENTITY_NAME) { $env:MSIX_IDENTITY_NAME } else { "Perch.PlaceholderIdentity" }
$publisher = if ($env:MSIX_PUBLISHER) { $env:MSIX_PUBLISHER } else { "CN=PerchPlaceholder" }
$display = if ($env:MSIX_PUBLISHER_DISPLAY_NAME) { $env:MSIX_PUBLISHER_DISPLAY_NAME } else { "Perch (placeholder)" }
$placeholder = -not $env:MSIX_IDENTITY_NAME

$exe = Get-ChildItem "$root/src-tauri/target/release" -Filter "*.exe" |
  Where-Object { $_.BaseName -ieq "perch" } | Select-Object -First 1
if (-not $exe) { throw "Perch.exe not found in src-tauri/target/release - run 'npx tauri build --no-bundle' first." }

$layout = Join-Path $root "target-msix/layout"
Remove-Item $layout -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$layout/Assets" | Out-Null
Copy-Item $exe.FullName "$layout/Perch.exe"
foreach ($icon in "Square44x44Logo.png", "Square150x150Logo.png", "StoreLogo.png") {
  Copy-Item "$root/src-tauri/icons/$icon" "$layout/Assets/$icon"
}

$escape = { param($s) [System.Security.SecurityElement]::Escape($s) }
$manifest = (Get-Content "$PSScriptRoot/AppxManifest.xml" -Raw).
  Replace("{{IDENTITY_NAME}}", (& $escape $identity)).
  Replace("{{PUBLISHER}}", (& $escape $publisher)).
  Replace("{{PUBLISHER_DISPLAY_NAME}}", (& $escape $display)).
  Replace("{{VERSION}}", $version)
Set-Content "$layout/AppxManifest.xml" $manifest -Encoding utf8

$makeappx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter makeappx.exe |
  Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeappx) { throw "makeappx.exe not found - install the Windows 10/11 SDK." }

$suffix = if ($placeholder) { "_placeholder" } else { "" }
$out = Join-Path $root "target-msix/Perch_$($conf.version)_x64$suffix.msix"
& $makeappx.FullName pack /d $layout /p $out /o
if ($LASTEXITCODE -ne 0) { throw "makeappx failed with exit code $LASTEXITCODE" }
Write-Host "Packaged $out (identity: $identity, version $version)"
