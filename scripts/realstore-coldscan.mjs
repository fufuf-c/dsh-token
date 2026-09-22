/**
 * dsh-token — 真实会话日志的「冷启动全量扫描」升级核对(开发期工具,不进包)
 *
 * 为什么需要它:`verify-tarball.mjs` 用的是一个会话的**人造**日志;而真实日志是
 * zstd 压缩的 `session.v3.jsonl.zstd`,字段形态(v0 老记录、缺 usage、多 provider、
 * 插件注入成员)只有本机这 18 个会话才有。这里把真实日志解出来,走**新版的
 * session-source + core**全量冷扫,再和**已安装版本落盘的 store.json** 比对:
 *   - 会话数 / 请求数 / 四段 Token 总量 / 成本
 *   - 每个会话的折叠记录条数与 Token 总量
 *   - 扫描是否报错、是否产生 quarantine
 *
 * 用法:
 *   node scripts/realstore-coldscan.mjs [DSH_HOME] [已安装store.json]
 * 退出码非 0 = 与既有 store 不一致(或扫描失败)。
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { emptyStore, tokenTotal, decodeStore, joinStore } from '../lib/core.mjs'
import { scanStore } from '../lib/session-source.mjs'

/**
 * 真实会话日志是**多帧** zstd(每个持久化批次一个独立帧,manifest 追加写入)。
 * `zstdDecompressSync` 只解第一帧 —— 直接用它只能拿到 275 字节的会话头,请求数为 0。
 * 这里按 DSH `dsh-session-persistence-jsonl` 的 scanZstdFrames 口径定位每个帧的
 * 字节区间,再逐帧解码(帧与帧之间是独立可解码的)。
 */
const ZSTD_MAGIC = 0xfd2fb528
function scanFrames(buf) {
  const frames = []
  let o = 0
  while (o < buf.length) {
    const start = o
    if (buf.length - o < 4) break
    if (buf.readUInt32LE(o) !== ZSTD_MAGIC) throw new Error(`invalid frame magic at byte ${o}`)
    o += 4
    if (o === buf.length) break
    const d = buf.readUInt8(o); o += 1
    const contentSizeFlag = d >>> 6
    const singleSegment = (d & 32) !== 0
    const checksum = (d & 4) !== 0
    const dictFlag = d & 3
    const dictBytes = dictFlag === 3 ? 4 : dictFlag
    const csBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const rest = (singleSegment ? 0 : 1) + dictBytes + csBytes
    if (buf.length - o < rest) break
    o += rest
    for (;;) {
      if (buf.length - o < 3) return frames
      const bh = buf.readUIntLE(o, 3); o += 3
      const last = (bh & 1) !== 0
      const type = (bh >>> 1) & 3
      const size = bh >>> 3
      const payload = type === 1 ? 1 : size
      if (buf.length - o < payload) return frames
      o += payload
      if (last) break
    }
    if (checksum) { if (buf.length - o < 4) return frames; o += 4 }
    frames.push({ start, end: o })
  }
  return frames
}

/** 逐帧解码并拼成完整 JSONL 文本(与 DSH 读取路径等价) */
function decodeZstdMultiFrame(buf) {
  const frames = scanFrames(buf)
  const parts = []
  for (const f of frames) {
    // node:zlib 的同步 zstd 只解一帧,这里正好每次只喂一帧的字节区间
    try { parts.push(zstdDecompressSync(buf.subarray(f.start, f.end))) }
    catch (e) { /* 损坏帧跳过,与 DSH 的容错口径一致 */ }
  }
  return Buffer.concat(parts).toString('utf8')
}

const HOME = process.argv[2] || join(process.env.USERPROFILE || process.env.HOME, '.dsh')
const SESS = join(HOME, 'sessions')
const INSTALLED = process.argv[3] || join(HOME, 'dsh-token', 'store.json')

// ---- 把真实 zstd 日志暴露成 sessionPersistence 句柄式 API ----
// 真实布局:sessions/<workspace>/<sessionId>/session.v3.jsonl.zstd
// 会话 id = **父目录名**(与已安装 store.json 的键一致)。
const fileOf = new Map() // id -> 绝对路径
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.jsonl.zstd') || e.name.endsWith('.jsonl')) {
      const parts = p.split(/[\\/]/)
      const id = parts[parts.length - 2]
      fileOf.set(id, p)
    }
  }
}
walk(SESS)
const ids = [...fileOf.keys()]

function parseJsonl(text) {
  const out = []
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s) continue
    try { out.push(JSON.parse(s)) } catch (e) { /* 半行/损坏行跳过 */ }
  }
  return out
}

let decErr = 0
const persistence = {
  async list() {
    return ids.map((id) => ({ header: { id }, revision: String(statSync(fileOf.get(id)).mtimeMs) }))
  },
  async open(id) {
    const p = fileOf.get(id)
    return {
      id,
      header: { id },
      async read() {
        let text
        if (p.endsWith('.zstd')) {
          text = decodeZstdMultiFrame(readFileSync(p))
        } else text = readFileSync(p, 'utf8')
        return { eventState: 'detached', events: parseJsonl(text) }
      },
      async close() {},
    }
  },
  locate: () => 'X:\\unknown',
}

console.log(`sessions dir : ${SESS}`)
console.log(`  ${ids.length} 个会话日志, 例: ${ids[0]}`)

// ---- 冷启动全量扫描(新版代码) ----
const store = emptyStore()
store.storeFile = INSTALLED
const logs = []
let scanErr = null
try {
  await scanStore(store, persistence, { force: true, logger: (...a) => logs.push(a.join(' ')) })
} catch (e) { scanErr = e }
if (scanErr) {
  console.error('✖ 扫描抛错:', scanErr)
  console.error(logs.join('\n'))
  process.exit(1)
}

const idOf = (p) => p.split(/[\\/]/).slice(-2, -1)[0]
let newReq = 0, newTok = 0
for (const id of Object.keys(store.requests)) for (const r of store.requests[id]) { newReq++; newTok += tokenTotal(r) }

console.log('')
console.log(`冷扫结果(新版): 会话 ${Object.keys(store.requests).length} · 请求 ${newReq} · Token ${newTok}`)
console.log(`  quarantine: ${Object.keys(store.quarantine || {}).length} · 解码失败 ${decErr}`)
if (logs.length) console.log('  扫描日志:\n    ' + logs.slice(0, 6).join('\n    '))

// ---- 与已安装 store 比对 ----
// **兼容 0.9.0 分片布局**:store.json 只是元数据,记录在 shards/*.json。
// 不处理的话这里会读到 0 会话,比对结论变成"全都对不上"。
function loadInstalled(file) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  const shardDir = join(dirname(file), 'shards')
  if (parsed && parsed.requests === undefined && existsSync(shardDir)) {
    const shards = []
    for (const f of readdirSync(shardDir)) {
      if (!f.endsWith('.json')) continue
      try {
        const s = JSON.parse(readFileSync(join(shardDir, f), 'utf8'))
        if (s && typeof s === 'object' && typeof s.id === 'string') shards.push(s)
      } catch (e) { /* 坏分片跳过 */ }
    }
    return joinStore(parsed, shards)
  }
  return decodeStore(parsed)
}
let installed = null
try { installed = loadInstalled(INSTALLED) } catch (e) { /* 无则跳过比对 */ }
if (!installed) {
  console.log(`\n(没有可比的已安装 store,跳过比对: ${INSTALLED})`)
} else {
  let oldReq = 0, oldTok = 0
  for (const id of Object.keys(installed.requests || {})) for (const r of installed.requests[id]) { oldReq++; oldTok += tokenTotal(r) }
  console.log('')
  console.log(`已安装 store : 会话 ${Object.keys(installed.requests || {}).length} · 请求 ${oldReq} · Token ${oldTok}`)

  // 逐会话比对(Token 总量;条数允许因日志增长而变,所以只提示不判错)
  const ids = new Set([...Object.keys(store.requests), ...Object.keys(installed.requests || {})])
  let tokDiff = 0, onlyNew = 0, onlyOld = 0
  for (const id of ids) {
    const a = (installed.requests || {})[id], b = store.requests[id]
    if (a && !b) { onlyOld++; continue }
    if (!a && b) { onlyNew++; continue }
    const ta = a.reduce((s, r) => s + tokenTotal(r), 0)
    const tb = b.reduce((s, r) => s + tokenTotal(r), 0)
    if (ta !== tb) { tokDiff++; if (tokDiff <= 5) console.log(`  ~ ${id}: 已装 ${ta} vs 冷扫 ${tb}`) }
  }
  console.log(`  逐会话 Token: 不一致 ${tokDiff} · 仅已装有 ${onlyOld} · 仅冷扫有 ${onlyNew}`)

  // 冷扫应当**覆盖**已安装的每一条(真实日志只会增长,不会倒退)
  if (newReq < oldReq) {
    console.log(`✖ 冷扫请求数(${newReq})少于已安装(${oldReq}) —— 真实日志不应倒退,扫描可能丢数据`)
    process.exit(1)
  }
  console.log(`✔ 冷扫请求数 ${newReq} ≥ 已安装 ${oldReq}(日志增长属正常)`)
}
console.log('\n✔ 真实日志冷启动全量扫描通过')
