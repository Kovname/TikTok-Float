'use strict';

const { ipcRenderer } = require('electron');

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || typeof data !== 'object' || data.__ttfDmBridge !== true) return;
  try {
    ipcRenderer.send('dm-engine:event', data.payload);
  } catch {}
});
