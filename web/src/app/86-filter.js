  function fCount() {
    var n = 0;
    if (state.models.length) n++;
    if (state.session) n++;
    if (state.wd) n++;

    if (state.range === 'custom' && state.from && state.to) n++;
    return n;
  }
  function openSheet() {
    var html =
      '<div class="overlay" role="presentation">' +
      '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-t">' +
      '<div class="grabber" aria-hidden="true"></div>' +
      '<div class="tt" id="sheet-t">筛选</div>' +
      '<div class="tt-sub">筛选将写入链接,可分享;作用于所有页面</div>' +
      '<div class="slist">' +
      '<div class="srow2"><span class="l">会话前缀</span><span class="c"><input class="inp" id="sh-session" placeholder="会话 ID 前缀…" value="' + esc(state.session) + '" style="width:200px"></span></div>' +
      '<div class="srow2"><span class="l">工作目录</span><span class="c"><input class="inp" id="sh-wd" placeholder="路径前缀…" value="' + esc(state.wd) + '" style="width:200px"></span></div>' +
      '<div class="srow2" style="display:block;border-bottom:0"><span class="l">模型</span>' +
      '<div class="maxh" style="margin-top:8px" id="sh-models"></div></div>' +
      '</div>' +
      '<div class="foot">' +
      '<button class="btn sm ghost" id="sh-clear">清除全部</button>' +
      '<button class="btn sm primary" id="sh-apply">应用</button></div>' +
      '</div></div>';
    $('sheet-root').innerHTML = html;
    sheetOpen = true;
    var list = $('sh-models');
    var models = (state.meta && state.meta.models) || [];
    list.innerHTML = models.length ? models.map(function (mk, i) {
      var on = state.models.indexOf(mk) >= 0;
      return '<label class="chk"><input type="checkbox" value="' + esc(mk) + '"' + (on ? ' checked' : '') + '><i class="dot" style="background:' + modelColor(mk) + '"></i><span>' + esc(mk) + '</span></label>';
    }).join('') : '<div class="muted" style="padding:6px;font-size:12px">暂无模型</div>';
    
    
    var applyFilters = function (msg) {
      closeSheet();
      applyUI();
      loadTab(state.tab);
      toast(msg);
    };
    $('sh-apply').onclick = function () {
      state.session = $('sh-session').value.trim();
      state.wd = $('sh-wd').value.trim();
      state.models = Array.prototype.slice.call(list.querySelectorAll('input')).filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
      applyFilters('筛选已应用');
    };
    $('sh-clear').onclick = function () {
      state.session = ''; state.wd = ''; state.models = [];
      applyFilters('已清除全部筛选');
    };
    
    
    var first = $('sh-session');
    if (first) first.focus();
    var sheetEl = document.querySelector('.sheet');
    if (sheetEl) sheetEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var f = sheetEl.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      var firstEl = f[0], lastEl = f[f.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    });
    document.querySelectorAll('.overlay').forEach(function (bg) {
      bg.onclick = function (e) { if (e.target === bg) closeSheet(); };
    });
    document.addEventListener('keydown', onSheetKey);
  }
  function onSheetKey(e) {
    if (!sheetOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); }
  }
  function closeSheet() {
    sheetOpen = false;
    document.removeEventListener('keydown', onSheetKey);
    $('sheet-root').innerHTML = '';
    hideTip();
    
    var opener = document.querySelector('.navbar [data-act="filters"]');
    if (opener && typeof opener.focus === 'function') opener.focus();
  }
