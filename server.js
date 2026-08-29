const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const qrcode = require('qrcode');
const pino = require('pino');
require('dotenv').config();

const {
  default: makeWASocket,
  Browsers,
  useMultiFileAuthState,
  DisconnectReason,
  delay,
  downloadMediaMessage,
  extractMessageContent,
  proto
} = require('@whiskeysockets/baileys');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'nexus_digital_wa_outreach_sec_98f41b8a7c29e10d6541f6e2c3a5e89d1b74';
const AUTH_FOLDER = path.join(__dirname, 'auth_info_baileys');
const UPLOADS_FOLDER = path.join(__dirname, 'public', 'uploads');
const STORE_FOLDER = path.join(__dirname, 'store_data');
const STORE_MESSAGES_FOLDER = path.join(STORE_FOLDER, 'messages');

// Ensure local folders exist
[UPLOADS_FOLDER, STORE_FOLDER, STORE_MESSAGES_FOLDER].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const ALLOWED_UPLOAD_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif',
  '.mp4', '.3gp', '.mov',
  '.mp3', '.ogg', '.wav', '.m4a', '.aac',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt'
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_FOLDER),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '_' + Math.round(Math.random() * 1e9);
    const rawExt = path.extname(file.originalname).toLowerCase();
    const ext = ALLOWED_UPLOAD_EXTS.has(rawExt) ? rawExt : '.bin';
    cb(null, 'file_' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024 // 25 MB max limit
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_UPLOAD_EXTS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed. Supported formats: images, videos, audio, PDF, Word, Excel, CSV, text.'));
    }
  }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Global WhatsApp Connection State
let waSock = null;
let qrCodeDataUrl = null;
let pairingCode = null;
let waConnectionStatus = 'disconnected';
let waUserInfo = null;
let isExplicitLogout = false;
let isInitializing = false;

// Persistent In-Memory Stores
const chatsStore = new Map();         // jid -> chatObj
const messagesStore = new Map();      // jid -> Array<msgObj>
const contactDetailsMap = new Map();  // jid/lid -> { name, phone, lid, jid }
const lidToJidMap = new Map();        // lid -> phoneJid
const jidToLidMap = new Map();        // phoneJid -> lid
const rawMessagesMap = new Map();     // key.id -> proto.IMessage (for Baileys retries)

function saveRawMessage(id, message) {
  if (!id || !message) return;
  rawMessagesMap.set(id, message);
  if (rawMessagesMap.size > 5000) {
    const oldestKey = rawMessagesMap.keys().next().value;
    rawMessagesMap.delete(oldestKey);
  }
}

const STORE_CHATS_FILE = path.join(STORE_FOLDER, 'chats.json');
const USERS_FILE = path.join(STORE_FOLDER, 'users.json');

function getUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch (e) {
    console.error('Error reading users.json:', e);
  }
  const defaultAdmin = [{
    id: 'admin',
    username: 'admin',
    phone: 'admin',
    name: 'Nexus Admin',
    password: '280208',
    role: 'admin',
    createdAt: Date.now()
  }];
  saveUsers(defaultAdmin);
  return defaultAdmin;
}

function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Error saving users.json:', e);
    return false;
  }
}

function findUserByLogin(loginId) {
  const clean = String(loginId || '').trim().toLowerCase();
  const rawNum = String(loginId || '').replace(/\D/g, '');
  const users = getUsers();
  return users.find(u => 
    (u.username && u.username.toLowerCase() === clean) ||
    (u.phone && (u.phone.toLowerCase() === clean || (rawNum && u.phone.replace(/\D/g, '') === rawNum))) ||
    (u.id && u.id.toLowerCase() === clean)
  );
}

function generateAuthToken(user) {
  if (!user) return null;
  const payload = {
    userId: user.id,
    loginId: user.phone || user.username || user.id,
    role: user.role,
    name: user.name,
    exp: Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 days validity
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;
  try {
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(payloadB64).digest('base64url');
    if (signature.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) {
      return null;
    }
    const user = findUserByLogin(payload.loginId || payload.userId);
    if (user && user.active !== false) {
      return user;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// In-Memory Rate Limiter Map (Key -> { count, lastAttempt, lockUntil })
const failedAttemptsMap = new Map();

function checkRateLimit(key, maxAttempts = 5, lockDurationMs = 10 * 60 * 1000) {
  const now = Date.now();
  const record = failedAttemptsMap.get(key) || { count: 0, lastAttempt: now, lockUntil: 0 };
  if (record.lockUntil && now < record.lockUntil) {
    const remainingSecs = Math.ceil((record.lockUntil - now) / 1000);
    return { allowed: false, remainingSecs };
  }
  if (record.lockUntil && now >= record.lockUntil) {
    record.count = 0;
    record.lockUntil = 0;
  }
  return { allowed: true };
}

function recordFailedAttempt(key, maxAttempts = 5, lockDurationMs = 10 * 60 * 1000) {
  const now = Date.now();
  const record = failedAttemptsMap.get(key) || { count: 0, lastAttempt: now, lockUntil: 0 };
  record.count += 1;
  record.lastAttempt = now;
  if (record.count >= maxAttempts) {
    record.lockUntil = now + lockDurationMs;
  }
  failedAttemptsMap.set(key, record);
}

function clearRateLimit(key) {
  failedAttemptsMap.delete(key);
}

function authMiddleware(req, res, next) {
  const token = req.headers['x-auth-token'] || req.query.token;
  if (!token) {
    req.user = null;
    return next();
  }
  req.user = verifyAuthToken(token);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required. Please log in.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required.' });
  }
  next();
}

function getSafeFilename(jid) {
  return encodeURIComponent(jid).replace(/%/g, '_') + '.json';
}

// --- LOCAL DATA PERSISTENCE ENGINE ---
function loadAllDataFromDisk() {
  try {
    getUsers(); // Ensure users exist
    const contactsFile = path.join(STORE_FOLDER, 'contacts.json');
    if (fs.existsSync(contactsFile)) {
      const data = JSON.parse(fs.readFileSync(contactsFile, 'utf8'));
      if (data.contacts) {
        Object.entries(data.contacts).forEach(([k, v]) => contactDetailsMap.set(k, v));
      }
      if (data.lidToJid) {
        Object.entries(data.lidToJid).forEach(([k, v]) => lidToJidMap.set(k, v));
      }
      if (data.jidToLid) {
        Object.entries(data.jidToLid).forEach(([k, v]) => jidToLidMap.set(k, v));
      }
    }

    if (fs.existsSync(STORE_CHATS_FILE)) {
      const raw = fs.readFileSync(STORE_CHATS_FILE, 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        list.forEach(c => {
          if (c && c.jid) {
            const canonicalJid = resolveCanonicalJid(c.jid);
            const rawPhone = getPhoneForJid(canonicalJid);
            const displayPhone = formatPhoneDisplay(rawPhone);

            // Always record in contacts directory
            processContactMetadata({
              id: canonicalJid,
              jid: canonicalJid,
              phone: rawPhone,
              name: displayPhone
            });

            // Only populate in chatsStore if it has a real message or unread count
            if ((c.lastMessage && c.lastMessage.trim() !== '') || (c.unreadCount && c.unreadCount > 0)) {
              c.jid = canonicalJid;
              c.name = displayPhone;
              c.phone = rawPhone;
              if (!c.ownerId) {
                c.ownerId = 'admin';
                c.ownerName = 'Nexus Admin';
              }
              chatsStore.set(canonicalJid, c);
            }
          }
        });
      }
    }

    if (fs.existsSync(STORE_MESSAGES_FOLDER)) {
      const files = fs.readdirSync(STORE_MESSAGES_FOLDER);
      files.forEach(f => {
        if (f.endsWith('.json')) {
          try {
            const raw = fs.readFileSync(path.join(STORE_MESSAGES_FOLDER, f), 'utf8');
            const thread = JSON.parse(raw);
            if (Array.isArray(thread) && thread.length > 0) {
              const fileJid = thread[0].jid || decodeURIComponent(f.replace(/\.json$/, '').replace(/_/g, '%'));
              const canonicalJid = resolveCanonicalJid(fileJid);
              if (canonicalJid) {
                thread.forEach(m => { m.jid = canonicalJid; });
                messagesStore.set(canonicalJid, thread);
                if (!chatsStore.has(canonicalJid)) {
                  const last = thread[thread.length - 1];
                  const rawPhone = getPhoneForJid(canonicalJid);
                  chatsStore.set(canonicalJid, {
                    jid: canonicalJid,
                    name: formatPhoneDisplay(rawPhone),
                    phone: rawPhone,
                    unreadCount: 0,
                    lastMessage: last.text || (last.mediaUrl ? `[${(last.mediaType || 'Media').toUpperCase()}]` : 'Message'),
                    timestamp: last.timestamp || Date.now(),
                    ownerId: 'admin',
                    ownerName: 'Nexus Admin'
                  });
                }
              }
            }
          } catch (e) {}
        }
      });
    }

    saveChatsToDisk();
    console.log(`📦 Loaded ${chatsStore.size} persistent chats and message history from store_data/.`);
  } catch (err) {
    console.error('Error loading data from disk:', err);
  }
}

function validateChatOwnership(chat) {
  if (!chat) return;
  if (!chat.ownerId || chat.ownerId === 'admin') {
    chat.ownerId = 'admin';
    chat.ownerName = 'Nexus Admin';
    return;
  }
  const users = getUsers();
  const ownerUser = users.find(u => 
    u.phone === chat.ownerId || 
    u.id === chat.ownerId || 
    u.username === chat.ownerId ||
    (u.phone && String(u.phone).replace(/\D/g, '') === String(chat.ownerId).replace(/\D/g, ''))
  );
  if (!ownerUser) {
    chat.ownerId = 'admin';
    chat.ownerName = 'Nexus Admin';
  } else {
    chat.ownerName = ownerUser.name || chat.ownerName;
  }
}

function findExistingChat(targetIdentifier) {
  if (!targetIdentifier) return null;
  const canonicalJid = resolveCanonicalJid(targetIdentifier);
  let found = chatsStore.get(canonicalJid) || chatsStore.get(targetIdentifier);

  if (!found) {
    const cleanNum = String(targetIdentifier).replace(/\D/g, '');
    const last10 = cleanNum.length >= 10 ? cleanNum.slice(-10) : cleanNum;

    if (last10 && last10.length >= 8) {
      for (const [jid, chat] of chatsStore.entries()) {
        const cPhone = String(chat.phone || jid).replace(/\D/g, '');
        if (cPhone.endsWith(last10) || cPhone === cleanNum) {
          found = chat;
          break;
        }
      }
    }
  }

  if (found) {
    validateChatOwnership(found);
  }
  return found;
}

loadAllDataFromDisk();

function saveChatsToDisk() {
  try {
    const arr = Array.from(chatsStore.values()).filter(c => {
      return (c.lastMessage && c.lastMessage.trim() !== '') || (c.unreadCount && c.unreadCount > 0);
    });
    fs.writeFileSync(STORE_CHATS_FILE, JSON.stringify(arr, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving chats to disk:', e);
  }
}

function saveContactsToDisk() {
  try {
    const data = {
      contacts: Object.fromEntries(contactDetailsMap),
      lidToJid: Object.fromEntries(lidToJidMap),
      jidToLid: Object.fromEntries(jidToLidMap)
    };
    fs.writeFileSync(path.join(STORE_FOLDER, 'contacts.json'), JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving contacts to disk:', e);
  }
}

function saveMessageThreadToDisk(jid) {
  try {
    const thread = messagesStore.get(jid) || [];
    const filePath = path.join(STORE_MESSAGES_FOLDER, getSafeFilename(jid));
    if (thread.length === 0) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } else {
      fs.writeFileSync(filePath, JSON.stringify(thread, null, 2), 'utf8');
    }
  } catch (e) {
    console.error(`Error saving message thread for ${jid}:`, e);
  }
}

function clearSessionFolderSync() {
  try {
    if (fs.existsSync(AUTH_FOLDER)) {
      fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
      console.log('🧹 Session directory cleared successfully.');
    }
  } catch (err) {
    console.error('Error clearing session folder:', err.message);
  }
}

// Helper to get raw phone digits or identifier from JID
function getPhoneForJid(jid) {
  if (!jid) return '';
  const canonicalJid = resolveCanonicalJid(jid);
  let raw = canonicalJid.split('@')[0];
  if (raw.includes(':')) raw = raw.split(':')[0];
  return raw;
}

function formatPhoneDisplay(rawPhone) {
  if (!rawPhone) return 'Contact';
  let clean = String(rawPhone).replace(/\D/g, '');
  if (clean.length === 12 && clean.startsWith('91')) {
    return `+91 ${clean.substring(2, 7)} ${clean.substring(7)}`;
  }
  if (clean.length === 10) {
    return `+91 ${clean.substring(0, 5)} ${clean.substring(5)}`;
  }
  if (clean.length >= 7 && clean.length <= 13) {
    return `+${clean}`;
  }
  return clean ? `+${clean}` : 'Contact';
}

function normalizeJid(jid) {
  if (!jid) return '';
  let clean = String(jid).trim();
  if (clean.includes(':')) {
    const parts = clean.split('@');
    clean = parts[0].split(':')[0] + '@' + parts[1];
  }
  return clean;
}

function resolveCanonicalJid(jid) {
  if (!jid) return '';
  let clean = normalizeJid(jid);

  if (clean.endsWith('@lid')) {
    if (lidToJidMap.has(clean)) {
      return lidToJidMap.get(clean);
    }
    for (const [phoneJid, lid] of jidToLidMap.entries()) {
      if (lid === clean) return phoneJid;
    }
    for (const [contactJid, info] of contactDetailsMap.entries()) {
      if (info.lid === clean && !contactJid.endsWith('@lid')) {
        return contactJid;
      }
    }
  }
  return clean;
}

function linkLidAndPhoneJid(lid, phoneJid) {
  if (!lid || !phoneJid) return;
  const cLid = normalizeJid(lid);
  const cPhone = normalizeJid(phoneJid);
  if (!cLid.endsWith('@lid') || cPhone.endsWith('@lid')) return;

  lidToJidMap.set(cLid, cPhone);
  jidToLidMap.set(cPhone, cLid);

  // Merge message history if LID had messages
  const lidThread = messagesStore.get(cLid) || [];
  const phoneThread = messagesStore.get(cPhone) || [];

  if (lidThread.length > 0) {
    const combined = [...phoneThread];
    for (const m of lidThread) {
      m.jid = cPhone;
      if (!combined.some(existing => existing.id === m.id)) {
        combined.push(m);
      }
    }
    combined.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    messagesStore.set(cPhone, combined);
    saveMessageThreadToDisk(cPhone);

    const oldPath = path.join(STORE_MESSAGES_FOLDER, getSafeFilename(cLid));
    if (fs.existsSync(oldPath)) {
      try { fs.unlinkSync(oldPath); } catch (e) {}
    }
    messagesStore.delete(cLid);
  }

  // Update chatsStore under canonical phone JID
  const lidChat = chatsStore.get(cLid);
  const phoneChat = chatsStore.get(cPhone);
  const rawPhone = getPhoneForJid(cPhone);
  const displayPhone = formatPhoneDisplay(rawPhone);

  const updatedChat = {
    jid: cPhone,
    name: displayPhone,
    phone: rawPhone,
    unreadCount: (phoneChat?.unreadCount || 0) + (lidChat?.unreadCount || 0),
    lastMessage: phoneChat?.lastMessage || lidChat?.lastMessage || '',
    timestamp: Math.max(phoneChat?.timestamp || 0, lidChat?.timestamp || 0, Date.now())
  };

  chatsStore.delete(cLid);
  chatsStore.set(cPhone, updatedChat);

  saveContactsToDisk();
  saveChatsToDisk();
}

function processContactMetadata(c) {
  if (!c || !c.id) return;
  const id = normalizeJid(c.id);
  const lid = c.lid ? normalizeJid(c.lid) : (id.endsWith('@lid') ? id : null);
  const pnJid = c.pnJid ? normalizeJid(c.pnJid) : (c.jid ? normalizeJid(c.jid) : (!id.endsWith('@lid') ? id : null));

  if (lid && pnJid && lid !== pnJid) {
    linkLidAndPhoneJid(lid, pnJid);
  }

  let rawPhone = getPhoneForJid(pnJid || id);

  const prev = contactDetailsMap.get(id) || {};
  contactDetailsMap.set(id, {
    id,
    lid: lid || prev.lid,
    phone: rawPhone,
    name: formatPhoneDisplay(rawPhone)
  });

  if (lid) {
    contactDetailsMap.set(lid, {
      id: lid,
      jid: pnJid || id,
      phone: rawPhone,
      name: formatPhoneDisplay(rawPhone)
    });
  }

  saveContactsToDisk();
}

// --- SCOPED REAL-TIME BROADCAST ENGINE ---
function broadcastChatList() {
  io.to('admin_room').emit('chat:list', getFilteredChatsList({ role: 'admin' }));
  const users = getUsers().filter(u => u.role !== 'admin');
  users.forEach(u => {
    const userChats = getFilteredChatsList(u);
    const uPhone = String(u.phone || '').replace(/\D/g, '');
    const uUser = String(u.username || '').toLowerCase();
    const uId = String(u.id || '');
    if (uPhone) io.to(`user_${uPhone}`).emit('chat:list', userChats);
    if (uUser && uUser !== uPhone) io.to(`user_${uUser}`).emit('chat:list', userChats);
    if (uId && uId !== uPhone && uId !== uUser) io.to(`user_${uId}`).emit('chat:list', userChats);
  });
}

function broadcastNewMessage(canonicalJid, rawJid, chat, msgObj) {
  const payload = { jid: canonicalJid, rawJid, chat, message: msgObj, ownerId: chat.ownerId };
  io.to('admin_room').emit('chat:new_message', payload);
  if (chat.ownerId && chat.ownerId !== 'admin') {
    const oPhone = String(chat.ownerId).replace(/\D/g, '');
    const oUser = String(chat.ownerId).toLowerCase();
    const oId = String(chat.ownerId);
    if (oPhone) io.to(`user_${oPhone}`).emit('chat:new_message', payload);
    if (oUser && oUser !== oPhone) io.to(`user_${oUser}`).emit('chat:new_message', payload);
    if (oId && oId !== oPhone && oId !== uUser) io.to(`user_${oId}`).emit('chat:new_message', payload);
  }
  broadcastChatList();
}

function broadcastMessageUpdate(canonicalJid, messageId, status, ownerId = null) {
  const payload = { jid: canonicalJid, messageId, status };
  io.to('admin_room').emit('chat:message_update', payload);
  if (ownerId && ownerId !== 'admin') {
    const oPhone = String(ownerId).replace(/\D/g, '');
    const oUser = String(ownerId).toLowerCase();
    const oId = String(ownerId);
    if (oPhone) io.to(`user_${oPhone}`).emit('chat:message_update', payload);
    if (oUser && oUser !== oPhone) io.to(`user_${oUser}`).emit('chat:message_update', payload);
    if (oId && oId !== oPhone && oId !== oUser) io.to(`user_${oId}`).emit('chat:message_update', payload);
  }
}

function broadcastMessageDeleted(canonicalJid, messageId, ownerId = null) {
  const payload = { jid: canonicalJid, messageId };
  io.to('admin_room').emit('chat:message_deleted', payload);
  if (ownerId && ownerId !== 'admin') {
    const oPhone = String(ownerId).replace(/\D/g, '');
    const oUser = String(ownerId).toLowerCase();
    const oId = String(ownerId);
    if (oPhone) io.to(`user_${oPhone}`).emit('chat:message_deleted', payload);
    if (oUser && oUser !== oPhone) io.to(`user_${oUser}`).emit('chat:message_deleted', payload);
    if (oId && oId !== oPhone && oId !== oUser) io.to(`user_${oId}`).emit('chat:message_deleted', payload);
  }
  broadcastChatList();
}

function broadcastChatDeleted(canonicalJid, ownerId = null) {
  const payload = { jid: canonicalJid };
  io.to('admin_room').emit('chat:deleted', payload);
  if (ownerId && ownerId !== 'admin') {
    const oPhone = String(ownerId).replace(/\D/g, '');
    const oUser = String(ownerId).toLowerCase();
    const oId = String(ownerId);
    if (oPhone) io.to(`user_${oPhone}`).emit('chat:deleted', payload);
    if (oUser && oUser !== oPhone) io.to(`user_${oUser}`).emit('chat:deleted', payload);
    if (oId && oId !== oPhone && oId !== oUser) io.to(`user_${oId}`).emit('chat:deleted', payload);
  }
  broadcastChatList();
}

function upsertChatMessage(rawJid, msgObj, shouldBroadcast = true, senderUser = null) {
  if (!rawJid || !msgObj || !msgObj.id) return;

  const canonicalJid = resolveCanonicalJid(rawJid);
  msgObj.jid = canonicalJid;

  if (!messagesStore.has(canonicalJid)) {
    messagesStore.set(canonicalJid, []);
  }
  const thread = messagesStore.get(canonicalJid);

  const existingIdx = thread.findIndex(m => m.id === msgObj.id);
  if (existingIdx !== -1) {
    thread[existingIdx] = { ...thread[existingIdx], ...msgObj };
  } else {
    thread.push(msgObj);
  }

  thread.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  if (thread.length > 500) thread.shift();

  saveMessageThreadToDisk(canonicalJid);

  let rawPhone = getPhoneForJid(canonicalJid);
  let displayPhone = formatPhoneDisplay(rawPhone);

  const existingChat = chatsStore.get(canonicalJid) || {
    jid: canonicalJid,
    name: displayPhone,
    phone: rawPhone,
    unreadCount: 0,
    lastMessage: '',
    timestamp: Date.now()
  };

  // If no owner assigned yet and sender is an employee/admin
  if (!existingChat.ownerId && senderUser) {
    existingChat.ownerId = senderUser.phone || senderUser.username || senderUser.id;
    existingChat.ownerName = senderUser.name;
  }

  existingChat.name = displayPhone;
  existingChat.phone = rawPhone;
  existingChat.lastMessage = msgObj.text || (msgObj.mediaUrl ? `[${(msgObj.mediaType || 'Media').toUpperCase()}]` : 'Message');
  existingChat.timestamp = msgObj.timestamp || Date.now();
  if (!msgObj.fromMe && msgObj.status !== 'read') {
    existingChat.unreadCount = (existingChat.unreadCount || 0) + 1;
  }

  chatsStore.set(canonicalJid, existingChat);
  saveChatsToDisk();

  if (shouldBroadcast) {
    broadcastNewMessage(canonicalJid, rawJid, existingChat, msgObj);
  }
}

function deleteChatMessageByKey(key) {
  if (!key || !key.remoteJid || !key.id) return;
  const canonicalJid = resolveCanonicalJid(key.remoteJid);
  const thread = messagesStore.get(canonicalJid);

  if (thread) {
    const idx = thread.findIndex(m => m.id === key.id);
    if (idx !== -1) {
      console.log(`🗑️ Deleting message ${key.id} from chat ${canonicalJid}`);
      thread.splice(idx, 1);
      saveMessageThreadToDisk(canonicalJid);

      const chat = chatsStore.get(canonicalJid);
      if (chat) {
        if (thread.length > 0) {
          const last = thread[thread.length - 1];
          chat.lastMessage = last.text || (last.mediaUrl ? `[${(last.mediaType || 'Media').toUpperCase()}]` : 'Message');
          chat.timestamp = last.timestamp;
        } else {
          chat.lastMessage = '';
        }
        chatsStore.set(canonicalJid, chat);
        saveChatsToDisk();
      }

      broadcastMessageDeleted(canonicalJid, key.id, chat?.ownerId);
    }
  }
}

function deleteChatByJid(targetJid) {
  if (!targetJid) return;
  const canonicalJid = resolveCanonicalJid(targetJid);
  const chat = chatsStore.get(canonicalJid);

  chatsStore.delete(canonicalJid);
  messagesStore.delete(canonicalJid);

  const filePath = path.join(STORE_MESSAGES_FOLDER, getSafeFilename(canonicalJid));
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (e) {}
  }

  saveChatsToDisk();
  broadcastChatDeleted(canonicalJid, chat?.ownerId);
}

const SETTINGS_FILE = path.join(STORE_FOLDER, 'settings.json');

function getContactsPassword() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      if (data.contactsPassword) return String(data.contactsPassword);
    }
  } catch (e) {}
  return process.env.CONTACTS_PASSWORD || '1234';
}

function setContactsPassword(newPass) {
  try {
    let settings = {};
    if (fs.existsSync(SETTINGS_FILE)) {
      settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) || {};
    }
    settings.contactsPassword = String(newPass);
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Error saving settings:', e);
    return false;
  }
}

function getFilteredChatsList(user = null) {
  // Only return chats that have actual messages or unread count (Active Conversations)
  const allActive = Array.from(chatsStore.values())
    .filter(c => {
      if (!c || !c.jid || c.jid.includes('broadcast') || c.jid.endsWith('@newsletter') || c.jid.endsWith('@g.us')) {
        return false;
      }
      validateChatOwnership(c);
      const hasMessage = (c.lastMessage && c.lastMessage.trim() !== '') || (c.unreadCount && c.unreadCount > 0);
      const thread = messagesStore.get(c.jid);
      const hasThread = Array.isArray(thread) && thread.length > 0;
      return hasMessage || hasThread;
    })
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  if (!user || user.role === 'admin') {
    return allActive;
  }

  // Employee filter: only own chats
  const uPhone = String(user.phone || '').replace(/\D/g, '');
  const uUser = String(user.username || '').toLowerCase();
  const uId = String(user.id || '');

  return allActive.filter(c => {
    if (!c.ownerId || c.ownerId === 'admin') return false;
    const oPhone = String(c.ownerId).replace(/\D/g, '');
    return c.ownerId === uPhone || c.ownerId.toLowerCase() === uUser || c.ownerId === uId || (oPhone && oPhone === uPhone);
  });
}

function getContactsList() {
  const map = new Map();

  // Add all from chatsStore
  chatsStore.forEach((c, jid) => {
    if (!jid.includes('broadcast') && !jid.endsWith('@newsletter') && !jid.endsWith('@g.us')) {
      const rawPhone = getPhoneForJid(jid);
      const displayPhone = formatPhoneDisplay(rawPhone);
      map.set(rawPhone, {
        jid: resolveCanonicalJid(jid),
        phone: rawPhone,
        displayPhone: displayPhone,
        hasChat: (c.lastMessage && c.lastMessage.trim() !== '') || (messagesStore.get(jid)?.length > 0),
        lastMessage: c.lastMessage || '',
        timestamp: c.timestamp || 0
      });
    }
  });

  // Add all from contactDetailsMap
  contactDetailsMap.forEach((info, jid) => {
    if (!jid.includes('broadcast') && !jid.endsWith('@newsletter') && !jid.endsWith('@g.us')) {
      const canonicalJid = resolveCanonicalJid(jid);
      const rawPhone = getPhoneForJid(canonicalJid);
      if (!map.has(rawPhone)) {
        const displayPhone = formatPhoneDisplay(rawPhone);
        map.set(rawPhone, {
          jid: canonicalJid,
          phone: rawPhone,
          displayPhone: displayPhone,
          hasChat: false,
          lastMessage: '',
          timestamp: 0
        });
      }
    }
  });

  return Array.from(map.values()).sort((a, b) => a.phone.localeCompare(b.phone));
}

// Baileys Socket Initialization
async function initWhatsApp(requestedPhone = null) {
  if (isInitializing) return;
  isInitializing = true;

  if (waSock) {
    try {
      waSock.ev.removeAllListeners();
      waSock.end();
    } catch (e) {}
    waSock = null;
  }

  waConnectionStatus = 'connecting';
  qrCodeDataUrl = null;
  pairingCode = null;

  io.emit('whatsapp:status', {
    status: waConnectionStatus,
    qr: null,
    pairingCode: null,
    user: null
  });

  if (!fs.existsSync(AUTH_FOLDER)) {
    fs.mkdirSync(AUTH_FOLDER, { recursive: true });
  }

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

    waSock = makeWASocket({
      auth: state,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: true,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      getMessage: async (key) => {
        if (key && key.id && rawMessagesMap.has(key.id)) {
          return rawMessagesMap.get(key.id);
        }
        return undefined;
      }
    });

    waSock.ev.on('creds.update', saveCreds);

    const handleContacts = (contacts) => {
      if (!Array.isArray(contacts)) return;
      contacts.forEach(c => {
        if (!c || !c.id) return;
        processContactMetadata(c);
      });
      broadcastChatList();
    };

    waSock.ev.on('contacts.set', ({ contacts }) => handleContacts(contacts));
    waSock.ev.on('contacts.upsert', (contacts) => handleContacts(contacts));
    waSock.ev.on('contacts.update', (contacts) => handleContacts(contacts));

    waSock.ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
      if (lid && jid) {
        linkLidAndPhoneJid(lid, jid);
        broadcastChatList();
      }
    });

    const handleChats = (chats) => {
      if (!Array.isArray(chats)) return;
      chats.forEach(c => {
        if (!c || !c.id) return;
        const jid = normalizeJid(c.id);
        if (jid.includes('broadcast') || jid.endsWith('@newsletter') || jid.endsWith('@g.us')) return;

        const pnJid = c.pnJid ? normalizeJid(c.pnJid) : (jid.endsWith('@s.whatsapp.net') ? jid : null);
        const lidJid = c.lidJid ? normalizeJid(c.lidJid) : (jid.endsWith('@lid') ? jid : null);

        if (pnJid && lidJid) {
          linkLidAndPhoneJid(lidJid, pnJid);
        }

        const canonicalJid = resolveCanonicalJid(jid);
        let rawPhone = getPhoneForJid(canonicalJid);
        let displayPhone = formatPhoneDisplay(rawPhone);

        // Always store in contacts directory
        processContactMetadata({
          id: canonicalJid,
          jid: canonicalJid,
          lid: lidJid,
          phone: rawPhone,
          name: displayPhone
        });

        // Only add to chatsStore if it has actual messages or unread count
        const hasMessages = (c.lastMessage && c.lastMessage.trim() !== '') || (c.unreadCount && c.unreadCount > 0) || (messagesStore.get(canonicalJid)?.length > 0);

        if (hasMessages) {
          const existing = chatsStore.get(canonicalJid) || {
            jid: canonicalJid,
            name: displayPhone,
            phone: rawPhone,
            unreadCount: c.unreadCount || 0,
            lastMessage: c.lastMessage || '',
            timestamp: c.conversationTimestamp ? Number(c.conversationTimestamp) * 1000 : Date.now()
          };

          existing.name = displayPhone;
          existing.phone = rawPhone;
          if (c.unreadCount !== undefined) existing.unreadCount = c.unreadCount;
          if (c.lastMessage) existing.lastMessage = c.lastMessage;
          if (c.conversationTimestamp) existing.timestamp = Number(c.conversationTimestamp) * 1000;

          chatsStore.set(canonicalJid, existing);
        }
      });
      saveChatsToDisk();
      broadcastChatList();
    };

    waSock.ev.on('chats.set', ({ chats }) => handleChats(chats));
    waSock.ev.on('chats.upsert', (chats) => handleChats(chats));
    waSock.ev.on('chats.update', (chats) => handleChats(chats));

    waSock.ev.on('chats.delete', (deletedJids) => {
      if (Array.isArray(deletedJids)) {
        deletedJids.forEach(j => deleteChatByJid(j));
      }
    });

    waSock.ev.on('messaging-history.set', ({ chats, contacts, messages }) => {
      console.log(`📥 [HISTORY SYNC] Received ${contacts?.length || 0} contacts, ${chats?.length || 0} chats, ${messages?.length || 0} messages.`);
      if (contacts) handleContacts(contacts);
      if (chats) handleChats(chats);

      if (Array.isArray(messages)) {
        messages.forEach(m => {
          if (!m || !m.message || !m.key) return;
          saveRawMessage(m.key.id, m.message);

          const remoteJid = m.key.remoteJid;
          if (!remoteJid || remoteJid === 'status@broadcast' || remoteJid.endsWith('@broadcast') || remoteJid.endsWith('@newsletter') || remoteJid.endsWith('@g.us')) {
            return;
          }

          parseAndSaveMessage(m, false);
        });
      }

      saveChatsToDisk();
      broadcastChatList();
    });

    async function parseAndSaveMessage(m, shouldBroadcast = true) {
      if (!m || !m.message || !m.key) return;
      saveRawMessage(m.key.id, m.message);

      const remoteJid = m.key.remoteJid;
      if (!remoteJid || remoteJid === 'status@broadcast' || remoteJid.endsWith('@broadcast') || remoteJid.endsWith('@newsletter') || remoteJid.endsWith('@g.us')) {
        return;
      }

      const rawMsg = extractMessageContent(m.message) || m.message;

      if (rawMsg?.protocolMessage) {
        if (rawMsg.protocolMessage.type === 0 || rawMsg.protocolMessage.type === proto.Message.ProtocolMessage.Type.REVOKE) {
          const revokedKey = rawMsg.protocolMessage.key;
          if (revokedKey) {
            deleteChatMessageByKey(revokedKey);
            return;
          }
        }
      }

      if (rawMsg?.reactionMessage) {
        return;
      }

      const fromMe = Boolean(m.key.fromMe);

      // ONLY save pushName if message is INCOMING from contact (never overwrite contact name with own name when sending from phone)
      if (!fromMe && m.pushName) {
        const jid = normalizeJid(remoteJid);
        const prev = contactDetailsMap.get(jid) || {};
        contactDetailsMap.set(jid, { ...prev, name: prev.name || m.pushName });
      }

      let text = '';
      let mediaUrl = null;
      let mediaType = null;
      let fileName = null;

      if (rawMsg.conversation) {
        text = rawMsg.conversation;
      } else if (rawMsg.extendedTextMessage?.text) {
        text = rawMsg.extendedTextMessage.text;
      } else if (rawMsg.imageMessage) {
        mediaType = 'image';
        text = rawMsg.imageMessage.caption || '';
      } else if (rawMsg.videoMessage || rawMsg.ptvMessage) {
        mediaType = 'video';
        text = (rawMsg.videoMessage || rawMsg.ptvMessage).caption || '';
      } else if (rawMsg.audioMessage) {
        mediaType = 'audio';
        text = '';
      } else if (rawMsg.documentMessage) {
        mediaType = 'document';
        fileName = rawMsg.documentMessage.fileName || 'Document';
        text = rawMsg.documentMessage.caption || '';
      } else if (rawMsg.stickerMessage) {
        mediaType = 'sticker';
        text = '';
      } else if (rawMsg.contactMessage || rawMsg.contactsArrayMessage) {
        text = `👤 ${rawMsg.contactMessage?.displayName || 'Contact Card'}`;
      } else if (rawMsg.locationMessage || rawMsg.liveLocationMessage) {
        text = `📍 Location: ${rawMsg.locationMessage?.name || rawMsg.locationMessage?.address || 'Shared Location'}`;
      } else if (rawMsg.pollCreationMessage || rawMsg.pollCreationMessageV2 || rawMsg.pollCreationMessageV3) {
        text = `📊 Poll: ${(rawMsg.pollCreationMessage || rawMsg.pollCreationMessageV2 || rawMsg.pollCreationMessageV3)?.name || 'Poll'}`;
      } else {
        text = '';
      }

      if (['image', 'video', 'document', 'audio', 'sticker'].includes(mediaType)) {
        try {
          const buffer = await downloadMediaMessage(
            m,
            'buffer',
            {},
            {
              logger: pino({ level: 'silent' }),
              reuploadRequest: waSock?.updateMediaMessage
            }
          );
          if (buffer && buffer.length > 0) {
            let ext = '.bin';
            if (mediaType === 'image') ext = '.jpg';
            else if (mediaType === 'video') ext = '.mp4';
            else if (mediaType === 'audio') ext = rawMsg.audioMessage?.mimetype?.includes('ogg') ? '.ogg' : '.mp3';
            else if (mediaType === 'sticker') ext = '.webp';
            else if (mediaType === 'document') {
              ext = path.extname(fileName || '') || '.pdf';
            }
            const uniqueName = `file_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`;
            const savePath = path.join(UPLOADS_FOLDER, uniqueName);
            fs.writeFileSync(savePath, buffer);
            mediaUrl = `/uploads/${uniqueName}`;
          }
        } catch (mediaErr) {}
      }

      const msgObj = {
        id: m.key.id,
        jid: resolveCanonicalJid(remoteJid),
        fromMe,
        text,
        mediaUrl,
        mediaType,
        fileName,
        timestamp: (m.messageTimestamp ? Number(m.messageTimestamp) * 1000 : Date.now()),
        status: fromMe ? (m.status ? String(m.status).toLowerCase() : 'sent') : 'received'
      };

      upsertChatMessage(remoteJid, msgObj, shouldBroadcast);
    }

    waSock.ev.on('messages.upsert', async ({ messages }) => {
      for (const m of messages) {
        await parseAndSaveMessage(m, true);
      }
    });

    waSock.ev.on('messages.update', (updates) => {
      for (const update of updates) {
        const { key, update: msgUpdate } = update;
        if (!key || !key.remoteJid) continue;
        const canonicalJid = resolveCanonicalJid(key.remoteJid);
        const thread = messagesStore.get(canonicalJid);
        if (thread) {
          const msg = thread.find(m => m.id === key.id);
          if (msg && msgUpdate.status) {
            const statusMap = { 2: 'sent', 3: 'delivered', 4: 'read', 5: 'played' };
            msg.status = statusMap[msgUpdate.status] || msg.status;
            saveMessageThreadToDisk(canonicalJid);
            broadcastMessageUpdate(canonicalJid, key.id, msg.status, chatsStore.get(canonicalJid)?.ownerId);
          }
        }
      }
    });

    waSock.ev.on('messages.delete', (item) => {
      if (item && Array.isArray(item.keys)) {
        item.keys.forEach(k => deleteChatMessageByKey(k));
      }
    });

    if (requestedPhone && !waSock.authState.creds.registered) {
      const cleanPhone = String(requestedPhone).replace(/\D/g, '');
      if (cleanPhone) {
        setTimeout(async () => {
          try {
            const rawCode = await waSock.requestPairingCode(cleanPhone);
            const formattedCode = rawCode?.match(/.{1,4}/g)?.join('-') || rawCode;
            pairingCode = formattedCode;

            io.emit('whatsapp:status', {
              status: 'pairing_ready',
              qr: null,
              pairingCode: formattedCode,
              user: null
            });
          } catch (pErr) {
            console.error('Error requesting pairing code:', pErr);
          }
        }, 3000);
      }
    }

    waSock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && !requestedPhone) {
        waConnectionStatus = 'qr_ready';
        qrCodeDataUrl = await qrcode.toDataURL(qr);
        console.log('⚡ QR Code Generated Successfully.');
        io.emit('whatsapp:status', {
          status: waConnectionStatus,
          qr: qrCodeDataUrl,
          pairingCode: null,
          user: null
        });
      }

      if (connection === 'open') {
        waConnectionStatus = 'connected';
        isExplicitLogout = false;
        qrCodeDataUrl = null;
        pairingCode = null;

        const rawId = waSock.user?.id ? waSock.user.id.split(':')[0] : 'Connected User';
        waUserInfo = {
          id: rawId,
          name: waSock.user?.name || formatPhoneDisplay(rawId)
        };

        io.emit('whatsapp:status', {
          status: waConnectionStatus,
          qr: null,
          pairingCode: null,
          user: waUserInfo
        });

        broadcastChatList();
        console.log('✅ WhatsApp Connected Successfully:', waUserInfo);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401 || isExplicitLogout;

        waConnectionStatus = 'disconnected';
        waUserInfo = null;
        qrCodeDataUrl = null;
        pairingCode = null;

        console.log(`⚠️ Connection closed. StatusCode: ${statusCode}. LoggedOut: ${isLoggedOut}`);

        if (isLoggedOut) {
          clearSessionFolderSync();
          isExplicitLogout = false;
          io.emit('whatsapp:status', { status: 'disconnected', qr: null, pairingCode: null, user: null });
        } else {
          io.emit('whatsapp:status', { status: 'connecting', qr: null, pairingCode: null, user: null });
          setTimeout(() => {
            isInitializing = false;
            initWhatsApp().catch(err => console.error('Reconnect error:', err));
          }, 3000);
        }
      }
    });
  } catch (err) {
    console.error('Failed to initialize WhatsApp:', err);
    waConnectionStatus = 'disconnected';
    io.emit('whatsapp:status', { status: 'disconnected', qr: null, pairingCode: null, user: null });
  } finally {
    isInitializing = false;
  }
}

// Start WhatsApp
initWhatsApp().catch(err => console.error('Initial load error:', err));

// Secure Socket.IO Handshake & Room Assignment
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.['x-auth-token'] || socket.handshake.query?.token;
  if (token) {
    const user = verifyAuthToken(token);
    if (user) {
      socket.user = user;
    }
  }
  next();
});

io.on('connection', (socket) => {
  socket.emit('whatsapp:status', {
    status: waConnectionStatus,
    qr: qrCodeDataUrl,
    pairingCode: pairingCode,
    user: waUserInfo
  });

  if (socket.user) {
    if (socket.user.role === 'admin') {
      socket.join('admin_room');
    } else {
      const uPhone = String(socket.user.phone || '').replace(/\D/g, '');
      const uUser = String(socket.user.username || '').toLowerCase();
      const uId = String(socket.user.id || '');
      if (uPhone) socket.join(`user_${uPhone}`);
      if (uUser && uUser !== uPhone) socket.join(`user_${uUser}`);
      if (uId && uId !== uPhone && uId !== uUser) socket.join(`user_${uId}`);
    }
    socket.emit('chat:list', getFilteredChatsList(socket.user));
  }
});

// REST API Endpoints
app.get('/api/status', (req, res) => {
  return res.json({
    status: waConnectionStatus,
    qr: qrCodeDataUrl,
    pairingCode: pairingCode,
    user: waUserInfo
  });
});

app.post('/api/pairing-code', authMiddleware, requireAdmin, async (req, res) => {
  const { phone } = req.body;
  const cleanPhone = String(phone || '').replace(/\D/g, '');

  if (!cleanPhone || cleanPhone.length < 8) {
    return res.status(400).json({ success: false, message: 'Please enter a valid phone number with country code.' });
  }

  try {
    if (waSock) {
      try { waSock.end(); } catch (e) {}
    }
    isInitializing = false;
    await initWhatsApp(cleanPhone);

    return res.json({ success: true, message: 'Pairing code request initiated.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/logout', authMiddleware, requireAdmin, async (req, res) => {
  try {
    isExplicitLogout = true;
    if (waSock) {
      try {
        await waSock.logout();
      } catch (err) {
        try { waSock.end(); } catch (e) {}
      }
    }

    clearSessionFolderSync();

    waConnectionStatus = 'disconnected';
    waUserInfo = null;
    qrCodeDataUrl = null;
    pairingCode = null;

    io.emit('whatsapp:status', { status: waConnectionStatus, qr: null, pairingCode: null, user: null });
    return res.json({ success: true, message: 'Logged out of WhatsApp session.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/relink', authMiddleware, requireAdmin, async (req, res) => {
  try {
    isExplicitLogout = true;
    if (waSock) {
      try {
        await waSock.logout();
      } catch (err) {
        try { waSock.end(); } catch (e) {}
      }
    }

    clearSessionFolderSync();

    waConnectionStatus = 'connecting';
    waUserInfo = null;
    qrCodeDataUrl = null;
    pairingCode = null;
    isInitializing = false;

    io.emit('whatsapp:status', { status: waConnectionStatus, qr: null, pairingCode: null, user: null });

    setTimeout(() => {
      initWhatsApp().catch(err => console.error('Relink init error:', err));
    }, 1000);

    return res.json({ success: true, message: 'WhatsApp session reset. Generating fresh QR code...' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// --- USER AUTHENTICATION & EMPLOYEE MANAGEMENT ---

// Login Endpoint (Supports mobile number or username with rate limiting)
app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const rateLimitCheck = checkRateLimit(`login_${ip}`, 5, 10 * 60 * 1000);
  if (!rateLimitCheck.allowed) {
    return res.status(429).json({
      success: false,
      message: `Too many failed login attempts. Please wait ${rateLimitCheck.remainingSecs} seconds before trying again.`
    });
  }

  const { loginId, password } = req.body;
  if (!loginId || !password) {
    return res.status(400).json({ success: false, message: 'Mobile Number / User ID and Password are required.' });
  }

  const user = findUserByLogin(loginId);
  if (!user || user.active === false || String(user.password).trim() !== String(password).trim()) {
    recordFailedAttempt(`login_${ip}`, 5, 10 * 60 * 1000);
    return res.status(401).json({ success: false, message: 'Invalid credentials or user does not exist.' });
  }

  clearRateLimit(`login_${ip}`);
  const token = generateAuthToken(user);

  return res.json({
    success: true,
    token,
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      username: user.username,
      role: user.role
    }
  });
});

// Current Authenticated User Profile
app.get('/api/auth/me', authMiddleware, (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated.' });
  }
  return res.json({
    success: true,
    user: {
      id: req.user.id,
      name: req.user.name,
      phone: req.user.phone,
      username: req.user.username,
      role: req.user.role
    }
  });
});

// Admin: List All Registered Employees
app.get('/api/admin/employees', authMiddleware, requireAdmin, (req, res) => {
  const users = getUsers()
    .filter(u => u.role !== 'admin')
    .map(u => ({
      id: u.id,
      name: u.name,
      phone: u.phone,
      username: u.username,
      role: u.role,
      createdAt: u.createdAt
    }));
  return res.json({ success: true, employees: users });
});

// Admin: Register New Employee
app.post('/api/admin/employees', authMiddleware, requireAdmin, (req, res) => {
  const { name, phone, password } = req.body;
  if (!name || !phone || !password) {
    return res.status(400).json({ success: false, message: 'Name, Mobile Number (User ID), and Password are required.' });
  }

  const cleanPhone = String(phone).replace(/\D/g, '');
  if (!cleanPhone || cleanPhone.length < 8) {
    return res.status(400).json({ success: false, message: 'Please enter a valid mobile number (min 8 digits).' });
  }

  if (String(password).trim().length < 3) {
    return res.status(400).json({ success: false, message: 'Password must be at least 3 characters.' });
  }

  const existing = findUserByLogin(cleanPhone);
  if (existing) {
    return res.status(400).json({ success: false, message: `An account with mobile number ${cleanPhone} already exists.` });
  }

  const users = getUsers();
  const newEmployee = {
    id: `emp_${Date.now()}`,
    name: String(name).trim(),
    phone: cleanPhone,
    username: cleanPhone,
    password: String(password).trim(),
    role: 'employee',
    createdAt: Date.now(),
    active: true
  };

  users.push(newEmployee);
  saveUsers(users);

  return res.json({
    success: true,
    message: 'Employee registered successfully.',
    employee: {
      id: newEmployee.id,
      name: newEmployee.name,
      phone: newEmployee.phone,
      role: newEmployee.role,
      createdAt: newEmployee.createdAt
    }
  });
});

// Admin: Delete Employee
app.delete('/api/admin/employees/:idOrPhone', authMiddleware, requireAdmin, (req, res) => {
  const target = req.params.idOrPhone;
  const users = getUsers();
  const idx = users.findIndex(u => u.id === target || u.phone === target || u.username === target);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Employee not found.' });
  }

  if (users[idx].role === 'admin') {
    return res.status(400).json({ success: false, message: 'Cannot delete admin account.' });
  }

  const deletedUser = users[idx];
  users.splice(idx, 1);
  saveUsers(users);

  // Automatically reassign all chats of deleted employee back to Admin
  let reassignedCount = 0;
  const delPhone = String(deletedUser.phone || '').replace(/\D/g, '');
  const delUser = String(deletedUser.username || '').toLowerCase();
  const delId = String(deletedUser.id || '');

  for (const [jid, chat] of chatsStore.entries()) {
    const oPhone = String(chat.ownerId || '').replace(/\D/g, '');
    if (chat.ownerId === deletedUser.phone || chat.ownerId === delId || String(chat.ownerId).toLowerCase() === delUser || (delPhone && oPhone === delPhone)) {
      chat.ownerId = 'admin';
      chat.ownerName = 'Nexus Admin';
      chatsStore.set(jid, chat);
      reassignedCount++;
    }
  }

  saveChatsToDisk();
  broadcastChatList();
  console.log(`🗑️ Deleted employee "${deletedUser.name}". Reassigned ${reassignedCount} chat(s) back to Admin.`);

  return res.json({
    success: true,
    message: `Employee removed successfully. ${reassignedCount} active chat(s) reassigned to Admin.`
  });
});

// Admin: Reset Employee Password
app.post('/api/admin/employees/:idOrPhone/reset-password', authMiddleware, requireAdmin, (req, res) => {
  const target = req.params.idOrPhone;
  const { newPassword } = req.body;
  if (!newPassword || String(newPassword).trim().length < 3) {
    return res.status(400).json({ success: false, message: 'New password must be at least 3 characters.' });
  }

  const users = getUsers();
  const user = users.find(u => u.id === target || u.phone === target || u.username === target);
  if (!user) {
    return res.status(404).json({ success: false, message: 'Employee not found.' });
  }

  user.password = String(newPassword).trim();
  saveUsers(users);
  return res.json({ success: true, message: 'Password updated successfully.' });
});

// Get Chats (Scoped by User Role & Ownership)
app.get('/api/chats', authMiddleware, (req, res) => {
  return res.json({ success: true, chats: getFilteredChatsList(req.user) });
});

app.get('/api/chats/:jid/messages', authMiddleware, (req, res) => {
  const rawJid = req.params.jid;
  const canonicalJid = resolveCanonicalJid(rawJid);
  const user = req.user;

  const chatObj = findExistingChat(canonicalJid) || findExistingChat(rawJid);

  // Strict Security Check: Employees cannot view messages of Admin's or other employees' chats
  if (user && user.role !== 'admin' && chatObj && chatObj.ownerId) {
    const uPhone = String(user.phone || '').replace(/\D/g, '');
    const oPhone = String(chatObj.ownerId).replace(/\D/g, '');
    const isOwner = chatObj.ownerId === user.phone || chatObj.ownerId === user.username || (oPhone && oPhone === uPhone);
    if (!isOwner) {
      return res.status(403).json({
        success: false,
        message: `⚠️ Access denied. This candidate is already being handled by ${chatObj.ownerName || 'another team member'}.`
      });
    }
  }

  if (chatObj) {
    chatObj.unreadCount = 0;
    chatsStore.set(canonicalJid, chatObj);
    saveChatsToDisk();
    broadcastChatList();
  }

  const thread = messagesStore.get(canonicalJid) || messagesStore.get(rawJid) || [];
  return res.json({ success: true, messages: thread });
});

// Link LID directly to a real Phone Number
app.post('/api/contacts/link-phone', authMiddleware, async (req, res) => {
  const { lid, phone } = req.body;
  if (!lid || !phone) {
    return res.status(400).json({ success: false, message: 'LID and Phone number are required.' });
  }

  let cleanPhone = String(phone).replace(/\D/g, '');
  if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
  let targetPhoneJid = `${cleanPhone}@s.whatsapp.net`;

  try {
    if (waSock && waConnectionStatus === 'connected') {
      try {
        const [waCheck] = await waSock.onWhatsApp(cleanPhone);
        if (waCheck && waCheck.exists) {
          targetPhoneJid = normalizeJid(waCheck.jid);
          if (waCheck.lid) {
            linkLidAndPhoneJid(waCheck.lid, targetPhoneJid);
          }
        }
      } catch (e) {}
    }

    linkLidAndPhoneJid(lid, targetPhoneJid);
    broadcastChatList();

    return res.json({ success: true, jid: targetPhoneJid, phone: cleanPhone, message: 'Phone number linked successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Bulk Resolve Phone Numbers
app.post('/api/contacts/bulk-resolve', authMiddleware, requireAdmin, async (req, res) => {
  const { phones } = req.body;
  if (!Array.isArray(phones) || phones.length === 0) {
    return res.status(400).json({ success: false, message: 'Array of phone numbers is required.' });
  }

  if (waConnectionStatus !== 'connected' || !waSock) {
    return res.status(400).json({ success: false, message: 'WhatsApp is not connected!' });
  }

  try {
    let resolvedCount = 0;
    for (const p of phones) {
      let clean = String(p).replace(/\D/g, '');
      if (clean.length === 10) clean = '91' + clean;
      try {
        const [waCheck] = await waSock.onWhatsApp(clean);
        if (waCheck && waCheck.exists && waCheck.lid) {
          linkLidAndPhoneJid(waCheck.lid, waCheck.jid);
          resolvedCount++;
        }
      } catch (e) {}
    }
    broadcastChatList();
    return res.json({ success: true, resolvedCount, chats: getFilteredChatsList() });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Contacts Password Verification Endpoint (With brute force protection)
app.post('/api/contacts/verify-password', (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const rateLimitCheck = checkRateLimit(`pin_${ip}`, 5, 10 * 60 * 1000);
  if (!rateLimitCheck.allowed) {
    return res.status(429).json({
      success: false,
      message: `Too many failed PIN attempts. Please wait ${rateLimitCheck.remainingSecs} seconds before trying again.`
    });
  }

  const { password } = req.body;
  const currentPassword = getContactsPassword();
  if (String(password || '').trim() === currentPassword.trim()) {
    clearRateLimit(`pin_${ip}`);
    return res.json({ success: true, message: 'Password verified successfully.' });
  } else {
    recordFailedAttempt(`pin_${ip}`, 5, 10 * 60 * 1000);
    return res.status(401).json({ success: false, message: 'Incorrect password. Access denied.' });
  }
});

// Update Contacts Password Endpoint
app.post('/api/contacts/update-password', authMiddleware, requireAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const savedPassword = getContactsPassword();

  if (String(currentPassword || '').trim() !== savedPassword.trim()) {
    return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
  }

  if (!newPassword || String(newPassword).trim().length < 3) {
    return res.status(400).json({ success: false, message: 'New password must be at least 3 characters long.' });
  }

  if (setContactsPassword(newPassword.trim())) {
    return res.json({ success: true, message: 'Password updated successfully.' });
  } else {
    return res.status(500).json({ success: false, message: 'Failed to update password.' });
  }
});

// Protected Contacts Directory Endpoint
app.get('/api/contacts', authMiddleware, (req, res) => {
  // If request is from an authenticated admin, allow direct access
  if (req.user && req.user.role === 'admin') {
    const contacts = getContactsList();
    return res.json({ success: true, count: contacts.length, contacts });
  }

  const authHeader = req.headers['x-contacts-password'];
  const savedPassword = getContactsPassword();

  if (String(authHeader || '').trim() !== savedPassword.trim()) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Please provide valid password.' });
  }

  const contacts = getContactsList();
  return res.json({ success: true, count: contacts.length, contacts });
});

// Message Dispatcher Endpoint (With Chat Ownership, Valid Number Verification & Anti-Ban Jitter)
app.post('/api/send-message', authMiddleware, upload.single('attachment'), async (req, res) => {
  const { phone, jid, text } = req.body;
  const attachment = req.file;
  const user = req.user || { phone: 'admin', name: 'Nexus Admin', role: 'admin' };

  const targetIdentifier = jid || phone;

  console.log(`\n📤 [SEND] User: "${user.name} (${user.role})", Target: "${targetIdentifier}", Text: "${text || ''}"`);

  if (!targetIdentifier) {
    return res.status(400).json({ success: false, message: 'Phone number or JID is required.' });
  }

  if (!text && !attachment) {
    return res.status(400).json({ success: false, message: 'Message text or attachment is required.' });
  }

  if (waConnectionStatus !== 'connected' || !waSock) {
    return res.status(400).json({ success: false, message: 'WhatsApp is not connected!' });
  }

  try {
    let targetJid = String(targetIdentifier).trim();

    if (!targetJid.includes('@')) {
      let cleanPhone = targetJid.replace(/\D/g, '');
      if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
      targetJid = `${cleanPhone}@s.whatsapp.net`;

      try {
        const [waCheck] = await waSock.onWhatsApp(cleanPhone);
        if (waCheck) {
          if (waCheck.exists === false) {
            return res.status(400).json({
              success: false,
              message: `The number +${cleanPhone} is not registered on WhatsApp.`
            });
          }
          targetJid = normalizeJid(waCheck.jid);
          if (waCheck.lid) {
            const cLid = normalizeJid(waCheck.lid);
            lidToJidMap.set(cLid, targetJid);
            jidToLidMap.set(targetJid, cLid);
            saveContactsToDisk();
          }
        }
      } catch (e) {}
    } else {
      targetJid = normalizeJid(targetJid);
    }

    const canonicalJid = resolveCanonicalJid(targetJid);
    const existingChat = findExistingChat(targetJid) || findExistingChat(canonicalJid) || chatsStore.get(canonicalJid);

    // Collision Check: If chat is already owned by Admin or another employee, and sender is not that owner or admin
    if (existingChat && existingChat.ownerId && user.role !== 'admin') {
      const uPhone = String(user.phone || '').replace(/\D/g, '');
      const oPhone = String(existingChat.ownerId).replace(/\D/g, '');
      const isOwner = existingChat.ownerId === user.phone || existingChat.ownerId === user.username || (oPhone && oPhone === uPhone);
      if (!isOwner) {
        return res.status(403).json({
          success: false,
          collision: true,
          message: `⚠️ This candidate is already being handled by ${existingChat.ownerName || 'another team member'}.`
        });
      }
    }

    // Set ownership if newly created chat
    if (!existingChat || !existingChat.ownerId) {
      const chatToSave = existingChat || { jid: canonicalJid };
      chatToSave.ownerId = user.phone || user.username || 'admin';
      chatToSave.ownerName = user.name || 'Nexus Admin';
      chatsStore.set(canonicalJid, chatToSave);
    }

    // WhatsApp Anti-Ban: Human typing simulation based on text length
    try {
      const textLen = String(text || '').length;
      const typingDelayMs = Math.min(2500, Math.max(800, textLen * 25));
      await waSock.sendPresenceUpdate('composing', targetJid);
      await delay(typingDelayMs);
    } catch (presenceErr) {}

    let sentMsg = null;
    let mediaUrl = null;
    let mediaType = null;

    if (attachment) {
      const filePath = attachment.path;
      const fileBuffer = fs.readFileSync(filePath);
      const mime = attachment.mimetype;
      mediaUrl = `/uploads/${path.basename(filePath)}`;

      if (mime.startsWith('image/')) {
        mediaType = 'image';
        sentMsg = await waSock.sendMessage(targetJid, {
          image: fileBuffer,
          caption: text || ''
        });
      } else if (mime.startsWith('video/')) {
        mediaType = 'video';
        sentMsg = await waSock.sendMessage(targetJid, {
          video: fileBuffer,
          caption: text || ''
        });
      } else if (mime.startsWith('audio/')) {
        mediaType = 'audio';
        sentMsg = await waSock.sendMessage(targetJid, {
          audio: fileBuffer,
          mimetype: mime
        });
      } else {
        mediaType = 'document';
        sentMsg = await waSock.sendMessage(targetJid, {
          document: fileBuffer,
          mimetype: mime,
          fileName: attachment.originalname,
          caption: text || ''
        });
      }
    } else {
      sentMsg = await waSock.sendMessage(targetJid, { text: String(text) });
    }

    if (sentMsg?.message && sentMsg?.key?.id) {
      saveRawMessage(sentMsg.key.id, sentMsg.message);
    }

    try {
      await waSock.sendPresenceUpdate('paused', targetJid);
    } catch (e) {}

    const msgObj = {
      id: sentMsg?.key?.id || ('msg_' + Date.now()),
      jid: canonicalJid,
      fromMe: true,
      text: text || (mediaUrl ? `[${mediaType.toUpperCase()}]` : ''),
      mediaUrl,
      mediaType,
      fileName: attachment ? attachment.originalname : null,
      timestamp: Date.now(),
      status: 'sent'
    };

    upsertChatMessage(targetJid, msgObj, true, user);

    return res.json({ success: true, message: 'Message sent successfully', msgObj });
  } catch (err) {
    console.error('❌ Error sending message to WhatsApp:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n⚠️ Port ${PORT} is already in use by another process.\n`);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 NexusDigital WA Server running on port ${PORT}`);
  console.log(`🔗 Web Portal: http://localhost:${PORT}`);
  console.log(`📂 Data Storage: ${STORE_FOLDER}`);
  console.log(`==================================================\n`);
});
