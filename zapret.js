'use strict';

const zapretOverlay = document.getElementById('zapret-overlay');
const zapretError = document.getElementById('zapret-error');
const zapretStatus = document.getElementById('zapret-status');
const zapretTabs = document.querySelectorAll('#zapret-overlay .zapret-tab');
const zapretNotify = () => window.RouteRichNotify;
const zapretPanels = document.querySelectorAll('#zapret-overlay .zapret-panel');
const hostsOverlay = document.getElementById('hosts-overlay');
const youtubeSelect = document.getElementById('zapret-youtube-select');
const discordSelect = document.getElementById('zapret-discord-select');

let zapretData = null;
let youtubeLoaded = false;
let testResultsLoaded = false;
let panelTestHistoryLoaded = false;
let selectedPanelTestId = '';
let testStrategiesType = '';
let busy = false;
let showZapret2DisabledBanner = false;

const TEST_TYPE_LABELS = {
  versions: 'Стратегии v',
  domain: 'По домену'
};

const PANEL_TEST_MODE_LABELS = {
  current: 'Текущая конфигурация',
  domain: 'По доменам',
  strategy: 'Стратегия'
};

const ZAPRET_STATUS_VISIBLE_MS = 4500;

function hostsUiOpen() {
  return !!(hostsOverlay && !hostsOverlay.hidden);
}

function notifySource() {
  return hostsUiOpen() ? 'Hosts' : 'Zapret';
}

function setZapretError(msg) {
  if (zapretError) {
    zapretError.hidden = true;
    zapretError.textContent = '';
  }
  const n = zapretNotify();
  if (!n) return;
  const source = notifySource();
  const group = source === 'Hosts' ? 'hosts-error' : 'zapret-error';
  if (!msg) {
    if (n.dismissAllByGroup) n.dismissAllByGroup(group);
    else if (n.dismissByGroup) n.dismissByGroup(group);
    return;
  }
  n.show({
    message: msg,
    type: 'error',
    source: source,
    title: 'Ошибка',
    group: group
  });
}

function setZapretStatus(msg, type, opts) {
  if (zapretStatus) zapretStatus.hidden = true;
  const n = zapretNotify();
  if (!n) return;
  opts = opts || {};
  const source = opts.source || notifySource();
  const group = source === 'Hosts' ? 'hosts-status' : 'zapret-status';
  if (!msg) {
    if (n.dismissAllByGroup) n.dismissAllByGroup(group);
    else if (n.dismissByGroup) n.dismissByGroup(group);
    return;
  }
  const statusType = type || 'info';
  const progress = !!opts.progress;
  let title = opts.title;
  if (!title) {
    if (progress) title = 'Подождите';
    else if (statusType === 'success') title = 'Применено';
    else if (statusType === 'error') title = 'Ошибка';
    else title = source;
  }
  n.show({
    message: msg,
    type: statusType,
    source: source,
    title: title,
    group: group,
    stack: false,
    toastOnly: true,
    progress: progress,
    persistent: progress,
    duration: progress ? 0 : (statusType === 'success' ? ZAPRET_STATUS_VISIBLE_MS : ZAPRET_STATUS_VISIBLE_MS + 1000)
  });
}

/** Краткое имя действия для toast (что именно делается) */
function describeAction(target, value) {
  const v = value == null ? '' : String(value);
  switch (target) {
    case 'start': return 'Запуск';
    case 'stop': return 'Остановка';
    case 'restart': return 'Перезапуск';
    case 'base': return 'Стратегия ' + v;
    case 'game': return v === 'remove' ? 'Игры: сброс' : 'Игры Gv' + v;
    case 'youtube': return 'YouTube ' + v;
    case 'discord_dv': return 'Discord Dv' + v;
    case 'discord_script':
      return v === 'remove' ? 'Discord-скрипт: выкл.' : 'Скрипт ' + v;
    case 'toggle': {
      const names = {
        rkn: 'RKN bypass',
        wssize: 'wssize',
        methodeol: 'methodeol',
        udp443: 'udp443',
        quic: 'QUIC',
        ipv6: 'IPv6',
        moonlight: 'Moonlight',
        finland: 'Finland hosts'
      };
      return names[v] || v;
    }
    case 'hosts': {
      if (v === 'all') return 'Hosts: все';
      if (v === 'reset') return 'Hosts: сброс';
      if (v === 'geohide' || v === 'mafioznik' || v === 'malw') return 'Пресет ' + v;
      return 'Hosts: ' + v;
    }
    case 'exclude_update': return 'Exclude-список';
    case 'backup':
      if (v === 'save') return 'Бэкап: сохранение';
      if (v === 'restore') return 'Бэкап: восстановление';
      if (v === 'delete') return 'Бэкап: удаление';
      return 'Бэкап';
    case 'zapret2_disable': return 'Отключение Zapret2';
    default: return target || 'Действие';
  }
}

function badge(on, label) {
  const cls = on ? 'zp-badge on' : 'zp-badge off';
  return '<span class="' + cls + '">' + label + (on ? ' ✓' : '') + '</span>';
}

function fmtStrategy(s) {
  if (!s) return '—';
  return s;
}

function isZapret2Active(z2) {
  if (!z2 || !z2.installed) return false;
  return !!(z2.running || z2.autostart);
}

function zapret2StatusParts(z2) {
  if (!z2) return [];
  const parts = [];
  if (z2.running) parts.push('служба запущена');
  if (z2.autostart) parts.push('автозапуск включён');
  return parts;
}

function setZapretPanelsEnabled(enabled) {
  const body = document.getElementById('zapret-body');
  const tabs = document.getElementById('zapret-tabs');
  if (body) body.classList.toggle('zapret-disabled', !enabled);
  if (tabs) tabs.classList.toggle('zapret-disabled', !enabled);
}

function renderInstallBanner(d) {
  const el = document.getElementById('zapret-install-banner');
  if (!el) return;

  if (!d || d.installed) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }

  const latest = d.latest_version ? ' (v' + d.latest_version + ')' : '';
  const z2warn = d.zapret2 && isZapret2Active(d.zapret2)
    ? '<p class="zp-zapret2-meta">На роутере активен Zapret2 — перед установкой рекомендуется отключить его кнопкой выше.</p>'
    : '';

  el.hidden = false;
  el.className = 'zapret-install-banner warn';
  el.innerHTML =
    '<strong>Zapret не установлен</strong>' +
    z2warn +
    '<button type="button" class="btn btn-primary btn-sm" id="zapret-install-btn">Установить Zapret' + latest + '</button>';
}

function renderZapret2Banner(d) {
  const el = document.getElementById('zapret-zapret2-banner');
  if (!el) return;

  const z2 = d && d.zapret2;
  if (!z2 || !z2.installed) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }

  if (isZapret2Active(z2)) {
    showZapret2DisabledBanner = false;
    el.hidden = false;
    const meta = zapret2StatusParts(z2).join(' · ');
    el.className = 'zapret-zapret2-banner warn';
    el.innerHTML =
      '<strong>На роутере активен Zapret2</strong>' +
      '<p>На Routerich он установлен по умолчанию. Zapret v1 и Zapret2 нельзя держать вместе: ' +
      'любое действие в этой вкладке остановит Zapret2 и снимет его автозапуск.</p>' +
      '<p class="zp-zapret2-meta">Кнопка ниже не меняет настройки в LuCI — Zapret2 можно снова включить вручную.</p>' +
      (meta ? '<p class="zp-zapret2-meta">Сейчас: ' + meta + '</p>' : '') +
      '<button type="button" class="btn btn-secondary btn-sm" id="zapret-zapret2-disable">' +
      'Отключить Zapret2</button>';
    return;
  }

  if (!showZapret2DisabledBanner) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }

  el.hidden = false;
  el.className = 'zapret-zapret2-banner ok';
  el.innerHTML =
    '<strong>Zapret2 отключён</strong>' +
    '<p>Можно устанавливать и настраивать обычный Zapret через эту панель.</p>' +
    '<p class="zp-zapret2-meta">Чтобы снова включить Zapret2: LuCI → Службы → Zapret2 → автозапуск и запуск службы.</p>';
}

function renderOverview(d) {
  const el = document.getElementById('zapret-overview');
  const run = d.running ? 'Запущен' : 'Остановлен';
  const runCls = d.running ? 'zp-run on' : 'zp-run off';
  const extras = [];
  if (d.discord_script) extras.push('Discord script: ' + d.discord_script);
  if (d.backup && d.backup.exists) extras.push('Бэкап: ' + (d.backup.date || 'есть'));
  const testHist = renderTestHistory(d.test_history).replace(/<\/?p[^>]*>/g, '').trim();
  if (testHist) extras.push(testHist);

  let z2Card = '';
  if (d.zapret2 && d.zapret2.installed) {
    const z2Active = isZapret2Active(d.zapret2);
    const z2Cls = z2Active ? 'zp-run off' : 'zp-run on';
    const z2Label = z2Active ? 'Активен' : 'Отключён';
    z2Card = '<div class="zp-card"><span class="zp-label">Zapret2</span><span class="' + z2Cls + '">' + z2Label + '</span></div>';
  }

  el.innerHTML =
    '<div class="zp-grid zp-grid-compact">' +
    '<div class="zp-card"><span class="zp-label">Статус</span><span class="' + runCls + '">' + run + '</span></div>' +
    z2Card +
    '<div class="zp-card"><span class="zp-label">NFQ</span><span>' + (d.nfq ? d.nfq.running + '/' + d.nfq.total : '—') + '</span></div>' +
    '<div class="zp-card"><span class="zp-label">Версия</span><span>' + (d.version || '—') + '</span></div>' +
    '<div class="zp-card"><span class="zp-label">Актуальная</span><span>' + (d.latest_version || '—') + '</span></div>' +
    '<div class="zp-card"><span class="zp-label">Manager</span><span>v' + (d.manager_version || '?') + '</span></div>' +
    '</div>' +
    '<div class="zp-section zp-section-compact"><h3>Конфигурация</h3><div class="zp-badges">' +
    badge(!!d.strategy.base, 'База: ' + fmtStrategy(d.strategy.base)) +
    badge(!!d.strategy.youtube, 'YT: ' + fmtStrategy(d.strategy.youtube)) +
    badge(!!d.strategy.discord, 'Discord: ' + fmtStrategy(d.strategy.discord)) +
    badge(!!d.strategy.games, 'Игры: ' + fmtStrategy(d.strategy.games)) +
    badge(!!d.strategy.xtreme, 'Xtreme') +
    badge(d.strategy.rkn, 'RKN') +
    badge(d.strategy.wssize, 'wssize') +
    badge(d.strategy.methodeol, 'methodeol') +
    badge(d.strategy.udp443, 'udp443') +
    badge(d.quic_blocked, 'QUIC') +
    badge(d.ipv6_enabled, 'IPv6') +
    badge(d.moonlight_bypass, 'Moonlight') +
    badge(d.finland_ips, 'Finland') +
    '</div>' +
    (extras.length
      ? '<p class="zp-muted zp-overview-meta">' + extras.join(' · ') + '</p>'
      : '') +
    '</div>';
}

function renderTestHistory(history) {
  if (!history) return '';
  const parts = [];
  if (history.panel) parts.push('панель');
  if (history.versions) parts.push('v');
  if (history.domain) parts.push('domain');
  if (!parts.length) return '';
  return '<p class="zp-muted">Сохранённые тесты: ' + parts.join(', ') + '</p>';
}

function panelTestTitle(item) {
  if (!item) return '—';
  if (item.mode === 'strategy') {
    const typeLabel = TEST_TYPE_LABELS[item.strategy_type] || item.strategy_type || '';
    return (typeLabel ? typeLabel + ': ' : '') + (item.strategy || '—');
  }
  if (item.mode === 'domain') {
    return 'Домены: ' + (item.domains_input || '—');
  }
  return PANEL_TEST_MODE_LABELS[item.mode] || item.mode || '—';
}

function renderPanelTestHistory(data) {
  const el = document.getElementById('zapret-panel-test-history');
  if (!el) return;
  const items = data && Array.isArray(data.items) ? data.items : [];
  if (!items.length) {
    el.innerHTML = '<p class="zp-muted">История пуста — запустите тест выше</p>';
    return;
  }
  el.innerHTML = items.map((item) => {
    const cls = scoreClass(item.ok, item.total);
    const active = item.id === selectedPanelTestId ? ' active' : '';
    const modeLabel = PANEL_TEST_MODE_LABELS[item.mode] || item.mode || '';
    return '<button type="button" class="zp-panel-test-row' + active + '" data-panel-test-id="' + item.id + '">' +
      '<span class="zp-panel-test-date">' + (item.date || '—') + '</span>' +
      '<span class="zp-panel-test-title">' + panelTestTitle(item) + '</span>' +
      '<span class="zp-panel-test-mode">' + modeLabel + '</span>' +
      '<span class="zp-panel-test-score ' + cls + '">' + item.ok + '/' + item.total + '</span>' +
      '</button>';
  }).join('');
}

function renderPanelTestDetail(data) {
  const el = document.getElementById('zapret-panel-test-detail');
  if (!el) return;
  if (!data || typeof data.ok !== 'number') {
    el.hidden = true;
    el.innerHTML = '';
    updatePanelTestHint();
    return;
  }
  const cls = data.status || scoreClass(data.ok, data.total);
  const title = panelTestTitle(data);
  const meta = [];
  if (data.date) meta.push(data.date);
  if (data.mode) meta.push(PANEL_TEST_MODE_LABELS[data.mode] || data.mode);
  if (data.restored) meta.push('конфиг восстановлен');
  const domains = Array.isArray(data.domains) ? data.domains : [];
  el.hidden = false;
  el.innerHTML =
    '<div class="zp-panel-test-detail-head">' +
      '<strong>' + title + '</strong>' +
      '<span class="zp-panel-test-score ' + cls + '">' + data.ok + '/' + data.total + '</span>' +
    '</div>' +
    (meta.length ? '<p class="zp-muted zp-panel-test-detail-meta">' + meta.join(' · ') + '</p>' : '') +
    '<div class="zp-test-list">' +
      domains.map((item) => {
        const ok = !!item.ok;
        return '<div class="zp-test-item ' + (ok ? 'ok' : 'fail') + '">' +
          '<span>' + item.name + '</span>' +
          '<span class="zp-test-item-state">' + (ok ? 'OK' : 'FAIL') + '</span>' +
          '</div>';
      }).join('') +
    '</div>';
  updatePanelTestHint();
}

function updatePanelTestHint() {
  const hint = document.getElementById('zapret-panel-test-hint');
  if (hint) hint.hidden = !selectedPanelTestId;
}

function hidePanelTestDetail() {
  selectedPanelTestId = '';
  renderPanelTestDetail(null);
  updatePanelTestHint();
  document.querySelectorAll('.zp-panel-test-row.active').forEach((row) => row.classList.remove('active'));
}

async function togglePanelTestDetail(id) {
  if (!id) return;
  if (id === selectedPanelTestId) {
    hidePanelTestDetail();
    return;
  }
  await showPanelTestDetail(id);
}

function scoreClass(ok, total) {
  if (!total) return 'bad';
  if (ok === total) return 'good';
  if (ok === 0) return 'bad';
  return 'partial';
}

function renderTestResult(data) {
  const summary = document.getElementById('zapret-test-summary');
  const list = document.getElementById('zapret-test-domains-list');
  if (!summary || !list) return;

  if (!data || typeof data.ok !== 'number') {
    summary.hidden = true;
    list.innerHTML = '';
    return;
  }

  const cls = data.status || scoreClass(data.ok, data.total);
  let summaryText = 'Результат: ' + data.ok + ' / ' + data.total + ' доменов доступны';
  if (data.strategy) {
    const typeLabel = TEST_TYPE_LABELS[data.strategy_type] || data.strategy_type || '';
    summaryText = (typeLabel ? typeLabel + ': ' : '') + data.strategy + ' — ' + summaryText;
    if (data.restored) summaryText += ' (конфиг восстановлен)';
  }
  summary.hidden = false;
  summary.className = 'zp-test-summary ' + cls;
  summary.textContent = summaryText;

  const domains = Array.isArray(data.domains) ? data.domains : [];
  list.innerHTML = domains.map((item) => {
    const ok = !!item.ok;
    return '<div class="zp-test-item ' + (ok ? 'ok' : 'fail') + '">' +
      '<span>' + item.name + '</span>' +
      '<span class="zp-test-item-state">' + (ok ? 'OK' : 'FAIL') + '</span>' +
      '</div>';
  }).join('');
}

function renderSavedTestResults(data) {
  const el = document.getElementById('zapret-test-saved');
  if (!el) return;
  const items = data && Array.isArray(data.items) ? data.items : [];
  if (!items.length) {
    el.innerHTML = '<p class="zp-muted">Нет сохранённых результатов</p>';
    return;
  }
  el.innerHTML = items.map((group) => {
    const label = TEST_TYPE_LABELS[group.type] || group.type;
    const rows = (group.strategies || []).map((row) => {
      const cls = scoreClass(row.ok, row.total);
      return '<div class="zp-test-saved-row">' +
        '<span>' + row.name + '</span>' +
        '<span class="zp-test-saved-score ' + cls + '">' + row.ok + '/' + row.total + '</span>' +
        '</div>';
    }).join('');
    return '<div class="zp-test-saved-group"><h4>' + label + '</h4>' + rows + '</div>';
  }).join('');
}

function renderHostsBlocks(d) {
  const blocks = d.hosts_blocks || {};
  const map = [
    ['nalog', 'Налог'], ['rutor', 'Rutor'], ['ntc', 'NTC'], ['instagram', 'Instagram'],
    ['librusec', 'Lib.rus.ec'], ['ai', 'AI'], ['twitch', 'Twitch'], ['tgweb', 'Telegram Web'],
    ['spotify', 'Spotify'], ['supercell', 'Supercell'], ['github', 'GitHub']
  ];
  const el = document.getElementById('zapret-hosts-blocks');
  el.innerHTML = map.map(([key, label]) => {
    const on = !!blocks[key];
    return '<button type="button" class="zp-toggle' + (on ? ' active' : '') + '" data-hosts="' + key + '">' + label + '</button>';
  }).join('');
}

function syncStrategyUI(d) {
  const s = d.strategy || {};
  document.querySelectorAll('[data-base]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.base === s.base);
  });

  document.querySelectorAll('[data-gv]').forEach((btn) => {
    if (btn.dataset.gv === 'xtreme') {
      btn.classList.toggle('active', !!s.xtreme);
      return;
    }
    const raw = (s.games || '').replace(/^#?/, '');
    const num = raw.replace(/^Gv/i, '').replace(/Xtreme$/i, '');
    btn.classList.toggle('active', btn.dataset.gv === num && !!num);
  });
  document.querySelectorAll('[data-toggle]').forEach((btn) => {
    const key = btn.dataset.toggle;
    let on = false;
    if (key === 'rkn') on = s.rkn;
    else if (key === 'wssize') on = s.wssize;
    else if (key === 'methodeol') on = s.methodeol;
    else if (key === 'udp443') on = s.udp443;
    else if (key === 'quic') on = d.quic_blocked;
    else if (key === 'ipv6') on = d.ipv6_enabled;
    else if (key === 'moonlight') on = d.moonlight_bypass;
    else if (key === 'finland') on = d.finland_ips;
    btn.classList.toggle('active', !!on);
  });
  document.querySelectorAll('[data-discord-script]').forEach((btn) => {
    const name = btn.dataset.discordScript;
    if (!name || name === 'remove') {
      btn.classList.remove('active');
      return;
    }
    btn.classList.toggle('active', name === d.discord_script);
  });
  if (youtubeSelect && s.youtube) {
    youtubeSelect.value = s.youtube;
  }
  if (discordSelect && s.discord) {
    discordSelect.value = (s.discord || '').replace(/^Dv/, '');
  }
}

async function parseZapretResponse(res) {
  const text = await res.text();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return { ok: false, error: 'Некорректный ответ сервера' };
  }
  try {
    const data = JSON.parse(text.slice(start, end + 1));
    if (!res.ok && !data.error) {
      data.error = 'HTTP ' + res.status;
      data.ok = false;
    }
    return data;
  } catch (_) {
    return { ok: false, error: 'Некорректный ответ сервера' };
  }
}

async function zapretGet(action, params) {
  const qs = new URLSearchParams();
  qs.set('action', action);
  if (params) {
    Object.keys(params).forEach((key) => {
      const val = params[key];
      if (val != null && val !== '') qs.set(key, String(val));
    });
  }
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), action === 'youtube-list' ? 25000 : 20000) : null;
  try {
    const res = await fetch('/cgi-bin/zapret-api?' + qs.toString(), ctrl ? { signal: ctrl.signal } : undefined);
    return parseZapretResponse(res);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function zapretApply(target, value) {
  const res = await fetch('/cgi-bin/zapret-api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'apply', target: target, value: value || '' })
  });
  return parseZapretResponse(res);
}

async function zapretTest(mode, options) {
  const body = { action: 'test', value: mode };
  if (options) {
    if (options.domains) body.domains = options.domains;
    if (options.type) body.type = options.type;
    if (options.name) body.name = options.name;
  }
  const res = await fetch('/cgi-bin/zapret-api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return parseZapretResponse(res);
}

function fillStrategySelect(listSelect, strategies) {
  listSelect.innerHTML = '<option value="">— выберите стратегию —</option>';
  strategies.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    listSelect.appendChild(opt);
  });
}

async function loadTestStrategies(type, force) {
  const typeSelect = document.getElementById('zapret-test-strategy-type');
  const listSelect = document.getElementById('zapret-test-strategy-select');
  if (!listSelect) return;
  const selectedType = type || (typeSelect ? typeSelect.value : 'versions');
  if (!force && testStrategiesType === selectedType && listSelect.options.length > 1) return;

  listSelect.innerHTML = '<option value="">— загрузка —</option>';
  listSelect.disabled = true;
  setZapretError('');
  try {
    const data = await zapretGet('test-strategies', { type: 'versions' });

    if (!data.ok || !data.data || !Array.isArray(data.data.strategies)) {
      listSelect.innerHTML = '<option value="">— ошибка загрузки —</option>';
      setZapretError(data.error || 'Не удалось загрузить список стратегий');
      return;
    }
    if (!data.data.strategies.length) {
      listSelect.innerHTML = '<option value="">— список пуст —</option>';
      return;
    }
    fillStrategySelect(listSelect, data.data.strategies);
    testStrategiesType = selectedType;
  } catch (err) {
    listSelect.innerHTML = '<option value="">— ошибка сети —</option>';
    setZapretError('Ошибка сети: ' + err.message);
    setZapretStatus('');
  } finally {
    listSelect.disabled = false;
  }
}

async function loadSavedTestResults(force) {
  if (testResultsLoaded && !force) return;
  const el = document.getElementById('zapret-test-saved');
  if (el) el.innerHTML = '<p class="zp-muted">Загрузка…</p>';
  try {
    const data = await zapretGet('test-results');
    if (!data.ok) {
      if (el) el.innerHTML = '<p class="zp-muted">Не удалось загрузить результаты</p>';
      return;
    }
    renderSavedTestResults(data.data);
    testResultsLoaded = true;
  } catch (_) {
    if (el) el.innerHTML = '<p class="zp-muted">Ошибка загрузки результатов</p>';
  }
}

async function loadPanelTestHistory(force) {
  if (panelTestHistoryLoaded && !force) return;
  const el = document.getElementById('zapret-panel-test-history');
  if (el) el.innerHTML = '<p class="zp-muted">Загрузка…</p>';
  try {
    const data = await zapretGet('test-history');
    if (!data.ok) {
      if (el) el.innerHTML = '<p class="zp-muted">Не удалось загрузить историю</p>';
      return;
    }
    renderPanelTestHistory(data.data);
    panelTestHistoryLoaded = true;
    if (selectedPanelTestId) {
      const found = (data.data.items || []).some((item) => item.id === selectedPanelTestId);
      if (!found) {
        selectedPanelTestId = '';
        renderPanelTestDetail(null);
      }
    }
  } catch (_) {
    if (el) el.innerHTML = '<p class="zp-muted">Ошибка загрузки истории</p>';
  }
}

async function showPanelTestDetail(id) {
  if (!id) return;
  selectedPanelTestId = id;
  panelTestHistoryLoaded = false;
  await loadPanelTestHistory(true);
  const detailEl = document.getElementById('zapret-panel-test-detail');
  if (detailEl) {
    detailEl.hidden = false;
    detailEl.innerHTML = '<p class="zp-muted">Загрузка деталей…</p>';
  }
  try {
    const data = await zapretGet('test-history-detail', { id: id });
    if (!data.ok) {
      setZapretError(data.error || 'Не удалось загрузить тест');
      renderPanelTestDetail(null);
      return;
    }
    renderPanelTestDetail(data.data);
  } catch (err) {
    setZapretError('Ошибка сети: ' + err.message);
    renderPanelTestDetail(null);
  }
}

function youtubeListNeedsLoad() {
  if (!youtubeSelect) return false;
  if (!youtubeLoaded) return true;
  return youtubeSelect.options.length <= 1;
}

async function loadYoutubeList(force) {
  if (!youtubeSelect) return;
  if (!force && !youtubeListNeedsLoad()) return;

  youtubeSelect.innerHTML = '<option value="">— загрузка списка —</option>';
  setZapretError('');

  try {
    const data = await zapretGet('youtube-list');
    if (!data.ok || !Array.isArray(data.data)) {
      youtubeSelect.innerHTML = '<option value="">— ошибка загрузки —</option>';
      setZapretError(data.error || 'Не удалось загрузить список YouTube-стратегий');
      youtubeLoaded = false;
      return;
    }
    if (!data.data.length) {
      youtubeSelect.innerHTML = '<option value="">— список пуст —</option>';
      youtubeLoaded = false;
      return;
    }
    youtubeSelect.innerHTML = '<option value="">— выберите Yv —</option>';
    data.data.forEach((yv) => {
      const opt = document.createElement('option');
      opt.value = yv;
      opt.textContent = yv;
      youtubeSelect.appendChild(opt);
    });
    youtubeLoaded = true;
    if (zapretData && zapretData.strategy && zapretData.strategy.youtube) {
      youtubeSelect.value = zapretData.strategy.youtube;
    }
  } catch (err) {
    youtubeSelect.innerHTML = '<option value="">— ошибка загрузки —</option>';
    setZapretError('Ошибка сети: ' + err.message);
    youtubeLoaded = false;
  }
}

async function refreshZapret(silent) {
  const hosts = hostsUiOpen();
  if (!silent) setZapretStatus(hosts ? 'Обновление…' : 'Статус…', 'info', { title: 'Обновление', progress: true });
  setZapretError('');
  try {
    const data = await zapretGet('status');
    if (!data.ok) {
      setZapretError(data.error || 'Не удалось получить статус');
      setZapretStatus('');
      return;
    }
    zapretData = data.data;
    renderHostsBlocks(zapretData);
    syncStrategyUI(zapretData);
    if (hosts) {
      if (!silent) setZapretStatus('Обновлено', 'success', { title: 'Обновлено' });
      return;
    }
    renderInstallBanner(zapretData);
    setZapretPanelsEnabled(!!zapretData.installed);
    if (!zapretData.installed) {
      setZapretError('');
    } else if (zapretData.uci && zapretData.uci.ready === false) {
      setZapretError('UCI-конфиг Zapret не инициализирован. Перезагрузите роутер или откройте Zapret в LuCI.');
    } else if (zapretData.uci && zapretData.uci.initialized) {
      if (!silent) setZapretStatus('UCI готов', 'success', { title: 'Обновлено' });
    }
    renderZapret2Banner(zapretData);
    renderOverview(zapretData);
    if (!silent && !(zapretData.uci && zapretData.uci.initialized)) {
      setZapretStatus('Статус получен', 'success', { title: 'Обновлено' });
    }
  } catch (err) {
    setZapretError('Ошибка сети: ' + err.message);
    setZapretStatus('');
  }
}

async function runTest(mode, options) {
  if (busy) return;
  const z2Warn = zapret2ActionWarning('test');
  if (z2Warn && !confirm(z2Warn)) return;
  busy = true;
  setZapretError('');
  const testLabel = mode === 'strategy'
    ? ((options && options.name) || 'стратегия')
    : (mode === 'domain' ? 'домены' : 'текущая');
  setZapretStatus(testLabel, 'info', { title: 'Тест', progress: true });
  try {
    const data = await zapretTest(mode, options);
    if (!data.ok) {
      setZapretError(data.error || 'Ошибка теста');
      setZapretStatus('');
      return;
    }
    renderTestResult(data.data);
    if (data.data && data.data.saved_id) {
      selectedPanelTestId = data.data.saved_id;
      panelTestHistoryLoaded = false;
      await loadPanelTestHistory(true);
      renderPanelTestDetail(data.data);
    } else {
      panelTestHistoryLoaded = false;
      loadPanelTestHistory(true);
    }
    setZapretStatus(testLabel + ' — в историю', 'success', { title: 'Тест завершён' });
  } catch (err) {
    setZapretError('Ошибка сети: ' + err.message);
    setZapretStatus('');
  } finally {
    busy = false;
  }
}

function zapret2ActionWarning(target) {
  if (target === 'zapret2_disable' || target === 'stop') return '';
  if (!zapretData || !isZapret2Active(zapretData.zapret2)) return '';
  return 'Zapret2 сейчас активен. Zapret v1 и Zapret2 нельзя держать вместе — Zapret2 будет остановлен.\n\nПродолжить?';
}

async function zapretInstall() {
  const res = await fetch('/cgi-bin/zapret-api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'install' })
  });
  return parseZapretResponse(res);
}

async function runInstallZapret() {
  if (busy) return;
  const z2Warn = zapret2ActionWarning('install');
  if (z2Warn && !confirm(z2Warn)) return;

  busy = true;
  setZapretError('');
  setZapretStatus('Скачивание и установка (до 3 мин)…', 'info', {
    title: 'Установка Zapret',
    progress: true
  });
  try {
    const data = await zapretInstall();
    if (!data.ok) {
      setZapretError(data.error || 'Не удалось установить Zapret');
      setZapretStatus('');
      return;
    }
    zapretData = data.data;
    renderInstallBanner(zapretData);
    setZapretPanelsEnabled(!!zapretData.installed);
    renderZapret2Banner(zapretData);
    renderOverview(zapretData);
    renderHostsBlocks(zapretData);
    syncStrategyUI(zapretData);
    if (zapretData.uci && zapretData.uci.initialized) {
      setZapretStatus('UCI инициализирован', 'success', { title: 'Zapret установлен' });
    } else {
      setZapretStatus('Готово к настройке', 'success', { title: 'Zapret установлен' });
    }
    youtubeLoaded = false;
    loadYoutubeList();
  } catch (err) {
    setZapretError('Ошибка сети: ' + err.message);
    setZapretStatus('');
  } finally {
    busy = false;
  }
}

async function runAction(target, value) {
  if (busy) return;
  const z2Warn = zapret2ActionWarning(target);
  if (z2Warn && !confirm(z2Warn)) return;
  busy = true;
  setZapretError('');
  const label = describeAction(target, value);
  setZapretStatus(label, 'info', { title: 'Применение', progress: true });
  try {
    const data = await zapretApply(target, value);
    if (!data.ok) {
      setZapretError(data.error || 'Ошибка применения');
      setZapretStatus('');
      return;
    }
    zapretData = data.data;
    if (target === 'zapret2_disable') {
      showZapret2DisabledBanner = true;
      setZapretStatus('Zapret2 остановлен', 'success', { title: 'Готово' });
    } else {
      setZapretStatus(label, 'success', { title: 'Применено' });
    }
    renderZapret2Banner(zapretData);
    renderOverview(zapretData);
    renderHostsBlocks(zapretData);
    syncStrategyUI(zapretData);
  } catch (err) {
    setZapretError('Ошибка сети: ' + err.message);
    setZapretStatus('');
  } finally {
    busy = false;
  }
}

function hideHostsModal() {
  if (!hostsOverlay) return;
  hostsOverlay.hidden = true;
  if (zapretOverlay && zapretOverlay.hidden) document.body.classList.remove('modal-open');
}

function showHostsModal() {
  hideZapretModal();
  if (!hostsOverlay) return;
  hostsOverlay.hidden = false;
  document.body.classList.add('modal-open');
  refreshZapret(true);
}

function showZapretModal() {
  hideHostsModal();
  const overlay = zapretOverlay || document.getElementById('zapret-overlay');
  if (!overlay) return;
  overlay.hidden = false;
  document.body.classList.add('modal-open');
  showZapret2DisabledBanner = false;
  setZapretError('');
  setZapretStatus('');
  youtubeLoaded = false;
  testResultsLoaded = false;
  panelTestHistoryLoaded = false;
  selectedPanelTestId = '';
  testStrategiesType = '';
  refreshZapret();
  loadYoutubeList();
  loadSavedTestResults();
  loadPanelTestHistory();
  loadTestStrategies();
}

function hideZapretModal() {
  const overlay = zapretOverlay || document.getElementById('zapret-overlay');
  if (!overlay) return;
  overlay.hidden = true;
  showZapret2DisabledBanner = false;
  if (!hostsOverlay || hostsOverlay.hidden) document.body.classList.remove('modal-open');
}

function switchTab(tabId) {
  zapretTabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === tabId));
  zapretPanels.forEach((p) => p.classList.toggle('active', p.id === 'zapret-panel-' + tabId));
  if (tabId === 'strategies') {
    loadYoutubeList();
  }
  if (tabId === 'test') {
    loadSavedTestResults();
    loadPanelTestHistory();
    loadTestStrategies();
  }
}

function bindClick(id, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', handler);
}

function initZapretUi() {
  bindClick('btn-zapret', showZapretModal);
  bindClick('zapret-close', hideZapretModal);
  bindClick('zapret-refresh', () => refreshZapret());
  bindClick('btn-hosts', showHostsModal);
  bindClick('hosts-close', hideHostsModal);
  bindClick('hosts-refresh', () => refreshZapret());

  bindClick('zapret-zapret2-banner', (e) => {
    if (!e.target.closest('#zapret-zapret2-disable')) return;
    runAction('zapret2_disable', '');
  });

  bindClick('zapret-install-banner', (e) => {
    if (!e.target.closest('#zapret-install-btn')) return;
    runInstallZapret();
  });

  if (zapretOverlay) {
    zapretOverlay.addEventListener('click', (e) => {
      if (e.target === zapretOverlay) hideZapretModal();
    });
  }

  zapretTabs.forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  const panelOverview = document.getElementById('zapret-panel-overview');
  if (panelOverview) panelOverview.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-service]');
  if (!btn) return;
  runAction(btn.dataset.service, '');
  });

  const panelStrategies = document.getElementById('zapret-panel-strategies');
  if (panelStrategies) panelStrategies.addEventListener('click', (e) => {
  const base = e.target.closest('[data-base]');
  if (base) return runAction('base', base.dataset.base);
  const gv = e.target.closest('[data-gv]');
  if (gv) {
    return runAction('games', gv.dataset.gv);
  }
  const toggle = e.target.closest('[data-toggle]');
  if (toggle) return runAction('toggle', toggle.dataset.toggle);
  });

  bindClick('zapret-youtube-apply', () => {
  const val = youtubeSelect ? youtubeSelect.value : '';
  if (!val) {
    setZapretError('Выберите YouTube-стратегию');
    return;
  }
  runAction('youtube', val);
  });

  bindClick('zapret-discord-apply', () => {
  const val = discordSelect ? discordSelect.value : '';
  if (!val) {
    setZapretError('Выберите Discord-стратегию (Dv)');
    return;
  }
  runAction('discord_dv', val);
  });

  const panelDiscord = document.getElementById('zapret-panel-discord');
  if (panelDiscord) panelDiscord.addEventListener('click', (e) => {
  const script = e.target.closest('[data-discord-script]');
  if (script) {
    const val = script.dataset.discordScript;
    if (!val || val === 'remove') return runAction('discord_script', 'remove');
    if (script.classList.contains('active') || (zapretData && zapretData.discord_script === val)) {
      return runAction('discord_script', 'remove');
    }
    return runAction('discord_script', val);
  }
  });

  if (hostsOverlay) {
    hostsOverlay.addEventListener('click', (e) => {
      if (e.target === hostsOverlay) hideHostsModal();
    });
  }
  const hostsBody = document.getElementById('hosts-body');
  if (hostsBody) hostsBody.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) return runAction('toggle', toggle.dataset.toggle);
    const block = e.target.closest('[data-hosts]');
    if (block) return runAction('hosts', block.dataset.hosts);
    const preset = e.target.closest('[data-hosts-preset]');
    if (!preset) return;
    runAction('hosts', preset.dataset.hostsPreset);
  });

  bindClick('zapret-test-current', () => runTest('current'));

  bindClick('zapret-test-domain', () => {
  const input = document.getElementById('zapret-test-domains');
  const val = input ? input.value.trim() : '';
  if (!val) {
    setZapretError('Введите один или несколько доменов');
    return;
  }
  runTest('domain', { domains: val });
  });

  const testStrategyType = document.getElementById('zapret-test-strategy-type');
  if (testStrategyType) {
    testStrategyType.addEventListener('change', (e) => {
      testStrategiesType = '';
      loadTestStrategies(e.target.value, true);
    });
  }

  bindClick('zapret-test-strategy', () => {
  const typeSelect = document.getElementById('zapret-test-strategy-type');
  const listSelect = document.getElementById('zapret-test-strategy-select');
  const type = typeSelect ? typeSelect.value : '';
  const name = listSelect ? listSelect.value : '';
  if (!name) {
    setZapretError('Выберите стратегию из списка');
    return;
  }
  runTest('strategy', { type: type, name: name });
  });

  const panelTestHistory = document.getElementById('zapret-panel-test-history');
  if (panelTestHistory) panelTestHistory.addEventListener('click', (e) => {
  const row = e.target.closest('[data-panel-test-id]');
  if (!row) return;
  togglePanelTestDetail(row.dataset.panelTestId);
  });

  bindClick('zapret-panel-test-refresh', () => {
    panelTestHistoryLoaded = false;
    loadPanelTestHistory(true);
  });

  bindClick('zapret-panel-test-clear', async () => {
  if (busy) return;
  busy = true;
  setZapretError('');
  setZapretStatus('История тестов…', 'info', { title: 'Очистка', progress: true });
  try {
    const data = await zapretTest('clear-panel');
    if (!data.ok) {
      setZapretError(data.error || 'Ошибка удаления');
      setZapretStatus('');
      return;
    }
    selectedPanelTestId = '';
    renderPanelTestDetail(null);
    renderPanelTestHistory(data.data);
    panelTestHistoryLoaded = true;
    if (zapretData && zapretData.test_history) {
      zapretData.test_history.panel = false;
      renderOverview(zapretData);
    }
    setZapretStatus('История тестов', 'success', { title: 'Очищено' });
  } catch (err) {
    setZapretError('Ошибка сети: ' + err.message);
    setZapretStatus('');
  } finally {
    busy = false;
  }
  });

  bindClick('zapret-test-refresh-saved', () => {
    testResultsLoaded = false;
    loadSavedTestResults(true);
  });

  bindClick('zapret-test-clear', async () => {
  if (busy) return;
  busy = true;
  setZapretError('');
  setZapretStatus('Результаты тестов…', 'info', { title: 'Очистка', progress: true });
  try {
    const data = await zapretTest('clear');
    if (!data.ok) {
      setZapretError(data.error || 'Ошибка удаления');
      setZapretStatus('');
      return;
    }
    renderSavedTestResults(data.data);
    if (zapretData) {
      if (zapretData.test_history) {
        zapretData.test_history.versions = false;
        zapretData.test_history.domain = false;
      }
      renderOverview(zapretData);
    }
    setZapretStatus('Результаты тестов', 'success', { title: 'Удалено' });
  } catch (err) {
    setZapretError('Ошибка сети: ' + err.message);
    setZapretStatus('');
  } finally {
    busy = false;
  }
  });

  const panelSystem = document.getElementById('zapret-panel-system');
  if (panelSystem) panelSystem.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-system]');
    if (!btn) return;
    const val = btn.dataset.system;
    if (val === 'backup-restore' && !confirm('Восстановить из резервной копии? Текущие настройки Zapret будут заменены.')) return;
    if (val === 'backup-delete' && !confirm('Удалить резервную копию Zapret?')) return;
    const target = val.startsWith('backup-') ? 'backup' : val;
    const value = val.startsWith('backup-') ? val.replace('backup-', '') : '';
    runAction(target, value);
  });
}

// Скрипты подключаются через document.write в конце body — DOM уже готов.
// Как app.js: не ждём DOMContentLoaded, иначе обработчики могут не повеситься.
initZapretUi();