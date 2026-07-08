'use strict';

(function () {
  const MAX_HISTORY = 80;
  const MAX_TOASTS = 5;
  const MOBILE_MAX_TOASTS = 1;
  const MOBILE_MQ = '(max-width: 600px)';
  const DEFAULT_DURATION = {
    info: 7000,
    success: 6000,
    warning: 9000,
    error: 0
  };

  const TYPE_LABELS = {
    info: 'Сведения',
    success: 'Готово',
    warning: 'Внимание',
    error: 'Ошибка'
  };

  const ICONS = {
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3z"/><path d="M12 10v4M12 17h.01"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg>'
  };

  let toastHost = null;
  let centerPanel = null;
  let centerList = null;
  let centerEmpty = null;
  let centerBackdrop = null;
  let bellBtn = null;
  let bellBadge = null;
  let centerOpen = false;

  const activeToasts = new Map();
  const groupToId = new Map();
  const history = [];
  let unreadCount = 0;

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeOpts(input, legacyType) {
    if (typeof input === 'string') {
      return {
        message: input,
        type: legacyType || 'info'
      };
    }
    return input || {};
  }

  function resolveDuration(type, explicit, persistent) {
    if (persistent) return 0;
    if (typeof explicit === 'number') return explicit;
    return DEFAULT_DURATION[type] ?? DEFAULT_DURATION.info;
  }

  function updateBellBadge() {
    if (!bellBadge) return;
    if (unreadCount > 0) {
      bellBadge.hidden = false;
      bellBadge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
    } else {
      bellBadge.hidden = true;
      bellBadge.textContent = '';
    }
  }

  function pushHistory(entry) {
    history.unshift(entry);
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    unreadCount += 1;
    updateBellBadge();
    renderCenterList();
  }

  function markAllRead() {
    unreadCount = 0;
    history.forEach((item) => { item.read = true; });
    updateBellBadge();
    renderCenterList();
  }

  function formatTime(ts) {
    try {
      return new Date(ts).toLocaleString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        day: 'numeric',
        month: 'short'
      });
    } catch (_) {
      return '';
    }
  }

  function renderCenterList() {
    if (!centerList || !centerEmpty) return;
    if (!history.length) {
      centerList.innerHTML = '';
      centerEmpty.hidden = false;
      return;
    }
    centerEmpty.hidden = true;
    centerList.innerHTML = history.map((item) => {
      const unread = item.read ? '' : ' notification-center-item--unread';
      const title = item.title || TYPE_LABELS[item.type] || 'Уведомление';
      return '<article class="notification-center-item' + unread + '" data-id="' + escapeHtml(item.id) + '">' +
        '<div class="notification-center-item-icon notification-toast-icon notification-toast-icon--' + item.type + '">' +
        (ICONS[item.type] || ICONS.info) +
        '</div>' +
        '<div class="notification-center-item-body">' +
        '<div class="notification-center-item-meta">' +
        '<span class="notification-center-item-source">' + escapeHtml(item.source || 'RouteRich') + '</span>' +
        '<time class="notification-center-item-time">' + escapeHtml(formatTime(item.ts)) + '</time>' +
        '</div>' +
        '<div class="notification-center-item-title">' + escapeHtml(title) + '</div>' +
        '<div class="notification-center-item-message">' + escapeHtml(item.message) + '</div>' +
        '</div>' +
        '</article>';
    }).join('');
  }

  function removeToastEl(el, id) {
    if (!el) return;
    el.classList.add('notification-toast--out');
    window.setTimeout(() => {
      el.remove();
    }, 220);
    const rec = activeToasts.get(id);
    if (rec && rec.timer) window.clearTimeout(rec.timer);
    activeToasts.delete(id);
    if (rec && rec.group) groupToId.delete(rec.group);
  }

  function dismiss(id) {
    const rec = activeToasts.get(id);
    if (!rec) return;
    removeToastEl(rec.el, id);
  }

  function dismissByGroup(group) {
    const id = groupToId.get(group);
    if (id) dismiss(id);
  }

  function dismissAllByGroup(group) {
    if (!group) return;
    const ids = [];
    activeToasts.forEach((rec, id) => {
      if (rec.group === group) ids.push(id);
    });
    ids.forEach(dismiss);
    groupToId.delete(group);
  }

  function clearToasts() {
    Array.from(activeToasts.keys()).forEach(dismiss);
  }

  function scheduleDismiss(id, duration) {
    if (!duration || duration <= 0) return;
    const rec = activeToasts.get(id);
    if (!rec) return;
    if (rec.timer) window.clearTimeout(rec.timer);
    rec.timer = window.setTimeout(() => dismiss(id), duration);
    const bar = rec.el.querySelector('.notification-toast-progress');
    if (bar) {
      bar.style.animation = 'none';
      void bar.offsetWidth;
      bar.style.animation = 'notification-progress ' + duration + 'ms linear forwards';
    }
  }

  function buildToastElement(entry) {
    const title = entry.title || TYPE_LABELS[entry.type] || 'Уведомление';
    const el = document.createElement('article');
    el.className = 'notification-toast notification-toast--' + entry.type;
    el.setAttribute('role', 'alert');
    el.dataset.id = entry.id;
    el.innerHTML =
      '<div class="notification-toast-icon notification-toast-icon--' + entry.type + '">' +
      (ICONS[entry.type] || ICONS.info) +
      '</div>' +
      '<div class="notification-toast-content">' +
      '<div class="notification-toast-app">' + escapeHtml(entry.source || 'RouteRich') + '</div>' +
      '<div class="notification-toast-title">' + escapeHtml(title) + '</div>' +
      '<div class="notification-toast-message">' + escapeHtml(entry.message) + '</div>' +
      '</div>' +
      '<button type="button" class="notification-toast-close" aria-label="Закрыть уведомление">&times;</button>' +
      (entry.duration > 0 ? '<div class="notification-toast-progress" aria-hidden="true"></div>' : '');

    el.querySelector('.notification-toast-close').addEventListener('click', () => dismiss(entry.id));
    return el;
  }

  function getToastLimit() {
    try {
      return window.matchMedia(MOBILE_MQ).matches ? MOBILE_MAX_TOASTS : MAX_TOASTS;
    } catch (_) {
      return MAX_TOASTS;
    }
  }

  function mountToast(entry) {
    if (!toastHost) return null;
    while (activeToasts.size >= getToastLimit()) {
      const oldest = toastHost.lastElementChild;
      if (!oldest || !oldest.dataset.id) break;
      dismiss(oldest.dataset.id);
    }
    const el = buildToastElement(entry);
    toastHost.prepend(el);
    requestAnimationFrame(() => el.classList.add('notification-toast--in'));
    activeToasts.set(entry.id, { el: el, timer: null, group: entry.group, duration: entry.duration });
    scheduleDismiss(entry.id, entry.duration);
    return el;
  }

  function show(input, legacyType) {
    const opts = normalizeOpts(input, legacyType);
    const message = (opts.message || '').trim();
    if (!message) return null;

    const type = opts.type || 'info';
    const group = opts.group || '';
    const stack = !!opts.stack;
    const id = opts.id || ('n-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    const duration = resolveDuration(type, opts.duration, opts.persistent);
    const entry = {
      id: id,
      type: type,
      source: opts.source || 'RouteRich',
      title: opts.title || '',
      message: message,
      group: group,
      duration: duration,
      toastOnly: !!opts.toastOnly,
      ts: Date.now(),
      read: centerOpen
    };

    const mobileSingle = getToastLimit() === 1;
    if (group && groupToId.has(group) && !stack && !mobileSingle) {
      return update(groupToId.get(group), opts);
    }

    if (group) groupToId.set(group, id);

    mountToast(entry);
    if (!entry.toastOnly) pushHistory(entry);
    return id;
  }

  function update(id, input, legacyType) {
    const opts = normalizeOpts(input, legacyType);
    const message = (opts.message || '').trim();
    const rec = activeToasts.get(id);
    if (!rec) {
      if (!message) return null;
      return show(Object.assign({}, opts, { id: id }));
    }

    if (!message) {
      dismiss(id);
      return null;
    }

    const type = opts.type || rec.el.className.match(/notification-toast--(\w+)/)?.[1] || 'info';
    const duration = resolveDuration(type, opts.duration, opts.persistent);
    const title = opts.title || TYPE_LABELS[type] || 'Уведомление';
    const source = opts.source || rec.el.querySelector('.notification-toast-app')?.textContent || 'RouteRich';

    rec.el.className = 'notification-toast notification-toast--' + type + ' notification-toast--in';
    const iconWrap = rec.el.querySelector('.notification-toast-icon');
    if (iconWrap) {
      iconWrap.className = 'notification-toast-icon notification-toast-icon--' + type;
      iconWrap.innerHTML = ICONS[type] || ICONS.info;
    }
    const appEl = rec.el.querySelector('.notification-toast-app');
    const titleEl = rec.el.querySelector('.notification-toast-title');
    const msgEl = rec.el.querySelector('.notification-toast-message');
    if (appEl) appEl.textContent = source;
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;

    let progress = rec.el.querySelector('.notification-toast-progress');
    if (duration > 0) {
      if (!progress) {
        progress = document.createElement('div');
        progress.className = 'notification-toast-progress';
        progress.setAttribute('aria-hidden', 'true');
        rec.el.appendChild(progress);
      }
    } else if (progress) {
      progress.remove();
    }

    if (rec.timer) window.clearTimeout(rec.timer);
    rec.timer = null;
    scheduleDismiss(id, duration);
    return id;
  }

  function clearHistory() {
    history.length = 0;
    unreadCount = 0;
    updateBellBadge();
    renderCenterList();
  }

  function setCenterOpen(open) {
    centerOpen = open;
    if (!centerPanel || !centerBackdrop) return;
    centerPanel.classList.toggle('notification-center--open', open);
    centerBackdrop.hidden = !open;
    if (open) {
      markAllRead();
      document.body.classList.add('notification-center-open');
    } else {
      document.body.classList.remove('notification-center-open');
    }
  }

  function initDom() {
    toastHost = document.getElementById('notification-toasts');
    centerPanel = document.getElementById('notification-center');
    centerList = document.getElementById('notification-center-list');
    centerEmpty = document.getElementById('notification-center-empty');
    centerBackdrop = document.getElementById('notification-center-backdrop');
    bellBtn = document.getElementById('btn-notifications');
    bellBadge = document.getElementById('notification-badge');

    if (bellBtn) {
      bellBtn.addEventListener('click', () => setCenterOpen(!centerOpen));
    }
    if (centerBackdrop) {
      centerBackdrop.addEventListener('click', () => setCenterOpen(false));
    }
    const closeBtn = document.getElementById('notification-center-close');
    if (closeBtn) closeBtn.addEventListener('click', () => setCenterOpen(false));
    const clearBtn = document.getElementById('notification-center-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => clearHistory());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && centerOpen) setCenterOpen(false);
    });

    renderCenterList();
  }

  window.RouteRichNotify = {
    show: show,
    update: update,
    dismiss: dismiss,
    dismissByGroup: dismissByGroup,
    dismissAllByGroup: dismissAllByGroup,
    clearToasts: clearToasts,
    clearHistory: clearHistory,
    info: (message, opts) => show(Object.assign({}, opts || {}, { message: message, type: 'info' })),
    success: (message, opts) => show(Object.assign({}, opts || {}, { message: message, type: 'success' })),
    warning: (message, opts) => show(Object.assign({}, opts || {}, { message: message, type: 'warning' })),
    error: (message, opts) => show(Object.assign({}, opts || {}, { message: message, type: 'error' }))
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDom);
  } else {
    initDom();
  }
})();