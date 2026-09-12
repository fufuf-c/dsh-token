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
import { mkdtempSync, mkdirSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
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
console.log(`✓ 文件清单正确(${all.filter((p) => !p.endsWith('/')).length} 个文件,无开发期文件)`)

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
assert.equal(meta.storeVersion, 6, 'store 版本应为 v6')
server.close()
rmSync(home, { recursive: true, force: true })
rmSync(work, { recursive: true, force: true })
console.log('✓ 解包后真实启动:扫描 / kpi / 页面 / meta 全部正常')
console.log(`\n✔ 打包产物验收通过:${tgz}`)
