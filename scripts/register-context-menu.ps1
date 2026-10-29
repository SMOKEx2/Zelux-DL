# ==============================================================================
# ZeluxDL - Windows Context Menu Registration Script
# ==============================================================================
param(
    [string]$ExePath = ""
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host "    ZeluxDL Windows Context Menu Integrator" -ForegroundColor Cyan
Write-Host "    ผสานเมนูคลิกขวาใน Windows Explorer เข้ากับ ZeluxDL" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host ""

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RootDir = Split-Path -Parent $ScriptDir

if (-not $ExePath) {
    $Candidates = @(
        (Join-Path $RootDir "target\release\ZeluxDL.exe"),
        (Join-Path $RootDir "packaging\out\ZeluxDL-2.0.0-portable\ZeluxDL.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\ZeluxDL\ZeluxDL.exe"),
        (Join-Path $env:ProgramFiles "ZeluxDL\ZeluxDL.exe")
    )
    foreach ($c in $Candidates) {
        if (Test-Path $c) {
            $ExePath = (Resolve-Path $c).Path
            break
        }
    }
}

if (-not $ExePath -or -not (Test-Path $ExePath)) {
    Write-Host "[!] ไม่พบไฟล์ ZeluxDL.exe" -ForegroundColor Red
    exit 1
}

Write-Host "[*] ZeluxDL executable: $ExePath" -ForegroundColor Gray

$HKCU = [Microsoft.Win32.Registry]::CurrentUser

# 1. Right click on any file
$k1 = $HKCU.CreateSubKey("Software\Classes\*\shell\ZeluxDL")
$k1.SetValue("", "ดาวน์โหลดด้วย ZeluxDL")
$k1.SetValue("Icon", "`"$ExePath`",0")
$k1cmd = $k1.CreateSubKey("command")
$k1cmd.SetValue("", "`"$ExePath`" `"%1`"")
$k1.Close()
Write-Host "  [✓] เมนูคลิกขวาสำหรับไฟล์ทั่วไป (*)" -ForegroundColor Green

# 2. Right click on URL shortcuts (.url)
$k2 = $HKCU.CreateSubKey("Software\Classes\InternetShortcut\shell\ZeluxDL")
$k2.SetValue("", "ดาวน์โหลดด้วย ZeluxDL")
$k2.SetValue("Icon", "`"$ExePath`",0")
$k2cmd = $k2.CreateSubKey("command")
$k2cmd.SetValue("", "`"$ExePath`" `"%1`"")
$k2.Close()
Write-Host "  [✓] เมนูคลิกขวาสำหรับชอร์ตคัตเว็บ (.url)" -ForegroundColor Green

# 3. Torrent association (.torrent)
$k3 = $HKCU.CreateSubKey("Software\Classes\ZeluxDL.Torrent")
$k3.SetValue("", "ZeluxDL BitTorrent File")
$k3cmd = $k3.CreateSubKey("shell\open\command")
$k3cmd.SetValue("", "`"$ExePath`" `"%1`"")
$k3.Close()
$k3assoc = $HKCU.CreateSubKey("Software\Classes\.torrent\OpenWithProgids")
$k3assoc.SetValue("ZeluxDL.Torrent", "")
$k3assoc.Close()
Write-Host "  [✓] ความเชื่อมโยงไฟล์ Torrent (.torrent)" -ForegroundColor Green

# 4. Magnet link protocol handler (magnet:)
$k4 = $HKCU.CreateSubKey("Software\Classes\magnet")
$k4.SetValue("", "URL:Magnet Protocol")
$k4.SetValue("URL Protocol", "")
$k4cmd = $k4.CreateSubKey("shell\open\command")
$k4cmd.SetValue("", "`"$ExePath`" `"%1`"")
$k4.Close()
Write-Host "  [✓] โปรโตคอล Magnet Link (magnet:)" -ForegroundColor Green

# 5. Right click on folder / desktop background
$k5 = $HKCU.CreateSubKey("Software\Classes\Directory\Background\shell\ZeluxDL")
$k5.SetValue("", "เปิด ZeluxDL")
$k5.SetValue("Icon", "`"$ExePath`",0")
$k5cmd = $k5.CreateSubKey("command")
$k5cmd.SetValue("", "`"$ExePath`"")
$k5.Close()
Write-Host "  [✓] เมนูคลิกขวาที่ว่างในโฟลเดอร์และหน้า Desktop" -ForegroundColor Green

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host "  [✓] ผสานเมนูคลิกขวา Windows Explorer สำเร็จสมบูรณ์!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host ""
