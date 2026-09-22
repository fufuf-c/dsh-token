  var REFRESH_PAGE_CHOICES = [
    { v: 0, label: '关闭' },
    { v: 15, label: '15 秒' }, { v: 30, label: '30 秒' }, { v: 60, label: '1 分钟' },
    { v: 300, label: '5 分钟' }, { v: 900, label: '15 分钟' }, { v: 3600, label: '1 小时' }
  ];
  var REFRESH_SCAN_CHOICES = [
    { v: 0, label: '关闭' },
    { v: 60, label: '1 分钟' }, { v: 300, label: '5 分钟' }, { v: 900, label: '15 分钟' },
    { v: 1800, label: '30 分钟' }, { v: 3600, label: '1 小时' }, { v: 21600, label: '6 小时' }, { v: 86400, label: '24 小时' }
  ];

  function refreshOptions(choices, cur) {
    var has = choices.some(function (c) { return c.v === cur; });
    var list = has ? choices : choices.concat([{ v: cur, label: '当前 ' + refreshSecText(cur) }]);
    return list.map(function (c) {
      return '<option value="' + c.v + '"' + (c.v === cur ? ' selected' : '') + '>' + esc(c.label) + '</option>';
    }).join('');
  }
  function refreshSecText(sec) {
    if (!(sec > 0)) return '关闭';
    if (sec % 3600 === 0) return (sec / 3600) + ' 小时';
    if (sec % 60 === 0) return (sec / 60) + ' 分钟';
    return sec + ' 秒';
  }
  function refreshSettingsHTML(cfg) {
    var r = cfg.refresh || (function () {
      var src = (state.meta && state.meta.refresh) || {};
      return { pageSec: src.pageSec === undefined ? 60 : src.pageSec, scanSec: src.scanSec === undefined ? 300 : src.scanSec, onOpen: src.onOpen === undefined ? true : !!src.onOpen };
    })();
    var pageSec = Number(r.pageSec) || 0, scanSec = Number(r.scanSec) || 0;
    var onOpen = r.onOpen === undefined ? true : !!r.onOpen;
    return '' +
      '<div class="setrow stack"><span class="sl">页面自动刷新<em>重取已算好的数据,很轻</em></span>' +
      '<select class="inp sel" id="rf-page" aria-label="页面自动刷新间隔">' + refreshOptions(REFRESH_PAGE_CHOICES, pageSec) + '</select></div>' +
      '<div class="setrow stack"><span class="sl">后台扫描日志<em>重读会话日志,较慢(秒级)</em></span>' +
      '<select class="inp sel" id="rf-scan" aria-label="后台扫描间隔">' + refreshOptions(REFRESH_SCAN_CHOICES, scanSec) + '</select></div>' +
      '<div class="setrow"><span class="sl">进入界面时先扫一次<em>打开即见最新</em></span>' +
      '<button class="swbtn' + (onOpen ? ' on' : '') + '" id="rf-onopen" role="switch" aria-checked="' + (onOpen ? 'true' : 'false') + '" aria-label="进入界面时先扫描">' +
      '<i></i></button></div>';
  }

  function renderSettings() {
    var body = $('settings-body');
    var meta = state.meta || {}, cfg = state.config || {};
    var budget = cfg.budget && cfg.budget.monthly;
    var html = '';

    html += '<div class="gtitle">外观</div><section class="card group">' +
      '<div class="setrow"><span class="sl">主题</span>' +
      '<div class="seg sm seg-inline" id="theme-seg" role="group" aria-label="主题">' +
      '<button data-t="auto" class="' + (state.theme === 'auto' ? 'on' : '') + '">自动</button>' +
      '<button data-t="light" class="' + (state.theme === 'light' ? 'on' : '') + '">浅色</button>' +
      '<button data-t="dark" class="' + (state.theme === 'dark' ? 'on' : '') + '">深色</button></div></div>' +
      '<div class="setrow"><span class="sl">数据来源</span><span class="sv">仅本机 · 零上传</span></div></section>';

    html += '<div class="gtitle">月度预算</div><section class="card group">';
    if (budget) {
      var kM = state.kpiMonth;
      var used = kM ? kM.totals.cost : 0;
      var pct = Math.min(1, used / budget);
      var d = new Date();
      var dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      var projected = used / Math.max(1, d.getDate()) * dim;
      var over = projected > budget;
      var barColor = pct >= 1 ? 'var(--red)' : pct >= .8 ? 'var(--orange)' : 'var(--green)';
      html += '<div class="setrow"><span class="sl">预算</span><span class="sv">¥' + fmtCost(budget) + ' / 月</span></div>' +
        '<div class="setrow stack"><span class="sl">本月已花</span><span class="sv" style="color:var(--text)">¥' + fmtCost(used) + ' · ' + fmtPct(used / budget) + '</span>' +
        '<div class="budget-bar" style="flex-basis:100%"><i style="width:' + (pct * 100).toFixed(1) + '%;background:' + barColor + '"></i></div></div>' +
        '<div class="setrow"><span class="sl">外推月底</span><span class="sv">' + (over ? '<span style="color:var(--red);font-weight:600">超 ¥' + fmtCost(projected - budget) + '</span>' : '剩 ¥' + fmtCost(budget - projected)) + '</span></div>' +
        '<div class="setrow"><span class="sl">日均</span><span class="sv">¥' + fmtCost(used / Math.max(1, d.getDate())) + ' · 已过 ' + d.getDate() + '/' + dim + ' 天</span></div>';
    }
    
    
    html += '<div class="setrow" id="budget-edit-row" style="display:' + (state.budgetEditing ? 'flex' : 'none') + '"><span class="sl">月度预算 ¥</span>' +
      '<input class="inp" id="budget-input" type="number" min="0" step="10" style="width:96px;margin-left:auto;text-align:right" value="' + (budget || '') + '" placeholder="如 200">' +
      '<button class="btn sm primary" id="b-budget-save">保存</button>' +
      (budget ? '<button class="btn sm ghost" id="b-budget-clear">清除</button>' : '') + '</div>' +
      '<div class="setrow"><span class="sl grow"></span><button class="barrowbtn" id="b-budget-edit">' + (budget ? '调整' : '设置预算') +
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></button></div></section>';

    var priceView = settingsPricesHTML(state, meta, cfg);
    var models = priceView.models, allModels = priceView.allModels;
    html += priceView.html;

    html += '<div class="gtitle">刷新</div><section class="card group">' +
      refreshSettingsHTML(cfg) + '</section>' +
      '<div class="gtitle">数据</div><section class="card group">' +
      '<div class="setrow"><span class="sl">增量扫描会话日志</span><button class="btn sm primary" id="b-scan" style="margin-left:auto">扫描</button></div>' +
      '<div class="setrow"><span class="sl">导出日 × 模型明细</span><button class="btn sm ghost" id="b-export-csv" style="margin-left:auto">CSV</button></div>' +
      '<div class="setrow"><span class="sl">导出逐请求明细</span><button class="btn sm ghost" id="b-export-json" style="margin-left:auto">JSON</button></div></section>';

    var s = meta.stats || {}, ls = s.lastSummary || {};
    html += '<div class="gtitle">关于</div><section class="card group">' +
      '<div class="setrow stack"><span class="sl">数据源</span><span class="sv mono">' + esc(meta.sessionsRoot || '—') + '</span></div>' +
      '<div class="setrow stack"><span class="sl">聚合缓存</span><span class="sv mono">' + esc(meta.storeFile || '—') + '</span></div>' +
      '<div class="setrow"><span class="sl">会话 / 请求</span><span class="sv">' + esc(meta.sessionCount) + ' / ' + esc(meta.requestCount) + '</span></div>' +
      '<div class="setrow"><span class="sl">覆盖范围</span><span class="sv">' + esc(meta.dayCount) + ' 天 · ' + esc(meta.monthCount) + ' 个月</span></div>' +
      '<div class="setrow"><span class="sl">最近扫描</span><span class="sv">' + (s.lastScanAt ? fmtDate(s.lastScanAt) + ' · ' : '') + (ls.durationMs || 0) + ' ms · 变更 ' + (ls.changed || 0) + '/' + (ls.totalSessions || 0) + '</span></div>' +
      '<div class="setrow"><span class="sl">扫描累计</span><span class="sv">全量 ' + (s.fullScans || 0) + ' · 增量 ' + (s.incrementalScans || 0) + ' · 失败 ' + (s.failedSessions || 0) + '</span></div>' +
      '<div class="setrow stack"><span class="sl">模型(' + (models.length === allModels.length ? models.length : models.length + ' / ' + allModels.length) + ')</span><span class="sv" style="font-size:11px">' + models.map(esc).join(' · ') + '</span></div>' +
      '<div class="setrow"><span class="sl">版本</span><span class="sv">' + (meta.version ? 'v' + esc(meta.version) : '—') + '</span></div></section>';

    // 数据完整性:隔离清单。服务端一直在 meta 里报(quarantinedCount / quarantined),
    // 但页面从来没显示过 —— 于是"有些会话统计不到"这件事对用户完全不可见,而这正是
    // README 说"可在设置页看到"的那一项。
    var quar = meta.quarantined || [];
    var quarTotal = Number(meta.quarantinedCount) || 0;
    if (quarTotal > 0) {
      // 服务端最多回 50 条(QUARANTINE_REPORT_LIMIT)。超出时必须把总数说清楚,
      // 否则用户会以为"就这 50 个"。
      var truncated = quarTotal > quar.length;
      html += '<div class="gtitle">数据完整性</div><section class="card group">' +
        '<div class="setrow stack"><span class="sl">被跳过的会话 ' + esc(String(quarTotal)) + ' 个</span>' +
        '<span class="sv" style="font-size:11px;line-height:1.6">这些会话日志连 DSH 自身都拒绝解码(常见于 v0 老日志),' +
        '插件只能跳过并保留它们<b>上一次成功扫描</b>的统计,不会静默清零。' +
        '它们会在冷却窗口后自动重试,也可以点上面「扫描」立刻重试。</span></div>';
      for (var qi = 0; qi < quar.length; qi++) {
        var q = quar[qi] || {};
        var when = q.at ? fmtDate(q.at) : '—';
        html += '<div class="setrow stack"><span class="sl mono" style="font-size:11px">' + esc(q.id || '—') + '</span>' +
          '<span class="sv" style="font-size:11px;line-height:1.6">' + esc(q.name || 'Error') +
          ' · ' + esc(when) + ' · 命中 ' + esc(String(q.hits || 1)) + ' 次<br>' +
          // 隔离消息来自宿主解码器的报错文本,同样是本机外部数据 —— 必须转义,不得 raw()。
          esc(q.message || '—') + '</span></div>';
      }
      if (truncated) {
        html += '<div class="setrow"><span class="sl">仅列出前 ' + esc(String(quar.length)) + ' 个</span>' +
          '<span class="sv">共 ' + esc(String(quarTotal)) + ' 个</span></div>';
      }
      html += '</section>';
    }

    body.innerHTML = html;
    segSyncAll(body);

    bindSettingsTheme(body);
    bindSettingsBudget(body);
    bindSettingsPrices(body);
    bindSettingsPeak(cfg);
    bindSettingsRefresh(body);
    bindSettingsActions(body);
    syncNavChrome();
  }

  
  
  
  
  
  function settingsPricesHTML(state, meta, cfg) {
    var prices = cfg.prices || {};
    
    
    
    var hasDefaults = !!(cfg.defaults && typeof cfg.defaults === 'object');
    var defaults = hasDefaults ? cfg.defaults : {};
    var allModels = meta.models || [];
    
    var configured = meta.configuredModels;
    var filterOn = !!(configured && ((configured.exact || []).length + (configured.byId || []).length));
    var exactSet = {}, byIdSet = {};
    if (configured) {
      (configured.exact || []).forEach(function (k) { exactSet[k] = 1; });
      (configured.byId || []).forEach(function (k) { byIdSet[k] = 1; });
    }
    var isConfigured = function (mk) {
      if (!filterOn) return true;
      if (exactSet[mk]) return true;
      var i = mk.indexOf(':');
      return !!byIdSet[i >= 0 ? mk.slice(i + 1) : mk];
    };
    var inUseModels = allModels.filter(function (mk) { return isConfigured(mk) || prices[mk]; });
    var models = (state.modelsAll || !filterOn) ? allModels : inUseModels;
    var hiddenN = allModels.length - inUseModels.length;
    var showToggle = filterOn && (hiddenN > 0 || state.modelsAll);

    var html = '<div class="gtitle">模型单价 · ¥ / 1M tokens</div><section class="card group">';
    
    html += '<div class="sl" style="font-size:12px;color:var(--text-2);line-height:1.6;padding:2px 0 8px">' +
      '单价按<b>时段</b>浮动:高峰与空闲分别计价。留空即用该模型的内置价;<b>高峰时段/高峰日只是当前官方策略,可自行修改</b>,改动会立刻重算全部历史成本。</div>';
    
    
    
    var hasSchedule = hasDefaults && !!(cfg.defaultsSchedule && Array.isArray(cfg.defaultsSchedule.hours));
    if (hasSchedule) {
      var DAY_ORDER = [1, 2, 3, 4, 5, 6, 0], DAY_LABEL = WEEKDAY_CN;
      var sel = peakSelOf(cfg.schedule), selH = sel.selH, selD = sel.selD;
      var daysHTML = DAY_ORDER.map(function (d) {
        return '<button data-d="' + d + '" class="' + (selD[d] ? 'on' : '') + '" aria-pressed="' + (selD[d] ? 'true' : 'false') + '" aria-label="周' + DAY_LABEL[d] + '">' + DAY_LABEL[d] + '</button>';
      }).join('');
      var hoursHTML = '';
      for (var h = 0; h < 24; h++) {
        hoursHTML += '<button data-h="' + h + '" class="' + (selH[h] ? 'on' : '') + '" aria-pressed="' + (selH[h] ? 'true' : 'false') + '" aria-label="' + pad2(h) + ':00 高峰">' + h + '</button>';
      }
      html += '<div class="setrow stack"><span class="sl">高峰日</span>' +
        '<div class="fill daychips" id="peak-days" role="group" aria-label="高峰日">' + daysHTML + '</div></div>' +
        '<div class="setrow stack"><span class="sl">高峰时段<em>北京时间,按小时点选</em></span>' +
        '<div class="fill hrgrid" id="peak-hours" role="group" aria-label="高峰时段">' + hoursHTML + '</div>' +
        
        '<div class="fill peak-sum" id="peak-summary">' + peakSummaryText(selH, selD) + '</div></div>' +
        '<div class="setrow"><span class="sl">快捷</span>' +
        '<div class="peak-presets">' +
        '<button id="peak-preset-official">官方默认</button>' +
        '<button id="peak-preset-all">全天</button>' +
        '<button id="peak-preset-none">清空</button></div></div>';
    }
    if (!models.length) html += emptyHTML('没有需要配置单价的模型', allModels.length ? '当前配置里的模型都还没有用量记录' : '');
    else {
      models.forEach(function (mk) {
        var e = prices[mk] || null, d = defaults[mk] || null;
        var pk = (e && e.peak) || {}, idl = (e && e.idle) || {};
        var ph = function (t, f) { return d ? String(d[t][f]) : ''; };
        var pill = e ? '<span class="pill">自定义</span>'
          : (!hasDefaults || d) ? '<span class="pill" style="opacity:.6">官方价</span>'
          : '<span class="pill" style="opacity:.6">未定价 · 按 ¥0 计</span>';
        var tierRow = function (t, name, vals) {
          return '<div class="pgrid"><span class="ptag">' + name + '</span>' +
            pcell(mk, t, 'miss', '未命中', vals.miss, ph(t, 'miss')) + pcell(mk, t, 'hit', '命中', vals.hit, ph(t, 'hit')) +
            pcell(mk, t, 'write', '写入', vals.write, ph(t, 'write')) + pcell(mk, t, 'output', '输出', vals.output, ph(t, 'output')) +
            '</div>';
        };
        html += '<div class="prow"><div class="phead"><span class="pmodel mono">' + esc(mk) + '</span>' + pill + '</div>' +
          tierRow('peak', '高峰', pk) + tierRow('idle', '空闲', idl) + '</div>';
      });
    }
    var priceNote = !allModels.length ? ''
      : !filterOn ? '读不到 DSH 模型配置,已显示全部 ' + allModels.length + ' 个'
      : state.modelsAll ? '显示全部 ' + allModels.length + ' 个模型'
      : hiddenN > 0 ? '已隐藏 ' + hiddenN + ' 个已不再配置的模型'
      : '全部 ' + allModels.length + ' 个模型都还在配置里';
    html += '<div class="setrow">' +
      '<span class="sl" style="flex:1;min-width:0;font-size:12px;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(priceNote) + '</span>' +
      (showToggle ? '<button class="barrowbtn" id="b-models-all">' + (state.modelsAll ? '只看配置中的' : '显示全部 (' + allModels.length + ')') + '</button>' : '') +
      '<button class="barrowbtn" id="b-price-reset">恢复官方价</button></div></section>';
    return { html: html, allModels: allModels, models: models };
  }

  function bindSettingsRefresh(body) {
    var apply = function (patch) {
      return post('/config', { refresh: patch }).then(function (c) {
        state.config = c;
        if (state.meta && c && c.refresh) state.meta.refresh = c.refresh;
        
        
        
        if (c && c.refresh) {
          try { localStorage.setItem('dsh-token-refresh-onopen', c.refresh.onOpen ? '1' : '0'); } catch (e) {  }
        }
        startAutoRefresh();          
        renderSettings();            
      }).catch(function (e) { toast('保存失败:' + e.message); });
    };
    var ps = $('rf-page'), ss = $('rf-scan');
    if (ps) ps.onchange = function () { apply({ pageSec: Number(this.value) }); };
    if (ss) ss.onchange = function () { apply({ scanSec: Number(this.value) }); };
    var oo = $('rf-onopen');
    if (oo) oo.onclick = function () {
      var next = !(this.getAttribute('aria-checked') === 'true');
      this.classList.toggle('on', next);
      this.setAttribute('aria-checked', next ? 'true' : 'false');
      apply({ onOpen: next });
    };
  }

  function bindSettingsTheme(body) {
    body.querySelectorAll('#theme-seg button').forEach(function (b) {
      b.onclick = function (e) {
        state.theme = b.getAttribute('data-t');
        localStorage.setItem('dsh-token-theme', state.theme === 'auto' ? '' : state.theme);
        applyTheme(true, e.clientX, e.clientY);
        var seg = $('theme-seg');
        seg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
        segSync(seg);
        toast(themeToastText());
      };
    });
  }

  function bindSettingsBudget(body) {
    var editRow = $('budget-edit-row');
    $('b-budget-edit').onclick = function () {
      state.budgetEditing = !state.budgetEditing;
      editRow.style.display = state.budgetEditing ? 'flex' : 'none';
      if (state.budgetEditing) { var bi = $('budget-input'); if (bi) bi.focus(); }
      segSyncAll(body);
    };
    $('b-budget-save').onclick = function () {
      var v = Number($('budget-input').value);
      if (!(v > 0)) { toast('请输入大于 0 的预算金额'); return; }
      
      post('/config', { budget: { monthly: v } }).then(function () {
        state.budgetEditing = false;
        toast('预算已保存 ¥' + v);
        loadTab(state.tab);
      }).catch(function (e) { toast('保存失败: ' + e.message); });
    };
    var clearBtn = $('b-budget-clear');
    if (clearBtn) clearBtn.onclick = function () {
      post('/config', { budget: { monthly: 0 } }).then(function () {
        state.budgetEditing = false;
        toast('已取消月度预算');
        loadTab('settings');
      }).catch(function (e) { toast('保存失败: ' + e.message); });
    };
  }

  function bindSettingsPrices(body) {
    var priceTimer = null;
    body.querySelectorAll('.prow input').forEach(function (inp) {
      
      
      inp.oninput = function () {
        if (!state.priceDraft) state.priceDraft = {};
        state.priceDraft[inp.getAttribute('data-m') + '|' + inp.getAttribute('data-t') + '|' + inp.getAttribute('data-f')] = inp.value;
      };
      inp.onchange = function () {
        if (priceTimer) clearTimeout(priceTimer);
        priceTimer = setTimeout(function () {
          var prev = (state.config || {}).prices || {};
          var next = JSON.parse(JSON.stringify(prev));
          
          var rendered = {};
          body.querySelectorAll('.prow input').forEach(function (i2) { rendered[i2.getAttribute('data-m')] = 1; });
          Object.keys(rendered).forEach(function (m) { delete next[m]; });
          body.querySelectorAll('.prow input').forEach(function (i2) {
            var v = i2.value.trim();
            if (v === '') return;
            var n = Number(v);
            if (!isFinite(n) || n < 0) return;
            var m = i2.getAttribute('data-m'), t = i2.getAttribute('data-t'), f = i2.getAttribute('data-f');
            var e = next[m] || (next[m] = { peak: {}, idle: {} });
            e[t][f] = n;
          });
          Object.keys(rendered).forEach(function (m) {
            var e = next[m];
            if (!e) { if (prev[m]) next[m] = null; return } 
            
            if (!Object.keys(e.peak).length) e.peak = e.idle;
            if (!Object.keys(e.idle).length) e.idle = e.peak;
            if (!Object.keys(e.peak).length) delete next[m];
          });
          post('/config', { prices: next }).then(function () {
            toast('单价已保存');
            
            state.priceDraft = null;
            get('/config').then(function (c) { state.config = c; });
          }).catch(function (e) { toast('保存单价失败: ' + e.message); });
        }, 400);
      };
    });
  }

  function bindSettingsPeak(cfg) {
    
    var hGrid = $('peak-hours'), dGrid = $('peak-days');
    if (hGrid && dGrid && cfg.schedule) {
      
      var sel = peakSelOf(cfg.schedule), selH = sel.selH, selD = sel.selD;
      var sumEl = $('peak-summary');
      var peakTimer = null;
      var peakPush = function () {
        if (sumEl) sumEl.innerHTML = peakSummaryText(selH, selD);
        if (peakTimer) clearTimeout(peakTimer);
        peakTimer = setTimeout(function () {
          post('/config', { peakHours: peakRangesOf(selH), peakDays: peakDaysOf(selD) })
            .then(function (c) { state.config = c; toast('高峰时段已更新,历史成本已重算'); })
            .catch(function (e) { toast('保存失败: ' + e.message); });
        }, 500);
      };
      var peakToggle = function (btn, attr, sel) {
        btn.onclick = function () {
          var v = Number(btn.getAttribute(attr));
          var on = !sel[v];
          if (on) sel[v] = 1; else delete sel[v];
          btn.classList.toggle('on', on);
          btn.setAttribute('aria-pressed', on ? 'true' : 'false');
          peakPush();
        };
      };
      hGrid.querySelectorAll('button').forEach(function (b) { peakToggle(b, 'data-h', selH); });
      dGrid.querySelectorAll('button').forEach(function (b) { peakToggle(b, 'data-d', selD); });
      
      var peakPreset = function (hours, days) {
        Object.keys(selH).forEach(function (k) { delete selH[k]; });
        Object.keys(selD).forEach(function (k) { delete selD[k]; });
        hours.forEach(function (r) { for (var i = r[0]; i < r[1]; i++) selH[i] = 1; });
        days.forEach(function (d) { selD[d] = 1; });
        hGrid.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', !!selH[Number(b.getAttribute('data-h'))]); });
        dGrid.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', !!selD[Number(b.getAttribute('data-d'))]); });
        peakPush();
      };
      var pOfficial = $('peak-preset-official'), pAll = $('peak-preset-all'), pNone = $('peak-preset-none');
      if (pOfficial) pOfficial.onclick = function () { var ds = cfg.defaultsSchedule || {}; peakPreset(ds.hours || [], ds.days || []); };
      if (pAll) pAll.onclick = function () { peakPreset([[0, 24]], [0, 1, 2, 3, 4, 5, 6]); };
      if (pNone) pNone.onclick = function () { peakPreset([], []); };
      peakPush();
    }
  }

  function bindSettingsActions() {
    var modelsAllBtn = $('b-models-all');
    if (modelsAllBtn) modelsAllBtn.onclick = function () {
      state.modelsAll = !state.modelsAll;
      renderSettings();
    };
    $('b-price-reset').onclick = function () {
      post('/config', { prices: null, resetPrices: true }).then(function () {
        toast('已恢复官方价');
        get('/meta').then(function (m) { state.meta = m; });
        loadTab('settings');
      }).catch(function (e) { toast('重置失败:' + e.message); });
    };
    $('b-scan').onclick = function () {
      var btn = this;
      btn.disabled = true;
      post('/scan', {}).then(function (r) {
        btn.disabled = false;
        var s2 = r && r.summary ? r.summary : r;
        var msg = s2 && s2.note ? s2.note : ('变更 ' + (s2 && s2.changed != null ? s2.changed : 0) + ' / ' + (s2 && s2.totalSessions != null ? s2.totalSessions : 0) + ' 会话');
        toast('扫描完成:' + msg);
        loadTab('settings');
      }).catch(function (e) { btn.disabled = false; toast('扫描失败:' + e.message); });
    };

    $('b-export-csv').onclick = function () { download(API + '/export.csv?' + new URLSearchParams(fParams()).toString(), 'dsh-token-daily-model.csv'); };
    $('b-export-json').onclick = function () { download(API + '/export.json?' + new URLSearchParams(fParams()).toString(), 'dsh-token-requests.json'); };
  }

  function peakSelOf(sched) {
    var s = sched || {};
    var selH = {}, selD = {};
    (s.hours || []).forEach(function (r) { for (var i = r[0]; i < r[1]; i++) selH[i] = 1; });
    (s.days || []).forEach(function (d) { selD[d] = 1; });
    return { selH: selH, selD: selD };
  }

  function peakRangesOf(selH) {
    var out = [], h = 0;
    while (h < 24) {
      if (!selH[h]) { h++; continue }
      var a = h;
      while (h < 24 && selH[h]) h++;
      out.push([a, h]);
    }
    return out;
  }
  function peakDaysOf(selD) {
    return Object.keys(selD).map(Number).sort(function (a, b) { return a - b; });
  }
  function peakDaysText(days) {
    if (!days.length) return '';
    if (days.length === 7) return '每天';
    if (days.join(',') === '1,2,3,4,5') return '工作日';
    return '周' + days.map(function (d) { return WEEKDAY_CN[d]; }).join('、');
  }

  function peakSummaryText(selH, selD) {
    var hrs = peakRangesOf(selH), days = peakDaysOf(selD);
    if (!hrs.length || !days.length) return '当前没有高峰时段 —— 全部用量都按<b>空闲价</b>计。';
    var t = hrs.map(function (r) { return pad2(r[0]) + ':00–' + pad2(r[1]) + ':00'; }).join('、');
    var n = hrs.reduce(function (s, r) { return s + (r[1] - r[0]); }, 0) * days.length;
    return '<b>' + peakDaysText(days) + '</b> ' + t + ' 为高峰 · 每周 <b>' + n + ' 小时</b> · 北京时间';
  }
  function pcell(mk, tier, f, label, val, ph) {
    
    
    
    var draft = state.priceDraft && state.priceDraft[mk + '|' + tier + '|' + f];
    var shown = draft != null ? draft : val;
    return '<label class="pcell"><em>' + label + '</em><input class="inp" data-m="' + esc(mk) + '" data-t="' + tier + '" data-f="' + f + '" value="' + esc(shown != null ? shown : '') + '" placeholder="' + esc(ph) + '" aria-label="' + esc(mk) + (tier === 'peak' ? ' 高峰' : ' 空闲') + label + '单价"></label>';
  }
  function download(url, name) {
    fetch(url, { cache: 'no-store' }).then(function (r) {
      if (r.ok) return r.text();
      
      
      return r.text().then(function (t) {
        var msg = '';
        try { msg = (JSON.parse(t) || {}).error || ''; } catch (e) {  }
        throw new Error(msg || ('HTTP ' + r.status));
      });
    }).then(function (t) {
      var blob = new Blob([t], { type: 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
    }).catch(function (e) { toast('导出失败:' + e.message); });
  }
