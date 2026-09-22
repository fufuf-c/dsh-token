



export const STORE_VERSION = 8

const pad2 = (n) => String(n).padStart(2, '0')

export const dayKeyOf = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
export const monthKeyOf = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

export const clipCP = (s, n) => Array.from(String(s)).slice(0, n).join('')

export function splitModelKey(key) {
  const k = String(key == null ? '' : key)
  const i = k.indexOf(':')
  return i >= 0 ? { provider: k.slice(0, i), model: k.slice(i + 1) } : { provider: '', model: k }
}

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















export const DEFAULT_PEAK_HOURS = [[9, 12], [14, 18]]
export const DEFAULT_PEAK_DAYS = [1, 2, 3, 4, 5] 
const DEFAULT_SCHEDULE = { hours: DEFAULT_PEAK_HOURS, days: DEFAULT_PEAK_DAYS }

export const DEFAULT_REFRESH = { pageSec: 60, scanSec: 300, onOpen: true }

export const REFRESH_BOUNDS = {
  pageSec: { min: 5, max: 3600 },
  scanSec: { min: 5, max: 86400 },
}

export function refreshSettings(store) {
  const r = (store && store.config && store.config.refresh) || {}
  const sec = (v, b, dflt) => {
    if (v === null || v === undefined || v === '') return dflt
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) return dflt
    return n === 0 ? 0 : Math.min(b.max, Math.max(b.min, Math.round(n)))
  }
  return {
    pageSec: sec(r.pageSec, REFRESH_BOUNDS.pageSec, DEFAULT_REFRESH.pageSec),
    scanSec: sec(r.scanSec, REFRESH_BOUNDS.scanSec, DEFAULT_REFRESH.scanSec),
    onOpen: r.onOpen === undefined || r.onOpen === null ? DEFAULT_REFRESH.onOpen : !!r.onOpen,
  }
}






const MAX_STREAK_LOOKBACK_DAYS = 73000

const HEATMAP_MONTHS_MIN = 1
const HEATMAP_MONTHS_MAX = 24

const SESSIONS_DEFAULT_LIMIT = 50
const SESSIONS_MAX_LIMIT = 500

const SESSIONS_PAGE_MAX_OFFSET = 5000

const QUARANTINE_REPORT_LIMIT = 50

const EXPORT_JSON_MAX_ROWS = 100000

const SPIKE_MIN_TOKENS = 150000
const SPIKE_MEDIAN_MULTIPLE = 2.5

export const PRICE_FAMILIES = [
  {
    key: 'deepseek-flash', label: 'DeepSeek 官方价 · deepseek-flash',
    
    peak: { miss: 2, hit: 0.04, write: 0, output: 8 },
    idle: { miss: 1, hit: 0.02, write: 0, output: 4 },
  },
  {
    key: 'deepseek-pro', label: 'DeepSeek 官方价 · deepseek-v4-pro',
    peak: { miss: 9, hit: 0.3, write: 0, output: 27 },
    idle: { miss: 4.5, hit: 0.15, write: 0, output: 13.5 },
  },
]


const splitParts = (s) => String(s == null ? '' : s).trim().split(/[,，;；]/)

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
  
  
  return mergeHourRanges(out)
}
export const fmtHourRanges = (h) => (h || []).map(([a, b]) => `${a}-${b}`).join(', ')

function mergeHourRanges(ranges) {
  const merged = []
  for (const [a, b] of ranges) {
    const last = merged[merged.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b) 
    else merged.push([a, b])
  }
  return merged
}

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
  return mergeHourRanges(out)
}

export function parseDayRanges(s) {
  const out = new Set()
  for (const part of splitParts(s)) {
    const p = part.trim()
    if (!p) continue
    const m = /^([0-7])\s*[-~–—]\s*([0-7])$/.exec(p) || /^([0-7])$/.exec(p)
    if (!m) return null
    const a = Number(m[1]) % 7
    if (m[2] === undefined) { out.add(a); continue } 
    const b = Number(m[2])
    for (let i = 0; i <= 7; i++) {
      out.add((a + i) % 7)
      if (a + i === b) break
      
      if (i > 0 && (a + i) % 7 === b) break
    }
  }
  if (!out.size) return null
  return Array.from(out).sort((x, y) => x - y)
}

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

export function peakSchedule(store) {
  const c = (store && store.config) || {}
  return {
    hours: Array.isArray(c.peakHours) ? c.peakHours : DEFAULT_PEAK_HOURS,
    days: Array.isArray(c.peakDays) ? c.peakDays : DEFAULT_PEAK_DAYS,
  }
}

export function isPeakHour(ms, sched) {
  const n = Number(ms)
  if (!Number.isFinite(n)) return false 
  const s = sched || DEFAULT_SCHEDULE
  const d = new Date(n + 8 * 3600 * 1000)
  if (!s.days.includes(d.getUTCDay())) return false
  const h = d.getUTCHours()
  for (const [a, b] of s.hours) if (h >= a && h < b) return true
  return false
}

export const beijingHourOf = (ms) => new Date(Number(ms) + 8 * 3600 * 1000).getUTCHours()

export const beijingDayOf = (ms) => {
  const d = new Date(Number(ms) + 8 * 3600 * 1000)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

export function priceAt(price, ms, sched) { return isPeakHour(ms, sched) ? price.peak : price.idle }

const familyFor = (model) => (/pro/i.test(String(model)) ? PRICE_FAMILIES[1] : PRICE_FAMILIES[0])

const OFFICIAL_PROVIDER = 'deepseek-official'

export function defaultPrice(provider, model) {
  const p = String(provider || '')
  if (p !== OFFICIAL_PROVIDER) return null
  return familyFor(model)
}

const PRICE_FIELDS = ['miss', 'hit', 'write', 'output']
const asTier = (o) => {
  if (!o || typeof o !== 'object') return null
  if (!PRICE_FIELDS.some((k) => o[k] !== undefined)) return null
  const miss = o.miss === undefined ? 0 : Number(o.miss)
  const hit = o.hit === undefined ? 0 : Number(o.hit)
  const write = o.write === undefined ? 0 : Number(o.write)
  const output = o.output === undefined ? 0 : Number(o.output)
  if (![miss, hit, write, output].every((n) => Number.isFinite(n) && n >= 0)) return null
  return { miss, hit, write, output }
}

export function priceEntryOf(ov) {
  if (!ov || typeof ov !== 'object') return null
  if (ov.peak !== undefined || ov.idle !== undefined) {
    const peak = asTier(ov.peak)
    if (!peak) return null
    const idle = ov.idle === undefined ? peak : asTier(ov.idle)
    if (!idle) return null
    return { peak, idle }
  }
  const flat = asTier(ov)
  return flat ? { peak: flat, idle: flat } : null
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

function costAndSavedOf(u, r) {
  return {
    cost: (r.miss * u.miss + r.read * u.hit + r.write * u.write + r.out * u.output) / 1e6,
    saved: (r.read * (u.miss - u.hit)) / 1e6,
  }
}
export function computeCost(price, r, sched) {
  const u = priceAt(price, r.t, sched)
  return { ...costAndSavedOf(u, r), priced: true }
}

export function priceDefaults(store) {
  const seen = new Set()
  for (const id of Object.keys((store && store.requests) || {})) {
    for (const r of store.requests[id]) seen.add(r.m)
  }
  const out = {}
  for (const mk of seen) {
    const { provider, model } = splitModelKey(mk)
    const d = defaultPrice(provider, model)
    if (d) out[mk] = { key: d.key, label: d.label, peak: d.peak, idle: d.idle }
  }
  return out
}

function priceCacheFor(store) {
  const cache = {}
  return (mk) => {
    let p = cache[mk]
    if (p === undefined) {
      const { provider, model } = splitModelKey(mk)
      p = priceOf(store, provider, model) || null
      cache[mk] = p
    }
    return p
  }
}

function costPartsOf(store, r, priceOfModel) {
  const resolve = priceOfModel || priceCacheFor(store)
  const price = resolve(r.m)
  if (!price) return null
  const u = priceAt(price, r.t, peakSchedule(store))
  return {
    miss: (r.miss * u.miss) / 1e6,
    read: (r.read * u.hit) / 1e6,
    write: (r.write * u.write) / 1e6,
    out: (r.out * u.output) / 1e6,
  }
}




function dayRangeOf(range, from, to, nowMs = Date.now()) {
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

function canUseAggregates(store, flt) {
  
  
  
  
  if (!flt) return aggregatesReady(store)
  if (flt.sessionId || flt.wd) return false
  return aggregatesReady(store)
}

function queryContext(store, range, from, to, flt, nowMs) {
  flushAggregates(store) 
  const r = dayRangeOf(range || 'all', from, to, nowMs)
  return { r, useAgg: canUseAggregates(store, flt || makeFilter(null)) }
}
export function makeFilter(args) {
  
  
  const raw = args && args.models ? String(args.models) : ''
  const models = raw.split(',').map((s) => s.trim()).filter(Boolean)
  return {
    modelSet: models.length ? new Set(models) : null,
    sessionId: args && args.session ? String(args.session) : '',
    wd: args && args.wd ? String(args.wd) : '',
    q: args && args.q ? String(args.q).trim().toLowerCase() : '',
  }
}

const NO_FILTER = () => makeFilter(null)
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
function eachWithin(store, fromDay, toDay, flt) {
  const f = flt || NO_FILTER()
  const r = { from: fromDay || null, to: toDay || null }
  const out = []
  const sessions = store.sessions || {}
  for (const id of Object.keys(store.requests)) {
    
    
    
    
    
    
    
    
    if (f.sessionId && id.indexOf(f.sessionId) !== 0) continue
    if (f.wd) {
      const m = sessions[id] && sessions[id].meta
      const cwd = (m && m.cwd) || ''
      if (cwd.indexOf(f.wd) !== 0) continue
    }
    const list = store.requests[id]
    for (let i = 0; i < list.length; i++) {
      const rec = list[i]
      
      if (f.modelSet && !f.modelSet.has(rec.m)) continue
      const dk = dayKeyOf(rec.t)
      if (!inDayRange(dk, r)) continue
      out.push({ r: rec, id })
    }
  }
  return out
}

export function inDayRange(dk, r) {
  if (r.from && dk < r.from) return false
  if (r.to && dk > r.to) return false
  return true
}

export function modelPicks(flt) {
  const f = flt || NO_FILTER()
  return f.modelSet ? Array.from(f.modelSet) : null
}




export function newTotals() { return { miss: 0, read: 0, write: 0, out: 0, requests: 0, cost: 0, saved: 0, priced: 0 } }
export function aggregate(total, r) {
  total.miss += r.miss; total.read += r.read; total.write += r.write; total.out += r.out
  total.requests += 1; total.cost += r.cost || 0; total.saved += r.saved || 0
  total.priced += r.priced ? 1 : 0
  return total
}

export function addTotals(dst, src) {
  dst.miss += src.miss; dst.read += src.read; dst.write += src.write; dst.out += src.out
  dst.requests += src.requests; dst.cost += src.cost; dst.saved += src.saved
  dst.priced += src.priced || 0
  return dst
}

export function tokenTotal(t) {
  if (!t) return 0
  return (t.miss || 0) + (t.read || 0) + (t.write || 0) + (t.out || 0)
}

export function modelsArrayOf(models) {
  return Object.keys(models).map((mk) => {
    const { provider, model } = splitModelKey(mk)
    return { key: mk, provider, model, totals: models[mk] }
  }).sort((a, b) => tokenTotal(b.totals) - tokenTotal(a.totals))
}

export function bumpModel(map, key) {
  return map[key] || (map[key] = newTotals())
}































function aggState(store) {
  let st = store.__agg
  if (!st) {
    st = { stale: false, scanning: 0, flushing: false, shape: null, configEpoch: CONFIG_EPOCH, appliedEpoch: CONFIG_EPOCH }
    Object.defineProperty(store, '__agg', {
      value: st, enumerable: false, writable: true, configurable: true,
    })
  }
  return st
}

/**
 * 价格/时段配置的**世代号**(0.9.5 起)。
 *
 * 为什么需要:增量重折只对"数据变了的会话"重算 cost/saved,而未变会话上的 cost
 * 仍是**上一个价目**算出来的。如果此时走增量,聚合里就会同时存在两种口径 ——
 * 一半新价、一半旧价,总额是个谁也对不上的怪数,而且页面上没有任何提示。
 * 所以:**配置世代变了就必须全量重折**,这条没有取巧余地。
 *
 * 该世代号只存在于内存(不落盘、不占 store 字段),所以重启后 appliedEpoch 从当前
 * 世代开始,等于"重启不做额外全量" —— 重启本来就会全量重折一遍,没有额外代价。
 */
let CONFIG_EPOCH = 1

/** 配置被改写时调用(applyConfigPatch)。只加世代号,不做任何重算。 */
export function touchConfigEpoch() {
  CONFIG_EPOCH++
  return CONFIG_EPOCH
}

/** 当前配置世代号(扫描侧用于判断"这一轮能不能走增量")。 */
export function configEpoch() {
  return CONFIG_EPOCH
}

/**
 * 声明"聚合已被按某个世代号重折过"。
 *
 * 只在**真正做完一次全量重建**之后调用。扫描侧要拿到"重折前"的世代号,所以
 * 调用方自己读 configEpoch()、重建、再把它回报回来 —— 重建期间若又有人改了配置,
 * 传入的旧世代号不等于当前世代号,这里就**什么都不标记**(下次仍会要求全量)。
 */
export function markConfigApplied(store, epoch) {
  if (!store) return
  const st = aggState(store)
  if (epoch === CONFIG_EPOCH) st.appliedEpoch = epoch
}

/** 聚合是否落后于当前配置(落后 → 必须全量重折,不许走增量)。 */
export function configStale(store) {
  if (!store) return true
  return aggState(store).appliedEpoch !== CONFIG_EPOCH
}

export function markScanning(store, on) {
  if (!store) return
  const st = aggState(store)
  if (on) st.scanning++
  else if (st.scanning > 0) st.scanning--
}

/**
 * 把聚合标记为"与请求数据不一致"。
 *
 * 由**任何改动 `store.requests` / `store.sessions` 的地方**调用(扫描替换记录、
 * 修剪、会话消失),以及改配置时调用。
 *
 * 为什么扫描侧也必须调(0.9.5 补):`aggregateShapeOk` 把判定结果缓存成
 * `st.shape = { src: days, ok }`,**只以 days 的对象标识为键**。"requests 变了但 days
 * 还是同一个对象"正是扫描的中间态 —— 缓存会继续返回改动前的结论。实测:空库
 * `flushAggregates()` 之后形状被缓存为 `ok=true`(合法),随后扫进 2 个会话,
 * `aggregatesNeedRebuild` 仍报 false、`aggregatesReady` 仍报 true,于是聚合再也不会
 * 被重建,每个查询都拿到一张空账 —— KPI 全 0,而记录明明都在。
 */
export function markStale(store) {
  if (!store) return
  aggState(store).stale = true
}

export function aggregatesNeedRebuild(store) {
  if (!store) return true
  const st = aggState(store)
  return st.stale || !aggregateShapeOk(store)
}

export function flushAggregates(store) {
  if (!store) return store
  const st = aggState(store)
  
  if (st.scanning > 0) return store
  
  if (st.stale || !aggregateShapeOk(store)) rebuildAll(store)
  return store
}

function aggregateShapeOk(store) {
  if (!store) return false
  const st = aggState(store)
  const days = store.days
  
  if (st.shape && st.shape.src === days) return st.shape.ok
  let ok
  const d = days || {}
  const ks = Object.keys(d)
  if (!ks.length) {
    // 空 days 只有在**整库确实没有任何记录**时才是合法形状。
    //
    // 为什么必须这样判(0.9.5):"无 days + 有 requests"是一个**自相矛盾**的中间态 ——
    // 它出现在"扫描刚把记录写进 store.requests、聚合还没来得及重建"那一刻。旧实现靠
    // 调用方无条件 `rebuildAllChunked` 把它盖过去;0.9.5 改成按需重折之后,这个中间态
    // 会一直留着,而 `aggregatesReady` 还会报 true(空 days 本身看着自洽),
    // 于是每个查询入口都拿到一张空账 —— KPI 全 0,而记录明明都在。
    // 与其在每个调用点加特例,不如让"形状体检"认识这个矛盾。
    ok = Object.keys(store.requests || {}).length === 0 && Object.keys(store.months || {}).length === 0
  } else {
    ok = true
    for (const k of ks) {
      const day = d[k]
      
      if (!day || !day.sessions) { ok = false; break }
      const ms = day.models || {}
      for (const mk of Object.keys(ms)) { if (!ms[mk].sessions) { ok = false; break } }
      if (!ok) break
    }
  }
  st.shape = { src: days, ok }
  return ok
}

export function aggregatesReady(store) {
  if (!store) return false
  const st = aggState(store)
  if (st.stale) return false
  if (st.scanning > 0) return false
  return aggregateShapeOk(store)
}




export function foldSession(events) {
  const recs = []
  const foldedSteps = new Set()
  let epoch = null
  const list = events || []
  for (let i = 0; i < list.length; i++) {
    const ev = list[i]
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
      
      
      
      
      const key = data.turn !== undefined && data.step !== undefined
        ? `${data.turn}:${data.step}`
        : `#${ev.seq === undefined ? `idx${i}` : ev.seq}`
      if (foldedSteps.has(key)) continue
      foldedSteps.add(key)
      
      
      
      
      const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0 }
      const input = num(usage.inputTokens)
      const read = num(usage.cacheReadTokens)
      const write = num(usage.cacheWriteTokens)
      const out = num(usage.outputTokens)
      
      
      
      
      
      
      
      
      
      
      const folded = usage.totalTokens !== undefined && (read > 0 || write > 0)
        && Number(usage.totalTokens) === input + out
      const miss = folded ? Math.max(0, input - read - write) : input
      recs.push({
        
        
        
        seq: ev.seq === undefined ? i : ev.seq,
        t: ev.time,
        m: `${epoch && epoch.provider || ''}:${epoch && epoch.model || ''}`,
        miss,
        read, write, out,
        r: num(usage.reasoningTokens),
        i: data.interrupted ? 1 : 0,
      })
    }
  }
  return recs
}




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





















function openRebuild(store) {
  return {
    days: {},
    months: {},
    priceOfModel: priceCacheFor(store), 
    sched: peakSchedule(store),         
    sessions: store.sessions || (store.sessions = {}),
    ids: Object.keys(store.requests),
  }
}

function rebuildSessionInto(acc, store, id) {
  const { days, months, sessions, priceOfModel, sched } = acc
  const list = store.requests[id]
  
  
  list.sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0))
  
  
  let ses = sessions[id]
  if (!ses || typeof ses !== 'object' || Array.isArray(ses)) {
    ses = sessions[id] = { meta: null, totals: newTotals(), models: {}, firstTs: null, lastTs: null }
  }
  ses.totals = newTotals(); ses.models = {}; ses.firstTs = null; ses.lastTs = null
  let cum = 0
  for (const r of list) {
    cum += r.miss + r.read + r.write
    r.cum = cum
    const price = priceOfModel(r.m)
    if (price) {
      const u = priceAt(price, r.t, sched) 
      const c = costAndSavedOf(u, r)
      r.cost = c.cost
      r.saved = c.saved
      r.priced = 1
    } else { r.cost = 0; r.saved = 0; r.priced = 0 }
    const dayK = dayKeyOf(r.t)
    const monthK = dayK.slice(0, 7)
    
    
    const hourK = String(beijingHourOf(r.t))
    aggregate(ses.totals, r)
    if (!ses.firstTs) ses.firstTs = r.t
    ses.lastTs = r.t
    let sm = bumpModel(ses.models, r.m); aggregate(sm, r)
    let day = days[dayK]
    if (!day) { day = { totals: newTotals(), models: {}, hours: {}, sessions: {} }; days[dayK] = day }
    aggregate(day.totals, r)
    day.sessions[id] = 1
    let dm = bumpModel(day.models, r.m)
    if (!dm.sessions) dm.sessions = {}
    dm.sessions[id] = 1
    aggregate(dm, r)
    let hh = bumpModel(day.hours, hourK); aggregate(hh, r)
    let mon = months[monthK]
    if (!mon) { mon = { totals: newTotals(), models: {} }; months[monthK] = mon }
    aggregate(mon.totals, r)
    let mm = bumpModel(mon.models, r.m); aggregate(mm, r)
  }
}

function publishRebuild(store, st, acc) {
  canonicalizeKeys(acc.days, acc.months)
  normalizeMoney(acc)
  store.days = acc.days; store.months = acc.months
  st.stale = false 
}

/**
 * 把聚合树的**键顺序**固定成规范序(字典序)。
 *
 * 为什么需要:增量路径会因"某个桶被减空 → 删除 → 之后又被重新加回"而改变插入顺序,
 * 于是 `Object.keys()` 的顺序与全量重建不同。实测 200 轮里 195 轮顺序不一致 ——
 * 两者的**数值**一样,但序列化字节不同,任何逐字节等价断言都会误报;
 * `seriesQuery` 还会按 `day.models` 的键序遍历,顺序不同会直接改变 API 返回的字节。
 *
 * ⚠ **必须就地重排,不得换对象**。`aggregateShapeOk` 用 `st.shape.src === days` 做
 * 对象标识缓存 —— 一旦把 `store.days` 换成新对象,缓存立刻失效,重查时会对着
 * 结构其实没变的 days 给出错误结论,聚合静默变成空账(实测:kpi.totals.requests 变 0,
 * 而 records 明明都在)。这一条是踩过的坑,不要"顺手"改成重建对象。
 *
 * 实现:先把有序键算好,再从原对象上删掉**每个**键(此时 JS 的对象剩余索引策略会
 * 自然给出升序),然后按有序键重新插入。不能只重插"顺序不对的那些"—— 已正确的键
 * 会被挪到末尾,反而把顺序弄乱(第一版就是这么错的)。
 */
function reorderInPlace(obj) {
  const sorted = Object.keys(obj).sort()
  // 全部改走"先删后插":V8 的普通对象在删除属性后,剩余键会按插入顺序回退成升序,
  // 于是"删一半"的结果不确定。全删光再按序插入是唯一确定的做法。
  const vals = sorted.map((k) => obj[k])
  for (const k of sorted) delete obj[k]
  for (let i = 0; i < sorted.length; i++) obj[sorted[i]] = vals[i]
}

function canonicalizeKeys(days, months) {
  for (const k of Object.keys(days)) {
    const d = days[k]
    if (!d) continue
    if (d.models) reorderInPlace(d.models)
    if (d.hours) reorderInPlace(d.hours)
  }
  for (const k of Object.keys(months)) {
    const m = months[k]
    if (!m) continue
    if (m.models) reorderInPlace(m.models)
  }
  reorderInPlace(days)
  reorderInPlace(months)
}

/**
 * 把聚合树里的金额吸附到 1e-12 元。
 *
 * 为什么需要:增量是 `unfold(减) → fold(加)`,而**浮点减法不可逆** —— 同一条记录
 * 减了再加,末位会变。实测 200 轮、每轮重折一个会话,累计漂移 6.7e-16 元:数值上
 * 完全无害,却让"增量结果与全量重建逐字节相同"这条断言必然失败。
 *
 * 网格必须**细**。这里踩过一次坑:先把网格设成 1e-6 元(看起来很合理的"分"级),
 * 结果出现 ±2e-6 的偏差 —— 因为漂移把某些桶推过了 0.5 个网格的取整边界,吸附
 * 反而**放大**了差异。1e-12 元比漂移(1e-16)粗 4 个数量级、又细到不可能碰到边界,
 * 既消掉末位噪声,又不会翻转任何值。
 *
 * 全量路径也走这里,所以两条路径的金额落在**同一张网格**上,等价性因此可比。
 */
const MONEY_GRID = 1e12

function gridMoney(x) {
  if (typeof x !== 'number' || !isFinite(x)) return 0
  return Math.round(x * MONEY_GRID) / MONEY_GRID
}

function normalizeMoney(acc) {
  const norm = (t) => {
    if (!t) return
    t.cost = gridMoney(t.cost)
    t.saved = gridMoney(t.saved)
  }
  for (const k of Object.keys(acc.days)) {
    const d = acc.days[k]
    if (!d) continue
    norm(d.totals)
    for (const mk of Object.keys(d.models || {})) norm(d.models[mk])
    for (const hk of Object.keys(d.hours || {})) norm(d.hours[hk])
  }
  for (const k of Object.keys(acc.months)) {
    const m = acc.months[k]
    if (!m) continue
    norm(m.totals)
    for (const mk of Object.keys(m.models || {})) norm(m.models[mk])
  }
}

// ---------------------------------------------------------------------------
// 增量聚合(0.9.5)
//
// 病根:`scanStore` 此前是 "只要有任何会话变了 → rebuildAllChunked(全库)"。
// 那个 if 用的是**布尔信号**(scanned>0),而 rebuildAll 的代价是 O(全库记录数) ——
// 于是一张 20 万请求的库里改 1 个会话,也要把 20 万条记录全部重排、重算 cost/saved、
// 重折 days/months/sessions。改动量与代价完全脱钩。
//
// 现在拆成两条路:
//   · 数据变了           → 只重折**被替换的那些会话**(本节的 unfold/incremental)
//   · 配置变了 / force   → 仍然整库重折(价格一改,每条记录的 cost 都过期,没有任何取巧余地)
//
// 为什么是 "unfold(旧) → fold(新)" 而不是 "直接重折":
// days/months 桶里存的是**累加后的数**,没有 per-session 的贡献记录,所以想减掉一个
// 会话只能把它当初加进去的量原样算出来再减 —— 也就是必须让 unfold 与 fold 用**同一份
// 记录列表、同一套定价**,逐字段对称。这是本节全部风险所在,由 V67(逐字节等价)锁住。
// ---------------------------------------------------------------------------

/**
 * 把一个会话**指定的那份记录列表**对 days/months 的贡献原样减掉。fold 的严格逆运算。
 *
 * ⚠ `list` 由调用方传入,而不是从 `store.requests[id]` 读 —— 这是**必须的**,不是风格:
 * 扫描时记录列表已经被换成新的了。若在这里读 store,减掉的就是"新列表",再把新列表
 * 加回去,旧贡献**从未被移除**,结果会稳定地偏离(实测:改 1 个会话后那天少算一半)。
 * 显式传参让这个错误在签名层面就不可能发生。
 *
 * 三个必须对齐的点(任意一处不齐都会静默偏移,且不报错):
 *   1. **同一份记录列表**:必须是当初 fold 进去的那一份(= 替换前的那一份);
 *   2. **同一套定价**:与 `rebuildSessionInto` 用同一个 acc 的 `priceOfModel` / `priceAt`
 *      (`priceCacheFor` 绑的是同一个 store);
 *   3. **同一个求和顺序**:先按 seq 排序,与 fold 的原地排序一致 —— 浮点加法不满足
 *      结合律,顺序不同会留下 1ulp 级残差。
 *
 * 会话级字段(totals/models/firstTs/lastTs)不做减法,整体清空后由
 * `rebuildSessionInto` 从新列表重建。
 */
export function unfoldSessionInto(acc, store, id, list) {
  if (!list || !list.length) return
  list.sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0))
  const days = acc.days
  const months = acc.months
  const ses = acc.sessions[id]
  for (const r of list) {
    const price = acc.priceOfModel(r.m)
    let cost = 0, saved = 0, priced = 0
    if (price) {
      const c = costAndSavedOf(priceAt(price, r.t, acc.sched), r)
      cost = c.cost; saved = c.saved; priced = 1
    }
    // 与 fold 同一口径:fold 里是 `r.saved || 0`,而 fold 之前 cost/saved 可能是
    // undefined(刚 foldSession 出来的记录)。
    const sv = saved || 0
    const dayK = dayKeyOf(r.t)
    const day = days[dayK]
    if (day) {
      subAgg(day.totals, r, cost, sv, priced)
      if (day.sessions) delete day.sessions[id]
      const dm = day.models[r.m]
      if (dm) {
        subAgg(dm, r, cost, sv, priced)
        if (dm.sessions) delete dm.sessions[id]
      }
      const hh = day.hours[String(beijingHourOf(r.t))]
      if (hh) subAgg(hh, r, cost, sv, priced)
    }
    const mon = months[dayK.slice(0, 7)]
    if (mon) {
      subAgg(mon.totals, r, cost, sv, priced)
      const mm = mon.models[r.m]
      if (mm) subAgg(mm, r, cost, sv, priced)
    }
  }
  if (ses) { ses.totals = newTotals(); ses.models = {}; ses.firstTs = null; ses.lastTs = null }
}

/** `aggregate` 的逐字段逆运算。必须与 aggregate 在同一处对称定义。 */
function subAgg(total, r, cost, saved, priced) {
  total.miss -= r.miss; total.read -= r.read; total.write -= r.write; total.out -= r.out
  total.requests -= 1
  total.cost -= cost; total.saved -= saved
  total.priced -= priced
  return total
}

/**
 * 装配一个**增量累加器**:绑定 store 上现成的 days / months / sessions。
 *
 * 刻意不叫 `openRebuild` —— 那个造的是**空桶**(全量重建"从零累加",拿空桶是对的),
 * 而增量是"在已经算对的账上增减",拿空桶等于把历史全抹掉。两者语义**相反**,
 * 名字必须分开,否则迟早有人把它们对调。
 *
 * 公开它是为了让 V69(fold/unfold 严格对称)能直接对同一个 acc 做
 * `unfold → rebuildSessionInto` 配对验证,而不必在测试里手工拼一个结构相同的对象 ——
 * 手工拼的那个一旦漏了字段,测试测的就是它自己,而不是生产代码。
 */
export function openDeltaAcc(store) {
  const acc = openRebuild(store)
  acc.days = store.days
  acc.months = store.months
  return acc
}

/**
 * 只重折 `deltas` 里的会话 —— 增量路径的唯一入口。
 *
 * `deltas` 的每一项是 `{ id, oldList }`:**oldList 必须是该会话被 fold 进去的那一份**
 * (会话记录被替换前的列表)。调用方在替换记录时顺手把旧列表留下即可。
 *
 * 前提(任一不满足都会做出错误结果):
 *   1. 聚合**已就绪**(`aggregatesReady`)—— 否则减掉的不是真正加进去的那份;
 *   2. 配置世代**未变**(`configStale === false`)—— 否则一半旧价一半新价。
 *
 * `days` / `months` 必须**原地**增减:全量重建是"从零累加"所以拿空桶是对的;增量是
 * "在已经算对的账上增减",拿空桶等于把历史全抹掉 —— 所以这里必须改指 store 上现成的
 * 那两个(`openRebuild` 造的是空桶)。顺带保住对象标识:`aggregateShapeOk` 用
 * `st.shape.src === days` 做缓存键,换新对象会让缓存失效、退化成每轮重扫全部桶。
 */
export function incrementalRebuildInto(store, st, deltas) {
  // 接受两类 delta:
  //   · 会话仍存在 → 先减旧列表、再加新列表(记录被替换)
  //   · 会话已被删除(oldList 非空,store.requests 里已没有它)→ **只减不加**
  // 删除这一支不能靠"过滤掉不存在的会话"来敷衍:那样它的旧贡献会永远留在账上,
  // 而 days 里的桶/prune 也永远清不掉。
  const list = []
  for (const d of deltas) {
    if (!d) continue
    const exists = !!store.requests[d.id]
    const hasOld = !!(d.oldList && d.oldList.length)
    if (!exists && !hasOld) continue
    list.push({ id: d.id, oldList: d.oldList, exists })
  }
  if (!list.length) return 0
  const acc = openRebuild(store)
  acc.days = store.days
  acc.months = store.months
  // 先减旧、再加新。两步都必须做:只减会把仍存在的会话从账上抹掉,只加会把旧贡献留成双份。
  for (const d of list) unfoldSessionInto(acc, store, d.id, d.oldList)
  for (const d of list) if (d.exists) rebuildSessionInto(acc, store, d.id)
  pruneEmptyBuckets(acc)
  acc.ids = Object.keys(store.requests)
  publishRebuild(store, st, acc)
  return list.length
}

/** 桶是否已空:四段用量与请求数全为 0。 */
function totalsEmpty(t) {
  return !t || (!t.requests && !t.miss && !t.read && !t.write && !t.out)
}

/**
 * 从聚合树上摘掉**已经空掉**的桶。
 *
 * 为什么必须做:全量重建是"从零累加",一个会话被删掉后它占的那天/那个月**根本不会
 * 被创建**;而增量是在旧账上减,减完会留下一个 `{totals: 0, models: {...}}` 的空壳。
 * 两者序列化后不同 —— days 的键集会凭空多出来,这正是 V67 逐字节等价要拦的东西。
 *
 * 判定必须**递归到底**:只看 totals 是否为 0 不够,残留的 models / hours 子桶会让
 * 一个已经没有任何数据的"月"继续出现在月份列表里。
 */
function pruneEmptyBuckets(acc) {
  for (const k of Object.keys(acc.days)) {
    const d = acc.days[k]
    if (!d) { delete acc.days[k]; continue }
    for (const mk of Object.keys(d.models || {})) if (totalsEmpty(d.models[mk])) delete d.models[mk]
    for (const hk of Object.keys(d.hours || {})) if (totalsEmpty(d.hours[hk])) delete d.hours[hk]
    if (totalsEmpty(d.totals)) delete acc.days[k]
  }
  for (const k of Object.keys(acc.months)) {
    const m = acc.months[k]
    if (!m) { delete acc.months[k]; continue }
    for (const mk of Object.keys(m.models || {})) if (totalsEmpty(m.models[mk])) delete m.models[mk]
    if (totalsEmpty(m.totals)) delete acc.months[k]
  }
}

export function rebuildAll(store) {
  const st = aggState(store)
  if (st.flushing) return
  st.flushing = true
  let done = false
  const epoch = CONFIG_EPOCH
  try {
    const acc = openRebuild(store)
    for (const id of acc.ids) rebuildSessionInto(acc, store, id)
    publishRebuild(store, st, acc)
    done = true
  } finally {
    
    st.flushing = false
    
    
    
    
    if (!done) st.stale = true
  }
  // 全量重折是"把 cost/saved 按当前价目重算一遍",所以它同时把聚合对齐到当前配置世代。
  // 世代号在**开始重折前**取:结束时若发现它已不等于当前世代,说明重折期间又有人改了
  // 配置,markConfigApplied 会拒绝标记 —— 下一轮自然会再要求一次全量,不会留下
  // "声称已对齐、实际是上一版价目"的假象。
  if (done) markConfigApplied(store, epoch)
}

export async function rebuildAllChunked(store, { sliceMs = 8, now = () => Date.now() } = {}) {
  const st = aggState(store)
  if (st.flushing) return
  st.flushing = true
  let done = false
  const epoch = CONFIG_EPOCH
  try {
    const acc = openRebuild(store)
    let sliceStart = now()
    for (let i = 0; i < acc.ids.length; i++) {
      rebuildSessionInto(acc, store, acc.ids[i])
      
      
      if (now() - sliceStart >= sliceMs) {
        await new Promise((resolve) => setImmediate(resolve))
        sliceStart = now()
      }
    }
    publishRebuild(store, st, acc)
    done = true
  } finally {
    st.flushing = false
    if (!done) st.stale = true
  }
  if (done) markConfigApplied(store, epoch)
}





function bucketTotalsOf(bucket, flt) {
  const out = newTotals()
  if (!bucket) return out
  if (flt.modelSet) { for (const mk of flt.modelSet) { const bm = bucket.models[mk]; if (bm) addTotals(out, bm) } }
  else addTotals(out, bucket.totals)
  return out
}

function collectDaySessions(day, picks, out) {
  if (!picks) {
    const s = day.sessions
    if (s) { for (const id of Object.keys(s)) out.add(id) }
    return
  }
  const push = (dm) => { const s = dm.sessions; if (s) for (const id of Object.keys(s)) out.add(id) }
  for (const mk of picks) { const dm = day.models[mk]; if (dm) push(dm) }
}

function accumulateAgg(store, r, flt) {
  const picks = modelPicks(flt)
  const acc = { totals: newTotals(), models: {}, dayTok: {}, active: new Set(), unpricedTokens: 0, unpricedModels: new Set() }
  const takeUnpriced = (mk, dm) => {
    const up = dm.requests - (dm.priced || 0)
    if (up > 0) { acc.unpricedTokens += tokenTotal(dm); acc.unpricedModels.add(mk) }
  }
  for (const dk of Object.keys(store.days)) {
    if (!inDayRange(dk, r)) continue
    const day = store.days[dk]
    if (picks) {
      for (const mk of picks) {
        const dm = day.models[mk]
        if (!dm) continue
        addTotals(acc.totals, dm)
        addTotals(bumpModel(acc.models, mk), dm)
        acc.dayTok[dk] = (acc.dayTok[dk] || 0) + tokenTotal(dm)
        takeUnpriced(mk, dm)
      }
    } else {
      addTotals(acc.totals, day.totals)
      acc.dayTok[dk] = tokenTotal(day.totals)
      for (const mk of Object.keys(day.models)) {
        addTotals(bumpModel(acc.models, mk), day.models[mk])
        takeUnpriced(mk, day.models[mk])
      }
    }
    collectDaySessions(day, picks, acc.active)
  }
  return acc
}

function accumulateRecords(store, r, flt) {
  const acc = { totals: newTotals(), models: {}, dayTok: {}, active: new Set(), unpricedTokens: 0, unpricedModels: new Set() }
  for (const it of eachWithin(store, r.from, r.to, flt)) {
    aggregate(acc.totals, it.r)
    aggregate(bumpModel(acc.models, it.r.m), it.r)
    acc.active.add(it.id)
    if (!it.r.priced) { acc.unpricedTokens += tokenTotal(it.r); acc.unpricedModels.add(it.r.m) }
    const dk = dayKeyOf(it.r.t)
    acc.dayTok[dk] = (acc.dayTok[dk] || 0) + tokenTotal(it.r)
  }
  return acc
}

function peakDayOf(dayTok) {
  let day = null, tokens = 0
  for (const dk of Object.keys(dayTok)) {
    if (dayTok[dk] <= 0) continue
    if (day === null || dayTok[dk] > tokens) { tokens = dayTok[dk]; day = dk }
  }
  return { day, tokens }
}

function streakDaysOf(dayTok, nowMs) {
  let streak = 0
  const d = new Date(nowMs)
  for (let i = 0; i < MAX_STREAK_LOOKBACK_DAYS; i++) {
    if ((dayTok[dayKeyOf(d.getTime())] || 0) > 0) streak++
    else break
    d.setDate(d.getDate() - 1)
  }
  return streak
}

function prevPeriodTotals(store, r, flt, useAgg) {
  if (r.label === 'today' && r.todayKey) {
    const d = new Date(`${r.todayKey}T00:00:00`); d.setDate(d.getDate() - 1)
    const pk = dayKeyOf(d.getTime())
    return { label: 'yesterday', totals: useAgg ? bucketTotalsOf(store.days[pk], flt) : rangeTotals(store, pk, pk, flt) }
  }
  if (r.label === 'month' && r.monthKey) {
    const parts = r.monthKey.split('-')
    const d = new Date(Number(parts[0]), Number(parts[1]) - 2, 1)
    const pmk = monthKeyOf(d.getTime())
    return { label: 'prevMonth', totals: useAgg ? bucketTotalsOf(store.months[pmk], flt) : rangeTotals(store, `${pmk}-01`, `${pmk}-31`, flt) }
  }
  return null
}

export function budgetStatus(store, usedCost, nowMs = Date.now()) {
  const monthly = Number(((store && store.config && store.config.budget) || {}).monthly)
  if (!Number.isFinite(monthly) || monthly <= 0) return null
  const used = Number.isFinite(usedCost) ? usedCost : 0
  const d = new Date(nowMs)
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  const day = d.getDate()
  const projected = used / Math.max(1, day) * daysInMonth
  return {
    monthly,
    used,
    day,
    daysInMonth,
    projected,
    over: projected > monthly,
    remaining: monthly - projected,
    ratio: used / monthly,
  }
}

export function kpiQuery(store, range, from, to, flt, nowMs = Date.now()) {
  const { r, useAgg } = queryContext(store, range, from, to, flt, nowMs)
  const { totals, models, dayTok, active, unpricedTokens, unpricedModels } =
    useAgg ? accumulateAgg(store, r, flt) : accumulateRecords(store, r, flt)
  const peak = peakDayOf(dayTok)
  const totalIn = totals.miss + totals.read + totals.write
  const hitRate = totalIn > 0 ? totals.read / totalIn : 0
  const prev = prevPeriodTotals(store, r, flt, useAgg)
  const delta = prev ? {
    tokens: tokenTotal(totals) - tokenTotal(prev.totals),
    cost: totals.cost - prev.totals.cost,
  } : null
  
  
  let budget = null
  const monthly = Number(((store && store.config && store.config.budget) || {}).monthly)
  if (Number.isFinite(monthly) && monthly > 0) {
    let usedCost = 0
    if (useAgg && store.months) {
      
      
      
      const mBucket = store.months[monthKeyOf(nowMs)]
      if (mBucket) {
        if (flt && flt.modelSet) {
          
          for (const mk of flt.modelSet) { const bm = mBucket.models && mBucket.models[mk]; if (bm) usedCost += bm.cost }
        } else usedCost = (mBucket.totals && mBucket.totals.cost) || 0
      }
    } else {
      
      
      const mr = dayRangeOf('month', null, null, nowMs)
      usedCost = accumulateRecords(store, mr, flt || NO_FILTER()).totals.cost
    }
    budget = budgetStatus(store, usedCost, nowMs)
  }
  return {
    range: { label: r.label, fromDay: r.from, toDay: r.to },
    totals: {
      miss: totals.miss, read: totals.read, write: totals.write, out: totals.out,
      total: tokenTotal(totals),
      requests: totals.requests, cost: totals.cost, saved: totals.saved,
      
      
      unpricedTokens, unpricedModelCount: unpricedModels.size,
    },
    hitRate, activeSessions: active.size,
    peakDay: peak.day === null ? null : peak,
    delta, streakDays: streakDaysOf(dayTok, nowMs), models: modelsArrayOf(models),
    
    budget,
  }
}

function rangeTotals(store, from, to, flt) {
  const pt = newTotals()
  for (const it of eachWithin(store, from, to, flt)) aggregate(pt, it.r)
  return pt
}

function normalizeGranularity(g) {
  return g === 'month' ? 'month' : g === 'week' ? 'week' : 'day'
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
  const { r, useAgg } = queryContext(store, range, from, to, flt, nowMs)
  
  const gran = normalizeGranularity(granularity)
  const buckets = {}, order = []
  if (useAgg) {
    const picks = modelPicks(flt)
    for (const dk of Object.keys(store.days)) {
      if (!inDayRange(dk, r)) continue
      const day = store.days[dk]
      if (picks) {
        
        for (const mk of picks) {
          const dm = day.models[mk]
          if (!dm) continue
          const bk = bucketKeyOf(dk, gran)
          let b = buckets[bk]
          if (!b) { b = { totals: newTotals(), models: {} }; buckets[bk] = b; order.push(bk) }
          addTotals(b.totals, dm)
          addTotals(bumpModel(b.models, mk), dm)
        }
      } else {
        const bk = bucketKeyOf(dk, gran)
        let b = buckets[bk]
        if (!b) { b = { totals: newTotals(), models: {} }; buckets[bk] = b; order.push(bk) }
        addTotals(b.totals, day.totals)
        for (const mk of Object.keys(day.models)) {
          addTotals(bumpModel(b.models, mk), day.models[mk])
        }
      }
    }
  } else {
    const items = eachWithin(store, r.from, r.to, flt)
    for (const it of items) {
      const rec = it.r
      const bk = bucketKeyOf(dayKeyOf(rec.t), gran)
      let b = buckets[bk]
      if (!b) { b = { totals: newTotals(), models: {} }; buckets[bk] = b; order.push(bk) }
      aggregate(b.totals, rec)
      aggregate(bumpModel(b.models, rec.m), rec)
    }
  }
  order.sort()
  
  return order.map((k) => ({ key: k, granularity: gran, totals: buckets[k].totals, models: buckets[k].models }))
}

export function hoursQuery(store, range, from, to, flt, nowMs = Date.now()) {
  const qc = queryContext(store, range, from, to, flt, nowMs)
  const r = qc.r
  const buckets = []
  for (let i = 0; i < 24; i++) buckets.push({ hour: i, totals: newTotals() })
  
  const useAgg = qc.useAgg && !flt.modelSet
  if (useAgg) {
    for (const dk of Object.keys(store.days)) {
      if (!inDayRange(dk, r)) continue
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
    
    const b = buckets[beijingHourOf(it.r.t)]
    if (b) aggregate(b.totals, it.r)
  }
  return buckets
}

export function heatmapQuery(store, months, flt, nowMs = Date.now()) {
  flushAggregates(store)
  const n = clamp(Number(months) || 12, HEATMAP_MONTHS_MIN, HEATMAP_MONTHS_MAX)
  const today = new Date(nowMs)
  const start = new Date(today.getFullYear(), today.getMonth() - (n - 1), 1)
  const from = dayKeyOf(start.getTime())
  const outMap = {}
  
  const useAgg = canUseAggregates(store, flt)
  if (useAgg) {
    const picks = modelPicks(flt)
    for (const dk of Object.keys(store.days)) {
      if (dk < from) continue
      const day = store.days[dk]
      let total = 0, requests = 0, hit = false
      if (picks) {
        for (const mk of picks) {
          const dm = day.models[mk]
          if (!dm) continue
          hit = true
          total += tokenTotal(dm)
          requests += dm.requests
        }
        if (!hit) continue 
      } else {
        total = tokenTotal(day.totals)
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
    e.total += tokenTotal(it.r)
    e.requests += 1
  }
  return Object.keys(outMap).sort().map((k) => outMap[k])
}

export function sessionsQuery(store, sort, limit, range, from, to, flt, nowMs = Date.now(), pageInfo = null) {
  flushAggregates(store) 
  const f = flt || NO_FILTER()
  const r = dayRangeOf(range || 'all', from, to, nowMs)
  const offset = pageInfo ? clampOffset(pageInfo.offset) : 0
  const bySession = {}
  
  
  
  
  
  
  
  const useAgg = !(r.from || r.to) && !f.modelSet && !f.sessionId && !f.wd && aggregatesReady(store)
  if (useAgg) {
    for (const id of Object.keys(store.sessions)) {
      const ses = store.sessions[id]
      if (!ses || !ses.totals || !ses.totals.requests) continue
      bySession[id] = { id, totals: ses.totals, firstTs: ses.firstTs, lastTs: ses.lastTs || 0 }
    }
  } else {
    const items = eachWithin(store, r.from, r.to, f)
    for (const it of items) {
      const e = bySession[it.id] || (bySession[it.id] = { id: it.id, totals: newTotals(), firstTs: null, lastTs: 0 })
      aggregate(e.totals, it.r)
      if (it.r.t > e.lastTs) e.lastTs = it.r.t
      
      
      if (e.firstTs === null || it.r.t < e.firstTs) e.firstTs = it.r.t
    }
  }
  const out = []
  for (const id of Object.keys(bySession)) {
    const e = bySession[id]
    const ses = store.sessions[id] || {}
    
    
    if (f.q) {
      const m = ses.meta || {}
      const hay = `${m.title || ''} ${m.cwd || ''} ${m.workspace || ''} ${id}`.toLowerCase()
      if (hay.indexOf(f.q) < 0) continue
    }
    out.push({
      id, meta: ses.meta || {}, totals: e.totals, requestsInRange: e.totals.requests,
      
      
      firstTs: e.firstTs, lastTs: e.lastTs,
      sessionFirstTs: ses.firstTs, sessionLastTs: ses.lastTs,
    })
  }
  const total = (x) => tokenTotal(x.totals)
  if (sort === 'cost') out.sort((a, b) => b.totals.cost - a.totals.cost)
  else if (sort === 'tokens') out.sort((a, b) => total(b) - total(a))
  else if (sort === 'recent') out.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0))
  else out.sort((a, b) => b.totals.requests - a.totals.requests)
  
  
  const n = Number(limit)
  const lim = Number.isFinite(n) && n > 0 ? clamp(Math.trunc(n), 1, SESSIONS_MAX_LIMIT) : SESSIONS_DEFAULT_LIMIT
  
  
  
  
  const page = out.slice(offset, offset + lim)
  if (pageInfo && typeof pageInfo === 'object') {
    pageInfo.total = out.length
    pageInfo.limit = lim
    pageInfo.offset = offset
    pageInfo.hasMore = offset + page.length < out.length
  }
  return page
}

function clampOffset(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(Math.trunc(n), SESSIONS_PAGE_MAX_OFFSET)
}

export function sessionDetailQuery(store, id, opts) {
  const brief = !!(opts && opts.brief)
  
  
  
  flushAggregates(store)
  const ses = store.sessions[id]
  if (!ses) return null
  const list = store.requests[id] || []
  const sched = peakSchedule(store)
  const models = {}
  let anomalies = 0
  const flags = []
  
  
  
  const hours = new Array(24).fill(0)
  const hoursPeak = new Array(24).fill(0)
  const peak = { tokens: 0, cost: 0, requests: 0 }
  const idle = { tokens: 0, cost: 0, requests: 0 }
  const costParts = { miss: 0, read: 0, write: 0, out: 0 }
  const days = new Set()
  const priceOfModel = priceCacheFor(store) 
  let unpriced = 0
  
  
  
  
  const spikeSeries = []
  for (let i = 0; i < list.length; i++) {
    const r = list[i]
    aggregate(bumpModel(models, r.m), r)
    const tk = tokenTotal(r)
    spikeSeries.push(tk)
    days.add(dayKeyOf(r.t))
    const hr = beijingHourOf(r.t)
    hours[hr] += tk
    const onPeak = isPeakHour(r.t, sched)
    const side = onPeak ? peak : idle
    side.tokens += tk; side.cost += r.cost || 0; side.requests += 1
    if (onPeak) hoursPeak[hr] += tk
    const parts = costPartsOf(store, r, priceOfModel)
    if (parts) {
      costParts.miss += parts.miss; costParts.read += parts.read
      costParts.write += parts.write; costParts.out += parts.out
    } else unpriced += tk
  }
  const sorted = spikeSeries.slice(1).sort((a, b) => a - b)
  
  
  const median = sorted.length === 0 ? 0
    : sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
  const thresh = Math.max(SPIKE_MIN_TOKENS, SPIKE_MEDIAN_MULTIPLE * median)
  for (let i = 0; i < list.length; i++) {
    let f = 0
    if (i > 0 && spikeSeries[i] > thresh) { f = 1; anomalies++ }
    else if (list[i].i) f = 2
    if (!brief) flags.push(f)
  }
  const modelsArr = modelsArrayOf(models)
  return {
    id, meta: ses.meta || { id }, totals: ses.totals, models: modelsArr,
    requestCount: list.length, anomalies, flagged: anomalies >= 2,
    firstTs: ses.firstTs, lastTs: ses.lastTs,
    hours, hoursPeak, tiers: { peak, idle }, costParts, unpriced,
    activeDays: days.size, schedule: { hours: sched.hours, days: sched.days },
    
    
    spike: { multiple: SPIKE_MEDIAN_MULTIPLE, minTokens: SPIKE_MIN_TOKENS, threshold: thresh },
    ...(brief ? {} : { requests: list, flags }),
  }
}




















const NS_TO_PROVIDER = { 'llm-deepseek': 'deepseek-official' }

export function configuredModelsFrom(descriptors) {
  if (!Array.isArray(descriptors)) return null
  const exact = new Set()
  const byId = new Set()
  let sawCatalog = false
  for (const d of descriptors) {
    const v = d && d.value
    if (!v || typeof v !== 'object') continue
    const ns = String((d && d.ns) || '')
    
    if (v.providers && typeof v.providers === 'object') {
      for (const route of Object.keys(v.providers)) {
        const prof = v.providers[route]
        if (!prof || !Array.isArray(prof.models)) continue
        for (const m of prof.models) {
          if (m && typeof m.id === 'string' && m.id) { exact.add(`${route}:${m.id}`); sawCatalog = true }
        }
      }
    }
    
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

export function isConfiguredModel(configured, key) {
  if (!configured) return false
  const k = String(key)
  if (configured.exact.indexOf(k) >= 0) return true
  return configured.byId.indexOf(splitModelKey(k).model) >= 0
}

export function metaInfo(store, extra = {}) {
  
  
  
  
  
  
  
  
  
  
  
  let reqCount = 0
  const models = new Set()
  let derived = false
  if (aggregatesReady(store)) {
    derived = true
    const sessions = store.sessions || {}
    for (const id of Object.keys(sessions)) {
      const ses = sessions[id]
      if (!ses || !ses.totals || !ses.totals.requests) continue
      reqCount += ses.totals.requests
      const ms = ses.models || {}
      
      
      
      for (const mk of Object.keys(ms)) if (mk) models.add(mk)
    }
  }
  if (!derived) {
    for (const id of Object.keys(store.requests)) reqCount += store.requests[id].length
    for (const id of Object.keys(store.requests)) for (const r of store.requests[id]) if (r.m) models.add(r.m)
  }
  const quar = store.quarantine || {}
  const quarantined = Object.keys(quar).map((id) => ({
    id, name: quar[id].name, message: quar[id].message,
    at: quar[id].at, hits: quar[id].hits || 1,
  })).sort((a, b) => (b.at || 0) - (a.at || 0))
  return {
    sessionsRoot: store.sessionsRoot || '', storeFile: store.storeFile || '',
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
    quarantined: quarantined.slice(0, QUARANTINE_REPORT_LIMIT),
    retention: (store.config && store.config.retention) || { days: 0 },
    hasCustomPrices: Object.keys((store.config && store.config.prices) || {}).length,
    ...extra,
  }
}






const csvEsc = (v) => {
  const s = String(v)
  return `"${(s && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`
}
export function exportCsv(store, range, from, to, flt, nowMs = Date.now()) {
  const { r, useAgg } = queryContext(store, range, from, to, flt, nowMs)
  const rows = []
  if (useAgg) {
    // 日×模型行恰好就是 day.models 的形状,直接按序输出
    const picks = modelPicks(flt)
    for (const dk of Object.keys(store.days).sort()) {
      if (!inDayRange(dk, r)) continue
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
    // (day, model) 在唯一键上构成全序,故直接整体排序即可 —— 原先先按 key 排序
    // 再整体排序,前一次是无用功(输出完全相同)。
    rows.push(...Object.values(rowMap))
    rows.sort((a, b) => a.day === b.day ? (a.model < b.model ? -1 : 1) : (a.day < b.day ? -1 : 1))
  }
  const head = ['date', 'model', 'miss', 'cache_read', 'cache_write', 'output', 'total', 'requests', 'cost_yuan', 'saved_yuan']
  const lines = [head.join(',')]
  for (const rw of rows) {
    lines.push([rw.day, csvEsc(rw.model), rw.miss, rw.read, rw.write, rw.out, tokenTotal(rw), rw.requests, rw.cost.toFixed(6), rw.saved.toFixed(6)].join(','))
  }
  return lines.join('\n')
}

/**
 * 导出超限错误。带上 statusCode,由 Host 路由翻成 413(而不是笼统的 500)——
 * 这是一个**可预期**的拒绝,不是内部故障,调用方据此可以给出"缩小范围"的指引。
 */
export class ExportTooLargeError extends Error {
  constructor(count, limit) {
    super(`导出命中 ${count} 条请求,超过上限 ${limit} 条。请缩小时间范围,或在设置里开启保留期(retention.days)控制库体积。`)
    this.name = 'ExportTooLargeError'
    this.statusCode = 413
    this.count = count
    this.limit = limit
  }
}

/**
 * 时间戳 → ISO 字符串,超出 Date 可表示范围时返回 null。
 *
 * `Number.isFinite` **不足以**保证 `new Date(t).toISOString()` 不抛:
 * Date 只覆盖 ±8.64e15 ms,而 1e18 是有限数。原实现只查 isFinite,于是
 * `exportJson` 在坏时间戳上抛 `RangeError: Invalid time value` —— 整个导出
 * 500,而调用方拿不到任何"缩小范围"的指引(见 ②C10 / V21 锁定)。
 */
function isoOf(ts) {
  if (!Number.isFinite(ts)) return null
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function exportJson(store, range, from, to, flt, nowMs = Date.now()) {
  // 逐请求导出**永远**走记录路径:聚合只有"日 × 模型"粒度,给不出逐请求明细
  flushAggregates(store)
  const f = flt || NO_FILTER()
  const r = dayRangeOf(range || 'all', from, to, nowMs)
  // 单遍扫描,边走边判上限:一旦超限立刻抛,最高只会分配 EXPORT_JSON_MAX_ROWS+1 个
  // 条目,永远不会走到 JSON.stringify 那一步(20 万条会拼出 68MB 字符串,那才是
  // 真正撑爆内存与卡死标签页的地方)。
  const out = []
  for (const id of Object.keys(store.requests)) {
    const list = store.requests[id]
    for (let i = 0; i < list.length; i++) {
      const rec = list[i]
      if (!inDayRange(dayKeyOf(rec.t), r)) continue
      if (!matchFilter(store, rec, id, f)) continue
      if (out.length >= EXPORT_JSON_MAX_ROWS) throw new ExportTooLargeError(out.length + 1, EXPORT_JSON_MAX_ROWS)
      const { provider, model } = splitModelKey(rec.m)
      out.push({
        session: id, seq: rec.seq, time: rec.t,
        // 坏时间戳(undefined/NaN/超出 Date 范围)不应让整个导出抛
        // RangeError:Invalid time value —— 见 isoOf 的说明。
        iso: isoOf(rec.t),
        provider, model,
        miss: rec.miss, cacheRead: rec.read, cacheWrite: rec.write, output: rec.out, reasoning: rec.r || 0,
        interrupted: rec.i ? 1 : 0, cumulativeInput: rec.cum || 0,
        costYuan: Number((rec.cost || 0).toFixed(6)), savedYuan: Number((rec.saved || 0).toFixed(6)),
      })
    }
  }
  return JSON.stringify({ exportedAt: new Date().toISOString(), range: { from: r.from, to: r.to }, count: out.length, requests: out }, null, 1)
}

// ---------------------------------------------------------------------------
// 配置
// patch 为部分补丁:未提及的字段保持不变
// (prices/budget/retention/peakHours/peakDays)。
//
// 0.8.9 移除 webPagePath:那条"把仪表盘换成任意 .html"的配置面只校验扩展名,
// 等于给本机任意进程开了一个"读取盘上任意 .html"的原语(UNC 路径还会触发对外 SMB
// 连接、外泄 NTLM 凭证)。仪表盘页面固定为包内 web/index.html。
// 老库里残留的 config.webPagePath 一律忽略,不做迁移也不因此判定库损坏。
// ---------------------------------------------------------------------------
/**
 * 清掉**已被移除**的配置键(0.9.4)。
 *
 * 为什么要有这一步:`webPagePath` 在 0.8.9 被移除后,写入侧已经 400 拒绝、读取侧
 * 也已经忽略 —— 行为一直是对的。但**老库里的那个值从未被删除**:它一直躺在
 * `$DSH_HOME/dsh-token/store.json` 的 `config` 里,而它的内容是一个**本机绝对路径**
 * (形如 `C:/Users/<name>/.dsh/profiles/web/node_modules/@fufuf-c/dsh-token/web/index.html`)。
 *
 * 两个实际代价:
 *   1. 目录结构/用户名会随 store.json 一起进入任何备份、issue 附件、截图或存储快照,
 *      而该字段早已不承载任何功能 —— 纯粹的泄漏面;
 *   2. 它会让 `configView()` 之外的人(手工读 store 的人)以为"换肤还能配",从而
 *      照着一个不存在的功能去调。
 *
 * 只在**写入路径**(applyConfigPatch)清理,不做启动时的隐式迁移:启动即改用户的
 * store 文件不符合本插件"配置是用户数据、只在用户动作或落盘时机写"的一贯纪律。
 * 用户任何一次改配置(改价、改时段、改保留期)都会顺手把它清掉。
 */
function purgeRemovedConfig(cfg) {
  // 只删这一个已知键,不做"白名单之外的都删" —— 那会让未来版本的配置在降级回本版
  // 时被抹掉,而 store 只需要向前兼容,不需要向后清理。
  if (Object.prototype.hasOwnProperty.call(cfg, 'webPagePath')) delete cfg.webPagePath
}

/**
 * 配置补丁的唯一入口:归一化 + 校验 + 标脏(不重建,见下方 markStale 的说明)。
 *
 * `purgeRemovedConfig` 在**每次写入**时顺手清掉已移除的键(见其说明)。
 */
export function applyConfigPatch(store, patch) {
  // 价格/时段/保留期的**改动前快照**(0.9.5)。只在真的变了的时候才推进配置世代号,
  // 否则"把 pageSec 从 60 改成 120"也会触发一次毫无必要的全库重折。
  const _before = pricingFingerprint(store)
  const _view = applyConfigPatchInner(store, patch)
  if (pricingFingerprint(store) !== _before) touchConfigEpoch()
  return _view
}

/** 价格指纹:只覆盖"会改变已落库记录 cost/saved 或改变扫描范围"的配置面。 */
function pricingFingerprint(store) {
  const c = (store && store.config) || {}
  return JSON.stringify([c.prices || null, c.peakHours || null, c.peakDays || null, (c.retention && c.retention.days) || 0])
}

function applyConfigPatchInner(store, patch) {
  const cfg = store.config || (store.config = emptyStore().config)
  if (!cfg.prices) cfg.prices = {}
  if (!cfg.retention) cfg.retention = { days: 0 }
  purgeRemovedConfig(cfg)
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
  // webPagePath 在 0.8.9 已移除:显式拒绝而不是静默忽略 —— 静默忽略会让调用方
  // 以为"换肤生效了",然后在页面上一直看到内置仪表盘,不知道发生了什么。
  if (patch.webPagePath !== undefined) {
    throw new Error('webPagePath 已在 0.8.9 移除:仪表盘页面固定为插件内置页')
  }
  if (patch.retention !== undefined) {
    const d = Number(patch.retention && patch.retention.days !== undefined ? patch.retention.days : patch.retention)
    if (!isFinite(d) || d < 0) throw new Error('retention.days must be a non-negative number')
    cfg.retention = { days: d }
  }
  // 自动刷新策略:只接受 pageSec / scanSec / onOpen 三个键。
  // **非法值必须抛错、不能静默忽略** —— 静默忽略会让调用方以为"设置生效了",
  // 而界面上显示的仍是旧值(页面用 POST 的返回体重绘),两者不一致且无从察觉。
  if (patch.refresh !== undefined) {
    if (patch.refresh === null) {
      // null = 恢复默认值(与 peakHours/peakDays 的约定一致)
      cfg.refresh = { ...DEFAULT_REFRESH }
    } else if (typeof patch.refresh !== 'object' || Array.isArray(patch.refresh)) {
      throw new Error('refresh 应为对象 { pageSec, scanSec, onOpen }')
    } else {
      const cur = refreshSettings(store)
      const next = { ...cur }
      const changed = []
      for (const k of ['pageSec', 'scanSec']) {
        if (patch.refresh[k] === undefined) continue
        const raw = patch.refresh[k]
        const b = REFRESH_BOUNDS[k]
        if (raw === null || raw === '') { next[k] = DEFAULT_REFRESH[k]; changed.push(k); continue }
        const n = Number(raw)
        if (!Number.isFinite(n) || n < 0) throw new Error(`refresh.${k} 应为不小于 0 的秒数(0 = 关闭)`)
        // 0 是"关闭"开关,不做下限钳制;非 0 才钳进 [min,max]。
        // 钳制而不是抛错:用户输入 3 秒时"给你 5 秒"比"报错让你重填"更可用,
        // 但**必须把钳制后的值回给页面**,否则界面显示 3 而实际是 5。
        next[k] = n === 0 ? 0 : Math.min(b.max, Math.max(b.min, Math.round(n)))
        changed.push(k)
      }
      if (patch.refresh.onOpen !== undefined) {
        if (patch.refresh.onOpen !== null && typeof patch.refresh.onOpen !== 'boolean') {
          throw new Error('refresh.onOpen 应为布尔值')
        }
        next.onOpen = patch.refresh.onOpen === null ? DEFAULT_REFRESH.onOpen : patch.refresh.onOpen
        changed.push('onOpen')
      }
      if (changed.length) cfg.refresh = next
    }
  }
  // 只标脏,不在这里重建(0.8.9 起这一步是 O(1):只写一个 WeakSet)。
  // 单价/时段/保留期都可能被设置页"点选即时生效"式地连续修改(24 个小时格 = 24 次
  // 请求),每次都全量重建是纯浪费。真正的重建推迟到下一次查询或落盘前
  // (flushAggregates),语义不变、成本从 N 次降到 1 次。
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
    retention: c.retention || { days: 0 },
    // refresh 是**归一化后**的值(缺字段/非法值已回退默认),页面拿它直接渲染控件;
    // defaults 一并给出,这样"恢复默认"按钮不必把默认值硬编码到前端。
    refresh: refreshSettings(store),
    defaultsRefresh: { ...DEFAULT_REFRESH },
    refreshBounds: { pageSec: { ...REFRESH_BOUNDS.pageSec }, scanSec: { ...REFRESH_BOUNDS.scanSec } },
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
  // sessions 也要查(0.8.9 补):rebuildAll 会往 sessions[id] 上写 .totals/.models,
  // 而 `{"sessions":{"a":"oops"}}` 能通过此前所有检查 —— 于是 loadStore 接受它,
  // 首次查询触发 rebuildAll 时抛 TypeError。旧实现里那次抛出还会**永久污染**
  // flushing(已由 try/finally 修掉),聚合从此静默冻结。拦住形态是更前面的一道门。
  if (s.sessions !== undefined) {
    if (typeof s.sessions !== 'object' || s.sessions === null || Array.isArray(s.sessions)) return false
    for (const id of Object.keys(s.sessions)) {
      const ses = s.sessions[id]
      if (!ses || typeof ses !== 'object' || Array.isArray(ses)) return false
    }
  }
  // config 的内层同样要拦:peakHours 若是个数字/字符串,isPeakHour 的 `for (const [a,b] of s.hours)`
  // 会抛 "s.hours is not iterable";prices 若是字符串,priceCacheFor 的 Object.keys 会拿到字符下标。
  // 这些都会在查询路径上炸成 500,而本该走的"隔离 + 从日志重建"不触发 —— 与上面 days 同理。
  if (s.config) {
    const c = s.config
    if (c.prices !== undefined && (typeof c.prices !== 'object' || c.prices === null || Array.isArray(c.prices))) return false
    if (c.peakHours !== undefined && !Array.isArray(c.peakHours)) return false
    if (c.peakDays !== undefined && !Array.isArray(c.peakDays)) return false
    if (c.retention !== undefined && (typeof c.retention !== 'object' || c.retention === null || Array.isArray(c.retention))) return false
    // refresh 内层也要看类型:refreshSettings 对 refresh 本身为字符串/数字是**容忍**的
    // (回退默认),所以这里不必拒绝 —— 但 refresh.pageSec 若被写成 `{}`,
    // Number({}) 是 NaN → 同样回退默认,也不会炸。唯一要拦的是 refresh 本身是数组
    // (数组也能挂属性,容易被误当成对象写进去,而它没有意义)。
    if (c.refresh !== undefined && Array.isArray(c.refresh)) return false
  }
  // 内层结构也要查:体检的职责是拦住"读取侧即将解引用"的形状。原先只判到
  // `days` 是不是 object,于是 `{days:{k:null}}` 能通过体检,却在
  // aggregatesReady/kpiQuery 里抛 "Cannot read properties of null (reading 'models')"
  // —— 每个 API 路由 500,而**本该走的"隔离 + 从日志重建"路径根本不触发**。
  // 查得浅,比不查更糟:它给人一种"已经验过了"的错觉。
  for (const group of ['days', 'months']) {
    const g = s[group]
    if (!g) continue
    for (const k of Object.keys(g)) {
      const bucket = g[k]
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return false
      if (bucket.totals !== undefined && (!bucket.totals || typeof bucket.totals !== 'object')) return false
      if (bucket.models !== undefined) {
        const ms = bucket.models
        if (!ms || typeof ms !== 'object' || Array.isArray(ms)) return false
        for (const mk of Object.keys(ms)) {
          if (!ms[mk] || typeof ms[mk] !== 'object' || Array.isArray(ms[mk])) return false
        }
      }
    }
  }
  return true
}

/**
 * 落盘紧凑编码(v7 起)
 *
 * 逐请求记录的定长列:seq, t, mi(模型表下标), miss, read, write, out, r, i
 * `cost/saved/priced/cum` **不入盘**:它们是 rebuildAll 的纯派生结果,载入后
 * 必然被重算(原实现把它们写进 store.json,实测占 requests 段的 32%)。
 *
 * v7 时 `mi` 指向**全库一张** modelTable;v8(0.9.1)起改为**每分片自带**一张表
 * (局部重写不会错位)。单文件形态(encodeStore)仍用一张表 —— 它是整份原子替换,
 * 不存在"表换了但记录没换"的窗口。
 */
const REC_COLS = 9

/**
 * 一行定长紧凑数组 → 记录对象。`resolveModel` 把模型下标还原成模型键。
 *
 * **派生槽位一并建出**(0.9.1 内存优化)。为什么:
 * `rebuildAll` 会往每条记录上写 `cum`/`cost`/`saved`/`priced`,若载入时只建 9 个字段,
 * 每个对象都要经历一次 9→13 的**隐藏类迁移**,迁移后的对象在 V8 里更占内存。
 * 同一载入路径 A/B 实测(20 万请求库):常驻堆 **67.6 MB → 56.6 MB**
 * (每请求 354 B → 297 B,**降 16.2%**),真实库 1.57 MB → 1.34 MB,而输出逐字节不变。
 *
 * 两个必须守住的细节:
 *   1. **属性顺序**:这 4 个值先置 `undefined`,而"给已存在的属性赋值"**不改变位置**,
 *      所以最终顺序与"先建 9 字段、再由 rebuildAll 依次追加"完全一致
 *      (`JSON.stringify` 的字节因此不变);
 *   2. 只对**紧凑数组行**这么做。v6 对象行(`decodeRowList` 里原样保留的那条路径)
 *      可能已有这些字段、且顺序各异,重建反而会改变其键顺序 —— 不动它。
 */
function rowToRecord(r, resolveModel) {
  return {
    seq: r[0] === null || r[0] === undefined ? undefined : r[0],
    t: r[1],
    m: resolveModel(r[2]),
    miss: r[3] || 0, read: r[4] || 0, write: r[5] || 0, out: r[6] || 0,
    r: r[7] || 0, i: r[8] || 0,
    // 派生槽位:rebuildAll 会写它们。这里先占位,避免隐藏类迁移(顺序见上)
    cum: undefined, cost: undefined, saved: undefined, priced: undefined,
  }
}

/**
 * 展开一组紧凑行 → 记录对象列表。**唯一的行展开实现**。
 *
 * 关键性质:**每个列表自带解析口径**(调用方传入的 `resolveModel`),因为 v8 起
 * 模型表是**每分片独立**的(见 splitStore 的说明)。全为对象行(v6)时整列表原样返回。
 */
function decodeRowList(list, resolveModel) {
  let needs = false
  for (let i = 0; i < list.length; i++) { if (Array.isArray(list[i])) { needs = true; break } }
  if (!needs) return list
  const out = new Array(list.length)
  for (let i = 0; i < list.length; i++) {
    const r = list[i]
    out[i] = Array.isArray(r) ? rowToRecord(r, resolveModel) : r // 混合形态:对象行原样保留
  }
  return out
}

/**
 * 内存 store → 落盘形态(纯函数,**不改动入参**)。
 *
 * 同时处理 `requests` 与 `sessions`:后者本身不大(占 store.json 的 3%),但仍
 * 参与"模型键内联"以保持口径一致 —— 它的 `models` 键也换成整数下标。
 *
 * 这是**单文件**落盘形态(一处写入、整份替换)。分片布局请用 splitStore ——
 * 两者的模型表口径不同,见 splitStore 的说明。
 */
export function encodeStore(store) {
  const modelTable = []
  const modelIndex = new Map()
  const internModel = (mk) => {
    let i = modelIndex.get(mk)
    if (i === undefined) { i = modelTable.length; modelIndex.set(mk, i); modelTable.push(mk) }
    return i
  }
  const requests = {}
  for (const id of Object.keys(store.requests || {})) {
    const list = store.requests[id] || []
    const out = new Array(list.length)
    for (let i = 0; i < list.length; i++) {
      const r = list[i]
      out[i] = [
        r.seq === undefined ? null : r.seq,
        r.t,
        internModel(r.m),
        r.miss, r.read, r.write, r.out,
        r.r || 0,
        r.i || 0,
      ]
    }
    requests[id] = out
  }
  // 按模型表把键换回整数下标(与 requests 共用同一张表)。
  // **用有序二元组数组**而不是 `{整数下标: totals}` 对象:JS 对象里"整数样式"
  // 的键会被 V8 按数值升序排列,丢掉插入顺序 —— 那样 sessions 的落盘字节每次
  // 往返都会变序(虽不影响语义,却让"内容未变则文件不变"不再成立,也让
  // 逐字节等价性验证无法进行)。数组显式保序。
  const sessions = {}
  for (const id of Object.keys(store.sessions || {})) {
    const ses = store.sessions[id]
    if (!ses || typeof ses !== 'object') { sessions[id] = ses; continue }
    const pairs = []
    for (const mk of Object.keys(ses.models || {})) pairs.push([internModel(mk), ses.models[mk]])
    sessions[id] = { ...ses, models: pairs }
  }
  return { ...store, requests, sessions, modelTable }
}

/**
 * 落盘形态 → 内存 store(纯函数,**原地展开传入对象**)。
 *
 * 自动识别记录形态:数组 = v7 紧凑编码,对象 = v6 及更早(原样保留)。
 * **因此 v6 库无需迁移脚本即可读入** —— 这是"升级不丢数据"的关键:
 * 老库读进来仍能用,只是下次落盘时会写成 v7。
 *
 * 两个**刻意的归一化**(生产路径不可观察,但必须写清楚而不是假装无损):
 *   1. 紧凑行缺列按 0 补齐。`foldSession` 恒给全 9 列,故正常路径无缺列;
 *      只有被外部截断/手改的库才会命中,那时按 0 比让整个库崩掉更合理。
 *   2. `r`(reasoningTokens)与 `i`(interrupted)在**原始记录缺失**时展开为 0
 *      而非 `undefined`。两者在全部读取侧都写 `r.r || 0` / `r.i ? 1 : 0`,
 *      因此 0 与 undefined 行为完全一致(已由逐字节查询等价性验证覆盖)。
 *
 * `requests` 与 `sessions` **各自独立判定**形态 —— 不能用"requests 里发现了
 * 数组行"当作 sessions 也需要展开的条件:空 requests 的库(全新安装)配上
 * v7 的 sessions 就会漏展开,导致 models 保持二元组数组、逐模型查询静默失效。
 */
export function decodeStore(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed
  const table = Array.isArray(parsed.modelTable) ? parsed.modelTable : []
  const resolveModel = (mi) => (typeof table[mi] === 'string' ? table[mi] : '')

  // ---- requests:v7 数组行 → 对象 ----
  // v7(0.9.0)的全局 modelTable 仍在这里生效,保证老库可读;v8 的分片表由 joinStore 展开。
  const requests = parsed.requests
  if (requests && typeof requests === 'object' && !Array.isArray(requests)) {
    for (const id of Object.keys(requests)) {
      const list = requests[id]
      if (!Array.isArray(list)) continue
      requests[id] = decodeRowList(list, resolveModel)
    }
  }

  // ---- sessions.models:二元组数组 → 对象(独立于 requests 判定)----
  const sessions = parsed.sessions
  if (sessions && typeof sessions === 'object' && !Array.isArray(sessions)) {
    for (const id of Object.keys(sessions)) {
      const ses = sessions[id]
      if (!ses || typeof ses !== 'object' || !ses.models) continue
      if (Array.isArray(ses.models)) {
        const models = {}
        for (const pair of ses.models) {
          if (!Array.isArray(pair)) continue
          models[resolveModel(pair[0]) || String(pair[0])] = pair[1]
        }
        ses.models = models
      } else if (typeof ses.models === 'object') {
        // v6 形态:字符串键本就正确,仅在模型表存在且键是数字时换回字符串
        const keys = Object.keys(ses.models)
        if (table.length && keys.length && keys.every((k) => /^\d+$/.test(k))) {
          const models = {}
          for (const k of keys) models[resolveModel(Number(k)) || k] = ses.models[k]
          ses.models = models
        }
      }
    }
  }
  return parsed
}

// ---------------------------------------------------------------------------
// 分片落盘(D1 · 0.9.0)
//
// 为什么分片:实测 20 万请求库的 store.json 里,`requests` 占 51%、`days`+`months`
// 占 23%、`sessions` 的派生部分(totals/models)占 25% —— 后两者共 **49% 是
// rebuildAll 的纯派生数据**,根本不必落盘。而 `requests` 天然按会话独立。
//
// 于是落盘拆成两块:
//   · store.json  —— 仅元数据(config/watermarks/quarantine/stats/会话 meta
//                    与首末时间戳/模型表),实测 35 KB;
//   · shards/*.json —— 每会话一个分片(紧凑行数组),合计约 10 MB。
//
// 收益:一轮扫描通常只改动少数会话 → 单轮写量 19.98 MB → **87 KB(降 99.6%)**;
// 且单会话损坏只影响那一个分片(载入时删其水位线,下一轮自动从日志重折)。
//
// 为什么 `sessions.meta` 必须留在 store.json 而 totals/models 可以丢:
// 标题来自会话事件,而增量扫描按 revision **跳过未变化会话** —— 丢了 meta
// 就再也没机会补回来(标题会永久变空)。totals/models 则由 rebuildAll 重算,安全。
// ---------------------------------------------------------------------------

/**
 * 一个会话的记录 → 分片编码(紧凑行 + **本分片自己的**模型表)。
 *
 * 单独抽出来是为了让落盘能**逐分片**编码:局部重写时只需编码脏分片,
 * 不必先把整库复制成紧凑行(20 万请求库实测那次复制要临时分配约 32 MB,
 * 而常态一轮只写 2 个会话、约 57 KB)。
 */
export function encodeShard(list) {
  const models = []
  const index = new Map()
  const intern = (mk) => {
    let i = index.get(mk)
    if (i === undefined) { i = models.length; index.set(mk, i); models.push(mk) }
    return i
  }
  const arr = list || []
  const rows = new Array(arr.length)
  for (let i = 0; i < arr.length; i++) {
    const r = arr[i]
    rows[i] = [
      r.seq === undefined ? null : r.seq,
      r.t,
      intern(r.m),
      r.miss, r.read, r.write, r.out,
      r.r || 0, r.i || 0,
    ]
  }
  return { models, rows }
}

/**
 * store 的**元数据部分**(不含 requests/days/months/全局模型表)—— 纯函数。
 *
 * 单独抽出来是为了落盘:meta 总是整体重写,而它与分片内容无关,
 * 不必为了写 meta 而先编码全部分片。
 */
export function storeMeta(store) {
  const sessions = {}
  // sessions 只保留**不可重建**的部分:meta 与首末时间戳。
  // totals/models 由 rebuildAll 重算(firstTs/lastTs 也重算,但保留可让
  // "还没重建就先看列表"的瞬间不至于空白;代价极小)。
  for (const id of Object.keys(store.sessions || {})) {
    const ses = store.sessions[id]
    if (!ses || typeof ses !== 'object') { sessions[id] = ses; continue }
    const { totals, models, ...keep } = ses
    void totals; void models
    sessions[id] = keep
  }
  // meta 不再携带全局 modelTable:没有任何读者需要它,而留着反而会诱使
  // 后来的实现"顺手复用全局表" —— 那正是本版修掉的错位根源。
  const { requests: _drop, days, months, modelTable: _mt, ...meta } = store
  void _drop; void days; void months; void _mt
  return { ...meta, sessions }
}

/**
 * 内存 store → { meta, shards }(纯函数)。
 *
 * `shards[id] = { models, rows }`,每个分片**自带模型表**;派生数据
 * (days/months/sessions.totals)**不入盘** —— 载入后由 rebuildAll 重建。
 *
 * 用途:整库一次性编码(测试、工具、以及需要整份快照的调用方)。
 * 生产落盘走 encodeShard/storeMeta 的**逐分片**路径,以免每次落盘都复制整库。
 */
export function splitStore(store) {
  // ⚠ 模型表必须是**每分片独立**的,不能共用一张全局表。
  //
  // 为什么(0.9.1 修):分片是**局部重写**的 —— writeStore 只重写脏分片,却会把
  // store.json 里的全局 modelTable **整体重写**。而 encodeStore 建表的顺序来自
  // `Object.keys(store.requests)`,载入分片时的顺序来自 `readdirSync` ——
  // 两者天然可能不同(首次写入按扫描完成顺序,载入按文件名顺序)。
  // 一旦不同,**未重写的分片里的 mi 下标就会指向新表里的另一个模型**:实测 4 个
  // 会话各用不同模型,只重折 1 个会话后重启,另外 3 个会话的模型全部被静默算错
  // (按模型统计、成本、页面模型列表一起错),且没有任何报错。
  //
  // 现在每个分片自带 `models` 表(只含该会话用到的模型,通常 1–3 个),
  // 于是"分片内容 + 它自己的表"构成自洽单元,与其它分片/写入顺序完全解耦。
  // 代价:每个分片多几十字节;换来的是局部重写在结构上不可能错位。
  const shards = {}
  for (const id of Object.keys(store.requests || {})) shards[id] = encodeShard(store.requests[id])
  return { meta: storeMeta(store), shards }
}

/**
 * { meta, shards } → 内存 store(纯函数)。
 *
 * `shards` 可以是 `{ id: rows }`、`{ id: {models, rows} }` 或磁盘形态
 * `[{ id, rows, models? }]`(文件名不可逆而 id 存在分片内容里)。
 *
 * **两种分片形态都要吃下**:
 *   · v8(0.9.1 起):分片自带 `models` 表,按**自己的**表解析 mi —— 局部重写不会错位;
 *   · v7(0.9.0):分片只有 `rows`,mi 指向 meta.modelTable(全局表)。老库照旧可读。
 * 两者可以混存(部分分片还没被重写过),因此**逐分片**判定,不设全局开关。
 *
 * `days`/`months` 一律给空对象,交给 rebuildAll —— 它们在磁盘上不存在,是**派生数据**。
 */
export function joinStore(meta, shards) {
  const requests = {}
  const globalTable = Array.isArray(meta && meta.modelTable) ? meta.modelTable : []
  const resolveGlobal = (mi) => (typeof globalTable[mi] === 'string' ? globalTable[mi] : '')

  const put = (id, entry) => {
    if (id === undefined) return
    // 形态 A:v8 分片对象 { models, rows } —— 用分片自己的表
    if (entry && !Array.isArray(entry) && typeof entry === 'object' && Array.isArray(entry.rows)) {
      const t = Array.isArray(entry.models) ? entry.models : []
      const resolve = (mi) => (typeof t[mi] === 'string' ? t[mi] : resolveGlobal(mi))
      requests[id] = decodeRowList(entry.rows, resolve)
      return
    }
    // 形态 B:v7 分片或裸行数组 —— mi 指向 meta 的全局表
    const rows = Array.isArray(entry) ? entry : (entry && entry.rows) || []
    requests[id] = decodeRowList(rows, resolveGlobal)
  }

  if (Array.isArray(shards)) {
    for (const s of shards) { if (s && s.id !== undefined) put(s.id, s) }
  } else if (shards && typeof shards === 'object') {
    for (const id of Object.keys(shards)) put(id, shards[id])
  }
  return decodeStore({
    ...(meta || {}),
    requests,
    days: (meta && meta.days) || {},
    months: (meta && meta.months) || {},
    // requests 已就地展开,不能再让 decodeStore 拿全局表二次解析(它会看到对象行而跳过,
    // 但显式去掉更清楚:分片库的模型解析**已经完成**)
    modelTable: undefined,
  })
}

/**
 * **异步**读入分片库(0.9.4)。
 *
 * 为什么单独有它:0.9.3 及以前,冷启动是一段**同步**循环 —— `readdirSync` +
 * 逐分片 `readFileSync` + `JSON.parse`。实测 400 会话 / 200k 请求库:
 * 400 次读 + 解析共 **约 103 ms**,全程独占事件循环。而 DSH 的宿主半区与所有插件
 * 共用同一个 Node 进程,这 100 ms 里宿主的 HTTP 请求(以及别的插件)一起卡住。
 *
 * 两条改动:
 *   1. IO 全部走异步(`port.readDir` / `port.readFile`),让出事件循环;
 *   2. 并发上限(默认 8)—— 无上限会让数千分片同时打开数千个文件描述符,
 *      在 Windows 上尤其容易撞到句柄压力;8 路足够把等待时间压到磁盘的极限附近。
 *
 * **core 不认识 fs**:真正的读写由调用方以 `port` 传入(Host 半区注入 fs.promises)。
 * 这样"分片怎么解析"仍然只有一处定义,而"字节从哪来"仍留在 Host 层 —— 与本文件
 * "纯数据层"的定位一致(core 不认识文件系统,也不认识 Cordis)。
 *
 * 单分片损坏只影响它自己:调 `port.onShardError(file, err)` 记录,其余照常载入,
 * 与同步路径的容错语义一致(见 Host 的 loadStore)。
 */
export async function loadShardsAsync(meta, files, port, { concurrency = 8 } = {}) {
  const out = []
  let idx = 0
  let errorCount = 0
  let legacyCount = 0
  const worker = async () => {
    while (idx < files.length) {
      const file = files[idx++]
      try {
        const text = await port.readFile(file)
        let s = null
        try { s = JSON.parse(text) } catch (e) {
          // JSON 坏掉也要走 onShardError:否则一个坏分片会**静默消失**,
          // 调用方的日志里只看到总数少了一个,无从知道是哪一个、为什么。
          errorCount++
          if (port.onShardError) port.onShardError(file, e)
          continue
        }
        if (s && typeof s === 'object' && typeof s.id === 'string') {
          out.push(s)
          // v7 老分片(没有自带 models 表):必须整批重写一次,否则它们的 mi 会失去
          // 解析依据 —— meta 下次落盘就是新格式,不再带全局 modelTable。见 splitStore。
          if (!Array.isArray(s.models)) legacyCount++
        } else {
          errorCount++
          if (port.onShardError) port.onShardError(file, new Error('shard missing string id'))
        }
      } catch (e) {
        errorCount++
        if (port.onShardError) port.onShardError(file, e)
      }
    }
  }
  const workers = []
  for (let w = 0; w < Math.min(concurrency, files.length); w++) workers.push(worker())
  await Promise.all(workers)
  return { store: joinStore(meta, out), shardCount: out.length, errorCount, legacyCount }
}

/**
 * 分片脏标记(非枚举,不落盘)。
 *
 * `null` = **未知**(刚从单文件库载入,磁盘上没有分片)→ 下一次落盘写全部分片;
 * `Set`   = 只有其中 id 需要重写(扫描重折 / 修剪 / 删除时由 session-source 标记)。
 * 载入**分片库**后应显式置空集:那时磁盘与内存一致,一次配置变更不该触发
 * 全量重写(实测那会白写 10 MB)。
 */
export function markShardsDirty(store, ids) {
  if (!store) return
  let d = store.__dirtyShards
  if (!(d instanceof Set)) {
    // 从"未知"变成"已知脏":取并集语义无法表达,退化为"全部重写"更安全
    Object.defineProperty(store, '__dirtyShards', { value: null, enumerable: false, writable: true, configurable: true })
    d = null
  }
  if (d === null) return // 已经是"全部重写",无需记录具体 id
  for (const id of (Array.isArray(ids) ? ids : [ids])) d.add(id)
}
/** 当前脏分片集合:`null` 表示"未知,全部重写"。 */
export function dirtyShardsOf(store) {
  const d = store && store.__dirtyShards
  return d instanceof Set ? d : null
}
/** 设定脏分片集合(载入分片库后置空集;载入单文件库后置 null)。 */
export function setDirtyShards(store, set) {
  if (!store) return
  Object.defineProperty(store, '__dirtyShards', { value: set, enumerable: false, writable: true, configurable: true })
}

export function emptyStore() {
  return {
    version: STORE_VERSION,
    updatedAt: 0,
    sessionsRoot: '',
    storeFile: '',
    config: {
      prices: {}, budget: { monthly: 0 }, retention: { days: 0 },
      // 不写 refresh:空库由 refreshSettings 回退默认,少一个"默认值写两份"的漂移点
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
    case 'sessions': {
      // 分页元信息**按需**给出(0.9.4):
      //   默认(不带 `meta=1`)返回体仍是**数组**,键名与形状与 0.9.3 完全一致 ——
      //     页面、面板、脚本都不必改一个字;
      //   带 `meta=1` 时改为 `{ sessions: [...], total, limit, offset, hasMore }`,
      //     让调用方能分辨"一共 400 个"与"一共 5 万个但我只看到 500 个"。
      // 之所以不无条件改形状:返回类型从数组变成包装对象会让所有既有调用方静默拿到
      // `undefined.map`/`undefined.forEach` —— 那是最难定位的一类破坏。
      const wantMeta = query.meta === '1' || query.meta === 'true'
      if (!wantMeta) return jsonOk(sessionsQuery(store, query.sort, query.limit, query.range, query.from, query.to, flt, ctx.nowMs))
      const info = {}
      const off = Number(query.offset)
      if (Number.isFinite(off) && off > 0) info.offset = off
      const list = sessionsQuery(store, query.sort, query.limit, query.range, query.from, query.to, flt, ctx.nowMs, info)
      return jsonOk({ sessions: list, total: info.total, limit: info.limit, offset: info.offset, hasMore: info.hasMore })
    }
    case 'session': {
      // 未知会话 id 必须给 404,而不是 200 + null:调用侧(页面/面板/curl)无法把
      // "200 的空 body" 与"这个会话真的没有数据"区分开,只能各自猜。
      const detail = sessionDetailQuery(store, query.id || '', { brief: !!query.brief })
      if (detail === null) return { status: 404, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ error: 'session not found', id: query.id || '' }) }
      return jsonOk(detail)
    }
    case 'meta': return jsonOk(metaInfo(store, ctx.metaExtra || {}))
    case 'config': return jsonOk(configView(store))
    case 'export.csv': {
      const csv = exportCsv(store, query.range, query.from, query.to, flt, ctx.nowMs)
      return { status: 200, contentType: 'text/csv; charset=utf-8', body: csv, headers: { 'Content-Disposition': 'attachment; filename="dsh-token-daily-model.csv"' } }
    }
    case 'export.json': {
      // 超限时给 413 + 可读原因(见 ExportTooLargeError),而不是让异常冒泡成 500 ——
      // 那是可预期的拒绝,不是内部故障。
      let js
      try { js = exportJson(store, query.range, query.from, query.to, flt, ctx.nowMs) }
      catch (e) {
        if (e && e.name === 'ExportTooLargeError') {
          return { status: e.statusCode, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ error: e.message, count: e.count, limit: e.limit }) }
        }
        throw e
      }
      return { status: 200, contentType: 'application/json; charset=utf-8', body: js, headers: { 'Content-Disposition': 'attachment; filename="dsh-token-requests.json"' } }
    }
    default: return { status: 404, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ error: 'unknown api' }) }
  }
}
function jsonOk(data) { return { status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(data) } }
