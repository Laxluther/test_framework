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
    roundSummaries: [],
    sessions: [],
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

  function pct(n) {
    if (n == null || isNaN(n)) return '—';
    return (Math.round(n * 100) / 100).toFixed(1) + '%';
  }

  function scoreDisplay(n) {
    if (n == null || isNaN(n)) return '—';
    return (Math.round(n * 100) / 100).toString();
  }

  function el(id) { return document.getElementById(id); }

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
        const errBody = await res.text();
        throw new Error(errBody || res.statusText);
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
    setTimeout(() => { t.remove(); }, 4000);
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
      'traces': 'MLflow Traces'
    };
    const breadcrumb = el('breadcrumb-page');
    if (breadcrumb && pageNames[page]) {
      breadcrumb.textContent = pageNames[page];
    }

    if (page === 'results') loadResultsSessions();
    if (page === 'dashboard') loadDashboardSessions();
    if (page === 'comparison') loadComparisonSessions();
    if (page === 'history') loadHistorySessions();
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
      updateSidebarStatus(true);
    } catch {
      updateSidebarStatus(false);
    }
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

  function updateSidebarStatus(online) {
    const dot = el('sidebar-status-dot');
    const val = el('sidebar-status-text');
    if (dot) dot.className = 'status-dot' + (online ? '' : ' offline');
    if (val) val.textContent = online ? 'Connected' : 'Offline';
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
      console.warn('SSE connection error');
    };
    return es;
  }

  /* ----------------------------------------------------------
     Single Run
  ---------------------------------------------------------- */
  function initSingleRun() {
    on('single-run-btn', 'click', startSingleRun);
    on('single-stop-btn', 'click', async () => {
      try { 
        const btn = el('single-stop-btn');
        if (btn) {
          btn.disabled = true;
          btn.innerHTML = '<span class="spinner"></span> Stopping...';
        }
        await api('/api/run/stop', { method: 'POST' }); 
        showToast('Stop requested', 'success'); 
      } catch { }
    });
  }

  async function startSingleRun() {
    const conv = el('single-conversation').value;
    const env = el('global-environment').value;
    const rounds = parseInt(el('single-rounds').value) || 1;

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
      return;
    }

    connectSSE({
      round_start(d) {
        addLog(logArea, 'system', 'Round ' + d.round + '/' + d.total_rounds + ' started');
      },
      file_start(d) {
        addLog(logArea, 'info', 'Processing: ' + d.conv_file + ' (' + d.index + '/' + d.total + ')');
      },
      turn_start(d) {
        addLog(logArea, 'user', '[Turn ' + d.turn + '] ' + d.user_input);
      },
      agent_reply(d) {
        addLog(logArea, 'agent', '[Turn ' + d.turn + '] ' + d.agent_msg);
      },
      evaluating(d) {
        addLog(logArea, 'info', 'Evaluating conversation #' + d.conv_no + '…');
      },
      completed(d) {
        const s = d.success ? '✓ PASS' : '✗ FAIL';
        addLog(logArea, d.success ? 'system' : 'error', s + ' — ' + (d.application || d.conv_no));
        if (d.error) addLog(logArea, 'error', d.error);
        showSingleResult(d);
      },
      run_complete(d) {
        addLog(logArea, 'system', 'Run complete. Output: ' + (d.output_dir || ''));
        finishSingleRun();
      },
      error(d) {
        addLog(logArea, 'error', d.message);
        finishSingleRun();
      },
      cancelled(d) {
        addLog(logArea, 'system', 'Cancelled. Completed ' + d.completed + '/' + d.total);
        finishSingleRun();
      },
    });
  }

  function addLog(container, type, text) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const labelClass = { user: 'user', agent: 'agent', system: 'system', error: 'error', info: 'info' }[type] || 'info';
    entry.innerHTML =
      '<span class="log-timestamp">' + nowTimestamp() + '</span>' +
      '<span class="log-label ' + labelClass + '">' + type.toUpperCase() + '</span>' +
      '<span class="log-message">' + escapeHtml(text) + '</span>';
    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
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
    if (d.grades_passed !== undefined) {
      stats.innerHTML += '<div class="stat-item"><span class="stat-label">Grades</span><span class="stat-value ' + (d.grades_passed ? 'pass' : 'fail') + '">' + (d.grades_passed ? 'Passed' : 'Failed') + '</span></div>';
    }
    if (d.assumptions_score !== undefined) {
      stats.innerHTML += '<div class="stat-item"><span class="stat-label">Assumption Score</span><span class="stat-value">' + scoreDisplay(d.assumptions_score) + '</span></div>';
    }
    if (d.flow_completed !== undefined) {
      stats.innerHTML += '<div class="stat-item"><span class="stat-label">Flow</span><span class="stat-value ' + (d.flow_completed ? 'pass' : 'fail') + '">' + (d.flow_completed ? 'Completed' : 'Incomplete') + '</span></div>';
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
  function initBatchRun() {
    on('batch-run-btn', 'click', startBatchRun);
    on('batch-stop-btn', 'click', stopBatchRun);
  }

  function getBatchHandlers(ctx) {
    return {
      round_start(d) {
        state.batchRound = d.round;
        state.batchTotalRounds = d.total_rounds;
        state.batchCompleted = 0;
        ctx.roundResults = [];
        updateBatchProgressText();
        
        const grid = el('batch-live-grid');
        grid.querySelectorAll('.batch-round-content').forEach(el => el.style.display = 'none');
        
        const roundDiv = document.createElement('div');
        roundDiv.className = 'batch-round-group';
        roundDiv.dataset.round = d.round;
        roundDiv.innerHTML = 
          '<div class="batch-round-header" style="cursor:pointer; padding:8px 12px; background:var(--bg-secondary); border-radius:6px; margin-bottom:12px; font-weight:600; border:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;" onclick="const content = this.nextElementSibling; content.style.display = content.style.display === \'none\' ? \'grid\' : \'none\'">' +
          '<span>Round ' + d.round + '</span><span style="font-size:11px; font-weight:normal; color:var(--text-secondary)">(Click to toggle)</span></div>' +
          '<div class="live-grid batch-round-content" style="display:grid; margin-bottom: 24px;"></div>';
        
        grid.appendChild(roundDiv);
      },
      file_start(d) {
        state.batchTotal = d.total;
        const gridId = d.conv_no !== undefined ? d.conv_no : d.conv_file;
        addOrUpdateGridItem(gridId, d.conv_file, 'running', '');
        updateBatchProgressText();
      },
      turn_start(d) {
        addBatchGridLog(d.conv_no, 'user', '[Turn ' + d.turn + '] ' + d.user_input);
      },
      agent_reply(d) {
        addBatchGridLog(d.conv_no, 'agent', '[Turn ' + d.turn + '] ' + d.agent_msg);
      },
      evaluating(d) {
        addOrUpdateGridItem(d.conv_no, null, 'running', 'Evaluating…');
      },
      completed(d) {
        state.batchCompleted++;
        const status = d.success ? 'pass' : 'fail';
        addOrUpdateGridItem(d.conv_no, d.application || d.conv_no, status, '');
        ctx.roundResults.push(d);
        updateBatchProgressText();
        updateBatchProgressBar();
      },
      run_complete(d) {
        if (ctx.roundResults.length > 0) addRoundSummary(state.batchRound, ctx.roundResults);
        showToast('Batch run complete', 'success');
        finishBatchRun();
      },
      error(d) {
        showToast(d.message, 'error');
        finishBatchRun();
      },
      cancelled(d) {
        showToast('Cancelled. Completed ' + d.completed + '/' + d.total, 'error');
        if (ctx.roundResults.length > 0) addRoundSummary(d.round || state.batchRound, ctx.roundResults);
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
    
    state.batchGrid = [];
    state.batchRound = 0;
    state.batchTotalRounds = snap.total_rounds || 1;
    state.batchCompleted = 0;
    state.batchTotal = snap.total || 0;
    state.roundSummaries = [];
    
    el('batch-live-grid').innerHTML = '';
    el('batch-round-summaries').innerHTML = '';
    updateBatchProgress(0, 0, 0, 0);
    
    const ctx = { roundResults: [] };
    const handlers = getBatchHandlers(ctx);
    
    snap.completedRounds.forEach(r => {
       handlers.round_start({ round: r.round, total_rounds: snap.total_rounds });
       r.results.forEach(res => {
         handlers.file_start({ total: snap.total, conv_no: res.conv_no, conv_file: res.conv_file });
         handlers.completed(res);
       });
       addRoundSummary(r.round, r.results);
       ctx.roundResults = [];
    });
    
    if (snap.round) {
       handlers.round_start({ round: snap.round, total_rounds: snap.total_rounds });
       Object.keys(snap.items).forEach(id => {
          const item = snap.items[id];
          handlers.file_start({ total: snap.total, conv_no: id, conv_file: item.conv_file });
          item.logs.forEach(l => {
             addBatchGridLog(id, l.type, l.text);
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

    el('batch-run-btn').disabled = true;
    el('batch-run-btn').innerHTML = '<span class="spinner"></span> Running…';
    show(el('batch-stop-btn'));
    show(el('batch-progress-area'));

    state.isRunning = true;
    state.batchGrid = [];
    state.batchRound = 0;
    state.batchTotalRounds = rounds;
    state.batchCompleted = 0;
    state.batchTotal = 0;
    state.roundSummaries = [];

    el('batch-live-grid').innerHTML = '';
    el('batch-round-summaries').innerHTML = '';
    updateBatchProgress(0, 0, 0, 0);

    try {
      await api('/api/run/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rounds: rounds, environment: env }),
      });
    } catch {
      finishBatchRun();
      return;
    }

    const ctx = { roundResults: [] };
    connectSSE(getBatchHandlers(ctx));
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

  function addBatchGridLog(id, type, text) {
    const grid = el('batch-live-grid');
    const roundContent = grid.querySelector('.batch-round-group:last-child .batch-round-content') || grid;
    const item = roundContent.querySelector('[data-grid-id="' + id + '"]');
    if (!item) return;
    const logArea = item.querySelector('.live-grid-item-log');
    if (!logArea) return;
    const entry = document.createElement('div');
    entry.style.marginBottom = '4px';
    const color = type === 'user' ? 'var(--primary-light)' : 'var(--success)';
    entry.innerHTML = '<span style="color:' + color + '; font-weight:bold;">' + type.toUpperCase() + ':</span> <span style="color:var(--text-secondary)">' + escapeHtml(text) + '</span>';
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

  function addRoundSummary(round, results) {
    const container = el('batch-round-summaries');
    const passed = results.filter(r => r.success).length;
    const failed = results.length - passed;
    const div = document.createElement('div');
    div.className = 'round-summary';
    div.innerHTML =
      '<div class="round-summary-header">Round ' + round + ' Summary</div>' +
      '<div class="round-summary-stats">' +
      '<span>Total: <strong>' + results.length + '</strong></span>' +
      '<span>Passed: <strong style="color:#16a34a">' + passed + '</strong></span>' +
      '<span>Failed: <strong style="color:#dc2626">' + failed + '</strong></span>' +
      '<span>Pass Rate: <strong>' + (results.length > 0 ? (passed / results.length * 100).toFixed(1) : 0) + '%</strong></span>' +
      '</div>';
    container.prepend(div);
    state.roundSummaries.push({ round, passed, failed, total: results.length });
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
  }

  /* ----------------------------------------------------------
     Results Page
  ---------------------------------------------------------- */
  async function loadResultsSessions() {
    const data = await api('/api/results/sessions');
    state.sessions = data || [];
    renderResultsTables(data || []);
  }

  function renderResultsTables(sessions) {
    const batchSessions = sessions.filter(s => s.unique_convs > 1);
    const singleSessions = sessions.filter(s => s.unique_convs === 1);
    renderBatchResultsTable(batchSessions);
    renderSingleResultsTable(singleSessions);
  }

  function renderBatchResultsTable(sessions) {
    const tbody = el('results-batch-tbody');
    tbody.innerHTML = '';
    if (sessions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty"><div class="empty-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto; opacity: 0.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></div>No batch runs yet</td></tr>';
      return;
    }
    sessions.forEach(s => {
      const tr = document.createElement('tr');
      tr.className = 'clickable';
      tr.innerHTML =
        '<td class="td-mono">' + escapeHtml(String(s.id).substring(0, 8)) + '</td>' +
        '<td>' + formatDate(s.timestamp) + '</td>' +
        '<td>' + escapeHtml(s.das_env || '—') + '</td>' +
        '<td>' + (s.total_iterations || '—') + '</td>' +
        '<td>' + pct(s.grade_accuracy_avg) + '</td>' +
        '<td>' + scoreDisplay(s.assumption_score_avg) + '</td>';
      tr.addEventListener('click', () => openSessionDetail(s.id));
      tbody.appendChild(tr);
    });
  }

  function renderSingleResultsTable(sessions) {
    const tbody = el('results-single-tbody');
    tbody.innerHTML = '';
    if (sessions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-empty"><div class="empty-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto; opacity: 0.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></div>No single runs yet</td></tr>';
      return;
    }
    sessions.forEach(s => {
      const tr = document.createElement('tr');
      tr.className = 'clickable';
      const passedAll = s.single_grade_passed && s.single_flow_completed;
      tr.innerHTML =
        '<td class="td-mono">' + escapeHtml(String(s.id).substring(0, 8)) + '</td>' +
        '<td>' + formatDate(s.timestamp) + '</td>' +
        '<td>' + escapeHtml(s.single_app_name || '—') + '</td>' +
        '<td>' + escapeHtml(s.das_env || '—') + '</td>' +
        '<td></td>';
      const statusCell = tr.cells[4];
      statusCell.appendChild(statusBadge(passedAll));
      tr.addEventListener('click', () => openSessionDetail(s.id));
      tbody.appendChild(tr);
    });
  }

  async function openSessionDetail(sessionId) {
    const data = await api('/api/results/' + sessionId);
    renderSessionDetailPanel(sessionId, data || []);
  }

  function renderSessionDetailPanel(sessionId, results) {
    const panel = el('detail-panel');
    const overlay = el('detail-overlay');
    const body = el('detail-panel-body');

    el('detail-panel-title').textContent = 'Session ' + String(sessionId).substring(0, 8);
    body.innerHTML = '';

    if (results.length === 0) {
      body.innerHTML = '<p class="text-muted" style="padding:20px">No results found.</p>';
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

      const wrapper = document.createElement('div');
      wrapper.className = 'table-wrapper';
      const table = document.createElement('table');
      table.innerHTML =
        '<thead><tr>' +
        '<th>Application</th><th>Round</th><th>Grades</th><th>Assumptions</th><th>Flow</th><th>Actions</th>' +
        '</tr></thead>';
      const tbody = document.createElement('tbody');
      results.forEach(r => {
        const tr = document.createElement('tr');
        tr.className = 'clickable';
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
          openResultDrillDown(r.id);
        });
        tr.addEventListener('click', () => openResultDrillDown(r.id));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrapper.appendChild(table);
      body.appendChild(wrapper);
    }

    panel.classList.add('open');
    overlay.classList.add('open');
  }

  async function openResultDrillDown(resultId) {
    let data;
    try {
      data = await api('/api/results/detail/' + resultId);
    } catch { return; }
    renderDrillDownPanel(data);
  }

  function renderDrillDownPanel(data) {
    const panel = el('detail-panel');
    const body = el('detail-panel-body');
    el('detail-panel-title').textContent = data.application_name || 'Result Detail';

    body.innerHTML = '';

    /* Overview Section */
    const overview = document.createElement('div');
    overview.className = 'detail-section';
    overview.innerHTML = '<div class="detail-section-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Overview</div>';
    const grid = document.createElement('div');
    grid.className = 'detail-grid';
    const fields = [
      ['Application', data.application_name || '—'],
      ['Conversation', '#' + (data.conversation_no || data.conversation_id || '')],
      ['Round', data.round_no || '—'],
      ['Timestamp', formatDate(data.timestamp)],
      ['Environment', data.das_env || data.environment || '—'],
      ['Error', data.error_message || 'None'],
    ];
    fields.forEach(([label, val]) => {
      grid.innerHTML += '<div class="detail-field"><span class="detail-field-label">' + label + '</span><span class="detail-field-value">' + escapeHtml(String(val)) + '</span></div>';
    });
    overview.appendChild(grid);
    body.appendChild(overview);

    /* Grades Section */
    const gradeSection = document.createElement('div');
    gradeSection.className = 'detail-section';
    gradeSection.innerHTML = '<div class="detail-section-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Grade Evaluation</div>';
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
    assumeSection.innerHTML = '<div class="detail-section-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>Assumption Evaluation</div>';
    const assumeInfo = document.createElement('div');
    assumeInfo.style.marginBottom = '12px';
    assumeInfo.innerHTML =
      '<div class="detail-field"><span class="detail-field-label">Score</span><span class="detail-field-value" style="font-size:18px;font-weight:700">' + scoreDisplay(data.assumptions_score) + '</span></div>';
    assumeSection.appendChild(assumeInfo);

    if (data.assumption_eval_details) {
      const aDetails = typeof data.assumption_eval_details === 'string' ? safeJSON(data.assumption_eval_details) : data.assumption_eval_details;
      if (aDetails) {
        const aItems = Array.isArray(aDetails) ? aDetails : [aDetails];
        aItems.forEach(item => {
          const aDiv = document.createElement('div');
          aDiv.className = 'eval-item';
          const matched = item.matched || item.status === 'matched';
          aDiv.innerHTML =
            '<div class="eval-item-header"><span class="eval-item-title">' + escapeHtml(item.ctq || item.name || 'CTQ') + '</span>' +
            (matched !== undefined ? '<span>' + (matched ? '✓ Matched' : '✗ Unmatched') + '</span>' : '') +
            '</div>' +
            '<div class="eval-item-body">' +
            (item.reasoning ? escapeHtml(item.reasoning) : '') +
            (item.details ? escapeHtml(item.details) : '') +
            '</div>';
          assumeSection.appendChild(aDiv);
        });
      }
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
        turns.forEach(t => {
          const role = (t.role || t.speaker || '').toLowerCase();
          const isUser = role === 'user' || role === 'human';
          const item = document.createElement('div');
          item.className = 'turn-item ' + (isUser ? 'user-turn' : 'agent-turn');
          item.innerHTML =
            '<span class="turn-role ' + (isUser ? 'user' : 'agent') + '">' + (isUser ? 'User' : 'Agent') + '</span>' +
            '<span class="turn-content">' + escapeHtml(t.content || t.message || t.text || '') + '</span>';
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
      '<button class="btn btn-primary btn-sm" id="override-save-btn">Save Override</button>';
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

    const jsonBtn = el('drill-raw-json-btn');
    if (jsonBtn) {
      jsonBtn.addEventListener('click', () => {
        const turns = typeof data.actual_turns_json === 'string' ? safeJSON(data.actual_turns_json) : data.actual_turns_json;
        turnList.innerHTML = '<pre style="background:var(--bg-app); padding:10px; border-radius:4px; font-size:12px; overflow-x:auto;">' + escapeHtml(JSON.stringify(turns, null, 2)) + '</pre>';
        jsonBtn.style.display = 'none';
      });
    }

    /* MLflow Section */
    const traceSection = document.createElement('div');
    traceSection.className = 'detail-section mt-4';
    traceSection.innerHTML = '<div class="detail-section-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>MLflow Traces</div>' +
      '<p class="text-muted text-sm mb-2">Fetch execution traces from MLflow (Agents, Time taken, Latencies).</p>' +
      '<button id="drill-mlflow-btn" class="btn btn-secondary btn-xs mb-2">Fetch Traces</button>' +
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
            el('drill-mlflow-results').innerHTML = '';
            if(!tr || tr.length === 0) {
              el('drill-mlflow-results').innerHTML = '<p class="text-muted">No traces found in MLflow for this conversation.</p>';
            } else {
              renderTraceSpans(tr, el('drill-mlflow-results'));
            }
          } catch (e) {
            el('drill-mlflow-results').innerHTML = '<p class="text-muted" style="color:var(--danger)">Failed to fetch traces.</p>';
          }
          fetchBtn.style.display = 'none';
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
  function renderTraceSpans(data, container) {
    if (!data || (!data.traces && !Array.isArray(data))) {
      container.innerHTML = '<p class="text-muted">No trace data available.</p>';
      return;
    }
    const traces = data.traces || (Array.isArray(data) ? data : [data]);
    if (traces.length === 0) {
      container.innerHTML = '<p class="text-muted">No traces found.</p>';
      return;
    }
    let maxDuration = 0;
    traces.forEach(t => {
      if (t.total_duration_ms > maxDuration) maxDuration = t.total_duration_ms;
      if (t.spans) t.spans.forEach(s => { if (s.duration_ms > maxDuration) maxDuration = s.duration_ms; });
    });
    if (maxDuration === 0) maxDuration = 1;

    traces.forEach(trace => {
      const card = document.createElement('div');
      card.className = 'trace-card';
      const header = document.createElement('div');
      header.className = 'trace-header';
      header.innerHTML =
        '<div class="trace-header-left">' +
        '<span class="trace-expand-icon">▶</span>' +
        '<span class="trace-id">' + escapeHtml(String(trace.trace_id || '').substring(0, 12)) + '</span>' +
        '</div>' +
        '<div class="trace-header-right">' +
        '<span>' + (trace.total_duration_ms || 0) + 'ms</span>' +
        '</div>';
      const sBadge = (trace.status === 'OK' || trace.status === 'ok')
        ? createBadge('pass', trace.status)
        : createBadge('fail', trace.status || 'ERROR');
      header.querySelector('.trace-header-right').prepend(sBadge);

      const body = document.createElement('div');
      body.className = 'trace-body';
      if (trace.spans && trace.spans.length > 0) {
        trace.spans.forEach(span => {
          const spanEl = document.createElement('div');
          spanEl.className = 'span-item';
          const pctWidth = maxDuration > 0 ? (span.duration_ms / maxDuration * 100) : 0;
          const barClass = (span.status === 'OK' || span.status === 'ok' || !span.status) ? 'ok' : 'error';
          spanEl.innerHTML =
            '<span class="span-name" title="' + escapeHtml(span.name) + '">' + escapeHtml(span.name) + '</span>' +
            '<div class="span-duration-bar"><div class="duration-bar-container">' +
            '<div class="duration-bar-track"><div class="duration-bar-fill ' + barClass + '" style="width:' + pctWidth + '%"></div></div>' +
            '<span class="duration-value">' + (span.duration_ms || 0) + 'ms</span>' +
            '</div></div>';
          body.appendChild(spanEl);
        });
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

  function closeDetailPanel() {
    el('detail-panel').classList.remove('open');
    el('detail-overlay').classList.remove('open');
  }

  /* ----------------------------------------------------------
     Dashboard Page
  ---------------------------------------------------------- */
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
  }

  async function loadDashboardData() {
    const sessionId = el('dashboard-session-select').value;
    if (!sessionId) return;
    const results = await api('/api/results/' + sessionId);
    const safeResults = results || [];
    
    const uniqueConvs = new Set(safeResults.map(r => r.conversation_no || r.conversation_id)).size;
    const passed = safeResults.filter(r => r.grades_passed).length;
    const accuracy = safeResults.length > 0 ? ((passed / safeResults.length) * 100).toFixed(1) + '%' : '0%';
    
    const validAssumptions = safeResults.filter(r => r.assumptions_score !== null && r.assumptions_score !== undefined);
    const avgAssumption = validAssumptions.length > 0 ? (validAssumptions.reduce((a, b) => a + b.assumptions_score, 0) / validAssumptions.length).toFixed(1) : '0';
    
    const elTotal = el('dash-stat-total');
    if (elTotal) elTotal.textContent = uniqueConvs;
    const elAcc = el('dash-stat-accuracy');
    if (elAcc) elAcc.textContent = accuracy;
    const elAss = el('dash-stat-assumption');
    if (elAss) elAss.textContent = avgAssumption;

    renderHeatmap(safeResults);
    renderDashboardCharts(safeResults);
    show(el('dashboard-content'));
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
    summaryRow.innerHTML = '<div class="heatmap-cell heatmap-header">Total</div>';
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
  async function loadComparisonSessions() {
    const data = await api('/api/results/sessions');
    ['comparison-session-a', 'comparison-session-b'].forEach(id => {
      const sel = el(id);
      sel.innerHTML = '<option value="">Select session…</option>';
      (data || []).forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = String(s.id).substring(0, 8) + ' — ' + formatDate(s.timestamp);
        sel.appendChild(opt);
      });
    });
  }

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

  function renderComparisonTable(data) {
    const container = el('comparison-results');
    container.innerHTML = '';

    const sessionA = data.session_a || [];
    const sessionB = data.session_b || [];

    const appsA = {};
    sessionA.forEach(r => { appsA[r.application_name || r.conversation_id] = r; });
    const appsB = {};
    sessionB.forEach(r => { appsB[r.application_name || r.conversation_id] = r; });
    const allApps = [...new Set([...Object.keys(appsA), ...Object.keys(appsB)])].sort();

    let improved = 0, regressed = 0, unchanged = 0;

    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper';
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Application</th><th>Base</th><th>Compare</th><th>Change</th></tr></thead>';
    const tbody = document.createElement('tbody');

    allApps.forEach(app => {
      const rA = appsA[app];
      const rB = appsB[app];
      const passA = rA ? (rA.grades_passed && rA.flow_completed) : null;
      const passB = rB ? (rB.grades_passed && rB.flow_completed) : null;

      let changeText, changeClass;
      if (passA === passB || (passA == null && passB == null)) {
        changeText = '= Same';
        changeClass = 'change-unchanged';
        unchanged++;
      } else if (!passA && passB) {
        changeText = '↑ Improved';
        changeClass = 'change-improved';
        improved++;
      } else if (passA && !passB) {
        changeText = '↓ Regressed';
        changeClass = 'change-regressed';
        regressed++;
      } else {
        changeText = '= Same';
        changeClass = 'change-unchanged';
        unchanged++;
      }

      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + escapeHtml(app) + '</td><td></td><td></td><td class="' + changeClass + '">' + changeText + '</td>';
      if (passA !== null) tr.cells[1].appendChild(statusBadge(passA));
      else tr.cells[1].textContent = '—';
      if (passB !== null) tr.cells[2].appendChild(statusBadge(passB));
      else tr.cells[2].textContent = '—';
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrapper.appendChild(table);
    container.appendChild(wrapper);

    const summary = document.createElement('div');
    summary.style.cssText = 'margin-top:16px;font-size:13px;color:#6b7280';
    summary.innerHTML =
      '<strong class="change-improved">' + improved + ' improved</strong>, ' +
      '<strong class="change-regressed">' + regressed + ' regressed</strong>, ' +
      '<strong class="change-unchanged">' + unchanged + ' unchanged</strong>';
    container.appendChild(summary);
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
        const sessions = state.sessions.length > 0 ? state.sessions : (await api('/api/results/sessions')) || [];
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
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty"><div class="empty-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto; opacity: 0.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>No sessions found</td></tr>';
      return;
    }
    sessions.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="td-mono">' + escapeHtml(String(s.id).substring(0, 8)) + '</td>' +
        '<td>' + formatDate(s.timestamp) + '</td>' +
        '<td>' + escapeHtml(s.das_env || '—') + '</td>' +
        '<td>' + (s.total_iterations || '—') + '</td>' +
        '<td>' + (s.unique_convs || '—') + '</td>' +
        '<td class="btn-group"></td>';
      const actions = tr.cells[5];
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
      '<button class="btn btn-sm btn-secondary" id="history-detail-back">← Back</button>';
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

  function renderMLflowTraces(data) {
    const container = el('trace-spans-list');
    const area = el('trace-results-area');
    const meta = el('trace-meta-info');
    container.innerHTML = '';
    meta.innerHTML = '';
    area.classList.remove('hidden');

    if (!data || !data.traces || data.traces.length === 0) {
      container.innerHTML = '<p class="text-muted" style="padding:20px">No traces found.</p>';
      return;
    }

    meta.innerHTML = 'Experiment: <strong>' + escapeHtml(data.experiment_name || '—') + '</strong> &nbsp;&bull;&nbsp; Total Traces: <strong>' + (data.total_traces || data.traces.length) + '</strong>';



    let maxDuration = 0;
    data.traces.forEach(t => {
      if (t.total_duration_ms > maxDuration) maxDuration = t.total_duration_ms;
      if (t.spans) {
        t.spans.forEach(s => {
          if (s.duration_ms > maxDuration) maxDuration = s.duration_ms;
        });
      }
    });
    if (maxDuration === 0) maxDuration = 1;

    data.traces.forEach(trace => {
      const card = document.createElement('div');
      card.className = 'trace-card';

      const header = document.createElement('div');
      header.className = 'trace-header';
      header.innerHTML =
        '<div class="trace-header-left">' +
        '<span class="trace-expand-icon">▶</span>' +
        '<span class="trace-id">' + escapeHtml(String(trace.trace_id || '').substring(0, 12)) + '</span>' +
        '</div>' +
        '<div class="trace-header-right">' +
        '<span>' + (trace.total_duration_ms || 0) + 'ms</span>' +
        '</div>';

      const statusBadgeEl = trace.status === 'OK' || trace.status === 'ok'
        ? createBadge('pass', trace.status)
        : createBadge('fail', trace.status || 'ERROR');
      header.querySelector('.trace-header-right').prepend(statusBadgeEl);

      const body = document.createElement('div');
      body.className = 'trace-body';

      if (trace.spans && trace.spans.length > 0) {
        trace.spans.forEach(span => {
          const spanEl = document.createElement('div');
          spanEl.className = 'span-item';
          const pctWidth = maxDuration > 0 ? (span.duration_ms / maxDuration * 100) : 0;
          const barClass = (span.status === 'OK' || span.status === 'ok' || !span.status) ? 'ok' : 'error';
          spanEl.innerHTML =
            '<span class="span-name" title="' + escapeHtml(span.name) + '">' + escapeHtml(span.name) + '</span>' +
            '<div class="span-duration-bar"><div class="duration-bar-container">' +
            '<div class="duration-bar-track"><div class="duration-bar-fill ' + barClass + '" style="width:' + pctWidth + '%"></div></div>' +
            '<span class="duration-value">' + (span.duration_ms || 0) + 'ms</span>' +
            '</div></div>';

          if (span.status && span.status !== 'OK' && span.status !== 'ok') {
            const sBadge = createBadge('fail', span.status);
            sBadge.style.marginLeft = '8px';
            spanEl.appendChild(sBadge);
          }
          body.appendChild(spanEl);
        });
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
          // If single run, just show the spinner. 
          // Rebuilding single-log is not implemented yet.
          const stopBtn = el('single-stop-btn');
          if (stopBtn) show(stopBtn);
          // connectSSE({}) ... can be omitted for single runs as UI isn't fully robust.
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
    loadConfig();
    checkRunningState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
