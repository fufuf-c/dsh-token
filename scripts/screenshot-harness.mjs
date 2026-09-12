/**
 * dsh-token — 截图用合成数据实例
 *
 * 为什么需要它:市场商店详情页要展示界面截图,而直接截运行中的 DSH 会把真实会话
 * 标题与用量一起公开。这里用一份**全虚构**的会话数据在独立 DSH_HOME 里起一个
 * 真 http 栈,截图取自这个实例,与被截图者的真实使用记录完全无关。
 *
 * 数据是确定性的(mulberry32 固定种子),同一份脚本每次产出同一组数字,截图可复现。
 *
 * 运行:
 *   node scripts/screenshot-harness.mjs            # 默认 http://127.0.0.1:3099/dsh-token
 *   SHOT_PORT=4000 SHOT_BUDGET=80 node scripts/screenshot-harness.mjs
 * 退出:Ctrl+C(临时 DSH_HOME 留在系统临时目录,不碰真实 ~/.dsh)
 */
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'

const PORT = Number(process.env.SHOT_PORT || 3099)
const BUDGET = Number(process.env.SHOT_BUDGET || 40)
const home = process.env.SHOT_HOME || mkdtempSync(join(tmpdir(), 'dsh-token-shot-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'sessions'), { recursive: true })

// ---- 确定性伪随机(固定种子 → 截图可复现) ----
let s = 20260912
const rnd = () => {
  s = (s + 0x6d2b79f5) | 0
  let t = Math.imul(s ^ (s >>> 15), 1 | s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1))

const HOUR = 3600e3
const DAY = 24 * HOUR
const NOW = Date.now()

// 以下标题、路径、会话 ID 全部为虚构示例,不对应任何真实项目或会话。
const SPECS = [
  { t: '给订单导出加流式写入', cwd: 'C:\\work\\order-service', m: 'deepseek-chat', ago: 35 * 60e3, n: 41 },
  { t: '排查缓存穿透导致的重复查询', cwd: 'C:\\work\\order-service', m: 'deepseek-reasoner', ago: 2.5 * HOUR, n: 26, spikes: [11, 12, 13] },
  { t: 'CLI 进度条与信号处理', cwd: 'D:\\scratch\\cli-tools', m: 'deepseek-chat', ago: 5 * HOUR, n: 23 },
  { t: '时区口径复核:日桶与小时桶', cwd: 'C:\\work\\metrics', m: 'deepseek-reasoner', ago: 8 * HOUR, n: 31, spikes: [17, 18] },
  { t: '把重试逻辑抽成策略对象', cwd: 'C:\\work\\order-service', m: 'deepseek-chat', ago: 1 * DAY + 3 * HOUR, n: 28 },
  { t: '报表导出内存占用过高', cwd: 'D:\\scratch\\reports', m: 'deepseek-reasoner', ago: 1 * DAY + 7 * HOUR, n: 19, spikes: [9, 10] },
  { t: '网关限流规则梳理', cwd: '/home/dev/edge-gateway', m: 'deepseek-chat', ago: 2 * DAY + 2 * HOUR, n: 34 },
  { t: '给配置加载补上校验', cwd: 'C:\\work\\order-service', m: 'deepseek-chat', ago: 3 * DAY + 6 * HOUR, n: 22 },
  { t: '日志分级与采样策略', cwd: '/home/dev/edge-gateway', m: 'deepseek-reasoner', ago: 4 * DAY + 4 * HOUR, n: 24 },
  { t: '批量任务的幂等键设计', cwd: 'D:\\scratch\\pipeline', m: 'deepseek-chat', ago: 6 * DAY + 5 * HOUR, n: 37 },
  { t: '解析半结构化日志字段', cwd: 'D:\\scratch\\pipeline', m: 'deepseek-chat', ago: 8 * DAY + 3 * HOUR, n: 20 },
  { t: '把散落的常量收进一处', cwd: 'C:\\work\\metrics', m: 'deepseek-chat', ago: 11 * DAY + 6 * HOUR, n: 16 },
  { t: '并发写同一份快照', cwd: '/home/dev/edge-gateway', m: 'deepseek-reasoner', ago: 14 * DAY + 2 * HOUR, n: 29, spikes: [15] },
  { t: '窗口函数改写慢查询', cwd: 'D:\\scratch\\reports', m: 'deepseek-chat', ago: 18 * DAY + 7 * HOUR, n: 25 },
  { t: '给接口加幂等与重放保护', cwd: 'C:\\work\\order-service', m: 'deepseek-chat', ago: 22 * DAY + 5 * HOUR, n: 33 },
  { t: '拆分过长的配置文件', cwd: 'D:\\scratch\\cli-tools', m: 'deepseek-chat', ago: 27 * DAY + 4 * HOUR, n: 18 },
  { t: '梳理错误码与文案', cwd: 'C:\\work\\metrics', m: 'deepseek-chat', ago: 33 * DAY + 6 * HOUR, n: 21 },
  { t: '首屏渲染的重复请求', cwd: '/home/dev/edge-gateway', m: 'deepseek-reasoner', ago: 38 * DAY + 3 * HOUR, n: 27 },
]

const sessions = {}
SPECS.forEach((sp, i) => {
  const id = `demo-${String(i + 1).padStart(2, '0')}`
  const t0 = NOW - sp.ago
  const events = [
    { type: 'session/title', seq: 0, time: t0 - 45e3, data: { title: sp.t, source: { kind: 'provider' } } },
    { type: 'request/header', seq: 1, time: t0, data: { header: { config: { provider: 'deepseek-official', model: sp.m } } } },
  ]
  const spikes = new Set(sp.spikes || [])
  let seq = 2
  for (let k = 0; k < sp.n; k++) {
    const spike = spikes.has(k)
    const inputTokens = (spike ? ri(18, 42) : ri(2, 14)) * 1000
    const cacheReadTokens = (spike ? ri(60, 180) : ri(4, 70)) * 1000
    const cacheWriteTokens = rnd() < 0.55 ? ri(2, 26) * 1000 : 0
    const outputTokens = (spike ? ri(4, 9) : ri(1, 3)) * 1000
    const reasoningTokens = sp.m.includes('reasoner') ? Math.round(outputTokens * 0.8) : 0
    events.push({
      type: 'assistant/message',
      seq: seq++,
      time: t0 + k * ri(45, 150) * 1000,
      data: {
        turn: k + 1,
        step: 1,
        usage: {
          inputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          outputTokens,
          reasoningTokens,
          totalTokens: inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens,
        },
      },
    })
  }
  sessions[id] = { revision: 1, meta: { id, cwd: sp.cwd, title: sp.t }, events }
})

// ---- 假 DSH 环境(形状与 scripts/e2e-smoke.mjs 一致) ----
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
const themeSettings = { preference: process.env.SHOT_THEME || 'dark' }
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
plugin.apply(ctx)
await new Promise((r) => setTimeout(r, 400)) // 等首次全量扫描

const server = http.createServer((req, res) => routeHandler(req, res))
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
const base = `http://127.0.0.1:${PORT}`

// 预算:先看本月实际花费,再设一个能看出环形进度的值
const post = (path, body) => fetch(base + path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', host: `127.0.0.1:${PORT}`, origin: base },
  body: JSON.stringify(body),
}).then((r) => r.json())

try {
  const k = await (await fetch(`${base}/dsh-token/api/kpi?range=month`)).json()
  const t = (k && k.totals) || {}
  console.log(`本月合成口径: requests=${t.requests} tokens=${t.total} 金额字段=${Object.keys(t).filter((x) => /cost|cny|money|price|spend/i.test(x)).map((x) => `${x}=${t[x]}`).join(' ') || '(none)'}`)
} catch (e) { console.log(`kpi 预读失败: ${e.message}`) }
const cfg = await post('/dsh-token/api/config', { budget: { monthly: BUDGET } })
console.log(`budget.monthly=${cfg && cfg.budget && cfg.budget.monthly}`)

console.log(`\n截图实例已就绪(合成数据,与真实记录无关):`)
console.log(`  仪表盘  ${base}/dsh-token`)
console.log(`  临时 HOME  ${home}`)
console.log(`  会话数  ${Object.keys(sessions).length}\n`)
