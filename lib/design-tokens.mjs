export const SEMANTIC_KEYS = [
  'bg', 'grad', 'glassBorder', 'specular', 'surface2', 'chip',
  'text', 'text2', 'text3', 'hairline', 'hairline2',
  'accent', 'accentSoft', 'red', 'green', 'blue', 'orange', 'teal', 'purple', 'indigo', 'gray',
  'shadow', 'shadowFloat', 'aurora',
]

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

export const LOCAL = {
  light: [
    
    
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

export function varName(file, key) {
  const name = (file === 'client' ? CLIENT_VAR : HTML_VAR)[key]
  if (!name) throw new Error(`design-tokens: 未定义 ${file} 的变量名映射:${key}`)
  return file === 'client' ? `--d-${name}` : `--${name}`
}

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

export function tokenStats() {
  const out = {}
  for (const file of ['html', 'client']) {
    out[file] = SEMANTIC_KEYS.length + LOCAL.light.filter((t) => t.file === file).length
  }
  return out
}
