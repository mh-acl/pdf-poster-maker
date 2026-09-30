const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { PDFDocument, degrees } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

// GPU unneccessary, and it was causing lots of errors to be logged
app.disableHardwareAcceleration();

function createWindow() {
  const win = new BrowserWindow({
    width: 520, height: 640,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.setMenuBarVisibility(false);
  win.loadFile('index.html');
}

// Visible size of a page in points (crop box, with /Rotate applied)
function geometry(page) {
  const cb = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  return { cb, rot, w: swap ? cb.height : cb.width, h: swap ? cb.width : cb.height };
}

ipcMain.handle('inspect-pdf', async (e, bytes) => {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const g = geometry(doc.getPage(0));
  return { pages: doc.getPageCount(), width: g.w, height: g.h };
});

ipcMain.handle('save-pdf', async (e, { bytes, type, widthPt, heightPt, scale, defaultName }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: defaultName, filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled) return { canceled: true };

  const out = await PDFDocument.create();

  if (type === 'pdf') {
    // Vector path: wrap each source page as a Form XObject and draw it scaled.
    // Page content, fonts and vector art are copied as-is, never rasterized.
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = src.getPages();
    const boxes = pages.map(p => {
      const c = p.getCropBox();
      return { left: c.x, bottom: c.y, right: c.x + c.width, top: c.y + c.height };
    });
    const embedded = await out.embedPages(pages, boxes);
    pages.forEach((p, i) => {
      const g = geometry(p);
      const s = scale;
      const origin = {
        0:   { x: 0,                  y: 0 },
        90:  { x: 0,                  y: g.cb.width * s },
        180: { x: g.cb.width * s,     y: g.cb.height * s },
        270: { x: g.cb.height * s,    y: 0 }
      }[g.rot] || { x: 0, y: 0 };
      const page = out.addPage([g.w * s, g.h * s]);
      page.drawPage(embedded[i], { ...origin, xScale: s, yScale: s, rotate: degrees(-g.rot) });
    });
  } else {
    // Bitmap path: JPEG passes through untouched, PNG is stored losslessly.
    const image = type === 'jpg' ? await out.embedJpg(bytes) : await out.embedPng(bytes);
    const page = out.addPage([widthPt, heightPt]);
    page.drawImage(image, { x: 0, y: 0, width: widthPt, height: heightPt });
  }

  fs.writeFileSync(filePath, await out.save());
  return { canceled: false, filePath };
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
