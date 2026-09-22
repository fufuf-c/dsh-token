/**
 * dsh-token — 0.8.5 界面回归测试(node:test,零依赖,无浏览器)
 *
 * 这一批锁的都是**用户实际反馈**的界面缺陷,共性同样是"不报错、只是看起来不对":
 *   UI-1  模型配色必须按**模型名**稳定 —— 同一模型在同一屏的任何卡片里恒为同色
 *   UI-2  「按模型」占比不得用 cost(未计价模型会整列显示 0.0%)
 *   UI-3  「按模型」的窗口必须跟随所选时间范围,标题也要跟着变
 *   UI-4  单桶(月粒度选一月)必须画成柱,且不给"▼100%"这种假环比
 *   UI-5  图表取点监听必须幂等 —— canvas 复用时不得累积监听器
 *   UI-6  自定义范围反馈:应用后给出解析结果,且结构不变时不重建输入框
 *
 * 做法与 page-render.test.mjs 一致:把 web/index.html 的**真实源码**放进 vm 执行,
 * 在 IIFE 收尾前把内部函数挂出来,然后直接调用。函数体一行不改。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------------------
// 假 DOM:能记录 innerHTML、支持 addEventListener 计数、可做事件派发
// ---------------------------------------------------------------------------
function fakeEl(tag) {
  const listeners = {}
  const t = {
    innerHTML: '', textContent: '', value: '', hidden: false,
    tagName: (tag || 'DIV').toUpperCase(),
    style: {}, dataset: {}, children: [],
    clientWidth: 640, clientHeight: 220, width: 640, height: 220,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c) }, remove(c) { this._s.delete(c) },
      toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c) } else if (on) this._s.add(c); else this._s.delete(c) },
      contains(c) { return this._s.has(c) },
    },
    listeners,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn) },
    removeEventListener(type, fn) {
      const a = listeners[type]
      if (!a) return
      const i = a.indexOf(fn)
      if (i >= 0) a.splice(i, 1)
    },
    dispatch(type, ev) { (listeners[type] || []).forEach((f) => f(ev || {})) },
    setAttribute(k, v) { t.dataset[k] = v },
    getAttribute(k) { return t.dataset[k] === undefined ? null : t.dataset[k] },
    getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 220, right: 640, bottom: 220 } },
    focus() {}, blur() {}, click() {},
  }
  const ctx2d = new Proxy({}, {
    get: (o, k) => {
      if (k === 'canvas') return el
      if (k === 'measureText') return () => ({ width: 10 })
      // 渐变必须返回带 addColorStop 的对象 —— drawAreaLine 会立刻调用它
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} })
      if (k === 'getLineDash') return () => []
      return () => {}
    },
    set: () => true,
  })
  const el = new Proxy(t, {
    get(o, k) {
      if (k in o) return o[k]
      if (k === 'getContext') return () => ctx2d
      if (k === 'querySelectorAll') return () => []
      if (k === 'querySelector' || k === 'closest') return () => el
      if (k === 'appendChild' || k === 'insertBefore' || k === 'removeChild' || k === 'replaceChild') return (x) => x
      if (k === 'cloneNode') return () => el
      if (k === 'insertAdjacentHTML') return () => {}
      if (k === 'parentElement') return null
      // 真实 DOM 里每个节点都有 parentNode;生产代码会用它摘掉弹出层。
      // 桩里给一个能接 removeChild 的对象,否则"移除"这一步会以
      // TypeError 的形式伪装成被测代码的缺陷。
      if (k === 'parentNode') return { removeChild() {}, appendChild() {}, insertBefore() {} }
      return () => {}
    },
    set(o, k, v) { o[k] = v; return true },
  })
  return el
}

const els = new Map()
/**
 * "还不存在的元素"集合。
 *
 * 默认 getEl 对任何 id 都随手造一个,方便了"只要读它写了什么"的用例;但
 * `insertAdjacentHTML` 是空操作,于是**弹层永远凭空存在** —— 那些断言
 * "点箭头会不会把整个弹层重建掉"的用例就永远走不到真实的建壳分支,变成假绿。
 * 需要真实建模"元素从无到有"的用例,先把 id 放进来。
 */
const absentIds = new Set()
const getEl = (id) => {
  if (absentIds.has(id)) return null
  if (!els.has(id)) els.set(id, fakeEl(/canvas|trend|hours|dm-/.test(id) ? 'CANVAS' : 'DIV'))
  return els.get(id)
}
/** 造一个"真实存在"的元素(等价于 DOM 里刚被 insertAdjacentHTML 插进来)。 */
const createEl = (id) => {
  absentIds.delete(id)
  if (!els.has(id)) els.set(id, fakeEl('DIV'))
  return els.get(id)
}

const docListeners = {}
const doc = {
  getElementById: getEl,
  querySelector: () => fakeEl(),
  querySelectorAll: () => [],
  // 记录 document 级监听:"点空白处收起"正是挂在这里的,而它误判游离节点就是
  // 自定义日期弹层"点箭头就整个退出"的根因 —— 不记录就没法复现那条路径。
  addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn) },
  removeEventListener(type, fn) {
    const a = docListeners[type]
    if (!a) return
    const i = a.indexOf(fn)
    if (i >= 0) a.splice(i, 1)
  },
  createElement: (t) => fakeEl(t),
  hidden: true,
  body: fakeEl(), documentElement: fakeEl(), head: fakeEl(),
  fonts: { ready: new Promise(() => {}) },
}

const sandbox = {
  document: doc,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetch: () => new Promise(() => {}),
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  location: { href: 'http://127.0.0.1:3080/dsh-token', search: '', hash: '', pathname: '/dsh-token' },
  navigator: { userAgent: 'node', clipboard: { writeText: async () => {} } },
  console, JSON, Date, Math, Number, String, Object, Array, RegExp, Error, Promise, Set, Map, isFinite, parseInt, parseFloat,
}
/**
 * 固定"今天"。热力图/月历有多条断言把 2026-09-18 当成今天(首条记录之前算 NA、
 * 之后算真实格子),而 `dayKey(Date.now())` 读的是真实时钟 —— 一旦跨过午夜,
 * 同一个用例就会因为"多出一个真实格子"而失败,看起来像代码坏了,其实只是日期变了。
 * 这里把沙箱里的 Date 钉死,让这些用例与运行日期无关。
 */
const FIXED_NOW = Date.parse('2026-09-18T15:00:00+08:00')
{
  const RealDate = Date
  class FixedDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(FIXED_NOW); else super(...args) }
    static now() { return FIXED_NOW }
  }
  sandbox.Date = FixedDate
}
sandbox.window = sandbox
sandbox.globalThis = sandbox
sandbox.addEventListener = () => {}
sandbox.removeEventListener = () => {}
sandbox.scrollTo = () => {}
sandbox.scrollY = 0
sandbox.devicePixelRatio = 1
sandbox.innerWidth = 1280
sandbox.innerHeight = 800
sandbox.history = { replaceState() {}, pushState() {} }
// cssVar() 走 getComputedStyle(...).getPropertyValue();颜色取不到时必须能走兜底表,
// 所以这里返回"读不到任何变量"而不是抛错 —— 正好也覆盖了兜底路径。
sandbox.getComputedStyle = () => ({ getPropertyValue: () => '' })
for (const g of ['URLSearchParams', 'URL', 'TextEncoder', 'TextDecoder', 'Blob', 'AbortController',
  'AbortSignal', 'Event', 'CustomEvent', 'Intl', 'encodeURIComponent', 'decodeURIComponent',
  'queueMicrotask', 'structuredClone', 'performance']) {
  if (g in globalThis) sandbox[g] = globalThis[g]
}
vm.createContext(sandbox)

const html = readFileSync(join(root, 'web', 'index.html'), 'utf8')
/**
 * 页面里那段 <style> 的**源码**。
 *
 * 有一条断言原先写的是"渲染出的 HTML 里不得出现 var(--chip)"—— 而 `--chip` 只会
 * 出现在 CSS 里,渲染 HTML 的格子背景是内联的 `rgba(...)`。于是那条断言**恒为真**,
 * 等于没测(变异测试把这一点暴露了出来:把空格子改回 --chip 填充,它照样全绿)。
 * 样式类的断言必须读样式源码,不能读渲染结果。
 */
const PAGE_CSS = (/<style[^>]*>([\s\S]*?)<\/style>/i.exec(html) || [, ''])[1]
const m = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(html)
assert.ok(m, '页面应有内联脚本')
let code = m[1]
const tail = code.lastIndexOf('})();')
assert.ok(tail > 0, '内联脚本应为 IIFE 收尾')
code = code.slice(0, tail) +
  'globalThis.__ui = { state: state, modelColor: modelColor, rebuildModelColors: rebuildModelColors, ' +
  'renderModelCats: renderModelCats, renderTrend: renderTrend, bindChartPointer: bindChartPointer, ' +
  'renderRangeChip: renderRangeChip, RANGE_LABELS: RANGE_LABELS, rpPickDay: rpPickDay, ' +
  'renderRangePop: renderRangePop, rpFillGrid: rpFillGrid, rpShift: rpShift, rpQuick: rpQuick, ' +
  'rpApply: rpApply, fCount: fCount, ' +
  'hmScale: hmScale, renderHeatmap: renderHeatmap, segSync: segSync };\n' +
  // rpView 是 IIFE 内的 var:上面那种一次性赋值只会拷走当时的字符串,读不到翻月后的值。
  // 用访问器把"当前正在显示哪个月"接出来,翻月测试才有意义。
  'Object.defineProperty(globalThis.__ui, "rpView", {' +
  ' get: function () { return rpView; }, set: function (v) { rpView = v; } });\n' +
  code.slice(tail)
vm.runInContext(code, sandbox, { filename: 'web/index.html' })
const ui = sandbox.__ui

const setModels = (keys) => { ui.state.meta = { models: keys.slice() }; ui.state._series = null; ui.state.kpiAct = null; ui.rebuildModelColors() }

// ---------------------------------------------------------------------------
// UI-1:模型配色按名字稳定
// ---------------------------------------------------------------------------
test('UI-1: 同一模型在任何数组顺序下都拿到同一个颜色', () => {
  // 复现真实缺陷的三个来源顺序(/kpi /series /meta 各不同)
  setModels(['d1:a', 'official:b', 'open:c'])
  const colorA = ui.modelColor('official:b')

  // 换一个"手边数组"的顺序 —— 旧实现按下标取色,这里就会换色
  ui.state.meta = { models: ['official:b', 'open:c', 'd1:a'] }
  const colorB = ui.modelColor('official:b')
  assert.equal(colorB, colorA, '模型换了个数组仍必须是同一个颜色')

  // 字典序决定编号:official:b 在两种集合里各自算出来都应一致
  setModels(['d1:a', 'official:b', 'open:c'])
  assert.equal(ui.modelColor('official:b'), colorA)
})

test('UI-1b: 同一份模型集合下配色是确定的(可复现,不随渲染次数变)', () => {
  setModels(['a', 'b'])
  const first = ['a', 'b'].map((k) => ui.modelColor(k))
  // 反复重建:同样的集合必须得到同样的颜色分配
  for (let i = 0; i < 3; i++) {
    ui.rebuildModelColors()
    assert.deepEqual(['a', 'b'].map((k) => ui.modelColor(k)), first, '同一集合下配色必须可复现')
  }
  // 且同一屏内不同模型颜色互不相同(否则颜色无法区分模型)
  assert.notEqual(first[0], first[1], '同一屏内相邻模型必须不同色')
})

test('UI-1c: 未知模型不会撞上 0 号色', () => {
  setModels(['a', 'b', 'c'])
  const zero = ui.modelColor('a')
  const unknown = ui.modelColor('zzz-never-listed')
  assert.notEqual(unknown, zero, '未登记模型必须另分配颜色,而不是回退到 0 号')
})

test('UI-1d: 渲染出的颜色必须按模型名绑定 —— 换顺序后同一模型仍是同色', () => {
  const colorInHTML = (key) => {
    ui.state.models = []
    ui.renderModelCats()
    const rows = getEl('model-cats').innerHTML.split('<button').slice(1)
    const row = rows.find((r) => r.includes('data-model="' + key + '"'))
    assert.ok(row, `应渲染出 ${key}`)
    const mm = /class="cdot" style="background:([^"]+)"/.exec(row)
    assert.ok(mm, `${key} 应有色点`)
    return mm[1]
  }
  // 同一组模型,两种不同的"手边数组顺序"(真实里 /kpi 与 /series 就是相反的)
  const ordered = [
    { key: 'official:b', totals: { miss: 30, read: 0, write: 0, out: 0, requests: 3, cost: 0 } },
    { key: 'd1:a', totals: { miss: 20, read: 0, write: 0, out: 0, requests: 2, cost: 0 } },
    { key: 'open:c', totals: { miss: 10, read: 0, write: 0, out: 0, requests: 1, cost: 0 } },
  ]
  setModels(ordered.map((x) => x.key))
  ui.state.kpiAct = { totals: { cost: 0 }, models: ordered.slice() }
  const first = ordered.map((x) => colorInHTML(x.key))

  // 反转数组顺序(旧实现按下标取色 → 三个模型全部变色)
  const reversed = ordered.slice().reverse()
  ui.state.kpiAct = { totals: { cost: 0 }, models: reversed }
  const second = reversed.map((x) => colorInHTML(x.key))

  // 按模型名比较,忽略顺序
  const mapOf = (keys, cols) => Object.fromEntries(keys.map((k, i) => [k, cols[i]]))
  assert.deepEqual(
    mapOf(reversed.map((x) => x.key), second),
    mapOf(ordered.map((x) => x.key), first),
    '数组顺序变化后,同一模型必须仍是同一个颜色(否则颜色不承载任何信息)',
  )
  // 且三个模型颜色互不相同(否则"按模型配色"形同虚设)
  assert.equal(new Set(first).size, 3, '同屏三个模型应有三种不同颜色')
})

// ---------------------------------------------------------------------------
// UI-2 / UI-3:按模型卡片的口径与窗口
// ---------------------------------------------------------------------------
test('UI-2: 未计价模型不得因为 cost=0 而在列表里显示 0.0%', () => {
  ui.state.models = []
  ui.state.meta = { models: ['big-unpriced', 'small-priced'] }
  // 大用量但未计价(真实数据即如此),小用量但计价
  ui.state.kpiAct = {
    totals: { cost: 1 },
    models: [
      { key: 'big-unpriced', totals: { miss: 3000, read: 0, write: 0, out: 0, requests: 10, cost: 0 } },
      { key: 'small-priced', totals: { miss: 100, read: 0, write: 0, out: 0, requests: 1, cost: 1 } },
    ],
  }
  ui.rebuildModelColors()
  ui.renderModelCats()
  const out = getEl('model-cats').innerHTML
  const rows = out.split('<button').slice(1)
  const rowOf = (key) => rows.find((r) => r.includes('data-model="' + key + '"'))
  // 直接解析"显示出来的那个百分数",而不是去子串匹配 ——
  // "100.0%" 里**包含** "0.0%",用 doesNotMatch(/0\.0%/) 会被自己骗过
  // (这个陷阱已被变异测试真实触发过一次,所以改成取值比较)。
  const pctOf = (key) => {
    const r = rowOf(key)
    assert.ok(r, `应渲染出 ${key} 行`)
    const mm = /<span>([\d.]+)% · ¥/.exec(r)
    assert.ok(mm, `${key} 行应带百分比`)
    return Number(mm[1])
  }
  // 旧实现按 cost 占比 → big-unpriced 是 0.0%,small-priced 是 100.0%
  assert.equal(pctOf('big-unpriced'), 100, '占比最大的模型必须是 100%(按 tokens,而不是按 cost)')
  assert.ok(pctOf('small-priced') < 100, '用量最小的模型不该是 100%')
  assert.notEqual(pctOf('big-unpriced'), 0, '未计价的大用量模型不得显示 0%')
})

test('UI-3: 按模型标题跟随所选范围,不再写死"全部时间"', () => {
  ui.state.meta = { models: ['x'] }
  ui.state.kpiAct = { totals: { cost: 0 }, models: [{ key: 'x', totals: { miss: 1, read: 0, write: 0, out: 0, requests: 1, cost: 0 } }] }
  for (const [range, label] of [['7d', '近 7 天'], ['month', '本月'], ['today', '今天']]) {
    ui.state.range = range
    ui.renderModelCats()
    // renderActivity 负责标题;这里直接断言标签表与状态一致(标题由它拼出)
    assert.equal(ui.RANGE_LABELS[range], label)
  }
  ui.state.range = 'all'
})

// ---------------------------------------------------------------------------
// UI-4:单桶不得给假环比 / 必须画成柱
// ---------------------------------------------------------------------------
test('UI-4: 只有一个周期时不得给出"▼100%"的假环比', () => {
  const el = getEl('trend-canvas')
  el.parentElement = getEl('trend-wrap')
  ui.state.metric = 'tokens'
  ui.state.granularity = 'month'
  ui.state.hidden = {}
  ui.state.stkSel = null
  const one = [{ key: '2026-09', granularity: 'month', totals: { miss: 100, read: 200, write: 0, out: 50, requests: 5, cost: 0, saved: 0 }, models: { m1: { miss: 100, read: 200, write: 0, out: 50, requests: 5, cost: 0 } } }]
  ui.renderTrend(one)
  const hero = getEl('trend-hero').innerHTML
  assert.doesNotMatch(hero, /100\.0%/, '单周期不得报出 100% 的环比')
  assert.doesNotMatch(hero, /▼/, '单周期不得出现下降箭头')
  assert.match(hero, /无法比较/, '应说明只有单个周期')
  // 必须真的画出内容(旧实现在折线分支下只 moveTo 一个点 → 画布空白)
  assert.ok(el.width > 0, 'canvas 应被初始化')
})

test('UI-4b: 多周期仍照常给环比', () => {
  const el = getEl('trend-canvas')
  el.parentElement = getEl('trend-wrap')
  ui.state.metric = 'tokens'
  ui.state.granularity = 'month'
  const mk = (k, v) => ({ key: k, granularity: 'month', totals: { miss: v, read: 0, write: 0, out: 0, requests: 1, cost: 0, saved: 0 }, models: { m1: { miss: v, read: 0, write: 0, out: 0, requests: 1, cost: 0 } } })
  ui.renderTrend([mk('2026-08', 100), mk('2026-09', 300)])
  const hero = getEl('trend-hero').innerHTML
  assert.match(hero, /%/, '多周期应给出环比')
  assert.doesNotMatch(hero, /无法比较/)
})

// ---------------------------------------------------------------------------
// UI-5:取点监听幂等
// ---------------------------------------------------------------------------
test('UI-5: 反复绑定不得累积监听器(否则旧闭包会抹掉新提示)', () => {
  const cv = fakeEl('CANVAS')
  const nop = () => {}
  for (let i = 0; i < 5; i++) ui.bindChartPointer(cv, nop, nop)
  for (const type of ['pointermove', 'pointerdown', 'pointerup', 'pointerleave', 'pointercancel']) {
    assert.equal((cv.listeners[type] || []).length, 1, `${type} 必须只有一个监听器,实际 ${(cv.listeners[type] || []).length}`)
  }
})

test('UI-5b: 重绑后生效的是最新那个回调', () => {
  const cv = fakeEl('CANVAS')
  const seen = []
  ui.bindChartPointer(cv, () => seen.push('old'), null)
  ui.bindChartPointer(cv, () => seen.push('new'), null)
  cv.dispatch('pointermove', { clientX: 10, clientY: 10, pointerType: 'mouse' })
  assert.deepEqual(seen, ['new'], '只应调用最新回调,旧闭包不得再跑')
})

// ---------------------------------------------------------------------------
// UI-6:自定义范围(自绘区间选择器)
// ---------------------------------------------------------------------------
test('UI-6: 自定义范围结构不变时不重建选择器(否则展开的月历会被吃掉)', () => {
  ui.state.range = 'custom'
  ui.state.from = '2026-09-01'
  ui.state.to = '2026-09-18'
  ui.state.rpOpen = false
  getEl('range-chip').dataset.kind = undefined
  ui.renderRangeChip(null)
  const firstHTML = getEl('range-chip').innerHTML
  assert.match(firstHTML, /rp-trigger/, '应渲染自绘触发器')
  // 再渲染一次:结构相同 → 不应重写 innerHTML
  getEl('range-chip').innerHTML = 'SENTINEL'
  ui.renderRangeChip(null)
  assert.equal(getEl('range-chip').innerHTML, 'SENTINEL', '结构未变时不得重建(重建会关掉展开的月历)')
})

test('UI-6b: 预设范围下选择器仍常驻(自定义是模式,不是第 7 个预设)', () => {
  ui.state.range = 'all'
  ui.state.from = ''
  ui.state.to = ''
  ui.state.rpOpen = false
  getEl('range-chip').dataset.kind = undefined
  ui.renderRangeChip({ range: { fromDay: '2026-09-01', toDay: '2026-09-18' } })
  const out = getEl('range-chip').innerHTML
  // 预设态下**也要有**展开入口:否则「自定义」只能藏在分段里,一变模式就找不到回去的路
  assert.match(out, /rp-trigger/, '预设态也必须留着自定义入口')
  assert.match(getEl('rp-label').textContent, /自定义日期/, '未选时引导文案')
  // 未选时不显示清除 ×(没有东西可清)
  assert.doesNotMatch(out, /range-clear/, '未选自定义范围时不该有清除按钮')
})

test('UI-6c: 自定义范围已选好时,触发器上直接显示区间', () => {
  ui.state.range = 'custom'
  ui.state.from = '2026-09-01'
  ui.state.to = '2026-09-18'
  ui.state.rpOpen = false
  getEl('range-chip').dataset.kind = undefined
  ui.renderRangeChip(null)
  // 区间文字是**唯一**的反馈处(原先还有一条 range-hint 重复说一遍「已应用 … 共 N 天」)
  assert.match(getEl('rp-label').textContent, /2026-09-01 ~ 2026-09-18/, '触发器上要显示已选区间')
  assert.match(getEl('range-chip').innerHTML, /range-clear/, '已选后要给出清除入口')
})

test('UI-6d: 不再使用原生 input[type=date],且只点一个端点不算一个范围', () => {
  ui.state.range = 'custom'
  ui.state.from = ''
  ui.state.to = ''
  ui.state.rpOpen = false
  getEl('range-chip').dataset.kind = undefined
  ui.renderRangeChip(null)
  const out = getEl('range-chip').innerHTML
  assert.doesNotMatch(out, /type="date"/, '不得再用原生日期输入')
  assert.doesNotMatch(out, /type=date/, '不得再用原生日期输入')
  // 未选日期时,触发器上应显示引导文案(桩不合成子节点 innerHTML,故直接看该节点)
  assert.match(getEl('rp-label').textContent, /自定义日期/, '未选时应提示去选')
  // 只点了起点(待选终点)时给出进行中的反馈,而不是沉默
  ui.state.from = '2026-09-05'
  ui.renderRangeChip(null)
  assert.match(getEl('rp-label').textContent, /2026-09-05 ~ …/, '待选终点时要显示已记下的起点')
})

test('UI-6g: 只有一个端点时不得进入 custom(否则等于「全部」却点亮筛选红点)', () => {
  ui.state.range = 'all'
  ui.state.from = '2026-09-05'
  ui.state.to = ''
  ui.state.rpOpen = true
  ui.rpApply(true)
  assert.equal(ui.state.range, 'all', '单端点不得切成 custom')
  assert.equal(ui.state.rpOpen, true, '未提交就不该收起月历')
  // 两端齐了才真的切过去
  ui.state.to = '2026-09-10'
  ui.rpApply(true)
  assert.equal(ui.state.range, 'custom')
  assert.equal(ui.state.rpOpen, false)
})

test('UI-6h: 筛选计数只在自定义范围**两端齐备**时才 +1', () => {
  ui.state.models = []
  ui.state.session = ''
  ui.state.wd = ''
  ui.state.range = 'custom'
  ui.state.from = ''
  ui.state.to = ''
  assert.equal(ui.fCount(), 0, '空的 custom 不是一枚筛选(它和「全部」等价)')
  ui.state.from = '2026-09-01'
  ui.state.to = '2026-09-18'
  assert.equal(ui.fCount(), 1, '选好区间才算一枚筛选')
  ui.state.range = 'all'
  ui.state.from = ''
  ui.state.to = ''
  assert.equal(ui.fCount(), 0)
})

test('UI-6e: 选区间是一次连续动作 —— 第一下定起点且不发请求,第二下定终点才提交', () => {
  ui.state.range = 'custom'
  ui.state.from = ''
  ui.state.to = ''
  ui.state.rpOpen = true
  ui.state.kpiAct = null
  getEl('range-chip').dataset.kind = undefined
  ui.renderRangeChip(null)
  // 弹出层应渲染出定长 6×7 网格
  const days = (getEl('rangebox').innerHTML.match(/class="rp-day/g) || []).length
  assert.equal(days, 0, '假 DOM 无法 insertAdjacentHTML,这里只断言状态机')

  // 第一下:定起点,to 仍为空(不提交)
  ui.rpPickDay('2026-09-10')
  assert.equal(ui.state.from, '2026-09-10')
  assert.equal(ui.state.to, '', '第一下不得直接提交区间')

  // 第二下:定终点
  ui.rpPickDay('2026-09-15')
  assert.equal(ui.state.from, '2026-09-10')
  assert.equal(ui.state.to, '2026-09-15')
  assert.equal(ui.state.rpOpen, false, '选定后应收起月历')
})

test('UI-6f: 倒着选(先点晚的)自动纠正为较早者为起点', () => {
  ui.state.range = 'custom'
  ui.state.from = '2026-09-20'
  ui.state.to = ''
  ui.state.rpOpen = true
  ui.rpPickDay('2026-09-05')
  assert.equal(ui.state.from, '2026-09-05', '起点必须是较早的那个')
  assert.equal(ui.state.to, '2026-09-20')
})

// ---------------------------------------------------------------------------
// UI-6i:翻月/选日必须**原地刷新**,不得重建弹层节点
// ---------------------------------------------------------------------------
/**
 * 用户报的缺陷:"自定义日期点左右箭头无反馈,而且直接退出这个信息框了"。
 *
 * 根因是一条**只在这个控件里成立**的时序:document 上挂着"点空白处收起"的监听,
 * 判据是 `rangebox.contains(e.target)`。旧实现每次翻月都先 `removeChild` 掉整个弹层
 * 再插一份新的 —— 于是被点击的那颗箭头在**事件派发途中**就脱离了 DOM;等监听器
 * 轮到时 `e.target` 已是游离节点,`contains` 返回 false,"点在自己身上"被当成
 * "点在外面",弹层应声关闭。用户看到的就是毫无反馈 + 直接退出。
 *
 * 这条测试直接复现那条时序:按钮 handler 先跑(可能把节点摘掉),随后用**同一个**
 * 事件目标走 document 的收起判定。只要实现改回"重建节点",判定就会变成 false。
 */
test('UI-6i: 翻月不得重建弹层(否则 document 的"点空白处收起"会误关它)', () => {
  // 建模"弹层尚不存在":真实 DOM 里这些节点是 renderRangePop 第一次调用时插进去的
  absentIds.add('rp-pop'); absentIds.add('rp-m'); absentIds.add('rp-grid'); absentIds.add('rp-foot')
  absentIds.add('rp-prev'); absentIds.add('rp-next')
  els.delete('rp-pop'); els.delete('rp-m'); els.delete('rp-grid'); els.delete('rp-foot')
  els.delete('rp-prev'); els.delete('rp-next')
  // insertAdjacentHTML 在桩里是空操作 —— 这里让它真的把子节点"变出来"
  const box = getEl('rangebox')
  const hosted = new Set()
  box.contains = (node) => hosted.has(node)
  box.insertAdjacentHTML = () => {
    ['rp-pop', 'rp-m', 'rp-grid', 'rp-foot', 'rp-prev', 'rp-next'].forEach((id) => { hosted.add(createEl(id)) })
  }

  ui.state.range = 'custom'
  ui.state.from = ''
  ui.state.to = ''
  ui.state.rpOpen = true
  ui.rpView = null
  ui.renderRangePop()

  const pop = getEl('rp-pop')
  const prev = getEl('rp-prev')
  assert.ok(pop && prev, '展开后弹层与箭头应存在')
  // 旧实现会 removeChild 掉 pop(连带 prev);记录"是否被摘除"
  let popDetached = false
  pop.parentNode = { removeChild: () => { popDetached = true; hosted.delete(pop); hosted.delete(prev) } }

  // 点"下个月":按钮 handler 先跑,随后 document 监听用同一个事件对象判定
  const fakeEvent = { target: prev, stopPropagation() {} }
  getEl('rp-next').onclick(fakeEvent)
  const containsSawTarget = box.contains(fakeEvent.target)

  assert.equal(popDetached, false, '翻月不得摘除弹层 —— 摘除会让这次点击的目标变成游离节点')
  assert.equal(containsSawTarget, true,
    '翻月后 rangebox 仍必须"包含"事件目标,否则会被"点空白处收起"误关(这正是用户报的现象)')
  // 翻月本身要有反馈:月份文字必须真的前进
  assert.equal(getEl('rp-m').textContent, '2026 年 10 月', '翻月必须更新月份标题(否则"无反馈")')
})

test('UI-6j: 翻月状态在展开期间保持(不得被重置回起点所在月)', () => {
  ui.state.from = '2026-09-10'
  ui.state.to = ''
  ui.state.rpOpen = true
  ui.rpView = null
  ui.renderRangePop()
  assert.equal(getEl('rp-m').textContent, '2026 年 9 月', '初次展开跟随起点所在月')
  ui.rpShift(1)
  assert.equal(getEl('rp-m').textContent, '2026 年 10 月')
  ui.rpShift(1)
  assert.equal(getEl('rp-m').textContent, '2026 年 11 月', '连续翻月必须持续累加')
  ui.rpShift(-3)
  assert.equal(getEl('rp-m').textContent, '2026 年 8 月', '反向翻月同样生效')
  // 跨年边界
  ui.rpView = '2026-12'
  ui.rpShift(1)
  assert.equal(getEl('rp-m').textContent, '2027 年 1 月', '跨年必须进位')
})

test('UI-6k: 未选起点时脚部整块隐藏(不留一条空边框)', () => {
  ui.state.from = ''
  ui.state.to = ''
  ui.renderRangePop()
  assert.equal(getEl('rp-foot').hidden, true, '没有起点就没有可清除的范围,脚部不该显示')
  assert.doesNotMatch(getEl('rp-foot').innerHTML, /清除范围/)
  ui.state.from = '2026-09-10'
  ui.renderRangePop()
  assert.equal(getEl('rp-foot').hidden, false, '选了起点后应给出清除入口')
  assert.match(getEl('rp-foot').innerHTML, /清除范围/)
})

// ---------------------------------------------------------------------------
// UI-7:热力图色阶(hmScale)—— 稀疏数据不得被配出不存在的量级差
// ---------------------------------------------------------------------------
test('UI-7: 活跃日不足阈值时不套四分位,且最低档从 2 起(不伪造量级差)', () => {
  // 真实场景:整年只有 2 天有数据,一大一小
  const s = ui.hmScale([0, 0, 400_000_000, 0, 17_000_000, 0])
  assert.equal(s.kind, 'ratio', '样本太小时应走 ratio 分支')
  assert.equal(s.of(400_000_000), 4, '较大的那天进最高档')
  assert.ok(s.of(17_000_000) >= 2, '较小的那天也不得掉到最低档(否则像是"几乎没用")')
  assert.equal(s.of(0), 0, '没记录就是 0 档')
})

test('UI-7b: 所有活跃日等值时给均匀带,不伪造尖峰', () => {
  const s = ui.hmScale([100, 100, 100, 0])
  assert.equal(s.kind, 'flat')
  assert.equal(s.of(100), s.of(100), '等值必须同档')
  assert.equal(s.of(0), 0)
})

test('UI-7c: 样本充足时走四分位,且 levels 只声明够得到的档位', () => {
  // 12 个活跃日,值各不相同
  const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  const s = ui.hmScale(vals)
  assert.equal(s.kind, 'quantile')
  assert.ok(s.levels >= 3 && s.levels <= 4, `档位数应在 3~4,实际 ${s.levels}`)
  // 档位必须单调不减:值越大档位不得越低
  let prev = -1
  for (const v of vals) { const lv = s.of(v); assert.ok(lv >= prev, '档位必须随值单调不减'); prev = lv }
  assert.equal(s.of(12), 4, '最大值应落在最高档')
  assert.ok(s.of(1) >= 1, '最小值是活跃日,不得为 0 档')
})

test('UI-7d: 全空数据返回 empty 且不给任何档位', () => {
  const s = ui.hmScale([0, 0, 0])
  assert.equal(s.kind, 'empty')
  assert.equal(s.levels, 0, '没有数据就不该声明档位(图例也不该画)')
  assert.equal(s.of(0), 0)
})

test('UI-7e: 热力图渲染为月历网格(每月一块,自带星期表头与日期数字)', () => {
  ui.state.hmMetric = 'tokens'
  ui.state._heat = null
  const days = []
  for (let i = 0; i < 3; i++) {
    const d = new Date(Date.UTC(2026, 8, 16 + i))
    days.push({ day: d.toISOString().slice(0, 10), total: 1000 * (i + 1), requests: i + 1 })
  }
  ui.renderHeatmap(days)
  const out = getEl('heatmap').innerHTML
  assert.match(out, /class="hm-months"/, '应渲染为月历网格')
  assert.match(out, /role="grid"/, '应声明 grid 角色')
  assert.match(out, /class="hm-mtitle"/, '每月应有月份标题')
  assert.match(out, /class="hm-dow"/, '应有星期表头(月历自带,故不再需要左侧粘性列)')
  assert.match(out, /class="sr-only"/, '应有只读屏可见的说明')
  assert.match(out, /2026 年 9 月/, '应标出真实月份')
  // 格子必须写日期数字 —— 只画色块的话读者读不出"这是哪一天"
  const cells = out.match(/<button[^>]*class="hm-cell[^"]*"[^>]*>(\d+)<\/button>/g) || []
  assert.ok(cells.length >= 18, `9 月应有 30 个可点格子(截至今天),实际 ${cells.length}`)
  // 空格子不得用 --chip 填充(那是"一排灰方块"的根因)。
  // 必须查**样式源码**:--chip 只出现在 CSS 里,渲染出的 HTML 里是内联 rgba(…),
  // 查渲染结果会让这条断言恒真(变异测试实测过)。
  const cellRule = (PAGE_CSS.match(/\.hm-cell\{[^}]*\}/) || [''])[0]
  assert.ok(cellRule, '样式里应有 .hm-cell 规则')
  assert.match(cellRule, /background:transparent/, '空白天应透明(只留描边),不得填充')
  assert.doesNotMatch(cellRule, /var\(--chip\)/, '空格子不得用 --chip 填充(深色下就是一片灰砖)')
  // 旧版的粘性星期列必须有**不透明底色**,深色下就是七块灰砖 —— 结构里不该再有它
  assert.doesNotMatch(out, /<th class="wd"/, '不得再有粘性星期列(它带灰底,是灰砖的来源)')
})

test('UI-7e2: 窗口按"月"贴合数据,不铺满 12 个月', () => {
  // 3 天记录(都在本月)→ 只该画 1 块月历,而不是 12 块
  const days = ['2026-09-16', '2026-09-17', '2026-09-18'].map((d, i) => ({ day: d, total: 1000, requests: i + 1 }))
  ui.renderHeatmap(days)
  const out = getEl('heatmap').innerHTML
  const months = (out.match(/class="hm-mtitle"/g) || []).length
  assert.equal(months, 1, `3 天数据只该画 1 个月,实际 ${months}`)

  // 窗口右端永远对齐"今天所在月":数据从 2 年前开始也只画到 12 个月(上限)
  const old = []
  for (let i = 0; i < 1100; i++) {
    const d = new Date(Date.UTC(2024, 0, 1 + i))
    old.push({ day: d.toISOString().slice(0, 10), total: 1000, requests: 1 })
  }
  ui.renderHeatmap(old)
  const many = (getEl('heatmap').innerHTML.match(/class="hm-mtitle"/g) || []).length
  assert.equal(many, 12, `上限应为 12 个月,实际 ${many}`)
  // 最后一块必须落在"今天所在月",否则窗口会随时间漂走
  assert.match(getEl('heatmap').innerHTML, /2026 年 9 月/, '窗口右端必须对齐今天所在月')
})

test('UI-7e3: 未来的日子照常显示日期数字,但不得发按钮(键盘到不了、读屏不念)', () => {
  ui.renderHeatmap([{ day: '2026-09-18', total: 1000, requests: 1 }])
  const out = getEl('heatmap').innerHTML
  // 今天(09-18)之后的日子仍是日历上的一天 → 保留数字、压淡,但**不是按钮**
  const naChips = out.match(/<span class="hm-cell hm-na" aria-hidden="true">\d+<\/span>/g) || []
  assert.ok(naChips.length >= 10, `未来日子应是有数字但不发按钮的 span,实际 ${naChips.length}`)
  assert.doesNotMatch(out, /<button[^>]*hm-na/, 'NA 格子不得是按钮')
  // 真实格子必须是按钮(可交互、可聚焦),且今天之前的天数都是
  const realBtns = out.match(/<button[^>]*class="hm-cell/g) || []
  assert.equal(realBtns.length, 18, '9/1–9/18 共 18 个可选日子')
})

test('UI-7f: 热力图副标题必须陈述"几天有记录"与真实窗口宽', () => {
  ui.state.hmMetric = 'tokens'
  ui.renderHeatmap([{ day: '2026-09-17', total: 1000, requests: 1 }])
  const note = getEl('hm-note').textContent
  assert.match(note, /1 天有记录/, '必须报出活跃天数')
  // 窗口宽度必须来自实际数据,不能写死"12 个月" —— 只有 1 天记录时窗口就是本月
  assert.match(note, /本月/, '只有本月数据时应说"本月"')
  assert.doesNotMatch(note, /12 个月/, '不得写死 12 个月')
  // 跨多个月时改成"N 个月"
  const days = ['2026-07-10', '2026-08-10', '2026-09-10'].map((d) => ({ day: d, total: 1000, requests: 1 }))
  ui.renderHeatmap(days)
  assert.match(getEl('hm-note').textContent, /3 个月/, '跨 3 个月应报出 3 个月')
})

test('UI-7g: 无数据时给出可理解的空状态,而不是留下空白', () => {
  ui.renderHeatmap([])
  const out = getEl('heatmap').innerHTML
  assert.match(out, /暂无活跃记录/, '空状态文案要说清是什么没有')
  assert.equal(getEl('hm-note').textContent, '', '空状态不该再挂窗口说明')
})

test('UI-7h: 有数据的格子必须真的带上背景色(否则全图恒等于空白描边)', () => {
  ui.state.hmMetric = 'tokens'
  // 两天数据,一大一小 —— 走 ratio 分支
  ui.renderHeatmap([
    { day: '2026-09-17', total: 1000, requests: 1 },
    { day: '2026-09-18', total: 900000, requests: 2 },
  ])
  const out = getEl('heatmap').innerHTML
  // 每一个 data-l>0 的格子都必须同时带 background:rgba(...)
  const cells = out.split('<button').slice(1)
  let colored = 0
  for (const c of cells) {
    const mm = /data-l="(\d)"/.exec(c)
    if (!mm) continue
    const lv = Number(mm[1])
    if (lv > 0) {
      assert.match(c, /background:rgba\(/, `第 ${lv} 档的格子必须带背景色(否则与空格子无法区分)`)
      colored++
    } else {
      assert.match(c, /background:transparent/, '0 档格子应为透明(只留描边)')
    }
  }
  assert.ok(colored >= 2, `应有至少 2 个上色格子,实际 ${colored}`)
  /* 图例现在挂在**滚动容器外面**的 #hm-legend,所以两处分别取。
     正确的不变量是**单向**的:格子上出现的每一种颜色,图例里都必须有
     (否则读者看到一个无法查表的颜色)。
     反过来不成立、也不该成立 —— 图例是**色阶的钥匙**,描述的是"这套色阶有哪几档",
     某个具体数据集没用到中间某一档,不代表那一档不存在于色阶中。 */
  const legend = getEl('hm-legend').innerHTML
  const cellColors = new Set((out.match(/background:(rgba\([^)]+\))/g) || []).filter((c) => !/transparent/.test(c)))
  const legendColors = new Set((legend.match(/background:(rgba\([^)]+\))/g) || []))
  assert.ok(legendColors.size, '图例应有档位色块')
  for (const cc of cellColors) {
    assert.ok(legendColors.has(cc), `格子上的颜色 ${cc} 必须能在图例里查到(不得各说各话)`)
  }
})

test('UI-7j: 图例必须渲染在月历**外面**的独立宿主', () => {
  ui.renderHeatmap([{ day: '2026-09-18', total: 1000, requests: 1 }])
  // 渲染出的月历里不得夹带图例
  assert.doesNotMatch(getEl('heatmap').innerHTML, /hm-legend/, '图例不得混进月历里')
  assert.match(getEl('hm-legend').innerHTML, /hm-legend/, '图例应渲染到独立宿主')
})

test('UI-7i: 图例只画够得到的档位(不吹嘘全图到不了的档)', () => {
  ui.state.hmMetric = 'tokens'
  ui.renderHeatmap([{ day: '2026-09-18', total: 1000, requests: 1 }])
  const legend = getEl('hm-legend').innerHTML
  assert.match(legend, /hm-legend/, '应有图例')
  const swatches = (legend.match(/<i /g) || []).length
  // 单个活跃日走 flat 分支,reached=[3] → 0 档 + 3 档 = 2 个色块
  assert.equal(swatches, 2, `flat 分支只该画「无」+1 档,实际 ${swatches}`)
  // 两端是"少/多"两个刻度词,右端写出**真实峰值**而不是形容词
  assert.match(legend, /少/, '图例左端应写"少"')
  assert.match(legend, /多/, '图例右端应写"多"')
  assert.match(legend, /峰值/, '图例应报出峰值,读者才知道最深那格是多少')

  // ratio 分支的 L1 永远取不到(最低从 2 起)→ 图例不得出现第 1 档的透明度
  ui.renderHeatmap([
    { day: '2026-09-17', total: 1000, requests: 1 },
    { day: '2026-09-18', total: 900000, requests: 2 },
  ])
  const rl = getEl('hm-legend').innerHTML
  const alphas = (rl.match(/rgba\([^)]*,([\d.]+)\)/g) || [])
  // 浅色 L1 是 .30;ratio 分支取不到 L1,图例里就不该有它
  assert.ok(!alphas.some((a) => /,0\.3\)$/.test(a)), 'ratio 分支的不可达档位不得出现在图例里')
  assert.equal((rl.match(/<i /g) || []).length, 4, 'ratio 分支 reached=[2,3,4] + 0 档 = 4 个色块')
})

// ---------------------------------------------------------------------------
// UI-7k:月历的**排布单位**必须与数据窗口一致
// ---------------------------------------------------------------------------
test('UI-7k: 每月第一天的星期列必须正确(用前导空位对齐,不是靠运气)', () => {
  // 2026-09-01 是**周二** → 周一开头的一周里,前面应有 1 个空位
  ui.renderHeatmap([{ day: '2026-09-01', total: 1000, requests: 1 }])
  const out = getEl('heatmap').innerHTML
  const grid = /<div class="hm-mgrid">([\s\S]*?)<\/div>/.exec(out)
  assert.ok(grid, '应有月历网格')
  const seq = grid[1].match(/class="(hm-pad|hm-dow|hm-cell[^"]*)"/g) || []
  // 7 个星期表头,然后 1 个空位,然后"1"号
  const dows = seq.filter((s) => /hm-dow/.test(s)).length
  const pads = seq.filter((s) => /hm-pad/.test(s)).length
  assert.equal(dows, 7, '应有 7 个星期表头')
  assert.equal(pads, 1, '2026-09-01 是周二 → 周一开头应有 1 个前导空位')

  // 反例:2026-06-01 是周一 → 不该有空位(证明前导不是写死的 1)
  ui.renderHeatmap([{ day: '2026-06-01', total: 1000, requests: 1 }])
  const g2 = /<div class="hm-mgrid">([\s\S]*?)<\/div>/.exec(getEl('heatmap').innerHTML)
  const pads2 = ((g2 && g2[1].match(/hm-pad/g)) || []).length
  assert.equal(pads2, 0, '2026-06-01 是周一 → 不需要前导空位')
})

test('UI-7l: 每块月历的格子数等于该月天数(不造出 2/30 这种不存在的日期)', () => {
  ui.state.hmMetric = 'tokens'
  // 取"某一块月历"里的格子数。窗口右端恒为今天,所以 2 月的记录会画出 2 月..9 月
  // 好几块 —— 必须按块取,不能数整张图(那是测试自己的错,不是代码的)。
  // 计数按 `data-key`(真实日格子都有)或 hm-na(未来格子)两者之和,
  // **不按标签里的文字** —— 否则"忘了写日期数字"这种变异会让计数悄悄变少而漏判。
  const cellsOfMonth = (label) => {
    const out = getEl('heatmap').innerHTML
    const blocks = out.split('<div class="hm-month"')
    const blk = blocks.find((b) => b.includes('>' + label + '<'))
    assert.ok(blk, `应画出 ${label}`)
    const cells = (blk.match(/class="hm-cell[^"]*"/g) || []).length
    const pads = (blk.match(/class="hm-pad"/g) || []).length
    return { cells: cells, pads: pads }
  }
  const expectMonth = (label, days, pads, msg) => {
    const got = cellsOfMonth(label)
    assert.equal(got.cells, days, `${msg}:${label} 应有 ${days} 个日期格子,实际 ${got.cells}`)
    assert.equal(got.pads, pads, `${label} 的前导空位应为 ${pads}`)
  }

  // 2 月(平年 28 天)、4 月(30 天)、5 月(31 天)—— 最容易写错的就是月长。
  // 前导空位:2026-02-01 是周日 → 周一开头需 6 个空位;04-01 周三 → 2;05-01 周五 → 4。
  ui.renderHeatmap([{ day: '2026-02-10', total: 1000, requests: 1 }])
  expectMonth('2026 年 2 月', 28, 6, '平年 2 月')
  ui.renderHeatmap([{ day: '2026-04-10', total: 1000, requests: 1 }])
  expectMonth('2026 年 4 月', 30, 2, '4 月')
  expectMonth('2026 年 5 月', 31, 4, '5 月')
})

test('UI-7l2: 闰年 2 月必须有 29 格(靠 Date 进位,不是写死 28)', () => {
  ui.state.hmMetric = 'tokens'
  // 闰年必须把"今天"也挪到闰年附近,否则 2 月落在 12 个月窗口之外根本画不出来。
  // renderHeatmap 里的 todayKey 是渲染那一刻现算的,所以这里换掉沙箱的 Date 即可。
  const realDate = sandbox.Date
  const pinned = Date.parse('2028-06-15T12:00:00+08:00')
  class LeapDate extends Date {
    constructor(...args) { if (args.length === 0) super(pinned); else super(...args) }
    static now() { return pinned }
  }
  sandbox.Date = LeapDate
  try {
    ui.renderHeatmap([{ day: '2028-02-10', total: 1000, requests: 1 }])
    const out = getEl('heatmap').innerHTML
    const blocks = out.split('<div class="hm-month"')
    const feb = blocks.find((b) => b.includes('>2028 年 2 月<'))
    assert.ok(feb, '应画出 2028 年 2 月')
    const cells = (feb.match(/class="hm-cell[^"]*"/g) || []).length
    assert.equal(cells, 29, '2028 是闰年,2 月应是 29 天')
    assert.match(feb, />29</, '应真的有 29 号这一天')
    assert.doesNotMatch(feb, />30</, '2 月不该出现 30 号')
  } finally {
    sandbox.Date = realDate
  }
})

// ---------------------------------------------------------------------------
// UI-8:卡内「显示」分段的作用域契约
//
// 这些断言锁的是**绑定表与渲染读的字段名必须一致**。曾经这里有一个真 bug:
// bindSegs 写的是 state.hmMode,而渲染读 state.hmMetric —— 于是切「请求」时图片
// 一动不动,可按钮却亮了起来(因为 setSeg 按 data-* 属性同步选中态),看起来像是
// 生效了;下一次整页重渲染又按 hmMetric 重建,选中态自己跳回 Tokens。
// 只断言"渲染函数能按 state.hmMetric 画出图"是抓不到的 —— 必须从**绑定的那一端**
// 打进去,也就是走真实的 click 处理函数。
// ---------------------------------------------------------------------------
const BIND_HTML = readFileSync(join(root, 'web', 'index.html'), 'utf8')

/** 从页面源码里抠出 bindSegs 的表(而非运行它——分段控件在活动页里,要整页渲染) */
function segBindings() {
  const m = /var SEGS = \[([\s\S]*?)\n    \]/.exec(BIND_HTML)
  assert.ok(m, '页面应有 bindSegs 的 SEGS 表')
  const out = {}
  for (const row of m[1].split('\n')) {
    const id = /id: '([^']+)'/.exec(row)
    const key = /key: '([^']+)'/.exec(row)
    const attr = /attr: '([^']+)'/.exec(row)
    if (id && key && attr) out[id[1]] = { key: key[1], attr: attr[1] }
  }
  return out
}

test('UI-8: 每个卡内分段的绑定键名都必须是 state 上真实存在的字段', () => {
  const segs = segBindings()
  // 四个"显示"分段都要在表里
  for (const id of ['m-seg', 'g-seg', 'hour-seg', 'hm-seg']) {
    assert.ok(segs[id], `SEGS 表缺少 ${id}`)
    // 键名必须真实存在于 state 声明里,否则就是往一个隐式属性上写(渲染读的是另一个)
    assert.ok(ui.state[segs[id].key] !== undefined,
      `${id} 绑定的 state.${segs[id].key} 不存在于 state(笔误会静默变成死控件)`)
  }
  // 热力图那一段尤其要盯:它曾经写成 hmMode
  assert.equal(segs['hm-seg'].key, 'hmMetric', '热力图分段必须绑 hmMetric(渲染读的就是它)')
  assert.equal(segs['hour-seg'].key, 'hourMetric')
})

test('UI-8b: 两个「显示」分段的属性名不得撞车(否则同一段 HTML 两处语义)', () => {
  const segs = segBindings()
  const attrs = Object.values(segs).map((s) => s.attr)
  assert.equal(new Set(attrs).size, attrs.length,
    `四个分段必须用四个不同的 data-* 属性,实际 ${JSON.stringify(attrs)}`)
  // 24 小时与热力图原先都用 data-h
  assert.notEqual(segs['hour-seg'].attr, segs['hm-seg'].attr, 'hour/hm 不得共用 data-h')
})

test('UI-8c: 切「显示」指标不得重取整页数据(它只是换一列怎么画)', () => {
  const m = /var SEGS = \[([\s\S]*?)\n    \]/.exec(BIND_HTML)
  assert.ok(m)
  const table = m[1]
  const afterOf = (id) => {
    const row = new RegExp(`id: '${id}'[\\s\\S]*?after: function \\(\\) \\{([^}]*)\\}`).exec(table)
    assert.ok(row, `找不到 ${id} 的 after`)
    return row[1]
  }
  // metric / hourMetric / hmMetric 的数据都已到手,重画即可
  assert.doesNotMatch(afterOf('m-seg'), /loadTab/, 'metric 只影响趋势图,不得整页重取')
  assert.doesNotMatch(afterOf('hour-seg'), /loadTab/, 'hourMetric 不得整页重取')
  assert.doesNotMatch(afterOf('hm-seg'), /loadTab/, 'hmMetric 不得整页重取')
  // 粒度是服务端切桶,必须重取 —— 但只重取 series 一个端点
  assert.match(afterOf('g-seg'), /loadSeries/, 'granularity 需要重新取数')
  assert.doesNotMatch(afterOf('g-seg'), /loadTab/, 'granularity 不该拖另外四个端点')
})

test('UI-8g: 「刷新」必须刷新**当前页**,不得写死某个 tab', () => {
  // 这个按钮目前只住在「活动」页的 navbar 里,所以写死 'activity' 是**碰巧**对的
  // (点它时 state.tab 恒为 activity)。但那是巧合,不是不变量:一旦按钮被挪到或
  // 复制到「今天」/「会话」页,写死值就会"点了刷新,刷的却是另一个页面" ——
  // 不报错,只是数据不动。这里锁住它必须跟随 state.tab。
  const m = /else if \(act === 'refresh'\) \{([\s\S]*?)\n      \} else if/.exec(BIND_HTML)
  assert.ok(m, '应能找到 refresh 分支')
  const body = m[1]
  assert.match(body, /scanThenReload\(state\.tab\)/, '刷新必须用 state.tab(刷新当前页)')
  assert.doesNotMatch(body, /loadTab\('[a-z]+'\)/, '不得把 tab 写死为字面量')
})

test('UI-8g2: 「刷新」必须先重扫日志再取数(否则"刷新了却没变化")', () => {
  // 0.9.3 的语义变更:点「刷新」的意图是"给我最新的"。只重取聚合会把
  // "刚产生的请求还没被算进来"显示成"刷新了但数字没变" —— 用户的结论是
  // "这插件不刷新",而实际上是刷新了、只是没重扫。
  const m = /else if \(act === 'refresh'\) \{([\s\S]*?)\n      \} else if/.exec(BIND_HTML)
  assert.ok(m, '应能找到 refresh 分支')
  assert.match(m[1], /scanThenReload\(/, '刷新必须先扫日志(POST /scan)再取数')
  // 而且不能退回"只 loadTab"
  assert.doesNotMatch(m[1], /^\s*loadTab\(state\.tab\);$/m, '不得退回只重取聚合')
})

test('UI-8h: 提取出的 refresh onclick **真的执行一次**,必须按 state.tab 取数', async () => {
  // 比 UI-8g 更强:把产物里的 onclick 源码抠出来**真的跑一遍**,
  // 用替身 scanThenReload/state 观察它传了什么参数。
  // 若它是写死的 'activity',这里立刻看得见 —— 而不是靠正则猜。
  const m = /else if \(act === 'refresh'\) \{([\s\S]*?)\n      \} else if/.exec(BIND_HTML)
  assert.ok(m, '应能找到 refresh 分支')
  const onclick = /el\.onclick = (function \(\) \{[\s\S]*?\n        \});/.exec(m[1])
  assert.ok(onclick, 'refresh 分支里应有 el.onclick = function () {…}')

  const calls = []
  const el = { disabled: false }
  const toastCalls = []
  const spy = new Function('scanThenReload', 'state', 'toast', 'el',
    'return (' + onclick[1] + ');')(
    (t) => { calls.push(t); return Promise.resolve({ ok: true }) },
    { tab: 'sessions' }, (m2) => toastCalls.push(m2), el)
  spy()
  await new Promise((r) => setTimeout(r, 0))

  assert.deepEqual(calls, ['sessions'], `刷新必须按当前 tab 取数,实际取的是 ${JSON.stringify(calls)}`)
  assert.deepEqual(toastCalls, ['已刷新'], '扫描成功时报"已刷新"')
  assert.equal(el.disabled, false, '完成后必须恢复按钮可用(否则刷新一次就永久点不动)')
  // 换一个 tab 再跑,证明它跟随状态而不是恒定值
  calls.length = 0
  const el2 = { disabled: false }
  const spy2 = new Function('scanThenReload', 'state', 'toast', 'el',
    'return (' + onclick[1] + ');')(
    (t) => { calls.push(t); return Promise.resolve({ ok: true }) },
    { tab: 'today' }, () => {}, el2)
  spy2()
  await new Promise((r) => setTimeout(r, 0))
  assert.deepEqual(calls, ['today'], '换 tab 后刷新目标必须跟着变')
})

test('UI-8i: 扫描失败时「刷新」不得谎报成功(必须说出原因)', async () => {
  // 同源栅栏会拒绝域名反代下的 POST /scan。此时数据**确实没变**,
  // 而旧实现无条件 toast('已刷新')—— 用户看到"刷新成功"却发现数字不动,
  // 只能得出"这插件坏了"的结论。失败必须说出来。
  const m = /else if \(act === 'refresh'\) \{([\s\S]*?)\n      \} else if/.exec(BIND_HTML)
  const onclick = /el\.onclick = (function \(\) \{[\s\S]*?\n        \});/.exec(m[1])
  const toastCalls = []
  const el = { disabled: false }
  const spy = new Function('scanThenReload', 'state', 'toast', 'el', 'return (' + onclick[1] + ');')(
    () => Promise.resolve({ ok: false, error: 'HTTP 403' }),
    { tab: 'activity' }, (m2) => toastCalls.push(m2), el)
  spy()
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(toastCalls.length, 1)
  assert.match(toastCalls[0], /403/, `失败原因必须出现在提示里,实际是 ${JSON.stringify(toastCalls)}`)
  assert.doesNotMatch(toastCalls[0], /^已刷新$/, '不得无条件说"已刷新"')
  assert.equal(el.disabled, false, '失败也要恢复按钮可用')
})

test('UI-8d: 范围分段不再包含「自定义」(它是模式,不是第 7 个预设)', () => {
  // 静态骨架里的 #f-range 只能有 6 个预设
  const fRange = /<div class="seg" id="f-range"[\s\S]*?<\/div>/.exec(BIND_HTML)
  assert.ok(fRange, '应有 #f-range 分段')
  const rAttrs = (fRange[0].match(/data-r="([^"]+)"/g) || []).map((s) => /"([^"]+)"/.exec(s)[1])
  assert.equal(rAttrs.length, 6, `范围预设应为 6 个,实际 ${rAttrs.length}:${rAttrs}`)
  assert.ok(!rAttrs.includes('custom'), 'custom 不得再作为分段按钮出现')
  // 常驻的自定义入口由胶囊承载,且它必须在分段**外面**
  assert.match(BIND_HTML, /id="range-chip"/, '应有自定义胶囊容器')
})

test('UI-8e: 筛选红点只在自定义范围两端齐备时才亮', () => {
  const saved = { r: ui.state.range, f: ui.state.from, t: ui.state.to, m: ui.state.models, s: ui.state.session, w: ui.state.wd }
  try {
    ui.state.models = []; ui.state.session = ''; ui.state.wd = ''
    ui.state.range = 'custom'; ui.state.from = ''; ui.state.to = ''
    assert.equal(ui.fCount(), 0, '空 custom 与「全部」等价,不该亮红点')
    ui.state.from = '2026-09-01'; ui.state.to = '2026-09-18'
    assert.equal(ui.fCount(), 1)
  } finally {
    ui.state.range = saved.r; ui.state.from = saved.f; ui.state.to = saved.t
    ui.state.models = saved.m; ui.state.session = saved.s; ui.state.wd = saved.w
  }
})

test('UI-8f: 没有任何预设被选中时,分段滑块必须隐藏(不得停在上一格说谎)', () => {
  // range='custom' 时 #f-range 的 6 个预设没有一个匹配 —— 旧实现把滑块留在
  // 「全部」上,看起来"范围还是全部",而数据已经换成自定义区间。
  const seg = fakeEl('DIV')
  const thumb = fakeEl('SPAN')
  thumb.className = 'seg-thumb'
  seg.querySelector = (sel) => (sel === 'button.on' ? null : thumb)
  ui.segSync(seg)
  assert.ok(thumb.classList.contains('hide'), '没有选中项时滑块必须带 hide')
  // 对照:有选中项时不该 hide
  const seg2 = fakeEl('DIV')
  const thumb2 = fakeEl('SPAN')
  thumb2.className = 'seg-thumb'
  const onBtn = fakeEl('BUTTON')
  seg2.querySelector = (sel) => (sel === 'button.on' ? onBtn : thumb2)
  ui.segSync(seg2)
  assert.equal(thumb2.classList.contains('hide'), false, '有选中项时滑块必须显示')
})
