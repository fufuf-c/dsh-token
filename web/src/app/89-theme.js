  function dshThemePreference() {
    var t = window.__DSH_TOKEN_THEME__;
    if (!t) return null;
    var p = t.preference;
    return p === 'light' || p === 'dark' || p === 'system' ? p : null;
  }
  function osPrefersDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function autoTracksOs() {
    var p = dshThemePreference();
    return p !== 'light' && p !== 'dark';
  }
  function autoPrefersDark() {
    var p = dshThemePreference();
    if (p === 'dark') return true;
    if (p === 'light') return false;
    return osPrefersDark();
  }
  function themeToastText() {
    if (state.theme === 'light') return '主题:浅色';
    if (state.theme === 'dark') return '主题:深色';
    var p = dshThemePreference();
    if (p === 'light') return '主题:跟随 DSH(浅色)';
    if (p === 'dark') return '主题:跟随 DSH(深色)';
    return p === 'system' ? '主题:跟随 DSH(跟随系统)' : '主题:跟随系统';
  }
  function applyTheme(animate, x, y) {
    var dark = state.theme === 'dark' || (state.theme === 'auto' && autoPrefersDark());
    var swap = function () {
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      syncNavChrome();
      if (state._series && state.tab === 'activity') renderTrend(state._series);
      if (state.hoursToday && state.tab === 'today') drawHours('today-hours', state.hoursToday, 110, null, true);
      if (state._hours && state.tab === 'activity') drawHours('hours', state._hours, 120, 'hour-note', false);
      if (state._heat && state.tab === 'activity') renderHeatmap(state._heat);
      if (state.today && state.tab === 'today') renderToday();
    };

    if (!animate) { swap(); return; }
    var root = document.documentElement;
    if (x != null) {
      root.style.setProperty('--rip-x', Math.round(x) + 'px');
      root.style.setProperty('--rip-y', Math.round(y) + 'px');
    }

    var ripple = document.createElement('div');
    ripple.className = 'theme-ripple';

    root.classList.add('theming');
    void root.offsetWidth;
    swap();
    document.body.appendChild(ripple);
    setTimeout(function () { root.classList.remove('theming'); }, 620);
    setTimeout(function () { if (ripple.parentNode) ripple.parentNode.removeChild(ripple); }, 760);
  }
