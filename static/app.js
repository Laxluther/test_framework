/* ============================================================
   Chemille DAS Testing System — Application JavaScript
   Vanilla JS, no frameworks
   ============================================================ */

(function () {
  'use strict';

  /* ----------------------------------------------------------
     State
  ---------------------------------------------------------- */
  const state = {
    config: { environments: [], conversations: [] },
    currentPage: 'single',
    sseSource: null,
    isRunning: false,
    batchGrid: [],
    batchRound: 0,
    batchTotalRounds: 0,
    batchCompleted: 0,
    batchTotal: 0,
    sessions: [],
    single: { startTs: null, endTs: null, turnCount: 0, flowState: 'idle' },
    singleTimerHandle: null,
    singleQueue: [],
    sessionDrilldownContext: null,
    dashboardAllResults: [],
    dashboardMaxRounds: 1,
    dashboardVisibleRounds: 1,
  };

  /* ----------------------------------------------------------
     Utilities
  ---------------------------------------------------------- */
  function formatDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    }) + ' ' + d.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function createBadge(type, text) {
    const span = document.createElement('span');
    span.className = 'badge badge-' + type;
    span.textContent = text || type.toUpperCase();
    return span;
  }

  function statusBadge(passed, failText) {
    if (passed === true || passed === 1 || passed === 'true') return createBadge('pass', 'PASS');
    if (passed === false || passed === 0 || passed === 'false') return createBadge('fail', failText || 'FAIL');
    return createBadge('pending', 'N/A');
  }

  const ICON_CHECK = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  const ICON_X = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const ICON_CHEVRON_RIGHT = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';
  const ICON_ARROW_LEFT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;vertical-align:-2px"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>';
  const ICON_CLOCK = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
  const ICON_MESSAGE = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  const ICON_COPY = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const ICON_UPLOAD = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
  const ICON_RETRY = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => showToast('Copied to clipboard', 'success'),
        () => showToast('Copy failed', 'error')
      );
    }
  }

  function conversationIdChipHTML(id) {
    if (!id) return '<span class="text-muted">—</span>';
    return '<span class="conv-id-chip" data-copy="' + escapeHtml(id) + '" title="Click to copy — use this ID to look up the trace in MLflow">' +
      escapeHtml(id) + ICON_COPY + '</span>';
  }

  function matchIndicatorHTML(matched) {
    return '<span class="match-indicator ' + (matched ? 'matched' : 'unmatched') + '">' +
      (matched ? ICON_CHECK : ICON_X) + (matched ? 'Matched' : 'Unmatched') + '</span>';
  }

  /* Break the assumption-evaluation object (matchedCTQs/unmatchedCTQs/extraCTQs)
     into one card per CTQ with clear matched/unmatched status, instead of a single
     generic reasoning blob. Shared by the result drilldown and the compare view. */
  function renderCTQListHTML(evalData) {
    if (!evalData) return '<p class="text-muted text-sm">No CTQ evaluation data.</p>';
    const matched = evalData.matchedCTQs || [];
    const unmatched = evalData.unmatchedCTQs || [];
    const extra = evalData.extraCTQs || [];
    if (matched.length === 0 && unmatched.length === 0 && extra.length === 0) {
      return '<p class="text-muted text-sm">No CTQs evaluated for this conversation.</p>';
    }
    let html = '';
    matched.forEach(c => {
      html += '<div class="eval-item"><div class="eval-item-header"><span class="eval-item-title">' + escapeHtml(c.expected || '') + '</span>' + matchIndicatorHTML(true) + '</div>' +
        '<div class="eval-item-body">' + escapeHtml(c.actualEvidence || c.matchNotes || '') + '</div></div>';
    });
    unmatched.forEach(c => {
      html += '<div class="eval-item"><div class="eval-item-header"><span class="eval-item-title">' + escapeHtml(c.expected || '') + '</span>' + matchIndicatorHTML(false) + '</div>' +
        '<div class="eval-item-body">' + escapeHtml(c.reason || '') + '</div></div>';
    });
    if (extra.length > 0) {
      html += '<div class="detail-field-label mt-4 mb-2">Extra CTQs mentioned (not in expected list)</div>' +
        '<ul class="td-list">' + extra.map(x => '<li>' + escapeHtml(String(x)) + '</li>').join('') + '</ul>';
    }
    return html;
  }

  function pct(n) {
    if (n == null || isNaN(n)) return '—';
    return (Math.round(n * 100) / 100).toFixed(1) + '%';
  }

  function scoreDisplay(n) {
    if (n == null || isNaN(n)) return '—';
    return (Math.round(n * 100) / 100).toString();
  }

  function pctColoredHTML(n) {
    if (n == null || isNaN(n)) return '<span class="text-muted">—</span>';
    const val = Math.round(n * 100) / 100;
    const cls = val >= 80 ? 'text-success' : val >= 60 ? 'text-warning' : 'text-danger';
    return '<span class="' + cls + '">' + val.toFixed(1) + '%</span>';
  }

  function scoreColoredHTML(n) {
    if (n == null || isNaN(n)) return '<span class="text-muted">—</span>';
    const val = Math.round(n * 100) / 100;
    const cls = val >= 7 ? 'text-success' : val >= 5 ? 'text-warning' : 'text-danger';
    return '<span class="' + cls + '">' + val + '</span>';
  }

  /* Batch vs single-conversation session, consistent everywhere a session list
     is shown (Results, History). unique_convs > 1 is the same test the dashboard
     session picker and Home overview already use to define "batch". */
  function sessionTypeBadgeHTML(s) {
    const isBatch = (s.unique_convs || 0) > 1;
    return '<span class="session-type-badge ' + (isBatch ? 'batch' : 'single') + '">' + (isBatch ? 'Batch' : 'Single') + '</span>';
  }

  function el(id) { return document.getElementById(id); }

  /* Re-trigger the panel body's fade-in — call after rebuilding detail-panel-body's
     content (switching conversations, opening a compare view, etc.) so the swap reads
     as a transition instead of an instant content pop. */
  function fadePanelBody() {
    const body = el('detail-panel-body');
    if (!body) return;
    body.classList.remove('panel-content-fade');
    void body.offsetWidth;
    body.classList.add('panel-content-fade');
  }

  /* Clickable <tr>s otherwise have no keyboard path — Tab never lands on them and
     Enter/Space does nothing. Call right after setting className = 'clickable'. */
  function enableRowKeyboardActivation(tr) {
    tr.tabIndex = 0;
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        tr.click();
      }
    });
  }

  function on(id, event, handler) {
    const elem = el(id);
    if (elem) {
      elem.addEventListener(event, handler);
    } else {
      console.warn(`Element with ID "${id}" was not found, listener not attached.`);
    }
  }

  function show(elem) { if (elem) elem.classList.remove('hidden'); }
  function hide(elem) { if (elem) elem.classList.add('hidden'); }

  async function api(url, opts) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) {
        const errText = await res.text();
        let message = errText || res.statusText;
        try {
          const parsed = JSON.parse(errText);
          if (parsed && parsed.error) message = parsed.error;
        } catch { }
        throw new Error(message);
      }
      return await res.json();
    } catch (e) {
      showToast(e.message || 'Request failed', 'error');
      throw e;
    }
  }

  function showToast(msg, type) {
    const container = el('toast-container');
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' ' + type : '');
    t.textContent = msg;
    container.appendChild(t);
    setTimeout(() => {
      t.classList.add('leaving');
      t.addEventListener('animationend', () => t.remove(), { once: true });
    }, 4000);
  }

  function nowTimestamp() {
    const d = new Date();
    return d.toLocaleTimeString('en-US', { hour12: false });
  }

  /* ----------------------------------------------------------
     Navigation
  ---------------------------------------------------------- */
  function initNav() {
    const navItems = document.querySelectorAll('.nav-item[data-page]');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        navigateTo(item.dataset.page);
      });
    });
    navigateTo('dashboard');
  }

  function navigateTo(page) {
    state.currentPage = page;
    document.querySelectorAll('.nav-item[data-page]').forEach(n => {
      n.classList.toggle('active', n.dataset.page === page);
    });
    document.querySelectorAll('.page-section').forEach(s => {
      s.classList.toggle('active', s.id === 'page-' + page);
    });

    const pageNames = {
      'dashboard': 'Home',
      'single': 'Run',
      'batch': 'Experiments',
      'results': 'Results',
      'comparison': 'Comparison',
      'history': 'History Management',
      'traces': 'MLflow Traces',
      'testdata': 'Test Data'
    };
    const breadcrumb = el('breadcrumb-page');
    if (breadcrumb && pageNames[page]) {
      breadcrumb.textContent = pageNames[page];
    }

    if (page === 'results') loadResultsSessions();
    if (page === 'dashboard') { loadDashboardOverview(); loadDashboardSessions(); }
    if (page === 'comparison') loadComparisonSessions();
    if (page === 'history') loadHistorySessions();
    if (page === 'testdata') loadTestDataList();
  }

  /* ----------------------------------------------------------
     Config Loader
  ---------------------------------------------------------- */
  async function loadConfig() {
    try {
      const data = await api('/api/config');
      state.config = data;
      populateConversationDropdown();
      populateEnvironmentDropdowns();
      updateBatchRoundsWarning();
    } catch { }
  }

  function populateConversationDropdown() {
    const sel = el('single-conversation');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select conversation…</option>';
    const convs = (state.config.conversations || []).slice();
    // Natural sort by conv_no (numeric) so conv 1 < 2 < 10
    convs.sort((a, b) => (a.conv_no || 0) - (b.conv_no || 0));
    convs.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.filename;
      opt.textContent = c.filename;
      sel.appendChild(opt);
    });
  }

  function populateEnvironmentDropdowns() {
    const selectors = ['global-environment'];
    selectors.forEach(id => {
      const select = el(id);
      if (!select) return;
      select.innerHTML = '';
      (state.config.environments || []).forEach(env => {
        const opt = document.createElement('option');
        opt.value = env;
        opt.textContent = env;
        select.appendChild(opt);
      });
    });
  }

  function updateSidebarStatus(online, label) {
    const dot = el('sidebar-status-dot');
    const val = el('sidebar-status-text');
    if (dot) dot.className = 'status-dot' + (online ? '' : ' offline');
    if (val) val.textContent = label || (online ? 'Connected' : 'Offline');
  }

  async function checkEnvHealth() {
    const envSelect = el('global-environment');
    const env = (envSelect && envSelect.value) || 'Local';
    try {
      const res = await fetch('/api/health?env=' + encodeURIComponent(env));
      const data = await res.json();
      updateSidebarStatus(!!data.healthy, (data.healthy ? env + ' online' : env + ' unreachable'));
    } catch {
      updateSidebarStatus(false, 'Server unreachable');
    }
  }

  function initEnvHealthCheck() {
    checkEnvHealth();
    setInterval(checkEnvHealth, 20000);
    on('global-environment', 'change', checkEnvHealth);
  }

  /* ----------------------------------------------------------
     SSE Helpers
  ---------------------------------------------------------- */
  function closeSSE() {
    if (state.sseSource) {
      state.sseSource.close();
      state.sseSource = null;
    }
  }

  let sseReconnectTimer = null;

  function scheduleSSEReconnect(handlers) {
    if (sseReconnectTimer) return;
    sseReconnectTimer = setTimeout(async () => {
      sseReconnectTimer = null;
      if (!state.isRunning) return;
      try {
        const data = await api('/api/run/is-running');
        if (data.running && data.snapshot && data.snapshot.mode === 'batch') {
          resumeBatchRun(data.snapshot);
        } else if (data.running && data.snapshot && data.snapshot.mode === 'single') {
          resumeSingleRun(data.snapshot);
        } else if (data.running) {
          connectSSE(handlers);
        } else {
          // The run finished or was stopped while we were disconnected.
          if (state.currentPage === 'batch') finishBatchRun();
          else finishSingleRun();
        }
      } catch {
        scheduleSSEReconnect(handlers);
      }
    }, 3000);
  }

  function connectSSE(handlers) {
    closeSSE();
    const es = new EventSource('/api/run/status');
    state.sseSource = es;
    Object.keys(handlers).forEach(evt => {
      es.addEventListener(evt, (e) => {
        try {
          const data = JSON.parse(e.data);
          handlers[evt](data);
        } catch (err) {
          console.error('SSE parse error', err);
        }
      });
    });
    es.onerror = () => {
      console.warn('SSE connection error, will attempt to resync and reconnect');
      es.close();
      if (state.sseSource === es) state.sseSource = null;
      if (state.isRunning) scheduleSSEReconnect(handlers);
    };
    return es;
  }

  /* ----------------------------------------------------------
     Single Run
  ---------------------------------------------------------- */
  function initSingleRun() {
    on('single-run-btn', 'click', () => startSingleRun());
    on('single-queue-btn', 'click', addToSingleQueue);
    on('single-stop-btn', 'click', async () => {
      try {
        const btn = el('single-stop-btn');
        if (btn) {
          btn.disabled = true;
          btn.innerHTML = '<span class="spinner"></span> Stopping...';
        }
        state.singleQueue = [];
        renderSingleQueue();
        await api('/api/run/stop', { method: 'POST' });
        showToast('Stop requested — queue cleared', 'success');
      } catch { }
    });
    renderSingleQueue();
  }

  function addToSingleQueue() {
    const conv = el('single-conversation').value;
    const rounds = parseInt(el('single-rounds').value) || 1;
    if (!conv) { showToast('Please select a conversation to queue', 'error'); return; }
    state.singleQueue.push({ conversation: conv, rounds: rounds });
    renderSingleQueue();
    showToast('Queued ' + conv + ' (' + rounds + ' round' + (rounds > 1 ? 's' : '') + ')', 'success');
  }

  function renderSingleQueue() {
    const list = el('single-queue-list');
    if (!list) return;
    if (state.singleQueue.length === 0) {
      list.innerHTML = '<p class="text-muted text-sm">No queued runs. Pick a conversation and rounds above, then click "+ Queue" to line up the next run.</p>';
      return;
    }
    list.innerHTML = '';
    state.singleQueue.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'single-queue-row';
      row.innerHTML =
        '<span class="single-queue-position">' + (idx + 1) + '</span>' +
        '<span class="single-queue-name">' + escapeHtml(item.conversation) + '</span>' +
        '<span class="single-queue-rounds">' + item.rounds + ' round' + (item.rounds > 1 ? 's' : '') + '</span>' +
        '<button type="button" class="btn btn-xs btn-danger single-queue-remove">Remove</button>';
      row.querySelector('.single-queue-remove').addEventListener('click', () => {
        state.singleQueue.splice(idx, 1);
        renderSingleQueue();
      });
      list.appendChild(row);
    });
  }

  function startNextQueuedRun(logArea) {
    if (state.singleQueue.length === 0) return false;
    const next = state.singleQueue.shift();
    renderSingleQueue();
    if (logArea) addSystemNote(logArea, 'Starting queued run: ' + next.conversation + ' (' + next.rounds + ' round' + (next.rounds > 1 ? 's' : '') + ')');
    const convSel = el('single-conversation');
    const roundsSlider = el('single-rounds');
    if (convSel) convSel.value = next.conversation;
    if (roundsSlider) { roundsSlider.value = next.rounds; el('single-rounds-val').innerText = next.rounds; }
    startSingleRun(next.conversation, next.rounds);
    return true;
  }

  function formatLatency(ms) {
    if (ms == null || isNaN(ms)) return null;
    return ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : Math.round(ms) + 'ms';
  }

  function addChatTurn(container, role, text, latencyMs) {
    const wrap = document.createElement('div');
    wrap.className = 'chat-turn chat-turn-' + role;
    const latencyLabel = formatLatency(latencyMs);
    const isSlow = latencyMs != null && latencyMs > 8000;
    wrap.innerHTML =
      '<div class="chat-turn-header"><span class="chat-turn-role">' + (role === 'user' ? 'User' : 'Agent') + '</span>' +
      (latencyLabel ? '<span class="chat-turn-latency' + (isSlow ? ' slow' : '') + '">' + ICON_CLOCK + latencyLabel + '</span>' : '') +
      '</div>' +
      '<div class="chat-turn-bubble"></div>';
    wrap.querySelector('.chat-turn-bubble').textContent = text || '';
    container.appendChild(wrap);
    container.scrollTop = container.scrollHeight;
  }

  function addSystemNote(container, text, isError) {
    const note = document.createElement('div');
    note.className = 'chat-system-note' + (isError ? ' error' : '');
    note.textContent = text;
    container.appendChild(note);
    container.scrollTop = container.scrollHeight;
  }

  function renderSingleStatusRail() {
    const rail = el('single-status-rail');
    if (!rail) return;
    const s = state.single;
    const elapsedSecs = s.startTs ? ((s.endTs || Date.now()) - s.startTs) / 1000 : 0;
    const flowClass = s.flowState === 'pass' ? 'status-pass' : s.flowState === 'fail' ? 'status-fail' : 'status-live';
    const flowLabel = s.flowState === 'pass' ? 'Flow Complete' : s.flowState === 'fail' ? 'Flow Failed' : s.flowState === 'idle' ? 'Idle' : 'Running';
    rail.innerHTML =
      '<span class="status-pill">' + ICON_CLOCK + '<span>' + elapsedSecs.toFixed(1) + 's</span></span>' +
      '<span class="status-pill">' + ICON_MESSAGE + '<span>Turn ' + s.turnCount + '</span></span>' +
      '<span class="status-pill ' + flowClass + '">' + flowLabel + '</span>';
  }

  function getSingleRunHandlers(logArea) {
    return {
      round_start(d) {
        addSystemNote(logArea, 'Round ' + d.round + '/' + (d.total_rounds || 1) + ' started');
      },
      file_start(d) {
        addSystemNote(logArea, 'Processing: ' + d.conv_file + ' (' + d.index + '/' + d.total + ')');
      },
      turn_start(d) {
        state.single.turnCount = d.turn;
        renderSingleStatusRail();
        addChatTurn(logArea, 'user', d.user_input, d.latency_ms);
      },
      agent_reply(d) {
        addChatTurn(logArea, 'agent', d.agent_msg, d.latency_ms);
      },
      evaluating(d) {
        addSystemNote(logArea, 'Evaluating conversation #' + d.conv_no + '…');
      },
      completed(d) {
        state.single.flowState = d.success ? 'pass' : 'fail';
        state.single.endTs = Date.now();
        renderSingleStatusRail();
        addSystemNote(logArea, (d.success ? 'PASS' : 'FAIL') + ' — ' + (d.application || d.conv_no), !d.success);
        if (d.error) addSystemNote(logArea, d.error, true);
        showSingleResult(d);
      },
      run_complete(d) {
        addSystemNote(logArea, 'Run complete. Output: ' + (d.output_dir || ''));
        finishSingleRun();
        startNextQueuedRun(logArea);
      },
      error(d) {
        addSystemNote(logArea, d.message, true);
        finishSingleRun();
        if (state.singleQueue.length > 0) {
          addSystemNote(logArea, 'Queue cleared after error.', true);
          state.singleQueue = [];
          renderSingleQueue();
        }
      },
      cancelled(d) {
        addSystemNote(logArea, 'Cancelled. Completed ' + d.completed + '/' + d.total);
        finishSingleRun();
        if (state.singleQueue.length > 0) {
          addSystemNote(logArea, 'Queue cleared after cancel.', true);
          state.singleQueue = [];
          renderSingleQueue();
        }
      },
    };
  }

  async function startSingleRun(convOverride, roundsOverride) {
    const conv = convOverride || el('single-conversation').value;
    const env = el('global-environment').value;
    const rounds = roundsOverride || parseInt(el('single-rounds').value) || 1;

    if (!conv) { showToast('Please select a conversation', 'error'); return; }

    const btn = el('single-run-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Running…';
    show(el('single-stop-btn'));

    const logArea = el('single-log');
    logArea.innerHTML = '';
    const resultCard = el('single-result-card');
    resultCard.classList.remove('visible');

    state.isRunning = true;
    state.single = { startTs: Date.now(), endTs: null, turnCount: 0, flowState: 'running' };
    renderSingleStatusRail();
    if (state.singleTimerHandle) clearInterval(state.singleTimerHandle);
    state.singleTimerHandle = setInterval(renderSingleStatusRail, 200);

    try {
      await api('/api/run/single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation: conv, rounds: rounds, environment: env }),
      });
    } catch {
      btn.disabled = false;
      btn.textContent = 'Run Test';
      state.isRunning = false;
      clearInterval(state.singleTimerHandle);
      return;
    }

    connectSSE(getSingleRunHandlers(logArea));
  }

  function resumeSingleRun(snap) {
    const btn = el('single-run-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Running…';
    }
    show(el('single-stop-btn'));

    const logArea = el('single-log');
    logArea.innerHTML = '';
    const resultCard = el('single-result-card');
    if (resultCard) resultCard.classList.remove('visible');

    state.isRunning = true;
    state.single = { startTs: Date.now(), endTs: null, turnCount: 0, flowState: 'running' };

    if (snap.round) {
      addSystemNote(logArea, 'Round ' + snap.round + '/' + (snap.total_rounds || 1) + ' started');
    }
    const items = Object.values(snap.items || {});
    if (items.length > 0) {
      const item = items[0];
      (item.logs || []).forEach(l => {
        if (l.type === 'user' || l.type === 'agent') {
          addChatTurn(logArea, l.type, (l.text || '').replace(/^\[Turn \d+\]\s*/, ''), l.latencyMs);
          if (l.type === 'user') state.single.turnCount++;
        } else {
          addSystemNote(logArea, l.text);
        }
      });
    }
    renderSingleStatusRail();
    if (state.singleTimerHandle) clearInterval(state.singleTimerHandle);
    state.singleTimerHandle = setInterval(renderSingleStatusRail, 200);

    connectSSE(getSingleRunHandlers(logArea));
  }

  function showSingleResult(d) {
    const card = el('single-result-card');
    const header = card.querySelector('.result-card-header');
    const stats = card.querySelector('.result-stats');
    const details = el('single-result-details');
    header.innerHTML = '';
    const badge = d.success ? createBadge('pass', 'PASS') : createBadge('fail', 'FAIL');
    const h4 = document.createElement('h4');
    h4.textContent = d.application || d.conv_file || 'Result';
    header.appendChild(badge);
    header.appendChild(h4);
    stats.innerHTML = '';
    if (d.conversation_id) {
      stats.innerHTML += '<div class="stat-item"><span class="stat-label">Conversation ID</span>' + conversationIdChipHTML(d.conversation_id) + '</div>';
    }
    if (d.grades_passed !== undefined) {
      stats.innerHTML += '<div class="stat-item"><span class="stat-label">Grades</span><span class="stat-value ' + (d.grades_passed ? 'pass' : 'fail') + '">' + (d.grades_passed ? 'Passed' : 'Failed') + '</span></div>';
    }
    if (d.assumptions_score !== undefined) {
      stats.innerHTML += '<div class="stat-item"><span class="stat-label">Assumption Score</span><span class="stat-value">' + scoreDisplay(d.assumptions_score) + '</span></div>';
    }
    if (d.flow_completed !== undefined) {
      stats.innerHTML += '<div class="stat-item"><span class="stat-label">Flow</span><span class="stat-value ' + (d.flow_completed ? 'pass' : 'fail') + '">' + (d.flow_completed ? 'Completed' : 'Incomplete') + '</span></div>';
    }
    if (d.timing) {
      if (d.timing.totalDurationMs != null) {
        stats.innerHTML += '<div class="stat-item"><span class="stat-label">Total Duration</span><span class="stat-value">' + formatLatency(d.timing.totalDurationMs) + '</span></div>';
      }
      if (d.timing.avgTurnLatencyMs != null) {
        stats.innerHTML += '<div class="stat-item"><span class="stat-label">Avg Response Time</span><span class="stat-value">' + formatLatency(d.timing.avgTurnLatencyMs) + '</span></div>';
      }
    }
    /* Additional eval details */
    if (details) {
      details.innerHTML = '';
      if (d.expected_grades) {
        details.innerHTML += '<div class="result-detail-item"><span class="result-detail-label">Expected Grades</span><span class="result-detail-value">' + escapeHtml(String(d.expected_grades)) + '</span></div>';
      }
      if (d.suggested_grades) {
        details.innerHTML += '<div class="result-detail-item"><span class="result-detail-label">Suggested Grades</span><span class="result-detail-value">' + escapeHtml(String(d.suggested_grades)) + '</span></div>';
      }
      if (d.grades_matched_count !== undefined) {
        details.innerHTML += '<div class="result-detail-item"><span class="result-detail-label">Grades Matched</span><span class="result-detail-value">' + d.grades_matched_count + '</span></div>';
      }
    }
    card.classList.add('visible');
  }

  function finishSingleRun() {
    closeSSE();
    state.isRunning = false;
    if (state.singleTimerHandle) { clearInterval(state.singleTimerHandle); state.singleTimerHandle = null; }
    const btn = el('single-run-btn');
    btn.disabled = false;
    btn.textContent = 'Run Test';
    const stopBtn = el('single-stop-btn');
    hide(stopBtn);
    if (stopBtn) {
      stopBtn.disabled = false;
      stopBtn.textContent = 'Stop Run';
    }
  }

  /* ----------------------------------------------------------
     Batch Run
  ---------------------------------------------------------- */
  function updateBatchRoundsWarning() {
    const slider = el('batch-rounds');
    const valEl = el('batch-rounds-val');
    const warningEl = el('batch-rounds-warning');
    if (!slider) return;
    const rounds = parseInt(slider.value) || 1;
    if (valEl) valEl.textContent = rounds;
    if (!warningEl) return;
    const convCount = (state.config.conversations || []).length;
    const totalTests = convCount * rounds;
    if (rounds >= 10 || totalTests >= 100) {
      warningEl.textContent = '≈ ' + convCount + ' conversations × ' + rounds + ' rounds = ' + totalTests + ' test runs. Each turn calls the LLM — this may take a while.';
    } else {
      warningEl.textContent = convCount ? ('≈ ' + convCount + ' conversations × ' + rounds + ' round' + (rounds > 1 ? 's' : '') + ' = ' + totalTests + ' test runs.') : '';
    }
  }

  function initBatchRun() {
    on('batch-run-btn', 'click', startBatchRun);
    on('batch-stop-btn', 'click', stopBatchRun);
    on('batch-rounds', 'input', updateBatchRoundsWarning);

    const modeControl = el('batch-execution-mode');
    if (modeControl) {
      modeControl.querySelectorAll('.segment').forEach(btn => {
        btn.addEventListener('click', () => {
          if (state.isRunning) return;
          modeControl.dataset.value = btn.dataset.mode;
          modeControl.querySelectorAll('.segment').forEach(b => b.classList.toggle('active', b === btn));
        });
      });
    }
  }

  function getBatchHandlers() {
    return {
      round_start(d) {
        state.batchRound = d.round;
        state.batchTotalRounds = d.total_rounds;
        state.batchCompleted = 0;
        updateBatchProgressText();
        
        const grid = el('batch-live-grid');
        grid.querySelectorAll('.batch-round-content').forEach(el => el.style.display = 'none');
        
        const modeLabel = d.execution_mode === 'parallel' ? 'Parallel' : 'Sequential';
        const roundDiv = document.createElement('div');
        roundDiv.className = 'batch-round-group';
        roundDiv.dataset.round = d.round;
        roundDiv.innerHTML =
          '<div class="batch-round-header" onclick="const content = this.nextElementSibling; content.style.display = content.style.display === \'none\' ? \'grid\' : \'none\'">' +
          '<span>Round ' + d.round + ' &middot; ' + modeLabel + '</span><span style="font-size:11px; font-weight:normal; color:var(--text-secondary)">(Click to toggle)</span></div>' +
          '<div class="live-grid batch-round-content"></div>';
        
        grid.appendChild(roundDiv);
      },
      file_start(d) {
        state.batchTotal = d.total;
        const gridId = d.conv_no !== undefined ? d.conv_no : d.conv_file;
        addOrUpdateGridItem(gridId, d.conv_file, 'running', '');
        updateBatchProgressText();
      },
      turn_start(d) {
        addBatchGridLog(d.conv_no, 'user', '[Turn ' + d.turn + '] ' + d.user_input, d.latency_ms);
      },
      agent_reply(d) {
        addBatchGridLog(d.conv_no, 'agent', '[Turn ' + d.turn + '] ' + d.agent_msg, d.latency_ms);
      },
      evaluating(d) {
        addOrUpdateGridItem(d.conv_no, null, 'running', 'Evaluating…');
      },
      completed(d) {
        state.batchCompleted++;
        const status = d.success ? 'pass' : 'fail';
        addOrUpdateGridItem(d.conv_no, d.application || d.conv_no, status, '');
        updateBatchProgressText();
        updateBatchProgressBar();
      },
      run_complete(d) {
        showToast('Batch run complete', 'success');
        finishBatchRun();
      },
      error(d) {
        showToast(d.message, 'error');
        finishBatchRun();
      },
      cancelled(d) {
        showToast('Cancelled. Completed ' + d.completed + '/' + d.total, 'error');
        finishBatchRun();
      },
    };
  }

  function resumeBatchRun(snap) {
    if (!snap || snap.mode !== 'batch') return;

    el('batch-run-btn').disabled = true;
    el('batch-run-btn').innerHTML = '<span class="spinner"></span> Running…';
    show(el('batch-stop-btn'));
    show(el('batch-progress-area'));
    setBatchModeControlValue(snap.execution_mode || 'sequential');
    setBatchModeControlDisabled(true);

    state.batchGrid = [];
    state.batchRound = 0;
    state.batchTotalRounds = snap.total_rounds || 1;
    state.batchCompleted = 0;
    state.batchTotal = snap.total || 0;

    el('batch-live-grid').innerHTML = '';
    updateBatchProgress(0, 0, 0, 0);

    const handlers = getBatchHandlers();

    snap.completedRounds.forEach(r => {
       handlers.round_start({ round: r.round, total_rounds: snap.total_rounds });
       r.results.forEach(res => {
         handlers.file_start({ total: snap.total, conv_no: res.conv_no, conv_file: res.conv_file });
         handlers.completed(res);
       });
    });
    
    if (snap.round) {
       handlers.round_start({ round: snap.round, total_rounds: snap.total_rounds });
       Object.keys(snap.items).forEach(id => {
          const item = snap.items[id];
          handlers.file_start({ total: snap.total, conv_no: id, conv_file: item.conv_file });
          item.logs.forEach(l => {
             addBatchGridLog(id, l.type, l.text, l.latencyMs);
          });
          if (item.status === 'pass' || item.status === 'fail') {
             handlers.completed({ conv_no: id, application: item.application, success: item.status === 'pass' });
          }
       });
    }
    connectSSE(handlers);
  }

  async function startBatchRun() {
    const env = el('global-environment').value;
    const rounds = parseInt(el('batch-rounds').value) || 1;
    const modeControl = el('batch-execution-mode');
    const executionMode = (modeControl && modeControl.dataset.value) || 'sequential';

    el('batch-run-btn').disabled = true;
    el('batch-run-btn').innerHTML = '<span class="spinner"></span> Running…';
    show(el('batch-stop-btn'));
    show(el('batch-progress-area'));
    setBatchModeControlDisabled(true);

    state.isRunning = true;
    state.batchGrid = [];
    state.batchRound = 0;
    state.batchTotalRounds = rounds;
    state.batchCompleted = 0;
    state.batchTotal = 0;

    el('batch-live-grid').innerHTML = '';
    updateBatchProgress(0, 0, 0, 0);

    try {
      await api('/api/run/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rounds: rounds, environment: env, execution_mode: executionMode }),
      });
    } catch {
      finishBatchRun();
      return;
    }

    connectSSE(getBatchHandlers());
  }

  function addOrUpdateGridItem(id, name, status, subText) {
    const grid = el('batch-live-grid');
    let roundContent = grid.querySelector('.batch-round-group:last-child .batch-round-content');
    if (!roundContent) roundContent = grid;
    
    let item = roundContent.querySelector('[data-grid-id="' + id + '"]');
    if (!item) {
      item = document.createElement('div');
      item.className = 'live-grid-item';
      item.dataset.gridId = id;
      item.innerHTML =
        '<div class="live-grid-item-header" style="display:flex; justify-content:space-between; cursor:pointer;" onclick="const l = this.nextElementSibling; l.style.display = l.style.display === \'none\' ? \'block\' : \'none\'">' +
        '<div class="live-grid-item-info">' +
        '<span class="live-grid-item-name"></span>' +
        '<span class="live-grid-item-sub"></span>' +
        '</div>' +
        '<div class="live-grid-item-badge"></div>' +
        '</div>' +
        '<div class="live-grid-item-log" style="display:none; padding-top: 8px; border-top: 1px solid var(--border-color); margin-top: 8px; max-height: 200px; overflow-y: auto; font-size: 11px;"></div>';
      roundContent.appendChild(item);
    }
    item.className = 'live-grid-item ' + status;
    if (name) item.querySelector('.live-grid-item-name').textContent = name;
    item.querySelector('.live-grid-item-sub').textContent = subText || '';
    const badgeContainer = item.querySelector('.live-grid-item-badge');
    badgeContainer.innerHTML = '';
    if (status === 'running') {
      badgeContainer.innerHTML = '<span class="badge badge-running"><span class="spinner" style="width:10px;height:10px;border-width:1.5px;margin-right:4px"></span> RUNNING</span>';
    } else if (status === 'pass') {
      badgeContainer.appendChild(createBadge('pass', 'PASS'));
    } else if (status === 'fail') {
      badgeContainer.appendChild(createBadge('fail', 'FAIL'));
    } else {
      badgeContainer.appendChild(createBadge('pending', 'PENDING'));
    }
  }

  function addBatchGridLog(id, type, text, latencyMs) {
    const grid = el('batch-live-grid');
    const roundContent = grid.querySelector('.batch-round-group:last-child .batch-round-content') || grid;
    const item = roundContent.querySelector('[data-grid-id="' + id + '"]');
    if (!item) return;
    const logArea = item.querySelector('.live-grid-item-log');
    if (!logArea) return;
    const entry = document.createElement('div');
    entry.className = 'grid-log-entry';
    const color = type === 'user' ? 'var(--accent)' : 'var(--success)';
    const latencyLabel = formatLatency(latencyMs);
    entry.innerHTML = '<span style="color:' + color + '; font-weight:bold;">' + type.toUpperCase() + ':</span> <span style="color:var(--text-secondary)">' + escapeHtml(text) + '</span>' +
      (latencyLabel ? '<span class="grid-log-latency">' + ICON_CLOCK + latencyLabel + '</span>' : '');
    logArea.appendChild(entry);
    logArea.scrollTop = logArea.scrollHeight;
  }

  function updateBatchProgressText() {
    el('batch-progress-text').innerHTML =
      '<strong>Round ' + state.batchRound + '/' + state.batchTotalRounds + '</strong>' +
      ' — Conversation ' + state.batchCompleted + '/' + state.batchTotal;
  }

  function updateBatchProgress(round, totalRounds, completed, total) {
    el('batch-progress-text').innerHTML =
      '<strong>Round ' + round + '/' + totalRounds + '</strong>' +
      ' — Conversation ' + completed + '/' + total;
    const bar = el('batch-progress-bar');
    bar.style.width = '0%';
    bar.classList.remove('complete');
  }

  function updateBatchProgressBar() {
    const bar = el('batch-progress-bar');
    const pctVal = state.batchTotal > 0 ? (state.batchCompleted / state.batchTotal * 100) : 0;
    bar.style.width = pctVal + '%';
    if (pctVal >= 100) bar.classList.add('complete');
  }

  async function stopBatchRun() {
    try {
      const btn = el('batch-stop-btn');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Stopping...';
      }
      await api('/api/run/stop', { method: 'POST' });
      showToast('Stop requested', 'success');
    } catch { }
  }

  function setBatchModeControlDisabled(disabled) {
    const modeControl = el('batch-execution-mode');
    if (!modeControl) return;
    modeControl.querySelectorAll('.segment').forEach(b => { b.disabled = disabled; });
  }

  function setBatchModeControlValue(mode) {
    const modeControl = el('batch-execution-mode');
    if (!modeControl) return;
    modeControl.dataset.value = mode;
    modeControl.querySelectorAll('.segment').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  }

  function finishBatchRun() {
    closeSSE();
    state.isRunning = false;
    const btn = el('batch-run-btn');
    btn.disabled = false;
    btn.textContent = 'Run Batch';
    const stopBtn = el('batch-stop-btn');
    hide(stopBtn);
    if (stopBtn) {
      stopBtn.disabled = false;
      stopBtn.textContent = 'Stop Run';
    }
    setBatchModeControlDisabled(false);
  }

  /* ----------------------------------------------------------
     Results Page
  ---------------------------------------------------------- */
  async function loadResultsSessions() {
    const data = await api('/api/results/sessions');
    state.sessions = data || [];
    renderResultsTable(data || []);
  }

  function renderResultsTable(sessions) {
    const tbody = el('results-sessions-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (sessions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="table-empty"><div class="empty-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto; opacity: 0.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></div>No runs yet. Start one from the Run or Experiments page.</td></tr>';
      return;
    }
    sessions.forEach(s => {
      const isBatch = (s.unique_convs || 0) > 1;
      const tr = document.createElement('tr');
      tr.className = 'clickable';
      enableRowKeyboardActivation(tr);
      tr.innerHTML =
        '<td class="td-mono">' + escapeHtml(String(s.id).substring(0, 8)) + '</td>' +
        '<td>' + formatDate(s.timestamp) + '</td>' +
        '<td>' + sessionTypeBadgeHTML(s) + '</td>' +
        '<td>' + (isBatch ? '<span class="text-muted">' + (s.unique_convs || 0) + ' apps</span>' : escapeHtml(s.single_app_name || '—')) + '</td>' +
        '<td>' + escapeHtml(s.das_env || '—') + '</td>' +
        '<td>' + (s.total_iterations || '—') + '</td>' +
        '<td>' + pctColoredHTML(s.grade_accuracy_avg) + '</td>' +
        '<td>' + scoreColoredHTML(s.assumption_score_avg) + '</td>' +
        '<td class="td-secondary" style="white-space:normal; max-width:200px;">' + escapeHtml(s.notes || '—') + '</td>';
      tr.addEventListener('click', () => openSessionDetail(s.id));
      tbody.appendChild(tr);
    });
  }

  async function openSessionDetail(sessionId) {
    const [data, sessions] = await Promise.all([
      api('/api/results/' + sessionId),
      api('/api/results/sessions'),
    ]);
    const sessionMeta = (sessions || []).find(s => s.id === sessionId) || {};
    renderSessionDetailPanel(sessionId, data || [], sessionMeta);
  }

  function renderSessionNotesEditor(sessionId, sessionMeta) {
    const section = document.createElement('div');
    section.className = 'mb-4';
    section.innerHTML =
      '<label class="form-label" style="display:block;margin-bottom:6px;">Notes</label>' +
      '<div style="display:flex; gap:8px;">' +
      '<input type="text" id="session-notes-input" class="form-input" style="flex:1;" placeholder="e.g. prompt v2.1, after retriever fix" value="' + escapeHtml(sessionMeta.notes || '') + '">' +
      '<button id="session-notes-save-btn" class="btn btn-secondary btn-sm">Save</button>' +
      '</div>';
    setTimeout(() => {
      const saveBtn = el('session-notes-save-btn');
      if (!saveBtn) return;
      saveBtn.addEventListener('click', async () => {
        const val = el('session-notes-input').value;
        try {
          await api('/api/results/notes/' + sessionId, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes: val }),
          });
          showToast('Notes saved', 'success');
        } catch { }
      });
    }, 0);
    return section;
  }

  function renderSessionDetailPanel(sessionId, results, sessionMeta) {
    const panel = el('detail-panel');
    const overlay = el('detail-overlay');
    const body = el('detail-panel-body');
    panel.classList.remove('compare-mode');

    state.sessionDrilldownContext = { sessionId, results, sessionMeta, currentIndex: null };

    el('detail-panel-title').textContent = 'Session ' + String(sessionId).substring(0, 8);
    body.innerHTML = '';
    body.appendChild(renderSessionNotesEditor(sessionId, sessionMeta || {}));

    if (results.length === 0) {
      const emptyMsg = document.createElement('p');
      emptyMsg.className = 'text-muted';
      emptyMsg.style.padding = '20px';
      emptyMsg.textContent = 'No results found.';
      body.appendChild(emptyMsg);
    } else {
      // Add Excel Download Button
      const downloadBtn = document.createElement('a');
      downloadBtn.href = '/api/report/' + sessionId;
      downloadBtn.className = 'btn btn-primary btn-sm mb-4';
      downloadBtn.style.display = 'inline-flex';
      downloadBtn.style.alignItems = 'center';
      downloadBtn.style.gap = '8px';
      downloadBtn.target = '_blank';
      downloadBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download Excel Report';
      body.appendChild(downloadBtn);

      const regenerateBtn = document.createElement('button');
      regenerateBtn.className = 'btn btn-secondary btn-sm mb-4';
      regenerateBtn.style.marginLeft = '8px';
      regenerateBtn.style.display = 'inline-flex';
      regenerateBtn.style.alignItems = 'center';
      regenerateBtn.style.gap = '8px';
      regenerateBtn.title = 'Rebuild the report from stored results (use if the original report file was lost)';
      const regenerateIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
      regenerateBtn.innerHTML = regenerateIcon + ' Regenerate Report';
      regenerateBtn.addEventListener('click', async () => {
        regenerateBtn.disabled = true;
        regenerateBtn.innerHTML = '<span class="spinner"></span> Regenerating…';
        try {
          await api('/api/report/regenerate/' + sessionId, { method: 'POST' });
          showToast('Report regenerated', 'success');
          window.open('/api/report/' + sessionId, '_blank');
        } catch { } finally {
          regenerateBtn.disabled = false;
          regenerateBtn.innerHTML = regenerateIcon + ' Regenerate Report';
        }
      });
      body.appendChild(regenerateBtn);

      const retryBtn = document.createElement('button');
      retryBtn.className = 'btn btn-secondary btn-sm mb-4';
      retryBtn.style.marginLeft = '8px';
      retryBtn.style.display = 'inline-flex';
      retryBtn.style.alignItems = 'center';
      retryBtn.style.gap = '8px';
      retryBtn.title = 'Re-run only the conversations that did not pass in every round, as a new linked session';
      const retryIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="10 8 16 12 10 16 10 8"/><circle cx="12" cy="12" r="10"/></svg>';
      retryBtn.innerHTML = retryIcon + ' Retry Failed';
      retryBtn.style.display = 'none'; // hidden per request; keep wired up for later re-enable
      retryBtn.addEventListener('click', async () => {
        if (state.isRunning) { showToast('A test is already running', 'error'); return; }
        retryBtn.disabled = true;
        retryBtn.innerHTML = '<span class="spinner"></span> Starting…';
        try {
          const env = (el('global-environment') && el('global-environment').value) || 'Local';
          const data = await api('/api/run/retry-failed/' + sessionId, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ environment: env }),
          });
          showToast('Retrying ' + (data.retrying_conv_nos || []).length + ' failed conversation(s) — see the Experiments tab', 'success');
          closeDetailPanel();
          navigateTo('batch');
          checkRunningState();
        } catch { } finally {
          retryBtn.disabled = false;
          retryBtn.innerHTML = retryIcon + ' Retry Failed';
        }
      });
      body.appendChild(retryBtn);

      const backfillSessionBtn = document.createElement('button');
      backfillSessionBtn.className = 'btn btn-secondary btn-sm mb-4';
      backfillSessionBtn.style.marginLeft = '8px';
      backfillSessionBtn.style.display = 'inline-flex';
      backfillSessionBtn.style.alignItems = 'center';
      backfillSessionBtn.style.gap = '8px';
      backfillSessionBtn.title = 'Fetch and save MLflow turn timing for every conversation in this session in one go, instead of opening each one individually';
      backfillSessionBtn.innerHTML = ICON_UPLOAD + ' Backfill Session Timing';
      backfillSessionBtn.addEventListener('click', async () => {
        backfillSessionBtn.disabled = true;
        backfillSessionBtn.innerHTML = '<span class="spinner"></span> Backfilling…';
        try {
          const envParam = (sessionMeta && sessionMeta.das_env) || 'Local';
          const data = await api('/api/mlflow/backfill-session/' + sessionId + '?env=' + encodeURIComponent(envParam), { method: 'POST' });
          showToast('Backfilled ' + data.updated + '/' + data.total + ' conversation(s)' + (data.skipped ? ' (' + data.skipped + ' had no trace data)' : ''), data.updated > 0 ? 'success' : 'error');
        } catch { } finally {
          backfillSessionBtn.disabled = false;
          backfillSessionBtn.innerHTML = ICON_UPLOAD + ' Backfill Session Timing';
        }
      });
      body.appendChild(backfillSessionBtn);

      const wrapper = document.createElement('div');
      wrapper.className = 'table-wrapper';
      const table = document.createElement('table');
      table.innerHTML =
        '<thead><tr>' +
        '<th>Application</th><th>Round</th><th>Grades</th><th>Assumptions</th><th>Flow</th><th>Actions</th>' +
        '</tr></thead>';
      const tbody = document.createElement('tbody');
      results.forEach((r, idx) => {
        const tr = document.createElement('tr');
        tr.className = 'clickable';
        enableRowKeyboardActivation(tr);
        tr.innerHTML =
          '<td>' + escapeHtml(r.application_name || '—') +
          '<div class="td-secondary">Conv #' + (r.conversation_no || r.conversation_id || '') + '</div></td>' +
          '<td>' + (r.round_no || '—') + '</td>' +
          '<td></td><td>' + scoreDisplay(r.assumptions_score) + '</td><td></td>' +
          '<td><button class="btn btn-xs btn-secondary drill-btn">Details</button></td>';
        const gradeCell = tr.cells[2];
        gradeCell.appendChild(statusBadge(r.grades_passed));
        const flowCell = tr.cells[4];
        flowCell.appendChild(statusBadge(r.flow_completed));
        tr.querySelector('.drill-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          openResultDrillDownAt(idx);
        });
        tr.addEventListener('click', () => openResultDrillDownAt(idx));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrapper.appendChild(table);
      body.appendChild(wrapper);
    }

    panel.classList.add('open');
    overlay.classList.add('open');
    fadePanelBody();
  }

  async function openResultDrillDown(resultId) {
    // Standalone open (not via the session table) — clear any stale session-nav
    // context left over from a previous drilldown so renderDrillDownNavBar stays hidden.
    state.sessionDrilldownContext = null;
    let data;
    try {
      data = await api('/api/results/detail/' + resultId);
    } catch { return; }
    renderDrillDownPanel(data);
  }

  /* Open a result by its position within the current session's result list, so
     Prev/Next/jump navigation can move between conversations (and rounds) of the
     same session without dropping back to the session table each time. */
  async function openResultDrillDownAt(index) {
    const ctx = state.sessionDrilldownContext;
    if (!ctx || !ctx.results[index]) return;
    ctx.currentIndex = index;
    let data;
    try {
      data = await api('/api/results/detail/' + ctx.results[index].id);
    } catch { return; }
    renderDrillDownPanel(data);
  }

  function renderDrillDownNavBar(body) {
    const ctx = state.sessionDrilldownContext;
    if (!ctx || ctx.currentIndex == null) return;

    const nav = document.createElement('div');
    nav.className = 'drilldown-nav-bar';

    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-secondary btn-xs';
    backBtn.innerHTML = ICON_ARROW_LEFT + 'Back to Session';
    backBtn.addEventListener('click', () => renderSessionDetailPanel(ctx.sessionId, ctx.results, ctx.sessionMeta));
    nav.appendChild(backBtn);

    const prevBtn = document.createElement('button');
    prevBtn.className = 'btn btn-secondary btn-xs';
    prevBtn.textContent = '‹ Prev';
    prevBtn.disabled = ctx.currentIndex <= 0;
    prevBtn.addEventListener('click', () => openResultDrillDownAt(ctx.currentIndex - 1));
    nav.appendChild(prevBtn);

    const select = document.createElement('select');
    select.className = 'form-input drilldown-nav-select';
    ctx.results.forEach((r, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = 'Round ' + (r.round_no || '—') + ' · Conv #' + (r.conversation_no || r.conversation_id || '') + ' · ' + (r.application_name || '');
      if (i === ctx.currentIndex) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => openResultDrillDownAt(parseInt(select.value)));
    nav.appendChild(select);

    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-secondary btn-xs';
    nextBtn.textContent = 'Next ›';
    nextBtn.disabled = ctx.currentIndex >= ctx.results.length - 1;
    nextBtn.addEventListener('click', () => openResultDrillDownAt(ctx.currentIndex + 1));
    nav.appendChild(nextBtn);

    body.appendChild(nav);

    // Compare this conversation's result against a different round of the SAME
    // application — comparing two different applications tells you nothing (they
    // have different expected grades/CTQs entirely), but the same app across rounds
    // shows whether a failure is consistent or one-off.
    const current = ctx.results[ctx.currentIndex];
    const currentKey = current.conversation_no != null ? current.conversation_no : current.conversation_id;
    const sameApp = ctx.results
      .map((r, i) => ({ r, i }))
      .filter(({ r, i }) => {
        if (i === ctx.currentIndex) return false;
        const key = r.conversation_no != null ? r.conversation_no : r.conversation_id;
        return key === currentKey;
      })
      .sort((a, b) => (a.r.round_no || 0) - (b.r.round_no || 0));

    if (sameApp.length > 0) {
      const compareBar = document.createElement('div');
      compareBar.className = 'drilldown-nav-bar';

      const label = document.createElement('span');
      label.className = 'text-muted text-sm';
      label.style.flexShrink = '0';
      label.textContent = 'Compare with round:';
      compareBar.appendChild(label);

      const compareSelect = document.createElement('select');
      compareSelect.className = 'form-input drilldown-nav-select';
      sameApp.forEach(({ r, i }) => {
        const opt = document.createElement('option');
        opt.value = i;
        // grades_passed comes back from SQLite as 0/1/null, not true/false/null —
        // a strict `=== false` check never matches the number 0, so failed rounds
        // fell through to "N/A" instead of "FAIL".
        const passLabel = r.grades_passed == null ? 'N/A' : (r.grades_passed ? 'PASS' : 'FAIL');
        opt.textContent = 'Round ' + (r.round_no || '—') + ' · ' + passLabel;
        compareSelect.appendChild(opt);
      });
      compareBar.appendChild(compareSelect);

      const compareBtn = document.createElement('button');
      compareBtn.className = 'btn btn-secondary btn-xs';
      compareBtn.textContent = 'Compare';
      compareBtn.addEventListener('click', () => openCompareView(ctx.currentIndex, parseInt(compareSelect.value)));
      compareBar.appendChild(compareBtn);

      body.appendChild(compareBar);
    }
  }

  async function openCompareView(indexA, indexB) {
    const ctx = state.sessionDrilldownContext;
    if (!ctx || !ctx.results[indexA] || !ctx.results[indexB]) return;
    let dataA, dataB;
    try {
      [dataA, dataB] = await Promise.all([
        api('/api/results/detail/' + ctx.results[indexA].id),
        api('/api/results/detail/' + ctx.results[indexB].id),
      ]);
    } catch { return; }
    renderCompareView(dataA, dataB, indexA, indexB);
  }

  function compareColumnHTML(data) {
    const turns = typeof data.actual_turns_json === 'string' ? safeJSON(data.actual_turns_json) : data.actual_turns_json;
    const assumptionEval = typeof data.assumption_eval_details === 'string' ? safeJSON(data.assumption_eval_details) : data.assumption_eval_details;
    let html =
      '<div class="detail-grid mb-4">' +
      '<div class="detail-field"><span class="detail-field-label">Application</span><span class="detail-field-value">' + escapeHtml(data.application_name || '—') + '</span></div>' +
      '<div class="detail-field"><span class="detail-field-label">Conversation</span><span class="detail-field-value">#' + (data.conversation_no || data.conversation_id || '') + '</span></div>' +
      '<div class="detail-field"><span class="detail-field-label">Total Duration</span><span class="detail-field-value">' + (data.total_duration_ms != null ? formatLatency(data.total_duration_ms) : '—') + '</span></div>' +
      '<div class="detail-field"><span class="detail-field-label">Avg Response Time</span><span class="detail-field-value">' + (data.avg_turn_latency_ms != null ? formatLatency(data.avg_turn_latency_ms) : '—') + '</span></div>' +
      '</div>' +
      '<div class="detail-field mb-2"><span class="detail-field-label">Grades</span> </div>' +
      '<div class="mb-2">Expected: ' + escapeHtml(data.expected_grades || '—') + '</div>' +
      '<div class="mb-4">Suggested: ' + formatSuggestedGrades(data.suggested_grades) + '</div>' +
      '<div class="detail-field mb-2"><span class="detail-field-label">Assumption Score</span> <span class="detail-field-value" style="display:inline">' + scoreDisplay(data.assumptions_score) + '</span></div>' +
      '<div class="mb-4">' + renderCTQListHTML(assumptionEval) + '</div>' +
      '<div class="detail-section-title">Conversation Turns</div>' +
      '<div class="turn-list">';
    (turns || []).forEach(t => {
      const isUser = t.role === 'user';
      html += '<div class="turn-item ' + (isUser ? 'user-turn' : 'agent-turn') + '">' +
        '<span class="turn-role ' + (isUser ? 'user' : 'agent') + '">' + (isUser ? 'User' : 'Agent') + '</span>' +
        '<span class="turn-content">' + escapeHtml(t.content || '') + '</span>' +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderCompareView(dataA, dataB, indexA, indexB) {
    const panel = el('detail-panel');
    const body = el('detail-panel-body');
    panel.classList.add('compare-mode');
    el('detail-panel-title').textContent = (dataA.application_name || 'Comparison') + ' — Round ' + (dataA.round_no || '—') + ' vs Round ' + (dataB.round_no || '—');
    body.innerHTML = '';

    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-secondary btn-xs mb-4';
    backBtn.innerHTML = ICON_ARROW_LEFT + 'Back';
    backBtn.addEventListener('click', () => openResultDrillDownAt(indexA != null ? indexA : 0));
    body.appendChild(backBtn);

    const grid = document.createElement('div');
    grid.className = 'compare-grid';

    const gradeBadgeA = statusBadge(dataA.grades_passed).outerHTML;
    const gradeBadgeB = statusBadge(dataB.grades_passed).outerHTML;

    const colA = document.createElement('div');
    colA.className = 'compare-column';
    colA.innerHTML = '<div class="compare-column-header">' + gradeBadgeA + '</div>' + compareColumnHTML(dataA);

    const colB = document.createElement('div');
    colB.className = 'compare-column';
    colB.innerHTML = '<div class="compare-column-header">' + gradeBadgeB + '</div>' + compareColumnHTML(dataB);

    grid.appendChild(colA);
    grid.appendChild(colB);
    body.appendChild(grid);

    panel.classList.add('open');
    el('detail-overlay').classList.add('open');
    fadePanelBody();
  }

  /* Re-run one stored result's exact conversation+environment and overwrite that
     same row in place — separate from the batch-level "retry failed" flow, which
     spins up a whole new linked session instead of touching the original. */
  async function retryThisResult(resultId, btn) {
    if (state.isRunning) { showToast('A test is already running', 'error'); return; }
    const resetBtn = () => { btn.disabled = false; btn.innerHTML = ICON_RETRY + ' Retry This Conversation'; };

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:12px;height:12px;margin-right:6px;display:inline-block"></span>Retrying...';
    state.isRunning = true;

    try {
      await api('/api/results/retry/' + resultId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch {
      state.isRunning = false;
      resetBtn();
      return;
    }

    connectSSE({
      completed(d) {
        showToast((d.success ? 'PASS' : 'FAIL') + ' — retry complete for ' + (d.application || ''), d.success ? 'success' : 'error');
      },
      async run_complete() {
        closeSSE();
        state.isRunning = false;
        let fresh;
        try {
          fresh = await api('/api/results/detail/' + resultId);
        } catch {
          resetBtn();
          return;
        }
        // Keep the session table / prev-next nav in sync so "Back to Session" and
        // switching to another conversation don't show the pre-retry outcome.
        const ctx = state.sessionDrilldownContext;
        if (ctx && ctx.currentIndex != null && ctx.results[ctx.currentIndex] && ctx.results[ctx.currentIndex].id === resultId) {
          Object.assign(ctx.results[ctx.currentIndex], {
            grades_passed: fresh.grades_passed,
            assumptions_score: fresh.assumptions_score,
            flow_completed: fresh.flow_completed,
            application_name: fresh.application_name,
          });
        }
        renderDrillDownPanel(fresh);
      },
      error(d) {
        closeSSE();
        state.isRunning = false;
        showToast(d.message || 'Retry failed', 'error');
        resetBtn();
      },
    });
  }

  function renderDrillDownPanel(data) {
    const panel = el('detail-panel');
    const body = el('detail-panel-body');
    panel.classList.remove('compare-mode');
    el('detail-panel-title').textContent = data.application_name || 'Result Detail';

    body.innerHTML = '';
    renderDrillDownNavBar(body);

    /* Overview Section */
    const overview = document.createElement('div');
    overview.className = 'detail-section';
    overview.innerHTML = '<div class="detail-section-title" style="display:flex;justify-content:space-between;align-items:center;">' +
      '<div><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Overview</div>' +
      '<button id="drill-retry-btn" class="btn btn-xs btn-secondary" title="Re-run this exact conversation and overwrite this result with the fresh outcome">' + ICON_RETRY + ' Retry This Conversation</button>' +
      '</div>';
    const grid = document.createElement('div');
    grid.className = 'detail-grid';
    const fields = [
      ['Application', data.application_name || '—'],
      ['Conversation', '#' + (data.conversation_no || data.conversation_id || '')],
      ['Round', data.round_no || '—'],
      ['Timestamp', formatDate(data.timestamp)],
      ['Environment', data.das_env || data.environment || '—'],
      ['Total Duration', data.total_duration_ms != null ? formatLatency(data.total_duration_ms) : '—'],
      ['Avg Response Time', data.avg_turn_latency_ms != null ? formatLatency(data.avg_turn_latency_ms) : '—'],
      ['Total Tokens', data.total_tokens != null ? data.total_tokens.toLocaleString() : '—'],
      ['Error', data.error_message || 'None'],
    ];
    fields.forEach(([label, val]) => {
      grid.innerHTML += '<div class="detail-field"><span class="detail-field-label">' + label + '</span><span class="detail-field-value">' + escapeHtml(String(val)) + '</span></div>';
    });
    if (data.conversation_id) {
      grid.innerHTML += '<div class="detail-field" style="grid-column: 1 / -1;"><span class="detail-field-label">Conversation ID (for MLflow lookup)</span><span class="detail-field-value">' + conversationIdChipHTML(data.conversation_id) + '</span></div>';
    }
    overview.appendChild(grid);
    body.appendChild(overview);

    /* Grades Section */
    const gradeSection = document.createElement('div');
    gradeSection.className = 'detail-section';
    gradeSection.innerHTML = '<div class="detail-section-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Grade Evaluation' +
      (data.grade_eval_ms != null ? '<span class="status-pill" style="margin-left:8px;text-transform:none;letter-spacing:0">' + ICON_CLOCK + formatLatency(data.grade_eval_ms) + '</span>' : '') +
      '</div>';
    const gradeInfo = document.createElement('div');
    gradeInfo.className = 'detail-grid mb-4';
    gradeInfo.innerHTML =
      '<div class="detail-field"><span class="detail-field-label">Status</span><span class="detail-field-value"></span></div>' +
      '<div class="detail-field" style="grid-column: 1 / -1;"><span class="detail-field-label">Expected Grades</span><span class="detail-field-value">' + escapeHtml(data.expected_grades || '—') + '</span></div>' +
      '<div class="detail-field" style="grid-column: 1 / -1;"><span class="detail-field-label">Suggested Grades</span><span class="detail-field-value">' + formatSuggestedGrades(data.suggested_grades) + '</span></div>';
    const statusValEl = gradeInfo.querySelector('.detail-field-value');
    statusValEl.appendChild(statusBadge(data.grades_passed));
    gradeSection.appendChild(gradeInfo);

    if (data.grade_eval_details) {
      const details = typeof data.grade_eval_details === 'string' ? safeJSON(data.grade_eval_details) : data.grade_eval_details;
      if (details) {
        const evalItems = Array.isArray(details) ? details : [details];
        evalItems.forEach(item => {
          const evalDiv = document.createElement('div');
          evalDiv.className = 'eval-item';
          if (item.totalMatched !== undefined) {
            evalDiv.innerHTML =
              '<div class="eval-item-header"><span class="eval-item-title">Match Results</span></div>' +
              '<div class="eval-item-body">' +
              '<div>Matched: <strong>' + item.totalMatched + ' / ' + item.totalExpected + '</strong> expected grades</div>' +
              (item.matchedExpected && Array.isArray(item.matchedExpected) && item.matchedExpected.length > 0 ? '<div>Matched Grades: ' + escapeHtml(item.matchedExpected.join(', ')) + '</div>' : '') +
              (item.reasoning ? '<div style="margin-top:4px">Reasoning: ' + escapeHtml(item.reasoning) + '</div>' : '') +
              '</div>';
          } else {
            evalDiv.innerHTML =
              '<div class="eval-item-header"><span class="eval-item-title">' + escapeHtml(item.grade || item.name || 'Evaluation') + '</span></div>' +
              '<div class="eval-item-body">' +
              (item.matched !== undefined ? '<div>Matched: <strong>' + (item.matched ? 'Yes' : 'No') + '</strong></div>' : '') +
              (item.expected !== undefined ? '<div>Expected: ' + escapeHtml(String(item.expected)) + '</div>' : '') +
              (item.actual !== undefined ? '<div>Actual: ' + escapeHtml(String(item.actual)) + '</div>' : '') +
              (item.reasoning ? '<div style="margin-top:4px">Reasoning: ' + escapeHtml(item.reasoning) + '</div>' : '') +
              '</div>';
          }
          gradeSection.appendChild(evalDiv);
        });
      }
    }
    body.appendChild(gradeSection);

    /* Assumption Section */
    const assumeSection = document.createElement('div');
    assumeSection.className = 'detail-section';
    assumeSection.innerHTML = '<div class="detail-section-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>Assumption Evaluation' +
      (data.assumption_eval_ms != null ? '<span class="status-pill" style="margin-left:8px;text-transform:none;letter-spacing:0">' + ICON_CLOCK + formatLatency(data.assumption_eval_ms) + '</span>' : '') +
      '</div>';
    const assumeInfo = document.createElement('div');
    assumeInfo.style.marginBottom = '12px';
    assumeInfo.innerHTML =
      '<div class="detail-field"><span class="detail-field-label">Score</span><span class="detail-field-value" style="font-size:18px;font-weight:700">' + scoreDisplay(data.assumptions_score) + '</span></div>';
    assumeSection.appendChild(assumeInfo);

    if (data.assumption_eval_details) {
      const aDetails = typeof data.assumption_eval_details === 'string' ? safeJSON(data.assumption_eval_details) : data.assumption_eval_details;
      const ctqWrap = document.createElement('div');
      ctqWrap.innerHTML = renderCTQListHTML(aDetails);
      assumeSection.appendChild(ctqWrap);
    }
    body.appendChild(assumeSection);

    /* Conversation Turns */
    const turnsSection = document.createElement('div');
    turnsSection.className = 'detail-section';
    turnsSection.innerHTML = '<div class="detail-section-title" style="display:flex; justify-content:space-between; align-items:center;">' +
      '<div><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Conversation Turns</div>' +
      '<button id="drill-raw-json-btn" class="btn btn-xs btn-secondary">Raw JSON</button>' +
      '</div>';
    const turnList = document.createElement('div');
    turnList.className = 'turn-list';

    if (data.actual_turns_json) {
      const turns = typeof data.actual_turns_json === 'string' ? safeJSON(data.actual_turns_json) : data.actual_turns_json;
      if (Array.isArray(turns) && turns.length > 0) {
        const latencies = turns.map(t => t.latencyMs).filter(v => v != null);
        const maxLatency = latencies.length > 1 ? Math.max(...latencies) : null;
        turns.forEach(t => {
          const role = (t.role || t.speaker || '').toLowerCase();
          const isUser = role === 'user' || role === 'human';
          const item = document.createElement('div');
          item.className = 'turn-item ' + (isUser ? 'user-turn' : 'agent-turn');
          const latencyLabel = formatLatency(t.latencyMs);
          const isSlowest = maxLatency != null && t.latencyMs === maxLatency;
          item.innerHTML =
            '<div style="display:flex; flex-direction:column; gap:4px; min-width:0; flex:1;">' +
            '<div style="display:flex; align-items:center; gap:8px;">' +
            '<span class="turn-role ' + (isUser ? 'user' : 'agent') + '">' + (isUser ? 'User' : 'Agent') + '</span>' +
            (latencyLabel ? '<span class="chat-turn-latency' + (isSlowest ? ' slow' : '') + '">' + ICON_CLOCK + latencyLabel + (isSlowest ? ' (slowest)' : '') + '</span>' : '') +
            '</div>' +
            '<span class="turn-content">' + escapeHtml(t.content || t.message || t.text || '') + '</span>' +
            '</div>';
          turnList.appendChild(item);
        });
      } else {
        turnList.innerHTML = '<p class="text-muted text-sm">No turns recorded.</p>';
      }
    } else {
      turnList.innerHTML = '<p class="text-muted text-sm">No turns recorded.</p>';
    }
    turnsSection.appendChild(turnList);
    body.appendChild(turnsSection);

    /* Manual Override Form */
    const overrideSection = document.createElement('div');
    overrideSection.className = 'detail-section';
    overrideSection.innerHTML = '<div class="detail-section-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>Manual Override</div>';
    const form = document.createElement('div');
    form.className = 'inline-edit-form';
    form.innerHTML =
      '<div class="form-group">' +
      '<label class="form-label">Grades Passed</label>' +
      '<label class="toggle"><input type="checkbox" id="override-grades" ' + (data.grades_passed ? 'checked' : '') + '><span class="toggle-slider"></span></label>' +
      '</div>' +
      '<div class="form-group">' +
      '<label class="form-label">Assumption Score</label>' +
      '<input type="number" step="0.01" class="form-input" id="override-assumption" value="' + (data.assumptions_score || '') + '">' +
      '</div>' +
      '<div class="form-group">' +
      '<label class="form-label" style="visibility:hidden">Save</label>' +
      '<button class="btn btn-primary btn-sm" id="override-save-btn">Save Override</button>' +
      '</div>';
    overrideSection.appendChild(form);
    body.appendChild(overrideSection);

    el('override-save-btn').addEventListener('click', async () => {
      const gradesPassed = el('override-grades').checked;
      const assumptionScore = parseFloat(el('override-assumption').value);
      try {
        await api('/api/results/override', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ result_id: data.id, grades_passed: gradesPassed, assumptions_score: assumptionScore }),
        });
        showToast('Override saved', 'success');
      } catch { }
    });

    panel.classList.add('open');
    el('detail-overlay').classList.add('open');
    fadePanelBody();

    const jsonBtn = el('drill-raw-json-btn');
    if (jsonBtn) {
      jsonBtn.addEventListener('click', () => {
        const turns = typeof data.actual_turns_json === 'string' ? safeJSON(data.actual_turns_json) : data.actual_turns_json;
        turnList.innerHTML = '<pre style="background:var(--bg-app); padding:10px; border-radius:4px; font-size:12px; overflow-x:auto;">' + escapeHtml(JSON.stringify(turns, null, 2)) + '</pre>';
        jsonBtn.style.display = 'none';
      });
    }

    const retryBtn = el('drill-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => retryThisResult(data.id, retryBtn));
    }

    /* Turn Timing Section — already-saved per-turn agent/tool breakdown, if any */
    const turnTraces = typeof data.turn_traces_json === 'string' ? safeJSON(data.turn_traces_json) : data.turn_traces_json;
    const timingSection = document.createElement('div');
    timingSection.className = 'detail-section mt-4';
    timingSection.innerHTML = '<div class="detail-section-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Turn Timing</div>' +
      '<div id="drill-turn-timing-list"></div>';
    body.appendChild(timingSection);
    renderTurnTimingTable(turnTraces, timingSection.querySelector('#drill-turn-timing-list'));

    /* MLflow Section */
    const traceSection = document.createElement('div');
    traceSection.className = 'detail-section mt-4';
    traceSection.innerHTML = '<div class="detail-section-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>MLflow Traces</div>' +
      '<p class="text-muted text-sm mb-2">Fetch execution traces from MLflow (tool calls, sub-agent spans, latencies). Use this ID to look the conversation up directly in MLflow too:</p>' +
      (data.conversation_id ? '<div class="mb-2">' + conversationIdChipHTML(data.conversation_id) + '</div>' : '') +
      '<button id="drill-mlflow-btn" class="btn btn-secondary btn-xs mb-2">Fetch Traces</button>' +
      '<button id="drill-mlflow-backfill-btn" class="btn btn-secondary btn-xs mb-2" style="margin-left:8px;" title="Fetch and save per-turn agent/tool timing for this conversation, so it appears in a regenerated report">Save Timing to Report</button>' +
      '<div id="drill-mlflow-results"></div>';
    body.appendChild(traceSection);

    setTimeout(() => {
      const fetchBtn = el('drill-mlflow-btn');
      if(fetchBtn) {
        fetchBtn.addEventListener('click', async () => {
          fetchBtn.innerHTML = '<span class="spinner" style="width:12px;height:12px;margin-right:6px;display:inline-block"></span>Fetching...';
          fetchBtn.disabled = true;
          try {
            const envParam = data.das_env || data.environment || 'Local';
            const tr = await api('/api/mlflow/traces/' + encodeURIComponent(data.conversation_id) + '?env=' + encodeURIComponent(envParam));
            renderTraceSpans(tr, el('drill-mlflow-results'));
          } catch (e) {
            el('drill-mlflow-results').innerHTML = '<p class="text-muted" style="color:var(--danger)">Failed to fetch traces: ' + escapeHtml(e.message || 'unknown error') + '</p>';
          }
          fetchBtn.style.display = 'none';
        });
      }
      const backfillBtn = el('drill-mlflow-backfill-btn');
      if (backfillBtn) {
        backfillBtn.addEventListener('click', async () => {
          backfillBtn.innerHTML = '<span class="spinner" style="width:12px;height:12px;margin-right:6px;display:inline-block"></span>Saving...';
          backfillBtn.disabled = true;
          try {
            const envParam = data.das_env || data.environment || 'Local';
            const res = await api('/api/mlflow/backfill/' + encodeURIComponent(data.conversation_id) + '?env=' + encodeURIComponent(envParam), { method: 'POST' });
            renderTurnTimingTable(res.turnTraces, timingSection.querySelector('#drill-turn-timing-list'));
            showToast('Turn timing saved to report', 'success');
            backfillBtn.style.display = 'none';
          } catch (e) {
            backfillBtn.disabled = false;
            backfillBtn.textContent = 'Save Timing to Report';
          }
        });
      }
    }, 50);
  }

  function safeJSON(str) {
    try { return JSON.parse(str); } catch { return null; }
  }

  function formatSuggestedGrades(grades) {
    if (!grades) return '—';
    if (Array.isArray(grades)) {
      return escapeHtml(grades.map(a => typeof a === 'object' ? (a.gradeName || a.grade_name || a.grade || JSON.stringify(a)) : String(a)).join(', '));
    }
    if (typeof grades === 'string') {
      if (grades.startsWith('[')) {
        try {
          const arr = JSON.parse(grades);
          if (Array.isArray(arr)) {
            return escapeHtml(arr.map(a => typeof a === 'object' ? (a.gradeName || a.grade_name || a.grade || JSON.stringify(a)) : String(a)).join(', '));
          }
        } catch (e) {
          const matches = [...grades.matchAll(/'grade_name':\s*'([^']+)'/g)];
          if (matches.length > 0) {
            return escapeHtml(matches.map(m => m[1]).join(', '));
          }
        }
      }
      return escapeHtml(grades);
    }
    return escapeHtml(String(grades));
  }

  /* Render MLflow traces inside a container (reused in drilldown + traces page) */
  function spanTypeClass(spanType) {
    const t = (spanType || '').toUpperCase();
    if (t === 'TOOL') return 'span-type-tool';
    if (t === 'AGENT') return 'span-type-agent';
    if (t === 'LLM' || t === 'CHAT_MODEL') return 'span-type-llm';
    return 'span-type-other';
  }

  function buildSpanRow(span) {
    const item = document.createElement('div');
    item.className = 'span-item';
    item.style.paddingLeft = ((span.depth || 0) * 16) + 'px';

    const isError = span.status && span.status !== 'OK' && span.status !== 'UNSET';
    const barClass = isError ? 'error' : 'ok';
    const offsetPct = Math.max(0, span._offsetPct || 0);
    const widthPct = Math.max(0.6, span._widthPct || 0);
    const hasIO = !!(span.inputs || span.outputs);

    item.innerHTML =
      '<div class="span-item-main">' +
      '<span class="span-type-tag ' + spanTypeClass(span.span_type) + '">' + escapeHtml((span.span_type || 'STEP').replace(/_/g, ' ')) + '</span>' +
      '<span class="span-name" title="' + escapeHtml(span.name || '') + '">' + escapeHtml(span.name || '') + '</span>' +
      '<div class="span-duration-bar"><div class="duration-bar-container">' +
      '<div class="duration-bar-track"><div class="duration-bar-fill ' + barClass + '" style="margin-left:' + offsetPct + '%; width:' + widthPct + '%"></div></div>' +
      '<span class="duration-value">' + (span.duration_ms != null ? formatLatency(span.duration_ms) : '—') + '</span>' +
      '</div></div>' +
      (hasIO ? '<span class="span-io-toggle">' + ICON_CHEVRON_RIGHT + '</span>' : '') +
      '</div>';

    if (hasIO) {
      const ioPanel = document.createElement('div');
      ioPanel.className = 'span-io-panel';
      ioPanel.innerHTML =
        (span.inputs ? '<div class="span-io-block"><div class="span-io-label">Input</div><pre class="span-io-content"></pre></div>' : '') +
        (span.outputs ? '<div class="span-io-block"><div class="span-io-label">Output</div><pre class="span-io-content"></pre></div>' : '');
      const contentEls = ioPanel.querySelectorAll('.span-io-content');
      let ci = 0;
      if (span.inputs) contentEls[ci++].textContent = span.inputs;
      if (span.outputs) contentEls[ci++].textContent = span.outputs;
      item.appendChild(ioPanel);
      item.classList.add('has-io');
      item.querySelector('.span-item-main').addEventListener('click', () => {
        item.classList.toggle('io-open');
        const toggle = item.querySelector('.span-io-toggle');
        if (toggle) toggle.classList.toggle('expanded');
      });
    }
    return item;
  }

  function renderTraceSpans(data, container) {
    if (data && data.error) {
      container.innerHTML = '<p class="text-muted" style="color:var(--danger)">' + escapeHtml(data.error) + '</p>';
      return;
    }
    if (!data || (!data.traces && !Array.isArray(data))) {
      container.innerHTML = '<p class="text-muted">No trace data available.</p>';
      return;
    }
    const traces = data.traces || (Array.isArray(data) ? data : [data]);
    if (traces.length === 0) {
      container.innerHTML = '<p class="text-muted">No traces found.</p>';
      return;
    }

    traces.forEach(trace => {
      const spans = trace.spans || [];
      const computedExtent = spans.reduce((m, s) => Math.max(m, (s.start_offset_ms || 0) + (s.duration_ms || 0)), 0);
      const traceDurationMs = trace.total_duration_ms || computedExtent || 1;
      spans.forEach(s => {
        s._offsetPct = ((s.start_offset_ms || 0) / traceDurationMs) * 100;
        s._widthPct = ((s.duration_ms || 0) / traceDurationMs) * 100;
      });

      const card = document.createElement('div');
      card.className = 'trace-card';
      const header = document.createElement('div');
      header.className = 'trace-header';
      header.innerHTML =
        '<div class="trace-header-left">' +
        '<span class="trace-expand-icon">' + ICON_CHEVRON_RIGHT + '</span>' +
        '<span class="trace-id">' + escapeHtml(String(trace.trace_id || '').substring(0, 12)) + '</span>' +
        '</div>' +
        '<div class="trace-header-right">' +
        '<span>' + (trace.total_duration_ms != null ? formatLatency(trace.total_duration_ms) : '—') + '</span>' +
        '</div>';
      const sBadge = (trace.status === 'OK' || trace.status === 'ok')
        ? createBadge('pass', trace.status)
        : createBadge('fail', trace.status || 'ERROR');
      header.querySelector('.trace-header-right').prepend(sBadge);

      const body = document.createElement('div');
      body.className = 'trace-body';
      if (spans.length > 0) {
        spans.forEach(span => body.appendChild(buildSpanRow(span)));
      } else {
        body.innerHTML = '<p class="text-muted text-sm" style="padding:8px 0">No spans recorded.</p>';
      }
      header.addEventListener('click', () => {
        body.classList.toggle('open');
        header.querySelector('.trace-expand-icon').classList.toggle('expanded');
      });
      card.appendChild(header);
      card.appendChild(body);
      container.appendChild(card);
    });
  }

  /* Per-turn agent/tool timing breakdown — the data saved to turn_traces_json and
     exported as the timing_round{N} report sheet. Reused in the Traces tab and the
     result drill-down. */
  /* One agent/tool call inside a turn — a green/red dot flags whether it actually
     produced output (not just whether MLflow recorded an error status), and if
     there's input/output captured, clicking expands it. This is the "micro eval"
     view for catching silent internal-tool failures that still let the turn as a
     whole complete normally. */
  function buildTurnCallPill(c) {
    const hasIO = !!((c.inputs && c.inputs.trim()) || (c.outputs && c.outputs.trim()));
    const failed = c.succeeded === false;
    const wrap = document.createElement('div');
    wrap.className = 'turn-timing-call' + (hasIO ? ' has-io' : '');

    const pill = document.createElement('span');
    pill.className = 'turn-timing-pill ' + spanTypeClass(c.type) + (failed ? ' call-failed' : '');
    pill.innerHTML =
      '<span class="turn-timing-status-dot ' + (failed ? 'fail' : 'ok') + '" title="' + (failed ? 'No output produced' : 'Produced output') + '"></span>' +
      '<span>' + escapeHtml(c.name || '') + ' &middot; ' + (c.durationMs != null ? formatLatency(c.durationMs) : '—') + '</span>' +
      (hasIO ? '<span class="turn-timing-io-toggle">' + ICON_CHEVRON_RIGHT + '</span>' : '');
    wrap.appendChild(pill);

    if (hasIO) {
      const ioPanel = document.createElement('div');
      ioPanel.className = 'turn-timing-io-panel';
      ioPanel.innerHTML =
        (c.inputs ? '<div class="span-io-block"><div class="span-io-label">Input</div><pre class="span-io-content"></pre></div>' : '') +
        (c.outputs ? '<div class="span-io-block"><div class="span-io-label">Output</div><pre class="span-io-content"></pre></div>' : '<div class="text-muted text-sm">No output produced.</div>');
      const contentEls = ioPanel.querySelectorAll('.span-io-content');
      let ci = 0;
      if (c.inputs) contentEls[ci++].textContent = c.inputs;
      if (c.outputs) contentEls[ci++].textContent = c.outputs;
      wrap.appendChild(ioPanel);
      pill.addEventListener('click', () => {
        wrap.classList.toggle('io-open');
        wrap.querySelector('.turn-timing-io-toggle').classList.toggle('expanded');
      });
    }
    return wrap;
  }

  function renderTurnTimingTable(turnTraces, container) {
    if (!turnTraces || turnTraces.length === 0) {
      container.innerHTML = '<p class="text-muted text-sm">No turn timing data saved for this conversation yet.</p>';
      return;
    }
    container.innerHTML = '';
    turnTraces.forEach(turn => {
      const row = document.createElement('div');
      row.className = 'turn-timing-row';
      row.innerHTML =
        '<div class="turn-timing-header">' +
        '<span class="turn-timing-no">Turn ' + (turn.turnNo != null ? turn.turnNo : '—') + '</span>' +
        '<span class="turn-timing-input" title="' + escapeHtml(turn.userInput || '') + '">' + escapeHtml(turn.userInput || '') + '</span>' +
        '<span class="turn-timing-latency">' + (turn.responseTimeMs != null ? formatLatency(turn.responseTimeMs) : '—') + '</span>' +
        '</div>';

      const calls = turn.agentCalls || [];
      if (calls.length === 0) {
        row.innerHTML += '<div class="text-muted text-sm">No agent/tool breakdown captured for this turn.</div>';
      } else {
        const callsWrap = document.createElement('div');
        callsWrap.className = 'turn-timing-calls';
        calls.forEach(c => callsWrap.appendChild(buildTurnCallPill(c)));
        row.appendChild(callsWrap);
      }
      container.appendChild(row);
    });
  }

  function closeDetailPanel() {
    el('detail-panel').classList.remove('open');
    el('detail-panel').classList.remove('compare-mode');
    el('detail-overlay').classList.remove('open');
  }

  /* ----------------------------------------------------------
     Dashboard Page
  ---------------------------------------------------------- */
  async function loadDashboardOverview() {
    let sessions;
    try {
      sessions = await api('/api/results/sessions');
    } catch {
      return;
    }
    // Single-conversation runs aren't "sessions" — keep Home consistent with
    // the batch-session dropdown below, which already filters these out.
    sessions = (sessions || []).filter(s => s.unique_convs > 1);

    el('ov-stat-total-runs').textContent = sessions.length;

    const assumptionScores = sessions.map(s => s.assumption_score_avg).filter(v => v != null);
    const avgAssumption = assumptionScores.length ? assumptionScores.reduce((a, b) => a + b, 0) / assumptionScores.length : null;
    el('ov-stat-assumption').textContent = avgAssumption != null ? scoreDisplay(avgAssumption) : '—';

    const latencies = sessions.map(s => s.avg_latency_ms).filter(v => v != null);
    const avgLatency = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;
    el('ov-stat-latency').textContent = avgLatency != null ? formatLatency(avgLatency) : '—';
  }

  async function loadDashboardSessions() {
    const data = await api('/api/results/sessions');
    const sel = el('dashboard-session-select');
    sel.innerHTML = '<option value="">Select batch session…</option>';
    const batchSessions = (data || []).filter(s => s.unique_convs > 1);
    batchSessions.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = String(s.id).substring(0, 8) + ' — ' + formatDate(s.timestamp) + (s.das_env ? ' (' + s.das_env + ')' : '');
      sel.appendChild(opt);
    });
  }

  function initDashboard() {
    on('dashboard-session-select', 'change', loadDashboardData);
    on('dashboard-load-btn', 'click', loadDashboardData);
    on('dash-rounds-minus', 'click', () => {
      if (state.dashboardVisibleRounds > 1) {
        state.dashboardVisibleRounds--;
        renderDashboardForVisibleRounds();
      }
    });
    on('dash-rounds-plus', 'click', () => {
      if (state.dashboardVisibleRounds < state.dashboardMaxRounds) {
        state.dashboardVisibleRounds++;
        renderDashboardForVisibleRounds();
      }
    });
  }

  async function loadDashboardData() {
    const sessionId = el('dashboard-session-select').value;
    if (!sessionId) return;
    const results = await api('/api/results/' + sessionId);
    state.dashboardAllResults = results || [];

    const roundNos = state.dashboardAllResults.map(r => r.round_no).filter(n => n != null);
    state.dashboardMaxRounds = roundNos.length ? Math.max(...roundNos) : 1;
    state.dashboardVisibleRounds = state.dashboardMaxRounds;

    renderDashboardForVisibleRounds();
    show(el('dashboard-content'));
  }

  function renderDashboardForVisibleRounds() {
    const allResults = state.dashboardAllResults || [];
    const visible = state.dashboardVisibleRounds || 1;
    const maxRounds = state.dashboardMaxRounds || 1;
    const filtered = allResults.filter(r => (r.round_no || 1) <= visible);

    const uniqueConvs = new Set(filtered.map(r => r.conversation_no || r.conversation_id)).size;
    const passed = filtered.filter(r => r.grades_passed).length;
    const accuracy = filtered.length > 0 ? ((passed / filtered.length) * 100).toFixed(1) + '%' : '0%';

    const validAssumptions = filtered.filter(r => r.assumptions_score !== null && r.assumptions_score !== undefined);
    const avgAssumption = validAssumptions.length > 0 ? (validAssumptions.reduce((a, b) => a + b.assumptions_score, 0) / validAssumptions.length).toFixed(1) : '0';

    const elTotal = el('dash-stat-total');
    if (elTotal) elTotal.textContent = uniqueConvs;
    const elAcc = el('dash-stat-acc');
    if (elAcc) elAcc.textContent = accuracy;
    const elAss = el('dash-stat-score');
    if (elAss) elAss.textContent = avgAssumption;

    renderHeatmap(filtered);
    renderDashboardCharts(filtered);
    renderAppAccuracy(filtered);

    const display = el('dash-rounds-display');
    if (display) display.textContent = 'round 1 – ' + visible + ' of ' + maxRounds;
    const minusBtn = el('dash-rounds-minus');
    const plusBtn = el('dash-rounds-plus');
    if (minusBtn) minusBtn.disabled = visible <= 1;
    if (plusBtn) plusBtn.disabled = visible >= maxRounds;
  }

  /* Per-application pass rate across the included rounds — the same PASS/FAIL-per-round
     view as the Excel overview sheet's per-conversation matrix, condensed for the
     dashboard's right rail. */
  function renderAppAccuracy(results) {
    const container = el('dashboard-app-accuracy');
    if (!container) return;

    const byConv = {};
    results.forEach(r => {
      const key = r.conversation_no != null ? r.conversation_no : r.conversation_id;
      if (!byConv[key]) byConv[key] = { app: r.application_name || r.conversation_id, rounds: [] };
      byConv[key].rounds.push({ round: r.round_no, passed: r.grades_passed });
    });

    const rows = Object.values(byConv).map(c => {
      const graded = c.rounds.filter(r => r.passed !== null && r.passed !== undefined);
      const passCount = graded.filter(r => r.passed).length;
      const score = graded.length > 0 ? (passCount / graded.length) * 100 : null;
      return { app: c.app, rounds: c.rounds, passCount, total: graded.length, score };
    }).sort((a, b) => (a.score == null ? 101 : a.score) - (b.score == null ? 101 : b.score));

    if (rows.length === 0) {
      container.innerHTML = '<p class="text-muted text-sm">No data for this session.</p>';
      return;
    }

    const LOW_ACCURACY_THRESHOLD = 66;
    container.innerHTML = '';
    rows.forEach(row => {
      const isLow = row.score != null && row.score < LOW_ACCURACY_THRESHOLD;
      const div = document.createElement('div');
      div.className = 'flakiness-row' + (isLow ? ' low-accuracy' : '');
      const dots = row.rounds
        .slice()
        .sort((a, b) => (a.round || 0) - (b.round || 0))
        .map(r => {
          // r.passed is the raw grades_passed value from SQLite: 0/1/null, not
          // true/false/null — a strict === check against booleans silently misses
          // every failed round (0 !== false) and mislabels it "N/A" instead of "FAIL".
          const cls = r.passed == null ? 'na' : (r.passed ? 'pass' : 'fail');
          const label = r.passed == null ? 'N/A' : (r.passed ? 'PASS' : 'FAIL');
          return '<span class="flakiness-dot ' + cls + '" title="Round ' + r.round + ': ' + label + '"></span>';
        })
        .join('');
      div.innerHTML =
        '<span class="flakiness-app" title="' + escapeHtml(row.app) + '">' + escapeHtml(row.app) + '</span>' +
        '<span class="flakiness-dots">' + dots + '</span>' +
        '<span class="flakiness-rate">' + (row.score != null ? row.score.toFixed(0) + '% (' + row.passCount + '/' + row.total + ')' : '—') + '</span>';
      container.appendChild(div);
    });
  }

  function renderHeatmap(results) {
    const container = el('dashboard-heatmap');
    container.innerHTML = '';

    if (results.length === 0) {
      container.innerHTML = '<p class="text-muted text-sm">No data for this session.</p>';
      return;
    }

    const rounds = [...new Set(results.map(r => r.round_no))].sort((a, b) => a - b);
    const apps = {};
    results.forEach(r => {
      const key = r.application_name || r.conversation_id;
      if (!apps[key]) apps[key] = {};
      apps[key][r.round_no] = r;
    });
    const appNames = Object.keys(apps);

    const table = document.createElement('div');
    table.className = 'heatmap-grid';

    /* Header row */
    const headerRow = document.createElement('div');
    headerRow.className = 'heatmap-row';
    headerRow.innerHTML = '<div class="heatmap-cell heatmap-header heatmap-app-label">Application</div>';
    rounds.forEach(r => {
      headerRow.innerHTML += '<div class="heatmap-cell heatmap-header">R' + r + '</div>';
    });
    table.appendChild(headerRow);

    /* Data rows */
    const roundTotals = {};
    rounds.forEach(r => { roundTotals[r] = { pass: 0, fail: 0 }; });

    appNames.forEach(appName => {
      const row = document.createElement('div');
      row.className = 'heatmap-row';
      row.innerHTML = '<div class="heatmap-cell heatmap-app-label">' + escapeHtml(appName) + '</div>';
      rounds.forEach(r => {
        const result = apps[appName][r];
        if (result) {
          const passed = result.grades_passed && result.flow_completed;
          if (passed) roundTotals[r].pass++; else roundTotals[r].fail++;
          row.innerHTML += '<div class="heatmap-cell ' + (passed ? 'heatmap-pass' : 'heatmap-fail') + '">' + (passed ? 'PASS' : 'FAIL') + '</div>';
        } else {
          row.innerHTML += '<div class="heatmap-cell heatmap-na">—</div>';
        }
      });
      table.appendChild(row);
    });

    /* Summary row */
    const summaryRow = document.createElement('div');
    summaryRow.className = 'heatmap-row heatmap-summary-row';
    summaryRow.innerHTML = '<div class="heatmap-cell heatmap-header heatmap-app-label">Total</div>';
    rounds.forEach(r => {
      const t = roundTotals[r];
      summaryRow.innerHTML += '<div class="heatmap-cell">' + t.pass + 'P / ' + t.fail + 'F</div>';
    });
    table.appendChild(summaryRow);

    container.appendChild(table);
  }

  function renderDashboardCharts(results) {
    const container = el('dashboard-charts');
    container.innerHTML = '';

    const rounds = [...new Set(results.map(r => r.round_no))].sort((a, b) => a - b);
    if (rounds.length === 0) return;

    /* Pass rate per round */
    const passRateSection = document.createElement('div');
    passRateSection.className = 'chart-section';
    passRateSection.innerHTML = '<div class="chart-title">Pass Rate per Round</div>';
    const passChart = document.createElement('div');
    passChart.className = 'bar-chart';

    rounds.forEach(r => {
      const roundResults = results.filter(res => res.round_no === r);
      const passed = roundResults.filter(res => res.grades_passed && res.flow_completed).length;
      const rate = roundResults.length > 0 ? (passed / roundResults.length * 100) : 0;
      passChart.innerHTML +=
        '<div class="bar-row">' +
        '<span class="bar-label">Round ' + r + '</span>' +
        '<div class="bar-track"><div class="bar-fill green" style="width:' + rate + '%"></div></div>' +
        '<span class="bar-value">' + rate.toFixed(1) + '%</span>' +
        '</div>';
    });
    passRateSection.appendChild(passChart);
    container.appendChild(passRateSection);

    /* Assumption score per round */
    const assumeSection = document.createElement('div');
    assumeSection.className = 'chart-section';
    assumeSection.innerHTML = '<div class="chart-title">Avg Assumption Score per Round</div>';
    const assumeChart = document.createElement('div');
    assumeChart.className = 'bar-chart';

    let maxScore = 0;
    rounds.forEach(r => {
      const roundResults = results.filter(res => res.round_no === r && res.assumptions_score != null);
      const avg = roundResults.length > 0 ? roundResults.reduce((s, res) => s + (res.assumptions_score || 0), 0) / roundResults.length : 0;
      if (avg > maxScore) maxScore = avg;
    });
    if (maxScore === 0) maxScore = 1;

    rounds.forEach(r => {
      const roundResults = results.filter(res => res.round_no === r && res.assumptions_score != null);
      const avg = roundResults.length > 0 ? roundResults.reduce((s, res) => s + (res.assumptions_score || 0), 0) / roundResults.length : 0;
      const widthPct = (avg / maxScore) * 100;
      assumeChart.innerHTML +=
        '<div class="bar-row">' +
        '<span class="bar-label">Round ' + r + '</span>' +
        '<div class="bar-track"><div class="bar-fill blue" style="width:' + widthPct + '%"></div></div>' +
        '<span class="bar-value">' + avg.toFixed(2) + '</span>' +
        '</div>';
    });
    assumeSection.appendChild(assumeChart);
    container.appendChild(assumeSection);
  }

  /* ----------------------------------------------------------
     Comparison Page
  ---------------------------------------------------------- */
  function initComparison() {
    on('compare-btn', 'click', runComparison);
  }

  async function loadComparisonSessions() {
    const data = await api('/api/results/sessions');
    const selA = el('compare-base-select');
    const selB = el('compare-new-select');
    selA.innerHTML = '<option value="">Select session…</option>';
    selB.innerHTML = '<option value="">Select session…</option>';
    (data || []).forEach(s => {
      const txt = String(s.id).substring(0, 8) + ' — ' + formatDate(s.timestamp) + (s.das_env ? ' (' + s.das_env + ')' : '');
      const optA = document.createElement('option'); optA.value = s.id; optA.textContent = txt;
      const optB = document.createElement('option'); optB.value = s.id; optB.textContent = txt;
      selA.appendChild(optA);
      selB.appendChild(optB);
    });
  }

  async function runComparison() {
    const a = el('compare-base-select').value;
    const b = el('compare-new-select').value;
    if (!a || !b) { showToast('Please select two sessions', 'error'); return; }
    if (a === b) { showToast('Please select different sessions', 'error'); return; }

    const data = await api('/api/comparison?a=' + encodeURIComponent(a) + '&b=' + encodeURIComponent(b));
    renderComparisonTable(data);
  }

  function trendIcon(direction) {
    if (direction === 'up') {
      return '<svg class="trend-icon trend-up" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
    }
    if (direction === 'down') {
      return '<svg class="trend-icon trend-down" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>';
    }
    return '<svg class="trend-icon trend-flat" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  }

  function aggregateComparisonByApp(results) {
    const byApp = {};
    results.forEach(r => {
      const key = r.application_name || r.conversation_id;
      if (!byApp[key]) byApp[key] = { passCount: 0, total: 0, scores: [] };
      byApp[key].total++;
      if (r.grades_passed && r.flow_completed) byApp[key].passCount++;
      if (r.assumptions_score != null) byApp[key].scores.push(r.assumptions_score);
    });
    const out = {};
    Object.keys(byApp).forEach(key => {
      const b = byApp[key];
      out[key] = {
        passRate: b.total > 0 ? (b.passCount / b.total) * 100 : null,
        avgScore: b.scores.length ? b.scores.reduce((a, c) => a + c, 0) / b.scores.length : null,
        rounds: b.total
      };
    });
    return out;
  }

  function renderComparisonTable(data) {
    const summaryEl = el('compare-summary');
    const resultsEl = el('compare-results');
    const tbody = el('compare-tbody');
    tbody.innerHTML = '';

    const appsA = aggregateComparisonByApp(data.session_a || []);
    const appsB = aggregateComparisonByApp(data.session_b || []);
    const allApps = [...new Set([...Object.keys(appsA), ...Object.keys(appsB)])].sort();

    let improved = 0, regressed = 0, unchanged = 0;

    allApps.forEach(app => {
      const rA = appsA[app];
      const rB = appsB[app];
      const rateA = rA ? rA.passRate : null;
      const rateB = rB ? rB.passRate : null;

      let changeClass, icon, changeLabel;
      if (rateA == null || rateB == null) {
        changeClass = 'change-unchanged'; icon = 'flat'; changeLabel = 'N/A'; unchanged++;
      } else if (rateB > rateA) {
        changeClass = 'change-improved'; icon = 'up'; changeLabel = 'Improved'; improved++;
      } else if (rateB < rateA) {
        changeClass = 'change-regressed'; icon = 'down'; changeLabel = 'Regressed'; regressed++;
      } else {
        changeClass = 'change-unchanged'; icon = 'flat'; changeLabel = 'Same'; unchanged++;
      }

      const baseLabel = rateA != null ? pct(rateA) + (rA.rounds > 1 ? ' (' + rA.rounds + 'r)' : '') : '—';
      const compareLabel = rateB != null ? pct(rateB) + (rB.rounds > 1 ? ' (' + rB.rounds + 'r)' : '') : '—';

      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + escapeHtml(app) + '</td>' +
        '<td>' + baseLabel + '</td>' +
        '<td>' + compareLabel + '</td>' +
        '<td>' + (rA && rA.avgScore != null ? scoreDisplay(rA.avgScore) : '—') + '</td>' +
        '<td>' + (rB && rB.avgScore != null ? scoreDisplay(rB.avgScore) : '—') + '</td>' +
        '<td class="' + changeClass + '" style="display:flex;align-items:center;gap:6px">' + trendIcon(icon) + '<span>' + changeLabel + '</span></td>';
      tbody.appendChild(tr);
    });

    summaryEl.innerHTML =
      '<strong class="change-improved">' + improved + ' improved</strong>&nbsp;&bull;&nbsp;' +
      '<strong class="change-regressed">' + regressed + ' regressed</strong>&nbsp;&bull;&nbsp;' +
      '<strong class="change-unchanged">' + unchanged + ' unchanged</strong>';
    show(summaryEl);
    show(resultsEl);
  }

  /* ----------------------------------------------------------
     History Page
  ---------------------------------------------------------- */
  async function loadHistorySessions() {
    const mainTable = el('history-main-table');
    const detail = el('history-detail');
    if (mainTable && detail) {
      show(mainTable);
      hide(detail);
    }
    const data = await api('/api/results/sessions');
    renderHistoryTable(data || []);
  }

  function initHistory() {
    on('history-delete-all-btn', 'click', () => {
      openConfirmModal('Delete All Sessions', 'Are you sure you want to delete all sessions? This action cannot be undone.', async () => {
        const sessions = (await api('/api/results/sessions')) || [];
        for (const s of sessions) {
          try { await api('/api/results/delete/' + s.id, { method: 'DELETE' }); } catch { }
        }
        showToast('All sessions deleted', 'success');
        loadHistorySessions();
      });
    });
  }

  function renderHistoryTable(sessions) {
    const tbody = el('history-tbody');
    tbody.innerHTML = '';
    if (sessions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty"><div class="empty-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto; opacity: 0.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>No sessions found</td></tr>';
      return;
    }
    sessions.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="td-mono">' + escapeHtml(String(s.id).substring(0, 8)) + '</td>' +
        '<td>' + formatDate(s.timestamp) + '</td>' +
        '<td>' + sessionTypeBadgeHTML(s) + '</td>' +
        '<td>' + escapeHtml(s.das_env || '—') + '</td>' +
        '<td>' + (s.total_iterations || '—') + '</td>' +
        '<td>' + (s.unique_convs || '—') + '</td>' +
        '<td class="btn-group"></td>';
      const actions = tr.cells[6];
      const viewBtn = document.createElement('button');
      viewBtn.className = 'btn btn-xs btn-secondary';
      viewBtn.textContent = 'View';
      viewBtn.addEventListener('click', () => openHistorySessionDetail(s.id));

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn-xs btn-danger';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => {
        openConfirmModal('Delete Session', 'Delete session ' + String(s.id).substring(0, 8) + '?', async () => {
          await api('/api/results/delete/' + s.id, { method: 'DELETE' });
          showToast('Session deleted', 'success');
          loadHistorySessions();
        });
      });
      actions.appendChild(viewBtn);
      actions.appendChild(deleteBtn);
      tbody.appendChild(tr);
    });
  }

  async function openHistorySessionDetail(sessionId) {
    const data = await api('/api/results/' + sessionId);
    renderHistoryDetail(sessionId, data || []);
  }

  function renderHistoryDetail(sessionId, results) {
    const container = el('history-detail');
    const mainTable = el('history-main-table');
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'flex justify-between items-center mb-4';
    header.innerHTML = '<h3 style="font-size:15px;font-weight:700">Session ' + String(sessionId).substring(0, 8) + ' — Results</h3>' +
      '<button class="btn btn-sm btn-secondary" id="history-detail-back">' + ICON_ARROW_LEFT + 'Back</button>';
    container.appendChild(header);

    hide(mainTable);
    show(container);

    el('history-detail-back').addEventListener('click', () => {
      hide(container);
      show(mainTable);
    });

    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper';
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Application</th><th>Round</th><th>Grades</th><th>Assumptions</th><th>Actions</th></tr></thead>';
    const tbody = document.createElement('tbody');

    results.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + escapeHtml(r.application_name || '—') + '<div class="td-secondary">Conv #' + (r.conversation_no || '') + '</div></td>' +
        '<td>' + (r.round_no || '—') + '</td>' +
        '<td></td>' +
        '<td>' + scoreDisplay(r.assumptions_score) + '</td>' +
        '<td class="btn-group"></td>';
      tr.cells[2].appendChild(statusBadge(r.grades_passed));

      const actions = tr.cells[4];

      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-xs btn-secondary';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => toggleInlineEdit(tr, r));

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-xs btn-danger';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => {
        openConfirmModal('Delete Result', 'Delete this result?', async () => {
          await api('/api/results/delete-result/' + r.id, { method: 'DELETE' });
          showToast('Result deleted', 'success');
          openHistorySessionDetail(sessionId);
        });
      });

      const detailBtn = document.createElement('button');
      detailBtn.className = 'btn btn-xs btn-primary';
      detailBtn.textContent = 'Details';
      detailBtn.addEventListener('click', () => openResultDrillDown(r.id));

      actions.appendChild(detailBtn);
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrapper.appendChild(table);
    container.appendChild(wrapper);
  }

  function toggleInlineEdit(tr, result) {
    let editRow = tr.nextElementSibling;
    if (editRow && editRow.classList.contains('inline-edit-row')) {
      editRow.remove();
      return;
    }
    editRow = document.createElement('tr');
    editRow.className = 'inline-edit-row';
    const td = document.createElement('td');
    td.colSpan = 5;
    td.innerHTML =
      '<div class="inline-edit-form">' +
      '<div class="form-group"><label class="form-label">Grades Passed</label>' +
      '<label class="toggle"><input type="checkbox" class="edit-grade-check" ' + (result.grades_passed ? 'checked' : '') + '><span class="toggle-slider"></span></label></div>' +
      '<div class="form-group"><label class="form-label">Assumption Score</label>' +
      '<input type="number" step="0.01" class="form-input edit-assumption-input" value="' + (result.assumptions_score || '') + '"></div>' +
      '<button class="btn btn-sm btn-primary edit-save-btn">Save</button>' +
      '<button class="btn btn-sm btn-secondary edit-cancel-btn">Cancel</button>' +
      '</div>';
    editRow.appendChild(td);
    tr.after(editRow);

    td.querySelector('.edit-save-btn').addEventListener('click', async () => {
      const gp = td.querySelector('.edit-grade-check').checked;
      const as = parseFloat(td.querySelector('.edit-assumption-input').value);
      try {
        await api('/api/results/override', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ result_id: result.id, grades_passed: gp, assumptions_score: as }),
        });
        showToast('Updated', 'success');
        editRow.remove();
      } catch { }
    });

    td.querySelector('.edit-cancel-btn').addEventListener('click', () => {
      editRow.remove();
    });
  }

  /* ----------------------------------------------------------
     MLflow Traces Page
  ---------------------------------------------------------- */
  function initMLflow() {
    on('trace-fetch-btn', 'click', fetchMLflowTraces);
    on('trace-backfill-btn', 'click', backfillMLflowTiming);
  }

  async function fetchMLflowTraces() {
    const convId = el('trace-conv-id').value;
    if (!convId) { showToast('Please enter a conversation ID', 'error'); return; }

    el('trace-fetch-btn').disabled = true;
    el('trace-fetch-btn').innerHTML = '<span class="spinner" style="width:12px;height:12px;margin-right:6px;display:inline-block"></span>Fetching...';

    try {
      const env = el('global-environment').value || 'Local';
      const data = await api('/api/mlflow/traces/' + encodeURIComponent(convId) + '?env=' + encodeURIComponent(env));
      renderMLflowTraces(data);
    } catch { }

    el('trace-fetch-btn').disabled = false;
    el('trace-fetch-btn').textContent = 'Fetch Traces';
  }

  async function backfillMLflowTiming() {
    const convId = el('trace-conv-id').value;
    if (!convId) { showToast('Please enter a conversation ID', 'error'); return; }

    const btn = el('trace-backfill-btn');
    const statusEl = el('trace-backfill-status');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:12px;height:12px;margin-right:6px;display:inline-block"></span>Saving...';
    statusEl.textContent = '';

    try {
      const env = el('global-environment').value || 'Local';
      const data = await api('/api/mlflow/backfill/' + encodeURIComponent(convId) + '?env=' + encodeURIComponent(env), { method: 'POST' });
      statusEl.textContent = 'Saved timing for ' + (data.turnTraces || []).length + ' turn(s) — will appear in this result\'s report on next regenerate.';
      showToast('Turn timing saved to report', 'success');
      show(el('trace-turn-timing-area'));
      renderTurnTimingTable(data.turnTraces, el('trace-turn-timing-list'));
    } catch { }

    btn.disabled = false;
    btn.textContent = 'Save Timing to Report';
  }

  function renderMLflowTraces(data) {
    const container = el('trace-spans-list');
    const area = el('trace-results-area');
    const meta = el('trace-meta-info');
    container.innerHTML = '';
    meta.innerHTML = '';
    area.classList.remove('hidden');

    if (!(data && data.error) && data && data.traces && data.traces.length > 0) {
      meta.innerHTML = 'Experiment: <strong>' + escapeHtml(data.experiment_name || '—') + '</strong> &nbsp;&bull;&nbsp; Total Traces: <strong>' + (data.total_traces || data.traces.length) + '</strong>';
    }
    renderTraceSpans(data, container);
  }

  /* ----------------------------------------------------------
     Test Data Page
  ---------------------------------------------------------- */
  function coverageIconHTML(has) {
    return has
      ? '<span class="td-coverage-icon yes" title="Present">' + ICON_CHECK + '</span>'
      : '<span class="td-coverage-icon no" title="Missing">' + ICON_X + '</span>';
  }

  async function loadTestDataList() {
    let convs;
    try {
      convs = await api('/api/testdata/conversations');
    } catch { return; }
    renderTestDataTable(convs || []);
  }

  function renderTestDataTable(convs) {
    const tbody = el('testdata-tbody');
    tbody.innerHTML = '';
    if (convs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No test conversations found.</td></tr>';
      return;
    }
    convs.forEach(c => {
      const tr = document.createElement('tr');
      tr.className = 'clickable';
      enableRowKeyboardActivation(tr);
      tr.innerHTML =
        '<td class="td-mono">' + c.conversationNo + '</td>' +
        '<td>' + escapeHtml(c.application) + '</td>' +
        '<td>' + escapeHtml(c.industry || '—') + '</td>' +
        '<td>' + c.turnCount + '</td>' +
        '<td></td><td></td>' +
        '<td class="btn-group"></td>';
      tr.cells[4].innerHTML = coverageIconHTML(c.hasExpectedGrades);
      tr.cells[5].innerHTML = coverageIconHTML(c.hasExpectedCTQs);

      const viewBtn = document.createElement('button');
      viewBtn.className = 'btn btn-xs btn-secondary';
      viewBtn.textContent = 'View';
      viewBtn.addEventListener('click', (e) => { e.stopPropagation(); openTestDataView(c.conversationNo); });

      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-xs btn-secondary';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', (e) => { e.stopPropagation(); openTestDataForm(c.conversationNo); });

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-xs btn-danger';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openConfirmModal('Delete Conversation', 'Delete "' + c.application + '" and its ground truth entries? A backup is kept, but this removes it from active testing.', async () => {
          await api('/api/testdata/conversations/' + c.conversationNo, { method: 'DELETE' });
          showToast('Conversation deleted', 'success');
          loadTestDataList();
        });
      });

      tr.cells[6].appendChild(viewBtn);
      tr.cells[6].appendChild(editBtn);
      tr.cells[6].appendChild(delBtn);
      tr.addEventListener('click', () => openTestDataView(c.conversationNo));
      tbody.appendChild(tr);
    });
  }

  async function openTestDataView(convNo) {
    let data;
    try {
      data = await api('/api/testdata/conversations/' + convNo);
    } catch { return; }

    const panel = el('detail-panel');
    const body = el('detail-panel-body');
    el('detail-panel-title').textContent = data.application + ' (#' + convNo + ')';
    body.innerHTML = '';

    const overview = document.createElement('div');
    overview.className = 'detail-section';
    overview.innerHTML =
      '<div class="detail-grid">' +
      '<div class="detail-field"><span class="detail-field-label">Application</span><span class="detail-field-value">' + escapeHtml(data.application) + '</span></div>' +
      '<div class="detail-field"><span class="detail-field-label">Industry</span><span class="detail-field-value">' + escapeHtml(data.industry || '—') + '</span></div>' +
      '</div>';
    body.appendChild(overview);

    const actionsRow = document.createElement('div');
    actionsRow.className = 'mb-4';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-secondary btn-sm';
    editBtn.textContent = 'Edit';
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger btn-sm';
    deleteBtn.style.marginLeft = '8px';
    deleteBtn.textContent = 'Delete';
    actionsRow.appendChild(editBtn);
    actionsRow.appendChild(deleteBtn);
    body.appendChild(actionsRow);

    const turnsSection = document.createElement('div');
    turnsSection.className = 'detail-section';
    turnsSection.innerHTML = '<div class="detail-section-title">Conversation Turns</div>';
    const turnList = document.createElement('div');
    turnList.className = 'turn-list';
    (data.turns || []).forEach(t => {
      const isUser = t.role === 'user';
      const item = document.createElement('div');
      item.className = 'turn-item ' + (isUser ? 'user-turn' : 'agent-turn');
      const roleSpan = document.createElement('span');
      roleSpan.className = 'turn-role ' + (isUser ? 'user' : 'agent');
      roleSpan.textContent = isUser ? 'User' : 'Agent';
      const contentSpan = document.createElement('span');
      contentSpan.className = 'turn-content';
      contentSpan.textContent = t.content || '';
      item.appendChild(roleSpan);
      item.appendChild(contentSpan);
      turnList.appendChild(item);
    });
    turnsSection.appendChild(turnList);
    body.appendChild(turnsSection);

    function renderStringList(title, items) {
      const section = document.createElement('div');
      section.className = 'detail-section';
      const heading = document.createElement('div');
      heading.className = 'detail-section-title';
      heading.textContent = title;
      section.appendChild(heading);
      if (items && items.length) {
        const ul = document.createElement('ul');
        ul.className = 'td-list';
        items.forEach(x => {
          const li = document.createElement('li');
          li.textContent = x;
          ul.appendChild(li);
        });
        section.appendChild(ul);
      } else {
        const p = document.createElement('p');
        p.className = 'text-muted text-sm';
        p.textContent = 'None defined.';
        section.appendChild(p);
      }
      return section;
    }
    body.appendChild(renderStringList('Expected Grades', data.expectedGrades));
    body.appendChild(renderStringList('Expected CTQs', data.expectedCTQs));

    editBtn.addEventListener('click', () => openTestDataForm(convNo));
    deleteBtn.addEventListener('click', () => {
      openConfirmModal('Delete Conversation', 'Delete "' + data.application + '" and its ground truth entries? A backup is kept, but this removes it from active testing.', async () => {
        await api('/api/testdata/conversations/' + convNo, { method: 'DELETE' });
        showToast('Conversation deleted', 'success');
        closeDetailPanel();
        loadTestDataList();
      });
    });

    panel.classList.add('open');
    el('detail-overlay').classList.add('open');
  }

  function openTestDataForm(existingConvNo) {
    const isEdit = existingConvNo != null;

    function build(data) {
      const panel = el('detail-panel');
      const body = el('detail-panel-body');
      el('detail-panel-title').textContent = isEdit ? 'Edit Conversation #' + existingConvNo : 'Add Conversation';
      body.innerHTML = '';

      if (isEdit) {
        const warning = document.createElement('p');
        warning.className = 'text-muted text-sm mb-4';
        warning.style.color = 'var(--danger)';
        warning.textContent = 'Editing changes what future test runs are graded against. Past results for this conversation are unaffected.';
        body.appendChild(warning);
      }

      const basicsSection = document.createElement('div');
      basicsSection.className = 'detail-section';
      basicsSection.innerHTML =
        '<div class="form-group mb-4"><label class="form-label" style="display:block;margin-bottom:6px;">Application</label>' +
        '<input type="text" id="td-form-application" class="form-input" style="width:100%;" placeholder="e.g. Battery Cover"></div>' +
        '<div class="form-group mb-4"><label class="form-label" style="display:block;margin-bottom:6px;">Industry</label>' +
        '<input type="text" id="td-form-industry" class="form-input" style="width:100%;" placeholder="e.g. Electrical &amp; Electronics"></div>';
      body.appendChild(basicsSection);

      if (!isEdit) {
        const uploadSection = document.createElement('div');
        uploadSection.className = 'detail-section';
        uploadSection.innerHTML =
          '<div class="detail-section-title">Import Conversation</div>' +
          '<p class="text-muted text-sm mb-2">Upload a conversation JSON (same structure as files in <code>conversation/</code>) or a PDF chat export to fill in the turns below instead of adding them one by one.</p>' +
          '<div class="td-upload-row">' +
          '<label class="btn btn-secondary btn-sm td-upload-btn">' + ICON_UPLOAD + '<span>Upload JSON / PDF</span>' +
          '<input type="file" id="td-form-upload" accept=".json,.pdf" style="display:none;"></label>' +
          '<span id="td-upload-status" class="text-muted text-sm"></span>' +
          '</div>';
        body.appendChild(uploadSection);
      }

      const turnsSection = document.createElement('div');
      turnsSection.className = 'detail-section';
      turnsSection.innerHTML =
        '<div class="detail-section-title" style="display:flex;justify-content:space-between;align-items:center;">' +
        '<span>Conversation Turns</span><button type="button" id="td-form-add-turn" class="btn btn-xs btn-secondary">+ Add Turn</button></div>' +
        '<div id="td-form-turns"></div>';
      body.appendChild(turnsSection);

      const gradesSection = document.createElement('div');
      gradesSection.className = 'detail-section';
      gradesSection.innerHTML =
        '<label class="form-label" style="display:block;margin-bottom:6px;">Expected Grades (one per line)</label>' +
        '<textarea id="td-form-grades" class="form-input td-textarea" placeholder="Zytel 70G35EF"></textarea>';
      body.appendChild(gradesSection);

      const ctqSection = document.createElement('div');
      ctqSection.className = 'detail-section';
      ctqSection.innerHTML =
        '<label class="form-label" style="display:block;margin-bottom:6px;">Expected CTQs (one per line)</label>' +
        '<textarea id="td-form-ctqs" class="form-input td-textarea" placeholder="High impact resistance"></textarea>';
      body.appendChild(ctqSection);

      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn btn-primary';
      saveBtn.textContent = isEdit ? 'Save Changes' : 'Create Conversation';
      body.appendChild(saveBtn);

      el('td-form-application').value = data.application || '';
      el('td-form-industry').value = data.industry || '';
      el('td-form-grades').value = (data.expectedGrades || []).join('\n');
      el('td-form-ctqs').value = (data.expectedCTQs || []).join('\n');

      const turnsContainer = el('td-form-turns');
      function addTurnRow(role, content) {
        const row = document.createElement('div');
        row.className = 'td-turn-row';
        row.innerHTML =
          '<select class="td-turn-role form-input"><option value="assistant">Agent</option><option value="user">User</option></select>' +
          '<textarea class="td-turn-content" placeholder="Message content"></textarea>' +
          '<button type="button" class="td-turn-remove btn btn-xs btn-danger">Remove</button>';
        row.querySelector('.td-turn-role').value = role || 'assistant';
        row.querySelector('.td-turn-content').value = content || '';
        row.querySelector('.td-turn-remove').addEventListener('click', () => row.remove());
        turnsContainer.appendChild(row);
      }
      const initialTurns = (data.turns && data.turns.length) ? data.turns : [{ role: 'assistant', content: '' }, { role: 'user', content: '' }];
      initialTurns.forEach(t => addTurnRow(t.role, t.content));

      el('td-form-add-turn').addEventListener('click', () => {
        const rows = turnsContainer.querySelectorAll('.td-turn-row');
        const lastRole = rows.length ? rows[rows.length - 1].querySelector('.td-turn-role').value : 'user';
        addTurnRow(lastRole === 'user' ? 'assistant' : 'user', '');
      });

      const uploadInput = el('td-form-upload');
      if (uploadInput) {
        uploadInput.addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const statusEl = el('td-upload-status');
          statusEl.textContent = 'Parsing ' + file.name + '…';
          const formData = new FormData();
          formData.append('file', file);
          try {
            const parsed = await api('/api/testdata/parse-upload', { method: 'POST', body: formData });
            if (!el('td-form-application').value.trim() && parsed.application) {
              el('td-form-application').value = parsed.application;
            }
            if (!el('td-form-industry').value.trim() && parsed.industry) {
              el('td-form-industry').value = parsed.industry;
            }
            turnsContainer.innerHTML = '';
            (parsed.turns || []).forEach(t => addTurnRow(t.role, t.content));
            statusEl.textContent = 'Loaded ' + (parsed.turns || []).length + ' turns from ' + file.name;
            showToast('Parsed ' + (parsed.turns || []).length + ' turns from file', 'success');
          } catch {
            statusEl.textContent = '';
          } finally {
            e.target.value = '';
          }
        });
      }

      saveBtn.addEventListener('click', async () => {
        const turns = Array.from(turnsContainer.querySelectorAll('.td-turn-row')).map(row => ({
          role: row.querySelector('.td-turn-role').value,
          content: row.querySelector('.td-turn-content').value.trim(),
        })).filter(t => t.content);

        const payload = {
          application: el('td-form-application').value.trim(),
          industry: el('td-form-industry').value.trim(),
          turns: turns,
          expectedGrades: el('td-form-grades').value.split('\n').map(s => s.trim()).filter(Boolean),
          expectedCTQs: el('td-form-ctqs').value.split('\n').map(s => s.trim()).filter(Boolean),
        };

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        try {
          if (isEdit) {
            await api('/api/testdata/conversations/' + existingConvNo, {
              method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
            });
            showToast('Conversation updated', 'success');
          } else {
            await api('/api/testdata/conversations', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
            });
            showToast('Conversation created', 'success');
          }
          closeDetailPanel();
          loadTestDataList();
        } catch {
          saveBtn.disabled = false;
          saveBtn.textContent = isEdit ? 'Save Changes' : 'Create Conversation';
        }
      });

      panel.classList.add('open');
      el('detail-overlay').classList.add('open');
    }

    if (isEdit) {
      api('/api/testdata/conversations/' + existingConvNo).then(build).catch(() => { });
    } else {
      build({});
    }
  }

  function initTestData() {
    on('testdata-add-btn', 'click', () => openTestDataForm(null));
  }

  /* ----------------------------------------------------------
     Confirm Modal
  ---------------------------------------------------------- */
  let confirmCallback = null;

  function openConfirmModal(title, message, callback) {
    el('confirm-modal-title').textContent = title;
    el('confirm-modal-body').textContent = message;
    el('confirm-modal').classList.add('open');
    confirmCallback = callback;
  }

  function initModal() {
    on('confirm-modal-cancel', 'click', () => {
      el('confirm-modal').classList.remove('open');
      confirmCallback = null;
    });
    on('confirm-modal-confirm', 'click', async () => {
      el('confirm-modal').classList.remove('open');
      if (confirmCallback) {
        await confirmCallback();
        confirmCallback = null;
      }
    });
  }

  /* ----------------------------------------------------------
     Detail Panel Close
  ---------------------------------------------------------- */
  function initDetailPanel() {
    on('detail-panel-close', 'click', closeDetailPanel);
    on('detail-overlay', 'click', closeDetailPanel);
  }

  /* ----------------------------------------------------------
     Check Running State
  ---------------------------------------------------------- */
  async function checkRunningState() {
    try {
      const data = await api('/api/run/is-running');
      state.isRunning = data.running;
      if (state.isRunning) {
        const singleBtn = el('single-run-btn');
        if (singleBtn) {
          singleBtn.disabled = true;
          singleBtn.innerHTML = '<span class="spinner"></span> Running…';
        }
        
        if (data.snapshot && data.snapshot.mode === 'batch') {
          resumeBatchRun(data.snapshot);
        } else if (data.snapshot && data.snapshot.mode === 'single') {
          resumeSingleRun(data.snapshot);
        } else {
          // Fallback if no snapshot
          const batchBtn = el('batch-run-btn');
          if (batchBtn) {
            batchBtn.disabled = true;
            batchBtn.innerHTML = '<span class="spinner"></span> Running…';
          }
          const stopBtn = el('batch-stop-btn');
          if (stopBtn) show(stopBtn);
        }
      }
    } catch { }
  }

  /* ----------------------------------------------------------
     Sidebar Toggle
  ---------------------------------------------------------- */
  function initSidebarToggle() {
    const btn = el('sidebar-toggle');
    const sidebar = el('sidebar');
    const main = document.querySelector('.main-content');
    if (!btn || !sidebar || !main) return;
    
    // Load state from local storage
    if (localStorage.getItem('sidebar-collapsed') === 'true') {
      sidebar.classList.add('collapsed');
      main.classList.add('sidebar-collapsed');
    }
    
    btn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      main.classList.toggle('sidebar-collapsed');
      localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
    });
  }

  /* ----------------------------------------------------------
     Init
  ---------------------------------------------------------- */
  function initCopyChips() {
    document.addEventListener('click', (e) => {
      const chip = e.target.closest('.conv-id-chip');
      if (chip) copyToClipboard(chip.dataset.copy || chip.textContent);
    });
  }

  function init() {
    initNav();
    initSingleRun();
    initBatchRun();
    initDashboard();
    initComparison();
    initHistory();
    initMLflow();
    initModal();
    initDetailPanel();
    initSidebarToggle();
    initCopyChips();
    initEnvHealthCheck();
    initTestData();
    loadConfig();
    checkRunningState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
