/**
 * 端到端扫描冒烟:用 DSH 0.1.5-rc.2 真实的 session-persistence-jsonl 后端
 * 驱动 lib/core.mjs 的 scanStore,读取 ~/.dsh/sessions 下的真实会话日志。
 *
 * 该脚本定位为「跨版本兼容回归」:它在真实服务实现上验证 list/read 适配层,
 * 而不是用 mock 假装 API 存在 —— 这正是 0.1.5-rc.2 破坏插件的那一层。
 *
 * 解析不到 DSH 安装时跳过(退出码 0),不阻塞无 DSH 环境的运行。
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const require = createRequire(import.meta.url)
const DSH_ROOT = process.env.DSH_PKG_ROOT
  || 'C:/Users/Administrator/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh'
const NM = join(DSH_ROOT, 'node_modules')

if (!existsSync(NM)) {
  console.log('[skip] DSH node_modules not found at', NM)
  process.exit(0)
}

const { Context } = await import(pathToFileURL(join(NM, '@deepseek-ai/cordis/lib/index.js')).href)
const { default: JsonlPersistence } = await import(pathToFileURL(join(NM, '@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js')).href)
// LIB 可指向别处的副本(如 profile 里已安装的那份),默认用本仓库的源码。
// Windows 绝对路径必须转成 file:// URL 才能被 ESM loader 接受。
const LIB_SPEC = process.env.DSH_TOKEN_LIB || new URL('../lib/core.mjs', import.meta.url).href
const LIB = /^[a-zA-Z]:[\\/]/.test(LIB_SPEC) ? pathToFileURL(LIB_SPEC).href : LIB_SPEC
const { emptyStore, scanStore, kpiQuery, makeFilter, apiDispatch } = await import(LIB)
console.log('core.mjs:', LIB)

const DSH_HOME = process.env.DSH_HOME || join(os.homedir(), '.dsh')
const SESSIONS = join(DSH_HOME, 'sessions')

const ctx = new Context()
ctx.plugin(JsonlPersistence, { root: SESSIONS })

// 等待服务就绪(cordis 的 fork 是同步交付的,服务在微任务后可见)
for (let i = 0; i < 200 && !ctx.sessionPersistence; i++) await new Promise((r) => setTimeout(r, 10))
const persistence = ctx.sessionPersistence
if (!persistence) {
  console.error('FAIL: sessionPersistence service did not start')
  process.exit(1)
}

console.log('persistence API:', {
  list: typeof persistence.list,
  listSnapshots: typeof persistence.listSnapshots,
  open: typeof persistence.open,
  readFrom: typeof persistence.readFrom,
  locate: typeof persistence.locate,
})

const snaps = await (typeof persistence.list === 'function' ? persistence.list() : persistence.listSnapshots())
console.log('snapshots:', snaps.length)

const store = emptyStore()
const summary = await scanStore(store, persistence, { force: true, logger: (...m) => console.log('  [scan]', ...m) })
console.log('summary:', JSON.stringify(summary))

const k = kpiQuery(store, 'all', null, null, makeFilter(null))
console.log('kpi totals:', JSON.stringify(k.totals))
console.log('activeSessions:', k.activeSessions, 'hitRate:', k.hitRate, 'models:', k.models.map((m) => m.key))

// 形状断言:失败时以非零码退出,便于在 CI/本地当作回归测试
const problems = []
if (!summary.ok) problems.push('scanStore reported !ok: ' + summary.error)
// 被宿主确定性拒绝的老格式会话(如 v0 里含插件注入的非标准成员)读不了是宿主的
// 限制,不是插件缺陷 —— 要求它们全部进入隔离,而不是要求零失败。
if (summary.quarantined !== summary.failed) {
  problems.push(`deterministic failures not all quarantined: failed=${summary.failed} quarantined=${summary.quarantined}`)
}
if (snaps.length > 0 && summary.scanned === 0) problems.push('no session scanned despite snapshots')
if (!(k.totals.requests > 0)) problems.push('kpi requests is 0')
if (!(k.totals.total > 0)) problems.push('kpi total tokens is 0')
const csv = apiDispatch(store, 'export.csv', { range: 'all' }).body
if (!csv.startsWith('date,model')) problems.push('export.csv shape wrong')

if (problems.length) {
  console.error('\nFAIL:\n - ' + problems.join('\n - '))
  process.exit(1)
}
console.log(`\nOK: real-backend scan works end to end (sessions ${summary.scanned}, failed/quarantined ${summary.failed})`)
process.exit(0)
