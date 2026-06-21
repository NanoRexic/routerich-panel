'use strict';

const zapretOverlay = document.getElementById('zapret-overlay');
const zapretError = document.getElementById('zapret-error');
const zapretStatus = document.getElementById('zapret-status');
const zapretTabs = document.querySelectorAll('.zapret-tab');
const zapretPanels = document.querySelectorAll('.zapret-panel');
const youtubeSelect = document.getElementById('zapret-youtube-select');
const discordSelect = document.getElementById('zapret-discord-select');

let zapretData = null;
let youtubeLoaded = false;
let testResultsLoaded = false;
let testStrategiesType = '';
let busy = false;

const TEST_TYPE_LABELS = {
  versions: 'Стратегии v',
  flowseal: 'Flowseal',
  all: 'v + Flowseal',
  domain: 'По домену'
};

function setZapretError(msg) {
  if (!msg) {
    zapretError.hidden = true;
    return;
  }
  zapretError.textContent = msg;
  zapretError.hidden = false;
}

function setZapretStatus(msg, type) {
  if (!msg) {
    zapretStatus.hidden = true;
    return;
  }
  zapretStatus.hidden = false;
  zapretStatus.className = 'zapret-status ' + (type || 'info');
  zapretStatus.textContent = msg;
}

function badge(on, label) {
  const cls = on ? 'zp-badge on' : 'zp-badge off';
  return '<span class="' + cls + '">' + label + (on ? ' ✓' : '') + '</span>';
}

function fmtStrategy(s) {
  if (!s) return '—';
  return s;
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

  el.innerHTML =
    '<div class="zp-grid zp-grid-compact">' +
    '<div class="zp-card"><span class="zp-label">Статус</span><span class="' + runCls + '">' + run + '</span></div>' +
    '<div class="zp-card"><span class="zp-label">Версия</span><span>' + (d.version || '—') + '</span></div>' +
    '<div class="zp-card"><span class="zp-label">NFQ</span><span>' + (d.nfq ? d.nfq.running + '/' + d.nfq.total : '—') + '</span></div>' +
    '<div class="zp-card"><span class="zp-label">Актуальная</span><span>' + (d.latest_version || '—') + '</span></div>' +
    '<div class="zp-card"><span class="zp-label">Manager</span><span>v' + (d.manager_version || '?') + '</span></div>' +
    '</div>' +
    '<div class="zp-section zp-section-compact"><h3>Конфигурация</h3><div class="zp-badges">' +
    badge(!!d.strategy.base, 'База: ' + fmtStrategy(d.strategy.base)) +
    badge(!!d.strategy.youtube, 'YT: ' + fmtStrategy(d.strategy.youtube)) +
    badge(!!d.strategy.discord, 'Discord: ' + fmtStrategy(d.strategy.discord)) +
    badge(!!d.strategy.games, 'Игры: ' + fmtStrategy(d.strategy.games)) +
    badge(!!d.strategy.flowseal, fmtStrategy(d.strategy.flowseal)) +
    badge(d.strategy.rkn, 'RKN') +
    badge(d.strategy.wssize, 'wssize') +
    badge(d.strategy.methodeol, 'methodeol') +
    badge(d.strategy.udp443, 'udp443') +
    badge(d.quic_blocked, 'QUIC') +
    badge(d.ipv6_enabled, 'IPv6') +
    badge(d.finland_ips, 'Finland') +
    '</div>' +
    (d.hosts_preset || extras.length
      ? '<p class="zp-muted zp-overview-meta">Hosts: ' + (d.hosts_preset || 'нет') +
        (extras.length ? ' · ' + extras.join(' · ') : '') + '</p>'
      : '') +
    '</div>';
}

function renderTestHistory(history) {
  if (!history) return '';
  const parts = [];
  if (history.versions) parts.push('v');
  if (history.flowseal) parts.push('Flowseal');
  if (history.all) parts.push('all');
  if (history.domain) parts.push('domain');
  if (!parts.length) return '';
  return '<p class="zp-muted">Сохранённые тесты: ' + parts.join(', ') + '</p>';
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
    const gv = (s.games || '').replace(/^#?/, '');
    btn.classList.toggle('active', btn.dataset.gv === gv.replace(/^Gv/, ''));
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
    else if (key === 'finland') on = d.finland_ips;
    btn.classList.toggle('active', !!on);
  });
  document.querySelectorAll('[data-discord-script]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.discordScript === d.discord_script);
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
  const res = await fetch('/cgi-bin/zapret-api?' + qs.toString());
  return parseZapretResponse(res);
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

async function prepareFlowsealStrategies() {
  const res = await fetch('/cgi-bin/zapret-api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'prepare-flowseal' })
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
    let data = await zapretGet('test-strategies', { type: selectedType });

    if (selectedType === 'flowseal' && data.ok && data.data && data.data.ready === false) {
      setZapretStatus('Скачивание стратегий Flowseal… Может занять 1–2 минуты.', 'info');
      const prep = await prepareFlowsealStrategies();
      if (!prep.ok) {
        listSelect.innerHTML = '<option value="">— ошибка скачивания —</option>';
        setZapretError(prep.error || 'Не удалось скачать Flowseal');
        setZapretStatus('');
        return;
      }
      data = await zapretGet('test-strategies', { type: 'flowseal' });
      setZapretStatus('');
    }

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
  if (!silent) setZapretStatus('Загрузка статуса…', 'info');
  setZapretError('');
  try {
    const data = await zapretGet('status');
    if (!data.ok) {
      setZapretError(data.error || 'Не удалось получить статус');
      setZapretStatus('');
      return;
    }
    zapretData = data.data;
    if (!zapretData.installed) {
      setZapretError('Zapret не установлен на роутере');
    }
    renderOverview(zapretData);
    renderHostsBlocks(zapretData);
    syncStrategyUI(zapretData);
    if (!silent) setZapretStatus('Обновлено', 'success');
    setTimeout(() => { if (!busy) setZapretStatus(''); }, 1500);
  } catch (err) {
    setZapretError('Ошибка сети: ' + err.message);
    setZapretStatus('');
  }
}

async function runTest(mode, options) {
  if (busy) return;
  busy = true;
  setZapretError('');
  const waitMsg = mode === 'strategy'
    ? 'Тест стратегии… Применение, проверка доменов, восстановление конфига.'
    : 'Тестирование… Это может занять до минуты.';
  setZapretStatus(waitMsg, 'info');
  try {
    const data = await zapretTest(mode, options);
    if (!data.ok) {
      setZapretError(data.error || 'Ошибка теста');
      setZapretStatus('');
      return;
    }
    renderTestResult(data.data);
    setZapretStatus('Тест завершён', 'success');
    setTimeout(() => setZapretStatus(''), 2500);
  } catch (err) {
    setZapretError('Ошибка сети: ' + err.message);
    setZapretStatus('');
  } finally {
    busy = false;
  }
}

async function runAction(target, value, confirmMsg) {
  if (busy) return;
  if (confirmMsg && !confirm(confirmMsg)) return;
  busy = true;
  setZapretError('');
  setZapretStatus('Применение…', 'info');
  try {
    const data = await zapretApply(target, value);
    if (!data.ok) {
      setZapretError(data.error || 'Ошибка применения');
      setZapretStatus('');
      return;
    }
    zapretData = data.data;
    renderOverview(zapretData);
    renderHostsBlocks(zapretData);
    syncStrategyUI(zapretData);
    setZapretStatus('Готово', 'success');
    setTimeout(() => setZapretStatus(''), 2000);
  } catch (err) {
    setZapretError('Ошибка сети: ' + err.message);
    setZapretStatus('');
  } finally {
    busy = false;
  }
}

function showZapretModal() {
  zapretOverlay.hidden = false;
  document.body.classList.add('modal-open');
  setZapretError('');
  setZapretStatus('');
  youtubeLoaded = false;
  testResultsLoaded = false;
  testStrategiesType = '';
  refreshZapret();
  loadYoutubeList();
  loadSavedTestResults();
  loadTestStrategies();
}

function hideZapretModal() {
  zapretOverlay.hidden = true;
  document.body.classList.remove('modal-open');
}

function switchTab(tabId) {
  zapretTabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === tabId));
  zapretPanels.forEach((p) => p.classList.toggle('active', p.id === 'zapret-panel-' + tabId));
  if (tabId === 'strategies') {
    loadYoutubeList();
  }
  if (tabId === 'test') {
    loadSavedTestResults();
    loadTestStrategies();
  }
}

document.getElementById('btn-zapret').addEventListener('click', showZapretModal);
document.getElementById('zapret-close').addEventListener('click', hideZapretModal);
document.getElementById('zapret-refresh').addEventListener('click', () => refreshZapret());

zapretOverlay.addEventListener('click', (e) => {
  if (e.target === zapretOverlay) hideZapretModal();
});

zapretTabs.forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

document.getElementById('zapret-panel-overview').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-service]');
  if (!btn) return;
  const map = { start: 'Запустить Zapret?', stop: 'Остановить Zapret?', restart: 'Перезапустить Zapret?' };
  runAction(btn.dataset.service, '', map[btn.dataset.service]);
});

document.getElementById('zapret-panel-strategies').addEventListener('click', (e) => {
  const base = e.target.closest('[data-base]');
  if (base) return runAction('base', base.dataset.base);
  const gv = e.target.closest('[data-gv]');
  if (gv) {
    if (gv.dataset.gv === 'remove') return runAction('games', 'remove');
    return runAction('games', gv.dataset.gv);
  }
  const toggle = e.target.closest('[data-toggle]');
  if (toggle) return runAction('toggle', toggle.dataset.toggle);
});

document.getElementById('zapret-youtube-apply').addEventListener('click', () => {
  const val = youtubeSelect ? youtubeSelect.value : '';
  if (!val) {
    setZapretError('Выберите YouTube-стратегию');
    return;
  }
  runAction('youtube', val, 'Применить ' + val + '? Zapret будет перезапущен.');
});

document.getElementById('zapret-discord-apply').addEventListener('click', () => {
  const val = discordSelect ? discordSelect.value : '';
  if (!val) {
    setZapretError('Выберите Discord-стратегию (Dv)');
    return;
  }
  runAction('discord_dv', val, 'Применить Dv' + val + '? Zapret будет перезапущен.');
});

document.getElementById('zapret-panel-discord').addEventListener('click', (e) => {
  const script = e.target.closest('[data-discord-script]');
  if (script) {
    const val = script.dataset.discordScript;
    if (val === 'remove') return runAction('discord_script', 'remove', 'Удалить Discord-скрипт?');
    return runAction('discord_script', val);
  }
  const finland = e.target.closest('[data-finland]');
  if (finland) return runAction('toggle', 'finland');
});

document.getElementById('zapret-panel-hosts').addEventListener('click', (e) => {
  const block = e.target.closest('[data-hosts]');
  if (block) return runAction('hosts', block.dataset.hosts);
  const preset = e.target.closest('[data-hosts-preset]');
  if (!preset) return;
  const val = preset.dataset.hostsPreset;
  const warns = { reset: 'Сбросить /etc/hosts до стандартного?', mafioznik: 'Заменить hosts на Mafioznik?', malw: 'Заменить hosts на Malw.link?', geohide: 'Заменить hosts на GeoHide?' };
  runAction('hosts', val, warns[val]);
});

document.getElementById('zapret-test-current').addEventListener('click', () => {
  runTest('current');
});

document.getElementById('zapret-test-domain').addEventListener('click', () => {
  const input = document.getElementById('zapret-test-domains');
  const val = input ? input.value.trim() : '';
  if (!val) {
    setZapretError('Введите один или несколько доменов');
    return;
  }
  runTest('domain', { domains: val });
});

document.getElementById('zapret-test-strategy-type').addEventListener('change', (e) => {
  testStrategiesType = '';
  loadTestStrategies(e.target.value, true);
});

document.getElementById('zapret-test-strategy').addEventListener('click', () => {
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

document.getElementById('zapret-test-refresh-saved').addEventListener('click', () => {
  testResultsLoaded = false;
  loadSavedTestResults(true);
});

document.getElementById('zapret-test-clear').addEventListener('click', async () => {
  if (busy) return;
  if (!confirm('Удалить все сохранённые результаты тестирования на роутере?')) return;
  busy = true;
  setZapretError('');
  setZapretStatus('Удаление…', 'info');
  try {
    const data = await zapretTest('clear');
    if (!data.ok) {
      setZapretError(data.error || 'Ошибка удаления');
      setZapretStatus('');
      return;
    }
    renderSavedTestResults(data.data);
    if (zapretData) {
      zapretData.test_history = { versions: false, flowseal: false, all: false, domain: false };
      renderOverview(zapretData);
    }
    setZapretStatus('Результаты удалены', 'success');
    setTimeout(() => setZapretStatus(''), 2000);
  } catch (err) {
    setZapretError('Ошибка сети: ' + err.message);
    setZapretStatus('');
  } finally {
    busy = false;
  }
});

document.getElementById('zapret-panel-system').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-system]');
  if (!btn) return;
  const val = btn.dataset.system;
  const map = {
    exclude_update: 'Обновить список исключений? Zapret будет перезапущен.',
    'backup-save': 'Сохранить резервную копию Zapret?',
    'backup-restore': 'Восстановить из резервной копии? Текущие настройки будут заменены.',
    'backup-delete': 'Удалить резервную копию?'
  };
  const target = val.startsWith('backup-') ? 'backup' : val;
  const value = val.startsWith('backup-') ? val.replace('backup-', '') : '';
  runAction(target, value, map[val]);
});