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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, rmSync, readdirSync } from 'node:fs'
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
// 假持久化后端按 DSH 0.1.5-rc.2 的句柄式契约:list() + open(id,'read')。
// 旧的 listSnapshots()/readFrom() 形状由 test/scan-store.test.mjs 的旧后端假件覆盖。
const persistence = {
  async list() { return Object.keys(sessions).map((id) => ({ header: { id }, revision: sessions[id].revision })) },
  async open(id) {
    return {
      id,
      header: sessions[id].meta,
      read: async () => ({ eventState: 'detached', events: sessions[id].events }),
      close: async () => {},
    }
  },
  locate: (meta) => ({ path: meta.cwd || 'X:\\unknown' }),
}

const pluginPath = fileURLToPath(new URL('../lib/index.js', import.meta.url))
const plugin = await import(`file:///${pluginPath.replace(/\\/g, '/')}`)

let routeHandler = null
/* 外观设置桩(可改):验证「外观偏好进页面缓存键」—— 用户改了深浅色而页面文件没动,
   注入的偏好也必须立刻换新,而不是把缓存里的旧值一直发出去。 */
const themeSettings = { preference: 'system' }
const ctx = {
  get(name) {
    if (name === 'sessionPersistence') return persistence
    if (name === 'webServer') return { register: (h) => { routeHandler = h.handler; return () => {} } }
    if (name === 'timer') return { interval: () => () => {} }
    if (name === 'settings') return { get: (ns) => (ns === 'ui-theme' ? themeSettings : undefined), describe: () => [] }
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
  // 宿主在发送时注入外观偏好:页面据此让「自动」跟随 DSH 外观,而不是只跟随操作系统
  const boot = '<script>window.__DSH_TOKEN_THEME__={"preference":"system"}</script>'
  assert.ok(html.includes(boot), '页面必须带宿主注入的外观偏好引导脚本')
  assert.ok(html.indexOf(boot) < html.indexOf('</head>'), '引导脚本必须在 head 内,先于页面自身脚本')
  ok(`页面 gzip(${raw.body.length} bytes 上线,含外观偏好注入)`)
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
// 9b. 外观偏好进缓存键:只改 DSH 设置、不动页面文件,注入的偏好也必须跟着换
{
  themeSettings.preference = 'dark'
  const dark = await (await fetch(base + '/dsh-token')).text()
  assert.ok(dark.includes('window.__DSH_TOKEN_THEME__={"preference":"dark"}'),
    'DSH 外观改成深色后,页面必须立刻下发新偏好(缓存键必须含偏好,否则会一直发旧值)')
  themeSettings.preference = 'light'
  const light = await (await fetch(base + '/dsh-token')).text()
  assert.ok(light.includes('window.__DSH_TOKEN_THEME__={"preference":"light"}'), '偏好改回浅色同样立刻生效')
  themeSettings.preference = 'system'
  const back = await (await fetch(base + '/dsh-token')).text()
  assert.ok(back.includes('window.__DSH_TOKEN_THEME__={"preference":"system"}'), '跟随系统同样立刻生效')
  ok('外观偏好变更即生效(页面缓存按偏好失效)')
}
// 10. 404
{
  const res = await fetch(base + '/dsh-token/api/nope')
  assert.equal(res.status, 404)
  ok('未知 API 404')
}
// 11. Host 白名单:同源但 Host 是本机可达私网 IP → 放行(bind 0.0.0.0 时经 LAN 访问)
{
  const port = server.address().port
  const post = (host) => new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: '/dsh-token/api/config', method: 'POST',
      headers: { 'content-type': 'application/json', host, origin: `http://${host}` },
    }, resolve)
    req.on('error', reject)
    req.end('{}')
  })
  assert.equal((await post(`192.168.1.9:${port}`)).statusCode, 200, '私网 IP Host 应放行')
  assert.equal((await post(`[::1]:${port}`)).statusCode, 200, 'IPv6 回环字面量应放行')
  ok('Host 白名单:回环名 / 私网 IP 字面量放行')
}
// 11b. Host 白名单:公网 IP 字面量与任意域名 → 拒绝(bind 0.0.0.0 时不允许裸公网 IP 写入配置)
{
  const port = server.address().port
  const post = (host) => new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: '/dsh-token/api/config', method: 'POST',
      headers: { 'content-type': 'application/json', host, origin: `http://${host}` },
    }, resolve)
    req.on('error', reject)
    req.end('{}')
  })
  assert.equal((await post(`203.0.113.7:${port}`)).statusCode, 403, '公网 IP 字面量 Host 应拒绝')
  assert.equal((await post(`evil.example:${port}`)).statusCode, 403, '域名 Host 应拒绝')
  assert.equal((await post(`localhost.evil.example:${port}`)).statusCode, 403, '后缀伪装域名应拒绝')
  ok('Host 白名单:公网 IP / 域名 / 后缀伪装一律拒绝')
}
// 12. store.json 形态不合规 → 改名留证 + 从会话日志重建,绝不静默清零
{
  const storeFile = join(home, 'dsh-token', 'store.json')
  writeFileSync(storeFile, JSON.stringify({ version: 6, requests: { s1: [{ t: 'oops', miss: 1 }] } }))
  // 重新 apply 一份新实例(模拟重启),共用同一个 DSH_HOME
  let route2 = null
  const ctx2 = {
    get(name) {
      if (name === 'sessionPersistence') return persistence
      if (name === 'webServer') return { register: (h) => { route2 = h.handler; return () => {} } }
      if (name === 'timer') return { interval: () => () => {} }
      return undefined
    },
    provide: () => () => {},
    effect: () => () => {},
  }
  plugin.apply(ctx2)
  assert.ok(route2, '重启后应重新注册路由')
  await new Promise((r) => setTimeout(r, 150))
  const dir = join(home, 'dsh-token')
  const kept = readdirSync(dir).filter((f) => f.includes('.corrupt-'))
  assert.equal(kept.length, 1, `不合格的 store 应被改名留证,实际留下 ${JSON.stringify(readdirSync(dir))}`)
  const server2 = http.createServer((req, res) => route2(req, res))
  await new Promise((r) => server2.listen(0, '127.0.0.1', r))
  const base2 = `http://127.0.0.1:${server2.address().port}`
  const kk = await (await fetch(base2 + '/dsh-token/api/kpi?range=all')).json()
  assert.equal(kk.totals.requests, 2, '应从会话日志重建出全部请求,而不是 0')
  server2.close()
  ok('store 形态不合规:改名留证 + 重建,不静默清零')
}
// 13. 未定价 tokens 必须显式报出(成本记 0 的部分不许混进"总成本")
{
  const port = server.address().port
  const cfg = await (await fetch(base + '/dsh-token/api/config', {
    method: 'POST', headers: { 'content-type': 'application/json', host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` },
    body: JSON.stringify({ prices: { 'deepseek-official:deepseek-chat': { miss: 1, hit: 1, write: 1, output: 1 } } }),
  })).json()
  assert.ok(cfg.prices['deepseek-official:deepseek-chat'], '自定义单价应生效')
  const kk = await (await fetch(base + '/dsh-token/api/kpi?range=all')).json()
  assert.equal(kk.totals.unpricedTokens, 0, '全部模型都有价时未定价量应为 0')
  assert.equal(typeof kk.totals.unpricedModelCount, 'number')
  ok('kpi 显式给出未定价 tokens 与模型数')
}

server.close()
rmSync(home, { recursive: true, force: true })
console.log(`\n✔ e2e 冒烟通过:${pass} 项`)
process.exit(0)
