/**
 * dsh-token — 正式 Host 半区(cordis bundle 插件)
 *
 * - 数据管道(折叠/聚合/筛选/导出)全部在 ./core.mjs(纯函数,零依赖);
 * - 扫描经 sessionPersistence 服务(与 DSH 官方一致,兼容多帧 Zstd 打包日志);
 * - 配置与聚合结果持久化于 $DSH_HOME/dsh-token/store.json(零上传,原子写);
 * - 数据源路径:$DSH_HOME/sessions,由持久化层 locate() 自动推导。
 *
 * 运行纪律:常规启动只做增量扫描(仅 store 版本迁移时做一次全量);
 * 空闲扫描周期无变化时跳过整库重建与落盘;扫描产物落盘合并(可重建缓存,
 * 最短间隔内只写一次,配置变更立即落盘,退出时兜底 flush);页面按 mtime
 * 失效缓存并提供 gzip;POST 走同源 + 本机 Host 校验 + 1MB body 上限。
 *
 * 该模块是 profile bundle 行 `@fufuf-c/dsh-token` 的 main 入口:
 *   cordis 加载 { name, inject?, apply } 形插件。
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import net from 'node:net'
import os from 'node:os'
import {
  apiDispatch, emptyStore, scanStore, applyConfigPatch,
  kpiQuery, makeFilter, parseQuery, STORE_VERSION, configuredModelsFrom, configView,
} from './core.mjs'

export const name = 'dsh-token'

// cordis 响应式 DI:apply 会 ctx.get 这四个服务,声明 inject 让挂载推迟到
// 它们全部就绪 —— 否则 apply 先于 session-persistence-jsonl 执行,
// sessionPersistence 拿到 undefined,整个数据管道静默失效。
export const inject = ['sessionPersistence', 'webServer', 'commands', 'timer']

const DSHDIR = process.env.DSH_HOME || join(os.homedir(), '.dsh')
const STORE_DIR = join(DSHDIR, 'dsh-token')
const STORE_FILE = join(STORE_DIR, 'store.json')
const DEFAULT_PAGE = fileURLToPath(new URL('../web/index.html', import.meta.url))
const PKG = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
const BODY_LIMIT = 1024 * 1024
// 扫描产物的落盘最小间隔:聚合/水位线都可由会话日志重建,合并写只影响
// 重启后的重扫量,不影响正确性;配置(用户数据,不可重建)始终立即落盘
const SAVE_MIN_INTERVAL = 10 * 60 * 1000
// 页面仅内联脚本/样式、仅连同源 API,CSP 阻断任何外部注入面
const PAGE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
}
const FALLBACK_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>dsh-token</title></head>
<body style="font:14px sans-serif;padding:32px">
<h2>dsh-token 仪表盘</h2>
<p>页面未找到,请通过 POST /dsh-token/api/config {"webPagePath":"<.html 绝对路径>"} 指定页面</p>
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
  let pageCache = null // { path, mtimeMs, html, gz }
  let scanPromise = null

  function log(...args) { console.log('[dsh-token]', ...args) }
  function logErr(...args) { console.error('[dsh-token]', ...args) }

  // ---------------- store 持久化 ----------------
  function loadStore() {
    try {
      if (existsSync(STORE_FILE)) {
        const parsed = JSON.parse(readFileSync(STORE_FILE, 'utf8'))
        if (parsed && parsed.requests) {
          store = parsed
          if (store.version !== STORE_VERSION) {
            // 结构/语义迁移:标记一次全量扫描,补齐老会话标题并让新的
            // foldSession 口径覆盖全部历史(水位线按 revision 跳过,不标记
            // 就永远沿用旧口径)。常规启动仍只做增量。
            log(`store version ${store.version} → ${STORE_VERSION}: scheduling one full rescan`)
            store.version = STORE_VERSION
            store.needsFullScan = true
          }
          if (!store.config) store.config = emptyStore().config
          if (!store.config.retention) store.config.retention = { days: 0 }
          if (!store.watermarks) store.watermarks = {}
          if (!store.quarantine) store.quarantine = {}
          if (!store.sessions) store.sessions = {}
          if (!store.days) store.days = {}
          if (!store.months) store.months = {}
          if (!store.stats) store.stats = emptyStore().stats
          log(`store loaded: ${STORE_FILE} | sessions ${Object.keys(store.requests).length}`)
          return
        }
      }
    } catch (e) {
      log(`store load failed (starting fresh): ${e && e.message || e}`)
    }
    store = emptyStore()
    store.storeFile = STORE_FILE
    store.sessionsRoot = join(DSHDIR, 'sessions')
  }

  // 两类数据,两种写策略:
  //  - 配置(prices/budget/webPagePath/retention):用户数据,不可由日志重建 → 立即落盘;
  //  - 扫描产物(聚合/水位线/请求记录):可重建缓存 → 合并写(最短 SAVE_MIN_INTERVAL
  //    一次),退出时兜底 flush;崩溃丢失的只是下次启动的重扫量。
  let lastSaveAt = 0
  let saveTimer = null
  let pendingFlush = false
  function writeStore() {
    try {
      mkdirSync(STORE_DIR, { recursive: true })
      // 原子写:先落临时文件再改名,写一半崩溃不会损坏 store.json
      const tmp = `${STORE_FILE}.tmp`
      writeFileSync(tmp, JSON.stringify(store))
      renameSync(tmp, STORE_FILE)
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

  // ---------------- 页面 ----------------
  // 按 (path, mtime) 失效:编辑 web/index.html 后刷新即生效,免重启。
  function pageHtml() {
    const path = (store.config && store.config.webPagePath) || DEFAULT_PAGE
    try {
      const mtimeMs = statSync(path).mtimeMs
      if (pageCache && pageCache.path === path && pageCache.mtimeMs === mtimeMs) return pageCache
      const html = readFileSync(path, 'utf8')
      pageCache = { path, mtimeMs, html, gz: gzipSync(Buffer.from(html)) }
      return pageCache
    } catch (e) {
      logErr(`page read failed (${path}): ${e && e.message || e}`)
      return null
    }
  }

  // ---------------- 扫描 ----------------
  let pendingForce = false
  function scan(force) {
    if (scanPromise) {
      // 已有扫描在跑:记下强制诉求,本轮结束后立即补跑一次 force,
      // 避免"迁移全量/手动强制"被进行中的周期扫描吞掉
      if (force) pendingForce = true
      return scanPromise
    }
    if (!store) loadStore()
    scanPromise = scanStore(store, persistence, { force: !!force, logger: log })
      .then((summary) => {
        // 迁移标记只有在 forced 扫描确实跑完后才清除;失败/被合并时下次启动重试
        if (summary.forced && store.needsFullScan) store.needsFullScan = false
        // 只有确实发生变化(或强制)时才安排落盘:空闲周期零写放大
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

  // ---------------- HTTP 路由 ----------------
  function json(res, code, payload) {
    try {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end(JSON.stringify(payload))
    } catch (e) { /* ignore */ }
  }

  // 防 CSRF:带 Origin 头的 POST 必须与 Host 头完全一致;无 Origin(curl)放行。
  // 防 DNS rebinding:rebinding 攻击下 Origin.host 与 Host 恰好相等(都是攻击
  // 域名),同源等式恒真 —— 因此同源还要求 Host 本身可信:仅接受回环名与
  // IP 字面量(直连 IP 无法被 DNS 重绑定);域名 Host 的 POST 一律拒绝。
  function isLocalishHost(host) {
    let h = String(host || '').trim().toLowerCase()
    const m = /^\[(.+)\](:\d+)?$/.exec(h)
    if (m) h = m[1]
    else { const c = h.lastIndexOf(':'); if (c > 0 && h.indexOf(':') === c) h = h.slice(0, c) }
    if (h === 'localhost' || h.endsWith('.localhost')) return true
    if (/^127\.\d+\.\d+\.\d+$/.test(h) || h === '::1' || h.startsWith('::ffff:127.')) return true
    return net.isIP(h) !== 0
  }
  function sameOrigin(req) {
    const o = req.headers.origin
    if (!o) return true
    let oh
    try { oh = new URL(o).host } catch (e) { return false }
    const hh = String(req.headers.host || '')
    return oh === hh && isLocalishHost(hh)
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
      if (method === 'POST') {
        if (!sameOrigin(req)) { json(res, 403, { error: 'cross-origin request rejected' }); return }
        if (name === 'scan') { json(res, 200, { ok: true, summary: await scan(false) }); return }
        if (name === 'config') {
          let body
          try { body = await readJsonBody(req) }
          catch (e) { json(res, (e && e.statusCode) || 400, { error: (e && e.message) || 'bad request' }); return }
          try {
            const cfg = applyConfigPatch(store, body)
            saveStore({ immediate: true }) // 配置是用户数据,立即落盘
            json(res, 200, cfg)
          } catch (e) { json(res, 400, { error: (e && e.message) || String(e) }) }
          return
        }
        json(res, 404, { error: 'unknown POST api' }); return
      }
      if (method !== 'GET') { json(res, 405, { error: 'method not allowed' }); return }
      const result = apiDispatch(store, name, query, null, { metaExtra: metaExtra() })
      if (result.status === 404) { json(res, 404, JSON.parse(result.body)); return }
      const headers = { 'Content-Type': result.contentType, 'Cache-Control': 'no-store', ...(result.headers || {}) }
      res.writeHead(result.status, headers)
      res.end(result.body)
    }
    run().catch((e) => { try { json(res, (e && e.statusCode) || 500, { error: String(e) }) } catch (e2) { /* ignore */ } })
  }

  function readJsonBody(req, limit = BODY_LIMIT) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (c) => {
        size += c.length
        if (size > limit) {
          // 超限:reject 的同时把剩余 body 排空(flowing 模式无监听即丢弃),
          // 避免半截 body 留在 keep-alive 连接上与下一个请求串流;
          // 413 响应仍可正常送达
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

  // ---------------- 命令 ----------------
  const fmtTok = (n) => { if (!isFinite(n)) return '0'; if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return String(Math.round(n)) }
  const fmtYuan = (n) => { if (!isFinite(n)) return '0.00'; return n.toFixed(2) }
  const fmtPct = (x) => (isFinite(x) ? (x * 100).toFixed(1) + '%' : '0%')
  function commandText(rawInput) {
    const arg = String(rawInput || '').trim()
    const k = kpiQuery(store, arg || 'all', null, null, makeFilter(null))
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

  // ---------------- API 服务 ----------------
  // 配置面(单价表)需要的「当前配置的模型」。每次调用现读 settings:配置随时会变,
  // 缓存反而会让"刚删掉一个模型"不生效。读不到就返回 null —— 前端据此**关闭过滤**
  // 显示全部,绝不把界面清空。
  // 只把 provider:model 标识交给前端,settings 原文(含凭据相关字段)绝不进载荷。
  let warnedNoRoster = false
  function configuredModels() {
    try {
      const settings = ctx.get('settings')
      if (!settings || typeof settings.describe !== 'function') return null
      const descriptors = settings.describe({ redactSecrets: true })
      const parsed = configuredModelsFrom(descriptors)
      if (!parsed && !warnedNoRoster) {
        warnedNoRoster = true
        // 诊断只记**命名空间名**,不含任何值 —— 凭据/环境变量名绝不进日志。
        // 出现这行说明 settings 里的模型目录形态与预期不同:前端会自动关闭过滤
        // 退回"显示全部",功能不受影响,只是不会隐藏已删除的模型。
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
      pagePath: (store.config && store.config.webPagePath) || DEFAULT_PAGE,
      configuredModels: configuredModels(),
    }
  }

  const api = {
    scan: (args) => scan(args && args.force),
    kpi: (args) => kpiQuery(store, (args && args.range) || 'all', args && args.from, args && args.to, makeFilter(args)),
    series: (args) => apiDispatch(store, 'series', args || {}).body,
    hours: (args) => apiDispatch(store, 'hours', args || {}).body,
    heatmap: (args) => apiDispatch(store, 'heatmap', args || {}).body,
    sessions: (args) => apiDispatch(store, 'sessions', args || {}).body,
    sessionDetail: (args) => apiDispatch(store, 'session', args || {}).body,
    config: () => configView(store),
    meta: () => apiDispatch(store, 'meta', {}, null, { metaExtra: metaExtra() }).body,
  }

  // ---------------- 装配与生命周期 ----------------
  loadStore()
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
  if (timer) {
    try { disposers.push(timer.interval(() => { void scan(false) }, 5 * 60 * 1000)) }
    catch (e) { logErr('interval failed:', String(e)) }
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      for (const d of disposers) { try { d() } catch (e) { /* ignore */ } }
      flushPendingSave() // 合并中的扫描产物在退出前落盘
    })
  }

  // 启动:仅 store 版本迁移(v2→v3)时做一次全量;常规启动走增量,秒级完成。
  // needsFullScan 由 scan() 在 forced 扫描真正跑完后清除(排队也不会丢)。
  const start = async () => {
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
