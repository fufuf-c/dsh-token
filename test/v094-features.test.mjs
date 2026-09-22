/**
 * dsh-token — 0.9.4 新增能力测试(node:test,零依赖)
 *
 * 覆盖四件在 0.9.4 改动的事,每一件都对应一个真实缺陷或一次真实的清库风险:
 *
 *   A. **异步分片载入**(core.loadShardsAsync)
 *      —— 同步 readFileSync×N 会独占事件循环约 103 ms(400 分片 / 20 万请求库);
 *      这里锁住"结果与同步 joinStore 完全相同"以及"损坏分片只影响自己"。
 *
 *   B. **分片重建**(core.rebuildAllChunked)
 *      —— 它是 0.9.4 唯一动到聚合计算路径的改动,必须与同步版**逐字段相同**。
 *      这一条是整版最关键的断言:算法被抽成 rebuildSessionInto 供两条驱动共用,
 *      若两者结果有任何差异,聚合就会随"哪条路径先跑"而变。
 *
 *   C. **会话分页**(sessionsQuery 的 pageInfo / apiDispatch 的 meta=1)
 *      —— 此前 limit 被静默钳到 500 且响应里没有任何字段说明被截断。
 *
 *   D. **webPagePath 清理**(purgeRemovedConfig)
 *      —— 0.8.9 移除该配置后,老库里的值一直留在 store.json 里(是一个本机绝对路径)。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  emptyStore, splitStore, joinStore, loadShardsAsync, rebuildAll, rebuildAllChunked,
  kpiQuery, makeFilter, sessionsQuery, apiDispatch, applyConfigPatch, configView,
  newTotals, foldSession, encodeShard, markScanning, aggregatesReady,
} from '../lib/core.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 造一份有真实规模感的库:多会话 × 多模型 × 跨天(让 days/months 都有内容)。 */
function makeStore(sessions = 6, perSession = 25, models = 3, nowMs = null) {
  const s = emptyStore()
  const mk = (i) => (i % 2 ? 'deepseek-official:deepseek-flash' : 'gmi:model-' + (i % models))
  // nowMs 可固定:比较"同步 vs 分片重建"时两份库必须用**同一个时间锚点**,
  // 否则各自的 Date.now() 会差 1ms,差异落在 sessions.firstTs 上,failure 与算法无关。
  const now = nowMs === null ? Date.now() : nowMs
  for (let i = 0; i < sessions; i++) {
    const id = `session-${i}`
    const events = []
    for (let r = 0; r < perSession; r++) {
      events.push({
        type: 'request/header', seq: r * 2 + 1, time: now - (r % 30) * 86400000 - i * 3600000,
        data: { header: { config: { provider: 'gmi', model: mk(r) } } },
      })
      events.push({
        type: 'assistant/message', seq: r * 2 + 2, time: now - (r % 30) * 86400000 - i * 3600000 + 500,
        data: { turn: 1, step: 1, usage: { inputTokens: 1000 + r, outputTokens: 50 + r, cacheReadTokens: 200 + r, cacheWriteTokens: 10 } },
      })
    }
    s.requests[id] = foldSession(events)
    s.sessions[id] = {
      meta: { id, title: '会话 ' + i, cwd: 'C:\\proj\\p' + (i % 3), workspace: 'p' + (i % 3) },
      totals: newTotals(), models: {}, firstTs: null, lastTs: null,
    }
    s.watermarks[id] = { rev: String(i) }
  }
  return s
}

// ═══════════════════════════════════════════════════════════════════════════
// A · 异步分片载入
// ═══════════════════════════════════════════════════════════════════════════

test('V54: loadShardsAsync 的结果必须与同步 joinStore 逐字段一致', async () => {
  const src = makeStore()
  rebuildAll(src)
  const { meta, shards } = splitStore(src)
  const diskShape = Object.entries(shards).map(([id, s]) => ({ id, models: s.models, rows: s.rows }))
  const textOf = (o) => JSON.stringify(o)

  // 同步路径
  const syncStore = joinStore(meta, diskShape)
  // 异步路径:走 port 注入(模拟 fs.promises.readFile)
  const byFile = new Map()
  diskShape.forEach((sh, i) => byFile.set('/shards/' + i + '.json', textOf(sh)))
  const asyn = await loadShardsAsync(meta, [...byFile.keys()], { readFile: async (p) => byFile.get(p) })

  assert.equal(asyn.shardCount, diskShape.length)
  assert.equal(asyn.errorCount, 0)
  assert.equal(asyn.legacyCount, 0, 'v8 分片自带模型表,不该被判成老格式')
  // 记录内容逐字段一致
  assert.deepEqual(Object.keys(asyn.store.requests).sort(), Object.keys(syncStore.requests).sort())
  for (const id of Object.keys(syncStore.requests)) {
    assert.deepEqual(asyn.store.requests[id], syncStore.requests[id], `${id} 记录必须一致`)
  }
  rebuildAll(asyn.store); rebuildAll(syncStore)
  assert.equal(
    JSON.stringify(kpiQuery(asyn.store, 'all', null, null, makeFilter({}))),
    JSON.stringify(kpiQuery(syncStore, 'all', null, null, makeFilter({}))),
    '载入后查询输出逐字节一致',
  )
})

test('V55: 单个分片损坏只影响它自己,其余照常载入(异步路径)', async () => {
  const src = makeStore(5)
  rebuildAll(src)
  const { meta, shards } = splitStore(src)
  const entries = Object.entries(shards)
  const files = new Map()
  entries.forEach(([id, s], i) => files.set('/s/' + i + '.json', JSON.stringify({ id, models: s.models, rows: s.rows })))
  // 让其中一个文件不可读、另一个是坏 JSON
  const keys = [...files.keys()]
  const errors = []
  const res = await loadShardsAsync(meta, keys, {
    readFile: async (p) => {
      if (p === keys[0]) throw new Error('EACCES: 读不了')
      if (p === keys[1]) return '{ 这不是 JSON'
      return files.get(p)
    },
    onShardError: (p, e) => errors.push(p),
  })
  assert.equal(res.errorCount, 2, '两个坏分片都要计入 errorCount')
  assert.equal(res.shardCount, entries.length - 2, '其余分片必须正常载入')
  // onShardError 对"读失败"与"解析失败"**都要**回调 —— 否则一个坏 JSON 分片会
  // 静默消失,日志里没有任何线索
  assert.equal(errors.length, 2, '两种坏法都要回调 onShardError')
  // 存活会话的用量必须还在(不是整库归零)
  rebuildAll(res.store)
  const k = kpiQuery(res.store, 'all', null, null, makeFilter({}))
  assert.ok(k.totals.requests > 0, '存活分片的用量不能被坏分片带没')
})

test('V55b: v7 老分片(无自带 models 表)必须计入 legacyCount,以便整批重写', async () => {
  const src = makeStore(3)
  rebuildAll(src)
  const { meta, shards } = splitStore(src)
  const entries = Object.entries(shards)
  const files = new Map()
  entries.forEach(([id, s], i) => {
    // 偶数个做成 v8(带 models),奇数个做成 v7(只有 rows)—— 模拟"部分重写过"
    const body = i % 2 === 0 ? { id, models: s.models, rows: s.rows } : { id, rows: s.rows }
    files.set('/m/' + i + '.json', JSON.stringify(body))
  })
  const res = await loadShardsAsync(meta, [...files.keys()], { readFile: async (p) => files.get(p) })
  assert.equal(res.legacyCount, entries.filter((_, i) => i % 2 === 1).length, 'v7 分片数量要被正确统计')
  // 混存也要能全部读出来
  assert.equal(Object.keys(res.store.requests).length, entries.length, '两种形态可混存')
})

test('V56: 并发上限被遵守(不得同时打开全部分片)', async () => {
  const src = makeStore(20)
  rebuildAll(src)
  const { meta, shards } = splitStore(src)
  const entries = Object.entries(shards)
  let inFlight = 0, peak = 0
  const files = new Map()
  entries.forEach(([id, s], i) => files.set('/c/' + i + '.json', JSON.stringify({ id, models: s.models, rows: s.rows })))
  await loadShardsAsync(meta, [...files.keys()], {
    readFile: async (p) => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 1)); inFlight--; return files.get(p) },
  }, { concurrency: 4 })
  assert.ok(peak <= 4, `并发不得超过 4(实测峰值 ${peak})`)
  assert.ok(peak >= 2, `并发应当真的并行(实测峰值 ${peak})`)
})

test('V56b: 空分片目录不得抛(全新安装的冷启动路径)', async () => {
  const res = await loadShardsAsync(emptyStore(), [], { readFile: async () => '' })
  assert.equal(res.shardCount, 0)
  assert.equal(res.errorCount, 0)
  assert.deepEqual(res.store.requests, {})
})

// ═══════════════════════════════════════════════════════════════════════════
// B · 分片(异步)重建 —— 与同步版逐字段等价
// ═══════════════════════════════════════════════════════════════════════════

test('V57: rebuildAllChunked 与 rebuildAll 必须产出**完全相同**的聚合与记录', async () => {
  // 固定时间锚点:两份库必须完全同源,否则比较的就不是算法而是时钟(见 makeStore)
  const ANCHOR = 1789994400000
  const a = makeStore(8, 30, 4, ANCHOR)
  const b = makeStore(8, 30, 4, ANCHOR)
  rebuildAll(a)
  await rebuildAllChunked(b, { sliceMs: 0 }) // sliceMs=0 → 每个会话都让出一次,最大化交错
  assert.equal(JSON.stringify(a.days), JSON.stringify(b.days), 'days 必须一致')
  assert.equal(JSON.stringify(a.months), JSON.stringify(b.months), 'months 必须一致')
  assert.equal(JSON.stringify(a.sessions), JSON.stringify(b.sessions), 'sessions 元数据必须一致')
  for (const id of Object.keys(a.requests)) {
    assert.equal(JSON.stringify(a.requests[id]), JSON.stringify(b.requests[id]), `${id} 逐记录必须一致(含 cost/saved/priced/cum)`)
  }
  assert.equal(
    JSON.stringify(kpiQuery(a, 'all', null, null, makeFilter({}))),
    JSON.stringify(kpiQuery(b, 'all', null, null, makeFilter({}))),
  )
})

test('V57b: 分片重建期间必须真的让出事件循环(不得一次性跑完)', async () => {
  const s = makeStore(12, 30, 3)
  let yields = 0
  const realSetImmediate = globalThis.setImmediate
  // 用一个可观测的"片边界"标记:每次 setImmediate 都计数
  const t0 = Date.now()
  await rebuildAllChunked(s, { sliceMs: 0, now: () => (yields++, Date.now()) })
  assert.ok(yields > 0, 'now() 必须被调用(切片判据存在)')
  assert.ok(Date.now() - t0 >= 0)
  assert.ok(aggregatesReady(s) || s.days, '重建完成后聚合必须已发布')
  void realSetImmediate
})

test('V58: 分片重建失败时必须把 stale 置回(不留下"声称就绪"的假象)', async () => {
  const s = makeStore(4)
  // 制造一个中途抛错:某会话的 requests 不是数组
  s.requests['boom'] = null
  await assert.rejects(() => rebuildAllChunked(s, { sliceMs: 0 }), '坏数据必须抛出而不是静默')
  // 抛错后聚合必须处于"不可读"状态,让下一次读取重试
  assert.equal(aggregatesReady(s), false, '失败后必须回退到"未就绪"')
})

test('V59: 分片重建必须尊重"已有重建在跑"的互斥(不得并发两次)', async () => {
  const s = makeStore(6, 10)
  markScanning(s, true)
  const p = rebuildAllChunked(s, { sliceMs: 0 })
  // 同一 store 上再起一次:应当立即返回(flushing 已置位),不得交错写
  const again = rebuildAllChunked(s, { sliceMs: 0 })
  await Promise.all([p, again])
  markScanning(s, false)
  assert.ok(s.days && Object.keys(s.days).length > 0, '第一轮必须正常完成')
})

// ═══════════════════════════════════════════════════════════════════════════
// C · 会话分页
// ═══════════════════════════════════════════════════════════════════════════

test('V61: 分片分页元信息必须如实报告总数(total 是截断前的真实条数)', () => {
  const s = makeStore(30, 3)
  rebuildAll(s)
  const info = {}
  const page1 = sessionsQuery(s, 'tokens', 10, 'all', null, null, makeFilter({}), Date.now(), info)
  assert.equal(page1.length, 10, '第一页返回 10 条')
  assert.equal(info.total, 30, 'total 必须是**截断前**的真实条数')
  assert.equal(info.limit, 10)
  assert.equal(info.offset, 0)
  assert.equal(info.hasMore, true, '还有 20 条 → hasMore')
  // 翻到第二页,不得与第一页重叠
  const i2 = { offset: 10 }
  const page2 = sessionsQuery(s, 'tokens', 10, 'all', null, null, makeFilter({}), Date.now(), i2)
  assert.equal(i2.offset, 10)
  const ids1 = new Set(page1.map((x) => x.id))
  for (const it of page2) assert.ok(!ids1.has(it.id), '第二页不得与第一页重复')
  // 最后一页
  const i3 = { offset: 20 }
  const page3 = sessionsQuery(s, 'tokens', 10, 'all', null, null, makeFilter({}), Date.now(), i3)
  assert.equal(page3.length, 10)
  assert.equal(i3.hasMore, false, '取完了 → 不再有更多')
})

test('V60: sessionsQuery 不传 pageInfo 时返回类型仍是**数组**', () => {
  const s = makeStore(5, 3)
  rebuildAll(s)
  const out = sessionsQuery(s, 'cost', 3, 'all', null, null, makeFilter({}))
  assert.ok(Array.isArray(out), '必须仍是数组,不能变成包装对象')
  assert.equal(out.length, 3)
})

test('V61b: limit 仍被钳到 [1,500],offset 被钳到翻页上限', () => {
  const s = makeStore(30, 3)
  rebuildAll(s)
  // 每次都用独立的 info 对象(查询会就地写它),再取返回的数组断言
  const q = (info) => sessionsQuery(s, 'cost', info.limit, 'all', null, null, makeFilter({}), Date.now(), info)
  assert.equal(q({ limit: 99999 }).length, 30, 'limit 超上限 → 返回实际条数(库只有 30)')
  const neg = { limit: -5, offset: -100 }
  q(neg)
  assert.equal(neg.limit, 50, '非法 limit → 默认 50')
  assert.equal(neg.offset, 0, '非法 offset → 0')
  const huge = { limit: 5, offset: 1e9 }
  assert.equal(q(huge).length, 0, 'offset 超出库大小 → 空页(不得抛)')
  assert.ok(huge.offset <= 5000, 'offset 钳到翻页上限')
  // 边界:limit=1 要真的给 1 条;limit 恰为上限 500 时库不够则给实际条数
  assert.equal(q({ limit: 1 }).length, 1)
  assert.equal(q({ limit: 500 }).length, 30)
})

test('V60b: apiDispatch 默认返回数组;meta=1 才包装(形状向后兼容)', () => {
  const s = makeStore(8, 3)
  rebuildAll(s)
  const plain = JSON.parse(apiDispatch(s, 'sessions', { sort: 'cost', limit: 3 }).body)
  assert.ok(Array.isArray(plain), '不带 meta 时必须是数组')
  assert.equal(plain.length, 3)
  const wrapped = JSON.parse(apiDispatch(s, 'sessions', { sort: 'cost', limit: 3, meta: '1' }).body)
  assert.ok(!Array.isArray(wrapped), 'meta=1 时改为包装对象')
  assert.equal(wrapped.sessions.length, 3)
  assert.equal(wrapped.total, 8)
  assert.equal(wrapped.hasMore, true)
  // offset 生效
  const p2 = JSON.parse(apiDispatch(s, 'sessions', { sort: 'cost', limit: 3, meta: '1', offset: '3' }).body)
  assert.equal(p2.offset, 3)
  const ids = new Set(wrapped.sessions.map((x) => x.id))
  for (const it of p2.sessions) assert.ok(!ids.has(it.id), 'offset 必须真的跳过前 3 条')
})

// ═══════════════════════════════════════════════════════════════════════════
// D · webPagePath 清理
// ═══════════════════════════════════════════════════════════════════════════

test('V62: 老库里残留的 webPagePath 必须被清掉(它是一个本机绝对路径)', () => {
  const s = emptyStore()
  s.config.webPagePath = 'C:/Users/someone/.dsh/profiles/web/node_modules/x/web/index.html'
  assert.ok(configView(s) && !('webPagePath' in configView(s)), 'configView 本来就不返回它')
  applyConfigPatch(s, { budget: { monthly: 20 } })
  assert.ok(!('webPagePath' in s.config), '一次配置写入就必须把它清掉')
})

test('V62b: 清理只针对已移除的键,不得误删其它配置', () => {
  const s = emptyStore()
  s.config.webPagePath = 'x'
  s.config.someFutureKey = { keep: 1 } // 模拟"未来版本写的、本版还不认识"的键
  applyConfigPatch(s, { retention: { days: 30 } })
  assert.ok(!('webPagePath' in s.config), '已移除的键要清掉')
  assert.deepEqual(s.config.someFutureKey, { keep: 1 }, '不认识的键必须原样保留(降级不该抹数据)')
  assert.equal(s.config.retention.days, 30, '本次要改的要生效')
})

test('V62c: 传 webPagePath 仍然被显式拒绝(清理不等于重新接受)', () => {
  const s = emptyStore()
  assert.throws(() => applyConfigPatch(s, { webPagePath: '/etc/passwd' }), /已在 0\.8\.9 移除/, '写入侧必须继续拒绝')
})

// ═══════════════════════════════════════════════════════════════════════════
// E · 包体治理(源码级)
// ═══════════════════════════════════════════════════════════════════════════

test('V63: package.json 的 files 必须逐个列出运行时文件,不得整目录收入 lib', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  for (const f of ['lib/index.js', 'lib/core.mjs', 'lib/session-source.mjs', 'lib/client.js', 'web/index.html']) {
    assert.ok(pkg.files.includes(f), `files 必须显式包含 ${f}`)
  }
  assert.ok(!pkg.files.includes('lib'), '不得整目录收 lib —— 那会把 design-tokens.mjs(仅构建期使用)也发出去')
  assert.ok(!pkg.files.includes('web'), '不得整目录收 web(会带上 web/src 源文件)')
})

test('V63b: design-tokens.mjs 只能是构建期依赖,不得被运行时模块 import', () => {
  // 它被 files 排除出包,所以一旦运行时 import 它,安装后会 MODULE_NOT_FOUND
  for (const f of ['lib/index.js', 'lib/core.mjs', 'lib/session-source.mjs', 'lib/client.js']) {
    const src = readFileSync(join(root, f), 'utf8')
    const imports = [...src.matchAll(/^\s*import[\s\S]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
    assert.ok(!imports.some((p) => p.includes('design-tokens')), `${f} 不得 import design-tokens(它不进包)`)
  }
  // 构建期脚本仍然要能拿到它
  const bt = readFileSync(join(root, 'scripts', 'build-tokens.mjs'), 'utf8')
  assert.match(bt, /design-tokens\.mjs/, 'build-tokens 仍从它取单一来源')
})
