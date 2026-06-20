<div align="center">
  <img src="https://raw.githubusercontent.com/SMOKEx2/Zelux-DL/main/zelux-extension/icon128.png" width="128" height="128" alt="ZELUX-DL Logo">
  <h1>🚀 ZELUX-DL</h1>
  <p><b>Lightning-fast, beautiful, and interactive terminal video downloader.</b></p>
  
  [![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](#)
  [![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#)
  [![License](https://img.shields.io/badge/license-MIT-green.svg)](#)
</div>

---

**ZELUX-DL** คือโปรแกรมช่วยดาวน์โหลดวิดีโอ (Wrapper สำหรับ `yt-dlp`) ที่ออกแบบมาเพื่อความง่าย รวดเร็ว และสวยงาม ด้วยหน้าจอ Terminal แบบ Interactive ที่มาพร้อมกับระบบสีสันและแอนิเมชัน ไม่ต้องจำคำสั่งให้ยุ่งยากอีกต่อไป!

## ✨ ฟีเจอร์หลัก (Features)

- 🎨 **Beautiful UI** - หน้าจอ Terminal ที่ถูกออกแบบใหม่ทั้งหมด พร้อม Animation และสีสันที่สบายตา
- ⚡ **Lightning Fast** - ใช้ระบบ Multi-connection โหลดวิดีโอแรงเต็มสปีดเน็ต
- 🔄 **Auto Update** - ระบบอัปเดตตัวเองอัตโนมัติ (พิมพ์ `upgrade`) และอัปเดต core `yt-dlp` / `ffmpeg` อัตโนมัติ
- 📦 **Batch Download** - วางหลายๆ ลิงก์พร้อมกัน หรือโหลดจากไฟล์ `.txt` ได้เลย
- 🛠 **Zero Setup** - โหลดเสร็จเปิดใช้ได้เลย โปรแกรมจัดการดาวน์โหลดไฟล์ที่จำเป็น (`ffmpeg`, `yt-dlp`) ให้เองทั้งหมด

## 📥 วิธีติดตั้งและใช้งาน (Installation)

### สำหรับ Windows
1. ไปที่หน้า [Releases](../../releases/latest)
2. ดาวน์โหลดไฟล์ `ZELUX-DL.exe`
3. ดับเบิ้ลคลิกเปิดใช้งานได้ทันที (ไม่ต้องติดตั้ง)

### การโหลดวิดีโอ
- เปิดโปรแกรมขึ้นมาแล้ว **คลิกขวาเพื่อวางลิงก์ (Paste)** วิดีโอที่ต้องการ แล้วกด `Enter`
- โปรแกรมจะจัดการดาวน์โหลดด้วยคุณภาพสูงสุดให้ทันที

## 📖 คำสั่งที่รองรับ (Commands)

เมื่ออยู่ในหน้าหลัก สามารถพิมพ์คำสั่งต่อไปนี้:

| คำสั่ง | คีย์ลัด | คำอธิบาย |
| :--- | :--- | :--- |
| `<URL>` | - | วางลิงก์ที่ต้องการดาวน์โหลด |
| `list` | `ls`, `l` | ดูประวัติ/รายชื่อไฟล์ที่เคยดาวน์โหลดมาแล้ว |
| `open` | `o` | เปิดโฟลเดอร์ที่เก็บไฟล์ดาวน์โหลด |
| `clear` | `cls` | ล้างหน้าจอ Terminal |
| `update` | `u` | อัปเดต `yt-dlp` และ `ffmpeg` เป็นเวอร์ชันล่าสุด |
| `upgrade` | - | ตรวจสอบและอัปเดต ZELUX-DL เป็นเวอร์ชันล่าสุด |
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

# บิวด์เป็นไฟล์ .exe
npm run build
```

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.
