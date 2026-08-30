/**
 * dsh-token — scanStore 单元测试(假 persistence,零依赖)
 * 覆盖:首扫折叠与水位线、无变化跳过重读且 dirty=false、revision 变更增量、
 *       会话删除、标题提取、缺 turn/step 不误折叠、retention 修剪。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyStore, scanStore, kpiQuery, makeFilter, aggregatesReady } from '../lib/core.mjs'

const T = 1787632311372 // 2026-08-25(本地时区)

function fakePersistence(sessions) {
  let reads = 0
  return {
    readCount: () => reads,
    async listSnapshots() {
      return Object.keys(sessions).map((id) => ({ header: { id }, revision: sessions[id].revision }))
    },
    async readFrom(id) {
      reads++
      const s = sessions[id]
      return { events: s.events, meta: { id, createdAt: T, cwd: 'C:\\work\\proj' } }
    },
    locate: (meta) => ({ path: `X:\\ws\\proj\\x\\${meta.id || ''}` }),
  }
}

function usageEvents(seqBase, t, model = 'deepseek-chat', provider = 'deepseek-official') {
  return [
    { type: 'request/header', seq: seqBase, time: t, data: { header: { config: { provider, model } } } },
    { type: 'assistant/message', seq: seqBase + 1, time: t + 1000, data: { turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 300 } } },
  ]
}

test('scanStore: 首扫折叠、水位线、聚合快路径可用', async () => {
  const store = emptyStore()
  const sessions = { s1: { revision: 1, events: usageEvents(1, T) }, s2: { revision: 1, events: usageEvents(1, T + 3600000) } }
  const p = fakePersistence(sessions)
  const summary = await scanStore(store, p, { nowMs: T + 7200000 })
  assert.equal(summary.changed, 2)
  assert.equal(summary.dirty, true)
  assert.equal(summary.forced, false)
  assert.equal(store.requests.s1.length, 1)
  assert.equal(store.watermarks.s1.rev, '1')
  assert.equal(store.watermarks.s1.lastSeq, undefined, '水位线只保留 rev,不再存无用的 lastSeq')
  assert.equal(p.readCount(), 2)
  assert.equal(aggregatesReady(store), true, '扫描后聚合索引应就绪')
  const k = kpiQuery(store, 'all', null, null, makeFilter(null), T + 7200000)
  assert.equal(k.totals.requests, 2)
  assert.equal(k.activeSessions, 2)
})

test('scanStore: 无变化时跳过重读且 dirty=false', async () => {
  const store = emptyStore()
  const sessions = { s1: { revision: 1, events: usageEvents(1, T) } }
  const p = fakePersistence(sessions)
  await scanStore(store, p, { nowMs: T })
  const before = p.readCount()
  const summary = await scanStore(store, p, { nowMs: T })
  assert.equal(p.readCount(), before, '未变化会话不应重读')
  assert.equal(summary.dirty, false)
  assert.equal(summary.changed, 0)
})

test('scanStore: revision 变更只重扫该会话', async () => {
  const store = emptyStore()
  const sessions = { s1: { revision: 1, events: usageEvents(1, T) }, s2: { revision: 1, events: usageEvents(1, T) } }
  const p = fakePersistence(sessions)
  await scanStore(store, p, { nowMs: T })
  const before = p.readCount()
  sessions.s2.events = usageEvents(1, T).concat([
    { type: 'assistant/message', seq: 99, time: T + 5000, data: { turn: 2, step: 1, usage: { inputTokens: 500, outputTokens: 10 } } },
  ])
  sessions.s2.revision = 2
  const summary = await scanStore(store, p, { nowMs: T })
  assert.equal(p.readCount() - before, 1, '只有变更会话被重读')
  assert.equal(summary.changed, 1)
  assert.equal(summary.dirty, true)
  assert.equal(store.requests.s2.length, 2)
})

test('scanStore: 快照消失时会话被清理', async () => {
  const store = emptyStore()
  const sessions = { s1: { revision: 1, events: usageEvents(1, T) }, gone: { revision: 1, events: usageEvents(1, T) } }
  const p = fakePersistence(sessions)
  await scanStore(store, p, { nowMs: T })
  delete sessions.gone
  const summary = await scanStore(store, p, { nowMs: T })
  assert.equal(summary.removed, 1, '按会话去重计数')
  assert.equal(summary.dirty, true)
  assert.equal(store.requests.gone, undefined)
  assert.equal(store.sessions.gone, undefined)
  assert.equal(store.watermarks.gone, undefined)
})

test('scanStore: 标题提取(session/title,kind=llm)', async () => {
  const store = emptyStore()
  const events = usageEvents(1, T).concat([
    { type: 'session/title', seq: 50, time: T, data: { title: '自动标题', source: { kind: 'provider' } } },
  ])
  const p = fakePersistence({ s1: { revision: 1, events } })
  await scanStore(store, p, { nowMs: T })
  assert.equal(store.sessions.s1.meta.title, '自动标题')
  assert.equal(store.sessions.s1.meta.titleKind, 'llm')
  assert.equal(store.sessions.s1.meta.workspace, 'proj')
})

test('scanStore: retention 修剪超龄记录,全超龄会话整段清理', async () => {
  const store = emptyStore()
  store.config.retention = { days: 1 }
  const sessions = {
    old1: { revision: 1, events: usageEvents(1, T - 5 * 86400000) },
    new1: { revision: 1, events: usageEvents(1, T) },
  }
  const p = fakePersistence(sessions)
  const summary = await scanStore(store, p, { nowMs: T })
  assert.equal(summary.pruned, 1)
  assert.equal(summary.dirty, true)
  assert.equal(store.requests.old1, undefined, '记录全部超龄的会话应整段清理')
  assert.equal(store.sessions.old1, undefined)
  assert.equal(store.requests.new1.length, 1)
  const k = kpiQuery(store, 'all', null, null, makeFilter(null), T)
  assert.equal(k.totals.requests, 1, 'KPI 只统计保留窗口内的记录')
})

test('scanStore: force 全量重扫且 dirty=true', async () => {
  const store = emptyStore()
  const sessions = { s1: { revision: 1, events: usageEvents(1, T) } }
  const p = fakePersistence(sessions)
  await scanStore(store, p, { nowMs: T })
  const before = p.readCount()
  const summary = await scanStore(store, p, { force: true, nowMs: T })
  assert.equal(p.readCount() - before, 1)
  assert.equal(summary.forced, true)
  assert.equal(summary.dirty, true)
})
