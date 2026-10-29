# ==============================================================================
# ZeluxDL - Windows Context Menu Unregistration Script
# ==============================================================================
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host "    ZeluxDL Windows Context Menu Remover" -ForegroundColor Cyan
Write-Host "    ถอนการผสานเมนูคลิกขวาออกจาก Windows Explorer" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host ""

$HKCU = [Microsoft.Win32.Registry]::CurrentUser

$keys = @(
    "Software\Classes\*\shell\ZeluxDL",
    "Software\Classes\InternetShortcut\shell\ZeluxDL",
    "Software\Classes\Directory\Background\shell\ZeluxDL",
    "Software\Classes\ZeluxDL.Torrent"
)

foreach ($k in $keys) {
    try {
        $parentPath = Split-Path -Parent $k
        $childName = Split-Path -Leaf $k
        $parent = $HKCU.OpenSubKey($parentPath, $true)
        if ($parent) {
            $parent.DeleteSubKeyTree($childName, $false)
            $parent.Close()
            Write-Host "  [-] ลบ $k สำเร็จ" -ForegroundColor Green
        }
    } catch {}
}

try {
    $prog = $HKCU.OpenSubKey("Software\Classes\.torrent\OpenWithProgids", $true)
    if ($prog) {
        $prog.DeleteValue("ZeluxDL.Torrent", $false)
        $prog.Close()
    }
} catch {}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host "  [✓] ถอนเมนูคลิกขวา Windows Explorer เรียบร้อยแล้ว!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host ""
