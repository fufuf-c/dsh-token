  function boot() {
    applyTheme();
    
    
    
    bindChrome();
    var q = new URLSearchParams(location.search);
    if (q.get('tab')) state.tab = q.get('tab');
    if (q.get('range')) state.range = q.get('range');
    if (q.get('from')) state.from = q.get('from');
    if (q.get('to')) state.to = q.get('to');
    if (q.get('session')) state.session = q.get('session');
    if (q.get('wd')) state.wd = q.get('wd');
    if (q.get('models')) state.models = q.get('models').split(',').filter(Boolean);
    
    if (q.get('q')) state.search = q.get('q');
    if (q.get('sort')) state.sSort = q.get('sort');
    
    
    
    
    
    var sid = q.get('detail');
    if (!sid && q.get('session') && !q.get('range') && !q.get('models') && !q.get('wd')) {
      var raw = q.get('session');
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) sid = raw;
    }

    get('/meta').then(function (m) {
      state.meta = m;
      
      
      try { localStorage.setItem('dsh-token-refresh-onopen', refreshSettings().onOpen ? '1' : '0'); } catch (e) {  }
      
      
      
      
      rebuildModelColors();
      applyUI();
      var startTab = state.tab;
      if (sid) startTab = 'sessions';
      else if (state.range !== 'all' || state.models.length || state.wd || state.session) startTab = 'activity';
      
      
      var explicit = q.get('tab');
      if (explicit && ['today', 'activity', 'sessions', 'settings'].indexOf(explicit) >= 0) startTab = explicit;
      if (['today', 'activity', 'sessions', 'settings'].indexOf(startTab) < 0) startTab = 'today';
      document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('on'); });
      $('page-' + startTab).classList.add('on');
      document.querySelectorAll('.tb').forEach(function (b) {
        b.classList.toggle('on', b.getAttribute('data-tab') === startTab);
        b.setAttribute('aria-current', b.getAttribute('data-tab') === startTab ? 'page' : 'false');
      });
      state.tab = startTab;

      if (refreshOnOpen()) void scanThenReload(startTab); else loadTab(startTab);
      if (sid) setTimeout(function () { openDetail(sid); }, 420);
      startAutoRefresh();
    }).catch(function (e) {
      
      var msg = (e && e.message) ? e.message : String(e);
      var card = '<div class="card">' + emptyHTML('无法连接数据 API', msg + ' — 请通过 dsh-token 插件页面访问') +
        '<div style="padding:0 0 4px"><button class="btn sm primary" id="boot-retry">重试</button></div></div>';
      document.querySelectorAll('.page .pagebody').forEach(function (el) { el.innerHTML = card; });
      var rb = $('boot-retry');
      if (rb) rb.onclick = function () { boot(); };
      toast('数据 API 不可达:' + msg);
    });
  }
  boot();
})();
