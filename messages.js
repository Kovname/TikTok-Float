'use strict';

const $ = (id) => document.getElementById(id);

const els = {
  backBtn: $('backBtn'),
  headerTitle: $('headerTitle'),
  unreadBadge: $('unreadBadge'),
  webModeBtn: $('webModeBtn'),
  refreshBtn: $('refreshBtn'),
  dockBtn: $('dockBtn'),
  closeBtn: $('closeBtn'),
  loginView: $('loginView'),
  loginQrBtn: $('loginQrBtn'),
  workspace: $('workspace'),
  webChatPane: $('webChatPane'),
  liveDmView: $('liveDmView'),
  inboxOpenWebBtn: $('inboxOpenWebBtn'),
  threadOpenWebBtn: $('threadOpenWebBtn'),
  chatSearch: $('chatSearch'),
  storiesBar: $('storiesBar'),
  inboxSkeleton: $('inboxSkeleton'),
  inboxEmpty: $('inboxEmpty'),
  chatList: $('chatList'),
  threadPlaceholder: $('threadPlaceholder'),
  threadActive: $('threadActive'),
  threadScroll: $('threadScroll'),
  loadOlderBtn: $('loadOlderBtn'),
  threadSkeleton: $('threadSkeleton'),
  threadEmpty: $('threadEmpty'),
  messagesList: $('messagesList'),
  composerForm: $('composerForm'),
  msgInput: $('msgInput'),
  sendBtn: $('sendBtn'),
  chatForwardSheet: $('chatForwardSheet'),
  chatForwardCopyBtn: $('chatForwardCopyBtn'),
  chatForwardCloseBtn: $('chatForwardCloseBtn'),
  chatForwardPreview: $('chatForwardPreview'),
  chatForwardSearch: $('chatForwardSearch'),
  chatForwardList: $('chatForwardList'),
  chatForwardNote: $('chatForwardNote'),
  chatForwardSendBtn: $('chatForwardSendBtn'),
  mediaLightbox: $('mediaLightbox'),
  lightboxImg: $('lightboxImg'),
  lightboxClose: $('lightboxClose'),
  toast: $('toast')
};

let chatForwardTarget = null;
let chatForwardContacts = [];
let chatForwardSelected = new Set();
let chatForwardSending = false;

let snapshot = {
  loggedIn: true,
  loading: true,
  conversations: [],
  stories: [],
  activeHeader: null,
  messages: [],
  unreadTotal: 0
};
let selectedChat = null;
let inThreadView = false;
let threadLoading = false;
let isSending = false;
let lastChatsSig = '';
let lastStoriesSig = '';
let lastMessagesSig = '';
let activeResizeEdge = null;
let resizeRaf = 0;
let toastTimer = null;
let inboxLoadTimer = null;
let inboxLoadTimedOut = false;
let webModeActive = false;
let webViewInitialized = false;

const LIVE_DM_CSS = `
  header,
  .header,
  #tiktok-sdk-tiktok-header-container,
  [data-e2e="top-navbar"],
  [class*="DivHeaderContainer"],
  .drawer-content,
  [class*="DivSideNavContainer"],
  [data-e2e="nav-bar"],
  [class*="BusinessSidebar"],
  [class*="SideNav"] {
    display: none !important;
  }
  html, body {
    background: #141418 !important;
    overflow: hidden !important;
  }
  .layout {
    padding-top: 0 !important;
    height: 100vh !important;
  }
  .message-iframe,
  .message-container,
  .contact-card-container {
    position: fixed !important;
    inset: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    max-width: none !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    border-radius: 0 !important;
    z-index: 50 !important;
  }
  .message-iframe iframe {
    width: 100vw !important;
    height: 100vh !important;
    border: 0 !important;
  }
  ::-webkit-scrollbar {
    width: 5px !important;
    height: 5px !important;
  }
  ::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.16) !important;
    border-radius: 999px !important;
  }
`;

function toggleWebMode(forceState) {
  webModeActive = typeof forceState === 'boolean' ? forceState : !webModeActive;
  if (els.webModeBtn) {
    els.webModeBtn.classList.toggle('active', webModeActive);
    els.webModeBtn.setAttribute('aria-pressed', String(webModeActive));
    els.webModeBtn.textContent = webModeActive ? 'iOS' : 'Веб';
  }
  if (els.webChatPane) {
    els.webChatPane.classList.toggle('hidden', !webModeActive);
  }
  if (webModeActive) {
    els.workspace.classList.add('hidden');
    els.loginView.classList.add('hidden');
    els.backBtn.classList.add('hidden');
    els.headerTitle.textContent = 'Сообщения · Веб';
    ensureLiveDmWebview();
  } else {
    const loggedOut = snapshot.loggedIn === false;
    els.loginView.classList.toggle('hidden', !loggedOut);
    els.workspace.classList.toggle('hidden', loggedOut);
    syncViewMode();
  }
}

function ensureLiveDmWebview() {
  if (!els.liveDmView || webViewInitialized) return;
  webViewInitialized = true;

  const injectCleanUi = () => {
    try {
      els.liveDmView.insertCSS(LIVE_DM_CSS).catch(() => {});
      els.liveDmView
        .executeJavaScript(
          `(() => {
            if (window.__TTF_LIVE_DM_HOOK__) return;
            window.__TTF_LIVE_DM_HOOK__ = true;
            document.addEventListener('click', (e) => {
              const a = e.target && e.target.closest ? e.target.closest('a[href*="/video/"], a[href*="/photo/"]') : null;
              if (a && a.href && /\\/(?:video|photo)\\/\\d+/.test(a.href)) {
                e.preventDefault();
                e.stopPropagation();
                window.open(a.href, '_blank');
              }
            }, true);
          })();`,
          true
        )
        .catch(() => {});
    } catch {}
  };

  els.liveDmView.addEventListener('dom-ready', injectCleanUi);
  els.liveDmView.addEventListener('did-finish-load', injectCleanUi);
  els.liveDmView.addEventListener('did-navigate-in-page', injectCleanUi);
  els.liveDmView.src = 'https://www.tiktok.com/messages?lang=ru';
}

document.addEventListener('DOMContentLoaded', init);

async function init() {
  if (!window.messagesApi) return;

  bindHeaderControls();
  bindResizeHandles();
  bindComposer();
  bindChatForwardSheet();

  window.messagesApi.onSnapshot(handleSnapshot);
  if (window.messagesApi.onShareContacts) {
    window.messagesApi.onShareContacts((info) => {
      if (info && Array.isArray(info.contacts) && info.contacts.length) {
        chatForwardContacts = info.contacts;
        if (chatForwardTarget) renderChatForwardList();
      }
    });
  }
  window.messagesApi.onWindowState((info) => {
    if (info) updateDockUI(Boolean(info.docked));
  });

  armInboxLoadTimeout();
  renderStoriesBar();

  try {
    const initial = await window.messagesApi.getInitialState();
    if (initial) {
      updateDockUI(Boolean(initial.docked));
      if (initial.snapshot) handleSnapshot(initial.snapshot);
    }
  } catch (err) {
    console.error(err);
  }
}

function armInboxLoadTimeout() {
  clearTimeout(inboxLoadTimer);
  inboxLoadTimedOut = false;
  inboxLoadTimer = setTimeout(() => {
    const convs = Array.isArray(snapshot.conversations) ? snapshot.conversations : [];
    if (convs.length === 0) {
      inboxLoadTimedOut = true;
      renderChatList();
    }
  }, 5000);
}

function bindHeaderControls() {
  els.closeBtn.addEventListener('click', () => window.messagesApi.close());
  if (els.webModeBtn) {
    els.webModeBtn.addEventListener('click', () => toggleWebMode());
  }
  if (els.inboxOpenWebBtn) {
    els.inboxOpenWebBtn.addEventListener('click', () => toggleWebMode(true));
  }
  if (els.threadOpenWebBtn) {
    els.threadOpenWebBtn.addEventListener('click', () => toggleWebMode(true));
  }
  els.refreshBtn.addEventListener('click', async () => {
    toast('Обновляю сообщения…');
    armInboxLoadTimeout();
    if (webModeActive && els.liveDmView && webViewInitialized) {
      try { els.liveDmView.reload(); } catch {}
    }
    await window.messagesApi.refresh();
  });
  els.dockBtn.addEventListener('click', async () => {
    const res = await window.messagesApi.toggleDock();
    if (res) {
      updateDockUI(Boolean(res.docked));
      toast(res.docked ? 'Окно прикреплено к видео' : 'Свободное перемещение');
    }
  });
  els.backBtn.addEventListener('click', () => {
    inThreadView = false;
    syncViewMode();
  });
  els.loginQrBtn.addEventListener('click', () => {
    window.messagesApi.openQrLogin();
    toast('Отсканируй QR-код в основном окне');
  });
  els.chatSearch.addEventListener('input', () => {
    lastChatsSig = '';
    renderChatList();
  });
  els.loadOlderBtn.addEventListener('click', async () => {
    els.loadOlderBtn.textContent = 'Подгружаю…';
    await window.messagesApi.loadOlder();
    els.loadOlderBtn.textContent = 'Загрузить ранние';
  });

  els.lightboxClose.addEventListener('click', closeLightbox);
  els.mediaLightbox.addEventListener('click', (e) => {
    if (e.target === els.mediaLightbox) closeLightbox();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!els.mediaLightbox.classList.contains('hidden')) {
        closeLightbox();
      } else if (inThreadView && window.innerWidth < 580) {
        inThreadView = false;
        syncViewMode();
      } else {
        window.messagesApi.close();
      }
    }
  });
}

function bindResizeHandles() {
  const zones = document.querySelectorAll('.resize-zone');
  for (const zone of zones) {
    zone.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      activeResizeEdge = zone.dataset.resize;
      zone.setPointerCapture(e.pointerId);
      window.messagesApi.startResize(activeResizeEdge);
    });

    zone.addEventListener('pointermove', () => {
      if (!activeResizeEdge) return;
      if (!resizeRaf) {
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = 0;
          if (activeResizeEdge) window.messagesApi.updateResize();
        });
      }
    });

    const finish = (e) => {
      if (!activeResizeEdge) return;
      activeResizeEdge = null;
      if (resizeRaf) {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = 0;
      }
      try { zone.releasePointerCapture(e.pointerId); } catch {}
      window.messagesApi.endResize();
    };

    zone.addEventListener('pointerup', finish);
    zone.addEventListener('pointercancel', finish);
  }
}

function bindComposer() {
  const syncInput = () => {
    els.msgInput.style.height = '32px';
    els.msgInput.style.height = Math.max(32, Math.min(92, els.msgInput.scrollHeight)) + 'px';
    els.sendBtn.disabled = !els.msgInput.value.trim() || isSending;
  };

  els.msgInput.addEventListener('input', syncInput);
  els.msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!els.sendBtn.disabled) submitMessage();
    }
  });
  els.composerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submitMessage();
  });
}

function updateDockUI(docked) {
  els.dockBtn.classList.toggle('active', docked);
  els.dockBtn.setAttribute('aria-pressed', String(docked));
  els.dockBtn.title = docked
    ? 'Окно прикреплено рядом с видео · нажми, чтобы открепить'
    : 'Прикрепить рядом с видео';
}

function syncViewMode() {
  if (webModeActive) {
    els.backBtn.classList.add('hidden');
    els.headerTitle.textContent = 'Сообщения · Веб';
    return;
  }
  const showThread = Boolean(inThreadView && selectedChat);
  els.workspace.classList.toggle('in-thread', showThread);
  els.backBtn.classList.toggle('hidden', !showThread);

  if (showThread && selectedChat) {
    els.headerTitle.textContent = selectedChat.name;
    els.unreadBadge.classList.add('hidden');
  } else {
    els.headerTitle.textContent = 'Сообщения';
    const unread = Number(snapshot.unreadTotal || 0);
    els.unreadBadge.textContent = String(unread);
    els.unreadBadge.classList.toggle('hidden', unread <= 0);
  }
}

function handleSnapshot(next) {
  if (!next || typeof next !== 'object') return;
  if (threadLoading && selectedChat) {
    const want = String(selectedChat.name || '').trim().toLowerCase();
    const got = String((next.activeHeader && next.activeHeader.name) || '').trim().toLowerCase();
    if (want && got && got !== want && !got.includes(want)) {
      snapshot = { ...next, messages: [] };
      renderChatList();
      return;
    }
  }
  snapshot = next;

  const loggedOut = next.loggedIn === false;
  if (!webModeActive) {
    els.loginView.classList.toggle('hidden', !loggedOut);
    els.workspace.classList.toggle('hidden', loggedOut);
  }
  if (loggedOut && !webModeActive) {
    els.headerTitle.textContent = 'Сообщения';
    els.backBtn.classList.add('hidden');
    els.unreadBadge.classList.add('hidden');
    return;
  }

  if (!selectedChat && next.activeHeader && next.activeHeader.name && window.innerWidth >= 580) {
    selectedChat = {
      id: (next.activeHeader.handle || next.activeHeader.name).toLowerCase(),
      name: next.activeHeader.name,
      handle: next.activeHeader.handle || '',
      avatar: next.activeHeader.avatar || ''
    };
  }

  if (Array.isArray(next.conversations) && next.conversations.length > 0) {
    clearTimeout(inboxLoadTimer);
    inboxLoadTimedOut = false;
  }

  syncViewMode();
  renderStoriesBar();
  renderChatList();
  renderMessages();
}

function renderStoriesBar() {
  if (!els.storiesBar) return;
  if (snapshot.loggedIn === false) {
    els.storiesBar.classList.add('hidden');
    return;
  }

  // Показываем ТОЛЬКО реальные истории из snapshot.stories — никогда не присваиваем истории случайным чатам!
  const rawStories = Array.isArray(snapshot.stories) ? snapshot.stories : [];

  const merged = [];
  const seen = new Set();
  for (const item of rawStories) {
    if (!item || !item.name) continue;
    const key = String(item.id || item.handle || item.name).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push({
      id: key,
      name: String(item.name).trim(),
      handle: String(item.handle || '').replace(/^@/, '').trim(),
      avatar: String(item.avatar || ''),
      url: String(item.url || ''),
      hasStory: true
    });
  }

  const sig = merged
    .map((s) => s.id + '|' + s.name + '|' + s.avatar)
    .join('\n');
  els.storiesBar.classList.remove('hidden');
  if (sig === lastStoriesSig && els.storiesBar.childElementCount > 0) return;
  lastStoriesSig = sig;

  const frag = document.createDocumentFragment();

  // 1-й элемент: «Все истории» -> открывает ленту друзей/историй в основном плеере
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'story-chip';
  allBtn.setAttribute('role', 'listitem');
  allBtn.title = 'Открыть ленту историй друзей в основном плеере';
  allBtn.innerHTML = `
    <span class="story-ring all-stories">
      <span class="story-ring-inner">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke-dasharray="4 3"></circle>
          <polygon points="10 8.5 16 12 10 15.5 10 8.5" fill="currentColor" stroke="none"></polygon>
        </svg>
      </span>
    </span>
    <span class="story-name">Истории</span>`;
  allBtn.addEventListener('click', () => {
    toast('Открываю истории друзей в плеере…');
    if (window.messagesApi.openStoryInPlayer) {
      window.messagesApi.openStoryInPlayer({ isFriendsFeed: true });
    }
  });
  frag.appendChild(allBtn);

  for (const story of merged) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'story-chip';
    chip.setAttribute('role', 'listitem');
    chip.title = story.hasStory
      ? 'Открыть историю ' + story.name
      : 'Открыть публикации и истории ' + story.name;

    const ring = document.createElement('span');
    ring.className = 'story-ring' + (story.hasStory ? ' has-story' : '');
    const inner = document.createElement('span');
    inner.className = 'story-ring-inner';
    if (story.avatar) {
      const img = document.createElement('img');
      img.src = story.avatar;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => {
        img.remove();
        inner.textContent = story.name.charAt(0).toUpperCase() || 'U';
      });
      inner.appendChild(img);
    } else {
      inner.textContent = story.name.charAt(0).toUpperCase() || 'U';
    }
    ring.appendChild(inner);

    const label = document.createElement('span');
    label.className = 'story-name';
    label.textContent = story.name;

    chip.appendChild(ring);
    chip.appendChild(label);
    chip.addEventListener('click', () => {
      toast('Открываю: ' + story.name);
      if (window.messagesApi.openStoryInPlayer) {
        if (story.url) {
          window.messagesApi.openStoryInPlayer({
            url: story.url,
            friendName: story.name,
            isFriendsFeed: false
          });
        } else {
          window.messagesApi.openStoryInPlayer({
            isFriendsFeed: true,
            friendName: story.name
          });
        }
      }
    });
    frag.appendChild(chip);
  }

  els.storiesBar.innerHTML = '';
  els.storiesBar.appendChild(frag);
}

function renderChatList() {
  const convs = Array.isArray(snapshot.conversations) ? snapshot.conversations : [];

  if (convs.length === 0 && snapshot.loading && !inboxLoadTimedOut) {
    els.chatList.innerHTML = '';
    lastChatsSig = '';
    els.inboxSkeleton.classList.remove('hidden');
    els.inboxEmpty.classList.add('hidden');
    return;
  }
  els.inboxSkeleton.classList.add('hidden');

  const query = els.chatSearch.value.trim().toLowerCase();
  const filtered = query
    ? convs.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          (c.handle && c.handle.toLowerCase().includes(query)) ||
          (c.lastMessage && c.lastMessage.toLowerCase().includes(query))
      )
    : convs;

  els.inboxEmpty.classList.toggle('hidden', filtered.length > 0);

  const activeId = selectedChat ? selectedChat.id : '';
  const sig =
    activeId +
    '::' +
    filtered
      .map((c) => c.id + '|' + c.name + '|' + c.lastMessage + '|' + c.timeText + '|' + c.unreadCount)
      .join('\n');
  if (sig === lastChatsSig) return;
  lastChatsSig = sig;

  const frag = document.createDocumentFragment();
  for (const chat of filtered) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    const isActive = activeId === chat.id;
    btn.className =
      'chat-row' +
      (isActive ? ' active' : '') +
      (chat.unreadCount > 0 ? ' has-unread' : '');
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', String(isActive));

    const ava = document.createElement('div');
    ava.className = 'ava-wrap';
    if (chat.avatar) {
      const img = document.createElement('img');
      img.src = chat.avatar;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => {
        img.remove();
        ava.textContent = chat.name.charAt(0).toUpperCase() || 'U';
      });
      ava.appendChild(img);
    } else {
      ava.textContent = chat.name.charAt(0).toUpperCase() || 'U';
    }

    const meta = document.createElement('div');
    meta.className = 'chat-meta';

    const top = document.createElement('div');
    top.className = 'chat-top';
    const nameEl = document.createElement('span');
    nameEl.className = 'chat-name';
    nameEl.textContent = chat.name;
    top.appendChild(nameEl);

    if (chat.timeText) {
      const timeEl = document.createElement('span');
      timeEl.className = 'chat-time tabular';
      timeEl.textContent = chat.timeText;
      top.appendChild(timeEl);
    }

    const bottom = document.createElement('div');
    bottom.className = 'chat-bottom';
    const prevEl = document.createElement('span');
    prevEl.className = 'chat-preview';
    prevEl.textContent = chat.lastMessage || 'Переписка TikTok';
    bottom.appendChild(prevEl);

    if (chat.unreadCount > 0) {
      const pill = document.createElement('span');
      pill.className = 'unread-pill tabular';
      pill.textContent = chat.unreadCount > 99 ? '99+' : String(chat.unreadCount);
      bottom.appendChild(pill);
    }

    meta.appendChild(top);
    meta.appendChild(bottom);
    btn.appendChild(ava);
    btn.appendChild(meta);

    btn.addEventListener('click', () => selectConversation(chat));
    li.appendChild(btn);
    frag.appendChild(li);
  }

  els.chatList.innerHTML = '';
  els.chatList.appendChild(frag);
}

async function selectConversation(chat) {
  selectedChat = chat;
  inThreadView = true;
  threadLoading = true;
  snapshot = { ...snapshot, messages: [] };
  lastChatsSig = '';
  lastMessagesSig = '';
  syncViewMode();
  renderChatList();
  els.threadPlaceholder.classList.add('hidden');
  els.threadActive.classList.remove('hidden');
  els.messagesList.innerHTML = '';
  els.threadEmpty.classList.add('hidden');
  els.loadOlderBtn.classList.add('hidden');
  els.threadSkeleton.classList.remove('hidden');

  try {
    await window.messagesApi.openChat({
      chatId: chat.id,
      index: chat.index,
      name: chat.name
    });
  } finally {
    threadLoading = false;
    els.threadSkeleton.classList.add('hidden');
    renderMessages();
  }
}

function renderMessages() {
  const hasThread = Boolean(selectedChat);
  els.threadPlaceholder.classList.toggle('hidden', hasThread);
  els.threadActive.classList.toggle('hidden', !hasThread);
  if (!hasThread) return;

  const list = Array.isArray(snapshot.messages) ? snapshot.messages : [];

  if (threadLoading && list.length === 0) {
    els.threadSkeleton.classList.remove('hidden');
    els.threadEmpty.classList.add('hidden');
    els.loadOlderBtn.classList.add('hidden');
    return;
  }

  els.threadSkeleton.classList.add('hidden');
  els.threadEmpty.classList.toggle('hidden', list.length > 0);
  els.loadOlderBtn.classList.toggle('hidden', list.length < 10);

  if (list.length === 0) {
    els.messagesList.innerHTML = '';
    lastMessagesSig = '';
    return;
  }

  const sig =
    selectedChat.id +
    '::' +
    list
      .map(
        (m) =>
          m.id +
          '|' +
          (m.text || '') +
          '|' +
          (m.forwardedComment ? m.forwardedComment.author + m.forwardedComment.text : '') +
          '|' +
          (m.isStory ? 'S' : '') +
          '|' +
          (m.video ? m.video.url + m.video.thumb : '')
      )
      .join('\n');
  if (sig === lastMessagesSig) return;

  const wasAtBottom =
    els.threadScroll.scrollHeight - els.threadScroll.scrollTop - els.threadScroll.clientHeight < 64;
  lastMessagesSig = sig;

  const frag = document.createDocumentFragment();
  for (const m of list) {
    if (m.kind === 'date') {
      const sep = document.createElement('div');
      sep.className = 'date-sep';
      sep.textContent = m.text;
      frag.appendChild(sep);
      continue;
    }

    const row = document.createElement('div');
    row.className = 'msg-row ' + (m.sender === 'me' ? 'me' : 'them');

    if (m.forwardedComment) {
      const fcCard = document.createElement('div');
      fcCard.className = 'forwarded-comment-card';

      const fcHead = document.createElement('div');
      fcHead.className = 'fc-head';

      const fcBadge = document.createElement('div');
      fcBadge.className = 'fc-badge';
      fcBadge.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
        </svg>`;
      const fcAuthor = document.createElement('span');
      fcAuthor.className = 'fc-author';
      fcAuthor.textContent = m.forwardedComment.author || 'Комментарий';
      fcBadge.appendChild(fcAuthor);
      fcHead.appendChild(fcBadge);

      const fcFwdBtn = document.createElement('button');
      fcFwdBtn.type = 'button';
      fcFwdBtn.className = 'fc-forward-btn';
      fcFwdBtn.textContent = 'Переслать';
      fcFwdBtn.addEventListener('click', () => {
        openChatForwardSheet({
          authorName: m.forwardedComment.author || 'Пользователь',
          text: m.forwardedComment.text || '',
          videoUrl: (m.video && m.video.url) || m.forwardedComment.videoUrl || ''
        });
      });
      fcHead.appendChild(fcFwdBtn);
      fcCard.appendChild(fcHead);

      const fcQuote = document.createElement('div');
      fcQuote.className = 'fc-quote';
      fcQuote.textContent = '«' + (m.forwardedComment.text || '') + '»';
      fcCard.appendChild(fcQuote);

      const fcVideoUrl = (m.video && m.video.url) || m.forwardedComment.videoUrl || '';
      if (fcVideoUrl && !m.video) {
        const fcVideoBtn = document.createElement('button');
        fcVideoBtn.type = 'button';
        fcVideoBtn.className = 'fc-video-btn';
        fcVideoBtn.textContent = 'Смотреть видео в плеере ▶';
        fcVideoBtn.addEventListener('click', async () => {
          toast('Открываю ролик в плеере…');
          await window.messagesApi.openVideoInPlayer({
            url: fcVideoUrl,
            domIndex: m.domIndex,
            chatName: selectedChat ? selectedChat.name : 'Чат'
          });
        });
        fcCard.appendChild(fcVideoBtn);
      }

      row.appendChild(fcCard);
    }

    if (m.video) {
      const vCard = document.createElement('button');
      vCard.type = 'button';
      vCard.className = 'video-card';
      vCard.title = 'Открыть ролик в основном плеере';

      if (m.video.thumb) {
        const img = document.createElement('img');
        img.className = 'video-thumb';
        img.src = m.video.thumb;
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        vCard.appendChild(img);
      }

      const scrim = document.createElement('div');
      scrim.className = 'video-scrim';
      vCard.appendChild(scrim);

      const playBadge = document.createElement('div');
      playBadge.className = 'video-play-badge';
      playBadge.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 5.5v13l10.5-6.5L8 5.5z" fill="currentColor"></path>
        </svg>`;
      vCard.appendChild(playBadge);

      const foot = document.createElement('div');
      foot.className = 'video-card-foot';
      const vAuth = document.createElement('span');
      vAuth.className = 'video-card-author';
      vAuth.textContent = m.video.author || 'Видео TikTok';
      const vCta = document.createElement('span');
      vCta.className = 'video-card-cta';
      vCta.textContent = 'Смотреть в плеере';
      foot.appendChild(vAuth);
      foot.appendChild(vCta);
      vCard.appendChild(foot);

      vCard.addEventListener('click', async () => {
        toast('Открываю ролик в плеере…');
        const ok = await window.messagesApi.openVideoInPlayer({
          url: m.video.url,
          domIndex: m.video.domIndex,
          needsClickResolve: Boolean(m.video.needsClickResolve),
          chatName: selectedChat ? selectedChat.name : 'Чат'
        });
        if (!ok) {
          toast('Не удалось получить ссылку на этот ролик');
        }
      });

      row.appendChild(vCard);
    }

    if (Array.isArray(m.images) && m.images.length) {
      for (const src of m.images) {
        const imgBtn = document.createElement('button');
        imgBtn.type = 'button';
        imgBtn.className = 'msg-img-btn';
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        imgBtn.appendChild(img);
        imgBtn.addEventListener('click', () => openLightbox(src));
        row.appendChild(imgBtn);
      }
    }

    if (m.text) {
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble';
      bubble.textContent = m.text;
      row.appendChild(bubble);
    }

    if (m.isStory) {
      const storyBtn = document.createElement('button');
      storyBtn.type = 'button';
      storyBtn.className = 'story-badge-btn';
      storyBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke-dasharray="4 3"></circle>
          <polygon points="10 8.5 16 12 10 15.5 10 8.5" fill="currentColor" stroke="none"></polygon>
        </svg>
        <span>История друга · Смотреть</span>`;
      storyBtn.addEventListener('click', () => {
        toast('Открываю историю друга в плеере…');
        if (window.messagesApi.openStoryInPlayer) {
          const handle = selectedChat && selectedChat.handle ? String(selectedChat.handle).replace(/^@/, '') : '';
          window.messagesApi.openStoryInPlayer(
            handle
              ? {
                  url: 'https://www.tiktok.com/@' + handle,
                  friendName: selectedChat ? selectedChat.name : 'История',
                  isFriendsFeed: false
                }
              : {
                  isFriendsFeed: true,
                  friendName: selectedChat ? selectedChat.name : 'Истории друзей'
                }
          );
        }
      });
      row.appendChild(storyBtn);
    }

    if (m.timeText) {
      const t = document.createElement('span');
      t.className = 'msg-time tabular';
      t.textContent = m.timeText;
      row.appendChild(t);
    }

    frag.appendChild(row);
  }

  els.messagesList.innerHTML = '';
  els.messagesList.appendChild(frag);

  if (wasAtBottom || list.length <= 20) {
    requestAnimationFrame(() => {
      els.threadScroll.scrollTop = els.threadScroll.scrollHeight;
    });
  }
}

async function submitMessage() {
  const text = els.msgInput.value.trim();
  if (!text || isSending || !selectedChat) return;

  isSending = true;
  els.sendBtn.disabled = true;

  try {
    const res = await window.messagesApi.sendMessage(text);
    if (res && res.ok) {
      els.msgInput.value = '';
      els.msgInput.style.height = '32px';
    } else {
      toast('Не удалось отправить сообщение');
    }
  } finally {
    isSending = false;
    els.sendBtn.disabled = !els.msgInput.value.trim();
  }
}

function openLightbox(src) {
  if (!src) return;
  els.lightboxImg.src = src;
  els.mediaLightbox.classList.remove('hidden');
}

function closeLightbox() {
  els.mediaLightbox.classList.add('hidden');
  els.lightboxImg.removeAttribute('src');
}

function toast(message) {
  if (!message) return;
  els.toast.textContent = message;
  els.toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('visible');
  }, 2200);
}

/* ─── Пересылка комментария другому контакту прямо из чата ───────── */

function bindChatForwardSheet() {
  if (!els.chatForwardSheet) return;
  els.chatForwardCloseBtn.addEventListener('click', closeChatForwardSheet);
  els.chatForwardSheet.addEventListener('click', (e) => {
    if (e.target === els.chatForwardSheet) closeChatForwardSheet();
  });
  els.chatForwardSearch.addEventListener('input', renderChatForwardList);
  els.chatForwardSendBtn.addEventListener('click', submitChatForward);
  els.chatForwardCopyBtn.addEventListener('click', async () => {
    if (!chatForwardTarget) return;
    const txt =
      '💬 Комментарий ' +
      (chatForwardTarget.authorName || 'Пользователь') +
      ': «' +
      (chatForwardTarget.text || '') +
      '»' +
      (chatForwardTarget.videoUrl ? '\n' + chatForwardTarget.videoUrl : '');
    await window.messagesApi.copyText(txt);
    toast('Комментарий скопирован');
    closeChatForwardSheet();
  });
}

async function openChatForwardSheet(targetObj) {
  if (!targetObj || !els.chatForwardSheet) return;
  chatForwardTarget = targetObj;
  chatForwardSelected.clear();
  els.chatForwardSearch.value = '';
  els.chatForwardNote.value = '';
  els.chatForwardPreview.textContent =
    '💬 ' + (targetObj.authorName || 'Комментарий') + ': «' + (targetObj.text || '') + '»';

  chatForwardContacts = Array.isArray(snapshot.conversations)
    ? snapshot.conversations.map((c) => ({
        id: c.id,
        name: c.name,
        handle: c.handle || '',
        avatar: c.avatar || ''
      }))
    : [];

  els.chatForwardSheet.classList.remove('hidden');
  renderChatForwardList();

  try {
    if (window.messagesApi.getShareContacts) {
      const info = await window.messagesApi.getShareContacts();
      if (info && Array.isArray(info.contacts) && info.contacts.length) {
        chatForwardContacts = info.contacts;
        if (chatForwardTarget) renderChatForwardList();
      }
    }
  } catch {}
}

function closeChatForwardSheet() {
  chatForwardTarget = null;
  chatForwardSelected.clear();
  if (els.chatForwardSheet) els.chatForwardSheet.classList.add('hidden');
}

function renderChatForwardList() {
  if (!els.chatForwardSheet || els.chatForwardSheet.classList.contains('hidden')) return;
  const q = els.chatForwardSearch.value.trim().toLowerCase();
  const filtered = q
    ? chatForwardContacts.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.handle && c.handle.toLowerCase().includes(q))
      )
    : chatForwardContacts;

  const frag = document.createDocumentFragment();
  for (const c of filtered) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    const isSel = chatForwardSelected.has(c.id);
    btn.className = 'chat-row' + (isSel ? ' active' : '');

    const ava = document.createElement('div');
    ava.className = 'ava-wrap';
    if (c.avatar) {
      const img = document.createElement('img');
      img.src = c.avatar;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      ava.appendChild(img);
    } else {
      ava.textContent = c.name.charAt(0).toUpperCase() || 'U';
    }

    const meta = document.createElement('div');
    meta.className = 'chat-meta';
    const nameEl = document.createElement('span');
    nameEl.className = 'chat-name';
    nameEl.textContent = c.name;
    meta.appendChild(nameEl);

    btn.appendChild(ava);
    btn.appendChild(meta);
    btn.addEventListener('click', () => {
      if (chatForwardSelected.has(c.id)) chatForwardSelected.delete(c.id);
      else chatForwardSelected.add(c.id);
      renderChatForwardList();
    });
    li.appendChild(btn);
    frag.appendChild(li);
  }

  els.chatForwardList.innerHTML = '';
  if (filtered.length === 0) {
    const emptyLi = document.createElement('li');
    emptyLi.className = 'chat-forward-empty';
    emptyLi.textContent = q ? 'Контакты не найдены' : 'Загружаю контакты TikTok…';
    els.chatForwardList.appendChild(emptyLi);
  } else {
    els.chatForwardList.appendChild(frag);
  }
  els.chatForwardSendBtn.disabled = chatForwardSelected.size === 0 || chatForwardSending;
  els.chatForwardSendBtn.textContent = chatForwardSending
    ? 'Отправка…'
    : chatForwardSelected.size > 1
      ? 'Отправить (' + chatForwardSelected.size + ')'
      : 'Отправить';
}

async function submitChatForward() {
  if (chatForwardSending || !chatForwardTarget || chatForwardSelected.size === 0) return;
  const chosen = chatForwardContacts.filter((c) => chatForwardSelected.has(c.id));
  if (!chosen.length) return;

  chatForwardSending = true;
  renderChatForwardList();

  try {
    const res = await window.messagesApi.forwardComment({
      fromChat: true,
      contacts: chosen,
      comment: {
        authorName: chatForwardTarget.authorName,
        text: chatForwardTarget.text
      },
      video: {
        videoUrl: chatForwardTarget.videoUrl || ''
      },
      note: els.chatForwardNote.value.trim()
    });
    if (res && res.ok) {
      toast('Комментарий переслан');
      closeChatForwardSheet();
    } else if (res && res.loginRequired) {
      toast('Войди в TikTok по QR-коду');
    } else {
      toast('Не удалось переслать — проверь вход в TikTok');
    }
  } finally {
    chatForwardSending = false;
    renderChatForwardList();
  }
}
