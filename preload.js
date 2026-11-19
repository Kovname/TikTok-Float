'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appApi', {
  getState: () => ipcRenderer.invoke('app:get-state'),
  setState: (patch) => ipcRenderer.invoke('app:set-state', patch),
  recordRecentContacts: (contacts) =>
    ipcRenderer.invoke('contacts:record-recent', contacts),
  copyText: (text) => ipcRenderer.invoke('app:copy-text', text),

  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  cycleSize: () => ipcRenderer.invoke('window:cycle-size'),
  setPresetSize: (presetId) => ipcRenderer.invoke('window:set-preset', presetId),
  scaleWindow: (deltaSteps) => ipcRenderer.invoke('window:scale', deltaSteps),
  startResize: (edge) =>
    ipcRenderer.send('window:resize-start', { target: 'main', edge }),
  updateResize: (freeAspect) =>
    ipcRenderer.send('window:resize-move', { target: 'main', freeAspect }),
  endResize: () => ipcRenderer.send('window:resize-end', { target: 'main' }),
  openExternal: (url) => ipcRenderer.send('app:open-external', url),

  trustedClick: (x, y, webContentsId) =>
    ipcRenderer.invoke('webview:trusted-click', { x, y, webContentsId }),
  trustedKey: (keyCode, webContentsId) =>
    ipcRenderer.invoke('webview:trusted-key', { keyCode, webContentsId }),
  activateFeed: (webContentsId) =>
    ipcRenderer.invoke('webview:activate', { webContentsId }),

  toggleComments: (payload) => ipcRenderer.invoke('comments:toggle', payload),
  openComments: (payload) => ipcRenderer.invoke('comments:open', payload),
  closeComments: () => ipcRenderer.send('comments:close'),
  pushCommentsData: (data) => ipcRenderer.send('comments:data', data),

  toggleMessages: () => ipcRenderer.invoke('messages:toggle'),
  openMessages: () => ipcRenderer.invoke('messages:open'),
  closeMessages: () => ipcRenderer.send('messages:close'),
  warmDmEngine: () => ipcRenderer.invoke('dm:warm'),
  sendVideoViaDm: (payload) => ipcRenderer.invoke('dm:send-video-fallback', payload),

  onStateChanged: (callback) => {
    ipcRenderer.on('state:changed', (_event, next) => callback(next));
  },
  onCommentsWindowState: (callback) => {
    ipcRenderer.on('comments:window-state', (_event, next) => callback(next));
  },
  onCommentsAction: (callback) => {
    ipcRenderer.on('comments:action', (_event, action) => callback(action));
  },
  onMessagesWindowState: (callback) => {
    ipcRenderer.on('messages:window-state', (_event, next) => callback(next));
  },
  onMessagesOpenVideo: (callback) => {
    ipcRenderer.on('messages:open-video', (_event, payload) => callback(payload));
  },
  onMessagesContacts: (callback) => {
    ipcRenderer.on('messages:contacts', (_event, contacts) => callback(contacts));
  },
  onMessagesUnread: (callback) => {
    ipcRenderer.on('messages:unread', (_event, count) => callback(count));
  },
  onMessagesOpenLogin: (callback) => {
    ipcRenderer.on('messages:open-login', () => callback());
  },
  onShareOpenForComment: (callback) => {
    ipcRenderer.on('share:open-for-comment', (_event, payload) => callback(payload));
  },
  onWindowBounds: (callback) => {
    ipcRenderer.on('window:bounds', (_event, info) => callback(info));
  },
  platform: process.platform
});
