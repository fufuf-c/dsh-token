import {
  STORE_VERSION, newTotals, foldSession, extractSessionInfo,
  rebuildAll, rebuildAllChunked, aggregatesReady, aggregatesNeedRebuild, flushAggregates,
  clipCP, markScanning, markShardsDirty, incrementalRebuildInto, configStale, markStale,
} from './core.mjs'





export const QUARANTINE_RETRY_MS = 24 * 60 * 60 * 1000

const PERMANENT_SCAN_ERRORS = new Set(['SessionFormatUnsupportedError', 'SessionPersistenceCorruptionError'])
export function isPermanentScanError(e) {
  return !!(e && typeof e.name === 'string' && PERMANENT_SCAN_ERRORS.has(e.name))
}

















export function listSnapshotsOf(persistence) {
  if (typeof persistence.list === 'function') return persistence.list()
  if (typeof persistence.listSnapshots === 'function') return persistence.listSnapshots()
  throw new Error('sessionPersistence exposes neither list() nor listSnapshots()')
}

export async function readSessionEvents(persistence, id) {
  if (typeof persistence.open === 'function') {
    const handle = await persistence.open(id, 'read')
    try {
      const res = await handle.read(0)
      return { events: (res && res.events) || [], meta: handle.header || null }
    } finally {
      try { await handle.close() } catch (e) {  }
    }
  }
  if (typeof persistence.readFrom === 'function') {
    const res = await persistence.readFrom(id, 0)
    return { events: (res && res.events) || [], meta: (res && res.meta) || null }
  }
  throw new Error('sessionPersistence exposes neither open() nor readFrom()')
}








function normalizeScanStats(store) {
  const st = store.stats || (store.stats = {})
  for (const k of ['fullScans', 'incrementalScans', 'scannedFiles', 'newRequests', 'failedSessions', 'lastScanAt', 'lastScanMs']) {
    if (!Number.isFinite(Number(st[k]))) st[k] = 0
  }
  return st
}

export async function scanStore(store, persistence, { force = false, concurrency = 4, logger = null, nowMs = Date.now() } = {}) {
  const log = (...a) => { if (logger) logger(...a) }
  const t0 = nowMs
  const snaps = await listSnapshotsOf(persistence)
  const seen = new Set()
  for (const s of snaps) seen.add(s.header.id)
  const quar = store.quarantine || (store.quarantine = {})
  const gone = new Set()
  for (const id of Object.keys(store.watermarks)) if (!seen.has(id)) gone.add(id)
  for (const id of Object.keys(store.requests)) if (!seen.has(id)) gone.add(id)
  for (const id of Object.keys(quar)) if (!seen.has(id)) gone.add(id)

  const knownBefore = Object.keys(store.requests).length + Object.keys(store.watermarks).length
  // 聚合索引必须在这里就绪,两条早退路径(延后清理 / 后端空)才不会留下"聚合不可用"的
  // store。这里是 O(1) 除非真的脏(冷启动后第一次调用会补一次全量重建,与旧行为一致)。
  flushAggregates(store)
  if (snaps.length === 0 && knownBefore > 0) {
    
    
    const seenEmpty = (Number(store.stats && store.stats.emptyListings) || 0) + 1
    if (seenEmpty < 2) {
      log(`[dsh-token] persistence reported 0 sessions while ${knownBefore} are known; deferring purge to the next scan (backend not ready?)`)
      const st0 = normalizeScanStats(store)
      st0.emptyListings = seenEmpty
      const summary0 = {
        ok: true, scanned: 0, changed: 0, newRequests: 0, failed: 0, skipped: 0,
        quarantined: Object.keys(quar).length, pruned: 0, removed: 0, emptyReads: 0,
        totalSessions: 0, durationMs: 0, dirty: false, forced: !!force,
        note: `持久化后端报告 0 个会话,但库中已知 ${knownBefore} 个;已延后清理(下一轮仍为空才清空)`,
      }
      st0.lastSummary = summary0
      return summary0
    }
    
    log(`[dsh-token] persistence still reports 0 sessions (${seenEmpty} consecutive); accepting and purging ${knownBefore} stale entries`)
  }
  if (snaps.length > 0 && store.stats) store.stats.emptyListings = 0

  // 把聚合树对齐到"扫描前"的状态。此后所有改动都只对这棵现成的树做增量加减。
  //
  // 放在 gone 清理**之前**:那时候缺失的会话记录还在,才能把它们对聚合的贡献减干净。
  // 若聚合不可用(结构不合、重建失败等),deferToFull 会兜底为整库重折 —— 增量必须
  // 有一个正确的基准,这一点没有取巧余地。
  const aggBaseOk = !(aggregatesNeedRebuild(store) || !aggregatesReady(store))
  // 完全没有已有聚合桶(冷启动 / 全新库):没有"旧账"可减,增量只会多做一轮
  // unfold+fold 的簿记。实测 200 会话 × 300 请求的冷启动:增量建 67–88ms,
  // 整库重折 57–84ms —— 一次性开销,直接走 proven 的全量路径。
  const coldStart = Object.keys(store.days || {}).length === 0
  let deferToFull = !aggBaseOk || coldStart
  if (!aggBaseOk) log('[dsh-token] aggregates not usable as an incremental base; this scan will do a full rebuild')
  else if (coldStart) log('[dsh-token] no existing aggregate buckets (cold start); building with a full rebuild')

  // 本轮需要做增量加减的会话:`id -> 被 fold 进去的那一份记录列表`。
  // 对"记录被替换"的会话,旧列表由 worker 在替换前留下;对"被删除/被修剪"的会话,
  // 由这里在动它之前留下。旧列表是 unfold 的唯一正确输入 —— 拿新列表去减会静默算错。
  const aggDeltas = new Map()

  let removed = 0
  for (const id of gone) {
    delete store.watermarks[id]
    delete quar[id]
    if (store.requests[id]) {
      aggDeltas.set(id, store.requests[id])
      delete store.requests[id]
      delete store.sessions[id]
      // 请求数据变了 → 聚合形状的缓存必须作废(见 core.markStale 的说明)。
      markStale(store)
    }
    
    markShardsDirty(store, id)
    removed++
  }
  
  const retentionDays = (store.config && Number(store.config.retention && store.config.retention.days)) || 0
  let changed
  if (force) changed = snaps.slice()
  else {
    changed = []
    for (const s of snaps) {
      const wm = store.watermarks[s.header.id]
      if (!wm || wm.rev !== String(s.revision)) { changed.push(s); continue }
      
      
      
      
      
      if (wm.prunedWith !== undefined && wm.prunedWith !== retentionDays) changed.push(s)
    }
  }
  
  
  
  const quarantinedNow = (s) => {
    if (force) return false
    const q = quar[s.header.id]
    if (!q || q.rev !== String(s.revision)) return false
    return (nowMs - q.at) < QUARANTINE_RETRY_MS
  }
  let scanned = 0, failed = 0, newReqs = 0, idx = 0, skipped = 0, emptyReads = 0
  async function worker() {
    while (idx < changed.length) {
      const s = changed[idx++]
      if (quarantinedNow(s)) { skipped++; continue }
      try {
        const res = await readSessionEvents(persistence, s.header.id)
        const events = res.events || []
        const meta = res.meta || s.header
        
        
        
        
        
        
        const prevRecs = store.requests[s.header.id]
        if (!events.length && Array.isArray(prevRecs) && prevRecs.length) {
          emptyReads++
          log(`[dsh-token] session ${s.header.id} read returned 0 events; keeping ${prevRecs.length} stored record(s) and retrying next scan`)
          continue
        }
        scanned++
        const info = extractSessionInfo(events)
        ensureSessionMeta(store, s.header.id, meta, persistence, info)
        // 在覆盖之前留住旧列表 —— 聚合的 unfold 必须减掉"当初 fold 进去的那一份"。
        // 覆盖之后再读 store.requests[id] 拿到的是新列表,减它会静默算错(实测:改 1 个
        // 会话后那天少算一半,而且不报错)。
        //
        // **无论旧列表是否为空都要登记**。此前写成 `if (oldRecs && oldRecs.length)`,
        // 于是全新会话(没有旧记录)被跳过 —— 它的记录永远折不进聚合,而聚合偏偏还会
        // 报 ready(空 days + 有 requests 曾被认为是自洽形状)。空 oldList 的语义是
        // "这个会话只需 fold、无需 unfold",这正是新会话该走的路。
        const oldRecs = store.requests[s.header.id]
        aggDeltas.set(s.header.id, oldRecs || [])
        store.requests[s.header.id] = foldSession(events)
        // 请求数据变了 → 聚合形状的缓存必须作废(见 core.markStale 的说明)。
        markStale(store)
        
        
        markShardsDirty(store, s.header.id)
        // `newRequests` 是**净新增**条数。此前写的是 `+= 本会话全量条数`,于是每次会话
        // 增长都把它整段再加一遍 —— 一个 3000 条的会话被改 10 次就虚报 3 万。自测统计
        // 失真比没有统计更糟:它看起来像个真实指标。
        newReqs += store.requests[s.header.id].length - (oldRecs ? oldRecs.length : 0)
        
        
        
        
        
        
        
        store.watermarks[s.header.id] = { rev: String(s.revision) }
        if (quar[s.header.id]) delete quar[s.header.id]
      } catch (e) {
        failed++
        
        
        
        
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
  
  
  
  
  
  markScanning(store, true)
  let pruned = 0
  let dirty = false
  let scanAggMode = 'none'
  try {
    await Promise.all(workers)
    if (retentionDays > 0) {
      const cutoff = nowMs - retentionDays * 86400000
      for (const id of Object.keys(store.requests)) {
        const list = store.requests[id]
        const keep = list.filter((r) => r.t >= cutoff)
        if (keep.length === list.length) continue
        pruned += list.length - keep.length
        // 同样先留下旧列表再替换:修剪等于"记录变少了",聚合必须减掉被剪掉的那部分。
        aggDeltas.set(id, list)
        if (keep.length) store.requests[id] = keep
        else { delete store.requests[id]; delete store.sessions[id] }
        markStale(store)
        
        markShardsDirty(store, id)
        
        
        
        
        
        
        
        
        
        
        const wm = store.watermarks[id]
        if (wm) wm.prunedWith = retentionDays
      }
    }
    
    
    dirty = !!(force || scanned || removed || pruned)
    
    
    
    
    
    
    
    
    
    
    // ── 聚合收尾(0.9.5)──────────────────────────────────────────────────
    // 旧行为:只要 dirty 就 `rebuildAllChunked(全库)`,代价 O(全库记录数),与"改了多少"
    // 完全脱钩 —— 20 万请求的库改 1 个会话也要重折 20 万条(作者实测 447ms)。
    //
    // 新行为分两条路:
    //   · 不能走增量(force / 基准不可用 / 扫描期间改了价格时段)→ 整库重折,语义同旧版;
    //   · 可以走增量 → 只对**被改动的会话**做 unfold(旧列表)+ fold(新列表)。
    //     代价正比于改动量:实测 200 会话 × 150 条约 0.46ms,而全量是 16.7ms。
    //
    // configStale 要在**做完之后再查一遍**:扫描期间用户可能改了单价,那时基准是旧价,
    // 走增量会留下"一半新价一半旧价"的账(总额谁也说不清,且页面没有任何提示)。
    //
    // 注意"没有 delta 但聚合仍不可用"这条路径(实测漏过一次):首次扫描时库是空的,
    // 每个会话都没有旧列表 → aggDeltas 为空 → 增量分支成了空操作,而聚合永远不会被建起来
    // (此后 aggregatesReady 还会给出 true,因为"空 days + 空 requests"是自洽的形状)。
    // 所以"需要整库重折"必须独立于 delta 判断。
    const canIncremental = !(force || deferToFull || configStale(store))
    if (!canIncremental) {
      if (dirty || aggregatesNeedRebuild(store)) {
        await rebuildAllChunked(store)
        scanAggMode = 'full'
      }
    } else if (aggDeltas.size) {
      const deltas = []
      for (const [id, oldList] of aggDeltas) deltas.push({ id, oldList })
      const n = incrementalRebuildInto(store, store.__agg, deltas)
      scanAggMode = n ? 'incremental' : 'none'
      // 极端竞态:增量刚走完配置就变了。这一轮作废,整库重折 —— 宁可多算一次,
      // 也不留下两种口径混在一起的账。
      if (configStale(store)) {
        log('[dsh-token] config changed during incremental refold; falling back to a full rebuild')
        await rebuildAllChunked(store)
        scanAggMode = 'full'
      }
    } else if (aggregatesNeedRebuild(store)) {
      // 没有 delta 可做增量、但聚合不可用(首次扫描 / 结构缺失)。必须建起来。
      await rebuildAllChunked(store)
      scanAggMode = 'full'
    }
  } finally {
    markScanning(store, false)
  }
  store.updatedAt = Date.now()
  const st = normalizeScanStats(store)
  const bump = (k, n) => { st[k] = (Number(st[k]) || 0) + n }
  if (force || !(st.fullScans > 0)) bump('fullScans', 1)
  else bump('incrementalScans', 1)
  
  bump('scannedFiles', scanned); bump('newRequests', newReqs); bump('failedSessions', failed)
  st.lastScanAt = Date.now(); st.lastScanMs = Date.now() - t0; st.sessionsTotal = snaps.length
  const quarantined = Object.keys(quar).length
  const summary = {
    ok: true, scanned, changed: changed.length, newRequests: newReqs, failed, skipped,
    quarantined, pruned, removed, emptyReads, totalSessions: snaps.length,
    durationMs: st.lastScanMs, dirty, forced: !!force,
    // 聚合收尾用了哪条路:'full' | 'incremental' | 'none'。暴露出来是为了让"这一轮到底
    // 是整库重折还是增量"可观测 —— 否则性能回归只能靠计时猜。
    aggMode: scanAggMode,
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
    } catch (e) {  }
    ses.meta = {
      id: meta.id || id, createdAt: meta.createdAt || null, cwd: meta.cwd || null,
      parentSession: meta.parentSession || null, origin: meta.origin || null,
      delegationDepth: meta.delegationDepth || null, agentPreset: meta.agentPreset || null,
      workspace,
      title: (info && info.title) || null, titleKind: (info && info.titleKind) || null,
    }
  } else if (ses.meta && info) {
    
    
    
    
    
    
    const incoming = info.title
    const authoritative = info.titleKind === 'llm'
    if (incoming && (authoritative || !ses.meta.title)) {
      if (ses.meta.title !== incoming || ses.meta.titleKind !== info.titleKind) {
        ses.meta.title = incoming
        ses.meta.titleKind = info.titleKind
      }
    }
    if (!ses.meta.workspace && ses.meta.cwd) ses.meta.workspace = String(ses.meta.cwd).split(/[\\/]+/).filter(Boolean).pop() || ''
  }
}
