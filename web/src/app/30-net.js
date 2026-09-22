  function qs(params) {
    var p = new URLSearchParams();
    if (params) for (var k in params) if (params[k] !== '' && params[k] != null) p.set(k, params[k]);
    var s = p.toString();
    return s ? '?' + s : '';
  }
  function get(path, params) {
    return fetch(API + path + qs(params), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(path + ' → ' + r.status);
      return r.json();
    });
  }
  function post(path, body) {
    return fetch(API + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}), cache: 'no-store'
    }).then(function (r) {
      if (!r.ok) throw new Error(path + ' → ' + r.status);
      return r.json();
    });
  }

  function filterPairs(rangeOverride) {
    var range = rangeOverride || state.range;
    var out = [['range', range]];
    if (range === 'custom' && state.from) out.push(['from', state.from]);
    if (range === 'custom' && state.to) out.push(['to', state.to]);
    if (state.models.length) out.push(['models', state.models.join(',')]);
    if (state.session) out.push(['session', state.session]);
    if (state.wd) out.push(['wd', state.wd]);
    return out;
  }
  var fParams = function (rangeOverride) {
    var p = {};
    filterPairs(rangeOverride).forEach(function (kv) { p[kv[0]] = kv[1]; });
    return p;
  };
  function escUrl() {
    var p = new URLSearchParams();
    
    if (state.tab !== 'today') p.set('tab', state.tab);
    
    filterPairs().forEach(function (kv) { if (kv[0] !== 'range' || kv[1] !== 'all') p.set(kv[0], kv[1]); });
    
    
    if (state.search) p.set('q', state.search);
    if (state.sSort && state.sSort !== 'recent') p.set('sort', state.sSort);
    history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p.toString() : ''));
  }
