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
  exportCsv, exportJson, dayKeyOf, aggregatesReady, markScanning, extractSessionInfo,
  isStoreShapeValid, configView,
} from '../lib/core.mjs'

/**
 * 时间锚点必须**与宿主时区无关**。
 *
 * 原来的写法是一个写死的 epoch(在作者机器的 UTC+8 上是"本地 08-25 上午"),
 * 于是"跨天"的断言其实是在赌宿主时区:同一串数字在 UTC-4 上是本地 08-24,
 * peakDay/连续天数/CSV 行数全都会变。改成"锚在**本地中午**"之后:
 *   - T 落在当天的正中间,前后 ±12 小时都不会跨日;
 *   - dayShift(T, 30) 稳定落在次日正中间;
 *   - 日/月桶是本地口径,所以它同时钉死了"日桶 = 宿主本地时区"这个契约。
 */
const T = new Date(2026, 7, 25, 12, 0, 0, 0).getTime()
/** 平移整天数(锚在中午,挪整天不会踩到日界) */
const dayShift = (ms, days) => new Date(new Date(ms).getFullYear(), new Date(ms).getMonth(), new Date(ms).getDate() + days, 12, 0, 0, 0).getTime()
const DAY1 = dayKeyOf(T)
const DAY2 = dayKeyOf(dayShift(T, 1))
/** "现在"锚在 DAY2 晚间:连续天数才有确定的答案(不能随手 +27h,那会跨到 DAY3) */
const NOW = dayShift(T, 1) + 6 * 3600 * 1000

/**
 * 数一数逐记录被真的读了几次(读 r.t 即计一次)。
 *
 * 为什么需要它:光比较"两条路径的输出相等"证明不了慢路径被走到 —— 两边都走快路径
 * 时同样相等(那正是本文件旧版等价用例的毛病)。用 r.t 的读取次数才能分辨:
 *   · 快路径只读聚合桶 → 0 次;
 *   · 慢路径 eachWithin 对每条记录做 dayKeyOf(rec.t) → 每条 1 次。
 * 探针装在查询**之前**,但 rebuildAll 也会读 r.t —— 因此调用方必须保证查询开头的
 * flushAggregates 无事可做(已就绪且未标脏),或整段锁在 markScanning 里。
 */
function countRecordTReads(store, fn) {
  const swapped = []
  let reads = 0
  for (const id of Object.keys(store.requests)) {
    const list = store.requests[id]
    for (let i = 0; i < list.length; i++) {
      const orig = list[i]
      const prox = new Proxy(orig, { get(t, k) { if (k === 't') reads++; return t[k] } })
      swapped.push([list, i, orig])
      list[i] = prox
    }
  }
  try { fn() } finally { for (const [list, i, orig] of swapped) list[i] = orig }
  return reads
}

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
    // 现行口径(0.1.5-rc.2 起):四段互斥,total = input + read + write + out → miss = input
    { type: 'assistant/message', seq: 3, time: T + 1000, data: { turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 300, cacheWriteTokens: 0, totalTokens: 1350 } } },
    // 大命中场景:input(200) 远小于 cacheRead(4000),miss 仍是 input 本身
    { type: 'assistant/message', seq: 4, time: T + 2000, data: { turn: 1, step: 2, usage: { inputTokens: 200, outputTokens: 30, cacheReadTokens: 4000, reasoningTokens: 10, totalTokens: 4230 } } },
    // 同 turn/step 重复 → 去重
    { type: 'assistant/message', seq: 5, time: T + 3000, data: { turn: 1, step: 1, usage: { inputTokens: 99999, outputTokens: 999, cacheReadTokens: 999, cacheWriteTokens: 999 } } },
    // 无 usage → 跳过
    { type: 'assistant/message', seq: 6, time: T + 4000, data: { turn: 1, step: 3, message: { role: 'assistant', content: [] }, source: {} } },
    // 极老日志的折叠口径(total = input + out,且 input 已含缓存)→ 回退相减
    { type: 'assistant/message', seq: 7, time: T + 5000, data: { turn: 1, step: 4, usage: { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 300, totalTokens: 1050 } } },
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
    { seq: 8, t: dayShift(T, 1) + 1000, m: 'openrouter:ox-alpha', miss: 111, read: 0, write: 0, out: 9, r: 0, i: 0 },
    { seq: 9, t: dayShift(T, 1) + 2000, m: 'openrouter:ox-alpha', miss: 222, read: 11, write: 0, out: 7, r: 0, i: 1 },
  ]
  rebuildAll(store)
  return store
}

test('foldSession: 四段分解、模型归属、去重', () => {
  const recs = foldSession(eventsFor())
  assert.equal(recs.length, 3)
  // 互斥口径:miss 直接取 inputTokens
  assert.deepEqual(
    { miss: recs[0].miss, read: recs[0].read, write: recs[0].write, out: recs[0].out },
    { miss: 1000, read: 300, write: 0, out: 50 },
  )
  // 大命中:input(200) < cacheRead(4000),miss 仍是 200(不再被相减吞掉)
  assert.deepEqual(
    { miss: recs[1].miss, read: recs[1].read, out: recs[1].out, r: recs[1].r },
    { miss: 200, read: 4000, out: 30, r: 10 },
  )
  // 折叠口径兼容:total = input + out → miss = input - read - write
  assert.deepEqual(
    { miss: recs[2].miss, read: recs[2].read, write: recs[2].write, out: recs[2].out },
    { miss: 700, read: 300, write: 0, out: 50 },
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
  const k = kpiQuery(store, 'all', null, null, makeFilter(null), NOW)
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
  assert.equal(k.streakDays, 2, '两个连续本地日都有数据 → 连续 2 天(锚点与宿主时区无关)')
})

test('连续使用天数:回溯上限足够长(否则长期用户会被静默截断)', () => {
  // 思路来自一次真实教训:上限原先写 3700 天(约 10 年),超过就静默停在 3700;
  // 而当时的测试只覆盖 0 天与 2 天,这种截断完全测不出来。
  // 上限只在"连续天数 > 上限"时才生效,所以必须真造出超过旧上限的连续日。
  const DAYS = 4000 // > 旧上限 3700
  const anchor = new Date(2026, 7, 25, 12, 0, 0, 0).getTime()
  const store = emptyStore()
  const list = []
  for (let i = 0; i < DAYS; i++) {
    // 从 anchor 往前推 DAYS-1 天,一直连到 anchor 当天(每天都有一条记录)
    const t = anchor - (DAYS - 1 - i) * 24 * 3600 * 1000
    // 锚在每天正午:避免 DST/时区把日期挤到相邻天
    const d = new Date(t)
    d.setHours(12, 0, 0, 0)
    list.push({ t: d.getTime(), m: 'deepseek-official:deepseek-chat', miss: 10, read: 0, write: 0, out: 5, cost: 0, saved: 0, priced: true })
  }
  store.requests = { 's-long': list }
  store.sessions = { 's-long': { id: 's-long', firstTs: list[0].t, lastTs: list[list.length - 1].t, meta: {} } }
  store.watermarks = {}
  rebuildAll(store)
  const k = kpiQuery(store, 'all', null, null, makeFilter({}), anchor)
  assert.ok(k.streakDays > 3700,
    `连续 ${DAYS} 天必须全部回溯到(实际 ${k.streakDays})—— 上限若被打回 3700 就会在这里失败`)
})

test('筛选:模型 / 会话 / 工作目录', () => {
  const store = buildStore()
  const k1 = kpiQuery(store, 'all', null, null, makeFilter({ models: 'deepseek-official:deepseek-chat' }), NOW)
  assert.equal(k1.totals.requests, 2)
  assert.equal(k1.models.length, 1)
  const k2 = kpiQuery(store, 'all', null, null, makeFilter({ session: 'a' }), NOW)
  assert.equal(k2.totals.requests, 2)
  const k3 = kpiQuery(store, 'all', null, null, makeFilter({ wd: 'C:\\other' }), NOW)
  assert.equal(k3.totals.requests, 2)
  assert.equal(k3.models[0].key, 'openrouter:ox-alpha')
})

test('聚合快路径与逐记录慢路径输出等价(kpi/series/hours/heatmap/csv)', () => {
  const fastStore = buildStore()
  // 让慢库**真的**走慢路径。
  //
  // 原先的构造是"删掉 model.sessions → aggregatesReady=false",但这达不到目的:
  // 每个查询函数开头都会 flushAggregates,而它看到"形状未就绪"会**当场 rebuildAll
  // 把索引补回来** —— 于是这个所谓"慢库"在查询时已经变成快库,断言退化成
  // "快路径和自己比"。实测两个 store 都是 0 次逐记录访问,用例是空转的。
  //
  // markScanning 是唯一压得住 flush 的手段(扫描窗口内 flushAggregates 拒绝重建),
  // 用它才能把慢路径真正钉住。两个 store 的数据完全相同,差别只在走哪条路。
  const slowStore = structuredClone(fastStore)
  const fastProbe = makeFilter(null)
  assert.equal(aggregatesReady(fastStore), true, '快库必须就绪')
  // 先验证"慢库确实走了慢路径",否则等价断言又会退化成空转
  const slowReads = countRecordTReads(slowStore, () => {
    markScanning(slowStore, true)
    try { kpiQuery(slowStore, 'all', null, null, fastProbe, NOW) } finally { markScanning(slowStore, false) }
  })
  assert.ok(slowReads > 0, `慢路径必须真的读取逐记录(实际 ${slowReads} 次)`)
  const fastReads = countRecordTReads(fastStore, () => kpiQuery(fastStore, 'all', null, null, fastProbe, NOW))
  assert.equal(fastReads, 0, `快路径不得触碰逐记录(实际 ${fastReads} 次)`)

  const now = NOW
  for (const useModel of [null, 'deepseek-official:deepseek-chat']) {
    const fFast = makeFilter(useModel ? { models: useModel } : null)
    const fSlow = makeFilter(useModel ? { models: useModel } : null)
    // 慢库整段锁在"扫描中":所有查询都被迫回退逐记录路径
    markScanning(slowStore, true)
    try {
      // 每一轮都确认慢库确实走了慢路径 —— 否则这条用例会悄悄退化成"快路径和自己比"
      const reads = countRecordTReads(slowStore, () => kpiQuery(slowStore, 'all', null, null, fSlow, now))
      assert.ok(reads > 0, `慢库必须走逐记录路径(实际读 r.t ${reads} 次)`)
      approx(kpiQuery(fastStore, 'all', null, null, fFast, now), kpiQuery(slowStore, 'all', null, null, fSlow, now))
      approx(kpiQuery(fastStore, 'today', null, null, fFast, now), kpiQuery(slowStore, 'today', null, null, fSlow, now), 1e-9, 'kpi.today')
      approx(kpiQuery(fastStore, 'month', null, null, fFast, now), kpiQuery(slowStore, 'month', null, null, fSlow, now), 1e-9, 'kpi.month')
      approx(seriesQuery(fastStore, 'day', 'all', null, null, fFast, now), seriesQuery(slowStore, 'day', 'all', null, null, fSlow, now), 1e-9, 'series.day')
      approx(seriesQuery(fastStore, 'week', 'all', null, null, fFast, now), seriesQuery(slowStore, 'week', 'all', null, null, fSlow, now), 1e-9, 'series.week')
      approx(seriesQuery(fastStore, 'month', 'all', null, null, fFast, now), seriesQuery(slowStore, 'month', 'all', null, null, fSlow, now), 1e-9, 'series.month')
      approx(hoursQuery(fastStore, 'all', null, null, fFast, now), hoursQuery(slowStore, 'all', null, null, fSlow, now), 1e-9, 'hours')
      approx(heatmapQuery(fastStore, 12, fFast, now), heatmapQuery(slowStore, 12, fSlow, now), 1e-9, 'heatmap')
      assert.equal(exportCsv(fastStore, 'all', null, null, fFast, now), exportCsv(slowStore, 'all', null, null, fSlow, now), 'csv')
    } finally { markScanning(slowStore, false) }
  }
})

test('series/hours/sessions/detail 形状', () => {
  const store = buildStore()
  const s = seriesQuery(store, 'day', 'all', null, null, makeFilter(null), NOW)
  assert.ok(Array.isArray(s) && s.length >= 2)
  const h = hoursQuery(store, 'all', null, null, makeFilter(null), NOW)
  assert.equal(h.length, 24)
  const ss = sessionsQuery(store, 'tokens', 10, 'all', null, null, makeFilter(null), NOW)
  assert.equal(ss.length, 2)
  const d = sessionDetailQuery(store, 'a')
  assert.equal(d.requestCount, 2)
  assert.equal(d.anomalies, 0)
  const d2 = sessionDetailQuery(store, 'b')
  assert.equal(d2.flags.filter((f) => f === 2).length, 1, '中断标记')
})

test('会话下钻 brief 模式:省掉逐请求数组,汇总照旧', () => {
  const store = buildStore()
  const full = sessionDetailQuery(store, 'a')
  const brief = sessionDetailQuery(store, 'a', { brief: true })
  // 汇总字段一个不少
  for (const k of ['id', 'meta', 'totals', 'models', 'requestCount', 'anomalies', 'flagged', 'firstTs', 'lastTs']) {
    assert.deepEqual(brief[k], full[k], `brief 不应改变 ${k}`)
  }
  // 逐请求数据被省掉(会话内面板只要汇总)
  assert.ok(Array.isArray(full.requests) && full.requests.length === 2)
  assert.equal(brief.requests, undefined)
  assert.equal(brief.flags, undefined)
  // payload 体积应显著更小
  assert.ok(JSON.stringify(brief).length < JSON.stringify(full).length)
  // 不存在的会话仍然是 null
  assert.equal(sessionDetailQuery(store, 'nope', { brief: true }), null)
})

test('会话下钻:面板用的节奏字段(逐小时 / 分档 / 逐段费用)', () => {
  const store = buildStore()
  const d = sessionDetailQuery(store, 'a', { brief: true })
  const total = d.totals.miss + d.totals.read + d.totals.write + d.totals.out
  assert.equal(d.hours.length, 24, '逐小时分布固定 24 桶')
  assert.equal(d.hours.reduce((s, v) => s + v, 0), total, '逐小时之和 = 总 tokens')
  assert.equal(d.hoursPeak.length, 24)
  assert.equal(d.hoursPeak.reduce((s, v) => s + v, 0), d.tiers.peak.tokens, '高峰桶之和 = 高峰 tokens')
  assert.ok(d.hours.every((v, i) => d.hoursPeak[i] <= v), '某小时的高峰量不可能超过该小时总量')
  assert.equal(d.tiers.peak.tokens + d.tiers.idle.tokens, total, '两档之和 = 总 tokens')
  assert.equal(d.tiers.peak.requests + d.tiers.idle.requests, d.requestCount, '两档请求数之和 = 请求总数')
  assert.equal(d.activeDays, new Set(store.requests['a'].map((r) => dayKeyOf(r.t))).size)
  assert.deepEqual(d.schedule, { hours: [[9, 12], [14, 18]], days: [1, 2, 3, 4, 5] }, '规则随响应下发,供面板原样展示')

  // 逐段费用必须能对上总费用(同一套单价、同一档)
  const parts = d.costParts.miss + d.costParts.read + d.costParts.write + d.costParts.out
  assert.ok(Math.abs(parts - d.totals.cost) <= 1e-9 * Math.max(1, d.totals.cost), `四段费用之和应等于总费用:${parts} vs ${d.totals.cost}`)
  assert.equal(d.unpriced, 0, '有价的会话不该有未定价 tokens')

  // 这就是"钱花在哪一段"的价值:缓存命中占了绝大多数 token,却只占极小一笔钱
  const readTokenShare = (d.totals.read) / total
  const readCostShare = d.costParts.read / d.totals.cost
  assert.ok(readTokenShare > 0.7, `缓存命中应占大头 tokens(实际 ${(readTokenShare * 100).toFixed(1)}%)`)
  assert.ok(readCostShare < 0.2, `缓存命中的费用占比应远小于 token 占比(实际 ${(readCostShare * 100).toFixed(1)}%)`)
})

test('会话下钻:未定价模型计成 unpriced,不混进费用', () => {
  const store = buildStore()
  const d = sessionDetailQuery(store, 'b', { brief: true })
  const total = d.totals.miss + d.totals.read + d.totals.write + d.totals.out
  assert.equal(d.unpriced, total, '整条会话都未定价')
  assert.equal(d.costParts.miss + d.costParts.read + d.costParts.write + d.costParts.out, 0)
  assert.equal(d.tiers.peak.tokens + d.tiers.idle.tokens, total)
})

test('会话下钻:小时桶按北京时间,与高峰分档同一口径(宿主时区无关)', () => {
  const store = emptyStore()
  store.sessions['z'] = session('z')
  // 2026-08-26 是周三:02:00Z = 北京 10:00(高峰),14:00Z = 北京 22:00(空闲)
  const am = Date.parse('2026-08-26T02:00:00Z')
  const pm = Date.parse('2026-08-26T14:00:00Z')
  store.requests['z'] = [
    { seq: 1, t: am, m: 'deepseek-official:deepseek-chat', miss: 100, read: 0, write: 0, out: 0, r: 0, i: 0 },
    { seq: 2, t: pm, m: 'deepseek-official:deepseek-chat', miss: 100, read: 0, write: 0, out: 0, r: 0, i: 0 },
  ]
  rebuildAll(store)
  const d = sessionDetailQuery(store, 'z', { brief: true })
  assert.equal(d.hours[10], 100, '02:00Z 落在北京时间 10 点桶')
  assert.equal(d.hours[22], 100, '14:00Z 落在北京时间 22 点桶')
  assert.equal(d.hoursPeak[10], 100, '周三 10 点是高峰')
  assert.equal(d.hoursPeak[22], 0, '22 点不是高峰')
  assert.equal(d.tiers.peak.tokens, 100)
  assert.equal(d.tiers.idle.tokens, 100)
  assert.equal(d.hours.reduce((s, v) => s + v, 0), 200)
})

test('导出 CSV/JSON', () => {
  const store = buildStore()
  const csv = exportCsv(store, 'all', null, null, makeFilter(null), NOW)
  assert.ok(csv.startsWith('date,model'))
  const lines = csv.split('\n')
  assert.equal(lines.length, 3, '2 行数据(2 天 × 各 1 模型)+ 表头')
  const js = exportJson(store, 'all', null, null, makeFilter(null), NOW)
  const parsed = JSON.parse(js)
  assert.equal(parsed.count, 4)
  assert.ok(parsed.requests[0].costYuan !== undefined)
})

test('价格覆盖与重置(全盘重算)', () => {
  const store = buildStore()
  const before = kpiQuery(store, 'all', null, null, makeFilter(null), NOW).totals.cost
  applyConfigPatch(store, { prices: { 'deepseek-official:deepseek-chat': { miss: 4, hit: 1, write: 0, output: 16 } } })
  const after = kpiQuery(store, 'all', null, null, makeFilter(null), NOW).totals.cost
  assert.ok(after > before, '提高单价后成本应上升')
  applyConfigPatch(store, { resetPrices: true })
  const back = kpiQuery(store, 'all', null, null, makeFilter(null), NOW).totals.cost
  assert.ok(Math.abs(back - before) < 1e-9, '重置后回到默认价')
})

test('配置补丁:retention 校验,未提及字段保持不变', () => {
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
})

test('webPagePath 已移除:显式拒绝,且配置视图不再回显它', () => {
  const store = buildStore()
  // 0.8.9 移除换肤:该字段只校验扩展名,等于一个"读盘上任意 .html"的原语。
  // 显式拒绝(而不是静默忽略),否则调用方以为换肤生效了。
  assert.throws(() => applyConfigPatch(store, { webPagePath: 'C:\\pages\\my.html' }), /移除/)
  assert.throws(() => applyConfigPatch(store, { webPagePath: 'C:\\Users\\x\\id_rsa' }), /移除/)
  assert.equal(store.config.webPagePath, undefined, '不得写进配置')
  assert.equal(configView(store).webPagePath, undefined, '配置视图不得回显')
  // 老库里残留的该字段一律忽略,也不因此判定库损坏
  const legacy = buildStore()
  legacy.config.webPagePath = 'C:\\old\\skin.html'
  assert.equal(isStoreShapeValid(legacy), true, '残留字段不应被判为损坏')
  assert.equal(configView(legacy).webPagePath, undefined, '残留字段不得出现在配置视图里')
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
  const csv = exportCsv(store, 'all', null, null, makeFilter(null), NOW)
  assert.ok(csv.includes('"\'=HYPERLINK(""http://evil"")"'), '模型列应被前置单引号且双引号转义')
  // 普通键不受影响
  assert.ok(csv.includes('"deepseek-official:deepseek-chat"'))
})

test('sessionsQuery: q 服务端子串搜索(标题/工作目录/会话 ID)', () => {
  const store = buildStore()
  store.sessions.a.meta.title = '项目Alpha讨论'
  store.sessions.b.meta.title = null
  const all = sessionsQuery(store, 'tokens', 10, 'all', null, null, makeFilter(null), NOW)
  assert.equal(all.length, 2)
  const byTitle = sessionsQuery(store, 'tokens', 10, 'all', null, null, makeFilter({ q: 'alpha' }), NOW)
  assert.equal(byTitle.length, 1)
  assert.equal(byTitle[0].id, 'a')
  const byCwd = sessionsQuery(store, 'tokens', 10, 'all', null, null, makeFilter({ q: 'other' }), NOW)
  assert.equal(byCwd.length, 1)
  assert.equal(byCwd[0].id, 'b')
  const miss = sessionsQuery(store, 'tokens', 10, 'all', null, null, makeFilter({ q: 'ZZZ' }), NOW)
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
