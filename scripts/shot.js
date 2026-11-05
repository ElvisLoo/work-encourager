/**
 * 截图脚本：用 Electron 真实渲染 index.html 并存 PNG
 * 用法：npm run shot（后台） 或 node scripts/shot.js
 */
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, '..', '.qa');
const PRELOAD_SRC = path.join(__dirname, '..', 'src', 'preload.js');
const PRELOAD_STUB = path.join(OUT_DIR, 'preload-stub.js');

// 渲染层依赖 window.desktop，这里给一个只读桩，模拟已保存过配置的用户
const STUB = `
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  getVersion: async () => '1.0.0',
  toggleAlwaysOnTop: async () => true,
  toggleMini: async () => false,
  startMini: async () => false,
  openMain: async () => true,
  setAutoStart: async () => true,
  exportConfig: async () => null,
  updateTicker: () => {}
});
`;

const SEED = `
localStorage.setItem('niuniu-encourager:settings:v1', JSON.stringify({
  monthlySalary: 12000, workdaysPerMonth: 21,
  workStart: '09:00', workEnd: '18:00',
  lunchEnabled: true, lunchStart: '12:00', lunchEnd: '13:00',
  dinnerEnabled: false, dinnerStart: '18:00', dinnerEnd: '19:00',
  digits: 4, autoStart: false,
  goals: [
    {emoji:'☕',name:'一杯瑞幸',price:13.9},
    {emoji:'🍜',name:'一顿午饭',price:28},
    {emoji:'🎧',name:'无线耳机',price:399},
    {emoji:'📱',name:'换台新手机',price:5999}
  ]
}));
localStorage.setItem('niuniu-encourager:theme', 'paper');
`;

async function shoot(win, name, opts) {
  const file = path.join(OUT_DIR, name);
  await new Promise((r) => setTimeout(r, 700));
  // 按内容真实高度截全页，避免窗口尺寸被系统限制导致截断
  const h = await win.webContents.executeJavaScript(
    'Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)'
  );
  win.setContentSize(600, Math.min(2400, h + 2));
  await new Promise((r) => setTimeout(r, 500));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(file, img.toPNG());
  const { width, height } = img.getSize();
  console.log('saved', name, width + 'x' + height);
}

app.disableHardwareAcceleration();
// 截图使用独立的临时用户目录，保证每次都是干净状态
try {
  const tmp = path.join(require('os').tmpdir(), 'we-shot-profile');
  app.setPath('userData', tmp);
} catch (e) { /* 忽略 */ }

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(PRELOAD_STUB, STUB, 'utf8');

  const win = new BrowserWindow({
    width: 600,
    height: 940,
    show: false,
    backgroundColor: '#efe6d6',
    webPreferences: {
      preload: PRELOAD_STUB,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const indexFile = path.join(__dirname, '..', 'src', 'index.html');
  await win.loadFile(indexFile);

  // 预置配置并刷新，模拟「已经用过的」状态
  await win.webContents.executeJavaScript(SEED, true);
  await win.webContents.reload();
  await new Promise((r) => win.webContents.once('did-finish-load', r));

  // 固定时间到 15:05:35（参考原始截图的时间段）
  await win.webContents.executeJavaScript(`
    (function(){
      const fixed = new Date();
      fixed.setHours(15, 5, 35, 0);
      const realNow = Date.now;
      const offset = fixed.getTime() - realNow();
      Date.now = () => realNow() + offset;
      const RealDate = Date;
      window.Date = class extends RealDate {
        constructor(...a){ if (a.length === 0) super(RealDate.now()); else super(...a); }
        static now(){ return RealDate.now(); }
      };
    })();
  `, true);
  await win.webContents.reload();
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await win.webContents.executeJavaScript(`
    (function(){
      const fixed = new Date();
      fixed.setHours(15, 5, 35, 0);
      const RealDate = Date;
      const offset = fixed.getTime() - RealDate.now();
      window.Date = class extends RealDate {
        constructor(...a){ if (!a.length) super(RealDate.now() + offset); else super(...a); }
        static now(){ return RealDate.now() + offset; }
      };
    })();
  `, true);

  await new Promise((r) => setTimeout(r, 900));
  await shoot(win, 'shot-01-main.png');

  // 深色主题
  await win.webContents.executeJavaScript(`document.getElementById('btnTheme').click(); true`);
  await new Promise((r) => setTimeout(r, 600));
  await shoot(win, 'shot-02-night.png');

  // 打码（截完立刻恢复，避免影响后续截图）
  await win.webContents.executeJavaScript(`document.getElementById('btnMask').click(); true`);
  await shoot(win, 'shot-03-masked.png');
  await win.webContents.executeJavaScript(`document.getElementById('btnMask').click(); document.getElementById('btnTheme').click(); true`);
  await new Promise((r) => setTimeout(r, 400));

  // 设置面板
  await win.webContents.executeJavaScript(`document.getElementById('btnSettings').click(); true`);
  await new Promise((r) => setTimeout(r, 500));
  await shoot(win, 'shot-04-settings.png');

  // 迷你窗
  const mini = new BrowserWindow({
    width: 250,
    height: 132,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: PRELOAD_STUB, contextIsolation: true, nodeIntegration: false }
  });
  await mini.loadFile(indexFile, { query: { mini: '1' } });
  await mini.webContents.executeJavaScript(SEED, true);
  await mini.webContents.reload();
  await new Promise((r) => mini.webContents.once('did-finish-load', r));
  await mini.webContents.executeJavaScript(`
    (function(){
      const fixed = new Date(); fixed.setHours(15,5,35,0);
      const RealDate = Date; const offset = fixed.getTime() - RealDate.now();
      window.Date = class extends RealDate {
        constructor(...a){ if (!a.length) super(RealDate.now()+offset); else super(...a); }
        static now(){ return RealDate.now()+offset; }
      };
      document.body.classList.add('mode-mini');
    })();
  `, true);
  await new Promise((r) => setTimeout(r, 700));
  const mimg = await mini.webContents.capturePage();
  fs.writeFileSync(path.join(OUT_DIR, 'shot-05-mini.png'), mimg.toPNG());
  console.log('saved shot-05-mini.png', mimg.getSize().width + 'x' + mimg.getSize().height);

  // 首次引导页（清空配置后加载）
  const fresh = new BrowserWindow({
    width: 600, height: 720, show: false, backgroundColor: '#efe6d6',
    webPreferences: { preload: PRELOAD_STUB, contextIsolation: true, nodeIntegration: false }
  });
  await fresh.loadFile(indexFile);
  await fresh.webContents.executeJavaScript("localStorage.clear(); true");
  await fresh.webContents.reload();
  await new Promise((r) => fresh.webContents.once('did-finish-load', r));
  await new Promise((r) => setTimeout(r, 1100));
  const fimg = await fresh.webContents.capturePage();
  fs.writeFileSync(path.join(OUT_DIR, 'shot-06-welcome.png'), fimg.toPNG());
  console.log('saved shot-06-welcome.png', fimg.getSize().width + 'x' + fimg.getSize().height);

  app.exit(0);
}).catch((e) => {
  console.error('SHOT FAILED', e);
  app.exit(1);
});
