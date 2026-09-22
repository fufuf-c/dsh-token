/**
 * dsh-token — 自动刷新策略(0.9.3)锁定断言
 *
 * 背景:页面 60 秒自动刷、服务端 5 分钟自动扫,这两个数字原先**写死在代码里**。
 * 它们成本差三个数量级(实测 53 会话:稳态增量扫描 34–52 ms、冷启全量 2.1 s;
 * 而重取聚合是纯内存查询,亚毫秒级),写死一个值必然对某类用户不合意。
 * 更关键的是第三种行为:**用户刚聊完一轮,切过去看到的还是旧数字** ——
 * 这不是"间隔不够短",而是"打开界面的那一刻压根没看日志",调间隔治不好。
 *
 * 这一批锁住:
 *   R1  refreshSettings 的归一化与边界(0 = 关闭,非 0 钳进 [min,max],非法回退默认)
 *   R2  applyConfigPatch 的写入语义(增量合并 / null 恢复默认 / 非法值必须抛错)
 *   R3  配置往返:写完立刻读等于写进去的值(configView 与 refreshSettings 同源)
 *   R4  形态体检不得把带 refresh 的库判成损坏(否则历史统计被静默清零)
 *   R5  metaInfo 必须把 refresh 带出去(页面首帧就要按正确间隔挂定时器)
 *   R6  宿主:改 scanSec 后定时器必须**重排**(不重启即生效);0 = 不挂
 *   R7  页面:间隔可配、切页/回前台先扫再取、失败不谎报
 *
 * 被测对象是**真实实现**:core.mjs 直接调用;宿主与页面走源码文本断言 +
 * 真实执行(lib/index.js 用桩 ctx 装载,r6 直接观察 timer 桩收到的间隔)。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir, homedir } from 'node:os'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const {
  emptyStore, applyConfigPatch, configView, refreshSettings, isStoreShapeValid,
  metaInfo, DEFAULT_REFRESH, REFRESH_BOUNDS, rebuildAll, STORE_VERSION,
} = await import('../lib/core.mjs')

// ---------------------------------------------------------------------------
// R1 · refreshSettings 归一化
// ---------------------------------------------------------------------------
test('R1: 缺字段 / 合法值 / 非法值 的归一化', () => {
  // 空库(没有 config.refresh):全部回退默认
  assert.deepEqual(refreshSettings(emptyStore()), { ...DEFAULT_REFRESH })
  // 完全没有 store 也不能抛(api.config() 在 loadStore 之前就被调用过)
  assert.deepEqual(refreshSettings(null), { ...DEFAULT_REFRESH })
  assert.deepEqual(refreshSettings({}), { ...DEFAULT_REFRESH })

  // 显式 0 = 关闭(是开关,不受 min 约束)
  const off = refreshSettings({ config: { refresh: { pageSec: 0, scanSec: 0 } } })
  assert.equal(off.pageSec, 0, '0 必须原样保留 —— 它表示"关闭",不是"太短"')
  assert.equal(off.scanSec, 0)

  // 非 0 值钳进边界(手改 store.json 写出 1 秒扫描时,不能让宿主每秒扫一次)
  const tiny = refreshSettings({ config: { refresh: { pageSec: 1, scanSec: 1 } } })
  assert.equal(tiny.pageSec, REFRESH_BOUNDS.pageSec.min)
  assert.equal(tiny.scanSec, REFRESH_BOUNDS.scanSec.min)

  // 超大值也钳住
  const huge = refreshSettings({ config: { refresh: { pageSec: 1e9, scanSec: 1e9 } } })
  assert.equal(huge.pageSec, REFRESH_BOUNDS.pageSec.max)
  assert.equal(huge.scanSec, REFRESH_BOUNDS.scanSec.max)
})

test('R1b: 非法值必须回退默认,而不是变成 NaN 传下去', () => {
  // NaN 传进 setInterval 会被当成 0(每秒触发);传进宿主 armScanTimer 会无限快扫。
  // 这是"配错了比不配更糟"的典型,必须在读取侧兜住。
  for (const bad of ['abc', {}, [], NaN, -5, Infinity, null]) {
    const r = refreshSettings({ config: { refresh: { pageSec: bad, scanSec: bad } } })
    assert.ok(Number.isFinite(r.pageSec) && r.pageSec >= 0, `pageSec=${JSON.stringify(bad)} 应回退为有限值,实际 ${r.pageSec}`)
    assert.ok(Number.isFinite(r.scanSec) && r.scanSec >= 0, `scanSec=${JSON.stringify(bad)} 应回退为有限值,实际 ${r.scanSec}`)
  }
  // 负数是"非法",不是"关闭":-5 != 0,必须回退默认(否则负延迟在宿主侧行为诡异)
  assert.equal(refreshSettings({ config: { refresh: { pageSec: -5 } } }).pageSec, DEFAULT_REFRESH.pageSec)
})

test('R1c: onOpen 只在显式 false 时关闭', () => {
  assert.equal(refreshSettings(emptyStore()).onOpen, true, '默认开启')
  assert.equal(refreshSettings({ config: { refresh: { onOpen: false } } }).onOpen, false)
  assert.equal(refreshSettings({ config: { refresh: { onOpen: 0 } } }).onOpen, false, '0 视为 false')
  assert.equal(refreshSettings({ config: { refresh: { onOpen: null } } }).onOpen, true, 'null = 未设置 → 默认')
})

// ---------------------------------------------------------------------------
// R2 · applyConfigPatch 写入语义
// ---------------------------------------------------------------------------
test('R2: refresh 是增量合并,不覆盖未提及的字段', () => {
  const s = emptyStore()
  applyConfigPatch(s, { refresh: { pageSec: 30 } })
  assert.equal(refreshSettings(s).pageSec, 30)
  assert.equal(refreshSettings(s).scanSec, DEFAULT_REFRESH.scanSec, '没提到的 scanSec 必须保持原值')
  applyConfigPatch(s, { refresh: { scanSec: 900 } })
  assert.equal(refreshSettings(s).pageSec, 30, '第二次 patch 不得把 pageSec 冲回默认')
  assert.equal(refreshSettings(s).scanSec, 900)
})

test('R2b: patch 里被钳制的值必须能从返回值读到(否则界面显示一个没生效的数字)', () => {
  const s = emptyStore()
  const view = applyConfigPatch(s, { refresh: { pageSec: 3 } })
  assert.equal(view.refresh.pageSec, REFRESH_BOUNDS.pageSec.min, '返回值必须是钳制后的值')
  assert.equal(refreshSettings(s).pageSec, REFRESH_BOUNDS.pageSec.min, '写入的也必须是钳制后的值')
})

test('R2c: 非法 refresh 必须抛错,不能静默忽略', () => {
  const s = emptyStore()
  // 静默忽略会让调用方以为"设置生效了",而界面上(用返回值重绘)显示旧值 —— 不一致且无从察觉
  assert.throws(() => applyConfigPatch(s, { refresh: { pageSec: -1 } }), /pageSec/)
  assert.throws(() => applyConfigPatch(s, { refresh: { pageSec: 'x' } }), /pageSec/)
  assert.throws(() => applyConfigPatch(s, { refresh: { scanSec: 'soon' } }), /scanSec/)
  assert.throws(() => applyConfigPatch(s, { refresh: { onOpen: 'yes' } }), /onOpen/)
  assert.throws(() => applyConfigPatch(s, { refresh: [] }), /refresh/)
  // 抛错后库不得被改坏
  assert.deepEqual(refreshSettings(s), { ...DEFAULT_REFRESH })
})

test('R2d: refresh = null 恢复默认', () => {
  const s = emptyStore()
  applyConfigPatch(s, { refresh: { pageSec: 15, scanSec: 60, onOpen: false } })
  assert.equal(refreshSettings(s).pageSec, 15)
  applyConfigPatch(s, { refresh: null })
  assert.deepEqual(refreshSettings(s), { ...DEFAULT_REFRESH }, 'null 必须恢复三档全部默认')
})

test('R2e: 改 refresh 不得影响其他配置(单价/预算/时段)', () => {
  const s = emptyStore()
  applyConfigPatch(s, { budget: { monthly: 123 }, peakDays: [1, 2] })
  applyConfigPatch(s, { refresh: { pageSec: 30 } })
  const v = configView(s)
  assert.equal(v.budget.monthly, 123)
  assert.deepEqual(v.schedule.days, [1, 2])
})

// ---------------------------------------------------------------------------
// R3 · 往返
// ---------------------------------------------------------------------------
test('R3: 写进 store.config.refresh 的值,configView / refreshSettings 读到的一致', () => {
  const s = emptyStore()
  applyConfigPatch(s, { refresh: { pageSec: 120, scanSec: 1800, onOpen: false } })
  // 模拟落盘往返:JSON 序列化丢掉 undefined/函数,值必须原样活下来
  const round = JSON.parse(JSON.stringify(s))
  const a = configView(s).refresh
  const b = configView(round).refresh
  assert.deepEqual(b, a, '往返后 refresh 必须一致')
  assert.deepEqual(a, { pageSec: 120, scanSec: 1800, onOpen: false })
  // configView 必须同时给出默认值与边界,前端不该硬编码这两份数据
  assert.deepEqual(configView(s).defaultsRefresh, { ...DEFAULT_REFRESH })
  assert.ok(configView(s).refreshBounds.pageSec.min > 0, '必须给出边界(页面据此提示)')
})

test('R3b: 老库(完全没有 refresh 字段)读出来是默认值,且不算损坏', () => {
  const s = emptyStore()
  delete s.config.refresh
  assert.equal(isStoreShapeValid(s), true, '缺 refresh 是合法老库,绝不能被判成损坏')
  rebuildAll(s)
  assert.deepEqual(configView(s).refresh, { ...DEFAULT_REFRESH })
})

// ---------------------------------------------------------------------------
// R4 · 形态体检
// ---------------------------------------------------------------------------
test('R4: refresh 为数组/字符串不得让整库被判损坏(否则历史统计被静默清零)', () => {
  // 体检的职责是拦住"读取侧即将解引用"的形状。refreshSettings 对 refresh 本身
  // 是字符串/数字是**容忍**的(回退默认),所以不该因此把用户的库隔离掉。
  // 唯一拦的是数组:数组也能挂属性,容易被误写进去,而它没有意义。
  const ok = emptyStore()
  ok.config.refresh = 'soon'
  assert.equal(isStoreShapeValid(ok), true, '容忍:refresh 是字符串时回退默认,不该判损坏')

  const arr = emptyStore()
  arr.config.refresh = []
  assert.equal(isStoreShapeValid(arr), false, '数组是明确写错,应判定为形态损坏')

  const inner = emptyStore()
  inner.config.refresh = { pageSec: {} }
  assert.equal(isStoreShapeValid(inner), true, '内层值类型错乱由 refreshSettings 兜底,不必判损坏')
  assert.equal(refreshSettings(inner).pageSec, DEFAULT_REFRESH.pageSec)
})

// ---------------------------------------------------------------------------
// R5 · metaInfo 带出 refresh
// ---------------------------------------------------------------------------
test('R5: metaInfo 必须带出归一化后的 refresh(页面首帧就要用)', () => {
  const s = emptyStore()
  const bare = metaInfo(s)
  // metaInfo 本身不认识 refresh(它由宿主的 metaExtra 注入)—— 这条锁的是
  // "宿主把 refresh 放进 metaExtra",见下面的 R6 源码断言。
  assert.equal(bare.refresh, undefined, 'core 的 metaInfo 不负责装配 refresh(那是宿主的事)')
  // 但 extra 是透传的:宿主塞什么就带什么
  const withExtra = metaInfo(s, { refresh: refreshSettings(s) })
  assert.deepEqual(withExtra.refresh, { ...DEFAULT_REFRESH })
})

// ---------------------------------------------------------------------------
// R6 · 宿主:定时器可重排
//
// ⚠ **必须在导入 lib/index.js 之前**把 DSH_HOME 指向临时目录。
//   index.js 在**模块顶层**就由 `process.env.DSH_HOME || ~/.dsh` 算出 STORE_DIR,
//   导入之后再改环境变量已经晚了 —— 装载出来的宿主会读写**用户真实的库**。
//   (这不是假设:第一版这条测试就是带着真实 DSH_HOME 跑的,而桩 persistence 的
//   list() 返回空,于是 scanStore 判定"53 个会话全被删了"并把真实 store.json
//   清成空索引。会话日志没丢、库可从日志重建,但那是一次真实的破坏。
//   顺带暴露的产品缺陷是"空列表即清库",已由 scanStore 的守卫修掉,见
//   test/scan-store.test.mjs 的四条用例。)
//   e2e-smoke.mjs 早就是先设 env 再 import,这里照同一模式办。
// ---------------------------------------------------------------------------
// R6 的隔离说明见上方文件头。这里只声明 HOME 集合(import 已经在文件顶部)。
// ---------------------------------------------------------------------------
const REAL_HOME = process.env.DSH_HOME
const HOMES = []
/**
 * 每个宿主用例一个**全新**的临时 DSH_HOME。
 *
 * 共用一个 HOME 会让用例之间通过 store.json 互相影响:R6b 把 scanSec 改成 60、
 * R6c 改成 0,而 R6e 断言"默认 300" —— 于是它读到的 0/15 完全取决于执行顺序,
 * 是个只在特定顺序下才红的脆弱用例(第一版就是这样失败的)。隔离必须做到
 * "每个用例从空库起步"这个粒度。
 */
function freshHome() {
  const h = mkdtempSync(join(tmpdir(), 'dsh-token-refresh-'))
  HOMES.push(h)
  return h
}
/**
 * 收尾清掉所有临时库。
 *
 * 用 `after()` 而不是"某个用例末尾顺手删":每个用例都会建一个新 HOME,
 * 只在其中一个用例里清理等于漏掉其余全部 —— 实测跑一次 `node --test` 会在
 * `%TEMP%` 留下 53 个空目录。测试污染外部环境(哪怕只是临时目录)都是要还的。
 * Windows 上文件句柄可能还被占着,删不掉就留给系统:不能因为清理失败让测试变红。
 */
after(() => {
  for (const h of HOMES) { try { rmSync(h, { recursive: true, force: true }) } catch (e) { /* ignore */ } }
})

/** 断言当前 DSH_HOME 确实在临时目录里,绝不允许真实库被测试读写。 */
function assertIsolatedHome(home) {
  assert.ok(home && home !== REAL_HOME, 'DSH_HOME 未被隔离')
  assert.ok(home.startsWith(tmpdir()) || home.includes('dsh-token-refresh-'),
    `测试必须隔离 DSH_HOME,当前为 ${home} —— 绝不可以用真实库跑宿主测试`)
}

/** 用桩 ctx 装载宿主插件,收集 timer.interval 收到的间隔。 */
async function loadHost({ persistence } = {}) {
  const home = freshHome()
  assertIsolatedHome(home)
  process.env.DSH_HOME = home
  const intervals = []
  const disposers = []
  let routeHandler = null
  const p = persistence || {
    async list() { return [] },
    async open() { return { header: {}, read: async () => ({ events: [] }), close: async () => {} } },
  }
  const ctx = {
    get(name) {
      if (name === 'sessionPersistence') return p
      if (name === 'webServer') return { register: (hd) => { routeHandler = hd.handler; return () => {} } }
      if (name === 'timer') return { interval: (cb, ms) => { intervals.push(ms); const d = () => {}; disposers.push(d); return d } }
      if (name === 'commands') return undefined
      if (name === 'settings') return undefined
      return undefined
    },
    provide: () => () => {},
    effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return () => {} },
  }
  // 唯一的 query 参数绕过 ESM 模块缓存:index.js 的顶层常量(STORE_DIR 等)
  // 是**导入时**从 process.env.DSH_HOME 求值的,不重新导入就换不了库。
  const plugin = await import(`../lib/index.js?t=${Date.now()}${Math.random()}`)
  plugin.apply(ctx)
  await new Promise((r) => setTimeout(r, 60)) // 等启动扫描落地
  return { plugin, intervals, routeHandler, ctx, home }
}

/**
 * 真实库的指纹(size + mtime)。宿主测试**结束前后**各取一次,必须完全相同。
 *
 * 这是对"测试没碰真实库"最直接的断言 —— 比"临时目录里出现了 dsh-token/"
 * 更贴近要守的不变式(那个断言其实锁不住东西:空库走不进写盘路径,目录压根不会创建)。
 */
function realStoreFingerprint() {
  const f = join(REAL_HOME || join(os.homedir(), '.dsh'), 'dsh-token', 'store.json')
  if (!existsSync(f)) return null
  const st = statSync(f)
  return { size: st.size, mtimeMs: st.mtimeMs }
}

test('R6f: 宿主测试不得触碰真实库(前后指纹必须一致)', async () => {
  const before = realStoreFingerprint()
  const { home } = await loadHost()
  assertIsolatedHome(home)
  assert.notEqual(home, REAL_HOME)
  // 关键不变式:真实 store.json 的字节数与 mtime 一字未动。
  // 第一版这条测试就是在这里翻车的:DSH_HOME 未隔离 → 加载真实 v6 库 →
  // needsFullScan → 桩 list() 返回空 → 判定 53 个会话全被删 → saveStore()
  // 因 lastSaveAt=0 算出 wait=0 → 立刻落盘 → 真实库被清成 882 字节空索引。
  assert.deepEqual(realStoreFingerprint(), before,
    '真实库被测试改动了 —— 宿主测试必须完全隔离 DSH_HOME')
})

/** 直接打真实 HTTP 语义太重;这里只调 routeHandler 的 API 面(用假 req/res)。 */
function callRoute(routeHandler, method, url, body) {
  return new Promise((resolve) => {
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
    const req = {
      method, url,
      headers: { host: '127.0.0.1:3080' },
      on(ev, fn) { if (ev === 'data') chunks.forEach(fn); if (ev === 'end') fn(); return this },
      resume() {}, removeAllListeners() {},
    }
    const res = {
      statusCode: 0, headers: null, body: '',
      writeHead(code, headers) { this.statusCode = code; this.headers = headers },
      end(b) { this.body = b === undefined ? '' : String(b); resolve(this) },
    }
    routeHandler(req, res)
  })
}

test('R6: 宿主的后台扫描定时器按配置挂载,默认 300 秒', async () => {
  const { intervals } = await loadHost()
  assert.ok(intervals.length >= 1, '必须挂一个后台扫描定时器')
  assert.equal(intervals[0], DEFAULT_REFRESH.scanSec * 1000, `默认应为 ${DEFAULT_REFRESH.scanSec}s,实际 ${intervals[0]}ms`)
})

test('R6b: 改 scanSec 后定时器必须重排(POST /config 不重启即生效)', async () => {
  const { intervals, routeHandler } = await loadHost()
  const before = intervals.length
  const r = await callRoute(routeHandler, 'POST', '/dsh-token/api/config', { refresh: { scanSec: 60 } })
  assert.equal(r.statusCode, 200, `POST /config 应 200,实际 ${r.statusCode}: ${r.body}`)
  const parsed = JSON.parse(r.body)
  assert.equal(parsed.refresh.scanSec, 60, '返回值必须带上新间隔')
  assert.ok(intervals.length > before, '改间隔必须重排定时器(旧周期是创建时固定的,不重排就得重启)')
  assert.equal(intervals[intervals.length - 1], 60 * 1000, `新定时器应为 60s,实际 ${intervals[intervals.length - 1]}ms`)
})

test('R6c: scanSec = 0 表示关闭后台扫描(只撤不建)', async () => {
  const { intervals, routeHandler } = await loadHost()
  const before = intervals.length
  const r = await callRoute(routeHandler, 'POST', '/dsh-token/api/config', { refresh: { scanSec: 0 } })
  assert.equal(r.statusCode, 200, r.body)
  assert.equal(intervals.length, before, '0 = 关闭:不得再建新定时器')
})

test('R6d: 只改页面间隔(不涉及 scanSec)不得重排宿主定时器', async () => {
  // 页面间隔是浏览器的事,宿主定时器与它无关;每保存一次都重排会白白清掉
  // 已经跑了 4 分钟的那一轮计时。
  const { intervals, routeHandler } = await loadHost()
  const before = intervals.length
  const r = await callRoute(routeHandler, 'POST', '/dsh-token/api/config', { refresh: { pageSec: 15 } })
  assert.equal(r.statusCode, 200, r.body)
  assert.equal(intervals.length, before, 'pageSec 变化不得触碰宿主定时器')
})

test('R6e: /meta 必须带出 refresh(页面首帧据此挂定时器)', async () => {
  const { routeHandler } = await loadHost()
  const r = await callRoute(routeHandler, 'GET', '/dsh-token/api/meta')
  assert.equal(r.statusCode, 200)
  const m = JSON.parse(r.body)
  assert.ok(m.refresh, '/meta 必须带 refresh 字段')
  assert.equal(m.refresh.pageSec, DEFAULT_REFRESH.pageSec)
  assert.equal(m.refresh.scanSec, DEFAULT_REFRESH.scanSec)
  assert.equal(typeof m.refresh.onOpen, 'boolean')
})

// ---------------------------------------------------------------------------
// R7 · 页面
// ---------------------------------------------------------------------------
const PAGE = readFileSync(join(root, 'web', 'index.html'), 'utf8')
/** 取出内联脚本,剥掉 IIFE 收尾,便于注入探针执行。 */
function pageScript() {
  const m = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(PAGE)
  assert.ok(m, '页面应有内联脚本')
  return m[1]
}

test('R7: 页面不得再把刷新间隔写死为 60000', () => {
  const code = pageScript()
  assert.doesNotMatch(code, /setInterval\([\s\S]{0,200}?,\s*60000\s*\)/,
    '页面自动刷新间隔必须来自配置,不得写死 60000')
  assert.doesNotMatch(code, /\},\s*60000\s*\);/, '不得残留写死 60000 的 setInterval')
  assert.match(code, /function startAutoRefresh/, '应有可按新间隔重挂的 startAutoRefresh')
})

test('R7b: 页面必须提供"先扫日志再取数"的统一入口', () => {
  const code = pageScript()
  assert.match(code, /function scanThenReload/, '需要 scanThenReload(先 POST /scan 再取数)')
  assert.match(code, /refreshOnOpen\(\)/, '需要读取 onOpen 策略')
  // 三处入口都要走它:启动 / 切 Tab / 刷新按钮
  assert.match(code, /scanThenReload\(startTab\)|scanThenReload\(tab\)|scanThenReload\(state\.tab\)/,
    '启动/切页/刷新至少要接到 scanThenReload')
  assert.match(code, /visibilitychange/, '回到前台也要补一次(后台标签页的定时器会被节流)')
})

test('R7c: 设置页必须有刷新策略控件,且保存后当场重挂定时器', () => {
  const code = pageScript()
  assert.match(code, /id="rf-page"/, '应有页面自动刷新间隔控件')
  assert.match(code, /id="rf-scan"/, '应有后台扫描间隔控件')
  assert.match(code, /id="rf-onopen"/, '应有"进入界面时先扫一次"开关')
  assert.match(code, /function bindSettingsRefresh/, '控件必须有绑定函数')
  // 保存后必须重挂:间隔是用户可配的,不在保存点重挂就得等下次刷新才生效
  const bind = /function bindSettingsRefresh\(body\) \{([\s\S]*?)\n  \}/.exec(code)
  assert.ok(bind, '应能找到 bindSettingsRefresh 的函数体')
  assert.match(bind[1], /startAutoRefresh\(\)/, '保存后必须当场按新间隔重挂定时器')
  // 必须用服务端返回值回填:服务端会钳制越界值
  assert.match(bind[1], /state\.config = c/, '必须用 POST 的返回体回填 state(服务端会钳制)')
})

test('R7d: 页面的默认值必须与 core 的 DEFAULT_REFRESH 一致', () => {
  // 两处各写一份是**有意的**(页面在 /meta 到达前、甚至 /meta 永久失败时也要能刷新),
  // 但值必须相同 —— 否则"meta 没到"和"meta 到了"会表现出两种行为。
  const code = pageScript()
  const m = /var REFRESH_DEFAULTS = \{([^}]*)\}/.exec(code)
  assert.ok(m, '页面应有 REFRESH_DEFAULTS')
  const grab = (k) => {
    const mm = new RegExp(k + ':\\s*(\\d+|true|false)').exec(m[1])
    return mm ? (mm[1] === 'true' ? true : mm[1] === 'false' ? false : Number(mm[1])) : undefined
  }
  assert.equal(grab('pageSec'), DEFAULT_REFRESH.pageSec, 'pageSec 默认值两处必须一致')
  assert.equal(grab('scanSec'), DEFAULT_REFRESH.scanSec, 'scanSec 默认值两处必须一致')
  assert.equal(grab('onOpen'), DEFAULT_REFRESH.onOpen, 'onOpen 默认值两处必须一致')
})

test('R7e: refreshSettings 在页面里必须对非法值兜底(不能把 NaN 交给 setInterval)', () => {
  // setInterval(fn, NaN) 会被当成 0 → 每帧触发,是"配错比不配更糟"的典型。
  const code = pageScript()
  // 用 vm 跑真实实现:注入探针后直接调 refreshSettings()
  const els = new Map()
  const fakeEl = () => {
    const t = { innerHTML: '', textContent: '', value: '', hidden: false, style: {}, dataset: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false } }
    const el = new Proxy(t, {
      get(o, k) {
        if (k in o) return o[k]
        if (k === 'querySelectorAll') return () => []
        if (k === 'querySelector' || k === 'closest') return () => el
        if (k === 'appendChild' || k === 'insertBefore' || k === 'removeChild') return (x) => x
        if (k === 'getContext') return () => ctx2d
        return () => {}
      }, set(o, k, v) { o[k] = v; return true },
    })
    return el
  }
  const ctx2d = new Proxy({}, { get: (o, k) => (k === 'canvas' ? fakeEl() : (k === 'measureText' ? () => ({ width: 10 }) : () => {})), set: () => true })
  const doc = {
    getElementById: (id) => { if (!els.has(id)) els.set(id, fakeEl()); return els.get(id) },
    querySelector: () => fakeEl(), querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    createElement: () => fakeEl(), hidden: true,
    body: fakeEl(), documentElement: fakeEl(), head: fakeEl(),
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
  sandbox.window = sandbox; sandbox.globalThis = sandbox
  sandbox.addEventListener = () => {}; sandbox.removeEventListener = () => {}
  sandbox.scrollTo = () => {}; sandbox.scrollY = 0; sandbox.devicePixelRatio = 1
  sandbox.innerWidth = 1280; sandbox.innerHeight = 800
  sandbox.history = { replaceState() {}, pushState() {} }
  sandbox.getComputedStyle = () => ({ getPropertyValue: () => '' })
  for (const g of ['URLSearchParams', 'URL', 'TextEncoder', 'TextDecoder', 'Blob', 'AbortController',
    'AbortSignal', 'Event', 'CustomEvent', 'Intl', 'encodeURIComponent', 'decodeURIComponent',
    'queueMicrotask', 'structuredClone', 'performance']) {
    if (g in globalThis) sandbox[g] = globalThis[g]
  }
  vm.createContext(sandbox)
  const tail = code.lastIndexOf('})();')
  const probed = code.slice(0, tail) +
    'globalThis.__r = { refreshSettings: refreshSettings, refreshOnOpen: refreshOnOpen, state: state };\n' +
    code.slice(tail)
  vm.runInContext(probed, sandbox, { filename: 'web/index.html' })
  const r = sandbox.__r

  // 读不到 meta/config → 默认
  r.state.meta = null; r.state.config = null
  assert.deepEqual(JSON.parse(JSON.stringify(r.refreshSettings())), { ...DEFAULT_REFRESH })

  // 非法值 → 默认(绝不能是 NaN)
  for (const bad of ['abc', {}, [], NaN, -5, Infinity]) {
    r.state.meta = { refresh: { pageSec: bad, scanSec: bad } }
    const got = r.refreshSettings()
    assert.ok(Number.isFinite(got.pageSec), `pageSec=${JSON.stringify(bad)} → 必须有限,实际 ${got.pageSec}`)
    assert.ok(Number.isFinite(got.scanSec), `scanSec=${JSON.stringify(bad)} → 必须有限,实际 ${got.scanSec}`)
  }
  // 0 是关闭,必须原样保留
  r.state.meta = { refresh: { pageSec: 0, scanSec: 0, onOpen: false } }
  assert.equal(r.refreshSettings().pageSec, 0)
  assert.equal(r.refreshSettings().scanSec, 0)
  assert.equal(r.refreshOnOpen(), false)
})
