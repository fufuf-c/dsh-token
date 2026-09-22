/**
 * v0.9.0 — C 批(紧凑落盘格式 v7)的锁定断言。
 *
 * 这是本版**风险最高**的改动:落盘格式换了。因此这里的断言重点不是"跑得通",
 * 而是三件必须成立的事:
 *   1. **往返无损**:encode → JSON → parse → decode 后逐字段等价,查询输出逐字节一致;
 *   2. **旧库可读**:v6 的对象形态能被识别并原样读入,不被误判损坏(否则丢用户配置);
 *   3. **形状约定**:紧凑库必须先 decode 才能过体检(防止未展开的库被直接使用)。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const C = await import('../lib/core.mjs')
const {
  encodeStore, decodeStore, rebuildAll, isStoreShapeValid, emptyStore,
  kpiQuery, seriesQuery, sessionsQuery, metaInfo, exportCsv, makeFilter, STORE_VERSION,
} = C

/** 造一个带派生字段的 v6 形态 store(模拟真实老库) */
function v6Store() {
  return {
    version: 6,
    updatedAt: 1,
    sessionsRoot: 'X:\\sessions', storeFile: 'X:\\store.json',
    requests: {
      's-1': [
        { seq: 1, t: 1.79e12, m: 'official:m1', miss: 10, read: 20, write: 0, out: 5, r: 3, i: 0, cost: 0.1, saved: 0.2, priced: 1, cum: 30 },
        { seq: 2, t: 1.79e12 + 1000, m: 'official:m2', miss: 7, read: 0, write: 1, out: 2, r: 0, i: 1, cost: 0.05, saved: 0, priced: 1, cum: 38 },
      ],
      's-2': [{ seq: 1, t: 1.79e12 + 2000, m: 'official:m1', miss: 4, read: 8, write: 0, out: 1, r: 0, i: 0, cost: 0.02, saved: 0.01, priced: 1, cum: 12 }],
    },
    sessions: {
      's-1': { meta: { id: 's-1', title: '甲' }, totals: { miss: 17, read: 20, write: 1, out: 7, requests: 2, cost: 0.15, saved: 0.2, priced: 2 }, models: { 'official:m1': { requests: 1, cost: 0.1 }, 'official:m2': { requests: 1, cost: 0.05 } }, firstTs: 1, lastTs: 2 },
      's-2': { meta: { id: 's-2', title: '乙' }, totals: { miss: 4, read: 8, write: 0, out: 1, requests: 1, cost: 0.02, saved: 0.01, priced: 1 }, models: { 'official:m1': { requests: 1, cost: 0.02 } }, firstTs: 3, lastTs: 3 },
    },
    watermarks: { 's-1': { rev: 'r1' }, 's-2': { rev: 'r2' } },
    quarantine: {},
    config: { prices: {}, budget: { monthly: 0 }, retention: { days: 0 }, peakHours: [[9, 12]], peakDays: [1, 2, 3, 4, 5] },
    days: {}, months: {},
    stats: { fullScans: 1, incrementalScans: 2, scannedFiles: 2, newRequests: 3, failedSessions: 0, lastScanAt: 1, lastScanMs: 1, lastSummary: null },
  }
}

const roundTrip = (s) => decodeStore(JSON.parse(JSON.stringify(encodeStore(s))))

test('V32: 紧凑落盘往返必须逐字段无损(requests / sessions / config / watermarks)', () => {
  const a = v6Store()
  rebuildAll(a)
  const b = roundTrip(a)

  // requests:逐会话逐记录逐字段
  assert.deepEqual(Object.keys(b.requests).sort(), Object.keys(a.requests).sort(), '会话集合一致')
  for (const id of Object.keys(a.requests)) {
    assert.equal(b.requests[id].length, a.requests[id].length, `${id} 记录数一致`)
    for (let i = 0; i < a.requests[id].length; i++) {
      for (const k of ['seq', 't', 'm', 'miss', 'read', 'write', 'out', 'r', 'i']) {
        assert.equal(b.requests[id][i][k], a.requests[id][i][k], `${id}[${i}].${k} 必须一致`)
      }
    }
  }
  // 派生字段(cost/saved/priced/cum)虽不入盘,但载入后 rebuildAll 会重算 → 等价。
  // 注意:decodeStore 之后**尚未**重算,那时 cost 是 undefined —— 这是设计如此
  // (落盘层不负责派生)。必须先 rebuildAll 再比,否则比的是"未重算"的中间态。
  rebuildAll(b)
  assert.equal(b.requests['s-1'][0].cost, a.requests['s-1'][0].cost, 'cost 由 rebuildAll 重算后一致')
  assert.equal(b.requests['s-1'][0].priced, a.requests['s-1'][0].priced)
  // sessions 整体(含 models 的键与值)
  for (const id of Object.keys(a.sessions)) {
    assert.deepEqual(Object.keys(b.sessions[id].models).sort(), Object.keys(a.sessions[id].models).sort(), `${id} models 键集合一致`)
    assert.deepEqual(b.sessions[id].totals, a.sessions[id].totals, `${id} totals 一致`)
    assert.deepEqual(b.sessions[id].meta, a.sessions[id].meta, `${id} meta 一致`)
  }
  assert.deepEqual(b.watermarks, a.watermarks, 'watermarks 一致')
  assert.deepEqual(b.config, a.config, 'config(用户数据)一致')
  assert.deepEqual(b.stats, a.stats, 'stats 一致')
})

test('V32b: 紧凑落盘往返后,sessions.models 必须是**对象**(不是二元组数组)', () => {
  // models 落盘写成有序二元组数组是为了保插入顺序;展开后必须回到对象形状,
  // 否则 `ses.models[mk]` 这类逐模型访问会静默拿到 undefined。
  const a = v6Store(); rebuildAll(a)
  const b = roundTrip(a)
  assert.ok(!Array.isArray(b.sessions['s-1'].models), 'models 必须是对象')
  assert.equal(typeof b.sessions['s-1'].models['official:m1'], 'object', '可按模型键直接取用')
  assert.equal(b.sessions['s-1'].models['official:m1'].requests, 1)
})

test('V32c: 往返后查询输出逐字节一致(含慢路径与导出)', () => {
  const a = v6Store(); rebuildAll(a)
  const b = roundTrip(a)
  const now = 1.79e12 + 10000
  const ops = {
    'kpi all': (s) => kpiQuery(s, 'all', '', '', makeFilter({}), now),
    'kpi today': (s) => kpiQuery(s, 'today', '', '', makeFilter({}), now),
    'series day': (s) => seriesQuery(s, 'day', 'all', '', '', makeFilter({}), now),
    'sessions': (s) => sessionsQuery(s, 'cost', 100, 'all', '', '', makeFilter({}), now),
    'kpi session=..': (s) => kpiQuery(s, 'all', '', '', makeFilter({ session: 's-1' }), now),
    'kpi models=..': (s) => kpiQuery(s, 'all', '', '', makeFilter({ models: 'official:m1' }), now),
    'meta': (s) => metaInfo(s),
    'export csv': (s) => exportCsv(s, 'all', '', '', makeFilter({}), now),
  }
  for (const [n, f] of Object.entries(ops)) {
    assert.equal(JSON.stringify(f(b)), JSON.stringify(f(a)), `${n} 输出必须逐字节一致`)
  }
})

test('V33: v6 老库必须能被直接读入且通过体检(升级不丢配置)', () => {
  // 关键回归:若 decodeStore 缺失或对 v6 形态处理不当,loadStore 会把**好库**
  // 判为损坏并隔离 —— 那会连带丢掉单价/预算/保留期(它们只存在 store 里)。
  const v6 = v6Store()
  const dec = decodeStore(JSON.parse(JSON.stringify(v6)))
  assert.ok(!Array.isArray(dec.requests['s-1'][0]), 'v6 对象记录必须原样保留')
  assert.equal(dec.requests['s-1'][0].m, 'official:m1', 'v6 记录字段完整')
  assert.equal(dec.requests['s-1'][0].cost, 0.1, 'v6 的派生字段仍在(载入后由 rebuildAll 重算)')
  assert.equal(isStoreShapeValid(dec), true, 'v6 库展开后必须通过体检')
  // 空 requests 的 v6 库也要通过(全新安装 / 已修剪干净)
  const emptyV6 = { ...v6Store(), requests: {} }
  assert.equal(isStoreShapeValid(decodeStore(emptyV6)), true, '空 requests 的 v6 库也要通过')
})

test('V33b: 空 requests 的 v7 库,sessions.models 仍必须被展开', () => {
  // 这是个真实边界:早期实现把 sessions 的展开挂在"requests 里发现了数组行"
  // 这个条件上,于是空 requests 的库会漏展开 models,逐模型查询静默失效。
  const a = v6Store(); rebuildAll(a)
  const enc = encodeStore({ ...a, requests: {} })
  const dec = decodeStore(JSON.parse(JSON.stringify(enc)))
  assert.ok(!Array.isArray(dec.sessions['s-1'].models), 'requests 为空时 models 也必须展开为对象')
  assert.equal(dec.sessions['s-1'].models['official:m1'].requests, 1)
})

test('V34: 未展开的紧凑库必须**不**通过体检(防止被直接使用)', () => {
  const a = v6Store(); rebuildAll(a)
  const enc = encodeStore(a)
  // 未 decode:requests 是数组行,体检应拦住(否则查询路径会读到 undefined.miss)
  assert.equal(isStoreShapeValid(enc), false, '未展开的紧凑库不得通过体检')
  assert.equal(isStoreShapeValid(decodeStore(enc)), true, '展开后通过')
})

test('V35: 落盘必须省略可派生字段,且体积确实变小', () => {
  const a = v6Store(); rebuildAll(a)
  const enc = encodeStore(a)
  const txt = JSON.stringify(enc)
  // 派生字段不得出现在**逐请求记录**里(它们由 rebuildAll 重算)。
  // 只看 requests 段:sessions[].totals 里的 cost/saved 是聚合值,本来就该保留。
  const reqTxt = JSON.stringify(enc.requests)
  assert.ok(!reqTxt.includes('"cost"'), '逐请求记录不得含 cost')
  assert.ok(!reqTxt.includes('"saved"'), '逐请求记录不得含 saved')
  assert.ok(!reqTxt.includes('"priced"'), '逐请求记录不得含 priced')
  assert.ok(!reqTxt.includes('"cum"'), '逐请求记录不得含 cum')
  // 逐请求记录定长 9 列,无键名
  assert.ok(Array.isArray(enc.requests['s-1'][0]), '记录必须是定长数组')
  assert.equal(enc.requests['s-1'][0].length, 9, '定长 9 列')
  // 模型键内联为整数下标 + 一张表
  assert.equal(typeof enc.requests['s-1'][0][2], 'number', '模型列是整数下标')
  assert.ok(Array.isArray(enc.modelTable) && enc.modelTable.includes('official:m1'), '模型表含实际键')
  // 体积:同一份数据的 v6 文本 vs v7 文本
  const v6Text = JSON.stringify(a)
  assert.ok(txt.length < v6Text.length, `v7 文本(${txt.length})必须小于 v6(${v6Text.length})`)
})

test('V36: encodeStore 必须是纯函数(不得改动传入的 store)', () => {
  // writeStore 里先 flushAggregates(store) 再 encodeStore(store),若 encode 改动了
  // 入参,内存里的 store 会被就地换成数组行 —— 之后所有查询都会读到 undefined。
  const a = v6Store(); rebuildAll(a)
  const snapshot = JSON.stringify(a)
  encodeStore(a)
  assert.equal(JSON.stringify(a), snapshot, 'encodeStore 不得改动入参')
  // 且必须真的可用于查询
  const k = kpiQuery(a, 'all', '', '', makeFilter({}), 1.79e12 + 10000)
  assert.equal(k.totals.requests, 3, 'encode 之后原 store 仍可正常查询')
})

test('V37: STORE_VERSION 必须为 8(落盘格式契约)', () => {
  // v7→v8:分片的模型表由"全局一张"改为"每分片自带"(修静默模型错位),
  // 解析口径变了就必须升版,否则载入端无法判断该按哪种口径解析分片。
  assert.equal(STORE_VERSION, 8, '落盘格式改了就必须升版,否则载入端无法判断该按哪种格式解析')
  assert.equal(emptyStore().version, 8, '新建库用当前版本')
})

test('V38: 缺列/被截断的紧凑行按 0 补齐,不得让整个库崩', () => {
  const enc = {
    version: 7,
    modelTable: ['official:m1'],
    requests: { s1: [[1, 1.79e12, 0]] }, // 只有 3 列
    sessions: {}, watermarks: {}, quarantine: {}, config: {}, days: {}, months: {}, stats: {},
  }
  const dec = decodeStore(JSON.parse(JSON.stringify(enc)))
  const r = dec.requests.s1[0]
  assert.equal(r.seq, 1)
  assert.equal(r.m, 'official:m1')
  assert.equal(r.miss, 0, '缺列按 0')
  assert.equal(r.out, 0, '缺列按 0')
  assert.equal(r.i, 0)
  // 不应抛,且体检不因缺列而崩(数值合法即通过)
  assert.doesNotThrow(() => rebuildAll(dec))
})

test('V38b: seq 为 null 的紧凑行展开为 undefined(与 foldSession 的兜底一致)', () => {
  const enc = {
    version: 7, modelTable: ['official:m1'],
    requests: { s1: [[null, 1.79e12, 0, 1, 0, 0, 0, 0, 0]] },
    sessions: {}, watermarks: {}, quarantine: {}, config: {}, days: {}, months: {}, stats: {},
  }
  const dec = decodeStore(enc)
  assert.equal(dec.requests.s1[0].seq, undefined, 'null 应展开为 undefined')
})
