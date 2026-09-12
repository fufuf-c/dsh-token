/**
 * dsh-token — **设计 token 单一来源**
 *
 * 背景:这个插件有两处界面,各自带一套 CSS 变量:
 *   - `web/index.html`(仪表盘单页)用 `--*` 前缀,`<html>` 上的 `:root` /
 *     `[data-theme=dark]` 驱动;
 *   - `lib/client.js`(会话内原生面板)用 `--d-*` 前缀,`body[data-ds-dark-theme]` 驱动。
 * 两边必须看起来像同一个产品,而"手工抄一遍并祈祷别忘同步"不是机制 —— 这个文件是
 * **唯一来源**,由 `scripts/build-tokens.mjs` 注入两个文件,`test/design-consistency.test.mjs`
 * 在 CI 里校验文件与这里一致(漂移即失败)。
 *
 * 语义:
 *   - `TOKENS`:**两边共用**的规范值。两处界面渲染出来的就是同一个值。
 *   - `LOCAL`:只属于某一个文件的 token。要么是平台差异(面板在 DSH 外壳里、页面是独立
 *     文档,所以透明度/磨砂强度不同),要么是另一个文件根本用不到的 token。
 *     写在这里是**显式声明差异**,不是遗漏 —— 想统一就把值挪进 `TOKENS`。
 *
 * 每一组里:light 是浅色档,dark 是深色档(`#000` 与 `#000000` 视为同值)。
 */

/** 语义色。列表顺序 = 注入到 CSS 里的顺序(便于 diff 阅读)。 */
export const SEMANTIC_KEYS = [
  'bg', 'grad', 'glassBorder', 'specular', 'surface2', 'chip',
  'text', 'text2', 'text3', 'hairline', 'hairline2',
  'accent', 'accentSoft', 'red', 'green', 'blue', 'orange', 'teal', 'purple', 'indigo', 'gray',
  'shadow', 'shadowFloat', 'aurora',
]

/**
 * 两边共用的规范值。
 * 注意 `glass`:两边**有意不同**(面板要更实一些才压得住 DSH 会话背景),
 * 因此它只出现在下面的 LOCAL 里,不在这里。
 */
export const TOKENS = {
  light: {
    bg: '#f2f2f7',
    grad: 'radial-gradient(110% 50% at 50% -8%,rgba(10,132,255,.09),transparent 60%),radial-gradient(60% 40% at 88% 0%,rgba(191,90,242,.05),transparent 65%)',
    glassBorder: 'rgba(255,255,255,.5)',
    specular: 'inset 0 1px 0 rgba(255,255,255,.75)',
    surface2: 'rgba(120,120,128,.08)',
    chip: 'rgba(120,120,128,.10)',
    text: '#1d1d1f',
    text2: '#6e6e73',
    text3: '#aeaeb2',
    hairline: 'rgba(0,0,0,.14)',
    hairline2: 'rgba(0,0,0,.07)',
    accent: '#007aff',
    accentSoft: 'rgba(0,122,255,.13)',
    red: '#ff3b30',
    green: '#34c759',
    blue: '#007aff',
    orange: '#ff9500',
    teal: '#5ac8fa',
    purple: '#af52de',
    indigo: '#5856d6',
    gray: '#8e8e93',
    shadow: '0 1px 1px rgba(0,0,0,.03),0 2px 10px rgba(0,0,0,.05),0 14px 36px rgba(0,0,0,.07)',
    shadowFloat: '0 8px 40px rgba(0,0,0,.18)',
    aurora: 'linear-gradient(100deg,#0a84ff 0%,#5e5ce6 24%,#bf5af2 48%,#ff375f 72%,#ff9f0a 100%)',
  },
  dark: {
    bg: '#000',
    grad: 'radial-gradient(110% 50% at 50% -8%,rgba(94,92,230,.15),transparent 60%),radial-gradient(60% 40% at 88% 0%,rgba(191,90,242,.07),transparent 65%)',
    glassBorder: 'rgba(255,255,255,.09)',
    specular: 'inset 0 1px 0 rgba(255,255,255,.08)',
    surface2: 'rgba(120,120,128,.16)',
    chip: 'rgba(120,120,128,.2)',
    text: '#f5f5f7',
    text2: '#98989d',
    text3: '#6e6e73',
    hairline: 'rgba(255,255,255,.16)',
    hairline2: 'rgba(255,255,255,.09)',
    accent: '#0a84ff',
    accentSoft: 'rgba(10,132,255,.22)',
    red: '#ff453a',
    green: '#30d158',
    blue: '#0a84ff',
    orange: '#ff9f0a',
    teal: '#64d2ff',
    purple: '#bf5af2',
    indigo: '#7d7aff',
    gray: '#98989d',
    shadow: '0 1px 0 rgba(0,0,0,.2),0 8px 30px rgba(0,0,0,.35)',
    shadowFloat: '0 8px 40px rgba(0,0,0,.6)',
    aurora: 'linear-gradient(100deg,#0a84ff 0%,#7d7aff 24%,#bf5af2 48%,#ff375f 72%,#ff9f0a 100%)',
  },
}

/**
 * 仅供某一个文件使用的 token(显式声明的差异)。
 *   file: 'html' | 'client'        目标文件
 *   name: 该文件里的变量名(不含 --)
 *   why:  为什么不一样(写给下一个想"顺手统一"的人)
 */
export const LOCAL = {
  light: [
    // 页面在 <html> 上定义,面板挂在 .dtk-app 里并覆盖 DSH 的 token,所以两者都需要
    // --bg / --text 这类"根级"变量名。
    { file: 'html', name: 'glass', value: 'linear-gradient(180deg,rgba(255,255,255,.80),rgba(255,255,255,.56))' },
    { file: 'html', name: 'glass-strong', value: 'rgba(255,255,255,.82)' },
    { file: 'html', name: 'seg-track', value: 'rgba(120,120,128,.10)' },
    { file: 'html', name: 'seg-on', value: '#ffffff' },
    { file: 'html', name: 'seg-shadow', value: '0 1px 4px rgba(0,0,0,.12),0 0 1px rgba(0,0,0,.08)' },
    { file: 'html', name: 'tabbar', value: 'rgba(255,255,255,.66)' },
    { file: 'html', name: 'tip-bg', value: 'rgba(30,30,32,.88)' },
    { file: 'html', name: 'tip-text', value: '#f5f5f7' },
    { file: 'client', name: 'd-glass', value: 'linear-gradient(180deg,rgba(255,255,255,.86),rgba(255,255,255,.62))', why: '面板要更实,压得住 DSH 会话背景' },
  ],
  dark: [
    { file: 'html', name: 'glass', value: 'linear-gradient(180deg,rgba(42,42,47,.6),rgba(26,26,30,.48))' },
    { file: 'html', name: 'glass-strong', value: 'rgba(44,44,46,.76)' },
    { file: 'html', name: 'seg-track', value: 'rgba(120,120,128,.18)' },
    { file: 'html', name: 'seg-on', value: '#636366' },
    { file: 'html', name: 'seg-shadow', value: 'none' },
    { file: 'html', name: 'tabbar', value: 'rgba(22,22,26,.56)' },
    { file: 'html', name: 'tip-bg', value: 'rgba(44,44,46,.92)' },
    { file: 'html', name: 'tip-text', value: '#f5f5f7' },
    { file: 'client', name: 'd-glass', value: 'linear-gradient(180deg,rgba(42,42,47,.62),rgba(26,26,30,.5))', why: '面板要更实,压得住 DSH 会话背景' },
  ],
}

/**
 * 语义 key → CSS 变量名(不含 `--` 前缀)。
 * **必须逐字对上历史变量名** —— 这些 key 里有些是拼写不规则的缩写
 * (`grad` 实为 `bg-grad`、`text2` 实为 `text-2`),一旦自动 kebab 化就会生成
 * 从未被引用的变量名,界面会**静默**丢配色。所以这里显式写死,并配
 * `test/design-consistency.test.mjs` 校验"生成物里声明了每一个被引用的变量"。
 */
const HTML_VAR = {
  bg: 'bg', grad: 'bg-grad', glassBorder: 'glass-border', specular: 'specular',
  surface2: 'surface-2', chip: 'chip',
  text: 'text', text2: 'text-2', text3: 'text-3',
  hairline: 'hairline', hairline2: 'hairline-2',
  accent: 'accent', accentSoft: 'accent-soft',
  red: 'red', green: 'green', blue: 'blue', orange: 'orange',
  teal: 'teal', purple: 'purple', indigo: 'indigo', gray: 'gray',
  shadow: 'shadow', shadowFloat: 'shadow-float', aurora: 'aurora',
}
const CLIENT_VAR = {
  bg: 'bg', grad: 'grad', glassBorder: 'glass-border', specular: 'specular',
  surface2: 'surface2', chip: 'chip',
  text: 'text', text2: 'text2', text3: 'text3',
  hairline: 'hairline', hairline2: 'hairline-2',
  accent: 'accent', accentSoft: 'accent-soft',
  red: 'red', green: 'green', blue: 'blue', orange: 'orange',
  teal: 'teal', purple: 'purple', indigo: 'indigo', gray: 'gray',
  shadow: 'shadow', shadowFloat: 'shadow-float', aurora: 'aurora',
}
/** 规范值 → 该文件里的完整 CSS 变量名(含 `--`)。 */
export function varName(file, key) {
  const name = (file === 'client' ? CLIENT_VAR : HTML_VAR)[key]
  if (!name) throw new Error(`design-tokens: 未定义 ${file} 的变量名映射:${key}`)
  return file === 'client' ? `--d-${name}` : `--${name}`
}

/**
 * 生成一个文件的 CSS 变量块(不含选择器,只有声明行)。
 * @param {'html'|'client'} file
 * @param {'light'|'dark'} theme
 * @param {string} indent 每行缩进
 */
export function renderDecls(file, theme, indent = '  ') {
  const lines = []
  for (const key of SEMANTIC_KEYS) {
    lines.push(`${indent}${varName(file, key)}:${TOKENS[theme][key]};`)
  }
  for (const item of LOCAL[theme]) {
    if (item.file !== file) continue
    lines.push(`${indent}--${item.name}:${item.value};`)
  }
  return lines.join('\n')
}

/** 返回按文件分组的 token 计数,供 build 脚本与测试打印/断言。 */
export function tokenStats() {
  const out = {}
  for (const file of ['html', 'client']) {
    out[file] = SEMANTIC_KEYS.length + LOCAL.light.filter((t) => t.file === file).length
  }
  return out
}
