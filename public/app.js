document.addEventListener('DOMContentLoaded', () => {
  // --- AUTHENTICATION STATE & ELEMENTS ---
  const authLoginView = document.getElementById('auth-login-view');
  const loginForm = document.getElementById('login-form');
  const loginIdInput = document.getElementById('login-id-input');
  const loginPasswordInput = document.getElementById('login-password-input');
  const loginSubmitBtn = document.getElementById('login-submit-btn');
  const loginErrorMsg = document.getElementById('login-error-msg');

  // WhatsApp Pairing View (for Admin when WhatsApp is disconnected)
  const loginView = document.getElementById('login-view');
  const chatView = document.getElementById('chat-view');

  // Linking Tabs & QR / Pairing Elements
  const btnTabQr = document.getElementById('btn-tab-qr');
  const btnTabPairing = document.getElementById('btn-tab-pairing');
  const pairingFormContainer = document.getElementById('pairing-form-container');
  const qrSection = document.getElementById('qr-section');
  const pairingPhoneInput = document.getElementById('pairing-phone-input');
  const getPairingCodeBtn = document.getElementById('get-pairing-code-btn');
  const pairingCodeDisplayCard = document.getElementById('pairing-code-display-card');
  const pairingCodeValue = document.getElementById('pairing-code-value');

  const qrPlaceholder = document.getElementById('qr-placeholder');
  const qrImage = document.getElementById('qr-image');
  const qrStatusText = document.getElementById('qr-status-text');

  // User Profile in Sidebar Header
  const userProfileAvatar = document.getElementById('user-profile-avatar');
  const userProfileName = document.getElementById('user-profile-name');
  const userProfileBadge = document.getElementById('user-profile-badge');
  const waConnectionText = document.getElementById('wa-connection-text');
  const toggleAdminDrawerBtn = document.getElementById('toggle-admin-drawer-btn');
  const newChatBtn = document.getElementById('new-chat-btn');
  const userLogoutBtn = document.getElementById('user-logout-btn');

  // Sidebar Tabs & Search
  const tabChats = document.getElementById('tab-chats');
  const tabContacts = document.getElementById('tab-contacts');
  const chatsCountBadge = document.getElementById('chats-count-badge');
  const chatSearchInput = document.getElementById('chat-search-input');
  const chatsListContainer = document.getElementById('chats-list-container');
  const contactsDirectoryWrapper = document.getElementById('contacts-directory-wrapper');
  const contactsTabLockIcon = document.getElementById('contacts-tab-lock-icon');

  // Contacts Locked / Unlocked
  const contactsLockedCard = document.getElementById('contacts-locked-card');
  const contactsUnlockedCard = document.getElementById('contacts-unlocked-card');
  const contactsPinInput = document.getElementById('contacts-pin-input');
  const unlockContactsBtn = document.getElementById('unlock-contacts-btn');
  const contactsListContainer = document.getElementById('contacts-list-container');
  const contactsTotalCount = document.getElementById('contacts-total-count');
  const relockContactsBtn = document.getElementById('relock-contacts-btn');
  const changeContactsPwdBtn = document.getElementById('change-contacts-pwd-btn');

  // Main Chat Elements
  const chatEmptyState = document.getElementById('chat-empty-state');
  const activeChatWrapper = document.getElementById('active-chat-wrapper');
  const activeChatAvatar = document.getElementById('active-chat-avatar');
  const activeChatTitle = document.getElementById('active-chat-title');
  const activeChatSubtitle = document.getElementById('active-chat-subtitle');
  const activeChatOwnerBadge = document.getElementById('active-chat-owner-badge');
  const chatMessagesContainer = document.getElementById('chat-messages-container');

  // Composer Elements
  const attachmentInput = document.getElementById('attachment-input');
  const attachmentPreviewTag = document.getElementById('attachment-preview-tag');
  const attachmentName = document.getElementById('attachment-name');
  const removeAttachmentBtn = document.getElementById('remove-attachment-btn');
  const messageTextInput = document.getElementById('message-text-input');
  const sendMsgBtn = document.getElementById('send-msg-btn');
  const linkPhoneBtn = document.getElementById('link-phone-btn');

  // Admin Drawer Elements
  const adminDrawerPanel = document.getElementById('admin-drawer-panel');
  const adminDrawerBackdrop = document.getElementById('admin-drawer-backdrop');
  const closeAdminDrawerBtn = document.getElementById('close-admin-drawer-btn');
  const drawerTabEmp = document.getElementById('drawer-tab-emp');
  const drawerTabContacts = document.getElementById('drawer-tab-contacts');
  const drawerTabWa = document.getElementById('drawer-tab-wa');
  const drawerSecEmp = document.getElementById('drawer-sec-emp');
  const drawerSecContacts = document.getElementById('drawer-sec-contacts');
  const drawerSecWa = document.getElementById('drawer-sec-wa');

  const empRegisterForm = document.getElementById('emp-register-form');
  const empRegName = document.getElementById('emp-reg-name');
  const empRegPhone = document.getElementById('emp-reg-phone');
  const empRegPassword = document.getElementById('emp-reg-password');
  const empRegSubmitBtn = document.getElementById('emp-reg-submit-btn');
  const empTotalCount = document.getElementById('emp-total-count');
  const employeeListContainer = document.getElementById('employee-list-container');

  const drawerContactsCount = document.getElementById('drawer-contacts-count');
  const drawerContactSearch = document.getElementById('drawer-contact-search');
  const drawerContactsList = document.getElementById('drawer-contacts-list');
  const drawerWaStatusText = document.getElementById('drawer-wa-status-text');
  const drawerRelinkWaBtn = document.getElementById('drawer-relink-wa-btn');
  const drawerLogoutWaBtn = document.getElementById('drawer-logout-wa-btn');

  // Modals
  const newChatModal = document.getElementById('new-chat-modal');
  const closeNewChatModal = document.getElementById('close-new-chat-modal');
  const newChatPhone = document.getElementById('new-chat-phone');
  const newChatMessage = document.getElementById('new-chat-message');
  const startChatSubmitBtn = document.getElementById('start-chat-submit-btn');

  const linkPhoneModal = document.getElementById('link-phone-modal');
  const closeLinkPhoneModal = document.getElementById('close-link-phone-modal');
  const linkPhoneInput = document.getElementById('link-phone-input');
  const submitLinkPhoneBtn = document.getElementById('submit-link-phone-btn');

  const changePwdModal = document.getElementById('change-pwd-modal');
  const closeChangePwdModal = document.getElementById('close-change-pwd-modal');
  const currentPinInput = document.getElementById('current-pin-input');
  const newPinInput = document.getElementById('new-pin-input');
  const submitChangePwdBtn = document.getElementById('submit-change-pwd-btn');

  // Socket & App State
  let authToken = localStorage.getItem('wa_auth_token') || null;
  const socket = io({
    auth: { token: authToken }
  });
  let currentUser = null;
  let currentChats = [];
  let allContacts = [];
  let selectedJid = null;
  let selectedFile = null;
  let activeTab = 'chats';
  let storedContactsPin = sessionStorage.getItem('contacts_pin') || '';
  let waConnectionStatus = 'disconnected';

  // --- AUTHENTICATED FETCH HELPER ---
  async function authFetch(url, options = {}) {
    const headers = options.headers ? { ...options.headers } : {};
    if (authToken) {
      headers['x-auth-token'] = authToken;
    }
    return fetch(url, { ...options, headers });
  }

  // --- INITIALIZE APPLICATION / AUTH CHECK ---
  async function checkAuthSession() {
    if (!authToken) {
      showLoginScreen();
      return;
    }

    try {
      const res = await authFetch('/api/auth/me');
      const data = await res.json();

      if (data.success && data.user) {
        currentUser = data.user;
        onUserAuthenticated();
      } else {
        localStorage.removeItem('wa_auth_token');
        authToken = null;
        currentUser = null;
        if (socket) {
          socket.auth = { token: null };
          socket.disconnect().connect();
        }
        showLoginScreen();
      }
    } catch (e) {
      showLoginScreen();
    }
  }

  function showLoginScreen() {
    authLoginView.classList.remove('hidden');
    chatView.classList.add('hidden');
    loginView.classList.add('hidden');
  }

  function onUserAuthenticated() {
    authLoginView.classList.add('hidden');
    loginView.classList.add('hidden');
    chatView.classList.remove('hidden');

    // Update Socket Authentication & Join Room
    if (socket && authToken) {
      socket.auth = { token: authToken };
      if (!socket.connected) {
        socket.connect();
      } else {
        socket.disconnect().connect();
      }
    }

    // Update Header Profile Info
    const initials = currentUser.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'U';
    userProfileAvatar.textContent = initials;
    userProfileName.textContent = currentUser.name;

    if (currentUser.role === 'admin') {
      userProfileBadge.textContent = 'ADMIN';
      userProfileBadge.className = 'user-role-badge admin';
      toggleAdminDrawerBtn.classList.remove('hidden');
    } else {
      userProfileBadge.textContent = 'EMPLOYEE';
      userProfileBadge.className = 'user-role-badge emp';
      toggleAdminDrawerBtn.classList.add('hidden');
    }

    loadChatsList();
    if (currentUser.role === 'admin') {
      loadEmployeesList();
    }
  }

  // Fetch initial WhatsApp status
  fetch('/api/status').then(r => r.json()).then(data => {
    updateStatusUI(data);
  }).catch(() => {});

  // --- USER LOGIN HANDLER ---
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const loginId = loginIdInput.value.trim();
    const password = loginPasswordInput.value.trim();

    if (!loginId || !password) return;

    try {
      loginSubmitBtn.disabled = true;
      loginErrorMsg.classList.add('hidden');

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId, password })
      });
      const data = await res.json();

      if (data.success && data.token) {
        authToken = data.token;
        localStorage.setItem('wa_auth_token', authToken);
        currentUser = data.user;
        onUserAuthenticated();
      } else {
        loginErrorMsg.textContent = data.message || 'Invalid Mobile Number / Password';
        loginErrorMsg.classList.remove('hidden');
      }
    } catch (err) {
      loginErrorMsg.textContent = 'Connection error. Please try again.';
      loginErrorMsg.classList.remove('hidden');
    } finally {
      loginSubmitBtn.disabled = false;
    }
  });

  // User Logout
  userLogoutBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to sign out?')) {
      localStorage.removeItem('wa_auth_token');
      authToken = null;
      currentUser = null;
      selectedJid = null;
      if (socket) {
        socket.auth = { token: null };
        socket.disconnect().connect();
      }
      showLoginScreen();
    }
  });

  // --- WHATSAPP PAIRING & STATUS LOGIC ---
  btnTabQr.addEventListener('click', () => {
    btnTabQr.classList.add('active');
    btnTabPairing.classList.remove('active');
    qrSection.classList.remove('hidden');
    pairingFormContainer.classList.add('hidden');
  });

  btnTabPairing.addEventListener('click', () => {
    btnTabPairing.classList.add('active');
    btnTabQr.classList.remove('active');
    pairingFormContainer.classList.remove('hidden');
    qrSection.classList.add('hidden');
    pairingPhoneInput.focus();
  });

  getPairingCodeBtn.addEventListener('click', async () => {
    const rawPhone = pairingPhoneInput.value.trim();
    const cleanPhone = rawPhone.replace(/\D/g, '');

    if (!cleanPhone || cleanPhone.length < 8) {
      alert('Please enter a valid phone number with country code (e.g. 919876543210).');
      return;
    }

    try {
      getPairingCodeBtn.disabled = true;
      getPairingCodeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Requesting...';

      const res = await authFetch('/api/pairing-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleanPhone })
      });
      const data = await res.json();

      if (!data.success) {
        alert(data.message || 'Failed to request pairing code.');
      }
    } catch (err) {
      alert('Error requesting pairing code.');
    } finally {
      getPairingCodeBtn.disabled = false;
      getPairingCodeBtn.innerHTML = 'Get Code <i class="fa-solid fa-arrow-right"></i>';
    }
  });

  function updateStatusUI(data) {
    if (!data) return;
    waConnectionStatus = data.status || 'disconnected';

    if (waConnectionText) {
      waConnectionText.textContent = waConnectionStatus === 'connected' ? 'WhatsApp Online' : 'WhatsApp Disconnected';
    }
    if (drawerWaStatusText) {
      drawerWaStatusText.textContent = waConnectionStatus === 'connected' ? 'WhatsApp Connected' : 'Disconnected';
    }

    if (waConnectionStatus === 'connected') {
      if (currentUser) {
        loginView.classList.add('hidden');
        chatView.classList.remove('hidden');
      }
    } else {
      if (data.qr) {
        qrImage.src = data.qr;
        qrImage.classList.remove('hidden');
        qrPlaceholder.classList.add('hidden');
        qrStatusText.textContent = 'Scan QR code with your phone';
      } else {
        qrImage.classList.add('hidden');
        qrPlaceholder.classList.remove('hidden');
        if (waConnectionStatus === 'connecting') {
          qrStatusText.textContent = 'Status: Connecting Baileys engine...';
        } else if (waConnectionStatus === 'disconnected') {
          qrStatusText.textContent = 'Status: WhatsApp Disconnected';
        } else if (waConnectionStatus === 'qr_ready') {
          qrStatusText.textContent = 'Status: Generating QR Code...';
        }
      }

      if (data.pairingCode) {
        pairingCodeValue.textContent = data.pairingCode;
        pairingCodeDisplayCard.classList.remove('hidden');
      }
    }
  }

  // --- SOCKET REALTIME LISTENERS ---
  socket.on('whatsapp:status', (data) => {
    updateStatusUI(data);
  });

  socket.on('chat:list', () => {
    if (currentUser) loadChatsList();
  });

  socket.on('chat:new_message', (data) => {
    const { jid, rawJid, message, ownerId } = data;

    // Check if this message belongs to this user
    if (currentUser) {
      const isOwner = currentUser.role === 'admin' ||
        (ownerId && (ownerId === currentUser.phone || ownerId === currentUser.username));

      if (isOwner) {
        if (areJidsMatching(selectedJid, jid, rawJid)) {
          appendMessageBubble(message);
        }
        loadChatsList();
      }
    }
  });

  socket.on('chat:message_deleted', (data) => {
    const { jid, messageId } = data;
    if (areJidsMatching(selectedJid, jid)) {
      const bubble = chatMessagesContainer.querySelector(`[data-msg-id="${messageId}"]`);
      if (bubble) bubble.remove();
    }
    loadChatsList();
  });

  function areJidsMatching(jidA, jidB, rawJidB = null) {
    if (!jidA || (!jidB && !rawJidB)) return false;
    if (jidA === jidB || (rawJidB && jidA === rawJidB)) return true;

    const phoneA = String(jidA).split('@')[0].replace(/\D/g, '');
    const phoneB = jidB ? String(jidB).split('@')[0].replace(/\D/g, '') : '';
    const phoneRawB = rawJidB ? String(rawJidB).split('@')[0].replace(/\D/g, '') : '';

    if (phoneA && phoneB && phoneA === phoneB) return true;
    if (phoneA && phoneRawB && phoneA === phoneRawB) return true;
    return false;
  }

  // --- SIDEBAR TABS & SEARCH ---
  tabChats.addEventListener('click', () => switchTab('chats'));
  tabContacts.addEventListener('click', () => switchTab('contacts'));

  function switchTab(tab) {
    activeTab = tab;
    chatSearchInput.value = '';

    if (tab === 'chats') {
      tabChats.classList.add('active');
      tabContacts.classList.remove('active');
      chatsListContainer.classList.remove('hidden');
      contactsDirectoryWrapper.classList.add('hidden');
      chatSearchInput.placeholder = 'Search active chats...';
      renderChatsList(currentChats);
    } else {
      tabContacts.classList.add('active');
      tabChats.classList.remove('active');
      chatsListContainer.classList.add('hidden');
      contactsDirectoryWrapper.classList.remove('hidden');
      chatSearchInput.placeholder = 'Search all contacts directory...';

      if (storedContactsPin) {
        verifyAndLoadContacts(storedContactsPin, false);
      } else {
        showContactsLockedState();
      }
    }
  }

  function showContactsLockedState() {
    contactsLockedCard.classList.remove('hidden');
    contactsUnlockedCard.classList.add('hidden');
    if (contactsTabLockIcon) contactsTabLockIcon.className = 'fa-solid fa-lock tab-lock-icon';
    contactsPinInput.value = '';
    contactsPinInput.focus();
  }

  function showContactsUnlockedState() {
    contactsLockedCard.classList.add('hidden');
    contactsUnlockedCard.classList.remove('hidden');
    if (contactsTabLockIcon) contactsTabLockIcon.className = 'fa-solid fa-lock-open tab-lock-icon color-emerald';
  }

  unlockContactsBtn.addEventListener('click', () => {
    const pin = contactsPinInput.value.trim();
    if (!pin) {
      alert('Please enter your contacts security PIN.');
      return;
    }
    verifyAndLoadContacts(pin, true);
  });

  contactsPinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') unlockContactsBtn.click();
  });

  async function verifyAndLoadContacts(pin, showAlertOnError = true) {
    try {
      unlockContactsBtn.disabled = true;
      const verifyRes = await authFetch('/api/contacts/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pin })
      });
      const verifyData = await verifyRes.json();

      if (!verifyData.success) {
        sessionStorage.removeItem('contacts_pin');
        storedContactsPin = '';
        showContactsLockedState();
        if (showAlertOnError) alert(verifyData.message || 'Incorrect PIN.');
        return;
      }

      storedContactsPin = pin;
      sessionStorage.setItem('contacts_pin', pin);
      showContactsUnlockedState();

      const res = await authFetch('/api/contacts', {
        headers: { 'x-contacts-password': pin }
      });
      const data = await res.json();

      if (data.success) {
        allContacts = data.contacts || [];
        renderContactsList(allContacts);
      }
    } catch (err) {
      if (showAlertOnError) alert('Could not unlock contacts directory.');
    } finally {
      unlockContactsBtn.disabled = false;
    }
  }

  relockContactsBtn.addEventListener('click', () => {
    sessionStorage.removeItem('contacts_pin');
    storedContactsPin = '';
    showContactsLockedState();
  });

  // Change PIN Handlers
  changeContactsPwdBtn.addEventListener('click', () => {
    changePwdModal.classList.remove('hidden');
    currentPinInput.value = storedContactsPin || '';
    newPinInput.value = '';
    newPinInput.focus();
  });

  closeChangePwdModal.addEventListener('click', () => {
    changePwdModal.classList.add('hidden');
  });

  submitChangePwdBtn.addEventListener('click', async () => {
    const cur = currentPinInput.value.trim();
    const next = newPinInput.value.trim();

    if (!cur || !next) {
      alert('Please enter both current and new PIN.');
      return;
    }

    try {
      submitChangePwdBtn.disabled = true;
      const res = await authFetch('/api/contacts/update-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: cur, newPassword: next })
      });
      const data = await res.json();

      if (data.success) {
        alert('Contacts security PIN updated successfully!');
        storedContactsPin = next;
        sessionStorage.setItem('contacts_pin', next);
        changePwdModal.classList.add('hidden');
      } else {
        alert(data.message || 'Failed to update PIN.');
      }
    } catch (e) {
      alert('Error updating password.');
    } finally {
      submitChangePwdBtn.disabled = false;
    }
  });

  function renderContactsList(contacts) {
    if (contactsTotalCount) {
      contactsTotalCount.textContent = `${(contacts || []).length.toLocaleString()} Contacts`;
    }

    if (!contacts || contacts.length === 0) {
      contactsListContainer.innerHTML = `
        <div class="empty-chats-placeholder">
          <i class="fa-solid fa-address-book"></i>
          <p>No contacts found</p>
        </div>
      `;
      return;
    }

    contactsListContainer.innerHTML = contacts.map(c => {
      const avatarLetters = String(c.phone).slice(-2) || 'WA';
      const statusText = c.hasChat ? '<i class="fa-solid fa-check color-emerald"></i> Active Chat' : 'Synced Contact';

      return `
        <div class="contact-dir-item" data-jid="${c.jid}" data-phone="${c.phone}">
          <div class="contact-dir-avatar">${avatarLetters}</div>
          <div class="contact-dir-info">
            <span class="contact-dir-phone">${escapeHtml(c.displayPhone)}</span>
            <span class="contact-dir-status">${statusText}</span>
          </div>
          <button type="button" class="contact-dir-action-btn" title="Open Chat">
            <i class="fa-solid fa-paper-plane"></i>
          </button>
        </div>
      `;
    }).join('');

    document.querySelectorAll('.contact-dir-item').forEach(item => {
      item.addEventListener('click', () => {
        const jid = item.getAttribute('data-jid');
        const phone = item.getAttribute('data-phone');
        openChatThread(jid, phone);
      });
    });
  }

  // --- CHATS LIST ENGINE ---
  async function loadChatsList() {
    try {
      const res = await authFetch('/api/chats');
      const data = await res.json();
      if (data.success) {
        currentChats = data.chats || [];
        if (chatsCountBadge) {
          chatsCountBadge.textContent = currentChats.length;
        }
        if (activeTab === 'chats') {
          renderChatsList(currentChats);
        }
      }
    } catch (err) {
      console.error('Error fetching chats:', err);
    }
  }

  chatSearchInput.addEventListener('input', () => {
    const query = chatSearchInput.value.toLowerCase().trim();

    if (activeTab === 'chats') {
      if (!query) {
        renderChatsList(currentChats);
        return;
      }
      const filtered = currentChats.filter(c =>
        (c.name && c.name.toLowerCase().includes(query)) ||
        (c.jid && c.jid.includes(query)) ||
        (c.phone && c.phone.includes(query)) ||
        (c.lastMessage && c.lastMessage.toLowerCase().includes(query))
      );
      renderChatsList(filtered);
    } else {
      if (!query) {
        renderContactsList(allContacts);
        return;
      }
      const filtered = allContacts.filter(c =>
        (c.displayPhone && c.displayPhone.toLowerCase().includes(query)) ||
        (c.phone && c.phone.includes(query)) ||
        (c.jid && c.jid.includes(query))
      );
      renderContactsList(filtered);
    }
  });

  function renderChatsList(chats) {
    if (chatsCountBadge) {
      chatsCountBadge.textContent = (currentChats || []).length;
    }

    if (!chats || chats.length === 0) {
      chatsListContainer.innerHTML = `
        <div class="empty-chats-placeholder">
          <i class="fa-solid fa-comment-dots"></i>
          <p>No active chats yet</p>
          <span>Click the message icon above to start a conversation.</span>
        </div>
      `;
      return;
    }

    chatsListContainer.innerHTML = chats.map(c => {
      let rawPhone = c.phone || c.jid.split('@')[0];
      if (rawPhone.includes(':')) rawPhone = rawPhone.split(':')[0];

      const formattedDisplay = formatPhoneDisplay(rawPhone);
      const avatarLetter = rawPhone.replace(/\D/g, '').slice(-2) || 'WA';
      const timeStr = c.timestamp ? formatChatTime(c.timestamp) : '';
      const isSelected = areJidsMatching(selectedJid, c.jid) ? 'active' : '';

      return `
        <div class="chat-item ${isSelected}" data-jid="${c.jid}" data-name="${escapeHtml(formattedDisplay)}" data-phone="${rawPhone}">
          <div class="chat-item-avatar">${avatarLetter}</div>
          <div class="chat-item-content">
            <div class="chat-item-top">
              <span class="chat-item-title">${escapeHtml(formattedDisplay)}</span>
              <span class="chat-item-time">${timeStr}</span>
            </div>
            <div class="chat-item-sub">
              <span class="chat-item-snippet">${escapeHtml(c.lastMessage || '')}</span>
              ${c.unreadCount > 0 ? `<span class="unread-badge">${c.unreadCount}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    document.querySelectorAll('.chat-item').forEach(item => {
      item.addEventListener('click', () => {
        const jid = item.getAttribute('data-jid');
        const phone = item.getAttribute('data-phone');
        openChatThread(jid, phone);
      });
    });
  }

  async function openChatThread(jid, phone) {
    selectedJid = jid;
    renderChatsList(currentChats);

    chatEmptyState.classList.add('hidden');
    activeChatWrapper.classList.remove('hidden');

    const displayNum = formatPhoneDisplay(phone);
    activeChatAvatar.textContent = String(phone).replace(/\D/g, '').slice(-2) || 'WA';
    activeChatTitle.textContent = displayNum;
    activeChatSubtitle.textContent = displayNum;

    // Show owner badge for Admin
    const chatObj = currentChats.find(c => areJidsMatching(c.jid, jid));
    if (currentUser?.role === 'admin' && chatObj?.ownerName) {
      activeChatOwnerBadge.textContent = `Assigned: ${chatObj.ownerName}`;
      activeChatOwnerBadge.classList.remove('hidden');
    } else {
      activeChatOwnerBadge.classList.add('hidden');
    }

    chatMessagesContainer.innerHTML = '<div class="empty-chats-placeholder"><i class="fa-solid fa-spinner fa-spin"></i><p>Loading conversation...</p></div>';

    try {
      const res = await authFetch(`/api/chats/${encodeURIComponent(jid)}/messages`);
      const data = await res.json();

      if (data.success) {
        renderMessages(data.messages || []);
      } else {
        alert(data.message || 'Could not access this conversation.');
        activeChatWrapper.classList.add('hidden');
        chatPlaceholderState.classList.remove('hidden');
        loadChatsList();
      }
    } catch (err) {
      chatMessagesContainer.innerHTML = '<div class="empty-chats-placeholder"><p>Failed to load messages.</p></div>';
    }
  }

  function renderMessages(messages) {
    chatMessagesContainer.innerHTML = '';
    if (!messages || messages.length === 0) {
      chatMessagesContainer.innerHTML = `
        <div class="empty-chats-placeholder">
          <i class="fa-solid fa-hand-wave"></i>
          <p>No messages yet</p>
          <span>Send a message to start this candidate outreach conversation.</span>
        </div>
      `;
      return;
    }

    messages.forEach(msg => appendMessageBubble(msg));
    scrollToBottom();
  }

  function appendMessageBubble(msg) {
    const emptyPlaceholder = chatMessagesContainer.querySelector('.empty-chats-placeholder');
    if (emptyPlaceholder) emptyPlaceholder.remove();

    const isOutgoing = Boolean(msg.fromMe);
    const bubbleClass = isOutgoing ? 'msg-outgoing' : 'msg-incoming';
    const timeStr = formatMsgTime(msg.timestamp || Date.now());
    const tickHtml = isOutgoing ? getStatusTickHtml(msg.status) : '';

    let mediaHtml = '';
    if (msg.mediaUrl) {
      if (msg.mediaType === 'image') {
        mediaHtml = `<div class="msg-media-wrapper"><img src="${msg.mediaUrl}" class="msg-image" alt="Image" onclick="window.open('${msg.mediaUrl}', '_blank')"></div>`;
      } else if (msg.mediaType === 'video') {
        mediaHtml = `<div class="msg-media-wrapper"><video src="${msg.mediaUrl}" controls class="msg-video"></video></div>`;
      } else if (msg.mediaType === 'audio') {
        mediaHtml = `<div class="msg-media-wrapper"><audio src="${msg.mediaUrl}" controls class="msg-audio"></audio></div>`;
      } else {
        mediaHtml = `
          <div class="msg-doc-box" onclick="window.open('${msg.mediaUrl}', '_blank')">
            <i class="fa-solid fa-file-arrow-down doc-icon"></i>
            <span class="doc-name">${escapeHtml(msg.fileName || 'Attachment Document')}</span>
          </div>
        `;
      }
    }

    const textHtml = msg.text ? `<div class="msg-text">${escapeHtml(msg.text).replace(/\n/g, '<br>')}</div>` : '';

    const bubble = document.createElement('div');
    bubble.className = `msg-bubble ${bubbleClass}`;
    bubble.setAttribute('data-msg-id', msg.id || '');
    bubble.innerHTML = `
      ${mediaHtml}
      ${textHtml}
      <div class="msg-meta">
        <span class="msg-time">${timeStr}</span>
        ${tickHtml}
      </div>
    `;

    chatMessagesContainer.appendChild(bubble);
    scrollToBottom();
  }

  function getStatusTickHtml(status) {
    if (status === 'read') return '<span class="status-tick read"><i class="fa-solid fa-check-double"></i></span>';
    if (status === 'delivered') return '<span class="status-tick delivered"><i class="fa-solid fa-check-double"></i></span>';
    return '<span class="status-tick sent"><i class="fa-solid fa-check"></i></span>';
  }

  function scrollToBottom() {
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
  }

  // --- COMPOSER & SEND MESSAGE ---
  attachmentInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      selectedFile = file;
      attachmentName.textContent = file.name;
      attachmentPreviewTag.classList.remove('hidden');
    }
  });

  removeAttachmentBtn.addEventListener('click', () => {
    selectedFile = null;
    attachmentInput.value = '';
    attachmentPreviewTag.classList.add('hidden');
  });

  messageTextInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendMsgBtn.addEventListener('click', sendMessage);

  async function sendMessage() {
    const text = messageTextInput.value.trim();
    if (!text && !selectedFile) return;
    if (!selectedJid) {
      alert('Please select a conversation first.');
      return;
    }

    const formData = new FormData();
    formData.append('jid', selectedJid);
    if (text) formData.append('text', text);
    if (selectedFile) formData.append('attachment', selectedFile);

    // Optimistic UI clear
    messageTextInput.value = '';
    const tempFile = selectedFile;
    selectedFile = null;
    attachmentInput.value = '';
    attachmentPreviewTag.classList.add('hidden');

    try {
      sendMsgBtn.disabled = true;
      const res = await authFetch('/api/send-message', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (!data.success) {
        alert(data.message || 'Failed to send message.');
        messageTextInput.value = text;
        if (tempFile) {
          selectedFile = tempFile;
          attachmentName.textContent = tempFile.name;
          attachmentPreviewTag.classList.remove('hidden');
        }
      }
    } catch (err) {
      alert('Error sending message.');
    } finally {
      sendMsgBtn.disabled = false;
    }
  }

  // --- NEW CHAT MODAL ---
  newChatBtn.addEventListener('click', () => {
    newChatModal.classList.remove('hidden');
    newChatPhone.value = '';
    newChatMessage.value = '';
    newChatPhone.focus();
  });

  closeNewChatModal.addEventListener('click', () => {
    newChatModal.classList.add('hidden');
  });

  startChatSubmitBtn.addEventListener('click', async () => {
    const rawPhone = newChatPhone.value.trim();
    const initialText = newChatMessage.value.trim();
    const countryCode = document.getElementById('new-chat-country')?.value || '91';

    if (!rawPhone) {
      alert('Please enter a phone number (e.g. 9876543210).');
      return;
    }

    let clean = rawPhone.replace(/\D/g, '');
    if (countryCode !== 'custom') {
      if (clean.length === 10) {
        clean = countryCode + clean;
      } else if (!clean.startsWith(countryCode)) {
        clean = countryCode + clean;
      }
    }

    if (clean.length < 8) {
      alert('Please enter a valid phone number with at least 8 digits.');
      return;
    }

    const jid = `${clean}@s.whatsapp.net`;

    try {
      startChatSubmitBtn.disabled = true;
      const formData = new FormData();
      formData.append('jid', jid);
      formData.append('phone', clean);
      if (initialText) formData.append('text', initialText);

      const res = await authFetch('/api/send-message', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (data.success) {
        newChatModal.classList.add('hidden');
        openChatThread(jid, clean);
        loadChatsList();
      } else {
        alert(data.message || 'Could not start chat.');
      }
    } catch (err) {
      alert('Error starting new chat.');
    } finally {
      startChatSubmitBtn.disabled = false;
    }
  });

  // --- LINK PHONE MODAL ---
  if (linkPhoneBtn) {
    linkPhoneBtn.addEventListener('click', () => {
      if (!selectedJid) {
        alert('Please select a chat first.');
        return;
      }
      linkPhoneModal.classList.remove('hidden');
      linkPhoneInput.value = '';
      linkPhoneInput.focus();
    });
  }

  if (closeLinkPhoneModal) {
    closeLinkPhoneModal.addEventListener('click', () => {
      linkPhoneModal.classList.add('hidden');
    });
  }

  if (submitLinkPhoneBtn) {
    submitLinkPhoneBtn.addEventListener('click', async () => {
      const raw = linkPhoneInput.value.trim();
      const countryCode = document.getElementById('link-phone-country')?.value || '91';
      let clean = raw.replace(/\D/g, '');

      if (countryCode !== 'custom') {
        if (clean.length === 10) {
          clean = countryCode + clean;
        } else if (!clean.startsWith(countryCode)) {
          clean = countryCode + clean;
        }
      }

      if (!clean || clean.length < 8) {
        alert('Please enter a valid phone number.');
        return;
      }

      try {
        submitLinkPhoneBtn.disabled = true;
        const res = await authFetch('/api/contacts/link-phone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lid: selectedJid, phone: clean })
        });
        const data = await res.json();
        if (data.success) {
          linkPhoneModal.classList.add('hidden');
          selectedJid = data.jid;
          openChatThread(data.jid, data.phone);
          loadChatsList();
        } else {
          alert(data.message || 'Failed to link phone number.');
        }
      } catch (err) {
        alert('Error linking phone number.');
      } finally {
        submitLinkPhoneBtn.disabled = false;
      }
    });
  }

  // --- ADMIN RIGHT-SIDE DRAWER & EMPLOYEE MANAGEMENT ---
  if (toggleAdminDrawerBtn) {
    toggleAdminDrawerBtn.addEventListener('click', () => {
      adminDrawerPanel.classList.remove('hidden');
      adminDrawerBackdrop.classList.remove('hidden');
      loadEmployeesList();
    });
  }

  if (closeAdminDrawerBtn) {
    closeAdminDrawerBtn.addEventListener('click', closeAdminDrawer);
  }
  if (adminDrawerBackdrop) {
    adminDrawerBackdrop.addEventListener('click', closeAdminDrawer);
  }

  function closeAdminDrawer() {
    adminDrawerPanel.classList.add('hidden');
    adminDrawerBackdrop.classList.add('hidden');
  }

  // Drawer Tabs
  drawerTabEmp.addEventListener('click', () => switchDrawerTab('emp'));
  drawerTabContacts.addEventListener('click', () => switchDrawerTab('contacts'));
  drawerTabWa.addEventListener('click', () => switchDrawerTab('wa'));

  function switchDrawerTab(tab) {
    [drawerTabEmp, drawerTabContacts, drawerTabWa].forEach(t => t.classList.remove('active'));
    [drawerSecEmp, drawerSecContacts, drawerSecWa].forEach(s => s.classList.add('hidden'));

    if (tab === 'emp') {
      drawerTabEmp.classList.add('active');
      drawerSecEmp.classList.remove('hidden');
      loadEmployeesList();
    } else if (tab === 'contacts') {
      drawerTabContacts.classList.add('active');
      drawerSecContacts.classList.remove('hidden');
      loadDrawerContacts();
    } else {
      drawerTabWa.classList.add('active');
      drawerSecWa.classList.remove('hidden');
    }
  }

  // Employee Registration Form
  empRegisterForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = empRegName.value.trim();
    const rawPhone = empRegPhone.value.trim();
    const password = empRegPassword.value.trim();
    const countryCode = document.getElementById('emp-reg-country')?.value || '91';

    if (!name || !rawPhone || !password) return;

    let cleanPhone = rawPhone.replace(/\D/g, '');
    if (countryCode !== 'custom') {
      if (cleanPhone.length === 10) {
        cleanPhone = countryCode + cleanPhone;
      } else if (!cleanPhone.startsWith(countryCode)) {
        cleanPhone = countryCode + cleanPhone;
      }
    }

    try {
      empRegSubmitBtn.disabled = true;
      const res = await authFetch('/api/admin/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone: cleanPhone, password })
      });
      const data = await res.json();

      if (data.success) {
        alert('Employee registered successfully! They can now log in with their mobile number.');
        empRegName.value = '';
        empRegPhone.value = '';
        empRegPassword.value = '';
        loadEmployeesList();
      } else {
        alert(data.message || 'Failed to register employee.');
      }
    } catch (err) {
      alert('Error registering employee.');
    } finally {
      empRegSubmitBtn.disabled = false;
    }
  });

  async function loadEmployeesList() {
    try {
      const res = await authFetch('/api/admin/employees');
      const data = await res.json();

      if (data.success) {
        renderEmployeesList(data.employees || []);
      }
    } catch (e) {}
  }

  function renderEmployeesList(employees) {
    if (empTotalCount) empTotalCount.textContent = employees.length;

    if (!employees || employees.length === 0) {
      employeeListContainer.innerHTML = `
        <div style="padding: 20px; text-align: center; color: var(--wa-text-sub); font-size: 13px;">
          No employees registered yet. Register your staff above.
        </div>
      `;
      return;
    }

    employeeListContainer.innerHTML = employees.map(emp => `
      <div class="employee-row-card" data-phone="${emp.phone}">
        <div class="employee-info-col">
          <span class="employee-name">${escapeHtml(emp.name)}</span>
          <span class="employee-phone-id"><i class="fa-solid fa-mobile-screen"></i> ${escapeHtml(emp.phone)}</span>
        </div>
        <div class="employee-actions-col">
          <button type="button" class="mini-text-btn reset-emp-pwd-btn" title="Reset Password" data-phone="${emp.phone}">
            <i class="fa-solid fa-key"></i>
          </button>
          <button type="button" class="mini-text-btn delete-emp-btn" style="color: #f87171;" title="Delete Employee" data-phone="${emp.phone}" data-name="${escapeHtml(emp.name)}">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `).join('');

    document.querySelectorAll('.reset-emp-pwd-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const phone = btn.getAttribute('data-phone');
        const newPwd = prompt(`Enter new password for employee (${phone}):`);
        if (!newPwd) return;

        const res = await authFetch(`/api/admin/employees/${phone}/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newPassword: newPwd })
        });
        const data = await res.json();
        alert(data.message || 'Password reset completed.');
      });
    });

    document.querySelectorAll('.delete-emp-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const phone = btn.getAttribute('data-phone');
        const name = btn.getAttribute('data-name');
        if (!confirm(`Are you sure you want to remove ${name} (${phone})?`)) return;

        const res = await authFetch(`/api/admin/employees/${phone}`, {
          method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) {
          loadEmployeesList();
        } else {
          alert(data.message || 'Failed to remove employee.');
        }
      });
    });
  }

  async function loadDrawerContacts() {
    try {
      const res = await authFetch('/api/contacts');
      const data = await res.json();

      if (data.success) {
        const contacts = data.contacts || [];
        if (drawerContactsCount) drawerContactsCount.textContent = contacts.length;
        renderDrawerContacts(contacts);
      }
    } catch (e) {}
  }

  function renderDrawerContacts(contacts) {
    drawerContactsList.innerHTML = contacts.map(c => `
      <div class="contact-dir-item" data-jid="${c.jid}" data-phone="${c.phone}">
        <div class="contact-dir-avatar">${String(c.phone).slice(-2) || 'WA'}</div>
        <div class="contact-dir-info">
          <span class="contact-dir-phone">${escapeHtml(c.displayPhone)}</span>
          <span class="contact-dir-status">${c.hasChat ? 'Active Chat' : 'Synced'}</span>
        </div>
      </div>
    `).join('');

    drawerContactsList.querySelectorAll('.contact-dir-item').forEach(item => {
      item.addEventListener('click', () => {
        const jid = item.getAttribute('data-jid');
        const phone = item.getAttribute('data-phone');
        closeAdminDrawer();
        openChatThread(jid, phone);
      });
    });
  }

  if (drawerRelinkWaBtn) {
    drawerRelinkWaBtn.addEventListener('click', async () => {
      closeAdminDrawer();
      loginView.classList.remove('hidden');
      chatView.classList.add('hidden');
      qrImage.classList.add('hidden');
      qrPlaceholder.classList.remove('hidden');
      qrStatusText.textContent = 'Status: Resetting session and generating QR code...';

      try {
        await authFetch('/api/relink', { method: 'POST' });
      } catch (e) {
        console.error('Relink error:', e);
      }
    });
  }

  if (drawerLogoutWaBtn) {
    drawerLogoutWaBtn.addEventListener('click', async () => {
      if (confirm('Disconnect central WhatsApp session from phone?')) {
        await authFetch('/api/logout', { method: 'POST' });
        closeAdminDrawer();
      }
    });
  }

  // --- HELPERS ---
  function formatPhoneDisplay(rawPhone) {
    if (!rawPhone) return 'Contact';
    let clean = String(rawPhone).replace(/\D/g, '');
    if (clean.length === 12 && clean.startsWith('91')) {
      return `+91 ${clean.substring(2, 7)} ${clean.substring(7)}`;
    }
    if (clean.length === 10) {
      return `+91 ${clean.substring(0, 5)} ${clean.substring(5)}`;
    }
    return `+${clean}`;
  }

  function formatChatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatMsgTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Start Auth Check
  checkAuthSession();
});
