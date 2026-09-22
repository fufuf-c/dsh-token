/**
 * dsh-token — 重构时抽出的共用原语测试(node:test,零依赖)
 *
 * 这些函数原先都是**散落的重复表达式**(四段求和 16 处、模型键拆分 7 处、
 * 模型桶懒建 6 处、空模型表 2 处、日期守卫 4 处、模型筛选 4 处)。抽出来之后,
 * 它们成了"口径的唯一出处" —— 一旦这里的行为变了,上层所有数字都会跟着变,
 * 所以每一个都要单独钉住。
 *
 * 与 host-fold.test.mjs 的分工:那里测的是"查询结果对不对"(端到端),
 * 这里测的是"共用原语本身"的边界与口径(单元)。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  tokenTotal, splitModelKey, modelsArrayOf, bumpModel,
  inDayRange, modelPicks, newTotals, addTotals, aggregate,
} from '../lib/core.mjs'

test('tokenTotal:四段求和,缺字段按 0 —— 与 totals 桶/逐条记录两种形状通用', () => {
  assert.equal(tokenTotal({ miss: 1, read: 2, write: 3, out: 4 }), 10)
  // 只给部分字段:不能出 NaN(旧代码逐字段 ||0 就是为了这个)
  assert.equal(tokenTotal({ miss: 5 }), 5)
  assert.equal(tokenTotal({}), 0)
  // 空/假值一律 0(调用点会直接拿 totals 用,不能抛)
  assert.equal(tokenTotal(null), 0)
  assert.equal(tokenTotal(undefined), 0)
  assert.equal(tokenTotal(0), 0)
  // 显式 0 与缺失等价
  assert.equal(tokenTotal({ miss: 0, read: 0, write: 0, out: 0 }), 0)
  assert.equal(tokenTotal({ miss: 100, read: 200, write: 300, out: 400 }), 1000)
})

test('tokenTotal:只算四段,requests/cost 一律不计入', () => {
  const t = newTotals()
  aggregate(t, { miss: 1, read: 0, write: 0, out: 0, cost: 99, saved: 5, priced: true })
  aggregate(t, { miss: 0, read: 0, write: 0, out: 7, cost: 1, saved: 0, priced: true })
  assert.equal(t.requests, 2)
  assert.equal(tokenTotal(t), 8, 'requests / cost / saved 都不计入 token 总数')
})

test('splitModelKey:第一个冒号切分,冒号后的内容原样保留', () => {
  assert.deepEqual(splitModelKey('deepseek-official:deepseek-flash'), { provider: 'deepseek-official', model: 'deepseek-flash' })
  // 模型名里可能再带冒号/斜杠:只切第一个
  assert.deepEqual(splitModelKey('gmi:MiniMaxAI/MiniMax-M3'), { provider: 'gmi', model: 'MiniMaxAI/MiniMax-M3' })
  assert.deepEqual(splitModelKey('p:a:b:c'), { provider: 'p', model: 'a:b:c' })
})

test('splitModelKey:无冒号时 provider 为空、model 为整串', () => {
  assert.deepEqual(splitModelKey('bare-model'), { provider: '', model: 'bare-model' })
  assert.deepEqual(splitModelKey(''), { provider: '', model: '' })
  // 前导/尾随冒号
  assert.deepEqual(splitModelKey(':lead'), { provider: '', model: 'lead' })
  assert.deepEqual(splitModelKey('trail:'), { provider: 'trail', model: '' })
})

test('splitModelKey:非字符串一律 String() 兜住(调用点原先会 TypeError)', () => {
  // sessionDetailQuery 的一处调用点原先直接对 key 调 indexOf,
  // 非字符串会 TypeError;统一后由这里兜住
  assert.deepEqual(splitModelKey(123), { provider: '', model: '123' })
  assert.deepEqual(splitModelKey(null), { provider: '', model: '' })
  assert.deepEqual(splitModelKey(undefined), { provider: '', model: '' })
  assert.deepEqual(splitModelKey(String(42)), { provider: '', model: '42' })
})

test('splitModelKey:与手写 indexOf 口径逐例一致(回归)', () => {
  for (const k of ['a:b', 'nocolon', ':lead', 'trail:', 'x:' + 'y'.repeat(50)]) {
    const i = k.indexOf(':')
    const want = i >= 0 ? { provider: k.slice(0, i), model: k.slice(i + 1) } : { provider: '', model: k }
    assert.deepEqual(splitModelKey(k), want, k)
  }
})

test('modelsArrayOf:拆分 key + 按 token 总量降序', () => {
  const out = modelsArrayOf({ 'prov:b': { miss: 1 }, a: { miss: 9 } })
  assert.equal(out.length, 2)
  // 降序:9 在前
  assert.deepEqual(out.map((x) => x.key), ['a', 'prov:b'])
  assert.deepEqual(out.map((x) => x.provider), ['', 'prov'])
  assert.deepEqual(out.map((x) => x.model), ['a', 'b'])
  // 每项都要带 key(消费方靠它渲染模型名)
  for (const x of out) assert.equal(typeof x.key, 'string')
})

test('modelsArrayOf:空表 → 空数组;totals 引用保持(不是深拷贝)', () => {
  assert.deepEqual(modelsArrayOf({}), [])
  const src = { a: { miss: 3, cost: 1 } }
  const out = modelsArrayOf(src)
  assert.equal(out[0].totals, src.a, 'totals 应直接引用,不再复制一份')
})

test('bumpModel:懒建空桶并挂回映射;已存在则原样返回同一对象', () => {
  const map = {}
  const a = bumpModel(map, 'a')
  assert.deepEqual(Object.keys(map), ['a'], '取不到就该建出来并挂回')
  assert.deepEqual(a, newTotals(), '新桶是完整零值形状(不是 {})')
  assert.equal(bumpModel(map, 'a'), a, '第二次必须返回同一个对象(否则累加会丢失)')
  // 调用方负责累加:bumpModel 本身不改数值
  addTotals(bumpModel(map, 'a'), Object.assign(newTotals(), { miss: 5, requests: 1 }))
  assert.equal(map.a.miss, 5)
  assert.equal(tokenTotal(bumpModel(map, 'b')), 0, '另一个 key 独立建桶')
})

test('bumpModel:非字符串 key 也按属性名处理(与对象语义一致)', () => {
  const map = {}
  bumpModel(map, 1)
  assert.deepEqual(Object.keys(map), ['1'])
})

test('inDayRange:无区间 / 单侧限制', () => {
  // 语义:r.from / r.to 为假值时该侧不设限
  assert.equal(inDayRange('2026-08-25', {}), true)
  assert.equal(inDayRange('2026-08-25', { from: null, to: null }), true)
  assert.equal(inDayRange('2020-01-01', { from: '2026-01-01' }), false)
  assert.equal(inDayRange('2030-01-01', { from: '2026-01-01' }), true)
  assert.equal(inDayRange('2030-01-01', { to: '2026-01-01' }), false)
  assert.equal(inDayRange('2020-01-01', { to: '2026-01-01' }), true)
})

test('inDayRange:边界含端点(闭区间 —— 与 dayRangeOf/CSV 行数口径一致)', () => {
  const r = { from: '2026-08-20', to: '2026-08-25' }
  assert.equal(inDayRange('2026-08-20', r), true, '下界含')
  assert.equal(inDayRange('2026-08-25', r), true, '上界含')
  assert.equal(inDayRange('2026-08-21', r), true)
  assert.equal(inDayRange('2026-08-19', r), false)
  assert.equal(inDayRange('2026-08-26', r), false)
})

test('inDayRange:形参名是 from/to,不是 fromDay/toDay(防误用回归)', () => {
  // 传错键名会静默"不过滤" —— 这正是 4 处重复判定里最容易抄错的地方
  assert.equal(inDayRange('2020-01-01', { fromDay: '2026-01-01' }), true)
  assert.equal(inDayRange('2020-01-01', { from: '2026-01-01' }), false)
})

test('modelPicks:无筛选 → null("走整桶快速累加"),有筛选 → 具体键数组', () => {
  assert.equal(modelPicks({}), null)
  assert.equal(modelPicks({ modelSet: null }), null)
  assert.equal(modelPicks({ modelSet: undefined }), null)
  assert.deepEqual(modelPicks({ modelSet: new Set(['a']) }), ['a'])
  assert.deepEqual(modelPicks({ modelSet: new Set(['a', 'b']) }).sort(), ['a', 'b'])
  // 空 Set 是"筛了但一个都不选" —— 不是 null(不能退化成整桶)
  const empty = modelPicks({ modelSet: new Set() })
  assert.ok(Array.isArray(empty) && empty.length === 0)
})

test('addTotals:totals 桶相加(dst ← src),含 requests/cost/saved/priced', () => {
  const dst = newTotals()
  const src = newTotals()
  aggregate(src, { miss: 1, read: 2, write: 3, out: 4, cost: 5, saved: 6, priced: true })
  aggregate(src, { miss: 1, read: 0, write: 0, out: 0, cost: 1, saved: 0, priced: false })
  const ret = addTotals(dst, src)
  assert.equal(ret, dst, '原地累加并返回 dst')
  assert.equal(dst.miss, 2)
  assert.equal(dst.read, 2)
  assert.equal(tokenTotal(dst), 11)
  assert.equal(dst.requests, 2)
  assert.equal(dst.cost, 6)
  assert.equal(dst.saved, 6)
  assert.equal(dst.priced, 1)
})

test('aggregate:单条记录累加,每次记一次 requests;cost/saved 缺省按 0', () => {
  const t = newTotals()
  aggregate(t, { miss: 1, read: 2, write: 3, out: 4 })
  assert.equal(t.requests, 1)
  assert.equal(t.cost, 0)
  assert.equal(t.saved, 0)
  assert.equal(t.priced, 0, 'priced 缺失 → 不计已定价数')
  aggregate(t, { miss: 0, read: 0, write: 0, out: 0, priced: true })
  assert.equal(t.requests, 2)
  assert.equal(t.priced, 1)
})

test('addTotals 与 aggregate 不可互换:形状相同但语义不同', () => {
  // addTotals 加 src.requests;aggregate 只 +1 —— 喂错输入不会报错,只会算错
  const dst = newTotals(), srcTotals = Object.assign(newTotals(), { requests: 7, miss: 1 })
  addTotals(dst, srcTotals)
  assert.equal(dst.requests, 7, 'addTotals 用 src.requests')
  const t2 = newTotals()
  aggregate(t2, srcTotals)
  assert.equal(t2.requests, 1, 'aggregate 每次只记 1')
})
