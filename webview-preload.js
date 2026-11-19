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
    liveIds: new Set(),
    commentsByVideo: new Map(),
    repliesByComment: new Map(),
    contacts: new Map(),
    stories: new Map(),
    lastAwemeId: null,
    lastDigg: null,
    lastRepost: null,
    listeners: []
  });
  if (!store.liveIds) store.liveIds = new Set();
  if (!store.contacts) store.contacts = new Map();
  if (!store.stories) store.stories = new Map();
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
      // ВАЖНО: в TikTok 2026 сервер возвращает data.is_digg === 0 даже при успешной постановке лайка!
      // Поэтому направление лайка берём ТОЛЬКО из query-параметра type=1/0, иначе доверяем DOM aria-pressed.
      const isDiggMatch = url.match(/[?&]type=(\d+)/);
      const inferredDigg = isDiggMatch ? Number(isDiggMatch[1]) : undefined;
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
      (/\/(?:create|delete|remove|cancel|commit|add|del)(?:\/|$)/i.test(repostPath) ||
        /[?&](?:action_type|type)=/i.test(url))
    ) {
      const awemeMatch = url.match(/[?&](?:item_id|aweme_id)=([^&]+)/);
      const awemeId =
        (awemeMatch ? decodeURIComponent(awemeMatch[1]) : '') ||
        String(data.item_id || data.aweme_id || '');
      const isRemove =
        /delete|remove|cancel|\/del(?:\/|$)/i.test(repostPath) ||
        /[?&](?:action_type=(?:2|0)|type=0)/i.test(url) ||
        data.upvote_status === 0 ||
        data.is_reposted === false;
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
        const itemRoomId = String(item.roomId || item.room_id || '');
        const isLiveItem = Boolean(
          Number(item.aweme_type ?? item.awemeType) === 101 ||
          item.liveRoomInfo ||
          item.live_room ||
          item.live_room_info ||
          item.cellRoom ||
          item.cell_room ||
          item.rawLiveData ||
          item.liveRoom ||
          item.liveData ||
          item.live_data ||
          item.isLive === true ||
          item.is_live === true ||
          /^live$/i.test(String(item.cardType || item.itemType || '')) ||
          (itemRoomId && itemRoomId !== '0' && (!item.video || !Number(item.video.duration)))
        );
        if (isLiveItem) {
          store.liveIds.add(id);
          if (itemRoomId && itemRoomId !== '0') store.liveIds.add(itemRoomId);
        }
        const author = item.author || {};
        const stats = item.stats || item.statsV2 || {};
        const music = item.music || {};
        store.videos.set(id, {
          id,
          isLive: isLiveItem,
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
      const parsedAll = rawList.map(normalizeComment).filter(Boolean);
      const awemeMatch = url.match(/[?&]aweme_id=([^&]+)/);
      const awemeId =
        (awemeMatch ? decodeURIComponent(awemeMatch[1]) : '') ||
        (parsedAll[0] && parsedAll[0].awemeId) ||
        '';
      if (awemeId) {
        const parsed = parsedAll.filter((c) => !c.awemeId || c.awemeId === awemeId);
        store.lastAwemeId = awemeId;
        const prev = store.commentsByVideo.get(awemeId) || {
          items: [],
          hasMore: false,
          total: 0,
          loaded: false
        };
        const map = new Map(prev.items.map((item) => [item.cid, item]));
        for (const item of parsed) {
          const old = map.get(item.cid);
          map.set(item.cid, old ? { ...old, ...item } : item);
        }
        store.commentsByVideo.set(awemeId, {
          items: Array.from(map.values()),
          hasMore: Boolean(data.has_more === 1 || data.has_more === true),
          total: Math.max(Number(data.total || 0), prev.total || 0, map.size),
          loaded: true
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

    if (url.includes('/api/story/user_list') || url.includes('/api/story/batch/item_list')) {
      let updated = false;
      const upsertStoryUser = (u, extra) => {
        if (!u || typeof u !== 'object') return;
        const uid = String(u.id || u.uid || (extra && extra.authorId) || '').trim();
        const handle = String(u.uniqueId || u.unique_id || '').replace(/^@/, '').trim();
        const name = String(u.nickname || handle || '').trim();
        if (!name && !handle) return;
        const key = uid || handle.toLowerCase() || name.toLowerCase();
        const prev = store.stories.get(key) || {};
        const nextHandle = handle || prev.handle || '';
        const itemId = (extra && extra.firstItemId) || prev.firstItemId || '';
        const isPhoto = Boolean((extra && extra.isPhoto) || prev.isPhoto);
        const directUrl =
          itemId && nextHandle
            ? 'https://www.tiktok.com/@' + nextHandle + '/' + (isPhoto ? 'photo' : 'video') + '/' + itemId
            : itemId
              ? 'https://www.tiktok.com/@_/' + (isPhoto ? 'photo' : 'video') + '/' + itemId
              : nextHandle
                ? 'https://www.tiktok.com/@' + nextHandle
                : prev.url || '';
        store.stories.set(key, {
          id: key,
          authorId: uid || prev.authorId || '',
          name: name || prev.name || nextHandle,
          handle: nextHandle,
          avatar: pickAvatar(u) || prev.avatar || '',
          url: directUrl,
          firstItemId: itemId,
          isPhoto,
          storyCount: Number((extra && extra.storyCount) || prev.storyCount || 1),
          allViewed: typeof (extra && extra.allViewed) === 'boolean'
            ? extra.allViewed
            : typeof prev.allViewed === 'boolean'
              ? prev.allViewed
              : u.UserStoryStatus === 2,
          hasStory: true,
          hasActiveRing: true,
          order: prev.order ?? store.stories.size
        });
        updated = true;
      };

      if (Array.isArray(data.storyUsers)) {
        for (const entry of data.storyUsers) {
          const u = entry && entry.user ? entry.user : entry;
          upsertStoryUser(u, null);
        }
      }
      if (Array.isArray(data.batchStoryItemLists)) {
        for (const batch of data.batchStoryItemLists) {
          if (!batch || !Array.isArray(batch.itemList) || !batch.itemList.length) continue;
          const firstItem = batch.itemList[0];
          const author = firstItem && firstItem.author ? firstItem.author : null;
          const firstItemId = String((firstItem && (firstItem.id || firstItem.aweme_id)) || '');
          const isPhoto = Boolean(firstItem && (firstItem.imagePost || Number(firstItem.aweme_type) === 150));
          upsertStoryUser(author || { id: batch.AuthorId }, {
            authorId: String(batch.AuthorId || ''),
            firstItemId,
            isPhoto,
            storyCount: Number(batch.TotalCount || batch.itemList.length || 1),
            allViewed: Boolean(batch.AllViewed)
          });
        }
      }
      if (updated) {
        const list = Array.from(store.stories.values()).sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
        emit('stories', list);
        try {
          window.postMessage({ __ttfBridge: true, payload: { type: 'stories', data: list } }, '*');
        } catch {}
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
      url.includes('/api/story/user_list') ||
      url.includes('/api/story/batch/item_list') ||
      url.includes('/api/im/') ||
      url.includes('/api/user/list') ||
      url.includes('/api/share/') ||
      url.includes('/tiktok/v1/im/') ||
      url.includes('spotlight/relation') ||
      url.includes('share_list')
    );
  }

  function attachNetHooks() {
    const curFetch = window.fetch;
    if (typeof curFetch === 'function' && !curFetch.__ttfWrapped) {
      const wrappedFetch = function (...args) {
        const promise = curFetch.apply(this, args);
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
      wrappedFetch.__ttfWrapped = true;
      try { window.fetch = wrappedFetch; } catch {}
    }

    const OrigXHR = window.XMLHttpRequest;
    if (OrigXHR && OrigXHR.prototype && !OrigXHR.prototype.open.__ttfWrapped) {
      const origOpen = OrigXHR.prototype.open;
      const origSend = OrigXHR.prototype.send;

      const wrappedOpen = function (method, url) {
        this.__ttfUrl = typeof url === 'string' ? url : '';
        return origOpen.apply(this, arguments);
      };
      wrappedOpen.__ttfWrapped = true;

      const wrappedSend = function () {
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
      wrappedSend.__ttfWrapped = true;

      try {
        OrigXHR.prototype.open = wrappedOpen;
        OrigXHR.prototype.send = wrappedSend;
      } catch {}
    }
  }

  attachNetHooks();
  document.addEventListener('DOMContentLoaded', attachNetHooks);
  window.addEventListener('load', attachNetHooks);
  setTimeout(attachNetHooks, 900);
  setTimeout(attachNetHooks, 2400);
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
  if (data.payload && data.payload.type === 'stories') {
    try {
      ipcRenderer.send('stories:update-from-api', data.payload.data);
    } catch {}
  }
});
