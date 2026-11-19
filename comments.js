'use strict';

const $ = (id) => document.getElementById(id);

const els = {
  totalBadge: $('totalBadge'),
  videoContext: $('videoContext'),
  refreshBtn: $('refreshBtn'),
  dockBtn: $('dockBtn'),
  closeBtn: $('closeBtn'),
  scrollArea: $('scrollArea'),
  skeletonList: $('skeletonList'),
  emptyState: $('emptyState'),
  commentsList: $('commentsList'),
  loadMoreWrap: $('loadMoreWrap'),
  loadMoreBtn: $('loadMoreBtn'),
  scrollSentinel: $('scrollSentinel'),
  loginBanner: $('loginBanner'),
  openLoginBtn: $('openLoginBtn'),
  replyBar: $('replyBar'),
  replyText: $('replyText'),
  cancelReplyBtn: $('cancelReplyBtn'),
  composerForm: $('composerForm'),
  commentInput: $('commentInput'),
  sendBtn: $('sendBtn'),
  forwardSheet: $('forwardSheet'),
  forwardCopyBtn: $('forwardCopyBtn'),
  forwardCloseBtn: $('forwardCloseBtn'),
  forwardPreviewAuthor: $('forwardPreviewAuthor'),
  forwardPreviewText: $('forwardPreviewText'),
  forwardActiveChatBtn: $('forwardActiveChatBtn'),
  forwardSearchInput: $('forwardSearchInput'),
  forwardEmptyContacts: $('forwardEmptyContacts'),
  forwardContactsList: $('forwardContactsList'),
  forwardNoteInput: $('forwardNoteInput'),
  forwardSendBtn: $('forwardSendBtn'),
  mediaLightbox: $('mediaLightbox'),
  lightboxImg: $('lightboxImg'),
  lightboxClose: $('lightboxClose'),
  toast: $('toast')
};

let currentData = null;
let replyTarget = null;
let forwardTarget = null;
let forwardContacts = [];
let forwardActiveHeader = null;
let forwardSelectedIds = new Set();
let forwardSending = false;
let isSending = false;
let isLoadingMore = false;
let consecutiveEmptyLoads = 0;
let countBeforeLoadMore = 0;
let loadMoreUnlockTimer = null;
let toastTimer = null;
let lastVideoId = '';
let lastAuthorKey = '';
let lastDescKey = '';
let lastListSignature = '';
let renderedMap = new Map();
let fingerprintToKey = new Map();
let optimisticLikes = new Map();
let activeResizeEdge = null;
let resizeRaf = 0;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  if (!window.commentsApi) return;

  bindHeaderControls();
  bindResizeHandles();
  bindComposer();
  bindInfiniteScroll();
  bindForwardSheet();

  window.commentsApi.onData(handleIncomingData);
  window.commentsApi.onWindowState(handleWindowState);
  if (window.commentsApi.onContacts) {
    window.commentsApi.onContacts((info) => {
      if (info && Array.isArray(info.contacts)) {
        forwardContacts = info.contacts;
        forwardActiveHeader = info.activeHeader || null;
        if (forwardTarget) renderForwardContacts();
      }
    });
  }

  try {
    const initial = await window.commentsApi.getInitialData();
    if (initial) {
      updateDockUI(Boolean(initial.docked));
      if (initial.contactsInfo) {
        forwardContacts = initial.contactsInfo.contacts || [];
        forwardActiveHeader = initial.contactsInfo.activeHeader || null;
      }
      if (initial.data) handleIncomingData(initial.data);
    }
  } catch (err) {
    console.error(err);
  }
}

function bindHeaderControls() {
  els.closeBtn.addEventListener('click', () => window.commentsApi.close());
  els.refreshBtn.addEventListener('click', () => {
    resetCommentsListState();
    els.skeletonList.classList.remove('hidden');
    els.emptyState.classList.add('hidden');
    window.commentsApi.sendAction({ type: 'refresh' });
  });
  els.dockBtn.addEventListener('click', async () => {
    const res = await window.commentsApi.toggleDock();
    if (res) {
      updateDockUI(Boolean(res.docked));
      toast(res.docked ? 'Окно прикреплено к видео' : 'Свободное перемещение');
    }
  });
  els.openLoginBtn.addEventListener('click', () => {
    window.commentsApi.sendAction({ type: 'openLogin' });
    toast('Отсканируй QR-код в основном окне');
  });
  els.loadMoreBtn.addEventListener('click', () => triggerLoadMore(true));

  els.lightboxClose.addEventListener('click', closeLightbox);
  els.mediaLightbox.addEventListener('click', (e) => {
    if (e.target === els.mediaLightbox) closeLightbox();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!els.mediaLightbox.classList.contains('hidden')) {
        closeLightbox();
      } else if (forwardTarget) {
        closeForwardSheet();
      } else if (replyTarget) {
        clearReply();
      } else {
        window.commentsApi.close();
      }
    }
  });
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

function bindResizeHandles() {
  const zones = document.querySelectorAll('.resize-zone');
  for (const zone of zones) {
    zone.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      activeResizeEdge = zone.dataset.resize;
      zone.setPointerCapture(e.pointerId);
      window.commentsApi.startResize(activeResizeEdge);
    });

    zone.addEventListener('pointermove', () => {
      if (!activeResizeEdge) return;
      if (!resizeRaf) {
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = 0;
          if (activeResizeEdge) window.commentsApi.updateResize();
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
      window.commentsApi.endResize();
    };

    zone.addEventListener('pointerup', finish);
    zone.addEventListener('pointercancel', finish);
  }
}

function bindComposer() {
  const syncInputState = () => {
    els.commentInput.style.height = '32px';
    const nextHeight = Math.max(32, Math.min(92, els.commentInput.scrollHeight));
    els.commentInput.style.height = nextHeight + 'px';
    const hasText = els.commentInput.value.trim().length > 0;
    els.sendBtn.disabled = !hasText || isSending;
  };

  els.commentInput.addEventListener('input', syncInputState);

  els.commentInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!els.sendBtn.disabled) submitComment();
    }
  });

  els.composerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submitComment();
  });

  els.cancelReplyBtn.addEventListener('click', clearReply);
}

function bindInfiniteScroll() {
  if (typeof IntersectionObserver === 'undefined') return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (
          entry.isIntersecting &&
          currentData &&
          currentData.hasMore &&
          !isLoadingMore &&
          consecutiveEmptyLoads < 2 &&
          renderedMap.size > 0
        ) {
          triggerLoadMore(false);
        }
      }
    },
    { root: els.scrollArea, rootMargin: '160px' }
  );
  observer.observe(els.scrollSentinel);
}

function triggerLoadMore(manual) {
  if (isLoadingMore) return;
  if (manual) consecutiveEmptyLoads = 0;
  isLoadingMore = true;
  countBeforeLoadMore = renderedMap.size;
  els.loadMoreBtn.disabled = true;
  els.loadMoreBtn.textContent = 'Подгружаю…';
  window.commentsApi.sendAction({ type: 'loadMore' });
  clearTimeout(loadMoreUnlockTimer);
  loadMoreUnlockTimer = setTimeout(() => {
    if (isLoadingMore) {
      if (renderedMap.size <= countBeforeLoadMore) {
        consecutiveEmptyLoads++;
      }
      isLoadingMore = false;
      els.loadMoreBtn.disabled = false;
      els.loadMoreBtn.textContent = 'Загрузить ещё';
    }
  }, 2400);
}

function submitComment() {
  const text = els.commentInput.value.trim();
  if (!text || isSending) return;

  isSending = true;
  els.sendBtn.disabled = true;

  window.commentsApi.sendAction({
    type: 'post',
    text,
    replyTo: replyTarget
  });

  setTimeout(() => {
    if (isSending) {
      isSending = false;
      els.sendBtn.disabled = els.commentInput.value.trim().length === 0;
    }
  }, 4500);
}

function setReply(comment) {
  replyTarget = {
    cid: comment.cid,
    index: comment.domIndex,
    text: comment.text,
    authorName: comment.authorName
  };
  els.replyText.textContent = 'Ответ для ' + (comment.authorName || 'автора');
  els.replyBar.classList.remove('hidden');
  els.commentInput.focus();
}

function clearReply() {
  replyTarget = null;
  els.replyBar.classList.add('hidden');
  els.replyText.textContent = '';
}

function handleWindowState(info) {
  if (!info) return;
  updateDockUI(Boolean(info.docked));
}

function updateDockUI(docked) {
  els.dockBtn.classList.toggle('active', docked);
  els.dockBtn.setAttribute('aria-pressed', String(docked));
  els.dockBtn.title = docked
    ? 'Окно прикреплено рядом с видео · нажми, чтобы открепить'
    : 'Прикрепить рядом с видео';
}

function resetCommentsListState() {
  lastListSignature = '';
  consecutiveEmptyLoads = 0;
  countBeforeLoadMore = 0;
  isLoadingMore = false;
  clearTimeout(loadMoreUnlockTimer);
  renderedMap.clear();
  fingerprintToKey.clear();
  optimisticLikes.clear();
  els.commentsList.innerHTML = '';
  els.scrollArea.scrollTop = 0;
  clearReply();
}

function commentFingerprint(c) {
  const auth = String(c.authorHandle || c.authorName || '')
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const txt = String(c.text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72);
  const firstImg =
    (Array.isArray(c.images) && c.images[0] && c.images[0].thumb ? c.images[0].thumb.slice(-24) : '') ||
    (c.sticker && c.sticker.thumb ? c.sticker.thumb.slice(-24) : '');
  return auth + '|' + txt + '|' + firstImg;
}

function commentKey(c, idx) {
  const fp = commentFingerprint(c);
  if (fp && fingerprintToKey.has(fp)) {
    return fingerprintToKey.get(fp);
  }
  const key = String(c.cid || ('fp_' + fp + '_' + idx));
  if (fp) fingerprintToKey.set(fp, key);
  return key;
}

function computeListSignature(list) {
  return list
    .map((c, idx) => {
      const key = commentKey(c, idx);
      const opt = optimisticLikes.get(key);
      const liked = opt && Date.now() < opt.until ? opt.liked : Boolean(c.userDigged);
      const count = opt && Date.now() < opt.until ? opt.count : (c.diggCount || 0);
      const dText = opt && Date.now() < opt.until ? '' : (c.diggText || '');
      const rLen = Array.isArray(c.replies) ? c.replies.length : 0;
      const iLen = Array.isArray(c.images) ? c.images.length : 0;
      return key + '|' + count + '|' + dText + '|' + (liked ? 1 : 0) + '|' + rLen + '|' + iLen;
    })
    .join('\n');
}

function handleIncomingData(payload) {
  if (!payload || typeof payload !== 'object') return;

  if (payload.notice) toast(payload.notice);
  if (payload.loginRequired) els.loginBanner.classList.remove('hidden');

  if (payload.postResult) {
    isSending = false;
    const res = payload.postResult;
    if (res.ok) {
      els.commentInput.value = '';
      els.commentInput.style.height = '32px';
      clearReply();
      toast('Комментарий отправлен');
    } else if (res.loginRequired) {
      els.loginBanner.classList.remove('hidden');
      toast('Нужен вход в аккаунт TikTok');
    } else {
      toast('Не удалось отправить комментарий');
    }
    els.sendBtn.disabled = els.commentInput.value.trim().length === 0;
    return;
  }

  currentData = payload;
  const incomingAuthorKey = String(payload.authorHandle || payload.authorName || '').trim().toLowerCase();
  const incomingDescKey = String(payload.desc || '').trim().toLowerCase().slice(0, 48);

  // Не сбрасываем уже загруженные комментарии ТОЛЬКО если временный dom_-ID уточнился до числового ID ТОГО ЖЕ ролика (совпадают и автор, и описание)
  const isDomToNumericUpgrade = Boolean(
    lastVideoId &&
      payload.videoId &&
      lastVideoId !== payload.videoId &&
      ((lastVideoId.startsWith('dom_') && /^\d{12,}$/.test(payload.videoId)) ||
        (payload.videoId.startsWith('dom_') && /^\d{12,}$/.test(lastVideoId))) &&
      lastAuthorKey &&
      incomingAuthorKey &&
      lastAuthorKey === incomingAuthorKey &&
      lastDescKey === incomingDescKey
  );

  const videoChanged = Boolean(
    payload.videoId &&
      lastVideoId &&
      payload.videoId !== lastVideoId &&
      !isDomToNumericUpgrade
  );

  if (!lastVideoId && payload.videoId) {
    lastVideoId = payload.videoId;
    lastAuthorKey = incomingAuthorKey;
    lastDescKey = incomingDescKey;
  } else if (isDomToNumericUpgrade) {
    if (/^\d{12,}$/.test(payload.videoId)) lastVideoId = payload.videoId;
  } else if (videoChanged) {
    lastVideoId = payload.videoId;
    lastAuthorKey = incomingAuthorKey;
    lastDescKey = incomingDescKey;
    resetCommentsListState();
  }

  const totalText = payload.totalText || String(Math.max(renderedMap.size, (payload.comments || []).length));
  if (els.totalBadge.textContent !== totalText) {
    els.totalBadge.textContent = totalText;
  }
  const author = payload.authorHandle ? '@' + payload.authorHandle : payload.authorName || 'TikTok';
  const desc = payload.desc ? ' · ' + payload.desc : '';
  const ctxText = author + desc;
  if (els.videoContext.textContent !== ctxText) {
    els.videoContext.textContent = ctxText;
  }

  if (payload.loggedIn === false) {
    els.loginBanner.classList.remove('hidden');
  } else if (payload.loggedIn === true || payload.canComment) {
    els.loginBanner.classList.add('hidden');
  }

  const isNumericPayloadId = Boolean(payload.videoId && /^\d{12,}$/.test(String(payload.videoId)));
  const rawList = Array.isArray(payload.comments) ? payload.comments : [];
  // Финальный барьер: никогда не рендерим комментарий, чей awemeId принадлежит другому ролику
  const list = isNumericPayloadId
    ? rawList.filter((c) => !c || !c.awemeId || !/^\d{12,}$/.test(String(c.awemeId)) || String(c.awemeId) === String(payload.videoId))
    : rawList;

  if (payload.loading && list.length === 0 && renderedMap.size === 0) {
    els.skeletonList.classList.remove('hidden');
    els.emptyState.classList.add('hidden');
    els.loadMoreWrap.classList.add('hidden');
    return;
  }

  els.skeletonList.classList.add('hidden');

  if (list.length === 0) {
    // Если комментарии уже подгружены для этого ролика — НЕ удаляем их при пустом промежуточном пакете!
    if (renderedMap.size > 0) {
      isLoadingMore = false;
      els.loadMoreBtn.disabled = false;
      els.loadMoreBtn.textContent = 'Загрузить ещё';
      return;
    }
    els.emptyState.classList.remove('hidden');
    els.loadMoreWrap.classList.add('hidden');
    return;
  }

  els.emptyState.classList.add('hidden');

  // Главная защита от лагов и миганий: если список не изменился — не трогаем DOM вообще!
  const sig = computeListSignature(list);
  const beforeSize = renderedMap.size;
  if (sig !== lastListSignature || renderedMap.size === 0) {
    lastListSignature = sig;
    patchCommentsList(list);
  }

  const afterSize = renderedMap.size;
  if (isLoadingMore) {
    clearTimeout(loadMoreUnlockTimer);
    if (afterSize > countBeforeLoadMore) {
      consecutiveEmptyLoads = 0;
    } else if (afterSize <= beforeSize) {
      consecutiveEmptyLoads++;
    }
    isLoadingMore = false;
    els.loadMoreBtn.disabled = false;
    els.loadMoreBtn.textContent = 'Загрузить ещё';
  }

  els.loadMoreWrap.classList.toggle('hidden', !payload.hasMore);
}

function formatRelativeTime(unixSec, fallbackText) {
  if (fallbackText) return fallbackText;
  const ts = Number(unixSec);
  if (!ts) return '';
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (diff < 60) return 'только что';
  if (diff < 3600) return Math.floor(diff / 60) + ' мин';
  if (diff < 86400) return Math.floor(diff / 3600) + ' ч';
  if (diff < 604800) return Math.floor(diff / 86400) + ' дн';
  const date = new Date(ts * 1000);
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function formatCount(count, fallback) {
  const n = Number(count);
  if (Number.isFinite(n) && n > 0) {
    if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace('.', ',') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',') + 'K';
    return String(Math.round(n));
  }
  if (fallback && String(fallback).trim() && String(fallback).trim() !== '0') {
    return String(fallback).trim();
  }
  return '0';
}

function createAvatar(src, name, small) {
  const wrap = document.createElement('div');
  wrap.className = 'ava-wrap' + (small ? ' small' : '');

  const fallback = document.createElement('span');
  fallback.className = 'ava-fallback';
  fallback.textContent = (name || 'U').trim().charAt(0).toUpperCase() || 'U';
  wrap.appendChild(fallback);

  if (src) {
    const img = document.createElement('img');
    img.className = 'ava-img';
    img.src = src;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('load', () => fallback.classList.add('hidden'));
    img.addEventListener('error', () => {
      img.remove();
      fallback.classList.remove('hidden');
    });
    wrap.appendChild(img);
  }

  return wrap;
}

function createMediaGrid(images, sticker) {
  const entries = [];
  if (Array.isArray(images)) {
    for (const img of images) {
      if (img && img.thumb) entries.push(img);
    }
  }
  if (sticker && sticker.thumb) {
    entries.push({ ...sticker, isSticker: true });
  }
  if (!entries.length) return null;

  const grid = document.createElement('div');
  grid.className = 'comment-media-grid';

  for (const media of entries) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'comment-media-btn' + (media.isSticker ? ' is-sticker' : '');
    btn.title = 'Открыть полностью';

    const img = document.createElement('img');
    img.className = 'comment-media-img';
    img.src = media.thumb;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => btn.remove());
    btn.appendChild(img);

    if (media.kind === 'gif') {
      const badge = document.createElement('span');
      badge.className = 'media-kind-badge';
      badge.textContent = 'GIF';
      btn.appendChild(badge);
    }

    btn.addEventListener('click', () => openLightbox(media.full || media.thumb));
    grid.appendChild(btn);
  }

  return grid;
}

function buildRepliesBox(replies) {
  const repliesBox = document.createElement('div');
  repliesBox.className = 'replies-list';

  for (const r of replies) {
    const row = document.createElement('div');
    row.className = 'reply-item';
    row.appendChild(createAvatar(r.avatar, r.authorName, true));

    const rBody = document.createElement('div');
    rBody.className = 'comment-body';

    const rMeta = document.createElement('div');
    rMeta.className = 'comment-meta';
    const rAuth = document.createElement('span');
    rAuth.className = 'comment-author';
    rAuth.textContent = r.authorName || 'Пользователь';
    rMeta.appendChild(rAuth);

    const rTime = formatRelativeTime(r.createTime, r.timeText);
    if (rTime) {
      const tSpan = document.createElement('span');
      tSpan.className = 'comment-time';
      tSpan.textContent = rTime;
      rMeta.appendChild(tSpan);
    }

    const rText = document.createElement('p');
    rText.className = 'comment-text';
    rText.textContent = r.text || '';

    rBody.appendChild(rMeta);
    rBody.appendChild(rText);
    const rMedia = createMediaGrid(r.images, r.sticker);
    if (rMedia) rBody.appendChild(rMedia);

    const rActions = document.createElement('div');
    rActions.className = 'comment-actions';
    const rFwdBtn = document.createElement('button');
    rFwdBtn.type = 'button';
    rFwdBtn.className = 'text-action forward-action';
    rFwdBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M22 2L11 13"></path>
        <path d="M22 2L15 22l-4-9-9-4 20-7z"></path>
      </svg>
      <span>Переслать</span>`;
    rFwdBtn.addEventListener('click', () => openForwardSheet(r));
    rActions.appendChild(rFwdBtn);
    rBody.appendChild(rActions);

    row.appendChild(rBody);
    repliesBox.appendChild(row);
  }

  return repliesBox;
}

function createCommentElement(c, idx, key) {
  const li = document.createElement('li');
  li.className = 'comment-item';
  li.dataset.cid = key;

  const main = document.createElement('div');
  main.className = 'comment-main';

  main.appendChild(createAvatar(c.avatar, c.authorName, false));

  const body = document.createElement('div');
  body.className = 'comment-body';

  const meta = document.createElement('div');
  meta.className = 'comment-meta';

  const author = document.createElement('span');
  author.className = 'comment-author';
  author.textContent = c.authorName || (c.authorHandle ? '@' + c.authorHandle : 'Пользователь');
  meta.appendChild(author);

  if (c.labelText) {
    const badge = document.createElement('span');
    badge.className = 'creator-pill';
    badge.textContent = c.labelText;
    meta.appendChild(badge);
  }

  const timeStr = formatRelativeTime(c.createTime, c.timeText);
  if (timeStr) {
    const time = document.createElement('span');
    time.className = 'comment-time';
    time.textContent = timeStr;
    meta.appendChild(time);
  }

  body.appendChild(meta);

  const textP = document.createElement('p');
  textP.className = 'comment-text';
  textP.textContent = c.text || '';
  body.appendChild(textP);

  const mediaGrid = createMediaGrid(c.images, c.sticker);
  if (mediaGrid) body.appendChild(mediaGrid);

  if (c.isAuthorDigged) {
    const authorLiked = document.createElement('div');
    authorLiked.className = 'author-liked-tag';
    authorLiked.textContent = 'Понравилось автору';
    body.appendChild(authorLiked);
  }

  const actions = document.createElement('div');
  actions.className = 'comment-actions';

  const replyBtn = document.createElement('button');
  replyBtn.type = 'button';
  replyBtn.className = 'text-action';
  replyBtn.textContent = 'Ответить';
  replyBtn.addEventListener('click', () => setReply(entry.data));
  actions.appendChild(replyBtn);

  const forwardBtn = document.createElement('button');
  forwardBtn.type = 'button';
  forwardBtn.className = 'text-action forward-action';
  forwardBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M22 2L11 13"></path>
      <path d="M22 2L15 22l-4-9-9-4 20-7z"></path>
    </svg>
    <span>Переслать</span>`;
  forwardBtn.addEventListener('click', () => openForwardSheet(entry.data));
  actions.appendChild(forwardBtn);

  const moreRepliesBtn = document.createElement('button');
  moreRepliesBtn.type = 'button';
  moreRepliesBtn.className = 'text-action hidden';
  moreRepliesBtn.addEventListener('click', () => {
    moreRepliesBtn.textContent = 'Загрузка…';
    window.commentsApi.sendAction({
      type: 'expandReplies',
      cid: entry.data.cid,
      index: Number.isInteger(entry.data.domIndex) ? entry.data.domIndex : entry.index,
      text: entry.data.text
    });
  });
  actions.appendChild(moreRepliesBtn);

  body.appendChild(actions);
  main.appendChild(body);

  const likeBtn = document.createElement('button');
  likeBtn.type = 'button';
  likeBtn.className = 'comment-like';
  likeBtn.title = 'Нравится';
  likeBtn.setAttribute('aria-label', 'Оценить комментарий');
  likeBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 20.4l-1.35-1.23C5.6 14.6 2.5 11.78 2.5 8.3A4.8 4.8 0 0 1 7.3 3.5c1.74 0 3.41.81 4.7 2.13C13.29 4.31 14.96 3.5 16.7 3.5a4.8 4.8 0 0 1 4.8 4.8c0 3.48-3.1 6.3-8.15 10.87L12 20.4z"></path>
    </svg>`;
  const countSpan = document.createElement('span');
  countSpan.className = 'comment-like-count';
  likeBtn.appendChild(countSpan);

  const entry = {
    li,
    likeBtn,
    countSpan,
    moreRepliesBtn,
    repliesCountRendered: 0,
    repliesBox: null,
    data: c,
    index: idx
  };

  likeBtn.addEventListener('click', () => {
    const nextLiked = !likeBtn.classList.contains('liked');
    const baseCount = Number(entry.data.diggCount || 0);
    const nextCount = Math.max(0, baseCount + (nextLiked ? 1 : -1));
    optimisticLikes.set(key, { liked: nextLiked, count: nextCount, until: Date.now() + 2600 });
    likeBtn.classList.toggle('liked', nextLiked);
    likeBtn.setAttribute('aria-pressed', String(nextLiked));
    countSpan.textContent = formatCount(nextCount, '');

    window.commentsApi.sendAction({
      type: 'like',
      cid: entry.data.cid,
      index: Number.isInteger(entry.data.domIndex) ? entry.data.domIndex : entry.index,
      text: entry.data.text
    });
  });

  main.appendChild(likeBtn);
  li.appendChild(main);

  updateCommentEntry(entry, c, idx, key);
  return entry;
}

function updateCommentEntry(entry, c, idx, key) {
  entry.data = c;
  entry.index = idx;

  const opt = optimisticLikes.get(key);
  const useOpt = Boolean(opt && Date.now() < opt.until);
  const liked = useOpt ? opt.liked : Boolean(c.userDigged);
  const countNum = useOpt ? opt.count : Number(c.diggCount || 0);
  const countLabel = formatCount(countNum, useOpt ? '' : c.diggText);

  entry.likeBtn.classList.toggle('liked', liked);
  entry.likeBtn.setAttribute('aria-pressed', String(liked));
  if (entry.countSpan.textContent !== countLabel) {
    entry.countSpan.textContent = countLabel;
  }

  const replies = Array.isArray(c.replies) ? c.replies : [];
  const hiddenReplies = Math.max(0, (c.replyCount || 0) - replies.length);
  if (c.hasMoreReplies || hiddenReplies > 0) {
    entry.moreRepliesBtn.classList.remove('hidden');
    entry.moreRepliesBtn.textContent =
      hiddenReplies > 0 ? 'Ответы (' + hiddenReplies + ')' : 'Показать ответы';
  } else {
    entry.moreRepliesBtn.classList.add('hidden');
  }

  if (replies.length > 0 && replies.length !== entry.repliesCountRendered) {
    entry.repliesCountRendered = replies.length;
    if (entry.repliesBox) entry.repliesBox.remove();
    entry.repliesBox = buildRepliesBox(replies);
    entry.li.appendChild(entry.repliesBox);
  }
}

/**
 * Строго накопительное обновление списка комментариев в рамках текущего видео:
 * - Новые подгруженные комментарии добавляются в конец, НЕ удаляя ранее подгруженные.
 * - Уже отрисованные узлы обновляются точечно (лайки/ответы) без сброса скролла и без мигания.
 */
function patchCommentsList(list) {
  const prevScrollTop = els.scrollArea.scrollTop;
  const hadItems = renderedMap.size > 0;

  list.forEach((c, idx) => {
    const key = commentKey(c, idx);
    let entry = renderedMap.get(key);
    if (!entry) {
      entry = createCommentElement(c, idx, key);
      renderedMap.set(key, entry);
      const isFreshUserPost =
        hadItems &&
        idx === 0 &&
        c.createTime > 0 &&
        Math.floor(Date.now() / 1000) - c.createTime < 25;
      if (isFreshUserPost && els.commentsList.firstChild) {
        els.commentsList.insertBefore(entry.li, els.commentsList.firstChild);
      } else {
        els.commentsList.appendChild(entry.li);
      }
    } else {
      updateCommentEntry(entry, c, idx, key);
    }
  });

  if (hadItems && Math.abs(els.scrollArea.scrollTop - prevScrollTop) > 4) {
    els.scrollArea.scrollTop = prevScrollTop;
  }
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

/* ─── Пересылка комментария контактам / в чат ────────────────────── */

function bindForwardSheet() {
  if (!els.forwardSheet) return;
  els.forwardCloseBtn.addEventListener('click', closeForwardSheet);
  els.forwardSheet.addEventListener('click', (e) => {
    if (e.target === els.forwardSheet) closeForwardSheet();
  });

  els.forwardSearchInput.addEventListener('input', renderForwardContacts);
  els.forwardSendBtn.addEventListener('click', () => submitForwardComment(null));
  els.forwardNoteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !els.forwardSendBtn.disabled) {
      e.preventDefault();
      submitForwardComment(null);
    }
  });

  els.forwardCopyBtn.addEventListener('click', async () => {
    if (!forwardTarget) return;
    const auth = forwardTarget.authorHandle
      ? '@' + String(forwardTarget.authorHandle).replace(/^@/, '')
      : forwardTarget.authorName || 'Пользователь';
    const quote = forwardTarget.text ? '«' + forwardTarget.text + '»' : '[медиа-комментарий]';
    const videoUrl = getForwardVideoUrl();
    const text =
      '💬 Комментарий ' + auth + ': ' + quote + (videoUrl ? '\n' + videoUrl : '');
    await window.commentsApi.copyText(text);
    toast('Комментарий скопирован');
    closeForwardSheet();
  });

  els.forwardActiveChatBtn.addEventListener('click', () => {
    if (!forwardActiveHeader || !forwardActiveHeader.name) return;
    submitForwardComment([
      {
        id: (forwardActiveHeader.handle || forwardActiveHeader.name).toLowerCase(),
        name: forwardActiveHeader.name,
        handle: forwardActiveHeader.handle || '',
        avatar: forwardActiveHeader.avatar || ''
      }
    ]);
  });
}

function getForwardVideoUrl() {
  if (!currentData) return '';
  if (currentData.videoUrl) return currentData.videoUrl;
  if (currentData.videoId && /^\d{12,}$/.test(String(currentData.videoId))) {
    const cleanAuth = String(currentData.authorHandle || '').replace(/^@/, '').trim();
    return cleanAuth
      ? 'https://www.tiktok.com/@' + cleanAuth + '/video/' + currentData.videoId
      : 'https://www.tiktok.com/@_/video/' + currentData.videoId;
  }
  return '';
}

function getForwardVideoMeta() {
  return {
    videoId: (currentData && currentData.videoId) || '',
    videoUrl: getForwardVideoUrl(),
    authorHandle: (currentData && currentData.authorHandle) || '',
    authorName: (currentData && currentData.authorName) || 'TikTok',
    desc: (currentData && currentData.desc) || ''
  };
}

async function openForwardSheet(comment) {
  if (!comment || !els.forwardSheet) return;
  forwardTarget = {
    cid: comment.cid || '',
    authorName: comment.authorName || 'Пользователь',
    authorHandle: comment.authorHandle || '',
    text: comment.text || '',
    avatar: comment.avatar || ''
  };
  forwardSelectedIds.clear();
  els.forwardSearchInput.value = '';
  els.forwardNoteInput.value = '';

  const authLabel = forwardTarget.authorHandle
    ? '@' + String(forwardTarget.authorHandle).replace(/^@/, '')
    : forwardTarget.authorName;
  els.forwardPreviewAuthor.textContent = authLabel;
  els.forwardPreviewText.textContent = forwardTarget.text
    ? '«' + forwardTarget.text + '»'
    : 'Медиа-комментарий';

  els.forwardSheet.classList.remove('hidden');
  renderForwardContacts();

  try {
    const info = await window.commentsApi.getContacts();
    if (info && Array.isArray(info.contacts)) {
      forwardContacts = info.contacts;
      forwardActiveHeader = info.activeHeader || null;
      if (forwardTarget) renderForwardContacts();
    }
  } catch {}
}

function closeForwardSheet() {
  forwardTarget = null;
  forwardSelectedIds.clear();
  if (els.forwardSheet) els.forwardSheet.classList.add('hidden');
}

function renderForwardContacts() {
  if (!els.forwardSheet || els.forwardSheet.classList.contains('hidden')) return;

  if (forwardActiveHeader && forwardActiveHeader.name) {
    els.forwardActiveChatBtn.textContent = 'Отправить в открытый чат: ' + forwardActiveHeader.name;
    els.forwardActiveChatBtn.classList.remove('hidden');
  } else {
    els.forwardActiveChatBtn.classList.add('hidden');
  }

  const query = els.forwardSearchInput.value.trim().toLowerCase();
  const filtered = query
    ? forwardContacts.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          (c.handle && c.handle.toLowerCase().includes(query))
      )
    : forwardContacts;

  els.forwardEmptyContacts.classList.toggle('hidden', filtered.length > 0);

  const frag = document.createDocumentFragment();
  for (const contact of filtered) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    const isSelected = forwardSelectedIds.has(contact.id);
    btn.className = 'forward-contact-row' + (isSelected ? ' selected' : '');
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', String(isSelected));

    btn.appendChild(createAvatar(contact.avatar, contact.name, false));

    const meta = document.createElement('div');
    meta.className = 'forward-contact-meta';
    const nameEl = document.createElement('span');
    nameEl.className = 'forward-contact-name';
    nameEl.textContent = contact.name;
    const subEl = document.createElement('span');
    subEl.className = 'forward-contact-sub';
    const parts = [];
    if (contact.handle) parts.push('@' + contact.handle);
    if (contact.recent) parts.push('Недавно');
    subEl.textContent = parts.join(' · ') || 'Контакт TikTok';
    meta.appendChild(nameEl);
    meta.appendChild(subEl);
    btn.appendChild(meta);

    const check = document.createElement('span');
    check.className = 'forward-check';
    check.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M5 12.5l4.5 4.5L19 7.5"></path>
      </svg>`;
    btn.appendChild(check);

    btn.addEventListener('click', () => {
      if (forwardSelectedIds.has(contact.id)) forwardSelectedIds.delete(contact.id);
      else forwardSelectedIds.add(contact.id);
      renderForwardContacts();
      updateForwardSendButton();
    });

    li.appendChild(btn);
    frag.appendChild(li);
  }

  els.forwardContactsList.innerHTML = '';
  els.forwardContactsList.appendChild(frag);
  updateForwardSendButton();
}

function updateForwardSendButton() {
  const count = forwardSelectedIds.size;
  els.forwardSendBtn.disabled = count === 0 || forwardSending;
  els.forwardSendBtn.textContent = forwardSending
    ? 'Отправка…'
    : count > 1
      ? 'Отправить (' + count + ')'
      : 'Отправить';
}

async function submitForwardComment(overrideContacts) {
  if (forwardSending || !forwardTarget) return;
  const chosen =
    Array.isArray(overrideContacts) && overrideContacts.length
      ? overrideContacts
      : forwardContacts.filter((c) => forwardSelectedIds.has(c.id));
  if (!chosen.length) return;

  forwardSending = true;
  updateForwardSendButton();

  try {
    const res = await window.commentsApi.forwardComment({
      contacts: chosen,
      comment: forwardTarget,
      video: getForwardVideoMeta(),
      note: els.forwardNoteInput.value.trim()
    });
    if (res && res.ok) {
      const label =
        chosen.length === 1
          ? 'Комментарий отправлен: ' + chosen[0].name
          : 'Комментарий отправлен (' + chosen.length + ')';
      toast(label);
      closeForwardSheet();
    } else if (res && res.loginRequired) {
      toast('Войди в TikTok по QR-коду');
    } else {
      toast('Не удалось переслать — проверь вход в TikTok');
    }
  } finally {
    forwardSending = false;
    updateForwardSendButton();
  }
}
