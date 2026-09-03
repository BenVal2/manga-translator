const $ = (id) => document.getElementById(id);

const STATUS = $('status');
function setStatus(msg) {
  STATUS.textContent = msg;
  setTimeout(() => { STATUS.textContent = ''; }, 3000);
}

function loadConfig() {
  chrome.storage.sync.get({
    ocrKey: '',
    deeplKey: '',
    targetLang: 'ES',
    mode: 'auto',
    autoDetect: true,
    scope: 'page'
  }, (cfg) => {
    $('ocrKey').value = cfg.ocrKey;
    $('deeplKey').value = cfg.deeplKey;
    $('targetLang').value = cfg.targetLang;
    $('autoDetect').checked = cfg.autoDetect;
    $('scope').value = cfg.scope || 'page';

    const overlay = $('modeOverlay');
    const click = $('modeClick');
    if (cfg.mode === 'click') {
      overlay.classList.remove('active');
      click.classList.add('active');
    } else {
      click.classList.remove('active');
      overlay.classList.add('active');
    }

    updateTokenStatus(cfg);
  });
}

function updateTokenStatus(cfg) {
  const el = $('tokenStatus');
  if (cfg.ocrKey && cfg.deeplKey) {
    el.textContent = '✅ Claves configuradas';
    el.className = 'token-status ok';
  } else {
    el.textContent = '⚠️ Faltan claves API';
    el.className = 'token-status warn';
  }
}

$('modeOverlay').addEventListener('click', () => {
  $('modeOverlay').classList.add('active');
  $('modeClick').classList.remove('active');
});

$('modeClick').addEventListener('click', () => {
  $('modeClick').classList.add('active');
  $('modeOverlay').classList.remove('active');
});

$('save').addEventListener('click', () => {
  const mode = $('modeOverlay').classList.contains('active') ? 'auto' : 'click';
  const cfg = {
    ocrKey: $('ocrKey').value.trim(),
    deeplKey: $('deeplKey').value.trim(),
    targetLang: $('targetLang').value,
    mode,
    autoDetect: $('autoDetect').checked,
    scope: $('scope').value
  };
  chrome.storage.sync.set(cfg, () => {
    setStatus('Configuración guardada ✓');
    updateTokenStatus(cfg);
  });
});

$('runOnPage').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) {
      setStatus('No hay pestaña activa');
      return;
    }
    chrome.storage.sync.get({
      ocrKey: '', deeplKey: '', targetLang: 'ES', mode: 'auto', autoDetect: true, scope: 'page'
    }, (cfg) => {
      sendOrInject(tab.id, { type: 'RUN_TRANSLATE', config: cfg });
    });
  });
});

$('clearAll').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) { setStatus('No hay pestaña activa'); return; }
    chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_ALL' }, () => {
      setStatus('Cuadros eliminados');
    });
  });
});

function sendOrInject(tabId, msg) {
  chrome.tabs.sendMessage(tabId, msg, (res) => {
    if (chrome.runtime.lastError) {
      injectAndSend(tabId, msg);
    } else if (res && res.ok) {
      setStatus('Traducción iniciada ✓');
    } else if (res && res.error) {
      setStatus('Error: ' + res.error);
    }
  });
}

function injectAndSend(tabId, msg) {
  chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js']
  }, () => {
    if (chrome.runtime.lastError) {
      setStatus('No se pudo inyectar: ' + chrome.runtime.lastError.message);
      return;
    }
    chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content.css']
    }, () => {
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, msg, (res) => {
          if (chrome.runtime.lastError || !res || !res.ok) {
            setStatus('Error al ejecutar. Revisa la consola (Ctrl+Shift+J).');
          } else {
            setStatus('Traducción iniciada ✓');
          }
        });
      }, 300);
    });
  });
}

loadConfig();
