/**
 * dsh-token — **不变量登记表**(机器可读的单一来源)
 *
 * 为什么需要它
 * ------------
 * 本插件有 60+ 条"防未来退化"的守卫,它们分散在 core/index/session-source 各处,
 * 每一条都对应一次真实事故(重构后聚合冻结、分片模型下标错位、Redis 式清库、
 * 扫描窗口里两个数字不一致……)。这些守卫本身是**资产**,但它们的**理由**此前
 * 只存在于两处:
 *   · 代码里的大段注释(getter 为什么删、pruning 标记为什么不能删水位线);
 *   · 92 KB 的 CHANGELOG。
 * 结果是:新贡献者要动一行聚合代码,得先读完 CHANGELOG 才敢判断"这个判断能不能
 * 删",否则删掉后测试仍然是绿的(除非那条守卫有专属测试)。
 *
 * 这个文件把"有哪些不变量、各自锁什么、被哪个测试锁住"变成**可查询的数据**,
 * 并由 test/invariants.test.mjs **强制**与测试套件一一对应:
 *   · 登记了却没有测试 → 立刻失败(说明守卫被删了或测试被删了);
 *   · 有 V-编号测试却没登记 → 立刻失败(说明新增守卫没写理由)。
 *
 * 这样"防御代码"不再是散落的、只能靠记忆维护的注释,而是一张**有编号、可检索、
 * 缺失即报错**的清单。改代码前先在这里搜关键词,就能知道"我动的东西还有谁依赖"。
 *
 * 编号规则
 * --------
 *   V<n>    主不变量;<n> 单调递增,**永不复用**(删掉一条守卫就留着编号空位,
 *           而不是把后面的往前挪 —— 否则所有引用该编号的注释/CHANGELOG 都会指错)。
 *   V<n>b   同一主题的补充断言(通常锁定"两种实现必须等价"或"边界形态")。
 *   缺号    见 GAPS:明确登记为"已不存在的不变量"(例如 V19 在当时被合并进 V18),
 *           登记出来是为了让"编号不连续"这件事有解释,而不是让读者怀疑丢数据。
 *
 * 每条记录的字段
 * --------------
 *   id      编号(必须与测试标题里的 `V<n>: …` 完全一致)
 *   title   一句话:锁住的性质(与测试标题的第二段保持一致,便于互相搜索)
 *   why     为什么需要它 —— 不写"发生了什么",写"没有它会怎样"
 *   file    锁定它的测试文件(相对仓库根)
 *   kind    'behavior' 行为断言 | 'structure' 源码结构守卫 | 'contract' 对外契约
 */
export const INVARIANTS = [
  // ── 聚合状态机(0.8.9 修复的四个缺陷) ──────────────────────────────────
  {
    id: 'V1', kind: 'behavior', file: 'test/v089-fixes.test.mjs',
    title: 'rebuildAll 抛异常后,修好数据必须仍能重建(AGG_FLUSHING 不得泄漏)',
    why: '重建用 flushing 位做互斥;不在 finally 里复位的话,一次异常就把这个 store 永久锁死,聚合从此不再更新且没有任何报错。',
  },
  {
    id: 'V2', kind: 'behavior', file: 'test/v089-fixes.test.mjs',
    title: 'isStoreShapeValid 拦住 sessions 与 config 内层的坏形态',
    why: '体检只查到外层时,`{"sessions":{"a":"oops"}}` 能通过并进入内存,首次查询抛 TypeError → 每个端点 500,而"隔离 + 从日志重建"这条本该走的路不触发。查得浅比不查更糟。',
  },
  {
    id: 'V3', kind: 'behavior', file: 'test/v089-fixes.test.mjs',
    title: '嵌套扫描:内层结束后仍必须视为"扫描中"',
    why: '周期性扫描与 POST /scan 可以重叠。用布尔标记时,先结束的那次会把窗口关掉,而内层仍在写 requests —— 读侧立刻又能走聚合,拿到半新半旧的数字。必须用引用计数。',
  },
  {
    id: 'V4', kind: 'behavior', file: 'test/v089-fixes.test.mjs',
    title: '扫描进行中 flushAggregates 不得重建(脏标记保留到扫描结束)',
    why: '扫描期间 requests 是半新半旧的,此时重建等于把一份自相矛盾的数据**固化**下来 —— 比读到旧聚合更糟(旧聚合至少自洽)。',
  },
  {
    id: 'V5', kind: 'behavior', file: 'test/v089-fixes.test.mjs',
    title: '逐记录 cost/saved/priced 必须是普通数值属性(不是访问器)',
    why: '曾用 getter 实现"改完单价立刻生效",代价是每条记录多占约 1.3 KB、整库 +250 MB、JSON.stringify 慢 2.6 倍。改回普通属性后所有生产读路径都改为"读前 flush"。',
  },
  {
    id: 'V6', kind: 'behavior', file: 'test/v089-fixes.test.mjs',
    title: 'day 桶带日级 sessions 索引,activeSessions 两条路径一致',
    why: '没有日级索引时,无筛选的 activeSessions 只能遍历"该日 × 每个模型",复杂度随模型数增长(200k 库、400 模型时 kpi 从 0.48ms 涨到 12.84ms)。',
  },
  {
    id: 'V7', kind: 'behavior', file: 'test/v089-fixes.test.mjs',
    title: 'sessionsQuery 无筛选时只读 store.sessions,不遍历逐记录',
    why: '会话列表是进「会话」页就触发的查询;走逐记录会让它成为唯一用不上聚合的查询(200k 库实测 33.6ms)。这条同时锁定"真的没碰逐记录容器"。',
  },
  {
    id: 'V8', kind: 'behavior', file: 'test/v089-fixes.test.mjs',
    title: '连续使用天数正确(且不依赖固定 73k 次循环)',
    why: 'streak 是从今天往回数到第一个没有记录的日子即停;上限只是防御性常数,不是工作量。曾把上限当循环次数,每次查询白跑几万次日期运算。',
  },
  {
    id: 'V9', kind: 'behavior', file: 'test/v089-fixes.test.mjs',
    title: 'foldSession 给无 seq 的事件回退下标(否则排序比较器是 NaN)',
    why: 'seq 缺失时 `Number(undefined)` 是 NaN,排序比较器返回 NaN 会让顺序随实现而定 —— 逐请求时间线与"异常激增"判定都会变得不可复现。',
  },
  {
    id: 'V10', kind: 'behavior', file: 'test/v089-fixes.test.mjs',
    title: 'export.json 超限抛 413,且不物化全部记录',
    why: '20 万条请求会拼出 68 MB 的单个响应体,足以卡死标签页。上限必须在**扫描途中**判,而不是先全物化再判 —— 后者照样分配那 68 MB。',
  },
  {
    id: 'V11', kind: 'behavior', file: 'test/v089-fixes.test.mjs',
    title: 'retention 稳态不再每轮全量重折,且放宽后历史回归',
    why: '旧实现靠"修剪后删水位线"让放宽保留期能恢复历史,代价是**每一轮**扫描都重折全部超龄会话(实测连续三轮 scanned=10 pruned=400 dirty=true)。改用 prunedWith 标记:稳态跳过,值一变才重折一次。',
  },
  {
    id: 'V12', kind: 'contract', file: 'test/v089-fixes.test.mjs',
    title: 'webPagePath 已移除(拒绝 + 不回显 + 老库残留被忽略)',
    why: '那条配置面只校验扩展名,等于给本机任意进程一个"读盘上任意 .html"的原语(UNC 路径还会触发对外 SMB、外泄 NTLM 凭证),而页面字节是同源返回的 → 脚本执行面。0.9.4 起写入时还会顺手把老库里的残留值清掉(它是一个本机绝对路径)。',
  },
  {
    id: 'V13', kind: 'behavior', file: 'test/v089-fixes.test.mjs',
    title: '缺日级索引的老库在首次查询时自动补齐(不升 STORE_VERSION)',
    why: '聚合是**纯派生数据**,内存里重算即可;为它升 STORE_VERSION 会标记 needsFullScan,强制从 zstd 会话日志全量重解码,在 20 万请求库上明显更慢。',
  },
  {
    id: 'V14', kind: 'behavior', file: 'test/v089-fixes.test.mjs',
    title: '重建中途抛异常后必须仍判为未就绪(不得声称就绪)',
    why: '重建是"就地把 r.cost 改写一半、再发布 days"。抛异常时 requests 已撕裂而 days 还是旧的 —— 若此刻声称"聚合就绪",读到的是两类数据混在一起的数字。',
  },
  {
    id: 'V15', kind: 'behavior', file: 'test/v089-fixes.test.mjs',
    title: '扫描窗口内"无需重建",且零变化的周期扫描不再白重建',
    why: '"能否读聚合"(受扫描窗口约束)与"是否欠一轮重建"是**两个判据**。混成一个会让每一轮零变化的周期扫描都白做一次全量 rebuildAll(实测 dirty=false 而 rebuilds=1)。',
  },
  {
    id: 'V16', kind: 'behavior', file: 'test/v089-fixes.test.mjs',
    title: '扫描引发(dirty)的重建失败后不得声称就绪',
    why: '与 V14 同源,但发生在**扫描收尾**这条路上:那条路会顺手把 dirty 标记清掉,失败后若不置回 stale,聚合会停在"新旧混合"的状态上无人察觉。',
  },
  {
    id: 'V17', kind: 'behavior', file: 'test/v089-fixes.test.mjs',
    title: '形状记忆按 days 对象身份自动失效(无需调用点刷新)',
    why: '形状缓存若只靠"记得清"来维护,任何一次直接替换 store.days 的调用都会留下"缓存说就绪、数据已变样"。按对象身份绑定把这件事从纪律变成结构。',
  },

  // ── 0.9.0 修复 ────────────────────────────────────────────────────────
  ...(function () { return [] })(),
  {
    id: 'V18', kind: 'behavior', file: 'test/v090-fixes.test.mjs',
    title: 'parseHourRanges 与 normalizeHourRanges 必须归一出同一形状',
    why: '两条入口(API 紧凑文本 / 页面点选数组)若归一出不同形状,设置页回显与实际计费取档就会各说各话。',
  },
  {
    id: 'V20', kind: 'behavior', file: 'test/v090-fixes.test.mjs',
    title: 'seriesQuery 回显的 granularity 必须是实际生效值',
    why: '原实现接受任意字符串并当 day 处理,却回显**输入原值** —— `?granularity=bogus` 会返回 `granularity:"bogus"` 的日桶,前端据此决定刻度格式时会拿到一个自己都不认识的值。',
  },
  {
    id: 'V21', kind: 'behavior', file: 'test/v090-fixes.test.mjs',
    title: 'exportJson 遇超出 Date 范围的时间戳不得抛 RangeError',
    why: 'Date 只覆盖 ±8.64e15 ms,而 1e18 是有限数。原实现只查 isFinite,于是一个坏时间戳让整个导出 500,而调用方拿不到任何"缩小范围"的指引。',
  },
  {
    id: 'V22', kind: 'contract', file: 'test/v090-fixes.test.mjs',
    title: '预算状态必须由服务端下发(kpi.budget),未设预算时为 null',
    why: '预算此前只有浏览器页面自己算,于是 curl、移动端、会话内面板这些不走那个页面的调用方**永远拿不到预算状态**。',
  },
  {
    id: 'V22b', kind: 'behavior', file: 'test/v090-fixes.test.mjs',
    title: 'budgetStatus 与 kpiQuery.budget 口径一致,且 budget=0 视为未设',
    why: '0 与"未设"必须是同一件事(否则页面会渲染一条永远超支的红条);两处口径漂移则会让设置页与 KPI 卡片给出不同的剩余额度。',
  },
  {
    id: 'V23', kind: 'structure', file: 'test/v090-fixes.test.mjs',
    title: '页面缓存键必须含文件 size(mtime 可能不动)',
    why: 'mtime 精度在不同文件系统上可粗到 1~2 秒,而 "改写但保留时间戳" 的部署(git checkout、rsync -t、容器镜像层)会让 mtime 完全不动 —— 那时页面改了却一直发旧缓存,且没有任何提示。',
  },
  {
    id: 'V24', kind: 'behavior', file: 'test/v090-fixes.test.mjs',
    title: 'POST /scan 失败时必须回 ok:false + 非 2xx(不得谎报成功)',
    why: '无条件写 ok:true 会让调用方(面板「立即扫描」、脚本)无法区分"扫完了 0 条"与"扫失败了",失败被伪装成成功。',
  },
  {
    id: 'V25', kind: 'behavior', file: 'test/v090-fixes.test.mjs',
    title: 'POST 路径必须排空请求体(keep-alive 不串流)',
    why: '分支不读 body 又不 resume(),未读完的字节会被当成下一个请求的开头 —— keep-alive 连接上后续请求莫名错位。',
  },
  {
    id: 'V26', kind: 'behavior', file: 'test/v090-fixes.test.mjs',
    title: 'eachWithin 的会话级预筛不得改变任何查询结果',
    why: '把 session/wd 前缀判定提到逐记录循环**之前**(整会话跳过)是 0.9.0 的性能修复;它改变的是访问顺序,绝不允许改变任何输出。',
  },
  {
    id: 'V27', kind: 'behavior', file: 'test/v090-fixes.test.mjs',
    title: '会话级预筛对 session/wd 的边界(cwd 缺失 / 空前缀 / 大小写)',
    why: '整会话跳过一旦判错就是"整个会话凭空消失"。cwd 缺失、空前缀、大小写这三类边界是最容易写反的地方。',
  },
  {
    id: 'V28', kind: 'behavior', file: 'test/v090-fixes.test.mjs',
    title: 'metaInfo 在聚合就绪时走派生,未就绪时回退逐记录 —— 两者结果必须一致',
    why: '同一份数据两条路径给出两个数字,是这类仪表盘最伤信任的缺陷。',
  },
  {
    id: 'V28b', kind: 'behavior', file: 'test/v090-fixes.test.mjs',
    title: 'metaInfo 派生路径在坏形态下不得给出 0(压测库 / sessions 数组)',
    why: '"算不出来"与"真的是 0"必须可区分 —— 后者会被当成"用户没有用量"。',
  },
  {
    id: 'V29', kind: 'behavior', file: 'test/v090-fixes.test.mjs',
    title: 'metaInfo 不得因派生而多出 "undefined" 伪模型',
    why: '取值失败被当成键参与聚合时,模型列表里会凭空多一个 `undefined`,而它会让"按模型"总额与总量对不上。',
  },
  {
    id: 'V30', kind: 'structure', file: 'test/v090-fixes.test.mjs',
    title: 'eachWithin 必须在逐记录循环**之前**做会话级预筛(结构守卫,防被改回)',
    why: '这是纯性能优化,把它改回循环内不会有任何**行为**测试失败,只会在 20 万库上悄悄慢 95%。故必须有结构守卫。',
  },
  {
    id: 'V31', kind: 'structure', file: 'test/v090-fixes.test.mjs',
    title: 'metaInfo 的派生路径必须受 aggregatesReady 闸门保护(结构守卫)',
    why: '派生路径绕过闸门就会在扫描窗口内读到半新半旧的聚合 —— 与 V4/V15 同一类事故,但发生在另一个调用点。',
  },

  // ── 落盘紧凑编码(v7) ─────────────────────────────────────────────────
  {
    id: 'V32', kind: 'behavior', file: 'test/v090-store-v7.test.mjs',
    title: '紧凑落盘往返必须逐字段无损(requests / sessions / config / watermarks)',
    why: '紧凑编码省略可派生字段、把模型键内联成下标。任何一处编码口径不一致都会让"重启后数字变了"。',
  },
  {
    id: 'V32b', kind: 'behavior', file: 'test/v090-store-v7.test.mjs',
    title: '紧凑落盘往返后,sessions.models 必须是**对象**(不是二元组数组)',
    why: 'sessions.models 也参与模型键内联;展开时若留在"下标形式",按会话查模型会全部读到 undefined。',
  },
  {
    id: 'V32c', kind: 'behavior', file: 'test/v090-store-v7.test.mjs',
    title: '往返后查询输出逐字节一致(含慢路径与导出)',
    why: '这是"编码只是存储细节"这条承诺的**唯一**可执行判据。',
  },
  {
    id: 'V33', kind: 'behavior', file: 'test/v090-store-v7.test.mjs',
    title: 'v6 老库必须能被直接读入且通过体检(升级不丢配置)',
    why: '升级路径断了用户会看到"我的自定义单价没了" —— 而配置只存在 store 里,日志里没有,重建不出来。',
  },
  {
    id: 'V33b', kind: 'behavior', file: 'test/v090-store-v7.test.mjs',
    title: '空 requests 的 v7 库,sessions.models 仍必须被展开',
    why: '没有任何请求的库是最容易被"提前 return"跳过的形态,而它恰恰是新装用户第一次重启时的状态。',
  },
  {
    id: 'V34', kind: 'behavior', file: 'test/v090-store-v7.test.mjs',
    title: '未展开的紧凑库必须**不**通过体检(防止被直接使用)',
    why: '体检与展开的顺序若反了,紧凑行会被当成记录对象使用 —— 每个字段都是 undefined,而**没有任何报错**。',
  },
  {
    id: 'V35', kind: 'behavior', file: 'test/v090-store-v7.test.mjs',
    title: '落盘必须省略可派生字段,且体积确实变小',
    why: 'cost/saved/priced/cum 占总量的 32%;写进盘只是"下次载入再算一遍"的浪费,而且它们会让 store 看起来比实际大得多。',
  },
  {
    id: 'V36', kind: 'behavior', file: 'test/v090-store-v7.test.mjs',
    title: 'encodeStore 必须是纯函数(不得改动传入的 store)',
    why: '落盘路径若会改写内存 store,一次失败的写入就会把内存里的数据也弄坏 —— 而落盘本应是"只读快照"。',
  },
  {
    id: 'V37', kind: 'contract', file: 'test/v090-store-v7.test.mjs',
    title: 'STORE_VERSION 必须为 8(落盘格式契约)',
    why: '它同时是"要不要全量重扫"的开关。改价目/改折叠口径却忘了 +1,会让水位线按 revision 跳过未变化会话 —— 存量成本永远沿用旧价。',
  },
  {
    id: 'V38', kind: 'behavior', file: 'test/v090-store-v7.test.mjs',
    title: '缺列/被截断的紧凑行按 0 补齐,不得让整个库崩',
    why: '一个被截断的分片不该让整库无法打开;补 0 至少让其余数据可用,且下轮会重折该会话。',
  },
  {
    id: 'V38b', kind: 'behavior', file: 'test/v090-store-v7.test.mjs',
    title: 'seq 为 null 的紧凑行展开为 undefined(与 foldSession 的兜底一致)',
    why: 'null 与 undefined 在这里必须收敛到同一语义,否则紧凑行的 seq 会变成 0,排序把"极老记录"排到最前面。',
  },

  // ── 分片布局(0.9.0 / 0.9.1) ─────────────────────────────────────────
  {
    id: 'V39', kind: 'behavior', file: 'test/v090-shard-web.test.mjs',
    title: 'splitStore 必须把 requests 摘出去,且派生数据不入盘',
    why: 'store.json 是**索引**:它要能在不载入 20 MB 记录的前提下被读出(配置、水位线、会话标题都在它里面)。',
  },
  {
    id: 'V39b', kind: 'behavior', file: 'test/v090-shard-web.test.mjs',
    title: 'splitStore 必须是纯函数(不得改动内存 store)',
    why: '同 V36:编码过程污染内存会让"落盘"变成一次有副作用的操作。',
  },
  {
    id: 'V40', kind: 'behavior', file: 'test/v090-shard-web.test.mjs',
    title: '分片往返必须逐字段无损,查询输出逐字节一致',
    why: '分片是默认布局;它一旦不无损,所有用户重启后看到的数字都会变。',
  },
  {
    id: 'V41', kind: 'behavior', file: 'test/v090-shard-web.test.mjs',
    title: 'joinStore 必须支持磁盘形态 [{id,rows}](文件名不可逆,id 以内容为准)',
    why: '文件名是 base64url(不可逆),而 macOS 大小写不敏感文件系统还会把两个不同 id 折叠成同一个文件 —— id 必须以**内容**为准。',
  },
  {
    id: 'V42', kind: 'behavior', file: 'test/v090-shard-web.test.mjs',
    title: '脏分片集合语义(未知→全量 / 已知→只写变化的)',
    why: 'null(未知)必须退化为"全部重写"才安全;而把"已知且为空"误当成未知,会让一次配置变更白写 10 MB。',
  },
  {
    id: 'V43', kind: 'behavior', file: 'test/v090-shard-web.test.mjs',
    title: '单分片损坏必须只影响该会话,其余照旧',
    why: '这是分片布局相对单文件的主要收益;若一个坏分片让整库打不开,那分片就白拆了。',
  },
  {
    id: 'V44', kind: 'structure', file: 'test/v090-shard-web.test.mjs',
    title: '分片落盘不得把 store.json 写成含 requests 的单文件',
    why: '整库 stringify 会在 20 万请求库上每次落盘多分配约 32 MB,而常态一轮只写几十 KB。这条同时锁定"先写分片、最后写索引"的崩溃安全顺序。',
  },
  {
    id: 'V45', kind: 'behavior', file: 'test/v090-shard-web.test.mjs',
    title: '扫描重折会话后必须标记该分片为脏(行为验证)',
    why: '不标记就不会重写分片 —— 重启后看到的是旧数据,而内存里一切正常,极难定位。',
  },
  {
    id: 'V45b', kind: 'behavior', file: 'test/v090-shard-web.test.mjs',
    title: '修剪(retention)后必须标记该分片为脏(行为验证)',
    why: '修剪改动了记录,分片必须重写或删除,否则被剪掉的记录会"复活"。',
  },
  {
    id: 'V45c', kind: 'behavior', file: 'test/v090-shard-web.test.mjs',
    title: '会话从 list() 消失后必须标记为脏(以便删除其分片)',
    why: '不删分片,重启后 `isShardLayout` 载入会**复活**一个已不存在的会话(有标题、有用量,但宿主里已经没有它)。',
  },
  {
    id: 'V46', kind: 'structure', file: 'test/v090-shard-web.test.mjs',
    title: 'web/index.html 必须是 web/src/** 的逐字节拼接产物',
    why: '交付物必须始终存在且随时可用(插件原样返回它、测试直接读它)。改了 src 忘构建会让"源码里修了、用户看到的是旧的"。',
  },
  {
    id: 'V46b', kind: 'structure', file: 'test/v090-shard-web.test.mjs',
    title: 'build-web 的 --check 语义(不一致即非零退出)可用',
    why: 'CI 与 prepack 都靠它挡住"改了源忘了构建"。它自己坏掉时不会有任何提示。',
  },
  {
    id: 'V47', kind: 'structure', file: 'test/v090-shard-web.test.mjs',
    title: '交付物必须仍是单文件(内联脚本 + 无外部资源)',
    why: '拆包请求会破坏 CSP(页面只允许内联)与"零构建交付"的形态。IIFE + use strict 还是"按区间切片再拼回不改变语义"的前提。',
  },
  {
    id: 'V47b', kind: 'structure', file: 'test/v090-shard-web.test.mjs',
    title: '两对 dtk:tokens 标记必须仍在样式源里(token 注入依赖它)',
    why: '标记是注入器的锚点;丢了标记,注入会静默跳过(或抛错),配色从此不再跟随单一来源。',
  },
  {
    id: 'V48', kind: 'structure', file: 'test/v090-shard-web.test.mjs',
    title: 'build-tokens 必须注入到**源文件**而不是产物(否则拼接会覆盖注入)',
    why: '顺序反了会出现"跑完 build-tokens 看着是对的,跑一次 build-web 就又变回去了"。',
  },
  {
    id: 'V49', kind: 'structure', file: 'test/v090-shard-web.test.mjs',
    title: 'package.json 必须把 web/src 排除在发布内容外,并保留产物',
    why: '整目录收 web 会把 20 份源文件也发给用户(体积翻倍且引起"改哪个才对"的混淆)。',
  },
  {
    id: 'V50', kind: 'structure', file: 'test/v090-shard-web.test.mjs',
    title: '源文件必须齐全(缺一份就构建不出可用的页面)',
    why: 'build 对缺文件是硬失败,但"缺了哪一份"只能从这里提前看出来。',
  },
  {
    id: 'V51', kind: 'behavior', file: 'test/v090-shard-web.test.mjs',
    title: '分片必须自带模型表 —— 局部重写不得让未重写分片的 mi 错位(v8 修复回归)',
    why: '分片是局部重写的,而全局 modelTable 是整体重写的;两者顺序一旦不同,未重写分片里的整数下标会指向**另一个模型** —— 静默算错,且没有任何报错。',
  },
  {
    id: 'V51b', kind: 'behavior', file: 'test/v090-shard-web.test.mjs',
    title: '只重写一个分片时,其余分片必须仍能按自己的表解析(v7 会在此错位)',
    why: '这是 v7 的真实缺陷复现:它证明"每分片自带表"不是多余的设计,而是修掉一个静默错误。',
  },
  {
    id: 'V51c', kind: 'behavior', file: 'test/v090-shard-web.test.mjs',
    title: 'v7 老分片(无 models 表)必须仍能按 meta 全局表读入 —— 升级不丢数据',
    why: '修 v8 不能以"v7 用户的历史读不出来"为代价。',
  },
  {
    id: 'V52', kind: 'behavior', file: 'test/v090-shard-web.test.mjs',
    title: 'joinStore 必须接受两种分片形态的**混存**(部分分片尚未重写)',
    why: '升级那一刻磁盘上必然是新旧混存(只重写过脏分片)。不支持混存就等于"升级即丢数据"。',
  },
  {
    id: 'V53', kind: 'behavior', file: 'test/v090-shard-web.test.mjs',
    title: '逐分片编码必须与整库 splitStore 得到**相同字节**(否则落盘会悄悄变格式)',
    why: '生产落盘走逐分片(省 32 MB 瞬时分配),测试与工具走整库编码。两条路径若字节不同,"落盘内容"会取决于用哪条路径,而持久化格式必须只有一个定义。',
  },

  // ── 0.9.4 新增 ───────────────────────────────────────────────────────
  {
    id: 'V54', kind: 'behavior', file: 'test/v094-features.test.mjs',
    title: 'loadShardsAsync 的结果必须与同步 joinStore 逐字段一致',
    why: '异步载入是为"不再独占事件循环"而引入的第二条读取路径。两条路径若不等价,冷启动的数字会取决于用哪一条。',
  },
  {
    id: 'V55', kind: 'behavior', file: 'test/v094-features.test.mjs',
    title: '单个分片损坏只影响它自己,其余照常载入(异步路径)',
    why: '与 V43 同一条不变量,但异步实现里由并发 worker 处理 —— 容错语义必须一起搬过去,否则"改异步"会顺手丢掉"坏分片不拖垮整库"。',
  },
  {
    id: 'V55b', kind: 'behavior', file: 'test/v094-features.test.mjs',
    title: 'v7 老分片(无自带 models 表)必须计入 legacyCount,以便整批重写',
    why: '老分片的 mi 依赖 meta 全局表,而 meta 下次落盘就是新格式(不再带全局表)。漏统计就等于让那些下标永久失去解析依据 —— 静默算错。',
  },
  {
    id: 'V56', kind: 'behavior', file: 'test/v094-features.test.mjs',
    title: '并发上限被遵守(不得同时打开全部分片)',
    why: '无上限会让数千分片同时打开数千个文件描述符(Windows 上尤其容易撞句柄压力);而串行又会让冷启动退回磁盘延迟的串行累加。',
  },
  {
    id: 'V56b', kind: 'behavior', file: 'test/v094-features.test.mjs',
    title: '空分片目录不得抛(全新安装的冷启动路径)',
    why: '全新安装时 shards/ 是空的;这条路径抛错会让插件在最常见的首次启动场景上直接不可用。',
  },
  {
    id: 'V57', kind: 'behavior', file: 'test/v094-features.test.mjs',
    title: 'rebuildAllChunked 与 rebuildAll 必须产出**完全相同**的聚合与记录',
    why: '0.9.4 把逐会话重建抽成 rebuildSessionInto 供同步/分片两条驱动共用。若两者结果有任何差异,聚合会随"哪条路径先跑"而变 —— 这是本版最关键的断言。',
  },
  {
    id: 'V57b', kind: 'behavior', file: 'test/v094-features.test.mjs',
    title: '分片重建期间必须真的让出事件循环(不得一次性跑完)',
    why: '分片重建的**全部意义**就是不独占事件循环。若切片判据失效(例如 now() 从不被调用),它会退化成同步重建而没有任何行为测试失败。',
  },
  {
    id: 'V58', kind: 'behavior', file: 'test/v094-features.test.mjs',
    title: '分片重建失败时必须把 stale 置回(不留下"声称就绪"的假象)',
    why: '异步路径的失败尤其容易被吞:await 之前的 throw 变成 rejection,但**状态位**仍必须和同步版一样复位,否则聚合停在撕裂状态且无人察觉。',
  },
  {
    id: 'V59', kind: 'behavior', file: 'test/v094-features.test.mjs',
    title: '分片重建必须尊重"已有重建在跑"的互斥(不得并发两次)',
    why: 'flushing 互斥在异步实现里必须依然成立,否则两次重建会交错写同一个 days。',
  },
  {
    id: 'V60', kind: 'contract', file: 'test/v094-features.test.mjs',
    title: 'sessionsQuery 不传 pageInfo 时返回类型仍是**数组**',
    why: '把返回类型从数组改成包装对象,会让所有既有调用方静默拿到 `undefined.map` —— 这是最难定位的一类破坏。故分页按需开启(见 V60b)。',
  },
  {
    id: 'V60b', kind: 'contract', file: 'test/v094-features.test.mjs',
    title: 'apiDispatch 默认返回数组;meta=1 才包装(形状向后兼容)',
    why: 'REST 层的形状兼容:老调用方(面板、脚本、curl)不该因为加分页而改写。',
  },
  {
    id: 'V61', kind: 'behavior', file: 'test/v094-features.test.mjs',
    title: '分片分页元信息必须如实报告总数(total 是截断前的真实条数)',
    why: '此前 limit 被静默钳到 500 且响应里没有任何字段说明被截断:调用方无法分辨"一共 400 个"与"一共 5 万个我只看到 500 个"。',
  },
  {
    id: 'V61b', kind: 'behavior', file: 'test/v094-features.test.mjs',
    title: 'limit 仍被钳到 [1,500],offset 被钳到翻页上限',
    why: 'limit 来自查询串(恒为字符串),`limit=abc` 会让 slice(0,NaN) 得到空数组 —— 一个拼错的链接就把整个会话列表变成空白。',
  },
  {
    id: 'V62', kind: 'behavior', file: 'test/v094-features.test.mjs',
    title: '老库里残留的 webPagePath 必须被清掉(它是一个本机绝对路径)',
    why: '该字段早已不承载功能(0.8.9 移除),内容是**本机绝对路径** —— 会随 store.json 一起进入备份、issue 附件与截图,泄漏目录结构与用户名。',
  },
  {
    id: 'V62b', kind: 'behavior', file: 'test/v094-features.test.mjs',
    title: '清理只针对已移除的键,不得误删其它配置',
    why: '"白名单之外都删"会让降级回本版时抹掉未来版本的配置 —— store 只需要向前兼容,不需要向后清理。',
  },
  {
    id: 'V62c', kind: 'behavior', file: 'test/v094-features.test.mjs',
    title: '传 webPagePath 仍然被显式拒绝(清理不等于重新接受)',
    why: '清理残留值不等于恢复那条配置面;写入侧必须继续 400 拒绝,否则"读盘上任意 .html"的执行原语又回来了。',
  },
  {
    id: 'V63', kind: 'structure', file: 'test/v094-features.test.mjs',
    title: 'package.json 的 files 必须逐个列出运行时文件,不得整目录收入 lib',
    why: '整目录收 lib 会把 design-tokens.mjs(仅注入器使用)也发给用户,并把"什么是运行时依赖"这件事变得无法从 package.json 读出。',
  },
  {
    id: 'V63b', kind: 'structure', file: 'test/v094-features.test.mjs',
    title: 'design-tokens.mjs 只能是构建期依赖,不得被运行时模块 import',
    why: '它不在 files 里。一旦运行时 import 它,安装后会 MODULE_NOT_FOUND —— 而仓库里(有那个文件)永远跑得通,这是最典型的"本地绿、用户炸"。',
  },
  {
    id: 'V64', kind: 'structure', file: 'test/escape-structural.test.mjs',
    title: 'innerHTML 赋值里的数据插值必须走 esc() / tpl` / raw() 三者之一',
    why: '本页近 40 处 innerHTML 里混着用户可控字符串(会话标题、工作目录、模型名、搜索词)。此前全靠"每次都记得 esc()":逐条核对过没有漏,但新增一处 `+ m.title +` 就能悄悄破掉它且不报错。这条把纪律变成结构。',
  },
  {
    id: 'V64b', kind: 'structure', file: 'test/escape-structural.test.mjs',
    title: 'web/src 的 innerHTML 使用点数量必须正常(页面没被搬走)',
    why: 'V64 的守卫依赖"能扫到那些赋值点"。若页面被整体搬去别处(或改成模板字符串),扫描会得到空集合而**全部通过** —— 需要一条下限断言兜底。',
  },
  {
    id: 'V65', kind: 'behavior', file: 'test/escape-structural.test.mjs',
    title: 'tpl`` 默认转义 / raw() 显式豁免 / 嵌套不得二次转义',
    why: 'tpl`` 返回**片段对象**(带 toString)而不是裸字符串,正是为了让嵌套不被二次转义 —— 否则用户会看到 `&amp;lt;b&amp;gt;` 这种双重实体。',
  },
  {
    id: 'V65b', kind: 'behavior', file: 'test/escape-structural.test.mjs',
    title: 'raw() 参与普通字符串拼接不得变成 [object Object]',
    why: '包装对象一参与 `+`,JS 就调 toString。没有这一条,页面上会出现 "[object Object]" 而不是内容 —— 一个纯显示错误,却能让人以为数据坏了。',
  },
  {
    id: 'V65c', kind: 'behavior', file: 'test/escape-structural.test.mjs',
    title: 'tpl``:数组按片段连接(常见于 .map(...).join 的替代写法)',
    why: '数组若不逐元素应用同一规则,`tpl`${rows}`` 会把整个数组转义成一个逗号分隔的字符串 —— 列表类界面会整块显示成一行文本。',
  },
  {
    id: 'V65d', kind: 'behavior', file: 'test/escape-structural.test.mjs',
    title: 'tpl``:数字 / null / undefined / 布尔 都不得产出 "null" 字样',
    why: '缺失值必须显示为空,而不是字面量 "null"/"undefined" —— 后者在会话列表里看起来像数据损坏。',
  },
  {
    id: 'V65e', kind: 'behavior', file: 'test/escape-structural.test.mjs',
    title: 'isRaw 只认 raw()/tpl` 的返回值',
    why: '豁免必须**不可伪造**:手写的普通对象若被当成已转义,任何人都能绕过转义。',
  },
  {
    id: 'V66', kind: 'behavior', file: 'test/escape-structural.test.mjs',
    title: '恶意会话标题/工作目录/会话 id 不得产出可执行标签',
    why: '这些值来自本机会话日志(含模型与插件可写内容),是本插件唯一真实的注入面;CSP 限制了爆炸半径(connect-src self),但不能替代转义。',
  },
  {
    id: 'V66b', kind: 'behavior', file: 'test/escape-structural.test.mjs',
    title: 'emptyHTML 的 title/sub 都是转义过的(搜索词这条路)',
    why: '会话页把**用户输入的搜索词**拼进空状态文案;这是最容易被忽略的一条路径(它看起来只是"一句提示")。',
  },
  {
    id: 'V66c', kind: 'behavior', file: 'test/escape-structural.test.mjs',
    title: 'sessionRow 正常输入仍渲染完整行结构',
    why: '加转义最容易顺手改坏结构(标签数、属性、格式化)。这条锁定"正常数据看到的仍是原来那一行"。',
  },
  {
    id: 'V66d', kind: 'behavior', file: 'test/escape-structural.test.mjs',
    title: 'sessionRow 大体量徽章仍然出现',
    why: '徽章是条件拼接分支 —— 改动转义写法时最容易被误删的那一支,而删掉后没有任何报错。',
  },
  {
    id: 'V66e', kind: 'behavior', file: 'test/escape-structural.test.mjs',
    title: 'renderFilterChips 的模型名/目录/会话值都不得注入',
    why: '筛选胶囊把三个筛选值(模型名、cwd、会话 id)同时拼进 HTML,是同一屏内注入面最集中的一处。',
  },
  // ── 增量聚合(0.9.5)────────────────────────────────────────────────────
  {
    id: 'V67', kind: 'behavior', file: 'test/v095-incremental.test.mjs',
    title: '增量重折必须与全量重建逐值等价(追加/缩短/删除/新增,多轮随机)',
    why: '0.9.5 把扫描收尾从"有变化就整库重折"改成"只重折被改动的会话",代价从 O(全库) 降到 O(改动量)。代价是 unfold(减)与 fold(加)只要有一处不对称,聚合就会**永久偏移且不报错**。这条随机多轮、四种变更混跑的等价性是本次改动唯一的放行依据。',
  },
  {
    id: 'V67e', kind: 'behavior', file: 'test/v095-incremental.test.mjs',
    title: '增量与全量的查询/导出输出必须逐字节相同',
    why: '只比聚合树是不够的:查询走 days/months 聚合快路径,与逐记录慢路径是两套代码。若聚合内部表示"看起来一致"而快慢路径口径不同,用户拿到的 KPI 与导出的 CSV 就会自相矛盾。',
  },
  {
    id: 'V68', kind: 'behavior', file: 'test/v095-incremental.test.mjs',
    title: '改了价格/时段必须让增量失效(configStale),且全量重折后恢复',
    why: '每笔记录的 cost/saved 是按**当时的价目**算好写进去的。改了单价之后若还走增量,未被重折的会话仍是旧价,聚合里就同时存在两种口径 —— 总额谁也说不清,而页面上没有任何提示。',
  },
  {
    id: 'V68b', kind: 'behavior', file: 'test/v095-incremental.test.mjs',
    title: '只改刷新策略/预算不得推进配置世代(否则每次改 pageSec 都要全库重折)',
    why: '配置世代是"必须整库重折"的信号。若把与记账无关的配置(刷新间隔、预算)也算进去,用户每调一次刷新频率都会触发一次全库重折 —— 把省下来的性能又还回去。',
  },
  {
    id: 'V69', kind: 'behavior', file: 'test/v095-incremental.test.mjs',
    title: '对每个会话 unfold 之后,聚合树必须归零(unfold 是 fold 的精确逆)',
    why: '这是"减掉的确实等于加进去的"最直接的判据。它同时锁住一个实现事实:整数账(四段用量/请求数)必须**精确**归零,而金额账允许 ~1e-17 的浮点噪声 —— 把两者混为一谈会写出永远无法满足的断言。',
  },
  {
    id: 'V69b', kind: 'behavior', file: 'test/v095-incremental.test.mjs',
    title: 'unfold 必须按**传入的旧列表**结算,不得回读 store 里的当前列表',
    why: '这条对应一次真实事故:unfold 原先从 store 读"当前记录",而扫描时记录**已经被换成新的**,于是减去的是新列表、加上的也是新列表,旧贡献从未被移除 —— 实测改 1 个会话后那天少算一半,且不报错。现在旧列表由调用方显式传入,这个错误在签名层面就不可能再发生。',
  },
  {
    id: 'V70', kind: 'behavior', file: 'test/v095-incremental.test.mjs',
    title: '会话被删除时必须只做 unfold(只减不加),空桶要连壳一起清掉',
    why: '删除这一支最容易被"过滤掉不存在的会话"敷衍过去,那样旧贡献会永远留在账上。同时全量重建从零累加、不会留下空桶,增量减完却会留下 `{totals:0, models:{...}}` 的空壳 —— 不递归清理,一个已经没有任何数据的"月"会继续出现在月份列表里。',
  },
  {
    id: 'V71', kind: 'behavior', file: 'test/v095-incremental.test.mjs',
    title: '扫描侧少量会话变更必须走增量(不得整库重折),且聚合仍就绪',
    why: '这是 0.9.5 的**目的本身**:契约一旦退化成"又整库重折",功能上完全看不出问题,只有耗时悄悄回到 O(全库)。summary.aggMode 是为此暴露的可观测点。',
  },
  {
    id: 'V71b', kind: 'behavior', file: 'test/v095-incremental.test.mjs',
    title: '新增会话(无旧记录)也必须被折进聚合',
    why: '对应一个真实缺陷:worker 里写成 `if (oldRecs && oldRecs.length) 登记 delta`,于是**全新会话被整个跳过** —— 记录永远折不进聚合,而聚合还会报 ready(空 days + 有 requests 曾被认为是自洽形状)。空 oldList 的语义是"只需 fold、无需 unfold",不是"忽略"。',
  },
  {
    id: 'V71c', kind: 'behavior', file: 'test/v095-incremental.test.mjs',
    title: '记录被修剪(retention)后聚合必须同步减少',
    why: '修剪等于"记录变少了",与追加一样是一次记录列表替换。若只更新 store.requests 而不做 unfold,保留下来的聚合会继续统计已被删除的请求 —— KPI 比实际日志还大。',
  },
  {
    id: 'V72', kind: 'behavior', file: 'test/v095-incremental.test.mjs',
    title: '"有 requests 但 days 为空"必须是待重建形状,不得被判定为就绪',
    why: '空 days 原先只在"整库确实没有记录"时才自洽,`aggregatesNeedRebuild` 对"有记录却没有桶"这个**矛盾中间态**报了 false。旧实现靠调用方无条件整库重折把它盖过去;改成按需重折之后它会一直留着,而 aggregatesReady 还报 true —— 每个查询都拿到一张空账。',
  },
  {
    id: 'V72b', kind: 'behavior', file: 'test/v095-incremental.test.mjs',
    title: '改动 requests 之后形状缓存必须作废(不得沿用改动前的结论)',
    why: '`aggregateShapeOk` 只以 days 的对象标识为缓存键,而"requests 变了、days 还是同一个对象"正是扫描的中间态。实测:空库 flushAggregates() 把形状缓存成 ok=true 后扫进 2 个会话,aggregatesReady 仍报 true,聚合再也不会被重建。所以任何改动 requests 的地方都必须 markStale。',
  },
  // ── 宿主 revision 粒度(0.1.7-alpha.1 回归)────────────────────────────
  {
    id: 'V73', kind: 'behavior', file: 'test/v096-hostrev.test.mjs',
    title: '遗留会话的整库语料哈希不得让任一会话变动触发全库重读',
    why: '宿主 0.1.7-alpha.1 把 v3 遗留会话的 revision 改成"文件身份:整库语料哈希"。原实现直接比 wm.rev !== revision,于是任何一个文件被新建/追加/触碰都会让全部遗留会话的水位线同时失效,每轮整库重读。作者实测 70 会话(65 个 v3)只改 1 个文件的 mtime:88ms → 8512ms;而页面「进入界面时先扫描」默认开启,表现为打开面板白屏到扫完 —— 即"时好时坏"。水位线必须只认文件身份。',
  },
  {
    id: 'V73b', kind: 'behavior', file: 'test/v096-hostrev.test.mjs',
    title: '语料哈希变化本身(其他格式文件被碰)不得重读任何遗留会话',
    why: '与 V73 同一事故的另一面:整库语料哈希会因**任何**文件的 stat 变化而变,包括当前格式(v4)会话与无关目录。若不隔离这一项,单靠"只比文件身份"仍可能被别处的哈希变化带偏 —— 这条锁定"哈希变了但文件身份没变 → 零重读"。',
  },
  {
    id: 'V73c', kind: 'behavior', file: 'test/v096-hostrev.test.mjs',
    title: '老库残留的六段 rev(含整库哈希)不得触发一次整库重读',
    why: '已在 0.1.7 上跑过的库,水位线里存的正是六段形态。修复只归一化当前快照而不归一化**已存值**的话,升级后的第一轮会把全部遗留会话判为"变了"而整库重读一次 —— 正是本次要消除的卡顿。存值也必须过 ownRevisionToken。',
  },
  {
    id: 'V73d', kind: 'behavior', file: 'test/v096-hostrev.test.mjs',
    title: '遗留会话的兄弟依赖按父会话子树精确追踪(不扩大也不缩小)',
    why: '整库哈希原本表达的是"遗留会话的解码可能依赖兄弟文件"(宿主 prepareStoredMigration 会读 origin=subagent && parentSession=id 的子会话)。直接丢掉这层依赖会让父会话在子会话变化后不再重折(数据静默少算)。改用"该父会话的子会话 id+文件身份"表达:子会话增删改只重读该父,不波及别的父。这条同时锁定不能收普通 parentSession 会话。',
  },
  {
    id: 'V73e', kind: 'structure', file: 'test/v096-hostrev.test.mjs',
    title: 'ownRevisionToken 只保留文件身份,relatedFingerprints 只认子代理子会话',
    why: '上面三条的行为断言依赖这两个纯函数。它们的边界(五段原样返回、内存会话段数不足、null/undefined 不抛)必须单独锁住 —— 否则宿主换一种 revision 形态(或 pending 会话的 memory: 形态)时,归一化会静默切错分支。',
  },
]
export const GAPS = {
  V19: '并入 V18(同一主题的两条断言合为一条,归一口径的形状一致性已由 V18 全覆盖)',
}

/** 按 id 取一条登记(便于测试与文档生成共用同一份数据)。 */
export function invariantById(id) {
  return INVARIANTS.find((x) => x.id === id) || null
}

/** 全部已登记编号(升序,数字优先、字母后缀在后)。 */
export function invariantIds() {
  const num = (id) => Number(String(id).replace(/^V(\d+).*$/, '$1'))
  const suf = (id) => String(id).replace(/^V\d+/, '')
  return INVARIANTS.map((x) => x.id).sort((a, b) => num(a) - num(b) || suf(a).localeCompare(suf(b)))
}
