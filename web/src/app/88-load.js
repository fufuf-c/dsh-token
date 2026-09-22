  function loadTab(tab) {
    if (tab === 'today') {
      var tf = fParams('today');
      return Promise.all([
        get('/kpi', tf).then(function (k) { state.today = k; }),
        get('/hours', tf).then(function (b) { state.hoursToday = b; }),
        get('/sessions', Object.assign({ sort: 'recent', limit: 4 }, tf)).then(function (l) { state.sessToday = l; })
      ]).then(function () { renderToday(); }).catch(function (e) { toast('加载失败:' + e.message); });
    }
    if (tab === 'activity') {
      var f = fParams();
      return Promise.all([
        get('/kpi', f).then(function (k) { state.kpiAct = k; }),
        get('/series', Object.assign({ granularity: state.granularity }, f)).then(function (s) { state._series = s; }),
        get('/hours', f).then(function (b) { state._hours = b; }),
        get('/heatmap', Object.assign({ months: 12 }, f)).then(function (d) { state._heat = d; }),
        get('/sessions', Object.assign({ sort: 'cost', limit: 6 }, f)).then(function (l) { state.costTop = l; })
      ]).then(function () { renderActivity(); }).catch(function (e) { toast('加载失败:' + e.message); });
    }
    if (tab === 'sessions') {
      return get('/sessions', Object.assign({ sort: state.sSort, limit: 100, q: state.search.trim() }, fParams()))
        .then(function (list) { state.sessionsList = list; renderSessions(); })
        .catch(function (e) { toast('加载失败:' + e.message); });
    }
    if (tab === 'settings') {
      
      
      return Promise.all([
        get('/meta').then(function (m) { state.meta = m; }),
        get('/config').then(function (c) { state.config = c; }),
        get('/kpi', { range: 'month' }).then(function (k) { state.kpiMonth = k; })
      ]).then(function () { renderSettings(); }).catch(function (e) { toast('加载失败:' + e.message); });
    }
    return Promise.resolve();
  }

  var REFRESH_DEFAULTS = { pageSec: 60, scanSec: 300, onOpen: true };

  function refreshSettings() {
    var src = (state.meta && state.meta.refresh) || (state.config && state.config.refresh) || {};
    var pick = function (k) {
      var v = src[k];
      var n = Number(v);
      if (v === null || v === undefined || v === '' || !isFinite(n) || n < 0) return REFRESH_DEFAULTS[k];
      return n === 0 ? 0 : Math.round(n);
    };
    return {
      pageSec: pick('pageSec'),
      scanSec: pick('scanSec'),
      onOpen: src.onOpen === undefined || src.onOpen === null ? REFRESH_DEFAULTS.onOpen : !!src.onOpen
    };
  }

  function refreshOnOpen() { return refreshSettings().onOpen; }

  var autoRefreshTimer = null;
  function startAutoRefresh() {
    if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
    var sec = refreshSettings().pageSec;
    if (!(sec > 0)) return;
    autoRefreshTimer = setInterval(function () {
      
      
      
      if (document.hidden || state.pushed || sheetOpen) return;
      if (state.tab === 'settings') return;
      if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
      loadTab(state.tab);
    }, sec * 1000);
  }

  var scanInFlight = null;

  function scanThenReload(tab) {
    if (!scanInFlight) {
      
      scanInFlight = post('/scan', {}).then(
        function (r) { return { ok: true, summary: r && r.summary }; },
        function (e) { return { ok: false, error: (e && e.message) || String(e) }; }
      ).then(function (res) {
        scanInFlight = null;
        return res;
      });
    }
    var target = tab || state.tab;
    return scanInFlight.then(function (res) {
      return loadTab(target).then(function () { return res; });
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    if (!refreshOnOpen()) return;
    if (state.pushed || sheetOpen) return;
    if (state.tab === 'settings') return;
    scanThenReload(state.tab);
  });
