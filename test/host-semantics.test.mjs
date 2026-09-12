/**
 * dsh-token — 宿主语义专项测试(node:test,零依赖)
 *
 * 这里锁的是**容易被"本机恰好正确"掩盖**的口径与边界:
 *   1. 小时桶 = 北京时间(而非宿主本地时区),且聚合/逐记录两条路径必须同口径;
 *   2. kpi 顶层必须显式报出"未定价 tokens",不许让成本 0 的部分冒充完整成本;
 *   3. peakDay 在无用量时是 null,不是"tokens 为 0 的伪日期";
 *   4. 配置变更(单价/时段)后**立刻读** r.cost 拿到的必须是新价(惰性重建的对外语义);
 *   5. store.json 形态体检:截断/类型错乱的库必须被判不合格(否则会被静默清零覆盖)。
 *
 * 1 之所以写成"UTC+8 固定偏移"而不是改 process.env.TZ:Node 的时区在进程内缓存,
 * 想在同一个测试进程里模拟别的宿主时区只能靠子进程 —— 而 CI(e2e-smoke)覆盖真实
 * HTTP 路径,这里用固定偏移锁住"任何宿主时区下结果相同"这个不变式即可。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyStore, rebuildAll, applyConfigPatch, makeFilter, kpiQuery, hoursQuery,
  sessionDetailQuery, newTotals, aggregate, isStoreShapeValid, beijingDayOf, dayKeyOf, monthKeyOf,
  beijingHourOf, isPeakHour, peakSchedule, STORE_VERSION,
} from '../lib/core.mjs'

/** 北京时间 → epoch ms(北京时间 = UTC+8),不受运行环境 TZ 影响 */
const bj = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 8, mi)

/** 构造一个只有一条请求的最小 store(记录走 newTotals/aggregate 之外的直构路径) */
function storeWithOne(ms, model = 'deepseek-official:deepseek-v4-flash', usage = { miss: 1000 }) {
  const store = emptyStore()
  store.requests['s1'] = [{
    seq: 1, t: ms, m: model,
    miss: usage.miss || 0, read: usage.read || 0, write: usage.write || 0, out: usage.out || 0,
    r: 0, i: 0,
  }]
  store.sessions['s1'] = { meta: { id: 's1' }, totals: newTotals(), models: {}, firstTs: ms, lastTs: ms }
  return store
}

// ---------------------------------------------------------------------------
// 1. 小时桶时区口径
// ---------------------------------------------------------------------------
test('小时桶:聚合快路径按北京时间分桶(周二 10:00 北京 = 02:00Z 落在 10 点)', () => {
  const ms = bj(2026, 9, 8, 10) // 周二 10:00 北京
  const store = storeWithOne(ms)
  rebuildAll(store)
  const hours = hoursQuery(store, 'all', null, null, makeFilter(null))
  const nonZero = hours.map((b, i) => (b.totals.miss ? i : null)).filter((x) => x !== null)
  assert.deepEqual(nonZero, [10], `聚合路径应落在北京 10 点桶,实际 ${JSON.stringify(nonZero)}`)
})

test('小时桶:逐记录慢路径与聚合路径同口径(模型筛选会强制走慢路径)', () => {
  const ms = bj(2026, 9, 8, 10)
  const store = storeWithOne(ms)
  rebuildAll(store)
  const fast = hoursQuery(store, 'all', null, null, makeFilter(null)) // 无模型筛选 → 聚合
  const slow = hoursQuery(store, 'all', null, null, makeFilter({ models: 'deepseek-official:deepseek-v4-flash' })) // → 逐记录
  const nz = (h) => h.map((b, i) => (b.totals.miss ? i : null)).filter((x) => x !== null)
  assert.deepEqual(nz(slow), [10], '慢路径也必须用北京时间')
  assert.deepEqual(nz(slow), nz(fast), '两条路径的小时桶必须一致')
})

test('小时桶:24 小时分布固定 24 桶,且总和 = 总 tokens', () => {
  const store = emptyStore()
  let cum = 0
  for (let h = 0; h < 24; h++) {
    const ms = bj(2026, 9, 8, h, 30) // 周二 09-12/14-18 为高峰
    store.requests[`s${h}`] = [{ seq: 1, t: ms, m: 'deepseek-official:deepseek-v4-flash', miss: 100 + h, read: 0, write: 0, out: 0, r: 0, i: 0 }]
    cum += 100 + h
  }
  rebuildAll(store)
  const hours = hoursQuery(store, 'all', null, null, makeFilter(null))
  assert.equal(hours.length, 24)
  assert.equal(hours.reduce((s, b) => s + b.totals.miss, 0), cum, '24 桶之和应等于全部用量')
  assert.ok(hours.every((b, i) => b.hour === i), '桶序号必须与数组下标一致(前端按下标画柱)')
})

test('小时桶:与高峰取档同口径(高峰小时的桶必须落在高峰时段内)', () => {
  // 北京周二 10:00(高峰)与 22:00(空闲)各一条;时区口径若不一致,高亮会错位
  for (const [h, onPeak] of [[10, true], [22, false]]) {
    const ms = bj(2026, 9, 8, h)
    assert.equal(isPeakHour(ms, peakSchedule(emptyStore())), onPeak, `北京 ${h} 点的高峰判定`)
    assert.equal(beijingHourOf(ms), h, `北京 ${h} 点应归入第 ${h} 桶`)
  }
})

test('会话下钻与 kpi 使用同一套北京时间口径', () => {
  const ms = bj(2026, 9, 8, 14) // 北京周二 14:00 = 高峰起点
  const store = storeWithOne(ms)
  rebuildAll(store)
  const d = sessionDetailQuery(store, 's1', { brief: true })
  assert.equal(d.hours[14], 1000, '会话面板的 24 桶按北京时间')
  assert.equal(d.hoursPeak[14], 1000, '北京 14:00 属高峰,应同时计入高峰桶')
  assert.equal(d.tiers.peak.tokens, 1000)
  assert.equal(d.tiers.idle.tokens, 0)
})

test('beijingDayOf:跨零点按北京时间换日(UTC 16:00 = 北京次日 00:00)', () => {
  assert.equal(beijingDayOf(Date.UTC(2026, 8, 8, 15, 59)), '2026-09-08')
  assert.equal(beijingDayOf(Date.UTC(2026, 8, 8, 16, 0)), '2026-09-09')
})

test('两条时区口径并存且各自稳定:日桶=宿主本地,高峰小时桶=北京时间', () => {
  // 锚在本地中午:前后 ±12 小时都不跨本地日,所以这个断言在任何宿主时区都成立。
  // 若哪天有人"顺手统一"成单一口径,这里会立刻失败 —— 那正是需要被提醒的时刻。
  const anchor = new Date(2026, 7, 25, 12, 0, 0, 0).getTime()
  const localKey = dayKeyOf(anchor)
  assert.match(localKey, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(dayKeyOf(anchor + 3600 * 1000), localKey, '±1h 仍在同一个本地日')
  assert.equal(dayKeyOf(anchor - 3600 * 1000), localKey, '−1h 仍在同一个本地日')
  assert.equal(monthKeyOf(anchor), localKey.slice(0, 7))
  assert.match(beijingDayOf(anchor), /^\d{4}-\d{2}-\d{2}$/)
  // 小时桶固定北京时间:同一瞬间在任何宿主时区都落在同一个桶
  const known = Date.UTC(2026, 8, 8, 2, 0, 0) // 北京 10:00
  assert.equal(beijingHourOf(known), 10)
  assert.equal(isPeakHour(known, peakSchedule(emptyStore())), true, '北京周二 10:00 是高峰')
})

// ---------------------------------------------------------------------------
// 2. 未定价 tokens 必须显式报出
// ---------------------------------------------------------------------------
test('kpi:未定价模型的 tokens 计入 unpricedTokens,而不是只体现在成本为 0', () => {
  const store = emptyStore()
  store.requests['a'] = [{ seq: 1, t: bj(2026, 9, 8, 10), m: 'someone-else:mystery-model', miss: 500, read: 100, write: 0, out: 50, r: 0, i: 0 }]
  store.requests['b'] = [{ seq: 1, t: bj(2026, 9, 8, 11), m: 'deepseek-official:deepseek-v4-flash', miss: 1000, read: 0, write: 0, out: 0, r: 0, i: 0 }]
  rebuildAll(store)
  const k = kpiQuery(store, 'all', null, null, makeFilter(null))
  assert.equal(k.totals.unpricedTokens, 650, '未定价的 miss+read+write+out 必须报出来')
  assert.equal(k.totals.unpricedModelCount, 1)
  assert.ok(k.totals.cost > 0, '有价模型仍要正常计价')
  // 逐记录路径(session 筛选会强制慢路径)必须给出同样的结论
  const slow = kpiQuery(store, 'all', null, null, makeFilter({ session: 'a' }))
  assert.equal(slow.totals.unpricedTokens, 650)
  assert.equal(slow.totals.unpricedModelCount, 1)
})

test('kpi:全部模型有价时 unpricedTokens 为 0(不虚报)', () => {
  const store = storeWithOne(bj(2026, 9, 8, 10))
  rebuildAll(store)
  const k = kpiQuery(store, 'all', null, null, makeFilter(null))
  assert.equal(k.totals.unpricedTokens, 0)
  assert.equal(k.totals.unpricedModelCount, 0)
})

// ---------------------------------------------------------------------------
// 3. peakDay 边界
// ---------------------------------------------------------------------------
test('kpi:没有任何用量时 peakDay 为 null(而不是 tokens 为 0 的伪日期)', () => {
  const store = emptyStore()
  rebuildAll(store)
  const k = kpiQuery(store, 'all', null, null, makeFilter(null))
  assert.equal(k.peakDay, null)
  assert.equal(k.streakDays, 0)
})

test('kpi:有用量时 peakDay 指向用量最大的那一天', () => {
  const store = emptyStore()
  store.requests['a'] = [
    { seq: 1, t: bj(2026, 9, 8, 10), m: 'deepseek-official:deepseek-v4-flash', miss: 100, read: 0, write: 0, out: 0, r: 0, i: 0 },
    { seq: 2, t: bj(2026, 9, 9, 10), m: 'deepseek-official:deepseek-v4-flash', miss: 900, read: 0, write: 0, out: 0, r: 0, i: 0 },
  ]
  rebuildAll(store)
  const k = kpiQuery(store, 'all', null, null, makeFilter(null))
  assert.equal(k.peakDay.tokens, 900)
  // peakDay 走的是**日桶**(宿主本地时区口径),所以期望值要用 dayKeyOf 算;
  // 用 beijingDayOf 对不上 —— 那正是"日桶本地 / 小时桶北京"这两条口径的区别。
  assert.equal(k.peakDay.day, dayKeyOf(bj(2026, 9, 9, 10)))
})

// ---------------------------------------------------------------------------
// 4. 配置变更后的惰性重建:对外语义必须与"立刻重建"等价
// ---------------------------------------------------------------------------
test('改单价后立刻读 r.cost 就是新价(惰性重建不得改变可观察行为)', () => {
  const store = storeWithOne(bj(2026, 9, 8, 10), 'deepseek-official:deepseek-flash', { miss: 1e6 })
  rebuildAll(store)
  assert.equal(store.requests.s1[0].cost, 2, '默认高峰价 ¥2/M')
  applyConfigPatch(store, { prices: { 'deepseek-official:deepseek-flash': { miss: 3, hit: 0, write: 0, output: 0 } } })
  assert.equal(store.requests.s1[0].cost, 3, '改价后第一次读就必须是新价')
})

test('改时段规则后立刻读 r.cost 就是新档(高峰→空闲)', () => {
  const store = storeWithOne(bj(2026, 9, 8, 10), 'deepseek-official:deepseek-flash', { miss: 1e6 })
  rebuildAll(store)
  assert.equal(store.requests.s1[0].cost, 2, '默认规则下 10:00 是高峰')
  applyConfigPatch(store, { peakHours: '20-23' })
  assert.equal(store.requests.s1[0].cost, 1, '改规则后同一时刻改判空闲 → 空闲价')
})

test('连续多次配置补丁只在第一次读取时重建一次(聚合入口同样要 flush)', () => {
  const store = storeWithOne(bj(2026, 9, 8, 10), 'deepseek-official:deepseek-flash', { miss: 1e6 })
  rebuildAll(store)
  // 模拟设置页"点选即时生效":连发 24 次补丁
  for (let h = 0; h < 24; h++) applyConfigPatch(store, { peakHours: `${h}-${h + 1}` })
  const k = kpiQuery(store, 'all', null, null, makeFilter(null))
  // 最后一次补丁把高峰定在 23-24,北京 10:00 属空闲 → ¥1/M
  assert.ok(Math.abs(k.totals.cost - 1) < 1e-9, `应按最后一次补丁的时段计价,实际 ${k.totals.cost}`)
  assert.equal(store.requests.s1[0].cost, 1, '逐记录字段也应与新时段一致')
})

// ---------------------------------------------------------------------------
// 5. store 形态体检
// ---------------------------------------------------------------------------
test('isStoreShapeValid:合格库通过', () => {
  const store = emptyStore()
  store.requests['s1'] = [{ seq: 1, t: 1, m: 'p:m', miss: 1, read: 0, write: 0, out: 0 }]
  assert.equal(isStoreShapeValid(store), true)
  assert.equal(isStoreShapeValid({ ...emptyStore(), version: 1, days: undefined, months: undefined, config: undefined }), true,
    '缺少可选字段(老库)不应判为不合格')
})

test('isStoreShapeValid:截断/类型错乱的库一律判不合格(否则会被静默清零)', () => {
  assert.equal(isStoreShapeValid(null), false)
  assert.equal(isStoreShapeValid('{}'), false)
  assert.equal(isStoreShapeValid([]), false)
  assert.equal(isStoreShapeValid({}), false, '缺 requests')
  assert.equal(isStoreShapeValid({ requests: [] }), false, 'requests 是数组')
  assert.equal(isStoreShapeValid({ requests: { s: 'not-a-list' } }), false)
  assert.equal(isStoreShapeValid({ requests: { s: [null] } }), false)
  assert.equal(isStoreShapeValid({ requests: { s: [{ t: 'oops', m: 'p:m', miss: 1, read: 0, write: 0, out: 0 }] } }), false, 't 必须是有限数')
  assert.equal(isStoreShapeValid({ requests: { s: [{ t: 1, m: 'p:m', miss: NaN, read: 0, write: 0, out: 0 }] } }), false, 'NaN 用量必须拦住')
  assert.equal(isStoreShapeValid({ requests: { s: [{ t: 1, m: 'p:m', miss: 1, read: 0, write: 0, out: Infinity }] } }), false, 'Infinity 必须拦住')
  assert.equal(isStoreShapeValid({ requests: {}, days: 'nope' }), false)
  assert.equal(isStoreShapeValid({ requests: {}, watermarks: null }), false, '缺 watermarks 形状')
})

test('STORE_VERSION 已随小时桶口径升级(改口径必须升版本,否则老库沿用旧口径)', () => {
  assert.equal(STORE_VERSION, 6)
})
