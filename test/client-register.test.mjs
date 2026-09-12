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
async function loadClientBundle(reactImpl = MINIMAL_REACT) {
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
  globalThis.window = {
    __ModuleLoader__: { load: (reg) => { registration = reg } },
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

test('client bundle: apply 注册三个官方插槽,细节符合 0.1.5 契约', async () => {
  const { mod } = await loadClientBundle()
  const { ctx, injected, registered, localeCalls } = fakeClientCtx()
  mod.apply(ctx)

  assert.deepEqual(injected.sort(), ['conversation.view', 'settings.section', 'sidebar.footer.action'])

  const byName = Object.fromEntries(registered.map((r) => [r.descriptor.name, r]))
  assert.equal(registered.length, 3)

  for (const name of ['sidebar.footer.action', 'conversation.view', 'settings.section']) {
    const r = byName[name]
    assert.ok(r, `必须注册 ${name}`)
    // list 槽位在运行时强制要求 options.id,缺失会直接抛错
    assert.equal(r.descriptor.id, 'dsh-token', `${name} 必须带 id(list 槽位契约)`)
    assert.equal(typeof r.descriptor.order, 'number', `${name} 需要 order 排序`)
    // label 由 resolveSlotLabel 解析:函数或字符串都合法,函数才能跟随语言切换
    assert.equal(typeof r.descriptor.label, 'function', `${name} 的 label 应为函数`)
    assert.equal(typeof r.descriptor.label(), 'string')
    assert.equal(r.descriptor.locale, 'dsh-token', `${name} 应声明 locale 命名空间`)
    assert.equal(typeof r.component, 'function', `${name} 的组件必须是可被 React 渲染的函数`)
  }
  // 每个组件都不得在渲染前就抛错(取一个最简 props)
  for (const { descriptor, component } of registered) {
    assert.doesNotThrow(() => component({ wide: true, sessionId: 'session-x' }), `${descriptor.name} 组件不应抛错`)
  }
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
  for (const { descriptor } of registered) assert.equal(descriptor.locale, ns)
  // 标签走各自的 translate key
  assert.equal(registered.find((r) => r.descriptor.name === 'conversation.view').descriptor.label(), 't:session')
  assert.equal(registered.find((r) => r.descriptor.name === 'sidebar.footer.action').descriptor.label(), 't:tab')
})

test('client bundle: 侧边栏与会话内入口的标签必须不同(否则用户分不清)', async () => {
  const { mod } = await loadClientBundle()
  const { ctx, registered } = fakeClientCtx({ withLocale: false })
  mod.apply(ctx)
  const labelOf = (n) => registered.find((r) => r.descriptor.name === n).descriptor.label()
  assert.equal(labelOf('sidebar.footer.action'), 'Token 统计')
  assert.equal(labelOf('conversation.view'), '本会话用量', '会话内入口应表明只服务当前对话')
  assert.notEqual(labelOf('sidebar.footer.action'), labelOf('conversation.view'), '两个入口名字不得相同')
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
  assert.equal(registered.length, 3)
  assert.equal(localeCalls.register.length, 0)
  assert.equal(registered.find((r) => r.descriptor.name === 'conversation.view').descriptor.label(), '本会话用量')
})

test('client bundle: 样式标签带 data-plugin 归属包名(供运行时认领/回收)', async () => {
  const { styleTags } = await loadClientBundle()
  assert.ok(styleTags.length >= 1, 'client bundle 必须注入自己的样式标签')
  // claimStyles() 认领无标签的 <style> 并按 data-plugin 归属;data-plugin-css 可选
  assert.equal(styleTags[0].getAttribute('data-plugin'), PKG_NAME)
  assert.ok(String(styleTags[0].textContent).includes('.dtk-entry'), '样式内容应为仪表盘入口样式')
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
 */
const TOTAL_TOKENS = 88_600_000
const HOUR_W = [2, 2, 2, 2, 3, 4, 6, 8, 14, 26, 30, 22, 18, 16, 28, 30, 24, 14, 12, 10, 8, 6, 4, 3]
const PEAK_IDX = new Set([9, 10, 11, 14, 15, 16, 17])
const HOUR_SUM = HOUR_W.reduce((a, b) => a + b, 0)
const HOURS = HOUR_W.map((w) => (w / HOUR_SUM) * TOTAL_TOKENS)
const HOURS_PEAK = HOUR_W.map((w, i) => (PEAK_IDX.has(i) ? (w / HOUR_SUM) * TOTAL_TOKENS : 0))
const PEAK_TOKENS = HOURS_PEAK.reduce((a, b) => a + b, 0)
const PEAK_SHARE = PEAK_TOKENS / TOTAL_TOKENS

const BRIEF = {
  id: 'sess-1',
  meta: { title: '修复 dsh-token 插件' },
  totals: { miss: 500000, read: 87900000, write: 0, out: 200000, requests: 448, cost: 3.78, saved: 262.71 },
  models: [
    { key: 'deepseek-official:deepseek-flash', provider: 'deepseek-official', model: 'deepseek-flash', totals: { miss: 500000, read: 87900000, write: 0, out: 200000, requests: 448, cost: 3.78, saved: 262.71 } },
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
  const { mod } = await loadClientBundle(hooks.React)
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
    await new Promise((r) => setTimeout(r, 0)) // 让 fetch 的 then 落地
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
  assert.equal(calls.length, 1, '只应取一次数据')
  assert.match(calls[0].url, /\/dsh-token\/api\/session\?id=sess-1&brief=1$/, '走单会话 brief 接口')
  assert.equal(walk(second).some((n) => n.type === 'a' && n.props && n.props.href === '/dsh-token'), true, '保留去完整仪表盘的链接')
})

test('会话面板:渲染本会话的汇总数字', async () => {
  const { second, text } = await renderSessionView({ sessionId: 'sess-1' }, BRIEF)
  assert.match(text, /88\.60 M/, '总量 = miss+read+out')
  assert.match(text, /448 次请求/)
  assert.match(text, /缓存命中率 99\.4%/, 'read/(miss+read)')
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
  assert.equal(cells.length, 3, '缓存命中 / 未命中 / 输出 三行(缓存写入为 0 不占行)')
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
  assert.match(text, /88\.60 M/, '核心汇总照旧')
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
  assert.match(String(CLIP.copied), /本会话用量 · 88\.60 M tokens · ¥3\.78/)
  assert.match(String(CLIP.copied), /缓存命中率 99\.4%/)
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

test('会话面板:未定价模型明确标注,不显示 ¥0', async () => {
  const { text } = await renderSessionView({ sessionId: 'sess-1' }, {
    ...BRIEF,
    models: [
      { key: 'a:x', totals: { miss: 0, read: 1000, write: 0, out: 0, cost: 0, requests: 1 } },
      { key: 'b:y', totals: { miss: 0, read: 1000, write: 0, out: 0, cost: 0.5, requests: 1 } },
    ],
  })
  assert.match(text, /未定价/)
  assert.match(text, /¥0\.50/)
})

test('会话面板:库中还没有这条会话时,自动补一次增量扫描再复查', async () => {
  const { second, calls, text } = await renderSessionView({ sessionId: 'sess-new' }, null)
  assert.match(text, /本会话还没有用量记录/)
  // 查 → 扫 → 再查(扫完立刻复查,不必等下一个扫描周期)
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'POST', 'GET'])
  assert.match(calls[0].url, /\/dsh-token\/api\/session\?id=sess-new&brief=1$/)
  assert.match(calls[1].url, /\/dsh-token\/api\/scan$/)
  assert.equal(walk(second).some((n) => n.type === 'button'), true, '应提供"立即扫描"按钮')
})

test('会话面板:没有 sessionId 时不发请求', async () => {
  const { calls, text } = await renderSessionView({}, null)
  assert.equal(calls.length, 0)
  assert.match(text, /本会话还没有用量记录/)
})
