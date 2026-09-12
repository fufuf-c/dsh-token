/**
 * dsh-token — 设置页单价表渲染测试(node:test,零依赖,无浏览器)
 *
 * web/index.html 是 2200+ 行内联 JS,此前只能靠肉眼看。这里把**真实源码**放进
 * vm 执行(IIFE 内注入一个取值垫片,函数体一行不改),再直接调 renderSettings(),
 * 断言单价表在各种 host 状态下的输出。
 *
 * 重点锁定两个易错点:
 *   1) 页面按 mtime 热更新、host 需重启 —— 两者会短暂不同步。此时 /api/config
 *      还没有 defaults 字段,页面**绝不能**把所有模型误报成"未定价";
 *   2) 高峰时段/两档价只是官方当前策略 —— 提示语不得把它写成"空闲 = 高峰 ÷ 2"
 *      这类恒等式,且时段必须可由用户改。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 足够宽的假元素:属性可读写,未知方法一律 no-op */
function fakeEl() {
  const t = {
    innerHTML: '', textContent: '', value: '', hidden: false,
    style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  }
  const el = new Proxy(t, {
    get(o, k) {
      if (k in o) return o[k]
      if (k === 'querySelectorAll') return () => []
      if (k === 'querySelector' || k === 'closest') return () => el
      if (k === 'appendChild' || k === 'insertBefore' || k === 'removeChild') return (x) => x
      if (k === 'cloneNode') return () => el
      if (k === 'getContext') return () => ctx2d
      return () => {}
    },
    set(o, k, v) { o[k] = v; return true },
  })
  return el
}
const ctx2d = new Proxy({}, {
  get: (o, k) => (k === 'canvas' ? fakeEl() : (k === 'measureText' ? () => ({ width: 10 }) : () => {})),
  set: () => true,
})

/** 取出 web/index.html 的内联脚本,在 IIFE 收尾前注入读取垫片 */
function loadPage() {
  const html = readFileSync(join(root, 'web/index.html'), 'utf8')
  const m = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(html)
  assert.ok(m, '页面应有内联脚本')
  let code = m[1]
  const tail = code.lastIndexOf('})();')
  assert.ok(tail > 0, '内联脚本应为 IIFE 收尾')
  // 仅注入取值语句,函数体保持不变
  code = code.slice(0, tail) +
    'globalThis.__page = { render: renderSettings, state: state, peakRangesOf: peakRangesOf, peakDaysText: peakDaysText, peakSummaryText: peakSummaryText };\n' +
    code.slice(tail)
  return code
}

const els = new Map()
const getEl = (id) => { if (!els.has(id)) els.set(id, fakeEl()); return els.get(id) }
const doc = {
  getElementById: getEl,
  querySelector: () => fakeEl(),
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  createElement: () => fakeEl(),
  hidden: true,
  body: fakeEl(), documentElement: fakeEl(), head: fakeEl(),
}
const sandbox = {
  document: doc,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  // boot() 挂在永不 resolve 的 fetch 上 —— 这样无需 mock 图表/canvas 等运行期依赖
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
// boot() 会同步用到一批 Web 标准全局;vm 上下文默认没有,按需透传真实实现
for (const g of ['URLSearchParams', 'URL', 'TextEncoder', 'TextDecoder', 'Blob', 'AbortController',
  'AbortSignal', 'Event', 'CustomEvent', 'Intl', 'encodeURIComponent', 'decodeURIComponent',
  'queueMicrotask', 'structuredClone', 'performance']) {
  if (g in globalThis) sandbox[g] = globalThis[g]
}
vm.createContext(sandbox)

const pageCode = loadPage()
// 页面是 IIFE + 立即 boot(),在 vm 里跑一次即可;垫片在收尾前把内部函数挂出来
vm.runInContext(pageCode, sandbox, { filename: 'web/index.html' })
const page = sandbox.__page

test('页面内联脚本可在 vm 中执行并暴露 renderSettings', () => {
  assert.equal(typeof page.render, 'function')
})

/** 用给定 meta/config 渲染设置页,返回 HTML */
function render(meta, config) {
  const st = page.state
  st.meta = meta
  st.config = config
  st.modelsAll = false
  st.tab = 'settings'
  page.render()
  return getEl('settings-body').innerHTML
}

// 真实形态:前三个配在 DSH 里(gmi 是"配置了但没有内置价"),
// 第四个既没配置也无内置价 —— 用于验证"不占配置表位"
const META = {
  models: [
    'deepseek-official:deepseek-flash',
    'deepseek-official:deepseek-v4-pro',
    'gmi:MiniMaxAI/MiniMax-M3',
    'openrouter:stealth/ox-alpha',
  ],
  configuredModels: {
    exact: ['deepseek-official:deepseek-flash', 'deepseek-official:deepseek-v4-pro', 'gmi:MiniMaxAI/MiniMax-M3'],
    byId: [],
  },
  stats: {}, sessionCount: 1, requestCount: 1, dayCount: 1, monthCount: 1, version: '0.5.0',
}
const DEFAULTS = {
  'deepseek-official:deepseek-flash': {
    key: 'deepseek-flash', label: 'x',
    peak: { miss: 2, hit: 0.04, write: 0, output: 8 },
    idle: { miss: 1, hit: 0.02, write: 0, output: 4 },
  },
  'deepseek-official:deepseek-v4-pro': {
    key: 'deepseek-pro', label: 'y',
    peak: { miss: 9, hit: 0.3, write: 0, output: 27 },
    idle: { miss: 4.5, hit: 0.15, write: 0, output: 13.5 },
  },
}
/** host 已升级时 /api/config 的完整形态 */
const SCHED = { hours: [[9, 12], [14, 18]], days: [1, 2, 3, 4, 5] }
const CFG = {
  prices: {}, defaults: DEFAULTS,
  schedule: SCHED, defaultsSchedule: SCHED,
  peakHours: '9-12, 14-18', peakDays: '1-5',
  defaultsPeakHours: '9-12, 14-18', defaultsPeakDays: '1-5',
}
const cfgWith = (over) => Object.assign({}, CFG, over)

// ---------------------------------------------------------------------------
// 提示语:必须在最上面,且不得把当前官方策略写成恒等式
// ---------------------------------------------------------------------------
test('提示语在模型单价界面最上面(所有价格行之前)', () => {
  const html = render(META, cfgWith({}))
  const hint = html.indexOf('高峰时段/高峰日只是当前官方策略')
  const firstRow = html.indexOf('class="prow"')
  assert.ok(hint >= 0, '应有提示语')
  assert.ok(firstRow >= 0, '应有价格行')
  assert.ok(hint < firstRow, '提示语必须排在价格行之前')
})

test('提示语不再硬编码"空闲 = 高峰 ÷ 2"之类的官方当前策略', () => {
  const html = render(META, cfgWith({}))
  assert.doesNotMatch(html, /÷\s*2/, '不得把倍率写死进文案')
  assert.doesNotMatch(html, /空闲\s*=\s*高峰/)
  assert.doesNotMatch(html, /09-12/, '时段由设置决定,不写死在提示里')
})

// ---------------------------------------------------------------------------
// 时段可配置:点选式(不是要用户手输 "9-12, 14-18")
// ---------------------------------------------------------------------------
/** 从渲染出的 HTML 里取出被选中的小时/星期 */
const onHours = (html) => [...html.matchAll(/data-h="(\d+)" class="on"/g)].map((m) => Number(m[1]));
// DOM 顺序是周一开头(一…日),比较前排序
const onDays = (html) => [...html.matchAll(/data-d="(\d+)" class="on"/g)].map((m) => Number(m[1])).sort((a, b) => a - b);

test('时段用点选控件:24 个小时格 + 7 个星期胶囊,不用输入框', () => {
  const html = render(META, cfgWith({}))
  assert.equal(onHours(html).length, 7, '默认高峰共 7 小时(9-12 + 14-18)')
  assert.deepEqual(onHours(html), [9, 10, 11, 14, 15, 16, 17], '默认时段落在 9-12、14-18')
  assert.deepEqual(onDays(html), [1, 2, 3, 4, 5], '默认高峰日为工作日')
  // 全量格子都在,便于任意点选
  assert.equal([...html.matchAll(/data-h="/g)].length, 24)
  assert.equal([...html.matchAll(/data-d="/g)].length, 7)
  // 不再要求手输格式,也不再需要"保存"
  assert.doesNotMatch(html, /id="b-peak-save"/, '点选即存,不该有保存按钮')
  assert.doesNotMatch(html, /placeholder="9-12, 14-18"/, '不该有需要手输格式的输入框')
})

test('点选控件按当前生效规则回填', () => {
  const html = render(META, cfgWith({ schedule: { hours: [[20, 23]], days: [0, 6] } }))
  assert.deepEqual(onHours(html), [20, 21, 22])
  assert.deepEqual(onDays(html), [0, 6])
})

test('没有高峰时段时全部格子熄灭', () => {
  const html = render(META, cfgWith({ schedule: { hours: [], days: [] } }))
  assert.deepEqual(onHours(html), [])
  assert.deepEqual(onDays(html), [])
})

test('有快捷预设(官方默认/全天/清空)', () => {
  const html = render(META, cfgWith({}))
  assert.match(html, /id="peak-preset-official"/)
  assert.match(html, /id="peak-preset-all"/)
  assert.match(html, /id="peak-preset-none"/)
})

test('host 未升级(连 defaults 都没有)时不显示时段设置', () => {
  const html = render(META, { prices: {} })
  assert.doesNotMatch(html, /id="peak-hours"/)
})

test('host 半升级(有 defaults 但没有 defaultsSchedule)时也不显示时段设置', () => {
  // 中间态:页面已热更新到新版,host 是只发 defaults 的旧版。
  // 此时若渲染控件,「官方默认」预设会读到 undefined 而变成清空 —— 必须整块隐藏。
  const html = render(META, { prices: {}, defaults: DEFAULTS })
  assert.doesNotMatch(html, /id="peak-hours"/)
  assert.doesNotMatch(html, /id="peak-days"/)
  assert.match(html, /class="ptag">高峰</, '价格表本身仍应正常渲染')
})

test('host 发得出 schedule 但没有 defaultsSchedule 时同样隐藏(避免预设误清)', () => {
  const html = render(META, cfgWith({ defaultsSchedule: undefined }))
  assert.doesNotMatch(html, /id="peak-preset-official"/, '拿不到官方默认值就不该给这个按钮')
  assert.doesNotMatch(html, /id="peak-hours"/)
})

// ---------------------------------------------------------------------------
// 点选 ↔ 区间的换算与摘要文案(直接测真实函数)
// ---------------------------------------------------------------------------
const { peakRangesOf, peakDaysText, peakSummaryText } = page
/** vm 里造出来的数组原型与宿主 realm 不同,deepStrictEqual 会因此失败 —— 先还原成宿主对象 */
const plain = (x) => JSON.parse(JSON.stringify(x))

/** [9,12] + [14,18] → 选中集合 */
const selOf = (ranges, days) => {
  const h = {}
  for (const [a, b] of ranges) for (let i = a; i < b; i++) h[i] = 1
  const d = {}
  for (const x of days) d[x] = 1
  return [h, d]
}

test('peakRangesOf:连续小时压成区间', () => {
  const [h] = selOf([[9, 12], [14, 18]], [])
  assert.deepEqual(plain(peakRangesOf(h)), [[9, 12], [14, 18]])
  assert.deepEqual(plain(peakRangesOf({})), [])
  assert.deepEqual(plain(peakRangesOf({ 0: 1, 23: 1 })), [[0, 1], [23, 24]], '不相邻不合并')
  assert.deepEqual(plain(peakRangesOf({ 0: 1, 1: 1, 2: 1, 3: 1 })), [[0, 4]])
})

test('peakDaysText:工作日/每天/自定义', () => {
  assert.equal(peakDaysText([1, 2, 3, 4, 5]), '工作日')
  assert.equal(peakDaysText([0, 1, 2, 3, 4, 5, 6]), '每天')
  assert.equal(peakDaysText([0, 6]), '周日、六')
  assert.equal(peakDaysText([]), '')
})

test('摘要把点选翻成人话,并给出每周小时数', () => {
  const [h, d] = selOf([[9, 12], [14, 18]], [1, 2, 3, 4, 5])
  const s = peakSummaryText(h, d)
  assert.match(s, /工作日/)
  assert.match(s, /09:00–12:00/)
  assert.match(s, /14:00–18:00/)
  assert.match(s, /每周 <b>35 小时<\/b>/, '7 小时 × 5 天')
})

test('全天预设的摘要为每天 168 小时', () => {
  const [h, d] = selOf([[0, 24]], [0, 1, 2, 3, 4, 5, 6])
  const s = peakSummaryText(h, d)
  assert.match(s, /每天/)
  assert.match(s, /每周 <b>168 小时<\/b>/)
})

test('没有高峰时摘要明确说明按空闲价计', () => {
  const s = peakSummaryText({}, {})
  assert.match(s, /没有高峰时段/)
  assert.match(s, /空闲价/)
})

// ---------------------------------------------------------------------------
// 两档价格各自独立
// ---------------------------------------------------------------------------
test('每个模型分高峰/空闲两行,占位符取各自的官方价', () => {
  const html = render(META, cfgWith({}))
  assert.match(html, /class="ptag">高峰</)
  assert.match(html, /class="ptag">空闲</)
  // 高峰未命中 2;空闲未命中 1
  assert.match(html, /data-t="peak" data-f="miss"[^>]*placeholder="2"/)
  assert.match(html, /data-t="idle" data-f="miss"[^>]*placeholder="1"/)
  // pro 档
  assert.match(html, /data-t="peak" data-f="miss"[^>]*placeholder="9"/)
  assert.match(html, /data-t="idle" data-f="miss"[^>]*placeholder="4\.5"/)
  // 写入官方恒为 0,两档各自显示 0
  assert.match(html, /data-t="peak" data-f="write"[^>]*placeholder="0"/)
  assert.match(html, /data-t="idle" data-f="write"[^>]*placeholder="0"/)
  assert.doesNotMatch(html, /placeholder="2 \/ 1"/, '不再用"高峰 / 空闲"合并占位')
})

test('自定义单价回填到对应档位', () => {
  const html = render(META, cfgWith({
    prices: {
      'deepseek-official:deepseek-flash': {
        peak: { miss: 5, hit: 1, write: 0, output: 10 },
        idle: { miss: 3, hit: 0.5, write: 0, output: 6 },
      },
    },
  }))
  assert.match(html, /自定义/)
  assert.match(html, /data-t="peak" data-f="miss"[^>]*value="5"/)
  assert.match(html, /data-t="idle" data-f="miss"[^>]*value="3"/)
  assert.match(html, /data-t="idle" data-f="output"[^>]*value="6"/)
})

// ---------------------------------------------------------------------------
// 降级:host 未升级时不得误报"未定价"
// ---------------------------------------------------------------------------
test('host 未升级(无 defaults 字段):退回"官方价",绝不误报未定价', () => {
  const html = render(META, { prices: {} })
  assert.doesNotMatch(html, /未定价/, '缺 defaults 字段是 host 未升级,不是模型没价')
  assert.match(html, /官方价/)
})

test('host 已升级但该模型确实无内置价:明确标注按 ¥0 计', () => {
  const html = render(META, cfgWith({}))
  assert.match(html, /未定价 · 按 ¥0 计/, 'gmi 配置了但无内置价,必须显式标注')
})

// ---------------------------------------------------------------------------
// 过滤
// ---------------------------------------------------------------------------
test('单价表按 DSH 配置过滤,并显示隐藏数量', () => {
  const html = render(META, cfgWith({}))
  assert.ok(!html.includes('openrouter:stealth/ox-alpha'), '未配置的模型默认不占位')
  assert.match(html, /已隐藏 1 个已不再配置的模型/)
  assert.match(html, /显示全部 \(4\)/)
})

test('读不到 DSH 配置时关闭过滤并说明,而不是清空列表', () => {
  const html = render({ ...META, configuredModels: null }, cfgWith({}))
  assert.match(html, /读不到 DSH 模型配置,已显示全部 4 个/)
  assert.ok(html.includes('openrouter:stealth/ox-alpha'), '降级时必须显示全部')
})
