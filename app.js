'use strict';

const overlay = document.getElementById('modal-overlay');
const configText = document.getElementById('config-text');
const modalError = document.getElementById('modal-error');
const modalStatus = document.getElementById('modal-status');
const savedPicker = document.getElementById('saved-picker');
const savedSelect = document.getElementById('saved-select');
const statusArea = document.getElementById('status-area');
const statusMessage = document.getElementById('status-message');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const awgIfacePicker = document.getElementById('awg-iface-picker');
const awgIfaceSelect = document.getElementById('awg-iface-select');

let savedVariants = [];
let awgInterfaces = [];

function showStatus(message, type) {
  statusArea.hidden = false;
  statusArea.className = 'status ' + type;
  statusMessage.textContent = message;
}

function hideStatus() {
  statusArea.hidden = true;
}

function showModalStatus(message, type) {
  modalStatus.hidden = false;
  modalStatus.className = 'modal-status ' + (type || 'info');
  modalStatus.textContent = message;
}

function hideModalStatus() {
  modalStatus.hidden = true;
}

function clearConfigText() {
  configText.value = '';
}

function populateAwgIfaceSelect(interfaces, selectedName) {
  awgInterfaces = interfaces || [];
  awgIfaceSelect.innerHTML = '';

  if (!awgInterfaces.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '— интерфейсы не найдены —';
    awgIfaceSelect.appendChild(opt);
    awgIfacePicker.hidden = true;
    return;
  }

  awgInterfaces.forEach((item) => {
    const opt = document.createElement('option');
    opt.value = item.name;
    opt.textContent = item.name + (item.up ? ' (поднят)' : ' (выключен)');
    awgIfaceSelect.appendChild(opt);
  });

  const preferred = selectedName || awgInterfaces[0].name;
  const found = awgInterfaces.some((item) => item.name === preferred);
  awgIfaceSelect.value = found ? preferred : awgInterfaces[0].name;
  awgIfacePicker.hidden = false;
}

async function loadAwgInterfaces() {
  awgIfaceSelect.innerHTML = '<option value="">— загрузка... —</option>';
  awgIfacePicker.hidden = false;

  try {
    const data = await apiGet('import-awg?action=list');
    if (data.ok && data.interfaces && data.interfaces.length) {
      populateAwgIfaceSelect(data.interfaces, data.default);
      modalError.hidden = true;
      return;
    }
    populateAwgIfaceSelect([]);
    showModalError(data.error || 'На роутере нет интерфейсов AmneziaWG. Создайте их в LuCI.');
  } catch (err) {
    populateAwgIfaceSelect([]);
    showModalError('Не удалось загрузить список интерфейсов: ' + err.message);
  }
}

function showModal() {
  clearConfigText();
  modalError.hidden = true;
  hideModalStatus();
  overlay.hidden = false;
  document.body.classList.add('modal-open');
  loadSavedVariants();
  loadAwgInterfaces();
}

function hideModal() {
  overlay.hidden = true;
  document.body.classList.remove('modal-open');
}

function showModalError(msg) {
  modalError.textContent = msg;
  modalError.hidden = false;
}

function isEmptyConfig(text) {
  return !text.trim();
}

async function apiPost(path, body, contentType, query) {
  let url = '/cgi-bin/' + path;
  if (query && typeof query === 'object') {
    const qs = new URLSearchParams(query).toString();
    if (qs) url += '?' + qs;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': contentType || 'text/plain; charset=utf-8' },
    body: body
  });
  const data = await res.json().catch(() => ({ ok: false, error: 'Некорректный ответ сервера' }));
  if (!res.ok && !data.error) {
    data.error = 'HTTP ' + res.status;
  }
  return data;
}

async function apiGet(path) {
  const res = await fetch('/cgi-bin/' + path, { method: 'GET' });
  const data = await res.json().catch(() => ({ ok: false, error: 'Некорректный ответ сервера' }));
  if (!res.ok && !data.error) {
    data.error = 'HTTP ' + res.status;
  }
  return data;
}

function populateSavedSelect(variants, selectedId) {
  savedVariants = variants || [];
  savedSelect.innerHTML = '<option value="">— выберите вариант —</option>';

  if (!savedVariants.length) {
    savedPicker.hidden = true;
    return;
  }

  savedVariants.forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v.id;
    const endpoint = v.endpoint ? ' (' + v.endpoint + ')' : '';
    opt.textContent = v.name + endpoint;
    savedSelect.appendChild(opt);
  });

  savedPicker.hidden = false;

  if (selectedId) {
    savedSelect.value = selectedId;
  }
}

async function loadSavedVariant(id) {
  if (!id) {
    clearConfigText();
    return;
  }

  const cached = savedVariants.find((v) => v.id === id);
  if (cached && cached.config) {
    configText.value = cached.config.trim();
    modalError.hidden = true;
    return;
  }

  try {
    const data = await apiGet('saved-awg?id=' + encodeURIComponent(id));
    if (data.ok && data.config) {
      configText.value = data.config.trim();
      modalError.hidden = true;
      const item = savedVariants.find((v) => v.id === id);
      if (item) item.config = data.config;
    } else {
      showModalError(data.error || 'Не удалось загрузить конфиг');
    }
  } catch (err) {
    showModalError('Ошибка сети: ' + err.message);
  }
}

async function loadSavedVariants() {
  try {
    const data = await apiGet('saved-awg');
    if (data.ok && data.variants && data.variants.length) {
      populateSavedSelect(data.variants);
    } else {
      populateSavedSelect([]);
    }
  } catch (_) {
    populateSavedSelect([]);
  }
}

function applyGeneratedVariants(data) {
  if (!data.variants || !data.variants.length) return;

  populateSavedSelect(data.variants, data.variants[0].id);
  configText.value = (data.variants[0].config || '').trim();
  modalError.hidden = true;

  const count = data.variants.length;
  showModalStatus(
    'Сгенерировано ' + count + ' вариант' + (count === 1 ? '' : count < 5 ? 'а' : 'ов') +
    '. Выберите вариант в списке или отредактируйте текст.',
    'success'
  );
  showStatus('Конфиги сохранены на роутере. Выберите вариант и нажмите «Импортировать».', 'info');
}

const operaProxyMenuItem = document.getElementById('menu-item-opera-proxy');
const operaProxyBtn = document.getElementById('btn-opera-proxy');

function setOperaProxyVisible(visible) {
  if (!operaProxyMenuItem) return;
  operaProxyMenuItem.hidden = !visible;
}

async function refreshOperaProxyStatus() {
  if (!operaProxyMenuItem) return;
  try {
    const data = await apiGet('fix-opera-proxy');
    if (data.ok && data.data) {
      setOperaProxyVisible(!!data.data.needs_fix);
    } else {
      setOperaProxyVisible(false);
    }
  } catch (_) {
    setOperaProxyVisible(false);
  }
}

if (operaProxyBtn) {
  operaProxyBtn.addEventListener('click', async () => {
    if (!confirm(
      'Настроить Opera-Proxy?\n\n' +
      '• Обновит пакет opera-proxy через opkg (важно для старых версий)\n' +
      '• Включит смешанный прокси awg10 (порт 2080), если выключен\n' +
      '• Перезапишет /etc/init.d/opera-proxy с адресом роутера\n' +
      '• Перезапустит Zeroblock и opera-proxy, проверит работу\n' +
      '• Включит секцию opera в Zeroblock, если она выключена'
    )) return;

    hideStatus();
    showStatus('Обновление пакета и настройка Opera-Proxy… Подождите до 60 секунд.', 'info');
    operaProxyBtn.disabled = true;

    try {
      const data = await apiPost('fix-opera-proxy', '');
      if (data.ok) {
        const d = data.data || {};
        let msg = data.message || 'Opera-Proxy настроен.';
        if (d.opera_proxy_version) msg += ' Версия пакета: ' + d.opera_proxy_version + '.';
        if (d.socks_proxy) msg += ' SOCKS: ' + d.socks_proxy + '.';
        if (d.opera_section_was_enabled === 0) msg += ' Секция opera включена.';
        showStatus(msg, 'success');
        setOperaProxyVisible(false);
      } else {
        showStatus('Ошибка: ' + (data.error || 'неизвестная'), 'error');
      }
    } catch (err) {
      showStatus('Ошибка сети: ' + err.message, 'error');
    } finally {
      operaProxyBtn.disabled = false;
    }
  });
}

refreshOperaProxyStatus();

const panelUpdateBtn = document.getElementById('btn-update');
let panelUpdateInfo = null;

function getEmbeddedPanelVersion() {
  const meta = document.querySelector('meta[name="routerich-version"]');
  return meta && meta.content ? meta.content.trim() : '';
}

function versionGt(a, b) {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return true;
    if (pa[i] < pb[i]) return false;
  }
  return false;
}

function setPanelUpdateVisible(visible, info) {
  if (!panelUpdateBtn) return;
  panelUpdateInfo = info || null;
  panelUpdateBtn.hidden = !visible;
  if (visible && info && info.latest) {
    panelUpdateBtn.title = 'Доступна версия ' + info.latest + ' (сейчас ' + (info.current || '?') + ')';
  } else {
    panelUpdateBtn.title = '';
  }
}

async function clearPanelCacheAndReload() {
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((reg) => reg.unregister()));
  }
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  const url = new URL(location.href);
  url.searchParams.set('_', String(Date.now()));
  location.replace(url.toString());
}

async function refreshPanelUpdateStatus() {
  if (!panelUpdateBtn) return;
  try {
    const res = await fetch('/cgi-bin/panel-update?_=' + Date.now(), {
      method: 'GET',
      cache: 'no-store'
    });
    const data = await res.json().catch(() => ({ ok: false }));
    if (data.ok && data.data && data.data.update_available) {
      const embedded = getEmbeddedPanelVersion();
      const latest = data.data.latest || '';
      if (embedded && !versionGt(latest, embedded)) {
        setPanelUpdateVisible(false);
        return;
      }
      setPanelUpdateVisible(true, data.data);
    } else {
      setPanelUpdateVisible(false);
    }
  } catch (_) {
    setPanelUpdateVisible(false);
  }
}

if (panelUpdateBtn) {
  panelUpdateBtn.addEventListener('click', async () => {
    const latest = panelUpdateInfo && panelUpdateInfo.latest;
    const current = panelUpdateInfo && panelUpdateInfo.current;
    const versionHint = latest ? ' до версии ' + latest : '';
    const currentHint = current ? ' (сейчас ' + current + ')' : '';

    if (!confirm('Обновить панель' + versionHint + '?' + currentHint + '\n\nСтраница перезагрузится автоматически после обновления.')) {
      return;
    }

    hideStatus();
    showStatus('Скачивание обновления с GitHub… Подождите до 2 минут.', 'info');
    panelUpdateBtn.disabled = true;

    try {
      const data = await apiPost('panel-update', '');
      if (data.ok) {
        showStatus((data.message || 'Панель обновлена.') + ' Перезагрузка…', 'success');
        await clearPanelCacheAndReload();
      } else {
        showStatus('Ошибка: ' + (data.error || 'неизвестная'), 'error');
        panelUpdateBtn.disabled = false;
      }
    } catch (err) {
      showStatus('Ошибка сети: ' + err.message, 'error');
      panelUpdateBtn.disabled = false;
    }
  });
}

refreshPanelUpdateStatus();

document.getElementById('btn-awg').addEventListener('click', showModal);
document.getElementById('btn-cancel').addEventListener('click', hideModal);

overlay.addEventListener('click', (e) => {
  if (e.target === overlay) hideModal();
});

savedSelect.addEventListener('change', () => {
  loadSavedVariant(savedSelect.value);
});

document.getElementById('btn-reboot').addEventListener('click', async () => {
  if (!confirm('Перезагрузить роутер? Соединение будет прервано.')) return;
  hideStatus();
  showStatus('Отправка команды перезагрузки...', 'info');
  try {
    const data = await apiPost('reboot', '');
    if (data.ok) {
      showStatus('Роутер перезагружается. Подождите 1–2 минуты.', 'success');
    } else {
      showStatus('Ошибка: ' + (data.error || 'неизвестная'), 'error');
    }
  } catch (err) {
    showStatus('Роутер перезагружается (соединение прервано).', 'success');
  }
});

document.getElementById('btn-generate').addEventListener('click', async () => {
  modalError.hidden = true;
  clearConfigText();
  savedSelect.value = '';
  const btn = document.getElementById('btn-generate');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Генерация...';
  showModalStatus('Запрос конфигурации WARP… Генерируем 3 варианта AWG 2.0.', 'info');
  try {
    const data = await apiGet('generate-awg');
    if (data.ok && data.variants && data.variants.length) {
      applyGeneratedVariants(data);
    } else {
      hideModalStatus();
      showModalError(data.error || 'Не удалось сгенерировать конфиг');
    }
  } catch (err) {
    hideModalStatus();
    showModalError('Ошибка сети: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
});

document.getElementById('btn-import').addEventListener('click', async () => {
  const text = configText.value.trim();
  const iface = awgIfaceSelect.value;
  if (!iface) {
    showModalError('Выберите интерфейс AmneziaWG');
    return;
  }
  if (isEmptyConfig(text)) {
    showModalError('Вставьте, выберите или сгенерируйте конфигурацию .conf');
    return;
  }
  modalError.hidden = true;
  const btn = document.getElementById('btn-import');
  btn.disabled = true;
  btn.textContent = 'Импорт...';
  try {
    const data = await apiPost('import-awg', text, undefined, { iface: iface });
    if (data.ok) {
      const appliedIface = (data.data && data.data.interface) || iface;
      hideModal();
      showStatus('Конфигурация AmneziaWG (' + appliedIface + ') успешно обновлена.', 'success');
    } else {
      showModalError(data.error || 'Ошибка импорта');
    }
  } catch (err) {
    showModalError('Ошибка сети: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Импортировать';
  }
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    configText.value = ev.target.result.trim();
    savedSelect.value = '';
    modalError.hidden = true;
    hideModalStatus();
  };
  reader.readAsText(file);
  fileInput.value = '';
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    configText.value = ev.target.result.trim();
    savedSelect.value = '';
    modalError.hidden = true;
    hideModalStatus();
  };
  reader.readAsText(file);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

if (window.matchMedia('(display-mode: standalone)').matches) {
  document.documentElement.classList.add('standalone');
}