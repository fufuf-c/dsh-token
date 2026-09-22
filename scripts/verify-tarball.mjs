/**
 * dsh-token — 打包产物验收(可选,零依赖)
 *
 * 用途:把 `npm pack` 出来的 tarball 解到一个**全新目录**,当作"用户刚装完"来验:
 *   1. 文件清单与 package.json 的 main/exports 逐一对得上;
 *   2. 用解包后的路径(而不是仓库路径)加载 Host 半区,跑一次真实扫描 + HTTP 请求;
 *   3. 断言 tarball 里没有多带开发期文件(test/、scripts/、.tgz 自己)。
 *
 * 与 e2e-smoke.mjs 的区别:那个验的是"仓库里的代码",这个验的是"用户装到手里的字节"。
 * 用法:node scripts/verify-tarball.mjs [path/to/pkg.tgz]
 */
import http from 'node:http'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { mkdtempSync, mkdirSync, readFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')
const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'))
const tgz = process.argv[2] ? resolve(process.argv[2]) : join(pkgRoot, `fufuf-c-dsh-token-${pkg.version}.tgz`)
assert.ok(existsSync(tgz), `找不到 tarball:${tgz}(先跑 npm pack)`)

const work = mkdtempSync(join(tmpdir(), 'dtk-tarball-'))
execFileSync('tar', ['-xzf', tgz, '-C', work], { stdio: 'inherit' })
const root = join(work, 'package')

// 1. 清单:声明为入口的文件必须真的在包里
for (const rel of [pkg.main, pkg.exports['.'], pkg.exports['./client'], pkg.dsh.bundle.patch, 'README.md', 'LICENSE', 'web/index.html']) {
  assert.ok(existsSync(join(root, rel)), `tarball 里缺少 ${rel}`)
}
// 2. 清单:不该出现的东西
const all = readdirSync(root, { recursive: true }).map((p) => String(p).replace(/\\/g, '/'))
for (const bad of all.filter((p) => /^(test|scripts)\//.test(p) || p.endsWith('.tgz') || p.endsWith('.map'))) {
  assert.fail(`tarball 不应包含开发期文件:${bad}`)
}
/* 只数**文件**,不数目录。原先写 `!p.endsWith('/')`,但 Windows 上
   readdirSync(recursive) 对目录**不带**尾斜杠,于是 `lib` 和 `web` 被算成文件 ——
   日志里报 13 而 npm pack 报 11,一个纯显示错误也能让人怀疑安装是不是缺文件。 */
const fileCount = all.filter((p) => existsSync(join(root, p)) && !statSync(join(root, p)).isDirectory()).length
console.log(`✓ 文件清单正确(${fileCount} 个文件,无开发期文件)`)

// 3. 真实跑一次:用解包后的路径加载插件
const home = mkdtempSync(join(tmpdir(), 'dtk-tarball-home-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'sessions'), { recursive: true })
const T = Date.now() - 60_000
const persistence = {
  async list() { return [{ header: { id: 's1' }, revision: 1 }] },
  async open() {
    return {
      header: { id: 's1', cwd: 'C:\\verify' },
      read: async () => ({ events: [
        { type: 'request/header', seq: 1, time: T, data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } } } },
        { type: 'assistant/message', seq: 2, time: T + 1000, data: { turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 200 } } },
      ] }),
      close: async () => {},
    }
  },
  locate: (m) => ({ path: m.cwd }),
}
let route = null
const ctx = {
  get(name) {
    if (name === 'sessionPersistence') return persistence
    if (name === 'webServer') return { register: (h) => { route = h.handler; return () => {} } }
    if (name === 'timer') return { interval: () => () => {} }
    return undefined
  },
  provide: () => () => {},
  effect: () => () => {},
}
const plugin = await import(pathToFileURL(join(root, pkg.main)).href)
assert.equal(plugin.name, 'dsh-token')
plugin.apply(ctx)
assert.ok(route, '解包后的插件应能注册路由')
await new Promise((r) => setTimeout(r, 200))

const server = http.createServer((req, res) => route(req, res))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`
const kpi = await (await fetch(base + '/dsh-token/api/kpi?range=all')).json()
assert.equal(kpi.totals.requests, 1, '应扫描出 1 条请求')
assert.ok(kpi.totals.total > 0, '应有 token 统计')
assert.equal(typeof kpi.totals.unpricedTokens, 'number', 'kpi 必须带未定价字段(0.7.0 契约)')
const page = await fetch(base + '/dsh-token')
assert.equal(page.status, 200)
assert.ok((await page.text()).includes('dsh-token'))
const meta = await (await fetch(base + '/dsh-token/api/meta')).json()
assert.equal(meta.storeVersion, 8, 'store 版本应为 v8(落盘格式契约)')
// 0.9.0:落盘必须是**分片布局** —— store.json 只留元数据,记录在 shards/。
// 这里直接看盘上的事实,而不是只信 API 自述。
const metaFile = join(home, 'dsh-token', 'store.json')
assert.ok(existsSync(metaFile), 'store.json 应存在')
const onDisk = JSON.parse(readFileSync(metaFile, 'utf8'))
assert.equal(onDisk.requests, undefined, 'store.json 不得含 requests(应为元数据/索引)')
assert.ok(existsSync(join(home, 'dsh-token', 'shards')), 'shards/ 目录应存在')
const shardFiles = readdirSync(join(home, 'dsh-token', 'shards')).filter((f) => f.endsWith('.json'))
assert.equal(shardFiles.length, 1, `应有 1 个会话分片(实际 ${shardFiles.length})`)
const shard = JSON.parse(readFileSync(join(home, 'dsh-token', 'shards', shardFiles[0]), 'utf8'))
assert.equal(shard.id, 's1', '分片内应含原始会话 id')
assert.ok(Array.isArray(shard.rows) && shard.rows[0].length === 9, '分片应是 9 列紧凑行数组')
// v8:分片必须**自带模型表**(全局表会让局部重写错位,见 core.splitStore)
assert.ok(Array.isArray(shard.models), '分片必须自带 models 表')
assert.equal(onDisk.modelTable, undefined, 'store.json 不得再带全局 modelTable')
// 重启一次:分片必须能被读回(证明"写出的东西自己能读")
assert.ok(onDisk.sessions && onDisk.sessions.s1, '元数据里应保留会话(标题不丢)')
server.close()
rmSync(home, { recursive: true, force: true })
rmSync(work, { recursive: true, force: true })
console.log('✓ 解包后真实启动:扫描 / kpi / 页面 / meta 全部正常')
console.log(`\n✔ 打包产物验收通过:${tgz}`)
