# dsh-token

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

DSH 本地 **Token 用量统计插件**——以 Token 为第一视角:不只回答"花了多少钱、用了多少量",还回答 **Token 从哪来、缓存省了多少、哪些会话在烧 Token**。数据全部来自本地会话日志,零上传、无在线依赖。仪表盘为 Apple 风格四 Tab 界面,开箱即用。

## 亮点

- **四段 Token 构成**:未命中 / 缓存命中 / 缓存写入 / 输出(不是简单的总量);
- **缓存省钱估算**:命中量 × 未命中与命中的价差(核心差异化);
- **成本诚实度**:未定价模型(无内置价且无自定义价)的成本一律计 0,但**绝不冒充完整成本** ——
  `kpi.totals` 显式给出 `unpricedTokens` / `unpricedModelCount`,KPI 卡片与导出里都标注了
  这部分"未计入";单价表只列当前配置的模型,其余收进"显示全部";
- **全局筛选贯穿所有面板**:时间(今天/3天/7天/30天/自定义)+ 模型多选 + 会话 + 工作目录,URL 可分享;
- **会话下钻**:四联统计、逐模型构成、逐请求明细、**上下文增长曲线**、**🔥 异常激增标记**、`?session=` 深链;
- **成本与预算**:模型单价表(¥/M,**内置 DeepSeek 官方价目、高峰/空闲分档计价,时段规则可自行修改**、按模型覆盖 + 一键重置)、月度预算环形进度 + 外推月底预估 + 80%/100% 阈值变色、按模型/按会话成本归因;
- **聚合快路径查询**:查询直接读 day/month 聚合索引(复杂度 O(天数) 而非 O(请求数),10 万条请求库 kpi 25ms→1ms);带 `session`/`wd` 筛选自动回退逐记录路径,两条路径输出等价由单测锁定;
- **增量扫描,空闲零写放大**:未变化会话按 revision 跳过(变更文件才整段重折);常规重启只做增量;扫描周期无变化时跳过整库重建与落盘;扫描产物落盘合并(可重建缓存,最短 10 分钟写一次,配置变更立即落盘,退出兜底 flush);store.json 原子写(临时文件 + 改名);
- **配置变更不触发全量重建**:单价/时段改动只置脏标记,重建推迟到**下一次读取**执行一次
  (聚合入口 flush,或读某条记录成本时按需 flush)。设置页是点选式交互,连点 24 个小时格
  也不会引发 24 次全量重建,而"改完单价立刻读到的就是新价"这一行为不变;
- **store 损坏不静默清零**:读取时先做形态体检(字段缺失/类型错乱/NaN 一律不合格),
  不合格就把原文件改名成 `store.json.corrupt-<时间戳>` 留证,再从会话日志重建,
  绝不让下一次落盘把用户历史覆盖成"干净的空库";
- **跨 DSH 版本自适应**:`sessionPersistence` 两代 API(旧的 `listSnapshots`/`readFrom` 与 0.1.5-rc.2 起的 `list`/`open`+句柄 `read`)按**能力探测**适配,插件不绑定宿主版本号;
- **失败会话隔离**:被宿主确定性拒绝的老格式/损坏日志(如 `SessionFormatUnsupportedError`)在冷却窗口内跳过重试,不会每 5 分钟被整段重解码一遍;revision 变化、冷却期到期或 `force` 全量扫描都会自动重试,瞬时错误(IO 抖动、写租约冲突)始终留在重试路径上;
- **配置面只列当前配置的模型**:模型清单本身来自历史用量、只增不减 —— 在 DSH 里删掉模型配置后历史账单仍在,列表不会缩;而"最近 N 天用过"也区分不出已删配置(删除往往紧随其近期使用之后)。所以**单价表**改由 DSH settings 驱动,只列「当前仍配置在 DSH 里」∪「已自定义单价」的模型,其余收进「显示全部」开关。历史用量 / 导出 / 会话下钻 / 仪表盘「按模型」一概不受影响(否则报表会和总额对不上);
- **保留期可配**:`retention.days` 修剪超龄原始记录,防止内存与 store.json 无界增长(默认 0 = 永久保留);
- **多模型叠加趋势图** + 图例逐模型独立开关 + 日/周/月粒度 + 24 桶小时直方图(峰值高亮) + 12 个月活跃热力图(日/周/累计)。

## 界面

六个视图,截图取自一份**全虚构**的示例库(18 个会话 / 474 次请求,由
`scripts/screenshot-harness.mjs` 用固定种子生成),不含任何真实使用记录。点图看原图。

|  |  |
| :--: | :--: |
| [![今天](https://raw.githubusercontent.com/fufuf-c/dsh-token/main/assets/01-today.png)](https://raw.githubusercontent.com/fufuf-c/dsh-token/main/assets/01-today.png)<br>今天 · 四段构成与小时分布 | [![活动](https://raw.githubusercontent.com/fufuf-c/dsh-token/main/assets/02-activity.png)](https://raw.githubusercontent.com/fufuf-c/dsh-token/main/assets/02-activity.png)<br>活动 · 趋势 / 逐模型 / 粒度切换 |
| [![会话](https://raw.githubusercontent.com/fufuf-c/dsh-token/main/assets/03-sessions.png)](https://raw.githubusercontent.com/fufuf-c/dsh-token/main/assets/03-sessions.png)<br>会话 · 排序 / 搜索 / 激增标记 | [![会话详情](https://raw.githubusercontent.com/fufuf-c/dsh-token/main/assets/04-session-detail.png)](https://raw.githubusercontent.com/fufuf-c/dsh-token/main/assets/04-session-detail.png)<br>会话详情 · 指标 / 构成 / 增长曲线 |
| [![逐请求时间线](https://raw.githubusercontent.com/fufuf-c/dsh-token/main/assets/05-session-growth.png)](https://raw.githubusercontent.com/fufuf-c/dsh-token/main/assets/05-session-growth.png)<br>逐请求时间线 · 明细表 | [![设置](https://raw.githubusercontent.com/fufuf-c/dsh-token/main/assets/06-settings.png)](https://raw.githubusercontent.com/fufuf-c/dsh-token/main/assets/06-settings.png)<br>设置 · 预算 / 单价 / 高峰时段 |

## 架构

```
web/index.html       仪表盘单页 · Apple 风格(默认页;四 Tab:iOS 大标题 / 玻璃材质 /
                     活动圆环 hero / 屏幕使用时间式图表;纯原生 JS + Canvas,零构建)
lib/client.js        宿主直供的浏览器模块(`exports["./client"]`,手写、不经打包器):
                      三个入口 —— 侧边栏「Token 统计」= 全量仪表盘(新开单页),
                      会话内「本会话用量」= 原生 React 单会话面板(不是 iframe),
                      设置页「Token 统计」= 插件信息面板。
                      只 require 平台种子模块 react(宿主模块表提供,非 npm 依赖)
lib/core.mjs         数据层核心(**纯数据**:store 进、结果出,不碰文件也不认识 Cordis 服务):
                      折叠、聚合、筛选、导出、价格、异常检测、
                      会话标题提取(session/title → 首条用户消息回退)、
                      day/month 聚合快路径(O(天数) 查询)+ 惰性重建、store 形态体检
lib/session-source.mjs 会话日志读取与扫描层(唯一需要 sessionPersistence 服务的一层):
                      sessionPersistence 新旧两代 API 适配、增量水位线、
                      确定性失败会话隔离 + retention 修剪
                      (依赖方向:index → session-source → core;core 不认识前两者)
lib/design-tokens.mjs 设计 token **单一来源**:两处界面的调色板/语义色/文本色/阴影
                      由 scripts/build-tokens.mjs 注入 web/index.html 与 lib/client.js,
                      LOCAL 里显式登记"有意不一致"的项
lib/index.js         Host 插件外壳:扫描(sessionPersistence)、/dsh-token 路由、
                      /token-stats 命令、5 分钟增量扫描(无变化不落盘)、
                      页面缓存(按 path+mtime+外观偏好失效)+ gzip、发送时注入外观偏好、
                     POST 同源校验 + 1MB body 上限、
                      store 形态体检与损坏留证、启动自检
test/                node:test 断言(143 项):数据层、价格/时段、扫描与隔离、客户端注册、
                      页面渲染、宿主语义(时区口径/未定价/惰性重建/store 体检)、
                      设计 token 一致性与引用闭合、宿主适配不回退
                      (面板必须"接"宿主字体族/正文字号/底色,不允许抄成固定值)
scripts/build.mjs    发布前完整性校验(文件、dsh 字段、各模块可解析、内联脚本语法)
scripts/build-tokens.mjs 设计 token 注入器(`--check` 用于 CI/测试,漂移即失败)
scripts/e2e-smoke.mjs 真实 http 栈端到端冒烟(零依赖,临时 DSH_HOME;含外观偏好注入与
                      「偏好进页面缓存键」:只改设置、不动页面文件,注入值也必须立刻换新)
scripts/verify-tarball.mjs 打包产物验收:把 tarball 解到全新目录当"新装"启动一遍
                      (这些 scripts/ 与 test/ **不打进 npm 包**,只在仓库里) 
```

数据源 = `$DSH_HOME/sessions`(默认 `~/.dsh/sessions`),经 DSH 官方 `sessionPersistence` 服务解码(`session.jsonl.zstd` 为多帧 Zstd + chunk 打包)。聚合与配置持久化于 `$DSH_HOME/dsh-token/store.json`。

### 三个入口各有明确分工

同一个插件在 DSH 界面上有三个入口,**名字不同、界面也不同** —— 避免"从不同地方点开、长得一模一样、
显示的数据却不一样"的困惑:

| 入口 | 插槽 | 名字 | 打开后是什么 |
| --- | --- | --- | --- |
| 侧边栏 | `sidebar.footer.action` | **Token 统计** | 全量仪表盘:新开标签页加载 `/dsh-token`(四个 Tab、图表、全局筛选、导出) |
| 对话区域上方的页签 | `conversation.view` | **本会话用量** | **只服务当前对话**的原生面板(见下)。**不嵌 iframe**,走 `/api/session?id=…&brief=1` 只取汇总 |
| 设置页 | `settings.section` | **Token 统计** | 数据源路径、缓存文件、会话/请求数、最近扫描统计 |

**视觉规则:外壳跟随宿主,整屏视图跟随产品 —— 但凡是宿主已经表达过的偏好,一律"接"而不是"抄"。**

* 侧边栏那一行、设置页那一段 —— 它们是 DSH 外壳的一部分,用 DSH 的设计变量
  (`--dsw-alias-*`)画,和旁边的侧边栏、设置项浑然一体,不抢戏。
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

## 安装

三种方式任选(三条路径均已实际可用):

```bash
# npm(包名 @fufuf-c/dsh-token):
dsh plugin --profile web add @fufuf-c/dsh-token
# 或 git:
dsh plugin --profile web add "git+https://github.com/fufuf-c/dsh-token.git#v0.7.1"
# 或 Release 预构建 tarball(包内自带 lib/ 与 web/,装完即可用):
dsh plugin --profile web add "https://github.com/fufuf-c/dsh-token/releases/download/v0.7.1/fufuf-c-dsh-token-0.7.1.tgz"
# 装完安装依赖并重启
cd ~/.dsh/profiles/web && pnpm install
dsh web
```

> 本包**没有构建步骤**:`lib/*.js`、`lib/core.mjs`、`web/index.html` 就是写死直接发布的
> 源文件,浏览器端 `lib/client.js` 也由宿主直接提供,不经过打包器。tarball 与 git 安装
> 拿到的是同一份字节。发布前的把关靠 `npm run verify`(完整性/语法校验)与
> `npm test`(143 项断言),两者都挂在 `prepack` 上,所以 `npm pack` 不会漏跑。

安装后打开 `http://127.0.0.1:3080`,开箱即用:

- 仪表盘默认即为 **Apple 风格四 Tab 页**(今天 / 活动 / 会话 / 设置,底部悬浮 Tab 栏);
- 首次启动会做**一次**全量扫描(自动提取每个会话的标题),之后每次重启均为秒级增量;
- 侧边栏底部出现 **Token 统计** 入口(wide 满宽行 / narrow 36×36 圆钮,order 0 顶置);
- 对话区域上方出现 **本会话用量** 页签:只服务当前对话的原生面板(不嵌 iframe,内容见上表);
- 设置 → **Token 统计** 页展示数据源、扫描统计、模型清单,并管理单价表与高峰时段;
- 斜杠命令 `/token-stats [today|3d|7d|30d|month|all]`;
- 想替换仪表盘页面(自定义皮肤):`POST /dsh-token/api/config {"webPagePath":"<html 绝对路径>"}`,刷新即生效。

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
| `/dsh-token/api/config` | GET/POST | 配置:`{prices?, resetPrices?, budget?:{monthly}, webPagePath?(.html/.htm), retention?:{days}, peakHours?("9-12, 14-18" 或 [[9,12],[14,18]];null=官方默认,[]=无高峰), peakDays?("1-5" 或 [1,2,3,4,5];null=默认,[]=无)}`;GET 额外返回 `defaults`(模型键 → 官方默认价,含 `peak`/`idle`)、归一化后的 `prices`、生效时段 `schedule`/`peakHours`/`peakDays` 及其官方默认值 |
| `/dsh-token/api/scan` | POST | 触发增量扫描 |
| `/dsh-token/api/export.csv` | GET | 日×模型明细(当前筛选) |
| `/dsh-token/api/export.json` | GET | 逐请求原始明细(当前筛选) |

**POST 安全**:带 `Origin` 头的请求必须与 `Host` 头完全一致,且 `Host` 必须落在"本机可达地址"白名单内 —— `localhost`/`*.localhost`、IPv4 回环(`127.0.0.0/8`)、IPv6 回环(`::1`、`::ffff:127.0.0.0/8`)、RFC1918 私网、链路本地、CGNAT、IPv6 唯一本地/链路本地放行;**域名与公网 IP 字面量一律拒绝**。域名拒绝是因为 DNS rebinding 只能借域名生效(rebind 后 `Origin.host` 与 `Host` 会同时是攻击者域名,同源等式恒真);公网 IP 字面量拒绝是因为 bind `0.0.0.0` 时任何人都能以裸 IP 访问,而浏览器发起的跨站请求的 `Origin` 必然是域名 —— 拒掉不伤任何正常用法。经 LAN 的私网 IP 访问(反代/多机)仍可写入配置,`curl` 无 `Origin` 调用照旧放行。请求体上限 1MB(超限排空剩余 body,keep-alive 不串流);`webPagePath` 仅接受 `.html`/`.htm`。页面响应带 `Content-Security-Policy`(仅内联脚本/样式 + 同源连接)与 `X-Content-Type-Options: nosniff`;CSV 导出对 `=/+/-/@` 开头的单元格做公式注入防护。**筛选参数**(贯穿所有数据端点):`range=today|3d|7d|30d|month|all|custom`(custom 配 `from`/`to` 日键 `YYYY-MM-DD`)、`models=`(逗号分隔 `provider:model` 键)、`session=`(会话 ID 前缀)、`wd=`(工作目录前缀)。

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

**仪表盘是独立单页,与插件壳完全解耦**——重设计只改一个文件,不碰数据层:

1. 直接编辑 `web/index.html`(或另建新文件)并替换;Host 按 (路径, mtime) 缓存页面,
   文件一变即失效,刷新页面即生效(免重启;也可通过
   `POST /dsh-token/api/config {"webPagePath":"<.html/.htm 绝对路径>"}` 指向仓库外的设计稿);
   页面响应自带 gzip(`Accept-Encoding` 协商,123KB 单页约 31KB 上线);
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
- **按模型名分档**:`deepseek-v4-pro` 走 pro 档,其余(含旧名 `deepseek-v4-flash`、
  `deepseek-v4-flash-vision-exp`,以及 `deepseek-v4.1-flash-expires-on-0910`)走 Flash 档 ——
  官方说明旧名仍可调用但由 V4.1-Flash 承接、按 Flash 价计费。认不出的名字回退 Flash,不猜 pro;
- **中转 provider**(`ccai` / `jyld` / `gjcs` 等)按同样的官方价目按名估算,**仅供参考** ——
  中转实际计费通常高于官方,需要精确成本请在单价表覆盖;
- **自定义单价两种写法都吃**:新的 `{peak:{…}, idle:{…}}` 分时段;旧的扁平
  `{miss,hit,write,output}` 仍可读且两档同价(设置页保存时自动升级为两档写法)。
  只填高峰一档时,空闲自动跟随 —— 想要"不分时段"就只填一档。

`/dsh-token/api/config` 的 `defaults` 字段即模型键 → 官方默认价(含两档)的映射,
**缺席 = 该模型无内置价**,页面据此显示"未定价 · 按 ¥0 计",避免把"没价"误标成"官方价";
`prices` 在读取侧已归一化为两档,UI 无需分支;`peakHours` / `peakDays` 为生效值的紧凑文本,
`defaultsPeakHours` / `defaultsPeakDays` 供页面"恢复默认"按钮对照。

> 改动价目表属于**语义变更**:必须同时 +1 `STORE_VERSION`(当前 **v6**),否则水位线会按 revision
> 跳过未变化会话,存量成本永远沿用旧价。测试 `test/price.test.mjs` 把官方数字与默认时段
> 都写死为断言(改价目/改时段会立刻失败),并单独断言"这两者都能被配置覆盖";
> 时区口径与惰性重建由 `test/host-semantics.test.mjs` 锁定。

## 已知限制

- 规模上限参考:10 万请求时 store.json ≈ 19MB,请求记录全量驻留内存;每个"脏"扫描周期(5 分钟 tick 且有会话变更时)执行一次全量重建 + 落盘,实测约 165ms(Node 24)。默认 `retention.days=0` 永久保留,长期大库建议开启保留期(如 `{"retention":{"days":365}}`)控制体积。**代价**:`writeStore` 是"整个 store 一次 `JSON.stringify` + 原子改名",库越大单次落盘越贵(19MB 级每次数百毫秒),且损坏时只能整体改名重建 —— 拆成"聚合快照 + 逐请求分片"是后续可做的优化,当前版本没做;
- 通过**域名**反代访问仪表盘时,设置类 POST 会被拒绝(防 DNS rebinding 的代价):Host 白名单只放行回环名、私网/链路本地/CGNAT/唯一本地 IP 与回环 IPv6,**域名与公网 IP 字面量一律拒绝**。私网 IP 直连(如 `http://192.168.1.5:3080`)与 `curl`(无 `Origin`)可用;
- 仪表盘价格估算内置 **DeepSeek 官方价目**(¥/M),按官方页口径分档并区分时段 ——
  见下方「价格口径」。中继/自建模型按模型名套用同一价目作**估算**(仅供参考),非 DeepSeek 系
  模型无内置价,需手动录入;未定价模型成本计 0,但这部分**不会被藏起来** ——
  `kpi.totals.unpricedTokens` / `unpricedModelCount` 显式给出,单价表显示"未定价 · 按 ¥0 计",
  会话面板与 KPI 卡片都会标注"含未定价模型,费用偏低"。**因此"估算成本"要读成
  "已定价部分的成本 + 未定价 token 数",不是完整账单;**
- 默认永久保留全部原始请求记录(会话下钻/导出依赖);设置 `retention.days` 可按天修剪,
  修剪在扫描期执行,超龄会话整段清理;
- **被宿主拒绝的老会话无法统计**:部分 v0 老日志(插件注入过非标准事件成员,或子代理
  描述符为 v2)连 DSH 自身都拒绝迁移,插件只能跳过。这类会话进入隔离清单并计入
  `meta.quarantinedCount`(设置页/`/dsh-token/api/meta` 可见),可用 `POST /dsh-token/api/scan`
  或重启触发 `force` 重试。它们**上一次成功扫描的记录会保留**在 store 里(不会静默清零),
  只是不再更新 —— 本机实测为 18 个会话 / 549 条记录;
- **store.json 损坏时以"留证 + 重建"处理,不尝试原地修复**:形态体检只做结构判定
  (字段/类型/NaN),不合格就改名成 `store.json.corrupt-<时间戳>` 再从会话日志重建。
  这样不会丢数据、也不会丢证据,但**配置**(自定义单价、预算、保留期、自定义页面路径)
  会随之回默认 —— 因为它们只存在 store 里,日志里没有。想保住配置,请把
  `$DSH_HOME/dsh-token/store.json` 一起备份;
- **小时桶/高峰判定固定北京时间**(UTC+8),不跟随宿主时区,也不可配置;日/月桶按宿主
  本地时区。两者口径不同是有意的:前者对齐官方计费,后者对齐用户对"今天"的直觉;
- 单价表按 DSH settings 里的模型目录过滤。命名空间形态已知两种(`llm-pi-ai` 的
  `providers.<路由>.models[]`,以及适配器自带命名空间的顶层 `models[]`,provider 名靠一张
  小映射表补全)。**任何解析不出来时一律关闭过滤显示全部**,并在启动日志里打印所见的命名
  空间名(不含任何值)—— 所以"读不到配置"只会退回旧行为,不会把界面清空;
- 配置与聚合在 `$DSH_HOME/dsh-token/store.json`(未走 `settings.register`,动态插件
  沙箱无法构造 schemastery schema);单价表只**读** DSH settings,从不写它,且只取
  `provider:model` 标识,settings 原文(含凭据相关字段)绝不进入 API 载荷;
- 会话标题取 DSH 的自动生成标题(`session/title` 事件),缺省回退首条用户消息。

## 开发与验证

```bash
npm test                # 143 项断言 + 设计 token 漂移检查
npm run verify          # 发布前完整性校验(文件 / dsh 字段 / 模块可解析 / 内联脚本语法)
npm run e2e             # 真实 http 栈端到端冒烟(临时 DSH_HOME,零依赖)
npm run tokens          # 改完 lib/design-tokens.mjs 后重新注入两处界面
npm pack && npm run verify:tarball   # 打包后把 tarball 解到全新目录当"新装"再验一遍
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

改配色请只改 `lib/design-tokens.mjs`(`web/index.html` 与 `lib/client.js` 里的
token 块是生成物,`--check` 会挡住手改)。

## 许可

MIT
