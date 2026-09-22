  function renderSessions() {
    var body = $('sessions-body');
    var all = state.sessionsList || [];
    var q = state.search.trim().toLowerCase();

    var items = all;
    if (!items.length) {

      body.innerHTML = emptyHTML(
        q ? raw(tpl`没有匹配"${state.search}"的会话`) : '当前筛选下没有会话',
        q ? '换个关键词试试' : '尝试放宽时间或模型筛选'
      );
      return;
    }
    var html = '';
    items.forEach(function (it) { html += sessionRow(it); });
    body.innerHTML = html;
    bindSessionRows(body);
  }
