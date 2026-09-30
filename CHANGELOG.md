# Changelog

## 1.8.11 - 2026-09-30

- เพิ่มการรอ route/ตัวแสดงภาพ Facebook หลายรอบ ป้องกันการอ่าน gallery ก่อนปุ่มถัดไปจะพร้อม
- อัปเดต Extension เป็น 2.5.8

## 1.8.10 - 2026-09-30

- แก้การไล่ภาพ Facebook แบบแกลเลอรีให้ทำทีละขั้นหลัง route เปลี่ยน ป้องกันสคริปต์ถูกยกเลิกกลางทาง
- อัปเดต Extension เป็น 2.5.7

## 1.8.9 - 2026-09-30

- แก้การดึงรูปจากโพสต์ Facebook แบบอัลบั้ม: เปิดตัวแสดงภาพจาก `+N` และไล่ภาพถัดไปจนครบทุกภาพ
- อัปเดต Extension เป็น 2.5.6

## 1.8.8 - 2026-09-30
- แก้แกลเลอรี Facebook ที่มีปุ่ม `+N` ให้เปิดชุดรูปเพิ่มเติมและอ่านรูป lazy-loaded/hidden ในโพสต์
- รวม URL รูปซ้ำตามไฟล์ต้นฉบับ เลือกขนาดใหญ่สุด และกรอง avatar จาก CDN เดียวกัน
- อัปเดต Extension เป็น 2.5.5

## 1.8.7 - 2026-09-30
- แก้การดาวน์โหลดรูปจากโพสต์ Facebook โดยให้ Extension อ่านเฉพาะรูปจริงที่แสดงอยู่ในกรอบโพสต์ ไม่กวาดรูป avatar/icon/รูปจากส่วนอื่นของหน้า
- ส่ง URL รูปที่ตรวจสอบแล้วผ่าน `zelux://` ให้แอปดาวน์โหลดครบชุด และใช้ตัวอ่านหน้าเดิมเป็น fallback เมื่อไม่มีรูปจาก Extension
- รองรับ session/cookies กับ CDN รูป Facebook และอัปเดต Extension เป็น 2.5.4

## 1.8.6 - 2026-09-30
- แก้ตัวตรวจสอบ EXE หลังอัปเดตบน Windows ให้ตรวจจาก FileVersion metadata โดยตรง ไม่เรียก EXE ระหว่างที่ helper ยังทำงานอยู่
- ป้องกันข้อผิดพลาด `node:internal/modules/cjs/loader` ทำให้ updater rollback กลับไปใช้รุ่นเดิม

## 1.8.5 - 2026-09-30
- เพิ่มเพดานอ่านหน้า Facebook Photo Post จาก 2 MB เป็น 16 MB เมื่อใช้ session/cookies เพื่อรองรับโพสต์ที่มีข้อมูลรูปหลายรายการ
- ป้องกันการจบงานก่อนเริ่มแยกรูปด้วยข้อความ `หน้าแชร์มีขนาดใหญ่เกินไป`

## 1.8.4 - 2026-09-30
- แก้ Windows updater ให้ helper แทนที่ EXE และตรวจสอบเวอร์ชันให้เสร็จก่อนรายงานว่าสำเร็จ
- เปลี่ยนพฤติกรรมหลังอัปเดตเป็นนับถอยหลัง 3 วินาทีแล้วปิดโปรแกรม โดยไม่เปิดหน้าต่างใหม่อัตโนมัติ ให้ผู้ใช้เปิดเองเพื่อหลีกเลี่ยงการกลับไปใช้ EXE รุ่นเดิม
- เพิ่มข้อความและ log ที่ระบุชัดว่าการอัปเดตเสร็จแล้วและต้องเปิดโปรแกรมใหม่เอง

## 1.8.3 - 2026-09-30
- แก้ตัวกรองรูป Facebook ไม่ให้ดาวน์โหลดไอคอน UI, GIF reaction และรูปโปรไฟล์ขนาดเล็กจากหน้าเว็บ
- รวม URL หลายขนาดของรูปเดียวกัน แล้วเลือกไฟล์ที่มีขนาดภาพสูงสุดเพียงไฟล์เดียว

## 1.8.2 - 2026-09-30
- เพิ่มการตรวจจับลิงก์โพสต์/อัลบั้มรูป Facebook และดาวน์โหลดรูปทั้งหมดในโพสต์เป็นชุดเดียว
- กรอง URL รูปซ้ำจากข้อมูล HTML/JSON ของ Facebook และเก็บไว้ใน `downloads/Images/Facebook - ...`
- ใช้ cookies จาก `cookies.txt` หรือ Facebook session จาก Extension เฉพาะตอนตรวจโพสต์และดาวน์โหลดรูป
- แยกโพสต์รูปออกจากตัวเลือก MP4/MP3 ของวิดีโอ เพื่อให้วางลิงก์แล้วเริ่มโหลดรูปได้ทันที

## 1.8.1 - 2026-09-27
- แก้ Windows updater ที่จบด้วย exit code 0 แต่ไม่ได้เริ่มสคริปต์ ทำให้ดาวน์โหลดไฟล์อัปเดตแล้วค้าง/ไม่เปลี่ยนเวอร์ชัน
- เพิ่ม PowerShell launcher ที่เปิด helper แบบซ่อนผ่าน `Start-Process` และรอ log ยืนยันก่อนปิดโปรแกรมเดิม
- เพิ่ม Windows integration test สำหรับการส่งต่องาน updater จริง รวมกรณีพาธที่มีช่องว่าง

## 1.8.0 - 2026-09-27
- รองรับดาวน์โหลดสื่อหลายลิงก์โดยเลือกชนิดไฟล์/คุณภาพครั้งเดียว พร้อมแยก progress ต่อรายการและทำงานพร้อมกันได้
- ดาวน์โหลดสื่อและภาพปกก่อน แล้วฝัง metadata/cover ด้วย FFmpeg จากไฟล์ในเครื่อง ไม่เรียกดาวน์โหลดซ้ำ; ลบภาพ sidecar หลังฝังสำเร็จและคงต้นฉบับไว้เมื่อผิดพลาด
- สร้าง `cookies.txt` รูปแบบ Netscape อัตโนมัติ ปรับพาธได้ใน Settings และใช้ cookies ที่ผู้ใช้ใส่เองโดยไม่ต้องพึ่ง Extension
- เพิ่ม YouTube session แบบ opt-in ผ่าน Extension และ localhost bridge แบบ one-time token; จำกัดโดเมนและลบไฟล์ cookies ชั่วคราวหลังจบงาน
- ปรับ Extension ให้ส่ง URL ที่วางเองโดยไม่ต้องสแกนหน้า และเพิ่มการตั้งค่าพาธ `ZELUX-DL.exe` พร้อมสถานะแจ้งเตือน
- เพิ่มการตรวจจับพาธไฟล์สื่อจริงจาก yt-dlp และรองรับ URL ที่คัดลอกจาก Markdown
- อัปเดต Extension เป็น 2.5.3

## 1.7.5 - 2026-09-26
- แก้ protocol handoff ระหว่าง EXE ที่ลงทะเบียนกับ EXE ที่ Extension เลือก ให้เปิดปลายทางเป็นหน้าต่าง console แยกซึ่งไม่ถูกปิดตามโปรเซสต้นทาง
- เขียนข้อผิดพลาดจากการเริ่มแอปลง `error.log` เพื่อให้ตรวจได้แม้หน้าต่างต้นทางปิดเร็ว

## Extension 2.5.1 - 2026-09-26
- ย้ายการขอสิทธิ์ Facebook ไปตอนเปิดตัวเลือก session เพื่อไม่ให้การขอสิทธิ์กลืนจังหวะคลิกเปิดแอปใน Brave
- เปิด `zelux://` จากคลิก Send โดยตรง แล้วแยกการส่ง session ไปยัง local bridge พร้อม token ใช้ครั้งเดียว
- แสดงความคืบหน้าระหว่างเปิดแอป/รอ bridge และแจ้งสาเหตุหาก bridge ไม่ตอบภายใน 30 วินาที
- จำกัดเวลาแต่ละครั้งที่ติดต่อ local bridge และคงการลบสิทธิ์กับข้อมูล session ชั่วคราวหลังจบงาน

## 1.7.4 - 2026-09-26
- แก้การส่งต่อจาก protocol ไปยัง EXE ที่ตั้งค่าไว้ให้รับคอนโซลเดิม เพื่อให้ Terminal UI แสดง แทนหน้าต่างดำว่าง

## 1.7.3 - 2026-09-26
- เพิ่มหน้าตั้งค่า Extension สำหรับเลือกพาธเต็มของ `ZELUX-DL.exe` และเก็บไว้ในเบราว์เซอร์เครื่องนี้
- ปิดการส่งลิงก์และการอ่าน cookies จนกว่าจะตั้งค่าพาธถูกต้อง; ยอมรับเฉพาะชื่อไฟล์ `ZELUX-DL.exe`
- ส่งพาธผ่าน `zelux://` ให้แอปตรวจ metadata ของ EXE และเปิดรุ่นที่เลือกก่อนเริ่มงาน
- ปรับ Extension เป็น 2.5.0 พร้อมข้อความตั้งค่าและสถานะที่ชัดเจน

## 1.7.2 - 2026-09-26
- รองรับคำขอ loopback จาก extension ที่ Brave ส่งมาโดยไม่มี `Origin` header โดยยังบังคับ one-time token ก่อนรับคุกกี้
- คงการปฏิเสธ Origin จากเว็บไซต์ทั่วไป และเพิ่ม regression test สำหรับ flow ที่ไม่มี Origin

## 1.7.1 - 2026-09-26
- รองรับ Origin ของ extension ใน Brave/Chromium forks ที่ใช้รูปแบบ host ID ต่างจาก Chrome มาตรฐาน โดยยังปฏิเสธเว็บทั่วไป
- เพิ่มรายละเอียดเวอร์ชันแอปและ Origin ที่ถูกปฏิเสธ เพื่อแยกกรณี EXE เก่ากับ extension ที่ไม่ได้รับอนุญาต
- แก้ข้อความ error ของ extension ให้ไม่อ้างเวอร์ชัน 2.4.0 แบบตายตัว

## 1.6.9 - 2026-09-26
- แก้ Windows self-updater ให้เรียก PowerShell จากพาธระบบแบบเต็มและรอ helper ยืนยันว่าเริ่มทำงานก่อนปิดโปรแกรมเดิม
- หาก helper เริ่มไม่สำเร็จ จะไม่ปิดโปรแกรมและจะแจ้ง error; เพิ่ม log ขั้นตอนสำหรับตรวจกรณีแทนไฟล์/เปิดเวอร์ชันใหม่ไม่สำเร็จ

## 1.6.8 - 2026-09-26
- ขยายการดาวน์โหลดวิดีโอไปยังเว็บที่ yt-dlp รองรับจำนวนมาก และลอง generic extractor กับลิงก์หน้าเว็บทั่วไป
- เพิ่มการใช้ cookies จากเบราว์เซอร์ที่เลือก สำหรับเนื้อหาที่บัญชีของผู้ใช้เข้าถึงได้
- ปรับจำนวน fragment connections และลำดับตัวเลือกรูปแบบให้เหมาะกับการดาวน์โหลดคลิป

## 1.6.7 - 2026-09-26
- ตรวจเวอร์ชันอัตโนมัติตอนเปิดโปรแกรม แจ้งเมื่อเป็นเวอร์ชันล่าสุดหรือมีเวอร์ชันใหม่
- แสดงตัวเลือกให้อัปเดตทันทีหรือข้ามไปก่อน โดยค่าเริ่มต้นไม่ติดตั้งเอง
- แก้ Windows updater ให้รอโปรเซสเดิมปิด ตรวจว่า EXE ใหม่ถูกติดตั้งจริงก่อนเปิด และ rollback พร้อม log เมื่อผิดพลาด
- หลังอัปเดตสำเร็จให้เปิดโปรแกรมเวอร์ชันใหม่อัตโนมัติ

## 1.6.6 - 2026-09-26
- ตรวจลิงก์ก่อนดาวน์โหลดและแยกข้อความแจ้งเมื่อถูกลบ/หมดอายุ, ต้องล็อกอิน, ถูกปฏิเสธสิทธิ์, ติด CAPTCHA หรือเซิร์ฟเวอร์ขัดข้อง
- ปฏิเสธหน้า HTML ที่ไม่ใช่ไฟล์ดาวน์โหลด แทนบันทึกหน้าเว็บเป็นไฟล์โดยไม่รู้ตัว
- ตรวจขนาดไฟล์หลังดาวน์โหลด และเทียบ SHA-256 กับ checksum จากเซิร์ฟเวอร์เมื่อมี metadata ที่รองรับ
- ยืนยันไฟล์ไม่ครบหรือ checksum ไม่ตรงว่าเป็นดาวน์โหลดล้มเหลว พร้อมลบไฟล์ที่ไม่สมบูรณ์

## 1.5.7 - 2026-09-26
- ยกเลิกดาวน์โหลดแล้วกวาดลบไฟล์ `.partN` ที่ตกค้างทั้งหมด แม้จำนวน chunk เกินค่าคอนเน็กชันปัจจุบัน
- แสดงผลเมื่อระบบลบไฟล์ค้างไม่สำเร็จ แทนการแจ้งว่าลบแล้วทั้งที่ยังเหลือ
- ปรับ resolver ให้ดึงลิงก์จากหน้าแชร์ที่เปิดเผยลิงก์จริง, รองรับ BuzzHeavier HTMX และไม่ใช้ลิงก์โฆษณาที่ซ่อนในคอมเมนต์
- แจ้งชัดเมื่อผู้ให้บริการต้องยืนยันตัวตนผ่านเบราว์เซอร์หรือไม่เปิดเผยลิงก์ดาวน์โหลด

## 1.5.6 - 2026-09-16
- ยกเลิกดาวน์โหลดแล้วลบไฟล์ `.part` และ chunk ที่ค้างโดยอัตโนมัติ
- แก้การ normalize ลิงก์ Vik1ngFile ไปยัง VikingFile

## 1.5.5 - 2026-09-16
- ปรับปรุงคำสั่ง `upgrade` ให้เปิดโปรแกรมเวอร์ชันใหม่อัตโนมัติหลังติดตั้งบน Windows

## 1.5.4 - 2026-09-16
- เพิ่มการรู้จำลิงก์ 1Filez, Vik1ngFile, Rootz, BuzzHeavier, DataNodes, FileMirage, FileKeeper และ FileDitchFiles

## 1.5.3 - 2026-09-01

- เพิ่มการตรวจสอบอัปเดต ZELUX-DL แบบไม่บล็อกตอนเปิดโปรแกรม
- เพิ่มคำสั่ง `check-update` สำหรับตรวจเวอร์ชันโดยไม่ติดตั้ง
- ปรับข้อความแนะนำการอัปเดตและการตรวจสอบ SHA256

## 1.5.2 - 2026-09-01

- Use an independently managed current yt-dlp binary so active legacy downloads cannot block core updates.
- Parse yt-dlp output line-by-line and update Playlist progress as soon as each item starts.
- Surface ignored per-item errors instead of showing a false 100% success state.
- Update the bundled runtime binary to yt-dlp 2026.08.19, fixing current YouTube media HTTP 403 failures.

## 1.5.1 - 2026-09-01

- Embed the ZELUX-DL logo as a multi-resolution Windows EXE icon.
- Set Windows Explorer product, description, filename, company, copyright, and version metadata during every build.

## 1.5.0 - 2026-09-01

- Resolve public share links from Google Drive/Docs, Dropbox, OneDrive, SharePoint, MediaFire, Pixeldrain, and Hugging Face.
- Show the detected provider before downloading and reject provider pages that do not expose a downloadable file.
- Keep all supported providers on the existing resume, retry, ranged-download, Batch, and history engine.
- Route Vimeo, TikTok, Facebook, Instagram, X/Twitter, Twitch, Dailymotion, SoundCloud, and Bandcamp through yt-dlp.

## 1.4.0 - 2026-09-01

- Accept multiple HTTP/HTTPS links pasted together and remove duplicates automatically.
- Add multi-line Batch input to extension 2.2 and launch the whole list in one ZELUX-DL process.
- Report exact succeeded, failed, and cancelled totals when a Batch finishes.

## 1.3.6 - 2026-08-16

- Fix GitHub links sent from the browser extension.
- Preserve query strings, fragments, and encoded characters in `zelux://` links.
- Auto-fill any HTTP or HTTPS page in extension 2.1, including GitHub repositories and release assets.
- Keep compatibility with links generated by older extension versions.
- Make Windows protocol registration follow the current project location.
- Split large GitHub files into byte ranges so one-file repositories can use all configured connections.

## 1.1.0 - 2026-07-26

- Resume interrupted HTTP downloads from `.part` files.
- Keep yt-dlp partial files so YouTube downloads can resume.
- Add persistent download history and retry commands.
- Add terminal settings view and validated `set KEY VALUE` command.
- Add configurable concurrent batch queue.
- Verify self-updates against release SHA-256 checksums.
- Add automated Windows/Linux builds, optional Windows signing, and GitHub Releases.
- Reduce production dependencies and add automated tests.
# 1.6.3

- Add a short, skippable glitch-gradient startup reveal to the terminal interface.
- Respect reduced-motion mode by opening directly to the menu.
# 1.6.4

- Move the configured download destination directly below the home menu frame.
- Keep menu spacing readable at the minimum supported terminal height.
# 1.6.5

- Add semantic color highlighting to command names in the help screen.
- Keep command descriptions aligned and readable in narrow terminals.
