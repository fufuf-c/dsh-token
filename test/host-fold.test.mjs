/**
 * dsh-token — 数据层单元测试(node:test,零依赖)
 * 覆盖:事件折叠(四段 Token/模型归属/去重/去重键回退)、派生重建、KPI、筛选、
 *       CSV/JSON 导出、价格覆盖与重置、聚合快路径与逐记录路径等价、
 *       parseQuery(URLSearchParams 口径)、配置补丁(retention/webPagePath 校验)。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyStore, foldSession, rebuildAll, applyConfigPatch, makeFilter, parseQuery,
  kpiQuery, seriesQuery, hoursQuery, heatmapQuery, sessionsQuery, sessionDetailQuery,
  exportCsv, exportJson, dayKeyOf, aggregatesReady, extractSessionInfo,
} from '../lib/core.mjs'

const T = 1787632311372 // 2026-08-25 (本地时区),仅用于归日照常
const DAY1 = '2026-08-25'
const DAY2 = '2026-08-26'

/** 数值容差比较:快路径与慢路径的浮点累加顺序不同,允许 1e-9 相对误差 */
function approx(a, b, eps = 1e-9, path = '$') {
  if (typeof a === 'number' && typeof b === 'number') {
    assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b)), `${path}: ${a} != ${b}`)
    return
  }
  if (a === null || b === null || a === undefined || b === undefined || typeof a !== 'object' || typeof b !== 'object') {
    assert.equal(a, b, path)
    return
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    assert.ok(Array.isArray(a) && Array.isArray(b), path)
    assert.equal(a.length, b.length, `${path}.length`)
    for (let i = 0; i < a.length; i++) approx(a[i], b[i], eps, `${path}[${i}]`)
    return
  }
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort()
  assert.deepEqual(ka, kb, `${path}.keys`)
  for (const k of ka) approx(a[k], b[k], eps, `${path}.${k}`)
}

function session(id, cwd = 'C:\\work') {
  return {
    id,
    meta: { id, createdAt: T, cwd, parentSession: null, origin: null, delegationDepth: null, agentPreset: null, workspace: '--C-work--' },
    firstTs: T, lastTs: T,
  }
}

function eventsFor(model = 'deepseek-chat', provider = 'deepseek-official') {
  return [
    { type: 'request/header', seq: 1, time: T, data: { header: { config: { provider, model } } } },
    { type: 'request/context', seq: 2, time: T, data: { provider, model } },
    // 约定 A:inputTokens 已含缓存读(Anthropic 型) → miss = input - read
    { type: 'assistant/message', seq: 3, time: T + 1000, data: { turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 300, cacheWriteTokens: 0 } } },
    // 约定 B:inputTokens 不含缓存读(DeepSeek 型) → floor 保护
    { type: 'assistant/message', seq: 4, time: T + 2000, data: { turn: 1, step: 2, usage: { inputTokens: 200, outputTokens: 30, cacheReadTokens: 4000, reasoningTokens: 10 } } },
    // 同 turn/step 重复 → 去重
    { type: 'assistant/message', seq: 5, time: T + 3000, data: { turn: 1, step: 1, usage: { inputTokens: 99999, outputTokens: 999, cacheReadTokens: 999, cacheWriteTokens: 999 } } },
    // 无 usage → 跳过
    { type: 'assistant/message', seq: 6, time: T + 4000, data: { turn: 1, step: 3, message: { role: 'assistant', content: [] }, source: {} } },
  ]
}

function buildStore() {
  const store = emptyStore()
  store.sessionsRoot = 'C:\\Users\\x\\.dsh\\sessions'
  store.storeFile = 'C:\\Users\\x\\.dsh\\dsh-token\\store.json'
  store.sessions['a'] = session('a')
  store.sessions['b'] = session('b', 'C:\\other')
  store.requests['a'] = [
    { seq: 3, t: T + 1000, m: 'deepseek-official:deepseek-chat', miss: 700, read: 300, write: 0, out: 50, r: 0, i: 0 },
    { seq: 4, t: T + 2000, m: 'deepseek-official:deepseek-chat', miss: 200, read: 4000, write: 0, out: 30, r: 10, i: 0 },
  ]
  store.requests['b'] = [
    { seq: 8, t: T + 80000000 + 1000, m: 'openrouter:ox-alpha', miss: 111, read: 0, write: 0, out: 9, r: 0, i: 0 },
    { seq: 9, t: T + 80000000 + 2000, m: 'openrouter:ox-alpha', miss: 222, read: 11, write: 0, out: 7, r: 0, i: 1 },
  ]
  rebuildAll(store)
  return store
}

test('foldSession: 四段分解、模型归属、去重', () => {
  const recs = foldSession(eventsFor())
  assert.equal(recs.length, 2)
  assert.deepEqual(
    { miss: recs[0].miss, read: recs[0].read, write: recs[0].write, out: recs[0].out },
    { miss: 700, read: 300, write: 0, out: 50 },
  )
  // 约定 B:input(200) < cacheRead(4000) → floor 后 miss=200,read 保留 4000
  assert.deepEqual(
    { miss: recs[1].miss, read: recs[1].read, out: recs[1].out, r: recs[1].r },
    { miss: 200, read: 4000, out: 30, r: 10 },
  )
  assert.equal(recs[0].m, 'deepseek-official:deepseek-chat')
})

test('foldSession: 缺 turn/step 时回退 seq 去重,不误折叠', () => {
  const events = [
    { type: 'request/header', seq: 1, time: T, data: { header: { config: { provider: 'x', model: 'y' } } } },
    { type: 'assistant/message', seq: 2, time: T + 1000, data: { usage: { inputTokens: 100, outputTokens: 1 } } },
    { type: 'assistant/message', seq: 3, time: T + 2000, data: { usage: { inputTokens: 200, outputTokens: 2 } } },
  ]
  const recs = foldSession(events)
  assert.equal(recs.length, 2, '无 turn/step 的事件必须逐条保留')
})

test('rebuildAll + kpiQuery: 总量/命中率/成本/峰值/激活数', () => {
  const store = buildStore()
  const k = kpiQuery(store, 'all', null, null, makeFilter(null), T + 99999999)
  // a: miss 900 read 4300 out 80 | b: miss 333 read 11 out 16
  assert.equal(k.totals.miss, 900 + 333)
  assert.equal(k.totals.read, 4300 + 11)
  assert.equal(k.totals.out, 80 + 16)
  assert.equal(k.totals.requests, 4)
  assert.equal(k.activeSessions, 2)
  assert.ok(k.totals.cost > 0, 'deepseek 家族应有默认价成本')
  assert.ok(k.totals.saved > 0, '缓存读应产生节省估算')
  assert.equal(k.models.length, 2)
  assert.equal(typeof k.hitRate, 'number')
  assert.equal(k.peakDay.day, DAY1)
  assert.equal(k.streakDays >= 1, true, '连续天数按 nowMs 往回数(今日为 08-26,两天皆有数据)')
})

test('筛选:模型 / 会话 / 工作目录', () => {
  const store = buildStore()
  const k1 = kpiQuery(store, 'all', null, null, makeFilter({ models: 'deepseek-official:deepseek-chat' }), T + 99999999)
  assert.equal(k1.totals.requests, 2)
  assert.equal(k1.models.length, 1)
  const k2 = kpiQuery(store, 'all', null, null, makeFilter({ session: 'a' }), T + 99999999)
  assert.equal(k2.totals.requests, 2)
  const k3 = kpiQuery(store, 'all', null, null, makeFilter({ wd: 'C:\\other' }), T + 99999999)
  assert.equal(k3.totals.requests, 2)
  assert.equal(k3.models[0].key, 'openrouter:ox-alpha')
})

test('聚合快路径与逐记录慢路径输出等价(kpi/series/hours/heatmap/csv)', () => {
  const fastStore = buildStore()
  const slowStore = structuredClone(fastStore)
  // 破坏逐会话日索引 → aggregatesReady=false,强制走逐记录路径
  for (const dk of Object.keys(slowStore.days)) {
    for (const mk of Object.keys(slowStore.days[dk].models)) delete slowStore.days[dk].models[mk].sessions
  }
  assert.equal(aggregatesReady(fastStore), true)
  assert.equal(aggregatesReady(slowStore), false)
  const now = T + 99999999
  for (const useModel of [null, 'deepseek-official:deepseek-chat']) {
    const fFast = makeFilter(useModel ? { models: useModel } : null)
    const fSlow = makeFilter(useModel ? { models: useModel } : null)
    approx(kpiQuery(fastStore, 'all', null, null, fFast, now), kpiQuery(slowStore, 'all', null, null, fSlow, now))
    approx(kpiQuery(fastStore, 'today', null, null, fFast, now), kpiQuery(slowStore, 'today', null, null, fSlow, now), 1e-9, 'kpi.today')
    approx(kpiQuery(fastStore, 'month', null, null, fFast, now), kpiQuery(slowStore, 'month', null, null, fSlow, now), 1e-9, 'kpi.month')
    approx(seriesQuery(fastStore, 'day', 'all', null, null, fFast, now), seriesQuery(slowStore, 'day', 'all', null, null, fSlow, now), 1e-9, 'series.day')
    approx(seriesQuery(fastStore, 'week', 'all', null, null, fFast, now), seriesQuery(slowStore, 'week', 'all', null, null, fSlow, now), 1e-9, 'series.week')
    approx(seriesQuery(fastStore, 'month', 'all', null, null, fFast, now), seriesQuery(slowStore, 'month', 'all', null, null, fSlow, now), 1e-9, 'series.month')
    approx(hoursQuery(fastStore, 'all', null, null, fFast, now), hoursQuery(slowStore, 'all', null, null, fSlow, now), 1e-9, 'hours')
    approx(heatmapQuery(fastStore, 12, fFast, now), heatmapQuery(slowStore, 12, fSlow, now), 1e-9, 'heatmap')
    assert.equal(exportCsv(fastStore, 'all', null, null, fFast, now), exportCsv(slowStore, 'all', null, null, fSlow, now), 'csv')
  }
})

test('series/hours/sessions/detail 形状', () => {
  const store = buildStore()
  const s = seriesQuery(store, 'day', 'all', null, null, makeFilter(null), T + 99999999)
  assert.ok(Array.isArray(s) && s.length >= 2)
  const h = hoursQuery(store, 'all', null, null, makeFilter(null), T + 99999999)
  assert.equal(h.length, 24)
  const ss = sessionsQuery(store, 'tokens', 10, 'all', null, null, makeFilter(null), T + 99999999)
  assert.equal(ss.length, 2)
  const d = sessionDetailQuery(store, 'a')
  assert.equal(d.requestCount, 2)
  assert.equal(d.anomalies, 0)
  const d2 = sessionDetailQuery(store, 'b')
  assert.equal(d2.flags.filter((f) => f === 2).length, 1, '中断标记')
})

test('导出 CSV/JSON', () => {
  const store = buildStore()
  const csv = exportCsv(store, 'all', null, null, makeFilter(null), T + 99999999)
  assert.ok(csv.startsWith('date,model'))
  const lines = csv.split('\n')
  assert.equal(lines.length, 3, '2 行数据(2 天 × 各 1 模型)+ 表头')
  const js = exportJson(store, 'all', null, null, makeFilter(null), T + 99999999)
  const parsed = JSON.parse(js)
  assert.equal(parsed.count, 4)
  assert.ok(parsed.requests[0].costYuan !== undefined)
})

test('价格覆盖与重置(全盘重算)', () => {
  const store = buildStore()
  const before = kpiQuery(store, 'all', null, null, makeFilter(null), T + 99999999).totals.cost
  applyConfigPatch(store, { prices: { 'deepseek-official:deepseek-chat': { miss: 4, hit: 1, write: 0, output: 16 } } })
  const after = kpiQuery(store, 'all', null, null, makeFilter(null), T + 99999999).totals.cost
  assert.ok(after > before, '提高单价后成本应上升')
  applyConfigPatch(store, { resetPrices: true })
  const back = kpiQuery(store, 'all', null, null, makeFilter(null), T + 99999999).totals.cost
  assert.ok(Math.abs(back - before) < 1e-9, '重置后回到默认价')
})

test('配置补丁:retention 与 webPagePath 校验,未提及字段保持不变', () => {
  const store = buildStore()
  const cfg = applyConfigPatch(store, { retention: { days: 30 }, budget: { monthly: 100 } })
  assert.deepEqual(cfg.retention, { days: 30 })
  assert.equal(cfg.budget.monthly, 100)
  // 部分补丁不改其它字段
  const cfg2 = applyConfigPatch(store, { budget: { monthly: 0 } })
  assert.deepEqual(cfg2.retention, { days: 30 })
  // 数字简写形式
  const cfg3 = applyConfigPatch(store, { retention: 7 })
  assert.deepEqual(cfg3.retention, { days: 7 })
  // 非法值
  assert.throws(() => applyConfigPatch(store, { retention: -1 }), /non-negative/)
  assert.throws(() => applyConfigPatch(store, { webPagePath: 'C:\\Users\\x\\id_rsa' }), /\.html/)
  assert.doesNotThrow(() => applyConfigPatch(store, { webPagePath: 'C:\\pages\\my.html' }))
  assert.equal(store.config.webPagePath, 'C:\\pages\\my.html')
})

test('parseQuery:与 URLSearchParams 同口径(+ 为空格,%2B 为字面加号)', () => {
  assert.deepEqual(parseQuery('/x?a=1&b=two+words'), { a: '1', b: 'two words' })
  assert.deepEqual(parseQuery('/x?wd=C%3A%5CMy+Projects'), { wd: 'C:\\My Projects' })
  assert.deepEqual(parseQuery('/x?v=1%2B2'), { v: '1+2' })
  assert.deepEqual(parseQuery('/x?flag'), { flag: '' })
  assert.deepEqual(parseQuery('/x'), {})
  assert.deepEqual(parseQuery('/x?empty='), { empty: '' })
})

test('exportCsv: 公式注入防护(=/+/-/@ 开头的值前置单引号)', () => {
  const store = buildStore()
  store.requests['c'] = [
    { seq: 1, t: T + 1000, m: '=HYPERLINK("http://evil")', miss: 1, read: 0, write: 0, out: 0, r: 0, i: 0 },
  ]
  store.sessions['c'] = session('c')
  rebuildAll(store)
  const csv = exportCsv(store, 'all', null, null, makeFilter(null), T + 99999999)
  assert.ok(csv.includes('"\'=HYPERLINK(""http://evil"")"'), '模型列应被前置单引号且双引号转义')
  // 普通键不受影响
  assert.ok(csv.includes('"deepseek-official:deepseek-chat"'))
})

test('sessionsQuery: q 服务端子串搜索(标题/工作目录/会话 ID)', () => {
  const store = buildStore()
  store.sessions.a.meta.title = '项目Alpha讨论'
  store.sessions.b.meta.title = null
  const all = sessionsQuery(store, 'tokens', 10, 'all', null, null, makeFilter(null), T + 99999999)
  assert.equal(all.length, 2)
  const byTitle = sessionsQuery(store, 'tokens', 10, 'all', null, null, makeFilter({ q: 'alpha' }), T + 99999999)
  assert.equal(byTitle.length, 1)
  assert.equal(byTitle[0].id, 'a')
  const byCwd = sessionsQuery(store, 'tokens', 10, 'all', null, null, makeFilter({ q: 'other' }), T + 99999999)
  assert.equal(byCwd.length, 1)
  assert.equal(byCwd[0].id, 'b')
  const miss = sessionsQuery(store, 'tokens', 10, 'all', null, null, makeFilter({ q: 'ZZZ' }), T + 99999999)
  assert.equal(miss.length, 0)
})

test('extractSessionInfo: 标题按码点截断,不产生孤立代理对', () => {
  const events = [
    { type: 'session/title', seq: 1, time: T, data: { title: '🔥'.repeat(100) } },
  ]
  const info = extractSessionInfo(events)
  assert.equal(Array.from(info.title).length, 80, '应保留 80 个完整码点')
  assert.equal(/[\uD800-\uDBFF]$/.test(info.title), false, '结尾不应是孤立高代理')
})

test('归日:本地时区日键', () => {
  assert.match(dayKeyOf(T), /^\d{4}-\d{2}-\d{2}$/)
})
