/**
 * v0.9.0 — D1(分片落盘)与 D2(网页源文件模块化)的锁定断言。
 *
 * D1:分片把"元数据 + 逐会话记录"分开落盘。这里锁住**语义**(往返等价、脏分片
 * 集合、单分片损坏的恢复路径)与**结构**(store.json 不得含 requests/派生数据)。
 *
 * D2:web/index.html 是拼接产物、web/src/** 是源。这里锁住"拼接即产物"
 * (逐字节)、分区覆盖完整、以及在 **lib/index.js 读产物** 这一前提下产物仍有效。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const C = await import('../lib/core.mjs')
const {
  splitStore, joinStore, markShardsDirty, dirtyShardsOf, setDirtyShards,
  rebuildAll, kpiQuery, sessionsQuery, metaInfo, makeFilter, encodeStore, decodeStore,
  isStoreShapeValid, encodeShard, storeMeta,
} = C

/** 生产形状的 store(带 meta;与 scan-store 的真实结构一致) */
function prodStore() {
  const T = 1.79e12
  const rec = (seq, m, n) => ({ seq, t: T + seq * 1000, m, miss: n, read: n * 2, write: 0, out: n / 2, r: 0, i: 0 })
  const s = {
    version: C.STORE_VERSION, updatedAt: 1,
    sessionsRoot: 'X:\\sessions', storeFile: 'X:\\store.json',
    requests: {
      's-1': [rec(1, 'official:m1', 100), rec(2, 'official:m2', 200)],
      's-2': [rec(1, 'official:m1', 50)],
    },
    sessions: {
      's-1': { meta: { id: 's-1', title: '甲', cwd: 'D:\\a' }, totals: {}, models: {}, firstTs: T, lastTs: T + 2000 },
      's-2': { meta: { id: 's-2', title: '乙', cwd: 'D:\\b' }, totals: {}, models: {}, firstTs: T, lastTs: T + 1000 },
    },
    watermarks: { 's-1': { rev: '1' }, 's-2': { rev: '1' } },
    quarantine: {},
    config: { prices: {}, budget: { monthly: 0 }, retention: { days: 0 } },
    days: {}, months: {}, stats: {},
  }
  rebuildAll(s)
  return s
}
/** 模拟磁盘往返:每块各自 JSON 序列化/解析 */
const onDisk = (o) => JSON.parse(JSON.stringify(o))
/**
 * 内存里的 shards[id] → 磁盘分片形态(v8:自带模型表)。
 * 生产写入在 lib/index.js;这里复刻同一形状,让往返测试走真实字节路径。
 */
const diskShard = (id, s) => onDisk({ id, models: s.models, rows: s.rows })

// ═══════════════════════════════════════════════════════════════════════════
// D1 · 分片落盘
// ═══════════════════════════════════════════════════════════════════════════

test('V39: splitStore 必须把 requests 摘出去,且派生数据不入盘', () => {
  const s = prodStore()
  const { meta, shards } = splitStore(s)
  // meta 只留元数据
  assert.ok(!('requests' in meta), 'meta 不得含 requests')
  assert.ok(!('days' in meta), 'days 是派生数据,不得入盘')
  assert.ok(!('months' in meta), 'months 是派生数据,不得入盘')
  assert.ok('sessions' in meta, 'sessions 必须在 meta 里(标题不可重建)')
  assert.ok('watermarks' in meta && 'config' in meta && 'stats' in meta, '元数据齐全')
  // 分片按会话切,且**每个分片自带模型表**(v8:局部重写不会错位)
  assert.deepEqual(Object.keys(shards).sort(), ['s-1', 's-2'])
  assert.equal(shards['s-1'].rows.length, 2)
  assert.deepEqual(shards['s-1'].models, ['official:m1', 'official:m2'], '分片必须自带自己的模型表')
  assert.deepEqual(shards['s-2'].models, ['official:m1'], 's-2 的表只含它自己用到的模型')
  // **不得**再有全局模型表:留着它会诱使实现"复用全局表",那正是错位的根源
  assert.equal(meta.modelTable, undefined, 'meta 不得携带全局 modelTable')
  // sessions 只留不可重建的部分
  assert.ok(!('totals' in meta.sessions['s-1']), 'sessions.totals 是派生数据,不入盘')
  assert.ok(!('models' in meta.sessions['s-1']), 'sessions.models 是派生数据,不入盘')
  assert.equal(meta.sessions['s-1'].meta.title, '甲', '标题必须保留')
})

test('V39b: splitStore 必须是纯函数(不得改动内存 store)', () => {
  const s = prodStore()
  const snap = JSON.stringify(s)
  splitStore(s)
  assert.equal(JSON.stringify(s), snap, 'splitStore 不得改动入参')
  // 且改动后仍可查询
  assert.equal(kpiQuery(s, 'all', '', '', makeFilter({}), 1.79e12).totals.requests, 3)
})

test('V40: 分片往返必须逐字段无损,查询输出逐字节一致', () => {
  const A = prodStore()
  const { meta, shards } = splitStore(A)
  const B = joinStore(onDisk(meta), Object.keys(shards).map((id) => diskShard(id, shards[id])))
  assert.ok(!('days' in onDisk(meta)) || Object.keys(onDisk(meta).days).length === 0, '磁盘上没有 days')
  rebuildAll(B) // 载入后重建派生数据(生产由首次查询惰性触发)

  // requests 逐字段(含 rebuildAll 重算出的派生字段)
  for (const id of Object.keys(A.requests)) {
    assert.equal(B.requests[id].length, A.requests[id].length, `${id} 记录数`)
    for (let i = 0; i < A.requests[id].length; i++) {
      for (const k of ['seq', 't', 'm', 'miss', 'read', 'write', 'out', 'r', 'i', 'cost', 'saved', 'priced', 'cum']) {
        assert.equal(B.requests[id][i][k], A.requests[id][i][k], `${id}[${i}].${k}`)
      }
    }
  }
  // 会话 meta 与标题
  for (const id of Object.keys(A.sessions)) {
    assert.deepEqual(B.sessions[id].meta, A.sessions[id].meta, `${id}.meta(标题)`)
  }
  // 查询输出逐字节
  for (const [n, f] of Object.entries({
    kpi: (s) => kpiQuery(s, 'all', '', '', makeFilter({}), 1.79e12),
    sessions: (s) => sessionsQuery(s, 'cost', 100, 'all', '', '', makeFilter({}), 1.79e12),
    meta: (s) => metaInfo(s),
  })) {
    assert.equal(JSON.stringify(f(B)), JSON.stringify(f(A)), `${n} 输出必须一致`)
  }
})

test('V51: 分片必须自带模型表 —— 局部重写不得让未重写分片的 mi 错位(v8 修复回归)', () => {
  // 这是 0.9.0 的**静默数据错位**缺陷:modelTable 是全局的,而分片是局部重写的。
  // 建模顺序来自 Object.keys(requests),载入顺序来自 readdirSync —— 两者可能不同,
  // 一旦不同,未重写的分片里旧的 mi 就会指向新表里的**另一个模型**,且无声无息。
  //
  // 本断言从**字节**层面锁死修复:两个会话用不同模型,各自的分片表必须只含自己的模型。
  const s = prodStore()
  const { meta, shards } = splitStore(s)
  assert.equal(meta.modelTable, undefined, 'meta 不得携带全局模型表(错位的根源)')
  for (const id of Object.keys(shards)) {
    const sh = shards[id]
    assert.ok(Array.isArray(sh.models), `${id} 分片必须自带 models 表`)
    assert.ok(Array.isArray(sh.rows), `${id} 分片必须有 rows`)
    // 分片里的每个 mi 都必须能在**它自己的**表里解析出来
    for (const row of sh.rows) {
      assert.equal(typeof row[2], 'number', '模型列是下标')
      assert.ok(row[2] >= 0 && row[2] < sh.models.length, `${id}: mi=${row[2]} 必须在自有表范围内`)
    }
  }
  // 关键:两个会话各自独立解析,互不影响
  assert.deepEqual(shards['s-1'].models, ['official:m1', 'official:m2'])
  assert.deepEqual(shards['s-2'].models, ['official:m1'])
  // 往返后模型必须正确(而不是"能读出来但读错")
  const B = joinStore(onDisk(meta), Object.keys(shards).map((id) => diskShard(id, shards[id])))
  assert.equal(B.requests['s-1'][0].m, 'official:m1')
  assert.equal(B.requests['s-1'][1].m, 'official:m2')
  assert.equal(B.requests['s-2'][0].m, 'official:m1')
})

test('V51b: 只重写一个分片时,其余分片必须仍能按自己的表解析(v7 会在此错位)', () => {
  // 直接模拟"表内容因重写而变化"的场合:让 s-2 的表顺序与 s-1 不同,
  // 只把 s-2 重新序列化一遍,再整体载入 —— 两边的模型都必须各自正确。
  const s = prodStore()
  const { meta, shards } = splitStore(s)
  const disk = Object.keys(shards).map((id) => diskShard(id, shards[id]))
  // 把 s-2 的分片"重写"成表顺序反过来的形态(等价于另一次写入用的表)
  const s2 = disk.find((x) => x.id === 's-2')
  s2.models = s2.models.slice().reverse()
  s2.rows = s2.rows.map((r) => { const c = r.slice(); c[2] = s2.models.length - 1 - c[2]; return c })
  const B = joinStore(onDisk(meta), disk)
  assert.equal(B.requests['s-2'][0].m, 'official:m1', 's-2 按自己的(逆序)表解析仍正确')
  assert.equal(B.requests['s-1'][0].m, 'official:m1', 's-1 不受 s-2 表变化的影响')
})

test('V51c: v7 老分片(无 models 表)必须仍能按 meta 全局表读入 —— 升级不丢数据', () => {
  // v7 库的分片没有 models,mi 指向 store.json 的全局 modelTable。这必须继续可读。
  const s = prodStore()
  const { meta, shards } = splitStore(s)
  // 造一个 v7 形态:全局表 + 分片只有 rows(无 models)
  const globalTable = ['official:m1', 'official:m2']
  const v7meta = { ...onDisk(meta), version: 7, modelTable: globalTable }
  const v7shards = Object.keys(shards).map((id) => onDisk({
    id,
    rows: shards[id].rows.map((r) => { const c = r.slice(); c[2] = globalTable.indexOf(shards[id].models[r[2]]); return c }),
  }))
  const B = joinStore(v7meta, v7shards)
  assert.equal(B.requests['s-1'][0].m, 'official:m1', 'v7 分片按全局表解析')
  assert.equal(B.requests['s-1'][1].m, 'official:m2')
  assert.equal(B.requests['s-2'][0].m, 'official:m1')
  assert.ok(isStoreShapeValid(B), 'v7 库载入后必须通过体检')
})

test('V52: joinStore 必须接受两种分片形态的**混存**(部分分片尚未重写)', () => {
  // 从 v7 升到 v8 时,磁盘上可能一半是老分片、一半是新分片(只有脏的被重写过)。
  // 载入必须逐分片判定,不能用一个全局开关。
  const s = prodStore()
  const { meta, shards } = splitStore(s)
  const globalTable = ['official:m1', 'official:m2']
  const v7meta = { ...onDisk(meta), version: 7, modelTable: globalTable }
  const newShard = diskShard('s-1', shards['s-1']) // v8 形态
  const oldShard = onDisk({ // v7 形态:无 models,mi 指向全局表
    id: 's-2',
    rows: shards['s-2'].rows.map((r) => { const c = r.slice(); c[2] = globalTable.indexOf(shards['s-2'].models[r[2]]); return c }),
  })
  assert.ok(Array.isArray(newShard.models) && oldShard.models === undefined, '两个分片形态确实不同')
  const B = joinStore(v7meta, [oldShard, newShard])
  assert.equal(B.requests['s-1'][0].m, 'official:m1', '新分片按自带表')
  assert.equal(B.requests['s-1'][1].m, 'official:m2')
  assert.equal(B.requests['s-2'][0].m, 'official:m1', '老分片按全局表 —— 混存也要读对')
})

test('V41: joinStore 必须支持磁盘形态 [{id,rows}](文件名不可逆,id 以内容为准)', () => {
  const A = prodStore()
  const { meta, shards } = splitStore(A)
  // 数组形态(磁盘载入)与对象形态必须等价
  const arr = joinStore(onDisk(meta), [diskShard('s-1', shards['s-1'])])
  const obj = joinStore(onDisk(meta), { 's-1': onDisk(shards['s-1']) })
  assert.equal(arr.requests['s-1'].length, 2, '数组形态能取到记录')
  assert.equal(JSON.stringify(arr.requests), JSON.stringify(obj.requests), '两种入参形态等价')
  // 缺分片的会话不出现在 requests 里(载入侧据此删水位线重折)
  assert.equal(arr.requests['s-2'], undefined, '缺分片 → 该会话无记录')
  assert.ok(arr.sessions['s-2'].meta, '但它的 meta 仍在(标题不丢)')
})

test('V42: 脏分片集合语义(未知→全量 / 已知→只写变化的)', () => {
  const s = prodStore()
  // 未知(null)= 磁盘上没有分片 → 必须全量写
  setDirtyShards(s, null)
  assert.equal(dirtyShardsOf(s), null)
  markShardsDirty(s, 'x')
  assert.equal(dirtyShardsOf(s), null, '全量状态下标记个别 id 仍保持全量(保守)')
  // 空集 = 磁盘与内存一致 → 只写被标记的
  setDirtyShards(s, new Set())
  markShardsDirty(s, 'a')
  markShardsDirty(s, ['b', 'c'])
  assert.equal(dirtyShardsOf(s).size, 3)
  assert.ok(dirtyShardsOf(s).has('a') && dirtyShardsOf(s).has('b') && dirtyShardsOf(s).has('c'))
  // 非枚举:不落盘
  assert.ok(!Object.keys(s).includes('__dirtyShards'))
  assert.ok(!JSON.stringify(s).includes('__dirtyShards'), 'JSON.stringify 不得看到脏标记')
})

test('V43: 单分片损坏必须只影响该会话,其余照旧', () => {
  const A = prodStore()
  const { meta, shards } = splitStore(A)
  delete shards['s-2'] // 模拟该分片读不出来
  const B = joinStore(onDisk(meta), Object.keys(shards).map((id) => diskShard(id, shards[id])))
  assert.ok(B.requests['s-1'], 's-1 不受影响')
  assert.equal(B.requests['s-2'], undefined, 's-2 无记录')
  assert.ok(B.sessions['s-2'].meta.title === '乙', 's-2 的标题仍在(重折后用量回来)')
  // 载入侧应据此清掉 s-2 的水位线,让它下轮重折
  assert.ok(B.watermarks['s-2'], '水位线此时仍在(载入侧负责清掉)')
})

test('V44: 分片落盘不得把 store.json 写成含 requests 的单文件', () => {
  // 结构守卫:防止有人把 writeStore 改回"整库 stringify"
  const src = readFileSync(join(root, 'lib', 'index.js'), 'utf8')
  // 落盘必须**逐分片编码**(encodeShard),而不是先 splitStore 复制整库:
  // 后者在 20 万请求库上每次落盘多分配约 32 MB,而常态一轮只写几十 KB。
  assert.match(src, /encodeShard\(requests\[id\]\)/, 'writeStore 必须逐分片编码(encodeShard)')
  assert.match(src, /storeMeta\(store\)/, 'writeStore 必须用 storeMeta 取元数据')
  assert.doesNotMatch(src, /splitStore\(store\)/, 'writeStore 不得再整库 splitStore(会产生 32MB 瞬时分配)')
  assert.match(src, /SHARD_DIR/, '必须使用分片目录')
  // 写顺序:分片在前,meta 在后(崩溃安全)
  const iShard = src.indexOf('writeFileAtomic(file')
  const iMeta = src.indexOf('writeFileAtomic(STORE_FILE')
  assert.ok(iShard > 0 && iMeta > 0, '两处写入都要存在')
  assert.ok(iShard < iMeta, '必须先写分片、最后写元数据索引(崩溃安全)')
  // 载入必须识别分片布局。
  //
  // 0.9.4 起不再断言字面量 `joinStore(`:载入路径改走 core.loadShardsAsync
  // (异步 + 并发 8),joinStore 由那个共用函数内部调用 —— 详情放在 core 里,
  // Host 侧只剩"把文件读出来"这一步。这里改断言**真正的结构事实**:
  //   · import 列表里要取到 loadShardsAsync(Host 不再自己拼分片);
  //   · 调用它时必须注入真正的异步文件读取(fs/promises),否则就退回同步 IO,
  //     而同步 IO 正是 0.9.4 要消灭的那 103 ms 独占事件循环的来源。
  assert.match(src, /loadShardsAsync/, '载入必须走 core.loadShardsAsync(异步 + 并发)')
  assert.match(src, /readFile as readFileAsync|fs\/promises/, '分片读取必须用 fs/promises(不得退回同步 readFileSync)')
  assert.match(src, /isShardLayout/, '载入必须判定布局')
  // 反向守卫:分片循环里不得再出现同步 readFileSync(store.json 那一次除外)
  const shardBlock = src.slice(src.indexOf('loadShardsAsync'), src.indexOf('loadShardsAsync') + 400)
  assert.doesNotMatch(shardBlock, /readFileSync/, '分片读取路径不得含同步 readFileSync')
})

test('V53: 逐分片编码必须与整库 splitStore 得到**相同字节**(否则落盘会悄悄变格式)', () => {
  // writeStore 用 encodeShard 逐个编码(省内存),测试与工具用 splitStore 整库编码。
  // 两条路径必须产出完全相同的分片字节 —— 否则"用哪种编码"会影响落盘内容。
  const s = prodStore()
  const { shards } = splitStore(s)
  for (const id of Object.keys(s.requests)) {
    const one = encodeShard(s.requests[id])
    assert.deepEqual(one.models, shards[id].models, `${id} 模型表必须一致`)
    assert.deepEqual(one.rows, shards[id].rows, `${id} 行必须一致`)
    assert.equal(
      JSON.stringify({ id, models: one.models, rows: one.rows }),
      JSON.stringify({ id, models: shards[id].models, rows: shards[id].rows }),
      `${id} 落盘字节必须一致`,
    )
  }
  // storeMeta 必须与 splitStore 的 meta 一致
  assert.equal(JSON.stringify(storeMeta(s)), JSON.stringify(splitStore(s).meta), 'meta 字节必须一致')
  // 空会话也要能编码(不能抛)
  assert.deepEqual(encodeShard([]), { models: [], rows: [] })
  assert.deepEqual(encodeShard(undefined), { models: [], rows: [] })
})

test('V45: 扫描重折会话后必须标记该分片为脏(行为验证)', async () => {
  // 行为验证优于结构断言:这里真的跑一次 scanStore,确认被重折的会话进了脏集合。
  // 不标脏 → 落盘时该分片不重写 → 重启后看到旧数据(静默丢更新)。
  const { scanStore } = await import('../lib/session-source.mjs')
  const T = Date.now() - 60_000
  const fake = {
    async list() { return [{ header: { id: 's-1', cwd: 'D:\\a' }, revision: 1 }] },
    async open() {
      return {
        header: { id: 's-1', cwd: 'D:\\a' },
        read: async () => ({ events: [
          { type: 'request/header', seq: 1, time: T, data: { header: { config: { provider: 'official', model: 'm1' } } } },
          { type: 'assistant/message', seq: 2, time: T + 1, data: { turn: 1, step: 0, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 } } },
        ] }),
        close: async () => {},
      }
    },
    locate: () => null,
  }
  const s = prodStore()
  s.requests = {}; s.sessions = {}; s.watermarks = {}; s.days = {}; s.months = {}
  setDirtyShards(s, new Set()) // 模拟"磁盘与内存一致"的分片库
  const sum = await scanStore(s, fake, { logger: null })
  assert.equal(sum.scanned, 1, '应重折 1 个会话')
  const dirty = dirtyShardsOf(s)
  assert.ok(dirty && dirty.has('s-1'), '被重折的会话必须进脏集合(否则分片不重写)')
})

test('V45b: 修剪(retention)后必须标记该分片为脏(行为验证)', async () => {
  const { scanStore } = await import('../lib/session-source.mjs')
  const now = Date.now()
  const old = now - 40 * 86400000 // 40 天前,超出 retention=30
  const fake = {
    async list() { return [{ header: { id: 's-old', cwd: 'D:\\a' }, revision: 9 }] },
    async open() {
      return {
        header: { id: 's-old', cwd: 'D:\\a' },
        read: async () => ({ events: [
          { type: 'request/header', seq: 1, time: old, data: { header: { config: { provider: 'official', model: 'm1' } } } },
          { type: 'assistant/message', seq: 2, time: old + 1, data: { turn: 1, step: 0, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 } } },
        ] }),
        close: async () => {},
      }
    },
    locate: () => null,
  }
  const s = prodStore()
  s.config = { prices: {}, budget: { monthly: 0 }, retention: { days: 30 } }
  // 预置一条超龄记录 + 已就绪的水位线,让"修剪"这一步真的发生
  s.requests = { 's-old': [{ seq: 1, t: old, m: 'official:m1', miss: 1, read: 0, write: 0, out: 1, r: 0, i: 0 }] }
  s.sessions = { 's-old': { meta: { id: 's-old' }, totals: {}, models: {}, firstTs: old, lastTs: old } }
  s.watermarks = { 's-old': { rev: '9' } }
  s.days = {}; s.months = {}
  setDirtyShards(s, new Set())
  const sum = await scanStore(s, fake, { logger: null, nowMs: now })
  assert.ok(sum.pruned >= 1, `应修剪至少 1 条(实际 ${sum.pruned})`)
  const dirty = dirtyShardsOf(s)
  assert.ok(dirty && dirty.has('s-old'), '被修剪的会话必须进脏集合(否则分片残留已删记录)')
})

test('V45c: 会话从 list() 消失后必须标记为脏(以便删除其分片)', async () => {
  // 注意(list() 返回空 → 会话被判定为消失)这条路在 0.9.3 起**需要连续两轮确认**:
  // 后端"没准备好"时 list() 会瞬时返回空,而原实现会把它当成"用户删光了会话"，
  // 一次清空整库(真实案例:宿主测试用 list()=>[] 的桩把一份 53 会话的库清成空索引)。
  // 所以这里**连扫两轮**才走到真正的清理路径 —— 这本身也是对"延后确认"
  // 这条守卫的回归锁定(第一轮必须什么都没删)。
  const { scanStore } = await import('../lib/session-source.mjs')
  const fake = { async list() { return [] }, async open() { throw new Error('should not be called') }, locate: () => null }
  const s = prodStore()
  setDirtyShards(s, new Set()) // 分片库:磁盘上有 s-1 / s-2 的分片

  const first = await scanStore(s, fake, { logger: null })
  assert.equal(first.removed, 0, '第一轮空列表只延后、不清库(后端可能没准备好)')
  assert.equal(Object.keys(s.requests).length, 2, '第一轮后两个会话必须都还在')

  const sum = await scanStore(s, fake, { logger: null })
  assert.equal(sum.removed, 2, '连续两轮确认后,两个会话都应被判定为已消失')
  const dirty = dirtyShardsOf(s)
  assert.ok(dirty && dirty.has('s-1') && dirty.has('s-2'), '消失的会话必须进脏集合,否则分片不会被清理')
})

// ═══════════════════════════════════════════════════════════════════════════
// D2 · 网页源文件模块化
// ═══════════════════════════════════════════════════════════════════════════

test('V46: web/index.html 必须是 web/src/** 的逐字节拼接产物', async () => {
  const { buildFrom } = await import('../scripts/build-web.mjs')
  const artifact = readFileSync(join(root, 'web', 'index.html'), 'utf8')
  const built = buildFrom()
  assert.equal(built, artifact, '拼接结果必须与交付物逐字节一致(否则改了 src 忘了构建)')
})

test('V46b: build-web 的 --check 语义(不一致即非零退出)可用', async () => {
  const { buildFrom } = await import('../scripts/build-web.mjs')
  // buildFrom 对缺失源文件必须抛(缺一块会产出坏页面)
  assert.throws(() => buildFrom(join(root, 'web', '__no_such_src__')), /缺少源文件/, '缺源文件必须抛')
})

test('V47: 交付物必须仍是单文件(内联脚本 + 无外部资源)', () => {
  const html = readFileSync(join(root, 'web', 'index.html'), 'utf8')
  // 不得出现外部 script/link(拆包会破坏 CSP 与"单文件零构建"的交付形态)
  assert.doesNotMatch(html, /<script[^>]*\bsrc\s*=/i, '不得有外部脚本')
  assert.doesNotMatch(html, /<link[^>]*rel=["']?stylesheet/i, '不得有外部样式表')
  // 仍必须有内联脚本(build.mjs 会断言这一点)
  const inline = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi)]
  assert.ok(inline.length >= 1, '必须至少有一个内联脚本')
  // IIFE + 'use strict' 是"切片拼接安全"的前提,必须保持
  assert.match(inline[0][1], /\(function \(\) \{/, '内联脚本应保持 IIFE 形态')
  assert.match(inline[0][1], /'use strict'/, '内联脚本应保持 use strict')
})

test('V47b: 两对 dtk:tokens 标记必须仍在样式源里(token 注入依赖它)', () => {
  const css = readFileSync(join(root, 'web', 'src', 'style.css'), 'utf8')
  const pairs = (css.match(/\/\* dtk:tokens:begin \*\//g) || []).length
  assert.equal(pairs, 2, '样式源必须有两个 begin 标记(浅色/深色)')
  assert.equal((css.match(/\/\* dtk:tokens:end \*\//g) || []).length, 2, '必须有两个 end 标记')
  // 产物里也必须还在(注入是注入到源、再由 build-web 带进产物)
  const html = readFileSync(join(root, 'web', 'index.html'), 'utf8')
  assert.equal((html.match(/\/\* dtk:tokens:begin \*\//g) || []).length, 2, '产物里标记也要在')
})

test('V48: build-tokens 必须注入到**源文件**而不是产物(否则拼接会覆盖注入)', () => {
  const src = readFileSync(join(root, 'scripts', 'build-tokens.mjs'), 'utf8')
  assert.match(src, /file: 'web\/src\/style\.css'/, 'token 必须注入 web/src/style.css')
  assert.doesNotMatch(src, /file: 'web\/index\.html'/, '不得再注入产物(会被 build-web 覆盖)')
})

test('V49: package.json 必须把 web/src 排除在发布内容外,并保留产物', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.ok(pkg.files.includes('web/index.html'), '产物必须入包')
  assert.ok(!pkg.files.includes('web'), '不得整目录入包(否则带上 web/src 源文件)')
  // test/prepack 必须校验产物与源一致
  assert.match(pkg.scripts.test, /build-web\.mjs --check/, 'npm test 必须校验产物与源一致')
  assert.match(pkg.scripts.prepack, /build-web\.mjs --check/, 'prepack 同样要校验')
  // 顺序:先 token 后拼接
  const iTok = pkg.scripts.prepack.indexOf('build-tokens')
  const iWeb = pkg.scripts.prepack.indexOf('build-web')
  assert.ok(iTok >= 0 && iWeb > iTok, '顺序必须是 build-tokens → build-web')
})

test('V50: 源文件必须齐全(缺一份就构建不出可用的页面)', async () => {
  const { PARTS } = await import('../scripts/web-parts.mjs')
  for (const rel of PARTS) {
    assert.ok(existsSync(join(root, 'web', 'src', rel)), `缺少 web/src/${rel}`)
  }
})
