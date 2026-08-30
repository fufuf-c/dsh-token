/**
 * dsh-token — Host 壳端到端冒烟(零依赖,临时 DSH_HOME + 真 http 栈)
 * 覆盖:gzip 页面、+ 空格解码、q 服务端搜索、同源校验(跨源/rebinding/本机)、
 *       安全头(CSP/nosniff)、body 上限、webPagePath 校验、
 *       页面 mtime 失效、HEAD、脏标记落盘。
 * 运行:node scripts/e2e-smoke.mjs(退出码非 0 即失败)
 */
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { gunzipSync } from 'node:zlib'
import assert from 'node:assert/strict'

const T = Date.now() - 3600 * 1000
const home = mkdtempSync(join(tmpdir(), 'dsh-token-e2e-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'sessions'), { recursive: true })

// ---- 假 DSH 环境 ----
const sessions = {
  'sess-1': {
    revision: 1,
    meta: { id: 'sess-1', cwd: 'C:\\My Projects\\demo' },
    events: [
      { type: 'request/header', seq: 1, time: T, data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-chat' } } } },
      { type: 'assistant/message', seq: 2, time: T + 1000, data: { turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 300 } } },
    ],
  },
  'sess-2': {
    revision: 1,
    meta: { id: 'sess-2', cwd: 'C:\\other' },
    events: [
      { type: 'request/header', seq: 1, time: T + 5000, data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-chat' } } } },
      { type: 'assistant/message', seq: 2, time: T + 6000, data: { turn: 1, step: 1, usage: { inputTokens: 800, outputTokens: 20, cacheReadTokens: 100 } } },
    ],
  },
}
const persistence = {
  async listSnapshots() { return Object.keys(sessions).map((id) => ({ header: { id }, revision: sessions[id].revision })) },
  async readFrom(id) { return { events: sessions[id].events, meta: sessions[id].meta } },
  locate: (meta) => ({ path: meta.cwd || 'X:\\unknown' }),
}

const pluginPath = fileURLToPath(new URL('../lib/index.js', import.meta.url))
const plugin = await import(`file:///${pluginPath.replace(/\\/g, '/')}`)

let routeHandler = null
const ctx = {
  get(name) {
    if (name === 'sessionPersistence') return persistence
    if (name === 'webServer') return { register: (h) => { routeHandler = h.handler; return () => {} } }
    if (name === 'timer') return { interval: () => () => {} }
    return undefined
  },
  provide: () => () => {},
  effect: () => () => {},
}

assert.equal(plugin.name, 'dsh-token')
plugin.apply(ctx)
assert.ok(routeHandler, 'route should be registered')
await new Promise((r) => setTimeout(r, 150)) // 等启动扫描完成

const server = http.createServer((req, res) => routeHandler(req, res))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`
let pass = 0
const ok = (name) => { pass++; console.log(`✓ ${name}`) }

// 1. 页面 gzip(fetch/undici 会透明解压,这里用原始请求拿字节)
{
  const raw = await new Promise((resolve, reject) => {
    const u = new URL(base + '/dsh-token')
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, headers: { 'accept-encoding': 'gzip' } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.end()
  })
  assert.equal(raw.headers['content-encoding'], 'gzip')
  const html = gunzipSync(raw.body).toString('utf8')
  assert.ok(html.includes('dsh-token'))
  ok(`页面 gzip(${raw.body.length} bytes 上线)`)
}
// 2. HEAD 无 body
{
  const res = await fetch(base + '/dsh-token', { method: 'HEAD' })
  assert.equal(res.status, 200)
  assert.equal((await res.arrayBuffer()).byteLength, 0)
  ok('HEAD 无响应体')
}
// 3. KPI 正常
{
  const k = await (await fetch(base + '/dsh-token/api/kpi?range=all')).json()
  assert.equal(k.totals.requests, 2)
  ok('kpi 数据正确')
}
// 4. 查询串 + 解码:wd 前缀含空格(URLSearchParams 口径)
{
  const k = await (await fetch(base + '/dsh-token/api/kpi?range=all&wd=' + encodeURIComponent('C:\\My Projects'))).json()
  assert.equal(k.totals.requests, 1, `含空格 wd 筛选应命中 1 条,实际 ${k.totals.requests}`)
  ok('查询串 + 按空格解码(URLSearchParams 口径)')
}
// 4b. 会话 q 服务端搜索(标题/工作目录/会话 ID 子串)
{
  const l = await (await fetch(base + '/dsh-token/api/sessions?q=' + encodeURIComponent('my projects'))).json()
  assert.equal(l.length, 1, `q 过滤应只命中 sess-1(My Projects),实际 ${l.length}`)
  ok('sessions q 服务端搜索')
}
// 5. 跨源 POST 拒绝
{
  const res = await fetch(base + '/dsh-token/api/config', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' })
  assert.equal(res.status, 403)
  ok('跨源 POST 403')
}
// 5b. DNS rebinding 形态:Origin 与 Host 同为攻击域名(同源等式恒真)也必须拒绝
{
  const res = await new Promise((resolve, reject) => {
    const u = new URL(base + '/dsh-token/api/config')
    const req = http.request({
      host: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'content-type': 'application/json', host: 'evil.example:3080', origin: 'http://evil.example:3080' },
    }, resolve)
    req.on('error', reject)
    req.end('{}')
  })
  assert.equal(res.statusCode, 403, 'Origin==Host 但 Host 非本机/IP,应按 rebinding 拒绝')
  ok('rebinding 形态(Origin==Host,域名非本机)403')
}
// 5c. 本机回环 Host 的同源 POST 放行
{
  const port = server.address().port
  const res = await new Promise((resolve, reject) => {
    const u = new URL(base + '/dsh-token/api/config')
    const req = http.request({
      host: '127.0.0.1', port, path: u.pathname, method: 'POST',
      headers: { 'content-type': 'application/json', host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` },
    }, resolve)
    req.on('error', reject)
    req.end('{}')
  })
  assert.equal(res.statusCode, 200)
  ok('本机同源 POST 200')
}
// 5d. CSP / nosniff 安全头
{
  const res = await fetch(base + '/dsh-token')
  assert.ok(String(res.headers.get('content-security-policy') || '').includes("default-src 'none'"), '页面应带 CSP')
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  ok('页面安全头(CSP + nosniff)')
}
// 6. webPagePath 非 .html 拒绝
{
  const res = await fetch(base + '/dsh-token/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ webPagePath: 'C:\\Users\\x\\id_rsa' }) })
  assert.equal(res.status, 400)
  ok('webPagePath 非 .html 400')
}
// 7. body 超限 413
{
  const big = JSON.stringify({ prices: { x: { miss: 1 }, pad: 'y'.repeat(1024 * 1024) } })
  const res = await fetch(base + '/dsh-token/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: big })
  assert.equal(res.status, 413)
  ok('超过 1MB body 413')
}
// 8. 合法配置 + retention 落盘
{
  const res = await fetch(base + '/dsh-token/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ retention: { days: 30 } }) })
  const cfg = await res.json()
  assert.deepEqual(cfg.retention, { days: 30 })
  const store = JSON.parse(readFileSync(join(home, 'dsh-token', 'store.json'), 'utf8'))
  assert.deepEqual(store.config.retention, { days: 30 })
  assert.equal(existsSync(join(home, 'dsh-token', 'store.json.tmp')), false, '原子写不留临时文件')
  ok('config 部分补丁 + 原子落盘')
}
// 9. 页面 mtime 失效:编辑默认页后刷新即生效
{
  const pagePath = join(dirname(pluginPath), '..', 'web', 'index.html')
  const before = await (await fetch(base + '/dsh-token')).text()
  assert.ok(before.includes('dsh-token'))
  appendFileSync(pagePath, '<!-- e2e touch -->')
  const after = await (await fetch(base + '/dsh-token')).text()
  assert.ok(after.includes('<!-- e2e touch -->'), 'mtime 变化后应重新读盘')
  writeFileSync(pagePath, readFileSync(pagePath, 'utf8').replace('<!-- e2e touch -->', ''))
  ok('页面编辑后刷新即生效(mtime 失效)')
}
// 10. 404
{
  const res = await fetch(base + '/dsh-token/api/nope')
  assert.equal(res.status, 404)
  ok('未知 API 404')
}

server.close()
rmSync(home, { recursive: true, force: true })
console.log(`\n✔ e2e 冒烟通过:${pass} 项`)
process.exit(0)
