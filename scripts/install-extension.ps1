# ==============================================================================
# ZeluxDL - 1-Click Browser Extension Installer for Windows
# ==============================================================================
param(
    [switch]$Uninstall = $false
)

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host "    ZeluxDL Browser Extension 1-Click Installer" -ForegroundColor Cyan
Write-Host "    ติดตั้งส่วนขยายเบราว์เซอร์ ZeluxDL อัตโนมัติ" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host ""

$ExtensionId = "knbafelhijahhnpjkfjggcljdalpbaac"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RootDir = Split-Path -Parent $ScriptDir

# Locate the unpacked extension directory
$ExtensionDir = $null
$Candidates = @(
    (Join-Path $ScriptDir "extension\chromium"),
    (Join-Path $RootDir "extension\build\chromium"),
    (Join-Path $RootDir "extension\chromium"),
    (Join-Path $RootDir "packaging\out\zeluxdl-chromium"),
    (Join-Path $env:LOCALAPPDATA "ZeluxDL\resources\extension\chromium"),
    (Join-Path $env:ProgramFiles "ZeluxDL\resources\extension\chromium")
)

foreach ($c in $Candidates) {
    if (Test-Path (Join-Path $c "manifest.json")) {
        $ExtensionDir = (Resolve-Path $c).Path
        break
    }
}

# If not found, check if zip is nearby and extract
if (-not $ExtensionDir) {
    $ZipCandidates = @(
        (Join-Path $ScriptDir "zeluxdl-chromium.zip"),
        (Join-Path $RootDir "extension\build\zeluxdl-chromium.zip"),
        (Join-Path $RootDir "packaging\out\zeluxdl-chromium.zip")
    )
    foreach ($z in $ZipCandidates) {
        if (Test-Path $z) {
            $ExtractTarget = Join-Path $env:LOCALAPPDATA "ZeluxDL\extension\chromium"
            Write-Host "[*] กำลังแตกไฟล์ส่วนขยายไปยัง $ExtractTarget ..." -ForegroundColor Yellow
            New-Item -ItemType Directory -Force $ExtractTarget | Out-Null
            Expand-Archive -Path $z -DestinationPath $ExtractTarget -Force
            if (Test-Path (Join-Path $ExtractTarget "manifest.json")) {
                $ExtensionDir = $ExtractTarget
                break
            }
        }
    }
}

if (-not $ExtensionDir -and -not $Uninstall) {
    Write-Host "[!] ไม่พบโฟลเดอร์ extension/chromium หรือ zeluxdl-chromium.zip" -ForegroundColor Red
    Write-Host "    กรุณาตรวจสอบว่ามีโฟลเดอร์ส่วนขยายอยู่ในโปรเจกต์หรือในเครื่อง" -ForegroundColor Yellow
    exit 1
}

$ManifestPath = if ($ExtensionDir) { Join-Path $ExtensionDir "manifest.json" } else { "" }
$Version = "2.0.0"
if ($ManifestPath -and (Test-Path $ManifestPath)) {
    try {
        $manifest = Get-Content $ManifestPath -Raw -Encoding utf8 | ConvertFrom-Json
        if ($manifest.version) { $Version = $manifest.version }
    } catch {}
}

# Browser registry paths for External Extensions
$Browsers = @(
    @{ Name = "Google Chrome"; Key = "HKCU:\Software\Google\Chrome\Extensions\$ExtensionId"; Exe = "chrome.exe" },
    @{ Name = "Microsoft Edge"; Key = "HKCU:\Software\Microsoft\Edge\Extensions\$ExtensionId"; Exe = "msedge.exe" },
    @{ Name = "Brave Browser"; Key = "HKCU:\Software\BraveSoftware\Brave-Browser\Extensions\$ExtensionId"; Exe = "brave.exe" },
    @{ Name = "Vivaldi"; Key = "HKCU:\Software\Vivaldi\Extensions\$ExtensionId"; Exe = "vivaldi.exe" },
    @{ Name = "Opera"; Key = "HKCU:\Software\Opera Software\Opera Stable\Extensions\$ExtensionId"; Exe = "opera.exe" }
)

if ($Uninstall) {
    Write-Host "[*] กำลังถอนการติดตั้งการลงทะเบียนส่วนขยายจาก Registry..." -ForegroundColor Yellow
    foreach ($b in $Browsers) {
        if (Test-Path $b.Key) {
            Remove-Item -Path $b.Key -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "  [-] ลบการลงทะเบียนจาก $($b.Name)" -ForegroundColor Green
        }
    }
    Write-Host "`n[✓] ถอนการติดตั้งส่วนขยายเรียบร้อยแล้ว!" -ForegroundColor Green
    exit 0
}

Write-Host "[*] ตำแหน่งส่วนขยาย: $ExtensionDir (v$Version)" -ForegroundColor Gray

$registeredCount = 0
foreach ($b in $Browsers) {
    try {
        if (-not (Test-Path $b.Key)) {
            New-Item -Path $b.Key -Force | Out-Null
        }
        # Chromium external extension values:
        # 'path' points to manifest.json or unpacked extension directory
        Set-ItemProperty -Path $b.Key -Name "path" -Value $ManifestPath -Type String
        Set-ItemProperty -Path $b.Key -Name "version" -Value $Version -Type String
        Write-Host "  [✓] ลงทะเบียนเข้า $($b.Name) สำเร็จ!" -ForegroundColor Green
        $registeredCount++
    } catch {
        Write-Host "  [-] ข้าม $($b.Name): $($_.Exception.Message)" -ForegroundColor DarkGray
    }
}

# Native messaging check
$NativeHostBin = $null
$NativeCandidates = @(
    (Join-Path $RootDir "target\release\zeluxdl-native-host.exe"),
    (Join-Path $RootDir "app\src-tauri\binaries\zeluxdl-native-host-x86_64-pc-windows-msvc.exe"),
    (Join-Path $env:LOCALAPPDATA "ZeluxDL\zeluxdl-native-host.exe")
)
foreach ($n in $NativeCandidates) {
    if (Test-Path $n) { $NativeHostBin = $n; break }
}

if ($NativeHostBin) {
    Write-Host "[*] กำลังซ่อมแซมและยืนยันการเชื่อมต่อ Native Host..." -ForegroundColor Yellow
    & $NativeHostBin register | Out-Null
    Write-Host "  [✓] Native Messaging Host เชื่อมต่อสมบูรณ์!" -ForegroundColor Green
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host "  [✓] ติดตั้งส่วนขยาย ZeluxDL สำเร็จเรียบร้อย! ($registeredCount เบราว์เซอร์)" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "วิธีเปิดใช้งานในเบราว์เซอร์ของคุณ:" -ForegroundColor Cyan
Write-Host "  1. เปิดเบราว์เซอร์ (Chrome / Edge / Brave)" -ForegroundColor White
Write-Host "  2. จะมีข้อความแจ้งเตือนจากเบราว์เซอร์ถามเพื่อเปิดใช้ส่วนขยาย หรือไปที่:" -ForegroundColor White
Write-Host "     - Chrome / Brave: chrome://extensions" -ForegroundColor Yellow
Write-Host "     - Edge: edge://extensions" -ForegroundColor Yellow
Write-Host "  3. กดปุ่ม 'เปิดใช้งาน' (Enable) หรือคลิกไอคอน จิ๊กซอว์ เพื่อปักหมุด ZeluxDL" -ForegroundColor White
Write-Host ""
