Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile('e:\ProjectCode\ZELUX-DL\zelux-extension\icon.png')

$sizes = @(16, 32, 48, 128)

foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $graph = [System.Drawing.Graphics]::FromImage($bmp)
    $graph.DrawImage($img, 0, 0, $size, $size)
    $bmp.Save("e:\ProjectCode\ZELUX-DL\zelux-extension\icon$size.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $graph.Dispose()
    $bmp.Dispose()
}

$img.Dispose()
