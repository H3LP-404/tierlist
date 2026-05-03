const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path  = require('path');
const fs    = require('fs');

const SUPPORTED = new Set(['.jpg','.jpeg','.png','.gif','.webp','.bmp','.svg','.avif']);

// Images folder lives next to the exe (or next to main.js in dev)
const BASE_DIR   = app.isPackaged
  ? path.dirname(process.execPath)
  : path.join(__dirname, '..');
const IMAGES_DIR = path.join(BASE_DIR, 'images');
const SAVE_FILE  = path.join(BASE_DIR, 'tierlist_save.json');

if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

function scanImages() {
  return fs.readdirSync(IMAGES_DIR)
    .filter(f => SUPPORTED.has(path.extname(f).toLowerCase()) && !f.startsWith('.'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function loadSave() {
  try { return JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8')); } catch { return null; }
}

function writeSave(data) {
  fs.writeFileSync(SAVE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ── IPC handlers ────────────────────────────────────────────────────────────
ipcMain.handle('get-state', () => {
  const images = scanImages();
  const saved  = loadSave();
  let state;

  if (saved) {
    saved.queue = (saved.queue || []).filter(f => images.includes(f));
    images.forEach(f => { if (!saved.queue.includes(f)) saved.queue.push(f); });
    (saved.tiers || []).forEach(t => {
      t.images = (t.images || []).filter(f => images.includes(f));
    });
    if ((saved.currentIdx ?? -1) >= saved.queue.length)
      saved.currentIdx = saved.queue.length - 1;
    if ((saved.currentIdx ?? -1) < 0 && saved.queue.length)
      saved.currentIdx = 0;
    state = saved;
  } else {
    state = {
      tiers: [
        { id:'t1', label:'S', color:'#c0392b', images:[] },
        { id:'t2', label:'A', color:'#e67e22', images:[] },
        { id:'t3', label:'B', color:'#f1c40f', images:[] },
        { id:'t4', label:'C', color:'#2ecc71', images:[] },
        { id:'t5', label:'D', color:'#3498db', images:[] },
      ],
      queue: images.slice(),
      currentIdx: images.length ? 0 : -1,
      nextTierId: 10,
    };
  }
  return { images, state };
});

ipcMain.handle('save-state', (_, data) => { writeSave(data); return true; });
ipcMain.handle('scan-images', () => scanImages());

ipcMain.handle('open-images-folder', () => shell.openPath(IMAGES_DIR));

ipcMain.handle('export-png', async (_, pngDataUrl) => {
  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'Save Tier List PNG',
    defaultPath: 'tierlist.png',
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
  });
  if (canceled || !filePath) return false;
  const base64 = pngDataUrl.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  return filePath;
});

// Read an image file as a data URL (for display in the renderer)
ipcMain.handle('read-image', (_, filename) => {
  const safe = path.basename(filename);
  const full  = path.join(IMAGES_DIR, safe);
  if (!fs.existsSync(full)) return null;
  const ext  = path.extname(safe).toLowerCase();
  const mime = { '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png',
                 '.gif':'image/gif','.webp':'image/webp','.bmp':'image/bmp',
                 '.svg':'image/svg+xml','.avif':'image/avif' }[ext] || 'image/jpeg';
  const data = fs.readFileSync(full).toString('base64');
  return `data:${mime};base64,${data}`;
});

// Watch images folder and notify renderer of changes
let watcher = null;
function setupWatcher(win) {
  if (watcher) watcher.close();
  watcher = fs.watch(IMAGES_DIR, () => win.webContents.send('images-changed'));
}

// ── Window ──────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Tier List',
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  setupWatcher(win);

  win.on('closed', () => { if (watcher) watcher.close(); });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
