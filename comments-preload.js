'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('commentsApi', {
  getInitialData: () => ipcRenderer.invoke('comments:get-initial'),
  getContacts: () => ipcRenderer.invoke('comments:get-contacts'),
  forwardComment: (payload) => ipcRenderer.invoke('comments:forward-to-contacts', payload),
  copyText: (text) => ipcRenderer.invoke('app:copy-text', text),
  close: () => ipcRenderer.send('comments:close'),
  toggleDock: () => ipcRenderer.invoke('comments:toggle-dock'),
  startResize: (edge) =>
    ipcRenderer.send('window:resize-start', { target: 'comments', edge }),
  updateResize: () =>
    ipcRenderer.send('window:resize-move', {
      target: 'comments',
      freeAspect: true
    }),
  endResize: () => ipcRenderer.send('window:resize-end', { target: 'comments' }),
  sendAction: (action) => ipcRenderer.send('comments:action-from-panel', action),

  onData: (callback) => {
    ipcRenderer.on('comments:data', (_event, payload) => callback(payload));
  },
  onContacts: (callback) => {
    ipcRenderer.on('comments:contacts', (_event, info) => callback(info));
  },
  onWindowState: (callback) => {
    ipcRenderer.on('comments:window-state', (_event, next) => callback(next));
  },
  platform: process.platform
});
