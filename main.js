'use strict';

const {
  app,
  BrowserWindow,
  webContents,
  ipcMain,
  shell,
  screen,
  globalShortcut,
  session,
  Menu,
  clipboard
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const DM_ENGINE = require('./dm-engine');

// Убираем спам Chromium WebRTC STUN в консоли (stun.l.google.com, errorcode -105)
try {
  app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
} catch {}

const APP_TITLE = 'TikTok Float';
const APP_ID = 'ru.tiktokfloat.desktop';
const APP_DIR = __dirname;

function resolveUnpacked(fileName) {
  const unpacked = path.join(
    process.resourcesPath || '',
    'app.asar.unpacked',
    fileName
  );
  if (app.isPackaged && fs.existsSync(unpacked)) return unpacked;
  return path.join(APP_DIR, fileName);
}

const APP_ICON = resolveUnpacked('icon.ico');
const WEBVIEW_PRELOAD = resolveUnpacked('webview-preload.js');
const DM_ENGINE_PRELOAD = resolveUnpacked('dm-engine-preload.js');
const TIKTOK_URL = 'https://www.tiktok.com/foryou?lang=ru';
const TIKTOK_MESSAGES_URL = 'https://www.tiktok.com/messages?lang=ru';

const FRAME_PAD = 8;
const MIN_WIDTH = 256;
const MIN_HEIGHT = 448;
const MAX_WIDTH = 680;
const MAX_HEIGHT = 1140;
const DEFAULT_ASPECT = 9 / 16;

const COMMENTS_MIN_WIDTH = 308;
const COMMENTS_MIN_HEIGHT = 420;
const COMMENTS_DEFAULT_WIDTH = 364;

const MESSAGES_MIN_WIDTH = 336;
const MESSAGES_MIN_HEIGHT = 460;
const MESSAGES_DEFAULT_WIDTH = 388;
const MESSAGES_MAX_WIDTH = 780;

const DOCK_GAP = 4;

app.setName(APP_TITLE);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
app.setPath('userData', path.join(app.getPath('appData'), 'TikTokFloat'));

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/' +
  process.versions.chrome +
  ' Safari/537.36';
app.userAgentFallback = CHROME_UA;

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const DEFAULT_STATE = {
  stateVersion: 3,
  bounds: null,
  commentsBounds: null,
  commentsDocked: true,
  messagesBounds: null,
  messagesDocked: true,
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
  menuOpen: false,
  onboardingSeen: false
};

const SIZE_PRESETS = [
  { id: 'mini', label: 'Мини', width: 280, height: 484 },
  { id: 'compact', label: 'Компакт', width: 352, height: 612 },
  { id: 'standard', label: 'Стандарт', width: 412, height: 720 },
  { id: 'large', label: 'Большой', width: 484, height: 848 }
];

const ZOOM_VALUES = [0.75, 0.8, 0.85, 0.9, 1, 1.1, 1.25];
const SPEED_VALUES = [0.5, 1, 1.25, 1.5, 2];

let win = null;
let commentsWin = null;
let messagesWin = null;
let dmEngineWin = null;
let dmEngineReady = false;
let latestDmSnapshot = null;
let dmPendingVideoUrl = '';
let dmResolvingVideo = false;
let fallbackGuestWebContents = null;
let state = { ...DEFAULT_STATE };
let saveTimer = null;
let boundsAnimTimer = null;
let isSyncingDock = false;
let latestCommentsPayload = null;

const resizeSessions = {
  main: null,
  comments: null,
  messages: null
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function stateFile() {
  return path.join(app.getPath('userData'), 'state.json');
}

function normalizeBounds(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const width = Math.round(Number(raw.width) || 0);
  const height = Math.round(Number(raw.height) || 0);
  if (width < 120 || height < 120) return null;
  return {
    x: Math.round(Number(raw.x) || 0),
    y: Math.round(Number(raw.y) || 0),
    width,
    height
  };
}

function normalizeContacts(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const handle = String(item.handle || '').replace(/^@/, '').trim();
    const name = String(item.name || handle || '').trim();
    const id = String(item.id || handle || name).trim().toLowerCase();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: name.slice(0, 60),
      handle: handle.slice(0, 60),
      avatar: typeof item.avatar === 'string' ? item.avatar.slice(0, 500) : '',
      lastSentAt: Number(item.lastSentAt) || 0
    });
    if (out.length >= 30) break;
  }
  return out;
}

function normalizeState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const merged = { ...DEFAULT_STATE, ...source };
  const prevVersion = Number(source.stateVersion) || 1;
  const seconds = Number(merged.autoSeconds);
  const opacity = Number(merged.opacity);
  const zoom = Number(merged.zoom);
  const playbackRate = Number(merged.playbackRate);
  const volume = Number(merged.volume);

  const autoMode =
    prevVersion < 2
      ? 'end'
      : merged.autoMode === 'interval'
        ? 'interval'
        : 'end';

  return {
    stateVersion: 3,
    bounds: normalizeBounds(merged.bounds),
    commentsBounds: normalizeBounds(merged.commentsBounds),
    commentsDocked: merged.commentsDocked !== false,
    messagesBounds: normalizeBounds(merged.messagesBounds),
    messagesDocked: merged.messagesDocked !== false,
    recentContacts: normalizeContacts(merged.recentContacts),
    alwaysOnTop: merged.alwaysOnTop !== false,
    opacity: Number.isFinite(opacity) ? clamp(opacity, 0.55, 1) : 1,
    zoom: ZOOM_VALUES.includes(zoom) ? zoom : 1,
    playbackRate: SPEED_VALUES.includes(playbackRate) ? playbackRate : 1,
    auto: merged.auto === true,
    autoMode,
    autoSeconds: Number.isFinite(seconds) ? clamp(seconds, 3, 120) : 10,
    muted: merged.muted === true,
    volume: Number.isFinite(volume) ? clamp(Math.round(volume * 100) / 100, 0, 1) : 1,
    menuOpen: merged.menuOpen === true,
    onboardingSeen: merged.onboardingSeen === true
  };
}

function loadState() {
  try {
    const raw = fs.readFileSync(stateFile(), 'utf8').replace(/^\uFEFF/, '');
    return normalizeState(JSON.parse(raw));
  } catch {
    return normalizeState(DEFAULT_STATE);
  }
}

function detectPresetId(width) {
  let closest = SIZE_PRESETS[2].id;
  let minDiff = Infinity;
  for (const preset of SIZE_PRESETS) {
    const diff = Math.abs(preset.width - width);
    if (diff < minDiff) {
      minDiff = diff;
      closest = preset.id;
    }
  }
  return minDiff <= 22 ? closest : 'custom';
}

function publicState() {
  const { bounds, commentsBounds, messagesBounds, ...rest } = state;
  const currentBounds = win && !win.isDestroyed() ? win.getBounds() : bounds;
  const width = currentBounds ? currentBounds.width : SIZE_PRESETS[2].width;
  const height = currentBounds ? currentBounds.height : SIZE_PRESETS[2].height;

  return {
    ...rest,
    width,
    height,
    presetId: detectPresetId(width),
    presets: SIZE_PRESETS,
    url: TIKTOK_URL,
    userAgent: CHROME_UA,
    webviewPreloadUrl: pathToFileURL(WEBVIEW_PRELOAD).toString(),
    version: app.getVersion()
  };
}

function saveStateNow() {
  if (win && !win.isDestroyed() && !win.isMinimized() && !win.isFullScreen()) {
    const b = win.getBounds();
    state.bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
  }
  if (
    commentsWin &&
    !commentsWin.isDestroyed() &&
    !commentsWin.isMinimized() &&
    !state.commentsDocked
  ) {
    const cb = commentsWin.getBounds();
    state.commentsBounds = { x: cb.x, y: cb.y, width: cb.width, height: cb.height };
  }
  if (
    messagesWin &&
    !messagesWin.isDestroyed() &&
    !messagesWin.isMinimized() &&
    !state.messagesDocked
  ) {
    const mb = messagesWin.getBounds();
    state.messagesBounds = { x: mb.x, y: mb.y, width: mb.width, height: mb.height };
  }

  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    console.error('Не удалось сохранить настройки:', error);
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveStateNow, 300);
}

function boundsAreVisible(bounds) {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const overlapX = Math.max(
      0,
      Math.min(bounds.x + bounds.width, area.x + area.width) -
        Math.max(bounds.x, area.x)
    );
    const overlapY = Math.max(
      0,
      Math.min(bounds.y + bounds.height, area.y + area.height) -
        Math.max(bounds.y, area.y)
    );
    return overlapX >= 96 && overlapY >= 96;
  });
}

function initialBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  const fallbackWidth = Math.min(SIZE_PRESETS[2].width, area.width - 32);
  const fallbackHeight = Math.min(SIZE_PRESETS[2].height, area.height - 32);
  const fallback = {
    width: Math.round(fallbackWidth),
    height: Math.round(fallbackHeight),
    x: Math.round(area.x + area.width - fallbackWidth - 24),
    y: Math.round(area.y + Math.max(20, (area.height - fallbackHeight) / 2))
  };

  if (!state.bounds || !boundsAreVisible(state.bounds)) return fallback;

  const display = screen.getDisplayMatching(state.bounds);
  const workArea = display.workArea;
  const width = clamp(
    state.bounds.width || fallbackWidth,
    MIN_WIDTH,
    Math.min(MAX_WIDTH, workArea.width - 16)
  );
  const height = clamp(
    state.bounds.height || fallbackHeight,
    MIN_HEIGHT,
    Math.min(MAX_HEIGHT, workArea.height - 16)
  );
  const x = clamp(
    state.bounds.x,
    workArea.x - width + 100,
    workArea.x + workArea.width - 100
  );
  const y = clamp(
    state.bounds.y,
    workArea.y - FRAME_PAD,
    workArea.y + workArea.height - 80
  );

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function computeDockedPanelBounds(kind) {
  if (!win || win.isDestroyed()) return null;
  const mainBounds = win.getBounds();
  const display = screen.getDisplayMatching(mainBounds);
  const area = display.workArea;

  const isMsg = kind === 'messages';
  const targetWin = isMsg ? messagesWin : commentsWin;
  const savedBounds = isMsg ? state.messagesBounds : state.commentsBounds;
  const minW = isMsg ? MESSAGES_MIN_WIDTH : COMMENTS_MIN_WIDTH;
  const minH = isMsg ? MESSAGES_MIN_HEIGHT : COMMENTS_MIN_HEIGHT;
  const maxW = isMsg ? MESSAGES_MAX_WIDTH : 480;
  const defW = isMsg ? MESSAGES_DEFAULT_WIDTH : COMMENTS_DEFAULT_WIDTH;

  const currentWidth =
    targetWin && !targetWin.isDestroyed()
      ? targetWin.getBounds().width
      : (savedBounds && savedBounds.width) || defW;

  const width = clamp(Math.round(currentWidth), minW, Math.min(maxW, area.width - 40));
  const height = clamp(Math.round(mainBounds.height), minH, area.height - 16);

  const rightX = mainBounds.x + mainBounds.width - FRAME_PAD * 2 + DOCK_GAP + FRAME_PAD;
  const leftX = mainBounds.x - width + FRAME_PAD * 2 - DOCK_GAP - FRAME_PAD;
  const fitsRight = rightX + width <= area.x + area.width + FRAME_PAD;
  const fitsLeft = leftX >= area.x - FRAME_PAD;

  const preferLeft =
    isMsg && Boolean(commentsWin && !commentsWin.isDestroyed() && state.commentsDocked);

  let x;
  if (preferLeft) {
    if (fitsLeft) x = leftX;
    else if (fitsRight) x = rightX;
    else x = clamp(leftX, area.x, area.x + area.width - width);
  } else {
    if (fitsRight) x = rightX;
    else if (fitsLeft) x = leftX;
    else x = clamp(rightX, area.x, area.x + area.width - width);
  }

  const y = clamp(
    mainBounds.y,
    area.y - FRAME_PAD,
    area.y + area.height - height + FRAME_PAD
  );

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function syncDockedPanels() {
  isSyncingDock = true;
  try {
    if (commentsWin && !commentsWin.isDestroyed() && state.commentsDocked) {
      const target = computeDockedPanelBounds('comments');
      if (target) commentsWin.setBounds(target);
    }
    if (messagesWin && !messagesWin.isDestroyed() && state.messagesDocked) {
      const target = computeDockedPanelBounds('messages');
      if (target) messagesWin.setBounds(target);
    }
  } finally {
    setTimeout(() => {
      isSyncingDock = false;
    }, 30);
  }
}

function notifyBoundsChanged() {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  win.webContents.send('window:bounds', {
    width: b.width,
    height: b.height,
    presetId: detectPresetId(b.width)
  });
}

function notifyCommentsWindowState() {
  const payload = {
    open: Boolean(commentsWin && !commentsWin.isDestroyed() && commentsWin.isVisible()),
    docked: Boolean(state.commentsDocked)
  };
  if (win && !win.isDestroyed()) {
    win.webContents.send('comments:window-state', payload);
  }
  if (commentsWin && !commentsWin.isDestroyed()) {
    commentsWin.webContents.send('comments:window-state', payload);
  }
}

function notifyMessagesWindowState() {
  const payload = {
    open: Boolean(messagesWin && !messagesWin.isDestroyed() && messagesWin.isVisible()),
    docked: Boolean(state.messagesDocked)
  };
  if (win && !win.isDestroyed()) {
    win.webContents.send('messages:window-state', payload);
  }
  if (messagesWin && !messagesWin.isDestroyed()) {
    messagesWin.webContents.send('messages:window-state', payload);
  }
}

function cancelBoundsAnimation() {
  if (boundsAnimTimer) {
    clearInterval(boundsAnimTimer);
    boundsAnimTimer = null;
  }
}

function animateMainBounds(target, durationMs = 190) {
  if (!win || win.isDestroyed()) return;
  cancelBoundsAnimation();

  const start = win.getBounds();
  const startTime = Date.now();
  const stepMs = 14;

  const finish = () => {
    cancelBoundsAnimation();
    if (!win || win.isDestroyed()) return;
    win.setBounds({
      x: Math.round(target.x),
      y: Math.round(target.y),
      width: Math.round(target.width),
      height: Math.round(target.height)
    });
    syncDockedPanels();
    notifyBoundsChanged();
    scheduleSave();
  };

  if (durationMs <= 16) {
    finish();
    return;
  }

  boundsAnimTimer = setInterval(() => {
    if (!win || win.isDestroyed()) {
      cancelBoundsAnimation();
      return;
    }

    const elapsed = Date.now() - startTime;
    const rawT = Math.min(1, elapsed / durationMs);
    const eased = 1 - Math.pow(1 - rawT, 3);

    const next = {
      x: Math.round(start.x + (target.x - start.x) * eased),
      y: Math.round(start.y + (target.y - start.y) * eased),
      width: Math.round(start.width + (target.width - start.width) * eased),
      height: Math.round(start.height + (target.height - start.height) * eased)
    };

    win.setBounds(next);
    syncDockedPanels();

    if (rawT >= 1) {
      finish();
    }
  }, stepMs);
}

/* ─── Невидимый фоновый движок ЛС (/messages) ─────────────────────── */

let dmScrollingChats = false;
let dmLoggedFirstChats = false;
let allowBusinessSuiteFallback = false;
let businessSuiteCheckTimer = null;
const cachedDmConversations = new Map();
const cachedDmStories = [];
const dmDebugTimeline = [];
let dialogContactsFromMain = [];
let stealthSendSeq = 0;
const pendingStealthSendResolvers = new Map();

function logDmDebug(event, detail) {
  const entry = {
    t: new Date().toISOString(),
    event: String(event || ''),
    detail: detail ? String(detail).slice(0, 220) : ''
  };
  dmDebugTimeline.push(entry);
  if (dmDebugTimeline.length > 45) dmDebugTimeline.shift();
  try {
    console.log('[DM-DEBUG]', entry.event, entry.detail);
  } catch {}
}

function getTikTokDmFrames() {
  if (!dmEngineWin || dmEngineWin.isDestroyed()) return [];
  try {
    const mainFrame = dmEngineWin.webContents.mainFrame;
    if (!mainFrame) return [];
    const list = Array.isArray(mainFrame.framesInSubtree)
      ? mainFrame.framesInSubtree
      : [mainFrame];
    return list.filter((f) => {
      if (!f || f.isDestroyed && f.isDestroyed()) return false;
      const u = String(f.url || '');
      return Boolean(u && u !== 'about:blank' && !/google|doubleclick|analytics|recaptcha/i.test(u));
    });
  } catch {
    return [];
  }
}

async function injectDmEngineIntoAllFrames() {
  if (!dmEngineWin || dmEngineWin.isDestroyed()) return;
  const frames = getTikTokDmFrames();
  for (const frame of frames) {
    try {
      const snap = await frame.executeJavaScript(DM_ENGINE.controller, true);
      dmEngineReady = true;
      if (snap && typeof snap === 'object') {
        if (!snap.isOuterShell || (snap.conversations && snap.conversations.length > 0)) {
          handleDmSnapshot(snap);
        }
      }
    } catch {}
  }
}

function ensureDmEngine() {
  if (dmEngineWin && !dmEngineWin.isDestroyed()) {
    return dmEngineWin;
  }

  dmEngineReady = false;
  dmLoggedFirstChats = false;
  allowBusinessSuiteFallback = false;
  clearTimeout(businessSuiteCheckTimer);
  logDmDebug('engine-create', TIKTOK_MESSAGES_URL);

  dmEngineWin = new BrowserWindow({
    width: 1180,
    height: 540,
    show: false,
    paintWhenInitiallyHidden: true,
    skipTaskbar: true,
    webPreferences: {
      preload: DM_ENGINE_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  dmEngineWin.webContents.setAudioMuted(true);
  dmEngineWin.webContents.setWindowOpenHandler(({ url }) => {
    if (isTikTokVideoUrl(url)) {
      if (dmResolvingVideo) {
        dmPendingVideoUrl = url;
      } else if (win && !win.isDestroyed()) {
        win.webContents.send('messages:open-video', { url, chatName: 'Чат' });
      }
    }
    return { action: 'deny' };
  });

  const handleBusinessSuiteRedirect = (event, url, sourceEvent) => {
    if (!url || !/\/business-suite\/messages/i.test(url)) return;
    if (allowBusinessSuiteFallback) {
      logDmDebug('allowing-business-suite', sourceEvent + ' -> ' + url);
      return;
    }
    // Блокируем редирект с /messages на /business-suite/messages (чтобы загрузившиеся чаты не исчезали через секунду!)
    event.preventDefault();
    logDmDebug('blocked-business-suite-redirect', sourceEvent + ' -> ' + url);

    clearTimeout(businessSuiteCheckTimer);
    businessSuiteCheckTimer = setTimeout(async () => {
      if (!dmEngineWin || dmEngineWin.isDestroyed()) return;
      await injectDmEngineIntoAllFrames();
      const rowsNow = await dmEval(
        'window.__TTF_DM_ENGINE__ && window.__TTF_DM_ENGINE__.hasChatRows ? window.__TTF_DM_ENGINE__.hasChatRows() : false'
      );
      if (rowsNow) {
        logDmDebug('stayed-on-messages-ok', 'chat rows intact on /messages');
        scrollDmChatListTrusted().catch(() => {});
        writeDmDebug('stayed-on-messages-ok');
      } else {
        // Если TikTok всё же размонтировал DOM на /messages — включаем режим /business-suite/messages и подключаемся прямо внутрь его <iframe>!
        allowBusinessSuiteFallback = true;
        logDmDebug('fallback-to-business-suite-iframe', url);
        dmEngineWin.loadURL(url, { userAgent: CHROME_UA }).catch(() => {});
      }
    }, 2200);
  };

  dmEngineWin.webContents.on('will-navigate', (e, url) =>
    handleBusinessSuiteRedirect(e, url, 'will-navigate')
  );
  dmEngineWin.webContents.on('will-redirect', (e, url) =>
    handleBusinessSuiteRedirect(e, url, 'will-redirect')
  );

  const onFrameReady = async (tag) => {
    if (!dmEngineWin || dmEngineWin.isDestroyed()) return;
    logDmDebug('frame-ready', tag + ' frames=' + getTikTokDmFrames().length);
    await injectDmEngineIntoAllFrames();
    setTimeout(() => {
      scrollDmChatListTrusted().catch(() => {});
    }, 1200);
  };

  const captureVideoNav = (_e, url) => {
    if (isTikTokVideoUrl(url)) {
      dmPendingVideoUrl = url;
    } else if (url && /\/messages/i.test(url)) {
      logDmDebug('navigated', url);
      setTimeout(() => {
        injectDmEngineIntoAllFrames().catch(() => {});
      }, 650);
    }
  };
  dmEngineWin.webContents.on('did-navigate-in-page', captureVideoNav);
  dmEngineWin.webContents.on('did-navigate', captureVideoNav);
  dmEngineWin.webContents.on('dom-ready', () => onFrameReady('dom-ready'));
  dmEngineWin.webContents.on('did-finish-load', () => onFrameReady('did-finish-load'));
  dmEngineWin.webContents.on('did-frame-finish-load', (_e, isMainFrame) => {
    if (!isMainFrame) onFrameReady('child-iframe-loaded');
  });

  dmEngineWin.on('closed', () => {
    clearTimeout(businessSuiteCheckTimer);
    dmEngineWin = null;
    dmEngineReady = false;
  });

  dmEngineWin.loadURL(TIKTOK_MESSAGES_URL, { userAgent: CHROME_UA }).catch(() => {});
  return dmEngineWin;
}

/**
 * Прокручивает левый список диалогов реальными событиями колеса Chromium (mouseWheel) + DOM-скроллом,
 * строго дождавшись появления первых строк диалогов в DOM.
 */
async function scrollDmChatListTrusted() {
  if (dmScrollingChats) return;
  if (!dmEngineWin || dmEngineWin.isDestroyed()) return;
  dmScrollingChats = true;
  try {
    let readyTarget = null;
    for (let wait = 0; wait < 24; wait++) {
      if (!dmEngineWin || dmEngineWin.isDestroyed()) return;
      const target = await dmEval(
        'window.__TTF_DM_ENGINE__ ? window.__TTF_DM_ENGINE__.getChatListWheelTarget() : null'
      );
      if (target && target.ok) {
        readyTarget = target;
        break;
      }
      await new Promise((r) => setTimeout(r, 450));
    }

    if (!readyTarget) {
      writeDmDebug('no-chat-rows-after-wait');
      return;
    }

    let stable = 0;
    let lastSeen = readyTarget.seenCount || 0;
    for (let step = 0; step < 26 && stable < 3; step++) {
      if (!dmEngineWin || dmEngineWin.isDestroyed()) return;
      const wheelTarget = await dmEval(
        'window.__TTF_DM_ENGINE__ ? window.__TTF_DM_ENGINE__.getChatListWheelTarget() : null'
      );
      if (!wheelTarget || !wheelTarget.ok) break;

      try {
        dmEngineWin.webContents.sendInputEvent({
          type: 'mouseMove',
          x: wheelTarget.x,
          y: wheelTarget.y
        });
        dmEngineWin.webContents.sendInputEvent({
          type: 'mouseWheel',
          x: wheelTarget.x,
          y: wheelTarget.y,
          deltaX: 0,
          deltaY: -480,
          canScroll: true
        });
      } catch {}

      const stepRes = await dmEval(
        'window.__TTF_DM_ENGINE__ ? window.__TTF_DM_ENGINE__.scrollChatListStep(480) : null'
      );
      await new Promise((r) => setTimeout(r, 340));
      const snap = await dmEval('window.__TTF_DM_ENGINE__ ? window.__TTF_DM_ENGINE__.snapshot() : null');
      if (snap) handleDmSnapshot(snap);

      const seenCount = (stepRes && stepRes.seenCount) || (snap && snap.conversations ? snap.conversations.length : 0);
      if (seenCount === lastSeen) stable++;
      else {
        stable = 0;
        lastSeen = seenCount;
      }
    }

    await dmEval('window.__TTF_DM_ENGINE__ ? window.__TTF_DM_ENGINE__.scrollChatListStep(0) : null');
    const finalSnap = await dmEval('window.__TTF_DM_ENGINE__ ? window.__TTF_DM_ENGINE__.snapshot() : null');
    if (finalSnap) handleDmSnapshot(finalSnap);
    writeDmDebug('startup-loaded:' + (finalSnap && finalSnap.conversations ? finalSnap.conversations.length : 0));
  } finally {
    dmScrollingChats = false;
  }
}

async function openDmChatTrusted(chatId, index, name) {
  const wantName = String(name || '').trim().toLowerCase();
  const prevMsgs =
    latestDmSnapshot && Array.isArray(latestDmSnapshot.messages) ? latestDmSnapshot.messages : [];
  const beforeSig =
    (latestDmSnapshot && latestDmSnapshot.activeHeader ? latestDmSnapshot.activeHeader.name : '') +
    '|' +
    prevMsgs.length +
    '|' +
    (prevMsgs[0] ? prevMsgs[0].id : '') +
    '|' +
    (prevMsgs[prevMsgs.length - 1] ? prevMsgs[prevMsgs.length - 1].id : '');

  const loc = await dmEval(
    'window.__TTF_DM_ENGINE__ ? window.__TTF_DM_ENGINE__.locateChatRow(' +
      JSON.stringify(chatId || '') + ',' +
      JSON.stringify(index ?? null) + ',' +
      JSON.stringify(name || '') + ') : null'
  );
  if (!loc || !loc.ok || !dmEngineWin || dmEngineWin.isDestroyed()) {
    writeDmDebug('locate-failed:' + (name || chatId || ''));
    return { ok: false };
  }

  await dmEval(
    'window.__TTF_DM_ENGINE__ ? window.__TTF_DM_ENGINE__.clickChatRowFallback(' +
      JSON.stringify(chatId || '') + ',' +
      JSON.stringify(index ?? null) + ',' +
      JSON.stringify(name || '') + ') : false'
  );

  try {
    dmEngineWin.webContents.sendInputEvent({ type: 'mouseMove', x: loc.x, y: loc.y });
    dmEngineWin.webContents.sendInputEvent({
      type: 'mouseDown',
      x: loc.x,
      y: loc.y,
      button: 'left',
      clickCount: 1
    });
    await new Promise((r) => setTimeout(r, 42));
    dmEngineWin.webContents.sendInputEvent({
      type: 'mouseUp',
      x: loc.x,
      y: loc.y,
      button: 'left',
      clickCount: 1
    });
  } catch {}

  let lastSnap = null;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 240));
    lastSnap = await dmEval('window.__TTF_DM_ENGINE__ ? window.__TTF_DM_ENGINE__.snapshot() : null');
    if (lastSnap && Array.isArray(lastSnap.messages)) {
      const realMsgs = lastSnap.messages.filter((m) => m.kind === 'msg');
      const hdr = (lastSnap.activeHeader && lastSnap.activeHeader.name ? lastSnap.activeHeader.name : '').toLowerCase();
      const headerMatches = !wantName || (hdr && (hdr === wantName || hdr.includes(wantName)));
      const nextSig =
        (lastSnap.activeHeader ? lastSnap.activeHeader.name : '') +
        '|' +
        lastSnap.messages.length +
        '|' +
        (lastSnap.messages[0] ? lastSnap.messages[0].id : '') +
        '|' +
        (lastSnap.messages[lastSnap.messages.length - 1] ? lastSnap.messages[lastSnap.messages.length - 1].id : '');
      const changed = nextSig !== beforeSig;

      if (realMsgs.length > 0 && (headerMatches || changed)) {
        handleDmSnapshot(lastSnap);
        writeDmDebug('open-ok:' + (name || chatId || '') + ':msgs=' + realMsgs.length);
        return { ok: true, count: realMsgs.length };
      }
    }
  }

  if (lastSnap) handleDmSnapshot(lastSnap);
  writeDmDebug('empty-thread:' + (name || chatId || ''));
  return { ok: true, count: lastSnap && lastSnap.messages ? lastSnap.messages.length : 0 };
}

/** Полная многофреймовая диагностика /messages и дочерних <iframe> -> dm-debug.json */
async function writeDmDebug(reason) {
  try {
    if (!dmEngineWin || dmEngineWin.isDestroyed()) return;
    const frames = getTikTokDmFrames();
    const frameDumps = [];
    for (const f of frames) {
      try {
        await f.executeJavaScript(DM_ENGINE.controller, true).catch(() => {});
        const d = await f.executeJavaScript(
          'window.__TTF_DM_ENGINE__ ? window.__TTF_DM_ENGINE__.debugDump() : null',
          true
        );
        frameDumps.push({
          frameUrl: f.url,
          isMainFrame: f === dmEngineWin.webContents.mainFrame,
          dump: d
        });
      } catch (err) {
        frameDumps.push({
          frameUrl: f.url,
          isMainFrame: f === dmEngineWin.webContents.mainFrame,
          error: String(err)
        });
      }
    }
    const payload = {
      reason,
      at: new Date().toISOString(),
      allowBusinessSuiteFallback,
      cachedConversationsCount: cachedDmConversations.size,
      timeline: dmDebugTimeline.slice(-25),
      frames: frameDumps
    };
    const outPath = path.join(app.getPath('userData'), 'dm-debug.json');
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    logDmDebug('wrote-debug', reason + ' frames=' + frameDumps.length + ' cached=' + cachedDmConversations.size);
  } catch {}
}

/** Реальный клик по карточке видео в чате и перехват ссылки на ролик */
async function resolveDmVideoUrlTrusted(domIndex) {
  if (!dmEngineWin || dmEngineWin.isDestroyed()) return '';
  const loc = await dmEval(
    'window.__TTF_DM_ENGINE__ ? window.__TTF_DM_ENGINE__.locateMessageCard(' + Number(domIndex) + ') : null'
  );
  if (!loc || !loc.ok || !dmEngineWin || dmEngineWin.isDestroyed()) return '';

  dmResolvingVideo = true;
  dmPendingVideoUrl = '';
  const wc = dmEngineWin.webContents;
  try {
    wc.focus();
    wc.sendInputEvent({ type: 'mouseMove', x: loc.x, y: loc.y });
    wc.sendInputEvent({ type: 'mouseDown', x: loc.x, y: loc.y, button: 'left', clickCount: 1 });
    await new Promise((r) => setTimeout(r, 42));
    wc.sendInputEvent({ type: 'mouseUp', x: loc.x, y: loc.y, button: 'left', clickCount: 1 });

    for (let i = 0; i < 16 && !dmPendingVideoUrl; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const href = await dmEval('location.href');
      if (typeof href === 'string' && isTikTokVideoUrl(href)) dmPendingVideoUrl = href;
    }
  } finally {
    dmResolvingVideo = false;
  }

  const url = dmPendingVideoUrl;
  dmPendingVideoUrl = '';
  if (url && dmEngineWin && !dmEngineWin.isDestroyed()) {
    try {
      dmEngineWin.webContents.navigationHistory.goBack();
    } catch {
      await dmEval('history.back()');
    }
  }
  return url;
}

async function dmEval(expression) {
  ensureDmEngine();
  if (!dmEngineWin || dmEngineWin.isDestroyed()) return null;
  if (!dmEngineReady) {
    for (let i = 0; i < 20 && !dmEngineReady; i++) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (!dmEngineWin || dmEngineWin.isDestroyed()) return null;
  try {
    const mainFrame = dmEngineWin.webContents.mainFrame;
    const frames = getTikTokDmFrames();
    if (frames.length > 1) {
      // 1) Ищем дочерний iframe (например на /business-suite/messages), в котором уже есть строки диалогов
      for (const f of frames) {
        if (f === mainFrame) continue;
        try {
          const hasRows = await f.executeJavaScript(
            'Boolean(window.__TTF_DM_ENGINE__ && window.__TTF_DM_ENGINE__.hasChatRows && window.__TTF_DM_ENGINE__.hasChatRows())',
            true
          );
          if (hasRows) {
            return await f.executeJavaScript(expression, true);
          }
        } catch {}
      }
      // 2) Если в mainFrame строк нет, а дочерний iframe есть — пробуем его
      const mainHasRows = await mainFrame
        .executeJavaScript(
          'Boolean(window.__TTF_DM_ENGINE__ && window.__TTF_DM_ENGINE__.hasChatRows && window.__TTF_DM_ENGINE__.hasChatRows())',
          true
        )
        .catch(() => false);
      if (!mainHasRows) {
        const child = frames.find((f) => f !== mainFrame);
        if (child) {
          await child.executeJavaScript(DM_ENGINE.controller, true).catch(() => {});
          return await child.executeJavaScript(expression, true);
        }
      }
    }
    return await dmEngineWin.webContents.executeJavaScript(expression, true);
  } catch {
    return null;
  }
}

function recordRecentContactsList(contacts) {
  const incoming = Array.isArray(contacts) ? contacts : [];
  if (!incoming.length) return state.recentContacts;
  const now = Date.now();
  const map = new Map();
  for (const c of state.recentContacts) map.set(c.id, c);
  incoming.forEach((raw, idx) => {
    if (!raw || typeof raw !== 'object') return;
    const handle = String(raw.handle || '').replace(/^@/, '').trim();
    const name = String(raw.name || handle || '').trim();
    const id = String(raw.id || handle || name).trim().toLowerCase();
    if (!id || !name) return;
    const prev = map.get(id) || {};
    map.set(id, {
      id,
      name,
      handle: handle || prev.handle || '',
      avatar: raw.avatar || prev.avatar || '',
      lastSentAt: now - idx
    });
  });
  state.recentContacts = Array.from(map.values())
    .sort((a, b) => (b.lastSentAt || 0) - (a.lastSentAt || 0))
    .slice(0, 30);
  scheduleSave();
  broadcastState();
  return state.recentContacts;
}

function getMergedShareContacts() {
  const out = [];
  const seen = new Set();

  const pushContact = (c, isRecent) => {
    if (!c || typeof c !== 'object') return;
    const handle = String(c.handle || '').replace(/^@/, '').trim();
    const name = String(c.name || handle || '').trim();
    if (!name) return;
    const id = String(c.id || handle || name).toLowerCase();
    const nameKey = name.toLowerCase();
    if (seen.has(id) || seen.has(nameKey)) return;
    seen.add(id);
    seen.add(nameKey);
    out.push({
      id,
      name,
      handle,
      avatar: String(c.avatar || ''),
      recent: Boolean(isRecent)
    });
  };

  if (state && Array.isArray(state.recentContacts)) {
    for (const c of state.recentContacts) pushContact(c, true);
  }
  if (Array.isArray(dialogContactsFromMain)) {
    dialogContactsFromMain.forEach((c, idx) => pushContact(c, idx < 6));
  }
  if (cachedDmConversations.size > 0) {
    for (const c of cachedDmConversations.values()) pushContact(c, true);
  } else if (latestDmSnapshot && Array.isArray(latestDmSnapshot.conversations)) {
    for (const c of latestDmSnapshot.conversations) pushContact(c, true);
  }

  return {
    contacts: out,
    activeHeader: (latestDmSnapshot && latestDmSnapshot.activeHeader) || null
  };
}

function formatForwardedCommentMessage(comment, videoUrl, note) {
  const rawAuth =
    comment && comment.authorHandle
      ? '@' + String(comment.authorHandle).replace(/^@/, '').trim()
      : (comment && (comment.authorName || comment.author)) || 'Пользователь';
  const rawText = comment && comment.text ? String(comment.text).trim() : '';
  const quote = rawText ? '«' + rawText + '»' : '[медиа-комментарий]';
  const lines = ['💬 Комментарий ' + rawAuth + ': ' + quote];
  if (note && String(note).trim()) {
    lines.push(String(note).trim());
  }
  if (videoUrl && String(videoUrl).trim()) {
    lines.push(String(videoUrl).trim());
  }
  return lines.join('\n');
}

async function sendTextToDmContacts(contacts, messageText) {
  if (!Array.isArray(contacts) || !contacts.length || !messageText) {
    return { ok: false, sentCount: 0 };
  }
  ensureDmEngine();
  let sent = 0;
  for (const c of contacts) {
    const opened = await openDmChatTrusted(c.id || '', null, c.name || c.handle || '');
    if (!opened || !opened.ok) continue;
    await new Promise((r) => setTimeout(r, 240));
    const prep = await dmEval(
      'window.__TTF_DM_ENGINE__ ? window.__TTF_DM_ENGINE__.prepareSendMessage(' +
        JSON.stringify(messageText) + ') : null'
    );
    if (prep && prep.ok && dmEngineWin && !dmEngineWin.isDestroyed()) {
      dmEngineWin.webContents.focus();
      if (prep.hasSendBtn) {
        const x = Math.round(prep.sendX);
        const y = Math.round(prep.sendY);
        dmEngineWin.webContents.sendInputEvent({ type: 'mouseMove', x, y });
        dmEngineWin.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        await new Promise((r) => setTimeout(r, 38));
        dmEngineWin.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      } else {
        dmEngineWin.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
        await new Promise((r) => setTimeout(r, 30));
        dmEngineWin.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
      }
      await new Promise((r) => setTimeout(r, 140));
      await dmEval('window.__TTF_DM_ENGINE__ ? window.__TTF_DM_ENGINE__.clickSendButtonFallback() : false');
      sent++;
      await new Promise((r) => setTimeout(r, 320));
    }
  }
  if (sent > 0) {
    recordRecentContactsList(contacts);
    await dmEval('window.__TTF_DM_ENGINE__ ? window.__TTF_DM_ENGINE__.emitSnapshot(true) : null');
  }
  return { ok: sent > 0, sentCount: sent };
}

function handleDmSnapshot(rawSnapshot) {
  if (!rawSnapshot || typeof rawSnapshot !== 'object') return;
  const snapshot = { ...rawSnapshot };

  // Сохраняем все найденные чаты в кэш, чтобы при смене фрейма или обновлении страницы чаты НИКОГДА не пропадали через секунду!
  if (Array.isArray(snapshot.conversations) && snapshot.conversations.length > 0) {
    for (const c of snapshot.conversations) {
      if (!c || !c.id) continue;
      const prev = cachedDmConversations.get(c.id) || {};
      cachedDmConversations.set(c.id, {
        ...prev,
        ...c,
        avatar: c.avatar || prev.avatar || '',
        handle: c.handle || prev.handle || '',
        lastMessage: c.lastMessage || prev.lastMessage || ''
      });
    }
  } else if (snapshot.loggedIn !== false && cachedDmConversations.size > 0) {
    snapshot.conversations = Array.from(cachedDmConversations.values());
    snapshot.loading = false;
  }

  if (Array.isArray(snapshot.stories) && snapshot.stories.length > 0) {
    cachedDmStories.length = 0;
    cachedDmStories.push(...snapshot.stories);
  } else if (cachedDmStories.length > 0) {
    snapshot.stories = [...cachedDmStories];
  }

  latestDmSnapshot = snapshot;

  if (
    !dmLoggedFirstChats &&
    Array.isArray(snapshot.conversations) &&
    snapshot.conversations.length > 0
  ) {
    dmLoggedFirstChats = true;
    logDmDebug('first-chats-loaded', 'count=' + snapshot.conversations.length + ' href=' + (snapshot.href || ''));
    writeDmDebug('first-chats:' + snapshot.conversations.length);
  }

  if (messagesWin && !messagesWin.isDestroyed()) {
    messagesWin.webContents.send('messages:snapshot', snapshot);
  }

  if (commentsWin && !commentsWin.isDestroyed()) {
    commentsWin.webContents.send('comments:contacts', getMergedShareContacts());
  }

  if (win && !win.isDestroyed()) {
    win.webContents.send('messages:unread', Number(snapshot.unreadTotal) || 0);
    if (Array.isArray(snapshot.conversations) && snapshot.conversations.length > 0) {
      const contacts = snapshot.conversations.map((c) => ({
        id: c.id,
        name: c.name,
        handle: c.handle,
        avatar: c.avatar,
        source: 'messages'
      }));
      win.webContents.send('messages:contacts', contacts);
    }
  }
}

/* ─── Окна приложения ────────────────────────────────────────────── */

function createWindow() {
  const bounds = initialBounds();

  win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    maxWidth: MAX_WIDTH,
    maxHeight: MAX_HEIGHT,
    title: APP_TITLE,
    icon: APP_ICON,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(APP_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  win.setMenuBarVisibility(false);
  win.setAlwaysOnTop(state.alwaysOnTop, 'floating');
  win.setOpacity(state.opacity);

  win.loadFile(path.join(APP_DIR, 'index.html'));

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });

  win.on('move', () => {
    syncDockedPanels();
    scheduleSave();
  });

  win.on('resize', () => {
    syncDockedPanels();
    notifyBoundsChanged();
    scheduleSave();
  });

  win.on('minimize', () => {
    if (commentsWin && !commentsWin.isDestroyed() && state.commentsDocked) {
      commentsWin.minimize();
    }
    if (messagesWin && !messagesWin.isDestroyed() && state.messagesDocked) {
      messagesWin.minimize();
    }
  });

  win.on('restore', () => {
    if (commentsWin && !commentsWin.isDestroyed() && state.commentsDocked) {
      if (commentsWin.isMinimized()) commentsWin.restore();
    }
    if (messagesWin && !messagesWin.isDestroyed() && state.messagesDocked) {
      if (messagesWin.isMinimized()) messagesWin.restore();
    }
    syncDockedPanels();
  });

  win.on('close', () => {
    cancelBoundsAnimation();
    saveStateNow();
    if (commentsWin && !commentsWin.isDestroyed()) {
      commentsWin.destroy();
      commentsWin = null;
    }
    if (messagesWin && !messagesWin.isDestroyed()) {
      messagesWin.destroy();
      messagesWin = null;
    }
    if (dmEngineWin && !dmEngineWin.isDestroyed()) {
      dmEngineWin.destroy();
      dmEngineWin = null;
    }
  });

  win.on('closed', () => {
    win = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
}

function createOrShowCommentsWindow(initialPayload) {
  if (initialPayload && typeof initialPayload === 'object') {
    latestCommentsPayload = initialPayload;
  }

  if (commentsWin && !commentsWin.isDestroyed()) {
    if (commentsWin.isMinimized()) commentsWin.restore();
    if (state.commentsDocked) syncDockedPanels();
    commentsWin.show();
    commentsWin.focus();
    if (latestCommentsPayload) {
      commentsWin.webContents.send('comments:data', latestCommentsPayload);
    }
    notifyCommentsWindowState();
    return;
  }

  const dockedBounds = computeDockedPanelBounds('comments');
  let startBounds = dockedBounds;

  if (!state.commentsDocked && state.commentsBounds && boundsAreVisible(state.commentsBounds)) {
    startBounds = state.commentsBounds;
  } else {
    state.commentsDocked = true;
  }

  if (!startBounds) {
    const area = screen.getPrimaryDisplay().workArea;
    startBounds = {
      x: Math.round(area.x + 120),
      y: Math.round(area.y + 80),
      width: COMMENTS_DEFAULT_WIDTH,
      height: 680
    };
  }

  commentsWin = new BrowserWindow({
    ...startBounds,
    minWidth: COMMENTS_MIN_WIDTH,
    minHeight: COMMENTS_MIN_HEIGHT,
    maxWidth: 540,
    maxHeight: 1140,
    title: 'Комментарии · ' + APP_TITLE,
    icon: APP_ICON,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(APP_DIR, 'comments-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });

  commentsWin.setMenuBarVisibility(false);
  commentsWin.setAlwaysOnTop(state.alwaysOnTop, 'floating');
  commentsWin.setOpacity(state.opacity);

  commentsWin.loadFile(path.join(APP_DIR, 'comments.html'));

  const pushInitialToComments = () => {
    if (!commentsWin || commentsWin.isDestroyed()) return;
    notifyCommentsWindowState();
    if (latestCommentsPayload) {
      commentsWin.webContents.send('comments:data', latestCommentsPayload);
    }
  };

  commentsWin.once('ready-to-show', () => {
    if (!commentsWin || commentsWin.isDestroyed()) return;
    if (state.commentsDocked) syncDockedPanels();
    commentsWin.show();
    pushInitialToComments();
  });

  commentsWin.webContents.on('did-finish-load', pushInitialToComments);

  commentsWin.on('move', () => {
    if (isSyncingDock || !commentsWin || commentsWin.isDestroyed()) return;
    const ideal = computeDockedPanelBounds('comments');
    const cur = commentsWin.getBounds();
    if (ideal) {
      const dist = Math.hypot(cur.x - ideal.x, cur.y - ideal.y);
      if (state.commentsDocked && dist > 32) {
        state.commentsDocked = false;
        notifyCommentsWindowState();
      } else if (!state.commentsDocked && dist < 18) {
        state.commentsDocked = true;
        syncDockedPanels();
        notifyCommentsWindowState();
      }
    }
    scheduleSave();
  });

  commentsWin.on('resize', () => {
    if (isSyncingDock || !commentsWin || commentsWin.isDestroyed()) return;
    scheduleSave();
  });

  commentsWin.on('closed', () => {
    commentsWin = null;
    notifyCommentsWindowState();
  });

  commentsWin.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
}

function closeCommentsWindow() {
  if (commentsWin && !commentsWin.isDestroyed()) {
    commentsWin.close();
  }
}

function createOrShowMessagesWindow() {
  ensureDmEngine();

  if (messagesWin && !messagesWin.isDestroyed()) {
    if (messagesWin.isMinimized()) messagesWin.restore();
    if (state.messagesDocked) syncDockedPanels();
    messagesWin.show();
    messagesWin.focus();
    if (latestDmSnapshot) {
      messagesWin.webContents.send('messages:snapshot', latestDmSnapshot);
    }
    notifyMessagesWindowState();
    return;
  }

  const dockedBounds = computeDockedPanelBounds('messages');
  let startBounds = dockedBounds;

  if (!state.messagesDocked && state.messagesBounds && boundsAreVisible(state.messagesBounds)) {
    startBounds = state.messagesBounds;
  } else {
    state.messagesDocked = true;
  }

  if (!startBounds) {
    const area = screen.getPrimaryDisplay().workArea;
    startBounds = {
      x: Math.round(area.x + 80),
      y: Math.round(area.y + 80),
      width: MESSAGES_DEFAULT_WIDTH,
      height: 680
    };
  }

  messagesWin = new BrowserWindow({
    ...startBounds,
    minWidth: MESSAGES_MIN_WIDTH,
    minHeight: MESSAGES_MIN_HEIGHT,
    maxWidth: MESSAGES_MAX_WIDTH,
    maxHeight: 1140,
    title: 'Сообщения · ' + APP_TITLE,
    icon: APP_ICON,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(APP_DIR, 'messages-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: true
    }
  });

  messagesWin.setMenuBarVisibility(false);
  messagesWin.setAlwaysOnTop(state.alwaysOnTop, 'floating');
  messagesWin.setOpacity(state.opacity);

  messagesWin.loadFile(path.join(APP_DIR, 'messages.html'));

  const pushInitialDm = () => {
    if (!messagesWin || messagesWin.isDestroyed()) return;
    notifyMessagesWindowState();
    if (latestDmSnapshot) {
      messagesWin.webContents.send('messages:snapshot', latestDmSnapshot);
    } else if (dmEngineReady) {
      dmEval('window.__TTF_DM_ENGINE__ ? window.__TTF_DM_ENGINE__.emitSnapshot(true) : null');
    }
  };

  messagesWin.once('ready-to-show', () => {
    if (!messagesWin || messagesWin.isDestroyed()) return;
    if (state.messagesDocked) syncDockedPanels();
    messagesWin.show();
    pushInitialDm();
  });

  messagesWin.webContents.on('did-finish-load', pushInitialDm);

  messagesWin.on('move', () => {
    if (isSyncingDock || !messagesWin || messagesWin.isDestroyed()) return;
    const ideal = computeDockedPanelBounds('messages');
    const cur = messagesWin.getBounds();
    if (ideal) {
      const dist = Math.hypot(cur.x - ideal.x, cur.y - ideal.y);
      if (state.messagesDocked && dist > 32) {
        state.messagesDocked = false;
        notifyMessagesWindowState();
      } else if (!state.messagesDocked && dist < 18) {
        state.messagesDocked = true;
        syncDockedPanels();
        notifyMessagesWindowState();
      }
    }
    scheduleSave();
  });

  messagesWin.on('resize', () => {
    if (isSyncingDock || !messagesWin || messagesWin.isDestroyed()) return;
    scheduleSave();
  });

  messagesWin.on('closed', () => {
    messagesWin = null;
    notifyMessagesWindowState();
  });

  messagesWin.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
}

function closeMessagesWindow() {
  if (messagesWin && !messagesWin.isDestroyed()) {
    messagesWin.close();
  }
}

function openExternal(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      shell.openExternal(parsed.toString());
    }
  } catch {}
}

function isTikTokUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'tiktok.com' ||
        parsed.hostname.endsWith('.tiktok.com'))
    );
  } catch {
    return false;
  }
}

function isTikTokVideoUrl(url) {
  return isTikTokUrl(url) && /\/(?:video|photo)\/\d+/.test(String(url));
}

function resolveTargetGuest(webContentsId) {
  if (Number.isInteger(webContentsId) && webContentsId > 0) {
    const wc = webContents.fromId(webContentsId);
    if (wc && !wc.isDestroyed()) return wc;
  }
  if (fallbackGuestWebContents && !fallbackGuestWebContents.isDestroyed()) {
    return fallbackGuestWebContents;
  }
  return null;
}

function setupGuestWebContents() {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;

    const isMessagesWebview = Boolean(
      messagesWin &&
        !messagesWin.isDestroyed() &&
        contents.hostWebContents &&
        contents.hostWebContents.id === messagesWin.webContents.id
    );

    if (!isMessagesWebview) {
      fallbackGuestWebContents = contents;
      contents.on('destroyed', () => {
        if (fallbackGuestWebContents === contents) fallbackGuestWebContents = null;
      });
    }

    contents.setWindowOpenHandler(({ url }) => {
      if (isMessagesWebview && isTikTokVideoUrl(url)) {
        if (win && !win.isDestroyed()) {
          win.show();
          win.webContents.send('messages:open-video', { url, chatName: 'Чат' });
        }
        return { action: 'deny' };
      }
      openExternal(url);
      return { action: 'deny' };
    });

    contents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        event.preventDefault();
        if (contents.isDevToolsOpened()) {
          contents.closeDevTools();
        } else {
          contents.openDevTools({ mode: 'detach' });
        }
      }
    });

    contents.on('will-navigate', (event, url) => {
      if (isMessagesWebview && isTikTokVideoUrl(url)) {
        event.preventDefault();
        if (win && !win.isDestroyed()) {
          win.show();
          win.webContents.send('messages:open-video', { url, chatName: 'Чат' });
        }
        return;
      }
      if (!isTikTokUrl(url)) {
        event.preventDefault();
        openExternal(url);
      }
    });
  });
}

function broadcastState() {
  const pub = publicState();
  if (win && !win.isDestroyed()) {
    win.webContents.send('state:changed', pub);
  }
  if (commentsWin && !commentsWin.isDestroyed()) {
    commentsWin.webContents.send('state:changed', pub);
  }
}

function applyMainPreset(preset) {
  if (!win || win.isDestroyed() || !preset) return null;
  const current = win.getBounds();
  const display = screen.getDisplayMatching(current);
  const area = display.workArea;

  const width = clamp(preset.width, MIN_WIDTH, area.width - 20);
  const height = clamp(preset.height, MIN_HEIGHT, area.height - 20);

  const centerX = current.x + current.width / 2;
  const centerY = current.y + current.height / 2;
  const x = clamp(
    Math.round(centerX - width / 2),
    area.x - FRAME_PAD,
    area.x + area.width - width + FRAME_PAD
  );
  const y = clamp(
    Math.round(centerY - height / 2),
    area.y - FRAME_PAD,
    area.y + area.height - height + FRAME_PAD
  );

  animateMainBounds({ x, y, width, height }, 190);
  return {
    id: preset.id,
    label: preset.label,
    width: width - FRAME_PAD * 2,
    height: height - FRAME_PAD * 2
  };
}

function getResizeTargetWin(target) {
  if (target === 'comments') return commentsWin;
  if (target === 'messages') return messagesWin;
  return win;
}

function handleResizeStart(target, edge) {
  const targetWin = getResizeTargetWin(target);
  if (!targetWin || targetWin.isDestroyed()) return;
  if (target === 'main') cancelBoundsAnimation();

  resizeSessions[target] = {
    edge: String(edge || 'se'),
    startCursor: screen.getCursorScreenPoint(),
    startBounds: targetWin.getBounds()
  };
}

function handleResizeMove(target, freeAspect) {
  const sessionInfo = resizeSessions[target];
  const targetWin = getResizeTargetWin(target);
  if (!sessionInfo || !targetWin || targetWin.isDestroyed()) return;

  const cur = screen.getCursorScreenPoint();
  const dx = cur.x - sessionInfo.startCursor.x;
  const dy = cur.y - sessionInfo.startCursor.y;
  const sb = sessionInfo.startBounds;
  const edge = sessionInfo.edge;

  const isMain = target === 'main';
  const isMsg = target === 'messages';
  const minW = isMain ? MIN_WIDTH : isMsg ? MESSAGES_MIN_WIDTH : COMMENTS_MIN_WIDTH;
  const minH = isMain ? MIN_HEIGHT : isMsg ? MESSAGES_MIN_HEIGHT : COMMENTS_MIN_HEIGHT;
  const maxW = isMain ? MAX_WIDTH : isMsg ? MESSAGES_MAX_WIDTH : 540;
  const maxH = isMain ? MAX_HEIGHT : 1140;

  let x = sb.x;
  let y = sb.y;
  let width = sb.width;
  let height = sb.height;

  const hasE = edge.includes('e');
  const hasW = edge.includes('w');
  const hasS = edge.includes('s');
  const hasN = edge.includes('n');
  const isCorner = (hasE || hasW) && (hasS || hasN);

  if (isMain && isCorner && !freeAspect) {
    const startInnerW = Math.max(120, sb.width - FRAME_PAD * 2);
    const startInnerH = Math.max(200, sb.height - FRAME_PAD * 2);
    const aspect = clamp(startInnerW / startInnerH, 0.48, 0.68) || DEFAULT_ASPECT;

    const deltaW = hasE ? dx : -dx;
    const deltaH = hasS ? dy : -dy;
    const projectedW =
      Math.abs(deltaW) >= Math.abs(deltaH * aspect)
        ? startInnerW + deltaW
        : (startInnerH + deltaH) * aspect;

    const innerW = clamp(projectedW, minW - FRAME_PAD * 2, maxW - FRAME_PAD * 2);
    let innerH = innerW / aspect;
    if (innerH < minH - FRAME_PAD * 2) innerH = minH - FRAME_PAD * 2;
    else if (innerH > maxH - FRAME_PAD * 2) innerH = maxH - FRAME_PAD * 2;

    width = Math.round(innerH * aspect + FRAME_PAD * 2);
    height = Math.round(innerH + FRAME_PAD * 2);

    if (hasW) x = sb.x + (sb.width - width);
    if (hasN) y = sb.y + (sb.height - height);
  } else {
    if (hasE) {
      width = clamp(sb.width + dx, minW, maxW);
    } else if (hasW) {
      const nextW = clamp(sb.width - dx, minW, maxW);
      x = sb.x + (sb.width - nextW);
      width = nextW;
    }

    if (hasS) {
      height = clamp(sb.height + dy, minH, maxH);
    } else if (hasN) {
      const nextH = clamp(sb.height - dy, minH, maxH);
      y = sb.y + (sb.height - nextH);
      height = nextH;
    }
  }

  targetWin.setBounds({
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  });

  if (isMain) {
    syncDockedPanels();
    notifyBoundsChanged();
  }
}

function handleResizeEnd(target) {
  resizeSessions[target] = null;
  scheduleSave();
}

function setupIpc() {
  ipcMain.handle('app:get-state', () => publicState());

  ipcMain.handle('app:set-state', (event, patch) => {
    if (!win || event.sender !== win.webContents) return publicState();
    if (!patch || typeof patch !== 'object') return publicState();

    const next = { ...state };
    if ('alwaysOnTop' in patch) next.alwaysOnTop = !!patch.alwaysOnTop;
    if ('opacity' in patch) next.opacity = Number(patch.opacity);
    if ('zoom' in patch) next.zoom = Number(patch.zoom);
    if ('playbackRate' in patch) next.playbackRate = Number(patch.playbackRate);
    if ('auto' in patch) next.auto = !!patch.auto;
    if ('autoMode' in patch) next.autoMode = patch.autoMode;
    if ('autoSeconds' in patch) next.autoSeconds = Number(patch.autoSeconds);
    if ('muted' in patch) next.muted = !!patch.muted;
    if ('volume' in patch) next.volume = Number(patch.volume);
    if ('menuOpen' in patch) next.menuOpen = !!patch.menuOpen;
    if ('onboardingSeen' in patch) next.onboardingSeen = !!patch.onboardingSeen;

    state = normalizeState(next);

    if ('alwaysOnTop' in patch) {
      win.setAlwaysOnTop(state.alwaysOnTop, 'floating');
      if (commentsWin && !commentsWin.isDestroyed()) {
        commentsWin.setAlwaysOnTop(state.alwaysOnTop, 'floating');
      }
      if (messagesWin && !messagesWin.isDestroyed()) {
        messagesWin.setAlwaysOnTop(state.alwaysOnTop, 'floating');
      }
    }
    if ('opacity' in patch) {
      win.setOpacity(state.opacity);
      if (commentsWin && !commentsWin.isDestroyed()) {
        commentsWin.setOpacity(state.opacity);
      }
      if (messagesWin && !messagesWin.isDestroyed()) {
        messagesWin.setOpacity(state.opacity);
      }
    }

    scheduleSave();
    return publicState();
  });

  ipcMain.handle('contacts:record-recent', (_event, contacts) => {
    return recordRecentContactsList(contacts);
  });

  ipcMain.handle('app:copy-text', (_event, text) => {
    try {
      clipboard.writeText(String(text || ''));
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.on('window:minimize', (event) => {
    if (win && event.sender === win.webContents) win.minimize();
  });

  ipcMain.on('window:close', (event) => {
    if (win && event.sender === win.webContents) win.close();
  });

  ipcMain.on('app:open-external', (_event, url) => {
    if (typeof url === 'string') openExternal(url);
  });

  ipcMain.handle('webview:trusted-click', async (event, coords) => {
    if (!win || event.sender !== win.webContents) return false;
    const target = resolveTargetGuest(coords && coords.webContentsId);
    if (!target) return false;
    const zoom =
      typeof target.getZoomFactor === 'function' ? target.getZoomFactor() || 1 : 1;
    const x = Math.round((Number(coords && coords.x) || 0) * zoom);
    const y = Math.round((Number(coords && coords.y) || 0) * zoom);
    try {
      if (win.isFocused()) {
        try { target.focus(); } catch {}
      }
      target.sendInputEvent({ type: 'mouseMove', x, y });
      target.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      await new Promise((r) => setTimeout(r, 40));
      target.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('webview:trusted-key', async (event, payload) => {
    if (!win || event.sender !== win.webContents) return false;
    const target = resolveTargetGuest(payload && payload.webContentsId);
    if (!target) return false;
    const keyCode = String((payload && payload.keyCode) || '');
    if (!keyCode) return false;
    try {
      if (win.isFocused()) {
        try { target.focus(); } catch {}
      }
      target.sendInputEvent({ type: 'keyDown', keyCode });
      await new Promise((r) => setTimeout(r, 28));
      target.sendInputEvent({ type: 'keyUp', keyCode });
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('webview:activate', async (event, payload) => {
    if (!win || event.sender !== win.webContents) return false;
    const target = resolveTargetGuest(payload && payload.webContentsId);
    if (!target) return false;
    try {
      if (win.isFocused()) {
        try { target.focus(); } catch {}
      }
      target.sendInputEvent({ type: 'mouseMove', x: 16, y: 16 });
      target.sendInputEvent({ type: 'keyDown', keyCode: 'Shift' });
      await new Promise((r) => setTimeout(r, 20));
      target.sendInputEvent({ type: 'keyUp', keyCode: 'Shift' });
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('window:cycle-size', (event) => {
    if (!win || event.sender !== win.webContents) return null;

    const current = win.getBounds();
    const display = screen.getDisplayMatching(current);
    const area = display.workArea;
    const presets = SIZE_PRESETS.filter(
      (preset) => preset.width <= area.width - 20 && preset.height <= area.height - 20
    );
    if (!presets.length) return null;

    let index = presets.findIndex(
      (preset) => Math.abs(preset.width - current.width) < 20
    );
    const next = presets[(index + 1) % presets.length];
    return applyMainPreset(next);
  });

  ipcMain.handle('window:set-preset', (event, presetId) => {
    if (!win || event.sender !== win.webContents) return null;
    const preset = SIZE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return null;
    return applyMainPreset(preset);
  });

  ipcMain.handle('window:scale', (event, deltaSteps) => {
    if (!win || event.sender !== win.webContents) return null;
    const steps = clamp(Number(deltaSteps) || 0, -4, 4);
    if (!steps) return null;

    const current = win.getBounds();
    const display = screen.getDisplayMatching(current);
    const area = display.workArea;

    const innerW = current.width - FRAME_PAD * 2;
    const innerH = current.height - FRAME_PAD * 2;
    const aspect = clamp(innerW / Math.max(1, innerH), 0.48, 0.68) || DEFAULT_ASPECT;

    const nextInnerW = clamp(
      Math.round(innerW + steps * 26),
      MIN_WIDTH - FRAME_PAD * 2,
      Math.min(MAX_WIDTH - FRAME_PAD * 2, area.width - 36)
    );
    const nextInnerH = clamp(
      Math.round(nextInnerW / aspect),
      MIN_HEIGHT - FRAME_PAD * 2,
      Math.min(MAX_HEIGHT - FRAME_PAD * 2, area.height - 36)
    );

    const width = Math.round(nextInnerH * aspect + FRAME_PAD * 2);
    const height = Math.round(nextInnerH + FRAME_PAD * 2);
    const centerX = current.x + current.width / 2;
    const centerY = current.y + current.height / 2;
    const x = clamp(
      Math.round(centerX - width / 2),
      area.x - FRAME_PAD,
      area.x + area.width - width + FRAME_PAD
    );
    const y = clamp(
      Math.round(centerY - height / 2),
      area.y - FRAME_PAD,
      area.y + area.height - height + FRAME_PAD
    );

    cancelBoundsAnimation();
    win.setBounds({ x, y, width, height });
    syncDockedPanels();
    notifyBoundsChanged();
    scheduleSave();

    return {
      width: width - FRAME_PAD * 2,
      height: height - FRAME_PAD * 2,
      presetId: detectPresetId(width)
    };
  });

  ipcMain.on('window:resize-start', (_event, payload) => {
    if (!payload || typeof payload !== 'object') return;
    handleResizeStart(payload.target, payload.edge);
  });

  ipcMain.on('window:resize-move', (_event, payload) => {
    if (!payload || typeof payload !== 'object') return;
    handleResizeMove(payload.target, Boolean(payload.freeAspect));
  });

  ipcMain.on('window:resize-end', (_event, payload) => {
    if (!payload || typeof payload !== 'object') return;
    handleResizeEnd(payload.target);
  });

  /* ─── Окно комментариев ─────────────────────────────────────────── */

  ipcMain.handle('comments:toggle', (_event, payload) => {
    if (commentsWin && !commentsWin.isDestroyed() && commentsWin.isVisible()) {
      closeCommentsWindow();
      return { open: false, docked: state.commentsDocked };
    }
    createOrShowCommentsWindow(payload);
    return { open: true, docked: state.commentsDocked };
  });

  ipcMain.handle('comments:open', (_event, payload) => {
    createOrShowCommentsWindow(payload);
    return { open: true, docked: state.commentsDocked };
  });

  ipcMain.on('comments:close', () => closeCommentsWindow());

  ipcMain.handle('comments:toggle-dock', () => {
    state.commentsDocked = !state.commentsDocked;
    if (state.commentsDocked) syncDockedPanels();
    scheduleSave();
    notifyCommentsWindowState();
    return { docked: state.commentsDocked };
  });

  ipcMain.on('contacts:update-dialog-cache', (_event, contacts) => {
    if (!Array.isArray(contacts) || !contacts.length) return;
    dialogContactsFromMain = contacts;
    if (commentsWin && !commentsWin.isDestroyed()) {
      commentsWin.webContents.send('comments:contacts', getMergedShareContacts());
    }
    if (messagesWin && !messagesWin.isDestroyed()) {
      messagesWin.webContents.send('messages:share-contacts', getMergedShareContacts());
    }
  });

  ipcMain.on('share:stealth-send-result', (_event, payload) => {
    if (!payload || !payload.reqId) return;
    const resolver = pendingStealthSendResolvers.get(payload.reqId);
    if (resolver) {
      pendingStealthSendResolvers.delete(payload.reqId);
      resolver(payload.result || { ok: false });
    }
  });

  ipcMain.handle('comments:get-initial', () => ({
    data: latestCommentsPayload,
    docked: state.commentsDocked,
    contactsInfo: getMergedShareContacts()
  }));

  ipcMain.handle('comments:get-contacts', () => {
    ensureDmEngine();
    if (win && !win.isDestroyed()) {
      win.webContents.send('share:refresh-contacts-stealth');
    }
    return getMergedShareContacts();
  });

  ipcMain.handle('comments:forward-to-contacts', async (_event, payload) => {
    if (!payload || typeof payload !== 'object') return { ok: false };

    const contacts = Array.isArray(payload.contacts) ? payload.contacts : [];
    if (!contacts.length) return { ok: false };

    const comment = payload.comment || {};
    const video = payload.video || {};
    let videoUrl = String(video.videoUrl || comment.videoUrl || '').trim();
    if (!videoUrl && video.videoId && /^\d{12,}$/.test(String(video.videoId))) {
      const cleanAuth = String(video.authorHandle || '').replace(/^@/, '').trim();
      videoUrl = cleanAuth
        ? 'https://www.tiktok.com/@' + cleanAuth + '/video/' + video.videoId
        : 'https://www.tiktok.com/video/' + video.videoId;
    }

    const rawAuth =
      comment.authorHandle
        ? '@' + String(comment.authorHandle).replace(/^@/, '').trim()
        : comment.authorName || comment.author || 'Пользователь';
    const quoteText = comment.text ? '«' + String(comment.text).trim() + '»' : '[медиа-комментарий]';
    const userNote = payload.note ? String(payload.note).trim() : '';
    const dialogNote =
      '💬 Комментарий ' + rawAuth + ': ' + quoteText + (userNote ? ' — ' + userNote : '');
    const messageText = formatForwardedCommentMessage(comment, videoUrl, userNote);

    const targetVideoIdMatch = videoUrl.match(/\/(?:video|photo)\/(\d{12,})/);
    const targetVideoId = (video.videoId && String(video.videoId)) || (targetVideoIdMatch ? targetVideoIdMatch[1] : '');
    const currentPlayerVideoId =
      latestCommentsPayload && latestCommentsPayload.videoId ? String(latestCommentsPayload.videoId) : '';
    const canUseStealthDialog =
      payload.fromChat === true
        ? Boolean(targetVideoId && currentPlayerVideoId && targetVideoId === currentPlayerVideoId)
        : payload.preferStealthDialog !== false;

    // 1) Основной путь (тот же самый, что идеально работает в плеере!): тихая отправка через диалог «Поделиться» в основном <webview> (без открытия окна плеера)
    if (win && !win.isDestroyed() && canUseStealthDialog) {
      const reqId = 'fwd_' + (++stealthSendSeq) + '_' + Date.now();
      const stealthRes = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingStealthSendResolvers.delete(reqId);
          resolve(null);
        }, 8500);
        pendingStealthSendResolvers.set(reqId, (res) => {
          clearTimeout(timer);
          resolve(res);
        });
        win.webContents.send('share:send-comment-stealth', {
          reqId,
          contacts,
          note: dialogNote
        });
      });

      if (stealthRes && stealthRes.ok) {
        let totalSent = Number(stealthRes.sentCount) || 0;
        if (Array.isArray(stealthRes.unmatchedTargets) && stealthRes.unmatchedTargets.length > 0) {
          const restRes = await sendTextToDmContacts(stealthRes.unmatchedTargets, messageText);
          if (restRes && restRes.ok) totalSent += Number(restRes.sentCount) || 0;
        }
        recordRecentContactsList(contacts);
        return { ok: true, via: 'stealth-dialog', sentCount: totalSent || contacts.length };
      }
      if (stealthRes && stealthRes.loginRequired) {
        return { ok: false, loginRequired: true };
      }
    }

    // 2) Запасной путь через фоновый движок ЛС (для контактов вне быстрого ряда «Поделиться» и пересылки из чата)
    return sendTextToDmContacts(contacts, messageText);
  });

  ipcMain.on('comments:data', (event, payload) => {
    if (!win || event.sender !== win.webContents) return;
    latestCommentsPayload = payload;
    if (commentsWin && !commentsWin.isDestroyed()) {
      commentsWin.webContents.send('comments:data', payload);
    }
  });

  ipcMain.on('comments:action-from-panel', (event, action) => {
    if (!commentsWin || event.sender !== commentsWin.webContents) return;
    if (win && !win.isDestroyed()) {
      win.webContents.send('comments:action', action);
    }
  });

  /* ─── Фоновый движок ЛС и собственное iOS-окно «Сообщения» ──────── */

  ipcMain.on('dm-engine:event', (_event, payload) => {
    if (!payload || typeof payload !== 'object') return;
    if (payload.type === 'dm-snapshot' && payload.data) {
      handleDmSnapshot(payload.data);
    }
  });

  ipcMain.handle('dm:warm', () => {
    ensureDmEngine();
    return true;
  });

  ipcMain.handle('dm:send-video-fallback', async (_event, payload) => {
    if (!payload || !Array.isArray(payload.contacts) || (!payload.videoUrl && !payload.comment)) {
      return { ok: false };
    }
    const text = payload.comment
      ? formatForwardedCommentMessage(payload.comment, payload.videoUrl || '', payload.note || '')
      : payload.note
        ? String(payload.note).trim() + '\n' + payload.videoUrl
        : String(payload.videoUrl);
    return sendTextToDmContacts(payload.contacts, text);
  });

  ipcMain.handle('messages:toggle', () => {
    if (messagesWin && !messagesWin.isDestroyed() && messagesWin.isVisible()) {
      closeMessagesWindow();
      return { open: false, docked: state.messagesDocked };
    }
    createOrShowMessagesWindow();
    return { open: true, docked: state.messagesDocked };
  });

  ipcMain.handle('messages:open', () => {
    createOrShowMessagesWindow();
    return { open: true, docked: state.messagesDocked };
  });

  ipcMain.on('messages:close', () => closeMessagesWindow());

  ipcMain.handle('messages:toggle-dock', () => {
    state.messagesDocked = !state.messagesDocked;
    if (state.messagesDocked) syncDockedPanels();
    scheduleSave();
    notifyMessagesWindowState();
    return { docked: state.messagesDocked };
  });

  ipcMain.handle('messages:get-initial', () => {
    ensureDmEngine();
    const convCount =
      latestDmSnapshot && Array.isArray(latestDmSnapshot.conversations)
        ? latestDmSnapshot.conversations.length
        : 0;
    if (convCount <= 12) {
      setTimeout(() => {
        scrollDmChatListTrusted().catch(() => {});
      }, 400);
    } else {
      writeDmDebug('messages-opened:' + convCount);
    }
    return {
      docked: state.messagesDocked,
      snapshot: latestDmSnapshot
    };
  });

  ipcMain.handle('messages:refresh', async () => {
    allowBusinessSuiteFallback = false;
    clearTimeout(businessSuiteCheckTimer);
    if (dmEngineWin && !dmEngineWin.isDestroyed()) {
      dmEngineReady = false;
      logDmDebug('manual-refresh', TIKTOK_MESSAGES_URL);
      dmEngineWin.loadURL(TIKTOK_MESSAGES_URL, { userAgent: CHROME_UA }).catch(() => {});
      setTimeout(() => {
        scrollDmChatListTrusted().catch(() => {});
      }, 2200);
    } else {
      ensureDmEngine();
    }
    return true;
  });

  ipcMain.handle('messages:open-chat', async (_event, payload) => {
    if (!payload) return { ok: false };
    return openDmChatTrusted(payload.chatId || '', payload.index ?? null, payload.name || '');
  });

  ipcMain.handle('messages:send-message', async (_event, rawText) => {
    const prep = await dmEval(
      'window.__TTF_DM_ENGINE__ ? window.__TTF_DM_ENGINE__.prepareSendMessage(' +
        JSON.stringify(rawText || '') + ') : null'
    );
    if (!prep || !prep.ok) return { ok: false };
    if (dmEngineWin && !dmEngineWin.isDestroyed()) {
      dmEngineWin.webContents.focus();
      if (prep.hasSendBtn) {
        const x = Math.round(prep.sendX);
        const y = Math.round(prep.sendY);
        dmEngineWin.webContents.sendInputEvent({ type: 'mouseMove', x, y });
        dmEngineWin.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        await new Promise((r) => setTimeout(r, 38));
        dmEngineWin.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      } else {
        dmEngineWin.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
        await new Promise((r) => setTimeout(r, 30));
        dmEngineWin.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
      }
      await new Promise((r) => setTimeout(r, 450));
      await dmEval('window.__TTF_DM_ENGINE__ ? window.__TTF_DM_ENGINE__.emitSnapshot(true) : null');
      return { ok: true };
    }
    return { ok: false };
  });

  ipcMain.handle('messages:load-older', async () => {
    return dmEval('window.__TTF_DM_ENGINE__ ? window.__TTF_DM_ENGINE__.loadOlderMessages() : false');
  });

  ipcMain.handle('messages:open-video', async (_event, payload) => {
    if (!payload) return false;
    let url = String(payload.url || '');
    if (!url && Number.isInteger(payload.domIndex) && payload.domIndex >= 0) {
      url = await resolveDmVideoUrlTrusted(payload.domIndex);
      if (!url) {
        url =
          (await dmEval(
            'window.__TTF_DM_ENGINE__ ? window.__TTF_DM_ENGINE__.resolveVideoUrlByClick(' +
              payload.domIndex + ') : ""'
          )) || '';
      }
      const reopenName = String(payload.chatName || '');
      if (url && reopenName && reopenName !== 'Чат') {
        setTimeout(() => openDmChatTrusted('', null, reopenName).catch(() => {}), 700);
      }
    }
    if (!url || !win || win.isDestroyed()) return false;
    win.show();
    win.webContents.send('messages:open-video', {
      url,
      chatName: String(payload.chatName || 'Чат')
    });
    return true;
  });

  ipcMain.handle('messages:open-story', async (_event, payload) => {
    if (!win || win.isDestroyed()) return false;
    const p = payload && typeof payload === 'object' ? payload : {};
    const url = String(p.url || '').trim() || 'https://www.tiktok.com/friends?lang=ru';
    const label = String(p.friendName || '').trim();
    win.show();
    win.webContents.send('messages:open-story', {
      url,
      friendName: label,
      isFriendsFeed: !p.url || /\/friends/i.test(url)
    });
    return true;
  });

  ipcMain.on('messages:open-login', () => {
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
      win.webContents.send('messages:open-login');
    }
  });
}

function registerShortcuts() {
  const toggleTop = () => {
    if (!win || win.isDestroyed()) return;
    state.alwaysOnTop = !state.alwaysOnTop;
    win.setAlwaysOnTop(state.alwaysOnTop, 'floating');
    if (commentsWin && !commentsWin.isDestroyed()) {
      commentsWin.setAlwaysOnTop(state.alwaysOnTop, 'floating');
    }
    if (messagesWin && !messagesWin.isDestroyed()) {
      messagesWin.setAlwaysOnTop(state.alwaysOnTop, 'floating');
    }
    scheduleSave();
    broadcastState();
  };

  const toggleVisible = () => {
    if (!win || win.isDestroyed()) return;
    if (win.isVisible()) {
      win.hide();
      if (commentsWin && !commentsWin.isDestroyed()) commentsWin.hide();
      if (messagesWin && !messagesWin.isDestroyed()) messagesWin.hide();
    } else {
      win.show();
      win.focus();
      syncDockedPanels();
      if (commentsWin && !commentsWin.isDestroyed()) commentsWin.showInactive();
      if (messagesWin && !messagesWin.isDestroyed()) messagesWin.showInactive();
    }
  };

  try {
    globalShortcut.register('CommandOrControl+Alt+T', toggleTop);
    globalShortcut.register('CommandOrControl+Alt+H', toggleVisible);
  } catch (error) {
    console.warn('Не удалось зарегистрировать глобальные горячие клавиши:', error);
  }
}

function setupSession() {
  const ses = session.defaultSession;
  ses.setUserAgent(CHROME_UA);

  const allowed = new Set(['fullscreen', 'clipboard-sanitized-write']);
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowed.has(permission));
  });
  ses.setPermissionCheckHandler((_webContents, permission) => {
    return allowed.has(permission);
  });
}

app.on('second-instance', () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  if (app.isReady()) {
    globalShortcut.unregisterAll();
  }
  saveStateNow();
});

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    state = loadState();
    state.menuOpen = false;
    Menu.setApplicationMenu(null);
    setupSession();
    setupGuestWebContents();
    setupIpc();
    createWindow();
    registerShortcuts();
    // Прогреваем фоновый offscreen-движок ЛС сразу после старта окна, чтобы чаты открывались мгновенно
    setTimeout(() => {
      if (win && !win.isDestroyed()) ensureDmEngine();
    }, 900);
  });
}
