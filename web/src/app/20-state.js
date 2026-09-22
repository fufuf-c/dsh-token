  var state = {
    tab: 'today',
    range: 'all', from: '', to: '',
    models: [], session: '', wd: '',
    metric: 'tokens', granularity: 'day', hourMetric: 'tokens',
    hmMetric: 'tokens', sSort: 'recent',
    search: '',
    theme: localStorage.getItem('dsh-token-theme') || 'auto',
    hidden: {}, stkSel: null, modelsAll: false,

    rpOpen: false,
    meta: null, config: null,
    today: null, hoursToday: null, sessToday: null,
    kpiAct: null, _series: null, _hours: null, _heat: null,
    costTop: null, sessionsList: null,
    kpiMonth: null,
    pushed: false,

    detail: null,

    priceDraft: null,
    budgetEditing: false,
  };
  var RANGE_LABELS = { today: '今天', '3d': '近 3 天', '7d': '近 7 天', '30d': '近 30 天', month: '本月', all: '全部时间', custom: '自定义' };
  var CATS = [
    { key: 'read', label: '缓存命中', css: '--green' },
    { key: 'miss', label: '未命中', css: '--red' },
    { key: 'out', label: '输出', css: '--blue' },
    { key: 'write', label: '缓存写入', css: '--gray' }
  ];
