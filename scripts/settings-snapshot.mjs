/**
 * dsh-token — 设置页输出快照(重构安全网,开发期工具)
 *
 * 用途:`renderSettings()` 是一个 280+ 行、拼字符串的函数,页面测试用的是
 * 正则断言(只盯关键属性)。做结构性拆分时,光靠正则不足以证明"输出逐字没变"。
 * 这里在 vm 里跑真实页面源码,对若干组 meta/config 组合把 `#settings-body`
 * 的 innerHTML 原样打印出来 —— 重构前后各跑一次、diff 为 0,才算真的没改行为。
 *
 * 用法:
 *   node scripts/settings-snapshot.mjs            # 打印到 stdout(用于 > 快照)
 *   node scripts/settings-snapshot.mjs --check    # 与 head 版本对比(见 README 开发节)
 *
 * 这个脚本**不进 npm 包**(files 白名单里只有 lib/web/说明文件)。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function fakeEl() {
  const t = {
    innerHTML: '', textContent: '', value: '', hidden: false,
    style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  }
  const el = new Proxy(t, {
    get(o, k) {
      if (k in o) return o[k]
      if (k === 'querySelectorAll') return () => []
      if (k === 'querySelector' || k === 'closest') return () => el
      if (k === 'appendChild' || k === 'insertBefore' || k === 'removeChild') return (x) => x
      if (k === 'cloneNode') return () => el
      if (k === 'getContext') return () => ctx2d
      return () => {}
    },
    set(o, k, v) { o[k] = v; return true },
  })
  return el
}
const ctx2d = new Proxy({}, {
  get: (o, k) => (k === 'canvas' ? fakeEl() : (k === 'measureText' ? () => ({ width: 10 }) : () => {})),
  set: () => true,
})

function loadPage() {
  const html = readFileSync(join(root, 'web/index.html'), 'utf8')
  const m = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(html)
  if (!m) throw new Error('页面应有内联脚本')
  let code = m[1]
  const tail = code.lastIndexOf('})();')
  if (tail <= 0) throw new Error('内联脚本应为 IIFE 收尾')
  code = code.slice(0, tail) +
    'globalThis.__page = { render: renderSettings, state: state, peakRangesOf: peakRangesOf, peakDaysText: peakDaysText, peakSummaryText: peakSummaryText };\n' +
    code.slice(tail)
  return code
}

const els = new Map()
const getEl = (id) => { if (!els.has(id)) els.set(id, fakeEl()); return els.get(id) }
const doc = {
  getElementById: getEl,
  querySelector: () => fakeEl(),
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  createElement: () => fakeEl(),
  hidden: true,
  body: fakeEl(), documentElement: fakeEl(), head: fakeEl(),
}
/**
 * 冻结"现在"到固定时刻。设置页的预算外推用 `new Date()` 取当月已过天数,
 * 不冻结的话跨零点跑两次快照就会差一行(实测 9/17 与 9/18 各跑一次,
 * 「超 ¥41.18 / 已过 17/30 天」变成「超 ¥33.33 / 已过 18/30 天」)——
 * 那是时钟在走,不是代码变了,会淹没真正的差异。
 */
const FROZEN_NOW = new Date(2026, 8, 17, 12, 0, 0, 0).getTime()
const FakeDate = new Proxy(Date, {
  construct(Target, args) {
    if (args.length === 0) return new Target(FROZEN_NOW)
    return new Target(...args)
  },
  apply() { return new Date(FROZEN_NOW).toString() },
  get(Target, prop) {
    if (prop === 'now') return () => FROZEN_NOW
    const v = Target[prop]
    return typeof v === 'function' ? v.bind(Target) : v
  },
})

const sandbox = {
  document: doc,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetch: () => new Promise(() => {}),
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  location: { href: 'http://127.0.0.1:3080/dsh-token', search: '', hash: '' },
  navigator: { userAgent: 'node', clipboard: { writeText: async () => {} } },
  console, JSON, Date: FakeDate, Math, Number, String, Object, Array, RegExp, Error, Promise, Set, Map, isFinite, parseInt, parseFloat,
}
sandbox.window = sandbox
sandbox.globalThis = sandbox
for (const g of ['URLSearchParams', 'URL', 'TextEncoder', 'TextDecoder', 'Blob', 'AbortController',
  'AbortSignal', 'Event', 'CustomEvent', 'Intl', 'encodeURIComponent', 'decodeURIComponent',
  'queueMicrotask', 'structuredClone', 'performance']) {
  if (g in globalThis) sandbox[g] = globalThis[g]
}
vm.createContext(sandbox)
vm.runInContext(loadPage(), sandbox, { filename: 'web/index.html' })
const page = sandbox.__page

/** 覆盖设置页的各个分支:无预算 / 有预算 / 无 defaults(host 未升级)/ 有自定义价 / 全部展开 */
const SCHEDULE = { hours: [[9, 12], [14, 18]], days: [1, 2, 3, 4, 5] }
const DEFAULTS = {
  'deepseek-official:deepseek-flash': { key: 'deepseek-flash', label: 'DeepSeek 官方价 · deepseek-flash', peak: { miss: 2, hit: 0.04, write: 0, output: 8 }, idle: { miss: 1, hit: 0.02, write: 0, output: 4 } },
  'deepseek-official:deepseek-v4-pro': { key: 'deepseek-pro', label: 'DeepSeek 官方价 · deepseek-v4-pro', peak: { miss: 9, hit: 0.3, write: 0, output: 27 }, idle: { miss: 4.5, hit: 0.15, write: 0, output: 13.5 } },
}
const META = {
  models: ['deepseek-official:deepseek-flash', 'deepseek-official:deepseek-v4-pro', 'gmi:MiniMaxAI/MiniMax-M3', 'unpriced:totally-unknown'],
  configuredModels: { exact: ['deepseek-official:deepseek-flash', 'unpriced:totally-unknown'], byId: ['deepseek-v4-pro'] },
  sessionsRoot: 'C:\\Users\\x\\.dsh\\sessions', storeFile: 'C:\\Users\\x\\.dsh\\dsh-token\\store.json',
  storeVersion: 6, sessionCount: 12, requestCount: 340, dayCount: 9, monthCount: 2,
  stats: { scans: 3, changed: 2, newRequests: 40, failed: 0, skipped: 1, quarantined: 0, pruned: 0, removed: 0, totalSessions: 12, durationMs: 12, lastScanAt: 1757000000000 },
  quarantinedCount: 0, quarantined: [],
  retention: { days: 0 }, hasCustomPrices: 1, updatedAt: 1757000000000,
}

const CASES = [
  ['no-budget-nod-defaults', META, { schedule: SCHEDULE, prices: {}, defaultsSchedule: SCHEDULE }],
  ['no-budget-with-defaults', META, { schedule: SCHEDULE, prices: {}, defaults: DEFAULTS, defaultsSchedule: SCHEDULE, budget: { monthly: 0 } }],
  ['budget-80pct', META, { schedule: SCHEDULE, prices: {}, defaults: DEFAULTS, defaultsSchedule: SCHEDULE, budget: { monthly: 100 } }],
  ['custom-prices-and-all-models', { ...META, configuredModels: null }, { schedule: SCHEDULE, prices: { 'deepseek-official:deepseek-flash': { peak: { miss: 3 }, idle: { miss: 1.5 } }, 'gmi:MiniMaxAI/MiniMax-M3': { miss: 7, hit: 1 } }, defaults: DEFAULTS, defaultsSchedule: SCHEDULE, budget: { monthly: 200 }, retention: { days: 30 } }],
  ['no-peak-schedule', META, { prices: {}, defaults: DEFAULTS, defaultsSchedule: { hours: [], days: [] }, schedule: { hours: [], days: [] } }],
]

const st = page.state
const out = []
for (const [name, meta, cfg] of CASES) {
  for (const modelsAll of [false, true]) {
    st.meta = meta
    st.config = cfg
    st.modelsAll = modelsAll
    st.tab = 'settings'
    // 预算进度依赖 kpiMonth / 当前日期,固定住以便可比
    st.kpiMonth = cfg.budget ? { totals: { cost: 80 } } : null
    page.render()
    out.push(`===== CASE ${name} modelsAll=${modelsAll} =====`)
    out.push(getEl('settings-body').innerHTML)
    out.push(`----- peakSummary(selH={9,10,11,14..17}, selD={1..5}) -----`)
    out.push(page.peakSummaryText({ 9: 1, 10: 1, 11: 1, 14: 1, 15: 1, 16: 1, 17: 1 }, { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 }))
    out.push(`----- peakDaysText([0,6]) = ${page.peakDaysText([0, 6])} | ([0..6]) = ${page.peakDaysText([0, 1, 2, 3, 4, 5, 6])} | ([]) = "${page.peakDaysText([])}"`)
    out.push(`----- peakRangesOf({0,1,9,10}) = ${JSON.stringify(page.peakRangesOf({ 0: 1, 1: 1, 9: 1, 10: 1 }))}`)
  }
}
process.stdout.write(out.join('\n') + '\n')
