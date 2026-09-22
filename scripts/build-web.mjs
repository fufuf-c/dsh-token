import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { PARTS } from './web-parts.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_DIR = join(root, 'web', 'src')
const OUT = join(root, 'web', 'index.html')
const check = process.argv.includes('--check')

export function buildFrom(srcDir = SRC_DIR) {
  const chunks = []
  for (const rel of PARTS) {
    const p = join(srcDir, rel)
    if (!existsSync(p)) throw new Error(`缺少源文件: web/src/${rel}`)
    chunks.push(readFileSync(p, 'utf8'))
  }
  return chunks.join('')
}

const built = buildFrom()
const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null

if (check) {
  if (current === null) {
    console.error('web/index.html 不存在(运行 node scripts/build-web.mjs)')
    process.exit(1)
  }
  if (current !== built) {
    console.error(`web/index.html 与 web/src/** 不一致(${Buffer.byteLength(current)} B → ${Buffer.byteLength(built)} B)`)
    process.exit(1)
  }
  console.log(`web/index.html 与 web/src/** 一致(${(Buffer.byteLength(built) / 1024).toFixed(1)} KB, ${PARTS.length} 份)`)
} else {
  writeFileSync(OUT, built)
  console.log(`web/index.html 已拼接(${(Buffer.byteLength(built) / 1024).toFixed(1)} KB, ${PARTS.length} 份)`)
}
