/**
 * dsh-token — 会话日志读取与扫描层(需要注入 sessionPersistence 服务)
 *
 * 与 `core.mjs` 的分工:`core.mjs` 是**纯数据层**(store 进、结果出,不碰文件也不认识
 * Cordis 服务),本文件是**唯一需要宿主服务**的一层 —— sessionPersistence 的新旧两代
 * API 适配、增量水位线、失败会话隔离、retention 修剪都在这里。
 *
 * Host 外壳(lib/index.js)只从本文件取 `scanStore`;查询与聚合一律经 core.mjs。
 * 反向依赖为零:本文件 import core,core 不认识本文件。
 */
import {
  STORE_VERSION, newTotals, foldSession, extractSessionInfo, defineLazyCost,
  rebuildAll, aggregatesReady, flushAggregates, clipCP,
} from './core.mjs'

// ---------------------------------------------------------------------------
// 扫描失败隔离策略
// ---------------------------------------------------------------------------
/** 确定性失败会话的隔离冷却:窗口内不重复解码;窗口后自动重试一次。 */
export const QUARANTINE_RETRY_MS = 24 * 60 * 60 * 1000
/**
 * 与内容相关、重扫不会自愈的失败。宿主拒绝迁移老格式(v0 里出现插件注入的
 * 非标准成员)、或日志本身损坏时,每轮周期扫描都重试纯属浪费。
 * 其它错误(IO 抖动、写租约冲突)是瞬时的,必须留在重试路径上。
 */
const PERMANENT_SCAN_ERRORS = new Set(['SessionFormatUnsupportedError', 'SessionPersistenceCorruptionError'])
export function isPermanentScanError(e) {
  return !!(e && typeof e.name === 'string' && PERMANENT_SCAN_ERRORS.has(e.name))
}

// ---------------------------------------------------------------------------
// sessionPersistence 跨版本适配层
//
// DSH 0.1.5-rc.2 把持久化服务从「按 id 直读」改写为「句柄式」://   旧(≤0.1.4):  persistence.listSnapshots() / persistence.readFrom(id, 0)
//                 → { events, meta }
//   新(≥0.1.5):  persistence.list() / persistence.open(id, 'read')
//                 → handle.read(0) → { eventState, events }
//                 → handle.header(不可变 SessionHeader)、handle.close()
//
// 两代 API 在 store 关心的信息上完全等价:快照仍是 { header, revision },
// 事件仍是同一份 SessionEvent 序列。因此这里按**能力探测**适配,而不是比较
// DSH 版本号 —— 插件不需要知道宿主的版本字符串,新旧宿主都能跑。
//
// locate(meta) 从未进入 0.1.5 的抽象契约,但 jsonl 后端一直保留它;它只用于
// 兜底推导工作区名,缺失时降级为空即可(已由调用侧 try/catch 包裹)。
// ---------------------------------------------------------------------------
export function listSnapshotsOf(persistence) {
  if (typeof persistence.list === 'function') return persistence.list()
  if (typeof persistence.listSnapshots === 'function') return persistence.listSnapshots()
  throw new Error('sessionPersistence exposes neither list() nor listSnapshots()')
}

/**
 * 读一个会话的完整事件日志,屏蔽新旧两代读取 API。
 * 新 API 的读句柄必须在 finally 中关闭,否则会泄漏每会话的租约/解码缓存。
 */
export async function readSessionEvents(persistence, id) {
  if (typeof persistence.open === 'function') {
    const handle = await persistence.open(id, 'read')
    try {
      const res = await handle.read(0)
      return { events: (res && res.events) || [], meta: handle.header || null }
    } finally {
      try { await handle.close() } catch (e) { /* 已释放:忽略 */ }
    }
  }
  if (typeof persistence.readFrom === 'function') {
    const res = await persistence.readFrom(id, 0)
    return { events: (res && res.events) || [], meta: (res && res.meta) || null }
  }
  throw new Error('sessionPersistence exposes neither open() nor readFrom()')
}

// ---------------------------------------------------------------------------
// 增量扫描(需要注入 persistence 服务,经上面的适配层访问)
// 对未变化会话按 revision 跳过;变化会话整段重折(保证模型归属正确)。
// 无变化时跳过整库重建(dirty=false),由调用方决定是否落盘。
// retention.days > 0 时同步修剪超龄原始记录,防止内存/store.json 无界增长。
// ---------------------------------------------------------------------------
export async function scanStore(store, persistence, { force = false, concurrency = 4, logger = null, nowMs = Date.now() } = {}) {
  const log = (...a) => { if (logger) logger(...a) }
  const t0 = nowMs
  const snaps = await listSnapshotsOf(persistence)
  const seen = new Set()
  for (const s of snaps) seen.add(s.header.id)
  const quar = store.quarantine || (store.quarantine = {})
  let removed = 0
  const gone = new Set()
  for (const id of Object.keys(store.watermarks)) if (!seen.has(id)) gone.add(id)
  for (const id of Object.keys(store.requests)) if (!seen.has(id)) gone.add(id)
  for (const id of Object.keys(quar)) if (!seen.has(id)) gone.add(id)
  for (const id of gone) {
    delete store.watermarks[id]
    delete quar[id]
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
  // 确定性失败(格式被宿主拒绝、日志损坏)不会因重扫而自愈:同一 revision 在
  // 冷却窗口内直接跳过,否则每轮 5 分钟周期扫描都要把这些会话整段解码一遍。
  // force 全量扫描忽略隔离,给用户/升级后一个显式重试出口。
  const quarantinedNow = (s) => {
    if (force) return false
    const q = quar[s.header.id]
    if (!q || q.rev !== String(s.revision)) return false
    return (nowMs - q.at) < QUARANTINE_RETRY_MS
  }
  let scanned = 0, failed = 0, newReqs = 0, idx = 0, skipped = 0
  async function worker() {
    while (idx < changed.length) {
      const s = changed[idx++]
      if (quarantinedNow(s)) { skipped++; continue }
      scanned++
      try {
        const res = await readSessionEvents(persistence, s.header.id)
        const events = res.events || []
        const meta = res.meta || s.header
        const info = extractSessionInfo(events)
        ensureSessionMeta(store, s.header.id, meta, persistence, info)
        // 折叠出的记录挂惰性成本访问器:配置变更后第一次读 cost 也能拿到新价,
        // 不必在 applyConfigPatch 里无条件全量重建(见 defineLazyCost)。
        store.requests[s.header.id] = foldSession(events).map((r) => defineLazyCost(r, store))
        newReqs += store.requests[s.header.id].length
        store.watermarks[s.header.id] = { rev: String(s.revision) }
        if (quar[s.header.id]) delete quar[s.header.id]
      } catch (e) {
        failed++
        // 读取失败时**刻意保留**该会话上一次成功折叠的记录:老日志被宿主新版本
        // 拒绝迁移时(实测本机 18 个 v0 会话、549 条记录),数据仍在仪表盘里,
        // 只是无法再更新。整段丢弃等于把用户历史静默清零,比"冻结"糟得多。
        // 记录只在会话从 list() 消失(或 retention 修剪干净)时才删除。
        if (isPermanentScanError(e)) {
          const prev = quar[s.header.id]
          quar[s.header.id] = {
            rev: String(s.revision), name: String((e && e.name) || 'Error'),
            message: clipCP(String((e && e.message) || e), 240),
            at: nowMs, hits: ((prev && prev.hits) || 0) + 1,
          }
        }
        log(`[dsh-token] scan failed for session ${s.header.id}:`, String(e))
      }
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
  // dirty 只按「实际做过的重折」判定:被隔离跳过的候选不产生新数据,
  // 若按 changed.length 判定,每轮周期扫描都会白重建聚合 + 白写盘。
  const dirty = !!(force || scanned || removed || pruned)
  if (dirty || !aggregatesReady(store)) rebuildAll(store)
  store.updatedAt = Date.now()
  const st = store.stats
  if (force || st.fullScans === 0) st.fullScans += 1
  else st.incrementalScans += 1
  // scannedFiles / newRequests 为累计值;最近一次扫描明细见 lastSummary
  st.scannedFiles += scanned; st.newRequests += newReqs; st.failedSessions += failed
  st.lastScanAt = Date.now(); st.lastScanMs = Date.now() - t0; st.sessionsTotal = snaps.length
  const quarantined = Object.keys(quar).length
  const summary = {
    ok: true, scanned, changed: changed.length, newRequests: newReqs, failed, skipped,
    quarantined, pruned, removed, totalSessions: snaps.length,
    durationMs: st.lastScanMs, dirty, forced: !!force,
  }
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

