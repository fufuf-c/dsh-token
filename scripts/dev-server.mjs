/**
 * dsh-token — 本地开发服务器(页面设计用)
 *
 * 用途:在不重启 DSH 的情况下调试仪表盘页面。页面与数据 API 挂到
 *   http://127.0.0.1:3980/dsh-token/
 * 数据默认读 $DSH_HOME/dsh-token/store.json(与正式插件同一份),只读;
 * POST /api/scan 在默认模式下返回占位说明,加 --live 后通过 profile 的
 * sessionPersistence 包做真实增量扫描(需能解析 @deepseek-ai 依赖)。
 *
 * 用法:
 *   node scripts/dev-server.mjs                    # 默认端口 3980,读真实 store
 *   node scripts/dev-server.mjs --page web/index.html --port 4100
 *   node scripts/dev-server.mjs --live             # 开启真实扫描(依赖 profile 安装)
 *   node scripts/dev-server.mjs --store C:\path\store.json --read-only
 */
import http from 'node:http'
import { readFileSync, existsSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import os from 'node:os'
import { apiDispatch, emptyStore, scanStore, applyConfigPatch } from '../lib/core.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def }
const has = (name) => args.includes(name)

const PORT = Number(opt('--port', '3980'))
const PAGE = resolve(opt('--page', join(__dir, '..', 'web', 'index.html')))
const STORE_FILE = resolve(opt('--store', join(process.env.DSH_HOME || join(os.homedir(), '.dsh'), 'dsh-token', 'store.json')))
const READ_ONLY = has('--read-only') && !has('--live')

function loadStore() {
  if (existsSync(STORE_FILE)) {
    try { return JSON.parse(readFileSync(STORE_FILE, 'utf8')) } catch (e) { console.error('store parse failed:', e.message) }
  }
  const s = emptyStore()
  s.storeFile = STORE_FILE
  s.sessionsRoot = join(process.env.DSH_HOME || join(os.homedir(), '.dsh'), 'sessions')
  return s
}

const store = loadStore()
console.log(`[dsh-token dev] page: ${PAGE}`)
console.log(`[dsh-token dev] store: ${STORE_FILE} (${store.requests ? Object.keys(store.requests).length : 0} sessions)`)
console.log(`[dsh-token dev] http://127.0.0.1:${PORT}/dsh-token/`)
if (READ_ONLY) console.log('[dsh-token dev] read-only: 配置变更不会写回')

let persistence = null
if (has('--live')) {
  try {
    const { Context } = await import('@deepseek-ai/cordis')
    const { JsonlSessionPersistence } = await import('@deepseek-ai/dsh-session-persistence-jsonl')
    const ctx = new Context({})
    ctx.provide('sessions', { list: () => [], get: () => undefined })
    persistence = new JsonlSessionPersistence(ctx, { root: store.sessionsRoot || join(os.homedir(), '.dsh', 'sessions'), compression: 'zstd' })
    console.log('[dsh-token dev] live persistence attached')
  } catch (e) { console.error('[dsh-token dev] --live unavailable (需要 profile 安装 @deepseek-ai/dsh-session-persistence-jsonl):', e.message) }
}

const html = () => readFileSync(PAGE, 'utf8')

http.createServer((req, res) => {
  const u = req.url || '/'
  const path = u.split('?')[0]
  const query = Object.fromEntries(new URLSearchParams(u.split('?')[1] || ''))
  const method = req.method || 'GET'
  const json = (code, payload) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(payload)) }

  if (path === '/dsh-token' || path === '/dsh-token/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(html())
    return
  }
  if (path.startsWith('/dsh-token/api/')) {
    const name = path.slice('/dsh-token/api/'.length)
    if (method === 'POST' && name === 'config') {
      if (READ_ONLY) { json(200, { note: 'read-only dev server; 正式环境请通过插件写入' }); return }
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        try {
          const cfg = applyConfigPatch(store, JSON.parse(body || '{}'))
          try {
            // 原子写,与正式插件同一份 store.json,不能写一半损坏
            const tmp = `${STORE_FILE}.tmp`
            mkdirSync(dirname(STORE_FILE), { recursive: true })
            writeFileSync(tmp, JSON.stringify(store))
            renameSync(tmp, STORE_FILE)
          } catch (e) { console.error('write failed:', e.message) }
          json(200, cfg)
        } catch (e) { json(400, { error: e.message }) }
      })
      return
    }
    if (method === 'POST' && name === 'scan') {
      if (!persistence) { json(200, { ok: true, summary: { note: 'dev read-only mode; use --live for real scan', changed: 0, totalSessions: Object.keys(store.requests).length } }); return }
      scanStore(store, persistence, { force: false }).then((summary) => json(200, { ok: true, summary })).catch((e) => json(500, { error: String(e) }))
      return
    }
    if (method !== 'GET') { json(405, { error: 'method not allowed' }); return }
    const result = apiDispatch(store, name, query, null, { nowMs: Date.now() })
    if (result.status === 404) { json(404, JSON.parse(result.body)); return }
    res.writeHead(result.status, { 'Content-Type': result.contentType, 'Cache-Control': 'no-store', ...(result.headers || {}) })
    res.end(result.body)
    return
  }
  json(404, { error: 'not found' })
}).listen(PORT, () => console.log(`[dsh-token dev] listening on ${PORT}`))
