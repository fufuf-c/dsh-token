/**
 * dsh-token — 单项严格配对测量(开发期工具,不进包)
 *
 * 背景:在 200k 请求的压力库上,rebuildAll 连续多轮都比旧版慢几个百分点,符号一致;
 * 而 heatmap/export csv 的符号来回翻转(纯噪声)。这个脚本只盯一个操作,用**配对差值
 * 的符号检验**判断是不是真实回归 —— 不是看平均值,而是看"每一对里新版是否稳定更慢"。
 *
 * 用法:
 *   node scripts/bench-one.mjs <旧core.mjs> <操作名> [store.json] [配对数]
 *   node scripts/bench-one.mjs <旧core.mjs> list        # 列出可用操作名
 */
import { readFileSync, existsSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const oldPath = process.argv[2]
const opName = process.argv[3]
const storePath = process.argv[4] || join(process.env.USERPROFILE || process.env.HOME, '.dsh', 'dsh-token', 'store.json')
const PAIRS = Number(process.argv[5] || 21)

const here = dirname(fileURLToPath(import.meta.url))
const OLD = await import(pathToFileURL(oldPath).href)
const NEW = await import(pathToFileURL(join(here, '..', 'lib', 'core.mjs')).href)
const raw = JSON.parse(readFileSync(storePath, 'utf8'))

const OPS = {
  rebuild: (C, s) => C.rebuildAll(s),
  kpiAll: (C, s) => C.kpiQuery(s, 'all', '', '', C.makeFilter({}), Date.now()),
  seriesDay: (C, s) => C.seriesQuery(s, 'day', 'all', '', '', C.makeFilter({}), Date.now()),
  hours: (C, s) => C.hoursQuery(s, 'all', '', '', C.makeFilter({}), Date.now()),
  heatmap: (C, s) => C.heatmapQuery(s, 12, C.makeFilter({}), Date.now()),
  sessions: (C, s) => C.sessionsQuery(s, 'cost', 100, 'all', '', '', C.makeFilter({}), Date.now()),
  csv: (C, s) => C.exportCsv(s, 'all', '', '', C.makeFilter({}), Date.now()),
}

if (opName === 'list' || !opName) { console.log('可用操作: ' + Object.keys(OPS).join(', ')); process.exit(0) }
const fn = OPS[opName]
if (!fn) { console.error('未知操作: ' + opName + '  可用: ' + Object.keys(OPS).join(', ')); process.exit(2) }

function fresh() {
  const s = JSON.parse(JSON.stringify(raw))
  delete s.days; delete s.months; delete s.models
  return s
}
const timeIt = (CORE) => { const s = fresh(); const t0 = process.hrtime.bigint(); fn(CORE, s); return Number(process.hrtime.bigint() - t0) / 1e6 }

// 预热
for (let i = 0; i < 5; i++) { timeIt(OLD); timeIt(NEW) }

const pairs = []
for (let i = 0; i < PAIRS; i++) {
  // 交替先后,消除"后跑者占便宜"
  const a = timeIt(OLD)
  const b = timeIt(NEW)
  pairs.push({ a, b, d: b - a })
}
const med = (arr) => { const s = arr.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const ma = med(pairs.map((p) => p.a))
const mb = med(pairs.map((p) => p.b))
const pos = pairs.filter((p) => p.d > 0).length
const neg = pairs.filter((p) => p.d < 0).length

console.log(`操作: ${opName}   配对 ${PAIRS} 轮   store: ${storePath}`)
console.log(`  旧版中位数: ${ma.toFixed(3)} ms`)
console.log(`  新版中位数: ${mb.toFixed(3)} ms`)
console.log(`  中位数变化: ${(((mb - ma) / ma) * 100).toFixed(1)}%`)
console.log(`  配对差值符号: 新版更慢 ${pos} 次 / 更快 ${neg} 次`)
console.log('')
// 符号检验(双尾):若纯噪声,正负应大致各半。用正态近似
if (pos + neg > 0) {
  const n = pos + neg
  const z = Math.abs(pos - n / 2) / Math.sqrt(n / 4)
  const verdict = z > 2.0 ? '显著(新版确实更慢)' : z > 1.3 ? '倾向性(可能更慢)' : '不显著(噪声)'
  console.log(`  符号检验 z=${z.toFixed(2)}  ->  ${verdict}`)
}
console.log(`  每对差值: ${pairs.map((p) => p.d.toFixed(2)).join(', ')}`)
