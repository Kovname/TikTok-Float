'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('messagesApi', {
  getInitialState: () => ipcRenderer.invoke('messages:get-initial'),
  close: () => ipcRenderer.send('messages:close'),
  toggleDock: () => ipcRenderer.invoke('messages:toggle-dock'),
  refresh: () => ipcRenderer.invoke('messages:refresh'),
  openChat: (payload) => ipcRenderer.invoke('messages:open-chat', payload),
  sendMessage: (text) => ipcRenderer.invoke('messages:send-message', text),
  loadOlder: () => ipcRenderer.invoke('messages:load-older'),
  openVideoInPlayer: (payload) => ipcRenderer.invoke('messages:open-video', payload),
  forwardComment: (payload) => ipcRenderer.invoke('comments:forward-to-contacts', payload),
  getShareContacts: () => ipcRenderer.invoke('comments:get-contacts'),
  copyText: (text) => ipcRenderer.invoke('app:copy-text', text),
  openQrLogin: () => ipcRenderer.send('messages:open-login'),

  startResize: (edge) =>
    ipcRenderer.send('window:resize-start', { target: 'messages', edge }),
  updateResize: () =>
    ipcRenderer.send('window:resize-move', {
      target: 'messages',
      freeAspect: true
    }),
  endResize: () => ipcRenderer.send('window:resize-end', { target: 'messages' }),

  onSnapshot: (callback) => {
    ipcRenderer.on('messages:snapshot', (_event, snapshot) => callback(snapshot));
  },
  onWindowState: (callback) => {
    ipcRenderer.on('messages:window-state', (_event, next) => callback(next));
  },
  platform: process.platform
});
