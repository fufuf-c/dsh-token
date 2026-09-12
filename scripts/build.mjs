/**
 * dsh-token — 完整性校验(免构建):
 * 1. 关键文件存在;2. package.json dsh 字段合法;3. 各模块可解析
 * (core/session-source/design-tokens 直接 import;core 跑一次空 store 冒烟;
 * client 在无 window 环境应仅报 ReferenceError 而非语法错误;index 可 import
 * 且导出 name/apply);4. web/index.html 内联脚本语法。
 *
 * 注意:设计 token 的注入一致性由 `node scripts/build-tokens.mjs --check`
 * 与 test/design-consistency.test.mjs 负责(已挂在 npm test / prepack 上),
 * 这里不重复实现。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dir, '..')
const fail = (msg) => { console.error(`✗ ${msg}`); process.exitCode = 1 }
const ok = (msg) => console.log(`✓ ${msg}`)

// 1. 文件存在
for (const f of [
  'package.json', 'cordis.patch.yml',
  'lib/index.js', 'lib/core.mjs', 'lib/session-source.mjs', 'lib/design-tokens.mjs', 'lib/client.js',
  'web/index.html', 'README.md', 'LICENSE',
]) {
  if (!existsSync(join(root, f))) fail(`missing file: ${f}`)
}
ok('关键文件存在')

// 2. package.json dsh 字段
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (!pkg.dsh?.bundle?.patch) fail('dsh.bundle.patch missing')
if (pkg.dsh?.client?.platform !== 'web') fail('dsh.client.platform must be "web"')
if (!existsSync(join(root, pkg.dsh.bundle.patch))) fail(`patch missing: ${pkg.dsh.bundle.patch}`)
ok('package.json dsh 字段合法')

// 3. cordis.patch.yml 行合法
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
if (!/name:\s*['"]@fufuf-c\/dsh-token['"]/.test(patch)) fail('patch row missing name @fufuf-c/dsh-token')
ok('cordis.patch.yml 合法')

// 4. core.mjs 可运行
try {
  const core = await import('../lib/core.mjs')
  const s = core.emptyStore()
  core.rebuildAll(s)
  const k = core.kpiQuery(s, 'all', null, null, core.makeFilter(null))
  if (k.totals.requests !== 0) throw new Error('kpi shape')
  ok('lib/core.mjs 纯函数冒烟通过')
} catch (e) { fail(`lib/core.mjs: ${e.message}`) }

// 5. session-source.mjs 可解析(扫描层,不真正扫描:没有 persistence 服务)
try {
  const scan = await import('../lib/session-source.mjs')
  if (typeof scan.scanStore !== 'function') throw new Error('scanStore missing')
  // 能力探测两条路都要在:缺 list()/listSnapshots() 时应当抛而不是静默返回空
  let threw = false
  try { await scan.listSnapshotsOf({}) } catch (e) { threw = true }
  if (!threw) throw new Error('listSnapshotsOf 应对无法识别的 persistence 抛错')
  ok('lib/session-source.mjs 扫描层可解析,能力探测按预期抛错')
} catch (e) { fail(`lib/session-source.mjs: ${e.message}`) }

// 6. index.js 可 import 且为 cordis 插件形
try {
  const mod = await import('../lib/index.js')
  if (mod.name !== 'dsh-token' || typeof mod.apply !== 'function') throw new Error('plugin shape')
  ok('lib/index.js 插件形:name/apply')
} catch (e) { fail(`lib/index.js: ${e.message}`) }

// 7. client.js 语法(期望 ReferenceError: window 未定义,而非 SyntaxError)
try {
  await import('../lib/client.js')
  fail('lib/client.js 在无 window 环境不应成功执行')
} catch (e) {
  if (e instanceof SyntaxError || /SyntaxError/.test(String(e))) fail(`lib/client.js syntax: ${e.message}`)
  else ok('lib/client.js 语法通过(运行时按预期缺 window)')
}

// 8. web/index.html 内联脚本语法(不执行,只编译)
try {
  const html = readFileSync(join(root, 'web/index.html'), 'utf8')
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  let m, n = 0
  while ((m = re.exec(html))) {
    const attrs = m[1] || ''
    if (/\bsrc\s*=/i.test(attrs)) continue
    const tm = /type\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)
    if (tm && !/^(text\/javascript|module|application\/javascript)$/i.test(tm[1])) continue
    n++
    try { new vm.Script(m[2], { filename: `web/index.html inline#${n}` }) }
    catch (e) { throw new Error(`inline#${n}: ${e.message}`) }
  }
  if (!n) fail('web/index.html 未找到内联脚本(页面被改坏了?)')
  else ok(`web/index.html 内联脚本语法通过(${n} 段)`)
} catch (e) { fail(`web/index.html 内联脚本: ${e.message}`) }

if (process.exitCode) {
  console.error('\nbuild 校验未全部通过')
} else {
  console.log('\n✔ build 校验通过 — 可 npm pack / 发布')
}
