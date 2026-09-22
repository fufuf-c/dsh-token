/**
 * dsh-token — **宿主 revision 粒度回归**(node:test,零依赖)
 *
 * 这一版修的是宿主侧一次回归带来的"时好时坏":
 *
 *   @deepseek-ai/dsh-session-persistence-jsonl 在 0.1.7-alpha.1 把 `list()` 的
 *   revision 从 `<文件身份>` 改成 `<文件身份>:<全语料哈希>` —— **仅当**
 *   sourceVersion < 当前格式(即 v3 遗留会话)。后半段是整库所有文件路径 + stat
 *   身份的 sha256。
 *
 * 本插件原先直接比 `wm.rev !== String(s.revision)`,于是:
 *   · 新建会话 / 当前会话追加一行 / 某个文件的 mtime 变了
 *   → 全部遗留会话的 revision 同时变化 → 水位线集体失效 → **每轮整库重读**。
 *   作者实测 70 会话(65 个 v3)只改 1 个文件的 mtime:88ms → 8512ms。
 *   而页面「进入界面时先扫描」默认开启,于是打开面板要白屏到扫完 —— 表现为
 *   "有时候不显示,过一会又能显示"。
 *
 * 修法:水位线只认**文件身份**,遗留会话的兄弟依赖改用"该父会话的子会话子树"
 * 精确表达(见 lib/session-source.mjs 的 ownRevisionToken / relatedFingerprints)。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyStore, rebuildAll } from '../lib/core.mjs'
import { scanStore, ownRevisionToken, relatedFingerprints } from '../lib/session-source.mjs'

const T = 1787632311372

/** 0.1.7-alpha.1 的遗留会话 revision:文件身份 + 整库语料哈希。 */
const legacyRev = (fileId, corpus) => `100:200:${fileId}:400:500:${corpus}`
/** 当前格式(v4)会话:只有文件身份五段。 */
const currentRev = (fileId) => `100:200:${fileId}:400:500`

/**
 * 假 persistence:支持"显式排布 revision"的会话表。
 *
 * `sessions[id] = { revision, events, corpus }` —— corpus 字段存在时,该会话按
 * 遗留形态上报 `文件身份:corpus`(模拟宿主对 v3 文件的行为)。
 */
function fakePersistence(sessions) {
  let reads = 0
  const revOf = (id) => {
    const s = sessions[id]
    return s.corpus === undefined ? currentRev(s.fileId) : legacyRev(s.fileId, s.corpus)
  }
  return {
    readCount: () => reads,
    readIds: () => readLog.slice(),
    async listSnapshots() {
      return Object.keys(sessions).map((id) => ({
        header: {
          id,
          origin: sessions[id].origin,
          parentSession: sessions[id].parentSession,
        },
        revision: revOf(id),
      }))
    },
    async readFrom(id) {
      reads++
      readLog.push(id)
      return { events: sessions[id].events, meta: { id, createdAt: T, cwd: 'D:\\ws\\proj' } }
    },
    locate: (meta) => ({ path: `X:\\ws\\proj\\x\\${meta.id || ''}` }),
  }
}
let readLog = []

function events(seqBase, t) {
  return [
    { type: 'request/header', seq: seqBase, time: t, data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-flash' } } } },
    { type: 'assistant/message', seq: seqBase + 1, time: t + 1000, data: { turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 300 } } },
  ]
}

// ---------------------------------------------------------------------------
// V73 — 0.1.7 的"整库语料哈希"不得让任一会话变动触发全库重读
// ---------------------------------------------------------------------------
test('V73: 遗留会话的整库语料哈希不得让任一会话变动触发全库重读', async () => {
  const store = emptyStore()
  const sessions = {}
  // 20 个遗留(v3)会话,共享同一个语料哈希 —— 这正是 0.1.7 的形态
  for (let i = 0; i < 20; i++) {
    sessions[`s${i}`] = {
      fileId: 1000 + i, corpus: 'CORPUS-A', events: events(1, T + i * 60000),
    }
  }
  const p = fakePersistence(sessions)

  const first = await scanStore(store, p, { nowMs: T })
  assert.equal(first.changed, 20, '冷启动全部要读')
  assert.equal(p.readCount(), 20)
  // 水位线只存文件身份,不得把整库哈希带进去
  assert.equal(store.watermarks.s0.rev, currentRev(1000), '水位线必须只含本会话文件身份')
  assert.doesNotMatch(store.watermarks.s0.rev, /CORPUS/, '水位线不得残留整库语料哈希')

  // 稳态:语料哈希一字未变 → 不重读
  readLog = []
  const idle = await scanStore(store, p, { nowMs: T })
  assert.equal(idle.changed, 0, '语料未变时不应有任何重读')
  assert.deepEqual(readLog, [], '稳态必须零重读')

  // 关键场景:只动了 s7 的文件身份,但**所有人都**换了语料哈希
  // (真实世界里就是"新建了一个会话"或"任何文件被追加/触碰")
  sessions.s7.fileId = 9999
  for (const id of Object.keys(sessions)) sessions[id].corpus = 'CORPUS-B'

  readLog = []
  const second = await scanStore(store, p, { nowMs: T })
  assert.deepEqual(readLog, ['s7'], '只有文件身份真的变了的那个会话该被重读')
  assert.equal(second.changed, 1, 'changed 必须是 1,而不是全库')
  assert.notEqual(second.changed, 20, '整库语料哈希不得触发全库重读')
})

// ---------------------------------------------------------------------------
// V73b — 语料哈希变化本身(其他格式文件被碰)不得重读任何遗留会话
// ---------------------------------------------------------------------------
test('V73b: 语料哈希变化本身(其他格式文件被碰)不得重读任何遗留会话', async () => {
  const store = emptyStore()
  const sessions = {}
  for (let i = 0; i < 10; i++) sessions[`s${i}`] = { fileId: 2000 + i, corpus: 'X', events: events(1, T + i * 1000) }
  // 一个"当前格式"(v4)会话:它的 revision 不含语料哈希
  sessions.modern = { fileId: 3000, events: events(1, T + 99999) }

  const p = fakePersistence(sessions)
  await scanStore(store, p, { nowMs: T })
  assert.equal(p.readCount(), 11)

  // 只碰那个 v4 会话 → 所有遗留会话的语料哈希变了,但谁的文件身份都没变
  sessions.modern.fileId = 3001
  for (const id of Object.keys(sessions)) if (sessions[id].corpus !== undefined) sessions[id].corpus = 'Y'

  readLog = []
  const summary = await scanStore(store, p, { nowMs: T })
  assert.deepEqual(readLog, ['modern'], '只该重读那个真的变了的 v4 会话')
  assert.equal(summary.changed, 1)
})

// ---------------------------------------------------------------------------
// V73c — 升级路径:老库里残留的六段 rev 不得触发一次整库重读
// ---------------------------------------------------------------------------
test('V73c: 老库残留的六段 rev(含整库哈希)不得触发一次整库重读', async () => {
  const store = emptyStore()
  const sessions = {}
  for (let i = 0; i < 8; i++) sessions[`s${i}`] = { fileId: 4000 + i, corpus: 'Z', events: events(1, T + i * 1000) }
  const p = fakePersistence(sessions)
  await scanStore(store, p, { nowMs: T })

  // 手工把水位线写成 0.9.5 之前的六段形态(带整库哈希)—— 模拟直接升级上来的老库
  for (const id of Object.keys(sessions)) {
    store.watermarks[id] = { rev: legacyRev(sessions[id].fileId, 'Z-OLD-CORPUS') }
  }

  readLog = []
  const summary = await scanStore(store, p, { nowMs: T })
  assert.deepEqual(readLog, [], '文件身份没变的老库水位线必须继续有效,不得整库重读')
  assert.equal(summary.changed, 0, '升级后第一轮就该是零重读(而不是把 8 个会话全读一遍)')
})

// ---------------------------------------------------------------------------
// V73d — 遗留会话的兄弟依赖必须按"该父会话的子会话子树"精确追踪
// ---------------------------------------------------------------------------
test('V73d: 遗留会话的兄弟依赖按父会话子树精确追踪(不扩大也不缩小)', async () => {
  const store = emptyStore()
  const sessions = {
    // 两个遗留父会话,各带一个子代理子会话
    p1: { fileId: 5001, corpus: 'C1', events: events(1, T) },
    c1: { fileId: 5002, corpus: 'C1', origin: 'subagent', parentSession: 'p1', events: events(1, T + 1000) },
    p2: { fileId: 5003, corpus: 'C1', events: events(1, T + 2000) },
    c2: { fileId: 5004, corpus: 'C1', origin: 'subagent', parentSession: 'p2', events: events(1, T + 3000) },
  }
  const p = fakePersistence(sessions)
  await scanStore(store, p, { nowMs: T })
  assert.equal(p.readCount(), 4)

  // 宿主解码遗留父会话会读它的子会话 → 父会话的指纹必须覆盖子会话
  assert.match(store.watermarks.p1.rel, /c1/, 'p1 的依赖指纹必须含它的子会话 c1')
  assert.doesNotMatch(store.watermarks.p1.rel, /c2/, 'p1 的依赖指纹不得含别人的子会话 c2')

  // 只改 c1(子会话)→ p1 必须跟着重读,c2/p2 不受影响
  sessions.c1.fileId = 5999
  readLog = []
  const s2 = await scanStore(store, p, { nowMs: T })
  assert.ok(readLog.includes('c1'), 'c1 自己变了,必须重读')
  assert.ok(readLog.includes('p1'), 'p1 的子会话 c1 变了,父会话必须重读(解码依赖它)')
  assert.ok(!readLog.includes('p2'), 'p1 子树的变化不得波及 p2')
  assert.ok(!readLog.includes('c2'), 'p1 子树的变化不得波及 c2')
  assert.equal(s2.changed, 2, '只有 c1 与它的父 p1')

  // 新增一个 c1 的兄弟子会话 → p1 必须重读
  sessions.c3 = { fileId: 5005, corpus: 'C1', origin: 'subagent', parentSession: 'p1', events: events(1, T + 5000) }
  readLog = []
  const s3 = await scanStore(store, p, { nowMs: T })
  assert.ok(readLog.includes('c3'), '新增的子会话自己要读')
  assert.ok(readLog.includes('p1'), '父会话的子会话集合变了,父会话必须重读')
  assert.ok(!readLog.includes('p2'), '不得波及其它父会话')
  assert.equal(s3.changed, 2)
})

// ---------------------------------------------------------------------------
// V73e — 纯净函数:令牌归一化与依赖指纹的形状
// ---------------------------------------------------------------------------
test('V73e: ownRevisionToken 只保留文件身份,relatedFingerprints 只认子代理子会话', () => {
  assert.equal(ownRevisionToken('1:2:3:4:5:HASH'), '1:2:3:4:5', '六段必须砍掉语料哈希')
  assert.equal(ownRevisionToken('1:2:3:4:5'), '1:2:3:4:5', '五段原样返回(≤0.1.6 的宿主)')
  assert.equal(ownRevisionToken('memory:jsonl:7'), 'memory:jsonl:7', '内存会话段数不足,原样返回')
  assert.equal(ownRevisionToken(null), '', 'null 不得抛')
  assert.equal(ownRevisionToken(undefined), '', 'undefined 不得抛')

  const fp = relatedFingerprints([
    // 遗留父会话(六段,带语料哈希)→ 它的子代理子会话算依赖
    { header: { id: 'p1' }, revision: 'a:b:1:c:d:H' },
    { header: { id: 'c1', origin: 'subagent', parentSession: 'p1' }, revision: 'a:b:2:c:d:H' },
    // origin 不是 subagent 的普通会话即使带 parentSession 也不算解码依赖
    { header: { id: 'c2', parentSession: 'p1' }, revision: 'a:b:3:c:d:H' },
    // 当前格式父会话(五段,无语料哈希)→ 子会话不参与它的解码,不得挂依赖
    { header: { id: 'p2' }, revision: 'a:b:4:c:d' },
    { header: { id: 'c3', origin: 'subagent', parentSession: 'p2' }, revision: 'a:b:5:c:d' },
  ])
  assert.equal(fp.get('p1'), 'c1:a:b:2:c:d', '遗留父会话:只收 origin=subagent 的子会话,且只留文件身份')
  assert.equal(fp.get('p2'), undefined, '当前格式父会话不得挂子会话依赖(否则子代理一动就白重读)')
  assert.equal(fp.get('c2'), undefined, '普通会话不产生依赖')
  assert.equal(fp.get('nope'), undefined, '无子会话的会话不在表里')
})
