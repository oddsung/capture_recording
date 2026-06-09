# Builds the native UIA helper with the Windows built-in .NET Framework csc.exe.
# No .NET SDK required; output runs on the .NET Framework 4.8 runtime in Windows 10/11.
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { throw "csc.exe not found at $csc" }

function Find-Gac($name) {
  $hit = Get-ChildItem -Path 'C:\Windows\Microsoft.NET\assembly\GAC_MSIL' -Recurse -Filter "$name.dll" -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $hit) { throw "Assembly not found in GAC: $name" }
  return $hit.FullName
}

$refs = @(
  'System.dll',
  'System.Core.dll',
  'System.Drawing.dll',
  (Find-Gac 'WindowsBase'),
  (Find-Gac 'UIAutomationClient'),
  (Find-Gac 'UIAutomationTypes')
)

$outDir = Join-Path $root 'bin'
New-Item -ItemType Directory -Force $outDir | Out-Null
$out = Join-Path $outDir 'native-helper.exe'

$args = @('/nologo', '/optimize+', '/target:exe', '/platform:x64', "/out:$out")
foreach ($r in $refs) { $args += "/reference:$r" }
$args += (Join-Path $root 'NativeHelper.cs')

Write-Output "Compiling native-helper.exe ..."
& $csc @args
if ($LASTEXITCODE -ne 0) { throw "csc failed with exit code $LASTEXITCODE" }
Write-Output "Built: $out"
