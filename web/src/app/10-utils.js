  var API = '/dsh-token/api';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  /* ================= 结构化转义(0.9.4) =================
     背景:本页有近 40 处 innerHTML 赋值,而数据里**混着用户可控字符串** ——
     会话标题、工作目录、模型名、搜索词都源自本机会话日志。此前这些拼接点靠
     "每次都记得包 esc()" 保证安全:逐条核对过,现有代码没有漏(包括
     emptyHTML 内部对 title/sub 的转义),但那是**纪律**而不是**结构** ——
     下一个人新增一处 `+ m.title +` 就破了,而且不会有任何报错。

     这里给出两件工具,把纪律变成结构:

       tpl`…${x}…`   tagged template:插值**默认转义**,只有显式 raw() 才原样插入。
                      静态模板字面量里的标签(如 '<b>' + name + '</b>')继续原样;
                      要拼的是**值**,写 tpl`<b>${name}</b>` 就不可能忘。

       raw(s)         显式豁免:用于"已经是 HTML"(如 esc() 的返回值、SVG 图标常量、
                      或已由 emptyHTML/sessionRow 产出的片段)。命名带 raw 的意图是
                      让豁免在代码里**显眼**——审计时搜 raw( 就知道哪些地方是刻意的。

     注意 tpl`` 的第一个参数是 strings 数组(模板标签的固有形态),这里逐段拼接。 */
  var RAW = typeof Symbol === 'function' ? Symbol('dsh-token.raw') : '__dtk_raw__';
  /**
   * 显式豁免转义。返回值**带 toString()**,因此既能被 tpl`` 识别为"已是 HTML",
   * 也能直接参与普通字符串拼接(`'a' + raw(x)`)而不变成 "[object Object]" ——
   * 后者是这类包装最容易踩的坑:包装对象一参与 `+`,JS 就调 toString,
   * 于是整页会出现 "[object Object]" 而不是内容。
   */
  var markRaw = function (v) {
    var o = { v: v };
    o[RAW] = true;
    o.toString = function () { return v; };
    return o;
  };
  var raw = function (s) { return markRaw(s == null ? '' : String(s)); };
  /* 供 raw() 之外的地方判断(例如需要透传的辅助函数) */
  var isRaw = function (x) { return !!(x && typeof x === 'object' && x[RAW]); };
  /**
   * tpl`` —— 插值**默认转义**的 HTML 模板标签。
   *
   * 名字取 `tpl` 而不是 `html`:本页有近十处局部变量就叫 `html`(渲染函数里累积
   * 片段用的),叫 `html` 会被那些 `var html = …` **静默遮蔽**,表现为在某个函数里
   * `html\`…\`` 突然 "is not a function"。挑一个零碰撞的名字,把这类问题从
   * "靠记性避开"变成"结构上不会撞"(`grep tpl` 也能立刻列出所有模板点)。
   *
   * 返回值是一个**带标记的片段对象**(不是裸字符串),这一点很关键:
   *   · 嵌套时 `tpl`…${tpl`<i>${x}</i>`}…`` 内层不会被二次转义(否则用户会看到
   *     `&amp;lt;i&amp;gt;` 这种双重实体);
   *   · 参与 `+` 拼接或赋给 innerHTML 时靠 toString() 自动还原成字符串,所以
   *     调用方写法与以前完全一样,不需要知道它是个对象。
   * 数组按"片段列表"逐元素应用同一规则后连接 —— 否则 `tpl`${rows}`` 会把整个
   * 数组转义成一个逗号分隔的字符串。
   */
  var tpl = function (strings) {
    var out = strings[0];
    for (var i = 1; i < arguments.length; i++) {
      out += stringifyForHtml(arguments[i]) + strings[i];
    }
    return markRaw(out);
  };
  function stringifyForHtml(v) {
    if (isRaw(v)) return v.v;
    if (Array.isArray(v)) {
      var buf = [];
      for (var j = 0; j < v.length; j++) buf.push(stringifyForHtml(v[j]));
      return buf.join('');
    }
    return esc(v);
  }
  var fmtTok = function (n) {
    n = Number(n) || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(2) + ' B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + ' M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + ' K';
    return String(Math.round(n));
  };
  /* 计数(请求数/条数)专用:只加千分位,不做 K/M/B 量级缩写 ——
     "1.2 K 次请求"读起来像在描述用量,而它其实只是次数。 */
  var fmtNum = function (n) {
    n = Math.round(Number(n) || 0);
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };
  var fmtCost = function (n) {
    n = Number(n) || 0;
    if (n >= 1000) return n.toFixed(0);
    if (n > 0 && n < 0.01) return n.toFixed(4);
    return n.toFixed(2);
  };
  var fmtPct = function (x) { return ((Number(x) || 0) * 100).toFixed(1) + '%'; };
  var pad2 = function (n) { return String(n).padStart(2, '0'); };
  var fmtDate = function (ms) {
    if (!ms) return '—';
    var d = new Date(ms);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  };
  var dayKey = function (ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  };
  var shortKey = function (k) {
    var p = String(k).split('-');
    if (p.length < 3) return k;
    return (+p[1]) + '/' + (+p[2]);
  };
  var cssVar = function (name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || null; };
  var reduceMotion = function () { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; };
  /* 四段 Token 之和(与 host 的 tokenTotal 同口径)。原先这个表达式散落十余处,
     任何一处漏改都会让"某个数字和总额对不上",且不会报错。 */
  var tokTotal = function (t) { return t ? ((t.miss || 0) + (t.read || 0) + (t.write || 0) + (t.out || 0)) : 0; };
  /* 画布统一取色与字号:调色板缺值时的兜底原先在每个图表里各写一遍 */
  var text3 = function () { return cssVar('--text-3') || '#aeaeb2'; };
  var hairline2 = function () { return cssVar('--hairline-2') || 'rgba(0,0,0,.07)'; };
  var blueRgb = function () { return hexRgb(cssVar('--blue') || '#0a84ff'); };
  var AXIS_FONT = '9.5px -apple-system, sans-serif';
  /**
   * y 轴取"整齐刻度":把数据最大值抬到 1/2/5×10ⁿ 的整档,再用它当轴顶。
   * 原先是 `maxV * 1.14` 直接当刻度用 —— 于是网格线标出的是
   * "548.7 K / 1.14 M"这种没人会读的数字,而且没有 0 基线,柱高失去参照。
   *
   * 提到模块作用域:趋势图与 24 小时图**共用同一个轴口径**,否则两张图对"整齐"
   * 的理解会各自漂移(一个 500 K、另一个 548.7 K),读者没法横向比较。
   */
  function niceMax(v) {
    if (!(v > 0)) return 1;
    var mag = Math.pow(10, Math.floor(Math.log10(v)));
    var norm = v / mag;
    var step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return step * mag;
  }
  var FLAG_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.5.7c.9 2.5-.4 4.2-2 5.6-1.4 1.2-2.6 2.3-3.8 4.1C5.7 13.2 5 16 5.5 18.6 6.2 22.4 9.6 25 13.4 24.6c3.6-.4 6.3-3.3 6.4-6.9.1-2.1-.6-4.1-1.9-5.8-.5-.6-1.2-1.3-2-2 .2 1.6-.4 2.8-1.5 3.5.3-2-.9-3.9-1.5-5.4-.8-2.2-1-4.3.6-7.3z"/></svg>';
  var CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4.5 12.5 5 5 10-11"/></svg>';
  /* 右箭头"进入"指示:列表行里的小箭头比次级链接的略细(2.2 vs 2.4),
     两处都是既有效果,故各自成一个常量而不是硬凑成一个。 */
  var CHEV_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
  var CHEV_ROW_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
  /* 日历"上个月":与 CHEV_SVG 同一线宽,仅方向相反,故由它镜像而来而不是再抄一份路径 */
  var LEFT_SVG = CHEV_SVG.replace('m9 6 6 6-6 6', 'm15 6-6 6 6 6');
  /* 筛选 chip 上的"移除"叉(4 处逐字相同)。样式保持既有效果:2.6 / 圆头,
     不带 linejoin、不带 aria-hidden —— 与弹层里那个 2.4 的关闭叉是有意不同的两处。 */
  var X_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  /* 单个汉字的星期名(0=日)。高峰设置里的"高峰日"按钮和摘要文字都用它 ——
     原先这两处各写了一份字面量完全相同的表,改一处漏一处就会出现"选了周三、
     摘要写周四"。 */
  var WEEKDAY_CN = { 0: '日', 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六' };
  var fmtTime = function (ms) { if (!ms) return '—'; var d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
  /* 会话显示标题:自动生成标题 → 子代理标记 → 未命名 */
  function sessTitle(m) {
    m = m || {};
    if (m.title) return m.title;
    if (m.origin === 'subagent') return '子代理' + (m.delegationDepth ? ' L' + m.delegationDepth : '');
    return '未命名会话';
  }
  /* 副标题:预设/来源 · 工作区(cwd 尾段,不用编码目录名) */
  function sessSub(m) {
    m = m || {};
    var ws = m.cwd ? String(m.cwd).split(/[\\/]+/).filter(Boolean).pop() : (m.workspace || '');
    var bits = [];
    if (m.origin === 'subagent') bits.push('子代理' + (m.delegationDepth ? ' L' + m.delegationDepth : ''));
    else if (m.agentPreset) bits.push(m.agentPreset);
    if (ws) bits.push(ws);
    return bits.join(' · ');
  }
  /* 会话行的"🔥"标记:语义是**大体量会话**,与详情页的"异常激增"是两件事。
     此前两处都叫「激增」而判定完全不同(这里 requests≥5 且 ≥2M;详情页是
     max(150000, 2.5×中位数) 且需 ≥2 处),同一个词在同一产品里指两种东西。
     现在这里明确叫「大体量」并把阈值写进 title,扫一眼就知道它依据什么。 */
  var HOT_MIN_REQUESTS = 5;
  var HOT_MIN_TOKENS = 2000000;
  function sessionRow(it) {
    var t = it.totals || {}, m = it.meta || {};
    var total = tokTotal(t);
    var hot = (t.requests || 0) >= HOT_MIN_REQUESTS && total >= HOT_MIN_TOKENS;
    var sid = String((m.id || it.id) || '');
    /* 结构化转义:会话标题 / 副标题 / id 全部来自会话日志(用户可控),
       这里用 tpl`` 让它们**默认转义** —— 不再依赖"记得写 esc()"。
       id 仍先截断再插入(与原实现同序:原先是先 esc 再 slice,两者对纯 ASCII
       会话 id 等价;这里按"截断 → 转义"处理,截断不会切断实体)。 */
    var sidShort = sid.length > 18 ? sid.slice(0, 18) + '…' : sid;
    return tpl`<button class="grow-row" data-id="${it.id}">` +
      '<span class="sdot" style="background:' + dotColor(total) + '"></span>' +
      tpl`<span class="smain"><span class="sname">${sessTitle(m)}</span><span class="smeta">${sessSub(m)}${sessSub(m) ? ' · ' : ''}${sidShort} · ${fmtDate(it.lastTs)}</span></span>` +
      tpl`<span class="sval"><b>${fmtTok(total)}</b><span>¥${fmtCost(t.cost)} · ${fmtNum(t.requests || 0)} 请求</span></span>` +
      (hot ? raw('<span class="firebadge" title="大体量会话:请求数 ≥ ' + HOT_MIN_REQUESTS + ' 且总量 ≥ ' + fmtTok(HOT_MIN_TOKENS) + ' tokens">' + FLAG_SVG + '大体量</span>') : '') +
      raw('<span class="chev">' + CHEV_ROW_SVG + '</span></button>');
  }
  /* 会话行的点击接线原先在三处逐字重复;统一走这里,新加的列表不会再漏绑。 */
  function bindSessionRows(root) {
    if (!root) return;
    root.querySelectorAll('.grow-row').forEach(function (b) {
      b.onclick = function () { openDetail(this.getAttribute('data-id')); };
    });
  }
