/**
 * dsh-token — 0.8.5 数据正确性回归测试(node:test,零依赖)
 *
 * 本文件锁的都是**实测确认过的缺陷**(修复前的行为已由探针复现),每条断言都对应
 * 一个"不报错、只安静给错数字或丢数据"的坑。命名用 FIX-xx。
 *
 * 覆盖:
 *   FIX-A1  非数字/零值 limit 回退默认(而不是整盘空白)
 *   FIX-A2  畸形 usage 收敛为有限数,store 序列化后仍能通过体检
 *   FIX-A3  扫描进行中,聚合快路径与逐记录慢路径必须一致
 *   FIX-A4  保留期修剪后放宽,历史仍能回归(修剪可逆)
 *   FIX-A5  成功但空事件的重扫不得清空已存历史
 *   FIX-A6  无 seq 的事件不得被折叠成一条
 *   FIX-A7  折叠口径不得产生负 miss
 *   FIX-A8  自定义单价四项都必须校验(负值/非数一律拒绝)
 *   FIX-A9  models=',' 不得把整盘清零
 *   FIX-A10 peakDay 不得报 tokens=0 的伪日期
 *   FIX-A12 store 体检必须能拦住读取侧会解引用的内层结构
 *   FIX-B3  缺省 flt 不得抛错(纯函数层的对外承诺)
 *   FIX-B7  标题随 revision 刷新
 *   FIX-C4  部分 stats 不得把计数器污染成 NaN
 *   FIX-C1  未知会话 id 必须 404
 *   FIX-C10 坏时间戳不得让 exportJson 抛错
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyStore, rebuildAll, foldSession, isStoreShapeValid, apiDispatch, sessionsQuery,
  kpiQuery, makeFilter, priceEntryOf, applyConfigPatch, exportCsv, exportJson,
  markScanning, sessionDetailQuery,
} from '../lib/core.mjs'
import { scanStore } from '../lib/session-source.mjs'

const T = 1787632311372 // 2026-08-25(本地时区)

/** 假 persistence(与 scan-store.test.mjs 同形状) */
function fakePersistence(sessions) {
  return {
    async listSnapshots() { return Object.keys(sessions).map((id) => ({ header: { id }, revision: sessions[id].revision })) },
    async readFrom(id) { return { events: sessions[id].events, meta: { id, createdAt: T, cwd: 'C:\\work\\proj' } } },
    locate: (meta) => ({ path: `X:\\ws\\proj\\x\\${meta.id || ''}` }),
  }
}

/** 一条最小用量事件(provider=官方,便于计价路径可预期) */
function usageEvents(base, t, provider = 'deepseek-official', model = 'deepseek-flash') {
  return [
    { type: 'request/header', seq: base, time: t, data: { header: { config: { provider, model } } } },
    { type: 'assistant/message', seq: base + 1, time: t + 1000, data: { turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 300 } } },
  ]
}

/** 一条最小 store(一条请求) */
function storeWithOne(ms = T, model = 'deepseek-official:deepseek-flash') {
  const store = emptyStore()
  store.requests.s1 = [{ seq: 1, t: ms, m: model, miss: 100, read: 0, write: 0, out: 10, r: 0, i: 0, cum: 0, cost: 0, saved: 0, priced: 0 }]
  store.sessions.s1 = { meta: { cwd: '/w' }, totals: null, models: {}, firstTs: ms, lastTs: ms }
  return store
}

// ---------------------------------------------------------------------------
// FIX-A1:limit 兜底
// ---------------------------------------------------------------------------
test('FIX-A1: 非数字/零值 limit 回退默认,而不是返回 0 行', () => {
  const s = storeWithOne()
  s.days = {}; s.months = {}
  rebuildAll(s)
  // 查询串里 limit 恒为字符串:'abc' → clamp(NaN) → slice(0,NaN) → 曾经整盘空白
  assert.equal(sessionsQuery(s, 'recent', 'abc', 'all', null, null, makeFilter({})).length, 1)
  assert.equal(sessionsQuery(s, 'recent', ' ', 'all', null, null, makeFilter({})).length, 1)
  assert.equal(sessionsQuery(s, 'recent', 0, 'all', null, null, makeFilter({})).length, 1, '0 视为默认')
  assert.equal(sessionsQuery(s, 'recent', -5, 'all', null, null, makeFilter({})).length, 1, '负数视为默认')
  assert.equal(sessionsQuery(s, 'recent', 3, 'all', null, null, makeFilter({})).length, 1, '正常值照旧')
})

// ---------------------------------------------------------------------------
// FIX-A2:畸形 usage 不得污染 store
// ---------------------------------------------------------------------------
test('FIX-A2: 畸形 usage 收敛为有限数,序列化后仍通过体检', () => {
  const recs = foldSession([{
    type: 'assistant/message', seq: 1, time: T,
    data: { turn: 1, step: 1, usage: { inputTokens: {}, cacheReadTokens: 'x', cacheWriteTokens: null, outputTokens: undefined } },
  }])
  assert.equal(recs.length, 1)
  for (const k of ['miss', 'read', 'write', 'out']) {
    assert.ok(Number.isFinite(recs[0][k]), `${k} 必须是有限数,实际 ${recs[0][k]}`)
    assert.ok(recs[0][k] >= 0, `${k} 必须非负`)
  }
  const store = emptyStore()
  store.requests.s1 = [Object.assign({}, recs[0], { cum: 0, cost: 0, saved: 0, priced: 0 })]
  store.sessions.s1 = { meta: {}, totals: null, models: {}, firstTs: T, lastTs: T }
  rebuildAll(store)
  const serialized = JSON.stringify(store)
  assert.ok(!serialized.includes('"miss":null'), 'NaN 不得被序列化成 null(否则下次启动会被判损坏)')
  assert.equal(isStoreShapeValid(JSON.parse(serialized)), true, '重新加载后体检必须仍然合格')
})

// ---------------------------------------------------------------------------
// FIX-A3:扫描窗口内两条路径必须一致
// ---------------------------------------------------------------------------
test('FIX-A3: 聚合未重建时(扫描窗口),快路径必须回退慢路径', () => {
  const s = storeWithOne()
  s.days = {}; s.months = {}
  rebuildAll(s)
  // 模拟扫描进行中:新会话的 requests 已写入,days 尚未重建
  s.sessions.s2 = { meta: { cwd: '/w' }, totals: null, models: {}, firstTs: T, lastTs: T }
  s.requests.s2 = [{ seq: 1, t: T, m: 'deepseek-official:deepseek-flash', miss: 500, read: 0, write: 0, out: 50, r: 0, i: 0, cum: 0, cost: 0, saved: 0, priced: 0 }]

  markScanning(s, true)
  try {
    const fast = kpiQuery(s, 'all', null, null, makeFilter({}))
    const slow = kpiQuery(s, 'all', null, null, makeFilter({ wd: '/w' }))
    assert.equal(fast.totals.requests, slow.totals.requests, '扫描期间两条路径的请求数必须一致')
    assert.equal(fast.totals.total, slow.totals.total, '扫描期间两条路径的 token 总量必须一致')
    // 导出同理:CSV 的快慢两路曾经给出不同行数
    assert.equal(
      exportCsv(s, 'all', null, null, makeFilter({})),
      exportCsv(s, 'all', null, null, makeFilter({ wd: '/w' })),
      '扫描期间导出的快慢路径内容必须一致',
    )
  } finally {
    markScanning(s, false)
  }
  // 复位后必须恢复快路径能力(不能永久退化为慢路径)
  rebuildAll(s)
  assert.equal(kpiQuery(s, 'all', null, null, makeFilter({})).totals.requests, 2, '扫描结束后快路径恢复正常')
})

// ---------------------------------------------------------------------------
// FIX-A4:修剪必须可逆
// ---------------------------------------------------------------------------
test('FIX-A4: 保留期修剪后放宽,历史仍能回归', async () => {
  const store = emptyStore()
  const old = T - 100 * 86400000 // 远超 1 天
  const sessions = { s1: { revision: 1, events: usageEvents(1, old) } }
  const p = fakePersistence(sessions)

  await scanStore(store, p, { nowMs: T })
  assert.equal(store.requests.s1.length, 1)

  applyConfigPatch(store, { retention: { days: 1 } })
  const prunedSummary = await scanStore(store, p, { nowMs: T })
  assert.equal(prunedSummary.pruned, 1, '超龄记录应被修剪')
  assert.equal(store.requests.s1, undefined, '修剪后该会话记录应移除')
  // 0.8.9:不再删除水位线(那会让每轮扫描都判定"有变化"并重折全部超龄会话),
  // 改为在它上面记下"是在 retention=1 时剪的" —— 该标记才是"需要重折"的第二个依据。
  assert.ok(store.watermarks.s1, '水位线必须保留(删掉会导致每轮全量重折)')
  assert.equal(store.watermarks.s1.prunedWith, 1, '必须记下修剪时的保留期')

  // 保留期不变:下一轮**不得**再重折(稳态零写放大)
  const steady = await scanStore(store, p, { nowMs: T })
  assert.equal(steady.scanned, 0, '保留期未变时不应重折任何会话')
  assert.equal(steady.pruned, 0, '已剪过的记录不该被反复统计')
  assert.equal(steady.dirty, false, '无变化时不得触发重建与落盘')

  applyConfigPatch(store, { retention: { days: 0 } })
  await scanStore(store, p, { nowMs: T })
  const k = kpiQuery(store, 'all', null, null, makeFilter(null), T)
  assert.equal(k.totals.requests, 1, '放宽保留期后,历史必须从日志重新折回')
})

// ---------------------------------------------------------------------------
// FIX-A5:空读不得清空历史
// ---------------------------------------------------------------------------
test('FIX-A5: 成功但 events 为空的重扫不得清空已存历史', async () => {
  const store = emptyStore()
  const sessions = { s1: { revision: 1, events: usageEvents(1, T) } }
  const p = fakePersistence(sessions)
  await scanStore(store, p, { nowMs: T })
  assert.equal(store.requests.s1.length, 1)

  // 日志轮转/压缩:revision 变了,但这次读出 0 个事件
  sessions.s1 = { revision: 2, events: [] }
  const summary = await scanStore(store, p, { nowMs: T })
  assert.equal(store.requests.s1.length, 1, '历史必须保留')
  assert.equal(summary.emptyReads, 1, '空读应被单独计数')
  assert.equal(summary.dirty, false, '空读不产生新数据,不应触发落盘')
  assert.equal(store.watermarks.s1.rev, '1', '空读不得推进水位线(否则再也不会重试)')
})

// ---------------------------------------------------------------------------
// FIX-A6:无 seq 不得合并
// ---------------------------------------------------------------------------
test('FIX-A6: 无 seq 的事件不得被折叠成一条', () => {
  const mk = (t, input) => ({ type: 'assistant/message', time: t, data: { usage: { inputTokens: input, outputTokens: 1 } } })
  const recs = foldSession([mk(1, 10), mk(2, 20), mk(3, 30)])
  assert.equal(recs.length, 3, '三条无 seq 事件必须保留三条记录')
  assert.deepEqual(recs.map((r) => r.miss), [10, 20, 30])
})

// ---------------------------------------------------------------------------
// FIX-A7:折叠口径不得为负
// ---------------------------------------------------------------------------
test('FIX-A7: 折叠口径不得产生负 miss', () => {
  // totalTokens === input + out 且带缓存 → 判为折叠口径 → 相减
  const recs = foldSession([{
    type: 'assistant/message', seq: 1, time: T,
    data: { turn: 1, step: 1, usage: { inputTokens: 100, cacheReadTokens: 300, cacheWriteTokens: 0, outputTokens: 0, totalTokens: 100 } },
  }])
  assert.equal(recs[0].miss, 0, '相减为负必须钳到 0,而不是把负数灌进统计')
  assert.ok(recs[0].miss >= 0)
})

// ---------------------------------------------------------------------------
// FIX-A8:单价四项校验
// ---------------------------------------------------------------------------
test('FIX-A8: 自定义单价四项都必须是非负有限数', () => {
  assert.equal(priceEntryOf({ miss: 1, hit: 'abc', write: 0, output: 0 }), null, 'hit 非数必须拒')
  assert.equal(priceEntryOf({ miss: 1, hit: -5, write: 0, output: -3 }), null, '负值必须拒(否则算出负成本)')
  assert.equal(priceEntryOf({ miss: -1 }), null)
  assert.equal(priceEntryOf({ miss: 1, hit: NaN }), null)
  assert.equal(priceEntryOf({ peak: { miss: 1, output: 8 }, idle: { miss: 1, output: 'x' } }), null, 'idle 不合法也要拒')
  // 合法值照旧;缺省字段按 0
  assert.deepEqual(priceEntryOf({ miss: 4, hit: 1, write: 0, output: 16 }).peak, { miss: 4, hit: 1, write: 0, output: 16 })
  // 空配置不得被当成"全 0 价"(那等于宣称免费)
  assert.equal(priceEntryOf({}), null)
  assert.equal(priceEntryOf({ peak: {} }), null)
})

// ---------------------------------------------------------------------------
// FIX-A9:models 边缘值
// ---------------------------------------------------------------------------
test("FIX-A9: models=',' 不得把整盘清零", () => {
  const s = storeWithOne()
  s.days = {}; s.months = {}
  rebuildAll(s)
  for (const v of [',', ' , ', ',,', ' ']) {
    const k = kpiQuery(s, 'all', null, null, makeFilter({ models: v }))
    assert.equal(k.totals.requests, 1, `models=${JSON.stringify(v)} 应视为无筛选`)
  }
  // 真正指定一个不存在的模型时,才应该清零
  assert.equal(kpiQuery(s, 'all', null, null, makeFilter({ models: 'nope:x' })).totals.requests, 0)
})

// ---------------------------------------------------------------------------
// FIX-A10:peakDay 不得报伪日期
// ---------------------------------------------------------------------------
test('FIX-A10: peakDay 不得报 tokens=0 的伪日期', () => {
  const s = emptyStore()
  s.requests.s1 = [{ seq: 1, t: T, m: 'a:b', miss: 0, read: 0, write: 0, out: 0, r: 0, i: 0, cum: 0, cost: 0, saved: 0, priced: 0 }]
  s.sessions.s1 = { meta: {}, totals: null, models: {}, firstTs: T, lastTs: T }
  s.days = {}; s.months = {}
  rebuildAll(s)
  assert.equal(kpiQuery(s, 'all', null, null, makeFilter({})).peakDay, null, '全零用量时必须是 null')
  // 有真实用量时照常报出
  const s2 = storeWithOne()
  s2.days = {}; s2.months = {}
  rebuildAll(s2)
  const pk = kpiQuery(s2, 'all', null, null, makeFilter({})).peakDay
  assert.ok(pk && pk.tokens > 0, '有用量时应报出峰值日')
})

// ---------------------------------------------------------------------------
// FIX-A12:store 体检的内层结构
// ---------------------------------------------------------------------------
test('FIX-A12: 体检必须拦住读取侧会解引用的内层结构', () => {
  const base = () => { const s = emptyStore(); rebuildAll(s); return s }
  // 这些形状原先都能通过体检,然后在查询里抛错 → 每个路由 500,隔离重建路径不触发
  const bad = [
    (() => { const s = base(); s.days = { '2026-01-01': null }; return s })(),
    (() => { const s = base(); s.days = { '2026-01-01': 'x' }; return s })(),
    (() => { const s = base(); s.days = { '2026-01-01': { models: null } }; return s })(),
    (() => { const s = base(); s.days = { '2026-01-01': { models: { 'a:b': null } } }; return s })(),
    (() => { const s = base(); s.months = { '2026-01': null }; return s })(),
  ]
  for (const s of bad) assert.equal(isStoreShapeValid(s), false, '不合格的内层结构必须被判损坏')
  // 合格形状不得被误杀
  const good = base()
  good.days = { '2026-01-01': { totals: { miss: 0, read: 0, write: 0, out: 0, requests: 0, cost: 0, saved: 0, priced: 0 }, models: { 'a:b': { sessions: {} } }, hours: {} } }
  assert.equal(isStoreShapeValid(good), true, '合法 store 不得被误判')
})

// ---------------------------------------------------------------------------
// FIX-B3:缺省 flt
// ---------------------------------------------------------------------------
test('FIX-B3: 查询函数缺省 flt 不得抛错(纯函数层承诺)', () => {
  const s = storeWithOne()
  s.days = {}; s.months = {}
  rebuildAll(s)
  assert.doesNotThrow(() => exportCsv(s, 'all'))
  assert.doesNotThrow(() => exportJson(s, 'all'))
  assert.doesNotThrow(() => kpiQuery(s, 'all', null, null, undefined))
  assert.doesNotThrow(() => sessionDetailQuery(s, 's1'))
})

// ---------------------------------------------------------------------------
// FIX-B7:标题刷新
// ---------------------------------------------------------------------------
test('FIX-B7: 标题随 revision 刷新(provider 来源覆盖旧值)', async () => {
  const withTitle = (title, base, kind) => [
    { type: 'session/title', seq: base, time: T + base, data: { title, ...(kind ? { source: { kind } } : {}) } },
    { type: 'assistant/message', seq: base + 10, time: T + base * 100, data: { turn: 1, step: 1, usage: { inputTokens: 100 } } },
  ]
  const store = emptyStore()
  const sessions = { s1: { revision: 1, events: withTitle('兜底标题', 1) } }
  const p = fakePersistence(sessions)
  await scanStore(store, p, { nowMs: T })
  assert.equal(store.sessions.s1.meta.title, '兜底标题')

  // 模型生成了正式标题(provider 来源)
  sessions.s1 = { revision: 2, events: withTitle('正式标题', 2, 'provider') }
  await scanStore(store, p, { nowMs: T })
  assert.equal(store.sessions.s1.meta.title, '正式标题', '权威标题必须覆盖兜底标题')
})

// ---------------------------------------------------------------------------
// FIX-C4:stats 归一
// ---------------------------------------------------------------------------
test('FIX-C4: 部分 stats 不得把计数器污染成 NaN/null', async () => {
  const store = emptyStore()
  store.stats = { fullScans: 0 } // 模拟字段不全的老 store
  const sessions = { s1: { revision: 1, events: usageEvents(1, T) } }
  await scanStore(store, fakePersistence(sessions), { nowMs: T })
  for (const k of ['scannedFiles', 'newRequests', 'failedSessions', 'fullScans', 'incrementalScans']) {
    assert.ok(Number.isFinite(store.stats[k]), `${k} 必须是有限数,实际 ${store.stats[k]}`)
  }
  assert.ok(!JSON.stringify(store.stats).includes(':null'), 'stats 里不得出现 null')
})

// ---------------------------------------------------------------------------
// FIX-C1:未知会话 404
// ---------------------------------------------------------------------------
test('FIX-C1: 未知会话 id 返回 404 而不是 200/null', () => {
  const s = emptyStore()
  const r = apiDispatch(s, 'session', { id: 'nope' })
  assert.equal(r.status, 404)
  assert.match(r.body, /session not found/)
  // 存在的会话照常 200
  const s2 = storeWithOne()
  s2.days = {}; s2.months = {}
  rebuildAll(s2)
  const ok = apiDispatch(s2, 'session', { id: 's1' })
  assert.equal(ok.status, 200)
})

// ---------------------------------------------------------------------------
// FIX-C10:坏时间戳导出
// ---------------------------------------------------------------------------
test('FIX-C10: 坏时间戳不得让 exportJson 抛错', () => {
  const s = emptyStore()
  s.requests.s1 = [{ seq: 1, t: undefined, m: 'a:b', miss: 1, read: 0, write: 0, out: 0, r: 0, i: 0, cum: 1, cost: 0, saved: 0, priced: 0 }]
  s.sessions.s1 = { meta: {} }
  s.days = {}; s.months = {}
  let out = null
  assert.doesNotThrow(() => { out = exportJson(s, 'all') })
  const parsed = JSON.parse(out)
  assert.equal(parsed.count, 1)
  assert.equal(parsed.requests[0].iso, null, '坏时间戳给 null,而不是抛 RangeError')
})
