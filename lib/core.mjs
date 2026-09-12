/**
 * dsh-token — 数据层核心(纯函数,零依赖)
 *
 * 输入一个 store 对象,sync 输出聚合/查询结果。不接触文件系统、不依赖 Cordis,
 * 因此可被正式的 Host 插件外壳直接复用。
 *
 * v3 查询设计:rebuildAll 维护 day/month 聚合(含逐模型明细与逐日会话索引),
 * 无 session/wd 筛选的查询直接读聚合,复杂度 O(天数);带 session/wd 筛选或
 * 聚合尚未重建(旧 store)时回退逐记录扫描 eachWithin,复杂度 O(请求数)。
 * 两条路径的输出保持等价。
 *
 * store 形状(与 ~/.dsh/dsh-token/store.json 一致):
 * {
 *   version, updatedAt, sessionsRoot, storeFile, needsFullScan?,
 *   config: { prices: { 'provider:model': {miss,hit,write,output} },
 *             budget: { monthly }, webPagePath, retention: { days } },
 *   watermarks: { id: { rev } },
 *   sessions: { id: { meta, totals, models, firstTs, lastTs } },
 *   days: { 'YYYY-MM-DD': { totals, models: { m: totals & { sessions: {id:1} } }, hours } },
 *   months: { 'YYYY-MM': { totals, models } },
 *   requests: { id: [ { seq,t,m,miss,read,write,out,r,i,cum,cost,saved,priced } ] },
 *   stats: {...}
 * }
 */

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------
/**
 * store 结构版本。**任何改变 foldSession 语义或聚合口径的改动都必须 +1**:
 * 水位线按 revision 跳过未变化会话,语义变了但版本没变,历史数据就会一直沿用旧口径。
 * v3 → v4:TokenUsage 修正为 0.1.5-rc.2 的互斥口径(inputTokens 不含缓存)。
 * v4 → v5:单价改为官方分档 + 高峰/空闲双价,存量成本需按新价重算。
 * v5 → v6:小时桶从"宿主本地时区"改为"北京时间"(与高峰取档同口径),存量
 *          day.hours 需按新口径整体重算,否则小时图与高峰分档仍会错 8 小时。
 *
 * 放在最前面是因为它是**存储契约**:扫描层(lib/session-source.mjs)写水位线、
 * Host 外壳判迁移都要读它,而反向依赖必须为零。
 */
export const STORE_VERSION = 6

export const pad2 = (n) => String(n).padStart(2, '0')
/**
 * 归日键(本地时区)。
 *
 * **时区口径声明**(两条口径并存,各有其理,勿混):
 *   - 日/月桶(`dayKeyOf`/`monthKeyOf`)= **宿主本地时区** —— "今天/本月"就是用户
 *     所在时区的今天,报表页的自然口径;
 *   - 小时桶与高峰/空闲取档 = **北京时间**(`beijingHourOf`/`beijingDayOf`/`isPeakHour`),
 *     因为官方按时段计费,同一份价目必须在任何宿主时区下落在同一个桶里。
 * 两条口径都只按记录时间戳计算,不依赖宿主的时区开关。
 */
export const dayKeyOf = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
export const monthKeyOf = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))
/** 截断到 n 个码点(而非 UTF-16 码元),避免把 emoji 等代理对切成孤立半边 */
export const clipCP = (s, n) => Array.from(String(s)).slice(0, n).join('')

/**
 * 解析 URL 查询串为对象。与 URLSearchParams 口径一致:`+` 还原为空格,
 * 而 %2B 保持为字面 `+`(先替换再解码)。解码失败时保留原值。
 */
export function parseQuery(url) {
  const q = {}
  const s = String(url || '')
  const i = s.indexOf('?')
  if (i < 0) return q
  for (const p of s.slice(i + 1).split('&')) {
    if (!p) continue
    const j = p.indexOf('=')
    const k = j >= 0 ? p.slice(0, j) : p
    const v = j >= 0 ? p.slice(j + 1) : ''
    const dec = (t) => { try { return decodeURIComponent(t.replace(/\+/g, ' ')) } catch (e) { return t } }
    q[dec(k)] = dec(v)
  }
  return q
}

// ---------------------------------------------------------------------------
// 价格(¥/1M tokens;可在 store.config.prices 按 provider:model 精确覆盖)
//
// DeepSeek 官方价随时段浮动,内置价目按官方页落地:
//   https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
// flash 与 pro 价差数倍,因此按模型名分档(旧名 deepseek-v4-flash /
// deepseek-v4-flash-vision-exp 由 V4.1-Flash 承接,同样按 Flash 价计费)。
//
// **时段规则与两档价都是"当前官方策略",不是恒等式,一律当作可配置数据:**
//   - 高峰时段/高峰日存 store.config(peakHours / peakDays),随时可改;
//   - 每个模型的两档价独立存放({peak, idle}),代码里**不做**"空闲=高峰÷2"
//     之类的推导 —— 官方哪天改了比例,只需改数据,不必改逻辑。
// ---------------------------------------------------------------------------
/** 官方当前策略:高峰 = 北京时间 工作日 09:00-12:00、14:00-18:00 */
export const DEFAULT_PEAK_HOURS = [[9, 12], [14, 18]]
export const DEFAULT_PEAK_DAYS = [1, 2, 3, 4, 5] // 0=周日 … 6=周六
const DEFAULT_SCHEDULE = { hours: DEFAULT_PEAK_HOURS, days: DEFAULT_PEAK_DAYS }

export const PRICE_FAMILIES = [
  {
    key: 'deepseek-flash', label: 'DeepSeek 官方价 · deepseek-flash',
    // 两档独立写死,便于官方调整比例时只改这里
    peak: { miss: 2, hit: 0.04, write: 0, output: 8 },
    idle: { miss: 1, hit: 0.02, write: 0, output: 4 },
  },
  {
    key: 'deepseek-pro', label: 'DeepSeek 官方价 · deepseek-v4-pro',
    peak: { miss: 9, hit: 0.3, write: 0, output: 27 },
    idle: { miss: 4.5, hit: 0.15, write: 0, output: 13.5 },
  },
]

// --- 时段规则的解析/格式化(UI 用紧凑文本,如 "9-12, 14-18" 与 "1-5") ---
const splitParts = (s) => String(s == null ? '' : s).trim().split(/[,，;；]/)

/** "9-12, 14-18" → [[9,12],[14,18]];"22" → [[22,23]];非法返回 null */
export function parseHourRanges(s) {
  const out = []
  for (const part of splitParts(s)) {
    const p = part.trim()
    if (!p) continue
    const m = /^(\d{1,2})\s*[-~–—]\s*(\d{1,2})$/.exec(p) || /^(\d{1,2})$/.exec(p)
    if (!m) return null
    const a = Number(m[1])
    const b = m[2] === undefined ? a + 1 : Number(m[2])
    if (!(a >= 0 && a <= 23) || !(b >= 1 && b <= 24) || b <= a) return null
    out.push([a, b])
  }
  if (!out.length) return null
  out.sort((x, y) => x[0] - y[0])
  return out
}
export const fmtHourRanges = (h) => (h || []).map(([a, b]) => `${a}-${b}`).join(', ')

/**
 * 归一化小时区间。接受紧凑文本("9-12, 14-18",供 API/curl)或区间数组(供页面点选)。
 * 空数组是**显式**的"没有高峰时段";空字符串则视为格式错误 —— 避免输入框被清空时误清规则。
 */
export function normalizeHourRanges(v) {
  if (typeof v === 'string') return parseHourRanges(v)
  if (!Array.isArray(v)) return null
  if (!v.length) return []
  const out = []
  for (const r of v) {
    if (!Array.isArray(r) || r.length !== 2) return null
    const a = Number(r[0]), b = Number(r[1])
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null
    if (!(a >= 0 && a <= 23) || !(b >= 1 && b <= 24) || b <= a) return null
    out.push([a, b])
  }
  out.sort((x, y) => x[0] - y[0])
  const merged = []
  for (const [a, b] of out) {
    const last = merged[merged.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b) // 相邻/重叠合并
    else merged.push([a, b])
  }
  return merged
}

/** "1-5" → [1,2,3,4,5];支持跨周 "5-1" → [0,1,5,6];非法返回 null */
export function parseDayRanges(s) {
  const out = new Set()
  for (const part of splitParts(s)) {
    const p = part.trim()
    if (!p) continue
    const m = /^([0-7])\s*[-~–—]\s*([0-7])$/.exec(p) || /^([0-7])$/.exec(p)
    if (!m) return null
    const a = Number(m[1]) % 7
    const b = m[2] === undefined ? a : Number(m[2]) % 7
    for (let i = 0; i < 7; i++) {
      const d = (a + i) % 7
      out.add(d)
      if (d === b) break
    }
  }
  if (!out.size) return null
  return Array.from(out).sort((x, y) => x - y)
}
/** 归一化高峰日。文本("1-5",支持跨周)或日期数组;空数组 = 每天都不算高峰。 */
export function normalizeDayRanges(v) {
  if (typeof v === 'string') return parseDayRanges(v)
  if (!Array.isArray(v)) return null
  if (!v.length) return []
  const set = new Set()
  for (const d of v) {
    const n = Number(d)
    if (!Number.isInteger(n) || n < 0 || n > 6) return null
    set.add(n)
  }
  return Array.from(set).sort((x, y) => x - y)
}
/** [1,2,3,4,5] → "1-5";[0,6] → "0, 6" */
export function fmtDayRanges(days) {
  const d = (days || []).slice().sort((a, b) => a - b)
  const out = []
  for (let i = 0; i < d.length;) {
    let j = i
    while (j + 1 < d.length && d[j + 1] === d[j] + 1) j++
    out.push(i === j ? String(d[i]) : `${d[i]}-${d[j]}`)
    i = j + 1
  }
  return out.join(', ')
}

/** 读取生效的时段规则:store 里没有(老库)时回退官方默认;显式空数组 = 没有高峰 */
export function peakSchedule(store) {
  const c = (store && store.config) || {}
  return {
    hours: Array.isArray(c.peakHours) ? c.peakHours : DEFAULT_PEAK_HOURS,
    days: Array.isArray(c.peakDays) ? c.peakDays : DEFAULT_PEAK_DAYS,
  }
}

/**
 * 该时刻是否处于高峰。官方按北京时间计,故固定按 UTC+8 换算,
 * 不受宿主时区影响(宿主若是 UTC+8,与本地时间一致)。
 */
export function isPeakHour(ms, sched) {
  const n = Number(ms)
  if (!Number.isFinite(n)) return false // 缺时间戳时按空闲价(不虚高)
  const s = sched || DEFAULT_SCHEDULE
  const d = new Date(n + 8 * 3600 * 1000)
  if (!s.days.includes(d.getUTCDay())) return false
  const h = d.getUTCHours()
  for (const [a, b] of s.hours) if (h >= a && h < b) return true
  return false
}
/**
 * 北京时间的小时(0-23)。与 isPeakHour 同口径 —— 时段条必须按同一时区画,
 * 否则宿主时区不是 UTC+8 时,柱子的位置会和高低峰分档对不上。
 */
export const beijingHourOf = (ms) => new Date(Number(ms) + 8 * 3600 * 1000).getUTCHours()
/** 北京时间的日键(`YYYY-MM-DD`)。小时桶与高峰判定必须与它同口径。 */
export const beijingDayOf = (ms) => {
  const d = new Date(Number(ms) + 8 * 3600 * 1000)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}
/** 取某时刻适用的那一档单价 */
export function priceAt(price, ms, sched) { return isPeakHour(ms, sched) ? price.peak : price.idle }

/** 按模型名分档;认不出的名字回退 Flash 档(不猜 pro) */
const familyFor = (model) => (/pro/i.test(String(model)) ? PRICE_FAMILIES[1] : PRICE_FAMILIES[0])

export function defaultPrice(provider, model) {
  const p = String(provider || ''), m = String(model || '')
  if (p === 'deepseek-official') return familyFor(m)
  // 第三方中转:按模型名按官方价估算,仅供参考
  if (/deepseek-v4-(flash|pro)|DeepSeek-V4|deepseek-chat|deepseek-reasoner/.test(m)) return familyFor(m)
  return null
}

const asTier = (o) => ({
  miss: Number(o.miss), hit: Number(o.hit || 0),
  write: Number(o.write || 0), output: Number(o.output || 0),
})
/**
 * 归一化一条自定义价目。接受两种写法:
 *   {peak:{…}, idle:{…}}  —— 分时段(新);
 *   {miss,hit,write,output} —— 不分时段(旧),两档同价。
 * 非法返回 null。
 */
export function priceEntryOf(ov) {
  if (!ov || typeof ov !== 'object') return null
  const peak = ov.peak && Number(ov.peak.miss) >= 0 ? asTier(ov.peak)
    : Number(ov.miss) >= 0 ? asTier(ov) : null
  if (!peak || !isFinite(peak.miss)) return null
  const idle = ov.idle && Number(ov.idle.miss) >= 0 ? asTier(ov.idle) : peak
  return { peak, idle }
}
export function priceOf(store, provider, model) {
  const cfg = (store && store.config && store.config.prices) || null
  if (cfg) {
    const key = `${provider || ''}:${model || ''}`
    const e = priceEntryOf(cfg[key])
    if (e) {
      const flat = e.peak.miss === e.idle.miss && e.peak.output === e.idle.output && e.peak.hit === e.idle.hit
      return { key: 'custom', label: `自定义(${key})`, peak: e.peak, idle: e.idle, note: flat ? '自定义单价,不分时段' : '自定义单价,分时段' }
    }
  }
  return defaultPrice(provider, model)
}
export function computeCost(price, r, sched) {
  const u = priceAt(price, r.t, sched)
  return {
    cost: (r.miss * u.miss + r.read * u.hit + r.write * u.write + r.out * u.output) / 1e6,
    saved: (r.read * (u.miss - u.hit)) / 1e6,
    priced: true,
  }
}
/** 页面单价表用:模型键 → 官方默认价(不含用户覆盖);缺席即"未定价" */
export function priceDefaults(store) {
  const seen = new Set()
  for (const id of Object.keys((store && store.requests) || {})) {
    for (const r of store.requests[id]) seen.add(r.m)
  }
  const out = {}
  for (const mk of seen) {
    const i = mk.indexOf(':')
    const d = defaultPrice(i >= 0 ? mk.slice(0, i) : '', i >= 0 ? mk.slice(i + 1) : mk)
    if (d) out[mk] = { key: d.key, label: d.label, peak: d.peak, idle: d.idle }
  }
  return out
}
/**
 * 逐段费用(¥):一条记录的四段分别按**当时适用的那一档**单价折算。
 * 用来回答"钱花在哪一段"—— 输出段单价是缓存命中的数百倍,只看总费用看不出来。
 * 未定价模型返回 null(调用侧须计成"未定价 tokens",不许悄悄按 0 展示)。
 */
export function costPartsOf(store, r) {
  const key = String(r.m == null ? '' : r.m)
  const idx = key.indexOf(':')
  const price = priceOf(store, idx >= 0 ? key.slice(0, idx) : '', idx >= 0 ? key.slice(idx + 1) : key)
  if (!price) return null
  const u = priceAt(price, r.t, peakSchedule(store))
  return {
    miss: (r.miss * u.miss) / 1e6,
    read: (r.read * u.hit) / 1e6,
    write: (r.write * u.write) / 1e6,
    out: (r.out * u.output) / 1e6,
  }
}

// ---------------------------------------------------------------------------
// 时间/筛选
// ---------------------------------------------------------------------------
export function dayRangeOf(range, from, to, nowMs = Date.now()) {
  const tKey = dayKeyOf(nowMs)
  const mKey = monthKeyOf(nowMs)
  const addDays = (key, n) => { const d = new Date(`${key}T00:00:00`); d.setDate(d.getDate() + n); return dayKeyOf(d.getTime()) }
  let f = null, t = null
  if (range === 'today') { f = tKey; t = tKey }
  else if (range === '3d') { f = addDays(tKey, -2); t = tKey }
  else if (range === '7d') { f = addDays(tKey, -6); t = tKey }
  else if (range === '30d') { f = addDays(tKey, -29); t = tKey }
  else if (range === 'month') {
    f = `${mKey}-01`
    const d0 = new Date(`${tKey}T00:00:00`)
    const next = new Date(d0.getFullYear(), d0.getMonth() + 1, 1)
    next.setDate(next.getDate() - 1)
    t = dayKeyOf(next.getTime())
  } else if (range === 'custom') { f = from || null; t = to || null }
  return { from: f, to: t, label: String(range || 'all'), todayKey: tKey, monthKey: mKey }
}
export function makeFilter(args) {
  const models = args && args.models ? String(args.models).split(',').filter(Boolean) : null
  return {
    modelSet: models ? new Set(models) : null,
    sessionId: args && args.session ? String(args.session) : '',
    wd: args && args.wd ? String(args.wd) : '',
    q: args && args.q ? String(args.q).trim().toLowerCase() : '',
  }
}
function matchFilter(store, rec, id, flt) {
  if (flt.modelSet && !flt.modelSet.has(rec.m)) return false
  if (flt.sessionId && id.indexOf(flt.sessionId) !== 0) return false
  if (flt.wd) {
    const m = store.sessions[id] && store.sessions[id].meta
    const cwd = (m && m.cwd) || ''
    if (cwd.indexOf(flt.wd) !== 0) return false
  }
  return true
}
export function eachWithin(store, fromDay, toDay, flt) {
  const r = { from: fromDay || null, to: toDay || null }
  const out = []
  for (const id of Object.keys(store.requests)) {
    const list = store.requests[id]
    for (let i = 0; i < list.length; i++) {
      const rec = list[i]
      const dk = dayKeyOf(rec.t)
      if (r.from && dk < r.from) continue
      if (r.to && dk > r.to) continue
      if (!matchFilter(store, rec, id, flt)) continue
      out.push({ r: rec, id })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 聚合原语
// ---------------------------------------------------------------------------
export function newTotals() { return { miss: 0, read: 0, write: 0, out: 0, requests: 0, cost: 0, saved: 0, priced: 0 } }
export function aggregate(total, r) {
  total.miss += r.miss; total.read += r.read; total.write += r.write; total.out += r.out
  total.requests += 1; total.cost += r.cost || 0; total.saved += r.saved || 0
  total.priced += r.priced ? 1 : 0
  return total
}
/** totals 形状相加(dst ← src),用于聚合快路径合并 day/month 桶 */
export function addTotals(dst, src) {
  dst.miss += src.miss; dst.read += src.read; dst.write += src.write; dst.out += src.out
  dst.requests += src.requests; dst.cost += src.cost; dst.saved += src.saved
  dst.priced += src.priced || 0
  return dst
}

// ---------------------------------------------------------------------------
// 聚合就绪标记:days 是否为 v3 形状(逐模型带逐会话索引)。
// 旧 v2 store 或尚未 rebuild 的 store 返回 false,查询自动回退逐记录路径。
//
// 同时充当**脏标记**:配置变更(单价/时段)后聚合与逐记录成本都不再可信,但重建是
// O(请求数),而设置页是"点选即时生效"(连点 24 个小时格 = 24 次请求)—— 每次都全量
// 重建是纯浪费。所以 applyConfigPatch 只 markStale(),重建推迟到**下一次读取**执行一次:
//   - 聚合读取入口(kpi/series/hours/heatmap/sessions/export)在函数开头 flush;
//   - 逐记录字段(r.cost/r.saved/r.priced)是访问器,脏的时候读一下就触发同一轮 flush,
//     因此"改完单价立刻读 cost"仍拿到新价(旧行为不变,且不依赖调用方自觉)。
// 语义与"每次都重建"完全等价,成本从 N 次降到 1 次。
// ---------------------------------------------------------------------------
const AGG_READY = new WeakMap()
const AGG_STALE = new WeakSet()
const AGG_FLUSHING = new WeakSet()
/** 配置级语义变更:聚合作废,并把现存记录的成本字段补上惰性访问器。 */
export function markStale(store) {
  if (!store) return
  AGG_STALE.add(store)
  // 只有冷启动从 store.json 读回来的记录还是普通属性(进程内新折叠的记录已由
  // scanStore 装饰过),这里补一次即可;装饰是幂等的,重复调用只花一次属性查找。
  const reqs = store.requests
  if (!reqs) return
  for (const id of Object.keys(reqs)) {
    const list = reqs[id]
    for (let i = 0; i < list.length; i++) defineLazyCost(list[i], store)
  }
}
/** 重建(若确实脏)并重新标记就绪。查询入口与落盘前都应调用。 */
export function flushAggregates(store) {
  if (store && AGG_STALE.has(store)) rebuildAll(store)
  return store
}
/**
 * 把一条折叠记录的成本字段做成惰性访问器。
 *
 * 为什么需要:配置变更(单价/时段)后逐记录成本必须按新口径重算,但设置页是"点选
 * 即时生效",一次交互会连发多个补丁 —— 若每个补丁都在 Host 里跑一次全量重建就是
 * O(补丁数 × 请求数)。改成脏标记 + 访问器后:补丁只标脏,真正的重建发生在**第一次
 * 读取**(聚合入口 flush,或读 r.cost 时触发),成本降到 O(请求数) 一次。
 * 这样"改完单价立刻读 cost 拿到新价"的旧语义不变,也不需要调用方自觉。
 */
const LAZY = Symbol('dsh-token.lazyCost')
export function defineLazyCost(r, store) {
  if (!r || r[LAZY]) return r
  const value = { cost: 0, saved: 0, priced: 0 }
  Object.defineProperty(r, LAZY, { value, enumerable: false, configurable: true })
  const define = (key) => Object.defineProperty(r, key, {
    enumerable: true,
    configurable: true,
    get() {
      if (AGG_STALE.has(store)) flushAggregates(store)
      return value[key]
    },
    set(v) { value[key] = v },
  })
  define('cost'); define('saved'); define('priced')
  return r
}
export function aggregatesReady(store) {
  if (AGG_STALE.has(store)) return false
  if (AGG_READY.has(store)) return AGG_READY.get(store)
  let ok
  const days = store.days || {}
  const ks = Object.keys(days)
  if (!ks.length) ok = Object.keys(store.requests || {}).length === 0
  else {
    ok = true
    for (const k of ks) {
      const ms = days[k].models || {}
      for (const mk of Object.keys(ms)) { if (!ms[mk].sessions) { ok = false; break } }
      if (!ok) break
    }
  }
  AGG_READY.set(store, ok)
  return ok
}

// ---------------------------------------------------------------------------
// 事件折叠 → 请求记录(四段 Token + 模型归属)
// ---------------------------------------------------------------------------
export function foldSession(events) {
  const recs = []
  const foldedSteps = new Set()
  let epoch = null
  for (const ev of events || []) {
    if (!ev || !ev.type) continue
    if (ev.type === 'request/header') {
      const cfg = ev.data && ev.data.header && ev.data.header.config
      if (cfg) epoch = { provider: cfg.provider || null, model: cfg.model || null }
      else if (ev.data) epoch = { provider: ev.data.provider || null, model: ev.data.model || null }
    } else if (ev.type === 'request/context') {
      if (!epoch && ev.data) epoch = { provider: ev.data.provider || null, model: ev.data.model || null }
    } else if (ev.type === 'assistant/message') {
      const data = ev.data || {}
      const usage = data.usage
      if (!usage) continue
      // 去重键:provider 正常带 turn/step 时按 (turn,step) 折叠重试副本;
      // 缺失时回退事件序号,避免把整段消息误并成一条导致用量少算。
      const key = data.turn !== undefined && data.step !== undefined ? `${data.turn}:${data.step}` : `#${ev.seq}`
      if (foldedSteps.has(key)) continue
      foldedSteps.add(key)
      const input = Number(usage.inputTokens || 0)
      const read = Number(usage.cacheReadTokens || 0)
      const write = Number(usage.cacheWriteTokens || 0)
      const out = Number(usage.outputTokens || 0)
      // 0.1.5-rc.2 起 TokenUsage 在契约层面是**互斥**口径:inputTokens 只计
      // 未命中输入,缓存读写单列,totalTokens = input + read + write + out
      // (本机实测 7173 条带 totalTokens 的记录 100% 吻合)。所以 miss 直接取 input。
      // 仅当 totalTokens 明确呈现**折叠**口径(total = input + out 且带缓存)时
      // 才回退相减,兼容极老日志。
      // 旧代码用「相减为负才取 input」的启发式:在 read>0 且 input>read 时会
      // 少算 miss(本机实测 85 条),是真实统计偏差,不是展示问题。
      const folded = usage.totalTokens !== undefined && (read > 0 || write > 0)
        && Number(usage.totalTokens) === input + out
      const miss = folded ? input - read - write : input
      recs.push({
        seq: ev.seq,
        t: ev.time,
        m: `${epoch && epoch.provider || ''}:${epoch && epoch.model || ''}`,
        miss,
        read, write, out,
        r: Number(usage.reasoningTokens || 0),
        i: data.interrupted ? 1 : 0,
      })
    }
  }
  return recs
}

// ---------------------------------------------------------------------------
// 会话元信息提取(标题 = 自动生成标题,缺省回退首条真人消息)
// ---------------------------------------------------------------------------
export function extractSessionInfo(events) {
  let title = null, titleFromLlm = false
  let firstUser = null
  for (const ev of events || []) {
    if (!ev || !ev.type) continue
    if (ev.type === 'session/title') {
      const t = ev.data && ev.data.title
      if (t && (!titleFromLlm || (ev.data.source && ev.data.source.kind === 'provider'))) {
        title = clipCP(t, 80)
        titleFromLlm = !!(ev.data.source && ev.data.source.kind === 'provider')
      }
    } else if (ev.type === 'user/message' && firstUser === null) {
      const d = ev.data || {}
      if (d.source && d.source.kind === 'user' && Array.isArray(d.content)) {
        for (const c of d.content) {
          if (c && c.type === 'text' && c.text) {
            const txt = String(c.text).replace(/\s+/g, ' ').trim()
            if (txt && !txt.startsWith('<')) { firstUser = clipCP(txt, 80); break }
          }
        }
      }
    }
  }
  return { title: title || firstUser || null, titleKind: title ? 'llm' : firstUser ? 'prompt' : null, firstUser }
}

// ---------------------------------------------------------------------------
// 派生重建(requests 主数据 → sessions/days/months + 成本/节省/cum)
// day.models[m] 额外维护 sessions 索引(会话 id → 1),供 KPI 的活跃会话数
// 与聚合快路径使用;months.models 仅聚合值。
// ---------------------------------------------------------------------------
export function rebuildAll(store) {
  // 重入保护:成本字段是惰性访问器(见 defineLazyCost),重建过程中读写它们会回环。
  // 置位后访问器直读本地值,不再触发 flush。
  if (AGG_FLUSHING.has(store)) return
  AGG_FLUSHING.add(store)
  AGG_STALE.delete(store)
  const days = {}, months = {}
  const priceCache = {} // 模型键 → 价格对象,避免逐条记录跑正则推断
  const sched = peakSchedule(store) // 取档规则整轮固定
  for (const id of Object.keys(store.requests)) {
    const list = store.requests[id]
    list.sort((a, b) => a.seq - b.seq)
    const ses = store.sessions[id] || (store.sessions[id] = { meta: null, totals: newTotals(), models: {}, firstTs: null, lastTs: null })
    ses.totals = newTotals(); ses.models = {}; ses.firstTs = null; ses.lastTs = null
    let cum = 0
    for (const r of list) {
      cum += r.miss + r.read + r.write
      r.cum = cum
      let price = priceCache[r.m]
      if (price === undefined) {
        const idx = r.m.indexOf(':')
        price = priceOf(store, idx >= 0 ? r.m.slice(0, idx) : '', idx >= 0 ? r.m.slice(idx + 1) : r.m)
        priceCache[r.m] = price
      }
      if (price) {
        const u = priceAt(price, r.t, sched) // 逐请求按时段取档(高峰/空闲)
        r.cost = (r.miss * u.miss + r.read * u.hit + r.write * u.write + r.out * u.output) / 1e6
        r.saved = (r.read * (u.miss - u.hit)) / 1e6
        r.priced = 1
      } else { r.cost = 0; r.saved = 0; r.priced = 0 }
      const dayK = dayKeyOf(r.t)
      const monthK = dayK.slice(0, 7)
      // 小时桶与高峰取档同口径:**北京时间**(见 dayKeyOf 的时区口径声明)。
      // 曾用本地 getHours(),在非 UTC+8 宿主上与高峰高亮错开 8 小时。
      const hourK = String(beijingHourOf(r.t))
      aggregate(ses.totals, r)
      if (!ses.firstTs) ses.firstTs = r.t
      ses.lastTs = r.t
      let sm = ses.models[r.m] || (ses.models[r.m] = newTotals()); aggregate(sm, r)
      let day = days[dayK]
      if (!day) { day = { totals: newTotals(), models: {}, hours: {} }; days[dayK] = day }
      aggregate(day.totals, r)
      let dm = day.models[r.m] || (day.models[r.m] = newTotals())
      if (!dm.sessions) dm.sessions = {}
      dm.sessions[id] = 1
      aggregate(dm, r)
      let hh = day.hours[hourK] || (day.hours[hourK] = newTotals()); aggregate(hh, r)
      let mon = months[monthK]
      if (!mon) { mon = { totals: newTotals(), models: {} }; months[monthK] = mon }
      aggregate(mon.totals, r)
      let mm = mon.models[r.m] || (mon.models[r.m] = newTotals()); aggregate(mm, r)
    }
  }
  store.days = days; store.months = months
  AGG_READY.set(store, true)
  AGG_FLUSHING.delete(store)
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------
function dayTotalsOf(store, dk, flt) {
  const out = newTotals()
  const day = store.days[dk]
  if (!day) return out
  if (flt.modelSet) { for (const mk of flt.modelSet) { const dm = day.models[mk]; if (dm) addTotals(out, dm) } }
  else addTotals(out, day.totals)
  return out
}
function monthTotalsOf(store, mk, flt) {
  const out = newTotals()
  const mon = store.months[mk]
  if (!mon) return out
  if (flt.modelSet) { for (const k of flt.modelSet) { const mm = mon.models[k]; if (mm) addTotals(out, mm) } }
  else addTotals(out, mon.totals)
  return out
}
function collectDaySessions(day, picks, out) {
  const push = (dm) => { const s = dm.sessions; if (s) for (const id of Object.keys(s)) out.add(id) }
  if (picks) { for (const mk of picks) { const dm = day.models[mk]; if (dm) push(dm) } }
  else { for (const mk of Object.keys(day.models)) push(day.models[mk]) }
}

export function kpiQuery(store, range, from, to, flt, nowMs = Date.now()) {
  flushAggregates(store) // 配置变更后第一次读取时才重建(见 markStale)
  const r = dayRangeOf(range || 'all', from, to, nowMs)
  const useAgg = !flt.sessionId && !flt.wd && aggregatesReady(store)
  let totals, models, dayTok, active, unpricedTokens = 0, unpricedModels = new Set()
  if (useAgg) {
    // 快路径:直接累加 day 聚合(逐模型桶天然支持模型筛选)
    const picks = flt.modelSet ? Array.from(flt.modelSet) : null
    totals = newTotals(); models = {}; dayTok = {}; active = new Set()
    // 未定价量必须能与总额一起报出来:桶上保留了 priced 个数
    const takeUnpriced = (mk, dm) => {
      const up = dm.requests - (dm.priced || 0)
      if (up > 0) { unpricedTokens += dm.miss + dm.read + dm.write + dm.out; unpricedModels.add(mk) }
    }
    for (const dk of Object.keys(store.days)) {
      if (r.from && dk < r.from) continue
      if (r.to && dk > r.to) continue
      const day = store.days[dk]
      if (picks) {
        for (const mk of picks) {
          const dm = day.models[mk]
          if (!dm) continue
          addTotals(totals, dm)
          let mm = models[mk]; if (!mm) mm = models[mk] = newTotals()
          addTotals(mm, dm)
          dayTok[dk] = (dayTok[dk] || 0) + dm.miss + dm.read + dm.write + dm.out
          takeUnpriced(mk, dm)
        }
      } else {
        addTotals(totals, day.totals)
        dayTok[dk] = day.totals.miss + day.totals.read + day.totals.write + day.totals.out
        for (const mk of Object.keys(day.models)) {
          let mm = models[mk]; if (!mm) mm = models[mk] = newTotals()
          addTotals(mm, day.models[mk])
          takeUnpriced(mk, day.models[mk])
        }
      }
      collectDaySessions(day, picks, active)
    }
  } else {
    // 慢路径:逐记录扫描(session/wd 筛选需要请求级定位)
    const items = eachWithin(store, r.from, r.to, flt)
    totals = newTotals(); models = {}; dayTok = {}; active = new Set()
    for (const it of items) {
      aggregate(totals, it.r)
      let m = models[it.r.m] || (models[it.r.m] = newTotals()); aggregate(m, it.r)
      active.add(it.id)
      if (!it.r.priced) { unpricedTokens += it.r.miss + it.r.read + it.r.write + it.r.out; unpricedModels.add(it.r.m) }
      const dk = dayKeyOf(it.r.t)
      dayTok[dk] = (dayTok[dk] || 0) + it.r.miss + it.r.read + it.r.write + it.r.out
    }
  }
  // 峰值日:没有任何用量时必须是 null,而不是"tokens 为 0 的伪日期"
  let peakDay = null, peakTokens = 0
  for (const dk of Object.keys(dayTok)) if (peakDay === null || dayTok[dk] > peakTokens) { peakTokens = dayTok[dk]; peakDay = dk }
  const totalIn = totals.miss + totals.read + totals.write
  const hitRate = totalIn > 0 ? totals.read / totalIn : 0
  let prev = null
  if (r.label === 'today' && r.todayKey) {
    const d = new Date(`${r.todayKey}T00:00:00`); d.setDate(d.getDate() - 1)
    const pk = dayKeyOf(d.getTime())
    prev = { label: 'yesterday', totals: useAgg ? dayTotalsOf(store, pk, flt) : rangeTotals(store, pk, pk, flt) }
  } else if (r.label === 'month' && r.monthKey) {
    const parts = r.monthKey.split('-')
    const d = new Date(Number(parts[0]), Number(parts[1]) - 2, 1)
    const pmk = monthKeyOf(d.getTime())
    prev = { label: 'prevMonth', totals: useAgg ? monthTotalsOf(store, pmk, flt) : rangeTotals(store, `${pmk}-01`, `${pmk}-31`, flt) }
  }
  const delta = prev ? {
    tokens: totals.miss + totals.read + totals.write + totals.out - (prev.totals.miss + prev.totals.read + prev.totals.write + prev.totals.out),
    cost: totals.cost - prev.totals.cost,
  } : null
  // 连续使用天数。上限按 200 年给足(原先 3700 天会在 10 年处静默截断)。
  let streak = 0
  for (let i = 0; i < 73000; i++) {
    const d = new Date(nowMs); d.setDate(d.getDate() - i)
    if ((dayTok[dayKeyOf(d.getTime())] || 0) > 0) streak++
    else break
  }
  const modelsArr = Object.keys(models).map((mk) => {
    const idx = mk.indexOf(':')
    return { key: mk, provider: idx >= 0 ? mk.slice(0, idx) : '', model: idx >= 0 ? mk.slice(idx + 1) : mk, totals: models[mk] }
  }).sort((a, b) => (b.totals.miss + b.totals.read + b.totals.write + b.totals.out) - (a.totals.miss + a.totals.read + a.totals.write + a.totals.out))
  return {
    range: { label: r.label, fromDay: r.from, toDay: r.to },
    totals: {
      miss: totals.miss, read: totals.read, write: totals.write, out: totals.out,
      total: totals.miss + totals.read + totals.write + totals.out,
      requests: totals.requests, cost: totals.cost, saved: totals.saved,
      // 未定价(无内置价且无自定义价)的 tokens 与模型数:cost 里这部分记 0,
      // 必须显式报出来,否则"估算成本"会被当成完整成本读。
      unpricedTokens, unpricedModelCount: unpricedModels.size,
    },
    hitRate, activeSessions: active.size,
    peakDay: peakDay === null ? null : { day: peakDay, tokens: peakTokens },
    delta, streakDays: streak, models: modelsArr,
  }
}
/** 环比上一日/上一月的慢路径兜底(仅逐记录路径使用) */
function rangeTotals(store, from, to, flt) {
  const pt = newTotals()
  for (const it of eachWithin(store, from, to, flt)) aggregate(pt, it.r)
  return pt
}

function bucketKeyOf(dk, granularity) {
  if (granularity === 'month') return dk.slice(0, 7)
  if (granularity === 'week') {
    const d = new Date(`${dk}T00:00:00`)
    const dow = (d.getDay() + 6) % 7
    d.setDate(d.getDate() - dow)
    return dayKeyOf(d.getTime())
  }
  return dk
}

export function seriesQuery(store, granularity, range, from, to, flt, nowMs = Date.now()) {
  flushAggregates(store)
  const r = dayRangeOf(range || 'all', from, to, nowMs)
  const useAgg = !flt.sessionId && !flt.wd && aggregatesReady(store)
  const buckets = {}, order = []
  if (useAgg) {
    const picks = flt.modelSet ? Array.from(flt.modelSet) : null
    for (const dk of Object.keys(store.days)) {
      if (r.from && dk < r.from) continue
      if (r.to && dk > r.to) continue
      const day = store.days[dk]
      if (picks) {
        // 只有当天确实存在被选模型时才建桶,避免趋势图出现空日期
        for (const mk of picks) {
          const dm = day.models[mk]
          if (!dm) continue
          const bk = bucketKeyOf(dk, granularity)
          let b = buckets[bk]
          if (!b) { b = { totals: newTotals(), models: {} }; buckets[bk] = b; order.push(bk) }
          addTotals(b.totals, dm)
          let m = b.models[mk]; if (!m) m = b.models[mk] = newTotals()
          addTotals(m, dm)
        }
      } else {
        const bk = bucketKeyOf(dk, granularity)
        let b = buckets[bk]
        if (!b) { b = { totals: newTotals(), models: {} }; buckets[bk] = b; order.push(bk) }
        addTotals(b.totals, day.totals)
        for (const mk of Object.keys(day.models)) {
          let m = b.models[mk]; if (!m) m = b.models[mk] = newTotals()
          addTotals(m, day.models[mk])
        }
      }
    }
  } else {
    const items = eachWithin(store, r.from, r.to, flt)
    for (const it of items) {
      const rec = it.r
      const bk = bucketKeyOf(dayKeyOf(rec.t), granularity)
      let b = buckets[bk]
      if (!b) { b = { totals: newTotals(), models: {} }; buckets[bk] = b; order.push(bk) }
      aggregate(b.totals, rec)
      let m = b.models[rec.m] || (b.models[rec.m] = newTotals()); aggregate(m, rec)
    }
  }
  order.sort()
  return order.map((k) => ({ key: k, granularity, totals: buckets[k].totals, models: buckets[k].models }))
}

export function hoursQuery(store, range, from, to, flt, nowMs = Date.now()) {
  flushAggregates(store)
  const r = dayRangeOf(range || 'all', from, to, nowMs)
  const buckets = []
  for (let i = 0; i < 24; i++) buckets.push({ hour: i, totals: newTotals() })
  const useAgg = !flt.sessionId && !flt.wd && !flt.modelSet && aggregatesReady(store)
  if (useAgg) {
    // 小时桶未按模型细分,模型筛选时走逐记录路径
    for (const dk of Object.keys(store.days)) {
      if (r.from && dk < r.from) continue
      if (r.to && dk > r.to) continue
      const hours = store.days[dk].hours || {}
      for (const hk of Object.keys(hours)) {
        const b = buckets[Number(hk)]
        if (b) addTotals(b.totals, hours[hk])
      }
    }
    return buckets
  }
  const items = eachWithin(store, r.from, r.to, flt)
  for (const it of items) {
    // 与聚合路径同口径:北京时间(曾用本地 getHours(),非 UTC+8 宿主会错 8 小时)
    const b = buckets[beijingHourOf(it.r.t)]
    if (b) aggregate(b.totals, it.r)
  }
  return buckets
}

export function heatmapQuery(store, months, flt, nowMs = Date.now()) {
  flushAggregates(store)
  const n = clamp(Number(months) || 12, 1, 24)
  const today = new Date(nowMs)
  const start = new Date(today.getFullYear(), today.getMonth() - (n - 1), 1)
  const from = dayKeyOf(start.getTime())
  const outMap = {}
  const useAgg = !flt.sessionId && !flt.wd && aggregatesReady(store)
  if (useAgg) {
    const picks = flt.modelSet ? Array.from(flt.modelSet) : null
    for (const dk of Object.keys(store.days)) {
      if (dk < from) continue
      const day = store.days[dk]
      let total = 0, requests = 0, hit = false
      if (picks) {
        for (const mk of picks) {
          const dm = day.models[mk]
          if (!dm) continue
          hit = true
          total += dm.miss + dm.read + dm.write + dm.out
          requests += dm.requests
        }
        if (!hit) continue // 当天无被选模型时不产生 0 值点
      } else {
        total = day.totals.miss + day.totals.read + day.totals.write + day.totals.out
        requests = day.totals.requests
      }
      const e = outMap[dk] || (outMap[dk] = { day: dk, total: 0, requests: 0 })
      e.total += total; e.requests += requests
    }
    return Object.keys(outMap).sort().map((k) => outMap[k])
  }
  const items = eachWithin(store, null, null, flt)
  for (const it of items) {
    const dk = dayKeyOf(it.r.t)
    if (dk < from) continue
    const e = outMap[dk] || (outMap[dk] = { day: dk, total: 0, requests: 0 })
    e.total += it.r.miss + it.r.read + it.r.write + it.r.out
    e.requests += 1
  }
  return Object.keys(outMap).sort().map((k) => outMap[k])
}

export function sessionsQuery(store, sort, limit, range, from, to, flt, nowMs = Date.now()) {
  flushAggregates(store) // 会话列表的 firstTs 来自聚合重建,读前先确保聚合已就绪
  const r = dayRangeOf(range || 'all', from, to, nowMs)
  const items = eachWithin(store, r.from, r.to, flt)
  const bySession = {}
  for (const it of items) {
    const e = bySession[it.id] || (bySession[it.id] = { id: it.id, totals: newTotals(), lastTs: 0 })
    aggregate(e.totals, it.r)
    if (it.r.t > e.lastTs) e.lastTs = it.r.t
  }
  const out = []
  for (const id of Object.keys(bySession)) {
    const e = bySession[id]
    const ses = store.sessions[id] || {}
    // 服务端子串搜索(q):标题 / 工作目录 / 工作区 / 会话 ID,覆盖全量会话,
    // 不受 limit 截断影响(前端 100 条快照搜不全)
    if (flt.q) {
      const m = ses.meta || {}
      const hay = `${m.title || ''} ${m.cwd || ''} ${m.workspace || ''} ${id}`.toLowerCase()
      if (hay.indexOf(flt.q) < 0) continue
    }
    out.push({ id, meta: ses.meta || {}, totals: e.totals, requestsInRange: e.totals.requests, firstTs: ses.firstTs, lastTs: e.lastTs })
  }
  const total = (x) => x.totals.miss + x.totals.read + x.totals.write + x.totals.out
  if (sort === 'cost') out.sort((a, b) => b.totals.cost - a.totals.cost)
  else if (sort === 'tokens') out.sort((a, b) => total(b) - total(a))
  else if (sort === 'recent') out.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0))
  else out.sort((a, b) => b.totals.requests - a.totals.requests)
  return out.slice(0, clamp(limit || 50, 1, 500))
}

/**
 * 单会话下钻。
 * opts.brief = true 时省掉逐请求数组与异常标记 —— 会话内嵌面板只要汇总,
 * 数千请求的会话可省下成 MB 的载荷(也省掉 flags 数组的分配)。
 * 两种模式都返回面板用的节奏字段:hours/hoursPeak(逐小时 token 与其中按高峰价
 * 计费的部分)、tiers(高峰/空闲各自的 token、费用、请求数)、costParts(四段
 * 各自花掉的钱)、unpriced(未定价模型的 token 数)、activeDays。
 */
export function sessionDetailQuery(store, id, opts) {
  const brief = !!(opts && opts.brief)
  const ses = store.sessions[id]
  if (!ses) return null
  const list = store.requests[id] || []
  const sched = peakSchedule(store)
  const models = {}
  let anomalies = 0
  const flags = []
  const deltas = []
  // 会话内面板的"节奏"数据:逐小时 token 分布、高峰/空闲分档、逐段费用、活跃天数。
  // 都是 O(请求数) 的小数组,无论 brief 与否都返回 —— 面板据此画时段条,不必再取
  // 数千条逐请求记录。
  const hours = new Array(24).fill(0)
  const hoursPeak = new Array(24).fill(0)
  const peak = { tokens: 0, cost: 0, requests: 0 }
  const idle = { tokens: 0, cost: 0, requests: 0 }
  const costParts = { miss: 0, read: 0, write: 0, out: 0 }
  const days = new Set()
  let unpriced = 0
  for (let i = 0; i < list.length; i++) {
    const r = list[i]
    const m = models[r.m] || (models[r.m] = newTotals()); aggregate(m, r)
    const prev = i > 0 ? list[i - 1].cum : 0
    deltas.push(r.cum - prev)
    const tk = (r.miss || 0) + (r.read || 0) + (r.write || 0) + (r.out || 0)
    days.add(dayKeyOf(r.t))
    const hr = beijingHourOf(r.t)
    hours[hr] += tk
    const onPeak = isPeakHour(r.t, sched)
    const side = onPeak ? peak : idle
    side.tokens += tk; side.cost += r.cost || 0; side.requests += 1
    if (onPeak) hoursPeak[hr] += tk
    const parts = costPartsOf(store, r)
    if (parts) {
      costParts.miss += parts.miss; costParts.read += parts.read
      costParts.write += parts.write; costParts.out += parts.out
    } else unpriced += tk
  }
  const sorted = deltas.slice(1).sort((a, b) => a - b)
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
  const thresh = Math.max(150000, 2.5 * median)
  for (let i = 0; i < list.length; i++) {
    let f = 0
    if (i > 0 && deltas[i] > thresh) { f = 1; anomalies++ }
    else if (list[i].i) f = 2
    if (!brief) flags.push(f)
  }
  const modelsArr = Object.keys(models).map((mk) => {
    const idx = mk.indexOf(':')
    return { key: mk, provider: idx >= 0 ? mk.slice(0, idx) : '', model: idx >= 0 ? mk.slice(idx + 1) : mk, totals: models[mk] }
  }).sort((a, b) => (b.totals.miss + b.totals.read + b.totals.write + b.totals.out) - (a.totals.miss + a.totals.read + a.totals.write + a.totals.out))
  return {
    id, meta: ses.meta || { id }, totals: ses.totals, models: modelsArr,
    requestCount: list.length, anomalies, flagged: anomalies >= 2,
    firstTs: ses.firstTs, lastTs: ses.lastTs,
    hours, hoursPeak, tiers: { peak, idle }, costParts, unpriced,
    activeDays: days.size, schedule: { hours: sched.hours, days: sched.days },
    ...(brief ? {} : { requests: list, flags }),
  }
}

// ---------------------------------------------------------------------------
// 「当前配置的模型」解析(供配置面使用)
//
// 为什么需要它:插件的模型清单来自历史请求记录(用量史),只增不减 —— 用户在 DSH
// 里删掉模型配置后历史账单仍在,列表不会缩;而"最近 N 天用过"也区分不出「已删配置」,
// 因为删除往往就紧随其近期使用之后(实测某部署删掉 11 个模型,其中 7 个 7 天内还用过)。
//
// 所以配置面(单价表)必须回到**真正的配置源** —— DSH 的 settings。
// 两种命名空间形态:
//   A. llm-pi-ai 风格:{ providers: { <路由名>: { models: [{ id }] } } }
//      路由名就是 provider,可结构化取出,无需映射。
//   B. 适配器自带命名空间:{ models: [{ id }] } —— provider 名不在 settings 里,而是
//      包内常量(如 dsh-llm-deepseek 的 PROVIDER = 'deepseek-official'),只能靠一张
//      小映射表;表里没有的**降级**为按模型 id 匹配(byId),绝不猜一个 provider 出来。
//
// 任何形态都解析不出来 → 返回 null,调用侧据此**关闭过滤**显示全部:
// "读不到配置"永远不许把界面清空。
// ---------------------------------------------------------------------------
/** 命名空间 → provider 路由名的已知映射。缺失即降级为 byId 匹配,不猜。 */
export const NS_TO_PROVIDER = { 'llm-deepseek': 'deepseek-official' }

/**
 * 从 settings 描述符快照解析当前配置的模型。
 * @param descriptors - settings.describe() 的结果。只读 ns/value,其余字段一律忽略,
 *   因此**任何**密钥类字段都不会进入返回值或后续 API 载荷。
 * @returns `{ exact: string[], byId: string[] }`,或 null(无法判定时)。
 *   exact 为 `provider:model`;byId 为 provider 无法确定时的裸模型 id。
 */
export function configuredModelsFrom(descriptors) {
  if (!Array.isArray(descriptors)) return null
  const exact = new Set()
  const byId = new Set()
  let sawCatalog = false
  for (const d of descriptors) {
    const v = d && d.value
    if (!v || typeof v !== 'object') continue
    const ns = String((d && d.ns) || '')
    // 形态 A:providers 字典的键就是 provider 路由名
    if (v.providers && typeof v.providers === 'object') {
      for (const route of Object.keys(v.providers)) {
        const prof = v.providers[route]
        if (!prof || !Array.isArray(prof.models)) continue
        for (const m of prof.models) {
          if (m && typeof m.id === 'string' && m.id) { exact.add(`${route}:${m.id}`); sawCatalog = true }
        }
      }
    }
    // 形态 B:顶层 models 数组,provider 来自映射表
    if (Array.isArray(v.models)) {
      const provider = NS_TO_PROVIDER[ns]
      for (const m of v.models) {
        if (!m || typeof m.id !== 'string' || !m.id) continue
        sawCatalog = true
        if (provider) exact.add(`${provider}:${m.id}`)
        else byId.add(m.id)
      }
    }
  }
  if (!sawCatalog) return null
  return { exact: Array.from(exact).sort(), byId: Array.from(byId).sort() }
}

/** 判断一条 `provider:model` 是否落在当前配置内(exact 命中,或 byId 兜底)。 */
export function isConfiguredModel(configured, key) {
  if (!configured) return false
  if (configured.exact.indexOf(key) >= 0) return true
  const idx = String(key).indexOf(':')
  const id = idx >= 0 ? String(key).slice(idx + 1) : String(key)
  return configured.byId.indexOf(id) >= 0
}

export function metaInfo(store, extra = {}) {
  let reqCount = 0
  for (const id of Object.keys(store.requests)) reqCount += store.requests[id].length
  const models = new Set()
  for (const id of Object.keys(store.requests)) for (const r of store.requests[id]) if (r.m) models.add(r.m)
  const quar = store.quarantine || {}
  const quarantined = Object.keys(quar).map((id) => ({
    id, name: quar[id].name, message: quar[id].message,
    at: quar[id].at, hits: quar[id].hits || 1,
  })).sort((a, b) => (b.at || 0) - (a.at || 0))
  return {
    sessionsRoot: store.sessionsRoot || '', storeFile: store.storeFile || '',
    storeDir: extra.storeDir || '',
    storeVersion: store.version,
    sessionCount: Object.keys(store.requests).length,
    requestCount: reqCount,
    dayCount: Object.keys(store.days).length,
    monthCount: Object.keys(store.months).length,
    models: Array.from(models).sort(),
    priceFamilies: PRICE_FAMILIES,
    stats: store.stats,
    updatedAt: store.updatedAt,
    quarantinedCount: quarantined.length,
    quarantined: quarantined.slice(0, 50),
    webPagePath: (store.config && store.config.webPagePath) || '',
    retention: (store.config && store.config.retention) || { days: 0 },
    hasCustomPrices: Object.keys((store.config && store.config.prices) || {}).length,
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------
// 公式注入防护:=/+/-/@/Tab/CR 开头的值在 Excel/WPS 中会被当公式执行,
// 前置单引号强制按文本处理(无损通道是 export.json,CSV 面向表格软件)
const csvEsc = (v) => {
  const s = String(v)
  return `"${(s && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`
}
export function exportCsv(store, range, from, to, flt, nowMs = Date.now()) {
  flushAggregates(store)
  const r = dayRangeOf(range || 'all', from, to, nowMs)
  const rows = []
  const useAgg = !flt.sessionId && !flt.wd && aggregatesReady(store)
  if (useAgg) {
    // 日×模型行恰好就是 day.models 的形状,直接按序输出
    const picks = flt.modelSet ? Array.from(flt.modelSet) : null
    for (const dk of Object.keys(store.days).sort()) {
      if (r.from && dk < r.from) continue
      if (r.to && dk > r.to) continue
      const day = store.days[dk]
      const mks = (picks ? picks.filter((mk) => day.models[mk]) : Object.keys(day.models)).sort()
      for (const mk of mks) {
        const dm = day.models[mk]
        rows.push({ day: dk, model: mk, miss: dm.miss, read: dm.read, write: dm.write, out: dm.out, requests: dm.requests, cost: dm.cost, saved: dm.saved })
      }
    }
  } else {
    const items = eachWithin(store, r.from, r.to, flt)
    const rowMap = {}
    for (const it of items) {
      const rec = it.r
      const dk = dayKeyOf(rec.t)
      const k = `${dk}|${rec.m}`
      let row = rowMap[k] || (rowMap[k] = { day: dk, model: rec.m, miss: 0, read: 0, write: 0, out: 0, requests: 0, cost: 0, saved: 0 })
      row.miss += rec.miss; row.read += rec.read; row.write += rec.write; row.out += rec.out
      row.requests += 1; row.cost += rec.cost || 0; row.saved += rec.saved || 0
    }
    for (const k of Object.keys(rowMap).sort()) rows.push(rowMap[k])
    rows.sort((a, b) => a.day === b.day ? (a.model < b.model ? -1 : 1) : (a.day < b.day ? -1 : 1))
  }
  const head = ['date', 'model', 'miss', 'cache_read', 'cache_write', 'output', 'total', 'requests', 'cost_yuan', 'saved_yuan']
  const lines = [head.join(',')]
  for (const rw of rows) {
    lines.push([rw.day, csvEsc(rw.model), rw.miss, rw.read, rw.write, rw.out, rw.miss + rw.read + rw.write + rw.out, rw.requests, rw.cost.toFixed(6), rw.saved.toFixed(6)].join(','))
  }
  return lines.join('\n')
}

export function exportJson(store, range, from, to, flt, nowMs = Date.now()) {
  flushAggregates(store)
  const r = dayRangeOf(range || 'all', from, to, nowMs)
  const items = eachWithin(store, r.from, r.to, flt)
  const out = items.map((it) => {
    const rec = it.r
    const idx = rec.m.indexOf(':')
    return {
      session: it.id, seq: rec.seq, time: rec.t, iso: new Date(rec.t).toISOString(),
      provider: idx >= 0 ? rec.m.slice(0, idx) : '', model: idx >= 0 ? rec.m.slice(idx + 1) : rec.m,
      miss: rec.miss, cacheRead: rec.read, cacheWrite: rec.write, output: rec.out, reasoning: rec.r || 0,
      interrupted: rec.i ? 1 : 0, cumulativeInput: rec.cum || 0,
      costYuan: Number((rec.cost || 0).toFixed(6)), savedYuan: Number((rec.saved || 0).toFixed(6)),
    }
  })
  return JSON.stringify({ exportedAt: new Date().toISOString(), range: { from: r.from, to: r.to }, count: out.length, requests: out }, null, 1)
}

// ---------------------------------------------------------------------------
// 配置
// patch 为部分补丁:未提及的字段保持不变
// (prices/budget/webPagePath/retention/peakHours/peakDays)。
// ---------------------------------------------------------------------------
export function applyConfigPatch(store, patch) {
  const cfg = store.config || (store.config = emptyStore().config)
  if (!cfg.prices) cfg.prices = {}
  if (!cfg.retention) cfg.retention = { days: 0 }
  if (patch.resetPrices || patch.prices === null) cfg.prices = {}
  if (patch.prices && typeof patch.prices === 'object') {
    const p = patch.prices
    for (const k of Object.keys(p)) {
      const v = p[k]
      if (v === null || (typeof v === 'object' && !Object.keys(v).length)) delete cfg.prices[k]
      else {
        const e = priceEntryOf(v)
        if (e) cfg.prices[k] = e
      }
    }
  }
  // 高峰时段/高峰日:官方策略会变,故开放为配置。null = 恢复官方默认。
  if (patch.peakHours !== undefined) {
    if (patch.peakHours === null) cfg.peakHours = DEFAULT_PEAK_HOURS.map((r) => r.slice())
    else {
      const h = normalizeHourRanges(patch.peakHours)
      if (!h) throw new Error('高峰时段格式应为 "9-12, 14-18" 或区间数组,如 [[9,12],[14,18]]')
      cfg.peakHours = h
    }
  }
  if (patch.peakDays !== undefined) {
    if (patch.peakDays === null) cfg.peakDays = DEFAULT_PEAK_DAYS.slice()
    else {
      const d = normalizeDayRanges(patch.peakDays)
      if (!d) throw new Error('高峰日格式应为 "1-5" 或日期数组,如 [1,2,3,4,5](0=周日)')
      cfg.peakDays = d
    }
  }
  if (patch.budget) {
    const b = Number(patch.budget.monthly)
    if (isFinite(b) && b >= 0) cfg.budget = { monthly: b }
  }
  if (patch.webPagePath) {
    // 页面内容会被原样返回给浏览器,限定为 .html/.htm,避免被当成任意文件读取通道
    const s = String(patch.webPagePath).trim()
    if (!/\.html?$/i.test(s)) throw new Error('webPagePath must point to an .html/.htm file')
    cfg.webPagePath = s
  }
  if (patch.retention !== undefined) {
    const d = Number(patch.retention && patch.retention.days !== undefined ? patch.retention.days : patch.retention)
    if (!isFinite(d) || d < 0) throw new Error('retention.days must be a non-negative number')
    cfg.retention = { days: d }
  }
  // 只标脏,不在这里重建:单价/时段/保留期都可能被设置页"点选即时生效"式地连续修改
  // (24 个小时格 = 24 次请求),每次都全量重建是纯浪费。真正的重建推迟到下一次查询
  // 或落盘前(flushAggregates),语义不变、成本从 N 次降到 1 次。
  markStale(store)
  return configView(store)
}

/**
 * 配置视图(页面配置面板)。除用户配置外附带:
 *   defaults  模型键 → 官方默认价(含 peak/idle 两档),供单价表显示占位值
 *             与区分"官方价 / 未定价"(缺席 = 无默认价,成本按 ¥0 计);
 *   prices    归一化为 {peak, idle} —— 旧的扁平写法在读取侧统一,UI 不必分支;
 *   schedule  生效中的高峰时段/日,以及给输入框用的紧凑文本。
 */
export function configView(store) {
  const c = (store && store.config) || {}
  const sched = peakSchedule(store)
  const prices = {}
  for (const k of Object.keys(c.prices || {})) {
    const e = priceEntryOf(c.prices[k])
    if (e) prices[k] = e
  }
  return {
    prices,
    budget: c.budget || { monthly: 0 },
    webPagePath: c.webPagePath || '',
    retention: c.retention || { days: 0 },
    defaults: priceDefaults(store),
    schedule: sched,
    peakHours: fmtHourRanges(sched.hours),
    peakDays: fmtDayRanges(sched.days),
    defaultsSchedule: { hours: DEFAULT_PEAK_HOURS.map((r) => r.slice()), days: DEFAULT_PEAK_DAYS.slice() },
    defaultsPeakHours: fmtHourRanges(DEFAULT_PEAK_HOURS),
    defaultsPeakDays: fmtDayRanges(DEFAULT_PEAK_DAYS),
  }
}

// ---------------------------------------------------------------------------
// store 形态与空库
// ---------------------------------------------------------------------------
/**
 * store.json 的**形态体检**。
 *
 * 为什么需要:JSON.parse 成功 ≠ 数据可用。截断/字段缺失/类型错乱的 store 若被当成
 * 空库接手,插件会在下一次落盘时把它覆盖成"干净的空库",用户的历史统计**静默清零**。
 * 所以读取侧先体检:不合格就留着原文件改名留证(见 Host 的 loadStore),绝不当场覆盖。
 * 只做结构判定,不修数据 —— 修数据需要语义,那是 migration 的活。
 */
export function isStoreShapeValid(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false
  if (!s.requests || typeof s.requests !== 'object' || Array.isArray(s.requests)) return false
  if (!s.watermarks || typeof s.watermarks !== 'object') return false
  for (const id of Object.keys(s.requests)) {
    const list = s.requests[id]
    if (!Array.isArray(list)) return false
    for (const r of list) {
      if (!r || typeof r !== 'object') return false
      if (typeof r.t !== 'number' || !isFinite(r.t)) return false
      // 四段用量必须是有限数:NaN 会一路污染聚合、成本与图表,且无从察觉
      for (const k of ['miss', 'read', 'write', 'out']) {
        if (typeof r[k] !== 'number' || !isFinite(r[k])) return false
      }
      if (typeof r.m !== 'string') return false
    }
  }
  if (s.days !== undefined && (typeof s.days !== 'object' || s.days === null || Array.isArray(s.days))) return false
  if (s.months !== undefined && (typeof s.months !== 'object' || s.months === null || Array.isArray(s.months))) return false
  if (s.config !== undefined && (typeof s.config !== 'object' || s.config === null || Array.isArray(s.config))) return false
  return true
}

export function emptyStore() {
  return {
    version: STORE_VERSION,
    updatedAt: 0,
    sessionsRoot: '',
    storeFile: '',
    config: {
      prices: {}, budget: { monthly: 0 }, webPagePath: '', retention: { days: 0 },
      peakHours: DEFAULT_PEAK_HOURS.map((r) => r.slice()), peakDays: DEFAULT_PEAK_DAYS.slice(),
    },
    watermarks: {},
    quarantine: {},
    sessions: {},
    days: {},
    months: {},
    requests: {},
    stats: { fullScans: 0, incrementalScans: 0, scannedFiles: 0, newRequests: 0, failedSessions: 0, lastScanAt: 0, lastScanMs: 0, lastSummary: null },
  }
}

// ---------------------------------------------------------------------------
// REST 分发(供 webServer 路由)
// 返回 { status, contentType, body }
// ---------------------------------------------------------------------------
export function apiDispatch(store, name, query, body = null, ctx = {}) {
  const flt = makeFilter(query)
  switch (name) {
    case 'kpi': return jsonOk(kpiQuery(store, query.range, query.from, query.to, flt, ctx.nowMs))
    case 'series': return jsonOk(seriesQuery(store, query.granularity || 'day', query.range, query.from, query.to, flt, ctx.nowMs))
    case 'hours': return jsonOk(hoursQuery(store, query.range, query.from, query.to, flt, ctx.nowMs))
    case 'heatmap': return jsonOk(heatmapQuery(store, query.months, flt, ctx.nowMs))
    case 'sessions': return jsonOk(sessionsQuery(store, query.sort, query.limit, query.range, query.from, query.to, flt, ctx.nowMs))
    case 'session': return jsonOk(sessionDetailQuery(store, query.id || '', { brief: !!query.brief }))
    case 'meta': return jsonOk(metaInfo(store, ctx.metaExtra || {}))
    case 'config': return jsonOk(configView(store))
    case 'export.csv': {
      const csv = exportCsv(store, query.range, query.from, query.to, flt, ctx.nowMs)
      return { status: 200, contentType: 'text/csv; charset=utf-8', body: csv, headers: { 'Content-Disposition': 'attachment; filename="dsh-token-daily-model.csv"' } }
    }
    case 'export.json': {
      const js = exportJson(store, query.range, query.from, query.to, flt, ctx.nowMs)
      return { status: 200, contentType: 'application/json; charset=utf-8', body: js, headers: { 'Content-Disposition': 'attachment; filename="dsh-token-requests.json"' } }
    }
    default: return { status: 404, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ error: 'unknown api' }) }
  }
}
function jsonOk(data) { return { status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(data) } }
