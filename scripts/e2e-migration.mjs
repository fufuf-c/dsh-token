/**
 * 端到端迁移冒烟:用真实旧版 store + 真实会话日志,验证
 *   1) index.js 的宿主外壳能在 0.1.5-rc.2 的真实持久化服务上启动(不再静默失效);
 *   2) store 版本落后时自动触发一次全量重扫,并落盘为当前 STORE_VERSION;
 *   3) 语义修正(如 miss 口径、官方分档单价)把历史数据一并纠正。
 *
 * 做法:临时 DSH_HOME + 指向真实 ~/.dsh/sessions 的 junction,并复制真实
 * store.json 进去 —— 全程不碰正在运行的 web 服务与其真实 store。
 *
 * 解析不到 DSH 或找不到真实 store 时跳过(退出码 0)。
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { existsSync, mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { STORE_VERSION } from '../lib/core.mjs'

const DSH_ROOT = process.env.DSH_PKG_ROOT
  || 'C:/Users/Administrator/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh'
const NM = join(DSH_ROOT, 'node_modules')
const REAL_HOME = process.env.REAL_DSH_HOME || join(process.env.USERPROFILE || '', '.dsh')
const REAL_STORE = join(REAL_HOME, 'dsh-token', 'store.json')
const REAL_SESSIONS = join(REAL_HOME, 'sessions')

for (const [what, p] of [['DSH node_modules', NM], ['real store.json', REAL_STORE], ['real sessions', REAL_SESSIONS]]) {
  if (!existsSync(p)) {
    console.log(`[skip] ${what} not found at ${p}`)
    process.exit(0)
  }
}

const before = JSON.parse(readFileSync(REAL_STORE, 'utf8'))
if (before.version === STORE_VERSION) {
  console.log(`[skip] real store is already v${STORE_VERSION}; nothing to migrate`)
  process.exit(0)
}
if (!(before.version < STORE_VERSION)) {
  console.log(`[skip] real store v${before.version} is newer than v${STORE_VERSION}`)
  process.exit(0)
}
console.log(`real store: version ${before.version} → ${STORE_VERSION}, requests sessions ${Object.keys(before.requests || {}).length}`)

// 临时 home:store 副本 + 指向真实会话目录的 junction(sessions 只读使用)
const home = mkdtempSync(join(tmpdir(), 'dsh-token-migrate-'))
mkdirSync(join(home, 'dsh-token'), { recursive: true })
copyFileSync(REAL_STORE, join(home, 'dsh-token', 'store.json'))
execFileSync('cmd.exe', ['/c', 'mklink', '/J', join(home, 'sessions'), REAL_SESSIONS], { stdio: 'ignore' })

process.env.DSH_HOME = home
const { Context } = await import(pathToFileURL(join(NM, '@deepseek-ai/cordis/lib/index.js')).href)
const { default: JsonlPersistence } = await import(pathToFileURL(join(NM, '@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js')).href)
const plugin = await import('../lib/index.js')

const app = new Context()
app.plugin(JsonlPersistence, { root: join(home, 'sessions') })
for (let i = 0; i < 300 && !app.sessionPersistence; i++) await new Promise((r) => setTimeout(r, 10))
const persistence = app.sessionPersistence
if (!persistence) {
  console.error('FAIL: real persistence service did not start')
  process.exit(1)
}

let routeHandler = null
let scanned = null
const ctx = {
  get(name) {
    if (name === 'sessionPersistence') return persistence
    if (name === 'webServer') return { register: (h) => { routeHandler = h.handler; return () => {} } }
    if (name === 'commands') return { register: () => () => {} }
    if (name === 'timer') return { interval: () => () => {} }
    return undefined
  },
  provide: () => () => {},
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
}

plugin.apply(ctx)
if (!routeHandler) {
  console.error('FAIL: /dsh-token route was not registered')
  process.exit(1)
}

// 等启动全量扫描 + 落盘(轮询 store.json 变成当前 STORE_VERSION)
const storeFile = join(home, 'dsh-token', 'store.json')
const deadline = Date.now() + 300000
let after = null
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 500))
  try {
    const cur = JSON.parse(readFileSync(storeFile, 'utf8'))
    if (cur.version === STORE_VERSION && cur.stats && cur.stats.lastSummary && cur.stats.lastSummary.forced) { after = cur; break }
  } catch (e) { /* 写一半/尚未落盘 */ }
}

if (!after) {
  console.error(`FAIL: store was not migrated to v${STORE_VERSION} within 300s`)
  rmSync(home, { recursive: true, force: true })
  process.exit(1)
}

scanned = after.stats.lastSummary
const sum = (store) => {
  let miss = 0, read = 0, out = 0, req = 0
  for (const id of Object.keys(store.requests || {})) for (const r of store.requests[id]) { miss += r.miss; read += r.read; out += r.out; req++ }
  return { miss, read, out, req }
}
const sumCost = (store) => Object.values(store.months || {}).reduce((s, m) => s + m.totals.cost, 0)
const b = sum(before)
const a = sum(after)
const bc = sumCost(before), ac = sumCost(after)
console.log('migration summary:', JSON.stringify(scanned))
console.log(`store totals before v${before.version}:`, JSON.stringify(b))
console.log(`store totals after  v${STORE_VERSION}:`, JSON.stringify(a))
console.log(`cost before ¥${bc.toFixed(2)} → after ¥${ac.toFixed(2)}`)
// 注意:这里的对比只作冒烟断言。旧 store 停止更新期间的会话会在本次全量重扫中
// 一并计入,所以 miss/req 的增长**不能**当作口径修正的幅度 —— 精确幅度需要在同一份
// 日志上 A/B(v3→v4 实测 177/11022 条被少算,miss +3.87%)。

const problems = []
if (after.version !== STORE_VERSION) problems.push(`store version is not ${STORE_VERSION}`)
if (!scanned.forced) problems.push('migration did not run a forced full scan')
if (scanned.quarantined !== scanned.failed) problems.push(`deterministic failures were not all quarantined: failed=${scanned.failed} quarantined=${scanned.quarantined}`)
if (scanned.scanned < 200) problems.push(`only ${scanned.scanned} sessions scanned, expected the full library`)
if (!(a.req >= b.req)) problems.push(`request count regressed: ${b.req} -> ${a.req}`)
if (!(a.miss >= b.miss)) problems.push(`miss count regressed: ${b.miss} -> ${a.miss}`)
if (!after.quarantine || Object.keys(after.quarantine).length !== scanned.quarantined) problems.push('quarantine map does not match the summary')
// 价格语义变更必须真正重算成本:新价目远低于旧价(旧 hit 0.5 是 deepseek-chat 的价)
if (before.version < 5 && !(ac < bc * 0.5)) problems.push(`cost was not repriced on migration: ¥${bc.toFixed(2)} -> ¥${ac.toFixed(2)}`)
if (!(ac > 0)) problems.push('cost is zero after migration')

rmSync(home, { recursive: true, force: true })
if (problems.length) {
  console.error('\nFAIL:\n - ' + problems.join('\n - '))
  process.exit(1)
}
console.log(`\nOK: v${before.version} → v${STORE_VERSION} migration + full rescan + repricing + quarantine on the real 0.1.5-rc.2 backend`)
console.log(`requests ${b.req} → ${a.req} · miss ${b.miss} → ${a.miss} · cost ¥${bc.toFixed(2)} → ¥${ac.toFixed(2)} · quarantined ${scanned.quarantined}`)
process.exit(0)
