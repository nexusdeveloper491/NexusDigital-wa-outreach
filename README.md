# 💬 NexusDigital WhatsApp Outreach Engine

[![Node.js](https://img.shields.io/badge/Node.js-v18+-green.svg?style=flat&logo=node.js)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.x-black.svg?style=flat&logo=express)](https://expressjs.com)
[![Socket.io](https://img.shields.io/badge/Socket.io-4.x-black.svg?style=flat&logo=socket.io)](https://socket.io)
[![Engine](https://img.shields.io/badge/Engine-Baileys%20v6-blue.svg)](https://github.com/WhiskeySockets/Baileys)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An automated WhatsApp Web messaging and outreach system powered by the **WhiskeySockets Baileys** multi-device engine, Express REST API, and real-time Socket.io updates.

---

## ⚡ Key Features

- 📱 **QR Code Authentication:** Instant pairing via dynamic QR codes rendered directly on the web interface.
- 🔄 **Real-Time Status:** Live connection sync, disconnect recovery, and real-time delivery logs over WebSockets.
- 📨 **Automated Outreach:** Bulk dispatching, media attachment uploads (images, PDFs, documents) via Multer.
- 🔒 **Session Management:** Secure multi-session state and auth credential management in isolated storage.
- 🚀 **Fast & Lightweight:** Built on Node.js with asynchronous I/O and Pino logging.

---

## 🛠️ Tech Stack

- **Runtime & Framework:** Node.js, Express.js
- **WhatsApp Engine:** `@whiskeysockets/baileys`
- **Real-Time Communication:** `socket.io`
- **File Uploads:** `multer`
- **QR Generation:** `qrcode`
- **Logging:** `pino`

---

## 🚀 Getting Started

### 1. Clone the repository
```bash
git clone https://github.com/nexusdeveloper491/NexusDigital-wa-outreach.git
cd NexusDigital-wa-outreach
