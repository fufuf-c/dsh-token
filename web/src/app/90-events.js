  function bindChrome() {

    document.querySelectorAll('.tb').forEach(function (b) {
      b.onclick = function () { setTab(b.getAttribute('data-tab')); };
    });

    document.querySelectorAll('.navbar [data-act]').forEach(function (el) {
      var act = el.getAttribute('data-act');
      if (act === 'filters' || el.closest('[data-act="filters"]') === el) {
        el.onclick = function () { openSheet(); };
      } else if (act === 'theme') {
        el.onclick = function (e) {
          state.theme = state.theme === 'auto' ? 'light' : state.theme === 'light' ? 'dark' : 'auto';
          localStorage.setItem('dsh-token-theme', state.theme === 'auto' ? '' : state.theme);
          applyTheme(true, e.clientX, e.clientY);
          toast(themeToastText());
        };
      } else if (act === 'refresh') {
        
        
        
        
        
        
        
        
        
        
        
        el.onclick = function () {
          var btn = el;
          btn.disabled = true;
          
          
          
          scanThenReload(state.tab).then(function (res) {
            btn.disabled = false;
            if (res && res.ok === false) toast('已重取数据,但扫描失败:' + res.error);
            else toast('已刷新');
          }, function () {
            btn.disabled = false;
            toast('刷新失败');
          });
        };
      } else if (act === 'share') {
        el.onclick = function () {
          escUrl();
          var url = location.href;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(function () { toast('已复制分享链接'); }, function () { prompt('复制链接', url); });
          } else prompt('复制链接', url);
        };
      }
    });

    document.querySelectorAll('#f-range button').forEach(function (b) {
      b.onclick = function () {
        state.range = b.getAttribute('data-r');
        state.from = ''; state.to = '';
        state.rpOpen = false;   
        applyUI();
        loadTab('activity');
      };
    });

    var sessSearchTimer = null;
    $('sess-search').oninput = function () {
      state.search = this.value;
      $('sess-clr').classList.toggle('hide', !this.value);
      if (sessSearchTimer) clearTimeout(sessSearchTimer);
      sessSearchTimer = setTimeout(function () { loadTab('sessions'); }, 250);
    };
    $('sess-clr').onclick = function () {
      state.search = '';
      $('sess-search').value = '';
      this.classList.add('hide');
      loadTab('sessions');
    };
    document.querySelectorAll('#s-seg button').forEach(function (b) {
      b.onclick = function () {
        state.sSort = b.getAttribute('data-s');
        setSeg('s-seg', 'data-s', state.sSort);
        loadTab('sessions');
      };
    });

    $('detail-back').onclick = closeDetail;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (sheetOpen) closeSheet();
        else if (state.pushed) closeDetail();
      }
    });

    var updateScrolled = function () {
      var y = window.scrollY || 0;
      document.querySelectorAll('.navbar').forEach(function (n) {
        var page = n.closest('.page') || n.closest('.pushpage');
        var visible = page && page.classList.contains('on');
        var sy = page && page.classList.contains('pushpage') ? page.scrollTop : y;
        n.classList.toggle('scrolled', visible && sy > 26);
      });
    };
    window.addEventListener('scroll', updateScrolled, { passive: true });
    $('page-detail').addEventListener('scroll', updateScrolled, { passive: true });
    
    window.addEventListener('popstate', function () {
      var q = new URLSearchParams(location.search);
      var want = q.get('detail');
      if (want && !state.pushed) openDetail(want, { replace: true });
      else if (!want && state.pushed) { closeDetail(); escUrl(); }
    });
    
    setDetailInert(true);
    window.addEventListener('resize', function () {
      segSyncAll();
      clearTimeout(window.__rsz);
      window.__rsz = setTimeout(function () {
        
        
        
        if (state.pushed && state.detail) { renderDetail(state.detail); return; }
        if (state.tab === 'today') renderToday();
        else if (state.tab === 'activity') renderActivity();
        else if (state.tab === 'sessions') renderSessions();
      }, 200);
    });
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {

        if (state.theme === 'auto' && autoTracksOs()) applyTheme(true);
      });
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { segSyncAll(); });
  }
