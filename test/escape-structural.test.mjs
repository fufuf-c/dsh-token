/**
 * dsh-token — **结构化转义**测试(0.9.4,node:test,零依赖)
 *
 * 这一组锁的是一件事:**数据到达 innerHTML 之前默认被转义**,而不是靠"每次都记得
 * 写 esc()"。此前本页 39 处 innerHTML 全靠纪律;纪律已经守住了(逐条核对过,
 * 包括 emptyHTML 内部对 title/sub 的转义),但**新增一处拼接就能悄悄破掉它**,
 * 且不会有任何报错。这里把那条性质变成可执行的断言。
 *
 * 覆盖三层:
 *   1. tpl`` 的语义(默认转义 / raw() 豁免 / 数组 / 拼接互操作 / 空值);
 *   2. 真实渲染函数(sessionRow / emptyHTML / renderFilterChips / 详情页)在
 *      **恶意输入**下不得产出可执行标签;
 *   3. 源码级守卫:innerHTML 赋值点里,凡是插值"数据标识符"的都必须出现
 *      esc( / html` / raw( 三者之一 —— 新增的裸拼接会被这里拦住。
 *
 * 测试手法沿用 page-render.test.mjs:把**真实产物** web/index.html 的内联脚本
 * 放进 vm 执行,注入取值垫片后直接调真实函数(函数体一行不改)。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
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

/** 取出 web/index.html 的内联脚本,在 IIFE 收尾前注入取值垫片 */
function loadPage() {
  const html = readFileSync(join(root, 'web/index.html'), 'utf8')
  const m = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(html)
  assert.ok(m, '页面应有内联脚本')
  let code = m[1]
  const tail = code.lastIndexOf('})();')
  assert.ok(tail > 0, '内联脚本应为 IIFE 收尾')
  code = code.slice(0, tail) +
    'globalThis.__esc = { tpl: tpl, raw: raw, esc: esc, isRaw: isRaw, wrapper: stringifyForHtml,' +
    ' sessionRow: sessionRow, emptyHTML: emptyHTML, sessTitle: sessTitle, sessSub: sessSub,' +
    ' renderFilterChips: renderFilterChips, state: state };\n' +
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
sandbox.addEventListener = () => {}
sandbox.removeEventListener = () => {}
sandbox.scrollTo = () => {}
sandbox.scrollY = 0
sandbox.devicePixelRatio = 1
sandbox.innerWidth = 1280
sandbox.innerHeight = 800
sandbox.clipboard = { writeText: async () => {} }
for (const g of ['URLSearchParams', 'URL', 'TextEncoder', 'TextDecoder', 'Blob', 'AbortController',
  'AbortSignal', 'Event', 'CustomEvent', 'Intl', 'encodeURIComponent', 'decodeURIComponent',
  'queueMicrotask', 'structuredClone', 'performance', 'Symbol']) {
  if (g in globalThis) sandbox[g] = globalThis[g]
}
vm.createContext(sandbox)
vm.runInContext(loadPage(), sandbox, { filename: 'web/index.html' })
const P = sandbox.__esc

const EVIL = '<img src=x onerror="globalThis.__pwned=1">'
const EVIL2 = '"><script>globalThis.__pwned=1</script>'
/**
 * tpl`` 返回的是**片段对象**(带 toString 的包装),这样嵌套时内层不会被二次转义。
 * 比较内容时统一转成字符串 —— 与真实使用一致(赋给 innerHTML / 参与 `+` 时,
 * JS 都会隐式调用 toString)。
 */
const S = (x) => String(x)

// ---------------------------------------------------------------------------
// 1. tpl`` 本身的语义
// ---------------------------------------------------------------------------
test('V65: tpl`` 默认转义 / raw() 显式豁免 / 嵌套不得二次转义', () => {
  const out = S(P.tpl`<b>${EVIL}</b>`)
  assert.doesNotMatch(out, /<img/, '不得原样插入标签')
  assert.match(out, /&lt;img/, '必须是转义后的实体')
  assert.equal(out, '<b>&lt;img src=x onerror=&quot;globalThis.__pwned=1&quot;&gt;</b>')
  // raw() 是唯一豁免通道
  assert.equal(S(P.tpl`<b>${P.raw('<i>ok</i>')}</b>`), '<b><i>ok</i></b>')
  assert.notEqual(S(P.tpl`<b>${'<i>ok</i>'}</b>`), '<b><i>ok</i></b>', '不加 raw 就必须被转义')
  // 嵌套不得二次转义(片段对象存在的理由)
  const outer = S(P.tpl`<b>${P.tpl`<i>${EVIL}</i>`}</b>`)
  assert.equal(outer, '<b><i>&lt;img src=x onerror=&quot;globalThis.__pwned=1&quot;&gt;</i></b>')
  assert.doesNotMatch(outer, /&amp;lt;/, '不得出现双重转义')
  // raw() 参与普通字符串拼接不得变成 [object Object]
  assert.equal('pre' + P.raw('<i>x</i>') + 'post', 'pre<i>x</i>post')
})

test('V65b: raw() 参与普通字符串拼接不得变成 [object Object]', () => {
  // 这是包装对象最容易踩的坑:`+` 会调 toString
  const s = 'pre' + P.raw('<i>x</i>') + 'post'
  assert.equal(s, 'pre<i>x</i>post')
  assert.doesNotMatch(s, /object Object/)
})

test('V65c: tpl``:数组按片段连接(常见于 .map(...).join 的替代写法)', () => {
  const out = S(P.tpl`${[EVIL, 'plain'].map((x) => P.tpl`<i>${x}</i>`)}`)
  assert.equal(out, '<i>&lt;img src=x onerror=&quot;globalThis.__pwned=1&quot;&gt;</i><i>plain</i>')
})

test('V65d: tpl``:数字 / null / undefined / 布尔 都不得产出 "null" 字样', () => {
  assert.equal(S(P.tpl`n=${42}`), 'n=42')
  assert.equal(S(P.tpl`[${null}]`), '[]')
  assert.equal(S(P.tpl`[${undefined}]`), '[]')
  // esc 的历史语义:null/undefined → 空串(不是 "null")
  assert.equal(P.esc(null), '')
  assert.equal(P.esc(undefined), '')
})

test('V65e: isRaw 只认 raw()/tpl` 的返回值', () => {
  assert.equal(P.isRaw(P.raw('x')), true)
  assert.equal(P.isRaw(P.tpl`<i>x</i>`), true, 'tpl`` 的片段同样是已转义内容')
  assert.equal(P.isRaw('x'), false)
  assert.equal(P.isRaw({ v: 'x' }), false, '手写的 {v:...} 不得被当成 raw')
  assert.equal(P.isRaw(null), false)
})

// ---------------------------------------------------------------------------
// 2. 真实渲染函数在恶意输入下的行为
// ---------------------------------------------------------------------------
test('V66: 恶意会话标题/工作目录/会话 id 不得产出可执行标签', () => {
  const row = S(P.sessionRow({
    id: EVIL2,
    totals: { miss: 1, read: 2, write: 0, out: 3, requests: 1, cost: 0.01 },
    lastTs: Date.now(),
    meta: { title: EVIL, cwd: 'C:\\proj\\' + EVIL2, id: EVIL2 },
  }))
  // 判据是"**未转义的**标签不得出现":恶意串以可见文本形式出现(其中当然含有
  // `onerror=` 这样的字面量)是正常的,不能据此判失败 —— 真正要拦住的是
  // 一个**能开标签**的 `<`。
  assert.doesNotMatch(row, /<img/, '标题里的 <img> 必须以实体出现,不得开标签')
  assert.doesNotMatch(row, /<script/i, 'cwd/id 里的 <script> 必须被转义')
  assert.match(row, /&lt;img src=x/, '应当看到转义后的可见文本')
  // 整行本身仍是合法的会话行按钮(没有被弄坏)
  assert.match(row, /^<button class="grow-row"/)
  assert.match(row, /<\/button>$/)
  // 自己产出的全部标签必须是我们预期的那些(白名单式收口)
  const tags = [...row.matchAll(/<([a-zA-Z][\w-]*)/g)].map((x) => x[1].toLowerCase())
  const allowed = new Set(['button', 'span', 'b', 'svg', 'path'])
  assert.deepEqual([...new Set(tags)].filter((t) => !allowed.has(t)), [], `出现了预期外的标签:${tags.join(',')}`)
})

test('V66c: sessionRow 正常输入仍渲染完整行结构', () => {
  const row = S(P.sessionRow({
    id: 'session-abc',
    totals: { miss: 10, read: 20, write: 0, out: 30, requests: 2, cost: 1.5 },
    lastTs: Date.now(),
    meta: { title: '修一个 bug', cwd: 'C:\\work\\myproj', id: 'session-abc' },
  }))
  assert.match(row, /修一个 bug/, '标题要出现')
  assert.match(row, /myproj/, '工作目录尾段要出现')
  assert.match(row, /data-id="session-abc"/)
  assert.match(row, /¥1\.50/)
})

test('V66d: sessionRow 大体量徽章仍然出现', () => {
  const row = S(P.sessionRow({
    id: 'session-hot',
    totals: { miss: 1e6, read: 2e6, write: 0, out: 5e5, requests: 9, cost: 3 },
    lastTs: Date.now(), meta: { id: 'session-hot', title: 'hot' },
  }))
  assert.match(row, /firebadge/, '请求数≥5 且总量≥2M 时必须有徽章')
})

test('V66b: emptyHTML 的 title/sub 都是转义过的(搜索词这条路)', () => {
  const out = S(P.emptyHTML(EVIL, EVIL2))
  assert.doesNotMatch(out, /<img/)
  assert.doesNotMatch(out, /<script/i)
  assert.equal(S(P.emptyHTML('a', 'b')), S(P.emptyHTML('a', 'b')), '同输入可复现')
  // 接受 raw():调用方可以自己拼好一段(例如 tpl`` 里混了文案与用户值)
  assert.match(S(P.emptyHTML(P.raw('<b>粗</b>'), 'x')), /<b>粗<\/b>/, 'raw 传入时不得被二次转义')
})

test('V66e: renderFilterChips 的模型名/目录/会话值都不得注入', () => {
  const st = P.state
  st.models = [EVIL]
  st.wd = EVIL2
  st.session = EVIL
  st.meta = { models: [EVIL] }
  P.renderFilterChips()
  const box = getEl('model-filter-chips')
  assert.doesNotMatch(box.innerHTML, /<img/, '模型名要转义')
  assert.doesNotMatch(box.innerHTML, /<script/i, 'wd/session 要转义')
})

// ---------------------------------------------------------------------------
// 3. 源码级守卫:裸拼接会被拦住
// ---------------------------------------------------------------------------
test('V64: innerHTML 赋值里的数据插值必须走 esc() / tpl` / raw() 三者之一', () => {
  const dir = join(root, 'web', 'src', 'app')
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'))
  // 已知安全的"值来源":纯格式化函数 → 只产出数字/¥/K/M/%,或本文件内的静态常量。
  // 这份白名单是**有意的**:它把"安全"写下来,新增一个不受信任的来源时会被抓住。
  const SAFE_CALL = /^(fmt\w+|pad2|String|Number|Math\.|JSON\.|tokTotal|trendVal|modelColor|cssVar|hexRgb|dotColor|lvColor|shortKey|trendLabel|dayKey|emptyHTML|sessionRow|esc|escUrl|peakDaysText|peakSummaryText|isRaw|raw|tpl)(\(|`|$|\.)/
  const SAFE_ID = new Set(['true', 'false', 'null', 'undefined', 'on', 'sel', 'cls', 'isSel', 'i', 'j', 'n', 'm', 'r', 'c', 'b', 'it', 's', 't', 'k', 'x', 'y', 'w', 'h', 'idx', 'html', 'chips', 'lh', 'sw', 'row', 'rows', 'parts', 'cells', 'list', 'items', 'MAX', 'MIN'])
  /** 去掉行注释与块注释 —— 否则注释里出现的标识符会被当成真实插值(误报)。 */
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  const offenders = []
  for (const f of files) {
    const lines = readFileSync(join(dir, f), 'utf8').split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (!/innerHTML|insertAdjacentHTML/.test(lines[i])) continue
      // 取整条赋值语句(可能跨行)
      let stmt = lines[i], j = i
      while (!/;\s*$/.test(stmt) && j < lines.length - 1 && j - i < 40) { j++; stmt += '\n' + lines[j] }
      const code = stripComments(stmt)
      // 该语句里出现的 `+ identifier` 或 `${identifier}` 插值。
      // 注意**必须先剔除** `tpl\`` / `raw(` 这类"本身就是安全通道"的调用形态:
      // 它们是插值的**包装器**,不是插值本身。
      const pushes = code.match(/\+\s*([A-Za-z_$][\w$.]*)/g) || []
      const interps = code.match(/\$\{\s*([A-Za-z_$][\w$.]*)/g) || []
      for (const rawTok of pushes.concat(interps)) {
        const id = rawTok.replace(/^[+$]\s*\{?\s*/, '').trim()
        const base = id.split('.')[0]
        if (SAFE_ID.has(id) || SAFE_ID.has(base)) continue
        if (SAFE_CALL.test(id) || SAFE_CALL.test(base)) continue
        // 该语句里只要出现过 esc( / tpl` / raw(,就认为这条语句是有意识处理的
        if (/\besc\(|\btpl`|\braw\(/.test(code)) continue
        offenders.push(`${f}:${i + 1}  ${id}   ${lines[i].trim().slice(0, 90)}`)
      }
    }
  }
  assert.deepEqual(offenders, [], `以下 innerHTML 插值既未转义也不在白名单内:\n${offenders.join('\n')}`)
})

test('V64b: web/src 的 innerHTML 使用点数量必须正常(页面没被搬走)', () => {
  const dir = join(root, 'web', 'src', 'app')
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'))
  let total = 0
  for (const f of files) {
    const src = readFileSync(join(dir, f), 'utf8')
    total += (src.match(/innerHTML/g) || []).length
  }
  // 数量只作为"页面没被搬走"的锚点;真正的判据是上一个测试
  assert.ok(total >= 30, `innerHTML 使用点数量异常(${total}),页面结构可能被大改`)
})
