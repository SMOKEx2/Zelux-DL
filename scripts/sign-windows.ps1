param(
  [string]$CertificatePath = $env:ZELUX_SIGN_CERTIFICATE,
  [string]$CertificatePassword = $env:ZELUX_SIGN_PASSWORD,
  [string]$ExecutablePath = (Join-Path $PSScriptRoot '..\dist\ZELUX-DL.exe')
)

$ErrorActionPreference = 'Stop'
$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
if (-not $CertificatePath) { throw 'Set ZELUX_SIGN_CERTIFICATE or pass -CertificatePath.' }
$resolvedCertificate = (Resolve-Path -LiteralPath $CertificatePath).Path

$signTool = Get-ChildItem -Path "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Filter signtool.exe -Recurse |
  Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
  Sort-Object FullName -Descending |
  Select-Object -First 1
if (-not $signTool) { throw 'signtool.exe was not found. Install the Windows SDK.' }

& $signTool.FullName sign /fd SHA256 /td SHA256 /tr http://timestamp.digicert.com /f $resolvedCertificate /p $CertificatePassword $resolvedExecutable
if ($LASTEXITCODE -ne 0) { throw "signtool failed with exit code $LASTEXITCODE" }
& $signTool.FullName verify /pa /v $resolvedExecutable
if ($LASTEXITCODE -ne 0) { throw "signature verification failed with exit code $LASTEXITCODE" }
