/**
 * dsh-token — Client bundle 契约测试(零依赖,无浏览器)
 *
 * 用最小的 __ModuleLoader__ / document / React / slots / locale 桩件装载
 * lib/client.js,锁定它与 DSH 0.1.5 客户端运行时的接口:
 *   - 注册 id 必须等于包名(运行时按包名匹配工厂与回收 <style data-plugin>);
 *   - factory(require) 返回 { inject, apply },inject 含 slots + locale;
 *   - 三个插槽的 name / 槽位类型需要的 id / order / label(函数)契约;
 *   - locale 命名空间 register 与 bind 共用同一字符串;
 *   - slots 缺席时静默降级,不抛错。
 *
 * 另外锁定两个入口的**定位差异**(侧边栏=全量仪表盘,会话内=本会话用量):
 *   - 两者标签必须不同,否则用户分不清点哪个;
 *   - 会话内面板必须是原生渲染,而不是把整张全局仪表盘塞进 iframe
 *     再靠 ?session= 筛选将就。
 *
 * 参照物是 DSH 自带的 dsh-client-ui-cordis 与第三方 dsh-context 的
 * 现行写法(label 为函数、list 槽位必须带 id)。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const PKG_NAME = '@fufuf-c/dsh-token'

/**
 * createElement 必须像真 React 一样把 children 也放进 props —— 否则函数组件
 * (Btn / Chip / 图标)拿不到 children,展开后的树就丢了文字。
 */
function makeCreateElement() {
  return (type, props, ...children) => {
    const p = Object.assign({}, props || {})
    p.children = children.length <= 1 ? children[0] : children
    return { $$typeof: 'element', type, props: p, children }
  }
}

/** 最小 React 桩件:只够"组件不抛错"的契约检查 */
const MINIMAL_REACT = {
  createElement: makeCreateElement(),
  useState: (v) => [v, () => {}],
  useEffect: () => {},
  useRef: (v) => ({ current: v }),
  useCallback: (fn) => fn,
}

/**
 * 可重入的 hooks 桩件:状态持久,useEffect 手动触发 —— 这样能跑出
 * "加载中 → 数据到达 → 渲染完成"两帧,真正检查面板渲染出的树。
 */
function makeHookHarness() {
  const states = []
  const refs = []
  let si = 0, ri = 0, effects = []
  return {
    React: {
      createElement: makeCreateElement(),
      useState: (v) => { const k = si++; if (!(k in states)) states[k] = v; return [states[k], (x) => { states[k] = x }] },
      useRef: (v) => { const k = ri++; if (!(k in refs)) refs[k] = { current: v }; return refs[k] },
      useCallback: (fn) => fn,
      useEffect: (fn) => { effects.push(fn) },
    },
    beginRender() { si = 0; ri = 0; effects = [] },
    runEffects() { const e = effects; effects = []; e.forEach((f) => f()) },
  }
}

/** 装载 client bundle,返回 { registration, mod, styleTags, required }。
 *  require 只认平台种子模块 `react` —— 本插件不 require DSH 的内部包,
 *  任何多出来的 specifier 都会让这里抛错(契约测试)。 */
async function loadClientBundle(reactImpl = MINIMAL_REACT, opts = {}) {
  const styleTags = []
  const allTags = []
  const makeEl = (tag) => {
    const attrs = new Map()
    const el = {
      tagName: String(tag).toUpperCase(),
      textContent: '',
      setAttribute(k, v) { attrs.set(String(k), String(v)) },
      getAttribute(k) { return attrs.has(String(k)) ? attrs.get(String(k)) : null },
      attrs,
    }
    // dataset 是属性的代理:官方插件写 dataset.plugin,老写法写 setAttribute
    el.dataset = new Proxy({}, {
      set(_, k, v) { attrs.set(`data-${String(k).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, String(v)); return true },
      get(_, k) { return attrs.get(`data-${String(k).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`) },
    })
    return el
  }
  const doc = {
    createElement: (tag) => { const el = makeEl(tag); if (el.tagName === 'STYLE') styleTags.push(el); allTags.push(el); return el },
    head: { appendChild: () => {} },
    querySelector: () => null,
    querySelectorAll: () => [],
  }
  let registration = null
  globalThis.document = doc
  // localStorage:面板用它**同步**读取「进入界面时先扫一次」开关(见 lib/client.js 的
  // refreshOnOpen)。测试必须能控制它,否则"关掉开关"这条路径根本跑不到。
  const store = new Map(Object.entries(opts.localStorage || {}))
  globalThis.window = {
    __ModuleLoader__: { load: (reg) => { registration = reg } },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  }
  // 每次测试用唯一 query,绕过 ESM 模块缓存
  await import(`../lib/client.js?t=${Date.now()}${Math.random()}`)
  assert.ok(registration, 'client.js 必须调用 window.__ModuleLoader__.load')
  const seen = []
  const require = (spec) => {
    seen.push(spec)
    if (spec === 'react') return reactImpl
    throw new Error(`unexpected require("${spec}") — client bundle 只允许平台种子模块`)
  }
  const mod = registration.factory(require)
  return { registration, mod, styleTags, required: seen }
}

/** 记录调用参数的 slots / locale 桩件。 */
function fakeClientCtx({ withSlots = true, withLocale = true } = {}) {
  const injected = []
  const registered = []
  const localeCalls = { register: [], bind: [] }
  const effects = []
  const slots = {
    inject: (name, factory) => { injected.push(name); factory() },
    register: (descriptor, component) => { registered.push({ descriptor, component }); return () => {} },
  }
  const locale = {
    register: (ns, dicts) => { localeCalls.register.push({ ns, dicts }); return () => {} },
    bind: (ns) => { localeCalls.bind.push(ns); return (k) => `t:${k}` },
  }
  const ctx = {
    get: (name) => {
      if (name === 'slots') return withSlots ? slots : undefined
      if (name === 'locale') return withLocale ? locale : undefined
      return undefined
    },
    effect: (fn) => { const d = fn(); effects.push(d); return () => {} },
  }
  return { ctx, injected, registered, localeCalls, effects }
}

test('client bundle: 注册 id 为包名,并导出 inject/apply', async () => {
  const { registration, mod, required } = await loadClientBundle()
  assert.equal(registration.id, PKG_NAME, '注册 id 必须与包名一致(client-modules 按包名匹配工厂)')
  assert.equal(typeof registration.factory, 'function')
  assert.equal(typeof mod.apply, 'function')
  assert.ok(Array.isArray(mod.inject), '必须导出 inject 数组')
  assert.ok(mod.inject.includes('slots'), 'slots 是硬依赖')
  assert.ok(mod.inject.includes('locale'), 'locale 是硬依赖')
  // 零第三方依赖:只 require 平台种子模块 react(不依赖 DSH 内部包,
  // DSH 改内部导出时本插件不受影响)
  assert.deepEqual(required, ['react'], '只允许 require 平台种子模块 react')
})

test('client bundle: apply 注册四个官方插槽,细节符合 0.1.5 契约', async () => {
  const { mod } = await loadClientBundle()
  const { ctx, injected, registered, localeCalls } = fakeClientCtx()
  mod.apply(ctx)

  assert.deepEqual(injected.sort(), ['conversation.view', 'main', 'settings.section', 'sidebar.panellist'])

  const byName = Object.fromEntries(registered.map((r) => [r.descriptor.name, r]))
  assert.equal(registered.length, 4)

  // list / single 槽位在运行时强制要求 options.id,缺失会直接抛错
  for (const name of ['sidebar.panellist', 'conversation.view', 'settings.section']) {
    const r = byName[name]
    assert.ok(r, `必须注册 ${name}`)
    assert.equal(r.descriptor.id, 'dsh-token', `${name} 必须带 id(list 槽位契约)`)
    assert.equal(typeof r.descriptor.order, 'number', `${name} 需要 order 排序`)
    // label 由 resolveSlotLabel 解析:函数或字符串都合法,函数才能跟随语言切换
    assert.equal(typeof r.descriptor.label, 'function', `${name} 的 label 应为函数`)
    assert.equal(typeof r.descriptor.label(), 'string')
    assert.equal(r.descriptor.locale, 'dsh-token', `${name} 应声明 locale 命名空间`)
    assert.equal(typeof r.component, 'function', `${name} 的组件必须是可被 React 渲染的函数`)
  }
  // `main` 是 keyed 槽:它按 key 寻址,没有 id/order/label(sidebar.panellist 的 id
  // 必须与它相等,否则图标位点了没有面板可切 —— 见下一条测试)
  assert.equal(byName.main.descriptor.key, 'dsh-token', 'main 面板的 key')
  assert.equal(byName.main.descriptor.id, undefined, 'keyed 槽不写 id')
  assert.equal(typeof byName.main.component, 'function')
  // 每个组件都不得在渲染前就抛错(取一个最简 props)
  for (const { descriptor, component } of registered) {
    assert.doesNotThrow(() => component({ wide: true, sessionId: 'session-x' }), `${descriptor.name} 组件不应抛错`)
  }
})

test('client bundle: 图标位 id 必须与 main 面板 key 相等(否则点了没有面板可切)', async () => {
  const { mod } = await loadClientBundle()
  const { ctx, registered } = fakeClientCtx()
  mod.apply(ctx)
  const entry = registered.find((r) => r.descriptor.name === 'sidebar.panellist')
  const panel = registered.find((r) => r.descriptor.name === 'main')
  // MainPanel 按 activePanelId 作为 entryKey 去 `main` 里找注册项;而 selectPanel 会用
  // sidebar.panellist 的 id 当 panelId。两者不等 → 点图标后中央区域是空白。
  assert.equal(String(entry.descriptor.id), String(panel.descriptor.key),
    'sidebar.panellist 的 id 必须等于 main 的 key')
})

test('client bundle: 侧边栏入口不得再注册到 sidebar.footer.action(那是与别的插件并排的半宽行)', async () => {
  const { mod } = await loadClientBundle()
  const { ctx, injected } = fakeClientCtx()
  mod.apply(ctx)
  assert.ok(!injected.includes('sidebar.footer.action'),
    'footer.action 是外壳的不换行 flex 行:两个 width:100% 的入口会各占一半、挤在一起')
})

test('client bundle: locale 命名空间 register / bind / 描述符三者一致', async () => {
  const { mod } = await loadClientBundle()
  const { ctx, registered, localeCalls } = fakeClientCtx()
  mod.apply(ctx)

  assert.equal(localeCalls.register.length, 1)
  const { ns, dicts } = localeCalls.register[0]
  assert.equal(ns, 'dsh-token')
  // 内置语言是 ["zh","en"],注册要求双向字典齐全且键集一致
  assert.deepEqual(Object.keys(dicts).sort(), ['en', 'zh'])
  assert.deepEqual(Object.keys(dicts.zh).sort(), Object.keys(dicts.en).sort(), 'zh/en 键集必须一致')
  assert.deepEqual(localeCalls.bind, ['dsh-token'], 'bind 必须用同一命名空间')
  // 带 label 的入口必须声明同一个命名空间。`main` 是 keyed 面板槽:它没有 label,
  // 也就没有 locale 可言(给它挂一个反而是错的)。
  for (const { descriptor } of registered) {
    if (descriptor.label === undefined) continue
    assert.equal(descriptor.locale, ns)
  }
  // 标签走各自的 translate key
  assert.equal(registered.find((r) => r.descriptor.name === 'conversation.view').descriptor.label(), 't:session')
  assert.equal(registered.find((r) => r.descriptor.name === 'sidebar.panellist').descriptor.label(), 't:tab')
})

test('client bundle: 侧边栏与会话内入口的标签必须不同(否则用户分不清)', async () => {
  const { mod } = await loadClientBundle()
  const { ctx, registered } = fakeClientCtx({ withLocale: false })
  mod.apply(ctx)
  const labelOf = (n) => registered.find((r) => r.descriptor.name === n).descriptor.label()
  assert.equal(labelOf('sidebar.panellist'), 'Token 统计')
  assert.equal(labelOf('conversation.view'), '本会话用量', '会话内入口应表明只服务当前对话')
  assert.notEqual(labelOf('sidebar.panellist'), labelOf('conversation.view'), '两个入口名字不得相同')
})

test('client bundle: slots 缺席时静默降级(不抛错、不注册)', async () => {
  const { mod } = await loadClientBundle()
  const { ctx, registered, injected } = fakeClientCtx({ withSlots: false })
  assert.doesNotThrow(() => mod.apply(ctx))
  assert.equal(registered.length, 0)
  assert.equal(injected.length, 0)
})

test('client bundle: locale 缺席时仍注册,标签回退硬编码', async () => {
  const { mod } = await loadClientBundle()
  const { ctx, registered, localeCalls } = fakeClientCtx({ withLocale: false })
  assert.doesNotThrow(() => mod.apply(ctx))
  assert.equal(registered.length, 4)
  assert.equal(localeCalls.register.length, 0)
  assert.equal(registered.find((r) => r.descriptor.name === 'conversation.view').descriptor.label(), '本会话用量')
})

test('client bundle: 样式标签带 data-plugin 归属包名(供运行时认领/回收)', async () => {
  const { styleTags } = await loadClientBundle()
  assert.ok(styleTags.length >= 1, 'client bundle 必须注入自己的样式标签')
  // claimStyles() 认领无标签的 <style> 并按 data-plugin 归属;data-plugin-css 可选
  assert.equal(styleTags[0].getAttribute('data-plugin'), PKG_NAME)
  assert.ok(String(styleTags[0].textContent).includes('.dtk-frame'),
    '样式内容应为全局面板的嵌入帧样式')
})

// ---------------------------------------------------------------------------
// 会话内「本会话用量」面板:原生渲染,只读当前会话
// ---------------------------------------------------------------------------
/** 把渲染树摊平成元素列表(children 可能层层套数组) */
function walk(node, out = []) {
  if (node === null || node === undefined) return out
  if (Array.isArray(node)) { for (const c of node) walk(c, out); return out }
  if (typeof node !== 'object' || node.$$typeof !== 'element') return out
  out.push(node)
  for (const k of [].concat(node.children || [])) walk(k, out)
  return out
}
/** 收集树里所有文本 */
function textOf(node, out = []) {
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const c of node) textOf(c, out); return out }
  if (node && typeof node === 'object' && node.$$typeof === 'element') {
    for (const k of [].concat(node.children || [])) textOf(k, out)
  }
  return out
}
/**
 * 注册进插槽的是包装组件(返回 h(SessionView, props)),直接调它拿到的是 element。
 * 这里把函数型 element 逐层展开,直到拿到真正渲染出的宿主元素树。
 */
function renderTree(Component, props, hooks) {
  hooks.beginRender()
  let node = Component(props)
  let guard = 0
  while (node && typeof node === 'object' && node.$$typeof === 'element' && typeof node.type === 'function' && guard++ < 6) {
    node = node.type(node.props || {})
  }
  return node
}

/** 把树里函数型组件(包装层 / Btn / Chip / 图标)逐层展开成宿主元素。
 *  这些组件都无状态,展开不会打乱 SessionView 自己的 hooks 游标。 */
function expand(node, depth = 0) {
  if (depth > 40) return node
  if (Array.isArray(node)) return node.map((c) => expand(c, depth + 1))
  if (!node || typeof node !== 'object' || node.$$typeof !== 'element') return node
  if (typeof node.type === 'function') return expand(node.type(node.props || {}), depth + 1)
  return Object.assign({}, node, { children: [].concat(node.children || []).map((c) => expand(c, depth + 1)) })
}
/** className 里是否**恰好**有某个类名('dtk-tile' 不该匹配 'dtk-tiles') */
function classHas(node, cls) {
  return !!(node && node.props && String(node.props.className || '').split(/\s+/).includes(cls))
}

// ---------------------------------------------------------------------------
// 全局面板(sidebar.panellist 图标位 + main 面板本体)
// ---------------------------------------------------------------------------
test('全局面板:图标位只交图标,行样式由外壳画(不得自绘行/自带标签)', async () => {
  const { mod } = await loadClientBundle()
  const { ctx, registered } = fakeClientCtx()
  mod.apply(ctx)
  const glyph = registered.find((r) => r.descriptor.name === 'sidebar.panellist')
  const tree = expand(glyph.component({ size: 16, active: true }))
  // 外壳的 PanelRow 负责行高/内边距/悬停底色/选中态/label;
  // 本组件若再画一层行容器或重复写一遍文字,就会与外壳打架(这正是旧 .dtk-entry 的问题)
  assert.equal(tree.type, 'svg', '图标位应当直接给外壳一个 svg')
  assert.equal(textOf(tree).join(''), '', '图标位不得自带文字 —— 标签由外壳按 label 画')
  assert.equal(tree.props.width, 16, '应使用外壳请求的尺寸')
  assert.equal(tree.props['aria-hidden'], true, '装饰性图标应对读屏隐藏(名称由外壳的 aria-label 提供)')
})

test('全局面板:main 面板内嵌同源 /dsh-token(而不是重写一份界面)', async () => {
  const { mod } = await loadClientBundle()
  const { ctx, registered } = fakeClientCtx()
  mod.apply(ctx)
  const panel = registered.find((r) => r.descriptor.name === 'main')
  const tree = expand(panel.component({}))
  const iframe = walk(tree).find((n) => n.type === 'iframe')
  assert.ok(iframe, 'main 面板应内嵌 iframe')
  assert.equal(iframe.props.src, '/dsh-token', '嵌入的就是那个独立单页(同一份代码)')
  assert.equal(iframe.props.title, 'Token 统计仪表盘', 'iframe 必须有可读标题')
  // 导出 CSV/JSON 走 <a download>,沙箱默认禁止下载 —— 少了 allow-downloads 会静默失效
  assert.match(String(iframe.props.sandbox), /allow-downloads/, '导出功能需要 allow-downloads')
  assert.match(String(iframe.props.sandbox), /allow-scripts/, '页面是 JS 应用')
  assert.match(String(iframe.props.sandbox), /allow-same-origin/, '要读同源 API 与主题偏好')
  // 不给顶层导航:面板里的链接开新标签,不该把整个 DSH 应用顶掉
  assert.doesNotMatch(String(iframe.props.sandbox), /allow-top-navigation/, '不得放行顶层导航')
  // 高度:面板处在 flex 列里,容器必须能收缩,否则 iframe 会溢出而不是填满
  assert.ok(classHas(findByClass(tree, 'dtk-frame-wrap'), 'dtk-frame-wrap'), '应有撑满高度的包裹层')
})

/** 按 className 找第一个元素(用来只检查某一行,而不是整个面板的文本) */
function findByClass(node, cls) {
  return walk(node).find((n) => classHas(n, cls)) || null
}
/** 该元素直接文本里的 "·" 分隔符个数 */
function sepsIn(node) {
  return textOf(node).filter((s) => s === '·').length
}

/**
 * brief 载荷的形状与真实 Host 一致(hours/hoursPeak 逐小时、tiers 分档、
 * costParts 逐段费用、schedule 生效规则)。
 * hours 用一份"白天为主"的权重生成,并保证 hoursPeak ⊆ hours、两档之和 = 总量。
 *
 * 四段用量先声明,**总量由四段相加推导** —— 手写一个总量常数最容易在调整某一段时
 * 忘记同步,而 hours/tiers 又都挂在这个总量上,于是夹具自己前后矛盾。
 *
 * 注意 `write` **故意非零**:命中率的分母含缓存写入,若 write=0,
 * `read/(miss+read)` 与 `read/(miss+read+write)` 恰好相等 —— 测试就永远抓不到
 * "面板与仪表盘命中率口径不一致"这个缺陷(0.8.5 修的正是它)。
 */
const MISS_TOKENS = 500_000
const READ_TOKENS = 87_900_000
const WRITE_TOKENS = 1_000_000
const OUT_TOKENS = 200_000
const TOTAL_TOKENS = MISS_TOKENS + READ_TOKENS + WRITE_TOKENS + OUT_TOKENS
const HOUR_W = [2, 2, 2, 2, 3, 4, 6, 8, 14, 26, 30, 22, 18, 16, 28, 30, 24, 14, 12, 10, 8, 6, 4, 3]
const PEAK_IDX = new Set([9, 10, 11, 14, 15, 16, 17])
const HOUR_SUM = HOUR_W.reduce((a, b) => a + b, 0)
const HOURS = HOUR_W.map((w) => (w / HOUR_SUM) * TOTAL_TOKENS)
const HOURS_PEAK = HOUR_W.map((w, i) => (PEAK_IDX.has(i) ? (w / HOUR_SUM) * TOTAL_TOKENS : 0))
const PEAK_TOKENS = HOURS_PEAK.reduce((a, b) => a + b, 0)
const PEAK_SHARE = PEAK_TOKENS / TOTAL_TOKENS
/** 面板/摘要应显示的命中率:read / (miss + read + write) —— 与 /api/kpi 同口径。 */
const EXPECT_HIT_RATE_PCT = ((READ_TOKENS / (MISS_TOKENS + READ_TOKENS + WRITE_TOKENS)) * 100).toFixed(1)

const BRIEF = {
  id: 'sess-1',
  meta: { title: '修复 dsh-token 插件' },
  totals: { miss: MISS_TOKENS, read: READ_TOKENS, write: WRITE_TOKENS, out: OUT_TOKENS, requests: 448, cost: 3.78, saved: 262.71 },
  models: [
    { key: 'deepseek-official:deepseek-flash', provider: 'deepseek-official', model: 'deepseek-flash', totals: { miss: MISS_TOKENS, read: READ_TOKENS, write: WRITE_TOKENS, out: OUT_TOKENS, requests: 448, cost: 3.78, saved: 262.71 } },
  ],
  requestCount: 448, anomalies: 0, flagged: false, firstTs: 1787000000000, lastTs: 1787003600000,
  activeDays: 2,
  hours: HOURS,
  hoursPeak: HOURS_PEAK,
  tiers: { peak: { tokens: PEAK_TOKENS, cost: 1.06, requests: 126 }, idle: { tokens: TOTAL_TOKENS - PEAK_TOKENS, cost: 2.72, requests: 322 } },
  costParts: { miss: 1.5, read: 0.0035, write: 0, out: 1.6 },
  unpriced: 0,
  schedule: { hours: [[9, 12], [14, 18]], days: [1, 2, 3, 4, 5] },
}

/** 面板里的 TOK 口径(K/M/B 缩写),用来独立复算纵轴刻度 —— 断言不能复用被测实现。 */
const TOK_OF = (n) => {
  n = Number(n) || 0
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + ' K'
  return String(Math.round(n))
}

/**
 * 剪贴板桩件:模块级安装一次(Node 的 globalThis.navigator 是只读访问器,
 * 按次覆盖会在断言前被还原 —— 断言发生在 renderSessionView 返回之后)。
 */
const CLIP = { copied: null, fail: false }
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    clipboard: {
      writeText: (txt) => {
        CLIP.copied = txt
        return CLIP.fail ? Promise.reject(new Error('clipboard denied')) : Promise.resolve()
      },
    },
  },
})

/** 渲染会话面板:跑两帧(加载中 → 数据到达) */
async function renderSessionView(props, payload, opts = {}) {
  const hooks = makeHookHarness()
  const { mod } = await loadClientBundle(hooks.React, opts)
  const { ctx, registered } = fakeClientCtx()
  mod.apply(ctx)
  const Component = registered.find((r) => r.descriptor.name === 'conversation.view').component
  const calls = []
  globalThis.fetch = (url, opts2) => {
    calls.push({ url: String(url), method: (opts2 && opts2.method) || 'GET' })
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) })
  }
  if (opts.clip) { CLIP.copied = null; CLIP.fail = !!opts.clip.fail }
  try {
    const first = expand(renderTree(Component, props, hooks))
    hooks.runEffects()
    // 两轮微任务:开启 onOpen 时是 POST /scan →(then)→ GET /session,
    // 单轮 setTimeout(0) 只够第一条 promise 落地。
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    const second = expand(renderTree(Component, props, hooks))
    return {
      first, second, calls, hooks, Component, props,
      rerender: () => expand(renderTree(Component, props, hooks)),
      text: textOf(second).join(' '),
    }
  } finally {
    delete globalThis.fetch
  }
}

test('会话面板:原生渲染,不再把整张全局仪表盘塞进 iframe', async () => {
  const { first, second, calls } = await renderSessionView({ sessionId: 'sess-1' }, BRIEF)
  assert.equal(walk(first).some((n) => n.type === 'iframe'), false, '加载态不应有 iframe')
  assert.equal(walk(second).some((n) => n.type === 'iframe'), false, '渲染态也不应有 iframe')
  // 0.9.3 起默认先扫一次(POST /scan)再取数,所以是两步 —— 见下一条的专项断言。
  assert.deepEqual(calls.map((c) => c.method), ['POST', 'GET'], '先扫日志、再取数')
  assert.match(calls[1].url, /\/dsh-token\/api\/session\?id=sess-1&brief=1$/, '走单会话 brief 接口')
  assert.equal(walk(second).some((n) => n.type === 'a' && n.props && n.props.href === '/dsh-token'), true, '保留去完整仪表盘的链接')
})

test('会话面板:进入即先扫日志再取数(否则"刚聊完却还是旧数字")', async () => {
  // 这是 0.9.3 的核心行为:面板**存在但数据旧**是最常见的场景(会话在库里,
  // 只是库里的快照落后于刚发生的那一轮对话),而原实现只在"库里完全查不到
  // 这条会话"时才补扫 —— 恰好漏掉了最常见的那一种。
  const { calls } = await renderSessionView({ sessionId: 'sess-1' }, BRIEF)
  assert.deepEqual(calls.map((c) => c.method), ['POST', 'GET'],
    `进入面板必须先 POST /scan 再 GET /session,实际 ${JSON.stringify(calls.map((c) => c.method))}`)
  assert.match(calls[0].url, /\/dsh-token\/api\/scan$/, '先扫日志')
  assert.match(calls[1].url, /brief=1$/, '再取本会话数据')
})

test('会话面板:关掉「进入即扫」后不得再发 POST /scan(只取数)', async () => {
  // 开关存在 localStorage(面板要在首帧前**同步**决定,不能再等一次 /meta)。
  const { calls } = await renderSessionView({ sessionId: 'sess-1' }, BRIEF,
    { localStorage: { 'dsh-token-refresh-onopen': '0' } })
  assert.deepEqual(calls.map((c) => c.method), ['GET'], `关掉开关后只应取数,实际 ${JSON.stringify(calls)}`)
})

test('会话面板:缺 sessionId 时一个请求都不发(连扫描也不发)', async () => {
  // 这个面板没有要显示的会话,而扫描是本插件最重的操作 —— 不该为了"什么都不显示"
  // 去扫一遍全部会话日志。
  const { calls } = await renderSessionView({}, BRIEF)
  assert.deepEqual(calls, [], `无 sessionId 时不得发任何请求,实际 ${JSON.stringify(calls)}`)
})

test('会话面板:渲染本会话的汇总数字', async () => {
  const { second, text } = await renderSessionView({ sessionId: 'sess-1' }, BRIEF)
  assert.match(text, /89\.60 M/, '总量 = miss+read+write+out')
  assert.match(text, /448 次请求/)
  // 命中率必须与 /api/kpi、仪表盘会话详情同口径(read 含 write 的分母)
  assert.match(text, new RegExp('缓存命中率 ' + EXPECT_HIT_RATE_PCT.replace('.', '\\.') + '%'), 'read/(miss+read+write)')
  assert.match(text, /缓存命中/)
  assert.match(text, /未命中/)
  assert.match(text, /输出/)
  assert.match(text, /262\.71/, '缓存省下')
  assert.match(text, /deepseek-official:deepseek-flash/)
  // 四块亮点小卡都要在(信息量是这次重做的重点)
  for (const label of ['缓存命中率', '缓存省下', '高峰时段', '平均每次请求']) {
    assert.match(text, new RegExp(label), `缺少亮点:${label}`)
  }
  assert.ok(findByClass(second, 'dtk-flow'), '亮点应是独立的一排小卡')
  assert.equal(walk(second).filter((n) => classHas(n, 'dtk-mini')).length, 4, '四块亮点小卡')
})

test('会话面板:有起止时间时显示时段,旧 host 不带该字段时整段省略', async () => {
  const withTs = await renderSessionView({ sessionId: 'sess-1' }, BRIEF)
  assert.match(withTs.text, /\d\d:\d\d–\d\d:\d\d/, '同日应显示 起–止')
  const meta = findByClass(withTs.second, 'dtk-hero-meta')
  assert.ok(meta, '应有汇总行')
  assert.equal(sepsIn(meta), 2, '请求 / 活跃天数 / 时段 之间两个分隔符')

  // 0.5.2 的 /api/session 还没有 firstTs/lastTs
  const noTs = await renderSessionView({ sessionId: 'sess-1' }, { ...BRIEF, firstTs: undefined, lastTs: undefined })
  assert.doesNotMatch(noTs.text, /—/, '不留一个孤零零的破折号')
  assert.equal(sepsIn(findByClass(noTs.second, 'dtk-hero-meta')), 1, '缺时段时分隔符也要跟着少一个')
})

test('会话面板:逐段费用(钱花在哪一段),缓存在 token 里最多、在钱里最少', async () => {
  const { second, text } = await renderSessionView({ sessionId: 'sess-1' }, BRIEF)
  const legend = findByClass(second, 'dtk-seglegend')
  assert.ok(legend, '构成要有双列图例')
  const cells = walk(legend).filter((n) => classHas(n, 'dtk-sli'))
  assert.equal(cells.length, 4, '缓存命中 / 缓存写入 / 未命中 / 输出 四行(夹具四段都非零)')
  for (const c of cells) assert.match(textOf(c).join(' '), /· ¥\d/, '每行都要带该段的费用')
  assert.match(text, /¥1\.50/, '未命中段的费用')
  assert.match(text, /¥1\.60/, '输出段的费用')
  assert.match(text, /¥0\.0035/, '缓存命中段的费用(单价极低)')
  // 没有 costParts(旧 host)→ 图例不带费用,表头也不说费用
  const old = await renderSessionView({ sessionId: 'sess-1' }, { ...BRIEF, costParts: undefined })
  assert.doesNotMatch(textOf(findByClass(old.second, 'dtk-seglegend')).join(' '), /¥/)
  assert.doesNotMatch(textOf(findByClass(old.second, 'dtk-chead')).join(' '), /费用/)
})

test('会话面板:24 格时段分布 + 高峰/空闲分档,规则文字来自服务端 schedule', async () => {
  const { second, text } = await renderSessionView({ sessionId: 'sess-1' }, BRIEF)
  const cols = walk(findByClass(second, 'dtk-hours')).filter((n) => classHas(n, 'dtk-hcol'))
  assert.equal(cols.length, 24, '24 根柱子')
  const peakBars = cols.filter((c) => walk(c).some((n) => classHas(n, 'dtk-hpk')))
  assert.deepEqual(peakBars.map((c) => c.props.key), [9, 10, 11, 14, 15, 16, 17], '只在高峰小时画高峰段')
  assert.match(text, new RegExp('高峰 ' + (PEAK_SHARE * 100).toFixed(1) + '%'), '高峰占比按 tiers 算')
  assert.match(text, /规则:工作日 9–12、14–18 点\(北京时间\)/, '规则文字必须来自服务端 schedule')
  assert.match(text, /高峰/)
  assert.match(text, /空闲/)
  // 规则可配置:换成每天 0-24 点(即全天高峰)后文字要跟着变
  const all = await renderSessionView({ sessionId: 'sess-1' }, {
    ...BRIEF, schedule: { hours: [[0, 24]], days: [0, 1, 2, 3, 4, 5, 6] },
  })
  assert.match(all.text, /规则:每天 0–24 点\(北京时间\)/)
  // 关闭高峰计价(空数组 = 显式没有高峰)
  const off = await renderSessionView({ sessionId: 'sess-1' }, { ...BRIEF, schedule: { hours: [], days: [1, 2, 3, 4, 5] } })
  assert.match(off.text, /高峰计价已关闭/)
})

test('会话面板:逐小时柱带纵轴刻度,柱高比例不受影响', async () => {
  const { second, text } = await renderSessionView({ sessionId: 'sess-1' }, BRIEF)
  const axis = findByClass(second, 'dtk-hyaxis')
  assert.ok(axis, '时段图必须有纵轴刻度,否则读不出柱高的量级')
  const labels = textOf(axis).filter((s) => /[0-9]/.test(s))
  assert.equal(labels.length, 3, '应该有 上/中/下 三格刻度')
  assert.equal(labels[labels.length - 1], '0', '底格是 0,读者才知道基线的含义')
  // 上格必须等于本会话单小时峰值,且与面板其他数字同一套 TOK 口径
  const peak = Math.max(...HOURS)
  assert.equal(labels[0], TOK_OF(peak), '上格刻度 = 单小时峰值,按 TOK 缩写')
  assert.ok(labels.every((s) => s === '0' || /[0-9]/.test(s)), '刻度必须真的是数字')
  // 刻度是给眼睛的,不能再给读屏重复念一遍(每根柱子自己带 aria-label)
  assert.equal(axis.props['aria-hidden'], 'true')
  // 加了纵轴后 24 根柱子一根不少、比例也不变:仍是相对 maxHour 的百分比
  const cols = walk(findByClass(second, 'dtk-hours')).filter((n) => classHas(n, 'dtk-hcol'))
  assert.equal(cols.length, 24, '纵轴不应吃掉柱子')
  const maxHour = peak
  assert.equal(cols[10].props.style.height, Math.max(2, (HOURS[10] / maxHour) * 100) + '%', '柱高仍是相对峰值的比例')
  // 网格线是背景标尺,必须是 3 条(0 / 中 / 顶)
  assert.equal(walk(findByClass(second, 'dtk-hgrid')).filter((n) => n.type === 'i').length, 3, '三条网格线')
  // 没有 hours(旧 host)时纵轴也整块不出现
  const old = { ...BRIEF }
  delete old.hours
  delete old.hoursPeak
  const oldView = await renderSessionView({ sessionId: 'sess-1' }, old)
  assert.equal(findByClass(oldView.second, 'dtk-hyaxis'), null, '没有 hours 就不画纵轴')
})

test('会话面板:逐小时明细用自绘浮层,不再依赖原生 title', async () => {
  const { second } = await renderSessionView({ sessionId: 'sess-1' }, BRIEF)
  const cols = walk(findByClass(second, 'dtk-hours')).filter((n) => classHas(n, 'dtk-hcol'))
  assert.equal(cols.length, 24)
  for (const c of cols) {
    // 原生 title 有约 1 秒系统延迟且样式不可控,正是这次要拿掉的东西
    assert.equal(c.props.title, undefined, '柱子不得再用原生 title 承载明细')
    assert.equal(typeof c.props.onPointerEnter, 'function', '指针进入即显示')
    assert.equal(typeof c.props.onPointerMove, 'function', '指针移动即跟随/保持')
    assert.equal(typeof c.props.onPointerLeave, 'function', '指针离开即隐藏')
    // 可访问性不能因为换实现而丢:同一段明细仍要留给读屏
    assert.match(String(c.props['aria-label']), /\d\d:00–\d\d:00 · .*tokens/, '每根柱子保留 aria-label 明细')
  }
  // 未悬停时不该有浮层(浮层是悬停产物,不是常驻元素)
  assert.equal(findByClass(second, 'dtk-htip'), null, '未悬停时不渲染浮层')
})

test('会话面板:悬停某小时才渲染浮层,离开后消失', async () => {
  const view = await renderSessionView({ sessionId: 'sess-1' }, BRIEF)
  const cols = walk(findByClass(view.second, 'dtk-hours')).filter((n) => classHas(n, 'dtk-hcol'))
  // 触发第 10 格(高峰小时)的 pointerenter —— 组件状态是持久桩件,重渲染即可见
  cols[10].props.onPointerEnter()
  const shown = view.rerender()
  const tip = findByClass(shown, 'dtk-htip')
  assert.ok(tip, 'onPointerEnter 之后必须出现浮层(即时,不等原生 tooltip 的 1 秒)')
  assert.equal(tip.props.role, 'tooltip')
  const tipText = textOf(tip).join(' ')
  assert.match(tipText, /10:00–11:00/, '浮层给出该小时时段')
  assert.match(tipText, /tokens/, '浮层给出该小时用量')
  assert.match(tipText, /高峰计费/, '高峰小时多给一行高峰计费')
  // 浮层不能塞在 overflow:hidden 的柱子里(会被裁掉),要和柱子同级
  assert.equal(findByClass(cols[10], 'dtk-htip'), null, '浮层不能是柱子的子元素')
  assert.ok(findByClass(shown, 'dtk-hplot'), '浮层挂在绘图区里')
  // 离开 → 浮层消失
  cols[10].props.onPointerLeave()
  assert.equal(findByClass(view.rerender(), 'dtk-htip'), null, 'onPointerLeave 之后浮层必须消失')
})

test('会话面板:浮层横向跟随指针(而不是钉在柱子上)', async () => {
  const view = await renderSessionView({ sessionId: 'sess-1' }, BRIEF)
  const cols = walk(findByClass(view.second, 'dtk-hours')).filter((n) => classHas(n, 'dtk-hcol'))
  // 1) 移动与进入必须是**两个不同的**处理函数。旧版写成 onPointerMove: enter,
  //    指针在柱子内部横移时虽然不断触发,但位置只由"第几根柱子"决定 ——
  //    这正是用户看到的"提示框不跟着鼠标走"。
  assert.notEqual(cols[10].props.onPointerMove, cols[10].props.onPointerEnter, '指针移动必须有自己的处理函数,不能复用 enter')
  // 2) 移动处理必须能读到事件的 clientX(跟随的输入源)。
  //    绘图区 ref 在纯函数桩件里没挂载,placeTip 会安全早退 —— 这里同时证明
  //    "没有真实 DOM 也不会抛错"(旧 host / SSR 下同样成立)。
  assert.doesNotThrow(() => cols[10].props.onPointerMove({ clientX: 123.5 }), '移动处理不得抛错')
  assert.doesNotThrow(() => cols[10].props.onPointerMove(undefined), '事件缺失也不得抛错')
  // 3) 只移动、不进入:不该凭空冒出浮层
  assert.equal(findByClass(view.rerender(), 'dtk-htip'), null, '未进入时移动指针不应显示浮层')
  // 4) 浮层横向位置是**光标的 px**(配合 CSS translateX(-50%) 居中),不是
  //    百分比贴边;旧版的 left/right 百分比二选一正是"钉住"的实现。
  cols[10].props.onPointerEnter({ clientX: 300 })
  const tip = findByClass(view.rerender(), 'dtk-htip')
  assert.ok(tip, '进入后应有浮层')
  assert.match(String(tip.props.style.left), /^-?[\d.]+px$/, '横向位置必须是 px,才能跟着光标连续移动')
  assert.equal(tip.props.style.right, undefined, '不得再用 right 贴边(那会把浮层钉死)')
})

test('会话面板:浮层样式含居中位移与贴边夹取所需的自定义属性', async () => {
  const { styleTags } = await loadClientBundle()
  const css = styleTags.map((t) => t.textContent).join('\n')
  // 居中:位置写的是光标中心,靠 transform 抵消自身宽度
  assert.match(css, /\.dtk-htip\{[^}]*transform:translateX\(-50%\)/, '浮层用 translateX(-50%) 把中心压在光标上')
  // 位置由 JS 按实宽夹取,所以 CSS 里不能再有 left/right 的默认值把它拽回去
  assert.doesNotMatch(css, /\.dtk-htip\{[^}]*\bright:/, '浮层不应再有 right 落位')
  // 玻璃语言仍是面板自己的,不是宿主 #tip
  assert.match(css, /\.dtk-htip\{[^}]*pointer-events:none/, '浮层必须 pointer-events:none,否则会自抖')
})

test('会话面板:旧 host 不发节奏字段时,相关卡片整块隐藏(不留半张空卡)', async () => {
  const old = { ...BRIEF }
  delete old.hours
  delete old.hoursPeak
  delete old.tiers
  delete old.schedule
  const { second, text } = await renderSessionView({ sessionId: 'sess-1' }, old)
  assert.equal(findByClass(second, 'dtk-hours'), null, '没有 hours 就不画时段卡')
  assert.doesNotMatch(text, /高峰时段/, '没有 tiers 就不显示高峰 KPI')
  assert.doesNotMatch(text, /规则:/, '没有 schedule 就不显示规则行')
  assert.match(text, /89\.60 M/, '核心汇总照旧')
})

test('会话面板:模型行给出请求数、占比与未定价标注', async () => {
  const { second, text } = await renderSessionView({ sessionId: 'sess-1' }, {
    ...BRIEF,
    models: [
      { key: 'deepseek-official:deepseek-flash', totals: { miss: 1000, read: 88000000, write: 0, out: 100, requests: 400, cost: 3.4 } },
      { key: 's:kimi-k3', totals: { miss: 500, read: 1000, write: 0, out: 20, requests: 48, cost: 0 } },
    ],
  })
  const rows = walk(second).filter((n) => classHas(n, 'dtk-cat'))
  assert.equal(rows.length, 2, '两个模型两行')
  for (const r of rows) {
    const sub = textOf(findByClass(r, 'cval')).join(' ')
    assert.match(sub, /\d+\.\d%/, '每行都要有占比')
    assert.match(sub, /次/, '每行都要有请求数')
  }
  assert.match(text, /400 次/)
  assert.match(text, /48 次/)
  assert.match(text, /¥3\.40/)
  assert.match(text, /未定价/, '零费用模型必须标未定价,不能显示 ¥0')
  // 模型色序照搬仪表盘 CAT_COLORS:第一行蓝、第二行紫
  const dots = rows.map((r) => findByClass(r, 'cdot'))
  assert.equal(dots[0].props.style.background, 'var(--d-blue)')
  assert.equal(dots[1].props.style.background, 'var(--d-purple)')
})

test('会话面板:头部用插件自己的 iOS 胶囊按钮(复制 / 刷新 / 完整仪表盘)', async () => {
  const { second, text } = await renderSessionView({ sessionId: 'sess-1' }, BRIEF)
  const top = findByClass(second, 'dtk-top')
  assert.ok(top, '应有顶部条')
  assert.match(textOf(top).join(''), /本会话用量/, '顶部要有标题')
  const btns = walk(top).filter((n) => classHas(n, 'dtk-btn'))
  assert.equal(btns.length, 3, '三个动作:复制摘要 / 刷新 / 完整仪表盘')
  const copy = btns.find((b) => textOf(b).join('') === '复制摘要')
  const refresh = btns.find((b) => textOf(b).join('') === '刷新')
  const dash = btns.find((b) => textOf(b).join('') === '完整仪表盘')
  assert.ok(copy && refresh && dash, '三个按钮都要有字')
  assert.match(String(copy.props.className), /ghost/, '复制 = 次级胶囊')
  assert.equal(copy.type, 'button')
  assert.equal(refresh.type, 'button')
  // 完整仪表盘是真链接(可新开、可复制链接),外观是强调色实心胶囊
  assert.equal(dash.type, 'a')
  assert.equal(dash.props.href, '/dsh-token')
  assert.equal(dash.props.target, '_blank')
  assert.match(String(dash.props.className), /primary/)
  // 每个按钮都带图标(不是两行裸文字)
  for (const b of btns) assert.ok(walk(b).some((n) => n.type === 'svg'), '按钮必须带图标')
  // 图标必须是**可读的多笔形状**:小尺寸下单笔形状会退化成一个正方形/圆圈
  // (预览渲染器漏把图形元素自闭合、漏把 strokeWidth 写成 stroke-width,就出过这个事故)
  const copySvg = walk(copy).find((n) => n.type === 'svg')
  assert.equal(walk(copySvg).filter((n) => n.type === 'path' || n.type === 'rect').length, 2, '复制图标 = 两份文档,不是一格正方形')
  assert.equal(copySvg.props.strokeWidth, 2, '描边 2px')
  assert.equal(copySvg.props.viewBox, '0 0 24 24')
  const refreshSvg = walk(refresh).find((n) => n.type === 'svg')
  assert.equal(walk(refreshSvg).filter((n) => n.type === 'path').length, 2, '刷新图标 = 圆弧 + 箭头缺口,不是一个圆圈')
  const dashSvg = walk(dash).find((n) => n.type === 'svg')
  assert.equal(walk(dashSvg).filter((n) => n.type === 'path').length, 2, '外链图标 = 斜箭头两笔')
  // 面板字体必须与 DSH 外壳同栈(缺 "Segoe UI" 时拉丁字形会掉到别的字体上,一眼看得出)
  const { styleTags } = await loadClientBundle()
  const css = styleTags.map((t) => t.textContent).join('\n')
  assert.match(css, /"Segoe UI"/, '字体栈必须与 DSH 外壳一致')
})

test('会话面板:复制摘要真的把文本交给剪贴板,并给出成功反馈', async () => {
  const view = await renderSessionView({ sessionId: 'sess-1' }, BRIEF, { clip: {} })
  const copyBtn = walk(view.second).find((n) => n.type === 'button' && textOf(n).join('') === '复制摘要')
  assert.ok(copyBtn, '应有复制按钮')
  copyBtn.props.onClick()
  await new Promise((r) => setTimeout(r, 0))
  assert.match(String(CLIP.copied), /本会话用量 · 89\.60 M tokens · ¥3\.78/)
  assert.match(String(CLIP.copied), new RegExp('缓存命中率 ' + EXPECT_HIT_RATE_PCT.replace('.', '\\.') + '%'), '复制摘要与面板同口径')
  assert.match(String(CLIP.copied), /deepseek-official:deepseek-flash/)
  assert.match(String(CLIP.copied), /高峰规则:工作日 9–12、14–18 点\(北京时间\)/)
  assert.match(textOf(view.rerender()).join(' '), /已复制/, '复制成功后按钮要变成已复制')
})

test('会话面板:复制被拒就如实说失败,不假装成功', async () => {
  const view = await renderSessionView({ sessionId: 'sess-1' }, BRIEF, { clip: { fail: true } })
  const copyBtn = walk(view.second).find((n) => n.type === 'button' && textOf(n).join('') === '复制摘要')
  assert.ok(copyBtn)
  copyBtn.props.onClick()
  await new Promise((r) => setTimeout(r, 0))
  assert.match(textOf(view.rerender()).join(' '), /复制失败/)
})

test('会话面板:异常增长给出去完整明细的深链', async () => {
  const { second, text } = await renderSessionView({ sessionId: 'sess-1' }, { ...BRIEF, anomalies: 113, flagged: true })
  assert.match(text, /异常增长 113 处/)
  const drill = walk(second).find((n) => n.type === 'a' && n.props && String(n.props.href || '').includes('?session='))
  assert.ok(drill, '应有逐请求明细链接')
  assert.equal(drill.props.href, '/dsh-token?session=sess-1')
})

test('会话面板:跨天时段带上日期,异常增长单独标出', async () => {
  const cross = await renderSessionView({ sessionId: 'sess-1' }, {
    ...BRIEF, firstTs: Date.parse('2026-09-10T23:50:00'), lastTs: Date.parse('2026-09-11T00:20:00'),
  })
  assert.match(cross.text, /9\/10 23:50 – 9\/11 00:20/, '跨天应带日期')
  const flagged = await renderSessionView({ sessionId: 'sess-1' }, { ...BRIEF, anomalies: 113, flagged: true })
  assert.match(flagged.text, /异常增长 113 处/)
  assert.doesNotMatch(cross.text, /异常增长/, '无异常时不显示该段')
})

test('会话面板:部分未定价时仍显示估算金额,未定价另行标注', async () => {
  const { text } = await renderSessionView({ sessionId: 'sess-1' }, {
    ...BRIEF,
    unpriced: 1000,
    models: [
      { key: 'a:x', totals: { miss: 0, read: 1000, write: 0, out: 0, cost: 0, requests: 1 } },
      { key: 'b:y', totals: { miss: 0, read: 1000, write: 0, out: 0, cost: 0.5, requests: 1 } },
    ],
  })
  // 未定价必须被标注(不能让人把估算读成完整账单)
  assert.match(text, /未计价|未定价/)
  // 但**金额本身不能被顶掉**:部分未定价是最常见的情形,用户仍要看到估算值
  assert.match(text, /¥3\.78/, 'hero 费用仍须显示估算金额(不能写"未定价"三个字顶掉数字)')
  assert.match(text, /≈/, '未定价时用 ≈ 前缀表达"估算"')
})

test('会话面板:库中还没有这条会话时,自动补一次增量扫描再复查', async () => {
  // 关掉"进入即扫"才能单独观察这条兜底路径:它存在的意义正是"用户把开关关了,
  // 但这是个全新会话,库里查不到" —— 这时仍要自动补扫,否则新会话永远显示空。
  const { second, calls, text } = await renderSessionView({ sessionId: 'sess-new' }, null,
    { localStorage: { 'dsh-token-refresh-onopen': '0' } })
  assert.match(text, /本会话还没有用量记录/)
  // 查 → 扫 → 再查(扫完立刻复查,不必等下一个扫描周期)
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'POST', 'GET'])
  assert.match(calls[0].url, /\/dsh-token\/api\/session\?id=sess-new&brief=1$/)
  assert.match(calls[1].url, /\/dsh-token\/api\/scan$/)
  assert.equal(walk(second).some((n) => n.type === 'button'), true, '应提供"立即扫描"按钮')
})

test('会话面板:开着「进入即扫」且库里仍没有该会话时,不得连扫两次', async () => {
  // 默认路径已经扫过一遍;再走"查不到就补扫"会多解码一次全部变化会话,
  // 而结果不会不同(两次扫描之间没有新日志产生)。
  const { calls } = await renderSessionView({ sessionId: 'sess-new' }, null)
  assert.deepEqual(calls.map((c) => c.method), ['POST', 'GET'],
    `开着开关时应只扫一次,实际 ${JSON.stringify(calls.map((c) => c.method))}`)
})

test('会话面板:扫描被同源栅栏拒绝且库里没有该会话时,必须报错而不是说"没有用量"', async () => {
  // 403 时"扫不动"与"这个会话真的没有用量"是两件事。渲染成后者等于陈述假事实。
  const hooks = makeHookHarness()
  const { mod } = await loadClientBundle(hooks.React)
  const { ctx, registered } = fakeClientCtx()
  mod.apply(ctx)
  const Component = registered.find((r) => r.descriptor.name === 'conversation.view').component
  globalThis.fetch = (url, opts2) => {
    const method = (opts2 && opts2.method) || 'GET'
    if (method === 'POST') return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) })
    return Promise.resolve({ ok: true, status: 404, json: () => Promise.resolve(null) })
  }
  try {
    expand(renderTree(Component, { sessionId: 'sess-x' }, hooks))
    hooks.runEffects()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    const text = textOf(expand(renderTree(Component, { sessionId: 'sess-x' }, hooks))).join(' ')
    assert.match(text, /读不到本会话用量/, '应走错误态并说明原因')
    assert.doesNotMatch(text, /本会话还没有用量记录/, '不得把"扫描失败"说成"没有用量"')
  } finally {
    delete globalThis.fetch
  }
})

test('会话面板:没有 sessionId 时不发请求', async () => {
  const { calls, text } = await renderSessionView({}, null)
  assert.equal(calls.length, 0)
  assert.match(text, /本会话还没有用量记录/)
})
