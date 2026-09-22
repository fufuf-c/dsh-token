/**
 * dsh-token — **干净 profile 安装验收**(零依赖)
 *
 * 与 verify-tarball.mjs 的区别:
 *   - verify-tarball 解包后**直接从解包目录** import,验的是"字节完整、插件能跑";
 *   - 本脚本走**真实安装路径**:建一个干净的 profile 目录 → `pnpm add <tarball>` →
 *     用宿主自己的 app-boot 解析 bundle 层 → 用 **Loader 的解析规则**
 *     (createRequire 沿 profile 的 node_modules)解析入口与 `./client` 子路径。
 *
 * 为什么必须单独验这一步:`dsh.client` 的 browser 半区是**运行时按包名解析**
 * `exports["./client"]` 的(见 dsh-client-modules 的 clientExportOf),exports 写错
 * 或子路径没发布时,Host 半区照样能起来,只有前端静默失效。直接从仓库路径 import
 * 永远碰不到这个路径。
 *
 * 用法:node scripts/verify-profile-install.mjs [path/to/pkg.tgz]
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')
const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'))
const tgz = process.argv[2] ? resolve(process.argv[2]) : join(pkgRoot, `fufuf-c-dsh-token-${pkg.version}.tgz`)
assert.ok(existsSync(tgz), `找不到 tarball:${tgz}(先跑 npm pack)`)

// Windows 上 npm / pnpm 都是 .cmd 垫片,而两种写法都不通:
//   - execFileSync('npm', …) 不带 shell → spawnSync ENOENT(不做 PATHEXT 解析)
//   - execFileSync('npm.cmd', …) 不带 shell → spawnSync EINVAL(Node 自 CVE-2024-27980
//     起拒绝无 shell 执行 .bat/.cmd)
// 所以只能带 shell:true。这里传的参数都是本脚本自己构造的固定值(tarball 路径),
// 没有外部输入拼接,注入面不存在;代价是一条 DEP0190 弃用警告。
// dsh 安装锚点:与 CLI 的 INSTALL_ANCHOR 同义(其 package.json 所在目录)。
// 全局安装的包不一定能从任意 cwd 解析(临时 profile 里没有它的依赖),所以直接
// 问 npm 自己的全局根,而不是靠 require.resolve 的搜索路径。
const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', shell: true }).trim()
const dshPkgDir = join(globalRoot, '@deepseek-ai', 'dsh')
const installAnchor = join(dshPkgDir, 'package.json')
assert.ok(existsSync(installAnchor), `解析不到 dsh 安装位置:npm root -g = ${globalRoot}`)

const work = mkdtempSync(join(tmpdir(), 'dtk-profile-'))
const profileDir = join(work, 'web')
mkdirSync(profileDir, { recursive: true })

// 1. 干净 profile:只把**本插件**列为依赖;dsh-base / dsh-web-app 是内置 bundle,
//    由宿主从**安装目录**解析(见 app-boot 的 resolveBundleDir),不该进依赖。
writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
  name: 'dsh-profile-verify',
  private: true,
  dependencies: {},
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
}, null, 2) + '\n')

// 2. 真实安装(与用户 `dsh plugin add` 之后的 pnpm 步骤等价)
execFileSync('pnpm', ['add', tgz], { cwd: profileDir, stdio: 'pipe', shell: true })
const installed = join(profileDir, 'node_modules', pkg.name)
assert.ok(existsSync(join(installed, 'package.json')), `pnpm 未把包装进 node_modules:${installed}`)
const installedPkg = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
assert.equal(installedPkg.version, pkg.version, '装到的版本应与仓库一致')
console.log(`✓ 干净 profile 安装成功:${pkg.name}@${installedPkg.version}`)

// 3. 依赖自足:包内不该有运行时 dependencies(宿主只保证 Node 内置 + 平台种子模块)
assert.deepEqual(installedPkg.dependencies ?? {}, {}, '本包不应有运行时依赖')
assert.ok(existsSync(join(installed, installedPkg.dsh.bundle.patch)), 'dsh.bundle.patch 必须随包发布')

// 3b. 登记 bundle 层。`dsh plugin add` 做的是两件事:装依赖 **且**把包写进 profile 的
// `dsh.profile.bundles`。只做前者的话,包躺在 node_modules 里但 app-boot 不会把它当作一层
// —— 下面第 5 步要验的正是"能解析成层",所以临时 profile 必须补上这一步,形态才与真实一致。
{
  const profilePkgPath = join(profileDir, 'package.json')
  const profilePkg = JSON.parse(readFileSync(profilePkgPath, 'utf8'))
  profilePkg.dsh.profile.bundles.push(pkg.name)
  writeFileSync(profilePkgPath, JSON.stringify(profilePkg, null, 2) + '\n')
}

// 4. 用 **Loader 的解析规则**解析入口与客户端子路径。
// pnpm 默认是 store + 软链接布局:createRequire 解析出的是 **realpath**(.pnpm 里的真实路径),
// 而 installed 是 node_modules 下的**软链接路径** —— 直接比字符串在 pnpm 下永远不相等,
// 所以两边都取 realpath 再比。断言的本意("解析到本包安装位置")不变。
const samePath = (a, b) => realpathSync(a) === realpathSync(b)
const req = createRequire(join(profileDir, 'package.json'))
assert.ok(samePath(req.resolve(pkg.name), join(installed, installedPkg.main)), 'main 入口必须按 exports 解析到安装目录')
assert.ok(samePath(req.resolve(`${pkg.name}/client`), join(installed, installedPkg.exports['./client'])), 'exports["./client"] 必须可解析')
assert.ok(samePath(req.resolve(`${pkg.name}/package.json`), join(installed, 'package.json')), 'package.json 子路径可解析(宿主扫描 dsh.client 需要)')
// 客户端半区必须在安装目录里真的存在(仅靠 exports 声明不够)
assert.ok(existsSync(join(installed, installedPkg.exports['./client'])), './client 指向的文件必须存在')
console.log('✓ Loader 解析规则下:main / ./client / ./package.json 全部就位')

// 5. 宿主自己的 app-boot 能把这个 bundle 解析成一层 patch(直接按安装目录的绝对路径加载)
const bootPath = join(dshPkgDir, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')
assert.ok(existsSync(bootPath), `找不到 dsh-app-boot:${bootPath}`)
const boot = await import(pathToFileURL(bootPath).href)
const layer = boot.loadProfileDirectory('verify', profileDir, installAnchor)
const mine = (layer.layers ?? []).find((l) => l.packageName === pkg.name)
assert.ok(mine, `宿主 app-boot 未把 ${pkg.name} 解析为 bundle 层(层:${(layer.layers ?? []).map((l) => l.packageName).join(', ')})`)
// 层里 patch 的字段名在 0.1.7-alpha.1 从 `patchPath`(单个字符串)改成了
// `patchPaths`(字符串数组)—— 一个 bundle 现在可以叠多层 patch。两种都认,
// 否则这条验收会在新宿主上恒失败,而失败原因看着像"本包的 patch 丢了"。
const patchPaths = mine.patchPaths ?? (mine.patchPath === undefined ? [] : [mine.patchPath])
assert.ok(patchPaths.some((p) => String(p).endsWith('cordis.patch.yml')), `patch 层路径正确(实得:${JSON.stringify(patchPaths)})`)
assert.ok((mine.patches ?? []).length > 0, 'patch 内容必须已被宿主解析出来')
console.log(`✓ 宿主 app-boot 解析出 ${layer.layers.length} 个 bundle 层,本包在其中且 patch 就位`)

rmSync(work, { recursive: true, force: true })
console.log(`\n✔ 干净 profile 安装验收通过:${tgz}`)
