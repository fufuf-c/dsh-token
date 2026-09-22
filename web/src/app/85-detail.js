  var sheetOpen = false;

  function setDetailInert(on) {
    var pg = $('page-detail');
    if (!pg) return;
    if (on) pg.setAttribute('inert', '');
    else pg.removeAttribute('inert');
  }
  function openDetail(id, opts) {
    get('/session', { id: id }).then(function (d) {
      if (!d) { toast('未找到会话 ' + id); return; }
      state.detail = d; 
      renderDetail(d);
      $('page-detail').classList.add('on');
      $('page-detail').setAttribute('aria-hidden', 'false');
      setDetailInert(false);
      state.pushed = true;
      $('page-detail').scrollTop = 0;

      document.querySelectorAll('.tb').forEach(function (b) {
        var on = b.getAttribute('data-tab') === 'sessions';
        b.classList.toggle('on', on);
        b.setAttribute('aria-current', on ? 'page' : 'false');
      });
      
      
      
      var p = new URLSearchParams();
      p.set('tab', 'sessions');
      p.set('detail', id);
      if (!(opts && opts.replace)) history.pushState({ detail: id }, '', location.pathname + '?' + p.toString());
      else escUrl();
      var back = $('detail-back');
      if (back) back.focus(); 
    }).catch(function (e) { toast('加载会话详情失败: ' + e.message); });
  }
  function closeDetail() {
    $('page-detail').classList.remove('on');
    $('page-detail').setAttribute('aria-hidden', 'true');
    setDetailInert(true);
    state.pushed = false;
    document.querySelectorAll('.tb').forEach(function (b) {
      var on = b.getAttribute('data-tab') === state.tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    hideTip();
    escUrl();
  }
  function renderDetail(d) {
    var m = d.meta || {}, t = d.totals || {};
    var reqs = d.requests || [];
    var seg = [(t.miss || 0), (t.read || 0), (t.write || 0), (t.out || 0)];
    var total = seg[0] + seg[1] + seg[2] + seg[3] || 1;
    var created = m.createdAt || (reqs.length ? reqs[0].t : 0);
    var last = reqs.length ? reqs[reqs.length - 1].t : 0;
    var days = {};
    reqs.forEach(function (r) { days[dayKey(r.t)] = 1; });
    var spanTxt = created && last ? Math.round((last - created) / 3600000) + ' 小时' : '—';
    var models = d.models || [];
    var hitRate = seg[0] + seg[1] + seg[2] > 0 ? seg[1] / (seg[0] + seg[1] + seg[2]) : 0;
    $('detail-title').textContent = sessTitle(m);
    var html =
      '<p class="mono muted" style="margin:0 0 4px">' + esc(d.id) + '</p>' +
      '<div class="meta-grid">' +
      '<div><b>工作目录</b><span class="mono">' + esc(m.cwd || '—') + '</span></div>' +
      '<div><b>预设 / 来源</b><span>' + esc(m.agentPreset || '—') + (m.origin === 'subagent' ? ' · 子代理' : '') + (m.delegationDepth ? ' · L' + m.delegationDepth : '') + '</span></div>' +
      '<div><b>父会话</b><span class="mono">' + esc(m.parentSession || '—') + '</span></div>' +
      '<div><b>创建时间</b><span>' + (created ? fmtDate(created) : '—') + '</span></div>' +
      '<div><b>最后活动</b><span>' + (last ? fmtDate(last) : '—') + '</span></div>' +
      '<div><b>跨度 / 活跃天数</b><span>' + spanTxt + ' · ' + Object.keys(days).length + ' 天</span></div>' +
      '</div>' +
      '<div class="stat4">' +
      '<div class="stat"><div class="k">Tokens</div><div class="v">' + fmtTok(total) + '</div></div>' +
      '<div class="stat"><div class="k">花费</div><div class="v">¥' + fmtCost(t.cost) + '</div></div>' +
      '<div class="stat"><div class="k">请求</div><div class="v">' + (d.requestCount || 0) + '</div></div>' +
      '<div class="stat"><div class="k">命中率</div><div class="v">' + fmtPct(hitRate) + '</div></div>' +
      '</div>' +
      '<section class="card" style="margin-top:14px"><div class="card-head"><h2>构成</h2><span class="card-note">节省 ¥' + fmtCost(t.saved) + '</span></div>' +
      '<div style="display:flex;gap:2px;height:7px;border-radius:4px;overflow:hidden">' +
      '<i style="flex:' + (seg[0] / total * 1000).toFixed(1) + ';background:var(--red)" title="未命中"></i>' +
      '<i style="flex:' + (seg[1] / total * 1000).toFixed(1) + ';background:var(--green)" title="缓存命中"></i>' +
      '<i style="flex:' + (seg[2] / total * 1000).toFixed(1) + ';background:var(--gray)" title="缓存写入"></i>' +
      '<i style="flex:' + (seg[3] / total * 1000).toFixed(1) + ';background:var(--blue)" title="输出"></i></div>' +
      '<p class="card-note" style="margin:8px 0 0">未命中 ' + fmtTok(seg[0]) + ' · 缓存命中 ' + fmtTok(seg[1]) + ' · 缓存写入 ' + fmtTok(seg[2]) + ' · 输出 ' + fmtTok(seg[3]) + '</p></section>' +
      '<div class="two-col" style="margin-top:14px">' +
      '<div><div class="sec-title">逐模型构成</div>' +
      (models.length === 1
        ? '<div class="stat" style="border-radius:14px"><div class="k mono" style="font-size:10px;white-space:normal;line-height:1.5">' + esc(models[0].key) + '</div><div class="v" style="font-size:16px;margin-top:6px">' + fmtTok(tokTotal(models[0].totals)) + ' <span style="font-size:12px;color:var(--text-2);font-weight:500">· ¥' + fmtCost(models[0].totals.cost) + '</span></div></div><p class="card-note" style="margin:6px 0 0">仅使用一个模型</p>'
        : models.length ? (function () {
          
          
          var msum = models.reduce(function (a, x) { return a + (x.totals.cost || 0); }, 0);
          return models.map(function (mo, i) {
            var mt = mo.totals || {};
            var pct = msum ? (mt.cost || 0) / msum : 0;
            return '<div class="rank"><div class="rank-line"><span class="rank-name" style="font-size:11.5px">' + esc(mo.key) + '</span>' +
              '<span class="rank-val">' + fmtTok(tokTotal(mt)) + '</span>' +
              '<span class="rank-pct">¥' + fmtCost(mt.cost) + '</span></div>' +
              '<div class="rank-bar"><i style="width:' + (Math.max(0, Math.min(100, pct * 100))).toFixed(1) + '%;background:' + modelColor(mo.key) + '"></i></div></div>';
          }).join('');
        })() : emptyHTML('暂无模型数据', '')) + '</div>' +
      '<div><div class="sec-title">上下文增长</div>' +
      '<div class="chart-wrap" id="dm-curve-wrap" style="height:132px"><canvas id="dm-curve" height="132" aria-label="上下文增长曲线"></canvas></div>' +
      '<p class="card-note" style="margin:6px 0 0">累计输入 token(含缓存)随请求增长</p></div></div>' +
      '<section class="card" style="margin-top:14px"><div class="card-head"><h2>逐请求时间线</h2></div>' +
      
      
      
      
      '<div class="chart-wrap" id="dm-stack-wrap" style="height:' + Math.max(72, Math.min(132, 16 + Math.min(reqs.length, 500) * 6)) + 'px"><canvas id="dm-stack" aria-label="逐请求时间线" style="width:100%"></canvas></div></section>' +
      '<section class="card" style="margin-top:14px;padding:0"><div style="max-height:320px;overflow:auto;border-radius:26px">' +
      '<table class="req"><thead><tr><th>#</th><th>时间</th><th>模型</th><th class="num">未命中</th><th class="num">命中</th><th class="num">写入</th><th class="num">输出</th><th class="num">推理</th><th class="num">累计输入</th><th class="num">成本 ¥</th><th>标记</th></tr></thead><tbody>' +
      reqs.slice(0, 600).map(function (r, i) {
        var f = d.flags && d.flags[i];
        return '<tr><td>' + (i + 1) + '</td><td class="muted" style="white-space:nowrap">' + fmtDate(r.t) + '</td>' +
          '<td class="mono" style="font-size:10px;max-width:130px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(r.m || '—') + '</td>' +
          '<td class="num">' + fmtTok(r.miss) + '</td><td class="num">' + fmtTok(r.read) + '</td><td class="num">' + fmtTok(r.write) + '</td><td class="num">' + fmtTok(r.out) + '</td>' +
          '<td class="num">' + fmtTok(r.r) + '</td><td class="num">' + fmtTok(r.cum) + '</td><td class="num">' + fmtCost(r.cost) + '</td>' +
          '<td>' + (f === 1 ? '<span class="pill hot" title="相对中位数的异常激增">' + FLAG_SVG + '激增</span>' : f === 2 ? '<span class="pill">中断</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (reqs.length > 600 ? '<p class="card-note" style="padding:10px 14px 0">仅显示前 600 条,共 ' + reqs.length + ' 条请求</p>' : '') +
      '</section>';
    $('detail-body').innerHTML = html;
    drawCurve(reqs);
    drawStack(reqs);
  }
  function drawCurve(reqs) {
    var cv = $('dm-curve');
    if (!cv || !reqs.length) return;
    var o = setupCanvas(cv, 132), g = o.g;
    var maxV = reqs[reqs.length - 1].cum || 1;
    var pad = { l: 6, r: 6, t: 8, b: 16 };
    var n = reqs.length;
    var xOf = function (i) { return pad.l + (o.w - pad.l - pad.r) * i / Math.max(1, n - 1); };
    var yOf = function (v) { return pad.t + (o.h - pad.t - pad.b) * (1 - v / maxV); };
    var hoverIdx = -1;
    var rgb = blueRgb();
    function frame() {
      g.clearRect(0, 0, o.w, o.h);
      drawAreaLine(g, n, xOf, function (i) { return yOf(reqs[i].cum || 0); }, rgb, { pad: pad, h: o.h }, { lineWidth: 2.2, lineJoin: 'round' });
      g.fillStyle = text3();
      g.font = AXIS_FONT;
      g.textAlign = 'center';
      var sameDay = n > 1 && dayKey(reqs[0].t) === dayKey(reqs[n - 1].t);
      if (sameDay) {

        var pts = [0, Math.floor((n - 1) / 2), n - 1];
        for (var pi = 0; pi < pts.length; pi++) {
          if (pi > 0 && pts[pi] === pts[pi - 1]) continue;
          g.textAlign = pts[pi] === 0 ? 'left' : pts[pi] === n - 1 ? 'right' : 'center';
          var lx = pts[pi] === 0 ? xOf(0) : pts[pi] === n - 1 ? xOf(n - 1) : xOf(pts[pi]);
          g.fillText(fmtTime(reqs[pts[pi]].t), lx, o.h - 4);
        }
      } else {
        var step = Math.max(1, Math.ceil(n / 8));
        for (var li = 0; li < n; li += step) g.fillText(fmtDate(reqs[li].t).split(' ')[0], xOf(li), o.h - 4);
      }
      g.textAlign = 'left';
      if (hoverIdx >= 0) {
        var hx = xOf(hoverIdx);
        g.strokeStyle = 'rgba(128,128,128,.4)';
        g.beginPath(); g.moveTo(hx, pad.t); g.lineTo(hx, o.h - pad.b); g.stroke();
        g.fillStyle = 'rgba(' + rgb.join(',') + ',1)';
        g.beginPath(); g.arc(hx, yOf(reqs[hoverIdx].cum || 0), 3, 0, Math.PI * 2); g.fill();
      }
    }
    frame();
    var onCurveMove = function (cx, cy) {
      var rect = cv.getBoundingClientRect();
      var idx = Math.round((cx - rect.left - pad.l) / ((o.w - pad.l - pad.r) / Math.max(1, n - 1)));
      if (idx < 0 || idx > n - 1) { if (hoverIdx >= 0) { hoverIdx = -1; frame(); hideTip(); } return; }
      if (idx !== hoverIdx) { hoverIdx = idx; frame(); }
      var r = reqs[idx];
      var prev = idx > 0 ? reqs[idx - 1].cum : 0;
      showTip(cx, cy,
        '<b># ' + (idx + 1) + ' · ' + esc(fmtDate(r.t)) + '</b>' +
        '<div class="row"><span>累计输入</span><span>' + fmtTok(r.cum) + '</span></div>' +
        '<div class="row"><span>本次增量</span><span>' + fmtTok(r.cum - prev) + '</span></div>' +
        '<div class="row"><span>成本</span><span>¥' + fmtCost(r.cost) + '</span></div>');
    };
    bindChartPointer(cv, onCurveMove, function () { hoverIdx = -1; frame(); hideTip(); });
  }
  function drawStack(reqs) {
    var cv = $('dm-stack');
    if (!cv || !reqs.length) return;
    var disp = reqs;
    if (reqs.length > 500) {
      disp = [];
      var stride = reqs.length / 500;
      for (var i = 0; i < 500; i++) disp.push(reqs[Math.floor(i * stride)]);
    }
    var cssH = Math.max(72, Math.min(132, 16 + disp.length * 6));
    var o = setupCanvas(cv, cssH), g = o.g;
    var maxV = 1;
    disp.forEach(function (r) { maxV = Math.max(maxV, tokTotal(r)); });
    maxV = maxV || 1;
    var pad = { l: 6, r: 6, t: 4, b: 4 };
    var bw = (o.w - pad.l - pad.r) / disp.length;
    var hoverIdx = -1;
    function frame() {
      g.clearRect(0, 0, o.w, o.h);
      for (var i = 0; i < disp.length; i++) {
        var r = disp[i];
        var parts = [r.miss || 0, r.read || 0, r.write || 0, r.out || 0];
        var tot = parts[0] + parts[1] + parts[2] + parts[3];
        if (tot <= 0) continue;
        var y = o.h - pad.b;
        var hTot = (o.h - pad.t - pad.b) * tot / maxV;
        var cols = ['--red', '--green', '--gray', '--blue'];
        for (var j = 0; j < 4; j++) {
          var hSeg = hTot * parts[j] / tot;
          if (hSeg <= 0) continue;
          g.fillStyle = cssVar(cols[j]) || 'rgba(10,132,255,.5)';
          g.globalAlpha = i === hoverIdx ? 1 : .82;
          g.fillRect(pad.l + bw * i + .5, y - hSeg, Math.max(1, bw - 1), hSeg);
          y -= hSeg;
        }
      }
      g.globalAlpha = 1;
    }
    frame();
    var onStackMove = function (cx, cy) {
      var rect = cv.getBoundingClientRect();
      var idx = Math.floor((cx - rect.left - pad.l) / bw);
      if (idx < 0 || idx > disp.length - 1) { if (hoverIdx >= 0) { hoverIdx = -1; frame(); hideTip(); } return; }
      if (idx !== hoverIdx) { hoverIdx = idx; frame(); }
      var r = disp[idx];
      var share = function (v, tot) { return tot > 0 ? (v / tot * 100).toFixed(1) + '%' : '0%'; };
      var tot = tokTotal(r);
      showTip(cx, cy,
        '<b>' + esc(fmtDate(r.t)) + (r.i ? ' · 中断' : '') + '</b>' +
        '<div class="row"><span>未命中</span><span>' + fmtTok(r.miss) + ' · ' + share(r.miss, tot) + '</span></div>' +
        '<div class="row"><span>缓存命中</span><span>' + fmtTok(r.read) + ' · ' + share(r.read, tot) + '</span></div>' +
        '<div class="row"><span>缓存写入</span><span>' + fmtTok(r.write) + ' · ' + share(r.write, tot) + '</span></div>' +
        '<div class="row"><span>输出</span><span>' + fmtTok(r.out) + ' · ' + share(r.out, tot) + '</span></div>' +
        '<div class="row"><span>累计输入</span><span>' + fmtTok(r.cum) + '</span></div>');
    };
    bindChartPointer(cv, onStackMove, function () { hoverIdx = -1; frame(); hideTip(); });
  }
