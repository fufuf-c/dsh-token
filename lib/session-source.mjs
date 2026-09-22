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

/** 宿主 `fileRevision(identity)` 的段数:dev:ino:size:mtimeNs:ctimeNs。 */
const FILE_REVISION_SEGMENTS = 5

/**
 * 宿主 revision → **本会话自己的**变更令牌。
 *
 * ## 为什么需要它(这是一次宿主侧回归)
 *
 * `@deepseek-ai/dsh-session-persistence-jsonl` 在 0.1.7-alpha.1 改了 `list()` 的
 * revision 构造(对比 0.1.6-alpha.1 的同名函数):
 *
 *   ≤ 0.1.6   `<文件身份>`
 *   ≥ 0.1.7   `<文件身份>:<全语料哈希>`      ← 仅当 sourceVersion < 当前格式
 *
 * 后半段是 `historicalCorpusRevision()` —— **整库所有会话文件**路径 + 各自 stat
 * 身份的 sha256。它表达的是"遗留会话的解码可能依赖兄弟文件"(见下方
 * relatedFingerprints),但粒度是**整库**。
 *
 * 后果对本插件是致命的:本插件用 `watermark.rev !== snapshot.revision` 判断"这个
 * 会话要不要重读"。于是任何一个会话文件被触碰 —— 新建会话、当前会话追加一行、
 * 甚至只是 mtime 变了 —— **所有遗留会话**的 revision 同时变化,水位线集体失效,
 * 每一轮扫描都把整库重读一遍。
 *
 * 作者实测(70 个会话,其中 65 个是 v3 遗留文件):
 *   · 无变化的一轮       88 ms
 *   · 只改 1 个文件的 mtime(内容零改动)   8 512 ms,changed=65
 *   · 页面「进入界面时先扫描」默认开启 → 打开面板要白屏 8 秒,
 *     扫描完才出数;而穿插操作又会再次弄脏语料 → 表现为"时好时坏"。
 *
 * 所以水位线只认**文件身份**那五段:它才是"这个会话自己变了没有"。遗留会话的兄弟
 * 依赖由 {@link relatedFingerprints} 精确接回来,不再靠整库哈希一刀切。
 *
 * 对两种宿主都安全:≤0.1.6 的 revision 本来就是五段(原样返回);内存/待落盘会话的
 * `memory:<name>:<n>` 段数不足五段(也原样返回)。
 *
 * @param rev - 宿主给的 revision(字符串;品牌类型在运行时就是同一个字符串)
 * @returns 仅含本会话文件身份的令牌
 */
export function ownRevisionToken(rev) {
  const parts = String(rev == null ? '' : rev).split(':')
  return parts.length > FILE_REVISION_SEGMENTS ? parts.slice(0, FILE_REVISION_SEGMENTS).join(':') : parts.join(':')
}

/**
 * 遗留会话的解码依赖(子代理子会话)→ 每个父会话一个指纹。
 *
 * 宿主解码一个 **sourceVersion < 当前格式** 的会话时,会把它**所有**
 * `origin === 'subagent' && parentSession === id` 的子会话读进来参与解码
 * (见 dsh-session-persistence-jsonl 的 `prepareStoredMigration` → `children()` →
 * `prepareCatalogFacts`)。旧实现用"整库哈希"表达这层依赖,代价是任一文件变动都让
 * 全部遗留会话失效。
 *
 * 这里按宿主**真正读的那批文件**算:父会话的指纹 = 每个子会话的 `id + 自身变更
 * 令牌`,排序后拼接。于是子会话新增 / 删除 / 内容变化只让**该父会话**重读,其余
 * 遗留会话完全不受影响 —— 语义不弱于整库哈希,影响面从 O(全库) 收到 O(该父的子树)。
 *
 * **只给遗留父会话算**(判定依据:它自己的 revision 带语料哈希,即段数 > 5)。
 * 当前格式(v4)父会话的解码只读它自己的文件,子会话不参与 —— 给它挂依赖会让
 * 子代理一有动静就白重读一次父会话。这条边界与宿主的
 * `artifact.sourceVersion < SESSION_FORMAT_VERSION` 条件严格对齐。
 *
 * 只读快照表已有字段,不产生任何额外 IO。`list()` 的顺序没有承诺,所以先排序。
 *
 * @param snaps - `listSnapshotsOf()` 的返回值
 * @returns `父会话 id -> 指纹`(无子会话的父、以及当前格式的父,都不在表里)
 */
export function relatedFingerprints(snaps) {
  const legacy = new Set()
  const children = new Map()
  for (const s of snaps) {
    const h = (s && s.header) || {}
    if (!h.id) continue
    // revision 段数 > 5 ⇔ 宿主给它拼了语料哈希 ⇔ 它是遗留格式(见 ownRevisionToken)
    if (String(s.revision == null ? '' : s.revision).split(':').length > FILE_REVISION_SEGMENTS) legacy.add(String(h.id))
    if (h.origin === 'subagent' && h.parentSession) {
      const parent = String(h.parentSession)
      const list = children.get(parent) || []
      list.push(`${String(h.id)}:${ownRevisionToken(s.revision)}`)
      children.set(parent, list)
    }
  }
  const out = new Map()
  for (const [parent, list] of children) {
    if (!legacy.has(parent)) continue
    out.set(parent, list.sort().join(','))
  }
  return out
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
  
  // 本会话的变更令牌,以及(仅遗留会话)它解码时依赖的子会话子树指纹。
  // 为什么不能直接用宿主 revision:见 ownRevisionToken 的注释 —— 0.1.7 起遗留会话的
  // revision 含**整库**哈希,直接比会让任一文件变动都触发全库重读。
  const tokenOf = (s) => ownRevisionToken(s.revision)
  const related = relatedFingerprints(snaps)
  const relOf = (id) => related.get(String(id)) || ''
  /** 水位线/隔离记录的内容:本会话自身令牌 + 依赖子树指纹(空串表示无依赖)。 */
  const markOf = (s) => ({ rev: tokenOf(s), rel: relOf(s.header.id) })
  /**
   * 水位线/隔离记录是否仍与当前快照一致(本会话自身 + 它的依赖子树)。
   *
   * 两边都过 `ownRevisionToken`:老库里的 rev 是 0.1.7 之前的六段形态(含整库哈希),
   * 若只归一化当前值,升级后的**第一轮**会把全部遗留会话判为"变了"而整库重读一次
   * —— 正是本次要消除的那个 8 秒卡顿。归一化后,只有文件身份真的变了(或该父会话的
   * 子会话集合变了 —— 老记录没有 rel,所以有子会话的父会话会保守地重读一次)才重读。
   */
  const marksMatch = (rec, s) => !!rec && ownRevisionToken(rec.rev) === tokenOf(s) && (rec.rel || '') === relOf(s.header.id)

  const retentionDays = (store.config && Number(store.config.retention && store.config.retention.days)) || 0
  let changed
  if (force) changed = snaps.slice()
  else {
    changed = []
    for (const s of snaps) {
      const wm = store.watermarks[s.header.id]
      if (!marksMatch(wm, s)) { changed.push(s); continue }
      
      
      
      
      
      if (wm.prunedWith !== undefined && wm.prunedWith !== retentionDays) changed.push(s)
    }
  }
  
  
  
  const quarantinedNow = (s) => {
    if (force) return false
    const q = quar[s.header.id]
    if (!marksMatch(q, s)) return false
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
        
        
        
        
        
        
        
        store.watermarks[s.header.id] = markOf(s)
        if (quar[s.header.id]) delete quar[s.header.id]
      } catch (e) {
        failed++
        
        
        
        
        if (isPermanentScanError(e)) {
          const prev = quar[s.header.id]
          quar[s.header.id] = {
            ...markOf(s), name: String((e && e.name) || 'Error'),
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
