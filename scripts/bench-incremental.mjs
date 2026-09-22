/**
 * 增量聚合等价性 + 性能对照(0.9.5 开发期脚本,不进发布包)
 *
 * 用固定种子的合成库存反复做"改若干会话 → 扫描"的多轮循环,每一轮都把增量结果与
 * "从零全量重建"逐字节比对。等价性不过就不许发版。
 *
 * 用法:node scripts/bench-incremental.mjs [会话数] [每会话请求数] [轮数]
 */
import {
  emptyStore, rebuildAll, incrementalRebuildInto, aggregatesReady,
  configStale, touchConfigEpoch, kpiQuery, makeFilter, seriesQuery, exportCsv,
} from '../lib/core.mjs'

const SESSIONS = Number(process.argv[2] || 40)
const PER = Number(process.argv[3] || 60)
const ROUNDS = Number(process.argv[4] || 30)

// ---------- 固定种子 PRNG(mulberry32),保证可复现 ----------
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
const rand = rng(20260921)
const pick = (arr) => arr[Math.floor(rand() * arr.length)]

const MODELS = ['deepseek-official:deepseek-flash', 'deepseek-official:deepseek-v4-pro', 'local:mystery-a', 'local:mystery-b']
const DAY = 86400000
const T0 = Date.UTC(2026, 7, 1, 1, 0, 0)

function makeRecord(i, base) {
  const read = Math.floor(rand() * 4000)
  const write = rand() < 0.15 ? Math.floor(rand() * 500) : 0
  const miss = Math.floor(rand() * 900)
  return {
    seq: i + 1,
    t: base + Math.floor(rand() * 6) * 3600000,
    m: pick(MODELS),
    miss, read, write,
    out: Math.floor(rand() * 600),
    r: 0,
    i: rand() < 0.05 ? 1 : 0,
  }
}

function makeSession(id, n, dayOffset) {
  const base = T0 + dayOffset * DAY
  const list = []
  for (let i = 0; i < n; i++) list.push(makeRecord(i, base))
  return { id, list }
}

function cloneStore(s) {
  return JSON.parse(JSON.stringify({
    version: s.version, updatedAt: s.updatedAt, sessionsRoot: s.sessionsRoot, storeFile: s.storeFile,
    config: s.config, watermarks: s.watermarks, quarantine: s.quarantine, sessions: s.sessions,
    days: s.days, months: s.months, stats: s.stats, requests: s.requests,
  }))
}

function buildStore(sessions) {
  const st = emptyStore()
  for (const s of sessions) {
    st.requests[s.id] = JSON.parse(JSON.stringify(s.list))
    st.sessions[s.id] = { meta: { id: s.id, cwd: 'D:\\ws\\proj' }, totals: null, models: {}, firstTs: null, lastTs: null }
    st.watermarks[s.id] = { rev: '1' }
  }
  return st
}

/**
 * 规范化:把"集合语义"的子映射按内容排序。
 *
 * `day.sessions` / `dm.sessions` 是 `{sessionId: 1}` 这种**集合**,它的键顺序只是插入
 * 顺序的产物(增量路径加回被删的 id 会排到末尾)。集合顺序不参与任何查询结果 ——
 * 查询侧一律 `Object.keys()` 收集进 Set 再排序。所以比较时必须按集合比,否则会被
 * 一个无意义的顺序差异挡住,而真正的数值差异反而看不见。
 * 其余键(totals 的字段、hours 的小时号、models 的模型名)顺序由插入决定但语义上是映射,
 * 一并排序以免误报。
 */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) {
      const val = v[k]
      // sessions 子映射:压成排序后的 id 列表
      if (k === 'sessions' && val && typeof val === 'object' && !Array.isArray(val)) {
        out[k] = Object.keys(val).sort()
      } else out[k] = canon(val)
    }
    return out
  }
  return v
}
const cj = (x) => JSON.stringify(canon(x))

/**
 * 金额容差(元)。只用于**聚合桶里的汇总金额**。
 *
 * 为什么需要:增量是 `unfold(减) → fold(加)`,浮点减法不可逆。实测 200 会话 × 150 条
 * 规模下,残余差 ≈1e-12 元(在 ¥87 上,相对 1.1e-14 —— 就是 double 在该量级的 1 ULP)。
 * 单次进入增量的会话越多,尾数噪声越容易堆在同一轮。
 *
 * 为什么可以接受:days/months 是**纯派生数据,不落盘**(storeMeta 只存 sessions 与
 * 元数据),重启或改价时会整体重算,所以不存在"误差在库里累积"。真正对外的契约 ——
 * 落盘分片里的逐记录 cost/saved、以及全部查询与导出 —— 仍然要求**逐字节相同**,
 * 下面就是按这个口径分开断言的。
 */
const MONEY_TOL = 1e-9

/** 逐值比较,返回第一处差异的描述(或 null)。 */
function firstDiff(a, b, path = '', inAgg = false) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (a === b) return null
    // 只对聚合树里的金额字段放宽
    if (inAgg && (path.endsWith('.cost') || path.endsWith('.saved')) && Math.abs(a - b) <= MONEY_TOL) return null
    return `${path}: live=${a} truth=${b} (差 ${Math.abs(a - b)})`
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${path}: 类型不同`
    if (a.length !== b.length) return `${path}: 长度 live=${a.length} truth=${b.length}`
    for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i], b[i], `${path}[${i}]`, inAgg); if (d) return d }
    return null
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort()
    if (ka.join(',') !== kb.join(',')) return `${path}: 键集不同 live=[${ka}] truth=[${kb}]`
    for (const k of ka) { const d = firstDiff(a[k], b[k], `${path}.${k}`, inAgg); if (d) return d }
    return null
  }
  if (a !== b) return `${path}: live=${JSON.stringify(a)} truth=${JSON.stringify(b)}`
  return null
}

/** 聚合树比较:键序无关,金额字段带容差。 */
function aggEqual(a, b, label) {
  const ka = Object.keys(a).sort().join(','), kb = Object.keys(b).sort().join(',')
  if (ka !== kb) return `${label} 键集不同: live=[${ka}] truth=[${kb}]`
  return firstDiff(canon(a), canon(b), label, true)
}

/** 逐字节比较两个 store 的聚合与逐记录派生字段。 */
function diffOf(a, b) {
  const out = []
  const dd = aggEqual(a.days, b.days, 'days')
  if (dd) out.push(dd)
  const dm = aggEqual(a.months, b.months, 'months')
  if (dm) out.push(dm)
  // 逐记录派生字段必须**逐字节**相同(它们会落盘、也会进导出)
  for (const id of Object.keys(a.requests)) {
    const ra = JSON.stringify(a.requests[id]), rb = JSON.stringify(b.requests[id])
    if (ra !== rb) { out.push(`requests[${id}] 不一致`); break }
  }
  const sa = JSON.stringify(Object.keys(a.sessions).sort().map((k) => [k, a.sessions[k].totals, a.sessions[k].models, a.sessions[k].firstTs, a.sessions[k].lastTs]))
  const sb = JSON.stringify(Object.keys(b.sessions).sort().map((k) => [k, b.sessions[k].totals, b.sessions[k].models, b.sessions[k].firstTs, b.sessions[k].lastTs]))
  if (sa !== sb) out.push('sessions 不一致')
  return out
}

// ---------- 等价性:多轮"改若干会话 → 增量 vs 全量" ----------
let sessions = []
for (let i = 0; i < SESSIONS; i++) sessions.push(makeSession('session-' + String(i).padStart(3, '0'), PER, i % 14))

const live = buildStore(sessions)
rebuildAll(live)
let failures = 0
let totalUnfolded = 0

for (let round = 0; round < ROUNDS; round++) {
  // 先把"每个会话被 fold 进去的那一份列表"整体快照下来,再动数据。
  // 这样无论一轮里同一个会话被改几次,oldList 都是真正的旧状态。
  const snapshot = new Map()
  for (const id of Object.keys(live.requests)) snapshot.set(id, live.requests[id])
  const beforeSessions = new Set(Object.keys(live.requests))

  const nTouch = 1 + Math.floor(rand() * 5)
  for (let k = 0; k < nTouch; k++) {
    const r = rand()
    if (r < 0.6) {
      const idx = Math.floor(rand() * SESSIONS)
      const id = sessions[idx].id
      const add = 1 + Math.floor(rand() * 4)
      // ⚠ 造新数组,不原地 push:真实扫描里 foldSession 返回全新列表,旧列表对象不动。
      const cur = (live.requests[id] || []).slice()
      for (let j = 0; j < add; j++) cur.push(makeRecord(cur.length + j, T0 + (idx % 14) * DAY + round * 3600000))
      live.requests[id] = cur
    } else if (r < 0.8) {
      const idx = Math.floor(rand() * SESSIONS)
      const id = sessions[idx].id
      const cur = live.requests[id] || []
      if (cur.length > 3) live.requests[id] = cur.slice(0, cur.length - 2)
    } else if (r < 0.92) {
      const idx = Math.floor(rand() * SESSIONS)
      const id = sessions[idx].id
      if (live.requests[id]) { delete live.requests[id]; delete live.sessions[id] }
    } else {
      const id = `session-new-${round}-${Math.floor(rand() * 1000)}`
      const n = 1 + Math.floor(rand() * 5)
      const dayOffset = Math.floor(rand() * 40)
      const list = []
      for (let j = 0; j < n; j++) list.push(makeRecord(j, T0 + dayOffset * DAY + round * 3600000))
      live.requests[id] = list
      live.sessions[id] = { meta: { id, cwd: 'D:\\ws\\other' }, totals: null, models: {}, firstTs: null, lastTs: null }
    }
  }

  // 差集:内容变了或消失了的会话
  const deltas = []
  for (const [id, oldList] of snapshot) {
    const now = live.requests[id]
    if (now === oldList) continue              // 引用没变 = 没动过
    deltas.push({ id, oldList })
  }
  for (const id of Object.keys(live.requests)) {
    if (snapshot.has(id)) continue
    deltas.push({ id, oldList: [] })           // 新增:无需减法
  }

  // 真值:同样内容做一次全量重建
  const truth = cloneStore(live)
  rebuildAll(truth)

  // 增量:在 live 上只重折被改动的会话(先减旧列表、再加新列表)
  const st = live.__agg
  const refolded = incrementalRebuildInto(live, st, deltas)
  totalUnfolded += refolded

  const d = diffOf(live, truth)
  if (d.length) {
    failures++
    console.error(`❌ round ${round}: ${d.join('; ')}(deltas=${deltas.length})`)
    const liveDays = Object.keys(live.days), truthDays = Object.keys(truth.days)
    console.error(`   days 键: live=[${liveDays}] truth=[${truthDays}]`)
    for (const k of truthDays) {
      if (JSON.stringify(live.days[k]) !== JSON.stringify(truth.days[k])) {
        console.error(`   首个差异日 ${k}:`)
        console.error(`     live : ${JSON.stringify(live.days[k])}`)
        console.error(`     truth: ${JSON.stringify(truth.days[k])}`)
        break
      }
    }
    if (failures >= 2) break
  } else if (round % 5 === 0) {
    console.log(`✓ round ${String(round).padStart(2)}: deltas=${String(deltas.length).padStart(2)} refolded=${refolded} 等价`)
  }

  // 增量结果必须仍被判定为"可用聚合"
  if (!aggregatesReady(live)) { console.error(`❌ round ${round}: 增量后 aggregatesReady=false`); failures++; break }
  if (configStale(live)) { console.error(`❌ round ${round}: 增量后 configStale=true`); failures++; break }
}

// ---------- 查询输出等价(含快路径与导出) ----------
const truthFinal = cloneStore(live)
rebuildAll(truthFinal)
const F = makeFilter(null)
const queryDiff = []
for (const range of ['all', 'today', '7d', '30d', 'month']) {
  const a = JSON.stringify(kpiQuery(live, range, null, null, F, T0 + 60 * DAY))
  const b = JSON.stringify(kpiQuery(truthFinal, range, null, null, F, T0 + 60 * DAY))
  if (a !== b) queryDiff.push(`kpi(${range})`)
}
for (const g of ['day', 'week', 'month']) {
  const a = seriesQuery(live, g, 'all', null, null, F, T0 + 60 * DAY)
  const b = seriesQuery(truthFinal, g, 'all', null, null, F, T0 + 60 * DAY)
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    queryDiff.push(`series(${g})`)
    const sa = JSON.stringify(a), sb = JSON.stringify(b)
    let i = 0
    while (i < sa.length && i < sb.length && sa[i] === sb[i]) i++
    console.log(`\n[series(${g}) 差异] 首个不同字符 @${i}`)
    console.log('  live :', sa.slice(Math.max(0, i - 120), i + 160))
    console.log('  truth:', sb.slice(Math.max(0, i - 120), i + 160))
  }
}
const csvA = exportCsv(live, 'all', null, null, F, T0 + 60 * DAY)
const csvB = exportCsv(truthFinal, 'all', null, null, F, T0 + 60 * DAY)
if (csvA !== csvB) queryDiff.push('exportCsv')

console.log('\n──────── 结果 ────────')
console.log(`会话 ${SESSIONS} × 每会话 ${PER} 条 · 轮数 ${ROUNDS} · 累计重折会话 ${totalUnfolded}`)
console.log(`聚合逐字节等价:${failures === 0 ? 'PASS' : `FAIL(${failures})`}`)
console.log(`查询/导出等价:${queryDiff.length === 0 ? 'PASS' : 'FAIL → ' + queryDiff.join(', ')}`)
console.log(`配置世代:configStale=${configStale(live)}(必须为 false)`)

// ---------- 性能对照:增量 vs 全量 ----------
function timeIt(label, fn, iters = 20) {
  fn()
  const t = []
  for (let i = 0; i < iters; i++) { const s = process.hrtime.bigint(); fn(); t.push(Number(process.hrtime.bigint() - s) / 1e6) }
  t.sort((a, b) => a - b)
  console.log(`  ${label.padEnd(28)} p50=${t[Math.floor(t.length / 2)].toFixed(2)}ms p95=${t[Math.floor(t.length * 0.95)].toFixed(2)}ms`)
}
const work = cloneStore(live)
rebuildAll(work)
const ids = Object.keys(work.requests).slice(0, 2)
const deltas = ids.map((id) => ({ id, oldList: work.requests[id] }))
console.log('\n──────── 性能(重折 2 个会话)────────')
timeIt('增量 incrementalRebuildInto', () => incrementalRebuildInto(work, work.__agg, deltas))
timeIt('全量 rebuildAll', () => rebuildAll(work))

process.exit(failures === 0 && queryDiff.length === 0 ? 0 : 1)
