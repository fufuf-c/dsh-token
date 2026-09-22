  function renderToday() {
    var k = state.today, body = $('today-body');
    if (!k) return;
    var t = k.totals || {};
    var d = new Date();
    $('today-eyebrow').textContent = (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · ' + WEEKDAYS[d.getDay()];

    
    
    
    var dTok = k.delta && k.delta.tokens != null ? k.delta.tokens : null;
    var dCost = k.delta && k.delta.cost != null ? k.delta.cost : null;
    var deltaChip = '';
    if (dTok != null) {
      deltaChip = '<span class="delta-chip ' + (dTok >= 0 ? 'down' : 'up') + '">较昨日 ' +
        (dTok >= 0 ? '+' : '−') + fmtTok(Math.abs(dTok)) + ' tokens</span>';
    } else if (dCost != null) {
      deltaChip = '<span class="delta-chip ' + (dCost >= 0 ? 'down' : 'up') + '">费用较昨日 ' +
        (dCost >= 0 ? '+¥' : '−¥') + fmtCost(Math.abs(dCost)) + '</span>';
    }
    var hitRate = k.hitRate != null ? k.hitRate : 0;

    var inTok = (t.miss || 0) + (t.read || 0) + (t.write || 0);
    var segs = [
      { label: '缓存命中', v: t.read || 0, color: cssVar('--green'), note: inTok > 0 ? '占输入 ' + fmtPct((t.read || 0) / inTok) : '' },
      { label: '未命中', v: t.miss || 0, color: cssVar('--red'), note: '全价输入' },
      { label: '输出', v: t.out || 0, color: cssVar('--blue'), note: (t.requests || 0) + ' 次请求' },
      { label: '缓存写入', v: t.write || 0, color: cssVar('--gray'), note: '写入缓存' }
    ].filter(function (s) { return s.v > 0; });
    var total = segs.reduce(function (a, s) { return a + s.v; }, 0) || 1;
    var segbar = segs.map(function (s) {
      return '<i style="flex:' + (s.v / total * 1000).toFixed(1) + ';background:' + s.color + '" title="' + esc(s.label) + ' ' + fmtTok(s.v) + ' tokens"></i>';
    }).join('');
    var seglegend = segs.map(function (s) {
      return '<div class="sli"><span class="dot" style="background:' + s.color + '"></span><div style="min-width:0">' +
        '<b>' + fmtTok(s.v) + '</b><span>' + esc(s.label) + (s.note ? ' · ' + s.note : '') + '</span></div></div>';
    }).join('');

    var html = '<section class="card" aria-label="今日用量">' +
      '<div class="hero-top"><div class="hero-num"><span class="num" id="today-total">0</span><span class="unit">tokens</span></div><span style="flex:1"></span>' + deltaChip + '</div>' +
      '<div class="hero-meta"><span>¥' + fmtCost(t.cost) + '</span><span class="sep">·</span><span>' + (t.requests || 0) + ' 次请求</span><span class="sep">·</span><span>命中率 ' + fmtPct(hitRate) + '</span></div>' +
      '<div class="hero-chart chart-wrap"><canvas class="chart" id="today-hours" height="110" aria-label="今日小时分布"></canvas></div></section>' +
      '<section class="card" aria-label="今日构成"><div class="card-head" style="margin-bottom:14px"><h2>构成</h2></div>' +
      '<div class="segbar">' + segbar + '</div><div class="seglegend">' + seglegend + '</div></section>';

    var peakHour = '—', peakTok = 0;
    if (state.hoursToday && state.hoursToday.length) {
      var vals = state.hoursToday.map(function (b) { return tokTotal(b.totals); });
      var pi = 0;
      for (var i = 1; i < 24; i++) if (vals[i] > vals[pi]) pi = i;
      peakHour = pad2(pi) + ':00'; peakTok = vals[pi];
    }
    html += '<div class="sechead"><h3>亮点</h3></div>';
    html += '<div class="flow">' +
      mini('save', 'green', '缓存省下', '¥' + fmtCost(t.saved), '命中 ' + fmtTok(t.read || 0) + ' × 价差') +
      mini('flame', 'orange', '缓存命中率', fmtPct(hitRate), '输入 ' + fmtTok(inTok)) +
      mini('clock', 'purple', '峰值时段', peakHour, peakTok ? fmtTok(peakTok) + ' tokens' : '今日暂无') +
      mini('zap', 'blue', '连续使用', (k.streakDays > 0 ? k.streakDays + ' 天' : '—'), '截至今天') +
      '</div>';

    html += '<div class="sechead"><h3>最近会话</h3><button class="lnk" data-goto="sessions">查看全部<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button></div>';
    html += '<section class="card list"><div class="glist" id="today-sess"></section>';
    body.innerHTML = html;

    var sess = state.sessToday || [];
    var sessEl = $('today-sess');
    if (!sess.length) sessEl.innerHTML = emptyHTML('今天还没有会话', '去干活吧,数据会实时汇总到这里');
    else {
      sessEl.innerHTML = sess.map(function (it) { return sessionRow(it); }).join('');
      bindSessionRows(sessEl);
    }

    countUp($('today-total'), t.total || 0, fmtTok, 'today-total');
    if (state.hoursToday) drawHours('today-hours', state.hoursToday, 110, null, true);
    body.querySelectorAll('[data-goto]').forEach(function (b) {
      b.onclick = function () { setTab(this.getAttribute('data-goto')); };
    });
    syncNavChrome();
  }
  function mini(icon, color, k, v, s) {
    var c = cssVar('--' + color) || '#0a84ff';
    var rgb = hexRgb(c);
    var ic = {
      save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/></svg>',
      flame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c1 3-1 4.5-2.5 6C7.9 10.7 7 12.3 7 14a5 5 0 0 0 10 0c0-1.6-.7-3-1.8-4.3-.8.9-1.9 1.3-2.7 1-.4-2.3-.5-5.2.5-7.7z"/></svg>',
      zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg>',
      clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/></svg>'
    }[icon];
    return '<div class="mini"><div class="mk"><span class="ic" style="background:rgba(' + rgb.join(',') + ',.15);color:' + c + '">' + ic + '</span>' + k + '</div>' +
      '<div class="mv">' + v + '</div><div class="ms">' + s + '</div></div>';
  }
