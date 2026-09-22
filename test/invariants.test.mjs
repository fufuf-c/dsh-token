/**
 * dsh-token — **不变量登记表强制性校验**(node:test,零依赖)
 *
 * scripts/invariants.mjs 是"有哪些防退化守卫、各自为什么存在"的单一来源。
 * 但一份**文档**如果没人校验,三个月后就会变成谎言 —— 这条测试的作用就是让它
 * 无法静默过期。三个方向都强制:
 *
 *   1. **登记 → 测试**:每条登记必须真的能在对应文件里找到同编号的测试;
 *      找不到说明守卫被删了(或测试被删了),而登记表还挂着它 —— 这正是最危险的状态:
 *      读者以为有网,实际没有。
 *   2. **测试 → 登记**:每个 V-编号测试都必须被登记;新增守卫不写理由会被拦下。
 *   3. **编号纪律**:不得重复;不得复用已删除的编号;缺号必须在 GAPS 里有解释。
 *
 * 另外校验 title 与测试标题一致(避免两边各改一半,搜索时对不上)。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { INVARIANTS, GAPS, invariantIds } from '../scripts/invariants.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const testDir = join(root, 'test')

/** 扫出所有测试文件里的 V-编号测试:{ id -> {file, line, title} } */
function scanInvariantTests() {
  const found = new Map()
  const dupes = []
  for (const f of readdirSync(testDir).filter((x) => x.endsWith('.mjs')).sort()) {
    const lines = readFileSync(join(testDir, f), 'utf8').split(/\r?\n/)
    lines.forEach((L, i) => {
      const m = /test\(\s*'(V\d+[a-z]*)\s*[:：]\s*([^']*)'/.exec(L)
      if (!m) return
      const id = m[1]
      const rec = { file: f, line: i + 1, title: m[2].trim() }
      if (found.has(id)) dupes.push(`${id}: ${found.get(id).file}:${found.get(id).line} 与 ${f}:${i + 1}`)
      found.set(id, rec)
    })
  }
  return { found, dupes }
}

const { found, dupes } = scanInvariantTests()
const registered = new Map(INVARIANTS.map((x) => [x.id, x]))

test('V-REG1: 编号不得重复(重复编号会让"某条守卫"指向两个地方)', () => {
  assert.deepEqual(dupes, [], `重复的 V 编号:\n${dupes.join('\n')}`)
})

test('V-REG2: 每条登记都必须真的有一个同编号的测试(否则是"以为有网,实际没有")', () => {
  const missing = []
  for (const inv of INVARIANTS) {
    if (!found.has(inv.id)) missing.push(`${inv.id} (${inv.file}) — ${inv.title}`)
  }
  assert.deepEqual(missing, [], `登记了但找不到对应测试:\n${missing.join('\n')}`)
})

test('V-REG3: 每个 V-编号测试都必须被登记(新增守卫必须写清为什么存在)', () => {
  const unregistered = []
  for (const [id, rec] of found) {
    if (!registered.has(id)) unregistered.push(`${id} @ ${rec.file}:${rec.line} — ${rec.title}`)
  }
  assert.deepEqual(unregistered, [], `以下守卫没有登记理由(请写进 scripts/invariants.mjs):\n${unregistered.join('\n')}`)
})

test('V-REG4: 登记的 file 字段必须与测试实际所在的文件一致', () => {
  // 登记的 file 写的是**仓库相对路径**(test/xxx.mjs),而扫描出来的只是文件名。
  // 比较前统一成"相对仓库根的路径",这样两种写法都能容忍,不必强迫其中一方。
  const rel = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '')
  const wrong = []
  for (const inv of INVARIANTS) {
    const rec = found.get(inv.id)
    if (!rec) continue
    if (rel(rec.file) !== rel(inv.file) && !rel(inv.file).endsWith(rel(rec.file))) {
      wrong.push(`${inv.id}: 登记为 ${inv.file},实际在 ${rec.file}`)
    }
  }
  assert.deepEqual(wrong, [], `文件归属不一致:\n${wrong.join('\n')}`)
})

test('V-REG5: 登记的 title 必须与测试标题一致(否则两边各改一半,搜索对不上)', () => {
  const norm = (s) => s.replace(/\s+/g, ' ').replace(/[""]/g, '"').trim()
  const mismatch = []
  for (const inv of INVARIANTS) {
    const rec = found.get(inv.id)
    if (rec && norm(rec.title) !== norm(inv.title)) {
      mismatch.push(`${inv.id}\n  登记: ${norm(inv.title)}\n  测试: ${norm(rec.title)}`)
    }
  }
  assert.deepEqual(mismatch, [], `标题不一致(请同步一处):\n${mismatch.join('\n')}`)
})

test('V-REG6: 缺号必须在 GAPS 里有解释(编号不连续必须可查)', () => {
  const nums = invariantIds().map((id) => Number(id.replace(/^V(\d+).*$/, '$1')))
  const max = Math.max(...nums)
  const present = new Set(nums)
  const unexplained = []
  for (let n = 1; n <= max; n++) {
    if (present.has(n)) continue
    if (!GAPS['V' + n]) unexplained.push('V' + n)
  }
  assert.deepEqual(unexplained, [], `以下编号缺失且未在 GAPS 里说明原因:${unexplained.join(', ')}`)
})

test('V-REG7: GAPS 里登记的编号不得其实存在(否则解释是错的)', () => {
  const present = new Set(invariantIds())
  const bogus = Object.keys(GAPS).filter((id) => present.has(id))
  assert.deepEqual(bogus, [], `GAPS 里这些编号其实有测试,不该登记为"不存在":${bogus.join(', ')}`)
})

test('V-REG8: 每条登记都必须有 why(理由不得留空)', () => {
  const empty = INVARIANTS.filter((x) => !x.why || x.why.trim().length < 10).map((x) => x.id)
  assert.deepEqual(empty, [], `以下登记缺少 why(或理由过短):${empty.join(', ')}`)
})

test('V-REG9: kind 必须是三个已知取值之一', () => {
  const allowed = new Set(['behavior', 'structure', 'contract'])
  const bad = INVARIANTS.filter((x) => !allowed.has(x.kind)).map((x) => `${x.id}=${x.kind}`)
  assert.deepEqual(bad, [], `未知 kind:${bad.join(', ')}`)
})

test('V-REG10: 登记的文件必须存在于 test/ 下(不得指向已删除的文件)', () => {
  const gone = INVARIANTS.filter((x) => !existsSync(join(root, x.file))).map((x) => `${x.id} → ${x.file}`)
  assert.deepEqual(gone, [], `登记指向不存在的文件:${gone.join(', ')}`)
})

test('V-REG11: 登记表必须覆盖足够多的守卫(防止有人把整张表清空来让测试变绿)', () => {
  // 清空 INVARIANTS 会让 REG2~REG10 全部"通过"(空集合没有反例),所以需要一条
  // 下限断言。数字取当前条数,新增守卫只会让它更大;删守卫时必须显式下调这里,
  // 而那一步是**显式的**,不会被当成"顺手清理"。
  assert.ok(INVARIANTS.length >= 107, `登记条数异常偏少(${INVARIANTS.length})—— 是不是被清空了?`)
  assert.ok(found.size >= 107, `扫描到的 V 测试数异常偏少(${found.size})`)
})
