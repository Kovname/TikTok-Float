'use strict';

const INJECT = window.TTF_INJECT || { controller: '', css: '' };
const FALLBACK_URL = 'https://www.tiktok.com/foryou?lang=ru';
const ZOOM_STEPS = [0.75, 0.8, 0.85, 0.9, 1, 1.1, 1.25];
const SPEED_CYCLE = [1, 1.5, 2, 0.5];
const SPEED_ALL = [0.5, 1, 1.25, 1.5, 2];
const HOLD_DELAY_MS = 220;
const HOLD_COMPLETE_MS = 600;
const DOUBLE_CLICK_MS = 320;
const RING_CIRCUMFERENCE = 2 * Math.PI * 27;

const ICONS = {
  play: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.2 5.6v12.8l10.2-6.4L8.2 5.6z" fill="currentColor"></path>
    </svg>`,
  pause: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="5.5" width="3.5" height="13" rx="1.2" fill="currentColor"></rect>
      <rect x="13.5" y="5.5" width="3.5" height="13" rx="1.2" fill="currentColor"></rect>
    </svg>`,
  volume: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M11 5L6 9H3v6h3l5 4V5z"></path>
      <path d="M15.5 8.5a5 5 0 0 1 0 7"></path>
      <path d="M18.5 5.5a9 9 0 0 1 0 13"></path>
    </svg>`,
  volumeLow: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M11 5L6 9H3v6h3l5 4V5z"></path>
      <path d="M15.5 8.5a5 5 0 0 1 0 7"></path>
    </svg>`,
  muted: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M11 5L6 9H3v6h3l5 4V5z"></path>
      <path d="M16 9l5 6"></path>
      <path d="M21 9l-5 6"></path>
    </svg>`
};

const $ = (id) => document.getElementById(id);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const els = {
  bezel: $('bezel'),
  stage: $('stage'),
  view: $('view'),
  dmVideoView: $('dmVideoView'),
  gestureLayer: $('gestureLayer'),
  heartLayer: $('heartLayer'),
  holdRing: $('holdRing'),
  holdRingProgress: $('holdRingProgress'),
  centerGlyph: $('centerGlyph'),
  dragPill: $('dragPill'),
  statusDot: $('statusDot'),
  statusText: $('statusText'),
  modeBanner: $('modeBanner'),
  modeBannerText: $('modeBannerText'),
  modeDoneBtn: $('modeDoneBtn'),

  sourceTabs: $('sourceTabs'),
  tabFeedBtn: $('tabFeedBtn'),
  tabChatWrap: $('tabChatWrap'),
  tabChatBtn: $('tabChatBtn'),
  tabChatCloseBtn: $('tabChatCloseBtn'),

  closeBtn: $('closeBtn'),
  minBtn: $('minBtn'),
  messagesBtn: $('messagesBtn'),
  messagesUnreadDot: $('messagesUnreadDot'),
  pinBtn: $('pinBtn'),
  sizeBtn: $('sizeBtn'),
  moreBtn: $('moreBtn'),

  hudAvatar: $('hudAvatar'),
  hudAvatarFallback: $('hudAvatarFallback'),
  hudHandle: $('hudHandle'),
  hudLikedBadge: $('hudLikedBadge'),
  hudRepostBadge: $('hudRepostBadge'),
  hudDesc: $('hudDesc'),
  hudMusicRow: $('hudMusicRow'),
  hudMusic: $('hudMusic'),
  hudLikeBtn: $('hudLikeBtn'),
  hudLikeCount: $('hudLikeCount'),
  hudCommentBtn: $('hudCommentBtn'),
  hudCommentCount: $('hudCommentCount'),
  hudShareBtn: $('hudShareBtn'),
  hudRepostBtn: $('hudRepostBtn'),
  hudRepostLabel: $('hudRepostLabel'),

  prevBtn: $('prevBtn'),
  playBtn: $('playBtn'),
  nextBtn: $('nextBtn'),
  volumeControl: $('volumeControl'),
  volumePopover: $('volumePopover'),
  volumePopoverVal: $('volumePopoverVal'),
  volumeTrack: $('volumeTrack'),
  volumeFill: $('volumeFill'),
  volumeThumb: $('volumeThumb'),
  muteBtn: $('muteBtn'),
  speedBtn: $('speedBtn'),
  autoBtn: $('autoBtn'),
  autoLabel: $('autoLabel'),
  scrubber: $('scrubber'),
  scrubberFill: $('scrubberFill'),

  settingsSheet: $('settingsSheet'),
  speedMeta: $('speedMeta'),
  speedChips: $('speedChips'),
  autoStatusMeta: $('autoStatusMeta'),
  modeIntervalBtn: $('modeIntervalBtn'),
  modeEndBtn: $('modeEndBtn'),
  intervalChips: $('intervalChips'),
  skipLivesBtn: $('skipLivesBtn'),
  skipLivesMeta: $('skipLivesMeta'),
  sizeMeta: $('sizeMeta'),
  presetChips: $('presetChips'),
  volumeSlider: $('volumeSlider'),
  volumeSettingsVal: $('volumeSettingsVal'),
  opacityInput: $('opacity'),
  opacityVal: $('opacityVal'),
  zoomOutBtn: $('zoomOutBtn'),
  zoomVal: $('zoomVal'),
  zoomInBtn: $('zoomInBtn'),
  qrLoginBtn: $('qrLoginBtn'),
  siteMenuBtn: $('siteMenuBtn'),
  reloadBtn: $('reloadBtn'),
  browserBtn: $('browserBtn'),

  shareSheet: $('shareSheet'),
  shareCloseBtn: $('shareCloseBtn'),
  shareSearchInput: $('shareSearchInput'),
  shareSkeleton: $('shareSkeleton'),
  shareLoginBox: $('shareLoginBox'),
  shareQrBtn: $('shareQrBtn'),
  shareEmptyBox: $('shareEmptyBox'),
  shareContactsList: $('shareContactsList'),
  shareNoteInput: $('shareNoteInput'),
  shareSendBtn: $('shareSendBtn'),
  shareCopyLinkBtn: $('shareCopyLinkBtn'),
  shareOpenMessagesBtn: $('shareOpenMessagesBtn'),

  qrWelcome: $('qrWelcome'),
  welcomeQrBtn: $('welcomeQrBtn'),
  welcomeSkipBtn: $('welcomeSkipBtn'),

  loading: $('loading'),
  loadingTitle: document.querySelector('#loading .overlay-title'),
  loadingSub: document.querySelector('#loading .overlay-sub'),
  errorPanel: $('errorPanel'),
  errorText: $('errorText'),
  retryBtn: $('retryBtn'),
  errorBrowserBtn: $('errorBrowserBtn'),
  toast: $('toast')
};

let appState = null;
let ready = false;
let dmViewReady = false;
let dmViewInitialized = false;
let dmViewCleanupKey = null;
let activeTab = 'feed'; // 'feed' | 'friends' | 'chat'
let chatTabName = '';
let chatTabOpen = false;
let lastChatVideoPayload = null;
let friendsUrlLoaded = false;
let pendingFriendsSpaNav = false;
let dmViewMode = 'none'; // 'none' | 'friends' | 'chat'
let cleanupKey = null;
let toastTimer = null;
let loadingTimer = null;
let opacityTimer = null;
let centerGlyphTimer = null;
let syncPollTimer = null;
let readyToken = 0;
let dmReadyToken = 0;
let lastPlaying = null;
let commentsOpen = false;
let commentsOpening = false;
let commentsSyncToken = 0;
let commentsSwitchTimer = null;
let messagesOpen = false;
let settingsOpen = false;
let shareOpen = false;
let interactiveModal = false;
let qrLoginMode = false;
let onboardingPromptedThisSession = false;
let currentHud = null;
let lastHudVideoId = '';
let lastIpcHudAt = 0;
let actionBusy = false;
let dmEngineWarmed = false;
let volumeSaveTimer = null;
let lastNonZeroVolume = 0.7;
let lastNavDirection = 1;
let liveSkipCooldownUntil = 0;
let liveBlockToastUntil = 0;

let dmContactsCache = [];
let dialogContactsCache = [];
let shareSelectedIds = new Set();
let shareSending = false;

let activeResizeEdge = null;
let resizeRaf = 0;
let lastShiftKey = false;

const gesture = {
  down: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  downAt: 0,
  moved: false,
  holdVisualTimer: null,
  holdRaf: 0,
  holdTriggered: false,
  lastTapAt: 0,
  lastTapX: 0,
  lastTapY: 0,
  singleTapTimer: null,
  wheelLockUntil: 0,
  lastLikeClickAt: 0
};

document.addEventListener('DOMContentLoaded', init);

function activeView() {
  return activeTab !== 'feed' ? els.dmVideoView : els.view;
}

function activeReady() {
  return activeTab !== 'feed' ? dmViewReady : ready;
}

function activeGuestId() {
  try {
    const v = activeView();
    return v && typeof v.getWebContentsId === 'function' ? v.getWebContentsId() : null;
  } catch {
    return null;
  }
}

async function init() {
  if (!window.appApi) {
    showError('Не загрузился внутренний интерфейс приложения');
    return;
  }

  bindWindowControls();
  bindResizeHandles();

  try {
    appState = await window.appApi.getState();
  } catch (error) {
    console.error('Не удалось получить настройки:', error);
    appState = fallbackState();
  }

  applyCompactClass(appState.width || 412);
  applyStateToUI();
  bindPageControls();
  bindSourceTabs();
  bindShareSheet();
  bindGestures();
  bindKeyboard();

  window.appApi.onStateChanged(handleExternalState);
  window.appApi.onCommentsWindowState(handleCommentsWindowState);
  window.appApi.onCommentsAction(handleCommentsAction);
  window.appApi.onMessagesWindowState(handleMessagesWindowState);
  window.appApi.onMessagesOpenVideo(handleOpenDmVideo);
  if (window.appApi.onMessagesOpenStory) {
    window.appApi.onMessagesOpenStory(handleOpenFriendStory);
  }
  window.appApi.onMessagesContacts(handleIncomingDmContacts);
  window.appApi.onMessagesUnread(updateUnreadMessagesUI);
  window.appApi.onMessagesOpenLogin(() => startQrLogin());
  if (window.appApi.onShareRefreshContactsStealth) {
    window.appApi.onShareRefreshContactsStealth(() => {
      handleStealthRefreshContacts().catch(() => {});
    });
  }
  if (window.appApi.onShareSendCommentStealth) {
    window.appApi.onShareSendCommentStealth((payload) => {
      handleStealthSendComment(payload).catch(() => {});
    });
  }
  window.appApi.onWindowBounds(handleWindowBounds);
  if (window.appApi.onLiveBlocked) {
    window.appApi.onLiveBlocked(handleLiveBlocked);
  }

  startWebview();
}

function fallbackState() {
  return {
    url: FALLBACK_URL,
    userAgent: navigator.userAgent,
    webviewPreloadUrl: '',
    recentContacts: [],
    alwaysOnTop: true,
    opacity: 1,
    zoom: 1,
    playbackRate: 1,
    auto: false,
    autoMode: 'end',
    autoSeconds: 10,
    muted: false,
    volume: 1,
    skipLives: true,
    menuOpen: false,
    onboardingSeen: false,
    width: 412,
    height: 720,
    presetId: 'standard'
  };
}

function formatSpeed(rate) {
  const n = Number(rate) || 1;
  return (Number.isInteger(n) ? String(n) : String(n)) + '×';
}

/* ─── Управление окном и плавным масштабированием ────────────────── */

function bindWindowControls() {
  els.minBtn.addEventListener('click', () => window.appApi.minimize());
  els.closeBtn.addEventListener('click', () => window.appApi.close());
  els.messagesBtn.addEventListener('click', toggleMessagesWindow);
  els.pinBtn.addEventListener('click', togglePin);
  els.sizeBtn.addEventListener('click', cycleSize);
  els.moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSettings();
  });

  document.addEventListener('pointerdown', (e) => {
    if (settingsOpen) {
      if (
        !els.settingsSheet.contains(e.target) &&
        !els.moreBtn.contains(e.target)
      ) {
        closeSettings();
      }
    }
    if (shareOpen) {
      if (
        !els.shareSheet.contains(e.target) &&
        !els.hudShareBtn.contains(e.target)
      ) {
        closeShareSheet();
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
      e.stopPropagation();
      activeResizeEdge = zone.dataset.resize;
      lastShiftKey = e.shiftKey;
      els.bezel.classList.add('resizing');
      zone.setPointerCapture(e.pointerId);
      window.appApi.startResize(activeResizeEdge);
    });

    zone.addEventListener('pointermove', (e) => {
      if (!activeResizeEdge) return;
      lastShiftKey = e.shiftKey;
      if (!resizeRaf) {
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = 0;
          if (activeResizeEdge) window.appApi.updateResize(lastShiftKey);
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
      els.bezel.classList.remove('resizing');
      try { zone.releasePointerCapture(e.pointerId); } catch {}
      window.appApi.endResize();
    };

    zone.addEventListener('pointerup', finish);
    zone.addEventListener('pointercancel', finish);
  }
}

function applyCompactClass(width) {
  document.body.classList.toggle('compact-mode', Number(width) < 316);
}

function handleWindowBounds(info) {
  if (!info || !appState) return;
  appState.width = info.width;
  appState.height = info.height;
  appState.presetId = info.presetId;
  applyCompactClass(info.width);
  updateSizePresetUI();
}

async function togglePin() {
  if (!appState) return;
  appState.alwaysOnTop = !appState.alwaysOnTop;
  updatePinUI();
  await saveState({ alwaysOnTop: appState.alwaysOnTop });
  toast(appState.alwaysOnTop ? 'Поверх всех окон' : 'Закрепление снято');
}

async function cycleSize() {
  try {
    const result = await window.appApi.cycleSize();
    if (result) {
      appState.presetId = result.id;
      updateSizePresetUI();
      toast('Размер: ' + result.label);
    }
  } catch (error) {
    console.error(error);
  }
}

async function selectPreset(presetId) {
  try {
    const result = await window.appApi.setPresetSize(presetId);
    if (result) {
      appState.presetId = result.id;
      updateSizePresetUI();
      toast('Размер: ' + result.label);
    }
  } catch (error) {
    console.error(error);
  }
}

function toggleSettings() {
  if (settingsOpen) closeSettings();
  else openSettings();
}

function openSettings() {
  if (shareOpen) closeShareSheet();
  settingsOpen = true;
  els.settingsSheet.classList.remove('hidden');
  els.moreBtn.classList.add('active');
  els.moreBtn.setAttribute('aria-expanded', 'true');
  els.bezel.classList.add('chrome-open', 'settings-open');
}

function closeSettings() {
  settingsOpen = false;
  els.settingsSheet.classList.add('hidden');
  els.moreBtn.classList.remove('active');
  els.moreBtn.setAttribute('aria-expanded', 'false');
  els.bezel.classList.remove('settings-open');
  if (!shareOpen) els.bezel.classList.remove('chrome-open');
}

function handleExternalState(next) {
  if (!appState || !next) return;
  if (typeof next.alwaysOnTop === 'boolean') {
    appState.alwaysOnTop = next.alwaysOnTop;
    updatePinUI();
  }
}

/* ─── Вкладки источника: «Рекомендации» / «Истории» / «Чат: Имя ×» ── */

function bindSourceTabs() {
  els.tabFeedBtn.addEventListener('click', () => switchSourceTab('feed'));
  els.tabChatBtn.addEventListener('click', () => switchSourceTab('chat'));
  els.tabChatCloseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeChatTab();
  });
}

function initDmVideoViewOnce() {
  if (dmViewInitialized) return;
  dmViewInitialized = true;

  if (appState && appState.webviewPreloadUrl) {
    els.dmVideoView.setAttribute('preload', appState.webviewPreloadUrl);
  }
  if (appState && appState.userAgent) {
    try { els.dmVideoView.setAttribute('useragent', appState.userAgent); } catch {}
  }

  els.dmVideoView.addEventListener('dom-ready', onDmVideoDomReady);
  els.dmVideoView.addEventListener('ipc-message', (ev) => {
    if (activeTab !== 'feed') onWebviewIpcMessage(ev);
  });
}

async function onDmVideoDomReady() {
  const token = ++dmReadyToken;
  dmViewReady = false;
  dmViewCleanupKey = null;

  const url = (() => {
    try { return els.dmVideoView.getURL(); } catch { return ''; }
  })();
  if (!url || url === 'about:blank') return;

  await delay(100);
  if (token !== dmReadyToken) return;

  if (!appState.menuOpen && INJECT.css) {
    try { dmViewCleanupKey = await els.dmVideoView.insertCSS(INJECT.css); } catch {}
  }
  if (token !== dmReadyToken) return;

  try {
    await els.dmVideoView.executeJavaScript(INJECT.controller, true);
  } catch {}
  if (token !== dmReadyToken) return;

  dmViewReady = true;
  if (pendingFriendsSpaNav) {
    pendingFriendsSpaNav = false;
    setTimeout(() => {
      evalOnView(els.dmVideoView, 'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.openFriendsSpa() : false');
    }, 350);
  }
  if (activeTab !== 'feed') {
    await pushSettingsToPage();
    setZoomOnView(els.dmVideoView, appState.zoom);
    hideLoadingSoon(200);
    if (commentsOpen) ensureCommentsOpen(false);
  }
}

async function handleOpenFriendStory(payload) {
  if (!payload || payload.isFriendsFeed) {
    // Прямой переход на /friends отдаёт HTTP 403; открываем /foryou и переходим в «Друзья» нативным SPA-кликом (HTTP 200!)
    pendingFriendsSpaNav = true;
    await handleOpenDmVideo({
      url: 'https://www.tiktok.com/foryou?lang=ru',
      chatName: 'Истории друзей',
      rawTabLabel: true,
      allowScroll: true
    });
    return;
  }
  pendingFriendsSpaNav = false;
  await handleOpenDmVideo({
    url: payload.url,
    chatName: payload.friendName ? 'История: ' + payload.friendName : 'История друга',
    rawTabLabel: true,
    allowScroll: false
  });
}

async function handleOpenDmVideo(payload) {
  if (!payload || !payload.url) return;
  closeShareSheet();
  closeSettings();
  initDmVideoViewOnce();

  lastChatVideoPayload = { ...payload };
  chatTabName = payload.rawTabLabel
    ? payload.chatName || 'История'
    : payload.chatName
      ? 'Чат: ' + payload.chatName
      : 'Чат';
  chatTabOpen = true;
  dmViewMode = payload.allowScroll ? 'friends' : 'chat';
  friendsUrlLoaded = Boolean(payload.allowScroll);
  els.tabChatBtn.textContent = chatTabName;
  els.sourceTabs.classList.remove('hidden');

  // Ставим на паузу ленту рекомендаций (не теряем позицию!)
  if (ready) {
    evalOnView(els.view, 'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.setPaused(true) : false');
  }

  activeTab = payload.allowScroll ? 'friends' : 'chat';
  syncTabButtonsUI();
  els.view.classList.add('hidden');
  els.dmVideoView.classList.remove('hidden');
  dmViewReady = false;
  showLoading(chatTabName, payload.rawTabLabel ? 'Открываю истории друзей' : 'Открываю ролик из сообщения');

  try {
    const p = els.dmVideoView.loadURL(payload.url);
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    els.dmVideoView.src = payload.url;
  }
}

async function switchSourceTab(nextTab) {
  const normalizedNext = nextTab === 'chat' && dmViewMode === 'friends' ? 'friends' : nextTab;
  if (normalizedNext === activeTab) return;
  if (normalizedNext !== 'feed' && !chatTabOpen) return;

  // Ставим на паузу уходящую вкладку
  if (activeTab === 'feed' && ready) {
    await evalOnView(els.view, 'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.setPaused(true) : false');
  } else if (activeTab !== 'feed' && dmViewReady) {
    await evalOnView(els.dmVideoView, 'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.setPaused(true) : false');
  }

  activeTab = normalizedNext;
  syncTabButtonsUI();
  els.view.classList.toggle('hidden', activeTab !== 'feed');
  els.dmVideoView.classList.toggle('hidden', activeTab === 'feed');

  if (activeReady()) {
    await evalOnView(activeView(), 'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.setPaused(false) : false');
    const hud = await pageEval('window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.status() : null');
    if (hud && hud.ok) applyHudUpdate(hud);
    if (commentsOpen) ensureCommentsOpen(false);
  }
}

async function closeChatTab() {
  chatTabOpen = false;
  lastChatVideoPayload = null;
  els.sourceTabs.classList.add('hidden');
  if (dmViewReady) {
    await evalOnView(els.dmVideoView, 'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.setPaused(true) : false');
  }
  dmViewReady = false;
  dmViewMode = 'none';
  friendsUrlLoaded = false;
  try { els.dmVideoView.loadURL('about:blank'); } catch { els.dmVideoView.src = 'about:blank'; }
  els.dmVideoView.classList.add('hidden');
  els.view.classList.remove('hidden');
  activeTab = 'feed';
  syncTabButtonsUI();

  if (ready) {
    await evalOnView(els.view, 'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.setPaused(false) : false');
    const hud = await pageEval('window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.status() : null');
    if (hud && hud.ok) applyHudUpdate(hud);
    if (commentsOpen) ensureCommentsOpen(false);
  }
}

function syncTabButtonsUI() {
  const isFeed = activeTab === 'feed';
  els.tabFeedBtn.classList.toggle('active', isFeed);
  els.tabFeedBtn.setAttribute('aria-selected', String(isFeed));
  els.tabChatWrap.classList.toggle('active', !isFeed);
  els.tabChatWrap.setAttribute('aria-selected', String(!isFeed));
}

/* ─── Webview и интеграция с TikTok ──────────────────────────────── */

function startWebview() {
  const url = appState.url || FALLBACK_URL;

  if (appState.webviewPreloadUrl) {
    els.view.setAttribute('preload', appState.webviewPreloadUrl);
  }

  els.view.addEventListener('dom-ready', onDomReady);
  els.view.addEventListener('did-fail-load', onDidFailLoad);
  els.view.addEventListener('did-start-loading', onDidStartLoading);
  els.view.addEventListener('did-stop-loading', () => {
    if (ready && activeTab === 'feed') hideLoadingSoon(0);
  });
  els.view.addEventListener('ipc-message', (ev) => {
    if (activeTab === 'feed') onWebviewIpcMessage(ev);
  });

  try {
    els.view.setAttribute('useragent', appState.userAgent);
  } catch {}

  setPillState('Загрузка', 'loading', true);
  els.view.src = url;

  clearTimeout(loadingTimer);
  loadingTimer = setTimeout(() => {
    if (!ready) {
      els.loadingSub.textContent =
        'Загрузка занимает дольше обычного. Проверь сеть или нажми «Обновить»';
      setPillState('Медленно', 'loading', true);
    }
  }, 15000);
}

function onWebviewIpcMessage(event) {
  if (event.channel !== 'ttf:event') return;
  const msg = event.args && event.args[0];
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'hud' && msg.data) {
    lastIpcHudAt = Date.now();
    applyHudUpdate(msg.data);
  } else if (msg.type === 'comments' && msg.data) {
    if (lastHudVideoId && msg.data.videoId && msg.data.videoId !== lastHudVideoId) {
      return;
    }
    if (!commentsOpening || (msg.data.comments && msg.data.comments.length > 0)) {
      window.appApi.pushCommentsData(msg.data);
    }
  } else if (msg.type === 'auto-next') {
    if (activeTab === 'feed' || activeTab === 'friends') navigate(1);
  } else if (msg.type === 'live-skip') {
    if (
      (activeTab === 'feed' || activeTab === 'friends') &&
      appState &&
      appState.skipLives !== false &&
      !appState.menuOpen
    ) {
      const dir =
        msg.data && msg.data.direction === -1 ? -1 : lastNavDirection || 1;
      skipLiveCard(dir);
    }
  } else if (msg.type === 'live-blocked') {
    handleLiveBlocked(msg.data || {});
  } else if (msg.type === 'contacts' && Array.isArray(msg.data)) {
    dialogContactsCache = msg.data;
    if (window.appApi.updateDialogContactsCache) {
      window.appApi.updateDialogContactsCache(dialogContactsCache);
    }
    if (shareOpen) renderShareContacts();
  }
}

async function onDomReady() {
  const token = ++readyToken;
  ready = false;
  cleanupKey = null;

  setPillState('Загрузка', 'loading', true);
  hideError();
  setZoomOnView(els.view, appState.zoom);

  await delay(100);
  if (token !== readyToken) return;

  if (!appState.menuOpen) {
    await applyCleanupCss();
  }
  if (token !== readyToken) return;

  try {
    await els.view.executeJavaScript(INJECT.controller, true);
  } catch (error) {
    console.warn('Не удалось внедрить контроллер страницы:', error);
  }
  if (token !== readyToken) return;

  ready = true;
  await pushSettingsToPage();
  setZoomOnView(els.view, appState.zoom);

  window.appApi.activateFeed(activeGuestId()).catch(() => {});

  updateIdlePill();
  hideLoadingSoon(320);
  startSyncPoll();

  if (commentsOpen && activeTab === 'feed') {
    ensureCommentsOpen(false);
  }

  // Тихо прогреваем фоновый движок ЛС через 4 с, чтобы контакты и непрочитанные были сразу под рукой
  if (!dmEngineWarmed) {
    dmEngineWarmed = true;
    setTimeout(() => {
      window.appApi.warmDmEngine().catch(() => {});
    }, 4000);
  }
}

function startSyncPoll() {
  clearInterval(syncPollTimer);
  syncPollTimer = setInterval(async () => {
    if (!activeReady()) return;

    if (Date.now() - lastIpcHudAt > 1600) {
      const hud = await pageEval(
        'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.status() : null'
      );
      if (hud && hud.ok) applyHudUpdate(hud);
    }

    // Не перерисовываем комментарии по таймеру, если они уже открыты — только страховка, если сайдбар закрыт
    if (commentsOpen && !actionBusy && !commentsOpening) {
      const sidebarOpen = await pageEval(
        'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.isCommentsSidebarOpen() : false'
      );
      if (!sidebarOpen) {
        ensureCommentsOpen(false);
      }
    }
  }, 1500);
}

function onDidStartLoading() {
  if (ready) return;
  if (els.loading.classList.contains('hidden')) {
    showLoading('Загрузка ленты', 'Подключаюсь к TikTok');
  }
  setPillState('Загрузка', 'loading', true);
}

function onDidFailLoad(event) {
  if (!event.isMainFrame || event.errorCode === -3) return;
  ready = false;
  clearInterval(syncPollTimer);
  showError(
    'Проверь соединение с интернетом и попробуй снова' +
      (event.errorDescription ? ' (' + event.errorDescription + ')' : '')
  );
  setPillState('Нет сети', 'error', true);
}

async function evalOnView(viewEl, expression) {
  try {
    return await viewEl.executeJavaScript(expression, true);
  } catch {
    return null;
  }
}

async function pageEval(expression) {
  if (!activeReady()) return null;
  return evalOnView(activeView(), expression);
}

async function trustedClickTarget(kind, arg) {
  if (!activeReady()) return null;
  const prep = await pageEval(
    'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.prepareClickTarget(' +
      JSON.stringify(kind) + ',' + JSON.stringify(arg || null) + ') : null'
  );
  if (!prep || !prep.ok || prep.alreadyOpen) return prep;

  try {
    const wcId = activeGuestId();
    if (prep.hitOk) {
      await window.appApi.trustedClick(prep.x, prep.y, wcId);
    } else {
      await pageEval(
        'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.directClickPinned() : false'
      );
    }
    await delay(90);
  } finally {
    await pageEval(
      'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.releaseClickTarget() : null'
    );
  }
  return prep;
}

async function pushSettingsToPage() {
  if (!appState) return null;
  const config = JSON.stringify({
    auto: activeTab === 'feed' ? appState.auto : false,
    mode: appState.autoMode,
    seconds: appState.autoSeconds,
    muted: appState.muted,
    volume: typeof appState.volume === 'number' ? appState.volume : 1,
    playbackRate: appState.playbackRate || 1,
    skipLives: appState.skipLives !== false,
    menuOpen: Boolean(appState.menuOpen)
  });

  const result = await pageEval(
    'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.configure(' + config + ') : null'
  );
  if (result && result.ok) applyHudUpdate(result);
  return result;
}

async function applyCleanupCss() {
  if (!cleanupKey && INJECT.css) {
    try { cleanupKey = await els.view.insertCSS(INJECT.css); } catch { cleanupKey = null; }
  }
  if (dmViewReady && !dmViewCleanupKey && INJECT.css) {
    try { dmViewCleanupKey = await els.dmVideoView.insertCSS(INJECT.css); } catch { dmViewCleanupKey = null; }
  }
}

async function removeCleanupCss() {
  if (cleanupKey) {
    const key = cleanupKey;
    cleanupKey = null;
    try { await els.view.removeInsertedCSS(key); } catch {}
  }
  if (dmViewCleanupKey) {
    const key = dmViewCleanupKey;
    dmViewCleanupKey = null;
    try { await els.dmVideoView.removeInsertedCSS(key); } catch {}
  }
}

function setZoomOnView(viewEl, value) {
  const zoom = Number(value);
  if (!Number.isFinite(zoom) || zoom <= 0 || !viewEl) return;
  try { viewEl.setZoomFactor(zoom); } catch {}
}

function setZoom(value) {
  setZoomOnView(els.view, value);
  if (dmViewReady) setZoomOnView(els.dmVideoView, value);
}

/* ─── Синхронизация HUD и нижней панели ──────────────────────────── */

function applyHudUpdate(hud) {
  const prevVideoId = lastHudVideoId;
  currentHud = hud;

  if (hud.videoId && hud.videoId !== prevVideoId) {
    lastHudVideoId = hud.videoId;
    commentsSyncToken++;
    clearTimeout(commentsSwitchTimer);
    if (commentsOpen && prevVideoId) {
      window.appApi.pushCommentsData({
        videoId: hud.videoId,
        authorHandle: hud.authorHandle || '',
        authorName: hud.authorName || 'TikTok',
        desc: hud.desc || '',
        totalText: hud.commentsText || '0',
        loading: true,
        hasMore: false,
        comments: []
      });
      const expectedVideoId = hud.videoId;
      commentsSwitchTimer = setTimeout(() => {
        commentsSwitchTimer = null;
        if (commentsOpen && lastHudVideoId === expectedVideoId) {
          ensureCommentsOpen(false);
        }
      }, 320);
    }
  }

  updatePlayUI(Boolean(hud.playing));

  const handle = hud.authorHandle ? '@' + hud.authorHandle : hud.authorName || 'TikTok';
  els.hudHandle.textContent = handle;
  const initial = (hud.authorName || hud.authorHandle || 'T').trim().charAt(0).toUpperCase();
  els.hudAvatarFallback.textContent = initial || 'T';

  if (hud.avatar && els.hudAvatar.dataset.src !== hud.avatar) {
    els.hudAvatar.dataset.src = hud.avatar;
    els.hudAvatar.src = hud.avatar;
    els.hudAvatar.classList.remove('hidden');
    els.hudAvatarFallback.classList.add('hidden');
  } else if (!hud.avatar) {
    els.hudAvatar.classList.add('hidden');
    els.hudAvatarFallback.classList.remove('hidden');
  }

  if (els.hudDesc.textContent !== (hud.desc || '')) {
    els.hudDesc.textContent = hud.desc || '';
    els.hudDesc.classList.remove('expanded');
  }

  if (hud.music) {
    els.hudMusic.textContent = hud.music;
    els.hudMusicRow.classList.remove('hidden');
  } else {
    els.hudMusicRow.classList.add('hidden');
  }

  const isLiked = Boolean(hud.liked);
  els.hudLikeBtn.classList.toggle('liked', isLiked);
  els.hudLikeBtn.setAttribute('aria-pressed', String(isLiked));
  els.hudLikeCount.textContent = hud.likesText || '0';
  els.hudLikedBadge.classList.toggle('hidden', !isLiked);

  els.hudCommentCount.textContent = hud.commentsText || '0';

  const isReposted = Boolean(hud.reposted);
  els.hudRepostBtn.classList.toggle('reposted', isReposted);
  els.hudRepostBtn.setAttribute('aria-pressed', String(isReposted));
  els.hudRepostBtn.title = isReposted ? 'Нажми, чтобы убрать репост' : 'Сделать репост';
  els.hudRepostLabel.textContent = isReposted ? 'В репостах' : 'Репост';
  els.hudRepostBadge.classList.toggle('hidden', !isReposted);

  if (typeof hud.unreadMessages === 'number' && hud.unreadMessages > 0) {
    updateUnreadMessagesUI(hud.unreadMessages);
  }

  const ratio =
    hud.duration > 0 ? Math.min(1, Math.max(0, hud.currentTime / hud.duration)) : 0;
  els.scrubberFill.style.transform = 'scaleX(' + ratio.toFixed(4) + ')';
  els.scrubber.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));

  if (activeReady()) {
    updateIdlePill();
  }

  if (
    ready &&
    appState &&
    !appState.onboardingSeen &&
    !onboardingPromptedThisSession &&
    !qrLoginMode &&
    !appState.menuOpen &&
    hud.loggedIn === false
  ) {
    onboardingPromptedThisSession = true;
    showQrWelcome();
  }

  if (qrLoginMode && hud.loggedIn === true) {
    finishQrLogin(true);
  }

  const nextModal = Boolean(hud.interactiveModal);
  if (nextModal !== interactiveModal) {
    interactiveModal = nextModal;
    syncPassthroughMode();
  }
}

els.hudAvatar.addEventListener('error', () => {
  els.hudAvatar.classList.add('hidden');
  els.hudAvatarFallback.classList.remove('hidden');
});

function syncPassthroughMode() {
  const pass = Boolean((appState && appState.menuOpen) || qrLoginMode || interactiveModal);
  els.gestureLayer.classList.toggle('passthrough', pass);
  els.bezel.classList.toggle('hud-hidden', pass);
  els.bezel.classList.toggle('force-top', Boolean((appState && appState.menuOpen) || qrLoginMode));

  if (qrLoginMode) {
    els.modeBannerText.textContent = 'Отсканируй QR-код в TikTok';
    els.modeDoneBtn.classList.remove('hidden');
    els.modeBanner.classList.remove('hidden');
  } else if (appState && appState.menuOpen) {
    els.modeBannerText.textContent = 'Интерфейс TikTok';
    els.modeDoneBtn.classList.remove('hidden');
    els.modeBanner.classList.remove('hidden');
  } else if (interactiveModal) {
    els.modeBannerText.textContent = 'Окно TikTok';
    els.modeDoneBtn.classList.add('hidden');
    els.modeBanner.classList.remove('hidden');
  } else {
    els.modeBanner.classList.add('hidden');
  }
}

function showQrWelcome() {
  els.qrWelcome.classList.remove('hidden');
  els.bezel.classList.add('chrome-open', 'settings-open');
}

function hideQrWelcome() {
  els.qrWelcome.classList.add('hidden');
  if (!settingsOpen && !shareOpen) {
    els.bezel.classList.remove('chrome-open', 'settings-open');
  }
}

async function startQrLogin() {
  closeSettings();
  closeShareSheet();
  hideQrWelcome();
  if (appState && !appState.onboardingSeen) {
    appState.onboardingSeen = true;
    await saveState({ onboardingSeen: true });
  }

  qrLoginMode = true;
  syncPassthroughMode();
  toast('Открываю вход по QR-коду');

  if (activeReady()) {
    await pageEval('window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.openQrLogin() : null');
  }
}

async function finishQrLogin(loggedInNow) {
  qrLoginMode = false;
  if (appState && appState.menuOpen) {
    appState.menuOpen = false;
    updateMenuUI();
    await applyCleanupCss();
    await saveState({ menuOpen: false });
    await pushSettingsToPage();
  }
  syncPassthroughMode();
  if (loggedInNow) {
    window.appApi.warmDmEngine().catch(() => {});
  }
  toast(loggedInNow ? 'Вход в TikTok выполнен' : 'Возвращён iOS-интерфейс');
}

/* ─── Личные сообщения (ЛС) ──────────────────────────────────────── */

async function toggleMessagesWindow() {
  const res = await window.appApi.toggleMessages();
  messagesOpen = Boolean(res && res.open);
  updateMessagesButtonUI();
}

function handleMessagesWindowState(info) {
  if (!info) return;
  messagesOpen = Boolean(info.open);
  updateMessagesButtonUI();
}

function updateMessagesButtonUI() {
  els.messagesBtn.classList.toggle('active', messagesOpen);
  els.messagesBtn.setAttribute('aria-pressed', String(messagesOpen));
}

function updateUnreadMessagesUI(count) {
  const hasUnread = Number(count) > 0;
  els.messagesUnreadDot.classList.toggle('hidden', !hasUnread);
}

function handleIncomingDmContacts(contacts) {
  if (!Array.isArray(contacts)) return;
  dmContactsCache = contacts;
  if (shareOpen) renderShareContacts();
}

/* ─── Отправка ролика контактам («Отправить») ────────────────────── */

function bindShareSheet() {
  els.hudShareBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openShareSheet();
  });

  els.shareCloseBtn.addEventListener('click', closeShareSheet);
  els.shareQrBtn.addEventListener('click', startQrLogin);

  els.shareSearchInput.addEventListener('input', () => renderShareContacts());
  els.shareSendBtn.addEventListener('click', submitShareToContacts);

  els.shareCopyLinkBtn.addEventListener('click', async () => {
    const url =
      (await pageEval('window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.getCurrentVideoUrl() : ""')) ||
      (currentHud && currentHud.videoUrl) ||
      FALLBACK_URL;
    await window.appApi.copyText(url);
    toast('Ссылка скопирована');
    closeShareSheet();
  });

  els.shareOpenMessagesBtn.addEventListener('click', async () => {
    closeShareSheet();
    await window.appApi.openMessages();
    messagesOpen = true;
    updateMessagesButtonUI();
  });
}

function getMergedContacts() {
  const out = [];
  const seen = new Set();

  const pushContact = (c, isRecent) => {
    if (!c || typeof c !== 'object') return;
    const handle = String(c.handle || '').replace(/^@/, '').trim();
    const name = String(c.name || handle || '').trim();
    const id = String(c.id || handle || name).trim().toLowerCase();
    if (!id || !name || seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      name,
      handle,
      avatar: c.avatar || '',
      recent: Boolean(isRecent)
    });
  };

  // 1. Контакты, кому недавно отправляли (всегда сверху)
  const savedRecents = (appState && Array.isArray(appState.recentContacts))
    ? appState.recentContacts
    : [];
  for (const c of savedRecents) pushContact(c, true);

  // 2. Свежие контакты из скрытого ряда «Поделиться» TikTok
  dialogContactsCache.forEach((c, idx) => pushContact(c, idx < 6));

  // 3. Недавние переписки из фонового движка ЛС
  for (const c of dmContactsCache) pushContact(c, true);

  return out;
}

function renderShareContacts() {
  const query = els.shareSearchInput.value.trim().toLowerCase();
  const all = getMergedContacts();
  const filtered = query
    ? all.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.handle.toLowerCase().includes(query)
      )
    : all;

  const isLoggedOut = currentHud && currentHud.loggedIn === false && all.length === 0;
  els.shareLoginBox.classList.toggle('hidden', !isLoggedOut);
  els.shareEmptyBox.classList.toggle(
    'hidden',
    isLoggedOut || filtered.length > 0 || !els.shareSkeleton.classList.contains('hidden')
  );

  const frag = document.createDocumentFragment();
  for (const contact of filtered) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    const isSelected = shareSelectedIds.has(contact.id);
    btn.className = 'share-contact-row' + (isSelected ? ' selected' : '');
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', String(isSelected));

    const ava = document.createElement('div');
    ava.className = 'share-ava';
    if (contact.avatar) {
      const img = document.createElement('img');
      img.src = contact.avatar;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => {
        img.remove();
        ava.textContent = contact.name.charAt(0).toUpperCase() || 'U';
      });
      ava.appendChild(img);
    } else {
      ava.textContent = contact.name.charAt(0).toUpperCase() || 'U';
    }

    const meta = document.createElement('div');
    meta.className = 'share-contact-meta';

    const nameEl = document.createElement('span');
    nameEl.className = 'share-contact-name';
    nameEl.textContent = contact.name;

    const subEl = document.createElement('span');
    subEl.className = 'share-contact-sub';
    const parts = [];
    if (contact.handle) parts.push('@' + contact.handle);
    if (contact.recent) parts.push('Недавно');
    subEl.textContent = parts.join(' · ') || 'Контакт TikTok';

    meta.appendChild(nameEl);
    meta.appendChild(subEl);

    const check = document.createElement('span');
    check.className = 'share-check';
    check.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M5 12.5l4.5 4.5L19 7.5"></path>
      </svg>`;

    btn.appendChild(ava);
    btn.appendChild(meta);
    btn.appendChild(check);

    btn.addEventListener('click', () => {
      if (shareSelectedIds.has(contact.id)) shareSelectedIds.delete(contact.id);
      else shareSelectedIds.add(contact.id);
      renderShareContacts();
      updateShareSendButton();
    });

    li.appendChild(btn);
    frag.appendChild(li);
  }

  els.shareContactsList.innerHTML = '';
  els.shareContactsList.appendChild(frag);
  updateShareSendButton();
}

function updateShareSendButton() {
  const count = shareSelectedIds.size;
  els.shareSendBtn.disabled = count === 0 || shareSending;
  els.shareSendBtn.textContent = shareSending
    ? 'Отправка…'
    : count > 1
      ? 'Отправить (' + count + ')'
      : 'Отправить';
}

async function openShareSheet() {
  if (!activeReady()) {
    toast('Лента ещё загружается');
    return;
  }
  closeSettings();
  shareOpen = true;
  shareSelectedIds.clear();
  els.shareSearchInput.value = '';
  els.shareNoteInput.value = '';
  els.shareSheet.classList.remove('hidden');
  els.bezel.classList.add('chrome-open', 'share-open');

  window.appApi.warmDmEngine().catch(() => {});

  const initialContacts = getMergedContacts();
  els.shareSkeleton.classList.toggle('hidden', initialContacts.length > 0);
  renderShareContacts();

  // Скрытно открываем «Поделиться» TikTok и забираем 1-й ряд недавних контактов (сам попап 100% невидим)
  if (!actionBusy) {
    actionBusy = true;
    try {
      const sharePrep = await trustedClickTarget('share');
      if (sharePrep && sharePrep.ok) {
        for (let i = 0; i < 10; i++) {
          await delay(180);
          if (!shareOpen) break;
          const scraped = await pageEval(
            'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.scrapeShareDialogContacts() : null'
          );
          if (scraped) {
            if (scraped.loginRequired) {
              els.shareSkeleton.classList.add('hidden');
              els.shareLoginBox.classList.remove('hidden');
              els.shareEmptyBox.classList.add('hidden');
              break;
            }
            if (scraped.contacts && scraped.contacts.length > 0) {
              dialogContactsCache = scraped.contacts;
              if (window.appApi.updateDialogContactsCache) {
                window.appApi.updateDialogContactsCache(dialogContactsCache);
              }
              els.shareSkeleton.classList.add('hidden');
              renderShareContacts();
              break;
            }
          }
        }
      }
    } finally {
      actionBusy = false;
      els.shareSkeleton.classList.add('hidden');
      if (shareOpen) renderShareContacts();
    }
  }
}

async function handleStealthRefreshContacts() {
  if (!activeReady() || actionBusy || shareOpen) {
    if (dialogContactsCache.length > 0 && window.appApi.updateDialogContactsCache) {
      window.appApi.updateDialogContactsCache(dialogContactsCache);
    }
    return;
  }
  actionBusy = true;
  try {
    const sharePrep = await trustedClickTarget('share');
    if (sharePrep && sharePrep.ok) {
      for (let i = 0; i < 9; i++) {
        await delay(160);
        const scraped = await pageEval(
          'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.scrapeShareDialogContacts() : null'
        );
        if (scraped && scraped.contacts && scraped.contacts.length > 0) {
          dialogContactsCache = scraped.contacts;
          if (window.appApi.updateDialogContactsCache) {
            window.appApi.updateDialogContactsCache(dialogContactsCache);
          }
          break;
        }
      }
    }
  } finally {
    await pageEval('window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.cancelStealthShare() : null');
    actionBusy = false;
  }
}

async function handleStealthSendComment(payload) {
  if (!payload || !payload.reqId) return;
  const finish = (result) => {
    if (window.appApi.sendStealthSendResult) {
      window.appApi.sendStealthSendResult({ reqId: payload.reqId, result });
    }
  };
  if (!activeReady()) {
    finish({ ok: false });
    return;
  }
  for (let w = 0; w < 20 && actionBusy; w++) {
    await delay(120);
  }
  if (actionBusy) {
    finish({ ok: false });
    return;
  }
  actionBusy = true;
  try {
    let foundDialog = false;
    const preScraped = await pageEval(
      'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.scrapeShareDialogContacts() : null'
    );
    if (preScraped && preScraped.dialogOpen && preScraped.contacts && preScraped.contacts.length > 0) {
      foundDialog = true;
    } else {
      const sharePrep = await trustedClickTarget('share');
      if (!sharePrep || !sharePrep.ok) {
        finish({ ok: false });
        return;
      }
      for (let i = 0; i < 12; i++) {
        await delay(160);
        const scraped = await pageEval(
          'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.scrapeShareDialogContacts() : null'
        );
        if (scraped) {
          if (scraped.loginRequired) {
            finish({ ok: false, loginRequired: true });
            return;
          }
          if (scraped.contacts && scraped.contacts.length > 0) {
            dialogContactsCache = scraped.contacts;
            if (window.appApi.updateDialogContactsCache) {
              window.appApi.updateDialogContactsCache(dialogContactsCache);
            }
            foundDialog = true;
            break;
          }
        }
      }
    }
    if (!foundDialog) {
      finish({ ok: false });
      return;
    }
    const res = await pageEval(
      'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.sendVideoToContactsInDialog(' +
        JSON.stringify(payload.contacts || []) + ',' + JSON.stringify(payload.note || '') + ') : null'
    );
    finish(res || { ok: false });
  } finally {
    await pageEval('window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.cancelStealthShare() : null');
    actionBusy = false;
  }
}

async function closeShareSheet() {
  if (!shareOpen) return;
  shareOpen = false;
  shareSelectedIds.clear();
  els.shareSheet.classList.add('hidden');
  els.bezel.classList.remove('share-open');
  if (!settingsOpen) els.bezel.classList.remove('chrome-open');
  if (activeReady()) {
    await pageEval('window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.cancelStealthShare() : null');
  }
}

async function submitShareToContacts() {
  if (shareSending || shareSelectedIds.size === 0 || !activeReady()) return;
  const all = getMergedContacts();
  const chosen = all.filter((c) => shareSelectedIds.has(c.id));
  if (!chosen.length) return;

  shareSending = true;
  updateShareSendButton();

  try {
    const note = els.shareNoteInput.value.trim();
    let res = await pageEval(
      'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.sendVideoToContactsInDialog(' +
        JSON.stringify(chosen) + ',' + JSON.stringify(note) + ') : null'
    );

    if (res && res.loginRequired) {
      els.shareLoginBox.classList.remove('hidden');
      toast('Войди в TikTok по QR-коду');
      return;
    }

    // Если контакта не было в быстром 1-м ряду «Поделиться» — отправляем через фоновый движок ЛС
    if (!res || !res.ok) {
      const videoUrl =
        (await pageEval('window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.getCurrentVideoUrl() : ""')) ||
        (currentHud && currentHud.videoUrl) ||
        '';
      if (videoUrl) {
        res = await window.appApi.sendVideoViaDm({
          contacts: chosen,
          videoUrl,
          note
        });
      }
    }

    if (res && res.ok) {
      const updatedRecents = await window.appApi.recordRecentContacts(chosen);
      if (appState && Array.isArray(updatedRecents)) {
        appState.recentContacts = updatedRecents;
      }
      const label =
        chosen.length === 1
          ? 'Отправлено: ' + chosen[0].name
          : 'Отправлено контактам (' + chosen.length + ')';
      toast(label);
      closeShareSheet();
    } else {
      toast('Не удалось отправить — проверь вход в TikTok');
    }
  } finally {
    shareSending = false;
    updateShareSendButton();
  }
}

/* ─── Жесты: 1 клик = пауза, 2 клика = лайк, удержание = репост ──── */

function bindGestures() {
  els.gestureLayer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (settingsOpen) {
      closeSettings();
      return;
    }
    if (shareOpen) {
      closeShareSheet();
      return;
    }
    startHoldGesture(e, false);
  });

  els.gestureLayer.addEventListener('pointermove', (e) => {
    if (!gesture.down || e.pointerId !== gesture.pointerId) return;
    const dist = Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY);
    if (dist > 12) {
      gesture.moved = true;
      cancelHoldVisual();
    }
  });

  els.gestureLayer.addEventListener('pointerup', (e) => {
    if (!gesture.down || e.pointerId !== gesture.pointerId) return;
    finishSurfaceGesture(e);
  });

  els.gestureLayer.addEventListener('pointercancel', () => {
    cancelHoldVisual();
    gesture.down = false;
  });

  els.stage.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const step = e.deltaY < 0 ? 1 : -1;
        window.appApi.scaleWindow(step).catch(() => {});
        return;
      }

      if (
        settingsOpen ||
        shareOpen ||
        (appState && appState.menuOpen) ||
        qrLoginMode ||
        interactiveModal ||
        activeTab === 'chat'
      ) {
        return;
      }
      if (Math.abs(e.deltaY) < 16) return;

      e.preventDefault();
      const now = Date.now();
      if (now < gesture.wheelLockUntil) return;
      gesture.wheelLockUntil = now + 380;
      navigate(e.deltaY > 0 ? 1 : -1);
    },
    { passive: false }
  );

  // Лайк в нижней панели: по обычному одиночному клику (поставить / убрать лайк)
  els.hudLikeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const stageRect = els.stage.getBoundingClientRect();
    performDoubleClickLike(stageRect.width / 2, stageRect.height * 0.44);
  });

  // Репост в нижней панели: по обычному одиночному клику (сделать репост / убрать репост)
  els.hudRepostBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    performHoldRepost();
  });

  // Перемотка по полосе прогресса
  let scrubbing = false;
  const seekAtEvent = (e) => {
    const rect = els.scrubber.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
    els.scrubberFill.style.transform = 'scaleX(' + ratio.toFixed(4) + ')';
    pageEval('window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.seekTo(' + ratio + ') : false');
  };

  els.scrubber.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    scrubbing = true;
    els.scrubber.setPointerCapture(e.pointerId);
    seekAtEvent(e);
  });

  els.scrubber.addEventListener('pointermove', (e) => {
    if (!scrubbing) return;
    seekAtEvent(e);
  });

  const endScrub = (e) => {
    if (!scrubbing) return;
    scrubbing = false;
    try { els.scrubber.releasePointerCapture(e.pointerId); } catch {}
  };
  els.scrubber.addEventListener('pointerup', endScrub);
  els.scrubber.addEventListener('pointercancel', endScrub);

  els.hudDesc.addEventListener('click', (e) => {
    e.stopPropagation();
    els.hudDesc.classList.toggle('expanded');
  });
}

function startHoldGesture(e, fromButton) {
  cancelHoldVisual();
  gesture.down = true;
  gesture.pointerId = e.pointerId;
  gesture.startX = e.clientX;
  gesture.startY = e.clientY;
  gesture.downAt = Date.now();
  gesture.moved = false;
  gesture.holdTriggered = false;

  const stageRect = els.stage.getBoundingClientRect();
  const relX = fromButton
    ? stageRect.width / 2
    : Math.min(stageRect.width - 46, Math.max(46, e.clientX - stageRect.left));
  const relY = fromButton
    ? stageRect.height * 0.45
    : Math.min(stageRect.height - 64, Math.max(64, e.clientY - stageRect.top));

  gesture.holdVisualTimer = setTimeout(() => {
    if (!gesture.down || gesture.moved) return;
    clearTimeout(gesture.singleTapTimer);
    gesture.singleTapTimer = null;

    els.holdRing.style.left = relX + 'px';
    els.holdRing.style.top = relY + 'px';
    els.holdRing.classList.remove('completed');
    els.holdRing.classList.add('active');

    const fillStart = performance.now();
    const fillDuration = HOLD_COMPLETE_MS - (fromButton ? 110 : HOLD_DELAY_MS);

    const tick = (now) => {
      if (!gesture.down || gesture.moved) {
        cancelHoldVisual();
        return;
      }
      const progress = Math.min(1, (now - fillStart) / Math.max(120, fillDuration));
      const offset = RING_CIRCUMFERENCE * (1 - progress);
      els.holdRingProgress.style.strokeDashoffset = String(offset);

      if (progress >= 1) {
        gesture.holdTriggered = true;
        els.holdRing.classList.remove('active');
        els.holdRing.classList.add('completed');
        performHoldRepost();
        return;
      }
      gesture.holdRaf = requestAnimationFrame(tick);
    };

    gesture.holdRaf = requestAnimationFrame(tick);
  }, fromButton ? 110 : HOLD_DELAY_MS);
}

function cancelHoldVisual() {
  clearTimeout(gesture.holdVisualTimer);
  gesture.holdVisualTimer = null;
  if (gesture.holdRaf) {
    cancelAnimationFrame(gesture.holdRaf);
    gesture.holdRaf = 0;
  }
  els.holdRing.classList.remove('active', 'completed');
  els.holdRingProgress.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
}

function finishSurfaceGesture(e) {
  const heldMs = Date.now() - gesture.downAt;
  const wasHold = gesture.holdTriggered;
  const wasMoved = gesture.moved;

  cancelHoldVisual();
  gesture.down = false;

  if (wasHold || wasMoved || heldMs >= HOLD_DELAY_MS + 40) return;

  const now = Date.now();
  const isDouble =
    now - gesture.lastTapAt <= DOUBLE_CLICK_MS &&
    Math.hypot(e.clientX - gesture.lastTapX, e.clientY - gesture.lastTapY) < 48;

  if (isDouble) {
    clearTimeout(gesture.singleTapTimer);
    gesture.singleTapTimer = null;
    gesture.lastTapAt = 0;

    const stageRect = els.stage.getBoundingClientRect();
    performDoubleClickLike(
      e.clientX - stageRect.left,
      e.clientY - stageRect.top
    );
    return;
  }

  gesture.lastTapAt = now;
  gesture.lastTapX = e.clientX;
  gesture.lastTapY = e.clientY;

  clearTimeout(gesture.singleTapTimer);
  gesture.singleTapTimer = setTimeout(async () => {
    gesture.singleTapTimer = null;
    const playing = await togglePlay();
    if (typeof playing === 'boolean') {
      flashCenterGlyph(playing ? ICONS.play : ICONS.pause);
    }
  }, DOUBLE_CLICK_MS);
}

function spawnHeartBurst(x, y, unliked) {
  const el = document.createElement('div');
  el.className = 'burst-heart' + (unliked ? ' unliked' : '');
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  const tilt = (Math.random() * 20 - 10).toFixed(1) + 'deg';
  el.style.setProperty('--rot', tilt);
  el.innerHTML = `
    <svg viewBox="0 0 24 24" width="72" height="72" fill="currentColor" aria-hidden="true">
      <path d="M12 20.6l-1.4-1.28C5.4 14.66 2.2 11.74 2.2 8.2A4.9 4.9 0 0 1 7.1 3.3c1.82 0 3.55.86 4.9 2.22C13.35 4.16 15.08 3.3 16.9 3.3a4.9 4.9 0 0 1 4.9 4.9c0 3.54-3.2 6.46-8.4 11.12L12 20.6z"></path>
    </svg>`;
  els.heartLayer.appendChild(el);
  setTimeout(() => el.remove(), 720);
}

function flashCenterGlyph(svgHtml) {
  els.centerGlyph.innerHTML = svgHtml;
  els.centerGlyph.classList.add('visible');
  clearTimeout(centerGlyphTimer);
  centerGlyphTimer = setTimeout(() => {
    els.centerGlyph.classList.remove('visible');
  }, 540);
}

async function performDoubleClickLike(x, y) {
  if (!activeReady()) {
    toast('Лента ещё загружается');
    return;
  }
  if (actionBusy) return;
  actionBusy = true;

  try {
    const wasLiked = Boolean(currentHud && currentHud.liked);
    spawnHeartBurst(x, y, wasLiked);

    const prep = await trustedClickTarget('like');
    if (!prep || !prep.ok) {
      toast('Не удалось найти кнопку лайка');
      return;
    }

    let res = null;
    for (let i = 0; i < 10; i++) {
      await delay(140);
      res = await pageEval(
        'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.verifyLikeResult(' +
          JSON.stringify(prep.videoId || '') + ',' +
          Boolean(prep.beforeLiked) + ',' +
          JSON.stringify(prep.beforeCount || '') + ') : null'
      );
      if (res && (res.loginRequired || res.ok)) break;
    }

    if (!res) {
      toast('Не удалось поставить лайк');
      return;
    }
    if (res.loginRequired) {
      toast('Нужен вход в TikTok по QR-коду');
      return;
    }
    if (res.ok) {
      const liked = Boolean(res.liked);
      if (currentHud) currentHud.liked = liked;
      els.hudLikeBtn.classList.toggle('liked', liked);
      els.hudLikeBtn.setAttribute('aria-pressed', String(liked));
      els.hudLikedBadge.classList.toggle('hidden', !liked);
      els.hudLikeBtn.classList.remove('like-pop');
      void els.hudLikeBtn.offsetWidth;
      if (liked) els.hudLikeBtn.classList.add('like-pop');
      if (res.likesText) els.hudLikeCount.textContent = res.likesText;
      toast(liked ? 'Лайк поставлен' : 'Лайк убран');
    } else {
      toast('Не удалось подтвердить лайк — проверь вход в аккаунт');
    }
  } finally {
    actionBusy = false;
  }
}

async function performHoldRepost() {
  if (!activeReady()) {
    toast('Лента ещё загружается');
    return;
  }
  if (actionBusy) return;
  actionBusy = true;

  // Жёсткий предохранитель: репост никогда не должен «зависать» и блокировать остальные действия
  let timedOut = false;
  const guard = setTimeout(() => {
    timedOut = true;
    actionBusy = false;
    pageEval('window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.cancelStealthShare() : null');
    cancelHoldVisual();
    toast('Репост не подтвердился — попробуй ещё раз');
  }, 8500);

  try {
    await performHoldRepostInner(() => timedOut);
  } finally {
    clearTimeout(guard);
    if (!timedOut) actionBusy = false;
    els.holdRing.classList.remove('completed');
  }
}

async function performHoldRepostInner(isAborted) {
  let videoId = (currentHud && currentHud.videoId) || '';
  const wasReposted = Boolean(currentHud && currentHud.reposted);
  let repostPrep = null;

  // 1) Если у ролика есть прямая кнопка репоста в панели действий — кликаем её сразу
  const directAttempt = await trustedClickTarget('repost-direct');
  if (directAttempt && directAttempt.ok) {
    repostPrep = directAttempt;
    if (directAttempt.videoId) videoId = directAttempt.videoId;
  } else {
    // 2) Открываем скрытое меню «Поделиться» и кликаем плитку «Репост» / «Удалить репост»
    const sharePrep = await trustedClickTarget('share');
    if (sharePrep && sharePrep.ok) {
      if (sharePrep.videoId) videoId = sharePrep.videoId;
      let unavailableTicks = 0;
      for (let i = 0; i < 10; i++) {
        await delay(110);
        if (isAborted()) return;
        const attempt = await trustedClickTarget('repost', { wasReposted });
        if (attempt && attempt.ok) {
          repostPrep = attempt;
          break;
        }
        if (attempt && attempt.dialogHasShareActions) {
          unavailableTicks++;
          if (unavailableTicks >= 3) break;
        }
      }
    }
  }

  if (!repostPrep || !repostPrep.ok) {
    await pageEval('window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.cancelStealthShare() : null');
    toast('Автор или TikTok ограничил репост этого ролика');
    return;
  }

  const effectiveWillRemove = Boolean(repostPrep.willRemove || wasReposted);

  // 3) Опрашиваем реальное подтверждение (API /upvote/(create|delete), тост TikTok или смена подписи)
  for (let i = 0; i < 8; i++) {
    await delay(140);
    if (isAborted()) return;
    const prog = await pageEval(
      'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.checkRepostProgress(' +
        JSON.stringify(videoId) + ',' +
        effectiveWillRemove + ') : null'
    );
    if (prog && prog.done) break;
  }

  const res = await pageEval(
    'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.finishRepost(' +
      JSON.stringify(videoId) + ',' +
      effectiveWillRemove + ',' +
      Boolean(repostPrep.inModal) + ') : null'
  );

  if (!res) {
    toast('Не удалось выполнить репост');
    return;
  }
  if (res.loginRequired) {
    toast('Войди в аккаунт TikTok для репоста');
    return;
  }
  if (isAborted()) return;
  if (res.ok) {
    const reposted = Boolean(res.reposted);
    const stillSame = !currentHud || !currentHud.videoId || currentHud.videoId === videoId;
    if (stillSame) {
      if (currentHud) currentHud.reposted = reposted;
      els.hudRepostBtn.classList.toggle('reposted', reposted);
      els.hudRepostBtn.setAttribute('aria-pressed', String(reposted));
      els.hudRepostBtn.title = reposted ? 'Нажми, чтобы убрать репост' : 'Сделать репост';
      els.hudRepostLabel.textContent = reposted ? 'В репостах' : 'Репост';
      els.hudRepostBadge.classList.toggle('hidden', !reposted);
    }
    toast(reposted ? 'Репост добавлен' : 'Репост убран');
  } else {
    toast('Не удалось подтвердить репост — проверь вход в аккаунт');
  }
}

/* ─── Кнопки управления, скорость 0.5×–2× и настройки ────────────── */

function bindPageControls() {
  els.prevBtn.addEventListener('click', () => navigate(-1));
  els.nextBtn.addEventListener('click', () => navigate(1));
  els.playBtn.addEventListener('click', togglePlay);
  els.muteBtn.addEventListener('click', toggleMute);
  els.speedBtn.addEventListener('click', cycleSpeed);
  els.speedBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    setPlaybackSpeed(1);
  });
  els.autoBtn.addEventListener('click', toggleAuto);
  els.hudCommentBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCommentsWindow();
  });

  els.speedChips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-speed]');
    if (!btn) return;
    setPlaybackSpeed(Number(btn.dataset.speed));
  });

  els.modeIntervalBtn.addEventListener('click', () => setAutoMode('interval'));
  els.modeEndBtn.addEventListener('click', () => setAutoMode('end'));

  els.intervalChips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-seconds]');
    if (!btn) return;
    setAutoSeconds(Number(btn.dataset.seconds));
  });

  if (els.skipLivesBtn) {
    els.skipLivesBtn.addEventListener('click', toggleSkipLives);
  }

  els.presetChips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-preset]');
    if (!btn) return;
    selectPreset(btn.dataset.preset);
  });

  els.opacityInput.addEventListener('input', changeOpacity);
  els.volumeSlider.addEventListener('input', () => {
    const pct = Number(els.volumeSlider.value);
    if (!Number.isFinite(pct)) return;
    applyVolumeChange(pct / 100, false);
  });
  bindVolumePopover();
  els.zoomOutBtn.addEventListener('click', () => stepZoom(-1));
  els.zoomInBtn.addEventListener('click', () => stepZoom(1));

  els.qrLoginBtn.addEventListener('click', startQrLogin);
  els.welcomeQrBtn.addEventListener('click', startQrLogin);
  els.welcomeSkipBtn.addEventListener('click', async () => {
    hideQrWelcome();
    if (appState) {
      appState.onboardingSeen = true;
      await saveState({ onboardingSeen: true });
    }
  });

  els.siteMenuBtn.addEventListener('click', () => {
    closeSettings();
    toggleSiteMenu();
  });
  els.modeDoneBtn.addEventListener('click', () => {
    if (qrLoginMode) finishQrLogin(false);
    else if (appState && appState.menuOpen) toggleSiteMenu();
  });

  els.reloadBtn.addEventListener('click', () => {
    closeSettings();
    reloadFeed();
  });
  els.browserBtn.addEventListener('click', () => {
    closeSettings();
    openInBrowser();
  });
  els.retryBtn.addEventListener('click', reloadFeed);
  els.errorBrowserBtn.addEventListener('click', openInBrowser);
}

function bindKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (shareOpen) closeShareSheet();
      else if (settingsOpen) closeSettings();
      else if (qrLoginMode) finishQrLogin(false);
      else if (appState && appState.menuOpen) toggleSiteMenu();
      return;
    }

    if (shareOpen) return;
    if ((appState && appState.menuOpen) || qrLoginMode) return;

    if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      window.appApi.scaleWindow(1).catch(() => {});
      return;
    }
    if (e.ctrlKey && e.key === '-') {
      e.preventDefault();
      window.appApi.scaleWindow(-1).catch(() => {});
      return;
    }

    if (e.code === 'Space' || e.key.toLowerCase() === 'k') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowDown' || e.key.toLowerCase() === 'j') {
      e.preventDefault();
      navigate(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigate(-1);
    } else if (e.key.toLowerCase() === 'm') {
      e.preventDefault();
      toggleMute();
    } else if (e.key.toLowerCase() === 'c') {
      e.preventDefault();
      toggleCommentsWindow();
    } else if (e.key.toLowerCase() === 'd') {
      e.preventDefault();
      toggleMessagesWindow();
    } else if (e.key === '2') {
      e.preventDefault();
      setPlaybackSpeed(appState && appState.playbackRate === 2 ? 1 : 2);
    } else if (e.key === '>' || e.key === '.') {
      e.preventDefault();
      stepSpeed(1);
    } else if (e.key === '<' || e.key === ',') {
      e.preventDefault();
      stepSpeed(-1);
    }
  });
}

async function cycleSpeed() {
  if (!appState) return;
  const cur = Number(appState.playbackRate) || 1;
  const idx = SPEED_CYCLE.findIndex((s) => Math.abs(s - cur) < 0.01);
  const next = SPEED_CYCLE[(idx + 1) % SPEED_CYCLE.length];
  await setPlaybackSpeed(next);
}

async function stepSpeed(delta) {
  if (!appState) return;
  const cur = Number(appState.playbackRate) || 1;
  let idx = SPEED_ALL.findIndex((s) => Math.abs(s - cur) < 0.01);
  if (idx < 0) idx = SPEED_ALL.indexOf(1);
  const next = SPEED_ALL[Math.min(SPEED_ALL.length - 1, Math.max(0, idx + delta))];
  await setPlaybackSpeed(next);
}

async function setPlaybackSpeed(rate) {
  if (!appState || !Number.isFinite(rate)) return;
  appState.playbackRate = rate;
  updateSpeedUI();
  await saveState({ playbackRate: rate });
  await pushSettingsToPage();
  toast('Скорость: ' + formatSpeed(rate));
}

async function skipLiveCard(direction) {
  if (!activeReady() || actionBusy) return;
  if (activeTab === 'chat') return;
  const now = Date.now();
  if (now < liveSkipCooldownUntil) return;
  liveSkipCooldownUntil = now + 850;

  const step = direction < 0 ? -1 : 1;
  const moved = await navigate(step, { isAutoLiveSkip: true });
  if (!moved && step < 0) {
    await navigate(1, { isAutoLiveSkip: true });
  }
  if (Date.now() > liveBlockToastUntil) {
    liveBlockToastUntil = Date.now() + 2200;
    toast('Стрим пропущен');
  }
}

function handleLiveBlocked(info) {
  if (appState && appState.menuOpen) return;
  const shouldSkip = Boolean(
    (appState ? appState.skipLives !== false : true) &&
      (activeTab === 'feed' || activeTab === 'friends')
  );
  if (shouldSkip) {
    skipLiveCard(lastNavDirection || 1);
    return;
  }
  const now = Date.now();
  if (now > liveBlockToastUntil) {
    liveBlockToastUntil = now + 2400;
    toast('Переход на страницу стрима заблокирован');
  }
}

async function navigate(direction, opts) {
  const isAutoLiveSkip = Boolean(opts && opts.isAutoLiveSkip);
  if (activeTab === 'chat') {
    if (!isAutoLiveSkip) {
      toast('Переключись на «Рекомендации» или «Истории», чтобы листать');
    }
    return false;
  }
  if (!activeReady()) {
    if (!isAutoLiveSkip) toast('Лента ещё загружается');
    return false;
  }

  const step = direction < 0 ? -1 : 1;
  if (!isAutoLiveSkip) {
    lastNavDirection = step;
    pageEval(
      'window.__TIKTOK_FLOAT__ && window.__TIKTOK_FLOAT__.recordNavDirection ? window.__TIKTOK_FLOAT__.recordNavDirection(' +
        step +
        ') : null'
    ).catch(() => {});
  }

  const before = await pageEval(
    'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.navSnapshot() : null'
  );

  await window.appApi.trustedKey(step > 0 ? 'Down' : 'Up', activeGuestId());
  await delay(260);

  const after = await pageEval(
    'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.navSnapshot() : null'
  );
  const movedByKey = Boolean(
    before &&
      after &&
      (after.videoId !== before.videoId ||
        Math.abs((after.scrollTop || 0) - (before.scrollTop || 0)) >= 12)
  );

  if (movedByKey) {
    setTimeout(() => pushSettingsToPage(), 350);
    return true;
  }

  const result = await pageEval(
    'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.next(' + step + ') : null'
  );

  if (result === 'busy') return false;
  if (!result || result === 'none') {
    if (!isAutoLiveSkip) toast('Не получилось переключить ролик');
    return false;
  }
  return true;
}

async function togglePlay() {
  if (!activeReady()) {
    toast('Лента ещё загружается');
    return null;
  }
  window.appApi.activateFeed(activeGuestId()).catch(() => {});
  const result = await pageEval(
    'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.togglePlay() : null'
  );
  if (typeof result === 'boolean') updatePlayUI(result);
  return result;
}

function bindVolumePopover() {
  let dragging = false;

  const setFromPointer = (e) => {
    const rect = els.volumeTrack.getBoundingClientRect();
    if (!rect.height) return;
    const ratio = 1 - (e.clientY - rect.top) / rect.height;
    const clamped = Math.min(1, Math.max(0, ratio));
    applyVolumeChange(Math.round(clamped * 100) / 100, false);
  };

  els.volumeTrack.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    els.volumeControl.classList.add('dragging');
    els.bezel.classList.add('chrome-open');
    try { els.volumeTrack.setPointerCapture(e.pointerId); } catch {}
    setFromPointer(e);
  });

  els.volumeTrack.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    e.stopPropagation();
    setFromPointer(e);
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    els.volumeControl.classList.remove('dragging');
    if (!settingsOpen && !shareOpen) els.bezel.classList.remove('chrome-open');
    try { els.volumeTrack.releasePointerCapture(e.pointerId); } catch {}
  };
  els.volumeTrack.addEventListener('pointerup', endDrag);
  els.volumeTrack.addEventListener('pointercancel', endDrag);

  els.volumeTrack.addEventListener('keydown', (e) => {
    if (!appState) return;
    const cur = appState.muted ? 0 : (typeof appState.volume === 'number' ? appState.volume : 1);
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      applyVolumeChange(Math.min(1, Math.round((cur + 0.05) * 100) / 100), false);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      applyVolumeChange(Math.max(0, Math.round((cur - 0.05) * 100) / 100), false);
    }
  });

  // Колесо мыши прямо над кнопкой звука / ползунком плавно меняет громкость (±5%)
  els.volumeControl.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || !appState) return;
      e.preventDefault();
      e.stopPropagation();
      const cur = appState.muted ? 0 : (typeof appState.volume === 'number' ? appState.volume : 1);
      const step = e.deltaY < 0 ? 0.05 : -0.05;
      const next = Math.min(1, Math.max(0, Math.round((cur + step) * 100) / 100));
      applyVolumeChange(next, false);
    },
    { passive: false }
  );
}

function pushVolumeToViews(vol, muted) {
  const expr =
    'if (window.__TIKTOK_FLOAT__) { window.__TIKTOK_FLOAT__.setVolume(' +
    Number(vol) +
    '); window.__TIKTOK_FLOAT__.setMuted(' +
    Boolean(muted) +
    '); }';
  if (ready) evalOnView(els.view, expr);
  if (dmViewReady) evalOnView(els.dmVideoView, expr);
}

function applyVolumeChange(rawVol, immediateSave) {
  if (!appState) return;
  const vol = Math.min(1, Math.max(0, Math.round((Number(rawVol) || 0) * 100) / 100));
  if (vol > 0.01) lastNonZeroVolume = vol;

  appState.volume = vol;
  appState.muted = vol <= 0.001;
  updateMuteUI();
  pushVolumeToViews(appState.volume, appState.muted);

  clearTimeout(volumeSaveTimer);
  if (immediateSave) {
    saveState({ volume: appState.volume, muted: appState.muted });
  } else {
    volumeSaveTimer = setTimeout(() => {
      window.appApi.setState({ volume: appState.volume, muted: appState.muted }).catch(() => {});
    }, 60);
  }
}

async function toggleMute() {
  if (!appState) return;
  const curVol = typeof appState.volume === 'number' ? appState.volume : 1;
  if (appState.muted || curVol <= 0.001) {
    appState.muted = false;
    if (curVol <= 0.01) {
      appState.volume = lastNonZeroVolume > 0.05 ? lastNonZeroVolume : 0.7;
    }
  } else {
    lastNonZeroVolume = curVol;
    appState.muted = true;
  }
  updateMuteUI();
  pushVolumeToViews(appState.volume, appState.muted);
  await saveState({ muted: appState.muted, volume: appState.volume });
  toast(appState.muted ? 'Звук выключен' : 'Громкость: ' + Math.round(appState.volume * 100) + '%');
}

async function toggleAuto() {
  if (!appState) return;
  appState.auto = !appState.auto;
  updateAutoUI();
  await saveState({ auto: appState.auto });
  await pushSettingsToPage();

  toast(
    appState.auto
      ? appState.autoMode === 'end'
        ? 'Автопросмотр включён'
        : 'Автопросмотр: каждые ' + appState.autoSeconds + ' с'
      : 'Автопросмотр выключен'
  );
}

async function setAutoMode(mode) {
  if (!appState) return;
  appState.autoMode = mode === 'end' ? 'end' : 'interval';
  updateAutoUI();
  await saveState({ autoMode: appState.autoMode });
  await pushSettingsToPage();
}

async function setAutoSeconds(seconds) {
  if (!appState || !Number.isFinite(seconds)) return;
  appState.autoMode = 'interval';
  appState.autoSeconds = seconds;
  updateAutoUI();
  await saveState({ autoMode: 'interval', autoSeconds: seconds });
  await pushSettingsToPage();
}

async function toggleSkipLives() {
  if (!appState) return;
  appState.skipLives = !(appState.skipLives !== false);
  updateSkipLivesUI();
  await saveState({ skipLives: appState.skipLives });
  await pushSettingsToPage();
  toast(appState.skipLives ? 'Стримы скрыты в ленте' : 'Стримы снова видны в ленте');
  if (
    appState.skipLives &&
    currentHud &&
    currentHud.isLive &&
    (activeTab === 'feed' || activeTab === 'friends')
  ) {
    skipLiveCard(1);
  }
}

async function toggleSiteMenu() {
  if (!appState) return;
  appState.menuOpen = !appState.menuOpen;
  updateMenuUI();
  syncPassthroughMode();

  if (appState.menuOpen) {
    await removeCleanupCss();
    toast('Открыт интерфейс TikTok');
  } else {
    await applyCleanupCss();
    toast('Возвращён iOS-интерфейс');
  }

  await saveState({ menuOpen: appState.menuOpen });
  await pushSettingsToPage();
}

async function stepZoom(delta) {
  if (!appState) return;
  let idx = ZOOM_STEPS.findIndex((z) => Math.abs(z - appState.zoom) < 0.01);
  if (idx < 0) idx = ZOOM_STEPS.indexOf(1);
  const nextIdx = Math.min(ZOOM_STEPS.length - 1, Math.max(0, idx + delta));
  const nextZoom = ZOOM_STEPS[nextIdx];
  appState.zoom = nextZoom;
  setZoom(nextZoom);
  updateZoomUI();
  await saveState({ zoom: nextZoom });
}

function changeOpacity() {
  if (!appState) return;
  const percent = Number(els.opacityInput.value);
  if (!Number.isFinite(percent)) return;

  els.opacityVal.textContent = percent + '%';
  appState.opacity = percent / 100;

  clearTimeout(opacityTimer);
  opacityTimer = setTimeout(() => {
    window.appApi.setState({ opacity: appState.opacity }).catch(() => {});
  }, 25);
}

async function reloadFeed() {
  if (!appState) return;
  if (activeTab === 'chat' || activeTab === 'friends') {
    try { els.dmVideoView.reload(); } catch {}
    return;
  }
  hideError();
  showLoading('Обновление ленты', 'Подключаюсь к TikTok');
  setPillState('Загрузка', 'loading', true);
  ready = false;
  clearInterval(syncPollTimer);

  const url = appState.url || FALLBACK_URL;
  try {
    const promise = els.view.loadURL(url);
    if (promise && typeof promise.catch === 'function') promise.catch(() => {});
  } catch {
    els.view.src = url;
  }
}

function openInBrowser() {
  let url = (appState && appState.url) || FALLBACK_URL;
  try {
    url = activeView().getURL() || url;
  } catch {}
  window.appApi.openExternal(url);
}

/* ─── Связь с отдельным окном комментариев ───────────────────────── */

function pushCommentsIfCurrent(data) {
  if (!data || typeof data !== 'object') return;
  if (lastHudVideoId && data.videoId && data.videoId !== lastHudVideoId) return;
  window.appApi.pushCommentsData(data);
}

async function ensureCommentsOpen(forceReopen) {
  if (!activeReady()) return null;
  clearTimeout(commentsSwitchTimer);
  commentsSwitchTimer = null;
  const myToken = ++commentsSyncToken;
  const targetVideoId = (currentHud && currentHud.videoId) || lastHudVideoId || '';
  commentsOpening = true;

  const isStillMine = () =>
    myToken === commentsSyncToken &&
    commentsOpen &&
    (!targetVideoId || !lastHudVideoId || lastHudVideoId === targetVideoId);

  try {
    await pageEval('window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.setCommentsTracking(true) : null');
    if (!isStillMine()) return null;

    // Если API уже предзагрузил комментарии именно для этого ролика — показываем мгновенно!
    if (!forceReopen) {
      const instant = await pageEval(
        'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.getComments(false) : null'
      );
      if (!isStillMine()) return null;
      if (
        instant &&
        instant.comments &&
        instant.comments.length > 0 &&
        (!targetVideoId || instant.videoId === targetVideoId)
      ) {
        pushCommentsIfCurrent(instant);
        return instant;
      }
    }

    let prep = await trustedClickTarget('comment', forceReopen ? { forceClick: true } : null);
    if (!isStillMine()) return null;

    // Если скрытый сайдбар TikTok застрял на ПРОШЛОМ видео — сначала ждём ~1с,
    // а если TikTok сам не обновился, переоткрываем сайдбар на текущем ролике
    if (prep && prep.alreadyOpen && prep.sidebarStale && !forceReopen) {
      for (let w = 0; w < 4; w++) {
        await delay(260);
        if (!isStillMine()) return null;
        const data = await pageEval(
          'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.getComments(false) : null'
        );
        if (!isStillMine()) return null;
        if (data && data.comments && data.comments.length > 0 && !data.staleDom) {
          pushCommentsIfCurrent(data);
          return data;
        }
        if (data && !data.staleDom && !data.loading) {
          pushCommentsIfCurrent(data);
          return data;
        }
      }
      // Всё ещё застрял на прошлом видео: закрываем и заново открываем комментарии для текущего
      await trustedClickTarget('comment', { forceClick: true });
      await delay(240);
      if (!isStillMine()) return null;
      prep = await trustedClickTarget('comment', { forceClick: true });
      if (!isStillMine()) return null;
    }

    if (prep && (!prep.alreadyOpen || forceReopen || prep.sidebarStale)) {
      for (let i = 0; i < 16; i++) {
        await delay(280);
        if (!isStillMine()) return null;
        const data = await pageEval(
          'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.getComments(false) : null'
        );
        if (!isStillMine()) return null;
        if (data && data.comments && data.comments.length > 0) {
          pushCommentsIfCurrent(data);
          return data;
        }
        if (data && !data.loading && !data.staleDom) {
          pushCommentsIfCurrent(data);
          return data;
        }
      }
    }

    const finalData = await pageEval(
      'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.getComments(true) : null'
    );
    if (!isStillMine()) return null;
    if (finalData) pushCommentsIfCurrent(finalData);
    return finalData;
  } finally {
    if (myToken === commentsSyncToken) {
      commentsOpening = false;
    }
  }
}

async function toggleCommentsWindow() {
  if (!activeReady()) {
    toast('Лента ещё загружается');
    return;
  }

  const initialPayload = {
    videoId: (currentHud && currentHud.videoId) || '',
    authorHandle: (currentHud && currentHud.authorHandle) || '',
    authorName: (currentHud && currentHud.authorName) || 'TikTok',
    desc: (currentHud && currentHud.desc) || '',
    totalText: (currentHud && currentHud.commentsText) || '0',
    loading: true,
    hasMore: false,
    comments: []
  };

  const res = await window.appApi.toggleComments(initialPayload);
  commentsOpen = Boolean(res && res.open);
  updateCommentsButtonUI();

  if (commentsOpen) {
    await ensureCommentsOpen(false);
  } else {
    await pageEval('window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.setCommentsTracking(false) : null');
  }
}

function handleCommentsWindowState(info) {
  if (!info) return;
  const wasOpen = commentsOpen;
  commentsOpen = Boolean(info.open);
  updateCommentsButtonUI();
  if (wasOpen && !commentsOpen && activeReady()) {
    pageEval('window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.setCommentsTracking(false) : null');
  }
}

async function handleCommentsAction(action) {
  if (!action || typeof action !== 'object') return;

  if (action.type === 'openLogin') {
    await startQrLogin();
    return;
  }

  if (!activeReady()) return;

  if (action.type === 'refresh') {
    await pageEval(
      'window.__TIKTOK_FLOAT__ && window.__TIKTOK_FLOAT__.clearDomCommentsForCurrent ? window.__TIKTOK_FLOAT__.clearDomCommentsForCurrent() : null'
    );
    await ensureCommentsOpen(false);
    return;
  }

  if (action.type === 'loadMore') {
    const data = await pageEval(
      'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.loadMoreComments() : null'
    );
    if (data) pushCommentsIfCurrent(data);
    return;
  }

  if (action.type === 'expandReplies') {
    const prep = await trustedClickTarget('comment-more-replies', action);
    if (prep && prep.ok) {
      await delay(750);
      const data = await pageEval(
        'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.getComments(true) : null'
      );
      if (data) pushCommentsIfCurrent(data);
    }
    return;
  }

  if (action.type === 'like') {
    const prep = await trustedClickTarget('comment-like', action);
    if (prep && prep.ok) {
      await delay(420);
      const data = await pageEval(
        'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.getComments(true) : null'
      );
      if (data) pushCommentsIfCurrent(data);
    }
    return;
  }

  if (action.type === 'post') {
    await ensureCommentsOpen(false);
    if (action.replyTo) {
      await trustedClickTarget('comment-reply', action.replyTo);
      await delay(180);
    }

    const filled = await pageEval(
      'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.fillCommentEditor(' +
        JSON.stringify(action.text || '') + ') : null'
    );
    if (!filled || !filled.ok) {
      window.appApi.pushCommentsData({
        postResult: filled || { ok: false, loginRequired: true }
      });
      return;
    }

    const postPrep = await trustedClickTarget('comment-post');
    if (!postPrep || !postPrep.ok) {
      window.appApi.pushCommentsData({ postResult: { ok: false } });
      return;
    }

    await delay(650);
    const data = await pageEval(
      'window.__TIKTOK_FLOAT__ ? window.__TIKTOK_FLOAT__.getComments(true) : null'
    );
    window.appApi.pushCommentsData({
      postResult: { ok: true }
    });
    if (data) window.appApi.pushCommentsData(data);
  }
}

/* ─── Обновление состояния интерфейса ────────────────────────────── */

function applyStateToUI() {
  const percent = Math.round(appState.opacity * 100);
  els.opacityInput.value = String(percent);
  els.opacityVal.textContent = percent + '%';

  updatePinUI();
  updateSpeedUI();
  updateAutoUI();
  updateSkipLivesUI();
  updateMuteUI();
  updateMenuUI();
  updateZoomUI();
  updateSizePresetUI();
  updateCommentsButtonUI();
  updateMessagesButtonUI();
}

function updatePinUI() {
  if (!appState) return;
  els.pinBtn.classList.toggle('active', appState.alwaysOnTop);
  els.pinBtn.setAttribute('aria-pressed', String(appState.alwaysOnTop));
  els.pinBtn.title = appState.alwaysOnTop
    ? 'Поверх всех окон · нажми, чтобы открепить'
    : 'Закрепить поверх всех окон';
}

function updateSpeedUI() {
  if (!appState) return;
  const rate = Number(appState.playbackRate) || 1;
  const label = formatSpeed(rate);
  els.speedBtn.textContent = label;
  els.speedBtn.classList.toggle('active', Math.abs(rate - 1) > 0.01);
  els.speedMeta.textContent = label;
  for (const btn of els.speedChips.querySelectorAll('[data-speed]')) {
    btn.classList.toggle('active', Math.abs(Number(btn.dataset.speed) - rate) < 0.01);
  }
}

function updateAutoUI() {
  if (!appState) return;
  els.autoBtn.classList.toggle('active', appState.auto);
  els.autoBtn.setAttribute('aria-pressed', String(appState.auto));
  els.autoLabel.textContent = 'Авто';

  els.modeIntervalBtn.classList.toggle('active', appState.autoMode === 'interval');
  els.modeEndBtn.classList.toggle('active', appState.autoMode === 'end');
  els.intervalChips.classList.toggle('hidden', appState.autoMode === 'end');

  for (const btn of els.intervalChips.querySelectorAll('[data-seconds]')) {
    btn.classList.toggle('active', Number(btn.dataset.seconds) === appState.autoSeconds);
  }

  els.autoStatusMeta.textContent = appState.auto
    ? appState.autoMode === 'end'
      ? 'До конца видео'
      : 'Каждые ' + appState.autoSeconds + ' с'
    : 'Выключен';

  if (activeReady()) updateIdlePill();
}

function updateSkipLivesUI() {
  if (!appState || !els.skipLivesBtn) return;
  const enabled = appState.skipLives !== false;
  els.skipLivesBtn.setAttribute('aria-checked', String(enabled));
  els.skipLivesBtn.title = enabled
    ? 'Стримы скрыты · нажми, чтобы показывать LIVE в ленте'
    : 'Стримы видны · нажми, чтобы отключить LIVE в ленте';
  if (els.skipLivesMeta) {
    els.skipLivesMeta.textContent = enabled
      ? 'Убирает LIVE из ленты и блокирует переход'
      : 'Стримы видны, редирект на LIVE заблокирован';
  }
}

function updateMuteUI() {
  if (!appState) return;
  const rawVol = typeof appState.volume === 'number' ? appState.volume : 1;
  if (rawVol > 0.01) lastNonZeroVolume = rawVol;
  const effectiveVol = appState.muted ? 0 : rawVol;
  const pct = Math.round(effectiveVol * 100);

  const icon = els.muteBtn.querySelector('.icon');
  if (icon) {
    icon.innerHTML =
      pct <= 0 ? ICONS.muted : pct <= 50 ? ICONS.volumeLow : ICONS.volume;
  }
  const label =
    pct <= 0 ? 'Включить звук' : 'Громкость ' + pct + '% (клик — выключить, колесо — регулировать)';
  els.muteBtn.title = label;
  els.muteBtn.setAttribute('aria-label', label);

  if (els.volumeControl) {
    els.volumeControl.classList.toggle('is-muted', pct <= 0);
  }
  if (els.volumePopoverVal) {
    els.volumePopoverVal.textContent = pct + '%';
  }
  if (els.volumeFill) {
    els.volumeFill.style.height = pct + '%';
  }
  if (els.volumeThumb) {
    els.volumeThumb.style.bottom = 'calc(' + pct + '% - 6.5px)';
  }
  if (els.volumeTrack) {
    els.volumeTrack.setAttribute('aria-valuenow', String(pct));
  }
  if (els.volumeSlider && Number(els.volumeSlider.value) !== pct) {
    els.volumeSlider.value = String(pct);
  }
  if (els.volumeSettingsVal) {
    els.volumeSettingsVal.textContent = pct + '%';
  }
}

function updateMenuUI() {
  if (!appState) return;
  els.siteMenuBtn.classList.toggle('active', appState.menuOpen);
}

function updateZoomUI() {
  if (!appState) return;
  els.zoomVal.textContent = Math.round(appState.zoom * 100) + '%';
}

function updateSizePresetUI() {
  if (!appState) return;
  const names = {
    mini: 'Мини',
    compact: 'Компакт',
    standard: 'Стандарт',
    large: 'Большой',
    custom: 'Свой'
  };
  els.sizeMeta.textContent = names[appState.presetId] || 'Свой';
  for (const btn of els.presetChips.querySelectorAll('[data-preset]')) {
    btn.classList.toggle('active', btn.dataset.preset === appState.presetId);
  }
}

function updateCommentsButtonUI() {
  els.hudCommentBtn.classList.toggle('open', commentsOpen);
  els.hudCommentBtn.setAttribute('aria-pressed', String(commentsOpen));
}

function updatePlayUI(playing) {
  if (playing === lastPlaying) return;
  lastPlaying = playing;
  const icon = els.playBtn.querySelector('.icon');
  if (icon) icon.innerHTML = playing ? ICONS.pause : ICONS.play;
  const label = playing ? 'Пауза' : 'Воспроизвести';
  els.playBtn.title = label;
  els.playBtn.setAttribute('aria-label', label);
}

function setPillState(text, kind, showBadge) {
  els.statusText.textContent = text;
  els.statusDot.className = 'status-dot' + (kind ? ' ' + kind : '');
  els.dragPill.classList.toggle('has-badge', Boolean(showBadge));
}

function updateIdlePill() {
  setPillState('', 'online', false);
}

function showLoading(title, subtitle) {
  clearTimeout(loadingTimer);
  els.loadingTitle.textContent = title || 'Загрузка ленты';
  els.loadingSub.textContent = subtitle || '';
  els.loading.classList.remove('hidden');
}

function hideLoadingSoon(ms) {
  clearTimeout(loadingTimer);
  loadingTimer = setTimeout(() => {
    els.loading.classList.add('hidden');
  }, ms || 0);
}

function showError(message) {
  ready = false;
  clearInterval(syncPollTimer);
  els.loading.classList.add('hidden');
  els.errorText.textContent =
    message || 'Проверь соединение с интернетом и попробуй снова';
  els.errorPanel.classList.remove('hidden');
  setPillState('Ошибка', 'error', true);
}

function hideError() {
  els.errorPanel.classList.add('hidden');
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

async function saveState(patch) {
  try {
    const next = await window.appApi.setState(patch);
    if (next) appState = { ...appState, ...next };
    return next;
  } catch (error) {
    console.error('Не удалось сохранить настройки:', error);
    return null;
  }
}
