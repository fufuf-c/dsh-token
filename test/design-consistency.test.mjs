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
 *      也是"改个变量名顺手漏改引用处"的网。DSH 外壳提供的 `--dsw-alias-*` 属于外部
 *      契约,不在本文件声明,故排除。
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
    if (m[1].startsWith('--dsw-')) continue
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
