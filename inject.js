'use strict';

/**
 * Контроллер внутри страницы TikTok (<webview>).
 * v7:
 * - Полная поддержка anchoring-chrome-host + article + одиночной страницы ролика из ЛС.
 * - Полностью невидимая работа Share-диалога (никаких веб-попапов «Поделиться» поверх видео).
 * - Парсинг 1-го ряда контактов авторизованного «Поделиться» + отправка по клику.
 * - Точные счётчики лайков у комментариев (API + расширенный DOM-парсер).
 */
function tiktokFloatPageController() {
  const KEY = '__TIKTOK_FLOAT__';
  if (window[KEY] && window[KEY].version >= 10) return window[KEY].status();

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function ensureNetStore() {
    const store = (window.__TTF_NET_STORE__ = window.__TTF_NET_STORE__ || {
      videos: new Map(),
      commentsByVideo: new Map(),
      repliesByComment: new Map(),
      contacts: new Map(),
      lastAwemeId: null,
      lastDigg: null,
      lastRepost: null,
      listeners: []
    });
    if (!store.contacts) store.contacts = new Map();
    if (!store.listeners) store.listeners = [];
    if (!('lastDigg' in store)) store.lastDigg = null;
    if (!('lastRepost' in store)) store.lastRepost = null;
    return store;
  }

  const NET = ensureNetStore();

  const S = {
    auto: false,
    mode: 'end',
    seconds: 10,
    muted: false,
    volume: 1,
    playbackRate: 1,
    timer: null,
    navLockUntil: 0,
    trackedVideo: null,
    trackedMaxTime: 0,
    trackedSkipLockUntil: 0,
    trackedItemKey: '',
    photoStartAt: 0,
    isScrubbing: false,

    commentsOpen: false,
    commentsLoading: false,
    currentVideoId: '',
    domCommentsByVideo: new Map(),
    repostedIds: new Set(),
    likedOverrides: new Map(),
    lastHudKey: '',
    lastCommentsHash: '',
    pinnedClickEl: null,
    pinnedAncestors: [],
    pinnedNoTransform: [],
    domObserver: null
  };

  function bridgeEmit(type, data) {
    try {
      window.postMessage({ __ttfBridge: true, payload: { type, data } }, '*');
    } catch {}
  }

  function cleanText(node) {
    return node ? String(node.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function allVideos() {
    return Array.from(document.querySelectorAll('video'));
  }

  function visibleArea(rect) {
    if (!rect || rect.width <= 0 || rect.height <= 0) return 0;
    const width = Math.max(
      0,
      Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0)
    );
    const height = Math.max(
      0,
      Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)
    );
    return width * height;
  }

  function updateVideoAspectClass(video) {
    if (!video || !video.videoWidth || !video.videoHeight) return;
    video.classList.toggle('ttf-landscape', video.videoWidth > video.videoHeight * 1.15);
  }

  function activeChromeHost() {
    return (
      document.querySelector('[data-e2e="anchoring-chrome-host"]') ||
      document.querySelector('[class*="DivChromeHost"]') ||
      null
    );
  }

  function activeFeedItem() {
    const items = Array.from(
      document.querySelectorAll(
        '[data-e2e="recommend-list-item-container"], article[class*="ArticleItemContainer"], article'
      )
    );
    let bestItem = null;
    let bestArea = 0;
    for (const item of items) {
      const area = visibleArea(item.getBoundingClientRect());
      if (area > bestArea) {
        bestArea = area;
        bestItem = item;
      }
    }
    return bestItem;
  }

  function queryActive(item, selectors, allowDocumentFallback) {
    const host = activeChromeHost();
    const roots = [];
    if (host) roots.push(host);
    if (item) roots.push(item);
    if (allowDocumentFallback || roots.length === 0) roots.push(document);

    for (const root of roots) {
      for (const sel of selectors) {
        try {
          const el = root.querySelector(sel);
          if (el) return el;
        } catch {}
      }
    }
    return null;
  }

  function activeVideo() {
    const item = activeFeedItem();
    if (item) {
      const inside = Array.from(item.querySelectorAll('video')).find((v) => {
        const r = v.getBoundingClientRect();
        return r.width > 40 && r.height > 40;
      });
      if (inside) {
        updateVideoAspectClass(inside);
        return inside;
      }
    }

    let best = null;
    let bestArea = 0;
    for (const video of allVideos()) {
      const rect = video.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40) continue;
      const area = visibleArea(rect);
      if (area > bestArea) {
        best = video;
        bestArea = area;
      }
    }
    if (best) updateVideoAspectClass(best);
    return best;
  }

  function extractAuthorHandle(item) {
    const link = queryActive(item, [
      '[data-e2e="video-author-avatar"]',
      '[data-e2e="browse-user-avatar"]',
      'a[href^="/@"]',
      'a[href*="/@"]'
    ]);
    if (link) {
      const href = link.getAttribute('href') || '';
      const m = href.match(/\/@([^/?#]+)/);
      if (m) return m[1];
    }
    const uid = queryActive(item, [
      '[data-e2e="video-author-uniqueid"]',
      '[data-e2e="browse-username"]'
    ]);
    return uid ? cleanText(uid).replace(/^@/, '') : '';
  }

  function extractAuthorName(item) {
    const identity = queryActive(item, ['[data-e2e="cinema-creator-identity"]']);
    if (identity) {
      const clone = identity.cloneNode(true);
      for (const btn of clone.querySelectorAll(
        'button, [data-e2e="cinema-video-info-follow"], [class*="DivCreatorFollow"]'
      )) {
        btn.remove();
      }
      const txt = cleanText(clone);
      if (txt) return txt;
    }
    const el = queryActive(item, [
      '[data-e2e="video-author-nickname"]',
      '[data-e2e="browse-user-nickname"]'
    ]);
    return cleanText(el);
  }

  function extractAvatar(item) {
    const img = queryActive(item, [
      '[data-e2e="video-author-avatar"] img',
      '[data-e2e="cinema-creator-avatar"] img',
      '[data-e2e="browse-user-avatar"] img',
      'a[href*="/@"] img',
      '[class*="ImgAvatar"]'
    ]);
    return img && img.src ? img.src : '';
  }

  function extractDescription(item) {
    const el = queryActive(item, [
      '[data-e2e="video-desc"]',
      '[data-e2e="multiline-text-content"]',
      '[data-e2e="browse-video-desc"]'
    ]);
    return cleanText(el);
  }

  function extractMusic(item) {
    const el = queryActive(item, [
      '[data-e2e="video-music"]',
      '[data-e2e="browse-music"]',
      'a[href*="/music/"]'
    ]);
    return cleanText(el);
  }

  function extractAwemeIdFromFiber(el) {
    if (!el) return '';
    let cur = el;
    for (let depth = 0; depth < 6 && cur && cur !== document.body; depth++) {
      try {
        for (const k of Object.keys(cur)) {
          if (!k.startsWith('__reactFiber') && !k.startsWith('__reactProps')) continue;
          const seen = new WeakSet();
          const stack = [cur[k]];
          let steps = 0;
          while (stack.length && steps < 140) {
            steps++;
            const obj = stack.pop();
            if (!obj || typeof obj !== 'object' || seen.has(obj)) continue;
            seen.add(obj);
            const candidate =
              obj.awemeId ||
              obj.aweme_id ||
              obj.itemId ||
              obj.item_id ||
              (obj.aweme && (obj.aweme.id || obj.aweme.aweme_id)) ||
              (obj.item && (obj.item.id || obj.item.aweme_id));
            if (candidate && /^\d{15,22}$/.test(String(candidate))) {
              return String(candidate);
            }
            for (const ck of Object.keys(obj)) {
              if (ck === 'return' || ck === 'sibling' || ck === 'alternate' || ck === '_owner' || ck === 'stateNode') continue;
              const v = obj[ck];
              if (v && typeof v === 'object') stack.push(v);
            }
          }
        }
      } catch {}
      cur = cur.parentElement;
    }
    return '';
  }

  function extractVideoId(item, video) {
    // 1) Самый точный источник в TikTok 2026 — обёртка xgwrapper активного <video>
    if (video) {
      const wrapper = video.closest('[id*="xgwrapper"]');
      if (wrapper && wrapper.id) {
        const m = wrapper.id.match(/(\d{15,22})/);
        if (m) return m[1];
      }
      if (video.id && /\d{15,22}/.test(video.id)) {
        const m = video.id.match(/(\d{15,22})/);
        if (m) return m[1];
      }
    }

    // 2) Атрибуты и ссылки СТРОГО внутри активного <article> (никогда не ищем по всему document!)
    if (item) {
      const attrs = [
        item.getAttribute('data-item-id'),
        item.getAttribute('data-e2e-item-id'),
        item.getAttribute('data-aweme-id'),
        item.id
      ];
      for (const a of attrs) {
        if (a && /\d{15,22}/.test(a)) {
          const m = a.match(/(\d{15,22})/);
          if (m) return m[1];
        }
      }
      const itemXg = item.querySelector('[id*="xgwrapper"]');
      if (itemXg && itemXg.id) {
        const m = itemXg.id.match(/(\d{15,22})/);
        if (m) return m[1];
      }
      const itemLink = item.querySelector('a[href*="/video/"], a[href*="/photo/"]');
      if (itemLink) {
        const m = (itemLink.getAttribute('href') || '').match(/\/(?:video|photo)\/(\d{15,22})/);
        if (m) return m[1];
      }
    }

    // 3) React Fiber на активном <article> или <video>
    const fiberId = extractAwemeIdFromFiber(video) || extractAwemeIdFromFiber(item);
    if (fiberId) return fiberId;

    // 4) Одиночная страница ролика (/video/123...)
    const urlMatch = location.pathname.match(/\/(?:video|photo)\/(\d{15,22})/);
    if (urlMatch) return urlMatch[1];

    // 5) Сопоставление с перехваченным списком видео по автору + описанию
    const handle = extractAuthorHandle(item);
    const authorName = extractAuthorName(item);
    const domDesc = extractDescription(item);
    for (const [id, meta] of NET.videos.entries()) {
      if (
        handle &&
        meta.authorHandle &&
        meta.authorHandle.toLowerCase() === handle.toLowerCase()
      ) {
        if (!domDesc || !meta.desc || meta.desc.slice(0, 18) === domDesc.slice(0, 18)) {
          return id;
        }
      }
      if (
        authorName &&
        meta.authorName &&
        meta.authorName.toLowerCase() === authorName.toLowerCase()
      ) {
        if (!domDesc || !meta.desc || meta.desc.slice(0, 18) === domDesc.slice(0, 18)) {
          return id;
        }
      }
    }

    const domKey = (handle || authorName || 'item') + '_' + (domDesc || '').slice(0, 18);
    let itemIdx = -1;
    try {
      itemIdx = item
        ? Array.from(document.querySelectorAll('[data-e2e="recommend-list-item-container"], article')).indexOf(item)
        : -1;
    } catch {}
    const srcTail =
      video && (video.currentSrc || video.src)
        ? String(video.currentSrc || video.src).replace(/[?#].*$/, '').slice(-14)
        : '';
    return 'dom_' + domKey + '_' + itemIdx + '_' + srcTail;
  }

  function getCurrentVideoUrl() {
    const item = activeFeedItem();
    const video = activeVideo();
    const videoId = extractVideoId(item, video);
    const meta = NET.videos.get(videoId) || {};
    const handle = extractAuthorHandle(item) || meta.authorHandle || '';
    if (/^\d{12,}$/.test(videoId)) {
      if (handle) return 'https://www.tiktok.com/@' + handle + '/video/' + videoId;
      return 'https://www.tiktok.com/video/' + videoId;
    }
    return location.href;
  }

  function findLikeContainer(item) {
    return queryActive(item, [
      '[data-e2e="like-icon"]',
      '[data-e2e="browse-like-icon"]'
    ]);
  }

  function findCommentContainer(item) {
    return queryActive(item, [
      '[data-e2e="comment-icon"]',
      '[data-e2e="browse-comment-icon"]'
    ]);
  }

  function findShareContainer(item) {
    return queryActive(item, [
      '[data-e2e="share-icon"]',
      '[data-e2e="browse-share-icon"]'
    ]);
  }

  function findDirectRepostContainer(item) {
    // Ищем ТОЛЬКО внутри панели действий активного ролика (не по всему документу!)
    const roots = [activeChromeHost(), item].filter(Boolean);
    const selectors = [
      '[data-e2e="repost-icon"]',
      '[data-e2e="video-repost"]',
      '[data-e2e="browse-repost-icon"]',
      'button[aria-label*="репост" i]',
      'button[aria-label*="repost" i]',
      '[role="button"][aria-label*="репост" i]',
      '[role="button"][aria-label*="repost" i]'
    ];
    for (const root of roots) {
      for (const sel of selectors) {
        try {
          const el = root.querySelector(sel);
          if (el) return el;
        } catch {}
      }
    }
    return null;
  }

  function isRepostedDom(container) {
    if (!container) return false;
    if (container.getAttribute('aria-pressed') === 'true') return true;
    const btn = container.querySelector('button');
    if (btn && btn.getAttribute('aria-pressed') === 'true') return true;
    const aria = (
      (container.getAttribute('aria-label') || '') +
      ' ' +
      (btn ? btn.getAttribute('aria-label') || '' : '')
    ).toLowerCase();
    return /отменить репост|удалить репост|убрать репост|remove repost|undo repost/i.test(aria);
  }

  function isReddishColor(colorStr) {
    if (!colorStr) return false;
    const s = String(colorStr).trim().toLowerCase();
    if (s.startsWith('#')) {
      const hex = s.slice(1);
      if (hex.length === 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return r >= 190 && g <= 110 && b <= 130;
      }
      return false;
    }
    const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return false;
    const r = Number(m[1]);
    const g = Number(m[2]);
    const b = Number(m[3]);
    return r >= 190 && g <= 110 && b <= 130;
  }

  function isLikedDom(container) {
    if (!container) return false;
    if (container.getAttribute('aria-pressed') === 'true') return true;
    const btn = container.querySelector('button');
    if (btn && btn.getAttribute('aria-pressed') === 'true') return true;

    const aria = (
      (container.getAttribute('aria-label') || '') +
      ' ' +
      (btn ? btn.getAttribute('aria-label') || '' : '')
    ).toLowerCase();
    if (/убрать|отменить|снят|unlike|liked/i.test(aria)) return true;

    const nodes = [container, ...Array.from(container.querySelectorAll('svg, path, span, button'))];
    for (const node of nodes) {
      try {
        if (isReddishColor(node.getAttribute('fill'))) return true;
        if (isReddishColor(node.getAttribute('stroke'))) return true;
        const st = getComputedStyle(node);
        if (isReddishColor(st.fill) || isReddishColor(st.color)) return true;
      } catch {}
    }
    return false;
  }

  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity || '1') < 0.05) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 40 && rect.height > 40;
  }

  function hasLoginModal() {
    const el = document.querySelector('#loginContainer, [class*="DivLoginContainer"]');
    return Boolean(el && isElementVisible(el));
  }

  function hasInteractiveModal() {
    const candidates = document.querySelectorAll(
      '[id*="captcha"], [class*="captcha" i], #tiktok-verify-ele, #loginContainer, [class*="DivLoginContainer"]'
    );
    for (const el of candidates) {
      if (isElementVisible(el)) return true;
    }
    return false;
  }

  function isLoggedInHeuristic() {
    if (document.querySelector('[data-e2e="profile-icon"]')) return true;
    if (document.querySelector('[data-e2e="comment-input"] [contenteditable="true"]')) {
      return true;
    }
    if (document.querySelector('button[aria-label="Войти"], [data-e2e="top-login-button"]')) {
      return false;
    }
    if (document.querySelector('[data-e2e="comment-login-bar"]')) return false;
    return null;
  }

  function detectUnreadMessages() {
    const msgLink = document.querySelector(
      '[data-e2e="nav-messages"], a[href*="/messages"], [aria-label*="Сообщения" i], [aria-label*="Messages" i]'
    );
    if (!msgLink) return 0;
    const badge = msgLink.querySelector(
      '[class*="Badge"], [class*="Sup"], sup, [data-e2e*="badge"]'
    );
    if (!badge) return 0;
    const n = parseInt(cleanText(badge), 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function formatCompact(num) {
    const n = Number(num);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace('.', ',') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',') + 'K';
    return String(Math.round(n));
  }

  /* ─── Полное скрытие любых Share-порталов TikTok во время скрытого репоста/отправки ─── */

  function findShareModals() {
    const found = new Set();
    const candidates = document.querySelectorAll(
      '[role="dialog"], [aria-modal="true"], [class*="TUXModal"], [class*="DivShareModal"], [class*="ShareModal"], [class*="DivModalContainer"]'
    );
    for (const el of candidates) {
      if (
        el.querySelector('#loginContainer, [class*="DivLoginContainer"], [id*="captcha"], #tiktok-verify-ele')
      ) {
        continue;
      }
      const txt = cleanText(el);
      if (
        el.querySelector('[data-e2e="share-repost"], [data-e2e="share-copy"], [data-e2e="share-group"], [data-e2e="share-message"]') ||
        /поделиться|отправить друзьям|share to|send to/i.test(txt.slice(0, 120))
      ) {
        found.add(el);
        // Также скрываем портал-обёртку в body, если она держит затемнённый backdrop
        let top = el;
        while (top.parentElement && top.parentElement !== document.body && top.parentElement.id !== 'app') {
          top = top.parentElement;
        }
        if (top && top !== document.body && top.id !== 'app' && !top.querySelector('#loginContainer')) {
          found.add(top);
        }
      }
    }
    return Array.from(found);
  }

  function markStealthShareModals() {
    if (!document.documentElement.classList.contains('ttf-stealth-share')) return;
    for (const modal of findShareModals()) {
      modal.classList.add('ttf-hidden-share-portal');
    }
  }

  function clearStealthShareModals() {
    for (const el of document.querySelectorAll('.ttf-hidden-share-portal')) {
      el.classList.remove('ttf-hidden-share-portal');
    }
  }

  /* ─── Надёжная подготовка элемента для реального isTrusted-клика ─── */

  function releaseClickTarget() {
    if (S.pinnedClickEl) {
      try { S.pinnedClickEl.classList.remove('ttf-click-target', 'ttf-click-inline'); } catch {}
      S.pinnedClickEl = null;
    }
    for (const anc of S.pinnedAncestors) {
      try { anc.classList.remove('ttf-click-ancestor', 'ttf-click-rel'); } catch {}
    }
    S.pinnedAncestors = [];
    for (const nt of S.pinnedNoTransform) {
      try { nt.classList.remove('ttf-click-no-transform'); } catch {}
    }
    S.pinnedNoTransform = [];
    return true;
  }

  function inViewport(x, y) {
    return (
      x >= 6 &&
      x <= window.innerWidth - 6 &&
      y >= 6 &&
      y <= window.innerHeight - 6
    );
  }

  function checkHit(el, x, y) {
    if (!inViewport(x, y)) return false;
    const hit = document.elementFromPoint(x, y);
    if (!hit) return false;
    return el === hit || el.contains(hit) || hit.contains(el);
  }

  function pinTarget(el, extra, options) {
    releaseClickTarget();
    if (!el || !el.isConnected) return { ok: false, reason: 'not_found' };

    const opts = options || {};
    const target = opts.preferInnerButton ? el.querySelector('button') || el : el;
    S.pinnedClickEl = target;

    let cur = target.parentElement;
    while (cur && cur !== document.documentElement) {
      const st = getComputedStyle(cur);
      const isHiddenLayer =
        st.pointerEvents === 'none' ||
        parseFloat(st.opacity || '1') < 0.05 ||
        Number(st.zIndex) < 0 ||
        cur.classList.contains('ttf-hidden-share-portal');
      if (isHiddenLayer) {
        cur.classList.add('ttf-click-ancestor');
        if (st.position === 'static') {
          cur.classList.add('ttf-click-rel');
        }
        S.pinnedAncestors.push(cur);
      }
      cur = cur.parentElement;
    }

    target.classList.add('ttf-click-inline');

    if (opts.scrollFirst) {
      try {
        target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      } catch {
        try { target.scrollIntoView(); } catch {}
      }
    }

    let r = target.getBoundingClientRect();
    let cx = r.left + Math.max(4, r.width / 2);
    let cy = r.top + Math.max(4, r.height / 2);
    let hitOk = r.width >= 4 && r.height >= 4 && checkHit(target, cx, cy);

    if (!hitOk && !opts.noFixedCenter) {
      target.classList.add('ttf-click-target');
      r = target.getBoundingClientRect();
      cx = r.left + Math.max(4, r.width / 2);
      cy = r.top + Math.max(4, r.height / 2);
      hitOk = r.width >= 4 && r.height >= 4 && checkHit(target, cx, cy);

      if (!hitOk) {
        let p = target.parentElement;
        while (p && p !== document.body) {
          const pst = getComputedStyle(p);
          if (
            pst.transform !== 'none' ||
            pst.filter !== 'none' ||
            (pst.backdropFilter && pst.backdropFilter !== 'none') ||
            (pst.contain && pst.contain !== 'none') ||
            (pst.willChange && pst.willChange !== 'auto')
          ) {
            p.classList.add('ttf-click-no-transform');
            S.pinnedNoTransform.push(p);
          }
          p = p.parentElement;
        }
        r = target.getBoundingClientRect();
        cx = r.left + Math.max(4, r.width / 2);
        cy = r.top + Math.max(4, r.height / 2);
        hitOk = r.width >= 4 && r.height >= 4 && checkHit(target, cx, cy);
      }
    }

    return {
      ok: true,
      x: clamp(cx, 8, Math.max(12, window.innerWidth - 8)),
      y: clamp(cy, 8, Math.max(12, window.innerHeight - 8)),
      hitOk,
      ...(extra || {})
    };
  }

  function directClickPinned() {
    if (!S.pinnedClickEl || !S.pinnedClickEl.isConnected) return false;
    try {
      S.pinnedClickEl.click();
      return true;
    } catch {
      return false;
    }
  }

  const REPOST_LABEL_RE =
    /^(репост|отменить репост|сделать репост|удалить репост|убрать репост|повторить публикацию|повторная публикация|repost|remove repost|undo repost)$/i;

  function findRepostElement() {
    const modals = findShareModals();

    // 1) Сначала строго внутри открытых Share-модалок (никогда не цепляем чужие скрытые ролики в ленте)
    for (const dlg of modals) {
      const direct = dlg.querySelector(
        '[data-e2e="share-repost"], [data-e2e="video-share-repost"], [data-e2e*="repost" i]'
      );
      if (direct) return direct;

      // Если карусель действий сдвинута вправо — возвращаем в начало
      const scrollRows = dlg.querySelectorAll('[data-e2e="share-group"], [class*="DivActionGroupContainer"], div');
      for (const sr of scrollRows) {
        if (sr.scrollLeft > 0 && sr.scrollWidth > sr.clientWidth + 10) {
          sr.scrollLeft = 0;
        }
      }

      const nodes = Array.from(dlg.querySelectorAll('div, button, a, p, span'));
      for (const node of nodes) {
        const aria = (node.getAttribute('aria-label') || node.getAttribute('title') || '').trim();
        if (aria && REPOST_LABEL_RE.test(aria)) {
          return node.closest('[data-e2e], [class*="DivActionContainer"], [role="button"], button, a') || node;
        }
        if (node.children.length > 2) continue;
        const text = cleanText(node);
        if (REPOST_LABEL_RE.test(text)) {
          return node.closest('[data-e2e], [class*="DivActionContainer"], [role="button"], button, a') || node;
        }
      }
    }

    // 2) Проверяем открытые поповеры/меню (например, если TikTok вынес репост в «...»)
    const menus = document.querySelectorAll(
      '[role="menu"], [data-e2e="more-menu-popover"], [class*="DivShareActions"], [class*="SharePopup"]'
    );
    for (const menu of menus) {
      const direct = menu.querySelector(
        '[data-e2e="share-repost"], [data-e2e="video-share-repost"], [data-e2e*="repost" i]'
      );
      if (direct) return direct;
      for (const node of menu.querySelectorAll('[role="menuitem"], button, a, div, p, span')) {
        if (node.children.length > 2) continue;
        if (REPOST_LABEL_RE.test(cleanText(node))) {
          return node.closest('[role="menuitem"], [data-e2e], button, a') || node;
        }
      }
    }

    // 3) Финальный запасной поиск по всему документу только для share-repost
    return document.querySelector('[data-e2e="share-repost"], [data-e2e="video-share-repost"]');
  }

  function hasShareDialogWithoutRepost() {
    const modals = findShareModals();
    if (!modals.length) return false;
    for (const dlg of modals) {
      if (dlg.querySelector('[data-e2e="share-copy"], [data-e2e="share-whatsapp"], [data-e2e="share-embed"]')) {
        return !findRepostElement();
      }
    }
    return false;
  }

  function isCommentsSidebarOpen() {
    return Boolean(
      document.querySelector(
        '[class*="DivCommentListContainer"], [class*="DivCommentMain"], [data-e2e="comment-level-1"], [data-e2e="comment-input"], [data-e2e="comment-login-bar"]'
      )
    );
  }

  function findCommentsSidebar() {
    return (
      document.querySelector('aside[class*="AsideOneColumnSidebar"]') ||
      document.querySelector('section[class*="SectionCommentSidebarContainer"]') ||
      document.querySelector('[class*="DivCommentListContainer"]') ||
      document.querySelector('[class*="DivCommentContainer"]') ||
      document.querySelector('[data-e2e="comment-list"]') ||
      null
    );
  }

  function findDomCommentCard(cid, index, text) {
    const container = findCommentsSidebar();
    if (!container) return null;
    const wrappers = Array.from(
      container.querySelectorAll(
        '[class*="DivCommentObjectWrapper"], [class*="DivCommentItemContainer"]'
      )
    );
    if (text) {
      const match = wrappers.find(
        (w) => cleanText(w.querySelector('[data-e2e="comment-level-1"]')) === text
      );
      if (match) return match;
    }
    if (Number.isInteger(index) && wrappers[index]) {
      return wrappers[index];
    }
    return null;
  }

  function findRepliesExpandButton(card) {
    if (!card) return null;
    const e2eBtn = card.querySelector('[data-e2e="view-more-1"]');
    if (e2eBtn) return e2eBtn;
    return (
      Array.from(card.querySelectorAll('button, p, span')).find((el) =>
        /просмотреть\s+\d+\s+ответ|посмотреть.*ответ|view\s+\d*\s*repl/i.test(cleanText(el))
      ) || null
    );
  }

  function prepareClickTarget(kind, arg) {
    const item = activeFeedItem();
    const video = activeVideo();
    const videoId = extractVideoId(item, video);

    if (kind === 'like') {
      const container = findLikeContainer(item);
      if (!container) return { ok: false, reason: 'not_found' };
      const beforeLiked = isLikedDom(container);
      const likesEl = queryActive(item, ['[data-e2e="like-count"]', '[data-e2e="browse-like-count"]']);
      const beforeCount = cleanText(likesEl);
      NET.lastDigg = null;
      return pinTarget(
        container,
        { beforeLiked, beforeCount, videoId },
        { preferInnerButton: true }
      );
    }

    if (kind === 'repost-direct') {
      const container = findDirectRepostContainer(item);
      if (!container) return { ok: false, reason: 'not_found' };
      const willRemove = isRepostedDom(container);
      NET.lastRepost = null;
      return pinTarget(container, { willRemove, videoId, direct: true }, { preferInnerButton: true });
    }

    if (kind === 'share') {
      document.documentElement.classList.add('ttf-stealth-share');
      const container = findShareContainer(item);
      if (!container) {
        document.documentElement.classList.remove('ttf-stealth-share');
        return { ok: false, reason: 'not_found' };
      }
      NET.lastRepost = null;
      return pinTarget(container, { videoId }, { preferInnerButton: true });
    }

    if (kind === 'more-menu') {
      document.documentElement.classList.add('ttf-stealth-share');
      const btn = queryActive(item, ['[data-e2e="more-menu-icon"]']);
      if (!btn) {
        document.documentElement.classList.remove('ttf-stealth-share');
        return { ok: false, reason: 'not_found' };
      }
      NET.lastRepost = null;
      return pinTarget(btn, { videoId }, { preferInnerButton: true });
    }

    if (kind === 'repost') {
      markStealthShareModals();
      const el = findRepostElement();
      if (!el) {
        return {
          ok: false,
          reason: hasShareDialogWithoutRepost() ? 'repost_unavailable_on_video' : 'not_found',
          dialogHasShareActions: hasShareDialogWithoutRepost()
        };
      }
      const label = (
        cleanText(el) +
        ' ' +
        (el.getAttribute('aria-label') || '') +
        ' ' +
        (el.getAttribute('title') || '')
      ).toLowerCase();
      const willRemove =
        label.includes('отмен') ||
        label.includes('удал') ||
        label.includes('убрат') ||
        label.includes('remove') ||
        label.includes('undo');
      return pinTarget(el, { willRemove, videoId }, { scrollFirst: true });
    }

    if (kind === 'comment') {
      S.commentsOpen = true;
      S.currentVideoId = videoId;
      const forceToggle = Boolean(arg && arg.forceClick);
      if (!forceToggle && isCommentsSidebarOpen()) {
        return { ok: true, alreadyOpen: true, videoId };
      }
      S.commentsLoading = true;
      const container = findCommentContainer(item);
      if (!container) return { ok: false, reason: 'not_found' };
      return pinTarget(container, { videoId }, { preferInnerButton: true });
    }

    if (kind === 'comment-like' && arg) {
      const card = findDomCommentCard(arg.cid, arg.index, arg.text);
      const icon = card && card.querySelector('[data-e2e="comment-like-icon"]');
      return pinTarget(icon, null, { scrollFirst: true });
    }

    if (kind === 'comment-reply' && arg) {
      const card = findDomCommentCard(arg.cid, arg.index, arg.text);
      const btn =
        card &&
        (card.querySelector('[data-e2e="comment-reply-1"]') ||
          Array.from(card.querySelectorAll('button, p, span')).find((el) =>
            /^(ответить|reply)$/i.test(cleanText(el))
          ));
      return pinTarget(btn, null, { scrollFirst: true });
    }

    if (kind === 'comment-more-replies' && arg) {
      const card = findDomCommentCard(arg.cid, arg.index, arg.text);
      const btn = findRepliesExpandButton(card);
      return pinTarget(btn, null, { scrollFirst: true });
    }

    if (kind === 'comment-post') {
      const postBtn =
        document.querySelector('[data-e2e="comment-post"]') ||
        Array.from(document.querySelectorAll('button, div[role="button"]')).find((el) =>
          /^(опубликовать|отправить|post)$/i.test(cleanText(el))
        );
      return pinTarget(postBtn, null, { scrollFirst: true });
    }

    return { ok: false, reason: 'unknown_kind' };
  }

  function verifyLikeResult(videoId, beforeLiked, beforeCount) {
    if (hasLoginModal()) {
      return { ok: false, loginRequired: true, liked: Boolean(beforeLiked) };
    }
    const item = activeFeedItem();
    const container = findLikeContainer(item);
    const domLiked = container ? isLikedDom(container) : Boolean(beforeLiked);
    const apiDigg =
      NET.lastDigg && Date.now() - NET.lastDigg.at < 3500 ? NET.lastDigg : null;

    const likesEl = queryActive(item, ['[data-e2e="like-count"]', '[data-e2e="browse-like-count"]']);
    const afterCount = cleanText(likesEl);
    const countChanged = Boolean(beforeCount && afterCount && beforeCount !== afterCount);

    let liked = domLiked;
    let changed = domLiked !== Boolean(beforeLiked);

    if (apiDigg && apiDigg.statusCode === 0) {
      if (typeof apiDigg.isDigg === 'number') {
        liked = apiDigg.isDigg === 1;
      } else {
        liked = !Boolean(beforeLiked);
      }
      changed = true;
    } else if (countChanged && !changed) {
      liked = !Boolean(beforeLiked);
      changed = true;
    }

    if (changed && videoId) {
      S.likedOverrides.set(videoId, { liked, until: Date.now() + 2600 });
      const meta = NET.videos.get(videoId);
      if (meta) meta.liked = liked;
    }

    emitHud(true);
    return {
      ok: changed,
      liked,
      likesText: afterCount,
      loginRequired: false
    };
  }

  function closeShareDialogOnly() {
    const modals = findShareModals();
    for (const dlg of modals) {
      const closeBtn = dlg.querySelector(
        'button[aria-label="close" i], button[aria-label="Закрыть" i], button[aria-label="exit" i], [class*="TUXModalNavBar"] button'
      );
      if (closeBtn) {
        try { closeBtn.click(); } catch {}
      }
    }
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } catch {}
  }

  function detectTikTokRepostToast() {
    const alerts = document.querySelectorAll(
      '[role="status"], [role="alert"], [class*="Toast"], [class*="Notice"], [class*="TUXToast"], [class*="Snack"]'
    );
    for (const el of alerts) {
      const txt = cleanText(el).toLowerCase();
      if (!txt || txt.length > 140) continue;
      if (/репост удал|репост отмен|убран из репост|repost removed|removed from repost|undo repost/i.test(txt)) {
        return { confirmed: true, reposted: false };
      }
      if (/сделали репост|добавлено в репост|опубликовано повторно|повторная публикация|репост|reposted/i.test(txt)) {
        return { confirmed: true, reposted: true };
      }
    }
    return null;
  }

  function evaluateRepostState(videoId, willRemove) {
    const loginRequired = hasLoginModal();
    if (loginRequired) {
      return { done: true, ok: false, loginRequired: true, reposted: false };
    }

    let apiRepost =
      NET.lastRepost && Date.now() - NET.lastRepost.at < 5000 ? NET.lastRepost : null;
    if (
      apiRepost &&
      apiRepost.awemeId &&
      /^\d{12,}$/.test(String(apiRepost.awemeId)) &&
      /^\d{12,}$/.test(String(videoId)) &&
      String(apiRepost.awemeId) !== String(videoId)
    ) {
      apiRepost = null;
    }
    const toastHint = detectTikTokRepostToast();

    const repostEl = findRepostElement();
    const stillLabel = repostEl
      ? (cleanText(repostEl) + ' ' + (repostEl.getAttribute('aria-label') || '')).toLowerCase()
      : '';
    const isNowRemoveLabel =
      stillLabel.includes('отмен') ||
      stillLabel.includes('удал') ||
      stillLabel.includes('убрат') ||
      stillLabel.includes('remove') ||
      stillLabel.includes('undo');
    const labelFlipped = Boolean(
      repostEl && stillLabel.length > 0 && (willRemove ? !isNowRemoveLabel : isNowRemoveLabel)
    );

    if (apiRepost) {
      if (apiRepost.statusCode === 0) {
        return { done: true, ok: true, loginRequired: false, reposted: Boolean(apiRepost.reposted) };
      }
      return { done: true, ok: false, loginRequired: false, reposted: S.repostedIds.has(videoId), apiError: apiRepost.statusCode };
    }
    if (toastHint && toastHint.confirmed) {
      return { done: true, ok: true, loginRequired: false, reposted: toastHint.reposted };
    }
    if (labelFlipped) {
      return { done: true, ok: true, loginRequired: false, reposted: !Boolean(willRemove) };
    }

    return { done: false, ok: false, loginRequired: false, reposted: S.repostedIds.has(videoId) };
  }

  function checkRepostProgress(videoId, willRemove) {
    markStealthShareModals();
    return evaluateRepostState(videoId, willRemove);
  }

  function finishRepost(videoId, willRemove) {
    const state = evaluateRepostState(videoId, willRemove);

    if (!state.loginRequired) {
      closeShareDialogOnly();
    }
    setTimeout(() => {
      clearStealthShareModals();
      document.documentElement.classList.remove('ttf-stealth-share');
    }, 180);

    if (state.loginRequired) {
      return { ok: false, found: true, loginRequired: true, reposted: false };
    }

    if (!state.ok) {
      return {
        ok: false,
        found: true,
        loginRequired: false,
        reposted: S.repostedIds.has(videoId)
      };
    }

    const nextReposted = Boolean(state.reposted);
    if (nextReposted) S.repostedIds.add(videoId);
    else S.repostedIds.delete(videoId);
    const meta = NET.videos.get(videoId);
    if (meta) meta.reposted = nextReposted;

    emitHud(true);
    return { ok: true, found: true, loginRequired: false, reposted: nextReposted };
  }

  function cancelStealthShare() {
    releaseClickTarget();
    if (!hasLoginModal()) closeShareDialogOnly();
    clearStealthShareModals();
    document.documentElement.classList.remove('ttf-stealth-share');
    return true;
  }

  /* ─── Парсинг 1-го ряда контактов из скрытого «Поделиться» + отправка ─── */

  const SHARE_PLATFORM_NAMES = /^(copy|копировать|whatsapp|вставка|embed|facebook|telegram|twitter|x|email|pinterest|reddit|linkedin|line|репост|repost|отправить друзьям|send to friends|поделиться|share|ещё|еще|more)$/i;

  function findShareContactElements() {
    markStealthShareModals();
    const modals = findShareModals();
    const results = [];
    const seen = new Set();

    for (const dlg of modals) {
      // 1) Контакты 1-го ряда в окне «Поделиться» (круглая аватарка <img> + имя снизу)
      const imgs = Array.from(dlg.querySelectorAll('img'));
      for (const img of imgs) {
        const src = img.currentSrc || img.src || '';
        if (!src) continue;
        // Поднимаемся к кликабельной плитке контакта
        let tile = img.parentElement;
        for (let depth = 0; depth < 5 && tile && tile !== dlg; depth++) {
          const txt = cleanText(tile);
          if (txt && txt.length >= 1 && txt.length <= 60) {
            break;
          }
          tile = tile.parentElement;
        }
        if (!tile || tile === dlg) continue;
        const name = cleanText(tile);
        if (!name || name.length > 56 || SHARE_PLATFORM_NAMES.test(name)) continue;

        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        results.push({
          id: key,
          name,
          handle: '',
          avatar: src,
          element: tile,
          source: 'share-row1'
        });
      }
    }

    return results;
  }

  function scrapeShareDialogContacts() {
    markStealthShareModals();
    const domContacts = findShareContactElements().map((c, idx) => ({
      id: c.id,
      name: c.name,
      handle: c.handle,
      avatar: c.avatar,
      domIndex: idx,
      source: c.source
    }));

    const seen = new Set(domContacts.map((c) => c.id));
    const apiContacts = Array.from(NET.contacts.values()).sort(
      (a, b) => (a.order ?? 999) - (b.order ?? 999)
    );
    for (const c of apiContacts) {
      const key = (c.handle || c.name || c.id).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      domContacts.push({
        id: c.id || key,
        name: c.name || c.handle || 'Пользователь',
        handle: c.handle || '',
        avatar: c.avatar || '',
        source: 'api'
      });
    }

    return {
      loginRequired: hasLoginModal(),
      dialogOpen: findShareModals().length > 0,
      contacts: domContacts
    };
  }

  async function sendVideoToContactsInDialog(targets, noteText) {
    markStealthShareModals();
    if (hasLoginModal()) return { ok: false, loginRequired: true };
    const modals = findShareModals();
    if (!modals.length) return { ok: false, reason: 'dialog_not_open' };

    const targetList = Array.isArray(targets) ? targets : [];
    if (!targetList.length) return { ok: false, reason: 'no_targets' };

    const tiles = findShareContactElements();
    let matched = 0;
    const unmatchedTargets = [];

    for (const target of targetList) {
      const wantName = String(target.name || '').trim().toLowerCase();
      const wantHandle = String(target.handle || '').replace(/^@/, '').trim().toLowerCase();
      const found = tiles.find((t) => {
        const tn = t.name.toLowerCase();
        return (wantName && (tn === wantName || tn.includes(wantName))) ||
          (wantHandle && tn.includes(wantHandle));
      });
      if (found && found.element) {
        try {
          found.element.click();
          matched++;
          await sleep(220);
        } catch {
          unmatchedTargets.push(target);
        }
      } else {
        unmatchedTargets.push(target);
      }
    }

    if (matched === 0) {
      return { ok: false, reason: 'not_in_quick_row', unmatchedTargets };
    }

    // Если после выбора контакта появилось поле подписи и кнопка «Отправить» (даём React до 3 попыток смонтировать блок)
    let clickedSend = false;
    for (let attempt = 0; attempt < 3 && !clickedSend; attempt++) {
      const activeModals = findShareModals();
      for (const dlg of activeModals) {
        if (noteText && String(noteText).trim()) {
          const noteInput = dlg.querySelector(
            'textarea, [contenteditable="true"], input[type="text"], input[placeholder*="сообщ" i], input[placeholder*="message" i]'
          );
          if (noteInput) {
            noteInput.focus();
            const text = String(noteText).trim();
            if (noteInput.tagName === 'TEXTAREA' || noteInput.tagName === 'INPUT') {
              const proto =
                noteInput.tagName === 'TEXTAREA'
                  ? HTMLTextAreaElement.prototype
                  : HTMLInputElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
              if (setter) setter.call(noteInput, text);
              else noteInput.value = text;
              noteInput.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
              try { document.execCommand('insertText', false, text); } catch {}
            }
            await sleep(160);
          }
        }

        const sendBtn = Array.from(dlg.querySelectorAll('button, div[role="button"]')).find((b) =>
          /^(отправить|send)(\s*\(\d+\))?$/i.test(cleanText(b))
        );
        if (sendBtn && !sendBtn.disabled) {
          sendBtn.click();
          clickedSend = true;
          await sleep(500);
          break;
        }
      }
      if (!clickedSend) await sleep(140);
    }

    await sleep(350);
    closeShareDialogOnly();
    clearStealthShareModals();
    document.documentElement.classList.remove('ttf-stealth-share');
    return { ok: true, sentCount: matched, unmatchedTargets };
  }

  /* ─── Вход по QR-коду (в 1 клик) ───────────────────────────────── */

  async function openQrLogin() {
    let loginModal = document.querySelector('#loginContainer, [class*="DivLoginContainer"]');
    if (!loginModal || !isElementVisible(loginModal)) {
      const loginBtn =
        document.querySelector('button[aria-label="Войти"]') ||
        document.querySelector('[data-e2e="top-login-button"]') ||
        Array.from(document.querySelectorAll('button')).find((b) =>
          /^(войти|log in)$/i.test(cleanText(b))
        );

      if (loginBtn) {
        loginBtn.click();
      } else {
        const likeEl = findLikeContainer(activeFeedItem());
        if (likeEl) (likeEl.querySelector('button') || likeEl).click();
      }

      for (let i = 0; i < 16; i++) {
        await sleep(160);
        loginModal = document.querySelector('#loginContainer, [class*="DivLoginContainer"]');
        if (loginModal && isElementVisible(loginModal)) break;
      }
    }

    for (let i = 0; i < 12; i++) {
      const items = Array.from(document.querySelectorAll('[data-e2e="channel-item"]'));
      const qrItem = items.find((el) => /qr/i.test(cleanText(el)));
      if (qrItem) {
        qrItem.click();
        return { ok: true, step: 'qr' };
      }
      await sleep(140);
    }

    return { ok: Boolean(loginModal), step: 'modal' };
  }

  /* ─── Комментарии + точные лайки + Фото / Гифки / Стикеры ──────── */

  function findCommentScrollBox() {
    const main = document.querySelector('[class*="DivCommentMain"]');
    if (main) return main;

    const sidebar = findCommentsSidebar();
    if (!sidebar) return null;
    for (const el of [sidebar, ...Array.from(sidebar.querySelectorAll('div'))]) {
      const st = getComputedStyle(el);
      if (
        (st.overflowY === 'auto' || st.overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + 10
      ) {
        return el;
      }
    }
    return sidebar;
  }

  function extractDomCardMedia(card) {
    const images = [];
    const seen = new Set();

    const thumbs = Array.from(
      card.querySelectorAll(
        '[data-e2e="comment-thumbnail"], img[src*="photomode"], img[src*="sticker"], img[src*="giphy"], [class*="CommentImage"] img, [class*="Sticker"] img'
      )
    );

    const contentWrap = card.querySelector('[class*="DivCommentContentWrapper"]') || card;
    for (const img of contentWrap.querySelectorAll('img')) {
      if (img.closest('[data-e2e*="avatar"], [class*="Avatar"]')) continue;
      const r = img.getBoundingClientRect();
      if (r.width >= 48 || r.height >= 48 || img.getAttribute('data-e2e') === 'comment-thumbnail') {
        thumbs.push(img);
      }
    }

    for (const img of thumbs) {
      const src = img.currentSrc || img.src || '';
      if (!src || seen.has(src)) continue;
      seen.add(src);
      const isGif = /\.gif|\.webp|giphy|sticker/i.test(src);
      images.push({ thumb: src, full: src, kind: isGif ? 'gif' : 'photo' });
    }

    return images;
  }

  function parseCountText(str) {
    if (!str) return 0;
    const cleaned = String(str).trim().replace(',', '.').toUpperCase();
    const num = parseFloat(cleaned);
    if (!Number.isFinite(num)) return 0;
    if (cleaned.endsWith('M') || cleaned.includes('МЛН')) return Math.round(num * 1000000);
    if (cleaned.endsWith('K') || cleaned.includes('ТЫС')) return Math.round(num * 1000);
    return Math.round(num);
  }

  function extractCommentLikeCountText(card, likeIconEl) {
    const direct = card.querySelector('[data-e2e="comment-like-count"]');
    if (direct) {
      const t = cleanText(direct);
      if (t) return t;
    }
    // В TikTok 2026 число лайков часто лежит в соседнем span внутри обёртки кнопки лайка
    const scope =
      (likeIconEl && likeIconEl.parentElement) ||
      card.querySelector('[class*="DivLikeContainer"], [class*="DivLikeWrapper"]');
    if (scope) {
      for (const node of scope.querySelectorAll('span, p, strong')) {
        const t = cleanText(node);
        if (/^\d[\d.,]*\s*[KMBkmb]?$/.test(t) || /^\d[\d.,]*\s*(?:тыс|млн)/i.test(t)) {
          return t;
        }
      }
      const aria = scope.getAttribute('aria-label') || (likeIconEl && likeIconEl.getAttribute('aria-label')) || '';
      const m = aria.match(/(\d[\d.,]*\s*[KMBkmb]?)/);
      if (m) return m[1];
    }
    return '';
  }

  function commentFingerprint(authorName, authorHandle, text, images, sticker) {
    const auth = String(authorHandle || authorName || '')
      .toLowerCase()
      .replace(/^@/, '')
      .replace(/\s+/g, ' ')
      .trim();
    const txt = String(text || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 72);
    const mediaTag =
      (Array.isArray(images) && images[0] && images[0].thumb ? images[0].thumb.slice(-24) : '') ||
      (sticker && sticker.thumb ? sticker.thumb.slice(-24) : '');
    return auth + '|' + txt + '|' + mediaTag;
  }

  function getDomCommentBucket(videoId) {
    const key = String(videoId || 'default');
    let bucket = S.domCommentsByVideo.get(key);
    if (!bucket) {
      bucket = new Map();
      S.domCommentsByVideo.set(key, bucket);
      if (S.domCommentsByVideo.size > 16) {
        const oldest = S.domCommentsByVideo.keys().next().value;
        if (oldest && oldest !== key) S.domCommentsByVideo.delete(oldest);
      }
    }
    return bucket;
  }

  function scrapeDomComments(videoId) {
    const container = findCommentsSidebar();
    if (!container) return { items: [], skeletons: 0 };

    const wrappers = Array.from(
      container.querySelectorAll(
        '[class*="DivCommentObjectWrapper"], [class*="DivCommentItemContainer"]'
      )
    );

    let skeletons = 0;
    const visibleItems = [];
    const bucket = getDomCommentBucket(videoId);

    wrappers.forEach((card, idx) => {
      const userEl =
        card.querySelector('[data-e2e="comment-username-1"]') ||
        card.querySelector('a[href*="/@"]');
      const textEl = card.querySelector('[data-e2e="comment-level-1"]');
      const media = extractDomCardMedia(card);

      const authorName = cleanText(userEl);
      const text = cleanText(textEl);

      if (!authorName && !text && media.length === 0) {
        skeletons++;
        return;
      }

      const avatarEl =
        card.querySelector('[data-e2e="comment-avatar-1"] img') ||
        card.querySelector('[class*="Avatar"] img') ||
        card.querySelector('a[href*="/@"] img');
      const timeEl = card.querySelector('[data-e2e="comment-time-1"]');
      const likeIconEl = card.querySelector('[data-e2e="comment-like-icon"]');
      const diggText = extractCommentLikeCountText(card, likeIconEl);
      const viewMoreEl = findRepliesExpandButton(card);

      let authorHandle = '';
      if (userEl) {
        const link = userEl.tagName === 'A' ? userEl : userEl.querySelector('a[href*="/@"]');
        const href = link ? link.getAttribute('href') || '' : '';
        const m = href.match(/\/@([^/?#]+)/);
        if (m) authorHandle = m[1];
      }

      const replyEls = Array.from(card.querySelectorAll('[data-e2e="comment-level-2"]'));
      const replies = replyEls.map((rTextEl, rIdx) => {
        const rCard =
          rTextEl.closest('[class*="DivCommentContentWrapper"], [class*="DivReplyItem"]') ||
          rTextEl.parentElement;
        const rUser = rCard && rCard.querySelector('[data-e2e="comment-username-2"]');
        const rAvatar =
          rCard && rCard.querySelector('[data-e2e="comment-avatar-2"] img, [class*="Avatar"] img');
        const rTime = rCard && rCard.querySelector('[data-e2e="comment-time-2"]');
        const rMedia = rCard ? extractDomCardMedia(rCard) : [];
        const rAuth = cleanText(rUser) || 'Пользователь';
        const rTxt = cleanText(rTextEl);
        return {
          cid: 'dom_r_' + commentFingerprint(rAuth, '', rTxt, rMedia, null) + '_' + rIdx,
          authorName: rAuth,
          authorHandle: '',
          avatar: rAvatar && rAvatar.src ? rAvatar.src : '',
          text: rTxt,
          images: rMedia,
          timeText: cleanText(rTime),
          diggCount: 0,
          userDigged: false
        };
      });

      const moreMatch = cleanText(viewMoreEl).match(/(\d+)/);
      const replyCount = moreMatch ? Number(moreMatch[1]) : replies.length;

      // Стабильный ключ БЕЗ индекса виртуализации — при скролле старые комменты не теряются и не дублируются
      const fp = commentFingerprint(authorName, authorHandle, text, media, null);
      const stableCid = 'dom_' + fp;

      const parsedItem = {
        cid: stableCid,
        domIndex: idx,
        authorName: authorName || 'Пользователь',
        authorHandle,
        avatar: avatarEl && avatarEl.src ? avatarEl.src : '',
        text,
        images: media,
        sticker: null,
        timeText: cleanText(timeEl),
        createTime: 0,
        diggText,
        diggCount: parseCountText(diggText),
        userDigged: isLikedDom(likeIconEl),
        replyCount,
        replies,
        hasMoreReplies: Boolean(viewMoreEl),
        isAuthorDigged: Boolean(card.querySelector('[data-e2e="comment-author-liked"]')),
        labelText: /автор|creator/i.test(cleanText(card.querySelector('[class*="Creator"]')))
          ? 'Автор'
          : '',
        source: 'dom'
      };

      const prev = bucket.get(stableCid);
      if (prev) {
        bucket.set(stableCid, {
          ...prev,
          ...parsedItem,
          avatar: parsedItem.avatar || prev.avatar,
          images: parsedItem.images.length ? parsedItem.images : prev.images,
          diggCount: parsedItem.diggCount || prev.diggCount,
          diggText: parsedItem.diggText || prev.diggText,
          replies: parsedItem.replies.length >= prev.replies.length ? parsedItem.replies : prev.replies
        });
      } else {
        bucket.set(stableCid, parsedItem);
      }

      visibleItems.push(bucket.get(stableCid));
    });

    return {
      items: Array.from(bucket.values()),
      visibleItems,
      skeletons
    };
  }

  function findCommentInput() {
    return (
      document.querySelector('[data-e2e="comment-input"] [contenteditable="true"]') ||
      document.querySelector('[data-e2e="comment-input"] [role="textbox"]') ||
      document.querySelector('[class*="DivInputEditorContainer"] [contenteditable="true"]') ||
      document.querySelector('[class*="CommentInput"] [contenteditable="true"]') ||
      document.querySelector('aside[class*="AsideOneColumnSidebar"] [contenteditable="true"]') ||
      document.querySelector('[data-e2e="comment-input"] textarea') ||
      document.querySelector('[data-e2e="comment-input"] input') ||
      null
    );
  }

  function buildCommentsPayload() {
    const item = activeFeedItem();
    const video = activeVideo();
    const videoId = extractVideoId(item, video);
    const meta = NET.videos.get(videoId) || {};

    const authorHandle = extractAuthorHandle(item) || meta.authorHandle || '';
    const authorName = extractAuthorName(item) || meta.authorName || authorHandle || 'TikTok';
    const desc = extractDescription(item) || meta.desc || '';

    const commentCountEl = queryActive(item, [
      '[data-e2e="comment-count"]',
      '[data-e2e="browse-comment-count"]'
    ]);
    const domCountText = cleanText(commentCountEl);

    const isNumericId = /^\d{12,}$/.test(videoId);
    const apiBucket =
      NET.commentsByVideo.get(videoId) ||
      (!isNumericId && NET.lastAwemeId ? NET.commentsByVideo.get(NET.lastAwemeId) : null) ||
      null;

    const domResult = scrapeDomComments(videoId);
    const domList = domResult.items;

    let merged = [];
    if (apiBucket && apiBucket.items.length) {
      const domByFp = new Map();
      for (const d of domList) {
        domByFp.set(commentFingerprint(d.authorName, d.authorHandle, d.text, d.images, d.sticker), d);
        if (d.text) domByFp.set('txt:' + d.text.toLowerCase().trim(), d);
      }

      const matchedDomCids = new Set();
      merged = apiBucket.items.map((c, idx) => {
        const replies = NET.repliesByComment.get(c.cid) || [];
        const fp = commentFingerprint(c.authorName, c.authorHandle, c.text, c.images, c.sticker);
        const domMatch =
          domByFp.get(fp) ||
          (c.text ? domByFp.get('txt:' + c.text.toLowerCase().trim()) : null) ||
          domList.find((d) => c.authorName && d.authorName === c.authorName && idx === d.domIndex);
        if (domMatch) matchedDomCids.add(domMatch.cid);

        const images =
          c.images && c.images.length
            ? c.images
            : domMatch && domMatch.images
              ? domMatch.images
              : [];
        const diggCount =
          Number(c.diggCount) > 0
            ? Number(c.diggCount)
            : domMatch
              ? Number(domMatch.diggCount || 0)
              : 0;
        const diggText =
          (domMatch && domMatch.diggText) || (diggCount > 0 ? formatCompact(diggCount) : '');
        const userDigged = domMatch ? Boolean(domMatch.userDigged || c.userDigged) : Boolean(c.userDigged);
        return {
          ...c,
          diggCount,
          diggText,
          userDigged,
          images,
          domIndex: domMatch ? domMatch.domIndex : idx,
          replies: replies.length ? replies : domMatch ? domMatch.replies : [],
          hasMoreReplies:
            c.replyCount > replies.length || (domMatch ? domMatch.hasMoreReplies : false)
        };
      });

      // Добавляем оставшиеся накопленные DOM-комментарии строго в конец (не удаляя и не ломая порядок)
      for (const domItem of domList) {
        if (matchedDomCids.has(domItem.cid)) continue;
        const exists = merged.some(
          (m) =>
            m.authorName === domItem.authorName &&
            m.text === domItem.text &&
            (m.images?.length || 0) === (domItem.images?.length || 0)
        );
        if (!exists) merged.push(domItem);
      }
    } else {
      merged = domList;
    }

    if (merged.length > 0) {
      S.commentsLoading = false;
    }

    const total =
      (apiBucket && apiBucket.total) ||
      parseCountText(domCountText) ||
      meta.comments ||
      merged.length;
    const totalText = domCountText || formatCompact(total) || String(total || 0);

    const hasInput = Boolean(findCommentInput());
    const loginBar = Boolean(document.querySelector('[data-e2e="comment-login-bar"]'));
    const loggedIn = hasInput ? true : loginBar ? false : isLoggedInHeuristic();

    const stillLoading =
      merged.length === 0 && (S.commentsLoading || domResult.skeletons > 0);

    return {
      videoId,
      videoUrl: getCurrentVideoUrl(),
      authorHandle,
      authorName,
      desc,
      total,
      totalText,
      hasMore: Boolean(
        (apiBucket && apiBucket.hasMore) || (total > merged.length && merged.length > 0)
      ),
      loading: stillLoading,
      loggedIn,
      canComment: hasInput,
      sidebarOpen: isCommentsSidebarOpen(),
      comments: merged
    };
  }

  function emitComments(force) {
    if (!S.commentsOpen && !force) return;
    const payload = buildCommentsPayload();
    const hash = JSON.stringify({
      v: payload.videoId,
      l: payload.loading,
      c: payload.comments.length,
      t: payload.totalText,
      m: payload.hasMore,
      g: payload.canComment,
      f: payload.comments.map(
        (x) =>
          x.cid +
          ':' +
          (x.diggCount || 0) +
          ':' +
          (x.diggText || '') +
          ':' +
          (x.userDigged ? 1 : 0) +
          ':' +
          (x.images ? x.images.length : 0) +
          ':' +
          (x.replies ? x.replies.length : 0)
      )
    });
    if (!force && hash === S.lastCommentsHash) return;
    S.lastCommentsHash = hash;
    bridgeEmit('comments', payload);
  }

  function getComments(finalize) {
    if (finalize === true) {
      S.commentsLoading = false;
    }
    return buildCommentsPayload();
  }

  function setCommentsTracking(open) {
    S.commentsOpen = Boolean(open);
    if (!open) S.commentsLoading = false;
    return true;
  }

  async function loadMoreComments() {
    const item = activeFeedItem();
    const video = activeVideo();
    const videoId = extractVideoId(item, video);
    const beforeCount = buildCommentsPayload().comments.length;

    const box = findCommentScrollBox();
    if (box) {
      // Шаговая прокрутка: виртуализированный список TikTok не пропускает промежуточные элементы,
      // а наш аккумулятор S.domCommentsByVideo сохраняет каждую страницу, не удаляя прошлые!
      const step = Math.max(360, Math.round((box.clientHeight || 500) * 0.85));
      for (let s = 0; s < 3; s++) {
        const targetTop = Math.min(box.scrollHeight, box.scrollTop + step);
        box.scrollTop = targetTop;
        box.dispatchEvent(new Event('scroll', { bubbles: true }));
        box.dispatchEvent(
          new WheelEvent('wheel', { deltaY: 520, bubbles: true, cancelable: true })
        );
        await sleep(220);
        scrapeDomComments(videoId);
        if (targetTop >= box.scrollHeight - 8) break;
      }

      // Дожимаем в самый низ, чтобы сработал триггер догрузки следующей страницы API
      box.scrollTop = box.scrollHeight;
      box.dispatchEvent(new Event('scroll', { bubbles: true }));
      box.dispatchEvent(
        new WheelEvent('wheel', { deltaY: 800, bubbles: true, cancelable: true })
      );
    }

    for (let i = 0; i < 7; i++) {
      await sleep(180);
      const next = buildCommentsPayload();
      if (next.comments.length > beforeCount) {
        emitComments(true);
        return next;
      }
    }

    emitComments(true);
    return buildCommentsPayload();
  }

  async function fillCommentEditor(rawText) {
    const text = String(rawText || '').trim();
    if (!text) return { ok: false, reason: 'empty' };

    let editor = findCommentInput();
    if (!editor) {
      await sleep(300);
      editor = findCommentInput();
    }
    if (!editor) {
      return { ok: false, loginRequired: true };
    }

    try {
      editor.focus();
      editor.click();
      await sleep(90);

      if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
        const proto =
          editor.tagName === 'TEXTAREA'
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(editor, text);
        else editor.value = text;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        selection.removeAllRanges();
        selection.addRange(range);
        try { document.execCommand('delete', false); } catch {}

        let inserted = false;
        try { inserted = document.execCommand('insertText', false, text); } catch {}

        if (!inserted || !cleanText(editor).includes(text.slice(0, 6))) {
          try {
            const dt = new DataTransfer();
            dt.setData('text/plain', text);
            editor.dispatchEvent(
              new ClipboardEvent('paste', {
                clipboardData: dt,
                bubbles: true,
                cancelable: true
              })
            );
          } catch {
            editor.textContent = text;
            editor.dispatchEvent(
              new InputEvent('input', {
                bubbles: true,
                inputType: 'insertText',
                data: text
              })
            );
          }
        }
      }

      await sleep(160);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: String(err) };
    }
  }

  /* ─── Навигация, воспроизведение, скорость 0.5x–2x и история просмотров ─── */

  function feed() {
    return document.querySelector('#column-list-container');
  }

  function navSnapshot() {
    const item = activeFeedItem();
    const video = activeVideo();
    const scroller = feed();
    return {
      videoId: extractVideoId(item, video),
      scrollTop: scroller ? Math.round(scroller.scrollTop) : 0
    };
  }

  function scrollFeed(direction) {
    const element = feed();
    if (!element) return false;
    const step = element.clientHeight || window.innerHeight;
    try {
      element.scrollBy({ top: direction * step, behavior: 'smooth' });
    } catch {
      element.scrollTop += direction * step;
    }
    return true;
  }

  function itemNavigation(direction) {
    const items = Array.from(
      document.querySelectorAll('[data-e2e="recommend-list-item-container"]')
    );
    if (!items.length) return false;

    const current = activeFeedItem();
    let index = current ? items.indexOf(current) : -1;
    if (index < 0) {
      index = items.findIndex((item) => {
        const rect = item.getBoundingClientRect();
        return rect.top >= -10 && rect.top < window.innerHeight * 0.5;
      });
    }

    const target = items[index + direction];
    if (!target) return false;

    try {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      target.scrollIntoView();
    }
    return true;
  }

  function wheelFeed(direction) {
    try {
      const target =
        feed() ||
        document.elementFromPoint(
          window.innerWidth / 2,
          window.innerHeight / 2
        ) ||
        document.body;
      target.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: direction * window.innerHeight,
          deltaMode: 0,
          bubbles: true,
          cancelable: true,
          view: window
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  async function go(direction) {
    const step = direction >= 0 ? 1 : -1;
    const now = Date.now();
    if (now < S.navLockUntil) return 'busy';
    S.navLockUntil = now + 680;

    S.trackedMaxTime = 0;
    S.photoStartAt = Date.now();

    const selector =
      step > 0
        ? '[data-e2e="feed-navigation-next"]'
        : '[data-e2e="feed-navigation-prev"]';
    const button = document.querySelector(selector);
    const scroller = feed();
    const before = scroller ? scroller.scrollTop : 0;
    let method = 'none';

    if (button) {
      button.click();
      method = 'button';
    } else if (itemNavigation(step)) {
      method = 'item';
    } else if (scrollFeed(step)) {
      method = 'scroll';
    } else if (wheelFeed(step)) {
      method = 'wheel';
    }

    if (method === 'button') {
      await sleep(480);
      const after = feed();
      if (after && Math.abs(after.scrollTop - before) < 6) {
        if (!itemNavigation(step) && !scrollFeed(step)) wheelFeed(step);
        method = 'button+fallback';
      }
    }

    setTimeout(() => {
      applyMuted();
      applyPlaybackRate();
      emitHud(true);
      if (S.commentsOpen) emitComments(false);
    }, 450);
    setTimeout(() => {
      applyMuted();
      applyPlaybackRate();
      emitHud(true);
      if (S.commentsOpen) emitComments(false);
    }, 1150);

    return method;
  }

  function isPlaying() {
    const video = activeVideo();
    return Boolean(video && !video.paused);
  }

  function setPaused(shouldPause) {
    const video = activeVideo();
    if (!video) return false;
    try {
      if (shouldPause) video.pause();
      else {
        const p = video.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
      return true;
    } catch {
      return false;
    }
  }

  async function togglePlay() {
    const video = activeVideo();
    const item = activeFeedItem();
    const button = queryActive(item, ['[data-e2e="anchoring-playback-control-play"]']);

    if (video) {
      if (video.paused) {
        const promise = video.play();
        if (promise && typeof promise.catch === 'function') {
          promise.catch(() => {
            if (button) button.click();
          });
        }
      } else {
        video.pause();
      }
    } else if (button) {
      button.click();
    }

    await sleep(110);
    applyPlaybackRate();
    emitHud(true);
    return isPlaying();
  }

  function seekTo(ratio) {
    const video = activeVideo();
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      return false;
    }
    S.isScrubbing = true;
    video.currentTime = clamp(Number(ratio) || 0, 0, 1) * video.duration;
    S.trackedMaxTime = video.currentTime;
    setTimeout(() => {
      S.isScrubbing = false;
    }, 300);
    emitHud(true);
    return true;
  }

  function applyVolume() {
    const vol = clamp(Number(S.volume), 0, 1);
    const shouldMute = S.muted || vol <= 0.001;
    for (const video of allVideos()) {
      if (Math.abs(video.volume - vol) > 0.015) {
        try { video.volume = vol; } catch {}
      }
      if (video.muted !== shouldMute) {
        video.muted = shouldMute;
      }
    }
  }

  function applyMuted() {
    applyVolume();
  }

  function setMuted(value) {
    S.muted = Boolean(value);
    applyVolume();
    emitHud(true);
  }

  function setVolume(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return S.volume;
    S.volume = clamp(Math.round(num * 100) / 100, 0, 1);
    applyVolume();
    emitHud(true);
    return S.volume;
  }

  function applyPlaybackRate() {
    const rate = clamp(Number(S.playbackRate) || 1, 0.5, 2.5);
    for (const video of allVideos()) {
      if (Math.abs(video.playbackRate - rate) > 0.01) {
        video.playbackRate = rate;
      }
    }
  }

  function setPlaybackRate(rate) {
    const num = Number(rate);
    if (!Number.isFinite(num)) return S.playbackRate;
    S.playbackRate = clamp(num, 0.5, 2.5);
    applyPlaybackRate();
    emitHud(true);
    return S.playbackRate;
  }

  /* ─── HUD и Автопросмотр ───────────────────────────────────────── */

  function collectHud() {
    const item = activeFeedItem();
    const video = activeVideo();
    const videoId = extractVideoId(item, video);
    const meta = NET.videos.get(videoId) || {};

    if (S.commentsOpen && videoId && S.currentVideoId && videoId !== S.currentVideoId) {
      S.currentVideoId = videoId;
      S.commentsLoading = true;
      S.lastCommentsHash = '';
      setTimeout(() => emitComments(true), 80);
    }

    const authorHandle = extractAuthorHandle(item) || meta.authorHandle || '';
    const authorName = extractAuthorName(item) || meta.authorName || authorHandle || 'TikTok';
    const avatar = extractAvatar(item) || meta.avatar || '';
    const desc = extractDescription(item) || meta.desc || '';
    const music =
      extractMusic(item) ||
      (meta.musicTitle
        ? meta.musicTitle + (meta.musicAuthor ? ' · ' + meta.musicAuthor : '')
        : '');

    const likeContainer = findLikeContainer(item);
    let liked = likeContainer ? isLikedDom(likeContainer) : Boolean(meta.liked);
    const override = S.likedOverrides.get(videoId);
    if (override) {
      if (Date.now() < override.until) {
        liked = override.liked;
      } else {
        S.likedOverrides.delete(videoId);
      }
    }

    const likesEl = queryActive(item, ['[data-e2e="like-count"]', '[data-e2e="browse-like-count"]']);
    const likesText = cleanText(likesEl) || formatCompact(meta.likes) || '';

    const commentsEl = queryActive(item, [
      '[data-e2e="comment-count"]',
      '[data-e2e="browse-comment-count"]'
    ]);
    const commentsText = cleanText(commentsEl) || formatCompact(meta.comments) || '';

    const isNumericId = /^\d{12,}$/.test(String(videoId));
    const reposted =
      S.repostedIds.has(videoId) ||
      (isNumericId && Boolean(meta.reposted));
    const currentTime = video && Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const duration = video && Number.isFinite(video.duration) ? video.duration : 0;

    return {
      ok: true,
      videoId,
      videoUrl: getCurrentVideoUrl(),
      authorHandle,
      authorName,
      avatar,
      desc,
      music,
      likesText,
      liked,
      commentsText,
      reposted,
      playing: video ? !video.paused : false,
      currentTime,
      duration,
      muted: S.muted,
      volume: S.volume,
      playbackRate: S.playbackRate,
      auto: S.auto,
      mode: S.mode,
      seconds: S.seconds,
      interactiveModal: hasInteractiveModal(),
      loggedIn: isLoggedInHeuristic(),
      unreadMessages: detectUnreadMessages(),
      isSingleVideoPage: /\/(?:video|photo)\/\d+/.test(location.pathname),
      videos: allVideos().length,
      href: location.href
    };
  }

  function emitHud(force) {
    const hud = collectHud();
    const key = [
      hud.videoId,
      hud.authorHandle,
      hud.authorName,
      hud.likesText,
      hud.liked,
      hud.commentsText,
      hud.reposted,
      hud.playing,
      Math.round(hud.currentTime * 4),
      Math.round(hud.duration),
      hud.playbackRate,
      hud.interactiveModal,
      hud.loggedIn,
      hud.unreadMessages
    ].join('|');

    if (!force && key === S.lastHudKey) return;
    S.lastHudKey = key;
    bridgeEmit('hud', hud);
  }

  function stopTimer() {
    if (S.timer) {
      clearInterval(S.timer);
      S.timer = null;
    }
  }

  function startTimer() {
    stopTimer();
    S.trackedMaxTime = 0;
    S.photoStartAt = Date.now();
    if (!S.auto || S.mode !== 'interval') return;

    const delayMs = clamp(S.seconds, 3, 120) * 1000;
    S.timer = setInterval(() => {
      if (S.auto && S.mode === 'interval') {
        bridgeEmit('auto-next', { reason: 'interval' });
      }
    }, delayMs);
  }

  function triggerAutoEndSkip() {
    const now = Date.now();
    if (now < S.trackedSkipLockUntil) return;
    S.trackedSkipLockUntil = now + 2200;
    S.trackedMaxTime = 0;
    S.photoStartAt = now;
    bridgeEmit('auto-next', { reason: 'end' });
  }

  function checkAutoEndTick() {
    if (!S.auto || S.mode !== 'end' || S.isScrubbing) return;
    if (hasInteractiveModal()) return;

    const item = activeFeedItem();
    const video = activeVideo();
    const itemKey = extractVideoId(item, video);

    if (itemKey !== S.trackedItemKey) {
      S.trackedItemKey = itemKey;
      S.trackedVideo = video;
      S.trackedMaxTime = 0;
      S.photoStartAt = Date.now();
      return;
    }

    if (video && Number.isFinite(video.duration) && video.duration > 1.2) {
      if (video !== S.trackedVideo) {
        S.trackedVideo = video;
        S.trackedMaxTime = 0;
      }
      if (video.paused) return;

      const cur = video.currentTime;
      const dur = video.duration;

      if (S.trackedMaxTime >= dur - 1.2 && cur < 0.8 && S.trackedMaxTime > 1.0) {
        triggerAutoEndSkip();
        return;
      }
      if (cur > S.trackedMaxTime) S.trackedMaxTime = cur;
      if (dur - cur <= 0.35 && S.trackedMaxTime > 0.8) {
        triggerAutoEndSkip();
      }
      return;
    }

    if (S.photoStartAt && Date.now() - S.photoStartAt >= clamp(S.seconds, 3, 60) * 1000) {
      triggerAutoEndSkip();
    }
  }

  function onMediaEvent(event) {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement)) return;

    updateVideoAspectClass(video);
    const targetVol = clamp(Number(S.volume), 0, 1);
    const shouldMute = S.muted || targetVol <= 0.001;
    if (Math.abs(video.volume - targetVol) > 0.015) {
      try { video.volume = targetVol; } catch {}
    }
    if (video.muted !== shouldMute) {
      video.muted = shouldMute;
    }
    if (Math.abs(video.playbackRate - S.playbackRate) > 0.01) {
      video.playbackRate = S.playbackRate;
    }
    if (event.type === 'volumechange') return;

    if (
      event.type === 'play' ||
      event.type === 'playing' ||
      event.type === 'pause' ||
      event.type === 'loadedmetadata'
    ) {
      emitHud(true);
      if (S.commentsOpen) emitComments(false);
      return;
    }

    if (event.type === 'ended') {
      if (S.auto && S.mode === 'end' && video === activeVideo()) {
        triggerAutoEndSkip();
      }
      return;
    }

    if (event.type === 'timeupdate') {
      emitHud(false);
      if (S.auto && S.mode === 'end' && video === activeVideo()) {
        checkAutoEndTick();
      }
    }
  }

  function status() {
    return collectHud();
  }

  function configure(config) {
    if (config && typeof config === 'object') {
      if (typeof config.auto === 'boolean') S.auto = config.auto;
      if (config.mode === 'end' || config.mode === 'interval') S.mode = config.mode;
      if (config.seconds != null) {
        const seconds = Number(config.seconds);
        if (Number.isFinite(seconds)) S.seconds = clamp(seconds, 3, 120);
      }
      if (typeof config.muted === 'boolean') S.muted = config.muted;
      if (config.volume != null) {
        const vol = Number(config.volume);
        if (Number.isFinite(vol)) S.volume = clamp(Math.round(vol * 100) / 100, 0, 1);
      }
      if (config.playbackRate != null) setPlaybackRate(config.playbackRate);
    }

    startTimer();
    applyVolume();
    applyPlaybackRate();
    emitHud(true);
    return status();
  }

  NET.listeners.push((kind) => {
    if (kind === 'comments' || kind === 'replies' || kind === 'comment-published') {
      S.commentsLoading = false;
      emitComments(false);
    }
    if (kind === 'feed' || kind === 'digg' || kind === 'repost') {
      emitHud(true);
    }
    if (kind === 'contacts') {
      bridgeEmit('contacts', Array.from(NET.contacts.values()));
    }
  });

  window.addEventListener('timeupdate', onMediaEvent, true);
  window.addEventListener('ended', onMediaEvent, true);
  window.addEventListener('play', onMediaEvent, true);
  window.addEventListener('playing', onMediaEvent, true);
  window.addEventListener('pause', onMediaEvent, true);
  window.addEventListener('loadedmetadata', onMediaEvent, true);
  window.addEventListener('ratechange', onMediaEvent, true);
  window.addEventListener('volumechange', onMediaEvent, true);

  setInterval(checkAutoEndTick, 220);

  setInterval(() => {
    applyVolume();
    applyPlaybackRate();
    markStealthShareModals();
    emitHud(false);
    if (S.commentsOpen) emitComments(false);
  }, 600);

  if (typeof MutationObserver !== 'undefined') {
    let mutTimer = null;
    S.domObserver = new MutationObserver(() => {
      markStealthShareModals();
      if (mutTimer) return;
      mutTimer = setTimeout(() => {
        mutTimer = null;
        emitHud(false);
        if (S.commentsOpen) emitComments(false);
      }, 420);
    });
    if (document.body) {
      S.domObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  window[KEY] = {
    version: 10,
    configure,
    status,
    togglePlay,
    setPaused,
    seekTo,
    setMuted,
    setVolume,
    setPlaybackRate,
    navSnapshot,
    getCurrentVideoUrl,
    prepareClickTarget,
    directClickPinned,
    releaseClickTarget,
    verifyLikeResult,
    checkRepostProgress,
    finishRepost,
    cancelStealthShare,
    scrapeShareDialogContacts,
    sendVideoToContactsInDialog,
    openQrLogin,
    isCommentsSidebarOpen,
    setCommentsTracking,
    getComments,
    loadMoreComments,
    fillCommentEditor,
    next: (direction) => go(direction > 0 ? 1 : -1)
  };

  applyMuted();
  applyPlaybackRate();
  emitHud(true);
  return status();
}

window.TTF_INJECT = {
  controller: '(' + tiktokFloatPageController.toString() + ')();',
  css: `
    /* ─── Полное удаление веб-интерфейса TikTok 2026: остаётся только видео ─── */

    html, body {
      background: #0c0c0e !important;
      overflow: hidden !important;
      scrollbar-width: none !important;
    }

    html::-webkit-scrollbar,
    body::-webkit-scrollbar,
    *::-webkit-scrollbar {
      width: 0 !important;
      height: 0 !important;
      display: none !important;
    }

    [class*="DivSideNav"],
    [class*="SideNavContainer"],
    [class*="SideNavPlaceholder"],
    [class*="DivMainNav"],
    [class*="DivHeaderContainer"],
    #app-header,
    [data-e2e="top-login-button"],
    [class*="DivGetApp"],
    [class*="GetApp"],
    [class*="DivPromotion"],
    [class*="DivFloatApp"],
    [class*="DownloadApp"],
    [class*="DivTopNav"],
    [class*="DivFloatingAction"] {
      display: none !important;
    }

    [class*="DivFeedNavigation"],
    [data-e2e="anchoring-scroll-controls"],
    [class*="DivAnchoringScrollControls"],
    [data-e2e="feed-navigation-next"],
    [data-e2e="feed-navigation-prev"] {
      opacity: 0 !important;
      pointer-events: none !important;
    }

    #app,
    [class*="DivBodyContainer"],
    [class*="DivMainContainer"],
    [data-e2e="anchoring-player-column"],
    #column-list-container,
    [data-e2e="recommend-list-item-container"],
    [data-e2e="feed-video"],
    [class*="SectionMediaCardContainer"],
    [class*="DivItemContainerV2"],
    [class*="DivMediaCardWrapper"],
    [class*="DivVideoWrapper"],
    [class*="DivPlayerContainer"],
    [class*="DivVideoPlayerContainer"],
    [class*="DivBasicPlayerWrapper"] {
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      border-radius: 0 !important;
      background: #0c0c0e !important;
    }

    [data-e2e="recommend-list-item-container"],
    [data-e2e="feed-video"],
    [class*="SectionMediaCardContainer"] {
      height: 100vh !important;
      min-height: 100vh !important;
      scroll-snap-align: start !important;
    }

    [data-e2e="recommend-list-item-container"] video,
    [data-e2e="browse-video"] video,
    [class*="DivBasicPlayerWrapper"] video {
      width: 100% !important;
      height: 100% !important;
      object-fit: cover !important;
      border-radius: 0 !important;
    }

    video.ttf-landscape {
      object-fit: contain !important;
    }

    [data-e2e="anchoring-chrome-host"],
    [class*="DivChromeHost"],
    [class*="DivItemChromeLayer"],
    [class*="DivChromeWheelRoot"],
    [data-e2e="anchoring-engagement-vertical"],
    [class*="DivVerticalEngagement"],
    [data-e2e="anchoring-description-layer"],
    [class*="DivDescriptionLayer"],
    [class*="DivDescriptionContent"],
    [data-e2e="cinema-creator-identity"],
    [class*="DivCreatorIdentity"],
    [class*="DivCreatorFollow"],
    [data-e2e="cinema-video-info-follow"],
    [data-e2e="anchoring-playback-chrome"],
    [class*="DivPlaybackChrome"],
    [class*="DivControlsRow"],
    [class*="DivControlsGroup"],
    [data-e2e="anchoring-progress-bar"],
    [class*="DivProgressBar"],
    [data-e2e="anchoring-playback-time"],
    [data-e2e="cinema-playback-control-speed"],
    [data-e2e="cinema-playback-control-captions"],
    [data-e2e="cinema-playback-control-volume"],
    [data-e2e="more-menu-icon"],
    [data-e2e="aigc-tag"],
    [data-e2e="effect-house-tag"],
    [class*="TagChipContainer"],
    [class*="DivMediaCardOverlay"],
    [data-e2e="anchoring-ambient"],
    [class*="DivExtractedGradient"],
    [class*="ActionBarContainer"],
    [class*="SectionActionBarContainer"],
    [class*="DivActionItemContainer"],
    [class*="DivMediaCardBottom"],
    [class*="DivMediaCardTop"],
    [class*="DivVideoInfoContainer"],
    [class*="DivDescriptionContentContainer"],
    [class*="DivBottomContainer"],
    [class*="DivVideoControlContainer"],
    [class*="DivPlayerControls"],
    [class*="DivSeekBarContainer"],
    [class*="DivVoiceControlContainer"],
    [class*="DivAudioControlContainer"],
    [class*="DivPlayIconContainer"],
    [class*="DivAuthorContainer"] {
      opacity: 0 !important;
      pointer-events: none !important;
    }

    aside[class*="AsideOneColumnSidebar"],
    [class*="DivCommentSidebarTransitionWrapper"],
    section[class*="SectionCommentSidebarContainer"],
    [class*="DivCommentSideBar"],
    [class*="DivCommentSidebar"],
    [class*="CommentSideBar"],
    [class*="DivCommentContainer"] {
      position: fixed !important;
      top: 0 !important;
      right: 0 !important;
      width: 340px !important;
      height: 100vh !important;
      max-height: 100vh !important;
      opacity: 0.001 !important;
      pointer-events: none !important;
      z-index: -1 !important;
    }

    /* 100% невидимое скрытие любых порталов и подложек «Поделиться» TikTok (:where = 0 специфичности, чтобы .ttf-click-ancestor всегда побеждал!) */
    html.ttf-stealth-share :where(
      [role="dialog"],
      [aria-modal="true"],
      [class*="TUXModal"],
      [class*="TUXModalOverlay"],
      [class*="DivShareActions"],
      [class*="DivShareModal"],
      [class*="SharePopup"],
      [data-e2e="share-popup"],
      [data-e2e="more-menu-popover"],
      [class*="TUXTooltip"]
    ):where(:not(:has(#loginContainer)):not(:has([id*="captcha"])):not(.ttf-click-ancestor)),
    :where(.ttf-hidden-share-portal:not(.ttf-click-ancestor)) {
      opacity: 0 !important;
      pointer-events: none !important;
    }

    html .ttf-click-ancestor.ttf-click-ancestor {
      opacity: 0.001 !important;
      pointer-events: auto !important;
      visibility: visible !important;
      z-index: 2147483645 !important;
    }

    html .ttf-click-rel.ttf-click-rel {
      position: relative !important;
    }

    html .ttf-click-no-transform.ttf-click-no-transform {
      transform: none !important;
      filter: none !important;
      backdrop-filter: none !important;
      will-change: auto !important;
      contain: none !important;
    }

    html .ttf-click-inline.ttf-click-inline {
      opacity: 0.001 !important;
      pointer-events: auto !important;
      visibility: visible !important;
      z-index: 2147483647 !important;
    }

    html .ttf-click-target.ttf-click-target {
      position: fixed !important;
      left: 50% !important;
      top: 50% !important;
      width: 88px !important;
      height: 112px !important;
      max-width: 88px !important;
      max-height: 112px !important;
      transform: translate(-50%, -50%) !important;
      opacity: 0.001 !important;
      pointer-events: auto !important;
      visibility: visible !important;
      z-index: 2147483647 !important;
    }

    [id*="captcha"],
    [class*="captcha" i],
    #tiktok-verify-ele,
    #loginContainer,
    [class*="DivLoginContainer"] {
      opacity: 1 !important;
      pointer-events: auto !important;
    }
  `
};
