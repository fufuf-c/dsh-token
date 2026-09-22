/**
 * dsh-token — 设计 token 一致性测试(node:test,零依赖)
 *
 * 锁三件事,任何一件出问题都说明"界面会变样但没人发现":
 *   1. 两个界面文件里的 token 块与 `lib/design-tokens.mjs`(单一来源)**逐字一致**——
 *      手改生成物、或改了 token 忘了重新注入,这里立刻失败;
 *   2. 生成的**变量名**逐字等于历史变量名。key 里有些是不规则缩写(`grad` 实为
 *      `bg-grad`、`text2` 实为 `text-2`),若被自动 kebab 化,生成的是一批
 *      **从未被引用**的变量名 —— 界面会静默丢掉全部配色,而语法检查毫无察觉;
 *   3. **引用闭合**:两个文件里所有 `var(--x)` 都能在文件内找到声明。这是 2 的兜底,
 *      也是"改个变量名顺手漏改引用处"的网。DSH 外壳提供的 `--dsw-*`(主题 token)与
 *      `--dsh-*`(外壳运行参数,如内容字号)属于外部契约,不在本文件声明,故排除;
 *   4. **宿主适配不回退**:面板必须接宿主的字体族与正文字号变量,而不是抄一份固定值 ——
 *      抄死的值会在用户改「外观」时静默无视设置,且宿主换字体时漂移。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderDecls, varName, SEMANTIC_KEYS, TOKENS } from '../lib/design-tokens.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')
const EOL = (s) => (s.includes('\r\n') ? '\r\n' : '\n')

/** 取出第 n 对(dtk:tokens:begin/end)之间的内容(不含标记行本身)。 */
function blockOf(src, index) {
  const BEGIN = '/* dtk:tokens:begin */'
  const END = '/* dtk:tokens:end */'
  let cursor = 0
  for (let i = 0; i <= index; i++) {
    const b = src.indexOf(BEGIN, cursor)
    assert.ok(b >= 0, `缺少第 ${i + 1} 个 tokens 标记`)
    const e = src.indexOf(END, b + BEGIN.length)
    assert.ok(e >= 0, `第 ${i + 1} 个 tokens 标记未闭合`)
    if (i === index) return src.slice(b + BEGIN.length, e)
    cursor = e + END.length
  }
  throw new Error('unreachable')
}

function declaredNames(block) {
  return block.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('--'))
    .map((l) => l.slice(0, l.indexOf(':')))
}

/**
 * 文件里**在别处**定义的自有变量:JS 运行时写入(`style.setProperty('--x')`)、
 * 内联样式(`style="--x:…"`)、以及 `@property --x{…}` 注册。
 * 这些不属于设计 token(它们是动效/几何参数,随鼠标或滚动变化),但对"引用必须有人声明"
 * 这个检查而言,它们**确实是声明** —— 所以并进集合,而不是把检查放宽成"只查 token 块"。
 */
function runtimeDeclared(src) {
  const out = new Set()
  for (const re of [
    /setProperty\(\s*['"](--[A-Za-z0-9_-]+)['"]/g,
    /style\s*=\s*["'][^"']*?(--[A-Za-z0-9_-]+)\s*:/g,
    /@property\s+(--[A-Za-z0-9_-]+)/g,
    /^\s*(--[A-Za-z0-9_-]+)\s*:/gm,
  ]) {
    let m
    while ((m = re.exec(src))) out.add(m[1])
  }
  return out
}

/** 文件里所有 `var(--x)` 引用(去重),排除 DSH 外壳提供的外部变量。 */
function referencedNames(src) {
  const out = new Set()
  const re = /var\(\s*(--[A-Za-z0-9_-]+)/g
  let m
  while ((m = re.exec(src))) {
    // 宿主契约,由 DSH 声明、不在这两个文件里,故不参与"引用闭合":
    //   --dsw-*  主题 token(调色板 / alias 语义色 / 字体族)
    //   --dsh-*  外壳自身的运行参数(如内容字号 --dsh-content-font-size / -delta)
    if (m[1].startsWith('--dsw-') || m[1].startsWith('--dsh-')) continue
    out.add(m[1])
  }
  return out
}

const CASES = [
  { file: 'web/index.html', kind: 'html', blocks: [0, 1] },
  { file: 'lib/client.js', kind: 'client', blocks: [0, 1] },
]
const THEMES = ['light', 'dark']

for (const c of CASES) {
  test(`设计 token:${c.file} 的两段(浅色/深色)与单一来源逐字一致`, () => {
    const src = read(c.file)
    c.blocks.forEach((bi, i) => {
      const theme = THEMES[i]
      const want = EOL(src) + renderDecls(c.kind, theme, '  ').split('\n').join(EOL(src)) + EOL(src)
      assert.equal(blockOf(src, bi), want,
        `${c.file} 的 ${theme} token 块与 lib/design-tokens.mjs 不一致 —— 运行 node scripts/build-tokens.mjs`)
    })
  })

  test(`设计 token:${c.file} 引用的每个 var(--x) 都在文件内有声明(引用闭合)`, () => {
    const src = read(c.file)
    const declared = runtimeDeclared(src)
    for (const bi of c.blocks) for (const n of declaredNames(blockOf(src, bi))) declared.add(n)
    const missing = [...referencedNames(src)].filter((n) => !declared.has(n))
    assert.deepEqual(missing, [],
      `${c.file} 引用了未声明的变量(界面会静默丢样式或走 fallback):${missing.join(', ')}`)
  })
}

test('设计 token:变量名逐字等于历史命名(不规则缩写必须显式映射)', () => {
  const htmlLight = declaredNames(blockOf(read('web/index.html'), 0))
  const clientLight = declaredNames(blockOf(read('lib/client.js'), 0))
  // 语义 token:顺序与 SEMANTIC_KEYS 一致,且名字对得上
  assert.deepEqual(htmlLight.slice(0, SEMANTIC_KEYS.length), SEMANTIC_KEYS.map((k) => varName('html', k)))
  assert.deepEqual(clientLight.slice(0, SEMANTIC_KEYS.length), SEMANTIC_KEYS.map((k) => varName('client', k)))
  // 抽查几个容易写错的:--bg-grad 不是 --grad,--text-2 不是 --text2,--glass-border 不是 --glassBorder
  assert.ok(htmlLight.includes('--bg-grad'), 'HTML 的渐变变量必须叫 --bg-grad')
  assert.ok(htmlLight.includes('--text-2'), 'HTML 的次级文字必须叫 --text-2')
  assert.ok(htmlLight.includes('--glass-border'), 'HTML 的描边必须叫 --glass-border(不是 --glassBorder)')
  assert.ok(htmlLight.includes('--accent-soft'), 'HTML 的强调色底必须叫 --accent-soft')
  assert.ok(htmlLight.includes('--surface-2'), 'HTML 的次级面必须叫 --surface-2')
  assert.ok(htmlLight.includes('--hairline-2'), 'HTML 的细分隔线必须叫 --hairline-2')
  assert.ok(clientLight.includes('--d-text'), 'client 变量带 --d- 前缀')
  assert.ok(clientLight.includes('--d-hairline-2'), 'client 的细分隔线必须叫 --d-hairline-2')
  for (const n of htmlLight.concat(clientLight)) {
    assert.match(n, /^--[a-z0-9-]+$/, `变量名必须是小写 kebab:${n}`)
  }
})

test('设计 token:两处共用的颜色值真正相等(不是"看起来差不多")', () => {
  const html = blockOf(read('web/index.html'), 0)
  const client = blockOf(read('lib/client.js'), 0)
  const grab = (block, name) => {
    const line = block.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith(`${name}:`))
    return line ? line.slice(name.length + 1).replace(/;$/, '') : null
  }
  // 17 个语义色 + 文本/描边:两处必须逐字相同
  for (const key of ['red', 'green', 'blue', 'orange', 'teal', 'purple', 'indigo', 'gray']) {
    assert.equal(grab(html, varName('html', key)), grab(client, varName('client', key)), `${key} 两边不一致`)
  }
  assert.equal(grab(html, '--bg'), grab(client, '--d-bg'))
  assert.equal(grab(html, '--text'), grab(client, '--d-text'))
  // glass 是有意的差异(见 LOCAL 的 why),这里反过来锁"它确实不同且两边都非空"
  assert.ok(grab(html, '--glass') && grab(client, '--d-glass'))
  assert.notEqual(grab(html, '--glass'), grab(client, '--d-glass'), 'glass 是显式差异,若被悄悄统一应更新 LOCAL 说明')
})

test('设计 token:语义 key 在两边都有名字映射(缺映射会抛出而不是生成坏名字)', () => {
  for (const key of SEMANTIC_KEYS) {
    assert.match(varName('html', key), /^--[a-z0-9-]+$/)
    assert.match(varName('client', key), /^--d-[a-z0-9-]+$/)
    assert.ok(TOKENS.light[key] !== undefined && TOKENS.dark[key] !== undefined, `${key} 必须有浅色与深色两档`)
  }
})

/**
 * 取出某条规则体:选择器必须出现在**行首 / `;` / `}` 之后**(允许空白),
 * 紧跟 `{`。这样 `.dtk-app{` 取的是浅色那条基础规则,而不是
 * `body[data-ds-dark-theme] .dtk-app{`;`body{` 取的也不是 `html,body{`。
 */
function ruleBody(src, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`(?:^|[\\n;}])\\s*${esc}\\{`).exec(src)
  assert.ok(m, `找不到规则 ${selector}`)
  const end = src.indexOf('}', m.index + m[0].length)
  assert.ok(end >= 0, `规则 ${selector} 未闭合`)
  return src.slice(m.index + m[0].length, end)
}

/**
 * 宿主适配不能靠"抄一份值"——抄下来的字号/字体/底色会在用户改「外观」或宿主换主题时
 * 静默失效(面板看起来还在,只是不再跟随)。这几条锁住"接"而不是"抄"。
 */
test('宿主适配:会话面板接宿主字体族 / 正文字号 / 底色,不写死固定值', () => {
  const panel = ruleBody(read('lib/client.js'), '.dtk-app')
  assert.match(panel, /font-family:var\(--dsw-font-family,/,
    '面板字体族必须接 --dsw-font-family(宿主留给主题覆写的钩子),而不是抄一份栈')
  assert.match(panel, /font-size:var\(--dsh-content-font-size,/,
    '面板正文字号必须接 --dsh-content-font-size,否则用户改「外观」里的字号时面板无反应')
  assert.match(panel, /line-height:calc\(24px \+ var\(--dsh-content-font-delta,0px\)\)/,
    '行高必须走宿主的 delta 口径,才能随字号同步变化')
  assert.doesNotMatch(panel, /(?:^|[;\s])font:\s*\d/,
    '不允许再用 font 简写写死字号 —— 简写会覆盖 font-size/line-height 的宿主绑定')
  assert.match(panel, /background:var\(--d-grad\),var\(--dsw-alias-bg-base,var\(--d-bg\)\)/,
    '面板底色必须接 --dsw-alias-bg-base(会话根节点 ConversationRoot 的底色),--d-bg 只作兜底')
})

test('宿主适配:仪表盘页与面板走同一个宿主字体钩子', () => {
  const body = ruleBody(read('web/index.html'), 'body')
  assert.match(body, /font-family:var\(--dsw-font-family,/,
    '仪表盘页字体族必须与面板同源,否则"同一个产品"的两处字体不一致')
  assert.doesNotMatch(body, /(?:^|[;\s])font:\s*\d/,
    '仪表盘页同样不允许 font 简写写死字体栈')
})

/**
 * 上一条只锁住了 `.dtk-app` **根选择器**——面板里 28 处固定 px 的 font-size
 * 就在它下一层,于是测试全绿而用户改「外观」字号时面板几乎不动。
 * 这条把它变成机制:面板区域里**每一处** font-size 必须是
 *   - 接宿主变量(var(--dsh-content-font-size) / var(--dsh-content-font-delta)),
 *   - 或显式登记在下面的「展示性字号」白名单里(带理由)。
 * 白名单只允许 hero 大数字与费用 —— 它们是视觉锚点,跟着正文轴放大会撑破版面。
 */
test('宿主适配:面板区域每一处字号都必须接宿主字号轴(白名单之外零例外)', () => {
  const src = read('lib/client.js')
  const css = src.slice(src.indexOf('style.textContent = `') + 'style.textContent = `'.length, src.indexOf('\n`\n'))
  // 只检查"产品面板"区域;外壳(.dtk-frame/.dtk-panel/.dtk-row/.dtk-open)跟随宿主,
  // 它们本来就用 var(--dsh-content-font-size) 或宿主 alias,不在本条约束内。
  // 侧边栏入口自 0.8.7 起不再自绘(注册进 sidebar.panellist,行样式全由外壳画),
  // 所以旧清单里的 .dtk-entry 已不存在 —— 留着它会让这条测试悄悄少查一段。
  const shellSelectors = ['.dtk-frame', '.dtk-panel', '.dtk-row', '.dtk-open']
  const fakePanel = css
    .split('\n')
    .filter((line) => !shellSelectors.some((s) => line.trim().startsWith(s)))
    .join('\n')

  const DISPLAY_ALLOWLIST = [
    // hero 主数字:展示性图形字号(有上方注释说明)
    '.dtk-hero-num{font-size:42px',
    '.dtk-hero-num .unit{font-size:15px',
    '.dtk-cost b{font-size:24px',
  ]
  const offenders = []
  for (const line of fakePanel.split('\n')) {
    const m = line.match(/font-size:\s*([^;}]+)/)
    if (!m) continue
    const val = m[1].trim()
    if (val.includes('var(--dsh-content-font-size') || val.includes('var(--dsh-content-font-delta')) continue
    if (DISPLAY_ALLOWLIST.some((a) => line.includes(a))) continue
    offenders.push(line.trim().slice(0, 110))
  }
  assert.deepEqual(offenders, [],
    '面板里出现未接宿主字号轴的固定字号 —— 用户改「外观」字号时这些文字不会跟随。\n' +
    '要么改成 calc(<n>px + var(--dsh-content-font-delta,0px)),要么加进 DISPLAY_ALLOWLIST 并说明理由。')
})
