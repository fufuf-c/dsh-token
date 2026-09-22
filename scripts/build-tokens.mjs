/**
 * dsh-token — 把 `lib/design-tokens.mjs` 的 token 注入两处界面文件。
 *
 * 这是**幂等的代码生成**:两个文件里各有一对标记,标记之间的 CSS 声明块由本脚本
 * 依据单一来源重写。改配色只改 `lib/design-tokens.mjs`,然后:
 *
 *     node scripts/build-tokens.mjs          # 写入
 *     node scripts/build-tokens.mjs --check  # 只校验(CI / test 用,漂移即非零退出)
 *
 * 标记之间的内容**不要手改** —— 下次注入会被覆盖,且 `--check` 会先报漂移。
 * 想给某一个文件开小灶,把差异写进 `LOCAL`(带 `why`),而不是直接改生成物。
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { renderDecls } from '../lib/design-tokens.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BEGIN = '/* dtk:tokens:begin */'
const END = '/* dtk:tokens:end */'

/**
 * 区域内联替换:标记在**外层选择器内部**,只重写标记之间的声明行。
 * 一个文件里有两对标记(浅色在前、深色在后),必须**按顺序逐个**替换:
 * 先找下一个 BEGIN,再找它之后的 END —— 而不是"第一个 BEGIN 到最后一个 END"
 * (那样会把两段规则连同中间的选择器一起吃掉)。用字面量匹配,不碰正则转义。
 */
function injectAll(src, regions) {
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  let cursor = 0
  for (const region of regions) {
    const b = src.indexOf(BEGIN, cursor)
    if (b < 0) throw new Error(`缺少第 ${regions.indexOf(region) + 1} 个 ${BEGIN} 标记`)
    const e = src.indexOf(END, b + BEGIN.length)
    if (e < 0) throw new Error(`第 ${regions.indexOf(region) + 1} 个 ${BEGIN} 之后缺少 ${END}`)
    const body = renderDecls(region.file, region.theme, region.pad).split('\n').join(eol)
    src = src.slice(0, b + BEGIN.length) + eol + body + eol + src.slice(e)
    cursor = b + BEGIN.length + eol.length + body.length
  }
  if (src.indexOf(BEGIN, cursor) !== -1) throw new Error('标记数量多于待注入的区间:请检查是否多写了一对标记')
  return src
}

/** 一个文件里通常有两段(浅色 / 深色),按出现顺序依次替换。 */
function transform(file, regions) {
  const path = join(root, file)
  const before = readFileSync(path, 'utf8')
  return { path, before, after: injectAll(before, regions) }
}

const TARGETS = [
  {
    // **注入的是源文件,不是产物**。web/index.html 由 scripts/build-web.mjs 从
    // web/src/** 拼接而成;若注入到产物,下一次拼接就会把注入覆盖掉 ——
    // 顺序必须是 build-tokens → build-web(npm test / prepack 已按此编排)。
    file: 'web/src/style.css',
    regions: [
      { file: 'html', theme: 'light', pad: '  ' },
      { file: 'html', theme: 'dark', pad: '  ' },
    ],
  },
  {
    file: 'lib/client.js',
    regions: [
      { file: 'client', theme: 'light', pad: '  ' },
      { file: 'client', theme: 'dark', pad: '  ' },
    ],
  },
]

const check = process.argv.includes('--check')
let drifted = 0
for (const target of TARGETS) {
  const { path, before, after } = transform(target.file, target.regions)
  const rel = path.slice(root.length + 1)
  if (before === after) {
    console.log(`✓ ${rel} 与设计 token 单一来源一致`)
    continue
  }
  drifted++
  if (check) {
    console.error(`✗ ${rel} 与 lib/design-tokens.mjs 不一致(运行 node scripts/build-tokens.mjs 重新注入)`)
  } else {
    writeFileSync(path, after)
    console.log(`↻ ${rel} 已按 lib/design-tokens.mjs 重新注入`)
  }
}

if (check && drifted) {
  console.error(`\n✗ token 漂移:${drifted} 个文件需要重新注入`)
  process.exit(1)
}
console.log(check ? '\n✔ token 无漂移' : '\n✔ token 注入完成')
