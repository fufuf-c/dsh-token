/**
 * dsh-token — 重构前后**性能**对比(开发期工具,不进包)
 *
 * 为什么需要它:重构抽出了 tokenTotal() 之类的函数,理论上多了一层调用;
 * 到底"快了还是慢了",不能靠感觉,得在同一份真实数据上量。
 *
 * 方法:
 *   - 同一个真实 store.json,分别加载 HEAD(旧)与当前(新)的 lib/core.mjs
 *   - 每个查询跑 N 轮,取**中位数**(避免偶发 GC/调度抖动)
 *   - 先跑足够的预热轮让 V8 完成 JIT,再开始计时
 *
 * 用法:
 *   node scripts/bench-refactor.mjs <旧core.mjs> [store.json] [轮数]
 */
import { readFileSync, existsSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const oldPath = process.argv[2]
const storePath = process.argv[3] || join(process.env.USERPROFILE || process.env.HOME, '.dsh', 'dsh-token', 'store.json')
const ROUNDS = Number(process.argv[4] || 25)
if (!oldPath) { console.error('用法: node scripts/bench-refactor.mjs <旧core.mjs> [store.json] [轮数]'); process.exit(2) }
if (!existsSync(storePath)) { console.error('找不到 store: ' + storePath); process.exit(2) }

const here = dirname(fileURLToPath(import.meta.url))
const OLD = await import(pathToFileURL(oldPath).href)
const NEW = await import(pathToFileURL(join(here, '..', 'lib', 'core.mjs')).href)

const raw = JSON.parse(readFileSync(storePath, 'utf8'))
const NREQ = Object.values(raw.requests || {}).reduce((a, l) => a + l.length, 0)
console.log(`store: ${Object.keys(raw.requests || {}).length} 会话 · ${NREQ} 请求 · ${ROUNDS} 轮取中位数`)
console.log('')

/** 每次测量都用全新 store(清掉聚合缓存),逼它走完整计算路径 */
function fresh() {
  const s = JSON.parse(JSON.stringify(raw))
  delete s.days; delete s.months; delete s.models
  return s
}

/** 定义全部被测操作:名字 → (CORE, store) => 结果 */
const OPS = {
  'kpi today': (C, s) => C.kpiQuery(s, 'today', '', '', C.makeFilter({}), Date.now()),
  'kpi all': (C, s) => C.kpiQuery(s, 'all', '', '', C.makeFilter({}), Date.now()),
  'series day': (C, s) => C.seriesQuery(s, 'day', 'all', '', '', C.makeFilter({}), Date.now()),
  'series month': (C, s) => C.seriesQuery(s, 'month', 'all', '', '', C.makeFilter({}), Date.now()),
  'hours all': (C, s) => C.hoursQuery(s, 'all', '', '', C.makeFilter({}), Date.now()),
  'heatmap 12': (C, s) => C.heatmapQuery(s, 12, C.makeFilter({}), Date.now()),
  'sessions recent': (C, s) => C.sessionsQuery(s, 'recent', 100, 'all', '', '', C.makeFilter({}), Date.now()),
  'sessions cost': (C, s) => C.sessionsQuery(s, 'cost', 100, 'all', '', '', C.makeFilter({}), Date.now()),
  'export csv': (C, s) => C.exportCsv(s, 'all', '', '', C.makeFilter({}), Date.now()),
  'export json': (C, s) => C.exportJson(s, 'all', '', '', C.makeFilter({}), Date.now()),
  'session detail': (C, s) => C.sessionDetailQuery(s, Object.keys(raw.requests)[0]),
  // 冷启动全量重折(最重的路径)
  'rebuildAll': (C, s) => C.rebuildAll(s),
}

/**
 * 计时:交错采样取中位数(毫秒)。
 * 交错是为了抵消系统性漂移(CPU 降频、GC 时机、页面缓存变暖)——如果先把旧版全部
 * 跑完再跑新版,任何贯穿全程的漂移都会被误读成"新旧差异"。
 */
function benchPair(fnA, fnB) {
  // 预热两组,让 JIT 都编译完
  for (let i = 0; i < 8; i++) { fnA(OLD, fresh()); fnB(NEW, fresh()) }
  const ta = [], tb = []
  for (let i = 0; i < ROUNDS; i++) {
    // 同一轮内交替先后顺序(奇偶轮对调),避免"总是后跑的那组"占便宜
    const first = i % 2 === 0
    const order = first
      ? [[fnA, OLD, ta], [fnB, NEW, tb]]
      : [[fnB, NEW, tb], [fnA, OLD, ta]]
    for (const [fn, CORE, bucket] of order) {
      const s = fresh()
      const t0 = process.hrtime.bigint()
      fn(CORE, s)
      const t1 = process.hrtime.bigint()
      bucket.push(Number(t1 - t0) / 1e6)
    }
  }
  const med = (arr) => { const a = arr.slice().sort((x, y) => x - y); return a[Math.floor(a.length / 2)] }
  return { a: med(ta), b: med(tb) }
}

console.log('操作'.padEnd(18) + '旧版 ms'.padStart(10) + '新版 ms'.padStart(10) + '变化'.padStart(11) + '   判定'.padStart(12))
console.log('-'.repeat(62))
const rows = []
for (const [name, fn] of Object.entries(OPS)) {
  let r
  try { r = benchPair(fn, fn) } catch (e) { r = { a: NaN, b: NaN } }
  const { a, b } = r
  let delta = 'n/a'
  let verdict = ''
  if (Number.isFinite(a) && Number.isFinite(b) && a > 0) {
    const pct = ((b - a) / a) * 100
    delta = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%'
    // 噪声地板:绝对值差 < 0.05ms 视为无可分辨差异
    const abs = Math.abs(b - a)
    verdict = abs < 0.05 ? '噪声内' : (pct > 0 ? '略慢' : '略快')
  }
  rows.push({ name, a, b, delta, verdict })
  console.log(name.padEnd(18) + (Number.isFinite(a) ? a.toFixed(3) : 'err').padStart(10) + (Number.isFinite(b) ? b.toFixed(3) : 'err').padStart(10) + delta.padStart(11) + verdict.padStart(12))
}

console.log('')
const slower = rows.filter((r) => r.verdict === '略慢')
const faster = rows.filter((r) => r.verdict === '略快')
const noise = rows.filter((r) => r.verdict === '噪声内')
console.log(`可分辨地变快: ${faster.length} 项 · 可分辨地变慢: ${slower.length} 项 · 噪声内(<0.05ms): ${noise.length} 项`)
if (slower.length) {
  console.log('')
  console.log('变慢的项(超过噪声地板):')
  for (const r of slower) console.log(`  ${r.name}: ${r.a.toFixed(3)} -> ${r.b.toFixed(3)} ms (${r.delta}, 绝对差 ${(r.b - r.a).toFixed(3)}ms)`)
}
if (faster.length) {
  console.log('')
  console.log('变快的项:')
  for (const r of faster) console.log(`  ${r.name}: ${r.a.toFixed(3)} -> ${r.b.toFixed(3)} ms (${r.delta})`)
}
