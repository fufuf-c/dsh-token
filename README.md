# dsh-token

[![CI](https://github.com/fufuf-c/dsh-token/actions/workflows/ci.yml/badge.svg)](https://github.com/fufuf-c/dsh-token/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

DSH 本地 **Token 用量统计插件**——以 Token 为第一视角:不只回答"花了多少钱、用了多少量",还回答 **Token 从哪来、缓存省了多少、哪些会话在烧 Token**。数据全部来自本地会话日志,零上传、无在线依赖。仪表盘为 Apple 风格四 Tab 界面,开箱即用。

## 亮点

- **四段 Token 构成**:未命中 / 缓存命中 / 缓存写入 / 输出(不是简单的总量);
- **缓存省钱估算**:命中量 × 未命中与命中的价差(核心差异化);
- **全局筛选贯穿所有面板**:时间(今天/3天/7天/30天/自定义)+ 模型多选 + 会话 + 工作目录,URL 可分享;
- **会话下钻**:四联统计、逐模型构成、逐请求明细、**上下文增长曲线**、**🔥 异常激增标记**、`?session=` 深链;
- **成本与预算**:模型单价表(¥/M,家族默认价 + 一键重置)、月度预算环形进度 + 外推月底预估 + 80%/100% 阈值变色、按模型/按会话成本归因;
- **聚合快路径查询**:查询直接读 day/month 聚合索引(复杂度 O(天数) 而非 O(请求数),10 万条请求库 kpi 25ms→1ms);带 `session`/`wd` 筛选自动回退逐记录路径,两条路径输出等价由单测锁定;
- **增量扫描,空闲零写放大**:未变化会话按 revision 跳过(变更文件才整段重折);常规重启只做增量;扫描周期无变化时跳过整库重建与落盘;扫描产物落盘合并(可重建缓存,最短 10 分钟写一次,配置变更立即落盘,退出兜底 flush);store.json 原子写(临时文件 + 改名);
- **保留期可配**:`retention.days` 修剪超龄原始记录,防止内存与 store.json 无界增长(默认 0 = 永久保留);
- **多模型叠加趋势图** + 图例逐模型独立开关 + 日/周/月粒度 + 24 桶小时直方图(峰值高亮) + 12 个月活跃热力图(日/周/累计)。

## 架构

```
web/index.html       仪表盘单页 · Apple 风格(默认页;四 Tab:iOS 大标题 / 玻璃材质 /
                     活动圆环 hero / 屏幕使用时间式图表;纯原生 JS + Canvas,零构建)
lib/client.js        浏览器 bundle:侧边栏入口 / 会话内 Tab / 设置页信息面板
lib/core.mjs         数据层核心(纯函数):折叠、聚合、筛选、导出、价格、异常检测、
                     会话标题提取(session/title → 首条用户消息回退)、
                     day/month 聚合快路径(O(天数) 查询)+ retention 修剪
lib/index.js         Host 插件外壳:扫描(sessionPersistence)、/dsh-token 路由、
                     /token-stats 命令、5 分钟增量扫描(无变化不落盘)、
                     页面 mtime 缓存 + gzip、POST 同源校验 + 1MB body 上限、启动自检
scripts/dev-server.mjs     页面设计调试服务器(读真实 store,免重启 DSH)
scripts/build.mjs          发版前完整性校验
test/                数据层单元测试(node --test)
```

数据源 = `$DSH_HOME/sessions`(默认 `~/.dsh/sessions`),经 DSH 官方 `sessionPersistence` 服务解码(`session.jsonl.zstd` 为多帧 Zstd + chunk 打包)。聚合与配置持久化于 `$DSH_HOME/dsh-token/store.json`。

## 安装

三种方式任选(npm 为 scoped 包,`npm publish` 后可用):

```bash
# npm(包名 @fufuf-c/dsh-token):
dsh plugin --profile web add @fufuf-c/dsh-token
# 或 git:
dsh plugin --profile web add "git+https://github.com/fufuf-c/dsh-token.git#v0.3.1"
# 或 Release 预构建 tarball(更快,无需本地构建):
dsh plugin --profile web add "https://github.com/fufuf-c/dsh-token/releases/download/v0.3.1/fufuf-c-dsh-token-0.3.1.tgz"
# 装完安装依赖并重启
cd ~/.dsh/profiles/web && pnpm install
dsh web
```

安装后打开 `http://127.0.0.1:3080`,开箱即用:

- 仪表盘默认即为 **Apple 风格四 Tab 页**(今天 / 活动 / 会话 / 设置,底部悬浮 Tab 栏);
- 首次启动会做**一次**全量扫描(自动提取每个会话的标题),之后每次重启均为秒级增量;
- 侧边栏底部出现 **Token 统计** 入口(wide 满宽行 / narrow 36×36 圆钮,order 0 顶置);
- 会话头部视图切换出现 **Token 统计** Tab(iframe 嵌入且自带 `?session=` 深链);
- 设置 → **dsh-token** 页展示数据源/扫描统计/模型清单;
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
| `/dsh-token/api/session` | GET | 单会话下钻:`?id=<sessionId>` |
| `/dsh-token/api/meta` | GET | 数据源路径/会话/请求/模型/扫描统计/价格族 |
| `/dsh-token/api/config` | GET/POST | 配置:`{prices?, resetPrices?, budget?:{monthly}, webPagePath?(.html/.htm), retention?:{days}}` |
| `/dsh-token/api/scan` | POST | 触发增量扫描 |
| `/dsh-token/api/export.csv` | GET | 日×模型明细(当前筛选) |
| `/dsh-token/api/export.json` | GET | 逐请求原始明细(当前筛选) |

**POST 安全**:带 `Origin` 头的请求必须与 `Host` 头完全一致,且 `Host` 仅接受回环地址(`127.0.0.1`/`localhost`/`::1`)与 IP 字面量 —— IP 直连无法被 DNS 重绑定,域名 `Host` 的 POST 一律拒绝,同时防住 CSRF 与 DNS rebinding;无 `Origin` 的 curl 调用放行(通过域名反代访问时,设置类 POST 需走 curl 或本机地址)。请求体上限 1MB(超限排空剩余 body,keep-alive 不串流);`webPagePath` 仅接受 `.html`/`.htm`。页面响应带 `Content-Security-Policy`(仅内联脚本/样式 + 同源连接)与 `X-Content-Type-Options: nosniff`;CSV 导出对 `=/+/-/@` 开头的单元格做公式注入防护。**筛选参数**(贯穿所有数据端点):`range=today|3d|7d|30d|month|all|custom`(custom 配 `from`/`to` 日键 `YYYY-MM-DD`)、`models=`(逗号分隔 `provider:model` 键)、`session=`(会话 ID 前缀)、`wd=`(工作目录前缀)。

**kpi 响应**:
```jsonc
{
  "range": { "label", "fromDay", "toDay" },
  "totals": { "miss", "read", "write", "out", "total", "requests", "cost", "saved" },
  "hitRate": 0.986,            // read / (miss+read+write)
  "activeSessions": 110,
  "peakDay": { "day", "tokens" },
  "delta": { "tokens", "cost" },   // 今日环比昨日 / 本月环比上月
  "streakDays": 9,
  "models": [{ "key", "provider", "model", "totals" }]  // 按量降序
}
```

**session 响应**:`{ id, meta{id,createdAt,cwd,parentSession,origin,delegationDepth,agentPreset,workspace}, totals, models[], requests[], requestCount, anomalies, flagged, flags[] }`;`requests[i]` = `{seq,t,m,miss,read,write,out,r(推理),i(中断),cum(累计输入),cost,saved,priced}`;`flags[i]` 0=正常 1=🔥激增 2=中断。

## 页面替换(UI 重设计指南)

**仪表盘是独立单页,与插件壳完全解耦**——重设计只改一个文件,不碰数据层:

1. 直接编辑 `web/index.html`(或另建新文件)并替换;Host 按 (路径, mtime) 缓存页面,
   文件一变即失效,刷新页面即生效(免重启;也可通过
   `POST /dsh-token/api/config {"webPagePath":"<.html/.htm 绝对路径>"}` 指向仓库外的设计稿);
   页面响应自带 gzip(`Accept-Encoding` 协商,123KB 单页约 31KB 上线);
2. 本地调试:`node scripts/dev-server.mjs` → `http://127.0.0.1:3980/dsh-token/`。
   数据读真实 store(只读),参数:`--page`(设计稿路径)、`--port`、`--live`(真实扫描,
   需 profile 环境)、`--store`;
3. 数据获取:页面用 `fetch('/dsh-token/api/…')`,前端契约见上表(稳定,不会变);
4. 主题:页面自带 `data-theme=light|dark` + `prefers-color-scheme` 跟随,可嵌入时与 DSH
   主题一致(变量名可自行约定;深度集成可读 DSH 主题 `localStorage` 偏好);
5. 深链约定(保持不变):`?range=&models=&session=&wd=&from=&to=` 全量可分享;
   `?session=<id>` 打开会话详情弹窗。

> 新增面板时,优先复用现有端点;若确需新数据,请在 `lib/core.mjs` 增加纯查询函数
> 并在 `apiDispatch` 挂一个端点 —— 保持"core 纯函数 + 路由薄壳"结构即可。

## 开发与验证

```bash
npm test        # 数据层单测:折叠/四段/筛选/导出/价格覆盖/快慢路径等价/scanStore
npm run smoke   # Host 壳端到端冒烟:gzip/同源/413/webPagePath/mtime 失效等
npm run build   # 完整性校验(免构建,纯 Node)
npm run dev     # 页面设计调试服务器
```

## 发布

```bash
# 版本更新后:
npm run build && npm test && npm run smoke   # 完整性 + 单测 + e2e 冒烟
npm pack                                     # 生成 fufuf-c-dsh-token-x.y.z.tgz
git add -A && git commit -m "vX.Y.Z" && git tag vX.Y.Z
git push origin main --tags
```

发布渠道二选一(或都做):

- **GitHub Release**:Releases → Draft new release vX.Y.Z,上传 npm pack 产出的 tarball
  (dshmarket 安装优先使用 Release 预构建 tarball:秒装、不执行构建脚本、不依赖访问源码仓库);
- **npm**:包名 `@fufuf-c/dsh-token`(scoped,已确认无占用),package.json 已配
  `publishConfig.access: "public"`,直接 `npm publish` 即可,无需附加参数。

用户安装方式:`dsh plugin --profile web add @fufuf-c/dsh-token`(npm)或
`dsh plugin --profile web add "git+https://github.com/fufuf-c/dsh-token.git#vX.Y.Z"`(git)。

## 已知限制

- 规模上限参考:10 万请求时 store.json ≈ 19MB,请求记录全量驻留内存;每个"脏"扫描周期(5 分钟 tick 且有会话变更时)执行一次全量重建 + 落盘,实测约 165ms(Node 24)。默认 `retention.days=0` 永久保留,长期大库建议开启保留期(如 `{"retention":{"days":365}}`)控制体积;
- 通过域名反代访问仪表盘时,设置类 POST(同源校验要求 Host 为本机/IP)会被拒绝 —— 这是防 DNS rebinding 的代价,可用 curl 或本机地址替代;
- 仪表盘价格估算基于内置家族默认价(¥/M,缓存写入按 0 计;如官方价目对缓存写入计费,
  可在页面单价表按模型覆盖);中继/自建模型需手动录入(模型名推断仅作参考);
  未定价模型成本计 0 并标记 `priced: 0`;
- 默认永久保留全部原始请求记录(会话下钻/导出依赖);设置 `retention.days` 可按天修剪,
  修剪在扫描期执行,超龄会话整段清理;
- 配置与聚合在 `$DSH_HOME/dsh-token/store.json`(未走 `settings.register`,动态插件
  沙箱无法构造 schemastery schema);
- 会话标题取 DSH 的自动生成标题(`session/title` 事件),缺省回退首条用户消息。

## 许可

MIT
