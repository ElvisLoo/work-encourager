/**
 * preload.js — 渲染进程与主进程之间的最小桥
 * 只暴露必要的、无副作用的方法，渲染层拿不到 Node 能力。
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  getVersion: () => ipcRenderer.invoke('app:version'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('win:toggle-always-on-top'),
  toggleMini: () => ipcRenderer.invoke('win:toggle-mini'),
  startMini: () => ipcRenderer.invoke('win:start-mini'),
  openMain: () => ipcRenderer.invoke('win:open-main'),
  setAutoStart: (v) => ipcRenderer.invoke('app:set-auto-start', v),
  exportConfig: (json) => ipcRenderer.invoke('app:export-config', json),
  updateTicker: (text) => ipcRenderer.send('ticker:update', text)
});
