/**
 * dsh-token — 0.9.5 **增量聚合**守卫(node:test,零依赖)
 *
 * 0.9.5 把扫描收尾从"只要有会话变化就整库重折"改成"只重折被改动的会话"。
 * 代价从 O(全库记录数) 降到 O(改动量),但引入了一类**静默出错**的风险:
 * unfold(减)与 fold(加)只要有一点不对称,聚合就会永久偏移,而任何地方都不报错。
 *
 * 因此这个文件的核心是一条**等价性**断言:随机改动若干会话后走增量,结果必须与
 * "从零全量重建"一致。它是本次改动唯一的放行依据 —— 下面所有单点守卫都是它的补充。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyStore, rebuildAll, incrementalRebuildInto, unfoldSessionInto, openDeltaAcc,
  aggregatesReady, aggregatesNeedRebuild, applyConfigPatch, kpiQuery, makeFilter,
  seriesQuery, exportCsv, configStale, flushAggregates, dayKeyOf, markStale,
} from '../lib/core.mjs'
import { scanStore } from '../lib/session-source.mjs'

const DAY = 86400000
const T0 = Date.UTC(2026, 7, 1, 1, 0, 0)
const MODELS = ['deepseek-official:deepseek-flash', 'deepseek-official:deepseek-v4-pro', 'local:mystery-a']

/** 固定种子 PRNG,保证失败可复现。 */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeStore(nSessions, perSession, seed = 20260921) {
  const rand = rng(seed)
  const store = emptyStore()
  let seq = 0
  for (let s = 0; s < nSessions; s++) {
    const id = `session-${String(s).padStart(3, '0')}`
    const list = []
    for (let i = 0; i < perSession; i++) {
      list.push({
        seq: ++seq,
        t: T0 + (s % 7) * DAY + i * 60000,
        m: MODELS[Math.floor(rand() * MODELS.length)],
        miss: Math.floor(rand() * 900),
        read: Math.floor(rand() * 4000),
        write: Math.floor(rand() * 300),
        out: Math.floor(rand() * 600),
        r: 0,
        i: 0,
      })
    }
    store.requests[id] = list
    store.sessions[id] = { meta: { id, cwd: 'D:\\ws\\proj' }, totals: null, models: {}, firstTs: null, lastTs: null }
    store.watermarks[id] = { rev: '1' }
  }
  return store
}

const cloneStore = (s) => JSON.parse(JSON.stringify({
  version: s.version, updatedAt: s.updatedAt, sessionsRoot: s.sessionsRoot, storeFile: s.storeFile,
  config: s.config, watermarks: s.watermarks, quarantine: s.quarantine, sessions: s.sessions,
  days: s.days, months: s.months, stats: s.stats, requests: s.requests,
}))

/**
 * 规范化聚合树:`sessions` 子映射是**集合**语义,键顺序只是插入顺序的产物
 * (增量把被删的 id 加回时会排到末尾),不参与任何查询结果,所以按集合比。
 */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) {
      const val = v[k]
      if (k === 'sessions' && val && typeof val === 'object' && !Array.isArray(val)) out[k] = Object.keys(val).sort()
      else out[k] = canon(val)
    }
    return out
  }
  return v
}

/** 逐值比较,返回第一处差异;金额只对聚合桶放宽(见注释)。 */
function firstDiff(a, b, path = '', inAgg = false) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (a === b) return null
    // 聚合桶的汇总额是浮点减法的产物,末位可能差 1ulp。days/months 是纯派生数据、
    // **不落盘**,重启或改价时整体重算,不存在误差累积;而逐记录 cost 与全部查询输出
    // 仍要求严格相等(见下面的 useAgg=false 分支)。
    if (inAgg && (path.endsWith('.cost') || path.endsWith('.saved')) && Math.abs(a - b) <= 1e-9) return null
    return `${path}: ${a} !== ${b}`
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${path}: 类型不同`
    if (a.length !== b.length) return `${path}: 长度 ${a.length} !== ${b.length}`
    for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i], b[i], `${path}[${i}]`, inAgg); if (d) return d }
    return null
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort()
    if (ka.join(',') !== kb.join(',')) return `${path}: 键集不同 [${ka}] vs [${kb}]`
    for (const k of ka) { const d = firstDiff(a[k], b[k], `${path}.${k}`, inAgg); if (d) return d }
    return null
  }
  return a === b ? null : `${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`
}

/** 断言增量结果与全量重建等价。 */
function assertEquivalent(live, truth, msg) {
  const dd = firstDiff(canon(live.days), canon(truth.days), 'days', true)
  assert.equal(dd, null, `${msg} — days 不一致: ${dd}`)
  const dm = firstDiff(canon(live.months), canon(truth.months), 'months', true)
  assert.equal(dm, null, `${msg} — months 不一致: ${dm}`)
  // 逐记录派生字段必须严格相同(它们会落盘、也会进导出)
  for (const id of Object.keys(live.requests)) {
    assert.deepEqual(live.requests[id], truth.requests[id], `${msg} — requests[${id}] 不一致`)
  }
  for (const id of Object.keys(live.sessions)) {
    assert.deepEqual(live.sessions[id].totals, truth.sessions[id].totals, `${msg} — sessions[${id}].totals`)
    assert.deepEqual(live.sessions[id].models, truth.sessions[id].models, `${msg} — sessions[${id}].models`)
  }
}

// ---------------------------------------------------------------------------
// V67 — 增量与全量的逐值等价(本次改动的唯一放行依据)
// ---------------------------------------------------------------------------
test('V67: 增量重折必须与全量重建逐值等价(追加/缩短/删除/新增,多轮随机)', () => {
  const rand = rng(987654321)
  const live = makeStore(24, 40)
  rebuildAll(live)
  let foldedTotal = 0

  for (let round = 0; round < 25; round++) {
    // 先快照"每个会话被 fold 进去的那一份列表",再动数据 —— 一轮里同一会话被改多次
    // 时,oldList 仍然必须是改动前的状态。
    const snapshot = new Map()
    for (const id of Object.keys(live.requests)) snapshot.set(id, live.requests[id])

    const nTouch = 1 + Math.floor(rand() * 4)
    for (let k = 0; k < nTouch; k++) {
      const r = rand()
      const ids = Object.keys(live.requests)
      const id = ids[Math.floor(rand() * ids.length)]
      if (r < 0.6) {
        // 追加:必须造新数组,模拟 foldSession 返回全新列表
        const cur = (live.requests[id] || []).slice()
        const add = 1 + Math.floor(rand() * 3)
        for (let j = 0; j < add; j++) {
          cur.push({ seq: 10000 + round * 10 + j, t: T0 + (round % 9) * DAY + 500000 + j, m: MODELS[j % MODELS.length], miss: 10 + j, read: 20 + j, write: 0, out: 5 + j, r: 0, i: 0 })
        }
        live.requests[id] = cur
      } else if (r < 0.8) {
        const cur = live.requests[id] || []
        if (cur.length > 3) live.requests[id] = cur.slice(0, cur.length - 2)
      } else if (r < 0.92) {
        delete live.requests[id]; delete live.sessions[id]
      } else {
        const nid = `session-new-${round}-${Math.floor(rand() * 1000)}`
        const n = 1 + Math.floor(rand() * 4)
        const list = []
        for (let j = 0; j < n; j++) {
          list.push({ seq: 20000 + round * 10 + j, t: T0 + (30 + round) * DAY + j, m: MODELS[j % MODELS.length], miss: 7 + j, read: 11 + j, write: 0, out: 3 + j, r: 0, i: 0 })
        }
        live.requests[nid] = list
        live.sessions[nid] = { meta: { id: nid, cwd: 'D:\\ws\\other' }, totals: null, models: {}, firstTs: null, lastTs: null }
      }
    }

    const deltas = []
    for (const [id, oldList] of snapshot) {
      if (live.requests[id] !== oldList) deltas.push({ id, oldList })
    }
    for (const id of Object.keys(live.requests)) {
      if (!snapshot.has(id)) deltas.push({ id, oldList: [] })
    }
    if (!deltas.length) continue

    const truth = cloneStore(live)
    rebuildAll(truth)
    foldedTotal += incrementalRebuildInto(live, live.__agg, deltas)
    assertEquivalent(live, truth, `第 ${round} 轮`)
    assert.equal(aggregatesReady(live), true, `第 ${round} 轮后聚合必须就绪`)
  }
  assert.ok(foldedTotal > 0, '本轮测试必须真的触发过增量重折')
})

test('V67e: 增量与全量的查询/导出输出必须逐字节相同', () => {
  const live = makeStore(12, 30)
  rebuildAll(live)
  const oldList = live.requests['session-000']
  live.requests['session-000'] = oldList.concat([
    { seq: 999, t: T0 + 3 * DAY, m: MODELS[0], miss: 111, read: 222, write: 33, out: 44, r: 0, i: 0 },
  ])
  incrementalRebuildInto(live, live.__agg, [{ id: 'session-000', oldList }])

  const truth = cloneStore(live)
  rebuildAll(truth)

  const F = makeFilter(null)
  for (const range of ['all', 'today', '7d', '30d', 'month']) {
    assert.equal(
      JSON.stringify(kpiQuery(live, range, null, null, F, T0 + 60 * DAY)),
      JSON.stringify(kpiQuery(truth, range, null, null, F, T0 + 60 * DAY)),
      `kpi(${range}) 必须一致`,
    )
  }
  for (const g of ['day', 'week', 'month']) {
    assert.equal(
      JSON.stringify(seriesQuery(live, g, 'all', null, null, F, T0 + 60 * DAY)),
      JSON.stringify(seriesQuery(truth, g, 'all', null, null, F, T0 + 60 * DAY)),
      `series(${g}) 必须一致`,
    )
  }
  assert.equal(exportCsv(live, 'all', null, null, F, T0 + 60 * DAY), exportCsv(truth, 'all', null, null, F, T0 + 60 * DAY), 'exportCsv 必须一致')
})

// ---------------------------------------------------------------------------
// V68 — 配置世代:改价必须让增量失效
// ---------------------------------------------------------------------------
test('V68: 改了价格/时段必须让增量失效(configStale),且全量重折后恢复', () => {
  const store = makeStore(8, 20)
  rebuildAll(store)
  assert.equal(configStale(store), false, '刚重建完不应落后于配置')

  applyConfigPatch(store, { prices: { 'deepseek-official:deepseek-v4-pro': { miss: 1, hit: 0.1, write: 0, output: 6 } } })
  assert.equal(configStale(store), true, '改单价后聚合必须被判定为落后于配置')

  // 全量重折把聚合对齐回当前配置
  rebuildAll(store)
  assert.equal(configStale(store), false, '全量重折后必须重新对齐')
})

test('V68b: 只改刷新策略/预算不得推进配置世代(否则每次改 pageSec 都要全库重折)', () => {
  const store = makeStore(4, 10)
  rebuildAll(store)
  assert.equal(configStale(store), false)
  applyConfigPatch(store, { refresh: { pageSec: 120 } })
  assert.equal(configStale(store), false, '刷新策略不影响已落库记录的 cost/saved,不该触发重折')
  applyConfigPatch(store, { budget: { monthly: 100 } })
  assert.equal(configStale(store), false, '预算只影响展示,不该触发重折')
})

// ---------------------------------------------------------------------------
// V69 — fold / unfold 严格对称
// ---------------------------------------------------------------------------
test('V69: 对每个会话 unfold 之后,聚合树必须归零(unfold 是 fold 的精确逆)', () => {
  const live = makeStore(10, 25)
  rebuildAll(live)
  assert.ok(Object.keys(live.days).length > 0, '前置:重建后应有日桶')

  // 把所有会话逐个 unfold。若 unfold 与 fold 严格对称,减完最后一个会话后整棵树应当
  // 归零 —— 任何一处不对称(漏减 hours 子桶、models 少减一次、定价口径不同、
  // 求和顺序不同)都会留下**整数级**的残渣。
  for (const id of Object.keys(live.requests)) {
    unfoldSessionInto(openDeltaAcc(live), live, id, live.requests[id])
  }

  // 四段用量与请求数必须**精确**为 0(整数加减,可精确判定)。
  // 金额只要求回到浮点噪声量级:它们是 `x/1e6` 的浮点累加,减法不可逆,实测残差 ~1e-17。
  // 这个区别本身就是要锁的性质 —— 整数账必须绝对干净,金额账只允许末位噪声。
  const bad = []
  const check = (label, t) => {
    if (t.requests !== 0 || t.miss !== 0 || t.read !== 0 || t.write !== 0 || t.out !== 0 || t.priced !== 0) {
      bad.push(`${label}: 整数账未归零 ${JSON.stringify(t)}`)
    }
    if (Math.abs(t.cost) > 1e-12 || Math.abs(t.saved) > 1e-12) {
      bad.push(`${label}: 金额残差超出浮点噪声 ${JSON.stringify(t)}`)
    }
  }
  for (const dk of Object.keys(live.days)) {
    check(`day ${dk}.totals`, live.days[dk].totals)
    for (const mk of Object.keys(live.days[dk].models)) check(`day ${dk}.models[${mk}]`, live.days[dk].models[mk])
    for (const hk of Object.keys(live.days[dk].hours)) check(`day ${dk}.hours[${hk}]`, live.days[dk].hours[hk])
  }
  for (const mk of Object.keys(live.months)) {
    check(`month ${mk}.totals`, live.months[mk].totals)
    for (const mm of Object.keys(live.months[mk].models)) check(`month ${mk}.models[${mm}]`, live.months[mk].models[mm])
  }
  assert.deepEqual(bad, [], `unfold 全部会话后仍有残渣,说明 fold/unfold 不对称:\n${bad.join('\n')}`)
})

test('V69b: unfold 必须按**传入的旧列表**结算,不得回读 store 里的当前列表', () => {
  const live = makeStore(2, 10)
  rebuildAll(live)
  const id = 'session-000'
  const fullOldList = live.requests[id]
  // 这个会话的记录都落在同一天;但模型是随机分配的,所以要按 (日, 模型) 分别算期望值。
  const dayKey = Object.keys(live.days).sort()[0]
  const byModel = {}
  let inThisDay = 0
  for (const r of fullOldList) {
    if (dayKeyOf(r.t) !== dayKey) continue
    inThisDay++
    byModel[r.m] = (byModel[r.m] || 0) + 1
  }
  const mk = Object.keys(byModel)[0]
  assert.ok(inThisDay > 1, '这条断言依赖旧列表里有不止一条落在这个日桶')
  assert.ok(byModel[mk] > 1, '这条断言依赖该模型在这个日桶里有不止一条')
  const hourKey = String(new Date(fullOldList.find((r) => dayKeyOf(r.t) === dayKey).t + 8 * 3600 * 1000).getUTCHours())

  // 把 store 里的记录换短(模拟"已经被替换"),再传入**完整**旧列表。
  // 若 unfold 回读 store,减掉的是 1 条;按传入列表结算则按上面的条数减。
  live.requests[id] = fullOldList.slice(0, 1)
  const dayBefore = live.days[dayKey].totals.requests
  const modelBefore = live.days[dayKey].models[mk].requests
  const hourBefore = live.days[dayKey].hours[hourKey].requests

  unfoldSessionInto(openDeltaAcc(live), live, id, fullOldList)

  assert.equal(dayBefore - live.days[dayKey].totals.requests, inThisDay, '日桶必须按传入列表的条数减,而不是 store 里当前的 1 条')
  assert.equal(modelBefore - live.days[dayKey].models[mk].requests, byModel[mk], '模型桶同样按传入列表结算')
  assert.equal(hourBefore - live.days[dayKey].hours[hourKey].requests, inThisDay, '小时桶同样按传入列表结算')
})

// ---------------------------------------------------------------------------
// V70 — 删除会话必须"只减不加"
// ---------------------------------------------------------------------------
test('V70: 会话被删除时必须只做 unfold(只减不加),空桶要连壳一起清掉', () => {
  const live = makeStore(3, 10)
  rebuildAll(live)
  const id = 'session-000'
  const oldList = live.requests[id]
  delete live.requests[id]
  delete live.sessions[id]

  const truth = cloneStore(live)
  rebuildAll(truth)
  incrementalRebuildInto(live, live.__agg, [{ id, oldList }])

  assertEquivalent(live, truth, '删除会话')
  // 该会话独占的日桶必须整体消失,不能留下 {totals:0, models:{...}} 的空壳
  for (const dk of Object.keys(live.days)) {
    assert.ok(live.days[dk].totals.requests > 0, `day ${dk} 是空壳,应被清掉`)
    for (const mk of Object.keys(live.days[dk].models)) {
      assert.ok(live.days[dk].models[mk].requests > 0, `day ${dk} 的模型桶 ${mk} 是空壳`)
    }
  }
})

// ---------------------------------------------------------------------------
// V71 — 扫描侧:少量变更不得触发整库重折
// ---------------------------------------------------------------------------
function fakePersistence(sessions) {
  let reads = 0
  return {
    readCount: () => reads,
    async listSnapshots() { return Object.keys(sessions).map((id) => ({ header: { id }, revision: sessions[id].revision })) },
    async readFrom(id) { reads++; return { events: sessions[id].events, meta: { id, createdAt: T0, cwd: 'D:\\ws\\proj' } } },
    locate: (meta) => ({ path: `X:\\ws\\proj\\x\\${meta.id || ''}` }),
  }
}
function usageEvents(seqBase, t, extra = []) {
  return [
    { type: 'request/header', seq: seqBase, time: t, data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-flash' } } } },
    { type: 'assistant/message', seq: seqBase + 1, time: t + 1000, data: { turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 300 } } },
  ].concat(extra)
}

test('V71: 扫描侧少量会话变更必须走增量(不得整库重折),且聚合仍就绪', async () => {
  const store = emptyStore()
  const sessions = {}
  for (let i = 0; i < 30; i++) sessions[`s${i}`] = { revision: 1, events: usageEvents(1, T0 + i * 60000) }
  const p = fakePersistence(sessions)

  const first = await scanStore(store, p, { nowMs: T0 })
  assert.equal(first.aggMode, 'full', '冷启动必须整库重折(没有旧账可减)')
  assert.equal(aggregatesReady(store), true)

  const before = kpiQuery(store, 'all', null, null, makeFilter(null), T0).totals.requests
  assert.equal(before, 30)

  // 只改一个会话
  sessions.s7.events = usageEvents(1, T0 + 7 * 60000, [
    { type: 'assistant/message', seq: 50, time: T0 + 7 * 60000 + 5000, data: { turn: 2, step: 1, usage: { inputTokens: 700, outputTokens: 20 } } },
  ])
  sessions.s7.revision = 2
  const second = await scanStore(store, p, { nowMs: T0 })
  assert.equal(second.changed, 1, '只有一个会话变更')
  assert.equal(second.aggMode, 'incremental', '少量变更必须走增量,不得整库重折')

  const after = kpiQuery(store, 'all', null, null, makeFilter(null), T0).totals.requests
  assert.equal(after, 31, '增量后 KPI 必须反映新增的那一条')
  assert.equal(aggregatesReady(store), true)

  // 与全量重建对照
  const truth = cloneStore(store)
  rebuildAll(truth)
  assertEquivalent(store, truth, '扫描增量后')
})

test('V71b: 新增会话(无旧记录)也必须被折进聚合', async () => {
  const store = emptyStore()
  const sessions = { s1: { revision: 1, events: usageEvents(1, T0) } }
  const p = fakePersistence(sessions)
  await scanStore(store, p, { nowMs: T0 })
  assert.equal(kpiQuery(store, 'all', null, null, makeFilter(null), T0).totals.requests, 1)

  // 第二、第三个会话是新出现的:它们没有旧列表,必须走"只加"这一支
  sessions.s2 = { revision: 1, events: usageEvents(1, T0 + 3600000) }
  sessions.s3 = { revision: 1, events: usageEvents(1, T0 + 7200000) }
  const summary = await scanStore(store, p, { nowMs: T0 })
  assert.equal(summary.changed, 2)
  assert.equal(summary.aggMode, 'incremental')
  assert.equal(kpiQuery(store, 'all', null, null, makeFilter(null), T0).totals.requests, 3, '新会话必须被折进来')

  const truth = cloneStore(store)
  rebuildAll(truth)
  assertEquivalent(store, truth, '新增会话后')
})

test('V71c: 记录被修剪(retention)后聚合必须同步减少', async () => {
  const store = emptyStore()
  store.config.retention = { days: 1 }
  const sessions = {
    old1: { revision: 1, events: usageEvents(1, T0 - 5 * DAY) },
    new1: { revision: 1, events: usageEvents(1, T0) },
  }
  const p = fakePersistence(sessions)
  const summary = await scanStore(store, p, { nowMs: T0 })
  assert.equal(summary.pruned, 1)
  assert.equal(kpiQuery(store, 'all', null, null, makeFilter(null), T0).totals.requests, 1, 'KPI 只统计保留窗口内的记录')

  const truth = cloneStore(store)
  rebuildAll(truth)
  assertEquivalent(store, truth, 'retention 修剪后')
})

// ---------------------------------------------------------------------------
// V72 — 聚合形状体检必须拦住"有记录但没有聚合桶"的矛盾态
// ---------------------------------------------------------------------------
test('V72: "有 requests 但 days 为空"必须是待重建形状,不得被判定为就绪', () => {
  const store = emptyStore()
  flushAggregates(store)
  assert.equal(aggregatesReady(store), true, '真正的空库是自洽的')
  assert.equal(aggregatesNeedRebuild(store), false)

  store.requests.a = [{ seq: 1, t: T0, m: MODELS[0], miss: 1, read: 0, write: 0, out: 1, r: 0, i: 0 }]
  // 改动 requests 之后必须标脏 —— 这是生产侧(scanStore)的契约,形状缓存只以 days
  // 的对象标识为键,不标脏就会沿用改动前的结论。markStale 的注释里写了这条约定。
  markStale(store)
  assert.equal(aggregatesReady(store), false, '有记录却没有聚合桶是矛盾态,不能报就绪')
  assert.equal(aggregatesNeedRebuild(store), true, '必须要求重建')
})

test('V72b: 改动 requests 之后形状缓存必须作废(不得沿用改动前的结论)', async () => {
  const store = emptyStore()
  flushAggregates(store)                       // 空库时把形状缓存成 ok=true
  const sessions = { s1: { revision: 1, events: usageEvents(1, T0) }, s2: { revision: 1, events: usageEvents(1, T0 + 3600000) } }
  await scanStore(store, fakePersistence(sessions), { nowMs: T0 })
  // scanStore 内部必须已经标脏并重建;若缓存没被作废,这里会拿到空账
  assert.equal(kpiQuery(store, 'all', null, null, makeFilter(null), T0).totals.requests, 2, '扫描后聚合必须真的建起来')
  assert.equal(aggregatesReady(store), true)
})
