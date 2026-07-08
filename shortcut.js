'use strict';

const shortcutOverlay = document.getElementById('shortcut-overlay');
const shortcutBody = document.getElementById('shortcut-body');
const shortcutActionBtn = document.getElementById('shortcut-action');
const shortcutCloseBtn = document.getElementById('shortcut-close');
const shortcutHeaderBtn = document.getElementById('btn-shortcut');

let currentAction = null;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function isIOS() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

function isSafari() {
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/Chrome|CriOS|EdgiOS|FxiOS|OPiOS/i.test(ua);
}

function isWindows() {
  return /Windows/i.test(navigator.userAgent);
}

function isMac() {
  return /Macintosh|Mac OS X/i.test(navigator.userAgent) && !isIOS();
}

function detectPlatform() {
  if (isStandalone()) return 'installed';
  if (isIOS()) return isSafari() ? 'ios-safari' : 'ios-other';
  if (isAndroid()) return 'android';
  return 'desktop';
}

function stepList(items) {
  return '<ol class="shortcut-steps">' + items.map((item) => {
    return '<li class="shortcut-step">' + item + '</li>';
  }).join('') + '</ol>';
}

function copyFieldHtml(url) {
  return (
    '<label class="shortcut-copy-label" for="shortcut-copy-input">Адрес панели</label>' +
    '<input type="text" class="shortcut-copy-input saved-select" id="shortcut-copy-input" readonly value="' +
    url.replace(/"/g, '&quot;') + '">'
  );
}

function setActionButton(label, action) {
  currentAction = action || null;
  if (!shortcutActionBtn) return;
  shortcutActionBtn.textContent = label || '';
  shortcutActionBtn.hidden = !action;
  shortcutActionBtn.disabled = false;
}

function renderShortcutContent(platform) {
  setActionButton(null, null);
  const panelUrl = location.href;

  if (platform === 'installed') {
    shortcutBody.innerHTML =
      '<p class="shortcut-lead">Панель уже открывается с ярлыка на экране «Домой» или рабочего стола.</p>' +
      '<p class="shortcut-note">Иконка RouteRich должна быть в списке ваших приложений или на рабочем столе.</p>';
    return;
  }

  if (platform === 'ios-safari') {
    shortcutBody.innerHTML =
      '<p class="shortcut-lead">Добавьте панель на экран «Домой» в Safari:</p>' +
      stepList([
        'Нажмите <strong>Поделиться</strong> внизу экрана (квадрат со стрелкой вверх).',
        'Выберите <strong>На экран «Домой»</strong>.',
        'Нажмите <strong>Добавить</strong>.'
      ]) +
      copyFieldHtml(panelUrl) +
      '<p class="shortcut-note">Можно выделить адрес выше и отправить себе, если открываете панель с другого устройства.</p>';
    setActionButton('Скопировать адрес', 'copy');
    return;
  }

  if (platform === 'ios-other') {
    shortcutBody.innerHTML =
      '<p class="shortcut-lead">Ярлык на iOS создаётся через Safari.</p>' +
      stepList([
        'Скопируйте адрес панели (кнопка ниже).',
        'Откройте <strong>Safari</strong> и вставьте адрес.',
        'В Safari: <strong>Поделиться</strong> → <strong>На экран «Домой»</strong> → <strong>Добавить</strong>.'
      ]) +
      copyFieldHtml(panelUrl);
    setActionButton('Скопировать адрес', 'copy');
    return;
  }

  if (platform === 'android') {
    shortcutBody.innerHTML =
      '<p class="shortcut-lead">Добавьте панель на главный экран Android:</p>' +
      stepList([
        'Откройте меню браузера <strong>⋮</strong>.',
        'Выберите <strong>Добавить на главный экран</strong> или <strong>Добавить ярлык</strong>.',
        'Подтвердите добавление.'
      ]);
    return;
  }

  const shortcutName = isMac() ? 'RouteRich.webloc' : (isWindows() ? 'RouteRich.url' : 'RouteRich.desktop');

  shortcutBody.innerHTML =
    '<p class="shortcut-lead">Создайте ярлык для быстрого доступа к панели с компьютера.</p>' +
    stepList([
      'Нажмите <strong>Скачать ярлык</strong> — файл <code>' + shortcutName + '</code> появится в «Загрузках».',
      isWindows()
        ? 'Перетащите файл на рабочий стол или в меню «Пуск».'
        : (isMac()
          ? 'Дважды щёлкните по файлу — ярлык появится на рабочем столе.'
          : 'Сохраните файл и добавьте ярлык в меню приложений.'),
      'Либо добавьте страницу в закладки браузера (<kbd>Ctrl</kbd>+<kbd>D</kbd>).'
    ]);

  setActionButton('Скачать ярлык', 'download');
}

function showShortcutModal() {
  renderShortcutContent(detectPlatform());
  shortcutOverlay.hidden = false;
  document.body.classList.add('modal-open');
  const copyInput = document.getElementById('shortcut-copy-input');
  if (copyInput) {
    copyInput.addEventListener('focus', () => copyInput.select());
  }
}

function hideShortcutModal() {
  shortcutOverlay.hidden = true;
  document.body.classList.remove('modal-open');
}

function showActionStatus(msg, type) {
  const n = window.RouteRichNotify;
  if (!n || !msg) return;
  n.show({
    message: msg,
    type: type || 'info',
    source: 'Ярлык'
  });
}

function downloadDesktopShortcut() {
  const url = location.href;
  let filename = 'RouteRich.url';
  let content = '[InternetShortcut]\r\nURL=' + url + '\r\n';
  let mime = 'application/x-url';

  if (isMac()) {
    filename = 'RouteRich.webloc';
    content = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
      '<plist version="1.0"><dict><key>URL</key><string>' + url + '</string></dict></plist>\n';
    mime = 'application/octet-stream';
  } else if (!isWindows()) {
    filename = 'routerich-panel.desktop';
    content = '[Desktop Entry]\nType=Link\nName=RouteRich\nURL=' + url + '\nIcon=text-html\n';
    mime = 'application/x-desktop';
  }

  const blob = new Blob([content], { type: mime });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
  showActionStatus('Файл ' + filename + ' скачан. Перенесите его на рабочий стол.', 'success');
}

async function copyPanelUrl() {
  const url = location.href;
  const copyInput = document.getElementById('shortcut-copy-input');

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
      showActionStatus('Адрес скопирован.', 'success');
      return;
    }
  } catch (_) {
    /* fallback below */
  }

  if (copyInput) {
    copyInput.focus();
    copyInput.select();
    copyInput.setSelectionRange(0, url.length);
    try {
      if (document.execCommand('copy')) {
        showActionStatus('Адрес скопирован.', 'success');
        return;
      }
    } catch (_) {
      /* manual copy */
    }
  }

  showActionStatus('Выделите адрес в поле выше и нажмите «Копировать».', 'info');
}

function runPrimaryAction() {
  if (currentAction === 'download') downloadDesktopShortcut();
  else if (currentAction === 'copy') copyPanelUrl();
}

if (shortcutHeaderBtn) {
  if (isStandalone()) shortcutHeaderBtn.hidden = true;
  shortcutHeaderBtn.addEventListener('click', showShortcutModal);
}

if (shortcutCloseBtn) {
  shortcutCloseBtn.addEventListener('click', hideShortcutModal);
}

if (shortcutActionBtn) {
  shortcutActionBtn.addEventListener('click', runPrimaryAction);
}

if (shortcutOverlay) {
  shortcutOverlay.addEventListener('click', (e) => {
    if (e.target === shortcutOverlay) hideShortcutModal();
  });
}