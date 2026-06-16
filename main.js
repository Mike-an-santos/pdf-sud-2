const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let win = null;

function encontrarPDF(argv) {
  return (argv || []).find(a =>
    typeof a === 'string' && a.toLowerCase().endsWith('.pdf') && fs.existsSync(a)
  );
}

function entregarPDF(caminho) {
  if (!caminho || !win) return;
  try {
    const dados = fs.readFileSync(caminho);
    const nome = path.basename(caminho);
    const enviar = () => win.webContents.send('open-pdf', { name: nome, data: dados });
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', enviar);
    } else {
      enviar();
    }
  } catch (e) {
    console.error('entregarPDF', e);
  }
}

function criarJanela() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    icon: path.join(__dirname, 'PDF.ico'),
    backgroundColor: '#0a0e18',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile('PDF_SUD.html');
  entregarPDF(encontrarPDF(process.argv));
  win.on('closed', () => { win = null; });
}

// uma só instância: se abrires outro PDF, usa a janela já aberta
const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); }
    entregarPDF(encontrarPDF(argv));
  });

  // (mantido por compatibilidade — já não é usado para imprimir)
  ipcMain.handle('imprimir', () => {
    if (!win) return { ok: false, reason: 'sem-janela' };
    return new Promise((resolve) => {
      win.webContents.print({ silent: false, printBackground: true }, (ok, reason) => resolve({ ok, reason }));
    });
  });

  // Imprimir o PDF REAL: abre-o no visualizador do Electron (que o desenha bem)
  // e dispara o Ctrl+P DESSE visualizador, que usa o motor interno de PDF.
  ipcMain.handle('imprimir-pdf', async (event, base64) => {
    let tmp = null, pdfWin = null;
    try {
      tmp = path.join(os.tmpdir(), 'pdfsud-' + Date.now() + '.pdf');
      fs.writeFileSync(tmp, Buffer.from(base64, 'base64'));
      pdfWin = new BrowserWindow({
        width: 900,
        height: 1080,
        autoHideMenuBar: true,
        backgroundColor: '#ffffff',
        webPreferences: { plugins: true }
      });
      pdfWin.on('closed', () => {
        try { if (tmp && fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
      });
      await pdfWin.loadFile(tmp);
      // dar tempo ao visualizador para desenhar e depois disparar a impressão DELE (Ctrl+P)
      setTimeout(() => {
        try {
          if (pdfWin && !pdfWin.isDestroyed()) {
            pdfWin.focus();
            const wc = pdfWin.webContents;
            wc.sendInputEvent({ type: 'keyDown', keyCode: 'P', modifiers: ['control'] });
            wc.sendInputEvent({ type: 'char',    keyCode: 'P', modifiers: ['control'] });
            wc.sendInputEvent({ type: 'keyUp',   keyCode: 'P', modifiers: ['control'] });
          }
        } catch (_) {}
      }, 1400);
      return { ok: true };
    } catch (err) {
      try { if (pdfWin && !pdfWin.isDestroyed()) pdfWin.close(); } catch (_) {}
      try { if (tmp && fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
      return { ok: false, reason: String(err && err.message ? err.message : err) };
    }
  });

  app.whenReady().then(() => {
    criarJanela();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) criarJanela();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
