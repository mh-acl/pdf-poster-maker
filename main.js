const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { PDFDocument, degrees } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

// GPU unneccessary, and it was causing lots of errors to be logged
app.disableHardwareAcceleration();

function createWindow() {
  const win = new BrowserWindow({
    width: 520, height: 740,
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

// Clamp crop insets (visible space, points) so at least 1pt survives on each axis.
function clampInsets(g, c) {
  let l = Math.max(0, c.l || 0), r = Math.max(0, c.r || 0);
  let t = Math.max(0, c.t || 0), b = Math.max(0, c.b || 0);
  if (l + r > g.w - 1) { const k = (g.w - 1) / (l + r); l *= k; r *= k; }
  if (t + b > g.h - 1) { const k = (g.h - 1) / (t + b); t *= k; b *= k; }
  return { l, t, r, b };
}

// Turn visible-space insets (origin top-left, y down, /Rotate applied) into a box in
// the page's own user space, which is what embedPages needs as its bounding box.
function cropBox(g, c) {
  const { l, t, r, b } = clampInsets(g, c);
  const W = g.cb.width, H = g.cb.height;
  const toUV = {
    0:   (x, y) => [x,     H - y],
    90:  (x, y) => [y,     x],
    180: (x, y) => [W - x, y],
    270: (x, y) => [W - y, H - x]
  }[g.rot];
  const [u0, v0] = toUV(l, t), [u1, v1] = toUV(g.w - r, g.h - b);
  return {
    left: g.cb.x + Math.min(u0, u1), right: g.cb.x + Math.max(u0, u1),
    bottom: g.cb.y + Math.min(v0, v1), top: g.cb.y + Math.max(v0, v1)
  };
}

ipcMain.handle('inspect-pdf', async (e, bytes) => {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const g = geometry(doc.getPage(0));
  return { pages: doc.getPageCount(), width: g.w, height: g.h };
});

ipcMain.handle('save-pdf', async (e, { bytes, type, scale, crop, defaultName }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: defaultName, filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled) return { canceled: true };

  const out = await PDFDocument.create();
  const c = crop || { l: 0, t: 0, r: 0, b: 0 };   // insets from each edge; source units (pt for PDF, px for bitmaps)

  if (type === 'pdf') {
    // Vector path: wrap each source page as a Form XObject and draw it scaled.
    // Page content, fonts and vector art are copied as-is, never rasterized.
    // Cropping just shrinks the XObject's bounding box, so the viewer clips for us.
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = src.getPages();
    const geoms = pages.map(geometry);
    const boxes = pages.map((p, i) => cropBox(geoms[i], c));
    const embedded = await out.embedPages(pages, boxes);
    pages.forEach((p, i) => {
      const g = geoms[i], s = scale;
      const bw = boxes[i].right - boxes[i].left, bh = boxes[i].top - boxes[i].bottom;
      const origin = {
        0:   { x: 0,        y: 0 },
        90:  { x: 0,        y: bw * s },
        180: { x: bw * s,   y: bh * s },
        270: { x: bh * s,   y: 0 }
      }[g.rot] || { x: 0, y: 0 };
      const swap = g.rot === 90 || g.rot === 270;
      const page = out.addPage([(swap ? bh : bw) * s, (swap ? bw : bh) * s]);
      page.drawPage(embedded[i], { ...origin, xScale: s, yScale: s, rotate: degrees(-g.rot) });
    });
  } else {
    // Bitmap path: JPEG passes through untouched, PNG is stored losslessly.
    // Cropping draws the whole image offset so the page edges cut it at exact pixel
    // boundaries; nothing is re-encoded, the cropped-away pixels stay in the file.
    const image = type === 'jpg' ? await out.embedJpg(bytes) : await out.embedPng(bytes);
    const W = image.width, H = image.height;
    const l = Math.min(Math.max(0, c.l), W - 1), r = Math.min(Math.max(0, c.r), W - l - 1);
    const t = Math.min(Math.max(0, c.t), H - 1), b = Math.min(Math.max(0, c.b), H - t - 1);
    const page = out.addPage([(W - l - r) * scale, (H - t - b) * scale]);
    page.drawImage(image, { x: -l * scale, y: -b * scale, width: W * scale, height: H * scale });
  }

  fs.writeFileSync(filePath, await out.save());
  return { canceled: false, filePath };
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
