/**
 * dsh-token — scanStore 单元测试(假 persistence,零依赖)
 * 覆盖:首扫折叠与水位线、无变化跳过重读且 dirty=false、revision 变更增量、
 *       会话删除、标题提取、缺 turn/step 不误折叠、retention 修剪。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyStore, kpiQuery, makeFilter, aggregatesReady, metaInfo, STORE_VERSION, configuredModelsFrom, isConfiguredModel } from '../lib/core.mjs'
import { scanStore } from '../lib/session-source.mjs'

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

// ---------------------------------------------------------------------------
// DSH 0.1.5-rc.2 句柄式 persistence API(list/open/handle.read/handle.close)
// ---------------------------------------------------------------------------

/** 新版后端:list() + open(id,'read') → 句柄;不提供 listSnapshots/readFrom。 */
function fakeHandlePersistence(sessions) {
  let reads = 0
  let closes = 0
  return {
    readCount: () => reads,
    closeCount: () => closes,
    async list() {
      return Object.keys(sessions).map((id) => ({ header: { id, cwd: 'C:\\work\\proj' }, revision: sessions[id].revision }))
    },
    async open(id, access) {
      assert.equal(access, 'read', '扫描必须用只读句柄,绝不夺取写所有权')
      const s = sessions[id]
      return {
        id,
        header: { id, createdAt: T, cwd: 'C:\\work\\proj' },
        read: async () => { reads++; return { eventState: 'detached', events: s.events } },
        close: async () => { closes++ },
      }
    },
    locate: (meta) => ({ path: `X:\\ws\\proj\\x\\${meta.id || ''}` }),
  }
}

test('scanStore: 兼容 0.1.5-rc.2 句柄式 API,并关闭每个句柄', async () => {
  const store = emptyStore()
  const sessions = { s1: { revision: 1, events: usageEvents(1, T) }, s2: { revision: 1, events: usageEvents(1, T + 3600000) } }
  const p = fakeHandlePersistence(sessions)
  const summary = await scanStore(store, p, { nowMs: T + 7200000 })
  assert.equal(summary.scanned, 2)
  assert.equal(summary.failed, 0)
  assert.equal(p.readCount(), 2)
  assert.equal(p.closeCount(), 2, '读句柄必须全部 close,否则泄漏每会话租约')
  assert.equal(store.requests.s1.length, 1)
  assert.equal(store.watermarks.s1.rev, '1')
  assert.equal(aggregatesReady(store), true)
  // 增量:无变化时既不重读也不重开
  const s = await scanStore(store, p, { nowMs: T + 7200000 })
  assert.equal(p.readCount(), 2)
  assert.equal(p.closeCount(), 2)
  assert.equal(s.dirty, false)
})

test('scanStore: 读句柄抛错后仍被关闭', async () => {
  const store = emptyStore()
  let closed = 0
  const p = {
    async list() { return [{ header: { id: 'bad' }, revision: 1 }] },
    async open() {
      return { header: { id: 'bad' }, read: async () => { throw new Error('boom') }, close: async () => { closed++ } }
    },
  }
  const summary = await scanStore(store, p, { nowMs: T })
  assert.equal(summary.failed, 1)
  assert.equal(closed, 1, 'read() 抛错也必须走 finally 关闭句柄')
  assert.equal(summary.error, undefined)
})

// ---------------------------------------------------------------------------
// 确定性失败隔离(quarantine)
// ---------------------------------------------------------------------------

function permanentError() {
  const e = new Error('SessionFormatUnsupportedError: refuses this format v0 Session')
  e.name = 'SessionFormatUnsupportedError'
  return e
}

function fakeFailingPersistence(sessions, makeError) {
  let reads = 0
  return {
    readCount: () => reads,
    async list() {
      return Object.keys(sessions).map((id) => ({ header: { id }, revision: sessions[id].revision }))
    },
    async open(id) {
      reads++
      const s = sessions[id]
      if (s.error) throw makeError()
      return { header: { id, cwd: 'C:\\work\\proj' }, read: async () => ({ events: s.events }), close: async () => {} }
    },
  }
}

test('scanStore: 确定性失败会话被隔离,后续扫描不再重读', async () => {
  const store = emptyStore()
  const sessions = { bad: { revision: 1, error: true }, good: { revision: 1, events: usageEvents(1, T) } }
  const p = fakeFailingPersistence(sessions, permanentError)
  const first = await scanStore(store, p, { nowMs: T })
  assert.equal(first.failed, 1)
  assert.equal(first.quarantined, 1)
  assert.equal(store.quarantine.bad.name, 'SessionFormatUnsupportedError')
  assert.equal(store.quarantine.bad.hits, 1)
  assert.equal(p.readCount(), 2)

  // 第二轮:同一 revision 的坏会话被跳过,不重读也不重扫整库
  const second = await scanStore(store, p, { nowMs: T + 60000 })
  assert.equal(p.readCount(), 2, '隔离期内不应再读坏会话')
  assert.equal(second.skipped, 1)
  assert.equal(second.changed, 1)
  assert.equal(second.dirty, false, '只有被跳过的候选时不得重建/落盘')
})

test('scanStore: 隔离有出口 —— revision 变化或超冷却期都会重试', async () => {
  const store = emptyStore()
  const sessions = { bad: { revision: 1, error: true } }
  const p = fakeFailingPersistence(sessions, permanentError)
  await scanStore(store, p, { nowMs: T })
  assert.equal(p.readCount(), 1)

  // revision 变化(日志被追加/重写)→ 立即重试
  sessions.bad.revision = 2
  await scanStore(store, p, { nowMs: T + 60000 })
  assert.equal(p.readCount(), 2, 'revision 变化必须重试')

  // 冷却期过后 → 自动重试一次
  await scanStore(store, p, { nowMs: T + 60000 + 25 * 3600000 })
  assert.equal(p.readCount(), 3, '超过隔离冷却期必须重试')

  // force 全量 → 忽略隔离(用户显式重试出口)
  await scanStore(store, p, { force: true, nowMs: T + 60000 })
  assert.equal(p.readCount(), 4, 'force 必须无视隔离')
})

test('scanStore: 瞬时错误不进隔离,始终留在重试路径上', async () => {
  const store = emptyStore()
  const sessions = { flaky: { revision: 1, error: true } }
  const p = fakeFailingPersistence(sessions, () => new Error('EBUSY: resource busy or locked'))
  await scanStore(store, p, { nowMs: T })
  const s = await scanStore(store, p, { nowMs: T + 60000 })
  assert.equal(s.failed, 1)
  assert.equal(s.skipped, 0)
  assert.equal(p.readCount(), 2, '瞬时错误必须每轮重试')
  assert.equal(Object.keys(store.quarantine).length, 0)
})

test('scanStore: 会话消失时隔离记录一并清理', async () => {
  const store = emptyStore()
  const sessions = { bad: { revision: 1, error: true } }
  const p = fakeFailingPersistence(sessions, permanentError)
  await scanStore(store, p, { nowMs: T })
  assert.equal(Object.keys(store.quarantine).length, 1)
  delete sessions.bad
  const s = await scanStore(store, p, { nowMs: T + 60000 })
  assert.equal(s.removed, 1)
  assert.equal(Object.keys(store.quarantine).length, 0)
})

test('scanStore: 失败后恢复成功的会话会解除隔离', async () => {
  const store = emptyStore()
  const sessions = { bad: { revision: 1, error: true } }
  const p = fakeFailingPersistence(sessions, permanentError)
  await scanStore(store, p, { nowMs: T })
  assert.equal(Object.keys(store.quarantine).length, 1)
  sessions.bad.error = false
  sessions.bad.events = usageEvents(1, T)
  sessions.bad.revision = 2
  await scanStore(store, p, { nowMs: T + 60000 })
  assert.equal(Object.keys(store.quarantine).length, 0, '成功扫描必须解除隔离')
  assert.equal(store.watermarks.bad.rev, '2')
})

test('metaInfo: 暴露隔离清单与 store 版本', async () => {
  const store = emptyStore()
  const sessions = { bad: { revision: 1, error: true } }
  const p = fakeFailingPersistence(sessions, permanentError)
  await scanStore(store, p, { nowMs: T })
  const info = metaInfo(store)
  assert.equal(info.storeVersion, STORE_VERSION)
  assert.equal(info.quarantinedCount, 1)
  assert.equal(info.quarantined[0].id, 'bad')
  assert.ok(info.quarantined[0].message.includes('refuses this format'))
})

// ---------------------------------------------------------------------------
// 当前配置的模型(configuredModels):配置面用它决定「谁占单价表位」
// ---------------------------------------------------------------------------

test('configuredModelsFrom: 解析 pi-ai providers 形态(路由名即 provider)', () => {
  const got = configuredModelsFrom([
    { ns: 'llm-pi-ai', value: { providers: {
      gmi: { displayName: 'GMI', models: [{ id: 'MiniMaxAI/MiniMax-M3' }] },
      s: { models: [{ id: 'kimi-k3' }, { id: 'glm-5.2' }, { id: '' }, { noId: 1 }] },
      empty: { models: [] },
      broken: {},
    } } },
  ])
  assert.deepEqual(got.exact, ['gmi:MiniMaxAI/MiniMax-M3', 's:glm-5.2', 's:kimi-k3'])
  assert.deepEqual(got.byId, [], 'pi-ai 形态无需 byId 兜底')
})

test('configuredModelsFrom: 解析适配器命名空间并套用 provider 映射', () => {
  const got = configuredModelsFrom([
    { ns: 'llm-deepseek', value: { models: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] } },
  ])
  // llm-deepseek 的 provider 名是包内常量,靠映射表补上
  assert.deepEqual(got.exact, ['deepseek-official:deepseek-flash', 'deepseek-official:deepseek-v4-pro'])
  assert.deepEqual(got.byId, [])
})

test('configuredModelsFrom: 未知命名空间降级为 byId,不猜 provider', () => {
  const got = configuredModelsFrom([
    { ns: 'llm-someone-else', value: { models: [{ id: 'mystery-model' }] } },
  ])
  assert.deepEqual(got.exact, [], '不得凭空编造 provider 名')
  assert.deepEqual(got.byId, ['mystery-model'])
})

test('configuredModelsFrom: 两种形态并存时合并', () => {
  const got = configuredModelsFrom([
    { ns: 'llm-pi-ai', value: { providers: { s: { models: [{ id: 'kimi-k3' }] } } } },
    { ns: 'llm-deepseek', value: { models: [{ id: 'deepseek-flash' }] } },
  ])
  assert.deepEqual(got.exact, ['deepseek-official:deepseek-flash', 's:kimi-k3'])
})

test('configuredModelsFrom: 读不到任何模型目录时返回 null(调用侧据此关闭过滤)', () => {
  assert.equal(configuredModelsFrom(null), null)
  assert.equal(configuredModelsFrom(undefined), null)
  assert.equal(configuredModelsFrom([]), null, '空描述符 = 读不到')
  assert.equal(configuredModelsFrom([{ ns: 'ui-theme', value: { preference: 'dark' } }]), null)
  assert.equal(configuredModelsFrom([{ ns: 'agent-default-model', value: { provider: 'x', model: 'y' } }]), null,
    '默认模型选择是「选了哪个」,不是模型目录,不得当成配置清单')
  assert.equal(configuredModelsFrom([{ ns: 'llm-pi-ai', value: { providers: {} } }]), null,
    'providers 为空 = 没有识别到任何模型 → 关闭过滤,而不是把界面清空')
})

test('configuredModelsFrom: 不把非 id 字段带进结果(凭据类字段绝不外泄)', () => {
  const got = configuredModelsFrom([
    { ns: 'llm-pi-ai', value: { apiKey: 'sk-SECRET', providers: {
      s: { apiKey: 'sk-SECRET2', models: [{ id: 'kimi-k3', name: 'Kimi', apiKeyEnv: 'S_API_KEY' }] },
    } } },
    { ns: 'llm-deepseek', value: { apiKeyEnv: 'DEEPSEEK_API_KEY', models: [{ id: 'deepseek-flash', name: 'flash' }] } },
  ])
  const flat = JSON.stringify(got)
  assert.ok(!flat.includes('SECRET'), '返回载荷里不得出现任何凭据')
  assert.ok(!flat.includes('API_KEY'), '连 env 变量名也不带出')
  assert.deepEqual(got.exact, ['deepseek-official:deepseek-flash', 's:kimi-k3'])
})

test('isConfiguredModel: exact 优先,byId 兜底', () => {
  const cfg = configuredModelsFrom([
    { ns: 'llm-pi-ai', value: { providers: { s: { models: [{ id: 'kimi-k3' }] } } } },
    { ns: 'llm-unknown', value: { models: [{ id: 'mystery' }] } },
  ])
  assert.equal(isConfiguredModel(cfg, 's:kimi-k3'), true)
  assert.equal(isConfiguredModel(cfg, 's:glm-5.2'), false)
  assert.equal(isConfiguredModel(cfg, 'mystery'), true, 'byId 兜底:provider 未知也能命中')
  assert.equal(isConfiguredModel(cfg, 'other:mystery'), true, 'byId 兜底忽略 provider 前缀')
  assert.equal(isConfiguredModel(cfg, 'other:kimi-k3'), false, 'exact 形态不做跨 provider 的 id 匹配')
  assert.equal(isConfiguredModel(null, 's:kimi-k3'), false, 'null 一律不命中')
})

// ---------------------------------------------------------------------------
// 「后端报告 0 会话」不得清库
//
// 这是**真实发生过**的破坏,不是防御性编程的臆想:本插件的宿主测试用
// `list() { return [] }` 的桩装载 lib/index.js(而 DSH_HOME 恰好是真实目录),
// scanStore 于是判定"53 个会话全被删了"并逐个 delete,再被 Host 落盘 ——
// 一份 53 会话 / 6801 请求的真实库被清成 882 字节的空索引。会话日志没丢
// (库可从日志重建),但那是一次不该发生的静默数据损失。
//
// list() 返回空的两种原因必须分开:
//   (a) 用户真的删光了会话 —— 极罕见;
//   (b) 后端这一轮没准备好(目录挂载慢 / root 指错 / 服务刚重启未扫盘)。
// 原实现对两者一视同仁,把 (b) 当成 (a) 处理。
// ---------------------------------------------------------------------------
test('scanStore: 后端报告 0 会话时必须延后清理(库中已有会话)', async () => {
  const store = emptyStore()
  // 先正常折一遍,让库里有两个会话
  const sessions = { s1: { revision: 1, events: usageEvents(1, T) }, s2: { revision: 1, events: usageEvents(1, T + 1000) } }
  await scanStore(store, fakePersistence(sessions), { nowMs: T + 7200000 })
  assert.equal(Object.keys(store.requests).length, 2, '前置:库里应有两个会话')

  // 换一个"还没准备好"的后端:list() 返回空
  const empty = { async list() { return [] }, async open() { throw new Error('不该被调用') } }
  const summary = await scanStore(store, empty, { nowMs: T + 7300000 })

  assert.equal(summary.removed, 0, '第一轮空列表不得删除任何会话')
  assert.equal(Object.keys(store.requests).length, 2, '会话记录必须完好')
  assert.equal(Object.keys(store.watermarks).length, 2, '水位线必须完好')
  assert.equal(Object.keys(store.sessions).length, 2, '会话元数据必须完好')
  assert.equal(summary.dirty, false, '什么都没做 → 不该触发落盘')
  assert.ok(summary.note && /延后|0 个会话/.test(summary.note), `必须如实回报原因,实际 ${JSON.stringify(summary.note)}`)
})

test('scanStore: 连续两轮空列表才真清(用户确实删光了会话时不能永远不清)', async () => {
  // 守卫不能变成"会话永远删不掉"。连续两轮确认是"后端瞬时故障"与
  // "用户真删光了"的分界:前者下一轮就恢复,后者两轮都空。
  const store = emptyStore()
  const sessions = { s1: { revision: 1, events: usageEvents(1, T) }, s2: { revision: 1, events: usageEvents(1, T + 1000) } }
  await scanStore(store, fakePersistence(sessions), { nowMs: T + 7200000 })
  assert.equal(Object.keys(store.requests).length, 2)

  const empty = { async list() { return [] }, async open() { throw new Error('不该被调用') } }
  const first = await scanStore(store, empty, { nowMs: T + 7300000 })
  assert.equal(first.removed, 0, '第一轮:延后')
  const second = await scanStore(store, empty, { nowMs: T + 7400000 })
  assert.equal(second.removed, 2, '第二轮:确认后必须真删(否则已删会话的分片永远残留)')
  assert.equal(Object.keys(store.requests).length, 0)
  assert.equal(Object.keys(store.watermarks).length, 0)
})

test('scanStore: 中间恢复过一轮就重新计数(不得靠陈旧计数误清)', async () => {
  // 后端抖动:空 → 正常 → 空。第二次空又是"第一次",必须继续延后。
  // 若计数不重置,这里会误判成"连续两轮空"而清库。
  const store = emptyStore()
  const sessions = { s1: { revision: 1, events: usageEvents(1, T) }, s2: { revision: 1, events: usageEvents(1, T + 1000) } }
  const normal = fakePersistence(sessions)
  await scanStore(store, normal, { nowMs: T + 7200000 })

  const empty = { async list() { return [] }, async open() { throw new Error('不该被调用') } }
  await scanStore(store, empty, { nowMs: T + 7300000 })       // 空(第 1 次)
  await scanStore(store, normal, { nowMs: T + 7350000 })      // 恢复:计数必须清零
  const again = await scanStore(store, empty, { nowMs: T + 7400000 })  // 空(又是第 1 次)
  assert.equal(again.removed, 0, '中间恢复过就必须重新计数,不能清库')
  assert.equal(Object.keys(store.requests).length, 2)
})

test('scanStore: force 全量扫描同样不得在首轮空列表上清库', async () => {
  // force 是"忽略水位线重折一遍"的出口,不是"忽略哪些会话存在"的出口 ——
  // 它不该改变删除判定。
  const store = emptyStore()
  const sessions = { s1: { revision: 1, events: usageEvents(1, T) } }
  await scanStore(store, fakePersistence(sessions), { nowMs: T + 7200000, force: true })
  assert.equal(Object.keys(store.requests).length, 1)

  const empty = { async list() { return [] }, async open() { throw new Error('不该被调用') } }
  const summary = await scanStore(store, empty, { nowMs: T + 7300000, force: true })
  assert.equal(Object.keys(store.requests).length, 1, 'force 也不得在首轮清空')
  assert.equal(summary.removed, 0)
})

test('scanStore: 空库碰到空列表是正常的,不该报警', async () => {
  // 首次安装 / 全新用户:库里本来什么都没有,list() 空是**正确**状态。
  // 这条防止守卫过度触发(把正常路径也拦下来,用户就永远扫不到数据)。
  const store = emptyStore()
  const empty = { async list() { return [] }, async open() { throw new Error('不该被调用') } }
  const summary = await scanStore(store, empty, { nowMs: T })
  assert.equal(summary.ok, true)
  assert.equal(summary.removed, 0)
  assert.equal(summary.note, undefined, '空库不该带"已延后清理"的警告')
  assert.ok(summary.totalSessions === 0)
})

test('scanStore: 会话**真的**被删掉时必须照常清理(守卫不得挡住正常删除)', async () => {
  // 上面几条守的是"空列表"这个特例。这里锁住正常删除路径没被误伤:
  // 后端列出的会话少了几个(但不是零),消失的那些必须立刻被清掉、不必等两轮。
  const store = emptyStore()
  const both = { s1: { revision: 1, events: usageEvents(1, T) }, s2: { revision: 1, events: usageEvents(1, T + 1000) } }
  await scanStore(store, fakePersistence(both), { nowMs: T + 7200000 })
  assert.equal(Object.keys(store.requests).length, 2)

  const onlyOne = { s1: { revision: 1, events: usageEvents(1, T) } }
  const summary = await scanStore(store, fakePersistence(onlyOne), { nowMs: T + 7300000 })
  assert.equal(summary.removed, 1, '消失的 s2 必须被清理')
  assert.deepEqual(Object.keys(store.requests), ['s1'])
  assert.equal(store.watermarks.s2, undefined)
  assert.equal(store.sessions.s2, undefined)
})

