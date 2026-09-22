/**
 * dsh-token — 画布绘制调用序列快照(开发期工具,不进包)
 *
 * 为什么会需要:`test/canvas-draw.test.mjs` 只对关键结构做断言(渐变档位/closePath/
 * 坐标有限),不锁住全部调用。抽取/合并绘制代码时,需要的是**逐字节**证明"画出来的
 * 东西一模一样" —— 这个脚本把五个绘制函数在固定输入下的完整 2D 调用序列打印出来,
 * 重构前后各跑一次、diff 为 0 才算真的没改。
 *
 * 用法:
 *   node scripts/canvas-snapshot.mjs > before.txt
 *   (重构)
 *   node scripts/canvas-snapshot.mjs > after.txt
 *   diff before.txt after.txt     # 应为空
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import vm from 'node:vm'

const root = process.cwd()
const src = readFileSync(join(root, 'test', 'canvas-draw.test.mjs'), 'utf8')

// 复用测试文件的垫片 + 造数据函数:截到**第一个真正的绘制测试**之前
// (L189-240 是 T0/makeSeries/makeHours/makeReqs,必须包进来)
const cut = src.indexOf("test('renderTrend:折线+面积分支")
if (cut < 0) throw new Error('未能定位测试文件的垫片区段')
let setup = src.slice(0, cut)
// 只删 test 相关的 import,垫片运行仍需 vm/fs/path/assert
setup = setup.replace(/^import \{ test \} from 'node:test'$/m, '')
setup = setup.replace(/^import \{ dirname, join \} from 'node:path'$/m, "import { dirname, join } from 'node:path'")
setup = setup.replace(/const root = .*$/m, `const root = ${JSON.stringify(root)}`)
// 去掉垫片自身那条 test(...),它只断言函数存在,这里不需要
setup = setup.replace(/test\('画布测试垫片[\s\S]*?\n\}\)\n/, '')
setup += '\nexport { page, getEl, makeRecorder, els, makeSeries, makeHours, makeReqs }\n'

const dir = mkdtempSync(join(tmpdir(), 'dtk-canvas-'))
const modPath = join(dir, 'shim.mjs')
writeFileSync(modPath, setup)
const m = await import('file:///' + modPath.replace(/\\/g, '/'))
rmSync(dir, { recursive: true, force: true })

const { page, getEl, makeRecorder, els, makeSeries, makeHours, makeReqs } = m

/** 在指定 canvas 上跑一次绘制,返回调用序列 JSON */
function capture(canvasId, state, fn) {
  Object.assign(page.state, state)
  const el = getEl(canvasId)
  el.__rec = makeRecorder()
  fn()
  return el.__rec.calls
}

const out = []
const dump = (label, calls) => {
  out.push(`===== ${label} =====`)
  for (const c of calls) {
    // 渐变的 addColorStop 挂在数组尾部,单独展开
    const parts = c.slice(1).map((a) => JSON.stringify(a))
    out.push(`  ${c[0]}(${parts.join(', ')})`)
  }
  out.push(`  -- 调用数 ${calls.length}`)
}

// ---- 1. 趋势图 · 折线+面积分支(必须避开 stacked) ----
{
  const series = makeSeries(14, ['m-a', 'm-b'])
  dump('renderTrend 折线+面积 (metric=tokens, gran=month, 14 点 2 模型)',
    capture('trend-canvas', { metric: 'tokens', granularity: 'month', hidden: {}, stkSel: null }, () => page.renderTrend(series)))
}
// ---- 1b. 趋势图 · 全部模型被隐藏(此时模型线循环不执行,lineJoin 靠继承) ----
{
  const series = makeSeries(14, ['m-a', 'm-b'])
  dump('renderTrend 折线+面积 · 模型全隐藏 (hidden 全 true)',
    capture('trend-canvas', { metric: 'tokens', granularity: 'month', hidden: { 'm-a': 1, 'm-b': 1 }, stkSel: null }, () => page.renderTrend(series)))
}
// ---- 2. 趋势图 · 堆叠柱分支 ----
{
  const series = makeSeries(10, ['m-a'])
  dump('renderTrend 堆叠柱 (metric=tokens, gran=day, 10 点 1 模型)',
    capture('trend-canvas', { metric: 'tokens', granularity: 'day', hidden: {}, stkSel: null }, () => page.renderTrend(series)))
}
// ---- 3. 趋势图 · 单点边界 ----
{
  const series = makeSeries(1, ['m-a'])
  dump('renderTrend 单点 (n=1)',
    capture('trend-canvas', { metric: 'tokens', granularity: 'month', hidden: {}, stkSel: null }, () => page.renderTrend(series)))
}
// ---- 4. 小时图(today 模式与非 today 模式) ----
{
  dump('drawHours (today 模式, 峰值在 18 点)',
    capture('hours', {}, () => page.drawHours('hours', makeHours(18), 120, null, true)))
  dump('drawHours (非 today 模式, 峰值在 9 点)',
    capture('hours', {}, () => page.drawHours('hours', makeHours(9), 120, null, false)))
}
// ---- 5. 上下文增长曲线(多点 / 单点 / 跨天) ----
{
  dump('drawCurve (40 点, 同一天)', capture('dm-curve', {}, () => page.drawCurve(makeReqs(40))))
  dump('drawCurve (1 点)', capture('dm-curve', {}, () => page.drawCurve(makeReqs(1))))
  // 跨天:让时间跨度超过一天,触发不同的轴标签分支
  const multiDay = makeReqs(30).map((r, i) => Object.assign({}, r, { t: r.t + i * 4 * 3600 * 1000 }))
  dump('drawCurve (30 点, 跨天)', capture('dm-curve', {}, () => page.drawCurve(multiDay)))
}
// ---- 6. 逐请求堆叠(30 条 / 1200 条降采样) ----
{
  dump('drawStack (30 条)', capture('dm-stack', {}, () => page.drawStack(makeReqs(30))))
  dump('drawStack (1200 条 -> 降采样 500)', capture('dm-stack', {}, () => page.drawStack(makeReqs(1200))))
}

process.stdout.write(out.join('\n') + '\n')
