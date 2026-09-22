/**
 * dsh-token — 真实 store 的「旧版 vs 新版」输出等价核对(开发期工具,不进包)
 *
 * 用途:重构号称"不改行为"。单测用的是人造小 store,而这里直接拿**本机真实的
 * store.json**(几百条请求、多模型、多天、含 quarantine/筛选分支)喂给两个版本的
 * lib/core.mjs,把每个只读查询接口的输出逐字节比对。
 *
 * 这是升级前最重要的一道保险:真实数据里的字段组合(缺字段的老记录、未定价模型、
 * 多 provider)是人造样例覆盖不到的。
 *
 * 用法:
 *   node scripts/realstore-equivalence.mjs <旧core.mjs路径> [store.json路径]
 * 退出码非 0 = 发现差异。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { decodeStore, joinStore } from '../lib/core.mjs'

const oldPath = process.argv[2]
const storePath = process.argv[3] || `${process.env.USERPROFILE || process.env.HOME}/.dsh/dsh-token/store.json`
if (!oldPath) {
  console.error('用法: node scripts/realstore-equivalence.mjs <旧core.mjs路径> [store.json路径]')
  process.exit(2)
}
if (!existsSync(storePath)) {
  console.error(`找不到 store: ${storePath}`)
  process.exit(2)
}

const load = (p) => import(pathToFileURL(p).href)
const OLD = await load(oldPath)
const NEW = await load(new URL('../lib/core.mjs', import.meta.url).pathname.replace(/^\//, ''))

/**
 * 载入 store,**兼容 0.9.0 的分片布局**。
 * 0.9.0 起 `store.json` 只是元数据/索引,逐会话记录在 `shards/*.json`;
 * 直接 `JSON.parse(store.json)` 会得到 0 会话(看起来像"数据全丢了")。
 * 这里按目录判定并组装;旧的单文件库原样返回。
 */
function loadStoreAny(file) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  const shardDir = join(dirname(file), 'shards')
  if (parsed && parsed.requests === undefined && existsSync(shardDir)) {
    const shards = []
    for (const f of readdirSync(shardDir)) {
      if (!f.endsWith('.json')) continue
      try {
        const s = JSON.parse(readFileSync(join(shardDir, f), 'utf8'))
        if (s && typeof s === 'object' && typeof s.id === 'string') shards.push(s)
      } catch (e) { /* 坏分片跳过:该会话会由下次扫描重折 */ }
    }
    return joinStore(parsed, shards)
  }
  return decodeStore(parsed)
}

const rawStore = loadStoreAny(storePath)
console.log(`store: ${storePath}`)
console.log(`  版本 v${rawStore.version ?? rawStore.storeVersion ?? '?'} · 会话 ${Object.keys(rawStore.requests || {}).length} · 请求 ${Object.values(rawStore.requests || {}).reduce((a, l) => a + l.length, 0)}`)

/** 深拷贝并清掉聚合缓存,逼两边都从原始记录重算(否则比的是缓存残留) */
function freshStore() {
  const s = JSON.parse(JSON.stringify(rawStore))
  delete s.days
  delete s.months
  delete s.models
  return s
}

/** 两边各自折叠一次,返回 {endpoint, query} → JSON 字符串 */
function readAll(CORE) {
  const store = freshStore()
  const out = {}
  const rec = (name, fn) => {
    try {
      // exportedAt 是 Date.now() 写入的,两次运行必然不同 —— 归一化掉,
      // 否则会把"时钟在走"误报成行为差异。其余字段一律原样比对。
      // 注意 export.json 的正文是**再 stringify 一次**的字符串,里面的引号是 \" ——
      // 两种形态都要覆盖。
      out[name] = JSON.stringify(fn(store))
        .replace(/"exportedAt":\s*"[^"]*"/g, '"exportedAt":"<T>"')
        .replace(/\\"exportedAt\\":\s*\\"[^"\\]*\\"/g, '\\"exportedAt\\":\\"<T>\\"')
    } catch (e) {
      out[name] = `THREW ${e.constructor.name}: ${e.message}`
    }
  }
  // 覆盖全部只读查询;range/filter 组合取真实会用到的形状
  for (const range of ['today', 'week', 'month', 'all']) {
    rec(`kpi:${range}`, (s) => CORE.kpiQuery(s, range, '', '', CORE.makeFilter({}), Date.now()))
  }
  for (const g of ['day', 'month']) {
    rec(`series:${g}`, (s) => CORE.seriesQuery(s, g, 'all', '', '', CORE.makeFilter({}), Date.now()))
  }
  rec('hours:all', (s) => CORE.hoursQuery(s, 'all', '', '', CORE.makeFilter({}), Date.now()))
  rec('heatmap:12', (s) => CORE.heatmapQuery(s, 12, CORE.makeFilter({}), Date.now()))
  for (const sort of ['recent', 'cost', 'tokens']) {
    rec(`sessions:${sort}`, (s) => CORE.sessionsQuery(s, sort, 100, 'all', '', '', CORE.makeFilter({}), Date.now()))
  }
  rec('export.csv:all', (s) => CORE.exportCsv(s, 'all', '', '', CORE.makeFilter({}), Date.now()))
  rec('export.json:all', (s) => CORE.exportJson(s, 'all', '', '', CORE.makeFilter({}), Date.now()))
  rec('configView', (s) => CORE.configView(s))
  rec('metaInfo', (s) => CORE.metaInfo(s, {}))

  // 每个会话的下钻(逐会话,最容易暴露 splitModelKey / bumpModel 的口径变化)
  const ids = Object.keys(rawStore.requests || {})
  let detailCount = 0
  for (const id of ids) {
    const r = (() => { try { return JSON.stringify(CORE.sessionDetailQuery(freshStore(), id)) } catch (e) { return `THREW ${e.message}` } })()
    out[`session:${id}`] = r
    detailCount++
  }
  // 带筛选的路径(走逐记录慢路径,与聚合快路径必须一致)
  rec('kpi:all+model', (s) => {
    const keys = Object.keys(rawStore.models || {})
    if (!keys.length) return 'no-models'
    return CORE.kpiQuery(s, 'all', '', '', CORE.makeFilter({ modelSet: new Set([keys[0]]) }), Date.now())
  })
  rec('kpi:all+session', (s) => {
    const id = Object.keys(rawStore.requests || {})[0]
    return CORE.kpiQuery(s, 'all', '', '', CORE.makeFilter({ session: id }), Date.now())
  })
  return { out, detailCount }
}

const a = readAll(OLD)
const b = readAll(NEW)

const keys = new Set([...Object.keys(a.out), ...Object.keys(b.out)])
let diff = 0
let threw = 0
/**
 * 本版的**预期新增字段**,比对时先剥掉再比。
 *
 * 每加一条都要能在 CHANGELOG 里找到对应的行为变更理由 —— 这个列表是"我知道并
 * 接受这处输出变了"的显式声明,不是"让测试变绿"的开关。列表之外的任何差异
 * (哪怕一个字节)仍然会让脚本非零退出。
 *
 *   budget        0.9.0:预算状态改由服务端下发(0.8.x 只有页面自己算,
 *                 curl/侧边栏拿不到)。
 *   refresh       0.9.3:自动刷新/扫描间隔开放为配置(configView 新增),
 *                 并带上 defaultsRefresh / refreshBounds 供设置页渲染控件。
 */
const EXPECTED_ADDITIONS = [
  ['budget'],
  ['refresh'],
  ['defaultsRefresh'],
  ['refreshBounds'],
]
const strip = (s) => {
  try {
    const o = JSON.parse(s)
    for (const path of EXPECTED_ADDITIONS) {
      let node = o
      for (let i = 0; i < path.length - 1; i++) node = node && node[path[i]]
      if (node && typeof node === 'object') delete node[path[path.length - 1]]
    }
    return JSON.stringify(o)
  } catch (e) { return s }
}
for (const k of [...keys].sort()) {
  const x = a.out[k], y = b.out[k]
  if (String(x).startsWith('THREW') || String(y).startsWith('THREW')) {
    // 两边都抛且消息一致 => 等价;只有一边抛才是问题
    if (x !== y) { console.log(`✖ ${k}\n   旧: ${String(x).slice(0, 160)}\n   新: ${String(y).slice(0, 160)}`); diff++ }
    else threw++
    continue
  }
  if (x !== y && strip(x) !== strip(y)) {
    diff++
    if (diff <= 5) {
      console.log(`✖ ${k}`)
      console.log(`   长度 旧=${x.length} 新=${y.length}`)
      // 找第一个不同字符,给出可读上下文
      let i = 0
      while (i < x.length && i < y.length && x[i] === y[i]) i++
      console.log(`   首处差异 @${i}`)
      console.log(`   旧: …${x.slice(Math.max(0, i - 60), i + 60)}…`)
      console.log(`   新: …${y.slice(Math.max(0, i - 60), i + 60)}…`)
    }
  }
}

console.log('')
console.log(`${keys.size} 个接口/查询 · 会话下钻 ${a.detailCount} 个 · 两端一致抛错 ${threw} 个`)
if (diff) {
  console.log(`✖ 有 ${diff} 处输出与旧版不一致`)
  process.exit(1)
}
console.log('✔ 全部输出与旧版逐字节一致')
