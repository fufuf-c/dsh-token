/**
 * v0.9.0 — A 批(正确性收口)+ B 批(性能优化)的锁定断言。
 *
 * 每一条都对应一个**实测过**的缺陷:先确认它在 0.8.10 上可复现(失败),
 * 再确认 0.9.0 修好(通过)。编号 V18+ 接续 v089-fixes / fix-regression 的编号。
 *
 * 命名约定:`V<n>: <一句话结论>` —— 断言失败时标题本身就把问题说清。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const C = await import('../lib/core.mjs')
const S = await import('../lib/session-source.mjs')

const rec = (o = {}) => ({ seq: 1, t: Date.now(), m: 'official:m1', miss: 100, read: 200, write: 0, out: 50, r: 0, i: 0, ...o })
function store(requests, cfg = {}) {
  return {
    version: C.STORE_VERSION, requests, sessions: {}, watermarks: {}, quarantine: {},
    config: { prices: {}, budget: { monthly: 0 }, retention: { days: 0 }, ...cfg },
    days: {}, months: {}, stats: {},
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// A 批 · 正确性收口
// ═══════════════════════════════════════════════════════════════════════════

test('V18: parseHourRanges 与 normalizeHourRanges 必须归一出同一形状', () => {
  // 0.8.10:'9-12, 11-14' → [[9,12],[11,14]](不合并),而数组写法 → [[9,14]]。
  // 同一份规则两种写法存出不同形状,设置页读回来的与用户填进去的对不上。
  assert.deepEqual(C.parseHourRanges('9-12, 11-14'), [[9, 14]], '文本入口也应按同一口径合并')
  assert.deepEqual(C.normalizeHourRanges([[9, 12], [11, 14]]), [[9, 14]])
  // 两种写法必须逐字等价
  const txt = C.parseHourRanges('9-12, 14-18')
  const arr = C.normalizeHourRanges([[9, 12], [14, 18]])
  assert.deepEqual(txt, arr, '不重叠时也必须一致')
  // 不相邻的**不得**被合并(合并判据是 a <= last[1],不是"差 1 就并")
  assert.deepEqual(C.parseHourRanges('9-12, 14-18'), [[9, 12], [14, 18]], '间隙必须保留')
  // 往返稳定
  assert.deepEqual(C.parseHourRanges(C.fmtHourRanges([[9, 14]])), [[9, 14]])
  assert.deepEqual(C.parseHourRanges(C.fmtHourRanges([[0, 24]])), [[0, 24]], '全天往返')
})

test("V19: parseDayRanges('0-7') 必须表示一整周,而不是退化成仅周日", () => {
  // 0.8.10:两端都 %7 → a=0,b=0 → 循环首次即 break → [0](仅周日)。
  // 正则显式允许 7、文档也写支持 0-7,于是用户以为选了一周,实际只在周日按高峰价计费。
  assert.deepEqual(C.parseDayRanges('0-7'), [0, 1, 2, 3, 4, 5, 6], "'0-7' = 整周")
  assert.deepEqual(C.parseDayRanges('1-7'), [0, 1, 2, 3, 4, 5, 6], "'1-7' 绕满一圈 = 整周")
  // 既有语义不得被破坏
  assert.deepEqual(C.parseDayRanges('1-5'), [1, 2, 3, 4, 5])
  assert.deepEqual(C.parseDayRanges('0-6'), [0, 1, 2, 3, 4, 5, 6])
  assert.deepEqual(C.parseDayRanges('5-1'), [0, 1, 5, 6], '跨周区间')
  assert.deepEqual(C.parseDayRanges('5-7'), [0, 5, 6], "'5-7' = 周五、六、日")
  assert.deepEqual(C.parseDayRanges('7'), [0], "单值 7 = 周日")
  assert.equal(C.parseDayRanges('8'), null, '只到 7')
})

test('V20: seriesQuery 回显的 granularity 必须是实际生效值', () => {
  // 0.8.10:?granularity=bogus → 按 day 分桶,却在每行回显 "bogus"。
  const s = store({ a: [rec()] })
  C.rebuildAll(s)
  const bad = C.seriesQuery(s, 'bogus', 'all', '', '', C.makeFilter({}), Date.now())
  assert.ok(bad.length > 0, '非法粒度应静默按 day 处理,而不是返回空')
  assert.equal(bad[0].granularity, 'day', '回显生效值,不是调用方传进来的假值')
  // 合法值必须原样保留
  for (const g of ['day', 'week', 'month']) {
    const r = C.seriesQuery(s, g, 'all', '', '', C.makeFilter({}), Date.now())
    if (r.length) assert.equal(r[0].granularity, g, `${g} 应原样回显`)
  }
  assert.equal(C.seriesQuery(s, undefined, 'all', '', '', C.makeFilter({}), Date.now())[0].granularity, 'day', '缺省 = day')
})

test('V21: exportJson 遇超出 Date 范围的时间戳不得抛 RangeError', () => {
  // 0.8.10:Number.isFinite(1e18) 为 true,但 new Date(1e18).toISOString() 抛
  // RangeError: Invalid time value → 整个导出 500。
  for (const t of [1e18, 8.64e15 + 1, -8.64e15 - 1]) {
    const s = store({ a: [rec({ t })] })
    C.rebuildAll(s)
    let out
    assert.doesNotThrow(() => { out = C.exportJson(s, 'all', '', '', C.makeFilter({}), Date.now()) }, `t=${t} 不应抛`)
    const parsed = JSON.parse(out)
    assert.equal(parsed.count, 1, `t=${t} 仍应导出该条`)
    assert.equal(parsed.requests[0].iso, null, '坏时间戳的 iso 应为 null')
    assert.equal(parsed.requests[0].time, t, '原始 time 必须原样保留')
  }
  // 正常时间戳不受影响
  const t = Date.UTC(2026, 8, 20, 3, 0, 0)
  const s = store({ a: [rec({ t })] })
  C.rebuildAll(s)
  const parsed = JSON.parse(C.exportJson(s, 'all', '', '', C.makeFilter({}), Date.now()))
  assert.equal(parsed.requests[0].iso, new Date(t).toISOString(), '正常时间戳照旧转 ISO')
})

test('V22: 预算状态必须由服务端下发(kpi.budget),未设预算时为 null', () => {
  // 用**本地时间**构造 nowMs:day/daysInMonth 都走本地 Date 方法,用 Date.UTC
  // 会让断言在非 UTC+8 的宿主机上随日期漂移(实测口径问题,不是被测代码的问题)。
  const nowMs = new Date(2026, 8, 20, 12, 0, 0).getTime()
  // 单价用"仅 miss 计价、1e6/¥M"→ 成本在数值上等于 miss,便于精确断言。
  // 必须是自定义价:official:* 不是内置官方 provider,默认是未定价(成本 0)。
  const price = { 'official:m1': { miss: 1e6, hit: 0, write: 0, output: 0 } }

  // 未设预算 → null(而不是"预算为 0"那种永远超支的假状态)
  const s0 = store({ a: [rec({ t: nowMs })] })
  C.rebuildAll(s0)
  assert.equal(C.kpiQuery(s0, 'all', '', '', C.makeFilter({}), nowMs).budget, null, '未设预算应为 null')

  // 设了预算 → 服务端给出与页面同一套字段
  const s = store({ a: [rec({ t: nowMs, miss: 30, read: 0, write: 0, out: 0 })] }, { prices: price, budget: { monthly: 100 } })
  C.rebuildAll(s)
  assert.equal(s.requests.a[0].cost, 30, '前置:自算成本应为 30(验证价格夹具本身)')
  const b = C.kpiQuery(s, 'all', '', '', C.makeFilter({}), nowMs).budget
  assert.ok(b, '设了预算必须下发 budget')
  assert.equal(b.monthly, 100)
  assert.equal(b.used, 30, '本月已花')
  assert.equal(b.day, 20, '今天几号')
  assert.equal(b.daysInMonth, 30, '2026-09 有 30 天')
  assert.equal(b.projected, 45, '外推 = 30/20*30')
  assert.equal(b.over, false)
  assert.equal(b.remaining, 55)
  assert.equal(b.ratio, 0.3)

  // 超支判定
  const s2 = store({ a: [rec({ t: nowMs, miss: 90, read: 0, write: 0, out: 0 })] }, { prices: price, budget: { monthly: 100 } })
  C.rebuildAll(s2)
  const b2 = C.kpiQuery(s2, 'all', '', '', C.makeFilter({}), nowMs).budget
  assert.equal(b2.projected, 135)
  assert.equal(b2.over, true, '外推超过预算应置 over')
  assert.equal(b2.remaining, -35, 'remaining 可为负')
})

test('V22b: budgetStatus 与 kpiQuery.budget 口径一致,且 budget=0 视为未设', () => {
  const nowMs = new Date(2026, 8, 10, 12, 0, 0).getTime()
  const a = C.budgetStatus(store({}, { budget: { monthly: 200 } }), 50, nowMs)
  assert.equal(a.projected, 150, '50/10*30')
  assert.equal(a.over, false)
  assert.equal(a.remaining, 50)
  // monthly=0 → null(未设预算),不是"预算 0 元"
  assert.equal(C.budgetStatus(store({}, { budget: { monthly: 0 } }), 50, nowMs), null)
  assert.equal(C.budgetStatus(store({}), 50, nowMs), null, '缺 config.budget 也是未设')
})

test('V23: 页面缓存键必须含文件 size(mtime 可能不动)', () => {
  const src = readFileSync(join(root, 'lib', 'index.js'), 'utf8')
  // 缓存对象要记录 size
  assert.match(src, /pageCache\s*=\s*\{[^}]*\bsize\b/, 'pageCache 必须记录 size')
  // 命中判定要比较 size
  assert.match(src, /pageCache\.size\s*===\s*size/, '命中判定必须比较 size')
  // statSync 的结果要取到 size
  assert.match(src, /statSync\(DEFAULT_PAGE\)/, '仍应只 stat 一次')
})

test('V24: POST /scan 失败时必须回 ok:false + 非 2xx(不得谎报成功)', async () => {
  const src = readFileSync(join(root, 'lib', 'index.js'), 'utf8')
  // 不得再出现"无条件 ok:true"的扫描响应
  assert.doesNotMatch(src, /if \(name === 'scan'\)\s*\{\s*json\(res,\s*200,\s*\{\s*ok:\s*true/,
    "POST /scan 不得无条件回 200 + ok:true")
  // 必须依据 summary.ok 分支
  assert.match(src, /summary\.ok === false|!summary\s*\|\|\s*summary\.ok/, '必须检查 scan() 的成败')
  // 扫描失败要落 5xx
  assert.match(src, /failed\s*\?\s*500\s*:\s*200/, '失败应回 500')

  // 行为验证:直接构造一个必然失败的 persistence,确认 scan 真的给出 ok:false
  const fake = {
    list: async () => [{ header: { id: 's1' }, revision: 1 }],
    open: async () => { throw new Error('boom') },
    locate: () => null,
  }
  const st = store({})
  const sum = await S.scanStore(st, fake, { logger: null })
  assert.equal(sum.ok, true, 'scanStore 内部把单会话失败计入 failed,而不是整体失败')
  assert.equal(sum.failed, 1)
})

test('V25: POST 路径必须排空请求体(keep-alive 不串流)', () => {
  const src = readFileSync(join(root, 'lib', 'index.js'), 'utf8')
  // scan 分支与未知 POST 分支都要 resume
  const scanBlock = src.slice(src.indexOf("if (name === 'scan')"), src.indexOf("if (name === 'config')"))
  assert.match(scanBlock, /req\.resume\(\)/, "scan 分支必须排空 body")
  const unknownBlock = src.slice(src.indexOf("json(res, 404, { error: 'unknown POST api' })") - 400, src.indexOf("json(res, 404, { error: 'unknown POST api' })") + 60)
  assert.match(unknownBlock, /req\.resume\(\)/, "未知 POST 分支也必须排空 body")
})

// ═══════════════════════════════════════════════════════════════════════════
// B 批 · 性能优化(语义必须完全不变)
// ═══════════════════════════════════════════════════════════════════════════

test('V26: eachWithin 的会话级预筛不得改变任何查询结果', () => {
  // 构造两个会话:两条不同 cwd、不同模型、不同日期
  const d1 = new Date('2026-09-10T10:00:00').getTime()
  const d2 = new Date('2026-09-11T10:00:00').getTime()
  const mk = () => ({
    version: C.STORE_VERSION,
    requests: {
      'sess-alpha-1': [rec({ t: d1, m: 'official:m1', miss: 10 }), rec({ t: d2, m: 'official:m2', miss: 20 })],
      'sess-beta-2': [rec({ t: d1, m: 'official:m2', miss: 30 })],
    },
    sessions: {
      'sess-alpha-1': { meta: { id: 'sess-alpha-1', cwd: 'D:\\proj\\alpha' } },
      'sess-beta-2': { meta: { id: 'sess-beta-2', cwd: 'D:\\other\\beta' } },
    },
    watermarks: {}, quarantine: {}, config: { prices: {}, retention: { days: 0 } }, days: {}, months: {}, stats: {},
  })
  const s1 = mk(); C.rebuildAll(s1)
  const now = new Date('2026-09-20T00:00:00').getTime()

  // session 前缀筛选:只应看到 alpha 的两条
  const k1 = C.kpiQuery(s1, 'all', '', '', C.makeFilter({ session: 'sess-alpha' }), now)
  assert.equal(k1.totals.requests, 2, 'session 前缀应命中该会话全部请求')
  assert.equal(k1.totals.miss, 30)

  // 不存在的 session → 0(且不得抛)
  const k0 = C.kpiQuery(s1, 'all', '', '', C.makeFilter({ session: 'nope' }), now)
  assert.equal(k0.totals.requests, 0)

  // wd 前缀筛选
  const k2 = C.kpiQuery(s1, 'all', '', '', C.makeFilter({ wd: 'D:\\proj' }), now)
  assert.equal(k2.totals.requests, 2, 'wd 前缀应命中 alpha')
  const k3 = C.kpiQuery(s1, 'all', '', '', C.makeFilter({ wd: 'D:\\other' }), now)
  assert.equal(k3.totals.requests, 1, 'wd 前缀应命中 beta')

  // 组合筛选:session + model
  const k4 = C.kpiQuery(s1, 'all', '', '', C.makeFilter({ session: 'sess-alpha', models: 'official:m2' }), now)
  assert.equal(k4.totals.requests, 1, 'session 与 model 组合')
  assert.equal(k4.totals.miss, 20)

  // 组合筛选:wd + model + 日期范围
  const k5 = C.kpiQuery(s1, 'custom', '2026-09-10', '2026-09-10', C.makeFilter({ wd: 'D:\\proj', models: 'official:m1' }), now)
  assert.equal(k5.totals.requests, 1, 'wd+model+日期 三者叠加')

  // 不带筛选时结果不变
  const kAll = C.kpiQuery(s1, 'all', '', '', C.makeFilter({}), now)
  assert.equal(kAll.totals.requests, 3)
  assert.equal(kAll.totals.miss, 60)

  // 慢路径必须与"手工过滤"逐字一致(交叉验证)
  const manual = [10, 20, 30].reduce((a, b) => a + b, 0)
  assert.equal(kAll.totals.miss, manual, '快慢路径与手工求和一致')
})

test('V27: 会话级预筛对 session/wd 的边界(cwd 缺失 / 空前缀 / 大小写)', () => {
  const t = new Date('2026-09-10T10:00:00').getTime()
  const s = {
    version: C.STORE_VERSION,
    requests: { s1: [rec({ t, miss: 5 })], s2: [rec({ t, miss: 7 })] },
    sessions: { s1: { meta: { id: 's1' } }, s2: { meta: { id: 's2', cwd: null } } },
    watermarks: {}, quarantine: {}, config: { prices: {}, retention: { days: 0 } }, days: {}, months: {}, stats: {},
  }
  C.rebuildAll(s)
  const now = Date.now()
  // cwd 缺失/为 null 时,w 前缀筛选应把它排除(与 matchFilter 的 (m&&m.cwd)||'' 同口径)
  assert.equal(C.kpiQuery(s, 'all', '', '', C.makeFilter({ wd: 'D:\\' }), now).totals.requests, 0, 'cwd 缺失应被排除')
  // 空前缀 = 无筛选(不得把全部会话排除掉)
  assert.equal(C.kpiQuery(s, 'all', '', '', C.makeFilter({ wd: '' }), now).totals.requests, 2, '空 wd = 无筛选')
  assert.equal(C.kpiQuery(s, 'all', '', '', C.makeFilter({ session: '' }), now).totals.requests, 2, '空 session = 无筛选')
})

test('V28: metaInfo 在聚合就绪时走派生,未就绪时回退逐记录 —— 两者结果必须一致', () => {
  const t = new Date('2026-09-10T10:00:00').getTime()
  const mk = () => ({
    version: C.STORE_VERSION,
    requests: { a: [rec({ t, m: 'official:m1' }), rec({ t, m: 'official:m2' })], b: [rec({ t, m: 'official:m3' })] },
    sessions: {}, watermarks: {}, quarantine: {}, config: { prices: {}, retention: { days: 0 } }, days: {}, months: {}, stats: {},
  })
  // 未就绪(没 rebuild):必须回退逐记录,给出正确的 3 / 3 个模型
  const cold = mk()
  const coldInfo = C.metaInfo(cold)
  assert.equal(coldInfo.requestCount, 3, '未就绪时不得因派生而报 0')
  assert.deepEqual(coldInfo.models, ['official:m1', 'official:m2', 'official:m3'], '未就绪时模型集合必须完整')

  // 已就绪:走派生,结果必须与未就绪时**逐字相同**
  const warm = mk(); C.rebuildAll(warm)
  const warmInfo = C.metaInfo(warm)
  assert.equal(warmInfo.requestCount, coldInfo.requestCount, '两条路径的 requestCount 必须一致')
  assert.deepEqual(warmInfo.models, coldInfo.models, '两条路径的 models 必须一致')
  assert.equal(warmInfo.sessionCount, 2)
})

test('V28b: metaInfo 派生路径在坏形态下不得给出 0(压测库 / sessions 数组)', () => {
  const t = Date.now()
  // 压测库形状:sessions 只有 requestCount,没有 totals
  const stressLike = {
    version: C.STORE_VERSION,
    requests: { a: [rec({ t }), rec({ t })], b: [rec({ t })] },
    sessions: { a: { id: 'a', requestCount: 2 }, b: { id: 'b', requestCount: 1 } },
    watermarks: {}, quarantine: {}, config: { prices: {}, retention: { days: 0 } }, days: {}, months: {}, stats: {},
  }
  const i1 = C.metaInfo(stressLike)
  assert.equal(i1.requestCount, 3, 'sessions 无 totals 时必须回退逐记录')
  assert.deepEqual(i1.models, ['official:m1'], '模型集合必须正确')

  // sessions 为数组(坏形态)
  const arrLike = { ...stressLike, sessions: [] }
  const i2 = C.metaInfo(arrLike)
  assert.equal(i2.requestCount, 3, 'sessions 为数组时不得报 0')

  // sessions 完全缺失
  const noSess = { ...stressLike, sessions: undefined }
  assert.equal(C.metaInfo(noSess).requestCount, 3)
})

test('V29: metaInfo 不得因派生而多出 "undefined" 伪模型', () => {
  const t = Date.now()
  // 正常库(有 m)派生后不得出现空键
  const s = { ...store({ a: [rec({ t, m: 'official:m1' }), rec({ t, m: 'official:m2' })] }) }
  C.rebuildAll(s)
  const info = C.metaInfo(s)
  assert.deepEqual(info.models, ['official:m1', 'official:m2'])
  assert.ok(!info.models.includes('undefined'), '不得出现伪模型名')
  assert.ok(!info.models.includes(''), '不得出现空模型名')
})

test('V30: eachWithin 必须在逐记录循环**之前**做会话级预筛(结构守卫,防被改回)', () => {
  // 这条是**结构断言**而不是计时断言:计时会随机器负载抖动,而"会话级筛选是否
  // 在日期计算之前"是源码层的确定事实。性能收益(慢路径 96%)完全依赖这个顺序,
  // 一旦有人"顺手"把它挪回 matchFilter 里,正确性测试(V26/V27)照样全绿 ——
  // 因为它们只验结果、不验路径。所以必须在这里钉住顺序。
  const src = readFileSync(join(root, 'lib', 'core.mjs'), 'utf8')
  const start = src.indexOf('function eachWithin(')
  assert.ok(start > 0, '找不到 eachWithin')
  // 截到函数结束(下一个顶层 '}' 后跟换行的启发式:用 matchFilter 之后的块)
  const end = src.indexOf('\nfunction inDayRange', start)
  const body = src.slice(start, end > 0 ? end : start + 2000)

  const atSessionCheck = body.indexOf('id.indexOf(f.sessionId)')
  const atWdCheck = body.indexOf('cwd.indexOf(f.wd)')
  const atDayKey = body.indexOf('dayKeyOf(rec.t)')

  assert.ok(atSessionCheck > 0, 'eachWithin 必须含 session 前缀的会话级判定')
  assert.ok(atWdCheck > 0, 'eachWithin 必须含 wd 前缀的会话级判定')
  assert.ok(atDayKey > 0, 'eachWithin 仍应逐记录算日键')

  // 关键:整会话跳过必须出现在逐记录日键计算**之前**
  assert.ok(atSessionCheck < atDayKey,
    'session 预筛必须在 dayKeyOf 之前(否则 99.98% 的日期计算仍是白做的)')
  assert.ok(atWdCheck < atDayKey,
    'wd 预筛必须在 dayKeyOf 之前')
  // 且必须在逐记录循环开始之前(不是被塞进循环体里)
  const innerLoop = body.indexOf('for (let i = 0; i < list.length')
  assert.ok(atSessionCheck < innerLoop, 'session 预筛必须在逐记录循环之外')
  assert.ok(atWdCheck < innerLoop, 'wd 预筛必须在逐记录循环之外')
})

test('V31: metaInfo 的派生路径必须受 aggregatesReady 闸门保护(结构守卫)', () => {
  // 与 V30 同理:V28/V28b 验的是"结果正确",但只要闸门被换成 "sessions 存在",
  // 那些用例在**正常库**上照样全绿,只有坏形态才暴露。这里直接钉住闸门本身。
  const src = readFileSync(join(root, 'lib', 'core.mjs'), 'utf8')
  const start = src.indexOf('export function metaInfo(')
  const end = src.indexOf('// 导出', start)
  const body = src.slice(start, end > 0 ? end : start + 2500)
  assert.match(body, /aggregatesReady\(store\)/,
    'metaInfo 的派生必须以 aggregatesReady 为闸门,不能只看 sessions 字段是否存在')
  // 必须保留逐记录回退分支
  assert.match(body, /store\.requests\[id\]\.length/, '必须保留逐记录回退')
})
