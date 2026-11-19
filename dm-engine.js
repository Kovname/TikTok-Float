'use strict';

/**
 * Невидимый фоновый движок TikTok Messages (/messages и /business-suite/messages) — v7.
 * - Без monkeypatch fetch/XHR (не ломает инициализацию TikTok IM SDK и не подмешивает свой профиль из /api/user/detail/self/).
 * - Строго отделяет верхнюю шапку (y < 56), левую колонку списка диалогов и правую область переписки по реальной геометрии.
 * - Гарантирует scroll-overflow на контейнере списка чатов (даже когда первые 9 чатов = 648px) и подгружает ВСЕХ людей в список.
 * - Открывает диалог комбинированным способом (DOM pointer/mouse/click по инфо-блоку + React __reactProps.onClick + Chromium isTrusted click).
 * - Извлекает сообщения и присланные видео 3 уровнями: строки сообщений + React Fiber (JSON msg.content с aweme_id) + геометрический TreeWalker-сканер по всей правой области чата.
 */
function tiktokFloatDmEngine() {
  if (window.__TTF_DM_ENGINE__ && window.__TTF_DM_ENGINE__.version >= 8) {
    return window.__TTF_DM_ENGINE__.snapshot();
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cleanText = (el) => (el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const isIframeContext = (() => {
    try { return window !== window.top; } catch { return true; }
  })();

  function emit(type, data) {
    try {
      const msg = { __ttfDmBridge: true, payload: { type, data } };
      window.postMessage(msg, '*');
      if (isIframeContext && window.top) {
        window.top.postMessage(msg, '*');
      }
    } catch {}
  }

  function expandOuterMessageIframe() {
    if (isIframeContext) return false;
    const iframeWrap = document.querySelector('.message-iframe');
    if (!iframeWrap) return false;
    if (!document.getElementById('__ttf_bs_iframe_css')) {
      try {
        const st = document.createElement('style');
        st.id = '__ttf_bs_iframe_css';
        st.textContent = `
          .message-iframe, .message-container, .contact-card-container {
            position: fixed !important;
            inset: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            max-width: none !important;
            padding: 0 !important;
            margin: 0 !important;
            border-radius: 0 !important;
            z-index: 99999 !important;
          }
          .message-iframe iframe {
            width: 100vw !important;
            height: 100vh !important;
            border: 0 !important;
          }
        `;
        (document.head || document.documentElement).appendChild(st);
      } catch {}
    }
    return true;
  }

  function isOuterIframeShell() {
    if (isIframeContext) return false;
    const hasMsgIframe = Boolean(document.querySelector('.message-iframe iframe, .message-container iframe'));
    if (hasMsgIframe) expandOuterMessageIframe();
    return hasMsgIframe;
  }

  let lastStateHash = '';
  let lastOpenedChatKey = '';
  let hasLoadedChatsOnce = false;
  const seenChats = new Map();
  let loadAllRunning = false;
  let loadAllDone = false;
  let lastScrapeMode = 'rows';
  let lastGenericEls = [];

  const SHORT_TIME_RE =
    /^(\d{1,2}:\d{2}|\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?|\d+\s*(?:мин|ч|дн|нед|с|m|h|d|w|s)|вчера|сегодня|yesterday|today)$/i;
  const TRAILING_TIME_RE =
    /\s*(\d{1,2}:\d{2}|\d{1,2}\.\d{1,2}\.\d{2,4}|\d{1,2}\.\d{1,2})$/;

  function isTopGlobalHeader(el) {
    if (!el) return false;
    if (
      el.closest(
        '.header, #tiktok-sdk-tiktok-header-container, [data-e2e="top-navbar"], [class*="DivHeaderContainer"]'
      )
    ) {
      return true;
    }
    if (!isIframeContext) {
      const r = el.getBoundingClientRect();
      if (r.bottom <= 62 && r.top < 20 && el.closest('header')) return true;
    }
    return false;
  }

  function extractAvatarUrl(root) {
    if (!root) return '';
    const img = root.querySelector('img');
    if (img && (img.currentSrc || img.src)) {
      return img.currentSrc || img.src;
    }
    const avaEl =
      root.querySelector('[class*="Avatar"], [class*="avatar"]') ||
      (String(root.className || '').toLowerCase().includes('avatar') ? root : null);
    if (avaEl) {
      try {
        const bg = getComputedStyle(avaEl).backgroundImage || '';
        const m = bg.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/i);
        if (m && m[1]) return m[1];
      } catch {}
    }
    return '';
  }

  function hasAvatarNode(el) {
    if (!el) return false;
    if (el.querySelector('img, [class*="Avatar"], [class*="avatar"]')) return true;
    return false;
  }

  function isLoggedOutDom() {
    if (/^\/login\b/i.test(location.pathname)) return true;
    const login = document.querySelector('#loginContainer, [class*="DivLoginContainer"]');
    if (login) {
      const r = login.getBoundingClientRect();
      if (r.width > 120 && r.height > 120) return true;
    }
    const loginBtn = document.querySelector('button[aria-label="Войти"], [data-e2e="top-login-button"]');
    if (loginBtn && !document.querySelector('[data-e2e="profile-icon"], .tiktok-sdk-tiktok-header-avatar')) {
      if (findChatRowElements().length === 0) return true;
    }
    return false;
  }

  const PREVIEW_SYSTEM_RE =
    /^(?:(?:вы\s+)?(?:поделил(?:ся|ась|ись)|отреагировал[аи]?|лайкнул[аи]?|отправил[аи]?|прислал[аи]?|переслал[аи]?|упомянул[аи]?|ответил[аи]?|просмотрел[аи]?|начал[аи]?)|поделил(?:ся|ась|ись)\s+(?:видео|фото|публикац|истори|ссылк|профил)|(?:you\s+)?(?:shared|sent|reacted|liked|replied|mentioned)\s+(?:a\s+)?(?:video|photo|story|post|message|link|sticker|gif)|сообщения|messages|запросы|requests|настройки|settings|скачать контакты|download leads|загрузка|loading)/i;

  function isInvalidChatName(name, lastMessage) {
    const n = String(name || '').replace(/\s+/g, ' ').trim();
    if (!n || n.length > 64) return true;
    if (SHORT_TIME_RE.test(n) || /^\d+$/.test(n)) return true;
    if (PREVIEW_SYSTEM_RE.test(n)) return true;
    if (n.includes('💬 Комментарий')) return true;
    const lm = String(lastMessage || '').replace(/\s+/g, ' ').trim();
    if (lm && lm.toLowerCase() === n.toLowerCase()) return true;
    return false;
  }

  function findChatRowElements() {
    // 1) Основной точный селектор TikTok /messages — никогда не смешиваем с внутренними wrapper-элементами!
    const exactPrimary = Array.from(document.querySelectorAll('[data-e2e="chat-list-item"]')).filter((el) => {
      if (isTopGlobalHeader(el)) return false;
      const r = el.getBoundingClientRect();
      return r.left >= -8 && r.left <= 560 && r.width >= 110 && r.width <= 540 && r.height >= 36 && r.height <= 140;
    });
    if (exactPrimary.length > 0) return exactPrimary;

    // 2) Запасной селектор для альтернативных версий / Business Suite iframe
    const raw = Array.from(
      document.querySelectorAll(
        '[class*="DivItemWrapper"], [class*="ConversationItem"], [class*="ChatListItem"], [class*="DivChatListItem"], [class*="conversation-item"], [class*="chat-list-item"], [class*="session-item"], [role="listitem"]'
      )
    );
    const out = [];

    for (const el of raw) {
      if (isTopGlobalHeader(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.left < -8 || r.left > 560) continue;
      if (r.width < 110 || r.width > 540 || r.height < 36 || r.height > 140) continue;
      if (!hasAvatarNode(el)) continue;
      if (out.some((prev) => prev.contains(el) || el.contains(prev))) continue;
      out.push(el);
    }

    if (out.length > 0) return out;

    // 3) Геометрический фоллбэк для Business Suite / Semi-UI / Tailwind-списков диалогов в левой колонке
    const geoCandidates = [];
    const minTop = isIframeContext ? -4 : 75;
    for (const el of document.querySelectorAll('div, li')) {
      if (isTopGlobalHeader(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.top < minTop || r.left < 0 || r.left > 360) continue;
      if (r.width < 160 || r.width > 460 || r.height < 46 || r.height > 112) continue;
      const ava = el.querySelector('img, [class*="Avatar"], [class*="avatar"]');
      if (!ava) continue;
      const ar = ava.getBoundingClientRect();
      if (ar.width < 22 || ar.width > 68 || ar.height < 22 || ar.height > 68) continue;
      if (ar.left > r.left + 84) continue;
      const txt = cleanText(el);
      if (!txt || txt.length < 2 || txt.length > 180) continue;
      if (/^(скачать контакты|сообщения|messages|поиск|search|все|непрочитанные)$/i.test(txt)) continue;
      if (geoCandidates.some((prev) => prev.contains(el) || el.contains(prev))) continue;
      geoCandidates.push(el);
    }

    if (geoCandidates.length >= 2) {
      return geoCandidates;
    }
    return out;
  }

  /**
   * Точная граница между левым списком людей и правой областью открытого чата.
   */
  function getChatPaneLeftBoundary() {
    const rows = findChatRowElements();
    if (rows.length > 0) {
      let maxRight = 0;
      for (const row of rows) {
        const r = row.getBoundingClientRect();
        if (r.right > maxRight && r.right < window.innerWidth * 0.72) {
          maxRight = r.right;
        }
      }
      if (maxRight >= 160) return Math.round(maxRight - 8);
    }
    return 260;
  }

  function formatShortDate(raw) {
    const t = String(raw || '').trim();
    const m = t.match(/^(\d{1,2}\.\d{1,2})\.\d{4}$/);
    return m ? m[1] : t;
  }

  function scrapeConversations() {
    const rows = findChatRowElements();
    const liveList = [];
    const usedKeys = new Set();

    rows.forEach((row, idx) => {
      const avatar = extractAvatarUrl(row);

      const leafTexts = Array.from(row.querySelectorAll('p, span, div, time'))
        .filter((n) => n.children.length === 0)
        .map((n) => ({ el: n, txt: cleanText(n) }))
        .filter((x) => x.txt.length > 0);

      const nameEl = row.querySelector(
        '[data-e2e="chat-list-username"], [data-e2e="chat-list-item-nickname"], [class*="PInfoNickname"], [class*="Nickname"], [class*="Username"], [class*="nickname"], [class*="username"]'
      );
      let name = cleanText(nameEl);
      // Если элемент никнейма уже есть в DOM, но ещё пустой (TikTok не догрузил профиль) — пропускаем строку, НЕ подставляем текст превью вместо имени!
      if (nameEl && !name) return;
      if (!name) {
        const previewNode = row.querySelector(
          '[data-e2e="chat-list-content"], [class*="PInfoExtract"], [class*="LastMessage"], [class*="Preview"]'
        );
        const firstNonPreview = leafTexts.find(
          (x) =>
            (!previewNode || (x.el !== previewNode && !previewNode.contains(x.el))) &&
            !isInvalidChatName(x.txt, '')
        );
        name = firstNonPreview ? firstNonPreview.txt : '';
      }
      if (isInvalidChatName(name, '')) return;

      let handle = '';
      const link = row.querySelector('a[href*="/@"]');
      if (link) {
        const m = (link.getAttribute('href') || '').match(/\/@([^/?#]+)/);
        if (m) handle = m[1];
      }

      let unreadCount = 0;
      const badgeEl = row.querySelector(
        '[data-e2e*="unread"], [class*="Unread"], [class*="Badge"], [class*="Sup"], [class*="unread"], [class*="badge"], sup'
      );
      if (badgeEl) {
        const bt = cleanText(badgeEl);
        const n = parseInt(bt, 10);
        if (Number.isFinite(n) && n > 0 && n < 10000) unreadCount = n;
        else if (!bt) unreadCount = 1;
      }

      let timeText = '';
      for (const item of leafTexts) {
        if (item.txt === name) continue;
        if (item.el === badgeEl || (badgeEl && badgeEl.contains(item.el))) continue;
        if (item.txt.length <= 14 && SHORT_TIME_RE.test(item.txt)) {
          timeText = item.txt;
          break;
        }
      }

      let lastMessage = '';
      const previewEl = row.querySelector(
        '[data-e2e="chat-list-content"], [class*="PInfoExtract"], [class*="LastMessage"], [class*="Preview"], [class*="extract"], [class*="preview"]'
      );
      if (previewEl) {
        const parts = [];
        for (const child of previewEl.childNodes) {
          const ct = cleanText(child);
          if (!ct) continue;
          if (ct.length <= 14 && SHORT_TIME_RE.test(ct)) {
            if (!timeText) timeText = ct;
            continue;
          }
          parts.push(ct);
        }
        lastMessage = parts.join(' ').trim() || cleanText(previewEl);
      }

      if (!lastMessage) {
        const candidate = leafTexts.find(
          (x) =>
            x.txt !== name &&
            x.txt !== timeText &&
            x.el !== badgeEl &&
            !(badgeEl && badgeEl.contains(x.el)) &&
            !/^\d{1,3}$/.test(x.txt)
        );
        lastMessage = candidate ? candidate.txt : '';
      }

      const trailMatch = lastMessage.match(TRAILING_TIME_RE);
      if (trailMatch) {
        if (!timeText) timeText = trailMatch[1];
        lastMessage = lastMessage.slice(0, trailMatch.index).trim();
      }

      if (timeText && !SHORT_TIME_RE.test(timeText)) {
        timeText = '';
      }
      timeText = formatShortDate(timeText);
      if (isInvalidChatName(name, lastMessage)) return;

      const cls = String(row.className || '');
      let id = (handle || name).toLowerCase();
      if (usedKeys.has(id)) id = id + '_' + idx;
      usedKeys.add(id);

      const domSelected =
        row.getAttribute('aria-selected') === 'true' ||
        /active|selected/i.test(cls);
      const active = domSelected || (lastOpenedChatKey && lastOpenedChatKey === id);

      const entry = {
        id,
        index: idx,
        name,
        handle,
        avatar,
        lastMessage: lastMessage.slice(0, 120),
        timeText,
        unreadCount,
        active: Boolean(active)
      };

      liveList.push(entry);
      const prev = seenChats.get(id);
      seenChats.set(id, {
        ...entry,
        avatar: entry.avatar || (prev && prev.avatar) || '',
        handle: entry.handle || (prev && prev.handle) || '',
        lastMessage: entry.lastMessage || (prev && prev.lastMessage) || ''
      });
    });

    if (liveList.length > 0) hasLoadedChatsOnce = true;

    // Сначала возвращаем живые чаты в точном порядке DOM (самые свежие сверху), затем ранее проскролленные валидные чаты
    const liveIds = new Set(liveList.map((c) => c.id));
    const merged = [...liveList];

    for (const [id, cached] of seenChats.entries()) {
      if (liveIds.has(id)) continue;
      if (isInvalidChatName(cached.name, cached.lastMessage)) {
        seenChats.delete(id);
        continue;
      }
      merged.push({
        ...cached,
        index: null,
        active: Boolean(lastOpenedChatKey && lastOpenedChatKey === id),
        stale: true
      });
    }

    return merged;
  }

  function findChatListScroller() {
    const rows = findChatRowElements();
    if (rows.length) {
      let cur = rows[0].parentElement;
      let fallback = null;
      while (cur && cur !== document.body && cur !== document.documentElement) {
        const r = cur.getBoundingClientRect();
        if (r.left >= -8 && r.right >= 140) {
          const st = getComputedStyle(cur);
          const ov = st.overflowY;
          if (ov === 'auto' || ov === 'scroll' || ov === 'overlay') {
            // Если 9 чатов (~640px) помещаются без скролла в высоком контейнере — ограничиваем высоту до 340px, чтобы активировался нативный scroll-overflow и пагинация TikTok!
            if (cur.scrollHeight <= cur.clientHeight + 8 && rows.length >= 5 && cur.clientHeight > 360) {
              try {
                cur.style.maxHeight = '340px';
                cur.style.overflowY = 'auto';
              } catch {}
            }
            if (cur.scrollHeight > cur.clientHeight + 4) return cur;
            if (!fallback) fallback = cur;
          } else if (cur.scrollHeight > cur.clientHeight + 20 && cur.clientHeight >= 180) {
            if (!fallback) fallback = cur;
          }
        }
        cur = cur.parentElement;
      }
      if (fallback) {
        if (fallback.scrollHeight <= fallback.clientHeight + 8 && rows.length >= 5 && fallback.clientHeight > 360) {
          try {
            fallback.style.maxHeight = '340px';
            fallback.style.overflowY = 'auto';
          } catch {}
        }
        return fallback;
      }
    }

    const paneLeft = getChatPaneLeftBoundary();
    for (const el of document.querySelectorAll('div, ul, section, aside')) {
      const r = el.getBoundingClientRect();
      // Строго исключаем скрытый левый drawer (r.left = -312) и верхнюю шапку!
      if (r.left < -4 || r.right < 150 || r.top < 50) continue;
      if (r.left > paneLeft || r.width < 160 || r.width > 540 || r.height < 200) continue;
      const st = getComputedStyle(el);
      if (
        (st.overflowY === 'auto' || st.overflowY === 'scroll' || st.overflowY === 'overlay') &&
        el.scrollHeight > el.clientHeight + 12
      ) {
        return el;
      }
    }
    return null;
  }

  function getChatListWheelTarget() {
    const rows = findChatRowElements();
    // НИКОГДА не начинаем крутить список до того, как в DOM появились реальные строки диалогов!
    if (!rows.length) {
      return { ok: false, seenCount: seenChats.size };
    }
    findChatListScroller();
    const visibleRow =
      rows.find((el) => {
        const rr = el.getBoundingClientRect();
        return rr.top >= 60 && rr.bottom <= window.innerHeight - 16 && rr.left >= 0;
      }) || rows[Math.min(rows.length - 1, Math.floor(rows.length / 2))];
    const r = visibleRow.getBoundingClientRect();
    if (r.left < 0 || r.top < 40) {
      return { ok: false, seenCount: seenChats.size };
    }
    return {
      ok: true,
      x: Math.round(r.left + r.width * 0.5),
      y: Math.round(r.top + r.height * 0.5),
      seenCount: seenChats.size
    };
  }

  function scrollChatListStep(deltaY) {
    const sc = findChatListScroller();
    if (sc) {
      if (deltaY === 0) {
        sc.scrollTop = 0;
      } else {
        sc.scrollTop = Math.max(0, sc.scrollTop + deltaY);
      }
      try {
        sc.dispatchEvent(new Event('scroll', { bubbles: true }));
        sc.dispatchEvent(new WheelEvent('wheel', { deltaY: deltaY || -400, bubbles: true, cancelable: true }));
      } catch {}
    }
    const rows = findChatRowElements();
    if (deltaY > 0 && rows.length) {
      try {
        rows[rows.length - 1].scrollIntoView({ block: 'end', behavior: 'instant' });
      } catch {}
    } else if (deltaY === 0 && rows.length && !sc) {
      try {
        rows[0].scrollIntoView({ block: 'start', behavior: 'instant' });
      } catch {}
    }
    scrapeConversations();
    return {
      seenCount: seenChats.size,
      scrollTop: sc ? Math.round(sc.scrollTop) : 0,
      scrollHeight: sc ? Math.round(sc.scrollHeight) : 0
    };
  }

  async function loadAllChats() {
    if (loadAllRunning) return seenChats.size;
    if (findChatRowElements().length === 0) return seenChats.size;
    loadAllRunning = true;
    try {
      let stable = 0;
      let last = -1;
      for (let i = 0; i < 28 && stable < 3; i++) {
        const rows = findChatRowElements();
        if (!rows.length) break;
        scrollChatListStep(480);
        await sleep(340);
        const n = seenChats.size;
        if (n === last) stable++;
        else {
          stable = 0;
          last = n;
        }
      }
      scrollChatListStep(0);
    } finally {
      loadAllRunning = false;
      loadAllDone = true;
      emitSnapshot(true);
    }
    return seenChats.size;
  }

  /**
   * Извлекает данные видео или сообщения из React Fiber / Props (включая JSON-строку msg.content в TikTok IM).
   */
  function parseContentPayload(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try { return JSON.parse(trimmed); } catch {}
      }
    }
    return null;
  }

  function extractVideoMetaFromFiber(el, domAuthorHint) {
    if (!el) return null;
    const queue = [el, ...Array.from(el.querySelectorAll('*')).slice(0, 14)];
    let cur = el.parentElement;
    for (let i = 0; i < 7 && cur && cur !== document.body; i++) {
      queue.push(cur);
      cur = cur.parentElement;
    }

    const seen = new WeakSet();
    for (const node of queue) {
      try {
        for (const key of Object.keys(node)) {
          if (!key.startsWith('__reactProps') && !key.startsWith('__reactFiber')) continue;
          const stack = [node[key]];
          let steps = 0;
          while (stack.length && steps < 280) {
            steps++;
            const obj = stack.pop();
            if (!obj || typeof obj !== 'object' || seen.has(obj)) continue;
            seen.add(obj);

            const parsedContent = parseContentPayload(obj.content);
            const srcObj = parsedContent || obj;

            // Сначала проверяем прямые готовые ссылки TikTok внутри Fiber
            if (typeof srcObj.href === 'string' && /\/@[^/]+\/(?:video|photo)\/\d+/.test(srcObj.href)) {
              return { url: srcObj.href, thumb: '', author: domAuthorHint ? '@' + domAuthorHint.replace(/^@/, '') : '', desc: '', needsClickResolve: false };
            }
            if (typeof srcObj.url === 'string' && /tiktok\.com\/@[^/]+\/(?:video|photo)\/\d+/.test(srcObj.url)) {
              return { url: srcObj.url, thumb: '', author: domAuthorHint ? '@' + domAuthorHint.replace(/^@/, '') : '', desc: '', needsClickResolve: false };
            }

            const awemeId =
              srcObj.itemId ||
              srcObj.item_id ||
              srcObj.awemeId ||
              srcObj.aweme_id ||
              srcObj.videoId ||
              srcObj.video_id ||
              obj.itemId ||
              obj.awemeId ||
              obj.aweme_id ||
              (srcObj.aweme && (srcObj.aweme.id || srcObj.aweme.aweme_id)) ||
              (srcObj.video && (srcObj.video.id || srcObj.video.aweme_id));

            if (awemeId && /^\d{15,22}$/.test(String(awemeId))) {
              const author =
                srcObj.authorUniqueId ||
                srcObj.author_unique_id ||
                srcObj.uniqueId ||
                srcObj.unique_id ||
                srcObj.share_user_name ||
                srcObj.author_name ||
                srcObj.authorName ||
                (srcObj.user && (srcObj.user.unique_id || srcObj.user.uniqueId || srcObj.user.nickname)) ||
                (srcObj.author && (srcObj.author.uniqueId || srcObj.author.unique_id || srcObj.author.nickname)) ||
                (srcObj.aweme && srcObj.aweme.author && (srcObj.aweme.author.uniqueId || srcObj.aweme.author.unique_id || srcObj.aweme.author.nickname)) ||
                domAuthorHint ||
                '';
              const desc =
                srcObj.desc ||
                srcObj.title ||
                srcObj.text ||
                (srcObj.aweme && srcObj.aweme.desc) ||
                '';
              const coverObj =
                srcObj.cover ||
                srcObj.coverUrl ||
                srcObj.cover_url ||
                (srcObj.video && srcObj.video.cover);
              const thumb =
                typeof coverObj === 'string'
                  ? coverObj
                  : coverObj && Array.isArray(coverObj.url_list) && coverObj.url_list[0]
                    ? coverObj.url_list[0]
                    : coverObj && Array.isArray(coverObj.urlList) && coverObj.urlList[0]
                      ? coverObj.urlList[0]
                      : '';
              const isPhoto =
                Number(srcObj.aweme_type || srcObj.awemeType || srcObj.item_type || 0) === 150 ||
                Boolean(srcObj.isPhoto || srcObj.is_photo || (srcObj.aweme && Number(srcObj.aweme.aweme_type) === 150));
              const kindSeg = isPhoto ? 'photo' : 'video';
              const handleClean = String(author || '').replace(/^@/, '').trim();
              const validHandle = /^[a-zA-Z0-9._-]{2,36}$/.test(handleClean) ? handleClean : '';
              // ВАЖНО: TikTok Web ВСЕГДА отдаёт 404 на голый /video/<id> без /@username/! Всегда ставим /@<handle>/ или /@_/!
              const url = validHandle
                ? 'https://www.tiktok.com/@' + validHandle + '/' + kindSeg + '/' + awemeId
                : 'https://www.tiktok.com/@_/' + kindSeg + '/' + awemeId;

              const commentText =
                srcObj.comment_text ||
                srcObj.commentText ||
                (srcObj.comment && (srcObj.comment.text || srcObj.comment.comment_text)) ||
                '';
              const commentAuthor =
                srcObj.comment_author ||
                srcObj.commentAuthor ||
                srcObj.comment_user_name ||
                (srcObj.comment &&
                  (srcObj.comment.user_name ||
                    srcObj.comment.nickname ||
                    srcObj.comment.unique_id ||
                    srcObj.comment.author)) ||
                '';
              const forwardedComment = commentText
                ? {
                    author: String(commentAuthor || handleClean || 'Пользователь'),
                    text: String(commentText).slice(0, 280),
                    videoUrl: url
                  }
                : null;

              return {
                videoId: String(awemeId),
                url,
                thumb,
                author: handleClean ? '@' + handleClean : '',
                desc: String(desc || '').slice(0, 140),
                forwardedComment,
                needsClickResolve: true
              };
            }

            for (const k of Object.keys(obj)) {
              if (k === 'return' || k === 'sibling' || k === 'alternate' || k === '_owner' || k === 'stateNode') {
                continue;
              }
              const v = obj[k];
              if (v && typeof v === 'object') stack.push(v);
            }
          }
        }
      } catch {}
    }
    return null;
  }

  function parseForwardedCommentFromText(rawText, existingVideo, domIndex) {
    let text = String(rawText || '').trim();
    let video = existingVideo || null;
    let forwardedComment =
      (existingVideo && existingVideo.forwardedComment) || null;

    if (text) {
      const urlMatch = text.match(/https?:\/\/(?:www\.|vm\.|vt\.)?tiktok\.com\/[^\s]+/);
      if (urlMatch && /\/(?:video|photo)\/\d+/.test(urlMatch[0])) {
        if (!video) {
          video = {
            url: urlMatch[0],
            thumb: '',
            author: '',
            desc: 'Видео TikTok',
            domIndex
          };
        } else if (!video.url) {
          video.url = urlMatch[0];
        }
        text = text.replace(urlMatch[0], '').trim();
      }

      const fcMatch = text.match(
        /💬\s*Комментарий\s+([^:]{1,48}):\s*(?:«([^»]+)»|"([^"]+)"|([^\n]+))/i
      );
      if (fcMatch) {
        const fcAuthor = String(fcMatch[1] || '').trim();
        const fcQuote = String(fcMatch[2] || fcMatch[3] || fcMatch[4] || '').trim();
        forwardedComment = {
          author: fcAuthor || 'Пользователь',
          text: fcQuote,
          videoUrl: (video && video.url) || ''
        };
        text = text.replace(fcMatch[0], '').trim();
      }
    }

    if (forwardedComment && video && video.url && !forwardedComment.videoUrl) {
      forwardedComment.videoUrl = video.url;
    }

    return { text, video, forwardedComment };
  }

  function findMessageEditor() {
    const paneLeft = getChatPaneLeftBoundary();
    const candidates = document.querySelectorAll(
      '[data-e2e="message-input-area"] [contenteditable="true"], [data-e2e="message-input-area"] [role="textbox"], [class*="DivEditor"] [contenteditable="true"], [class*="DivInputArea"] [contenteditable="true"], [class*="Composer" i] [contenteditable="true"], [class*="Composer" i] textarea, [contenteditable="true"], [role="textbox"], textarea, input[type="text"]'
    );
    let best = null;
    let bestTop = -1;
    const minTop = Math.max(200, Math.round(window.innerHeight * 0.42));

    for (const el of candidates) {
      if (isTopGlobalHeader(el)) continue;
      const ph = String(el.getAttribute('placeholder') || el.getAttribute('aria-label') || '');
      if (/поиск|search|фильтр|filter/i.test(ph)) continue;
      const r = el.getBoundingClientRect();
      if (r.left >= paneLeft - 24 && r.width >= 72 && r.height >= 16 && r.top >= minTop) {
        if (r.top > bestTop) {
          bestTop = r.top;
          best = el;
        }
      }
    }
    return best;
  }

  function findChatMainArea() {
    const paneLeft = getChatPaneLeftBoundary();
    const directCandidates = document.querySelectorAll(
      '[data-e2e="dm-new-chatbox"], [data-e2e="chat-room"], [data-e2e="chat-main"], [class*="DivChatMain"], [class*="DivChatBox"], [class*="ChatRoom"]'
    );
    for (const d of directCandidates) {
      const r = d.getBoundingClientRect();
      if (r.left >= paneLeft - 24 && r.width >= 260 && r.height >= 220) {
        return d;
      }
    }

    const minTop = isIframeContext ? 0 : 45;
    const candidates = Array.from(document.querySelectorAll('div, main, section')).filter((el) => {
      if (isTopGlobalHeader(el)) return false;
      const r = el.getBoundingClientRect();
      return (
        r.left >= paneLeft - 20 &&
        r.top >= minTop &&
        r.width >= 280 &&
        r.height >= 260 &&
        r.right <= window.innerWidth + 24
      );
    });

    const editor = findMessageEditor();
    if (editor) {
      const withEditor = candidates.filter((el) => el.contains(editor));
      if (withEditor.length) {
        withEditor.sort(
          (a, b) =>
            a.getBoundingClientRect().width * a.getBoundingClientRect().height -
            b.getBoundingClientRect().width * b.getBoundingClientRect().height
        );
        return withEditor[0];
      }
    }

    if (candidates.length) {
      candidates.sort(
        (a, b) =>
          b.getBoundingClientRect().width * b.getBoundingClientRect().height -
          a.getBoundingClientRect().width * a.getBoundingClientRect().height
      );
      return candidates[0];
    }
    return null;
  }

  function findMessageScrollBox(chatMain) {
    const paneLeft = getChatPaneLeftBoundary();
    const scope = chatMain || document;

    const directCandidates = scope.querySelectorAll(
      '[data-e2e="dm-new-message-list"], [data-e2e="chat-message-list"], [class*="DivMessageList"], [class*="MessageList"], [class*="DivChatMain"]'
    );
    for (const direct of directCandidates) {
      const r = direct.getBoundingClientRect();
      if (r.left >= paneLeft - 24 && r.width >= 240 && r.height >= 140) {
        return direct;
      }
    }

    let best = null;
    let bestArea = 0;
    for (const el of scope.querySelectorAll('div')) {
      if (isTopGlobalHeader(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.left < paneLeft - 24 || r.top < 45 || r.width < 240 || r.height < 140) continue;
      const st = getComputedStyle(el);
      const isScrollable =
        st.overflowY === 'auto' ||
        st.overflowY === 'scroll' ||
        st.overflowY === 'overlay' ||
        el.scrollHeight > el.clientHeight + 12;
      if (!isScrollable) continue;
      const area = r.width * r.height;
      if (area > bestArea) {
        bestArea = area;
        best = el;
      }
    }
    return best || chatMain;
  }

  function isExcludedChatChrome(el, headerEl, paneLeft) {
    if (!el) return true;
    if (isTopGlobalHeader(el)) return true;
    const r = el.getBoundingClientRect();
    if (r.left < paneLeft - 24 || r.height < 14 || r.width < 24) return true;

    // Исключаем только саму шапку чата (но НЕ крупный контейнер-обёртку, внутри которого лежат и шапка, и сообщения!)
    if (headerEl) {
      if (el === headerEl || headerEl.contains(el)) return true;
      if (el.contains(headerEl) && r.height < 130) return true;
    }

    // Исключаем только нижнюю панель ввода (но НЕ крупный контейнер-обёртку высотой >= 170px, внутри которого лежат и сообщения, и поле ввода!)
    if (el.closest('[data-e2e="message-input-area"]')) return true;
    if (
      r.height < 170 &&
      el.querySelector('[contenteditable="true"], textarea, [data-e2e="message-input-area"]')
    ) {
      return true;
    }
    return false;
  }

  function collectMessageRowNodes(scrollBox, chatMain, headerEl) {
    const paneLeft = getChatPaneLeftBoundary();
    const root = scrollBox || chatMain;
    if (!root) return [];

    const bySelector = Array.from(
      root.querySelectorAll(
        '[data-e2e="dm-new-chat-item"], [data-e2e="chat-item"], [data-e2e*="message-item"], [class*="DivChatItemContainer"], [class*="DivChatItemWrapper"], [class*="DivMessageItem"], [class*="MessageItem"], [class*="ChatItem"], [class*="message-item"]'
      )
    ).filter((el) => !isExcludedChatChrome(el, headerEl, paneLeft));

    const deduped = bySelector.filter(
      (el, _, arr) => !arr.some((other) => other !== el && other.contains(el))
    );
    if (deduped.length > 0) return deduped;

    const rootRect = root.getBoundingClientRect();
    let listContainer = root;

    for (let depth = 0; depth < 9; depth++) {
      const children = Array.from(listContainer.children).filter(
        (ch) => !isExcludedChatChrome(ch, headerEl, paneLeft)
      );
      if (children.length === 0) break;
      if (children.length === 1) {
        listContainer = children[0];
        continue;
      }
      const lcRect = listContainer.getBoundingClientRect();
      const dominant = children
        .filter((ch) => {
          const r = ch.getBoundingClientRect();
          // Настоящий контейнер-обёртка списка сообщений всегда широкий (>= 85% ширины родителя) и содержит >= 2 дочерних элементов
          return (
            r.width >= lcRect.width * 0.85 &&
            r.height >= Math.max(160, rootRect.height * 0.55) &&
            ch.children.length >= 2
          );
        })
        .sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];

      if (dominant) {
        const others = children.filter((c) => c !== dominant);
        const othersAreTiny = others.every((c) => c.getBoundingClientRect().height < 64);
        if (othersAreTiny) {
          listContainer = dominant;
          continue;
        }
      }
      break;
    }

    return Array.from(listContainer.children).filter((el) => {
      if (isExcludedChatChrome(el, headerEl, paneLeft)) return false;
      return cleanText(el).length > 0 || Boolean(el.querySelector('img, video, a'));
    });
  }

  function findRightPaneHeader(chatMain, paneLeft) {
    const scope = chatMain || document;
    const direct = Array.from(
      scope.querySelectorAll('[data-e2e="chat-header"], [class*="DivChatHeader"], [class*="ChatHeader"], [class*="chat-header"]')
    ).find((el) => !isTopGlobalHeader(el) && el.getBoundingClientRect().left >= paneLeft - 24);
    if (direct) return direct;

    const minTop = isIframeContext ? -2 : 48;
    for (const el of scope.querySelectorAll('header, div')) {
      if (isTopGlobalHeader(el)) continue;
      const r = el.getBoundingClientRect();
      if (
        r.left >= paneLeft - 20 &&
        r.top >= minTop &&
        r.top <= 170 &&
        r.bottom <= 235 &&
        r.height >= 28 &&
        r.height <= 110 &&
        r.width >= 220
      ) {
        const txt = cleanText(el);
        if (
          txt &&
          txt.length >= 1 &&
          txt.length <= 72 &&
          !/^(поиск|search|скачать контакты|download leads|сообщения|messages)$/i.test(txt)
        ) {
          return el;
        }
      }
    }
    return null;
  }

  function scrapeActiveChat(conversations) {
    const paneLeft = getChatPaneLeftBoundary();
    const chatMain = findChatMainArea() || document.body;
    const headerEl = findRightPaneHeader(chatMain, paneLeft);

    let headerName = '';
    let headerHandle = '';
    let headerAvatar = '';
    if (headerEl) {
      headerAvatar = extractAvatarUrl(headerEl);
      const hLink = headerEl.querySelector('a[href*="/@"]');
      if (hLink) {
        const m = (hLink.getAttribute('href') || '').match(/\/@([^/?#]+)/);
        if (m) headerHandle = m[1];
      }
      const hNameEl = headerEl.querySelector('[data-e2e="chat-nickname"], [class*="Nickname"], [class*="nickname"], p, span, a');
      const cand = cleanText(hNameEl) || cleanText(headerEl).split(/\s+@/)[0].slice(0, 48);
      if (cand && !/^(скачать контакты|сообщения|messages)$/i.test(cand)) {
        headerName = cand;
      }
    }

    if (!headerName) {
      const activeConv = conversations.find((c) => c.active);
      if (activeConv) {
        headerName = activeConv.name;
        headerHandle = activeConv.handle;
        headerAvatar = activeConv.avatar;
      }
    }

    const scrollBox = findMessageScrollBox(chatMain);
    const editorEl = findMessageEditor();
    const editorRect = editorEl ? editorEl.getBoundingClientRect() : null;
    const rawRect = scrollBox ? scrollBox.getBoundingClientRect() : chatMain.getBoundingClientRect();
    const rightBound =
      editorRect && editorRect.right > paneLeft + 240
        ? Math.min(window.innerWidth, Math.max(rawRect.right, editorRect.right + 72))
        : Math.max(paneLeft + 320, rawRect.right || window.innerWidth);

    const boxRect = {
      left: Math.max(paneLeft, rawRect.left || paneLeft),
      top: Math.max(54, rawRect.top || 54),
      right: rightBound,
      bottom: rawRect.bottom || window.innerHeight,
      width: Math.max(280, rightBound - Math.max(paneLeft, rawRect.left || paneLeft)),
      height: Math.max(200, (rawRect.bottom || window.innerHeight) - Math.max(54, rawRect.top || 54))
    };
    const centerX = boxRect.left + boxRect.width / 2;

    const items = collectMessageRowNodes(scrollBox, chatMain, headerEl);
    const messages = [];

    items.forEach((node, idx) => {
      const rawText = cleanText(node);
      const fiberVideo = extractVideoMetaFromFiber(node);
      const hasMedia =
        Boolean(fiberVideo) ||
        Boolean(node.querySelector('img, video, a[href*="/video/"], a[href*="/photo/"]'));

      if (
        !hasMedia &&
        rawText.length <= 28 &&
        /^(\d{1,2}:\d{2}|вчера|сегодня|yesterday|today|\d{1,2}\s+[а-яa-z]+|\d{1,2}[./-]\d{1,2})/i.test(rawText)
      ) {
        messages.push({
          id: 'sep_' + idx + '_' + rawText,
          kind: 'date',
          text: rawText
        });
        return;
      }

      let contentNode =
        node.querySelector(
          '[class*="DivTextContainer"], [class*="DivVideoContainer"], [class*="ShareVideo"], [class*="MessageContent"], [class*="Bubble" i], a[href*="/video/"]'
        ) || node;
      if (contentNode === node && node.firstElementChild) {
        const fc = node.firstElementChild;
        const fr = fc.getBoundingClientRect();
        if (fr.width > 10 && fr.width < boxRect.width * 0.85) {
          contentNode = fc;
        }
      }
      const br = contentNode.getBoundingClientRect();
      const clsAll = (String(node.className || '') + ' ' + String(contentNode.className || '')).toLowerCase();
      const nodeStyle = getComputedStyle(node);
      let isMe =
        /\b(self|sender|mine|right|outgoing|is-me|me)\b/.test(clsAll) ||
        nodeStyle.justifyContent === 'flex-end' ||
        nodeStyle.flexDirection === 'row-reverse';
      if (!isMe && br.width > 10 && br.width < boxRect.width * 0.85) {
        const bubbleCenter = br.left + br.width / 2;
        if (bubbleCenter > centerX + 18) isMe = true;
      }

      let video = null;
      const isStoryReactionRow = Boolean(
        node.querySelector('[class*="DivRefVideoContent"]') ||
        /(?:отреагировал[аи]?\s+на\s+(?:эту\s+)?истори|ответил[аи]?\s+на\s+истори|reacted\s+to\s+.*story|replied\s+to\s+.*story)/i.test(rawText)
      );
      const videoLink = node.querySelector('a[href*="/video/"], a[href*="/photo/"]');
      const videoCard =
        videoLink ||
        node.querySelector(
          '[data-e2e="dm-new-shared-video"], [data-e2e*="video"], [class*="VideoCard"], [class*="ShareVideo"], [class*="AwemeCard"], [class*="DivVideoContainer"], [class*="VideoWrapper"], [class*="video-card" i]'
        );

      const nonAvatarImgs = Array.from(node.querySelectorAll('img')).filter((img) => {
        if (img.closest('[class*="Avatar"], [class*="avatar"], [data-e2e*="avatar"]')) return false;
        const ir = img.getBoundingClientRect();
        return ir.width >= 46 || ir.height >= 46;
      });

      const looksLikeVideoCard =
        !isStoryReactionRow &&
        (Boolean(videoCard) ||
          Boolean(fiberVideo) ||
          nonAvatarImgs.some((im) => {
            const ir = im.getBoundingClientRect();
            return ir.height >= 76 && ir.height > ir.width * 1.02;
          }));

      if (looksLikeVideoCard) {
        const coverImg = nonAvatarImgs[0];
        const coverSrc = coverImg ? coverImg.currentSrc || coverImg.src : '';
        const cardScope = videoCard || node;
        const rawAuthor = cleanText(
          cardScope.querySelector('[class*="PNickname"], [class*="Author"], [class*="Nickname"], a[href*="/@"]')
        );
        const fiberMeta =
          extractVideoMetaFromFiber(videoCard || coverImg || node, rawAuthor) ||
          fiberVideo;
        const url =
          (videoLink && videoLink.href) ||
          (fiberMeta && fiberMeta.url) ||
          '';
        const vAuthor = (fiberMeta && fiberMeta.author) || (rawAuthor ? '@' + rawAuthor.replace(/^@/, '') : '') || '';
        const vDesc = (fiberMeta && fiberMeta.desc) || '';

        video = {
          url,
          thumb: coverSrc || (fiberMeta && fiberMeta.thumb) || '',
          author: vAuthor,
          desc: vDesc,
          domIndex: idx,
          needsClickResolve: videoLink ? false : Boolean(!url || (fiberMeta && fiberMeta.needsClickResolve)),
          forwardedComment: (fiberMeta && fiberMeta.forwardedComment) || null
        };
      }

      const images = [];
      if (!video) {
        for (const img of nonAvatarImgs) {
          const src = img.currentSrc || img.src || '';
          if (src) images.push(src);
        }
      }

      let text = '';
      if (!video) {
        const textEl = node.querySelector(
          '[data-e2e="dm-new-message-text"], [data-e2e="chat-text"], [class*="PText"], [class*="TextContainer"], p'
        );
        text = cleanText(textEl) || rawText;
        if (isStoryReactionRow) {
          const senderHdr = cleanText(node.querySelector('[class*="DivChatItemSenderNameContainer"]'));
          if (senderHdr && text && !text.toLowerCase().includes('истори') && !text.toLowerCase().includes('story')) {
            text = senderHdr + ' · ' + text;
          } else if (senderHdr && !text) {
            text = senderHdr;
          }
        }
      } else {
        const pTexts = Array.from(node.querySelectorAll('[data-e2e="dm-new-message-text"], [class*="PText"], [data-e2e="chat-text"]'))
          .map((n) => cleanText(n))
          .filter((t) => t && t !== video.author && t !== video.author.replace(/^@/, '') && t !== video.desc);
        text = pTexts.join(' ') || (rawText.includes('💬') ? rawText : '');
      }

      const parsedFc = parseForwardedCommentFromText(text, video, idx);
      text = parsedFc.text;
      video = parsedFc.video;
      let forwardedComment = parsedFc.forwardedComment;

      if (!forwardedComment) {
        const commentCardEl = node.querySelector(
          '[class*="CommentCard" i], [class*="ShareComment" i], [data-e2e*="comment-card" i]'
        );
        if (commentCardEl) {
          const cAuth = cleanText(commentCardEl.querySelector('[class*="Author" i], [class*="Nickname" i], [class*="User" i]'));
          const cTxt = cleanText(commentCardEl);
          if (cTxt) {
            forwardedComment = {
              author: cAuth || 'Комментарий',
              text: cAuth ? cTxt.replace(cAuth, '').trim() : cTxt,
              videoUrl: (video && video.url) || ''
            };
          }
        }
      }

      if (!text && !video && !images.length && !forwardedComment) return;

      const timeEl = node.querySelector('[class*="Time"], time');
      const timeCandidate = cleanText(timeEl);
      const timeText = timeCandidate && SHORT_TIME_RE.test(timeCandidate) ? timeCandidate : '';

      messages.push({
        id:
          'm_' +
          idx +
          '_' +
          (isMe ? '1' : '0') +
          '_' +
          (
            text +
            (forwardedComment ? forwardedComment.author + forwardedComment.text : '') +
            (video ? video.url + video.thumb : '')
          ).slice(0, 32),
        domIndex: idx,
        kind: 'msg',
        sender: isMe ? 'me' : 'them',
        text,
        video,
        forwardedComment,
        isStory: Boolean(isStoryReactionRow || (text && /(?:истори|story|stories)/i.test(text))),
        images,
        timeText
      });
    });

    const rowMsgCount = messages.filter((m) => m.kind === 'msg').length;
    lastScrapeMode = 'rows';
    let finalMessages = messages;

    // Геометрический TreeWalker-сканер включаем ТОЛЬКО если структурированные строки чата вообще не найдены (иначе он дробит карточки видео и шапки историй!)
    if (rowMsgCount === 0) {
      const generic = scrapeMessagesGeneric(document.body, headerEl, boxRect, paneLeft);
      const genMsgCount = generic.filter((m) => m.kind === 'msg').length;
      if (genMsgCount > 0) {
        finalMessages = generic;
        lastScrapeMode = 'generic';
      }
    }

    return {
      header: headerName
        ? { name: headerName, handle: headerHandle, avatar: headerAvatar }
        : null,
      messages: finalMessages
    };
  }

  function bubbleRectFor(el, boxRect, paneLeft) {
    let cur = el;
    for (let i = 0; i < 6 && cur && cur !== document.body; i++) {
      let bg = '';
      try { bg = getComputedStyle(cur).backgroundColor; } catch {}
      const r = cur.getBoundingClientRect();
      if (
        r.left >= paneLeft - 12 &&
        bg &&
        bg !== 'rgba(0, 0, 0, 0)' &&
        bg !== 'transparent' &&
        r.width > 18 &&
        r.width < boxRect.width * 0.9
      ) {
        return r;
      }
      cur = cur.parentElement;
    }
    return el.getBoundingClientRect();
  }

  function scrapeMessagesGeneric(rootEl, headerEl, boxRect, paneLeft) {
    lastGenericEls = [];
    const root = rootEl || document.body;
    if (!root) return [];

    const headerBottom = headerEl
      ? Math.max(62, headerEl.getBoundingClientRect().bottom)
      : 92;
    const editorEl = findMessageEditor();
    const composerTop = editorEl
      ? editorEl.getBoundingClientRect().top - 16
      : window.innerHeight - 76;
    const centerX = boxRect.left + boxRect.width / 2;
    const entries = [];

    const isSenderMe = (rect) => {
      const bubbleCenter = rect.left + rect.width / 2;
      if (bubbleCenter > centerX + 18) return true;
      return rect.right > boxRect.right - 56 && rect.left > boxRect.left + boxRect.width * 0.28;
    };

    const isInsideMsgArea = (r) => {
      if (r.width < 2 || r.height < 2) return false;
      if (r.left < paneLeft - 12 || r.left > boxRect.right - 12) return false;
      if (r.bottom <= headerBottom + 2 || r.top >= composerTop) return false;
      return true;
    };

    // 1) Собираем все ссылки на видео и изображения/обложки роликов в геометрической области чата
    for (const el of root.querySelectorAll('a, img, video, [data-e2e*="video"], [class*="VideoCard"], [class*="ShareVideo"], [class*="AwemeCard"]')) {
      if (isTopGlobalHeader(el)) continue;
      if (el.closest('[data-e2e="message-input-area"], [contenteditable="true"], textarea')) continue;
      if (headerEl && (headerEl === el || headerEl.contains(el))) continue;
      const r = el.getBoundingClientRect();
      if (!isInsideMsgArea(r)) continue;
      const tag = el.tagName;

      if (tag === 'A') {
        const href = el.getAttribute('href') || '';
        if (/\/(?:video|photo)\/\d+/.test(href)) {
          const img = el.querySelector('img');
          entries.push({
            type: 'video',
            el,
            top: r.top,
            rect: r,
            url: el.href || href,
            thumb: img ? img.currentSrc || img.src : ''
          });
        }
        continue;
      }

      if (tag === 'IMG') {
        if (el.closest('[class*="Avatar"], [class*="avatar"], [data-e2e*="avatar"]')) continue;
        if (el.closest('a[href*="/video/"], a[href*="/photo/"]')) continue;
        if (el.closest('[class*="DivRefVideoContent"]')) continue;
        // Маленькие круглые аватарки собеседника слева от сообщения (<= 44px) пропускаем
        if (r.width <= 44 && r.height <= 44) continue;
        const src = el.currentSrc || el.src || '';
        if (!src) continue;
        const vCard = el.closest('[data-e2e="dm-new-shared-video"], [class*="DivVideoContainer"], [class*="VideoCard"], [class*="ShareVideo"]');
        const domNick = vCard ? cleanText(vCard.querySelector('[class*="PNickname"], [class*="Author"], [class*="Nickname"]')) : '';
        const fiber = extractVideoMetaFromFiber(vCard || el, domNick);
        const inVideoContainer = Boolean(
          vCard || el.closest('[class*="video" i], [class*="aweme" i], [class*="share" i], [data-e2e*="video" i]')
        );
        if (fiber || inVideoContainer || (r.height >= 72 && r.height > r.width * 1.02)) {
          entries.push({
            type: 'video',
            el: vCard || el,
            top: r.top,
            rect: r,
            url: (fiber && fiber.url) || '',
            thumb: src,
            author: (fiber && fiber.author) || (domNick ? '@' + domNick.replace(/^@/, '') : ''),
            desc: (fiber && fiber.desc) || '',
            needsClickResolve: true,
            forwardedComment: (fiber && fiber.forwardedComment) || null
          });
        } else if (r.width >= 48 || r.height >= 48) {
          entries.push({ type: 'image', el, top: r.top, rect: r, src });
        }
        continue;
      }

      if (tag === 'VIDEO' && r.height >= 64) {
        const fiber = extractVideoMetaFromFiber(el);
        entries.push({
          type: 'video',
          el,
          top: r.top,
          rect: r,
          url: (fiber && fiber.url) || '',
          thumb: el.poster || (fiber && fiber.thumb) || '',
          author: (fiber && fiber.author) || '',
          desc: (fiber && fiber.desc) || ''
        });
      }
    }

    // 2) Собираем ВСЕ текстовые узлы через TreeWalker с точным Range-прямоугольником каждого текстового фрагмента
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let tNode = walker.nextNode();
    while (tNode) {
      const raw = String(tNode.nodeValue || '').replace(/\s+/g, ' ').trim();
      const parent = tNode.parentElement;
      const curTextNode = tNode;
      tNode = walker.nextNode();
      if (!raw || !parent) continue;
      const pTag = parent.tagName;
      if (pTag === 'SCRIPT' || pTag === 'STYLE' || pTag === 'NOSCRIPT' || pTag === 'SVG' || pTag === 'PATH') continue;
      if (isTopGlobalHeader(parent)) continue;
      if (parent.closest('[data-e2e="message-input-area"], [contenteditable="true"], textarea')) continue;
      if (headerEl && (headerEl === parent || headerEl.contains(parent))) continue;
      if (parent.closest('a[href*="/video/"], a[href*="/photo/"]')) continue;
      if (/^(отправить|send|сообщение|message\.\.\.|скачать контакты|выберите чат|select a chat)$/i.test(raw)) continue;

      let r = parent.getBoundingClientRect();
      try {
        const range = document.createRange();
        range.selectNodeContents(curTextNode);
        const rr = range.getBoundingClientRect();
        if (rr.width >= 1 && rr.height >= 1) r = rr;
      } catch {}
      if (!isInsideMsgArea(r)) continue;

      entries.push({ type: 'text', el: parent, top: r.top, rect: r, text: raw });
    }

    entries.sort((a, b) => a.top - b.top || a.rect.left - b.rect.left);

    const videoEntries = entries.filter((e) => e.type === 'video');
    const usable = entries.filter((e) => {
      if (e.type !== 'text') return true;
      return !videoEntries.some((v) => {
        const cx = e.rect.left + e.rect.width / 2;
        const cy = e.rect.top + e.rect.height / 2;
        return cx >= v.rect.left - 8 && cx <= v.rect.right + 8 && cy >= v.rect.top - 8 && cy <= v.rect.bottom + 8;
      });
    });

    const messages = [];
    const textGroups = new Map();

    for (const e of usable) {
      if (e.type === 'text') {
        const t = e.text;
        if (
          t.length <= 28 &&
          /^(\d{1,2}:\d{2}|вчера|сегодня|yesterday|today|\d{1,2}\s+[а-яa-z]+\.?(?:\s+\d{4})?|\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?)$/i.test(t)
        ) {
          messages.push({ id: 'g_sep_' + Math.round(e.top) + '_' + t, kind: 'date', text: t, _top: e.top });
          continue;
        }
        const b = bubbleRectFor(e.el, boxRect, paneLeft);
        const key = Math.round(b.left / 10) + ':' + Math.round(b.top / 14);
        let group = textGroups.get(key);
        if (!group) {
          group = {
            kind: 'msg',
            sender: isSenderMe(b) ? 'me' : 'them',
            text: '',
            video: null,
            images: [],
            timeText: '',
            _top: e.top,
            _el: e.el
          };
          textGroups.set(key, group);
          messages.push(group);
        }
        if (!group.text.includes(t)) {
          group.text = (group.text ? group.text + ' ' : '') + t;
        }
      } else if (e.type === 'video') {
        const fiber = e.url ? null : extractVideoMetaFromFiber(e.el);
        const url = e.url || (fiber && fiber.url) || '';
        const fc = e.forwardedComment || (fiber && fiber.forwardedComment) || null;
        messages.push({
          kind: 'msg',
          sender: isSenderMe(e.rect) ? 'me' : 'them',
          text: '',
          video: {
            url,
            thumb: e.thumb || (fiber && fiber.thumb) || '',
            author: e.author || (fiber && fiber.author) || '',
            desc: e.desc || (fiber && fiber.desc) || '',
            domIndex: -1,
            forwardedComment: fc
          },
          forwardedComment: fc,
          images: [],
          timeText: '',
          _top: e.top,
          _el: e.el
        });
      } else if (e.type === 'image') {
        messages.push({
          kind: 'msg',
          sender: isSenderMe(e.rect) ? 'me' : 'them',
          text: '',
          video: null,
          images: [e.src],
          timeText: '',
          _top: e.top,
          _el: e.el
        });
      }
    }

    messages.sort((a, b) => a._top - b._top);

    const out = [];
    messages.forEach((m, idx) => {
      if (m.kind === 'msg') {
        const parsedFc = parseForwardedCommentFromText(m.text, m.video, idx);
        m.text = parsedFc.text;
        m.video = parsedFc.video;
        if (parsedFc.forwardedComment) {
          m.forwardedComment = parsedFc.forwardedComment;
        }
        if (m.text && /(?:истори|story|stories)/i.test(m.text)) {
          m.isStory = true;
        }
      }
      if (m.video) m.video.domIndex = idx;
      lastGenericEls[idx] = m._el || null;
      const base =
        (m.text || '') +
        (m.forwardedComment ? m.forwardedComment.author + m.forwardedComment.text : '') +
        (m.video ? m.video.url + m.video.thumb.slice(-18) : '') +
        (m.images && m.images[0] ? m.images[0].slice(-18) : '');
      m.domIndex = idx;
      m.id = m.id || 'g_' + idx + '_' + (m.sender === 'me' ? 1 : 0) + '_' + base.slice(0, 28);
      delete m._top;
      delete m._el;
      out.push(m);
    });
    return out;
  }

  function scrapeStories(conversations) {
    const out = [];
    const seen = new Set();

    const addStory = (item) => {
      if (!item || !item.name || isInvalidChatName(item.name, '')) return;
      const key = String(item.handle || item.name).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        id: key,
        name: item.name,
        handle: item.handle || '',
        avatar: item.avatar || '',
        url: item.url || (item.handle ? 'https://www.tiktok.com/@' + item.handle : ''),
        hasStory: true,
        hasActiveRing: true
      });
    };

    // 1) Ищем ТОЛЬКО реальные элементы историй в DOM (аватарки со Story-кольцом)
    const storyEls = document.querySelectorAll(
      '[data-e2e*="story" i], [class*="StoryItem" i], [class*="StoryRing" i], [class*="AvatarStory" i]'
    );
    for (const el of storyEls) {
      if (isTopGlobalHeader(el)) continue;
      const row = el.closest('[data-e2e="chat-list-item"], [class*="DivItemWrapper"], [class*="ConversationItem"], a') || el;
      const name = extractRowNickname(row);
      if (isInvalidChatName(name, '')) continue;
      const avatar = extractAvatarUrl(row);
      let handle = '';
      const link = row.querySelector('a[href*="/@"]') || (row.tagName === 'A' ? row : null);
      if (link) {
        const m = (link.getAttribute('href') || '').match(/\/@([^/?#]+)/);
        if (m) handle = m[1];
      }
      addStory({ name, handle, avatar });
    }

    // 2) Дополняем ТОЛЬКО теми реальными друзьями, у которых в чате действительно есть упоминание истории (никогда не присваиваем истории за обычные видео/фото!)
    if (Array.isArray(conversations) && conversations.length) {
      for (const c of conversations) {
        if (!c || isInvalidChatName(c.name, c.lastMessage)) continue;
        if (/(?:истори|story|stories)/i.test(c.lastMessage || '')) {
          addStory({
            name: c.name,
            handle: c.handle,
            avatar: c.avatar
          });
        }
      }
    }

    return out;
  }

  function debugDump() {
    const trunc = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 28);
    const describe = (el) => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        e2e: el.getAttribute('data-e2e') || '',
        cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').slice(0, 72),
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        kids: el.children.length,
        txt: el.children.length === 0 ? trunc(el.textContent) : ''
      };
    };
    const isVisualEl = (el) => {
      const tag = el.tagName;
      if (tag === 'SVG' || tag === 'PATH' || tag === 'G' || tag === 'DEFS' || tag === 'SCRIPT' || tag === 'STYLE') {
        return false;
      }
      if (isTopGlobalHeader(el)) return false;
      const r = el.getBoundingClientRect();
      const minTop = isIframeContext ? 0 : 54;
      return r.top >= minTop && r.left >= -4 && r.width >= 20 && r.height >= 14;
    };
    const paneLeft = getChatPaneLeftBoundary();
    const rows = findChatRowElements();
    const chatMain = findChatMainArea();
    const scrollBox = chatMain ? findMessageScrollBox(chatMain) : null;
    const sc = findChatListScroller();
    const allVisual = Array.from(document.querySelectorAll('*')).filter(isVisualEl);
    const leftNodes = allVisual
      .filter((el) => el.getBoundingClientRect().left < paneLeft)
      .slice(0, 40)
      .map(describe);
    const rightNodes = allVisual
      .filter((el) => el.getBoundingClientRect().left >= paneLeft - 10)
      .slice(0, 50)
      .map(describe);
    const iframes = Array.from(document.querySelectorAll('iframe')).map((f) => {
      const r = f.getBoundingClientRect();
      return {
        src: String(f.src || f.getAttribute('src') || '').slice(0, 180),
        cls: String(f.className || '').slice(0, 64),
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]
      };
    });

    return {
      href: location.href,
      isIframe: isIframeContext,
      isOuterShell: isOuterIframeShell(),
      viewport: [window.innerWidth, window.innerHeight],
      paneLeft,
      chatRowsInDom: rows.length,
      chatRowsSample: rows.slice(0, 8).map((r) => trunc(r.textContent)),
      seenChatsTotal: seenChats.size,
      iframes,
      chatScroller: sc ? { ...describe(sc), scrollH: sc.scrollHeight, clientH: sc.clientHeight, scrollT: sc.scrollTop } : null,
      editorFound: Boolean(findMessageEditor()),
      chatMain: chatMain ? describe(chatMain) : null,
      scrollBox: scrollBox ? describe(scrollBox) : null,
      mode: lastScrapeMode,
      leftNodes,
      rightNodes
    };
  }

  function snapshot() {
    const outerShell = isOuterIframeShell();
    const loggedOut = outerShell ? false : isLoggedOutDom();
    const conversations = loggedOut ? [] : scrapeConversations();
    const active = loggedOut ? { header: null, messages: [] } : scrapeActiveChat(conversations);
    const unreadTotal = conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
    const stories = loggedOut ? [] : scrapeStories(conversations);

    return {
      loggedIn: !loggedOut,
      loading: !loggedOut && !hasLoadedChatsOnce && conversations.length === 0,
      isIframe: isIframeContext,
      isOuterShell: outerShell,
      conversations,
      stories,
      activeHeader: active.header,
      messages: active.messages,
      unreadTotal,
      href: location.href
    };
  }

  function emitSnapshot(force) {
    const data = snapshot();
    // Внешняя оболочка /business-suite/messages без строк чатов (все чаты внутри iframe) не должна затирать реальный список чатов!
    if (data.isOuterShell && data.conversations.length === 0) {
      return;
    }
    const hash = JSON.stringify({
      l: data.loggedIn,
      ld: data.loading,
      u: data.unreadTotal,
      h: data.activeHeader ? data.activeHeader.name : '',
      s: (data.stories || []).length,
      c: data.conversations.map((x) => x.id + ':' + x.lastMessage + ':' + x.timeText + ':' + x.unreadCount + ':' + (x.active ? 1 : 0)),
      m: data.messages.map((x) => x.id + ':' + (x.video ? x.video.url : '') + ':' + (x.text || '').slice(0, 24))
    });
    if (!force && hash === lastStateHash) return;
    lastStateHash = hash;
    emit('dm-snapshot', data);
  }

  function extractRowNickname(row) {
    const el = row.querySelector(
      '[data-e2e="chat-list-username"], [class*="PInfoNickname"], [class*="Nickname"], [class*="Username"], [class*="nickname"], [class*="username"]'
    );
    if (el) return cleanText(el);
    const firstLeaf = Array.from(row.querySelectorAll('p, span, div'))
      .filter((n) => n.children.length === 0)
      .map((n) => cleanText(n))
      .find(Boolean);
    return firstLeaf || cleanText(row);
  }

  function resolveChatRowElement(chatId, index, name) {
    const rows = findChatRowElements();
    if (!rows.length) return null;

    if (name && String(name).trim()) {
      const want = String(name).trim().toLowerCase();
      const exact = rows.find((r) => extractRowNickname(r).toLowerCase() === want);
      if (exact) return exact;
      const partial = rows.find((r) => extractRowNickname(r).toLowerCase().includes(want));
      if (partial) return partial;
      const anyText = rows.find((r) => cleanText(r).toLowerCase().includes(want));
      if (anyText) return anyText;
      return null;
    }
    if (Number.isInteger(index) && rows[index]) {
      return rows[index];
    }
    return null;
  }

  function triggerReactClick(el) {
    if (!el) return false;
    const candidates = [
      el,
      el.firstElementChild,
      el.querySelector('[class*="Info"], [class*="Content"], [data-e2e="chat-list-username"], [class*="PInfoNickname"]'),
      el.parentElement
    ].filter(Boolean);

    for (const node of candidates) {
      let cur = node;
      for (let d = 0; d < 4 && cur && cur !== document.body; d++) {
        const cr = cur.getBoundingClientRect();
        if (cr.height > 150) break;
        try {
          for (const k of Object.keys(cur)) {
            if (!k.startsWith('__reactProps')) continue;
            const props = cur[k];
            if (props && typeof props.onClick === 'function') {
              props.onClick({
                currentTarget: cur,
                target: node,
                button: 0,
                preventDefault() {},
                stopPropagation() {},
                nativeEvent: new MouseEvent('click', { bubbles: true })
              });
              return true;
            }
          }
        } catch {}
        cur = cur.parentElement;
      }
    }
    return false;
  }

  async function locateChatRow(chatId, index, name) {
    let target = resolveChatRowElement(chatId, name ? null : index, name);

    if (!target && name) {
      const sc = findChatListScroller();
      if (sc) {
        sc.scrollTop = 0;
        await sleep(100);
        for (let i = 0; i < 32 && !target; i++) {
          target = resolveChatRowElement(chatId, null, name);
          if (target) break;
          const before = sc.scrollTop;
          scrollChatListStep(360);
          await sleep(220);
          if (sc.scrollTop === before && i > 2) {
            target = resolveChatRowElement(chatId, null, name);
            break;
          }
        }
      }
    }
    if (!target && Number.isInteger(index)) target = resolveChatRowElement(chatId, index, '');
    if (!target) return { ok: false, reason: 'chat_not_found' };

    try { target.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch {
      try { target.scrollIntoView(); } catch {}
    }
    await sleep(50);

    // Кликаем именно по правой текстовой области строки (дальше от аватарки слева!)
    const nameNode = target.querySelector(
      '[data-e2e="chat-list-username"], [class*="PInfoNickname"], [class*="Nickname"], [class*="Info"], p, span'
    );
    const nr = nameNode ? nameNode.getBoundingClientRect() : null;
    const r = target.getBoundingClientRect();
    const clickX =
      nr && nr.width >= 16 && nr.left >= r.left + 44
        ? Math.round(nr.left + Math.min(72, nr.width / 2))
        : Math.round(r.left + Math.max(76, Math.min(r.width - 32, r.width * 0.56)));
    const clickY = Math.round(r.top + Math.max(12, r.height / 2));

    return {
      ok: true,
      x: clickX,
      y: clickY
    };
  }

  function markChatOpened(chatId, name) {
    lastOpenedChatKey = String(chatId || name || '').toLowerCase();
  }

  async function locateMessageCard(domIndex) {
    let el = null;
    if (lastScrapeMode === 'generic') {
      el = lastGenericEls[domIndex] || null;
    } else {
      const paneLeft = getChatPaneLeftBoundary();
      const chatMain = findChatMainArea() || document.body;
      const headerEl = findRightPaneHeader(chatMain, paneLeft);
      const items = collectMessageRowNodes(findMessageScrollBox(chatMain), chatMain, headerEl);
      const node = items[domIndex];
      if (node) {
        el =
          node.querySelector(
            '[data-e2e="dm-new-shared-video"], a[href*="/video/"], a[href*="/photo/"], [class*="DivVideoContainer"], [class*="VideoCard"], [class*="ShareVideo"], img'
          ) || node;
      }
    }
    if (!el || !el.isConnected) return { ok: false };
    try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch {}
    await sleep(60);
    const r = el.getBoundingClientRect();
    return {
      ok: true,
      x: Math.round(Math.max(10, Math.min(window.innerWidth - 10, r.left + r.width / 2))),
      y: Math.round(Math.max(10, Math.min(window.innerHeight - 10, r.top + r.height / 2))),
      href: location.href
    };
  }

  async function clickChatRowFallback(chatId, index, name) {
    const target = resolveChatRowElement(chatId, index, name);
    if (!target) return false;
    markChatOpened(chatId, name);
    const infoNode =
      target.querySelector(
        '[class*="Info"], [data-e2e="chat-list-username"], [class*="PInfoNickname"], [class*="Nickname"]'
      ) || target;
    const r = infoNode.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    try {
      const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0, buttons: 1 };
      infoNode.dispatchEvent(new PointerEvent('pointerdown', opts));
      infoNode.dispatchEvent(new MouseEvent('mousedown', opts));
      infoNode.dispatchEvent(new PointerEvent('pointerup', opts));
      infoNode.dispatchEvent(new MouseEvent('mouseup', opts));
      infoNode.click();
    } catch {}
    triggerReactClick(target);
    await sleep(240);
    emitSnapshot(true);
    return true;
  }

  async function prepareSendMessage(rawText) {
    const text = String(rawText || '').trim();
    if (!text) return { ok: false, reason: 'empty' };

    let editor = findMessageEditor();
    if (!editor) {
      await sleep(300);
      editor = findMessageEditor();
    }
    if (!editor) return { ok: false, reason: 'editor_not_found' };

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
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        sel.removeAllRanges();
        sel.addRange(range);
        try { document.execCommand('delete', false); } catch {}
        let ok = false;
        try { ok = document.execCommand('insertText', false, text); } catch {}
        if (!ok || !cleanText(editor).includes(text.slice(0, 6))) {
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
            editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
          }
        }
      }

      await sleep(140);
      const sendBtn =
        document.querySelector('[data-e2e="message-send"], [class*="SvgSend"], button[aria-label*="отправ" i], button[aria-label*="send" i]');
      const sr = sendBtn ? sendBtn.getBoundingClientRect() : null;
      return {
        ok: true,
        hasSendBtn: Boolean(sr && sr.width > 4 && sr.height > 4),
        sendX: sr ? sr.left + sr.width / 2 : 0,
        sendY: sr ? sr.top + sr.height / 2 : 0
      };
    } catch (err) {
      return { ok: false, reason: String(err) };
    }
  }

  function clickSendButtonFallback() {
    const btn = document.querySelector(
      '[data-e2e="message-send"], [class*="SvgSend"], button[aria-label*="отправ" i], button[aria-label*="send" i]'
    );
    if (btn) {
      try { btn.click(); return true; } catch {}
    }
    const editor = findMessageEditor();
    if (editor) {
      editor.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })
      );
      return true;
    }
    return false;
  }

  async function resolveVideoUrlByClick(domIndex) {
    const loc = await locateMessageCard(domIndex);
    if (!loc.ok) return '';
    const paneLeft = getChatPaneLeftBoundary();
    const chatMain = findChatMainArea() || document.body;
    let card = null;
    if (lastScrapeMode === 'generic') {
      card = lastGenericEls[domIndex];
    } else {
      const headerEl = findRightPaneHeader(chatMain, paneLeft);
      const items = collectMessageRowNodes(findMessageScrollBox(chatMain), chatMain, headerEl);
      const target = items[domIndex];
      card =
        (target &&
          (target.querySelector('[data-e2e="dm-new-shared-video"], a[href*="/video/"], a[href*="/photo/"], [class*="DivVideoContainer"], [class*="VideoCard"], [class*="ShareVideo"], img') ||
            target)) ||
        null;
    }
    if (!card) return '';
    const beforeHref = location.href;
    triggerReactClick(card);
    card.click();
    for (let i = 0; i < 12; i++) {
      await sleep(150);
      if (location.href !== beforeHref && /\/(?:video|photo)\/\d+/.test(location.href)) {
        const found = location.href;
        try { history.back(); } catch {}
        return found;
      }
    }
    return '';
  }

  async function loadOlderMessages() {
    const chatMain = findChatMainArea();
    const scrollBox = findMessageScrollBox(chatMain);
    if (!scrollBox) return false;
    scrollBox.scrollTop = 0;
    scrollBox.dispatchEvent(new Event('scroll', { bubbles: true }));
    scrollBox.dispatchEvent(new WheelEvent('wheel', { deltaY: -600, bubbles: true, cancelable: true }));
    await sleep(700);
    emitSnapshot(true);
    return true;
  }

  if (typeof MutationObserver !== 'undefined') {
    let timer = null;
    const obs = new MutationObserver(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        emitSnapshot(false);
      }, 320);
    });
    if (document.body) {
      obs.observe(document.body, { childList: true, subtree: true });
    }
  }

  setInterval(() => emitSnapshot(false), 1400);
  setTimeout(() => emitSnapshot(true), 450);

  const autoLoadTimer = setInterval(() => {
    if (loadAllDone || loadAllRunning) {
      if (loadAllDone) clearInterval(autoLoadTimer);
      return;
    }
    if (findChatRowElements().length > 0) {
      clearInterval(autoLoadTimer);
      setTimeout(() => loadAllChats(), 600);
    }
  }, 650);

  window.__TTF_DM_ENGINE__ = {
    version: 9,
    hasChatRows: () => findChatRowElements().length > 0,
    snapshot,
    emitSnapshot,
    locateChatRow,
    markChatOpened,
    locateMessageCard,
    clickChatRowFallback,
    getChatListWheelTarget,
    scrollChatListStep,
    loadAllChats,
    debugDump,
    scrapeGenericNow() {
      const paneLeft = getChatPaneLeftBoundary();
      const chatMain = findChatMainArea() || document.body;
      const headerEl = findRightPaneHeader(chatMain, paneLeft);
      const box = {
        left: paneLeft,
        top: 60,
        right: window.innerWidth,
        bottom: window.innerHeight,
        width: Math.max(320, window.innerWidth - paneLeft),
        height: Math.max(300, window.innerHeight - 60)
      };
      return scrapeMessagesGeneric(document.body, headerEl, box, paneLeft);
    },
    prepareSendMessage,
    clickSendButtonFallback,
    resolveVideoUrlByClick,
    loadOlderMessages
  };

  return snapshot();
}

module.exports = {
  controller: '(' + tiktokFloatDmEngine.toString() + ')();'
};
