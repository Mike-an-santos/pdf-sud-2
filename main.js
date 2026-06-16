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

  // Impressão: NÃO usa o motor do Electron. Grava o PDF e pede ao Windows
  // para o imprimir com o programa de PDF do sistema (o mesmo motor do Acrobat).
  // Vai para a impressora PREDEFINIDA do Windows.
  ipcMain.handle('imprimir-pdf', async (event, base64) => {
    let tmp = null;
    try {
      tmp = path.join(os.tmpdir(), 'BEO-' + Date.now() + '.pdf');
      fs.writeFileSync(tmp, Buffer.from(base64, 'base64'));
      const caminho = tmp.replace(/'/g, "''"); // escapar plicas para o PowerShell
      return await new Promise((resolve) => {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', "Start-Process -FilePath '" + caminho + "' -Verb Print"],
          { windowsHide: true },
          (err) => {
            // apagar o temporário só passado 90s (o leitor de PDF precisa de o ler primeiro)
            setTimeout(() => { try { fs.unlinkSync(tmp); } catch (_) {} }, 90000);
            if (err) resolve({ ok: false, reason: String(err.message || err) });
            else resolve({ ok: true });
          }
        );
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
