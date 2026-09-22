import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { readFile as readFileAsync } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import os from 'node:os'
import {
  apiDispatch, emptyStore, applyConfigPatch,
  kpiQuery, makeFilter, parseQuery, STORE_VERSION, configuredModelsFrom, configView, refreshSettings,
  flushAggregates, isStoreShapeValid, encodeStore, decodeStore,
  splitStore, joinStore, dirtyShardsOf, setDirtyShards, encodeShard, storeMeta,
  loadShardsAsync, rebuildAllChunked,
} from './core.mjs'

import { scanStore } from './session-source.mjs'

export const name = 'dsh-token'




export const inject = ['sessionPersistence', 'webServer', 'commands', 'timer']

const DSHDIR = process.env.DSH_HOME || join(os.homedir(), '.dsh')
const STORE_DIR = join(DSHDIR, 'dsh-token')
const STORE_FILE = join(STORE_DIR, 'store.json')

const SHARD_DIR = join(STORE_DIR, 'shards')
const DEFAULT_PAGE = fileURLToPath(new URL('../web/index.html', import.meta.url))
const PKG = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
const BODY_LIMIT = 1024 * 1024


const SAVE_MIN_INTERVAL = 10 * 60 * 1000

const ENCODING_ONLY_VERSIONS = new Set([7])

const PAGE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
}
const FALLBACK_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>dsh-token</title></head>
<body style="font:14px sans-serif;padding:32px">
<h2>dsh-token 仪表盘</h2>
<p>内置页面未找到,请重新安装本插件(web/index.html 缺失)。</p>
<p><a href="/dsh-token/api/meta">API 元信息</a></p>
</body></html>`

export function apply(ctx) {
  const persistence = ctx.get('sessionPersistence')
  const webServer = ctx.get('webServer')
  const commands = ctx.get('commands')
  const timer = ctx.get('timer')
  if (persistence === undefined) {
    console.error('[dsh-token] sessionPersistence unavailable; please keep the jsonl persistence bundle enabled')
    return
  }

  let store = null

  function storeOrEmpty() {
    return store || emptyStore()
  }
  let pageCache = null 
  let scanPromise = null

  function log(...args) { console.log('[dsh-token]', ...args) }
  function logErr(...args) { console.error('[dsh-token]', ...args) }

  
  
  
  
  function quarantineStoreFile(reason) {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const dest = `${STORE_FILE}.corrupt-${stamp}`
      renameSync(STORE_FILE, dest)
      logErr(`store file failed validation (${reason}); kept as ${dest} and rebuilt from session logs`)
      return dest
    } catch (e) {
      logErr(`store file failed validation (${reason}) and could not be moved aside: ${e && e.message || e}`)
      return null
    }
  }

  
  
  
  
  
  
  const shardFileOf = (id) => join(SHARD_DIR, `${Buffer.from(String(id), 'utf8').toString('base64url')}.json`)

  function listShardFiles() {
    try { return readdirSync(SHARD_DIR).filter((f) => f.endsWith('.json')) } catch (e) { return [] }
  }

  function writeFileAtomic(dest, text) {
    const tmp = `${dest}.tmp`
    writeFileSync(tmp, text)
    renameSync(tmp, dest)
  }

  async function loadStore() {
    try {
      if (existsSync(STORE_FILE)) {
        const raw = readFileSync(STORE_FILE, 'utf8')
        let parsed = null
        try { parsed = JSON.parse(raw) } catch (e) { parsed = null }
        
        
        
        
        const isShardLayout = !!(parsed && parsed.requests === undefined && existsSync(SHARD_DIR))
        
        
        let legacyShards = 0
        if (parsed) {
          if (isShardLayout) {
            
            
            const files = listShardFiles().map((f) => join(SHARD_DIR, f))
            const res = await loadShardsAsync(parsed, files, {
              readFile: (p) => readFileAsync(p, 'utf8'),
              
              
              onShardError: (p, e) => logErr(`shard unreadable: ${p} (${(e && e.message) || e})`),
            })
            parsed = res.store
            legacyShards = res.legacyCount
            if (res.errorCount) logErr(`${res.errorCount} shard file(s) unreadable; their sessions will be re-folded from logs`)
            if (legacyShards) log(`${legacyShards} shard(s) in the pre-v8 layout (no per-shard model table); rewriting them on the next save`)
          } else {
            
            parsed = decodeStore(parsed)
          }
        }
        if (parsed && isStoreShapeValid(parsed)) {
          store = parsed
          
          
          
          
          setDirtyShards(store, isShardLayout && !legacyShards ? new Set() : null)
          if (store.version !== STORE_VERSION) {
            
            
            
            
            
            
            
            if (ENCODING_ONLY_VERSIONS.has(store.version)) {
              log(`store version ${store.version} → ${STORE_VERSION} (encoding only): no rescan needed`)
            } else {
              log(`store version ${store.version} → ${STORE_VERSION}: scheduling one full rescan`)
              store.needsFullScan = true
            }
            store.version = STORE_VERSION
          }
          if (!store.config) store.config = emptyStore().config
          if (!store.config.retention) store.config.retention = { days: 0 }
          if (!store.watermarks) store.watermarks = {}
          if (!store.quarantine) store.quarantine = {}
          if (!store.sessions) store.sessions = {}
          if (!store.days) store.days = {}
          if (!store.months) store.months = {}
          if (!store.stats) store.stats = emptyStore().stats
          
          
          
          if (isShardLayout) {
            let missing = 0
            for (const id of Object.keys(store.sessions)) {
              if (!store.requests[id] && store.watermarks[id]) { delete store.watermarks[id]; missing++ }
            }
            if (missing) log(`${missing} session(s) had no shard on disk; watermarks dropped so they are re-folded`)
          }
          log(`store loaded: ${STORE_FILE} | sessions ${Object.keys(store.requests).length}${isShardLayout ? ' (sharded)' : ''}`)
          return
        }
        quarantineStoreFile(parsed ? 'invalid shape' : 'unparsable JSON')
      }
    } catch (e) {
      log(`store load failed (starting fresh): ${e && e.message || e}`)
    }
    store = emptyStore()
    store.storeFile = STORE_FILE
    store.sessionsRoot = join(DSHDIR, 'sessions')
    setDirtyShards(store, null)
  }

  
  
  
  
  let lastSaveAt = 0
  let saveTimer = null
  let pendingFlush = false
  function writeStore() {
    try {
      mkdirSync(STORE_DIR, { recursive: true })
      
      
      flushAggregates(store)
      
      
      
      
      
      
      
      const meta = storeMeta(store)
      
      
      
      
      mkdirSync(SHARD_DIR, { recursive: true })
      const want = new Set()
      const dirty = dirtyShardsOf(store)
      const requests = store.requests || {}
      for (const id of Object.keys(requests)) {
        const file = shardFileOf(id)
        want.add(file)
        
        if (dirty !== null && !dirty.has(id)) continue
        
        
        const s = encodeShard(requests[id])
        writeFileAtomic(file, JSON.stringify({ id, models: s.models, rows: s.rows }))
      }
      
      for (const f of listShardFiles()) {
        const full = join(SHARD_DIR, f)
        if (!want.has(full)) { try { unlinkSync(full) } catch (e) {  } }
      }
      
      writeFileAtomic(STORE_FILE, JSON.stringify(meta))
      
      setDirtyShards(store, new Set())
      lastSaveAt = Date.now()
    } catch (e) {
      logErr(`store write failed (in-memory only): ${e && e.message || e}`)
    }
  }
  function saveStore(opts) {
    store.updatedAt = Date.now()
    if (opts && opts.immediate) {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
      pendingFlush = false
      writeStore()
      return
    }
    pendingFlush = true
    if (saveTimer) return
    const wait = Math.max(0, SAVE_MIN_INTERVAL - (Date.now() - lastSaveAt))
    saveTimer = setTimeout(() => {
      saveTimer = null
      if (pendingFlush) { pendingFlush = false; writeStore() }
    }, wait)
  }
  function flushPendingSave() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    if (pendingFlush) { pendingFlush = false; writeStore() }
  }

  
  
  
  
  
  
  function themePreference() {
    try {
      const settings = ctx.get('settings')
      if (!settings || typeof settings.get !== 'function') return 'system'
      const section = settings.get('ui-theme')
      const pref = section && typeof section === 'object' ? section.preference : undefined
      return pref === 'light' || pref === 'dark' || pref === 'system' ? pref : 'system'
    } catch (e) {
      return 'system'
    }
  }

  function injectThemePreference(html, preference) {
    
    
    if (html.indexOf('window.__DSH_TOKEN_THEME__=') !== -1) return html
    const tag = `<script>window.__DSH_TOKEN_THEME__=${JSON.stringify({ preference })}</script>`
    const meta = '<meta charset="utf-8">'
    const at = html.indexOf(meta)
    if (at >= 0) return html.slice(0, at + meta.length) + tag + html.slice(at + meta.length)
    const head = html.indexOf('<head>')
    if (head >= 0) return html.slice(0, head + 6) + tag + html.slice(head + 6)
    return html
  }

  
  
  
  
  
  
  
  function pageHtml() {
    try {
      const st = statSync(DEFAULT_PAGE)
      const mtimeMs = st.mtimeMs
      
      
      
      
      const size = st.size
      const preference = themePreference()
      if (pageCache && pageCache.mtimeMs === mtimeMs && pageCache.size === size && pageCache.preference === preference) return pageCache
      const html = injectThemePreference(readFileSync(DEFAULT_PAGE, 'utf8'), preference)
      pageCache = { mtimeMs, size, preference, html, gz: gzipSync(Buffer.from(html)) }
      return pageCache
    } catch (e) {
      logErr(`page read failed (${DEFAULT_PAGE}): ${e && e.message || e}`)
      return null
    }
  }

  
  let pendingForce = false
  function scan(force) {
    if (scanPromise) {
      
      
      if (force) pendingForce = true
      return scanPromise
    }
    
    
    
    scanPromise = (async () => {
      if (!store) await loadStore()
      return scanStore(store, persistence, { force: !!force, logger: log })
    })()
      .then((summary) => {
        
        if (summary.forced && store.needsFullScan) store.needsFullScan = false
        
        if (summary.dirty || summary.forced) saveStore()
        if (summary.dirty) log('scan done:', JSON.stringify(summary))
        return summary
      })
      .catch((e) => { logErr('scan error:', String(e)); return { ok: false, error: String(e) } })
      .finally(() => {
        scanPromise = null
        if (pendingForce) { pendingForce = false; void scan(true) }
      })
    return scanPromise
  }

  let scanTimerDispose = null

  let scanTimerSec = -1

  function armScanTimer(force) {
    if (!timer) return
    
    
    
    const sec = refreshSettings(storeOrEmpty()).scanSec
    if (!force && sec === scanTimerSec) return
    if (scanTimerDispose) { try { scanTimerDispose() } catch (e) {  } ; scanTimerDispose = null }
    scanTimerSec = sec
    if (!(sec > 0)) { log('background scan disabled (scanSec = 0)'); return }
    try {
      scanTimerDispose = timer.interval(() => { void scan(false) }, sec * 1000)
      log(`background scan every ${sec}s`)
    } catch (e) { logErr('interval failed:', String(e)) }
  }

  
  function json(res, code, payload) {
    try {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end(JSON.stringify(payload))
    } catch (e) {  }
  }

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  

  function canonicalAuthority(raw) {
    let h = String(raw || '').trim().toLowerCase()
    if (!h) return null
    let hostname = h, port = ''
    const m = /^\[([^\]]*)\](?::(\d+))?$/.exec(h)
    if (m) { hostname = m[1]; port = m[2] || '' }
    else {
      const c = h.lastIndexOf(':')
      if (c > 0 && h.indexOf(':') === c) { hostname = h.slice(0, c); port = h.slice(c + 1) }
    }
    
    
    hostname = hostname.replace(/\.+$/, '')
    if (!hostname) return null
    return { hostname, authority: port ? `${hostname}:${port}` : hostname }
  }
  function isLoopback4(h) {
    if (!/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return false
    return h.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255)
  }
  function isPrivate4(h) {
    const p = h.split('.').map(Number)
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
    if (p[0] === 10) return true
    if (p[0] === 192 && p[1] === 168) return true
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true
    if (p[0] === 169 && p[1] === 254) return true 
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true 
    return false
  }

  function isLocalishHostname(h) {
    if (!h) return false
    if (h === 'localhost' || h.endsWith('.localhost')) return true
    if (isLoopback4(h)) return true
    if (h === '::1' || h.startsWith('::ffff:127.')) return true
    if (isPrivate4(h)) return true
    
    if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true
    return false
  }

  function fence(req) {
    const h = canonicalAuthority(req.headers.host)
    if (!h || !isLocalishHostname(h.hostname)) return false
    if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return false
    const o = req.headers.origin
    
    if (o === undefined) return true
    let oh
    try { oh = canonicalAuthority(new URL(String(o)).host) } catch (e) { return false }
    return !!oh && oh.authority === h.authority
  }

  function routeHandler(req, res) {
    const u = String(req.url || '/')
    const path = u.split('?')[0]
    const query = parseQuery(u)
    const method = String(req.method || 'GET')
    const run = async () => {
      if (path === '/dsh-token' || path === '/dsh-token/') {
        if (method !== 'GET' && method !== 'HEAD') { json(res, 405, { error: 'method not allowed' }); return }
        const page = pageHtml()
        if (page && String(req.headers['accept-encoding'] || '').includes('gzip')) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding', 'Cache-Control': 'no-store', ...PAGE_HEADERS })
          res.end(method === 'HEAD' ? undefined : page.gz)
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Vary': 'Accept-Encoding', 'Cache-Control': 'no-store', ...PAGE_HEADERS })
        res.end(method === 'HEAD' ? undefined : (page ? page.html : FALLBACK_PAGE))
        return
      }
      if (!path.startsWith('/dsh-token/api/')) { json(res, 404, { error: 'not found' }); return }
      const name = path.slice('/dsh-token/api/'.length)
      
      
      if (!fence(req)) { json(res, 403, { error: 'request rejected: host/origin not local' }); return }
      if (method === 'POST') {
        if (name === 'scan') {
          
          
          
          
          try { req.resume() } catch (e) {  }
          
          
          
          const summary = await scan(false)
          const failed = !summary || summary.ok === false
          json(res, failed ? 500 : 200, failed
            ? { ok: false, error: (summary && summary.error) || 'scan failed', summary: summary || null }
            : { ok: true, summary })
          return
        }
        if (name === 'config') {
          let body
          try { body = await readJsonBody(req) }
          catch (e) { json(res, (e && e.statusCode) || 400, { error: (e && e.message) || 'bad request' }); return }
          try {
            const cfg = applyConfigPatch(store, body)
            saveStore({ immediate: true }) 
            
            
            if (body && body.refresh !== undefined) armScanTimer()
            json(res, 200, cfg)
          } catch (e) { json(res, 400, { error: (e && e.message) || String(e) }) }
          return
        }
        
        try { req.resume() } catch (e) {  }
        json(res, 404, { error: 'unknown POST api' }); return
      }
      if (method !== 'GET') { json(res, 405, { error: 'method not allowed' }); return }
      const result = apiDispatch(storeOrEmpty(), name, query, null, { metaExtra: metaExtra() })
      if (result.status === 404) { json(res, 404, JSON.parse(result.body)); return }
      const headers = { 'Content-Type': result.contentType, 'Cache-Control': 'no-store', ...(result.headers || {}) }
      res.writeHead(result.status, headers)
      res.end(result.body)
    }
    run().catch((e) => { try { json(res, (e && e.statusCode) || 500, { error: String(e) }) } catch (e2) {  } })
  }

  function readJsonBody(req, limit = BODY_LIMIT) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (c) => {
        size += c.length
        if (size > limit) {
          
          
          
          req.removeAllListeners('data')
          req.resume()
          const e = new Error('request body too large')
          e.statusCode = 413
          reject(e)
          return
        }
        chunks.push(c)
      })
      req.on('end', () => {
        try {
          const s = chunks.map((c) => String(c && c.toString ? c.toString('utf8') : '')).join('')
          resolve(s ? JSON.parse(s) : {})
        } catch (e) { reject(e) }
      })
      req.on('error', reject)
    })
  }

  
  const fmtTok = (n) => { if (!isFinite(n)) return '0'; if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return String(Math.round(n)) }
  const fmtYuan = (n) => { if (!isFinite(n)) return '0.00'; return n.toFixed(2) }
  const fmtPct = (x) => (isFinite(x) ? (x * 100).toFixed(1) + '%' : '0%')
  function commandText(rawInput) {
    const arg = String(rawInput || '').trim()
    
    
    const k = kpiQuery(storeOrEmpty(), arg || 'all', null, null, makeFilter(null))
    const t = k.totals
    const lines = []
    lines.push(`── Token 统计 [${arg || 'all'}] ──`)
    lines.push(`用量: 未命中 ${fmtTok(t.miss)} / 缓存命中 ${fmtTok(t.read)} / 缓存写入 ${fmtTok(t.write)} / 输出 ${fmtTok(t.out)} | 合计 ${fmtTok(t.total)}`)
    lines.push(`请求: ${t.requests} | 活跃会话: ${k.activeSessions} | 缓存命中率: ${fmtPct(k.hitRate)}`)
    lines.push(`估算成本: ¥ ${fmtYuan(t.cost)} | 缓存节省估算: ¥ ${fmtYuan(t.saved)}`)
    if (k.streakDays > 0) lines.push(`连续使用: ${k.streakDays} 天`)
    if (k.peakDay && k.peakDay.day) lines.push(`峰值日: ${k.peakDay.day} (${fmtTok(k.peakDay.tokens)} tokens)`)
    if (k.delta) lines.push(`环比: ${k.delta.tokens >= 0 ? '+' : ''}${fmtTok(k.delta.tokens)} tokens, ${k.delta.cost >= 0 ? '+' : ''}¥${fmtYuan(k.delta.cost)}`)
    if (k.models.length) {
      lines.push('按模型:')
      for (const m of k.models.slice(0, 8)) lines.push(`  ${m.key} → ${fmtTok(m.totals.read + m.totals.miss + m.totals.write + m.totals.out)} tokens, ¥${fmtYuan(m.totals.cost)}`)
    }
    lines.push('仪表盘: /dsh-token (全本地, 零上传)')
    return lines.join('\n')
  }

  
  
  
  
  
  let warnedNoRoster = false
  function configuredModels() {
    try {
      const settings = ctx.get('settings')
      if (!settings || typeof settings.describe !== 'function') return null
      const descriptors = settings.describe({ redactSecrets: true })
      const parsed = configuredModelsFrom(descriptors)
      if (!parsed && !warnedNoRoster) {
        warnedNoRoster = true
        
        
        
        const names = (descriptors || []).map((d) => String((d && d.ns) || '?')).join(', ')
        logErr(`no model catalog recognized in settings; roster filtering disabled (namespaces: ${names || 'none'})`)
      }
      return parsed
    } catch (e) {
      logErr('settings read failed (model roster unavailable, filtering disabled):', String(e))
      return null
    }
  }
  function metaExtra() {
    return {
      version: PKG.version,
      configuredModels: configuredModels(),
      
      
      
      
      refresh: refreshSettings(storeOrEmpty()),
    }
  }

  const api = {
    scan: (args) => scan(args && args.force),
    kpi: (args) => kpiQuery(storeOrEmpty(), (args && args.range) || 'all', args && args.from, args && args.to, makeFilter(args)),
    series: (args) => apiDispatch(storeOrEmpty(), 'series', args || {}).body,
    hours: (args) => apiDispatch(storeOrEmpty(), 'hours', args || {}).body,
    heatmap: (args) => apiDispatch(storeOrEmpty(), 'heatmap', args || {}).body,
    sessions: (args) => apiDispatch(storeOrEmpty(), 'sessions', args || {}).body,
    sessionDetail: (args) => apiDispatch(storeOrEmpty(), 'session', args || {}).body,
    config: () => configView(storeOrEmpty()),
    meta: () => apiDispatch(storeOrEmpty(), 'meta', {}, null, { metaExtra: metaExtra() }).body,
  }

  

  const loadPromise = loadStore()
  const disposers = []
  if (commands) {
    try {
      disposers.push(commands.register({
        name: 'token-stats',
        description: 'DSH 本地 Token 使用统计(今日/本月/全部等)',
        input: { hint: '[today|month|all|7d|30d|3d]' },
        handler: (invocation) => {
          try { return { kind: 'success', text: commandText(invocation.rawInput) } }
          catch (e) { return { kind: 'error', text: `token-stats: ${String(e)}` } }
        },
      }))
    } catch (e) { logErr('command register failed:', String(e)) }
  }
  if (webServer) {
    try { disposers.push(webServer.register({ kind: 'prefix', path: '/dsh-token', handler: routeHandler })) }
    catch (e) { logErr('webServer route failed:', String(e)) }
  }
  try { disposers.push(ctx.provide('dshTokenStats', api)) }
  catch (e) { logErr('provide failed:', String(e)) }
  
  
  armScanTimer(true) 
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      if (scanTimerDispose) { try { scanTimerDispose() } catch (e) {  } ; scanTimerDispose = null }
      for (const d of disposers) { try { d() } catch (e) {  } }
      flushPendingSave() 
    })
  }

  
  
  
  
  
  
  
  const start = async () => {
    await loadPromise
    
    
    const summary = await scan(!!store.needsFullScan)
    log('startup scan:', JSON.stringify(summary))
    try {
      const k = api.kpi({ range: 'all' })
      if (typeof k.totals.cost !== 'number') throw new Error('kpi shape')
      const csv = apiDispatch(store, 'export.csv', { range: 'all' }).body
      if (!csv.startsWith('date,model')) throw new Error('csv shape')
      log(`self-test OK: sessions ${store ? Object.keys(store.requests).length : 0} · requests ${k.totals.requests} · cost ¥${k.totals.cost.toFixed(2)}`)
    } catch (e) {
      logErr('self-test FAIL:', String(e))
    }
  }
  void start().catch((e) => logErr('startup failed:', String(e)))
}
