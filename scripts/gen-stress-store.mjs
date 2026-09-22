/**
 * dsh-token — 造一份**大规模合成 store** 用于性能对比(开发期工具,不进包)
 *
 * 本机真实 store 只有 921 条请求,所有查询都在 0.5ms 以下 —— 在那个量级上任何
 * 差异都被噪声淹没。要判断"重构是否引入额外开销",必须把数据放大到压力区间。
 *
 * 用法:
 *   node scripts/gen-stress-store.mjs <输出路径> [请求数] [模型数] [会话数]
 * 例:
 *   node scripts/gen-stress-store.mjs /tmp/big.json 200000 120 400
 */
import { writeFileSync } from 'node:fs'

const out = process.argv[2]
const NREQ = Number(process.argv[3] || 200000)
const NMODEL = Number(process.argv[4] || 120)
const NSESS = Number(process.argv[5] || 400)
if (!out) { console.error('用法: node scripts/gen-stress-store.mjs <输出路径> [请求数] [模型数] [会话数]'); process.exit(2) }

// 固定种子:每次生成同一份数据,新旧两版才可比
let seed = 20260917
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]

const providers = ['deepseek-official', 'gmi', 'openrouter', 'siliconflow']
const models = []
for (let i = 0; i < NMODEL; i++) models.push(`${pick(providers)}:model-${i}-${Math.floor(rnd() * 1e6).toString(36)}`)

const NOW = Date.now()
const requests = {}
const meta = {}
const watermarks = {}
for (let s = 0; s < NSESS; s++) {
  const id = `stress-${s.toString(36).padStart(4, '0')}`
  const n = Math.max(1, Math.round(NREQ / NSESS))
  const list = []
  let t = NOW - Math.floor(rnd() * 90 * 86400000)
  for (let r = 0; r < n; r++) {
    t += Math.floor(rnd() * 3600000)
    const miss = Math.floor(rnd() * 40000)
    const read = Math.floor(rnd() * 900000)
    const write = Math.floor(rnd() * 30000)
    const o = Math.floor(rnd() * 8000)
    list.push({
      t, m: pick(models), miss, read, write, out: o,
      r: Math.floor(rnd() * 2000), // reasoning
      cost: (miss * 2 + read * 0.04 + write * 0 + o * 8) / 1e6,
      saved: (read * 1.96) / 1e6,
      priced: 1,
    })
  }
  requests[id] = list
  meta[id] = {
    id, title: `压力测试会话 ${s}`, createdAt: list[0].t, updatedAt: list[list.length - 1].t,
    cwd: `D:\\stress\\project-${s % 20}`, parentSession: null, origin: null,
    delegationDepth: null, agentPreset: null, workspace: `--stress-project-${s % 20}--`,
    requestCount: n,
  }
  watermarks[id] = { rev: '1' }
}

const store = {
  version: 6, updatedAt: NOW,
  sessionsRoot: 'X:\\stress\\sessions', storeFile: out,
  watermarks, quarantine: {}, requests, sessions: meta,
  config: { retention: { days: 0 } },
  stats: {
    fullScans: 1, incrementalScans: 0, scannedFiles: NSESS, newRequests: NREQ,
    failedSessions: 0, lastScanAt: NOW, lastScanMs: 0, sessionsTotal: NSESS,
    lastSummary: { durationMs: 0, changed: NSESS, totalSessions: NSESS, forced: true },
  },
}
writeFileSync(out, JSON.stringify(store))
console.log(`已生成: ${out}`)
console.log(`  ${NSESS} 会话 · ${NREQ} 请求 · ${NMODEL} 模型`)
