/**
 * 端到端对照:真实 `scanStore` 路径下,改 N 个会话的扫描耗时(0.9.5 增量 vs 全量)。
 *
 * 与 bench-incremental.mjs 的区别:那个只测 `incrementalRebuildInto` 本身;这个走完整的
 * 扫描 —— 列快照、比水位线、读会话、fold、聚合收尾 —— 也就是用户真正感觉到的那段时间。
 *
 * 用法:node scripts/bench-scan-e2e.mjs [会话数] [每会话请求数] [改动会话数]
 */
import { emptyStore, kpiQuery, makeFilter } from '../lib/core.mjs'
import { scanStore } from '../lib/session-source.mjs'

const NSESS = Number(process.argv[2] || 400)
const PER = Number(process.argv[3] || 500)
const TOUCH = Number(process.argv[4] || 2)
const MODELS = ['deepseek-official:deepseek-flash', 'deepseek-official:deepseek-v4-pro', 'local:a', 'local:b']

let seed = 20260921
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }

const T0 = Date.UTC(2026, 6, 1)

/** 造一个会话的"事件流",readFrom 时被 foldSession 折叠。 */
function makeEvents(id, n, dayOff) {
  const out = [{ type: 'request/header', seq: 1, time: T0 + dayOff * 86400000, data: { header: { config: { provider: MODELS[0].split(':')[0], model: MODELS[0].split(':')[1] } } } }]
  let seq = 2
  for (let i = 0; i < n; i++) {
    out.push({
      type: 'assistant/message', seq: seq++, time: T0 + dayOff * 86400000 + i * 60000,
      data: { turn: i + 1, step: 1, usage: { inputTokens: Math.floor(rnd() * 40000), outputTokens: Math.floor(rnd() * 8000), cacheReadTokens: Math.floor(rnd() * 900000), cacheWriteTokens: Math.floor(rnd() * 30000) } },
    })
  }
  return out
}

const sessions = {}
for (let s = 0; s < NSESS; s++) sessions[`session-${String(s).padStart(4, '0')}`] = { revision: 1, events: makeEvents(s, PER, s % 40) }

let reads = 0
const persistence = {
  async listSnapshots() { return Object.keys(sessions).map((id) => ({ header: { id }, revision: sessions[id].revision })) },
  async readFrom(id) { reads++; return { events: sessions[id].events, meta: { id, createdAt: T0, cwd: 'D:\\bench\\proj' } } },
  locate: (meta) => ({ path: `X:\\ws\\p\\x\\${meta.id}` }),
}

const store = emptyStore()
const time = async (label, fn) => {
  const s = process.hrtime.bigint()
  const r = await fn()
  const ms = Number(process.hrtime.bigint() - s) / 1e6
  console.log(`  ${label.padEnd(34)} ${ms.toFixed(1)} ms${r ? '  aggMode=' + r.aggMode : ''}`)
  return ms
}

console.log(`规模:${NSESS} 会话 × ${PER} 请求/会话 = ${NSESS * PER} 请求\n`)
console.log('── 首次全量扫描 ──')
await time('首扫(全部会话都要 fold)', () => scanStore(store, persistence, { nowMs: Date.now() }))

console.log('\n── 稳态:无变化 ──')
const noChange = await time('无变化扫描', () => scanStore(store, persistence, { nowMs: Date.now() }))

console.log(`\n── 稳态:改 ${TOUCH} 个会话 ──`)
function touch(n) {
  for (let k = 0; k < n; k++) {
    const id = `session-${String(Math.floor(rnd() * NSESS)).padStart(4, '0')}`
    const s = sessions[id]
    s.events = s.events.concat([{
      type: 'assistant/message', seq: 100000 + k, time: Date.now(),
      data: { turn: 999, step: 1, usage: { inputTokens: 500, outputTokens: 60, cacheReadTokens: 100 } },
    }])
    s.revision++
  }
}
touch(TOUCH)
const changed = await time(`扫描(${TOUCH} 个会话变更)`, () => scanStore(store, persistence, { nowMs: Date.now() }))

console.log('\n── 对照:同一份库走全量重折 ──')
touch(1)
const force = await time('强制全量扫描(force)', () => scanStore(store, persistence, { force: true, nowMs: Date.now() }))

console.log('\n── 查询正确性抽查 ──')
const k = kpiQuery(store, 'all', null, null, makeFilter(null))
console.log(`  requests=${k.totals.requests}  sessions=${k.activeSessions}  总量=${k.totals.total}`)
console.log(`  期望 requests≈${NSESS * PER + TOUCH + 1}`)

console.log('\n──────── 摘要 ────────')
console.log(`无变化            : ${noChange.toFixed(1)} ms`)
console.log(`改 ${TOUCH} 个会话(增量) : ${changed.toFixed(1)} ms`)
console.log(`全量重折          : ${force.toFixed(1)} ms`)
console.log(`倍数              : ${(force / Math.max(changed, 0.001)).toFixed(1)}×`)
