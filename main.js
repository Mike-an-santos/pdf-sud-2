const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

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

// caminho do SumatraPDF: na app instalada fica em "resources"; em desenvolvimento, ao lado do main.js
function caminhoSumatra() {
  const empacotado = path.join(process.resourcesPath || '', 'SumatraPDF.exe');
  if (fs.existsSync(empacotado)) return empacotado;
  const dev = path.join(__dirname, 'SumatraPDF.exe');
  if (fs.existsSync(dev)) return dev;
  return null;
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

  // Impressão com o SumatraPDF: abre o painel para escolher a impressora e imprime o PDF real.
  ipcMain.handle('imprimir-pdf', async (event, base64) => {
    let tmp = null;
    try {
      tmp = path.join(os.tmpdir(), 'BEO-' + Date.now() + '.pdf');
      fs.writeFileSync(tmp, Buffer.from(base64, 'base64'));

      const sumatra = caminhoSumatra();
      const apagarDepois = () => setTimeout(() => { try { fs.unlinkSync(tmp); } catch (_) {} }, 120000);

      if (sumatra) {
        // -print-dialog: mostra o painel para escolher impressora
        // -exit-when-done: fecha o SumatraPDF assim que terminar
        return await new Promise((resolve) => {
          execFile(sumatra, ['-print-dialog', '-exit-when-done', '-silent', tmp], { windowsHide: true }, (err) => {
            apagarDepois();
            if (err) resolve({ ok: false, reason: String(err.message || err) });
            else resolve({ ok: true });
          });
        });
      }

      // recurso (se o SumatraPDF não estiver presente): abre o BEO no leitor predefinido
      return await new Promise((resolve) => {
        const p = tmp.replace(/'/g, "''");
        execFile('powershell.exe',
          ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', "Start-Process -FilePath '" + p + "'"],
          { windowsHide: true },
          (err) => {
            apagarDepois();
            if (err) resolve({ ok: false, reason: String(err.message || err) });
            else resolve({ ok: true, aberto: true });
          });
      });
    } catch (err) {
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
