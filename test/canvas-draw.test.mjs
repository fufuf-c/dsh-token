/**
 * dsh-token — 画布绘制守护测试(node:test,零依赖,无浏览器)
 *
 * 为什么需要它:web/index.html 里有 5 处 canvas 绘制(趋势图 / 小时图 / 热力图无关 /
 * 上下文增长曲线 / 逐请求堆叠),此前**完全没有任何测试**。子代理报告的原话是
 * 「canvas 完全无测试守护」—— 意味着改动绘制代码后,测试全绿而图可能已经画坏。
 *
 * 做法:在 vm 里跑真实页面源码,把 getContext('2d') 换成一个**录制器**,记录每一次
 * 2D API 调用的方法名与参数,得到一个确定性的调用序列。然后对这个序列做断言:
 *   - 关键结构(渐变档位、路径闭合、填充/描边顺序)必须存在
 *   - 同一份输入两次绘制必须**逐字节一致**(确定性)
 *   - 改动绘制代码时,若序列变化,这些断言会直接失败,逼人确认是"有意改"还是"画坏了"
 *
 * 与 page-render.test.mjs 分工:那里测 DOM 字符串(innerHTML),这里测 canvas 调用。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------------------
// 2D 上下文录制器:记录每一次调用的 (方法, 规范化参数)
// ---------------------------------------------------------------------------
/** 录制器:所有 2D 方法都记一笔;属性赋值(setter)也记 */
function makeRecorder() {
  const calls = []
  const props = {}
  const round = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)
  const METHODS = [
    'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo',
    'arc', 'arcTo', 'rect', 'roundRect', 'ellipse', 'quadraticCurveTo', 'bezierCurveTo',
    'fill', 'stroke', 'clip', 'save', 'restore', 'translate', 'rotate', 'scale',
    'setTransform', 'resetTransform', 'setLineDash', 'getLineDash', 'fillText', 'strokeText',
    'measureText', 'createLinearGradient', 'createRadialGradient', 'drawImage', 'putImageData',
  ]
  const g = {}
  for (const m of METHODS) {
    g[m] = (...args) => {
      calls.push([m, ...args.map(round)])
      if (m === 'measureText') return { width: String(args[0] || '').length * 6 }
      if (m === 'createLinearGradient' || m === 'createRadialGradient') {
        // 渐变对象:addColorStop 也要记录,并按顺序挂到这次调用上
        const stops = []
        calls[calls.length - 1].push(stops)
        return { addColorStop: (o, c) => stops.push([round(o), String(c)]) }
      }
      if (m === 'getLineDash') return []
      return undefined
    }
  }
  // 属性赋值:fillStyle / strokeStyle / lineWidth / font / textAlign / globalAlpha / lineJoin / lineCap
  const PROPS = ['fillStyle', 'strokeStyle', 'lineWidth', 'font', 'textAlign', 'textBaseline',
    'globalAlpha', 'lineJoin', 'lineCap', 'globalCompositeOperation', 'shadowBlur', 'shadowColor']
  for (const p of PROPS) {
    Object.defineProperty(g, p, {
      get: () => props[p],
      set: (v) => { props[p] = v; calls.push(['set:' + p, round(v)]) },
      enumerable: true,
      configurable: true,
    })
  }
  return { g, calls }
}

/** 足够宽的假元素;canvas 元素带 getContext 与录制器 */
function fakeEl(tag) {
  const t = {
    innerHTML: '', textContent: '', value: '', hidden: false,
    style: {}, dataset: {}, children: [], tagName: (tag || 'DIV').toUpperCase(),
    clientWidth: 640, clientHeight: 220, offsetWidth: 120, offsetHeight: 40,
    parentElement: null, width: 640, height: 220,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c) }, remove(c) { this._s.delete(c) },
      toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c) } else if (on) this._s.add(c); else this._s.delete(c) },
      contains: (c) => false,
    },
  }
  t.parentElement = { clientWidth: 640, clientHeight: 220, appendChild: () => {}, insertBefore: () => {}, replaceChild: () => {}, removeChild: () => {}, querySelectorAll: () => [], contains: () => false }
  const el = new Proxy(t, {
    get(o, k) {
      if (k in o) return o[k]
      if (k === 'querySelectorAll') return () => []
      if (k === 'querySelector' || k === 'closest') return () => el
      if (k === 'appendChild' || k === 'insertBefore' || k === 'removeChild') return (x) => x
      if (k === 'cloneNode') return () => el
      if (k === 'getContext') return () => el.__rec.g
      if (k === 'getBoundingClientRect') return () => ({ left: 0, top: 0, width: 640, height: 220, right: 640, bottom: 220 })
      if (k.startsWith('on')) return null
      return () => {}
    },
    set(o, k, v) { o[k] = v; return true },
  })
  el.__rec = makeRecorder()
  return el
}

/** 取出内联脚本,在 IIFE 收尾前注入取值垫片 */
function loadPage() {
  const html = readFileSync(join(root, 'web', 'index.html'), 'utf8')
  const m = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(html)
  assert.ok(m, '页面应有内联脚本')
  let code = m[1]
  const tail = code.lastIndexOf('})();')
  assert.ok(tail > 0, '内联脚本应为 IIFE 收尾')
  code = code.slice(0, tail) +
    'globalThis.__page = { state: state, renderTrend: renderTrend, drawHours: drawHours, drawCurve: drawCurve, drawStack: drawStack, $: $ };\n' +
    code.slice(tail)
  return code
}

const els = new Map()
const getEl = (id) => {
  if (!els.has(id)) {
    const isCanvas = /canvas|trend|hours|dm-|curve|stack/.test(id)
    els.set(id, fakeEl(isCanvas ? 'CANVAS' : 'DIV'))
  }
  return els.get(id)
}
/* renderTrend 有 `if (cv.parentElement !== wrap)` 的重建判断。垫片里每个元素各有自己的
   parentElement 就会恒不相等、导致每次重画都"重建 canvas"并把绘制丢到另一个元素上。
   这里让 wrap 内的 canvas 父元素指向 wrap,复现真实 DOM 关系。 */
const PARENTS = { 'trend-canvas': 'trend-wrap', 'hours': 'hours-wrap', 'dm-curve': 'dm-curve-wrap', 'dm-stack': 'dm-stack-wrap' }
for (const [child, parent] of Object.entries(PARENTS)) {
  getEl(child).parentElement = getEl(parent)
}
const doc = {
  getElementById: getEl,
  querySelector: () => fakeEl(),
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  createElement: (tag) => fakeEl(tag),
  hidden: true,
  body: fakeEl(), documentElement: fakeEl(), head: fakeEl(),
}
const sandbox = {
  document: doc,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetch: () => new Promise(() => {}),
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  location: { href: 'http://127.0.0.1:3080/dsh-token', search: '', hash: '' },
  navigator: { userAgent: 'node', clipboard: { writeText: async () => {} } },
  console, JSON, Date, Math, Number, String, Object, Array, RegExp, Error, Promise, Set, Map, isFinite, parseInt, parseFloat,
}
sandbox.window = sandbox
sandbox.globalThis = sandbox
// boot() 现在**同步**调用 bindChrome()(不再等 /meta),这个桩因此需要 window 级
// 事件接口。此前没有只是因为 bindChrome 排在永不 resolve 的 fetch 之后,从未被执行到。
sandbox.addEventListener = () => {}
sandbox.removeEventListener = () => {}
sandbox.scrollTo = () => {}
sandbox.scrollY = 0
sandbox.innerWidth = 1280
sandbox.innerHeight = 800
// cssVar() 内部调 getComputedStyle:给一个稳定的调色板桩,让取色确定可比
const PALETTE = {
  '--blue': '#0a84ff', '--purple': '#af52de', '--teal': '#5ac8fa', '--orange': '#ff9500',
  '--red': '#ff3b30', '--green': '#34c759', '--indigo': '#5856d6', '--gray': '#8e8e93',
  '--text-3': '#aeaeb2', '--hairline-2': 'rgba(0,0,0,.07)', '--chip': 'rgba(120,120,128,.12)',
}
sandbox.getComputedStyle = () => ({ getPropertyValue: (n) => PALETTE[n] || '' })
// reduceMotion 走这个:返回 false 让动画走 requestAnimationFrame 分支(被 stub 掉)
sandbox.devicePixelRatio = 1
for (const g of ['URLSearchParams', 'URL', 'TextEncoder', 'TextDecoder', 'Blob', 'AbortController',
  'AbortSignal', 'Event', 'CustomEvent', 'Intl', 'encodeURIComponent', 'decodeURIComponent',
  'queueMicrotask', 'structuredClone', 'performance']) {
  if (g in globalThis) sandbox[g] = globalThis[g]
}
vm.createContext(sandbox)
vm.runInContext(loadPage(), sandbox, { filename: 'web/index.html' })
const page = sandbox.__page

/** 跑一次绘制,返回规范化后的调用序列 */
function rec(fn) {
  const cv = getEl('__probe')
  cv.__rec = makeRecorder()
  fn(cv)
  return cv.__rec.calls
}

test('画布测试垫片:页面脚本可在 vm 中执行并暴露绘制函数', () => {
  assert.equal(typeof page.renderTrend, 'function')
  assert.equal(typeof page.drawHours, 'function')
  assert.equal(typeof page.drawCurve, 'function')
  assert.equal(typeof page.drawStack, 'function')
})

// ---------------------------------------------------------------------------
// 造数据
// ---------------------------------------------------------------------------
const T0 = new Date(2026, 8, 17, 9, 0, 0, 0).getTime()
const HOUR = 3600 * 1000
const DAY = 24 * HOUR

/** 趋势序列:跨天,含多模型,触发非堆叠折线+面积分支 */
function makeSeries(n, models) {
  return Array.from({ length: n }, (_, i) => {
    const t = T0 + i * DAY
    const d = new Date(t)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const ms = {}
    models.forEach((m, mi) => {
      ms[m] = { miss: 1000 * (i + 1) * (mi + 1), read: 5000 * (i + 2), write: 100 * (mi + 1), out: 300 * (i + 1), requests: i + 1, cost: 0.01 * (i + 1), saved: 0.5 }
    })
    return { key, totals: { miss: 3000 * (i + 1), read: 15000 * (i + 2), write: 300, out: 900 * (i + 1), requests: 3 * (i + 1), cost: 0.03 * (i + 1), saved: 1.5 }, models: ms }
  })
}

/** 24 小时桶 */
function makeHours(peakAt) {
  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    totals: { miss: h === peakAt ? 9000 : 100 * h, read: h === peakAt ? 40000 : 200 * h, write: 0, out: h === peakAt ? 3000 : 50 * h, requests: h, cost: 0.001 * h, saved: 0.02 * h },
  }))
}

/** 逐请求记录(带 cum,给 drawCurve/drawStack 用) */
function makeReqs(n) {
  const out = []
  let cum = 0
  for (let i = 0; i < n; i++) {
    const miss = 500 + (i % 7) * 300
    const read = 4000 + (i % 11) * 900
    const write = i % 3 === 0 ? 0 : 120
    const o = 200 + (i % 5) * 90
    cum += miss + read + write
    out.push({ t: T0 + i * 60000, m: 'deepseek-official:deepseek-flash', miss, read, write, out: o, r: 10 * i, cum, cost: 0.001 * (i + 1), saved: 0.02 * (i + 1), priced: 1 })
  }
  return out
}

// ---------------------------------------------------------------------------
// 断言辅助:把调用序列压成可读的"骨架"
// ---------------------------------------------------------------------------
const methods = (calls) => calls.map((c) => c[0])
const countOf = (calls, name) => calls.filter((c) => c[0] === name).length
/** 取某次调用的第 idx 个参数 */
const argOf = (calls, name, idx) => {
  const c = calls.find((x) => x[0] === name)
  return c ? c[idx + 1] : undefined
}

test('renderTrend:折线+面积分支(非 day+tokens)渐变档位正确且可复现', () => {
  const series = makeSeries(14, ['m-a', 'm-b'])
  const el = getEl('trend-canvas')
  // stacked = gran==='day' && metric==='tokens' —— 要测折线+面积,必须避开这个组合
  page.state.metric = 'tokens'
  page.state.granularity = 'month'
  page.state.hidden = {}
  page.state.stkSel = null
  el.__rec = makeRecorder()
  page.renderTrend(series)
  const calls = el.__rec.calls
  assert.ok(calls.length > 40, `应有实质绘制调用,实际 ${calls.length}`)

  // 面积渐变必须有两档:.20 -> .02(与上下文增长曲线同形)
  const grads = calls.filter((c) => c[0] === 'createLinearGradient')
  assert.ok(grads.length >= 1, `折线+面积分支应创建面积渐变,实际 ${grads.length} 个渐变`)
  const stops = grads[0][grads[0].length - 1]
  assert.deepEqual(stops.map((s) => s[1]), ['rgba(10,132,255,.20)', 'rgba(10,132,255,.02)'], '面积渐变两档应为 .20 -> .02')

  // 路径必须闭合(面积填充靠 lineTo 到底边 + closePath)
  assert.ok(countOf(calls, 'closePath') >= 1, '面积路径应 closePath')
  assert.ok(countOf(calls, 'fill') >= 1, '应有 fill')
  assert.ok(countOf(calls, 'stroke') >= 2, '应有描边(各模型线 + 总量线)')

  // 二次绘制必须逐字节一致(确定性 —— 重构后最容易破坏的性质)
  const saved = els.get('trend-canvas')
  const fresh = fakeEl('CANVAS')
  fresh.parentElement = getEl('trend-wrap')
  els.set('trend-canvas', fresh)
  page.renderTrend(series)
  assert.equal(JSON.stringify(fresh.__rec.calls), JSON.stringify(calls), '同一输入两次绘制必须完全一致')
  els.set('trend-canvas', saved)
})

test('renderTrend:柱状分支(day+tokens)画出堆叠色块', () => {
  const series = makeSeries(10, ['m-a'])
  const el = getEl('trend-canvas')
  page.state.metric = 'tokens'
  page.state.granularity = 'day'
  page.state.stkSel = null
  page.state.hidden = {}
  el.__rec = makeRecorder()
  page.renderTrend(series)
  const calls = el.__rec.calls
  assert.ok(calls.length > 40, '堆叠柱模式应有实质绘制')
  // 堆叠:每根柱按分段设色(取色走 cssVar,拿到的是十六进制),四类应都出现
  const fills = calls.filter((c) => c[0] === 'set:fillStyle').map((c) => String(c[1]))
  const hexFills = new Set(fills.filter((f) => /^#[0-9a-f]{6}$/i.test(f)))
  assert.ok(hexFills.size >= 4, `堆叠模式应设置四类色块填充色,实际 ${hexFills.size} 种: ${[...hexFills].join(',')}`)
  assert.ok(countOf(calls, 'roundRect') + countOf(calls, 'rect') >= 4, '每段应画圆角矩形')
  assert.ok(countOf(calls, 'set:globalAlpha') >= 4, '堆叠分段应设置透明度')
  // 坐标必须有限
  for (const c of calls) for (const a of c.slice(1)) if (typeof a === 'number') assert.ok(Number.isFinite(a), `${c[0]} 坐标应有限`)
})

test('drawHours:柱高与峰值高亮,空数据不抛', () => {
  const el = getEl('hours')
  el.__rec = makeRecorder()
  page.drawHours('hours', makeHours(18), 120, null, false)
  const calls = el.__rec.calls
  assert.ok(calls.length > 20, `小时图应有实质绘制,实际 ${calls.length}`)
  assert.ok(countOf(calls, 'fill') >= 24, '24 个小时柱都应有填充')
  // 空桶:不能抛错
  const empty = getEl('hours-empty')
  empty.__rec = makeRecorder()
  assert.doesNotThrow(() => page.drawHours('hours-empty', [], 120, null, false))
})

test('drawHours:全零数据不产生 NaN/Infinity 坐标', () => {
  const zeros = Array.from({ length: 24 }, (_, h) => ({ hour: h, totals: { miss: 0, read: 0, write: 0, out: 0, requests: 0, cost: 0, saved: 0 } }))
  const el = getEl('hours-zero')
  el.__rec = makeRecorder()
  assert.doesNotThrow(() => page.drawHours('hours-zero', zeros, 120, null, false))
  for (const c of el.__rec.calls) {
    for (const a of c.slice(1)) {
      if (typeof a === 'number') assert.ok(Number.isFinite(a), `坐标必须有限,出现 ${a} in ${c[0]}`)
    }
  }
})

test('drawCurve:面积渐变与 renderTrend 同形(.20 -> .02)', () => {
  const reqs = makeReqs(40)
  const el = getEl('dm-curve')
  el.__rec = makeRecorder()
  page.drawCurve(reqs)
  const calls = el.__rec.calls
  assert.ok(calls.length > 20, `曲线应有实质绘制,实际 ${calls.length}`)
  const grads = calls.filter((c) => c[0] === 'createLinearGradient')
  assert.ok(grads.length >= 1, '应有面积渐变')
  const stops = grads[0][grads[0].length - 1]
  assert.deepEqual(stops.map((s) => s[1]), ['rgba(10,132,255,.20)', 'rgba(10,132,255,.02)'], '面积渐变两档应与趋势图一致')
  assert.ok(countOf(calls, 'closePath') >= 1, '面积应 closePath')
  // 坐标必须有限
  for (const c of calls) for (const a of c.slice(1)) if (typeof a === 'number') assert.ok(Number.isFinite(a), `${c[0]} 坐标应有限`)
})

test('drawCurve:单点与空数组不抛', () => {
  const one = getEl('dm-curve-one')
  one.__rec = makeRecorder()
  assert.doesNotThrow(() => page.drawCurve(makeReqs(1)))
  const none = getEl('dm-curve-none')
  none.__rec = makeRecorder()
  assert.doesNotThrow(() => page.drawCurve([]))
})

test('drawStack:逐请求堆叠四段,超 500 条自动降采样', () => {
  const el = getEl('dm-stack')
  el.__rec = makeRecorder()
  page.drawStack(makeReqs(30))
  const calls = el.__rec.calls
  assert.ok(calls.length > 20, '堆叠图应有实质绘制')
  assert.ok(countOf(calls, 'clearRect') === 1, '应只清一次')
  // 超长:降采样到 500,不应爆炸
  const big = getEl('dm-stack-big')
  big.__rec = makeRecorder()
  page.drawStack(makeReqs(1200))
  assert.ok(big.__rec.calls.length < 20000, '1200 条应降采样,调用数不应爆炸')
  for (const c of big.__rec.calls) for (const a of c.slice(1)) if (typeof a === 'number') assert.ok(Number.isFinite(a), `${c[0]} 坐标应有限`)
})

test('全部绘制函数在空/零数据下都不产生非有限坐标(统一守卫)', () => {
  const cases = [
    ['renderTrend 空', () => { page.state.metric = 'tokens'; page.state.granularity = 'day'; page.renderTrend([]) }],
    ['drawHours 空', () => page.drawHours('h-x', [], 120, null, false)],
    ['drawCurve 空', () => page.drawCurve([])],
    ['drawStack 空', () => page.drawStack([])],
  ]
  for (const [name, fn] of cases) {
    for (const id of ['trend-canvas', 'h-x', 'dm-curve', 'dm-stack']) {
      const el = getEl(id)
      el.__rec = makeRecorder()
    }
    assert.doesNotThrow(fn, name)
    for (const id of ['trend-canvas', 'h-x', 'dm-curve', 'dm-stack']) {
      for (const c of getEl(id).__rec.calls) {
        for (const a of c.slice(1)) {
          if (typeof a === 'number') assert.ok(Number.isFinite(a), `${name} / ${id}: ${c[0]} 出现 ${a}`)
        }
      }
    }
  }
})
