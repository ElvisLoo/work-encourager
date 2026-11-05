/**
 * main.js — Electron 主进程
 * 主窗口 + 系统托盘 + 迷你悬浮窗 + 开机自启 + 配置导出
 */
'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = !app.isPackaged;
const PRELOAD = path.join(__dirname, 'preload.js');
const ICON_PNG = path.join(__dirname, '..', 'build', 'icon.png');

let mainWin = null;
let miniWin = null;
let tray = null;
let quitting = false;

/* ---------- 单实例 ---------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (miniWin && miniWin.isVisible()) miniWin.show();
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.show();
      mainWin.focus();
    } else {
      createMainWindow();
    }
  });
}

/* ---------- 主窗口 ---------- */
function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 600,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    show: false,
    backgroundColor: '#efe6d6',
    title: '牛马鼓励器',
    icon: ICON_PNG,
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  mainWin.loadFile(path.join(__dirname, 'index.html'));

  mainWin.once('ready-to-show', () => {
    mainWin.show();
    if (isDev && process.env.OPEN_DEVTOOLS) mainWin.webContents.openDevTools({ mode: 'detach' });
  });

  // 记住窗口大小与位置
  const state = readWindowState();
  if (state && state.mainBounds) {
    try { mainWin.setBounds(state.mainBounds); } catch (e) { /* 屏幕变化时忽略 */ }
  }
  mainWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      saveWindowState({ mainBounds: mainWin.getBounds() });
      mainWin.hide();
    }
  });
  mainWin.on('closed', () => { mainWin = null; });

  // 内部链接用系统浏览器打开
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  return mainWin;
}

/* ---------- 迷你悬浮窗 ---------- */
function createMiniWindow() {
  if (miniWin && !miniWin.isDestroyed()) return miniWin;

  const state = readWindowState();
  const w = 250, h = 132;
  let x = null, y = null;
  if (state && state.miniBounds) {
    // 校验位置仍在可见屏幕内，避免换显示器后窗口跑到看不见的地方
    const disp = screen.getDisplayMatching(state.miniBounds);
    const b = disp.workArea;
    const s = state.miniBounds;
    if (s.x >= b.x - 20 && s.y >= b.y - 20 &&
        s.x < b.x + b.width - 40 && s.y < b.y + b.height - 40) {
      x = s.x; y = s.y;
    }
  }
  if (x === null) {
    const b = screen.getPrimaryDisplay().workArea;
    x = b.x + b.width - w - 24;
    y = b.y + 24;
  }

  miniWin = new BrowserWindow({
    width: w,
    height: h,
    minWidth: 200,
    minHeight: 110,
    x: Math.round(x),
    y: Math.round(y),
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    title: '牛马鼓励器',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  miniWin.loadFile(path.join(__dirname, 'index.html'), { query: { mini: '1' } });
  miniWin.once('ready-to-show', () => {
    miniWin.show();
    miniWin.webContents.executeJavaScript(
      "document.body.classList.add('mode-mini')", true
    ).catch(() => {});
  });

  miniWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      hideMini();
    }
  });
  miniWin.on('moved', () => saveWindowState({ miniBounds: miniWin.getBounds() }));
  miniWin.on('resized', () => saveWindowState({ miniBounds: miniWin.getBounds() }));
  miniWin.on('closed', () => { miniWin = null; });

  return miniWin;
}

function showMini() {
  const w = createMiniWindow();
  w.show();
  w.setAlwaysOnTop(true, 'floating');
  return true;
}

function hideMini() {
  if (miniWin && !miniWin.isDestroyed()) miniWin.hide();
  return false;
}

function toggleMini() {
  if (miniWin && miniWin.isVisible()) return hideMini();
  return showMini();
}

/* ---------- 窗口状态持久化 ---------- */
function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function readWindowState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return null; }
}

function saveWindowState(patch) {
  try {
    const cur = readWindowState() || {};
    fs.writeFileSync(stateFile(), JSON.stringify(Object.assign(cur, patch)));
  } catch (e) { /* 写失败不影响使用 */ }
}

/* ---------- 托盘 ---------- */
function buildTray() {
  let img = nativeImage.createFromPath(ICON_PNG);
  if (img.isEmpty()) {
    // 兜底：画一个纯色方块，保证托盘图标不空
    img = nativeImage.createEmpty();
  } else {
    img = img.resize({ width: 16, height: 16, quality: 'best' });
  }

  tray = new Tray(img);
  tray.setToolTip('牛马鼓励器 · ¥0.00');

  const menu = Menu.buildFromTemplate([
    { label: '打开主面板', click: () => { if (!mainWin) createMainWindow(); mainWin.show(); mainWin.focus(); } },
    { label: '迷你悬浮窗', click: () => { toggleMini(); } },
    { type: 'separator' },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--autostart'] });
        if (mainWin) mainWin.webContents.send('autostart:changed', item.checked);
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => { quitting = true; app.quit(); }
    }
  ]);
  tray.setContextMenu(menu);

  tray.on('click', () => {
    if (!mainWin) createMainWindow();
    if (mainWin.isVisible() && mainWin.isFocused()) mainWin.hide();
    else { mainWin.show(); mainWin.focus(); }
  });
}

/* ---------- IPC ---------- */
ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('win:toggle-always-on-top', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return false;
  const next = !win.isAlwaysOnTop();
  win.setAlwaysOnTop(next, 'floating');
  return next;
});

ipcMain.handle('win:toggle-mini', () => toggleMini());
ipcMain.handle('win:start-mini', () => showMini());

ipcMain.handle('win:open-main', () => {
  if (!mainWin) createMainWindow();
  mainWin.show();
  mainWin.focus();
  return true;
});

ipcMain.handle('app:set-auto-start', (e, enabled) => {
  const opts = { openAtLogin: !!enabled, args: ['--autostart'] };
  if (process.platform === 'win32') opts.path = process.execPath;
  app.setLoginItemSettings(opts);
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('app:export-config', async (e, json) => {
  const win = BrowserWindow.fromWebContents(e.sender) || mainWin;
  const res = await dialog.showSaveDialog(win, {
    title: '导出配置',
    defaultPath: 'work-encourager-config.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePath) return null;
  fs.writeFileSync(res.filePath, json, 'utf8');
  return res.filePath;
});

// 迷你窗标题数字同步（后续可用于任务栏/托盘提示）
ipcMain.on('ticker:update', (e, text) => {
  if (tray && !tray.isDestroyed()) {
    tray.setToolTip('牛马鼓励器 · ' + text);
    if (process.platform === 'win32') {
      // Windows 托盘不能直接显示文字，用 tooltip 兜底即可
    }
  }
});

/* ---------- 生命周期 ---------- */
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createMainWindow();
  buildTray();

  // 带 --autostart 参数时静默进托盘
  const isAutoStart = process.argv.includes('--autostart');
  if (isAutoStart) {
    mainWin.once('ready-to-show', () => mainWin.hide());
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else if (mainWin) mainWin.show();
  });
});

app.on('before-quit', () => { quitting = true; });

app.on('window-all-closed', () => {
  // 托盘常驻，不随窗口关闭退出（macOS 同样保持后台）
  if (quitting) app.quit();
});
