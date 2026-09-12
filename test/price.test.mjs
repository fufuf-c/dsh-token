/**
 * dsh-token — 单价与时段规则测试(node:test,零依赖)
 *
 * 官方口径来源:https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 * 该页的数字与"高峰 = 工作日 09-12、14-18(北京时间)"都只是**当前策略**,
 * 所以既要断言内置数据与官方一致(改动会立刻失败),也要断言它们**可被配置覆盖**
 * —— 官方哪天改了时段或价目,不必改代码。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PRICE_FAMILIES, DEFAULT_PEAK_HOURS, DEFAULT_PEAK_DAYS,
  defaultPrice, priceOf, priceAt, isPeakHour, computeCost, priceEntryOf,
  priceDefaults, configView, peakSchedule, emptyStore, rebuildAll, applyConfigPatch,
  parseHourRanges, fmtHourRanges, parseDayRanges, fmtDayRanges,
  normalizeHourRanges, normalizeDayRanges,
} from '../lib/core.mjs'

/** 北京时间的某个瞬间 → epoch ms(北京时间 = UTC+8) */
const bj = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 8, mi)

// 2026-09-11 是周五;09-12 周六;09-13 周日;09-14 周一
const FRI = (h, mi) => bj(2026, 9, 11, h, mi)

const rec = (m, t, over = {}) => ({ m, t, seq: 1, miss: 0, read: 0, write: 0, out: 0, ...over })
function storeWith(recs) {
  const s = emptyStore()
  s.requests = { s1: recs }
  return s
}

// ---------------------------------------------------------------------------
// 内置价目(硬编码期望值,防止静默改错价)
// ---------------------------------------------------------------------------
test('内置价目与官方页一致', () => {
  const flash = PRICE_FAMILIES[0]
  assert.equal(flash.key, 'deepseek-flash')
  assert.deepEqual(flash.peak, { miss: 2, hit: 0.04, write: 0, output: 8 })
  assert.deepEqual(flash.idle, { miss: 1, hit: 0.02, write: 0, output: 4 })

  const pro = PRICE_FAMILIES[1]
  assert.equal(pro.key, 'deepseek-pro')
  assert.deepEqual(pro.peak, { miss: 9, hit: 0.3, write: 0, output: 27 })
  assert.deepEqual(pro.idle, { miss: 4.5, hit: 0.15, write: 0, output: 13.5 })

  // 官方不单独收缓存写入费(同样是"当前策略",故只断言内置数据)
  for (const f of PRICE_FAMILIES) {
    assert.equal(f.peak.write, 0, `${f.key} peak.write`)
    assert.equal(f.idle.write, 0, `${f.key} idle.write`)
  }
})

test('两档价各自独立存放,代码里不做"空闲=高峰÷2"的推导', () => {
  for (const f of PRICE_FAMILIES) {
    assert.equal(typeof f.peak, 'object')
    assert.equal(typeof f.idle, 'object')
    assert.notEqual(f.idle, f.peak, '两档不得共用同一对象引用')
    for (const k of ['miss', 'hit', 'write', 'output']) {
      assert.ok(k in f.peak && k in f.idle, `${f.key}.${k} 两档都要显式给出`)
    }
  }
})

// ---------------------------------------------------------------------------
// 高峰时段判定(默认规则)
// ---------------------------------------------------------------------------
test('高峰时段边界:工作日 09-12、14-18', () => {
  assert.equal(isPeakHour(FRI(8, 59)), false, '08:59 空闲')
  assert.equal(isPeakHour(FRI(9, 0)), true, '09:00 高峰(含)')
  assert.equal(isPeakHour(FRI(11, 59)), true, '11:59 高峰')
  assert.equal(isPeakHour(FRI(12, 0)), false, '12:00 空闲(不含)')
  assert.equal(isPeakHour(FRI(13, 59)), false, '13:59 空闲')
  assert.equal(isPeakHour(FRI(14, 0)), true, '14:00 高峰(含)')
  assert.equal(isPeakHour(FRI(17, 59)), true, '17:59 高峰')
  assert.equal(isPeakHour(FRI(18, 0)), false, '18:00 空闲(不含)')
  assert.equal(isPeakHour(FRI(0, 30)), false, '凌晨空闲')
  assert.equal(isPeakHour(FRI(23, 30)), false, '深夜空闲')
})

test('高峰时段:周末全天空闲', () => {
  assert.equal(isPeakHour(bj(2026, 9, 12, 10)), false, '周六 10:00')
  assert.equal(isPeakHour(bj(2026, 9, 13, 15)), false, '周日 15:00')
  assert.equal(isPeakHour(bj(2026, 9, 14, 10)), true, '周一 10:00 恢复高峰')
})

test('高峰判定按北京时间,不受宿主时区影响', () => {
  assert.equal(isPeakHour(Date.UTC(2026, 8, 11, 1, 0)), true, '北京 09:00 == UTC 01:00')
  assert.equal(isPeakHour(Date.UTC(2026, 8, 11, 0, 59)), false)
})

test('缺时间戳时按空闲价,不虚高', () => {
  for (const v of [undefined, null, NaN, 'not-a-time']) assert.equal(isPeakHour(v), false)
})

// ---------------------------------------------------------------------------
// 时段规则可配置(这两条本来只是官方当前策略)
// ---------------------------------------------------------------------------
test('高峰时段可改成任意区间,默认规则随之失效', () => {
  const sched = { hours: [[20, 23]], days: [1, 2, 3, 4, 5] }
  assert.equal(isPeakHour(FRI(21), sched), true, '改后 21:00 是高峰')
  assert.equal(isPeakHour(FRI(10), sched), false, '原高峰 10:00 不再是高峰')
  assert.equal(priceAt(PRICE_FAMILIES[0], FRI(21), sched).miss, 2)
  assert.equal(priceAt(PRICE_FAMILIES[0], FRI(10), sched).miss, 1)
})

test('高峰日可配,周末也能成为高峰', () => {
  const weekend = { hours: [[9, 12]], days: [0, 6] }
  assert.equal(isPeakHour(bj(2026, 9, 12, 10), weekend), true, '周六 10:00 高峰')
  assert.equal(isPeakHour(bj(2026, 9, 13, 10), weekend), true, '周日 10:00 高峰')
  assert.equal(isPeakHour(FRI(10), weekend), false, '周五 10:00 反而空闲')
})

test('时段规则存进 store.config 后 rebuildAll 按新规则重算', () => {
  const store = storeWith([rec('deepseek-official:deepseek-flash', FRI(10), { miss: 1e6 })])
  rebuildAll(store)
  assert.equal(store.requests.s1[0].cost, 2, '默认规则下 10:00 是高峰 → ¥2')
  applyConfigPatch(store, { peakHours: '20-23' })
  assert.equal(store.requests.s1[0].cost, 1, '改规则后同一时刻改判空闲 → ¥1')
  assert.deepEqual(store.config.peakHours, [[20, 23]])
})

test('parseHourRanges / fmtHourRanges', () => {
  assert.deepEqual(parseHourRanges('9-12, 14-18'), [[9, 12], [14, 18]])
  assert.deepEqual(parseHourRanges('14-18,9-12'), [[9, 12], [14, 18]], '应排序')
  assert.deepEqual(parseHourRanges('22'), [[22, 23]], '单值表示整点一小时')
  assert.equal(parseHourRanges('12-9'), null, '结束不得早于开始')
  assert.equal(parseHourRanges('0-25'), null, '越界')
  assert.equal(parseHourRanges('abc'), null)
  assert.equal(parseHourRanges(''), null)
  assert.equal(fmtHourRanges([[9, 12], [14, 18]]), '9-12, 14-18')
  assert.deepEqual(parseHourRanges(fmtHourRanges([[9, 12], [14, 18]])), [[9, 12], [14, 18]], '往返稳定')
})

test('parseDayRanges / fmtDayRanges', () => {
  assert.deepEqual(parseDayRanges('1-5'), [1, 2, 3, 4, 5])
  assert.deepEqual(parseDayRanges('0-6'), [0, 1, 2, 3, 4, 5, 6])
  assert.deepEqual(parseDayRanges('5-1'), [0, 1, 5, 6], '跨周区间')
  assert.deepEqual(parseDayRanges('0, 6'), [0, 6])
  assert.equal(parseDayRanges('8'), null, '只到 7(=周日)')
  assert.equal(parseDayRanges('x'), null)
  assert.equal(fmtDayRanges([1, 2, 3, 4, 5]), '1-5')
  assert.equal(fmtDayRanges([0, 6]), '0, 6')
  assert.equal(fmtDayRanges([0, 1, 2, 3, 4, 5, 6]), '0-6')
})

test('DEFAULT 时段与官方页一致', () => {
  assert.deepEqual(DEFAULT_PEAK_HOURS, [[9, 12], [14, 18]])
  assert.deepEqual(DEFAULT_PEAK_DAYS, [1, 2, 3, 4, 5])
})

test('peakSchedule:没配置时回退默认,配了就用配置', () => {
  const s = emptyStore()
  assert.deepEqual(peakSchedule(s), { hours: [[9, 12], [14, 18]], days: [1, 2, 3, 4, 5] })
  s.config = {} // 老 store 可能没有这两个字段
  assert.deepEqual(peakSchedule(s), { hours: [[9, 12], [14, 18]], days: [1, 2, 3, 4, 5] })
  s.config = { peakHours: [[1, 2]], peakDays: [0] }
  assert.deepEqual(peakSchedule(s), { hours: [[1, 2]], days: [0] })
})

// ---------------------------------------------------------------------------
// 分档(flash / pro)
// ---------------------------------------------------------------------------
test('deepseek-official 按模型名分档', () => {
  assert.equal(defaultPrice('deepseek-official', 'deepseek-flash').key, 'deepseek-flash')
  assert.equal(defaultPrice('deepseek-official', 'deepseek-v4-pro').key, 'deepseek-pro')
  // 旧名由 V4.1-Flash 承接,按 Flash 价计费
  assert.equal(defaultPrice('deepseek-official', 'deepseek-v4-flash').key, 'deepseek-flash')
  assert.equal(defaultPrice('deepseek-official', 'deepseek-v4-flash-vision-exp').key, 'deepseek-flash')
  assert.equal(defaultPrice('deepseek-official', 'deepseek-v4.1-flash-expires-on-0910').key, 'deepseek-flash')
  assert.equal(defaultPrice('deepseek-official', 'whatever-new').key, 'deepseek-flash', '认不出回退 Flash,不猜 pro')
})

test('中转模型按名字估算,无关模型无默认价', () => {
  assert.equal(defaultPrice('ccai', 'deepseek-v4-pro').key, 'deepseek-pro')
  assert.equal(defaultPrice('jyld', 'deepseek-v4-flash-0731').key, 'deepseek-flash')
  assert.equal(defaultPrice('gjcs', 'DeepSeek-V4-Flash-0731-Event').key, 'deepseek-flash')
  assert.equal(defaultPrice('gmi', 'MiniMaxAI/MiniMax-M3'), null)
  assert.equal(defaultPrice('s', 'kimi-k3'), null)
  assert.equal(defaultPrice('openrouter', 'stealth/ox-alpha'), null)
})

// ---------------------------------------------------------------------------
// 取档与计费
// ---------------------------------------------------------------------------
test('priceAt 按时刻取档', () => {
  const flash = PRICE_FAMILIES[0]
  assert.deepEqual(priceAt(flash, FRI(10)), flash.peak)
  assert.deepEqual(priceAt(flash, FRI(20)), flash.idle)
  assert.deepEqual(priceAt(flash, bj(2026, 9, 12, 10)), flash.idle, '周六按空闲')
})

test('同样用量在高峰/空闲不同价', () => {
  const flash = defaultPrice('deepseek-official', 'deepseek-flash')
  const r = { miss: 1e6, read: 0, write: 0, out: 1e6 }
  assert.equal(computeCost(flash, { ...r, t: FRI(10) }).cost, 10, '高峰 2+8')
  assert.equal(computeCost(flash, { ...r, t: FRI(20) }).cost, 5, '空闲 1+4')
})

test('缓存命中价按官方口径(旧版 0.5 是 deepseek-chat 的价)', () => {
  const flash = defaultPrice('deepseek-official', 'deepseek-flash')
  const c = computeCost(flash, { miss: 0, read: 1e6, write: 0, out: 0, t: FRI(10) })
  assert.equal(c.cost, 0.04)
  assert.equal(c.saved, 1e6 * (2 - 0.04) / 1e6)
})

test('pro 档单价高于 flash', () => {
  const pro = defaultPrice('deepseek-official', 'deepseek-v4-pro')
  assert.equal(computeCost(pro, { miss: 1e6, read: 0, write: 0, out: 1e6, t: FRI(10) }).cost, 9 + 27)
})

// ---------------------------------------------------------------------------
// 自定义单价:兼容旧的扁平写法,也支持新的两档写法
// ---------------------------------------------------------------------------
test('priceEntryOf:扁平(旧)= 两档同价;两档(新)各取各的', () => {
  const flat = priceEntryOf({ miss: 4, hit: 1, write: 0, output: 16 })
  assert.deepEqual(flat.peak, flat.idle)
  assert.deepEqual(flat.peak, { miss: 4, hit: 1, write: 0, output: 16 })

  const tiered = priceEntryOf({ peak: { miss: 4, output: 8 }, idle: { miss: 1, output: 2 } })
  assert.deepEqual(tiered.peak, { miss: 4, hit: 0, write: 0, output: 8 })
  assert.deepEqual(tiered.idle, { miss: 1, hit: 0, write: 0, output: 2 })

  const half = priceEntryOf({ peak: { miss: 4, output: 8 } })
  assert.deepEqual(half.idle, half.peak, '只给 peak → idle 跟随')

  assert.equal(priceEntryOf(null), null)
  assert.equal(priceEntryOf({}), null)
  assert.equal(priceEntryOf({ miss: 'x' }), null)
})

test('旧扁平自定义价仍可用,且不分时段', () => {
  const store = emptyStore()
  store.config.prices['deepseek-official:deepseek-flash'] = { miss: 4, hit: 1, write: 0, output: 16 }
  const p = priceOf(store, 'deepseek-official', 'deepseek-flash')
  assert.equal(p.key, 'custom')
  const r = { miss: 1e6, read: 0, write: 0, out: 0 }
  assert.equal(computeCost(p, { ...r, t: FRI(10) }).cost, 4)
  assert.equal(computeCost(p, { ...r, t: FRI(20) }).cost, 4)
  assert.equal(priceOf(store, 'deepseek-official', 'deepseek-v4-pro').key, 'deepseek-pro', '未覆盖的走官方价')
})

test('自定义价可分时段,比例任意(不再固定 ÷2)', () => {
  const store = emptyStore()
  store.config.prices['deepseek-official:deepseek-flash'] = {
    peak: { miss: 10, hit: 2, write: 0, output: 30 },
    idle: { miss: 3, hit: 0.1, write: 0, output: 7 }, // 故意不用 0.5 倍
  }
  const p = priceOf(store, 'deepseek-official', 'deepseek-flash')
  assert.equal(computeCost(p, { miss: 1e6, read: 0, write: 0, out: 1e6, t: FRI(10) }).cost, 40)
  assert.equal(computeCost(p, { miss: 1e6, read: 0, write: 0, out: 1e6, t: FRI(20) }).cost, 10)
})

// ---------------------------------------------------------------------------
// defaults / configView(页面数据)
// ---------------------------------------------------------------------------
test('priceDefaults 只给有默认价的模型,且带两档', () => {
  const store = storeWith([
    rec('deepseek-official:deepseek-flash', FRI(10)),
    rec('gmi:MiniMaxAI/MiniMax-M3', FRI(10)),
  ])
  const d = priceDefaults(store)
  assert.deepEqual(d['deepseek-official:deepseek-flash'].peak, { miss: 2, hit: 0.04, write: 0, output: 8 })
  assert.deepEqual(d['deepseek-official:deepseek-flash'].idle, { miss: 1, hit: 0.02, write: 0, output: 4 })
  assert.equal(d['gmi:MiniMaxAI/MiniMax-M3'], undefined, '无默认价 → 缺席')
})

test('configView:价格归一化为两档、带时段文本与默认值', () => {
  const store = storeWith([rec('deepseek-official:deepseek-v4-pro', FRI(10))])
  store.config.budget = { monthly: 200 }
  // 旧扁平写法在读取侧应被归一化,UI 不必分支
  store.config.prices['deepseek-official:deepseek-flash'] = { miss: 4, hit: 1, write: 0, output: 16 }
  const v = configView(store)
  assert.equal(v.budget.monthly, 200)
  assert.deepEqual(v.prices['deepseek-official:deepseek-flash'], {
    peak: { miss: 4, hit: 1, write: 0, output: 16 },
    idle: { miss: 4, hit: 1, write: 0, output: 16 },
  })
  assert.equal(v.peakHours, '9-12, 14-18')
  assert.equal(v.peakDays, '1-5')
  assert.deepEqual(v.schedule, { hours: [[9, 12], [14, 18]], days: [1, 2, 3, 4, 5] })
  assert.equal(v.defaultsPeakHours, '9-12, 14-18', '页面"恢复默认"按钮用')
  assert.equal(v.defaultsPeakDays, '1-5')
  assert.ok(v.defaults['deepseek-official:deepseek-v4-pro'])
  assert.ok(!/apiKey|SECRET|sk-/.test(JSON.stringify(v)), 'config 载荷不得携带凭据')
})

// ---------------------------------------------------------------------------
// applyConfigPatch 的时段校验
// ---------------------------------------------------------------------------
test('peakHours/peakDays 非法值报错且不落库', () => {
  const store = emptyStore()
  assert.throws(() => applyConfigPatch(store, { peakHours: '12-9' }), /高峰时段格式/)
  assert.throws(() => applyConfigPatch(store, { peakDays: '9' }), /高峰日格式/)
  assert.deepEqual(store.config.peakHours, DEFAULT_PEAK_HOURS, '报错后不得写入')
  assert.deepEqual(store.config.peakDays, DEFAULT_PEAK_DAYS)
})

test('peakHours/peakDays 传 null 恢复官方默认', () => {
  const store = emptyStore()
  applyConfigPatch(store, { peakHours: '1-2', peakDays: '0' })
  assert.deepEqual(store.config.peakHours, [[1, 2]])
  assert.deepEqual(store.config.peakDays, [0])
  applyConfigPatch(store, { peakHours: null, peakDays: null })
  assert.deepEqual(store.config.peakHours, DEFAULT_PEAK_HOURS)
  assert.deepEqual(store.config.peakDays, DEFAULT_PEAK_DAYS)
})

// ---------------------------------------------------------------------------
// 端到端:rebuildAll 逐请求取档
// ---------------------------------------------------------------------------
test('normalizeHourRanges:页面点选传来的区间数组', () => {
  assert.deepEqual(normalizeHourRanges([[9, 12], [14, 18]]), [[9, 12], [14, 18]])
  assert.deepEqual(normalizeHourRanges([[14, 18], [9, 12]]), [[9, 12], [14, 18]], '应排序')
  assert.deepEqual(normalizeHourRanges([[9, 12], [11, 14]]), [[9, 14]], '相邻/重叠应合并')
  assert.deepEqual(normalizeHourRanges([[0, 1], [1, 2]]), [[0, 2]])
  assert.deepEqual(normalizeHourRanges([[0, 24]]), [[0, 24]], '全天')
  assert.deepEqual(normalizeHourRanges([]), [], '显式空 = 没有高峰时段')
  assert.equal(normalizeHourRanges([9, 12]), null, '元素必须是 [起,止] 二元组')
  assert.equal(normalizeHourRanges([[25, 26]]), null, '越界')
  assert.equal(normalizeHourRanges([[12, 12]]), null, '空区间')
  // 字符串仍走旧路径(供 curl / API 用户)
  assert.deepEqual(normalizeHourRanges('9-12, 14-18'), [[9, 12], [14, 18]])
  assert.equal(normalizeHourRanges(''), null, '空字符串视为格式错误,不当作清空')
  assert.equal(normalizeHourRanges(null), null)
})

test('normalizeDayRanges:页面点选传来的日期数组', () => {
  assert.deepEqual(normalizeDayRanges([3, 1, 2]), [1, 2, 3])
  assert.deepEqual(normalizeDayRanges([0, 1, 2, 3, 4, 5, 6]), [0, 1, 2, 3, 4, 5, 6])
  assert.deepEqual(normalizeDayRanges([]), [], '显式空 = 每天都不算高峰')
  assert.deepEqual(normalizeDayRanges([0, 0, 6]), [0, 6], '去重')
  assert.equal(normalizeDayRanges([7]), null, '只到 6')
  assert.equal(normalizeDayRanges([-1]), null)
  assert.deepEqual(normalizeDayRanges('1-5'), [1, 2, 3, 4, 5], '字符串仍可用')
  assert.equal(normalizeDayRanges(''), null)
})

test('显式空时段 = 全按空闲价(而不是悄悄回退默认)', () => {
  const store = storeWith([rec('deepseek-official:deepseek-flash', FRI(10), { miss: 1e6 })])
  rebuildAll(store)
  assert.equal(store.requests.s1[0].cost, 2, '默认规则下 10:00 是高峰')
  applyConfigPatch(store, { peakHours: [] })
  assert.deepEqual(store.config.peakHours, [])
  assert.deepEqual(peakSchedule(store).hours, [])
  assert.equal(store.requests.s1[0].cost, 1, '清空后按空闲价 → ¥1')
})

test('applyConfigPatch 也接受点选式数组', () => {
  const store = emptyStore()
  applyConfigPatch(store, { peakHours: [[20, 23]], peakDays: [0, 6] })
  assert.deepEqual(store.config.peakHours, [[20, 23]])
  assert.deepEqual(store.config.peakDays, [0, 6])
  assert.equal(configView(store).peakHours, '20-23', '紧凑文本仍对外提供')
  assert.equal(configView(store).peakDays, '0, 6')
})

test('configView 带 defaultsSchedule,供页面"官方默认"预设直接使用', () => {
  const store = emptyStore()
  store.config.peakHours = []
  const v = configView(store)
  assert.deepEqual(v.defaultsSchedule, { hours: [[9, 12], [14, 18]], days: [1, 2, 3, 4, 5] })
  assert.deepEqual(v.schedule, { hours: [], days: [1, 2, 3, 4, 5] }, '生效值照实反映清空')
})

test('rebuildAll 逐请求按时段取档并汇总', () => {
  const store = storeWith([
    rec('deepseek-official:deepseek-flash', FRI(10), { seq: 1, miss: 1e6 }), // 高峰 → ¥2
    rec('deepseek-official:deepseek-flash', FRI(20), { seq: 2, miss: 1e6 }), // 空闲 → ¥1
  ])
  rebuildAll(store)
  const [a, b] = store.requests.s1
  assert.equal(a.cost, 2)
  assert.equal(b.cost, 1)
  assert.equal(store.sessions.s1.totals.cost, 3)
  assert.equal(store.days['2026-09-11'].totals.cost, 3)
  assert.equal(store.months['2026-09'].totals.cost, 3)
})

test('rebuildAll:未定价模型成本为 0 且标记 priced=0', () => {
  const store = storeWith([rec('gmi:MiniMaxAI/MiniMax-M3', FRI(10), { miss: 1e6, out: 1e6 })])
  rebuildAll(store)
  assert.equal(store.requests.s1[0].cost, 0)
  assert.equal(store.requests.s1[0].priced, 0)
})

test('改单价后立刻按新价重算', () => {
  const store = storeWith([rec('deepseek-official:deepseek-flash', FRI(10), { miss: 1e6 })])
  rebuildAll(store)
  assert.equal(store.requests.s1[0].cost, 2)
  applyConfigPatch(store, { prices: { 'deepseek-official:deepseek-flash': { miss: 3, hit: 0, write: 0, output: 0 } } })
  assert.equal(store.requests.s1[0].cost, 3, 'applyConfigPatch 内部已 rebuildAll')
})
