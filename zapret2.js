'use strict';

(function () {
  const overlay = document.getElementById('zapret2-overlay');
  const tabs = document.querySelectorAll('#zapret2-tabs .zapret-tab');
  const panels = document.querySelectorAll('#zapret2-overlay .zapret-panel');
  const notify = () => window.RouteRichNotify;

  let data = null;
  let busy = false;
  let pollTimer = null;
  let slotPollTimer = null;
  let liveTimer = null;
  let liveJob = null;
  let liveLog = '';
  let liveSyncedAt = 0;
  let resultItems = [];
  let selectedStamp = '';
  let nfqOpen = false;

  function showError(msg) {
    const n = notify();
    if (!n) return;
    if (!msg) {
      if (n.dismissAllByGroup) n.dismissAllByGroup('zapret2-error');
      return;
    }
    n.show({ message: msg, type: 'error', source: 'Zapret2', title: 'Ошибка', group: 'zapret2-error' });
  }

  function showStatus(msg, type, opts) {
    const n = notify();
    if (!n) return;
    opts = opts || {};
    if (!msg) {
      if (n.dismissAllByGroup) n.dismissAllByGroup('zapret2-status');
      return;
    }
    const statusType = type || 'info';
    n.show({
      message: msg,
      type: statusType,
      source: 'Zapret2',
      title: opts.title || (opts.progress ? 'Подождите' : 'Zapret2'),
      group: 'zapret2-status',
      stack: false,
      toastOnly: true,
      progress: !!opts.progress,
      persistent: !!opts.progress,
      duration: opts.progress ? 0 : 4500
    });
  }

  async function parseResponse(res) {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error('Некорректный ответ API');
    }
  }

  async function apiGet(action, extra) {
    let url = '/cgi-bin/zapret2-api?action=' + encodeURIComponent(action || 'status');
    if (extra) url += extra;
    const res = await fetch(url);
    return parseResponse(res);
  }

  async function apiApply(target, extra) {
    const body = Object.assign({}, extra || {}, { action: 'apply', target: target });
    const res = await fetch('/cgi-bin/zapret2-api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return parseResponse(res);
  }

  function v1Active(d) {
    return !!(d && d.zapret1 && (d.zapret1.running || d.zapret1.autostart));
  }

  function renderConflict(d) {
    const el = document.getElementById('zapret2-conflict-banner');
    if (!el) return;
    if (v1Active(d)) {
      el.hidden = false;
      el.className = 'zapret-zapret2-banner warn';
      el.innerHTML =
        '<strong>Запущен Zapret v1</strong>' +
        '<p>Вместе с Zapret2 он работать не может. Запуск Zapret2 остановит v1.</p>';
      return;
    }
    el.hidden = true;
    el.innerHTML = '';
  }

  function renderMissing(d) {
    const el = document.getElementById('zapret2-missing-banner');
    const body = document.getElementById('zapret2-body');
    const tabbar = document.getElementById('zapret2-tabs');
    if (!el) return;
    if (d && d.installed) {
      el.hidden = true;
      el.innerHTML = '';
      if (body) body.classList.remove('zapret-disabled');
      if (tabbar) tabbar.classList.remove('zapret-disabled');
      return;
    }
    el.hidden = false;
    el.className = 'zapret-install-banner warn';
    el.innerHTML =
      '<strong>Zapret2 не найден</strong>' +
      '<p>Установка пакета Routerich Zapret2. Zapret v1 будет удалён.</p>' +
      '<button type="button" class="btn btn-primary btn-sm" id="z2-install-btn">Установить Zapret2</button>';
    if (body) body.classList.add('zapret-disabled');
    if (tabbar) tabbar.classList.add('zapret-disabled');
  }

  function badge(on, label) {
    return '<span class="zp-badge ' + (on ? 'on' : 'off') + '">' + label + (on ? ' ✓' : '') + '</span>';
  }

  function isGamesProfile(p) {
    const name = (p && typeof p === 'object') ? String(p.name || '') : String(p || '');
    return name.indexOf('games_') === 0;
  }

  function renderOverview(d) {
    const el = document.getElementById('zapret2-overview');
    if (!el || !d) return;
    const run = d.running ? 'Запущен' : 'Остановлен';
    const runCls = d.running ? 'zp-run on' : 'zp-run off';
    const bcwInstalled = !!(d.blockcheckw && d.blockcheckw.installed);
    const bcwRun = !!(d.blockcheckw && d.blockcheckw.running);
    const bcwLabel = !bcwInstalled ? 'нет' : (bcwRun ? 'идёт поиск' : 'установлен');
    const bcwCls = !bcwInstalled ? 'zp-run off' : 'zp-run on';
    const gv = d.games && d.games.active ? ('Gv' + d.games.active) : 'выкл';
    const liveBlocks = (d.nfq_blocks && d.nfq_blocks.length)
      ? d.nfq_blocks
      : (d.profiles || []).filter(function (p) { return p.enabled; }).map(function (p) {
          return { name: p.name, kind: 'profile', filter: [p.port, p.protocol].filter(Boolean).join('/') };
        });
    const nfqDetail = liveBlocks.length
      ? '<ul class="z2-nfq-list">' + liveBlocks.map(function (b) {
          const kind = b.kind === 'script' ? 'скрипт' : 'профиль';
          return '<li>' +
            '<span class="z2-nfq-name zp-run on">' + b.name + '</span>' +
            '<span class="z2-nfq-kind zp-muted">' + kind + '</span>' +
            '<span class="z2-nfq-filter zp-muted">' + (b.filter || '') + '</span>' +
            '</li>';
        }).join('') + '</ul>'
      : '<p class="zp-muted">Нет активных блоков.</p>';
    el.innerHTML =
      '<div class="zp-grid zp-grid-compact">' +
      '<div class="zp-card"><span class="zp-label">Статус</span><span class="' + runCls + '">' + run + '</span></div>' +
      '<div class="zp-card"><span class="zp-label">Автозапуск</span><span>' + (d.autostart ? 'да' : 'нет') + '</span></div>' +
      '<button type="button" class="zp-card zp-card-btn' + (nfqOpen ? ' active' : '') + '" data-z2-nfq aria-expanded="' + (nfqOpen ? 'true' : 'false') + '">' +
      '<span class="zp-label">NFQ</span><span>' + (d.nfqws2 || 0) + '</span>' +
      '<span class="zp-card-hint">' + (nfqOpen ? 'Скрыть' : 'Просмотр') + '</span></button>' +
      '<div class="zp-card"><span class="zp-label">Поиск</span><span class="' + bcwCls + '">' + bcwLabel + '</span></div>' +
      '<div class="zp-card"><span class="zp-label">Zapret v1</span><span class="' + (v1Active(d) ? 'zp-run off' : 'zp-run on') + '">' +
      (v1Active(d) ? 'активен' : 'выкл') + '</span></div>' +
      '<div class="zp-card"><span class="zp-label">Игры</span><span>' + gv + (d.games && d.games.xtreme ? ' Xtreme' : '') + '</span></div>' +
      '<div class="zp-card"><span class="zp-label">Версия</span><span>' + (d.version || '—') + '</span></div>' +
      '</div>' +
      '<div class="z2-nfq-detail"' + (nfqOpen ? '' : ' hidden') + '>' +
      '<h3>Сейчас в работе</h3>' +
      (d.running ? nfqDetail : '<p class="zp-muted">Служба остановлена.</p>') +
      '</div>' +
      '<div class="zp-section zp-section-compact"><h3>Профили</h3><div class="zp-badges">' +
      (d.profiles || []).filter(function (p) { return !isGamesProfile(p); }).map(function (p) {
        const n = (p.slots || []).length;
        const live = p.live_count || 0;
        return badge(p.enabled, p.name + (n ? ' · ' + live + '/' + n : ''));
      }).join('') +
      '</div></div>';
  }

  function renderStrategies(d) {
    const el = document.getElementById('zapret2-strategies');
    if (!el) return;
    const profiles = ((d && d.profiles) || []).filter(function (p) { return !isGamesProfile(p); });
    if (!profiles.length) {
      el.innerHTML = '<p class="zp-muted">Нет стратегий.</p>';
      return;
    }
    el.innerHTML = profiles.map(function (p) {
      const disabled = {};
      (p.disabled || []).forEach(function (id) { disabled[id] = true; });
      const st = (d && d.slottest) || {};
      const testing = !!(st.running && st.name === p.name);
      const scores = {};
      const kept = {};
      if (p.last_test && p.last_test.scores) {
        p.last_test.scores.forEach(function (s) { scores[s.id] = s; });
      }
      (p.last_test && p.last_test.keep ? p.last_test.keep : []).forEach(function (id) { kept[id] = true; });
      const stale = p.stale
        ? '<div class="zapret-zapret2-banner warn z2-stale">' +
          '<strong>Профиль изменён вне панели</strong>' +
          '<button type="button" class="btn btn-outline btn-sm" data-z2-resync="' + p.name + '">Взять текущий</button> ' +
          '<button type="button" class="btn btn-secondary btn-sm" data-z2-reapply="' + p.name + '">Вернуть отсев</button>' +
          '</div>'
        : '';
      const slots = (p.slots || []).map(function (s) {
        const on = !disabled[s.id];
        const fn = String(s.label || '').split(/\s+/)[0] || '';
        const tip = String(s.hint || s.label || '').replace(/"/g, '&quot;');
        const sc = scores[s.id];
        const score = sc ? '<span class="z2-slot-score' + (kept[s.id] ? ' best' : '') + '">' + sc.ok + '/' + sc.total + '</span>' : '';
        return '<button type="button" class="zp-toggle z2-slot' + (on ? ' active' : '') + '" data-z2-slot="' + p.name + ':' + s.id + '" title="' +
          tip + (p.slots.length > 1 ? ' · перетащите для порядка' : '') + '">' +
          '<span class="z2-slot-num">#' + s.id + '</span>' +
          (fn ? '<span class="z2-slot-fn">' + fn + '</span>' : '') +
          score +
          '</button>';
      }).join('');
      const dragHint = (p.slots || []).length > 1
        ? '<p class="zp-muted z2-drag-hint">Перетащите слоты, чтобы сменить порядок. Нажатие — вкл/выкл.</p>'
        : '';
      const testBtn = (p.slots || []).length
        ? (testing
          ? '<button type="button" class="btn btn-outline btn-sm zp-toggle-danger" data-z2-slottest-stop="' + p.name + '">Стоп теста ' +
            (st.current || 0) + '/' + (st.total_slots || p.slots.length) + '</button>'
          : '<button type="button" class="btn btn-outline btn-sm" data-z2-slottest="' + p.name + '">Тест слотов</button>')
        : '';
      const testNote = testing
        ? '<p class="zp-muted z2-drag-hint">Только включённые. Список хостов профиля (иначе v1). 5 лучших станут #1–#5.</p>'
        : '';
      return '<div class="zp-section z2-profile" data-profile="' + p.name + '">' +
        '<div class="z2-profile-head">' +
        '<h3>' + p.name + '</h3>' +
        '<button type="button" class="zp-toggle' + (p.enabled ? ' active' : '') + '" data-z2-profile="' + p.name + '">' +
        (p.enabled ? 'Вкл' : 'Выкл') + '</button> ' +
        '<button type="button" class="zp-toggle' + (p.circ_style === 'pkts' ? ' active' : '') +
        '" data-z2-circ-style="' + p.name + '" title="seq: −s34228/−s5556 · d20: −d20/−d10">' +
        (p.circ_style === 'pkts' ? 'd20' : 'seq') + '</button> ' +
        testBtn +
        '<span class="zp-muted">' + [p.port, p.protocol, p.hostlist].filter(Boolean).join(' ') + '</span>' +
        '</div>' +
        stale +
        dragHint +
        testNote +
        (slots ? '<div class="z2-slot-grid">' + slots + '</div>' : '') +
        '</div>';
    }).join('');
  }

  function fillBcwForm(d) {
    const cfg = (d && d.bcw) || {};
    const set = function (id, val) {
      const el = document.getElementById(id);
      if (el && val != null && val !== '') el.value = val;
    };
    set('z2-bcw-domains', cfg.domains);
    set('z2-bcw-workers', cfg.workers);
    set('z2-bcw-proto', cfg.proto);
    set('z2-bcw-dns', cfg.dns);
    set('z2-bcw-timeout', cfg.timeout);
  }

  function fillEmbedTargets(d) {
    const sel = document.getElementById('z2-embed-target');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '';
    ((d && d.profiles) || []).forEach(function (p) {
      if (isGamesProfile(p)) return;
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
    if (!sel.options.length) {
      const opt = document.createElement('option');
      opt.value = 'youtube';
      opt.textContent = 'youtube';
      sel.appendChild(opt);
    }
    if (cur) sel.value = cur;
  }

  function syncEmbedMode() {
    const modeSel = document.getElementById('z2-embed-mode');
    const target = document.getElementById('z2-embed-target');
    const nameInp = document.getElementById('z2-embed-name');
    const isNew = !!(modeSel && modeSel.value === 'new');
    if (target) target.hidden = isNew;
    if (nameInp) nameInp.hidden = !isNew;
  }

  function sanitizeProfileName(s) {
    return String(s || '').replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
  }

  async function embedApply(extra, created, mode) {
    if (busy) return;
    busy = true;
    showError('');
    showStatus('Встройка', 'info', { progress: true, title: 'Применение' });
    try {
      const res = await apiApply('bcw-embed', extra);
      if (!res.ok) {
        showError(res.error || 'Ошибка');
        showStatus('');
        return;
      }
      applyData(res.data);
      if (mode === 'new' && created) {
        const modeSel = document.getElementById('z2-embed-mode');
        const nameInp = document.getElementById('z2-embed-name');
        if (modeSel) modeSel.value = 'circular-front';
        if (nameInp) nameInp.value = '';
        syncEmbedMode();
        fillEmbedTargets(data);
        const sel = document.getElementById('z2-embed-target');
        if (sel) sel.value = created;
      }
      showStatus(mode === 'new' ? 'Профиль ' + created : 'Встроено', 'success', { title: 'Применено' });
    } catch (e) {
      showError('Ошибка сети: ' + e.message);
      showStatus('');
    } finally {
      busy = false;
    }
  }

  function currentArgs() {
    const el = document.getElementById('z2-bcw-results');
    const checked = el && el.querySelector('input[name="z2-result"]:checked');
    if (checked) {
      const v = resultItems[Number(checked.value)];
      if (v) return String(v);
    }
    return resultItems[0] ? String(resultItems[0]) : '';
  }

  function modeLabel(mode) {
    if (mode === 'quick') return 'быстрый';
    if (mode === 'full') return 'полный';
    if (mode === 'universal') return 'универсальный';
    return mode || '';
  }

  function reportLabel(r) {
    if (!r) return '';
    const parts = [];
    if (r.domains) parts.push(r.domains);
    if (r.mode) parts.push(modeLabel(r.mode));
    if (r.count != null && r.count !== '') parts.push(r.count + ' шт.');
    if (r.stamp) parts.push(String(r.stamp).replace(/_/g, ' '));
    return parts.join(' · ') || r.stamp || '';
  }

  function fillSavedReports(d) {
    const sel = document.getElementById('z2-bcw-saved');
    if (!sel) return;
    const items = (d && d.results) || [];
    const keep = selectedStamp || sel.value;
    sel.innerHTML = '';
    if (!items.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Нет сохранённых отчётов';
      sel.appendChild(opt);
      return;
    }
    items.forEach(function (r) {
      const opt = document.createElement('option');
      opt.value = r.stamp;
      opt.textContent = reportLabel(r);
      sel.appendChild(opt);
    });
    if (keep) sel.value = keep;
    if (!sel.value && items[0]) sel.value = items[0].stamp;
  }

  function renderResultsPending() {
    const el = document.getElementById('z2-bcw-results');
    resultItems = [];
    selectedStamp = '';
    if (el) el.innerHTML = '<p class="zp-muted">Идёт поиск…</p>';
  }

  function renderResultsList(items, verified, meta) {
    const el = document.getElementById('z2-bcw-results');
    if (!el) return;
    resultItems = (items || []).map(function (x) { return String(x || ''); }).filter(Boolean);
    if (!resultItems.length) {
      el.innerHTML = '<p class="zp-muted">Нет стратегий в отчёте.</p>';
      return;
    }
    const bits = [];
    if (meta && meta.domains) bits.push(meta.domains);
    if (meta && meta.mode) bits.push(modeLabel(meta.mode));
    bits.push(resultItems.length + ' шт.');
    el.innerHTML = '<p class="zp-muted">' + bits.join(' · ') + '</p>' + resultItems.map(function (args, i) {
      const short = args.replace(/^nfqws2\s+/, '');
      return '<label class="z2-result">' +
        '<input type="radio" name="z2-result" value="' + i + '"' + (i === 0 ? ' checked' : '') + '>' +
        '<code>' + short.replace(/</g, '&lt;') + '</code>' +
        (verified ? '<span class="zp-badge on">check</span>' : '<span class="zp-badge">scan</span>') +
        '</label>';
    }).join('');
  }

  async function loadReport(stamp) {
    if (!stamp) return;
    selectedStamp = stamp;
    const sel = document.getElementById('z2-bcw-saved');
    if (sel && sel.value !== stamp) sel.value = stamp;
    const det = await apiGet('bcw-result', '&id=' + encodeURIComponent(stamp));
    if (!det.ok) {
      showError(det.error || 'Отчёт не найден');
      return;
    }
    const rec = det.data || {};
    renderResultsList(rec.strategies || [], !!rec.verified, { domains: rec.domains, mode: rec.mode });
  }

  function showSearchProgress(on) {
    const el = document.getElementById('z2-bcw-progress');
    if (el) el.hidden = !on;
  }

  function jobSearching(job) {
    if (!job) return false;
    return !!(job.running || job.phase === 'running' || job.phase === 'starting');
  }

  function renderLog(text) {
    const el = document.getElementById('z2-bcw-log');
    if (!el) return;
    el.textContent = text || '';
    el.scrollTop = el.scrollHeight;
  }

  function parseScanMeta(log) {
    const t = String(log || '');
    const start = t.match(/\[START\] Scanning ([^:]+):\s*(\d+)\s*items/i);
    const workers = t.match(/workers\s*=\s*(\d+)/i);
    return {
      proto: start ? start[1].trim() : '',
      items: start ? Number(start[2]) : 0,
      workers: workers ? Number(workers[1]) : 0
    };
  }

  function formatElapsed(sec) {
    const n = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(n / 60);
    const s = n % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function jobElapsedSec(job) {
    const started = Number(job && job.started_at) || 0;
    const serverNow = Number(job && job.now) || 0;
    if (started && serverNow && serverNow >= started) {
      const extra = liveSyncedAt ? Math.max(0, Math.floor((Date.now() - liveSyncedAt) / 1000)) : 0;
      return serverNow - started + extra;
    }
    return Number(job && job.elapsed) || 0;
  }

  function renderSearchLive() {
    const box = document.getElementById('z2-bcw-live');
    const text = document.getElementById('z2-bcw-live-text');
    if (!box || !text) return;
    const on = jobSearching(liveJob);
    box.hidden = !on;
    if (!on) return;
    const meta = parseScanMeta(liveLog);
    const parts = ['Идёт проверка'];
    if (meta.proto) parts.push(meta.proto);
    if (meta.items) parts.push(meta.items + ' шт.');
    if (meta.workers) parts.push(meta.workers + ' потоков');
    parts.push(formatElapsed(jobElapsedSec(liveJob)));
    text.textContent = parts.join(' · ');
  }

  function startLiveTick(job, log) {
    if (job) {
      liveJob = job;
      liveSyncedAt = Date.now();
    }
    if (log != null) liveLog = log;
    renderSearchLive();
    if (liveTimer || !jobSearching(liveJob)) return;
    liveTimer = setInterval(renderSearchLive, 1000);
  }

  function stopLiveTick() {
    if (liveTimer) {
      clearInterval(liveTimer);
      liveTimer = null;
    }
    liveJob = null;
    liveLog = '';
    liveSyncedAt = 0;
    renderSearchLive();
  }

  function renderGames(d) {
    const gv = d && d.games && d.games.active;
    const xt = d && d.games && d.games.xtreme;
    document.querySelectorAll('#zapret2-panel-games [data-z2-gv]').forEach(function (btn) {
      const v = btn.dataset.z2Gv;
      if (v === 'xtreme') btn.classList.toggle('active', !!xt);
      else btn.classList.toggle('active', String(gv) === v);
    });
  }

  function applyData(d) {
    data = d;
    renderMissing(d);
    renderConflict(d);
    renderOverview(d);
    renderStrategies(d);
    fillBcwForm(d);
    fillEmbedTargets(d);
    fillSavedReports(d);
    syncEmbedMode();
    renderGames(d);
    renderLog(d && d.log);
    const running = jobSearching(d && d.job);
    showSearchProgress(running);
    if (running) startLiveTick(d && d.job, d && d.log);
    else stopLiveTick();
    if (running) {
      if (!resultItems.length) renderResultsPending();
    } else if (selectedStamp) {
      const sel = document.getElementById('z2-bcw-saved');
      if (sel && sel.value !== selectedStamp) sel.value = selectedStamp;
    } else if (d && d.results && d.results[0] && d.results[0].stamp) {
      loadReport(d.results[0].stamp);
    }
    if (running) startPoll();
    else stopPoll();
    if (d && d.slottest && d.slottest.running) startSlotPoll();
    else stopSlotPoll();
  }

  async function refresh(opts) {
    const silent = !!(opts && opts.silent);
    if (!silent) showStatus('Статус…', 'info', { progress: true, title: 'Обновление' });
    try {
      const res = await apiGet('status');
      if (!res.ok) {
        showError(res.error || 'Не удалось получить статус');
        if (!silent) showStatus('');
        return;
      }
      applyData(res.data);
      if (!silent) showStatus('Статус получен', 'success', { title: 'Обновлено' });
    } catch (e) {
      showError('Ошибка сети: ' + e.message);
      if (!silent) showStatus('');
    }
  }

  async function run(target, extra, label) {
    if (busy) return;
    if ((target === 'start' || target === 'restart') && v1Active(data)) {
      if (!confirm('Zapret v1 будет остановлен. Продолжить?')) return;
    }
    busy = true;
    showError('');
    showStatus(label || target, 'info', { progress: true, title: 'Применение' });
    try {
      const res = await apiApply(target, extra);
      if (!res.ok) {
        showError(res.error || 'Ошибка');
        showStatus('');
        return;
      }
      applyData(res.data);
      showStatus(label || 'Готово', 'success', { title: 'Применено' });
    } catch (e) {
      showError('Ошибка сети: ' + e.message);
      showStatus('');
    } finally {
      busy = false;
    }
  }

  async function startInstall() {
    if (busy) return;
    if (data && data.installed) return;
    if (data && data.zapret1 && (data.zapret1.installed || data.zapret1.running || data.zapret1.autostart)) {
      if (!confirm('Zapret v1 будет удалён. Продолжить установку Zapret2?')) return;
    }
    busy = true;
    showError('');
    showStatus('Установка Zapret2…', 'info', { progress: true, title: 'Установка' });
    try {
      const res = await apiApply('install');
      if (!res.ok) {
        showError(res.error || 'Не удалось установить Zapret2');
        showStatus('');
        return;
      }
      applyData(res.data);
      showStatus('Zapret2 установлен', 'success', { title: 'Установлено' });
    } catch (e) {
      showError('Ошибка сети: ' + e.message);
      showStatus('');
    } finally {
      busy = false;
    }
  }

  function collectBcw() {
    return {
      domains: (document.getElementById('z2-bcw-domains') || {}).value || 'rutracker.org',
      workers: Number((document.getElementById('z2-bcw-workers') || {}).value || 128),
      proto: (document.getElementById('z2-bcw-proto') || {}).value || 'tls12',
      dns: (document.getElementById('z2-bcw-dns') || {}).value || 'auto',
      timeout: Number((document.getElementById('z2-bcw-timeout') || {}).value || 600)
    };
  }

  async function startBcw(mode) {
    if (busy) return;
    if (!data || !data.blockcheckw || !data.blockcheckw.installed) {
      showError('blockcheckw не установлен на роутере');
      return;
    }
    busy = true;
    showStatus('Поиск стратегий…', 'info', { progress: true, title: 'blockcheckw' });
    renderResultsPending();
    renderLog('');
    showSearchProgress(true);
    startLiveTick({ running: true, phase: 'starting', started_at: Math.floor(Date.now() / 1000) }, '');
    try {
      const extra = Object.assign({ mode: mode }, collectBcw());
      extra.value = mode;
      const res = await apiApply('bcw-start', extra);
      if (!res.ok) {
        showSearchProgress(false);
        stopLiveTick();
        showError(res.error || 'Не удалось запустить поиск');
        showStatus('');
        return;
      }
      applyData(res.data);
      startPoll();
    } catch (e) {
      showSearchProgress(false);
      stopLiveTick();
      showError('Ошибка сети: ' + e.message);
      showStatus('');
    } finally {
      busy = false;
    }
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    stopLiveTick();
  }

  function stopSlotPoll() {
    if (slotPollTimer) {
      clearInterval(slotPollTimer);
      slotPollTimer = null;
    }
  }

  function startSlotPoll() {
    if (slotPollTimer) return;
    slotPollTimer = setInterval(async function () {
      try {
        const res = await apiGet('slottest-status');
        if (!res.ok || !res.data) return;
        const job = res.data.job || {};
        if (data) {
          data.slottest = Object.assign({}, job, { log: res.data.log || '' });
          renderStrategies(data);
        }
        if (!job.running && job.phase !== 'running') {
          stopSlotPoll();
          if (job.phase === 'error' || job.phase === 'starting') {
            showError(job.error || 'Тест не запустился');
            showStatus('');
          } else {
            showStatus(job.phase === 'stopped' ? 'Тест остановлен' : 'Оставлены 5 лучших', 'success', { title: 'Тест слотов' });
          }
          refresh({ silent: true });
        }
      } catch (e) { /* ignore */ }
    }, 2000);
  }

  async function startSlottest(name) {
    if (busy || !name) return;
    if (data && data.slottest && data.slottest.running) {
      showError('Тест слотов уже выполняется');
      return;
    }
    if (v1Active(data)) {
      if (!confirm('Zapret v1 будет остановлен на время проверки. Продолжить?')) return;
    }
    busy = true;
    showError('');
    showStatus('Тест слотов…', 'info', { progress: true, title: 'Проверка' });
    try {
      const res = await apiApply('slottest-start', { name: name, keep: 5 });
      if (!res.ok) {
        showError(res.error || 'Не удалось запустить тест');
        showStatus('');
        return;
      }
      applyData(res.data);
      startSlotPoll();
    } catch (e) {
      showError('Ошибка сети: ' + e.message);
      showStatus('');
    } finally {
      busy = false;
    }
  }

  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(async function () {
      try {
        const res = await apiGet('bcw-status');
        if (!res.ok || !res.data) return;
        const job = res.data.job || {};
        renderLog(res.data.log || '');
        showSearchProgress(jobSearching(job));
        if (jobSearching(job)) startLiveTick(job, res.data.log || '');
        else stopLiveTick();
        if (job.results) {
          const stamp = (job.results.split('/').pop() || '').replace(/\.json$/, '');
          if (stamp) {
            try { await loadReport(stamp); } catch (e) { /* ignore */ }
          }
        }
        if (!job.running && job.phase !== 'running') {
          showSearchProgress(false);
          stopPoll();
          if (job.phase === 'error' || job.phase === 'starting') {
            showError(job.error || 'Поиск не запустился');
            showStatus('');
          } else {
            showStatus(job.phase === 'stopped' ? 'Поиск остановлен' : 'Поиск завершён', 'success');
          }
          refresh({ silent: true });
        }
      } catch (e) { /* ignore poll errors */ }
    }, 2000);
  }

  function currentDisabled(name) {
    const p = ((data && data.profiles) || []).find(function (x) { return x.name === name; });
    return (p && p.disabled) ? p.disabled.slice() : [];
  }

  function switchTab(id) {
    tabs.forEach(function (t) { t.classList.toggle('active', t.dataset.tab === id); });
    panels.forEach(function (p) { p.classList.toggle('active', p.id === 'zapret2-panel-' + id); });
  }

  function showModal() {
    if (!overlay) return;
    overlay.hidden = false;
    document.body.classList.add('modal-open');
    refresh({ silent: true });
  }

  function hideModal() {
    if (!overlay) return;
    overlay.hidden = true;
    document.body.classList.remove('modal-open');
    stopPoll();
    stopSlotPoll();
  }

  function bind(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  }

  function init() {
    bind('btn-zapret2', showModal);
    bind('zapret2-close', hideModal);
    bind('zapret2-refresh', function () { refresh(); });
    const missing = document.getElementById('zapret2-missing-banner');
    if (missing) {
      missing.addEventListener('click', function (e) {
        if (e.target.closest('#z2-install-btn')) startInstall();
      });
    }
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) hideModal();
      });
    }
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () { switchTab(tab.dataset.tab); });
    });

    const overview = document.getElementById('zapret2-panel-overview');
    if (overview) overview.addEventListener('click', function (e) {
      const nfq = e.target.closest('[data-z2-nfq]');
      if (nfq) {
        nfqOpen = !nfqOpen;
        if (data) renderOverview(data);
        return;
      }
      const btn = e.target.closest('[data-z2-service]');
      if (!btn) return;
      const t = btn.dataset.z2Service;
      const labels = { start: 'Запуск', stop: 'Остановка', restart: 'Перезапуск' };
      run(t, {}, labels[t] || t);
    });

    const strat = document.getElementById('zapret2-strategies');
    if (strat) strat.addEventListener('click', function (e) {
      const resync = e.target.closest('[data-z2-resync]');
      if (resync) return run('circular-resync', { name: resync.dataset.z2Resync }, 'Профиль обновлён');
      const reapply = e.target.closest('[data-z2-reapply]');
      if (reapply) return run('circular-reapply', { name: reapply.dataset.z2Reapply }, 'Отсев применён');
      const stStart = e.target.closest('[data-z2-slottest]');
      if (stStart) return startSlottest(stStart.dataset.z2Slottest);
      const stStop = e.target.closest('[data-z2-slottest-stop]');
      if (stStop) return run('slottest-stop', {}, 'Остановка теста');
      const circSt = e.target.closest('[data-z2-circ-style]');
      if (circSt) {
        const name = circSt.dataset.z2CircStyle;
        const p = ((data && data.profiles) || []).find(function (x) { return x.name === name; });
        const next = (p && p.circ_style === 'pkts') ? 'seq' : 'pkts';
        return run('circ-style', { name: name, style: next }, next === 'pkts' ? 'Диапазон d20' : 'Диапазон seq');
      }
      const prof = e.target.closest('[data-z2-profile]');
      if (prof) {
        const name = prof.dataset.z2Profile;
        const p = ((data && data.profiles) || []).find(function (x) { return x.name === name; });
        return run('profile-enable', { name: name, enabled: p && p.enabled ? 0 : 1 }, 'Профиль ' + name);
      }
      const slot = e.target.closest('[data-z2-slot]');
      if (slot) {
        if (data && data.slottest && data.slottest.running) return;
        if (suppressSlotClick) {
          suppressSlotClick = false;
          return;
        }
        const parts = slot.dataset.z2Slot.split(':');
        const name = parts[0];
        const id = Number(parts[1]);
        let dis = currentDisabled(name);
        const i = dis.indexOf(id);
        if (i >= 0) dis.splice(i, 1);
        else dis.push(id);
        return run('circular-set', { name: name, disabled: dis, no_cycle: true }, 'Слоты ' + name);
      }
    });

    let slotDrag = null;
    let suppressSlotClick = false;

    function slotOrderFromGrid(grid) {
      return Array.prototype.map.call(grid.querySelectorAll('[data-z2-slot]'), function (el) {
        return Number(String(el.dataset.z2Slot).split(':')[1]);
      });
    }

    strat.addEventListener('pointerdown', function (e) {
      if (e.button && e.button !== 0) return;
      if (busy) return;
      if (data && data.slottest && data.slottest.running) return;
      const slot = e.target.closest('[data-z2-slot]');
      if (!slot) return;
      const grid = slot.closest('.z2-slot-grid');
      if (!grid || grid.querySelectorAll('[data-z2-slot]').length < 2) return;
      slotDrag = {
        slot: slot,
        grid: grid,
        name: String(slot.dataset.z2Slot).split(':')[0],
        pid: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        dragging: false,
        moved: false
      };
    });

    window.addEventListener('pointermove', function (e) {
      if (!slotDrag) return;
      const d = slotDrag;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.dragging) {
        if ((dx * dx + dy * dy) < 64) return;
        d.dragging = true;
        d.moved = true;
        d.slot.classList.add('z2-slot-dragging');
        d.grid.classList.add('z2-sorting');
        try { d.slot.setPointerCapture(d.pid); } catch (err) { /* ignore */ }
      }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const over = el && el.closest ? el.closest('[data-z2-slot]') : null;
      if (!over || over === d.slot || over.closest('.z2-slot-grid') !== d.grid) return;
      const rect = over.getBoundingClientRect();
      const before = (e.clientX - rect.left) < (rect.width / 2);
      if (before) d.grid.insertBefore(d.slot, over);
      else d.grid.insertBefore(d.slot, over.nextSibling);
    });

    window.addEventListener('pointerup', function () {
      if (!slotDrag) return;
      const d = slotDrag;
      slotDrag = null;
      d.slot.classList.remove('z2-slot-dragging');
      d.grid.classList.remove('z2-sorting');
      try { d.slot.releasePointerCapture(d.pid); } catch (err) { /* ignore */ }
      if (!d.moved) return;
      suppressSlotClick = true;
      const order = slotOrderFromGrid(d.grid);
      const p = ((data && data.profiles) || []).find(function (x) { return x.name === d.name; });
      const prev = ((p && p.slots) || []).map(function (s) { return s.id; });
      if (order.join(',') === prev.join(',')) return;
      run('circular-reorder', { name: d.name, order: order }, 'Порядок ' + d.name);
    });
    window.addEventListener('pointercancel', function () {
      if (!slotDrag) return;
      slotDrag.slot.classList.remove('z2-slot-dragging');
      slotDrag.grid.classList.remove('z2-sorting');
      slotDrag = null;
    });

    const savedSel = document.getElementById('z2-bcw-saved');
    if (savedSel) {
      savedSel.addEventListener('change', function () {
        if (savedSel.value) loadReport(savedSel.value);
      });
    }
    bind('z2-bcw-quick', function () { startBcw('quick'); });
    bind('z2-bcw-full', function () { startBcw('full'); });
    bind('z2-bcw-univ', function () { startBcw('universal'); });
    bind('z2-bcw-stop', function () { run('bcw-stop', {}, 'Остановка поиска'); });

    const modeSel = document.getElementById('z2-embed-mode');
    if (modeSel) modeSel.addEventListener('change', syncEmbedMode);
    syncEmbedMode();
    bind('z2-embed-btn', function () {
      const args = currentArgs();
      if (!args) {
        showError('Сначала отметьте стратегию в списке выше');
        return;
      }
      const mode = (document.getElementById('z2-embed-mode') || {}).value || 'circular-front';
      const name = ((document.getElementById('z2-embed-name') || {}).value || '').trim();
      const target = (document.getElementById('z2-embed-target') || {}).value || 'youtube';
      if (mode === 'new' && !name) {
        showError('Укажите имя нового профиля');
        return;
      }
      const created = sanitizeProfileName(name);
      const extra = {
        profile: target,
        mode: mode,
        args: args,
        name: name,
        domains: collectBcw().domains
      };
      embedApply(extra, created, mode);
    });

    const games = document.getElementById('zapret2-panel-games');
    if (games) games.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-z2-gv]');
      if (!btn) return;
      const v = btn.dataset.z2Gv;
      if (v === 'xtreme') return run('games', { value: 'xtreme' }, 'Xtreme');
      const cur = data && data.games && String(data.games.active);
      if (cur === v) return run('games', { value: 'remove' }, 'Игры выкл');
      run('games', { value: v }, 'Игры Gv' + v);
    });

    const sys = document.getElementById('zapret2-panel-system');
    if (sys) sys.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-z2-system]');
      if (!btn) return;
      const v = btn.dataset.z2System;
      if (v === 'reload-lists') return run('reload-lists', {}, 'Reload lists');
      if (v.indexOf('backup-') === 0) return run('backup', { value: v.replace('backup-', '') }, 'Бэкап');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
