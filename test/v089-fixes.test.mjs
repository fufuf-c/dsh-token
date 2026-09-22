/**
 * dsh-token — 修复回归测试(node:test,零依赖)
 *
 * 前 13 条锁定 0.8.9 修掉的缺陷;V14 起锁定 0.8.10 由"状态不可见"这一病根查出的问题。
 * 每条都先写成**会红的**用例,再改代码 —— 否则"修好了"只是口头承诺。
 * 每条都用**变异测试**验过(把实现改回旧写法,确认对应用例真的会红)。
 *
 *   V1  rebuildAll 抛异常不得永久冻结聚合(缺 try/finally)
 *   V2  store 形态体检必须拦住会让重建抛错的形状(sessions / config 内层)
 *   V3  scanning 必须是引用计数(嵌套扫描不得提前开灯)
 *   V4  扫描进行中 flushAggregates 不得重建(半新半旧的数据比旧数据更糟)
 *   V5  逐记录成本是普通属性,不是访问器(9 倍内存放大的来源)
 *   V6  day 桶必须有日级 sessions 索引,且 activeSessions 快慢路径一致
 *   V7  sessionsQuery 走 store.sessions 快路径,且与逐记录路径输出等价
 *   V8  streakDaysOf 数值正确(去掉了每轮 new Date 分配)
 *   V9  foldSession 必须给 seq(否则 rebuildAll 排序得到 NaN 比较器)
 *   V10 export.json 超限抛 413,且不得物化全部记录
 *   V11 retention 稳态不再每轮全量重折,且修剪仍可逆
 *   V12 webPagePath 已移除(任意本地 .html 读取面)
 *   V13 缺日级索引的老库首次查询自动补齐(不升 STORE_VERSION)
 *   V14 重建中途抛异常不得留下"声称就绪"的撕裂状态
 *   V15 "需要重建"(写侧)与"能否读聚合"(读侧)是两个判据;零变化扫描不白重建
 *   V16 非标脏(扫描 dirty)的重建失败也必须回到未就绪
 *   V17 形状记忆按 days 对象身份自动失效(不靠调用点刷新)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyStore, rebuildAll, applyConfigPatch, makeFilter, kpiQuery, sessionsQuery,
  isStoreShapeValid, aggregatesReady, aggregatesNeedRebuild, markScanning, flushAggregates, foldSession,
  exportJson, apiDispatch, configView, ExportTooLargeError, STORE_VERSION,
} from '../lib/core.mjs'
import { scanStore } from '../lib/session-source.mjs'

const T = 1787632311372 // 固定锚点,避免跨午夜的不稳定
const rec = (t, over = {}) => ({ seq: 0, t, m: 'deepseek-official:deepseek-v4-flash', miss: 1, read: 0, write: 0, out: 0, ...over })

/** 一个可以直接 rebuildAll 的最小 store */
function miniStore(requests) {
  const s = emptyStore()
  s.requests = requests || {}
  s.sessions = {}
  s.watermarks = {}
  return s
}

// ---------------------------------------------------------------------------
// V1:重建抛异常后不得永久冻结
//
// 注意:rebuildAll 现在会把坏形态的 sessions[id] **就地换成合法形状**(防御),
// 所以"坏 sessions"这条路已经不会抛错了 —— 它由 V2 的形态体检负责拦。
// 这里要验的是 finally 本身:用别的异常源(priceOfModel 抛)触发中途退出,
// 确认 AGG_FLUSHING 不泄漏、后续仍能重建。
// ---------------------------------------------------------------------------
test('V1: rebuildAll 抛异常后,修好数据必须仍能重建(AGG_FLUSHING 不得泄漏)', () => {
  const s = miniStore({ a: [rec(T)] })
  // config.prices 挂一个会抛的 getter → priceOfModel 解析价格时抛错,
  // 异常发生在 AGG_FLUSHING.add 之后、delete 之前。
  let armed = true
  s.config = {
    prices: new Proxy({}, {
      get() { if (armed) throw new Error('boom during rebuild'); return undefined },
      ownKeys() { return [] },
      getOwnPropertyDescriptor() { return { enumerable: true, configurable: true, value: undefined } },
    }),
    peakHours: [], peakDays: [],
  }
  assert.throws(() => rebuildAll(s), /boom/, '应把异常抛出去(而不是吞掉)')
  armed = false
  s.config = { prices: {}, peakHours: [], peakDays: [] }
  // 旧实现:AGG_FLUSHING 泄漏 → 此后每次 rebuildAll 都在入口静默 return,
  // 聚合永久冻结且无任何日志。修好后必须能恢复。
  rebuildAll(s)
  assert.equal(Object.keys(s.days).length, 1, '修好数据后必须能重建(否则聚合永久冻结)')
  assert.equal(aggregatesReady(s), true)
})

// ---------------------------------------------------------------------------
// V2:形态体检必须拦住会让重建/查询抛错的形状
// ---------------------------------------------------------------------------
test('V2: isStoreShapeValid 拦住 sessions 与 config 内层的坏形态', () => {
  const base = { version: 6, requests: { a: [rec(T)] }, watermarks: {} }
  // sessions 此前**完全不查**:能通过体检,却在首次查询触发 rebuildAll 时抛错
  assert.equal(isStoreShapeValid({ ...base, sessions: { a: 'oops' } }), false, 'sessions 条目必须是对象')
  assert.equal(isStoreShapeValid({ ...base, sessions: { a: null } }), false, 'sessions 条目不得为 null')
  assert.equal(isStoreShapeValid({ ...base, sessions: [] }), false, 'sessions 不得是数组')
  // config 内层:peakHours 非数组会让 `for (const [a,b] of s.hours)` 抛 not iterable
  assert.equal(isStoreShapeValid({ ...base, config: { prices: 'x' } }), false, 'prices 必须是对象')
  assert.equal(isStoreShapeValid({ ...base, config: { peakHours: 5 } }), false, 'peakHours 必须是数组')
  assert.equal(isStoreShapeValid({ ...base, config: { peakDays: 'x' } }), false, 'peakDays 必须是数组')
  // 合法库(含老库缺可选字段)仍必须通过
  assert.equal(isStoreShapeValid({ ...base, sessions: { a: { meta: null } } }), true)
  assert.equal(isStoreShapeValid({ ...base, config: undefined }), true, '缺可选字段的老库必须通过')
  // 残留的 webPagePath 不应被判为损坏(它只是被忽略)
  assert.equal(isStoreShapeValid({ ...base, config: { webPagePath: 'C:\\old\\x.html' } }), true)
})

// ---------------------------------------------------------------------------
// V3:扫描标记是引用计数
// ---------------------------------------------------------------------------
test('V3: 嵌套扫描:内层结束后仍必须视为"扫描中"', () => {
  const s = miniStore({ a: [rec(T)] })
  rebuildAll(s)
  markScanning(s, true)
  markScanning(s, true)
  markScanning(s, false)
  assert.equal(aggregatesReady(s), false, '还有一次扫描未结束,聚合不得被视为就绪(旧布尔实现会误判)')
  markScanning(s, false)
  assert.equal(aggregatesReady(s), true, '全部结束后恢复就绪')
})

// ---------------------------------------------------------------------------
// V4:扫描进行中不得重建
// ---------------------------------------------------------------------------
test('V4: 扫描进行中 flushAggregates 不得重建(脏标记保留到扫描结束)', () => {
  const s = miniStore({ a: [rec(T)] })
  rebuildAll(s)
  markScanning(s, true)
  applyConfigPatch(s, { budget: { monthly: 5 } }) // 标脏
  flushAggregates(s)
  assert.equal(aggregatesReady(s), false, '扫描期间不得重建(半新半旧的数据比旧数据更糟)')
  markScanning(s, false)
  flushAggregates(s)
  assert.equal(aggregatesReady(s), true, '扫描结束后 flush 正常收口')
})

// ---------------------------------------------------------------------------
// V5:成本字段是普通数据属性
//
// 必须走**两条**会挂访问器的老路径:rebuildAll 之后(冷启动从 store.json 读回的库),
// 以及 applyConfigPatch 之后(设置页改价)。只验 rebuildAll 会漏掉 markStale 那条 ——
// 在旧实现里后者才是给全库 20 万条记录挂 getter 的地方。
// ---------------------------------------------------------------------------
test('V5: 逐记录 cost/saved/priced 必须是普通数值属性(不是访问器)', () => {
  const assertPlain = (r, when) => {
    for (const k of ['cost', 'saved', 'priced']) {
      const d = Object.getOwnPropertyDescriptor(r, k)
      assert.ok(d, `${when}:${k} 必须是自有属性`)
      assert.equal(d.get, undefined, `${when}:${k} 不得是访问器(访问器会把记录打成字典模式并放大内存)`)
      assert.equal(typeof d.value, 'number', `${when}:${k} 必须是普通数值`)
    }
    assert.equal(Object.getOwnPropertySymbols(r).length, 0, `${when}:不得残留 LAZY Symbol 位`)
  }
  const s = miniStore({ a: [rec(T, { miss: 1e6 })] })
  rebuildAll(s)
  assertPlain(s.requests.a[0], 'rebuildAll 之后')
  // 改配置(旧实现此处对全库逐条 defineLazyCost)
  applyConfigPatch(s, { prices: { 'deepseek-official:deepseek-v4-flash': { miss: 3, hit: 0, write: 0, output: 0 } } })
  assertPlain(s.requests.a[0], 'applyConfigPatch 之后')
  flushAggregates(s)
  assertPlain(s.requests.a[0], 'flush 之后')
  assert.equal(s.requests.a[0].cost, 3, 'flush 后按新价')
})

// ---------------------------------------------------------------------------
// V6:日级 sessions 索引
// ---------------------------------------------------------------------------
test('V6: day 桶带日级 sessions 索引,activeSessions 两条路径一致', () => {
  const s = miniStore({
    a: [rec(T, { m: 'p:m1' })],
    b: [rec(T, { m: 'p:m1' })],
    c: [rec(T, { m: 'p:m2' })],
  })
  rebuildAll(s)
  const dk = Object.keys(s.days)[0]
  assert.ok(s.days[dk].sessions, 'day 桶必须有日级 sessions 索引(否则无筛选 kpi 要 union 全部日×模型)')
  assert.equal(Object.keys(s.days[dk].sessions).length, 3)
  const fast = kpiQuery(s, 'all', null, null, makeFilter(null))
  assert.equal(fast.activeSessions, 3, '快路径活跃会话数应为 3')
  // 慢路径(强制回退)必须给出同一个数
  markScanning(s, true)
  const slow = kpiQuery(s, 'all', null, null, makeFilter(null))
  markScanning(s, false)
  assert.equal(slow.activeSessions, 3, '两条路径的活跃会话数必须一致')
  assert.equal(fast.totals.requests, slow.totals.requests)
})

// ---------------------------------------------------------------------------
// V7:sessionsQuery 快路径与等价性
//
// "等价"本身不足以证明快路径被走到(两条路径都会给出同样的数字)。这里用 Proxy
// 数一数**逐记录容器被访问了几次**:无筛选时若真的走了 store.sessions 索引,
// 就一次都不该碰 store.requests。
// ---------------------------------------------------------------------------
test('V7: sessionsQuery 无筛选时只读 store.sessions,不遍历逐记录', () => {
  const base = miniStore({
    a: [rec(T, { miss: 10 }), rec(T, { miss: 1 })],
    b: [rec(T - 86400000, { miss: 20 })],
  })
  base.sessions = { a: { meta: { id: 'a', title: 'A' } }, b: { meta: { id: 'b', title: 'B' } } }
  rebuildAll(base)
  const fast = sessionsQuery(base, 'tokens', 50, 'all', null, null, makeFilter(null))
  assert.equal(fast.length, 2)
  assert.equal(fast.find((x) => x.id === 'a').totals.requests, 2)

  // 数访问次数:重建已完成,快路径不该碰 store.requests
  let touches = 0
  const spy = new Proxy(base.requests, {
    get(t, k) { touches++; return t[k] },
    ownKeys(t) { touches++; return Reflect.ownKeys(t) },
    getOwnPropertyDescriptor(t, k) { return Reflect.getOwnPropertyDescriptor(t, k) },
  })
  const orig = base.requests
  base.requests = spy
  const fast2 = sessionsQuery(base, 'tokens', 50, 'all', null, null, makeFilter(null))
  base.requests = orig
  assert.equal(fast2.length, 2, '快路径必须能给出全部会话')
  assert.equal(touches, 0, `无筛选的 sessionsQuery 不该读取逐记录容器(实际访问 ${touches} 次)`)

  // 带筛选时必须回退,并给出与强制慢路径一致的结果
  markScanning(base, true)
  const slow = sessionsQuery(base, 'tokens', 50, 'all', null, null, makeFilter(null))
  markScanning(base, false)
  assert.deepEqual(fast, slow, '两条路径输出必须完全等价')
  // 模型筛选口径不同(仅被选模型),必须走逐记录
  assert.equal(sessionsQuery(base, 'tokens', 50, 'all', null, null, makeFilter({ models: 'p:m1' })).length, 0)
})

// ---------------------------------------------------------------------------
// V8:streakDaysOf
// ---------------------------------------------------------------------------
test('V8: 连续使用天数正确(且不依赖固定 73k 次循环)', () => {
  const now = T
  const requests = {}
  for (let i = 0; i < 5; i++) requests['s' + i] = [rec(now - i * 86400000)]
  const s = miniStore(requests)
  rebuildAll(s)
  const k = kpiQuery(s, 'all', null, null, makeFilter(null), now)
  assert.equal(k.streakDays, 5, '连续 5 天应计为 5')
  // 今天没有记录 → 0(不算昨天起算的连续),保持既有语义
  const gap = miniStore({ old: [rec(now - 2 * 86400000)] })
  rebuildAll(gap)
  assert.equal(kpiQuery(gap, 'all', null, null, makeFilter(null), now).streakDays, 0, '今天无记录 → 0')
})

// ---------------------------------------------------------------------------
// V9:foldSession 必带 seq
// ---------------------------------------------------------------------------
test('V9: foldSession 给无 seq 的事件回退下标(否则排序比较器是 NaN)', () => {
  const recs = foldSession([
    { type: 'assistant/message', time: 1, data: { usage: { inputTokens: 10, outputTokens: 1 } } },
    { type: 'assistant/message', time: 2, data: { usage: { inputTokens: 20, outputTokens: 1 } } },
  ])
  assert.equal(recs.length, 2)
  for (const r of recs) {
    assert.equal(typeof r.seq, 'number', 'seq 必须是有限数,否则 a.seq - b.seq 得到 NaN')
    assert.ok(Number.isFinite(r.seq))
  }
  assert.deepEqual(recs.map((r) => r.seq), [0, 1], '回退为事件下标')
})

// ---------------------------------------------------------------------------
// V10:export.json 上限
// ---------------------------------------------------------------------------
test('V10: export.json 超限抛 413,且不物化全部记录', () => {
  const s = miniStore({})
  const big = []
  for (let i = 0; i < 100002; i++) big.push(rec(T))
  s.requests = { big }
  rebuildAll(s)
  assert.throws(() => exportJson(s, 'all', null, null, makeFilter(null)), ExportTooLargeError)
  // Host 路由应翻成 413 而不是 500
  const disp = apiDispatch(s, 'export.json', { range: 'all' })
  assert.equal(disp.status, 413, 'apiDispatch 必须给 413')
  assert.match(JSON.parse(disp.body).error, /上限/, '拒绝原因应可读')
  // 未超限仍正常导出
  const small = miniStore({ a: [rec(T)] })
  rebuildAll(small)
  assert.equal(JSON.parse(exportJson(small, 'all', null, null, makeFilter(null))).count, 1)
})

// ---------------------------------------------------------------------------
// V11:retention 稳态零写放大 + 修剪可逆
// ---------------------------------------------------------------------------
test('V11: retention 稳态不再每轮全量重折,且放宽后历史回归', async () => {
  const s = emptyStore()
  const old = T - 100 * 86400000
  const events = (t) => [
    { type: 'request/header', seq: 0, time: t, data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } } } },
    { type: 'assistant/message', seq: 1, time: t, data: { turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 10 } } },
  ]
  const sessions = { s1: { revision: 1, events: events(old) } }
  const p = {
    list: async () => Object.keys(sessions).map((id) => ({ header: { id }, revision: sessions[id].revision })),
    open: async (id) => ({ header: { id, cwd: 'C:\\w' }, read: async () => ({ events: sessions[id].events }), close: async () => {} }),
    locate: () => ({ path: 'x' }),
  }
  await scanStore(s, p, { nowMs: T })
  applyConfigPatch(s, { retention: { days: 1 } })
  const r1 = await scanStore(s, p, { nowMs: T })
  assert.equal(r1.pruned, 1, '超龄记录应被修剪')
  assert.ok(s.watermarks.s1, '水位线必须保留(删掉会导致每轮全量重折)')
  assert.equal(s.watermarks.s1.prunedWith, 1, '必须记下修剪时的保留期')
  // 稳态:保留期没变 → 不得重折、不得重建、不得落盘
  const r2 = await scanStore(s, p, { nowMs: T })
  assert.equal(r2.scanned, 0, '保留期未变时不应重折')
  assert.equal(r2.pruned, 0, '已剪过的记录不该被反复统计')
  assert.equal(r2.dirty, false, '无变化时不得触发重建与落盘')
  // 放宽保留期 → 历史必须回来,而且**只能重折一次**
  applyConfigPatch(s, { retention: { days: 0 } })
  const r3 = await scanStore(s, p, { nowMs: T })
  assert.equal(r3.scanned, 1, '保留期改了 → 应重折一次')
  assert.equal(kpiQuery(s, 'all', null, null, makeFilter(null), T).totals.requests, 1, '放宽后历史必须回归')
  // 关键:重折之后标记必须被清掉,否则「标记=1 ≠ 当前=0」恒成立 → 每轮都重折
  // (这正是本版要修的缺陷的另一个形态,自己实现时真的踩过一次)
  assert.equal(s.watermarks.s1.prunedWith, undefined, '重折后必须清掉旧的修剪标记')
  const r4 = await scanStore(s, p, { nowMs: T })
  const r5 = await scanStore(s, p, { nowMs: T })
  assert.equal(r4.scanned, 0, '放宽后第 2 轮不得再重折')
  assert.equal(r4.dirty, false, '放宽后第 2 轮不得判定为脏')
  assert.equal(r5.scanned, 0, '放宽后第 3 轮同样不得重折')
})

// ---------------------------------------------------------------------------
// V12:webPagePath 已移除
// ---------------------------------------------------------------------------
test('V12: webPagePath 已移除(拒绝 + 不回显 + 老库残留被忽略)', () => {
  const s = miniStore({ a: [rec(T)] })
  assert.throws(() => applyConfigPatch(s, { webPagePath: 'C:\\secret.html' }), /移除/)
  assert.throws(() => applyConfigPatch(s, { webPagePath: '\\\\evil\\share\\p.html' }), /移除/)
  assert.equal(s.config.webPagePath, undefined, '不得写进配置')
  assert.equal(configView(s).webPagePath, undefined, '配置视图不得回显')
  // 老库残留字段被忽略,也不因此判定损坏
  const legacy = miniStore({ a: [rec(T)] })
  legacy.config.webPagePath = 'C:\\old\\skin.html'
  assert.equal(isStoreShapeValid(legacy), true)
  rebuildAll(legacy)
  assert.equal(configView(legacy).webPagePath, undefined, '残留字段不得出现在配置视图')
})

// ---------------------------------------------------------------------------
// V13:老库(0.8.7 及更早)冷启动必须自动补齐日级索引,且不升版本
//
// 这条是 0.8.9 开发过程中实测发现的缺口:老库**不脏**(没人改配置),但它缺 0.8.9
// 才引入的 day.sessions 索引。若 flushAggregates 只看脏标记,升级后的用户会永久
// 跑在慢路径上而毫无提示。这里锁住"就绪也触发重建 + 不升 STORE_VERSION"。
// ---------------------------------------------------------------------------
test('V13: 缺日级索引的老库在首次查询时自动补齐(不升 STORE_VERSION)', () => {
  // 构造一个"0.8.7 形状"的老 store.json:有 days/models、聚合内容是对的,
  // 但没有 0.8.9 才引入的 day.sessions。经 JSON 往返得到**全新对象**,
  // 与"冷启动从磁盘读回"完全同构(就绪判定按对象缓存,必须是新对象才不命中缓存)。
  const seed = miniStore({ a: [rec(T, { miss: 7 })] })
  seed.sessions = { a: { meta: { id: 'a' }, totals: null, models: {}, firstTs: null, lastTs: null } }
  rebuildAll(seed)
  const raw = JSON.parse(JSON.stringify(seed))
  for (const k of Object.keys(raw.days)) delete raw.days[k].sessions

  assert.equal(aggregatesReady(raw), false, '缺日级索引必须判为未就绪')
  assert.equal(raw.version, STORE_VERSION, '不得升版本')

  // 首次查询应自行补齐
  const k = kpiQuery(raw, 'all', null, null, makeFilter(null))
  assert.equal(k.totals.miss, 7, '补齐过程中数值不得变化')
  assert.ok(raw.days[Object.keys(raw.days)[0]].sessions, '补齐后必须有日级索引')
  assert.equal(aggregatesReady(raw), true, '补齐后应就绪')
  assert.equal(raw.version, STORE_VERSION, '补齐不得改 STORE_VERSION(否则会强制全量重解码)')
  // 补齐结果必须能被持久化:落盘再读回,就绪状态保持
  const again = JSON.parse(JSON.stringify(raw))
  assert.equal(aggregatesReady(again), true, '补齐后的形状必须持久化(再加载无需重算)')
})

// ---------------------------------------------------------------------------
// V14:重建中途抛异常不得留下"声称就绪"的撕裂状态
//
// 0.8.9 在 rebuildAll **入口**就清掉脏标记。于是重建跑到一半抛异常时:
//   · requests 里的 r.cost 已被改写了一部分(撕裂),
//   · store.days 仍是旧值(尚未发布),
//   · 而脏标记已清 → aggregatesReady 返回 true。
// 结果:无筛选查询读旧聚合、带 session 筛选查询读撕裂的逐记录,同一时刻两个答案。
// 0.8.10 把清除移到**成功之后**,并用 finally 兜住失败路径。
// ---------------------------------------------------------------------------
test('V14: 重建中途抛异常后必须仍判为未就绪(不得声称就绪)', () => {
  const s = miniStore({ a: [rec(T, { miss: 1e6 })] })
  rebuildAll(s)
  assert.equal(aggregatesReady(s), true, '前置:初始应就绪')
  // 让下一次重建在改写记录成本时抛错(异常发生在 days 发布之前)
  let armed = true
  Object.defineProperty(s.requests.a[0], 'cost', {
    configurable: true, enumerable: true,
    get() { return 0 },
    set() { if (armed) throw new Error('boom mid-rebuild') },
  })
  applyConfigPatch(s, { budget: { monthly: 1 } }) // 标脏,逼下一次读取重建
  assert.equal(aggregatesReady(s), false, '标脏后必须未就绪')
  assert.throws(() => kpiQuery(s, 'all', null, null, makeFilter(null), T), /boom/)
  // 关键断言:异常之后不得声称就绪,否则读侧会拿到"旧聚合 + 半新半旧的逐记录"
  assert.equal(aggregatesReady(s), false, '重建失败后仍必须未就绪(旧实现在入口清脏标记 → 这里会误判为 true)')
  // 失败必须能自愈:下一次读取自动重试
  armed = false
  const k = kpiQuery(s, 'all', null, null, makeFilter(null), T)
  assert.equal(k.totals.requests, 1, '修好数据后下一次读取应自动重建成功')
  assert.equal(aggregatesReady(s), true, '重试成功后恢复就绪')
})

// ---------------------------------------------------------------------------
// V15:"数据是否需要重建"(写侧)与"此刻能否读聚合"(读侧)必须是两个判据
//
// 扫描窗口内两者必然相反:读侧必须回退(scanning>0 → 不可读),但数据并未欠重建。
// 0.8.9 只有一个函数,于是 scanStore 收尾时 `!aggregatesReady(store)` 恒为 true,
// **每一轮零变化的周期扫描都白做一次全量 rebuildAll**(实测 dirty=false、rebuilds=1)。
// ---------------------------------------------------------------------------
test('V15: 扫描窗口内"无需重建",且零变化的周期扫描不再白重建', async () => {
  const s = miniStore({ a: [rec(T)] })
  rebuildAll(s)
  markScanning(s, true)
  // 读侧:不可读(窗口保护)
  assert.equal(aggregatesReady(s), false, '扫描期间读侧必须回退')
  // 写侧:数据并未欠重建 —— 这正是 0.8.9 缺的那个判据
  assert.equal(aggregatesNeedRebuild(s), false, '扫描期间数据并未欠重建(旧实现用 !aggregatesReady 会误判为 true)')
  markScanning(s, false)
  assert.equal(aggregatesReady(s), true, '扫描结束恢复可读')

  // 端到端:零变化的第二次扫描不得触发 rebuildAll
  const ev = (t) => [
    { type: 'request/header', seq: 0, time: t, data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } } } },
    { type: 'assistant/message', seq: 1, time: t, data: { turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 10 } } },
  ]
  const sessions = { s1: { revision: 1, events: ev(T) } }
  const p = {
    list: async () => Object.keys(sessions).map((id) => ({ header: { id }, revision: sessions[id].revision })),
    open: async (id) => ({ header: { id, cwd: 'C:\\w' }, read: async () => ({ events: sessions[id].events }), close: async () => {} }),
  }
  const st = emptyStore()
  await scanStore(st, p, { nowMs: T })
  // 数 rebuildAll 是否被调用:它必定给 store.days 重新赋值
  let rebuilds = 0
  const realDays = st.days
  Object.defineProperty(st, 'days', {
    configurable: true, enumerable: true,
    get() { return realDays },
    set() { rebuilds++ },
  })
  rebuilds = 0
  const r2 = await scanStore(st, p, { nowMs: T + 60000 })
  assert.equal(r2.dirty, false, '零变化扫描不得判脏')
  assert.equal(r2.scanned, 0, '零变化扫描不得重折')
  assert.equal(rebuilds, 0, `零变化的周期扫描不得重建聚合(实际重建 ${rebuilds} 次)`)
})

// ---------------------------------------------------------------------------
// V16:非"标脏"触发的重建失败也必须回到未就绪
//
// V14 覆盖的是"标脏 → 重建失败":那时 stale 本来就是 true,靠它就能挡住误判。
// 但还有另一条真实路径:scanStore 在**有变化**时直接调 rebuildAll,而此刻
// stale=false、形状本来是好的(dirty=true 是唯一的重建理由)。若这次重建中途抛异常,
// 只有"失败即置脏"这条 finally 兜底能阻止 aggregatesReady 声称就绪 ——
// 否则读侧会同时拿到旧聚合与半新半旧的逐记录(撕裂),正是本版要消灭的那类不一致。
// ---------------------------------------------------------------------------
test('V16: 扫描引发(dirty)的重建失败后不得声称就绪', () => {
  const s = miniStore({ a: [rec(T, { miss: 1e6 })] })
  rebuildAll(s)
  assert.equal(aggregatesReady(s), true, '前置:就绪')
  assert.equal(aggregatesNeedRebuild(s), false, '前置:并不欠重建(stale=false、形状正常)')
  // 直接触发重建并在中途抛错 —— 模拟 scanStore 的 dirty 路径
  const orig = s.config.prices
  let armed = true
  s.config = {
    prices: new Proxy({}, {
      get() { if (armed) throw new Error('boom during dirty rebuild'); return undefined },
      ownKeys() { return [] },
      getOwnPropertyDescriptor() { return { enumerable: true, configurable: true, value: undefined } },
    }),
    peakHours: [], peakDays: [],
  }
  assert.throws(() => rebuildAll(s), /boom/, '异常必须抛出去')
  assert.equal(aggregatesReady(s), false,
    '非标脏的重建失败后仍必须未就绪(否则读侧会拿到撕裂数据)')
  // 自愈:修好后下一次读取自动重建
  armed = false
  s.config = { prices: orig || {}, peakHours: [], peakDays: [] }
  const k = kpiQuery(s, 'all', null, null, makeFilter(null), T)
  assert.equal(k.totals.requests, 1)
  assert.equal(aggregatesReady(s), true, '重试成功后恢复就绪')
})

// ---------------------------------------------------------------------------
// V17:形状记忆必须按 days 的**对象身份**绑定,而不是靠调用点"记得刷新"
//
// 这是 0.8.10 把"纪律问题"变成"结构问题"的判定点。缓存若只是一个布尔,就必须
// 依赖每个改写 days 的地方都记得清掉它 —— 那正是本版要消灭的缺陷类型。按身份绑定后,
// 外部替换 days(无需任何刷新调用)会让记忆自动失效。
// ---------------------------------------------------------------------------
test('V17: 形状记忆按 days 对象身份自动失效(无需调用点刷新)', () => {
  const s = miniStore({ a: [rec(T)] })
  rebuildAll(s)
  assert.equal(aggregatesReady(s), true, '前置:就绪')
  // 外部替换 days 为"老形状"(缺日级 sessions),不做任何刷新调用
  const oldDays = JSON.parse(JSON.stringify(s.days))
  for (const k of Object.keys(oldDays)) delete oldDays[k].sessions
  s.days = oldDays
  assert.equal(aggregatesReady(s), false, 'days 换了对象 → 记忆必须自动失效(否则会沿用旧的 true)')
  assert.equal(aggregatesNeedRebuild(s), true)
  // 查询应自行补齐
  assert.equal(kpiQuery(s, 'all', null, null, makeFilter(null), T).totals.requests, 1)
  assert.equal(aggregatesReady(s), true, '补齐后恢复就绪')

  // 反向:换成"缺逐模型 sessions"的 days 也必须被判为未就绪
  const s2 = miniStore({ a: [rec(T)] })
  rebuildAll(s2)
  aggregatesReady(s2) // 建立记忆
  const bad = JSON.parse(JSON.stringify(s2.days))
  const dk = Object.keys(bad)[0]
  delete bad[dk].models[Object.keys(bad[dk].models)[0]].sessions
  s2.days = bad
  assert.equal(aggregatesReady(s2), false, '缺逐模型 sessions 也必须判为未就绪')
})
