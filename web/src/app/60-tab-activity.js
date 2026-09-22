  function trendVal(t, metric) {
    if (!t) return 0;
    return metric === 'tokens' ? (tokTotal(t)) : (t[metric] || 0);
  }
  function trendLabel(key, gran) {
    if (gran === 'month') { var p = String(key).split('-'); return (+p[1]) + ' 月'; }
    if (gran === 'week') return shortKey(key) + ' 周';
    return shortKey(key);
  }

  var rpView = null;   
  function rpMonthOf(key) { return String(key || '').slice(0, 7); }
  function rpTodayKey() { return dayKey(Date.now()); }

  function renderRangeChip(k) {
    var chip = $('range-chip');
    if (!chip) return;
    var isCustom = state.range === 'custom';
    var wantKind = isCustom ? 'custom' : 'preset';

    
    
    
    if (chip.getAttribute('data-kind') !== wantKind) {
      chip.innerHTML = '<span class="rangepick" id="rangebox">' +
        '<button class="rp-trigger" id="rp-trigger" aria-haspopup="dialog" aria-expanded="false">' +
        '<span id="rp-label"></span>' + raw(CHEV_SVG.replace('<svg', '<svg class="rp-caret"')) + '</button>' +
        (isCustom ? raw('<button class="x" id="range-clear" aria-label="清除自定义范围" title="清除">' + X_SVG + '</button>') : '') +
        '</span>';
      chip.setAttribute('data-kind', wantKind);
      bindRangePicker();
    }

    var ready = !!(state.from && state.to);
    var trig = $('rp-trigger'), lbl = $('rp-label'), box = $('rangebox');
    if (trig) {
      trig.classList.toggle('is-set', ready);
      trig.setAttribute('aria-expanded', state.rpOpen ? 'true' : 'false');
    }
    
    
    if (lbl) {
      if (ready) lbl.textContent = state.from + ' ~ ' + state.to;
      else if (state.from) lbl.textContent = state.from + ' ~ …';
      else lbl.textContent = '自定义日期';
    }
    if (box) {
      var pop = $('rp-pop');
      if (state.rpOpen && !pop) renderRangePop();
      else if (!state.rpOpen && pop) pop.parentNode.removeChild(pop);
      else if (state.rpOpen && pop) renderRangePop();  
    }
  }

  function renderRangePop() {
    var box = $('rangebox');
    if (!box) return;
    if (!$('rp-pop')) {
      var dow = ['一', '二', '三', '四', '五', '六', '日'];
      
      box.insertAdjacentHTML('beforeend', raw(
        '<div class="rp-pop" id="rp-pop" role="dialog" aria-label="选择日期范围">' +
        '<div class="rp-head">' +
        '<button type="button" class="rp-nav" id="rp-prev" aria-label="上个月">' + LEFT_SVG + '</button>' +
        '<span class="rp-m" id="rp-m" aria-live="polite"></span>' +
        '<button type="button" class="rp-nav" id="rp-next" aria-label="下个月">' + CHEV_SVG + '</button>' +
        '</div><div class="rp-dow">' + dow.map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div>' +
        '<div class="rp-grid" id="rp-grid"></div>' +
        '<div class="rp-foot" id="rp-foot"></div></div>'));
      
      $('rp-prev').onclick = function (e) { e.stopPropagation(); rpShift(-1); };
      $('rp-next').onclick = function (e) { e.stopPropagation(); rpShift(1); };
    }
    rpFillGrid();
  }

  function rpFillGrid() {
    var grid = $('rp-grid'), mtxt = $('rp-m'), foot = $('rp-foot');
    if (!grid) return;
    
    var anchor = rpView || rpMonthOf(state.from) || rpMonthOf(rpTodayKey());
    var y = Number(anchor.slice(0, 4)), mo = Number(anchor.slice(5, 7)) - 1;
    var first = new Date(y, mo, 1);
    var startDow = (first.getDay() + 6) % 7;              
    var dim = new Date(y, mo + 1, 0).getDate();
    var prevDim = new Date(y, mo, 0).getDate();
    var today = rpTodayKey();
    
    var cells = [];
    for (var i = 0; i < 42; i++) {
      var dn = i - startDow + 1;
      var yy = y, mm = mo, dd = dn, out = false;
      if (dn < 1) { out = true; dd = prevDim + dn; mm = mo - 1; if (mm < 0) { mm = 11; yy--; } }
      else if (dn > dim) { out = true; dd = dn - dim; mm = mo + 1; if (mm > 11) { mm = 0; yy++; } }
      var key = yy + '-' + pad2(mm + 1) + '-' + pad2(dd);
      cells.push({ key: key, day: dd, out: out });
    }
    var f = state.from, t = state.to;
    var lo = f && t ? (f < t ? f : t) : (f || t);
    var hi = f && t ? (f > t ? f : t) : null;
    
    var pending = f && !t;
    
    if (mtxt) mtxt.textContent = y + ' 年 ' + (mo + 1) + ' 月';
    grid.innerHTML = cells.map(function (c) {
      var cls = 'rp-day';
      if (c.out) cls += ' out';
      if (c.key === today) cls += ' today';
      if (lo && hi && c.key >= lo && c.key <= hi) cls += ' in-range';
      if (lo && hi && c.key === lo) cls += ' range-start';
      if (lo && hi && c.key === hi) cls += ' range-end';
      if (pending && c.key === f) cls += ' in-range range-start range-end';
      return tpl`<button type="button" class="${cls}" data-day="${c.key}" aria-label="${c.key}"${c.key === today ? ' aria-current="date"' : ''}>${c.day}</button>`;
    }).join('');
    grid.querySelectorAll('.rp-day').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); rpPickDay(b.getAttribute('data-day')); };
    });
    if (foot) {
      
      
      
      
      foot.innerHTML = f ? '<button type="button" class="rp-q" data-q="clear">清除范围</button>' : '';
      foot.hidden = !f;
      foot.querySelectorAll('.rp-q').forEach(function (b) {
        b.onclick = function (e) { e.stopPropagation(); rpQuick(b.getAttribute('data-q')); };
      });
    }
  }
  function rpShift(n) {
    var anchor = rpView || rpMonthOf(state.from) || rpMonthOf(rpTodayKey());
    var y = Number(anchor.slice(0, 4)), mo = Number(anchor.slice(5, 7)) - 1 + n;
    var d = new Date(y, mo, 1);
    rpView = d.getFullYear() + '-' + pad2(d.getMonth() + 1);
    
    rpFillGrid();
  }

  function rpPickDay(key) {
    if (!state.from || (state.from && state.to)) {
      state.from = key; state.to = '';
      renderRangePop(); renderRangeChip(state.kpiAct);
      return;
    }
    var f = state.from, t = key;
    if (t < f) { var tmp = f; f = t; t = tmp; toast('已自动按较早日期为起点'); }
    state.from = f; state.to = t;
    rpApply(true);
  }

  function rpQuick(kind) {
    state.from = ''; state.to = ''; state.range = 'all'; state.rpOpen = false;
    applyUI(); loadTab('activity'); toast('已清除自定义范围');
  }

  function rpApply(closePick) {
    if (!(state.from && state.to)) return;   
    state.range = 'custom';
    if (closePick) state.rpOpen = false;
    applyUI();
    loadTab('activity');
  }
  function bindRangePicker() {
    var trig = $('rp-trigger');
    if (trig) trig.onclick = function (e) {
      e.stopPropagation();
      state.rpOpen = !state.rpOpen;
      if (state.rpOpen) rpView = null;   
      renderRangeChip(state.kpiAct);
    };
    var xc = $('range-clear');
    if (xc) xc.onclick = function (e) {
      e.stopPropagation();
      state.from = ''; state.to = ''; state.range = 'all'; state.rpOpen = false;
      applyUI(); loadTab('activity'); toast('已清除自定义范围');
    };
    
    if (!bindRangePicker._bound) {
      bindRangePicker._bound = true;
      document.addEventListener('click', function (e) {
        if (!state.rpOpen) return;
        var box = $('rangebox');
        if (box && !box.contains(e.target)) {
          state.rpOpen = false;
          renderRangeChip(state.kpiAct);
        }
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && state.rpOpen) {
          state.rpOpen = false;
          renderRangeChip(state.kpiAct);
        }
      });
    }
  }
  function renderActivity() {
    var body = $('activity-body');
    var k = state.kpiAct;

    renderRangeChip(k);
    if (!k) return;
    var t = k.totals || {};
    var html = '';

    
    var upTok = Number(t.unpricedTokens) || 0;

    var rng = k.range || {};
    var rngText = (RANGE_LABELS[state.range] || RANGE_LABELS.all || '全部时间') +
      (rng.fromDay ? ' · ' + rng.fromDay + ' ~ ' + rng.toDay : '');
    html += '<section class="card totstrip" aria-label="范围汇总">' +
      '<div class="tstrip-note">' + esc(rngText) + '</div>' +
      '<div class="tcell"><b>' + fmtTok(t.total) + '</b><span>Tokens</span></div>' +
      '<div class="tcell"><b>¥' + fmtCost(t.cost) + '</b><span>估算费用' +
      (upTok > 0 ? ' · 另有 ' + fmtTok(upTok) + ' tokens 未定价未计入' : '') + '</span></div>' +
      '<div class="tcell"><b>' + (t.requests || 0) + '</b><span>请求</span></div>' +
      '<div class="tcell"><b>' + fmtPct(k.hitRate) + '</b><span>命中率</span></div>' +
      '</section>';

    html += '<section class="card" aria-label="用量趋势"><div class="card-head"><h2>用量</h2><span class="grow"></span>' +
      '<span class="card-note">显示</span>' +
      '<div class="seg sm" id="m-seg" role="group" aria-label="显示指标">' +
      '<button data-m="tokens" class="' + (state.metric === 'tokens' ? 'on' : '') + '">Tokens</button>' +
      '<button data-m="cost" class="' + (state.metric === 'cost' ? 'on' : '') + '">金额</button>' +
      '<button data-m="requests" class="' + (state.metric === 'requests' ? 'on' : '') + '">请求</button></div>' +
      '<span class="card-note">粒度</span>' +
      '<div class="seg sm" id="g-seg" role="group" aria-label="粒度">' +
      '<button data-g="day" class="' + (state.granularity === 'day' ? 'on' : '') + '">日</button>' +
      '<button data-g="week" class="' + (state.granularity === 'week' ? 'on' : '') + '">周</button>' +
      '<button data-g="month" class="' + (state.granularity === 'month' ? 'on' : '') + '">月</button></div></div>' +
      '<div class="bigrow" id="trend-hero"></div>' +
      '<div class="chart-wrap" id="trend-wrap"><canvas class="chart" id="trend-canvas" height="230" aria-label="用量图"></canvas></div>' +
      '<div class="legend" id="trend-legend"></div></section>';

    html += '<div class="sechead"><h3>按模型筛选 · ' + esc(RANGE_LABELS[state.range] || '全部时间') + '</h3>' +
      '<span class="card-note">作用于全部卡片</span></div>';
    html += '<div class="fchips" id="model-filter-chips"></div>';
    html += '<section class="card list"><div class="glist" id="model-cats"></section>';

    html += '<section class="card" aria-label="24 小时分布"><div class="card-head"><h2>24 小时分布</h2><span class="card-note" id="hour-note"></span><span class="grow"></span>' +
      '<span class="card-note">显示</span>' +
      '<div class="seg sm" id="hour-seg" role="group" aria-label="显示指标">' +
      '<button data-hour="tokens" class="' + (state.hourMetric === 'tokens' ? 'on' : '') + '">Tokens</button>' +
      '<button data-hour="requests" class="' + (state.hourMetric === 'requests' ? 'on' : '') + '">请求</button></div></div>' +
      '<div class="chart-wrap" id="hours-wrap"><canvas class="chart" id="hours" height="120" aria-label="24 小时分布图"></canvas></div></section>';

    html += '<section class="card" aria-label="活跃度"><div class="card-head"><h2>活跃度</h2><span class="card-note" id="hm-note"></span><span class="grow"></span>' +

      '<span class="card-note">显示</span>' +
      '<div class="seg sm" id="hm-seg" role="group" aria-label="显示指标">' +
      '<button data-hm="tokens" class="' + (state.hmMetric === 'tokens' ? 'on' : '') + '">Tokens</button>' +
      '<button data-hm="requests" class="' + (state.hmMetric === 'requests' ? 'on' : '') + '">请求</button></div></div>' +
      '<div id="heatmap"></div>' +
      
      
      '<div id="hm-legend"></div></section>';

    html += '<div class="sechead"><h3>花费最高会话</h3><button class="lnk" data-goto="sessions">全部会话<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button></div>';
    html += '<section class="card list"><div class="glist" id="cost-sess"></section>';

    body.innerHTML = html;
    segSyncAll(body);
    bindSegs(body);
    renderFilterChips();

    body.querySelectorAll('[data-goto]').forEach(function (b) {
      b.onclick = function () { setTab(this.getAttribute('data-goto')); };
    });

    if (state._series) renderTrend(state._series);
    renderModelCats();
    if (state._hours) drawHours('hours', state._hours, 120, 'hour-note', false);
    if (state._heat) renderHeatmap(state._heat);
    renderCostSess();
    syncNavChrome();
  }

  function renderFilterChips() {
    var box = $('model-filter-chips');
    if (!box) return;
    var chips = '';
    (state.meta && state.meta.models || []).forEach(function (mk) {
      if (state.models.indexOf(mk) >= 0) {
        chips += '<span class="fchip">' + esc(mk) + '<button class="x" data-unmodel="' + esc(mk) + '" aria-label="移除模型筛选">' + X_SVG + '</button></span>';
      }
    });
    if (state.wd) chips += '<span class="fchip">目录 ' + esc(state.wd) + '<button class="x" data-unwd aria-label="移除目录筛选">' + X_SVG + '</button></span>';
    if (state.session) chips += '<span class="fchip">会话 ' + esc(state.session) + '<button class="x" data-unsession aria-label="移除会话筛选">' + X_SVG + '</button></span>';
    box.innerHTML = chips;
    box.querySelectorAll('[data-unmodel]').forEach(function (b) {
      b.onclick = function () {
        state.models = state.models.filter(function (m) { return m !== b.getAttribute('data-unmodel'); });
        applyUI(); loadTab('activity');
      };
    });
    var uw = box.querySelector('[data-unwd]');
    if (uw) uw.onclick = function () { state.wd = ''; applyUI(); loadTab('activity'); };
    var us = box.querySelector('[data-unsession]');
    if (us) us.onclick = function () { state.session = ''; applyUI(); loadTab('activity'); };
  }

  function renderModelCats() {
    var el = $('model-cats');
    if (!el) return;
    var k = state.kpiAct;
    var ms = k && k.models ? k.models.slice(0, 9) : [];
    if (!ms.length) { el.innerHTML = emptyHTML('暂无模型数据', ''); return; }
    
    
    
    var maxTok = ms.reduce(function (a, m) { return Math.max(a, tokTotal(m.totals || {})); }, 0) || 1;
    var html = '';
    ms.forEach(function (m, i) {
      var tok = tokTotal(m.totals || {});
      var pct = tok / maxTok;
      var sel = state.models.indexOf(m.key) >= 0;
      var c = modelColor(m.key);
      html += '<button class="catrow' + (sel ? ' sel' : '') + '" data-model="' + esc(m.key) + '" aria-pressed="' + sel + '">' +
        '<span class="cdot" style="background:' + c + '"></span>' +
        '<span class="cmain"><span class="cname">' + esc(m.key) + '</span>' +
        '<span class="cbar"><i style="width:' + (Math.max(0, Math.min(100, pct * 100))).toFixed(1) + '%;background:' + c + '"></i></span></span>' +
        '<span class="cval"><b>' + fmtTok(tok) + '</b><span>' + fmtPct(pct) + ' · ¥' + fmtCost(m.totals.cost) + '</span></span>' +
        '<span class="tick">' + (sel ? CHECK_SVG : '') + '</span></button>';
    });
    el.innerHTML = html;
    el.querySelectorAll('.catrow').forEach(function (b) {
      b.onclick = function () {
        var mk = b.getAttribute('data-model');
        var idx = state.models.indexOf(mk);
        if (idx >= 0) state.models.splice(idx, 1); else state.models.push(mk);
        applyUI(); loadTab('activity');
        toast(state.models.length ? '已筛选 ' + state.models.length + ' 个模型' : '已清除模型筛选');
      };
    });
  }
  var CAT_COLORS = ['--blue', '--purple', '--teal', '--orange', '--red', '--green', '--indigo', '--gray'];
  
  
  var CAT_FALLBACK = ['#0a84ff', '#af52de', '#5ac8fa', '#ff9500', '#ff3b30', '#34c759', '#5856d6', '#8e8e93'];

  var modelColorMap = null;
  function collectModelKeys() {
    var seen = {}, out = [];
    var add = function (k) { if (k && !seen[k]) { seen[k] = 1; out.push(k); } };
    ((state.meta && state.meta.models) || []).forEach(add);
    [state.today, state.kpiAct, state.kpiMonth].forEach(function (k) {
      if (k && k.models) k.models.forEach(function (m) { add(m.key); });
    });
    (state._series || []).forEach(function (s) { Object.keys(s.models || {}).forEach(add); });
    [state.sessionsList, state.sessToday, state.costTop].forEach(function (list) {
      (list || []).forEach(function (it) { (it && it.models ? it.models : []).forEach(function (m) { add(m.key || m); }); });
    });
    if (state.detail && state.detail.models) state.detail.models.forEach(function (m) { add(m.key); });
    out.sort();
    return out;
  }
  function rebuildModelColors() {
    var map = {};
    collectModelKeys().forEach(function (k, i) { map[k] = i; });
    modelColorMap = map;
  }
  function modelColor(key) {
    if (!modelColorMap) rebuildModelColors();
    if (key == null || key === '') key = '—';
    var i = modelColorMap[key];
    if (i == null) {
      
      
      i = Object.keys(modelColorMap).length;
      modelColorMap[key] = i;
    }
    return cssVar(CAT_COLORS[i % CAT_COLORS.length]) || CAT_FALLBACK[i % CAT_FALLBACK.length];
  }

  function renderCostSess() {
    var el = $('cost-sess');
    if (!el) return;
    var list = state.costTop || [];
    if (!list.length) { el.innerHTML = emptyHTML('暂无数据', ''); return; }
    el.innerHTML = list.map(function (it) { return sessionRow(it); }).join('');
    bindSessionRows(el);
  }

  function renderTrend(series) {
    var wrap = $('trend-wrap'), cv = $('trend-canvas');
    if (!wrap) return;
    if (!series || !series.length) {
      wrap.innerHTML = emptyHTML('暂无趋势数据', '当前筛选下没有记录');
      $('trend-legend').innerHTML = '';
      $('trend-hero').innerHTML = '';
      return;
    }
    
    
    if (!cv || cv.parentElement !== wrap) {
      wrap.innerHTML = '<canvas class="chart" id="trend-canvas" height="230" aria-label="用量图"></canvas>';
      cv = $('trend-canvas');
    }
    var metric = state.metric, gran = state.granularity;
    var n = series.length;
    var totAll = 0, totFirst = 0, half = Math.floor(n / 2) || 1;
    series.forEach(function (s, i) {
      var v = trendVal(s.totals, metric);
      totAll += v; if (i < half) totFirst += v;
    });
    var totSecond = totAll - totFirst;
    
    
    
    var deltaPct = (n >= 2 && totFirst > 0) ? ((totSecond - totFirst) / totFirst * 100) : null;
    var mLabel = metric === 'tokens' ? 'Tokens' : metric === 'cost' ? '金额' : '请求';
    
    
    var deltaHtml = deltaPct == null
      ? tpl`<span class="sub">${mLabel}${n < 2 ? ' · 当前范围只有一个周期,无法比较' : ''}</span>`
      : tpl`<span class="delta ${deltaPct >= 0 ? 'up' : 'down'}">${deltaPct >= 0 ? '▲' : '▼'} ${Math.abs(deltaPct).toFixed(1)}%</span><span class="sub">${mLabel} · 后半段 vs 前半段</span>`;
    $('trend-hero').innerHTML =
      '<span class="val num" id="trend-hero-v"></span>' + raw(deltaHtml);
    countUp($('trend-hero-v'), totAll, metric === 'cost' ? function (v) { return '¥' + fmtCost(v); } : fmtTok, 'trend-hero-' + metric);

    var stacked = gran === 'day' && metric === 'tokens';
    var models = [], seen = {};
    series.forEach(function (s) {
      Object.keys(s.models || {}).forEach(function (m) { if (!seen[m]) { seen[m] = 1; models.push(m); } });
    });
    var vis = models.filter(function (m) { return !state.hidden[m]; });

    if (!stacked && !vis.length && models.length) {
      wrap.innerHTML = '<div class="empty"><b>所有模型都已隐藏</b>' +
        '<span>用量图只画被选中的模型</span>' +
        '<button class="btn sm primary" id="trend-show-all" style="margin-top:10px">显示全部模型</button></div>';
      var rb = $('trend-show-all');
      if (rb) rb.onclick = function () { state.hidden = {}; renderTrend(series); };
      $('trend-legend').innerHTML = '';
      return;
    }
    var maxV = 1;
    series.forEach(function (s) {
      var vv = stacked ? trendVal(s.totals, metric) : 0;
      if (!stacked) vis.forEach(function (m) { vv += trendVal(s.models[m], metric); });
      maxV = Math.max(maxV, vv);
    });
    maxV = niceMax(maxV);
    var pad = { l: 56, r: 8, t: 14, b: 22 };
    var o = setupCanvas(cv, 230), g = o.g;
    var xOf = function (i) { return pad.l + (n <= 1 ? (o.w - pad.l - pad.r) / 2 : (o.w - pad.l - pad.r) * i / (n - 1)); };
    var yOf = function (v) { return pad.t + (o.h - pad.t - pad.b) * (1 - v / maxV); };
    var hoverIdx = -1;
    var rgb = blueRgb();
    var bw = (o.w - pad.l - pad.r) / n;

    var barW = n <= 2 ? Math.min(bw * .72, 120) : bw * .72;
    var barX = function (i) { return pad.l + bw * i + (bw - barW) / 2; };

    var barMode = gran === 'day' || n === 1;
    var posOf = function (i) { return barMode ? pad.l + bw * (i + .5) : xOf(i); };
    function grid() {
      g.textAlign = 'right';
      g.font = AXIS_FONT;
      
      
      
      [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
        var y = yOf(maxV * f);
        g.strokeStyle = hairline2();
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(pad.l, y); g.lineTo(o.w - pad.r, y); g.stroke();
        g.fillStyle = text3();
        g.fillText(metric === 'cost' ? '¥' + fmtCost(maxV * f) : fmtTok(maxV * f), pad.l - 6, y + 3);
      });
      g.textAlign = 'left';
    }
    function totAt(i) {
      if (stacked) return trendVal(series[i].totals, metric);
      var v = 0; vis.forEach(function (m) { v += trendVal(series[i].models[m], metric); });
      return v;
    }
    function topMost(parts) { var last = 0; for (var j = 0; j < parts.length; j++) if (parts[j] > 0) last = j; return last; }
    function frame() {
      g.clearRect(0, 0, o.w, o.h);
      grid();
      if (hoverIdx >= 0) {

        g.strokeStyle = 'rgba(128,128,128,.35)';
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(posOf(hoverIdx), pad.t); g.lineTo(posOf(hoverIdx), o.h - pad.b); g.stroke();
      }
      if (stacked) {
        
        
        
        var catColors = CATS.map(function (c) { return cssVar(c.css) || '#8e8e93'; });
        var avg = 0, peak = 0;
        for (var i0 = 0; i0 < n; i0++) { avg += totAt(i0); if (totAt(i0) > totAt(peak)) peak = i0; }
        avg = avg / n;
        for (var i = 0; i < n; i++) {
          var t = series[i].totals || {};
          var parts = CATS.map(function (c) { return t[c.key] || 0; });
          var tot = parts[0] + parts[1] + parts[2] + parts[3];
          if (tot <= 0) continue;
          var y = o.h - pad.b;
          var topIdx = topMost(parts);
          for (var j = 0; j < parts.length; j++) {
            var c = CATS[j];
            var hSeg = (o.h - pad.t - pad.b) * parts[j] / maxV;
            if (hSeg <= 0) continue;
            var isSel = !state.stkSel || c.key === state.stkSel;
            g.fillStyle = catColors[j];
            g.globalAlpha = (i === hoverIdx ? 1 : i === n - 1 ? .92 : .78) * (isSel ? 1 : .15);
            var x0 = barX(i);
            var w2 = Math.max(1.5, barW);
            g.beginPath();
            if (j === topIdx) rr(g, x0, y - hSeg, w2, hSeg, [2.5, 2.5, 0, 0]);
            else rr(g, x0, y - hSeg, w2, hSeg + .5, 0);
            g.fill();
            y -= hSeg;
          }
          g.globalAlpha = 1;
        }
        if (avg > 0 && n > 1) {
          var ya = yOf(avg);
          g.strokeStyle = text3();
          g.lineWidth = 1;
          g.setLineDash([4, 4]);
          g.beginPath(); g.moveTo(pad.l, ya); g.lineTo(o.w - pad.r, ya); g.stroke();
          g.setLineDash([]);
          g.fillStyle = text3();
          g.font = AXIS_FONT;
          g.textAlign = 'right';
          g.fillText('均值 ' + fmtTok(avg), o.w - pad.r - 2, ya - 4);
          g.textAlign = 'left';
        }
      } else if (barMode) {

        var peak2 = 0;
        for (var i2 = 1; i2 < n; i2++) if (totAt(i2) > totAt(peak2)) peak2 = i2;
        var plotH = o.h - pad.t - pad.b;
        var stackModels = models.filter(function (m) { return !state.hidden[m]; });
        for (var i3 = 0; i3 < n; i3++) {
          var sm = series[i3].models || {};
          var parts2 = stackModels.map(function (m) { return { m: m, v: trendVal(sm[m], metric) }; });
          
          var top2 = -1;
          for (var q = parts2.length - 1; q >= 0; q--) if (parts2[q].v > 0) { top2 = q; break; }
          var y3 = o.h - pad.b;
          for (var k3 = 0; k3 < parts2.length; k3++) {
            var hseg = plotH * parts2[k3].v / maxV;
            if (hseg <= 0) continue;
            g.fillStyle = modelColor(parts2[k3].m);
            g.globalAlpha = (i3 === hoverIdx ? 1 : i3 === peak2 ? .95 : .78);
            g.beginPath();
            var hh = Math.max(hseg, 1);
            if (k3 === top2) rr(g, barX(i3), y3 - hh, Math.max(1.5, barW), hh, Math.min(3, barW / 2));
            else rr(g, barX(i3), y3 - hh, Math.max(1.5, barW), hh + .5, 0);
            g.fill();
            y3 -= hh;
          }
          g.globalAlpha = 1;
        }
      } else {
        vis.forEach(function (m, mi) {
          g.strokeStyle = modelColor(m);
          g.globalAlpha = .55;
          g.lineWidth = 1.4;
          g.lineJoin = 'round'; g.lineCap = 'round';
          g.beginPath();
          var started = false;
          for (var j = 0; j < n; j++) {
            var x = xOf(j), y = yOf(trendVal(series[j].models[m], metric));
            if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
          }
          g.stroke();
          g.globalAlpha = 1;
        });
        drawAreaLine(g, n, xOf, function (i) { return yOf(totAt(i)); }, rgb, { pad: pad, h: o.h }, { lineWidth: 2.4 });
      }
      g.fillStyle = text3();
      g.font = AXIS_FONT;
      g.textAlign = 'center';
      var step = Math.max(1, Math.ceil(n / 7));
      for (var i4 = 0; i4 < n; i4 += step) g.fillText(trendLabel(series[i4].key, gran), xOf(i4), o.h - 6);
      g.textAlign = 'left';
      if (hoverIdx >= 0) {
        g.fillStyle = 'rgba(' + rgb.join(',') + ',1)';
        g.beginPath(); g.arc(posOf(hoverIdx), yOf(totAt(hoverIdx)), 3.4, 0, Math.PI * 2); g.fill();
      }
    }
    frame();
    var lh = '';
    if (stacked) {
      CATS.forEach(function (c) {
        var on = !state.stkSel || state.stkSel === c.key;
        lh += '<button class="lg' + (on ? ' on' : ' off') + '" data-cat="' + c.key + '" aria-pressed="' + on + '"><i style="background:' + (cssVar(c.css) || '#8e8e93') + '"></i>' + c.label + '</button>';
      });
    } else {
      models.forEach(function (m, i) {
        lh += '<button class="lg' + (state.hidden[m] ? ' off' : ' on') + '" data-m="' + esc(m) + '" aria-pressed="' + (!state.hidden[m]) + '"><i style="background:' + modelColor(m) + '"></i>' + esc(m) + '</button>';
      });
    }
    $('trend-legend').innerHTML = lh;

    var lgWrap = $('trend-legend');
    if (!stacked) {
      var note = document.createElement('span');
      note.className = 'lg-note';
      note.textContent = '仅本图显示';
      lgWrap.insertBefore(note, lgWrap.firstChild);
    }
    $('trend-legend').querySelectorAll('.lg').forEach(function (b) {
      b.onclick = function () {
        if (stacked) {
          var c = this.getAttribute('data-cat');
          state.stkSel = (state.stkSel === c) ? null : c;
        } else {
          var m = this.getAttribute('data-m');
          state.hidden[m] = !state.hidden[m];
        }
        renderTrend(state._series);
      };
    });
    var onTrendMove = function (cx, cy) {
      var rect = cv.getBoundingClientRect();
      var x = cx - rect.left;
      var idx;
      if (barMode) {
        
        
        idx = Math.floor((x - pad.l) / bw);
        if (x < pad.l - 2 || idx < 0 || idx > n - 1) { if (hoverIdx >= 0) { hoverIdx = -1; frame(); hideTip(); } return; }
      } else {
        idx = n <= 1 ? 0 : Math.round((x - pad.l) / ((o.w - pad.l - pad.r) / Math.max(1, n - 1)));
        if (x < pad.l - 4 || idx < 0 || idx > n - 1) { if (hoverIdx >= 0) { hoverIdx = -1; frame(); hideTip(); } return; }
      }
      if (idx !== hoverIdx) { hoverIdx = idx; frame(); }
      var s = series[idx];
      var html = '<b>' + esc(trendLabel(s.key, gran)) + ' · ' + esc(mLabel) + '</b>';
      if (stacked) {
        var t = s.totals || {};
        CATS.forEach(function (c) { html += '<div class="row"><span>' + c.label + '</span><span>' + fmtTok(t[c.key]) + '</span></div>'; });
        html += '<div class="row" style="margin-top:3px;border-top:1px solid rgba(255,255,255,.15);padding-top:3px"><span>合计</span><span>' + fmtTok(totAt(idx)) + '</span></div>';
      } else {
        var rows = vis.map(function (m) { return { m: m, v: trendVal(s.models[m], metric) }; }).sort(function (a, b) { return b.v - a.v; });
        rows.slice(0, 8).forEach(function (r) {
          
          html += '<div class="row"><span><i class="tipdot" style="background:' + modelColor(r.m) + '"></i>' + esc(r.m) + '</span><span>' + (metric === 'cost' ? '¥' + fmtCost(r.v) : fmtTok(r.v)) + '</span></div>';
        });
        if (rows.length > 8) html += '<div class="row"><span>…共 ' + rows.length + ' 个模型</span></div>';
        html += '<div class="row" style="margin-top:3px;border-top:1px solid rgba(255,255,255,.15);padding-top:3px"><span>合计</span><span>' + (metric === 'cost' ? '¥' + fmtCost(totAt(idx)) : fmtTok(totAt(idx))) + '</span></div>';
      }
      showTip(cx, cy, html);
    };
    bindChartPointer(cv, onTrendMove, function () { hoverIdx = -1; frame(); hideTip(); });
  }

  function drawHours(canvasId, buckets, cssH, noteId, todayMode) {
    var cv = $(canvasId);
    if (!cv) return;
    var wrap = cv.parentElement;
    if (!buckets || !buckets.length) { wrap.innerHTML = emptyHTML('暂无数据', ''); if (noteId && $(noteId)) $(noteId).textContent = ''; return; }
    var metric = todayMode ? 'tokens' : state.hourMetric;
    var vals = buckets.map(function (b) {
      return metric === 'tokens' ? (tokTotal(b.totals)) : (b.totals.requests || 0);
    });
    var maxV = Math.max.apply(null, vals.concat([1]));
    var peak = 0;
    for (var i = 1; i < 24; i++) if (vals[i] > vals[peak]) peak = i;

    maxV = niceMax(maxV);
    var pad = { l: 52, r: 8, t: 8, b: 16 };
    var o = setupCanvas(cv, cssH), g = o.g;
    var bw = (o.w - pad.l - pad.r) / 24;
    var hoverIdx = -1;
    var rgb = blueRgb();
    function axisLabel(v) {
      
      return metric === 'tokens' ? fmtTok(v) : fmtNum(v);
    }
    function frame() {
      g.clearRect(0, 0, o.w, o.h);

      g.font = AXIS_FONT;
      g.textAlign = 'right';
      [0, 0.5, 1].forEach(function (f) {
        var y = o.h - pad.b - (o.h - pad.t - pad.b) * f;
        g.strokeStyle = hairline2();
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(pad.l, y); g.lineTo(o.w - pad.r, y); g.stroke();
        g.fillStyle = text3();
        g.fillText(axisLabel(maxV * f), pad.l - 6, y + 3);
      });
      g.textAlign = 'left';
      for (var i = 0; i < 24; i++) {
        var h2 = (o.h - pad.t - pad.b) * vals[i] / maxV;
        g.fillStyle = i === peak ? 'rgba(' + rgb.join(',') + ',.95)'
          : i === hoverIdx ? 'rgba(' + rgb.join(',') + ',.8)' : 'rgba(' + rgb.join(',') + ',.30)';
        var x0 = pad.l + bw * i + 1.5;
        var y0 = o.h - pad.b - h2;
        var w2 = Math.max(1, bw - 3);
        if (h2 > 0.5) { g.beginPath(); rr(g, x0, y0, w2, h2, Math.min(3, w2 / 2)); g.fill(); }
        else { g.beginPath(); g.arc(x0 + w2 / 2, o.h - pad.b - 1.5, 1.5, 0, Math.PI * 2); g.fill(); }
      }
      g.fillStyle = text3();
      g.font = AXIS_FONT;
      g.textAlign = 'center';
      for (i = 0; i < 24; i += 3) g.fillText(i + ' 时', pad.l + bw * i + bw / 2, o.h - 4);
      g.textAlign = 'left';
    }
    frame();
    var totalAll = vals.reduce(function (a, b) { return a + b; }, 0) || 1;
    
    
    if (noteId && $(noteId)) {
      var peakTxt = metric === 'tokens' ? fmtTok(vals[peak]) + ' tokens' : fmtNum(vals[peak]) + ' 次请求';
      $(noteId).textContent = '峰值 ' + pad2(peak) + ':00 · ' + peakTxt;
    }
    var onHourMove = function (cx, cy) {
      var rect = cv.getBoundingClientRect();
      var idx = Math.floor((cx - rect.left - pad.l) / bw);
      if (idx < 0 || idx > 23) { if (hoverIdx >= 0) { hoverIdx = -1; frame(); hideTip(); } return; }
      if (idx !== hoverIdx) { hoverIdx = idx; frame(); }
      var b = buckets[idx], t = b.totals || {};
      var share = (vals[idx] / totalAll * 100).toFixed(1);
      showTip(cx, cy,
        '<b>' + pad2(idx) + ':00 – ' + pad2((idx + 1) % 24) + ':00 · 占全天 ' + share + '%</b>' +
        '<div class="row"><span>未命中</span><span>' + fmtTok(t.miss) + '</span></div>' +
        '<div class="row"><span>缓存命中</span><span>' + fmtTok(t.read) + '</span></div>' +
        '<div class="row"><span>缓存写入</span><span>' + fmtTok(t.write) + '</span></div>' +
        '<div class="row"><span>输出</span><span>' + fmtTok(t.out) + '</span></div>' +
        '<div class="row"><span>请求</span><span>' + fmtNum(t.requests || 0) + '</span></div>');
    };
    bindChartPointer(cv, onHourMove, function () { hoverIdx = -1; frame(); hideTip(); });
  }

  var HM_MIN_Q = 8;

  var HM_MONTHS_MAX = 12;
  function hmScale(vals) {
    var nz = [], i;
    for (i = 0; i < vals.length; i++) if (vals[i] > 0) nz.push(vals[i]);
    if (!nz.length) return { kind: 'empty', levels: 0, reached: [], of: function () { return 0; } };
    nz.sort(function (a, b) { return a - b; });
    var vmax = nz[nz.length - 1];
    if (nz[0] === vmax) {
      return { kind: 'flat', levels: 3, reached: [3], of: function (v) { return v > 0 ? 3 : 0; } };
    }
    if (nz.length < HM_MIN_Q) {
      return {
        kind: 'ratio', levels: 4, reached: [2, 3, 4], of: function (v) {
          if (v <= 0) return 0;
          var r = v / vmax;
          return r >= .75 ? 4 : r >= .40 ? 3 : 2;
        }
      };
    }
    var q = function (p) {
      var x = (nz.length - 1) * p, lo = Math.floor(x), hi = Math.ceil(x);
      return nz[lo] + (nz[hi] - nz[lo]) * (x - lo);
    };
    var b1 = q(.25), b2 = q(.5), b3 = q(.75);
    if (b3 >= vmax) b3 = vmax;           
    var levels = b3 < vmax ? 4 : 3;
    return {
      kind: 'quantile', levels: levels, breaks: [b1, b2, b3, vmax],
      reached: levels === 4 ? [1, 2, 3, 4] : [1, 2, 3],
      of: function (v) {
        return v <= 0 ? 0 : v <= b1 ? 1 : v <= b2 ? 2 : v <= b3 ? 3 : 4;
      }
    };
  }

  var HM_ALPHA = { light: [0, .30, .50, .72, 1], dark: [0, .42, .60, .80, 1] };

  function renderHeatmap(days) {
    var box = $('heatmap');
    if (!box) return;
    var noteEl = $('hm-note');
    var lgHost = $('hm-legend');
    if (!days || !days.length) {
      box.innerHTML = emptyHTML('暂无活跃记录', '开始使用后,这里会按天显示用量');
      if (noteEl) noteEl.textContent = '';
      if (lgHost) lgHost.innerHTML = '';
      return;
    }
    var metric = state.hmMetric === 'requests' ? 'requests' : 'tokens';
    var byDay = {}, daysMeta = {};
    days.forEach(function (d) {
      byDay[d.day] = metric === 'requests' ? (d.requests || 0) : (d.total || 0);
      daysMeta[d.day] = d;
    });
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var rgb = blueRgb();
    var alpha = HM_ALPHA[dark ? 'dark' : 'light'];
    var unit = metric === 'requests' ? '次请求' : 'tokens';
    var todayKey = dayKey(Date.now());
    var fmtV = metric === 'requests' ? fmtNum : fmtTok;

    var firstKey = null;
    days.forEach(function (d) { if (!firstKey || d.day < firstKey) firstKey = d.day; });
    var firstD = new Date((firstKey || todayKey) + 'T00:00:00');
    var lastD = new Date(todayKey + 'T00:00:00');
    var months = (lastD.getFullYear() - firstD.getFullYear()) * 12 + (lastD.getMonth() - firstD.getMonth()) + 1;
    months = Math.max(1, Math.min(HM_MONTHS_MAX, months));
    
    var monthStarts = [];
    for (var mIdx = months - 1; mIdx >= 0; mIdx--) {
      monthStarts.push(new Date(lastD.getFullYear(), lastD.getMonth() - mIdx, 1));
    }
    var windowStart = dayKey(monthStarts[0].getTime());

    var allVals = [];
    var keyVal = {};   
    monthStarts.forEach(function (st) {
      var dim = new Date(st.getFullYear(), st.getMonth() + 1, 0).getDate();
      for (var dd = 1; dd <= dim; dd++) {
        var k = dayKey(new Date(st.getFullYear(), st.getMonth(), dd).getTime());
        if (k > todayKey) continue;
        var v = byDay[k] || 0;
        keyVal[k] = v;
        allVals.push(v);
      }
    });
    var scale = hmScale(allVals);
    var maxV = Math.max.apply(null, allVals.concat([0]));
    var activeDays = allVals.filter(function (v) { return v > 0; }).length;
    var totalAll = allVals.reduce(function (a, b) { return a + b; }, 0);

    
    function lvColor(lv) { return lv ? 'rgba(' + rgb.join(',') + ',' + alpha[lv] + ')' : 'transparent'; }

    var DOW_SHORT = ['一', '二', '三', '四', '五', '六', '日'];
    var html = '<div class="hm-months" role="grid" aria-label="每日用量月历">' +
      '<span class="sr-only">' + unit + '每日用量月历,从 ' + windowStart + ' 到今天。' +
      '方向键逐日移动,上下键跨周,回车只看该日。</span>';
    monthStarts.forEach(function (st) {
      var y = st.getFullYear(), mo = st.getMonth();
      var dim = new Date(y, mo + 1, 0).getDate();
      
      var lead = (new Date(y, mo, 1).getDay() + 6) % 7;
      html += '<div class="hm-month" role="rowgroup" aria-label="' + y + ' 年 ' + (mo + 1) + ' 月">' +
        '<div class="hm-mtitle">' + y + ' 年 ' + (mo + 1) + ' 月</div>' +
        '<div class="hm-mgrid">';
      DOW_SHORT.forEach(function (dw) { html += '<span class="hm-dow" aria-hidden="true">' + dw + '</span>'; });
      for (var p = 0; p < lead; p++) html += '<span class="hm-pad" aria-hidden="true"></span>';
      for (var dd2 = 1; dd2 <= dim; dd2++) {
        var key = dayKey(new Date(y, mo, dd2).getTime());
        var future = key > todayKey;
        var v2 = future ? 0 : (keyVal[key] || 0);
        var lv = scale.of(v2);
        var cls = 'hm-cell';
        if (future) cls += ' hm-na';
        else if (key === todayKey) cls += ' hm-today';

        if (future) {
          html += '<span class="' + cls + '" aria-hidden="true">' + dd2 + '</span>';
          continue;
        }
        var meta = daysMeta[key];
        var label = key + ' ' + WEEKDAY_CN[(new Date(key + 'T00:00:00').getDay())] + (v2 > 0
          ? ' · ' + (metric === 'requests' ? fmtNum(v2) + ' 次请求' : fmtTok(v2) + ' tokens') +
            (metric === 'tokens' && meta ? ' · ' + fmtNum(meta.requests || 0) + ' 次请求' : '')
          : ' · 无记录');
        html += '<button type="button" class="' + cls + '" data-l="' + lv + '" data-key="' + esc(key) + '"' +
          ' data-tip="' + esc(label) + '" aria-label="' + esc(label) + '" tabindex="-1"' +
          (key === todayKey ? ' aria-current="date"' : '') +
          
          
          
          ' style="background:' + lvColor(lv) + '">' + dd2 + '</button>';
      }
      html += '</div></div>';
    });
    html += '</div>';
    box.innerHTML = html;

    if (lgHost) {
      if (!scale.levels) lgHost.innerHTML = '';
      else {
        var used = [0].concat(scale.reached || []);
        var sw = '';
        for (var l = 0; l < used.length; l++) {
          
          sw += tpl`<i style="background:${lvColor(used[l])}"></i>`;
        }
        lgHost.innerHTML = '<div class="hm-legend" aria-hidden="true">' +
          '<span>少</span><span class="hm-ramp">' + sw + '</span><span>多</span>' +
          tpl`<span class="hm-peak">峰值 ${fmtV(maxV)}</span></div>`;
      }
    }

    if (noteEl) {

      var spanTxt = months === 1 ? '本月' : months + ' 个月';
      noteEl.textContent = spanTxt + ' · ' + activeDays + ' 天有记录 · 共 ' + fmtV(totalAll) +
        (metric === 'requests' ? ' 次请求' : ' tokens');
    }

    var cells = Array.prototype.slice.call(box.querySelectorAll('.hm-cell[data-key]'));

    var byKey = {};
    cells.forEach(function (c, i) { byKey[c.getAttribute('data-key')] = i; });
    var dayOf = function (k) { return new Date(k + 'T00:00:00'); };
    var wdOf = function (k) { return (dayOf(k).getDay() + 6) % 7; };        
    var addDays = function (k, n) { var d = dayOf(k); d.setDate(d.getDate() + n); return dayKey(d.getTime()); };
    var sortedKeys = Object.keys(byKey).sort();

    var rove = 0;
    var todayIdx = -1;
    for (var ci = 0; ci < cells.length; ci++) {
      if (cells[ci].getAttribute('data-key') === todayKey) { todayIdx = ci; break; }
    }
    if (todayIdx >= 0) rove = todayIdx;
    else {
      var lastActive = -1;
      cells.forEach(function (c, i) { if (c.getAttribute('data-l') !== '0') lastActive = i; });
      rove = lastActive >= 0 ? lastActive : cells.length - 1;
    }

    if (state.hmRove) {
      var keep = -1;
      for (var ki = 0; ki < cells.length; ki++) if (cells[ki].getAttribute('data-key') === state.hmRove) { keep = ki; break; }
      if (keep >= 0) rove = keep;
    }
    function setRove(k) {
      for (var j = 0; j < cells.length; j++) cells[j].tabIndex = (j === k ? 0 : -1);
      if (cells[k]) state.hmRove = cells[k].getAttribute('data-key');
    }
    if (cells.length) setRove(rove);

    if (state.hmRove && cells[rove] && document.activeElement === document.body) {
      try { cells[rove].focus({ preventScroll: true }); } catch (e2) { cells[rove].focus(); }
    }

    var tipOn = function (c, x, y) { showTip(x, y, '<b>' + esc(c.getAttribute('data-tip')) + '</b>'); };

    var tipAtCell = function (c) {
      var r = c.getBoundingClientRect();
      tipOn(c, r.left + r.width / 2, r.top + r.height / 2);
    };
    cells.forEach(function (c, idx) {
      c.addEventListener('pointerenter', function (e) { tipOn(c, e.clientX, e.clientY); });
      c.addEventListener('pointerleave', hideTip);
      c.addEventListener('pointercancel', hideTip);
      c.addEventListener('focus', function () { rove = idx; state.hmRove = c.getAttribute('data-key'); tipAtCell(c); });
      c.addEventListener('blur', hideTip);
      c.addEventListener('click', function () {
        var k = c.getAttribute('data-key');
        state.range = 'custom'; state.from = k; state.to = k;
        state.rpOpen = false;
        setTab('activity'); applyUI(); loadTab('activity');
        toast(k);
      });
      c.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.click(); return; }

        var k0 = c.getAttribute('data-key');
        var next = -1;
        if (e.key === 'ArrowRight') next = byKey[addDays(k0, 1)];
        else if (e.key === 'ArrowLeft') next = byKey[addDays(k0, -1)];
        else if (e.key === 'ArrowDown') next = byKey[addDays(k0, 7)];
        else if (e.key === 'ArrowUp') next = byKey[addDays(k0, -7)];
        
        else if (e.key === 'Home' || e.key === 'End') {
          var mine = sortedKeys.filter(function (kk) { return wdOf(kk) === wdOf(k0); });
          if (mine.length) next = byKey[e.key === 'Home' ? mine[0] : mine[mine.length - 1]];
        }
        
        else if (e.key === 'PageUp' || e.key === 'PageDown') {
          var mon = addDays(k0, -wdOf(k0));
          var week = sortedKeys.filter(function (kk) { return kk >= mon && kk <= addDays(mon, 6); });
          if (week.length) next = byKey[e.key === 'PageUp' ? week[0] : week[week.length - 1]];
        } else return;
        if (next == null || next < 0 || next >= cells.length) return;
        e.preventDefault();
        rove = next; setRove(next); tipAtCell(cells[next]); cells[next].focus();
      });
    });
  }
