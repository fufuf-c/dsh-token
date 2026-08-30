/**
 * dsh-token — 数据层核心(纯函数,零依赖)
 *
 * 输入一个 store 对象,sync 输出聚合/查询结果。不接触文件系统、不依赖 Cordis,
 * 因此可被单元测试、dev-server 与正式的 Host 插件外壳共同复用。
 *
 * v3 查询设计:rebuildAll 维护 day/month 聚合(含逐模型明细与逐日会话索引),
 * 无 session/wd 筛选的查询直接读聚合,复杂度 O(天数);带 session/wd 筛选或
 * 聚合尚未重建(旧 store)时回退逐记录扫描 eachWithin,复杂度 O(请求数)。
 * 两条路径输出等价,由单测(deepEqual 容差比较)保证。
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
export const pad2 = (n) => String(n).padStart(2, '0')
export const dayKeyOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
export const monthKeyOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}` }
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))
/** 截断到 n 个码点(而非 UTF-16 码元),避免把 emoji 等代理对切成孤立半边 */
const clipCP = (s, n) => Array.from(String(s)).slice(0, n).join('')

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
// 价格族(¥/1M tokens;可在 store.config.prices 按 provider:model 精确覆盖)
// ---------------------------------------------------------------------------
export const PRICE_FAMILIES = [
  { key: 'deepseek', label: 'DeepSeek 官方默认价', miss: 2, hit: 0.5, write: 0, output: 8, note: '¥/1M tokens;缓存写入按 0 计(如需按官方价目补上,可在单价表覆盖)' },
  { key: 'deepseek-relay', label: 'DeepSeek 系模型(按官方价估算)', miss: 2, hit: 0.5, write: 0, output: 8, note: '按模型名推断,仅供参考' },
]
export function defaultPrice(provider, model) {
  const p = String(provider || ''), m = String(model || '')
  if (p === 'deepseek-official') return PRICE_FAMILIES[0]
  if (/deepseek-v4-(flash|pro)|DeepSeek-V4|deepseek-chat|deepseek-reasoner/.test(m)) return PRICE_FAMILIES[1]
  return null
}
export function priceOf(store, provider, model) {
  const cfg = (store && store.config && store.config.prices) || null
  if (cfg) {
    const key = `${provider || ''}:${model || ''}`
    const ov = cfg[key]
    if (ov && Number(ov.miss) >= 0) {
      return { key: 'custom', label: `自定义(${key})`, miss: Number(ov.miss), hit: Number(ov.hit || 0), write: Number(ov.write || 0), output: Number(ov.output || 0), note: '自定义' }
    }
  }
  return defaultPrice(provider, model)
}
export function computeCost(price, r) {
  return {
    cost: (r.miss * price.miss + r.read * price.hit + r.write * price.write + r.out * price.output) / 1e6,
    saved: (r.read * (price.miss - price.hit)) / 1e6,
    priced: true,
  }
}
export function costOf(store, r) {
  const idx = r.m.indexOf(':')
  const provider = idx >= 0 ? r.m.slice(0, idx) : ''
  const model = idx >= 0 ? r.m.slice(idx + 1) : r.m
  const price = priceOf(store, provider, model)
  if (!price) return { cost: 0, saved: 0, priced: false }
  return computeCost(price, r)
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
export function newTotals() { return { miss: 0, read: 0, write: 0, out: 0, requests: 0, cost: 0, saved: 0 } }
export function aggregate(total, r) {
  total.miss += r.miss; total.read += r.read; total.write += r.write; total.out += r.out
  total.requests += 1; total.cost += r.cost || 0; total.saved += r.saved || 0
  return total
}
/** totals 形状相加(dst ← src),用于聚合快路径合并 day/month 桶 */
export function addTotals(dst, src) {
  dst.miss += src.miss; dst.read += src.read; dst.write += src.write; dst.out += src.out
  dst.requests += src.requests; dst.cost += src.cost; dst.saved += src.saved
  return dst
}

// ---------------------------------------------------------------------------
// 聚合就绪标记:days 是否为 v3 形状(逐模型带逐会话索引)。
// 旧 v2 store 或尚未 rebuild 的 store 返回 false,查询自动回退逐记录路径。
// ---------------------------------------------------------------------------
const AGG_READY = new WeakMap()
export function aggregatesReady(store) {
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
      // 两种 provider 口径:
      //  A. inputTokens 已含缓存(如 Anthropic)→ miss = input - read - write
      //  B. inputTokens 不含缓存(如 DeepSeek 大命中场景 input=656/read=12800)
      //     → 相减为负,此时 miss 直接取 input 本身
      const miss = input - read - write >= 0 ? input - read - write : input
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
  const days = {}, months = {}
  const priceCache = {} // 模型键 → 价格对象,避免逐条记录跑正则推断
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
        r.cost = (r.miss * price.miss + r.read * price.hit + r.write * price.write + r.out * price.output) / 1e6
        r.saved = (r.read * (price.miss - price.hit)) / 1e6
        r.priced = 1
      } else { r.cost = 0; r.saved = 0; r.priced = 0 }
      const dt = new Date(r.t)
      const dayK = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`
      const monthK = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}`
      const hourK = String(dt.getHours())
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
  const r = dayRangeOf(range || 'all', from, to, nowMs)
  const useAgg = !flt.sessionId && !flt.wd && aggregatesReady(store)
  let totals, models, dayTok, active
  if (useAgg) {
    // 快路径:直接累加 day 聚合(逐模型桶天然支持模型筛选)
    const picks = flt.modelSet ? Array.from(flt.modelSet) : null
    totals = newTotals(); models = {}; dayTok = {}; active = new Set()
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
        }
      } else {
        addTotals(totals, day.totals)
        dayTok[dk] = day.totals.miss + day.totals.read + day.totals.write + day.totals.out
        for (const mk of Object.keys(day.models)) {
          let mm = models[mk]; if (!mm) mm = models[mk] = newTotals()
          addTotals(mm, day.models[mk])
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
      const dk = dayKeyOf(it.r.t)
      dayTok[dk] = (dayTok[dk] || 0) + it.r.miss + it.r.read + it.r.write + it.r.out
    }
  }
  let peakDay = null, peakTokens = -1
  for (const dk of Object.keys(dayTok)) if (dayTok[dk] > peakTokens) { peakTokens = dayTok[dk]; peakDay = dk }
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
  let streak = 0
  for (let i = 0; i < 3700; i++) {
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
    totals: { miss: totals.miss, read: totals.read, write: totals.write, out: totals.out, total: totals.miss + totals.read + totals.write + totals.out, requests: totals.requests, cost: totals.cost, saved: totals.saved },
    hitRate, activeSessions: active.size,
    peakDay: { day: peakDay, tokens: peakTokens },
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
    const b = buckets[new Date(it.r.t).getHours()]
    if (b) aggregate(b.totals, it.r)
  }
  return buckets
}

export function heatmapQuery(store, months, flt, nowMs = Date.now()) {
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

export function sessionDetailQuery(store, id) {
  const ses = store.sessions[id]
  if (!ses) return null
  const list = store.requests[id] || []
  const models = {}
  let anomalies = 0
  const flags = []
  const deltas = []
  for (let i = 0; i < list.length; i++) {
    const r = list[i]
    const m = models[r.m] || (models[r.m] = newTotals()); aggregate(m, r)
    const prev = i > 0 ? list[i - 1].cum : 0
    deltas.push(r.cum - prev)
  }
  const sorted = deltas.slice(1).sort((a, b) => a - b)
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
  const thresh = Math.max(150000, 2.5 * median)
  for (let i = 0; i < list.length; i++) {
    let f = 0
    if (i > 0 && deltas[i] > thresh) { f = 1; anomalies++ }
    else if (list[i].i) f = 2
    flags.push(f)
  }
  const modelsArr = Object.keys(models).map((mk) => {
    const idx = mk.indexOf(':')
    return { key: mk, provider: idx >= 0 ? mk.slice(0, idx) : '', model: idx >= 0 ? mk.slice(idx + 1) : mk, totals: models[mk] }
  }).sort((a, b) => (b.totals.miss + b.totals.read + b.totals.write + b.totals.out) - (a.totals.miss + a.totals.read + a.totals.write + a.totals.out))
  return { id, meta: ses.meta || { id }, totals: ses.totals, models: modelsArr, requests: list, requestCount: list.length, anomalies, flagged: anomalies >= 2, flags }
}

export function metaInfo(store, extra = {}) {
  let reqCount = 0
  for (const id of Object.keys(store.requests)) reqCount += store.requests[id].length
  const models = new Set()
  for (const id of Object.keys(store.requests)) for (const r of store.requests[id]) if (r.m) models.add(r.m)
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
// patch 为部分补丁:未提及的字段保持不变(prices/budget/webPagePath/retention)。
// ---------------------------------------------------------------------------
export function applyConfigPatch(store, patch) {
  const cfg = store.config || (store.config = { prices: {}, budget: { monthly: 0 }, webPagePath: '', retention: { days: 0 } })
  if (!cfg.prices) cfg.prices = {}
  if (!cfg.retention) cfg.retention = { days: 0 }
  if (patch.resetPrices || patch.prices === null) cfg.prices = {}
  if (patch.prices && typeof patch.prices === 'object') {
    const p = patch.prices
    for (const k of Object.keys(p)) {
      const v = p[k]
      if (v === null || (typeof v === 'object' && !Object.keys(v).length)) delete cfg.prices[k]
      else {
        const e = { miss: Number(v.miss), hit: Number(v.hit || 0), write: Number(v.write || 0), output: Number(v.output || 0) }
        if (!isFinite(e.miss) || e.miss < 0) continue
        cfg.prices[k] = e
      }
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
  rebuildAll(store)
  return { prices: cfg.prices, budget: cfg.budget, webPagePath: cfg.webPagePath, retention: cfg.retention }
}

// ---------------------------------------------------------------------------
// 增量扫描(需要注入 persistence 服务:listSnapshots / readFrom / locate)
// 对未变化会话按 revision 跳过;变化会话整段重折(保证模型归属正确)。
// 无变化时跳过整库重建(dirty=false),由调用方决定是否落盘。
// retention.days > 0 时同步修剪超龄原始记录,防止内存/store.json 无界增长。
// ---------------------------------------------------------------------------
export async function scanStore(store, persistence, { force = false, concurrency = 4, logger = null, nowMs = Date.now() } = {}) {
  const log = (...a) => { if (logger) logger(...a) }
  const t0 = nowMs
  const snaps = await persistence.listSnapshots()
  const seen = new Set()
  for (const s of snaps) seen.add(s.header.id)
  let removed = 0
  const gone = new Set()
  for (const id of Object.keys(store.watermarks)) if (!seen.has(id)) gone.add(id)
  for (const id of Object.keys(store.requests)) if (!seen.has(id)) gone.add(id)
  for (const id of gone) {
    delete store.watermarks[id]
    if (store.requests[id]) { delete store.requests[id]; delete store.sessions[id] }
    removed++
  }
  let changed
  if (force) changed = snaps.slice()
  else {
    changed = []
    for (const s of snaps) {
      const wm = store.watermarks[s.header.id]
      if (!wm || wm.rev !== String(s.revision)) changed.push(s)
    }
  }
  let scanned = 0, failed = 0, newReqs = 0, idx = 0
  async function worker() {
    while (idx < changed.length) {
      const s = changed[idx++]
      scanned++
      try {
        const res = await persistence.readFrom(s.header.id, 0)
        const events = (res && res.events) || []
        const meta = (res && res.meta) || s.header
        const info = extractSessionInfo(events)
        ensureSessionMeta(store, s.header.id, meta, persistence, info)
        store.requests[s.header.id] = foldSession(events)
        newReqs += store.requests[s.header.id].length
        store.watermarks[s.header.id] = { rev: String(s.revision) }
      } catch (e) { failed++; log(`[dsh-token] scan failed for session ${s.header.id}:`, String(e)) }
    }
  }
  const workers = []
  for (let w = 0; w < Math.min(concurrency, changed.length); w++) workers.push(worker())
  await Promise.all(workers)
  let pruned = 0
  const retentionDays = (store.config && Number(store.config.retention && store.config.retention.days)) || 0
  if (retentionDays > 0) {
    const cutoff = nowMs - retentionDays * 86400000
    for (const id of Object.keys(store.requests)) {
      const list = store.requests[id]
      const keep = list.filter((r) => r.t >= cutoff)
      if (keep.length === list.length) continue
      pruned += list.length - keep.length
      if (keep.length) store.requests[id] = keep
      else { delete store.requests[id]; delete store.sessions[id] }
    }
  }
  const dirty = !!(force || changed.length || removed || pruned)
  if (dirty || !aggregatesReady(store)) rebuildAll(store)
  store.updatedAt = Date.now()
  const st = store.stats
  if (force || st.fullScans === 0) st.fullScans += 1
  else st.incrementalScans += 1
  // scannedFiles / newRequests 为累计值;最近一次扫描明细见 lastSummary
  st.scannedFiles += scanned; st.newRequests += newReqs; st.failedSessions += failed
  st.lastScanAt = Date.now(); st.lastScanMs = Date.now() - t0; st.sessionsTotal = snaps.length
  const summary = { ok: true, scanned, changed: changed.length, newRequests: newReqs, failed, pruned, removed, totalSessions: snaps.length, durationMs: st.lastScanMs, dirty, forced: !!force }
  st.lastSummary = summary
  return summary
}

function ensureSessionMeta(store, id, meta, persistence, info) {
  let ses = store.sessions[id]
  if (!ses) { ses = { meta: null, totals: newTotals(), models: {}, firstTs: null, lastTs: null }; store.sessions[id] = ses }
  if (!ses.meta && meta) {
    let workspace = ''
    try {
      if (meta && meta.cwd) workspace = String(meta.cwd).split(/[\\/]+/).filter(Boolean).pop() || ''
      if (!workspace) {
        const loc = persistence.locate(meta)
        if (loc && loc.path) {
          const p = String(loc.path).split(/[\\/]+/).filter(Boolean)
          if (p.length >= 3) workspace = p[p.length - 3]
        }
      }
    } catch (e) { /* ignore */ }
    ses.meta = {
      id: meta.id || id, createdAt: meta.createdAt || null, cwd: meta.cwd || null,
      parentSession: meta.parentSession || null, origin: meta.origin || null,
      delegationDepth: meta.delegationDepth || null, agentPreset: meta.agentPreset || null,
      workspace,
      title: (info && info.title) || null, titleKind: (info && info.titleKind) || null,
    }
  } else if (ses.meta && info) {
    // 老会话补标题(增量扫描 / 旧 store 升级)
    if (!ses.meta.title && info.title) { ses.meta.title = info.title; ses.meta.titleKind = info.titleKind }
    if (!ses.meta.workspace && ses.meta.cwd) ses.meta.workspace = String(ses.meta.cwd).split(/[\\/]+/).filter(Boolean).pop() || ''
  }
}

export function emptyStore() {
  return {
    version: 3,
    updatedAt: 0,
    sessionsRoot: '',
    storeFile: '',
    config: { prices: {}, budget: { monthly: 0 }, webPagePath: '', retention: { days: 0 } },
    watermarks: {},
    sessions: {},
    days: {},
    months: {},
    requests: {},
    stats: { fullScans: 0, incrementalScans: 0, scannedFiles: 0, newRequests: 0, failedSessions: 0, lastScanAt: 0, lastScanMs: 0, lastSummary: null },
  }
}

// ---------------------------------------------------------------------------
// REST 分发(供 webServer 路由与 dev-server 共用)
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
    case 'session': return jsonOk(sessionDetailQuery(store, query.id || ''))
    case 'meta': return jsonOk(metaInfo(store, ctx.metaExtra || {}))
    case 'config': return jsonOk({ prices: store.config.prices, budget: store.config.budget, webPagePath: store.config.webPagePath, retention: store.config.retention })
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
