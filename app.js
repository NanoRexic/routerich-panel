'use strict';

window.RouteRichUi = (function () {
  let n = 0;
  function paint() {
    document.body.classList.toggle('panel-busy', n > 0);
    if (n > 0) document.body.setAttribute('aria-busy', 'true');
    else document.body.removeAttribute('aria-busy');
  }
  return {
    begin: function () { n += 1; paint(); },
    end: function () { n = Math.max(0, n - 1); paint(); },
    locked: function () { return n > 0; }
  };
})();

function uiLocked() {
  return window.RouteRichUi.locked();
}

const overlay = document.getElementById('modal-overlay');

const configText = document.getElementById('config-text');

const modalError = document.getElementById('modal-error');

const savedPicker = document.getElementById('saved-picker');

const savedSelect = document.getElementById('saved-select');

const dropZone = document.getElementById('drop-zone');

const notify = () => window.RouteRichNotify;

const fileInput = document.getElementById('file-input');

const awgIfacePicker = document.getElementById('awg-iface-picker');

const awgIfaceSelect = document.getElementById('awg-iface-select');



let savedVariants = [];

let awgInterfaces = [];
let awgUiMode = '';



function showStatus(message, type, opts) {

  const n = notify();

  if (!n || !message) return;

  opts = opts || {};

  const t = type || 'info';

  const progress = !!opts.progress;

  n.show({

    message: message,

    type: t,

    source: opts.source || 'Панель',

    title: opts.title || (progress ? 'Подождите' : (t === 'success' ? 'Готово' : 'Панель')),

    group: opts.group || 'panel-status',

    stack: false,

    toastOnly: true,

    progress: progress,

    persistent: progress,

    duration: progress ? 0 : undefined

  });

}



function hideStatus() {

  const n = notify();

  if (n?.dismissAllByGroup) n.dismissAllByGroup('panel-status');

  else n?.dismissByGroup?.('panel-status');

}



function showModalStatus(message, type, opts) {

  const n = notify();

  if (!n || !message) return;

  opts = opts || {};

  const t = type || 'info';

  const progress = !!opts.progress;

  n.show({

    message: message,

    type: t,

    source: 'AmneziaWG',

    title: opts.title || (progress ? 'Подождите' : (t === 'success' ? 'Готово' : 'AmneziaWG')),

    group: 'awg-status',

    stack: false,

    toastOnly: true,

    progress: progress,

    persistent: progress,

    duration: progress ? 0 : undefined

  });

}



function hideModalStatus() {

  const n = notify();

  if (n?.dismissAllByGroup) n.dismissAllByGroup('awg-status');

  else n?.dismissByGroup?.('awg-status');

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

      clearModalError();

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

  if (uiLocked()) return;

  clearConfigText();

  clearModalError();

  hideModalStatus();

  overlay.hidden = false;

  document.body.classList.add('modal-open');

  loadAwgInterfaces();
  loadAwgConstructor();

  Promise.all([
    loadSavedVariants(),
    apiGet('generate-awg?mode=scout').catch(() => null)
  ]).then(([, data]) => {
    if (data && data.scout && data.scout.rows && data.scout.rows.length) {
      renderScoutResults(data.scout, {
        mode: savedVariants.length ? 'generate' : 'scan'
      });
    }
  });

}



function hideModal(force) {

  if (!force && uiLocked()) return;

  overlay.hidden = true;

  document.body.classList.remove('modal-open');

}



function clearModalError() {

  if (modalError) {

    modalError.hidden = true;

    modalError.textContent = '';

  }

  const n = notify();

  if (n?.dismissAllByGroup) n.dismissAllByGroup('awg-error');

  else if (n?.dismissByGroup) n.dismissByGroup('awg-error');

}



function showModalError(msg) {

  if (modalError) {

    modalError.hidden = true;

    modalError.textContent = '';

  }

  if (!msg) {

    clearModalError();

    return;

  }

  const n = notify();

  if (!n) return;

  n.show({

    message: msg,

    type: 'error',

    source: 'AmneziaWG',

    title: 'Ошибка',

    group: 'awg-error'

  });

}



function isEmptyConfig(text) {

  return !text.trim();

}



function parseServerJson(text, httpOk) {

  const raw = String(text || '').trim();

  const from = raw.indexOf('{');

  const to = raw.lastIndexOf('}');

  if (from === -1 || to <= from) {

    return { ok: false, error: 'Некорректный ответ сервера' };

  }

  try {

    const data = JSON.parse(raw.slice(from, to + 1));

    if (!httpOk && data && !data.error) {

      data.error = 'HTTP error';

      data.ok = false;

    }

    return data;

  } catch (_) {

    return { ok: false, error: 'Некорректный ответ сервера' };

  }

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

  const text = await res.text();

  const data = parseServerJson(text, res.ok);

  if (!res.ok && !data.error) {

    data.error = 'HTTP ' + res.status;

  }

  return data;

}



async function apiGet(path) {

  const res = await fetch('/cgi-bin/' + path, { method: 'GET', cache: 'no-store' });

  const text = await res.text();

  const data = parseServerJson(text, res.ok);

  if (!res.ok && !data.error) {

    data.error = 'HTTP ' + res.status;

  }

  return data;

}



let awgCtorTimer = 0;
let awg3Ready = true;
let awgCtorState = null;

function awgCtorApplyVisibility() {
  const verEl = document.getElementById('awg-ctor-version');
  const i1El = document.getElementById('awg-ctor-i1');
  const ver = verEl ? verEl.value : '2.0';
  const custom = document.getElementById('awg-ctor-i1-custom-wrap');
  const note = document.getElementById('awg-ctor-note');
  if (custom) custom.hidden = !i1El || i1El.value !== 'custom';
  if (note) {
    const blocked = ver !== '2.0' && !awg3Ready;
    note.hidden = !blocked;
    if (blocked) {
      note.textContent = 'AWG 3.x нужен amneziawg-tools ≥ 3.1.20260812-r1 и kmod-amneziawg ≥ 6.6.144.3.1.20260812-r1';
    }
  }
  if (verEl) {
    for (const opt of verEl.options) {
      if (opt.value !== '2.0') opt.disabled = !awg3Ready;
    }
  }
}

function awgCtorRead() {
  const base = Object.assign({
    version: '2.0',
    dns: '1.1.1.1, 1.0.0.1',
    mtu: '1280',
    jc: '4',
    jmin: '40',
    jmax: '70',
    i1_mode: 'cps2',
    i1_custom: '',
    content_padding: '10-100',
    rekey_after: '100-120',
    rekey_timeout: '3-7',
    reject_after: '150-180',
    keepalive_timeout: '5-15',
    max_handshake: '15-20',
    persistent_keepalive: '25',
    disable_cookies: 'on'
  }, awgCtorState || {});
  const verEl = document.getElementById('awg-ctor-version');
  const dnsEl = document.getElementById('awg-ctor-dns');
  const i1El = document.getElementById('awg-ctor-i1');
  const customEl = document.getElementById('awg-ctor-i1-custom');
  if (verEl) base.version = verEl.value;
  if (dnsEl) {
    const opt = dnsEl.options[dnsEl.selectedIndex];
    base.dns = (opt && opt.getAttribute('data-dns')) || '1.1.1.1, 1.0.0.1';
    base.dns_id = dnsEl.value;
  }
  if (i1El) base.i1_mode = i1El.value;
  if (customEl) base.i1_custom = customEl.value;
  if (base.version === '2.0') {
    if (!base.persistent_keepalive || String(base.persistent_keepalive).indexOf('-') !== -1) {
      base.persistent_keepalive = '25';
    }
  } else if (!base.persistent_keepalive || String(base.persistent_keepalive).indexOf('-') === -1) {
    base.persistent_keepalive = '25-35';
  }
  return base;
}

function awgCtorFill(s) {
  awgCtorState = s || {};
  const verEl = document.getElementById('awg-ctor-version');
  const dnsEl = document.getElementById('awg-ctor-dns');
  const i1El = document.getElementById('awg-ctor-i1');
  const customEl = document.getElementById('awg-ctor-i1-custom');
  if (!verEl) return;
  verEl.value = s.version || '2.0';
  if (dnsEl) {
    const want = String(s.dns || '').replace(/\s+/g, '');
    let matched = '';
    for (const opt of dnsEl.options) {
      const packed = String(opt.getAttribute('data-dns') || '').replace(/\s+/g, '');
      if (packed && packed === want) matched = opt.value;
    }
    dnsEl.value = matched || s.dns_id || 'cloudflare';
  }
  if (i1El) i1El.value = s.i1_mode || 'cps2';
  if (customEl) customEl.value = s.i1_custom || '';
  awgCtorApplyVisibility();
}

async function awgCtorSave() {
  const res = await fetch('/cgi-bin/generate-awg?mode=constructor', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(awgCtorRead())
  });
  const data = await res.json();
  if (data && data.settings) awgCtorState = data.settings;
  if (data && data.awg3) awg3Ready = !!data.awg3.ok;
  awgCtorApplyVisibility();
}

function bindAwgConstructor() {
  const root = document.getElementById('awg-ctor');
  if (!root || root.dataset.bound) return;
  root.dataset.bound = '1';
  root.addEventListener('input', () => {
    awgCtorApplyVisibility();
    clearTimeout(awgCtorTimer);
    awgCtorTimer = setTimeout(() => { awgCtorSave().catch(() => {}); }, 400);
  });
  root.addEventListener('change', () => {
    awgCtorApplyVisibility();
    clearTimeout(awgCtorTimer);
    awgCtorSave().catch(() => {});
  });
}

async function loadAwgConstructor() {
  bindAwgConstructor();
  try {
    const data = await apiGet('generate-awg?mode=constructor');
    if (data && data.awg3) awg3Ready = !!data.awg3.ok;
    if (data && data.settings) awgCtorFill(data.settings);
    else awgCtorApplyVisibility();
  } catch (err) {
    awgCtorApplyVisibility();
  }
}

function syncSavedPickerVisibility() {
  if (!savedPicker) return;
  if (awgUiMode === 'scan') {
    savedPicker.hidden = true;
    return;
  }
  savedPicker.hidden = !(savedVariants && savedVariants.length);
}

function populateSavedSelect(variants, selectedId) {

  savedVariants = variants || [];

  savedSelect.innerHTML = '<option value="">— выберите вариант —</option>';



  if (!savedVariants.length) {

    syncSavedPickerVisibility();

    return;

  }



  savedVariants.forEach((v) => {

    const opt = document.createElement('option');

    opt.value = v.id;

    const endpoint = v.endpoint ? ' (' + v.endpoint + ')' : '';

    opt.textContent = v.name + endpoint;

    savedSelect.appendChild(opt);

  });



  if (selectedId) {

    savedSelect.value = selectedId;

  }

  syncSavedPickerVisibility();

}



async function loadSavedVariant(id) {

  if (!id) {

    clearConfigText();

    return;

  }



  const cached = savedVariants.find((v) => v.id === id);

  if (cached && cached.config) {

    configText.value = cached.config.trim();

    clearModalError();

    return;

  }



  try {

    const data = await apiGet('saved-awg?id=' + encodeURIComponent(id));

    if (data.ok && data.config) {

      configText.value = data.config.trim();

      clearModalError();

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

  setAwgUiMode('generate');

  populateSavedSelect(data.variants, data.variants[0].id);

  configText.value = (data.variants[0].config || '').trim();

  clearModalError();



  const count = data.variants.length;

  notify()?.show({

    source: 'AmneziaWG',

    title: 'Сгенерировано',

    message: count + ' вариант' + (count === 1 ? '' : count < 5 ? 'а' : 'ов') + ' — выберите и импортируйте',

    type: 'success',

    toastOnly: true

  });

}




function scoutCountryCode(code, loc) {
  const raw = String(code || '').replace(/[\uD83C][\uDDE6-\uDDFF]/g, '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  const fromLoc = String(loc || '').match(/,\s*([A-Z]{2})\s*$/i);
  if (fromLoc) return fromLoc[1].toUpperCase();
  const s = String(loc || '') + ' ' + String(code || '');
  if (/Germany|Frankfurt/i.test(s)) return 'DE';
  if (/Finland|Helsinki/i.test(s)) return 'FI';
  if (/Sweden|Stockholm/i.test(s)) return 'SE';
  if (/Netherlands|Amsterdam/i.test(s)) return 'NL';
  if (/Poland|Warsaw/i.test(s)) return 'PL';
  if (/France|Paris/i.test(s)) return 'FR';
  if (/Russia|Moscow|Petersburg/i.test(s)) return 'RU';
  if (/United States|Ashburn|Los Angeles/i.test(s)) return 'US';
  return '';
}

function scoutFlag(code, loc) {
  const cc = scoutCountryCode(code, loc);
  if (!cc) return '';
  return '<img class="scout-flag" src="https://flagcdn.com/w40/' + cc.toLowerCase() + '.png" alt="" width="18" height="13"> ';
}

function scoutEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function updateScoutOpenClass() {
  const box = document.getElementById('scout-results');
  const modal = document.querySelector('#modal-overlay .modal');
  if (!modal) return;
  modal.classList.toggle('scout-open', !!(box && !box.hidden && box.open));
}

function setScoutExpanded(open) {
  const box = document.getElementById('scout-results');
  if (box && !box.hidden) box.open = !!open;
  updateScoutOpenClass();
}

function setAwgUiMode(mode) {
  awgUiMode = mode === 'scan' || mode === 'generate' ? mode : '';
  const modal = document.querySelector('#modal-overlay .modal');
  if (modal) {
    modal.classList.toggle('awg-scan', awgUiMode === 'scan');
    modal.classList.toggle('awg-generate', awgUiMode === 'generate');
  }
  if (awgUiMode === 'scan') setScoutExpanded(true);
  else if (awgUiMode === 'generate') setScoutExpanded(false);
  syncSavedPickerVisibility();
}

function bindScoutSpoiler() {
  const box = document.getElementById('scout-results');
  if (!box || box.dataset.toggleBound) return;
  box.dataset.toggleBound = '1';
  box.addEventListener('toggle', () => updateScoutOpenClass());
}

function hideScoutResults() {
  const box = document.getElementById('scout-results');
  const modal = document.querySelector('#modal-overlay .modal');
  if (box) {
    box.open = false;
    box.hidden = true;
  }
  if (modal) modal.classList.remove('has-scout', 'scout-open', 'awg-scan', 'awg-generate');
}

function scoutTime(scout) {
  if (scout && scout.scanned_at_text) return scout.scanned_at_text;
  const ts = scout && Number(scout.scanned_at);
  if (!ts) return '';
  const d = new Date(ts * 1000);
  if (isNaN(d.getTime())) return '';
  const p = (n) => (n < 10 ? '0' : '') + n;
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

let scoutTableState = { data: null, key: '', dir: 1, selected: '' };

function scoutParseNum(s) {
  const n = parseFloat(String(s || '').replace('%', '').replace(',', '.'));
  return isFinite(n) ? n : Infinity;
}

function scoutSortedRows(rows, key, dir) {
  const list = (rows || []).slice();
  if (!key) return list;
  const numeric = key === 'ep_ping' || key === 'tun_ping' || key === 'loss';
  list.sort((a, b) => {
    if (numeric) {
      const d = scoutParseNum(a[key]) - scoutParseNum(b[key]);
      if (d) return d * dir;
    } else {
      const d = String(a[key] || '').localeCompare(String(b[key] || ''), 'en', { sensitivity: 'base' });
      if (d) return d * dir;
    }
    return String(a.endpoint || '').localeCompare(String(b.endpoint || ''));
  });
  return list;
}

function renderScoutTableBody() {
  const body = document.getElementById('scout-table-body');
  const scout = scoutTableState.data;
  if (!body || !scout) return;
  const rows = scoutSortedRows(scout.rows, scoutTableState.key, scoutTableState.dir);
  const selected = scoutTableState.selected;
  body.innerHTML = rows.map((row) => {
    const loc = row.location || '';
    const seen = row.seen_as || '';
    const node = row.node || '';
    const sel = row.endpoint === selected ? ' class="selected"' : '';
    return '<tr data-endpoint="' + scoutEscape(row.endpoint) + '"' + sel + '>' +
      '<td>' + scoutEscape(row.subnet) + '</td>' +
      '<td>' + scoutEscape(row.endpoint) + '</td>' +
      '<td class="scout-metric">' + scoutEscape(row.ep_ping) + '</td>' +
      '<td class="scout-metric">' + scoutEscape(row.tun_ping) + '</td>' +
      '<td class="scout-metric">' + scoutEscape(row.loss) + '</td>' +
      '<td>' + scoutFlag(seen, loc) + scoutEscape(seen) + '</td>' +
      '<td>' + scoutEscape(node) + '</td>' +
      '<td>' + scoutFlag('', loc) + scoutEscape(loc) + '</td>' +
      '</tr>';
  }).join('');
  body.querySelectorAll('tr[data-endpoint]').forEach((tr) => {
    tr.addEventListener('click', () => pickScoutEndpoint(tr));
  });
}

function bindScoutSortHeaders() {
  const table = document.getElementById('scout-table');
  if (!table || table.dataset.sortBound) return;
  table.dataset.sortBound = '1';
  table.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = th.getAttribute('data-sort');
      if (scoutTableState.key === key) scoutTableState.dir *= -1;
      else {
        scoutTableState.key = key;
        scoutTableState.dir = 1;
      }
      updateScoutSortHeaders();
      renderScoutTableBody();
    });
  });
}

function updateScoutSortHeaders() {
  document.querySelectorAll('#scout-table th[data-sort]').forEach((th) => {
    const on = th.getAttribute('data-sort') === scoutTableState.key;
    th.classList.toggle('sorted', on);
    th.setAttribute('aria-sort', on ? (scoutTableState.dir === 1 ? 'ascending' : 'descending') : 'none');
    th.dataset.dir = on ? (scoutTableState.dir === 1 ? 'asc' : 'desc') : '';
  });
}

function renderScoutResults(scout, opts) {
  const box = document.getElementById('scout-results');
  const sum = document.getElementById('scout-summary');
  const meta = document.getElementById('scout-spoiler-meta');
  const body = document.getElementById('scout-table-body');
  const modal = document.querySelector('#modal-overlay .modal');
  if (!box || !sum || !body) return;
  scoutTableState.data = scout;
  scoutTableState.key = '';
  scoutTableState.dir = 1;
  const working = scout.working != null ? scout.working : (scout.rows || []).length;
  const probed = scout.probed != null ? scout.probed : working;
  const scanned = scoutTime(scout);
  sum.innerHTML =
    '<div class="scout-summary">' +
    '<span><em>Junk</em> ' + scoutEscape(scout.junk || '—') + '</span>' +
    '<span><em>Working</em> <b class="scout-ok">' + scoutEscape(working) + ' / ' + scoutEscape(probed) + '</b></span>' +
    (scanned ? '<span><em>Scanned</em> ' + scoutEscape(scanned) + '</span>' : '') +
    '</div>';
  if (meta) {
    meta.textContent = working + '/' + probed + (scanned ? ' · ' + scanned : '');
  }
  bindScoutSpoiler();
  bindScoutSortHeaders();
  updateScoutSortHeaders();
  renderScoutTableBody();
  box.hidden = false;
  if (modal) modal.classList.add('has-scout');
  setAwgUiMode((opts && opts.mode) || 'scan');
}

async function pickScoutEndpoint(tr) {
  const endpoint = tr && tr.getAttribute('data-endpoint');
  if (!endpoint) return;
  scoutTableState.selected = endpoint;
  document.querySelectorAll('#scout-table-body tr').forEach((row) => {
    row.classList.toggle('selected', row === tr);
  });
  const genBtn = document.getElementById('btn-generate');
  const scoutBtn = document.getElementById('btn-generate-scout');
  if (genBtn) genBtn.disabled = true;
  if (scoutBtn) scoutBtn.disabled = true;
  showModalStatus(endpoint, 'info', { title: 'Сборка конфига', progress: true });
  try {
    const data = await apiGet('generate-awg?mode=scout&pick=' + encodeURIComponent(endpoint));
    hideModalStatus();
    if (data.ok && data.config) {
      setAwgUiMode('scan');
      configText.value = String(data.config).trim();
      if (savedSelect) savedSelect.value = '';
      clearModalError();
      notify()?.show({
        source: 'AmneziaWG',
        title: 'Конфиг собран',
        message: data.endpoint || endpoint,
        type: 'success',
        toastOnly: true
      });
    } else {
      showModalError(data.error || 'Не удалось собрать конфиг');
    }
  } catch (err) {
    hideModalStatus();
    showModalError('Ошибка сети: ' + err.message);
  } finally {
    if (genBtn) genBtn.disabled = false;
    if (scoutBtn) scoutBtn.disabled = false;
  }
}

const panelUpdateBtn = document.getElementById('btn-update');

let panelUpdateInfo = null;



function getEmbeddedPanelVersion() {

  const meta = document.querySelector('meta[name="routerich-version"]');

  return meta && meta.content ? meta.content.trim() : '';

}



function versionGt(a, b) {

  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);

  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);

  for (let i = 0; i < 3; i++) {

    if ((pa[i] || 0) > (pb[i] || 0)) return true;

    if ((pa[i] || 0) < (pb[i] || 0)) return false;

  }

  return false;

}



function versionMax(a, b) {

  if (!a) return b || '';

  if (!b) return a || '';

  return versionGt(a, b) ? a : b;

}



function escapeHtml(value) {

  return String(value).replace(/[&<>"']/g, (ch) => ({

    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'

  }[ch]));

}



function parseChangelog(text) {

  const sections = [];

  let current = null;

  String(text || '').split(/\r?\n/).forEach((line) => {

    const match = /^##\s+\[([^\]]+)\]/.exec(line);

    if (match) {

      current = { version: match[1], items: [] };

      sections.push(current);

      return;

    }

    if (current && /^\s*[-*]\s+/.test(line)) {

      current.items.push(line.replace(/^\s*[-*]\s+/, ''));

    }

  });

  return sections;

}



function hideChangelog() {

  const overlay = document.getElementById('changelog-overlay');

  if (overlay) overlay.hidden = true;

  const otherOpen = Array.prototype.some.call(document.querySelectorAll('.modal-overlay'), (el) => {

    return el !== overlay && !el.hidden;

  });

  if (!otherOpen) document.body.classList.remove('modal-open');

}



function showChangelog(sections) {

  const overlay = document.getElementById('changelog-overlay');

  const body = document.getElementById('changelog-body');

  const title = document.getElementById('changelog-title');

  if (!overlay || !body || !sections.length) return;

  if (title) {

    title.textContent = sections.length === 1

      ? ('Что нового в ' + sections[0].version)

      : 'Что нового';

  }

  body.innerHTML = sections.map((sec) => {

    const items = sec.items.map((item) => '<li>' + escapeHtml(item) + '</li>').join('');

    return '<section class="changelog-section"><h3>' + escapeHtml(sec.version) + '</h3><ul>' + items + '</ul></section>';

  }).join('');

  overlay.hidden = false;

  document.body.classList.add('modal-open');

}



function markChangelogSeen(version) {

  try { localStorage.setItem('routerich-seen-version', version || ''); } catch (_) {}

}



function maybeShowChangelog() {

  const current = getEmbeddedPanelVersion();

  if (!current) return;

  let from = '';

  let seen = '';

  try {

    from = localStorage.getItem('routerich-changelog-from') || '';

    seen = localStorage.getItem('routerich-seen-version') || '';

    if (from) localStorage.removeItem('routerich-changelog-from');

  } catch (_) {}

  const baseline = from || seen;

  if (!baseline || !versionGt(current, baseline)) {

    markChangelogSeen(current);

    return;

  }

  fetch('CHANGELOG.md?_=' + Date.now(), { cache: 'no-store' })

    .then((res) => (res.ok ? res.text() : ''))

    .then((text) => {

      const sections = parseChangelog(text).filter((sec) => {

        return versionGt(sec.version, baseline) && !versionGt(sec.version, current);

      });

      if (sections.length) showChangelog(sections);

      markChangelogSeen(current);

    })

    .catch(() => { markChangelogSeen(current); });

}



document.getElementById('changelog-close')?.addEventListener('click', hideChangelog);

document.getElementById('changelog-overlay')?.addEventListener('click', (e) => {

  if (e.target && e.target.id === 'changelog-overlay') hideChangelog();

});

maybeShowChangelog();



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

  const stamp = String(Date.now());

  try {

    sessionStorage.setItem('routerich-hard-reload', stamp);

  } catch (_) {}



  if ('serviceWorker' in navigator) {

    const regs = await navigator.serviceWorker.getRegistrations();

    await Promise.all(regs.map((reg) => reg.unregister()));

  }

  if ('caches' in window) {

    const keys = await caches.keys();

    await Promise.all(keys.map((key) => caches.delete(key)));

  }



  const url = new URL(location.href);

  url.searchParams.set('_', stamp);

  url.hash = '';

  location.replace(url.toString());

}



async function refreshPanelUpdateStatus() {

  if (!panelUpdateBtn) return;

  try {

    const res = await fetch('/cgi-bin/panel-update?_=' + Date.now(), {

      method: 'GET',

      cache: 'no-store',

      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }

    });

    const data = await res.json().catch(() => ({ ok: false }));

    if (data.ok && data.data) {

      const embedded = getEmbeddedPanelVersion();

      const serverCurrent = data.data.current || '';

      const latest = data.data.latest || '';

      const effectiveCurrent = versionMax(embedded, serverCurrent);

      const needUpdate = !!(latest && versionGt(latest, effectiveCurrent));



      if (needUpdate) {

        setPanelUpdateVisible(true, {

          current: effectiveCurrent || serverCurrent || '?',

          latest: latest,

          update_available: true,

          remote_ok: data.data.remote_ok !== false

        });

        return;

      }

      if (data.data.remote_ok === false && panelUpdateBtn) {

        panelUpdateBtn.title = 'Не удалось проверить обновления на GitHub (сеть или доступ к github.com)';

      }

    }

    setPanelUpdateVisible(false);

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



    if (uiLocked()) return;

    if (!confirm('Обновить панель' + versionHint + '?' + currentHint + '\n\nСтраница перезагрузится автоматически после обновления.')) {

      return;

    }



    showStatus('GitHub (до 2 мин)…', 'info', { title: 'Обновление', progress: true });

    panelUpdateBtn.disabled = true;

    window.RouteRichUi.begin();



    try {

      const data = await apiPost('panel-update', '');

      let ok = !!(data && data.ok);

      let message = (data && data.message) || 'Панель обновлена.';

      if (!ok) {

        const again = await fetch('/cgi-bin/panel-update?_=' + Date.now(), {

          method: 'GET',

          cache: 'no-store',

          headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }

        }).then((r) => r.text()).then((t) => parseServerJson(t, true)).catch(() => null);

        const nowVer = again && again.data && again.data.current;

        if (nowVer && latest && !versionGt(latest, nowVer)) {

          ok = true;

          message = 'Панель обновлена до версии ' + nowVer + '.';

        }

      }

      if (ok) {

        hideStatus();

        try {

          localStorage.setItem('routerich-changelog-from', getEmbeddedPanelVersion() || current || '');

        } catch (_) {}

        notify()?.success(message + ' Перезагрузка…', { source: 'Обновление' });

        await clearPanelCacheAndReload();

      } else {

        hideStatus();

        notify()?.error('Ошибка: ' + ((data && data.error) || 'неизвестная'), { source: 'Обновление' });

        panelUpdateBtn.disabled = false;

      }

    } catch (err) {

      hideStatus();

      notify()?.error('Ошибка сети: ' + err.message, { source: 'Обновление' });

      panelUpdateBtn.disabled = false;

    } finally {

      window.RouteRichUi.end();

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

  if (uiLocked()) return;

  if (!confirm('Перезагрузить роутер? Соединение будет прервано.')) return;

  showStatus('Команда reboot…', 'info', { title: 'Перезагрузка', progress: true });

  window.RouteRichUi.begin();

  try {

    const data = await apiPost('reboot', '');

    if (data.ok) {

      hideStatus();

      notify()?.success('Роутер перезагружается. Подождите 1–2 минуты.', { source: 'Перезагрузка', title: 'Команда отправлена' });

    } else {

      hideStatus();

      notify()?.error('Ошибка: ' + (data.error || 'неизвестная'), { source: 'Перезагрузка' });

    }

  } catch (err) {

    hideStatus();

    notify()?.success('Роутер перезагружается (соединение прервано).', { source: 'Перезагрузка', title: 'Команда отправлена' });

  } finally {

    window.RouteRichUi.end();

  }

});



document.getElementById('btn-generate').addEventListener('click', async () => {
  if (uiLocked()) return;
  window.RouteRichUi.begin();
  clearModalError();
  clearConfigText();
  savedSelect.value = '';
  setAwgUiMode('generate');
  try { await awgCtorSave(); } catch (err) { /* settings stay on the router */ }
  const btn = document.getElementById('btn-generate');
  const scoutBtn = document.getElementById('btn-generate-scout');
  const origText = btn.textContent;
  btn.disabled = true;
  if (scoutBtn) scoutBtn.disabled = true;
  btn.textContent = 'Генерация...';
  showModalStatus('3 варианта AWG…', 'info', { title: 'Генерация', progress: true });
  try {
    const data = await apiGet('generate-awg');
    if (data.ok && data.variants && data.variants.length) {
      hideModalStatus();
      applyGeneratedVariants(data);
    } else {
      hideModalStatus();
      showModalError(data.error || 'Не удалось сгенерировать конфиг');
    }
  } catch (err) {
    hideModalStatus();
    showModalError('Ошибка сети: ' + err.message);
  } finally {
    window.RouteRichUi.end();
    btn.disabled = false;
    if (scoutBtn) scoutBtn.disabled = false;
    btn.textContent = origText;
  }
});

document.getElementById('btn-generate-scout')?.addEventListener('click', async () => {
  if (uiLocked()) return;
  window.RouteRichUi.begin();
  clearModalError();
  clearConfigText();
  savedSelect.value = '';
  setAwgUiMode('scan');
  try { await awgCtorSave(); } catch (err) { /* settings stay on the router */ }
  if (typeof hideScoutResults === 'function') hideScoutResults();
  const btn = document.getElementById('btn-generate-scout');
  const genBtn = document.getElementById('btn-generate');
  const origText = btn.textContent;
  btn.disabled = true;
  if (genBtn) genBtn.disabled = true;
  btn.textContent = 'Сканирование...';
  const phaseLabel = {
    starting: 'Запуск…',
    installing: 'Установка WARP Scout…',
    registering: 'Регистрация WARP…',
    scanning: 'Сканирование эндпоинтов…'
  };
  showModalStatus(phaseLabel.starting, 'info', { title: 'WARP Scout', progress: true });
  const started = Date.now();
  let startedJob = false;
  try {
    for (;;) {
      if (Date.now() - started > 360000) {
        hideModalStatus();
        showModalError('Сканирование слишком долгое. Попробуйте ещё раз.');
        break;
      }
      const q = startedJob ? 'generate-awg?mode=scout' : 'generate-awg?mode=scout&start=1';
      const data = await apiGet(q);
      if (data.error === 'Некорректный ответ сервера') {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      startedJob = true;
      if (data.ok && data.scout && data.scout.rows && data.scout.rows.length && data.phase === 'done') {
        hideModalStatus();
        renderScoutResults(data.scout);
        notify()?.show({
          source: 'AmneziaWG',
          title: 'WARP Scout',
          message: 'Выберите эндпоинт в таблице',
          type: 'success',
          toastOnly: true
        });
        break;
      }
      if (data.error || data.phase === 'error') {
        hideModalStatus();
        showModalError(data.error || 'Сканирование не удалось');
        break;
      }
      if (data.phase === 'stopped') {
        hideModalStatus();
        showModalError('Сканирование остановлено');
        break;
      }
      const label = phaseLabel[data.phase] || 'Сканирование эндпоинтов…';
      const extra = data.log ? String(data.log).trim().split('\n').pop() : '';
      showModalStatus(extra ? (label + ' ' + extra.slice(0, 80)) : label, 'info', { title: 'WARP Scout', progress: true });
      await new Promise((r) => setTimeout(r, 2000));
    }
  } catch (err) {
    hideModalStatus();
    showModalError('Ошибка сети: ' + err.message);
  } finally {
    window.RouteRichUi.end();
    btn.disabled = false;
    if (genBtn) genBtn.disabled = false;
    btn.textContent = origText;
  }
});

document.getElementById('btn-import').addEventListener('click', async () => {

  if (uiLocked()) return;

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

  clearModalError();

  const btn = document.getElementById('btn-import');

  btn.disabled = true;

  btn.textContent = 'Импорт...';

  showModalStatus(iface, 'info', { title: 'Импорт', progress: true });

  window.RouteRichUi.begin();

  try {

    const data = await apiPost('import-awg', text, undefined, { iface: iface });

    if (data.ok) {

      const appliedIface = (data.data && data.data.interface) || iface;

      hideModalStatus();

      hideModal(true);

      notify()?.success(appliedIface, {

        source: 'AmneziaWG',

        title: 'Импортировано',

        toastOnly: true

      });

    } else {

      hideModalStatus();

      showModalError(data.error || 'Ошибка импорта');

    }

  } catch (err) {

    hideModalStatus();

    showModalError('Ошибка сети: ' + err.message);

  } finally {

    window.RouteRichUi.end();

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

    clearModalError();

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

    clearModalError();

    hideModalStatus();

  };

  reader.readAsText(file);

});



if ('serviceWorker' in navigator) {

  const swBust = window.__ROUTERICH_CACHE_BUST__ || '1';

  navigator.serviceWorker.register('sw.js?_=' + encodeURIComponent(swBust)).catch(() => {});

}



if (window.matchMedia('(display-mode: standalone)').matches) {

  document.documentElement.classList.add('standalone');

}