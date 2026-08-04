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

  ipcMain.handle('imprimir', () => {
    if (!win) return { ok: false, reason: 'sem-janela' };
    return new Promise((resolve) => {
      win.webContents.print({ silent: false, printBackground: true }, (ok, reason) => resolve({ ok, reason }));
    });
  });

  ipcMain.handle('imprimir-pdf', async (event, base64) => {
    // Renderiza o PDF numa janela oculta e imprime-a diretamente para a impressora
    // predefinida (sem caixa de dialogo). NAO usa o visualizador interno de PDF do
    // Chromium (que deixou de responder em versoes recentes do Electron) — em vez disso
    // desenha o PDF num <embed> e imprime essa pagina, o que e fiavel entre versoes.
    let tmp = null, pdfWin = null;
    const limpar = () => {
      try { if (pdfWin && !pdfWin.isDestroyed()) pdfWin.close(); } catch (_) {}
      try { if (tmp && fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    };
    try {
      tmp = path.join(os.tmpdir(), 'pdfsud-' + Date.now() + '.pdf');
      fs.writeFileSync(tmp, Buffer.from(base64, 'base64'));

      pdfWin = new BrowserWindow({
        show: false,
        webPreferences: { plugins: true }
      });

      // Timeout de seguranca: se algo encravar, responde em vez de ficar preso para sempre.
      let resolvido = false;
      const acabar = (ok, reason, resolve) => {
        if (resolvido) return; resolvido = true;
        resolve({ ok: ok, reason: reason });
        setTimeout(limpar, 2000);
      };

      return await new Promise((resolve) => {
        // Salvaguarda mais generosa (30s) para PDFs grandes ou primeira abertura (sem cache).
        const salvaguarda = setTimeout(() => acabar(false, 'tempo-esgotado', resolve), 30000);

        // Imprime SO depois de o conteudo terminar mesmo de carregar (nao adivinha tempo).
        const imprimir = () => {
          // Pequena folga extra para o <embed> acabar de desenhar a 1a pagina.
          setTimeout(() => {
            try {
              pdfWin.webContents.print(
                { silent: true, printBackground: true },
                (ok, reason) => { clearTimeout(salvaguarda); acabar(ok, ok ? '' : (reason || 'falhou'), resolve); }
              );
            } catch (e) {
              clearTimeout(salvaguarda);
              acabar(false, String(e && e.message ? e.message : e), resolve);
            }
          }, 800);
        };

        // did-finish-load dispara quando a pagina (com o PDF embutido) terminou de carregar.
        pdfWin.webContents.once('did-finish-load', imprimir);

        const fileUrl = 'file://' + tmp.replace(/\\/g, '/');
        const html = '<!doctype html><html><head><meta charset="utf-8">'
          + '<style>html,body{margin:0;padding:0;height:100%;}embed{width:100%;height:100%;}</style>'
          + '</head><body><embed type="application/pdf" src="' + fileUrl + '#toolbar=0"></body></html>';
        pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
          .catch((e) => { clearTimeout(salvaguarda); acabar(false, String(e && e.message ? e.message : e), resolve); });
      });
    } catch (err) {
      limpar();
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
