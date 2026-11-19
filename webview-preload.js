'use strict';

const { ipcRenderer, webFrame } = require('electron');

/**
 * Прелоад гостевого <webview> TikTok.
 * Пассивно читает JSON-ответы ленты, комментариев, лайков, репостов и списка контактов,
 * не изменяя запросы/заголовки TikTok, и пересылает события контроллера в хост.
 */
const EARLY_NET_TAP = `(() => {
  if (window.__TTF_NET_TAP_V2__) return;
  window.__TTF_NET_TAP__ = true;
  window.__TTF_NET_TAP_V2__ = true;

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
  if (!('lastDigg' in store)) store.lastDigg = null;
  if (!('lastRepost' in store)) store.lastRepost = null;

  function emit(kind, payload) {
    for (const fn of store.listeners) {
      try { fn(kind, payload); } catch {}
    }
  }

  function firstUrl(obj) {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    if (Array.isArray(obj.url_list) && obj.url_list.length) return obj.url_list[0];
    if (Array.isArray(obj.urlList) && obj.urlList.length) return obj.urlList[0];
    return '';
  }

  function pickAvatar(user) {
    if (!user) return '';
    return (
      firstUrl(user.avatar_thumb) ||
      firstUrl(user.avatarThumb) ||
      firstUrl(user.avatar_medium) ||
      firstUrl(user.avatarLarger) ||
      firstUrl(user.avatar_larger) ||
      firstUrl(user.avatar) ||
      ''
    );
  }

  function addContact(u, orderHint) {
    if (!u || typeof u !== 'object') return;
    const handle = String(u.unique_id || u.uniqueId || u.handle || '').replace(/^@/, '').trim();
    const uid = String(u.uid || u.id || u.sec_uid || u.secUid || handle || '').trim();
    const name = String(u.nickname || u.nick_name || u.displayName || handle || '').trim();
    if (!uid && !handle && !name) return;
    const key = (handle || uid || name).toLowerCase();
    const prev = store.contacts.get(key) || {};
    store.contacts.set(key, {
      id: uid || prev.id || key,
      secUid: String(u.sec_uid || u.secUid || prev.secUid || ''),
      handle: handle || prev.handle || '',
      name: name || prev.name || handle || 'Пользователь',
      avatar: pickAvatar(u) || prev.avatar || '',
      order: typeof orderHint === 'number' ? orderHint : (prev.order ?? store.contacts.size)
    });
  }

  function extractCommentMedia(c) {
    const images = [];
    if (Array.isArray(c.image_list)) {
      for (const img of c.image_list) {
        if (!img) continue;
        const thumb =
          firstUrl(img.medium_url) ||
          firstUrl(img.crop_url) ||
          firstUrl(img.origin_url) ||
          firstUrl(img);
        const full = firstUrl(img.origin_url) || thumb;
        if (thumb) {
          images.push({ thumb, full, kind: 'photo' });
        }
      }
    }

    let sticker = null;
    if (c.sticker && typeof c.sticker === 'object') {
      const anim =
        firstUrl(c.sticker.animate_url) ||
        firstUrl(c.sticker.webp_url) ||
        firstUrl(c.sticker.gif_url);
      const stat = firstUrl(c.sticker.static_url);
      const src = anim || stat;
      if (src) {
        sticker = {
          thumb: src,
          full: src,
          kind: anim ? 'gif' : 'sticker',
          width: Number(c.sticker.width || 0),
          height: Number(c.sticker.height || 0)
        };
      }
    }

    return { images, sticker };
  }

  function normalizeComment(c) {
    if (!c || typeof c !== 'object') return null;
    const cid = String(c.cid || c.id || '');
    const user = c.user || {};
    const media = extractCommentMedia(c);
    return {
      cid: cid || 'c_' + Math.random().toString(36).slice(2, 10),
      awemeId: String(c.aweme_id || ''),
      text: String(c.text || '').trim(),
      createTime: Number(c.create_time || 0),
      diggCount: Number(c.digg_count || 0),
      userDigged: Boolean(c.user_digged === 1 || c.user_digged === true),
      replyCount: Number(c.reply_comment_total || 0),
      isAuthorDigged: Boolean(c.is_author_digged),
      labelText: String(c.label_text || ''),
      authorName: String(user.nickname || user.unique_id || 'Пользователь'),
      authorHandle: String(user.unique_id || ''),
      avatar: pickAvatar(user),
      replyToUser: c.reply_to_username ? String(c.reply_to_username) : '',
      images: media.images,
      sticker: media.sticker,
      source: 'api'
    };
  }

  function handleJson(url, data) {
    if (!data || typeof data !== 'object') return;

    if (url.includes('/item/digg') || url.includes('/commit/item/digg')) {
      const isDiggMatch = url.match(/[?&]type=(\d+)/);
      const inferredDigg =
        typeof data.is_digg === 'number'
          ? data.is_digg
          : isDiggMatch
            ? Number(isDiggMatch[1])
            : undefined;
      const awemeMatch = url.match(/[?&]aweme_id=([^&]+)/);
      const awemeId = awemeMatch ? decodeURIComponent(awemeMatch[1]) : '';
      store.lastDigg = {
        at: Date.now(),
        statusCode: Number(data.status_code ?? data.statusCode ?? 0),
        isDigg: inferredDigg,
        awemeId
      };
      if (awemeId && store.videos.has(awemeId) && typeof inferredDigg === 'number') {
        store.videos.get(awemeId).liked = inferredDigg === 1;
      }
      emit('digg', store.lastDigg);
      return;
    }

    let repostPath = '';
    try { repostPath = new URL(url, location.href).pathname; } catch { repostPath = url.split('?')[0]; }
    if (
      /(?:upvote|repost)/i.test(repostPath) &&
      /\/(?:create|delete|remove|cancel|commit|add|del)(?:\/|$)/i.test(repostPath)
    ) {
      const awemeMatch = url.match(/[?&](?:item_id|aweme_id)=([^&]+)/);
      const awemeId =
        (awemeMatch ? decodeURIComponent(awemeMatch[1]) : '') ||
        String(data.item_id || data.aweme_id || '');
      const isRemove = /delete|remove|cancel/i.test(url);
      store.lastRepost = {
        at: Date.now(),
        statusCode: Number(data.status_code ?? data.statusCode ?? (data.ok === false ? -1 : 0)),
        awemeId,
        reposted: !isRemove,
        url
      };
      if (awemeId && store.videos.has(awemeId) && store.lastRepost.statusCode === 0) {
        store.videos.get(awemeId).reposted = !isRemove;
      }
      emit('repost', store.lastRepost);
      return;
    }

    if (
      url.includes('/api/recommend/item_list') ||
      url.includes('/api/post/item_list') ||
      url.includes('/api/preload/item_list') ||
      url.includes('/api/item/detail')
    ) {
      const list = Array.isArray(data.itemList)
        ? data.itemList
        : data.itemInfo && data.itemInfo.itemStruct
          ? [data.itemInfo.itemStruct]
          : [];
      for (const item of list) {
        if (!item || !item.id) continue;
        const id = String(item.id);
        const author = item.author || {};
        const stats = item.stats || item.statsV2 || {};
        const music = item.music || {};
        store.videos.set(id, {
          id,
          desc: String(item.desc || ''),
          authorHandle: String(author.uniqueId || ''),
          authorName: String(author.nickname || author.uniqueId || ''),
          avatar: pickAvatar(author),
          musicTitle: String(music.title || ''),
          musicAuthor: String(music.authorName || ''),
          likes: Number(stats.diggCount || 0),
          comments: Number(stats.commentCount || 0),
          shares: Number(stats.shareCount || 0),
          liked: Boolean(item.digged),
          reposted: Boolean(item.isReposted)
        });
      }
      emit('feed', { count: list.length });
      return;
    }

    if (url.includes('/comment/list/reply')) {
      const rawList = Array.isArray(data.comments) ? data.comments : [];
      const parsed = rawList.map(normalizeComment).filter(Boolean);
      const commentIdMatch = url.match(/[?&]comment_id=([^&]+)/);
      const parentId = commentIdMatch ? decodeURIComponent(commentIdMatch[1]) : '';
      if (parentId && parsed.length) {
        const existing = store.repliesByComment.get(parentId) || [];
        const map = new Map(existing.map((item) => [item.cid, item]));
        for (const item of parsed) map.set(item.cid, item);
        store.repliesByComment.set(parentId, Array.from(map.values()));
        emit('replies', { parentId });
      }
      return;
    }

    if (url.includes('/comment/list')) {
      const rawList = Array.isArray(data.comments) ? data.comments : [];
      const parsed = rawList.map(normalizeComment).filter(Boolean);
      const awemeMatch = url.match(/[?&]aweme_id=([^&]+)/);
      const awemeId =
        (awemeMatch ? decodeURIComponent(awemeMatch[1]) : '') ||
        (parsed[0] && parsed[0].awemeId) ||
        '';
      if (awemeId) {
        store.lastAwemeId = awemeId;
        const prev = store.commentsByVideo.get(awemeId) || {
          items: [],
          hasMore: false,
          total: 0
        };
        const map = new Map(prev.items.map((item) => [item.cid, item]));
        for (const item of parsed) {
          const old = map.get(item.cid);
          map.set(item.cid, old ? { ...old, ...item } : item);
        }
        store.commentsByVideo.set(awemeId, {
          items: Array.from(map.values()),
          hasMore: Boolean(data.has_more === 1 || data.has_more === true),
          total: Math.max(Number(data.total || 0), prev.total || 0, map.size)
        });
        emit('comments', { awemeId });
      }
      return;
    }

    if (url.includes('/comment/publish')) {
      const created = data.comment ? normalizeComment(data.comment) : null;
      if (created && created.awemeId) {
        const prev = store.commentsByVideo.get(created.awemeId) || {
          items: [],
          hasMore: false,
          total: 0
        };
        const items = [created, ...prev.items.filter((x) => x.cid !== created.cid)];
        store.commentsByVideo.set(created.awemeId, {
          items,
          hasMore: prev.hasMore,
          total: Math.max(prev.total + 1, items.length)
        });
        emit('comment-published', { awemeId: created.awemeId, comment: created });
      }
      return;
    }

    if (
      url.includes('/api/im/') ||
      url.includes('/api/user/list') ||
      url.includes('/api/share/') ||
      url.includes('/tiktok/v1/im/') ||
      url.includes('spotlight/relation') ||
      url.includes('share_list')
    ) {
      const lists = [
        data.userList,
        data.user_list,
        data.followings,
        data.friends,
        data.contacts,
        data.recent_contacts,
        data.users
      ];
      let added = 0;
      for (const arr of lists) {
        if (!Array.isArray(arr)) continue;
        arr.forEach((entry, idx) => {
          const u = entry && entry.user ? entry.user : entry;
          if (u && typeof u === 'object') {
            addContact(u, idx);
            added++;
          }
        });
      }
      if (added > 0) emit('contacts', { count: store.contacts.size });
    }
  }

  function watchUrl(url) {
    return (
      url.includes('/comment/') ||
      url.includes('/api/recommend/item_list') ||
      url.includes('/api/post/item_list') ||
      url.includes('/api/preload/item_list') ||
      url.includes('/api/item/detail') ||
      url.includes('/item/digg') ||
      url.includes('upvote') ||
      url.includes('repost') ||
      url.includes('/api/im/') ||
      url.includes('/api/user/list') ||
      url.includes('/api/share/') ||
      url.includes('/tiktok/v1/im/') ||
      url.includes('spotlight/relation') ||
      url.includes('share_list')
    );
  }

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (...args) {
      const promise = origFetch.apply(this, args);
      try {
        const req = args[0];
        const url = typeof req === 'string' ? req : (req && req.url) || '';
        if (watchUrl(url)) {
          promise
            .then((res) => {
              if (!res || !res.ok) return;
              return res.clone().json().then((json) => handleJson(url, json));
            })
            .catch(() => {});
        }
      } catch {}
      return promise;
    };
  }

  const OrigXHR = window.XMLHttpRequest;
  if (OrigXHR && OrigXHR.prototype) {
    const origOpen = OrigXHR.prototype.open;
    const origSend = OrigXHR.prototype.send;

    OrigXHR.prototype.open = function (method, url) {
      this.__ttfUrl = typeof url === 'string' ? url : '';
      return origOpen.apply(this, arguments);
    };

    OrigXHR.prototype.send = function () {
      const url = this.__ttfUrl || '';
      if (watchUrl(url)) {
        this.addEventListener('load', function () {
          try {
            if (this.status >= 200 && this.status < 300 && this.responseText) {
              handleJson(url, JSON.parse(this.responseText));
            }
          } catch {}
        });
      }
      return origSend.apply(this, arguments);
    };
  }
})();`;

try {
  webFrame.executeJavaScript(EARLY_NET_TAP).catch(() => {});
} catch {}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || typeof data !== 'object' || data.__ttfBridge !== true) return;
  try {
    ipcRenderer.sendToHost('ttf:event', data.payload);
  } catch {}
});
