  var scrollPos = {};
  function setTab(tab, force) {

    if (state.pushed) closeDetail();
    if (!force && state.tab === tab) return;
    scrollPos[state.tab] = window.scrollY;
    state.tab = tab;
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('on'); });
    var pg = $('page-' + tab);
    if (pg) pg.classList.add('on');
    document.querySelectorAll('.tb').forEach(function (b) {
      var on = b.getAttribute('data-tab') === tab;
      b.classList.toggle('on', on);
      
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    window.scrollTo({ top: scrollPos[tab] || 0, behavior: 'auto' });
    escUrl();

    if (refreshOnOpen()) scanThenReload(tab); else loadTab(tab);
    hideTip();
  }
  function applyUI() {
    setSeg('f-range', 'data-r', state.range);
    document.querySelectorAll('[data-act="fdot"]').forEach(function (d) {
      d.classList.toggle('hide', fCount() === 0);
    });
    escUrl();
  }
  function syncNavChrome() {

    document.querySelectorAll('[data-act="theme"]').forEach(function (btn) {
      btn.querySelector('.ic-auto').classList.toggle('hide', state.theme !== 'auto');
      btn.querySelector('.ic-sun').classList.toggle('hide', state.theme !== 'light');
      btn.querySelector('.ic-moon').classList.toggle('hide', state.theme !== 'dark');
    });
  }

  function bindSegs(root) {
    var SEGS = [
      { id: 'm-seg', attr: 'data-m', key: 'metric', after: function () { if (state._series) renderTrend(state._series); } },
      { id: 'g-seg', attr: 'data-g', key: 'granularity', after: function () { loadSeries(); } },
      { id: 'hour-seg', attr: 'data-hour', key: 'hourMetric', after: function () { drawHours('hours', state._hours, 120, 'hour-note', false); } },
      { id: 'hm-seg', attr: 'data-hm', key: 'hmMetric', after: function () { renderHeatmap(state._heat); } }
    ];
    SEGS.forEach(function (s) {
      root.querySelectorAll('#' + s.id + ' button').forEach(function (b) {
        b.onclick = function () {
          state[s.key] = b.getAttribute(s.attr);
          setSeg(s.id, s.attr, state[s.key]);
          s.after();
        };
      });
    });
  }

  function loadSeries() {
    return get('/series', Object.assign({ granularity: state.granularity }, fParams()))
      .then(function (s) { state._series = s; if (state._series) renderTrend(state._series); })
      .catch(function (e) { toast('加载失败:' + e.message); });
  }
