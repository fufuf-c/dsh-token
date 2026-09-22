# dsh-token

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

DSH 本地 **Token 用量统计插件**——以 Token 为第一视角:不只回答"花了多少钱、用了多少量",还回答 **Token 从哪来、缓存省了多少、哪些会话在烧 Token**。数据全部来自本地会话日志,零上传、无在线依赖。仪表盘为 Apple 风格四 Tab 界面,开箱即用。

## 亮点

- **四段 Token 构成**:未命中 / 缓存命中 / 缓存写入 / 输出,并给出**缓存省下的钱**;
- **成本诚实**:无内置价且无自定义价的模型成本计 0,但 `kpi.totals` 显式报出
  `unpricedTokens` / `unpricedModelCount`,界面与导出都标注"未计入" ——
  估算成本是"已定价部分的成本 + 未定价 token 数",不是完整账单;
- **全局筛选**:时间(今天/3天/7天/30天/自定义)+ 模型 + 会话 + 工作目录,URL 可分享;
- **会话下钻**:四联统计、逐模型构成、逐请求明细、上下文增长曲线、🔥 异常激增标记、`?session=` 深链;
- **成本与预算**:单价表(内置 DeepSeek 官方价目,高峰/空闲分档,时段可改)、月度预算
  环形进度 + 月底外推 + 80%/100% 阈值、按模型/按会话归因;
- **图表**:多模型叠加趋势(图例可逐个关)、日/周/月粒度、24 桶小时直方图、活跃度月历热力图;
- **快路径聚合**:无 `session`/`wd` 筛选时查询读 day/month 聚合索引,复杂度 **O(天数)**;
  带这两个筛选时整会话跳过(它们是会话级前缀判定)。两条路径输出等价由单测锁定;
- **落盘分片**:`store.json` 只存元数据,逐会话记录在 `shards/`;分片自带模型表,
  局部重写不会让整数下标错位;单会话损坏只影响它自己;
- **增量扫描**:未变化会话按 revision 跳过;扫描周期无变化时跳过重建与落盘;
  `retention.days` 修剪超龄记录,默认 0 = 永久保留;
- **刷新可配**:`refresh.pageSec`(页面重取,默认 60s)、`scanSec`(后台重扫,默认 300s)、
  `onOpen`(进入界面先扫一次,默认开);填 `0` 关闭;
- **store 损坏不静默清零**:形态体检不合格就改名 `store.json.corrupt-<时间戳>` 留证再从日志重建;
- **跨 DSH 版本自适应**:`sessionPersistence` 两代 API 按能力探测适配,不绑宿主版本号;
- **失败会话隔离**:被宿主确定性拒绝的老日志在冷却窗口内跳过,瞬时错误始终重试。

> 性能与实现取舍的逐条论证见 `scripts/invariants.mjs`(95 条编号不变量,
> 每条写明"锁什么、为什么、被哪个测试锁住")。
## 界面

六个视图,截图取自一份**全虚构**的示例库(18 个会话 / 474 次请求,由
`scripts/screenshot-harness.mjs` 用固定种子生成),不含任何真实使用记录。点图看原图。

> 图片挂在 Release 资产上而不是用仓库相对路径:README 同时是 npm 页,相对路径在
> npmjs.com 上会裂图,而 `raw.githubusercontent.com` 在部分网络环境下不可达。商店侧
> 以仓库里的 `screenshots.json` 为准,与这里无关。

|  |  |
| :--: | :--: |
| [![今天](https://github.com/fufuf-c/dsh-token/releases/download/v0.7.1/shot-01-today.png)](https://github.com/fufuf-c/dsh-token/releases/download/v0.7.1/shot-01-today.png)<br>今天 · 四段构成与小时分布 | [![活动](https://github.com/fufuf-c/dsh-token/releases/download/v0.7.1/shot-02-activity.png)](https://github.com/fufuf-c/dsh-token/releases/download/v0.7.1/shot-02-activity.png)<br>活动 · 趋势 / 逐模型 / 粒度切换 |
| [![会话](https://github.com/fufuf-c/dsh-token/releases/download/v0.7.1/shot-03-sessions.png)](https://github.com/fufuf-c/dsh-token/releases/download/v0.7.1/shot-03-sessions.png)<br>会话 · 排序 / 搜索 / 激增标记 | [![会话详情](https://github.com/fufuf-c/dsh-token/releases/download/v0.7.1/shot-04-session-detail.png)](https://github.com/fufuf-c/dsh-token/releases/download/v0.7.1/shot-04-session-detail.png)<br>会话详情 · 指标 / 构成 / 增长曲线 |
| [![逐请求时间线](https://github.com/fufuf-c/dsh-token/releases/download/v0.7.1/shot-05-session-growth.png)](https://github.com/fufuf-c/dsh-token/releases/download/v0.7.1/shot-05-session-growth.png)<br>逐请求时间线 · 明细表 | [![设置](https://github.com/fufuf-c/dsh-token/releases/download/v0.7.1/shot-06-settings.png)](https://github.com/fufuf-c/dsh-token/releases/download/v0.7.1/shot-06-settings.png)<br>设置 · 预算 / 单价 / 高峰时段 |

## 架构

```
web/index.html       **拼接产物**(交付物)仪表盘单页 · Apple 风格(默认页;四 Tab:iOS 大标题 / 玻璃材质 /
                     活动圆环 hero / 屏幕使用时间式图表;纯原生 JS + Canvas,单文件无外部资源)
lib/client.js        宿主直供的浏览器模块(`exports["./client"]`,手写、不经打包器):
                      四个入口 —— 侧边栏「Token 统计」= 全局面板(应用内整屏仪表盘,
                      注册在 sidebar.panellist + main,本体是 iframe 嵌 /dsh-token),
                      会话内「本会话用量」= 原生 React 单会话面板(不是 iframe),
                      设置页「Token 统计」= 插件信息面板。
                      只 require 平台种子模块 react(宿主模块表提供,非 npm 依赖)
lib/core.mjs         数据层核心(**纯数据**:store 进、结果出,不碰文件也不认识 Cordis 服务):
                      折叠、聚合、筛选、导出、价格、异常检测、
                      会话标题提取(session/title → 首条用户消息回退)、
                      day/month 聚合快路径(O(天数) 查询)+ 惰性重建、store 形态体检
                      (聚合运行时状态挂 store 的**非枚举**字段 `__agg`,单一入口 `aggState(store)`,不落盘)
lib/session-source.mjs 会话日志读取与扫描层(唯一需要 sessionPersistence 服务的一层):
                      sessionPersistence 新旧两代 API 适配、增量水位线、
                      确定性失败会话隔离 + retention 修剪
                      (依赖方向:index → session-source → core;core 不认识前两者)
lib/design-tokens.mjs 设计 token **单一来源**:两处界面的调色板/语义色/文本色/阴影
                      由 scripts/build-tokens.mjs 注入 web/src/style.css 与 lib/client.js
                      (**注入源文件**,再由 build-web 带进产物),LOCAL 里显式登记"有意不一致"的项
                      **仅构建期使用**:不在 package.json 的 files 里,运行时无任何 import
                      (由 V63b 守卫 —— 运行时 import 它会让用户侧 MODULE_NOT_FOUND)
scripts/invariants.mjs **不变量登记表**:112 条防退化守卫的"锁什么 / 为什么 / 被哪个测试锁定"
                      (V1–V73e),机器可读。test/invariants.test.mjs **双向强制**:
                      登记了没测试 → 失败;有 V 编号测试没登记 → 失败;缺号必须在 GAPS 里解释
scripts/web-parts.mjs 网页源文件的拼接清单(按序排列的文件名)
scripts/build-web.mjs 把 web/src/** 拼成 web/index.html;--check 逐字节校验(漂移即失败)
web/src/**          仪表盘源文件(HTML 外壳 + style.css + app/*.js 共 20 份)
web/index.html      **拼接产物**(交付物):仪表盘单页 · Apple 风格
lib/index.js         Host 插件外壳:扫描(sessionPersistence)、/dsh-token 路由、
                      /token-stats 命令、5 分钟增量扫描(无变化不落盘)、
                      页面缓存(按 mtime+size+外观偏好失效)+ gzip、发送时注入外观偏好、
                      POST 同源校验 + 1MB body 上限、
                      store 形态体检与损坏留证、启动自检;
                      **store 载入与分片读取为异步**(0.9.4,并发 8),
                      查询入口有空库兜底(载入完成前不返回 500)
test/                node:test 断言(397 项):数据层、价格/时段、扫描与隔离、客户端注册、
                      页面渲染、宿主语义(时区口径/未定价/惰性重建/store 体检)、
                      界面回归(配色按模型名稳定/占比口径/单桶趋势/监听幂等/自定义范围)、
                      设计 token 一致性与引用闭合、宿主适配不回退
                      (面板必须"接"宿主字体族/正文字号/底色,不允许抄成固定值)、
                      画布绘制(2D 调用序列录制:渐变档位/路径闭合/坐标有限/同输入可复现)、
                      **结构化转义**(tpl/raw 语义 + 恶意输入实测 + 源码级裸拼接守卫)、
                      **异步载入与分片重建的等价性**(与同步路径逐字段相同)、
                      **不变量登记表强制**(登记 ↔ 测试双向一致)
scripts/build.mjs    发布前完整性校验(文件、dsh 字段、各模块可解析、内联脚本语法)
scripts/build-tokens.mjs 设计 token 注入器(`--check` 用于 CI/测试,漂移即失败)
scripts/e2e-smoke.mjs 真实 http 栈端到端冒烟(零依赖,临时 DSH_HOME;含外观偏好注入与
                      「偏好进页面缓存键」:只改设置、不动页面文件,注入值也必须立刻换新)
scripts/verify-tarball.mjs 打包产物验收:把 tarball 解到全新目录当"新装"启动一遍
scripts/settings-snapshot.mjs / canvas-snapshot.mjs
                      重构安全网:把"设置页输出"与"画布 2D 调用序列"打成快照,
                      改动前后 diff 为 0 才算没改行为(还能当变异测试用:故意改坏一处,
                      确认对应的网真能抓到)
scripts/realstore-equivalence.mjs / realstore-coldscan.mjs
                      拿**本机真实 store** 比对旧版/新版全部查询,以及真实 zstd 会话日志
                      的冷启动全量重扫(多帧解码按 DSH 的 scanZstdFrames 口径逐帧解)
scripts/bench-refactor.mjs / bench-one.mjs / gen-stress-store.mjs
                      性能对照:交错采样取中位数 + 配对符号检验,可生成 20 万请求压力库
                      (这些 scripts/ 与 test/ **不打进 npm 包**,只在仓库里) 
```

数据源 = `$DSH_HOME/sessions`(默认 `~/.dsh/sessions`),经 DSH 官方 `sessionPersistence` 服务解码(`session.jsonl.zstd` 为多帧 Zstd + chunk 打包)。持久化在 `$DSH_HOME/dsh-token/`:**`store.json`** 存配置与元数据(水位线 / 隔离清单 / 统计 / 会话 meta),**`shards/<id>.json`** 存逐会话记录(0.9.0 起;备份请连目录一起备)。

### 三个入口各有明确分工

同一个插件在 DSH 界面上有三个入口,**名字不同、界面也不同** —— 避免"从不同地方点开、长得一模一样、
显示的数据却不一样"的困惑:

| 入口 | 插槽 | 名字 | 打开后是什么 |
| --- | --- | --- | --- |
| 侧边栏（全局面板区） | `sidebar.panellist` + `main` | **Token 统计** | 全量仪表盘:在应用内整屏打开(四个 Tab、图表、全局筛选、导出)。图标/行样式由外壳画,面板本体 `iframe` 嵌 `/dsh-token` |
| 对话区域上方的页签 | `conversation.view` | **本会话用量** | **只服务当前对话**的原生面板(见下)。**不嵌 iframe**,走 `/api/session?id=…&brief=1` 只取汇总 |
| 设置页 | `settings.section` | **Token 统计** | 数据源路径、缓存文件、会话/请求数、最近扫描统计 |

`/dsh-token` 单页仍可**独立打开**(同样的内容、同样的 API),面板只是把它嵌进来 ——
两者共用同一份页面,不存在"面板里一套、页面里另一套"。

**为什么侧边栏入口在 `sidebar.panellist` 而不是 `sidebar.footer.action`**:后者被外壳渲染成
`display:flex` 且**不换行**的一行,任何写死 `width:100%` 的入口都会与别的插件各占一半、
挤在设置上方;那半截宽度由外壳算出,从入口内部修不掉。`sidebar.panellist` 是面板图标位,
行样式全部由外壳负责,天然与内置面板同区同款。

**视觉规则:外壳跟随宿主,整屏视图跟随产品 —— 但凡是宿主已经表达过的偏好,一律"接"而不是"抄"。**

* 侧边栏图标位、设置页那一段 —— 它们是 DSH 外壳的一部分,用 DSH 的设计变量
  (`--dsw-alias-*`)画;图标位更是**整个交给外壳**(行高/内边距/底色/选中态都由它画),
  和旁边的面板、设置项浑然一体,不抢戏。
* 对话区域里的「本会话用量」是**一整屏视图** —— 它跟随产品:复用 `/dsh-token` 仪表盘那一套
  iOS 设计语言(液态玻璃卡片、大数字 hero、彩色图标小卡、分类条形列表),调色板与语义色
  跟仪表盘**逐一对齐**(缓存命中=绿、未命中=红、输出=蓝、缓存写入=灰,高峰=橙、空闲=蓝)。
* 但"跟随产品"只到**识别度**为止,不越过宿主已经表达过的偏好。以下四件事是**绑定**关系,
  不是抄写关系 —— 抄一份固定值会在用户改设置或宿主换主题时静默失效:

  | 维度 | 面板接的宿主变量 | 效果 |
  | --- | --- | --- |
  | 字体族 | `--dsw-font-family`(DSH 留给主题覆写的钩子) | 宿主的主题换了字体,面板与仪表盘一起跟着换 |
  | 正文字号 | `--dsh-content-font-size`(「外观」里的内容字号,12–17px) | 面板与相邻页签同一个字号;行高走 `--dsh-content-font-delta` 同步变化 |
  | 底色 | `--dsw-alias-bg-base`(会话根节点 ConversationRoot 的底色) | 面板与相邻页签无缝,切页签不会看到一大块异色 |
  | 深浅色 | `body[data-ds-dark-theme]` | 跟宿主外壳同一个开关 |

  面板自有的调色板(`--d-*`)退居**兜底**:宿主 token 缺失时(如单独打开 `web/index.html`)仍有产品底色。
* `/dsh-token` 是独立文档,看不到宿主 DOM 上的 `data-ds-dark-theme`,所以由宿主在发送页面时
  注入 `window.__DSH_TOKEN_THEME__`(读的是同一个 `ui-theme` 设置段)。页面的「自动」因此跟随
  **DSH 外观**,而不是只跟随操作系统 —— 用户把 DSH 钉成深色、系统却是浅色时,两者不会反着来。
  注入缺失(例如直接以文件打开本页)时退回"只跟随系统"。注入结果进页面缓存键,改设置立即生效。

面板内容:

| 区块 | 说明 |
| --- | --- |
| 顶部 | 「复制摘要」(把本会话用量打成纯文本进剪贴板,成功/失败都有反馈)/「刷新」/「完整仪表盘 ↗」(强调色实心胶囊) |
| hero | 42px 大数字 + 费用 + 汇总行(请求数 · 活跃天数 · 起止时刻)+ 逐小时柱 |
| 时段分布 | 24 根柱(北京时间):蓝=空闲价、橙=高峰价,并给出高峰/空闲的 token 与花费,以及**生效的规则文字** |
| 构成 | 细堆叠条 + 双列图例,每段带 **token、占比与费用** —— 直接看出"钱花在哪一段"(输出单价是缓存命中的数百倍) |
| 亮点 | 四块彩色图标小卡:缓存省下 / 缓存命中率 / 高峰时段 / 平均每次请求 |
| 按模型 | 分类条形列表:tokens、费用、请求数、占比;未定价模型明确标注 |
| 异常提示 | 有异常增长时给出次数、解释与「查看逐请求明细」深链(`?session=<id>`) |
| 脚注 | 计价口径 + 高峰规则出处 |

会话面板在库中查不到这条会话时会**自动补一次增量扫描**再复查(刚建的对话不必等 5 分钟周期)。
高峰规则文字来自服务端下发的生效配置,不在客户端写死官方时段 —— 用户改了高峰时段,面板文字跟着变。

## DSH 版本兼容

`sessionPersistence` 在 **DSH 0.1.5-rc.2** 从"按 id 直读"改写为"句柄式",本插件按能力探测同时支持两代,无需按宿主版本分发:

| 能力 | ≤ 0.1.4 | ≥ 0.1.5-rc.2 |
| --- | --- | --- |
| 列举会话 | `listSnapshots()` | `list()` |
| 读取事件 | `readFrom(id, 0)` | `open(id,'read')` → `handle.read(0)` → `handle.close()` |
| 会话头 | 返回值 `meta` | `handle.header` |
| 路径推导 | `locate(meta)` | `locate(meta)`(仍存在,仅作兜底) |

同时,**TokenUsage 口径**在 0.1.5-rc.2 明确为互斥口径:`inputTokens` 只计未命中输入,
`totalTokens = input + read + write + out`。插件据此按**等式判据**(`totalTokens === input + out`
且带缓存)识别"折叠口径"的极老日志并回退相减,`miss` 因此不再被"相减启发式"少算。

> store 结构版本随口径修正升到 **v4**;v4 → v5 是单价改为官方分档 + 高峰/空闲双价;
> v5 → v6 是小时桶从"宿主本地时区"改为"北京时间"(与高峰取档同口径)。
> 旧 store 首次加载会自动触发**一次**全量重扫,之后回到秒级增量。

### 关于 `dsh.engines` / `dsh.compatibility`

这两个字段**不是门禁**:DSH 宿主不读取它们(`dsh plugin add` 只检查 `dsh.bundle`),
`DshManifest` 类型里也没有 `compatibility`。它们的作用是给插件市场/人工核对留一份
"测过哪些宿主版本"的记录,`dsh.engines.dsh` 是**下限**而非精确集合。改宿主版本时
请一并更新这里,别让它烂成过期文档。

当前声明为 `>=0.1.5-rc.1 || >=0.1.6-0 || >=0.1.7-0`。**后两段不是冗余**:按 SemVer
规则,预发布版本不落在普通范围里 —— `0.1.6-alpha.1` **不满足** `>=0.1.5-rc.1`,
`0.1.7-alpha.1` **既不满足** `>=0.1.5-rc.1` **也不满足** `>=0.1.6-0`。只写前面几条会把
这两个预发布判成不兼容(本插件实际支持它们)。每加一条 `>=0.x-0` 才能把"0.x 及其预发布"
纳入范围。这仍然只是**声明**,不构成门禁。

### 0.1.7-alpha.1:宿主 revision 粒度回归(0.9.6 修复)

宿主 `@deepseek-ai/dsh-session-persistence-jsonl` 在 **0.1.7-alpha.1** 改了 `list()`
里 revision 的构造(对比 0.1.6-alpha.1 的同名函数):

| 宿主版本 | 遗留会话(v3）的 revision |
| --- | --- |
| ≤ 0.1.6 | `<文件身份>` = `dev:ino:size:mtimeNs:ctimeNs` |
| ≥ 0.1.7 | `<文件身份>:<整库语料哈希>`（**仅当**来源版本 < 当前格式） |

后半段是 `historicalCorpusRevision()` —— **整库所有会话文件**路径 + 各自 stat 身份的
sha256,表达的是"遗留会话的解码可能依赖兄弟文件"。但它的粒度是**整库**。

插件原先把 revision 直接当水位线(`wm.rev !== String(s.revision)`),于是任何一个文件被
新建 / 追加 / 触碰都会让**全部遗留会话**的水位线同时失效 → 每轮整库重读。实测(70 个会话,
65 个是 v3)只改 1 个文件的 mtime、内容零改动:

| 场景 | 耗时 | changed |
| --- | --- | --- |
| 无变化的一轮 | **88 ms** | 0 |
| 只改 1 个文件的 mtime | **8 512 ms** | 65 |

而页面「进入界面时先扫描」默认开启,打开面板要等整轮扫完才出数 —— 表现就是**时好时坏**。

0.9.6 起水位线只认**文件身份**,遗留会话的兄弟依赖改用"该父会话的子会话子树"
(`origin === 'subagent' && parentSession === id`,与宿主真正读的那批文件一致)精确表达:
子会话增删改只让该父会话重读,其余遗留会话不受影响。已在 0.1.7 上跑过的库无需迁移,
第一轮就是零重读。

## 安装

三种方式任选(三条路径均已实际可用):

```bash
# npm(包名 @fufuf-c/dsh-token):
dsh plugin --profile web add @fufuf-c/dsh-token
# 或 git:
dsh plugin --profile web add "git+https://github.com/fufuf-c/dsh-token.git#v0.9.6"
# 或 Release 预构建 tarball(包内自带 lib/ 与 web/,装完即可用):
dsh plugin --profile web add "https://github.com/fufuf-c/dsh-token/releases/download/v0.9.6/fufuf-c-dsh-token-0.9.6.tgz"
# 装完安装依赖并重启
cd ~/.dsh/profiles/web && pnpm install
dsh web
```

> 本包**没有打包器**:`lib/*.js`、`lib/core.mjs` 是直接发布的源文件,浏览器端
> `lib/client.js` 也由宿主直接提供。唯一的"构建"是 `web/index.html` ——
> 它由 `web/src/**`(20 份源文件)经 `scripts/build-web.mjs` **拼接**而成,
> 拼接结果与源**逐字节一致**(内联脚本是单个 IIFE + `'use strict'`,按行区间
> 切片再按同序拼回不改变语义)。**交付物始终是那个单文件 `web/index.html`**,
> 插件原样返回它,测试也直接读它 —— 拆分只为好维护,不引入多文件请求。
> tarball 与 git 安装拿到的是同一份字节。发布前的把关靠 `npm run verify`(完整性/语法校验)与
> `npm test`(397 项断言 + token/产物一致性校验),两者都挂在 `prepack` 上,所以 `npm pack` 不会漏跑。

安装后打开 `http://127.0.0.1:3080`,开箱即用:

- 仪表盘默认即为 **Apple 风格四 Tab 页**(今天 / 活动 / 会话 / 设置,底部悬浮 Tab 栏);
- 首次启动会做**一次**全量扫描(自动提取每个会话的标题),之后每次重启均为秒级增量;
- 侧边栏出现 **Token 统计** 全局面板入口(在「技能中心」等内置面板同一区,图标与行样式由外壳画);
  点击在应用内整屏打开仪表盘,`/dsh-token` 单页仍可独立打开;
- 对话区域上方出现 **本会话用量** 页签:只服务当前对话的原生面板(不嵌 iframe,内容见上表);
- 设置 → **Token 统计** 页展示数据源、扫描统计、模型清单、被跳过(隔离)的会话清单,
  并管理单价表与高峰时段;
- 斜杠命令 `/token-stats [today|3d|7d|30d|month|all]`。
- 想自定义仪表盘外观:改 `web/src/**`(源文件)后跑 `node scripts/build-web.mjs` 重新拼接
  出 `web/index.html`,Host 按 (mtime, size, 外观偏好) 失效缓存,刷新即生效,免重启。
  > ⚠ **这条只适用于 clone 仓库的场景。** npm / git / Release tarball 三种安装方式拿到的
  > 是**发布产物**:`package.json` 的 `files` 只列 `web/index.html`,`web/src/**` 与
  > `scripts/**` **不在包里**(由 V49/V50 锁定"产物在、源不在")。想改外观请先
  > `git clone https://github.com/fufuf-c/dsh-token`,再按 `scripts/web-parts.mjs` 的
  > 拼接清单改。
  **0.8.9 起不再支持 `webPagePath` 指向外部文件** —— 那条配置面只校验扩展名,
  等于给本机任意进程一个"读盘上任意 `.html`"的原语(UNC 路径还会触发对外 SMB 连接、
  外泄 NTLM 凭证),而页面字节又是同源返回的,构成脚本执行面。

与 dsh-usage-vista 系列可共存(不同 URL 前缀 / bundle id / 入口 id)。

## 路由与 API 契约

全部同源,`Cache-Control: no-store`。

| 端点 | 方法 | 说明 |
|---|---|---|
| `/dsh-token` | GET | 仪表盘单页(见"页面替换") |
| `/dsh-token/api/kpi` | GET | KPI:`?range=&models=&session=&wd=&from=&to=` |
| `/dsh-token/api/series` | GET | 序列:`?granularity=day|week|month&range=…` |
| `/dsh-token/api/hours` | GET | 24 桶小时分布(同上筛选) |
| `/dsh-token/api/heatmap` | GET | 12 个月日总量:`?months=12&…` |
| `/dsh-token/api/sessions` | GET | 会话排行:`?sort=recent|cost|tokens|requests&limit=&q=&…`(`q=` 标题/工作目录/工作区/会话 ID 子串,服务端过滤,不受 limit 截断) |
| `/dsh-token/api/session` | GET | 单会话下钻:`?id=<sessionId>`;`&brief=1` 省掉逐请求数组(会话内面板用,大会话可省成 MB 载荷)。两种模式都带节奏字段:`hours`/`hoursPeak`(24 桶,北京时间,后者是按高峰价计费的部分)、`tiers`(高峰/空闲各自的 tokens/费用/请求数)、`costParts`(四段各自花掉的钱)、`unpriced`(未定价模型的 tokens)、`activeDays`、`schedule`(生效的高峰规则) |
| `/dsh-token/api/meta` | GET | 数据源路径/会话/请求/模型/扫描统计/价格族 |
| `/dsh-token/api/config` | GET/POST | 配置:`{prices?, resetPrices?, budget?:{monthly}, retention?:{days}, refresh?:{pageSec?, scanSec?, onOpen?}, peakHours?("9-12, 14-18" 或 [[9,12],[14,18]];null=官方默认,[]=无高峰), peakDays?("1-5" 或 [1,2,3,4,5];null=默认,[]=无)}`;GET 额外返回 `defaults`(模型键 → 官方默认价,含 `peak`/`idle`)、归一化后的 `prices`、生效时段 `schedule`/`peakHours`/`peakDays` 及其官方默认值、以及 `refresh`(归一化后)+ `defaultsRefresh` + `refreshBounds`。**`webPagePath` 已在 0.8.9 移除**(传了会 400) |
| `/dsh-token/api/scan` | POST | 触发增量扫描 |
| `/dsh-token/api/export.csv` | GET | 日×模型明细(当前筛选) |
| `/dsh-token/api/export.json` | GET | 逐请求原始明细(当前筛选);**超过 10 万条时返回 413** + 可操作的原因(避免单次 68MB 响应体卡死标签页) |

**主机/来源栅栏(0.8.9 起对 GET 与 POST 一视同仁)**:请求的 `Host` 头必须落在"本机可达"白名单内 —— `localhost`/`*.localhost`、IPv4 回环(`127.0.0.0/8`)、IPv6 回环(`::1`、`::ffff:127.0.0.0/8`)、RFC1918 私网、链路本地、CGNAT、IPv6 唯一本地/链路本地放行;**域名与公网 IP 字面量一律拒绝**。域名拒绝是因为 DNS rebinding 只能借域名生效(rebind 后 `Origin.host` 与 `Host` 会同时是攻击者域名,同源等式恒真);公网 IP 字面量拒绝是因为 bind `0.0.0.0` 时任何人都能以裸 IP 访问,而浏览器发起的跨站请求的 `Origin` 必然是域名 —— 拒掉不伤任何正常用法。带 `Origin` 头时还须与 `Host` 完全一致;另拒绝 `Sec-Fetch-Site: cross-site`(与 Host 检查是两条独立线索)。主机名比较前会规范化(去尾部点、统一小写),所以 `127.0.0.1.` 与 `LOCALHOST` 不会被误拒。经 LAN 的私网 IP 访问(反代/多机)仍可写入配置,`curl` 无 `Origin` 调用照旧放行。请求体上限 1MB(超限排空剩余 body,keep-alive 不串流)。页面响应带 `Content-Security-Policy`(仅内联脚本/样式 + 同源连接)与 `X-Content-Type-Options: nosniff`;CSV 导出对 `=/+/-/@` 开头的单元格做公式注入防护。**筛选参数**(贯穿所有数据端点):`range=today|3d|7d|30d|month|all|custom`(custom 配 `from`/`to` 日键 `YYYY-MM-DD`)、`models=`(逗号分隔 `provider:model` 键)、`session=`(会话 ID 前缀)、`wd=`(工作目录前缀)。

**kpi 响应**:
```jsonc
{
  "range": { "label", "fromDay", "toDay" },
  "totals": { "miss", "read", "write", "out", "total", "requests", "cost", "saved",
              "unpricedTokens": 650,       // 无内置价且无自定义价的 tokens(cost 里记 0)
              "unpricedModelCount": 1 },   // 涉及几个模型
  "hitRate": 0.986,            // read / (miss+read+write)
  "activeSessions": 110,
  "peakDay": { "day", "tokens" },  // 无任何用量时为 null(不是 tokens 为 0 的伪日期)
  "delta": { "tokens", "cost" },   // 今日环比昨日 / 本月环比上月
  "streakDays": 9,
  "models": [{ "key", "provider", "model", "totals" }]  // 按量降序
}
```

> **时区口径**(两条并存,别混):日/月桶按**宿主本地时区**("今天"= 用户所在时区的今天);
> 小时桶(24 桶)与高峰/空闲取档按**北京时间** UTC+8,因为官方按时段计费、同一份价目必须
> 在任何宿主时区下落在同一个桶里。`/dsh-token/api/hours` 的 24 桶与
> `/dsh-token/api/session` 的 `hours`/`hoursPeak` 现在是**同一口径**;旧版本里 `/hours`
> 用的是本地 `getHours()`,非 UTC+8 宿主会与高峰高亮错开 8 小时(storage v5 → v6 已修正)。

**session 响应**:`{ id, meta{id,createdAt,cwd,parentSession,origin,delegationDepth,agentPreset,workspace}, totals, models[], requests[], requestCount, anomalies, flagged, flags[] }`;`requests[i]` = `{seq,t,m,miss,read,write,out,r(推理),i(中断),cum(累计输入),cost,saved,priced}`;`flags[i]` 0=正常 1=🔥激增 2=中断。

## 页面替换(UI 重设计指南)

**仪表盘与插件壳完全解耦**——重设计只改网页源文件,不碰数据层:

1. 编辑 `web/src/**`(外壳 HTML / `style.css` / `app/*.js`),然后 `node scripts/build-web.mjs`
   拼出 `web/index.html`;Host 按 (mtime, size, 外观偏好) 缓存页面,产物一变即失效,
   刷新页面即生效(免重启)。`npm test` 会在产物与源不一致时失败(`build-web --check`)。
   页面响应自带 gzip(`Accept-Encoding` 协商,**实测 176854 B 单页 gzip 后 47903 B(降 73%)**);
   > 0.8.9 起**不再**支持 `webPagePath` 指向包外文件:那条配置面只校验扩展名,
   > 等于一个"读盘上任意 `.html`"的原语(UNC 还会外泄 NTLM 凭证)。要换皮肤请直接改
   > 源文件;想保留改动请在 git 里维护你自己的分叉。
2. 数据获取:页面用 `fetch('/dsh-token/api/…')`,前端契约见上表(稳定,不会变);
3. 主题:页面自带 `data-theme=light|dark` + `prefers-color-scheme` 跟随,可嵌入时与 DSH
   主题一致(变量名可自行约定;深度集成可读 DSH 主题 `localStorage` 偏好);
4. 深链约定(保持不变):`?range=&models=&session=&wd=&from=&to=` 全量可分享;
   `?session=<id>` 打开会话详情弹窗。

> 新增面板时,优先复用现有端点;若确需新数据,请在 `lib/core.mjs` 增加纯查询函数
> 并在 `apiDispatch` 挂一个端点 —— 保持"core 纯函数 + 路由薄壳"结构即可。

## 价格口径

内置价目按官方页落地:[模型 & 价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)(单位 ¥ / 1M tokens)。

| 模型 | 高峰<br>未命中 / 命中 / 输出 | 空闲<br>未命中 / 命中 / 输出 |
| --- | --- | --- |
| `deepseek-flash` | 2 / 0.04 / 8 | 1 / 0.02 / 4 |
| `deepseek-v4-pro` | 9 / 0.30 / 27 | 4.5 / 0.15 / 13.5 |

**时段规则与倍率都是"当前官方策略",不是恒等式** —— 官方随时会改,所以插件里一律当作
可配置数据,不把任何一条写进逻辑:

- **高峰时段/高峰日可改**,存 `store.config` 的 `peakHours` / `peakDays`:

  ```jsonc
  { "peakHours": [[9, 12], [14, 18]], "peakDays": [1, 2, 3, 4, 5] }  // 0=周日 … 6=周六
  ```

  设置页是**点选式**:24 个小时格 + 7 个星期胶囊,点一下即时保存(去抖 500ms),没有"保存"按钮;
  下方实时回显成一句人话(如「工作日 09:00–12:00、14:00–18:00 为高峰 · 每周 35 小时」),
  并带「官方默认 / 全天 / 清空」三个预设。API/curl 另外接受紧凑文本(`9-12, 14-18` / `1-5`,
  支持跨周 `5-1`);`null` 恢复官方默认,**显式空数组 `[]` = 没有高峰时段**(字符串空则视为
  格式错误,避免输入框被清空时误清规则)。判定固定按 UTC+8(北京时间)换算,**不受宿主时区影响**;
- **两档价各自独立存放**(`{peak:{…}, idle:{…}}`),代码里**没有**"空闲 = 高峰 ÷ 2"
  这类推导 —— 官方哪天改了比例甚至改成三档,只需改数据,不必改逻辑。当前内置价目恰好
  是半价,那只是数据如此;
- 计费**逐请求取档**:每条记录按其自身时间戳落在高峰还是空闲选价,所以跨时段的日/月汇总
  自然正确(高峰时段的小时柱会明显更高);
- **缓存写入费为 0**:官方不单独收取(同样是内置数据,可覆盖);
- **按模型名分档**(仅官方 provider):`deepseek-v4-pro` 走 pro 档,其余(含旧名 `deepseek-v4-flash`、
  `deepseek-v4-flash-vision-exp`,以及 `deepseek-v4.1-flash-expires-on-0910`)走 Flash 档 ——
  官方说明旧名仍可调用但由 V4.1-Flash 承接、按 Flash 价计费。认不出的名字回退 Flash,不猜 pro;
- **定价规则:只有 DSH 内置的官方模型(`deepseek-official`)享受内置价目;其余一切
  provider(第三方中转 / 自建 / OpenRouter 等)一律不计价**,成本按 ¥0 计,并由
  `kpi.totals.unpricedTokens` / `unpricedModelCount` 显式报出"未定价"。
  之所以不再按模型名套官方价估算:中转的真实计费与官方价无关(常见高于官方),
  拿官方价乘第三方用量得到的数字**像账单但不是账单**,比老实说"没价"更容易误导。
  这些模型要精确成本,请在单价表录入自定义单价 —— 那条路径不受此规则影响;
- **自定义单价两种写法都吃**:新的 `{peak:{…}, idle:{…}}` 分时段;旧的扁平
  `{miss,hit,write,output}` 仍可读且两档同价(设置页保存时自动升级为两档写法)。
  只填高峰一档时,空闲自动跟随 —— 想要"不分时段"就只填一档。

`/dsh-token/api/config` 的 `defaults` 字段即模型键 → 官方默认价(含两档)的映射,
**缺席 = 该模型无内置价**,页面据此显示"未定价 · 按 ¥0 计",避免把"没价"误标成"官方价";
`prices` 在读取侧已归一化为两档,UI 无需分支;`peakHours` / `peakDays` 为生效值的紧凑文本,
`defaultsPeakHours` / `defaultsPeakDays` 供页面"恢复默认"按钮对照。

> 改动价目表属于**语义变更**:必须同时 +1 `STORE_VERSION`(当前 **v8**),否则水位线会按 revision
> 跳过未变化会话,存量成本永远沿用旧价。测试 `test/price.test.mjs` 把官方数字与默认时段
> 都写死为断言(改价目/改时段会立刻失败),并单独断言"这两者都能被配置覆盖";
> 时区口径与惰性重建由 `test/host-semantics.test.mjs` 锁定。

## 已知限制

- 规模上限参考(20 万请求 / 400 会话 / 120 模型的合成库,Node 24,2026-09 实测):
  落盘 = `store.json` 元数据约 **142 KB** + `shards/` 约 **10 MB**(逐会话一个分片),
  请求记录全量驻留内存,**堆占用约 59 MB**;
  冷启动 `JSON.parse` + 分片载入约 0.12 s,`rebuildAll` 约 0.42 s;
  **0.9.5 起,有会话变更的扫描周期只重折被改动的会话**(unfold 旧列表 + fold 新列表),
  不再整库重折,同时**只重写变化的分片**
  (改 2 个会话时约 0.19 s 的写量,而 0.8.x 是整库 19.98 MB / 0.17 s)。
  端到端实测(真实 `scanStore` 路径,6 万请求 / 200 会话):
  **改 2 个会话 2.7 ms,而整库重折 71.6 ms(约 27×)**;无变化仍是 0.2 ms。
  两条路都会在 `summary.aggMode` 里如实报出(`full` / `incremental` / `none`)。
  冷启动与"聚合不可用"仍走整库重折 —— 没有旧账可减时增量只会多做一轮簿记。
  稳态增量扫描实测 **34-52 ms**(无变化时只 list 一遍比对 revision,不解码任何会话),
  冷启全量约 2.1 s;扫描周期可用 `refresh.scanSec` 调整或关掉(`0`)。
  默认 `retention.days=0` 永久保留,长期大库建议开启保留期
  (如 `{"retention":{"days":365}}`)控制体积 —— 开启后稳态扫描是零写放大的。
  **`store.json` 的体积随会话数线性增长**(它每个脏周期整体重写):本机 64 会话约 32 KB,
  即每会话约 0.5 KB;数千会话时该文件会到 MB 级,这是选分片布局换来的代价,已记录在案。
  **分片布局的取舍**:单会话损坏只影响一个分片(其余照旧,该会话下轮从日志重折),
  代价是文件数为**会话数**(数千会话即数千个小文件)。逐请求导出(JSON)另有 10 万行上限,
  超过会拒绝(见路由表);
- **`store.json` 不再含逐请求记录(0.9.0 起)**:它是**元数据 + 索引**,记录在
  `shards/*.json`。备份时请连 `$DSH_HOME/dsh-token/` **整个目录**一起备份
  (只备份 `store.json` 会丢掉全部用量记录,只留下配置与标题);
- **逐请求 JSON 导出的行数上限是 10 万条**:20 万条会生成 68 MB 单个响应体,足以卡死
  标签页。需要全量请缩小时间范围,或开启保留期;
- `cost/saved/priced` 是**普通数据属性**,不是访问器(0.8.9 起):改完单价/时段后,下一次
  **查询**就会用新价(所有查询入口与落盘前都先 flush),但直接读
  `store.requests[id][i].cost` 的代码需要自己先 `flushAggregates(store)`;
- 通过**域名**反代访问仪表盘时,设置类 POST 会被拒绝(防 DNS rebinding 的代价):Host 白名单只放行回环名、私网/链路本地/CGNAT/唯一本地 IP 与回环 IPv6,**域名与公网 IP 字面量一律拒绝**。私网 IP 直连(如 `http://192.168.1.5:3080`)与 `curl`(无 `Origin`)可用;
- 仪表盘价格估算内置 **DeepSeek 官方价目**(¥/M),按官方页口径分档并区分时段 ——
  见下方「价格口径」。**只有 DSH 内置官方模型(`deepseek-official`)套用该价目;中继/自建/第三方
  路由一律无内置价**,成本计 0,需手动为它们录入自定义单价。未定价部分**不会被藏起来** ——
  `kpi.totals.unpricedTokens` / `unpricedModelCount` 显式给出,单价表显示"未定价 · 按 ¥0 计",
  会话面板与 KPI 卡片都会标注"含未定价模型,费用偏低"。**因此"估算成本"要读成
  "已定价部分的成本 + 未定价 token 数",不是完整账单;**
  > 0.8.5 起收紧了这条口径:此前第三方模型会按名字套用官方价估算,但中转实际计费与官方价
  > 无关,那个数字**像账单却不是账单**。现在改为一律不计价,由"未定价"显式报出。
- 默认永久保留全部原始请求记录(会话下钻/导出依赖);设置 `retention.days` 可按天修剪,
  修剪在扫描期执行,超龄会话整段清理;
- **被宿主拒绝的老会话无法统计**:部分 v0 老日志(插件注入过非标准事件成员,或子代理
  描述符为 v2)连 DSH 自身都拒绝迁移,插件只能跳过。这类会话进入隔离清单并计入
  `meta.quarantinedCount`(设置页/`/dsh-token/api/meta` 可见),可用 `POST /dsh-token/api/scan`
  或重启触发 `force` 重试。它们**上一次成功扫描的记录会保留**在 store 里(不会静默清零),
  只是不再更新 —— 本机实测为 18 个会话 / 549 条记录;
- **store 损坏时以"留证 + 重建"处理,不尝试原地修复**:形态体检只做结构判定
  (字段/类型/NaN),不合格就改名成 `store.json.corrupt-<时间戳>` 再从会话日志重建。
  这样不会丢数据、也不会丢证据,但**配置**(自定义单价、预算、保留期)
  会随之回默认 —— 因为它们只存在 store 里,日志里没有。想保住配置,请把
  `$DSH_HOME/dsh-token/` **整个目录**一起备份(0.9.0 起用量记录在 `shards/`,`store.json`
  只是元数据与索引;单独备份 `store.json` 会丢掉全部用量记录);
- **小时桶/高峰判定固定北京时间**(UTC+8),不跟随宿主时区,也不可配置;日/月桶按宿主
  本地时区。两者口径不同是有意的:前者对齐官方计费,后者对齐用户对"今天"的直觉;
- 单价表按 DSH settings 里的模型目录过滤。命名空间形态已知两种(`llm-pi-ai` 的
  `providers.<路由>.models[]`,以及适配器自带命名空间的顶层 `models[]`,provider 名靠一张
  小映射表补全)。**任何解析不出来时一律关闭过滤显示全部**,并在启动日志里打印所见的命名
  空间名(不含任何值)—— 所以"读不到配置"只会退回旧行为,不会把界面清空;
- 配置在 `$DSH_HOME/dsh-token/store.json`,用量记录在同目录 `shards/`(均未走
  `settings.register`,动态插件沙箱无法构造 schemastery schema);单价表只**读**
  DSH settings,从不写它,且只取 `provider:model` 标识,settings 原文(含凭据相关字段)
  绝不进入 API 载荷;
- 会话标题取 DSH 的自动生成标题(`session/title` 事件),缺省回退首条用户消息。

## 开发与验证

```bash
npm test                # 397 项断言 + token/产物一致性检查
npm run verify          # 发布前完整性校验(文件 / dsh 字段 / 模块可解析 / 内联脚本语法)
npm run e2e             # 真实 http 栈端到端冒烟(临时 DSH_HOME,零依赖)
npm run tokens          # 改完 lib/design-tokens.mjs 后重新注入两处界面
npm pack && npm run verify:tarball   # 打包后把 tarball 解到全新目录当"新装"再验一遍
npm run verify:profile      # 建干净 profile → pnpm add → 用宿主 app-boot 解析成 bundle 层
                            #（唯一能验 exports["./client"] 子路径可解析的一步）
node scripts/screenshot-harness.mjs  # 起合成数据实例(全虚构会话),重拍商店截图用
```

`assets/` 里的商店截图由 `scripts/screenshot-harness.mjs` 起一个**全虚构**会话数据的
临时实例拍摄(`screenshots.json` 按展示顺序列出)。截图永远不取自真实使用记录 ——
重拍不会带出任何真实会话标题或用量的风险。

`npm test` 与 `npm run verify` 都挂在 `prepack` 上,因此 `npm pack` / `npm publish`
不会漏跑。CI 除 Node 20/22 双版本外,还另有一条**跨时区**任务
(`America/New_York` / `UTC` / `Asia/Shanghai` / `Pacific/Kiritimati`)——
本插件有两条并存的时区口径(日/月桶按宿主本地,小时桶与高峰取档按北京时间),
只在本机(UTC+8)跑测不出任何东西:历史上真出过一次"小时图与高峰高亮在非 UTC+8
宿主上错开 8 小时",而当时断言全绿。

改配色请只改 `lib/design-tokens.mjs`(它注入 `web/src/style.css` 与 `lib/client.js`
的 token 块是生成物,`--check` 会挡住手改;`web/index.html` 是拼接产物,同样不要手改)。

## 许可

MIT
