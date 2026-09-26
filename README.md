<div align="center">
  <img src="https://raw.githubusercontent.com/SMOKEx2/Zelux-DL/main/zelux-extension/icon128.png" width="128" height="128" alt="ZELUX-DL Logo">
  <h1>🚀 ZELUX-DL</h1>
  <p><b>Lightning-fast, beautiful, and interactive terminal video downloader.</b></p>
  
  [![Version](https://img.shields.io/badge/version-1.6.9-blue.svg)](#)
  [![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#)
  [![License](https://img.shields.io/badge/license-MIT-green.svg)](#)
</div>

---

## ZELUX-DL 1.6: Terminal Edition

หน้าจอใหม่ดัดแปลงจากต้นแบบ `installer.ps1`: โลโก้ม่วง–ฟ้า เมนูลูกศร และสถานะงานจริงในหน้าจอเดียว ไม่มี Electron หรือข้อมูลตัวอย่าง

- ใช้ **↑ ↓ / Enter** เลือกเมนู หรือพิมพ์/วาง URL และคำสั่งได้ทันที
- เมนู Download, History, Settings, Open Downloads, Retry Failed, Upgrade และ Commands เชื่อมกับระบบเดิม
- หน้าดาวน์โหลดแสดงเปอร์เซ็นต์ ความเร็ว ขนาด และ log จริง รองรับหลายงานพร้อมกัน
- **Esc / Ctrl+C** ระหว่างดาวน์โหลดใช้ยกเลิกและรอการลบไฟล์ค้าง; หน้าผลลัพธ์แยกจำนวนสำเร็จ/ล้มเหลว/ยกเลิก
- Settings เลือกค่าแล้วแก้ไขได้; History และผลลัพธ์เลื่อนด้วย ↑ ↓ / Page Up / Page Down
- แนะนำเทอร์มินัล **90 × 32** ช่อง (ขั้นต่ำ 60 × 26); หน้าจอปรับตามขนาดโดยไม่เปลี่ยนฟอนต์ระบบหรือขอสิทธิ์ Admin
- เปิดโปรแกรมมีอนิเมชันโลโก้แบบ glitch สั้น ๆ, กดปุ่มใดก็ข้ามได้; `ZELUX-DL.exe --no-animation` หรือ `ZELUX_REDUCED_MOTION=1` จะเปิดเมนูทันที
- `ZELUX-DL.exe --plain` ใช้หน้าคำสั่งเดิม; การ pipe input ยังใช้โหมดเดิมอัตโนมัติ
- `ZELUX-DL.exe --version` ตรวจเวอร์ชันโดยไม่เข้าเมนู

เมื่อรันจากซอร์ส `upgrade` จะไม่เขียนทับ Node.js: ใช้ Git อัปเดตซอร์ส หรือรันคำสั่งนี้จาก EXE ที่แพ็กแล้ว

## ระบบดาวน์โหลด

เวอร์ชัน 1.1 เพิ่มระบบดาวน์โหลดต่อจากไฟล์ `.part`, ประวัติและ Retry, คิว Batch แบบพร้อมกัน,
หน้า Settings และการตรวจ SHA-256 ก่อนติดตั้งอัปเดต

คำสั่งใหม่:

| คำสั่ง | คำอธิบาย |
| :--- | :--- |
| `settings` | แสดงค่าปัจจุบันทั้งหมด |
| `set KEY VALUE` | เปลี่ยนค่า เช่น `set BATCH_CONCURRENCY 3` |
| `history` | แสดงประวัติล่าสุดพร้อม ID และสถานะ |
| `retry failed` | ลองดาวน์โหลดรายการที่ล้มเหลวทั้งหมดอีกครั้ง |
| `retry <ID>` | ลองดาวน์โหลดรายการตาม History ID |
| `library` | จัดประเภทไฟล์ แสดงที่มา และตรวจหาไฟล์ซ้ำด้วย SHA-256 |

การออก Release อัตโนมัติทำงานเมื่อ push tag รูปแบบ `v*` และจะสร้าง Windows EXE, Linux binary
และ `SHA256SUMS.txt` หากตั้งค่า GitHub Secrets `WINDOWS_CERTIFICATE_BASE64` กับ
`WINDOWS_CERTIFICATE_PASSWORD` ระบบจะเซ็น EXE ก่อนเผยแพร่ด้วย

**ZELUX-DL** คือโปรแกรมช่วยดาวน์โหลดวิดีโอ (Wrapper สำหรับ `yt-dlp`) ที่ออกแบบมาเพื่อความง่าย รวดเร็ว และสวยงาม ด้วยหน้าจอ Terminal แบบ Interactive ที่มาพร้อมกับระบบสีสันและแอนิเมชัน ไม่ต้องจำคำสั่งให้ยุ่งยากอีกต่อไป!

## ✨ ฟีเจอร์หลัก (Features)

- 🎨 **Beautiful UI** - หน้าจอ Terminal ที่ถูกออกแบบใหม่ทั้งหมด พร้อม Animation และสีสันที่สบายตา
- ⚡ **Lightning Fast** - ใช้ระบบ Multi-connection โหลดวิดีโอแรงเต็มสปีดเน็ต
- 🔄 **Auto Update** - ระบบอัปเดตตัวเองอัตโนมัติ (พิมพ์ `upgrade`) และอัปเดต core `yt-dlp` / `ffmpeg` อัตโนมัติ
- 📦 **Batch Download** - วางหลายลิงก์คั่นด้วยเว้นวรรค/ขึ้นบรรทัดใหม่ หรือโหลดจากไฟล์ `.txt` ได้ พร้อมตัดลิงก์ซ้ำอัตโนมัติ
- ☁️ **Multi-provider** - รองรับลิงก์แชร์สาธารณะจาก Google Drive/Docs, Dropbox, OneDrive, SharePoint, MediaFire, Pixeldrain, 1Filez, Vik1ngFile, Rootz, BuzzHeavier, DataNodes, FileMirage, FileKeeper, FileDitchFiles, Hugging Face, GitHub และลิงก์ไฟล์ตรง
- 🎬 **Media sites** - รองรับเว็บวิดีโอ/เสียงชื่อดังและเว็บอีกจำนวนมากที่ yt-dlp มีตัวดึงข้อมูล รวมถึง YouTube, Vimeo, TikTok, Facebook, Instagram, X/Twitter, Twitch และ Dailymotion; URL หน้าเว็บทั่วไปจะลองใช้ generic extractor เมื่อเซิร์ฟเวอร์ส่งหน้า HTML กลับมา
- 🐙 **GitHub Repository** - วางลิงก์ `https://github.com/owner/repo` เพื่อดาวน์โหลดและแตกไฟล์ทั้ง repo อัตโนมัติ
- 📊 **Honest Progress** - ไฟล์ที่ไม่แจ้งขนาดจะแสดง LIVE, bytes, speed และ elapsed time พร้อมจำนวน connections ที่ใช้จริง
- 🚀 **GitHub Ranged Download** - อ่าน Git tree แล้วแบ่งทั้งหลายไฟล์และไฟล์ใหญ่เป็น byte ranges สูงสุด 16 connections พร้อม `%` และ ETA; หาก API ใช้ไม่ได้จะ fallback เป็น ZIP
- 🗂️ **Smart Library** - พิมพ์ `library` เพื่อจัดกลุ่มไฟล์ตามประเภท จับคู่ URL ต้นทางจากประวัติ และตรวจไฟล์ซ้ำด้วย SHA-256 โดยไม่ย้ายหรือลบไฟล์อัตโนมัติ
- 🛠 **Zero Setup** - โหลดเสร็จเปิดใช้ได้เลย โปรแกรมจัดการดาวน์โหลดไฟล์ที่จำเป็น (`ffmpeg`, `yt-dlp`) ให้เองทั้งหมด

## 📥 วิธีติดตั้งและใช้งาน (Installation)

### 🪟 สำหรับ Windows
1. ไปที่หน้า [Releases](../../releases/latest)
2. ดาวน์โหลดไฟล์ `ZELUX-DL.exe`
3. ดับเบิ้ลคลิกเปิดใช้งานได้ทันที (ไม่ต้องติดตั้ง)

### 🐧 สำหรับ Linux
1. ไปที่หน้า [Releases](../../releases/latest)
2. ดาวน์โหลดไฟล์ `ZELUX-DL-linux`
3. เปิด Terminal แล้วรันคำสั่ง:
```bash
# ให้สิทธิ์รันโปรแกรม
chmod +x ZELUX-DL-linux

# เปิดใช้งาน
./ZELUX-DL-linux
```

#### ลงทะเบียน Custom Protocol (zelux://) สำหรับ Linux
หากต้องการใช้งานร่วมกับ Browser Extension ให้รัน:
```bash
chmod +x register-linux.sh
./register-linux.sh
```

### การโหลดวิดีโอ
- เปิดโปรแกรมขึ้นมาแล้ว **คลิกขวาเพื่อวางลิงก์ (Paste)** วิดีโอที่ต้องการ แล้วกด `Enter`
- โปรแกรมจะตรวจเว็บที่รองรับและลองดึงข้อมูลจากหน้าเว็บให้โดยอัตโนมัติ เว็บที่ต้องล็อกอินสามารถเลือกส่ง cookies จากเบราว์เซอร์ได้ (ใช้เฉพาะโปรไฟล์ของคุณและเก็บ cookies เป็นความลับ)
- เว็บที่ไม่รองรับ, ต้องผ่าน CAPTCHA, คลิปส่วนตัว หรือ DRM อาจโหลดไม่ได้; การรองรับขึ้นกับ yt-dlp และการเปลี่ยนแปลงของแต่ละเว็บ ไม่ได้รับประกันว่าทุกเว็บจะใช้งานได้

#### ใช้ cookies จากเบราว์เซอร์สำหรับเว็บที่ต้องล็อกอิน (ไม่บังคับ)
เลือก browser ที่ล็อกอินอยู่ เช่น Edge:
```text
set MEDIA_COOKIES_BROWSER edge
```
ใช้ `none` เพื่อปิด และกลับไปใช้ `cookies.txt` ถ้ามีไฟล์นั้น รองรับ `chrome`, `edge`, `firefox`, `brave`, `opera`, `safari`, `vivaldi`, `whale` และ `chromium` ทั้งนี้ควรปิด browser ก่อนเริ่มดาวน์โหลดหากไฟล์ cookies ถูกล็อก

## 📖 คำสั่งที่รองรับ (Commands)

เมื่ออยู่ในหน้าหลัก สามารถพิมพ์คำสั่งต่อไปนี้:

| คำสั่ง | คีย์ลัด | คำอธิบาย |
| :--- | :--- | :--- |
| `<URL>` | - | วางลิงก์ที่ต้องการดาวน์โหลด |
| `https://github.com/owner/repo` | - | ดาวน์โหลด default branch และแตกเป็นโฟลเดอร์ชื่อ repo |
| `list` | `ls`, `l` | ดูประวัติ/รายชื่อไฟล์ที่เคยดาวน์โหลดมาแล้ว |
| `open` | `o` | เปิดโฟลเดอร์ที่เก็บไฟล์ดาวน์โหลด |
| `clear` | `cls` | ล้างหน้าจอ Terminal |
| `update` | `u` | อัปเดต `yt-dlp` และ `ffmpeg` เป็นเวอร์ชันล่าสุด |
| `check-update` | - | ตรวจสอบเวอร์ชัน ZELUX-DL โดยไม่ติดตั้ง |
| `upgrade` | - | ตรวจสอบ ดาวน์โหลด และอัปเดต ZELUX-DL พร้อมตรวจ SHA256 |
| `help` | `h`, `?` | แสดงหน้าต่างช่วยเหลือ |
| `exit` | `q` | ออกจากโปรแกรม |

## ⚙️ การตั้งค่า (Configuration)

คุณสามารถปรับแต่งการทำงานได้ผ่านไฟล์ `config.json` ที่จะถูกสร้างขึ้นมาอัตโนมัติ:
```json
{
  "DOWNLOADS_DIR": "downloads",
  "NUM_CONNECTIONS": 16,
  "TIMEOUT_MS": 60000
}
```

## 💻 สำหรับนักพัฒนา (Build from source)

หากต้องการนำไปพัฒนาต่อ:

```bash
git clone https://github.com/SMOKEx2/Zelux-DL.git
cd Zelux-DL
npm install

# รันโปรแกรมแบบทดสอบ
npm start

# บิวด์เป็นไฟล์ .exe (Windows) และ binary (Linux)
npm run build

# หรือบิวด์แยกแพลตฟอร์ม
npx pkg zelux.js -t node18-win-x64 -o dist/ZELUX-DL.exe     # Windows
npx pkg zelux.js -t node18-linux-x64 -o dist/ZELUX-DL-linux  # Linux
```

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.
