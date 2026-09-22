window.__ModuleLoader__.load({
  
  
  id: '@fufuf-c/dsh-token',
  factory: (require) => {
    
    
    
    var module = { exports: {} }
    const React = require('react')
    const h = React.createElement

    const style = document.createElement('style')
    style.setAttribute('data-plugin', '@fufuf-c/dsh-token')
    style.textContent = `
/* ======================= 外壳部位(跟随 DSH) ======================= */
/* 侧边栏入口**不再自绘**:注册进 sidebar.panellist(全局面板图标位),行高、内边距、
   悬停底色、选中态、宽窄栏形态全部由 DSH 外壳画 —— 与内置面板同一区、同一款样式。
   过去自绘一行 .dtk-entry 挂在 sidebar.footer.action:那是个 display:flex 且
   **不换行**的槽,而 dsh-token 与 dsh-context 的入口都写死 width:100%,于是各被压成
   一半、并排挤在设置上方。那半截宽度是外壳算出来的,从自绘行内部改不掉 —— 所以
   正解不是"把行画得更像",而是**把行还给外壳**。 */
/* 全局面板:仪表盘是独立文档(/dsh-token),这里用 iframe 嵌进中央面板。
   不重写成 React 的理由:整页 210KB 自绘界面(图表/热力图/键盘游走/手势)本身就是
   这个插件的产品本体,/dsh-token 是它可独立打开的发布形态;嵌进来两端共用同一份
   代码与同一套 /dsh-token/api/*,而重写一份会立刻产生两套必然漂移的实现。 */
.dtk-frame-wrap{flex:1;min-height:0;min-width:0;display:flex;background:var(--dsw-alias-bg-base)}
.dtk-frame{display:block;flex:1;width:100%;min-height:0;border:0;background:transparent}
.dtk-panel{display:flex;flex-direction:column;gap:10px;padding:4px 2px;max-width:640px}
.dtk-row{display:flex;justify-content:space-between;gap:12px;font-size:var(--dsh-content-font-size,14px)}
.dtk-row b{font-weight:600}
.dtk-mono{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:calc(11.5px + var(--dsh-content-font-delta,0px));word-break:break-all;color:var(--dsw-alias-label-secondary,#8e8e93)}
.dtk-open{display:inline-flex;align-items:center;gap:6px;align-self:flex-start;font-size:var(--dsh-content-font-size,14px);color:var(--dsw-alias-link,#4176e6);text-decoration:none}
.dtk-open:hover{text-decoration:underline}
.dtk-open svg{width:13px;height:13px}

/* ============ 会话内「本会话用量」:与 /dsh-token 同一套 iOS 设计语言 ============
   调色板**不再手工抄一遍**:下面的变量块由 lib/design-tokens.mjs(单一来源)
   经 scripts/build-tokens.mjs 注入,test/design-consistency.test.mjs 校验无漂移。
   标记之间的内容请勿手改 —— 改配色请改 lib/design-tokens.mjs。
   深浅由 DSH 的 body[data-ds-dark-theme] 驱动 —— 面板自己成一块产品视图。 */
.dtk-app{
  color-scheme:light;
/* dtk:tokens:begin */
  --d-bg:#f2f2f7;
  --d-grad:radial-gradient(110% 50% at 50% -8%,rgba(10,132,255,.09),transparent 60%),radial-gradient(60% 40% at 88% 0%,rgba(191,90,242,.05),transparent 65%);
  --d-glass-border:rgba(255,255,255,.5);
  --d-specular:inset 0 1px 0 rgba(255,255,255,.75);
  --d-surface2:rgba(120,120,128,.08);
  --d-chip:rgba(120,120,128,.10);
  --d-text:#1d1d1f;
  --d-text2:#6e6e73;
  --d-text3:#aeaeb2;
  --d-hairline:rgba(0,0,0,.14);
  --d-hairline-2:rgba(0,0,0,.07);
  --d-accent:#007aff;
  --d-accent-soft:rgba(0,122,255,.13);
  --d-red:#ff3b30;
  --d-green:#34c759;
  --d-blue:#007aff;
  --d-orange:#ff9500;
  --d-teal:#5ac8fa;
  --d-purple:#af52de;
  --d-indigo:#5856d6;
  --d-gray:#8e8e93;
  --d-shadow:0 1px 1px rgba(0,0,0,.03),0 2px 10px rgba(0,0,0,.05),0 14px 36px rgba(0,0,0,.07);
  --d-shadow-float:0 8px 40px rgba(0,0,0,.18);
  --d-aurora:linear-gradient(100deg,#0a84ff 0%,#5e5ce6 24%,#bf5af2 48%,#ff375f 72%,#ff9f0a 100%);
  --d-glass:linear-gradient(180deg,rgba(255,255,255,.86),rgba(255,255,255,.62));
/* dtk:tokens:end */
  /* 底色**接**宿主,不是压一层自己的:会话根节点(ConversationRoot)画的就是
     --dsw-alias-bg-base,面板只有用同一个 token 才和相邻页签(对话/轨迹/上下文)无缝。
     --d-bg 退居兜底 —— 宿主 token 缺失时(独立打开本文件)仍有产品自己的底色。 */
  background:var(--d-grad),var(--dsw-alias-bg-base,var(--d-bg));
  color:var(--d-text);
  height:100%;box-sizing:border-box;overflow-y:auto;padding:14px 18px 24px;
  /* 字体与字号同样是**接**宿主,而不是抄一份值:
     - --dsw-font-family 是 DSH 留给主题覆写的钩子(基础样式故意不定义);
     - --dsh-content-font-size / -delta 就是「外观」里那个正文字号(12–17px,默认 14),
       会话区里 chat/conversation/tool 等视图全部走这两个变量。
     面板是会话区里的一整屏视图,必须跟着用户设的字号走;抄死 15px 会无视该设置。 */
  font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Helvetica,Arial,sans-serif);
  font-size:var(--dsh-content-font-size,14px);
  line-height:calc(24px + var(--dsh-content-font-delta,0px));
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
}
body[data-ds-dark-theme] .dtk-app{
  color-scheme:dark;
/* dtk:tokens:begin */
  --d-bg:#000;
  --d-grad:radial-gradient(110% 50% at 50% -8%,rgba(94,92,230,.15),transparent 60%),radial-gradient(60% 40% at 88% 0%,rgba(191,90,242,.07),transparent 65%);
  --d-glass-border:rgba(255,255,255,.09);
  --d-specular:inset 0 1px 0 rgba(255,255,255,.08);
  --d-surface2:rgba(120,120,128,.16);
  --d-chip:rgba(120,120,128,.2);
  --d-text:#f5f5f7;
  --d-text2:#98989d;
  --d-text3:#6e6e73;
  --d-hairline:rgba(255,255,255,.16);
  --d-hairline-2:rgba(255,255,255,.09);
  --d-accent:#0a84ff;
  --d-accent-soft:rgba(10,132,255,.22);
  --d-red:#ff453a;
  --d-green:#30d158;
  --d-blue:#0a84ff;
  --d-orange:#ff9f0a;
  --d-teal:#64d2ff;
  --d-purple:#bf5af2;
  --d-indigo:#7d7aff;
  --d-gray:#98989d;
  --d-shadow:0 1px 0 rgba(0,0,0,.2),0 8px 30px rgba(0,0,0,.35);
  --d-shadow-float:0 8px 40px rgba(0,0,0,.6);
  --d-aurora:linear-gradient(100deg,#0a84ff 0%,#7d7aff 24%,#bf5af2 48%,#ff375f 72%,#ff9f0a 100%);
  --d-glass:linear-gradient(180deg,rgba(42,42,47,.62),rgba(26,26,30,.5));
/* dtk:tokens:end */
}
.dtk-app *{box-sizing:border-box}
.dtk-inner{width:100%;max-width:680px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
/* ---- 顶部:标题 + iOS 胶囊按钮 ---- */
.dtk-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:2px 2px 0}
.dtk-top h1{font-size:calc(22px + var(--dsh-content-font-delta,0px));font-weight:750;letter-spacing:-.022em;margin:0;flex:1;min-width:0}
.dtk-acts{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
/* iOS 胶囊按钮:次级=灰底 chip(与仪表盘 .peak-presets 同语言),主动作=强调色实心 */
.dtk-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 13px;border:0;border-radius:980px;background:var(--d-chip);font-size:calc(12.5px + var(--dsh-content-font-delta,0px));font-weight:600;color:var(--d-text2);cursor:pointer;font-family:inherit;white-space:nowrap;text-decoration:none;transition:background .18s ease-out,transform .14s ease-out,color .18s ease-out}
.dtk-btn:hover{background:var(--d-surface2);color:var(--d-text)}
.dtk-btn:active{transform:scale(.96)}
.dtk-btn:disabled{opacity:.45;cursor:default}
.dtk-btn.ghost.ok{color:var(--d-green)}
.dtk-btn.ghost.bad{color:var(--d-red)}
.dtk-btn.primary{background:var(--d-accent);color:#fff;box-shadow:0 1px 4px rgba(0,122,255,.3)}
.dtk-btn.primary:hover{background:var(--d-accent);color:#fff;filter:brightness(1.06)}
.dtk-btn svg{width:16px;height:16px;flex:none}
/* ---- Liquid Glass 卡片 ---- */
.dtk-card{background:var(--d-glass);backdrop-filter:blur(40px) saturate(180%);-webkit-backdrop-filter:blur(40px) saturate(180%);border:1px solid var(--d-glass-border);border-radius:22px;padding:18px;box-shadow:var(--d-shadow),var(--d-specular)}
.dtk-card.list{padding:4px 6px}
.dtk-chead{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.dtk-chead h2{font-size:calc(16px + var(--dsh-content-font-delta,0px));font-weight:700;letter-spacing:-.015em;margin:0}
.dtk-chead .r{margin-left:auto;font-size:calc(11.5px + var(--dsh-content-font-delta,0px));color:var(--d-text2);font-variant-numeric:tabular-nums}
/* ---- hero:大数字 + 逐小时柱 ---- */
/* 例外说明:hero 主数字(42px)与费用(24px)是**展示性图形字号**,刻意不跟
   正文字号轴一起缩放 —— 它们是这一屏的视觉锚点,跟着 12→17px 变化会让版面在
   最大字号下把下面的卡片挤走。其余全部文字(标题/图例/脚注/小卡)都接
   --dsh-content-font-delta,与宿主「外观」里的内容字号同步。 */
.dtk-hero-top{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
.dtk-hero-num{font-size:42px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums;line-height:1.05}
.dtk-hero-num .unit{font-size:15px;font-weight:600;color:var(--d-text2);letter-spacing:0;margin-left:6px}
.dtk-cost{text-align:right;flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.dtk-cost b{font-size:24px;font-weight:800;letter-spacing:-.022em;font-variant-numeric:tabular-nums;line-height:1.1}
.dtk-hero-meta{font-size:calc(13px + var(--dsh-content-font-delta,0px));color:var(--d-text2);margin-top:7px;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.dtk-hero-meta .sep{color:var(--d-text3)}
/* ---- 逐小时柱:纵轴 + 网格 + 绘图区 ----
   柱高是**相对本会话单小时峰值**的比例,原来没有任何刻度 —— 读者只能看出谁高谁矮,
   读不出量级。纵轴刻度复用面板其他数字的 TOK 口径(9.14 M / 4.57 M / 0),这样
   "柱子到顶"和 hero 里的大数字是同一把尺子;三条淡网格线画在柱子**后面**,
   半透明柱身会透出线,读起来像背景标尺而不是压在柱子上的横杠。 */
.dtk-hchart{display:flex;gap:8px;margin-top:16px}
.dtk-hyaxis{flex:none;display:flex;flex-direction:column;align-items:flex-end;justify-content:space-between;height:64px;line-height:1;white-space:nowrap;text-align:right;font-size:calc(9.5px + var(--dsh-content-font-delta,0px));color:var(--d-text3);font-variant-numeric:tabular-nums}
.dtk-hmain{flex:1;min-width:0}
.dtk-hplot{position:relative;height:64px}
.dtk-hgrid{position:absolute;inset:0;z-index:0;pointer-events:none}
.dtk-hgrid i{position:absolute;left:0;right:0;height:1px;background:var(--d-hairline-2)}
.dtk-hgrid i:nth-child(1){top:0}
.dtk-hgrid i:nth-child(2){top:50%}
.dtk-hgrid i:nth-child(3){bottom:0}
/* z-index 把柱子抬到网格线上方 —— 绝对定位的网格线否则会盖在柱身之上 */
.dtk-hours{position:relative;z-index:1;display:flex;align-items:flex-end;gap:3px;height:64px}
.dtk-hcol{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;border-radius:3px;overflow:hidden;background:var(--d-chip)}
.dtk-hcol i{display:block;width:100%}
.dtk-hid{background:var(--d-blue)}
.dtk-hpk{background:var(--d-orange)}
/* 逐小时明细浮层:沿用面板自己的液态玻璃语言(--d-glass / --d-glass-border /
   --d-shadow-float),而不是宿主页面的 #tip —— 面板是独立视图,不能依赖宿主 DOM。
   浮在绘图区**上方**(bottom:100%)而不是压在柱子上:柱子本身就是被读的对象,
   盖住最高的几根就白画了。
   pointer-events:none 是必须的:浮层若可命中指针,指针一进浮层就触发柱子的
   pointerleave,浮层会把自己抖掉。
   横向**跟着指针走**:内联 left 是光标在绘图区里的百分比,translateX(-50%) 让
   浮层中心压在光标上。旧版把浮层钉在本柱的左沿(靠右的柱子钉右沿),指针在柱子
   内部左右移动时浮层纹丝不动 —— 那正是"提示框不跟着鼠标走"的来源。
   translateX(-50%) 会带来探出卡片的风险,所以 JS 侧用**量到的浮层宽度**把中心
   夹在 [半宽, 绘图区宽-半宽] 之内(见 trackTipX):贴边时浮层是"停住"而不是
   "探出去",这也是各主流图表库 followCursor 的做法。 */
.dtk-htip{position:absolute;bottom:calc(100% + 6px);z-index:3;pointer-events:none;transform:translateX(-50%);background:var(--d-glass);backdrop-filter:blur(24px) saturate(180%);-webkit-backdrop-filter:blur(24px) saturate(180%);border:1px solid var(--d-glass-border);border-radius:12px;padding:7px 11px;box-shadow:var(--d-shadow-float),var(--d-specular);color:var(--d-text);white-space:nowrap;font-size:calc(11px + var(--dsh-content-font-delta,0px));line-height:1.5}
.dtk-htip b{display:block;font-weight:650}
.dtk-htip span{display:block;color:var(--d-text2);font-variant-numeric:tabular-nums}
.dtk-haxis{display:flex;justify-content:space-between;margin-top:6px;font-size:calc(10px + var(--dsh-content-font-delta,0px));color:var(--d-text3);font-variant-numeric:tabular-nums}
/* ---- 图例胶囊 ---- */
.dtk-legend{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.dtk-lg{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:980px;background:var(--d-chip);color:var(--d-text2);font-size:calc(11px + var(--dsh-content-font-delta,0px));line-height:1.3;font-variant-numeric:tabular-nums}
.dtk-lg i{width:8px;height:8px;border-radius:50%;flex:none}
.dtk-lg.rule{background:none;padding-left:0;color:var(--d-text3)}
/* ---- 构成:细堆叠条 + 双列图例 ---- */
.dtk-segbar{display:flex;gap:2.5px;height:11px;border-radius:6px;overflow:hidden}
.dtk-segbar i{display:block;min-width:3px;border-radius:1px}
.dtk-seglegend{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;margin-top:14px}
.dtk-sli{display:flex;align-items:flex-start;gap:9px;min-width:0}
.dtk-sli .dot{width:9px;height:9px;border-radius:3px;flex:none;margin-top:5px}
.dtk-sli b{display:block;font-size:calc(15px + var(--dsh-content-font-delta,0px));font-weight:700;letter-spacing:-.01em;font-variant-numeric:tabular-nums;line-height:1.2}
.dtk-sli span{display:block;font-size:calc(11px + var(--dsh-content-font-delta,0px));color:var(--d-text2);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* ---- 亮点小卡 ---- */
.dtk-flow{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.dtk-mini{background:var(--d-glass);backdrop-filter:blur(40px) saturate(180%);-webkit-backdrop-filter:blur(40px) saturate(180%);border:1px solid var(--d-glass-border);border-radius:18px;padding:14px 15px;box-shadow:var(--d-shadow),var(--d-specular);min-width:0}
.dtk-mini .mk{display:flex;align-items:center;gap:7px;font-size:calc(11px + var(--dsh-content-font-delta,0px));color:var(--d-text2);font-weight:600}
.dtk-mini .ic{width:20px;height:20px;border-radius:6.5px;display:inline-flex;align-items:center;justify-content:center;flex:none}
.dtk-mini .ic svg{width:11px;height:11px}
.dtk-mini .mv{font-size:calc(22px + var(--dsh-content-font-delta,0px));font-weight:750;letter-spacing:-.025em;margin-top:6px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dtk-mini .ms{font-size:calc(11px + var(--dsh-content-font-delta,0px));color:var(--d-text3);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* ---- 模型行(仪表盘 .catrow 语言) ---- */
.dtk-cat{position:relative;display:flex;align-items:center;gap:11px;padding:11px 10px;border-radius:12px}
.dtk-cat:not(:last-child)::after{content:'';position:absolute;left:32px;right:0;bottom:0;height:1px;background:var(--d-hairline-2)}
.dtk-cat .cdot{width:11px;height:11px;border-radius:4px;flex:none}
.dtk-cat .cmain{flex:1;min-width:0}
.dtk-cat .cname{font-size:calc(12.5px + var(--dsh-content-font-delta,0px));font-weight:600;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace)}
.dtk-cat .cbar{height:4.5px;border-radius:3px;background:var(--d-chip);margin-top:6px;overflow:hidden}
.dtk-cat .cbar i{display:block;height:100%;border-radius:3px;min-width:3px}
.dtk-cat .cval{text-align:right;flex:none}
.dtk-cat .cval b{font-size:calc(13px + var(--dsh-content-font-delta,0px));font-weight:700;font-variant-numeric:tabular-nums;display:block;line-height:1.35}
.dtk-cat .cval span{font-size:calc(10.5px + var(--dsh-content-font-delta,0px));color:var(--d-text2);font-variant-numeric:tabular-nums}
.dtk-pill{display:inline-flex;align-items:center;gap:4px;padding:2.5px 9px;border-radius:980px;font-size:calc(10.5px + var(--dsh-content-font-delta,0px));font-weight:600;background:var(--d-chip);color:var(--d-text2);white-space:nowrap}
.dtk-pill.warn{background:color-mix(in srgb,var(--d-orange) 16%,transparent);color:var(--d-orange)}
.dtk-pill.good{background:color-mix(in srgb,var(--d-green) 15%,transparent);color:var(--d-green)}
/* ---- 异常提示 ---- */
.dtk-anom{display:flex;gap:10px;align-items:flex-start}
.dtk-anom .wi{color:var(--d-orange);flex:none;margin-top:1px}
.dtk-anom .wi svg{width:19px;height:19px}
.dtk-anom .at{font-size:calc(13.5px + var(--dsh-content-font-delta,0px));font-weight:700}
.dtk-anom .ad{font-size:calc(11.5px + var(--dsh-content-font-delta,0px));color:var(--d-text2);line-height:1.6;margin-top:3px}
.dtk-anom .aa{margin-top:10px}
/* ---- 空态 / 骨架 / 脚注 ---- */
.dtk-state{padding:32px 16px;text-align:center;color:var(--d-text2);display:flex;flex-direction:column;align-items:center;gap:4px}
.dtk-state .si svg{width:32px;height:32px}
/* 错误态用警示色,与"没有数据"的中性空态一眼分得开 */
.dtk-state.bad .si{color:var(--d-orange);opacity:.85}
.dtk-state b{font-size:calc(14.5px + var(--dsh-content-font-delta,0px));font-weight:700;color:var(--d-text)}
.dtk-state span{font-size:calc(11.5px + var(--dsh-content-font-delta,0px));line-height:1.65;max-width:430px}
.dtk-state .dtk-acts{justify-content:center;margin-top:14px}
.dtk-skel{display:flex;flex-direction:column;gap:12px}
.dtk-skel i{display:block;border-radius:20px;background:var(--d-chip);animation:dtk-pulse 1.5s ease-in-out infinite}
.dtk-skel i:nth-child(1){height:120px}
.dtk-skel i:nth-child(2){height:96px}
.dtk-skel i:nth-child(3){height:140px}
@keyframes dtk-pulse{0%,100%{opacity:1}50%{opacity:.45}}
@keyframes dtk-spin{to{transform:rotate(360deg)}}
.dtk-spin{animation:dtk-spin .9s linear infinite}
/* 面板内按钮的键盘焦点圈:玻璃卡片上 UA 默认描边几乎看不见。
   (侧边栏那一行本来就有,这里补齐面板内所有按钮与链接。) */
.dtk-btn:focus-visible,.dtk-open:focus-visible{outline:2px solid var(--d-accent);outline-offset:2px}
/* 跟随用户的"减少动态效果"偏好:持续脉冲的骨架与旋转的刷新图标正是这条媒体查询
   存在的理由。宿主各包都自带规则,面板作为嵌进宿主的一屏不该例外。 */
@media (prefers-reduced-motion:reduce){
  .dtk-skel i{animation:none;opacity:.7}
  .dtk-spin{animation:none}
}
.dtk-foot{text-align:center;font-size:calc(11px + var(--dsh-content-font-delta,0px));color:var(--d-text3);line-height:1.65;padding:0 8px}
`
    document.head.appendChild(style)

    
    
    
    const TOK = (n) => {
      n = Number(n) || 0
      if (n >= 1e9) return (n / 1e9).toFixed(2) + ' B'
      if (n >= 1e6) return (n / 1e6).toFixed(2) + ' M'
      if (n >= 1e3) return (n / 1e3).toFixed(1) + ' K'
      return String(Math.round(n))
    }

    const fmtNum = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    const COST = (n) => {
      n = Number(n) || 0
      if (n >= 1000) return n.toFixed(0)
      if (n > 0 && n < 0.01) return n.toFixed(4)
      return n.toFixed(2)
    }
    const MONEY = (n) => '¥' + COST(n)
    const PCT = (x) => ((Number(x) || 0) * 100).toFixed(1) + '%'
    const pad2 = (n) => String(n).padStart(2, '0')
    const CLOCK = (ms) => { if (!ms) return ''; const d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }
    const DAY = (ms) => { if (!ms) return ''; const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()}` }

    const sumOf = (t) => t ? (t.miss || 0) + (t.read || 0) + (t.write || 0) + (t.out || 0) : 0

    function derive(d) {
      const t = (d && d.totals) || {}
      const miss = t.miss || 0, read = t.read || 0, write = t.write || 0, out = t.out || 0
      const total = miss + read + write + out
      const cost = t.cost || 0
      const saved = t.saved || 0
      const reqs = (d && (d.requestCount || t.requests)) || 0
      
      
      
      const unpricedTok = d && Number(d.unpriced) > 0 ? Number(d.unpriced) : 0
      const priced = cost > 0
      const inTok = miss + read + write
      return {
        miss, read, write, out, total, cost, saved, reqs,
        unpricedTok, priced,
        noPrice: total > 0 && (!priced || unpricedTok > 0),
        share: (v) => (total > 0 ? v / total : 0),
        
        
        
        
        
        
        hitRate: inTok > 0 ? read / inTok : 0,
        inTok,
        avg: reqs > 0 ? total / reqs : 0,
        avgCost: reqs > 0 ? cost / reqs : 0,
      }
    }

    function postScan() {
      return fetch('/dsh-token/api/scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store',
      }).then((r) => {
        if (!r.ok) return { ok: false, error: 'HTTP ' + r.status + (r.status === 403 ? '(跨源请求被拒绝,请用本机地址打开)' : '') }
        return r.json().then((j) => ({ ok: true, summary: j && j.summary }), () => ({ ok: true }))
      }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }))
    }

    function refreshOnOpen() {
      try {
        const v = window.localStorage.getItem('dsh-token-refresh-onopen')
        return v === null ? true : v === '1'
      } catch (e) { return true }
    }

    
    
    
    
    
    
    const path = (d) => h('path', { d, key: d })
    const Ico = (children) => function Icon(props) {
      const p = props || {}
      const s = p.size || 16
      return h('svg', {
        width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
        className: p.className, 'aria-hidden': true,
      }, children)
    }

    const IcRefresh = Ico([
      path('M20.6 12A8.6 8.6 0 1 1 12 3.4c2.5 0 4.8 1.1 6.3 2.8'),
      path('M20.9 3.4v5.4h-5.4'),
    ])

    const IcCopy = Ico([
      h('rect', { key: 'r', x: 9.6, y: 9.6, width: 11.9, height: 11.9, rx: 3.1 }),
      path('M5.6 16.4H5a2.5 2.5 0 0 1-2.5-2.5V5A2.5 2.5 0 0 1 5 2.5h8.9A2.5 2.5 0 0 1 16.4 5v.6'),
    ])
    const IcCheck = Ico([path('M4.5 12.6l5 5L19.5 6')])

    const IcUp = Ico([
      path('M7.4 16.6 16.6 7.4'),
      path('M9.2 7.4h7.4v7.4'),
    ])
    const IcWarn = Ico([
      path('M12 3.4 21.2 20.6H2.8z'),
      path('M12 9.4v5.2'),
      h('circle', { key: 'c', cx: 12, cy: 17.7, r: 1.15, fill: 'currentColor', stroke: 'none' }),
    ])
    const IcGauge = Ico([
      path('M3.2 19.2a9 9 0 1 1 17.6 0'),
      path('M12 13.8 17.2 8.6'),
      h('circle', { key: 'c', cx: 12, cy: 14.2, r: 1.7, fill: 'currentColor', stroke: 'none' }),
    ])
    const IcSave = Ico([path('M12 3v13'), path('m7 11 5 5 5-5'), path('M4 20h16')])
    const IcFlame = Ico([path('M12 3c1 3-1 4.5-2.5 6C7.9 10.7 7 12.3 7 14a5 5 0 0 0 10 0c0-1.6-.7-3-1.8-4.3-.8.9-1.9 1.3-2.7 1-.4-2.3-.5-5.2.5-7.7z')])
    const IcZap = Ico([path('M13 2 4 14h6l-1 8 9-12h-6l1-8z')])
    const IcClock = Ico([
      h('circle', { key: 'c', cx: 12, cy: 12, r: 8.5 }),
      path('M12 7.5V12l3.2 2'),
    ])

    function Glyph(props) {
      const s = (props && props.size) || 16
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, [
        h('line', { x1: 5, y1: 11, x2: 5, y2: 20, key: 'a' }),
        h('line', { x1: 12, y1: 4, x2: 12, y2: 20, key: 'b' }),
        h('line', { x1: 19, y1: 8, x2: 19, y2: 20, key: 'c' }),
        h('polyline', { points: '3 8 8 4 13 8 21 2', key: 'd' }),
      ])
    }

    function writeClipboard(text) {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          return Promise.resolve(navigator.clipboard.writeText(text)).then(() => true).catch(() => false)
        }
      } catch (e) {  }
      try {
        const el = document.createElement('textarea')
        el.value = text
        el.setAttribute('readonly', '')
        el.style.position = 'fixed'
        el.style.left = '-9999px'
        document.body.appendChild(el)
        el.select()
        const ok = typeof document.execCommand === 'function' ? document.execCommand('copy') : false
        el.remove()
        return Promise.resolve(!!ok)
      } catch (e) { return Promise.resolve(false) }
    }

    const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

    function schedText(sched) {
      if (!sched || !Array.isArray(sched.hours)) return null
      const days = Array.isArray(sched.days) ? sched.days.slice().sort((a, b) => a - b) : []
      if (!sched.hours.length || !days.length) return '高峰计价已关闭'
      const hrs = sched.hours.map((r) => `${r[0]}–${r[1]}`).join('、') + ' 点'
      let day
      if (days.length === 7) day = '每天'
      else if (days.join(',') === '1,2,3,4,5') day = '工作日'
      else day = days.map((d) => WEEK[d] || '').filter(Boolean).join(' ')
      return `${day} ${hrs}(北京时间)`
    }

    function summaryText(d) {
      const s = derive(d)
      const { miss, read, write, out, total, reqs, cost, saved } = s
      const lines = [
        `本会话用量 · ${TOK(total)} tokens · ${MONEY(cost)}`,
        `${reqs} 次请求 · 缓存命中率 ${PCT(s.hitRate)} · 缓存省下 ${MONEY(saved)}`,
        `缓存命中 ${TOK(read)} · 未命中 ${TOK(miss)} · 缓存写入 ${TOK(write)} · 输出 ${TOK(out)}`,
      ]
      const ti = d.tiers
      if (ti && ti.peak && ti.idle && (ti.peak.tokens + ti.idle.tokens) > 0) {
        lines.push(`高峰 ${TOK(ti.peak.tokens)} ${MONEY(ti.peak.cost)} · 空闲 ${TOK(ti.idle.tokens)} ${MONEY(ti.idle.cost)}`)
      }
      const sched = schedText(d.schedule)
      if (sched) lines.push(`高峰规则:${sched}`)
      for (const m of (d.models || []).slice(0, 8)) {
        const x = m.totals || {}
        const v = sumOf(x)
        lines.push(`${m.key} ${TOK(v)} ${(x.cost || 0) > 0 ? MONEY(x.cost) : '未定价'}`)
      }
      return lines.join('\n')
    }

    
    const CATS = [
      { key: 'read', label: '缓存命中', color: 'var(--d-green)' },
      { key: 'miss', label: '未命中', color: 'var(--d-red)' },
      { key: 'out', label: '输出', color: 'var(--d-blue)' },
      { key: 'write', label: '缓存写入', color: 'var(--d-gray)' },
    ]
    
    const CAT_COLORS = ['--d-blue', '--d-purple', '--d-teal', '--d-orange', '--d-red', '--d-green', '--d-indigo', '--d-gray']

    function PanelGlyph(props) {
      const p = props || {}
      return h(Glyph, { size: p.size || 16 })
    }

    function DashboardPanel() {
      return h('div', { className: 'dtk-frame-wrap' },
        h('iframe', {
          className: 'dtk-frame',
          src: '/dsh-token',
          title: 'Token 统计仪表盘',
          
          
          
          
          sandbox: 'allow-scripts allow-same-origin allow-downloads allow-popups allow-popups-to-escape-sandbox allow-forms',
        }))
    }

    const shell = (children) => h('div', { className: 'dtk-app' }, h('div', { className: 'dtk-inner' }, children))

    function SessionView(props) {
      const sid = props && props.sessionId ? String(props.sessionId) : ''
      const [d, setD] = React.useState(undefined) 
      const [err, setErr] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [copied, setCopied] = React.useState(0) 
      
      
      const [hoverHour, setHoverHour] = React.useState(null)
      
      
      
      const tipAnchor = React.useRef({ x: 0, half: 0, w: 0 })
      const plotRef = React.useRef(null)
      const tipRef = React.useRef(null)

      const clampLeft = (x, half, w) => {
        if (!w || !half) return x
        const lo = Math.min(half, w / 2)          
        const hi = Math.max(lo, w - half)
        return Math.min(Math.max(x, lo), hi)
      }
      const placeTip = (clientX) => {
        const plot = plotRef.current
        if (!plot) return
        const a = tipAnchor.current
        if (clientX != null) {
          const r = plot.getBoundingClientRect()
          a.w = r.width
          a.x = clientX - r.left
        }
        const tip = tipRef.current
        if (!tip) return
        a.half = tip.offsetWidth / 2
        tip.style.left = clampLeft(a.x, a.half, a.w) + 'px'
      }

      const tipLeftPx = () => {
        const a = tipAnchor.current
        return clampLeft(a.x, a.half, a.w)
      }
      
      
      React.useEffect(() => {
        if (hoverHour === null) return
        placeTip(null)
      }, [hoverHour])
      
      
      
      const hoverRef = React.useRef(null)
      
      
      const scanErr = React.useRef(null)
      
      
      
      const genRef = React.useRef(0)
      const copyTimer = React.useRef(null)

      const load = React.useCallback((gen) => {
        if (!sid) { setD(null); return Promise.resolve(null) }
        return fetch('/dsh-token/api/session?id=' + encodeURIComponent(sid) + '&brief=1', { cache: 'no-store' })
          .then((r) => {
            if (r.status === 404) return null 
            if (!r.ok) throw new Error('HTTP ' + r.status)
            return r.json()
          })
          .then((j) => {
            if (genRef.current !== gen) return j 
            setD(j || null); setErr(null); return j
          })
          .catch((e) => {
            if (genRef.current !== gen) return null
            
            
            
            setD(undefined); setErr(String((e && e.message) || e)); return null
          })
      }, [sid])

      React.useEffect(() => {
        const gen = ++genRef.current
        setD(undefined); setErr(null); scanErr.current = null
        
        
        if (!sid) { setD(null); return () => { genRef.current++ } }

        const fetchWithRetry = (alreadyScanned) => load(gen).then((j) => {
          if (genRef.current !== gen || j) return j
          
          if (alreadyScanned) return j
          return postScan().then((res) => {
            if (genRef.current !== gen) return null
            if (res && res.error) scanErr.current = res.error
            return load(gen)
          })
        })
        setBusy(true)
        
        
        
        const willScan = refreshOnOpen()
        const first = willScan
          ? postScan().then((res) => {
            
            
            if (genRef.current !== gen) return null
            if (res && res.error) scanErr.current = res.error
            return fetchWithRetry(true)
          })
          : fetchWithRetry(false)
        first.then((j) => {
          if (genRef.current !== gen) return
          setBusy(false)
          
          
          
          
          
          
          
          if (j === null && scanErr.current) { setD(undefined); setErr(scanErr.current) }
        }).catch((e) => {
          if (genRef.current !== gen) return
          setBusy(false); setD(undefined); setErr(String((e && e.message) || e))
        })
        return () => { genRef.current++ }
      }, [sid, load])

      React.useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

      const scan = () => {
        const gen = genRef.current
        setBusy(true)
        setErr(null)
        return postScan()
          .then((res) => {
            
            
            if (res && res.error) { if (genRef.current === gen) { setErr(res.error); setBusy(false) } ; return null }
            return load(gen)
          })
          .then(() => { if (genRef.current === gen) setBusy(false) })
      }

      const onCopy = () => {
        if (!d) return
        Promise.resolve(writeClipboard(summaryText(d))).then((ok) => {
          if (copyTimer.current) clearTimeout(copyTimer.current)
          setCopied(ok ? 1 : 2)
          copyTimer.current = setTimeout(() => setCopied(0), 1800)
        })
      }

      const dashBtn = h('a', {
        className: 'dtk-btn primary', href: '/dsh-token', target: '_blank', rel: 'noopener noreferrer',
        title: '全部会话 / 全部时间(新开页面)',
      }, [h(IcUp, { size: 16, key: 'i' }), '完整仪表盘'])

      const refreshBtn = h('button', {
        type: 'button', className: 'dtk-btn', disabled: busy, onClick: scan,
        title: '增量扫描一次本地日志并刷新',
      }, [
        busy ? h(IcRefresh, { size: 16, className: 'dtk-spin', key: 'i' }) : h(IcRefresh, { size: 16, key: 'i' }),
        busy ? '刷新中' : '刷新',
      ])

      const copyBtn = copied === 1 ? h('button', {
        type: 'button', key: 'c', onClick: onCopy,
        className: 'dtk-btn ghost ok',
        title: '复制本会话的用量摘要',
      }, [h(IcCheck, { size: 16, key: 'i' }), '已复制']) : copied === 2 ? h('button', {
        type: 'button', key: 'c', onClick: onCopy,
        className: 'dtk-btn ghost bad',
        title: '复制本会话的用量摘要',
      }, [h(IcWarn, { size: 16, key: 'i' }), '复制失败']) : h('button', {
        type: 'button', key: 'c', onClick: onCopy,
        className: 'dtk-btn ghost',
        title: '复制本会话的用量摘要',
      }, [h(IcCopy, { size: 16, key: 'i' }), '复制摘要'])

      
      
      const top = (withCopy) => h('div', { className: 'dtk-top' }, [
        h('h1', { key: 't' }, '本会话用量'),
        h('div', { className: 'dtk-acts', key: 'a', 'aria-live': 'polite' }, [
          withCopy ? copyBtn : null,
          refreshBtn,
          dashBtn,
        ]),
      ])

      
      
      
      if (err && d === undefined) {
        return shell([
          top(false),
          h('section', { className: 'dtk-card', key: 'err' }, h('div', { className: 'dtk-state bad' }, [
            h('span', { className: 'si', key: 'i' }, h(IcWarn, { size: 32 })),
            h('b', { key: 't' }, '读不到本会话用量'),
            h('span', { key: 'a' }, '插件没能取到这条会话的数据,原因如下。'),
            h('span', { key: 'c', className: 'dtk-mono' }, err),
            h('div', { className: 'dtk-acts', key: 'd' }, [
              h('button', { type: 'button', className: 'dtk-btn primary', key: 's', disabled: busy, onClick: scan }, [
                busy ? h(IcRefresh, { size: 16, className: 'dtk-spin', key: 'i' }) : h(IcRefresh, { size: 16, key: 'i' }),
                busy ? '重试中' : '重试',
              ]),
              dashBtn,
            ]),
          ])),
        ])
      }
      if (d === undefined) {
        return shell([
          top(false),
          h('section', { className: 'dtk-card', key: 'k' }, h('div', { className: 'dtk-skel' }, [h('i', { key: 1 }), h('i', { key: 2 }), h('i', { key: 3 })])),
        ])
      }
      if (!d) {
        return shell([
          top(false),
          h('section', { className: 'dtk-card', key: 'e' }, h('div', { className: 'dtk-state' }, [
            h('span', { className: 'si', key: 'i' }, h(IcGauge, { size: 32 })),
            h('b', { key: 't' }, '本会话还没有用量记录'),
            h('span', { key: 'a' }, 'DSH 会随着对话把日志写入磁盘,插件按周期增量扫描 —— 刚创建的对话可能要等下一次扫描。'),
            h('span', { key: 'b' }, '也可能这条会话的日志格式被宿主拒绝解析(v0 旧格式 / 未知事件),那样它不会出现在统计里。'),
            h('div', { className: 'dtk-acts', key: 'd' }, [
              h('button', { type: 'button', className: 'dtk-btn primary', key: 's', disabled: busy, onClick: scan }, [
                busy ? h(IcRefresh, { size: 16, className: 'dtk-spin', key: 'i' }) : h(IcRefresh, { size: 16, key: 'i' }),
                busy ? '扫描中' : '立即扫描',
              ]),
              dashBtn,
            ]),
          ])),
        ])
      }

      
      const s = derive(d)
      const { miss, read, write, out, total, cost, priced, noPrice, saved, reqs, unpricedTok, inTok, avg, avgCost } = s
      const share = s.share
      const hitRate = s.hitRate
      const models = d.models || []
      const maxTok = models.reduce((acc, m) => Math.max(acc, sumOf(m.totals)), 0)
      const parts = d.costParts && typeof d.costParts === 'object' ? d.costParts : null
      const tiers = d.tiers && typeof d.tiers === 'object' ? d.tiers : null
      const tp = tiers && tiers.peak ? (tiers.peak.tokens || 0) : 0
      const tidle = tiers && tiers.idle ? (tiers.idle.tokens || 0) : 0
      const peakShare = (tp + tidle) > 0 ? tp / (tp + tidle) : null
      
      const hours = Array.isArray(d.hours) && d.hours.length === 24 ? d.hours : null
      const hoursPeak = hours && Array.isArray(d.hoursPeak) && d.hoursPeak.length === 24 ? d.hoursPeak : null
      const maxHour = hours ? hours.reduce((s, v) => Math.max(s, v), 0) : 0
      const sched = schedText(d.schedule)

      
      const span = d.firstTs
        ? (DAY(d.firstTs) === DAY(d.lastTs) ? `${CLOCK(d.firstTs)}–${CLOCK(d.lastTs)}` : `${DAY(d.firstTs)} ${CLOCK(d.firstTs)} – ${DAY(d.lastTs)} ${CLOCK(d.lastTs)}`)
        : null

      const metaBits = []
      metaBits.push(h('span', { key: 'r' }, `${fmtNum(reqs)} 次请求`))
      if ((d.activeDays || 0) >= 1) { metaBits.push(h('span', { key: 's1', className: 'sep' }, '·')); metaBits.push(h('span', { key: 'd' }, `活跃 ${d.activeDays} 天`)) }
      if (span) { metaBits.push(h('span', { key: 's2', className: 'sep' }, '·')); metaBits.push(h('span', { key: 'sp' }, span)) }
      if (noPrice) {
        
        
        metaBits.push(h('span', { key: 's3', className: 'sep' }, '·'))
        metaBits.push(h('span', { key: 'np' }, unpricedTok > 0 ? `${TOK(unpricedTok)} tokens 未计价` : '含未计价模型'))
      }

      
      
      
      
      
      const gridLabels = maxHour > 0
        ? [TOK(maxHour), TOK(Math.max(1, Math.round(maxHour / 2))), '0']
        : ['0', '0', '0']
      const hoursBlock = hours ? [
        h('div', { className: 'dtk-hchart', key: 'b' }, [
          
          
          h('div', { className: 'dtk-hyaxis', key: 'y', 'aria-hidden': 'true' }, gridLabels.map((s2, gi) => h('span', { key: gi }, s2))),
          h('div', { className: 'dtk-hmain', key: 'm' }, [
            h('div', { className: 'dtk-hplot', key: 'p', ref: plotRef }, [
              h('div', { className: 'dtk-hgrid', key: 'g', 'aria-hidden': 'true' }, [h('i', { key: 1 }), h('i', { key: 2 }), h('i', { key: 3 })]),
              h('div', { className: 'dtk-hours', key: 'c' }, hours.map((v, i) => {
                const pk = hoursPeak ? Math.min(hoursPeak[i] || 0, v) : 0
                const idleV = v - pk
                const height = maxHour > 0 ? Math.max(2, (v / maxHour) * 100) : 2
                
                
                const segH = (x) => (v > 0 ? (x / v * 100) + '%' : '0%')
                
                
                
                
                const enter = (e) => {
                  hoverRef.current = i
                  setHoverHour(i)
                  placeTip(e && e.clientX)
                }
                const move = (e) => placeTip(e && e.clientX)
                const leave = () => {
                  if (hoverRef.current !== i) return 
                  hoverRef.current = null
                  setHoverHour(null)
                }
                return h('div', {
                  className: 'dtk-hcol', key: i, style: { height: height + '%' },
                  
                  
                  'aria-label': `${pad2(i)}:00–${pad2((i + 1) % 24)}:00 · ${TOK(v)} tokens` + (pk > 0 ? ` · 高峰计费 ${TOK(pk)}` : ''),
                  onPointerEnter: enter, onPointerMove: move, onPointerLeave: leave,
                }, [
                  pk > 0 ? h('i', { className: 'dtk-hpk', key: 'p', style: { height: segH(pk) } }) : null,
                  idleV > 0 ? h('i', { className: 'dtk-hid', key: 'i', style: { height: segH(idleV) } }) : null,
                ])
              })),
              
              
              
              
              (hoverHour !== null && hours[hoverHour] !== undefined) ? (() => {
                const hi = hoverHour
                const hv = hours[hi]
                const hpk = hoursPeak ? Math.min(hoursPeak[hi] || 0, hv) : 0
                return h('div', {
                  className: 'dtk-htip', role: 'tooltip', key: 'tip', ref: tipRef,
                  style: { left: tipLeftPx() + 'px' },
                }, [
                  h('b', { key: 'h' }, `${pad2(hi)}:00–${pad2((hi + 1) % 24)}:00`),
                  h('span', { key: 'v' }, `${TOK(hv)} tokens` + (hpk > 0 ? ` · 高峰计费 ${TOK(hpk)}` : '')),
                  h('span', { key: 'z' }, hpk > 0 ? `高峰 ${TOK(hpk)} · 空闲 ${TOK(hv - hpk)}` : '空闲时段'),
                ])
              })() : null,
            ]),
            h('div', { className: 'dtk-haxis', key: 'x' }, ['00', '06', '12', '18', '23'].map((s2) => h('span', { key: s2 }, s2))),
          ]),
        ]),
        h('div', { className: 'dtk-legend', key: 'lg' }, [
          peakShare === null ? null : h('span', { className: 'dtk-lg', key: 'p' }, [
            h('i', { style: { background: 'var(--d-orange)' } }),
            `高峰 ${PCT(peakShare)} · ${TOK(tp)} · ${MONEY(tiers.peak.cost)}`,
          ]),
          peakShare === null ? null : h('span', { className: 'dtk-lg', key: 'i' }, [
            h('i', { style: { background: 'var(--d-blue)' } }),
            `空闲 ${PCT(1 - peakShare)} · ${TOK(tidle)} · ${MONEY(tiers.idle.cost)}`,
          ]),
          sched ? h('span', { className: 'dtk-lg rule', key: 'r' }, `规则:${sched}`) : null,
        ]),
      ].filter(Boolean) : []

      
      const segs = CATS.map((c) => {
        const v = c.key === 'read' ? read : c.key === 'miss' ? miss : c.key === 'out' ? out : write
        const cst = parts ? parts[c.key === 'read' ? 'read' : c.key === 'miss' ? 'miss' : c.key === 'out' ? 'out' : 'write'] : null
        return { label: c.label, v, color: c.color, cost: cst }
      }).filter((s2) => s2.v > 0).sort((a, b) => b.v - a.v)
      const compCard = h('section', { className: 'dtk-card', key: 'comp' }, [
        h('div', { className: 'dtk-chead', key: 'h' }, [
          h('h2', null, '构成'),
          parts ? h('span', { className: 'r' }, '费用为本地估算') : null,
        ]),
        h('div', { className: 'dtk-segbar', key: 'bar' }, segs.map((s2) => h('i', {
          key: s2.label, title: `${s2.label} ${TOK(s2.v)} tokens`,
          style: { flex: (total > 0 ? s2.v / total * 1000 : 1).toFixed(1), background: s2.color },
        }))),
        h('div', { className: 'dtk-seglegend', key: 'lg' }, segs.map((s2) => h('div', { className: 'dtk-sli', key: s2.label }, [
          h('span', { className: 'dot', style: { background: s2.color } }),
          h('div', { style: { minWidth: 0 } }, [
            h('b', { key: 'v' }, TOK(s2.v)),
            h('span', { key: 's' }, s2.label + ' · ' + PCT(share(s2.v)) + (s2.cost === null || s2.cost === undefined ? '' : ' · ' + MONEY(s2.cost))),
          ]),
        ]))),
        saved > 0 ? h('div', { className: 'dtk-legend', key: 'sv' }, [
          h('span', { className: 'dtk-lg' }, [
            h('i', { style: { background: 'var(--d-green)' } }),
            `缓存命中省下 ${MONEY(saved)}(按未命中价折算)`,
          ]),
        ]) : null,
      ])

      
      const mini = (icon, color, label, value, sub, key) => h('div', { className: 'dtk-mini', key }, [
        h('div', { className: 'mk', key: 'k' }, [
          h('span', { className: 'ic', key: 'i', style: { background: `color-mix(in srgb, ${color} 15%, transparent)`, color } }, h(icon, { size: 11 })),
          label,
        ]),
        h('div', { className: 'mv', key: 'v' }, value),
        h('div', { className: 'ms', key: 's', title: sub }, sub),
      ])
      const flow = h('div', { className: 'dtk-flow', key: 'flow' }, [
        mini(IcSave, 'var(--d-green)', '缓存省下', priced || saved > 0 ? MONEY(saved) : '—',
          `命中 ${TOK(read)} × 价差`, 'm1'),
        mini(IcFlame, 'var(--d-orange)', '缓存命中率', PCT(hitRate), `输入 ${TOK(inTok)}`, 'm2'),
        peakShare === null ? null : mini(IcClock, 'var(--d-purple)', '高峰时段', PCT(peakShare), `${MONEY(tiers.peak.cost)} / ${MONEY(tiers.peak.cost + tiers.idle.cost)}`, 'm3'),
        mini(IcZap, 'var(--d-blue)', '平均每次请求', TOK(avg), priced ? `${MONEY(avgCost)} / 次` : `${reqs} 次`, 'm4'),
      ].filter(Boolean))

      
      const modelCard = models.length ? h('section', { className: 'dtk-card list', key: 'models' }, [
        h('div', { className: 'dtk-chead', key: 'h', style: { padding: '12px 10px 0' } }, [
          h('h2', null, models.length > 1 ? `按模型 · ${models.length}` : '模型'),
          h('span', { className: 'r' }, 'tokens · 费用'),
        ]),
        h('div', { key: 'l', style: { padding: '0 4px 6px' } }, models.map((m, i) => {
          const x = m.totals || {}
          const v = sumOf(x)
          const mc = x.cost || 0
          const color = `var(${CAT_COLORS[i % CAT_COLORS.length]})`
          return h('div', { className: 'dtk-cat', key: m.key }, [
            h('span', { className: 'cdot', style: { background: color } }),
            h('div', { className: 'cmain' }, [
              h('span', { className: 'cname', title: m.key }, m.key),
              h('div', { className: 'cbar' }, h('i', { style: { width: (maxTok > 0 ? (v / maxTok) * 100 : 0) + '%', background: color } })),
            ]),
            h('div', { className: 'cval' }, [
              mc > 0 ? h('b', { key: 'b' }, MONEY(mc)) : h('span', { className: 'dtk-pill warn', key: 'p' }, '未定价'),
              h('span', { key: 's' }, `${TOK(v)} · ${x.requests || 0} 次 · ${PCT(share(v))}`),
            ]),
          ])
        })),
      ]) : null

      
      
      
      const spike = (d.spike && typeof d.spike === 'object') ? d.spike : null
      const anomCount = Number(d.anomalies) || 0
      const anomCard = (d.flagged && anomCount > 0) ? h('section', { className: 'dtk-card', key: 'anom' }, h('div', { className: 'dtk-anom' }, [
        h('span', { className: 'wi', key: 'i' }, h(IcWarn, { size: 19 })),
        h('div', { key: 't' }, [
          h('div', { className: 'at', key: 'a' }, `异常增长 ${anomCount} 处`),
          h('div', { className: 'ad', key: 'b' }, spike
            ? `这些请求的单次用量超过本会话中位数 ${spike.multiple} 倍(且不低于 ${TOK(spike.minTokens)} tokens),常见于一次性灌入大文件或工具回灌。`
            : '这些请求的用量明显高于本会话中位数,常见于一次性灌入大文件或工具回灌。'),
          h('div', { className: 'aa', key: 'c' }, h('a', {
            className: 'dtk-btn ghost', target: '_blank', rel: 'noopener noreferrer',
            href: '/dsh-token?session=' + encodeURIComponent(d.id),
          }, [h(IcUp, { size: 16, key: 'i' }), '查看逐请求明细'])),
        ]),
      ])) : null

      const foot = h('div', { className: 'dtk-foot', key: 'foot' },
        sched
          ? `口径:¥/1M tokens,高峰 ${sched} 按高峰价、其余按空闲价计(费用为本地估算,仅供参考)。数据来自本地会话日志扫描,只读、不上传,与「Token 统计」仪表盘同一份缓存。`
          : '口径:¥/1M tokens,按模型单价分档计算(费用为本地估算,仅供参考)。数据来自本地会话日志扫描,只读、不上传。')

      return shell([
        top(true),
        h('section', { className: 'dtk-card', key: 'hero' }, [
          h('div', { className: 'dtk-hero-top', key: 'top' }, [
            h('div', { className: 'dtk-hero-num', key: 'n' }, [
              h('span', { className: 'num' }, TOK(total)),
              h('span', { className: 'unit' }, 'tokens'),
            ]),
            h('span', { key: 'sp', style: { flex: '1' } }),
            h('div', { className: 'dtk-cost', key: 'c' }, [
              
              
              
              
              h('b', { key: 'b' }, (noPrice ? '≈' : '') + MONEY(cost)),
              noPrice ? h('span', { className: 'dtk-pill warn', key: 'w' },
                unpricedTok > 0 ? `${TOK(unpricedTok)} tokens 未计价` : '含未计价模型') : null,
              saved > 0 ? h('span', { className: 'dtk-pill good', key: 'p' }, `缓存省下 ${MONEY(saved)}`) : null,
            ]),
          ]),
          h('div', { className: 'dtk-hero-meta', key: 'meta' }, metaBits),
        ].concat(hoursBlock)),
        compCard,
        flow,
        modelCard,
        anomCard,
        foot,
      ].filter(Boolean))
    }

    function SettingsPanel() {
      
      
      
      const [info, setInfo] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [nonce, setNonce] = React.useState(0)
      React.useEffect(() => {
        let alive = true
        setErr(null)
        fetch('/dsh-token/api/meta', { cache: 'no-store' })
          .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
          .then((d) => { if (!alive) return; if (d && typeof d === 'object') setInfo(d); else setErr('meta 载荷不是对象') })
          .catch((e) => { if (alive) setErr(String((e && e.message) || e)) })
        return () => { alive = false }
      }, [nonce])
      if (err) return h('div', { className: 'dtk-panel' }, [
        h('div', { className: 'dtk-row', key: 'e' }, [h('b', null, '无法读取'), h('span', { className: 'dtk-mono' }, '/dsh-token/api/meta · ' + err)]),
        h('div', { className: 'dtk-row', key: 'r' }, [
          h('b', null, ''),
          h('button', { type: 'button', className: 'dtk-btn', onClick: () => setNonce((n) => n + 1) }, '重试'),
        ]),
      ])
      if (!info) return h('div', { className: 'dtk-panel' }, h('span', { className: 'dtk-mono' }, '加载中…'))
      const st = info.stats || {}
      const ls = st.lastSummary || {}
      return h('div', { className: 'dtk-panel' }, [
        h('div', { className: 'dtk-row', key: 'r1' }, [h('b', null, '数据源'), h('span', { className: 'dtk-mono' }, info.sessionsRoot || '-')]),
        h('div', { className: 'dtk-row', key: 'r2' }, [h('b', null, '缓存文件'), h('span', { className: 'dtk-mono' }, info.storeFile || '-')]),
        h('div', { className: 'dtk-row', key: 'r3' }, [h('b', null, '会话 / 请求'), h('span', null, `${info.sessionCount} / ${info.requestCount}`)]),
        h('div', { className: 'dtk-row', key: 'r4' }, [h('b', null, '最近扫描'), h('span', null, `变更 ${ls.changed || 0}/${ls.totalSessions || 0} · ${ls.durationMs || 0}ms`)]),
        h('div', { className: 'dtk-row', key: 'r5' }, [h('b', null, '扫描统计'), h('span', null, `全量 ${st.fullScans || 0} · 增量 ${st.incrementalScans || 0} · 失败 ${st.failedSessions || 0}`)]),
        h('div', { className: 'dtk-row', key: 'r6' }, [h('b', null, '模型'), h('span', { className: 'dtk-mono' }, (info.models || []).join(' · '))]),
        h('a', { key: 'r7', className: 'dtk-open', href: '/dsh-token?tab=settings', target: '_blank', rel: 'noopener noreferrer' }, [h(IcUp, { size: 13, key: 'i' }), '打开完整仪表盘']),
      ])
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      const locale = ctx.get('locale')
      
      const NS = 'dsh-token'
      let translate = null
      let localeDispose = null
      if (locale !== undefined && typeof locale.register === 'function') {
        try {
          
          
          localeDispose = locale.register(NS, {
            zh: { tab: 'Token 统计', panel: 'Token 统计', session: '本会话用量' },
            en: { tab: 'Token stats', panel: 'Token stats', session: 'Chat usage' },
          })
          translate = typeof locale.bind === 'function' ? locale.bind(NS) : null
        } catch (e) {  }
      }
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => () => { try { if (localeDispose) localeDispose() } catch (e) {  } })
      }
      
      
      const tabLabel = () => (translate ? translate('tab') : 'Token 统计')
      
      const sessionLabel = () => (translate ? translate('session') : '本会话用量')

      slots.inject('sidebar.panellist', () =>
        slots.register({ name: 'sidebar.panellist', id: 'dsh-token', order: 40, locale: NS, label: tabLabel }, (props) => h(PanelGlyph, props))
      )
      slots.inject('main', () =>
        slots.register({ name: 'main', key: 'dsh-token' }, () => h(DashboardPanel))
      )
      slots.inject('conversation.view', () =>
        slots.register({ name: 'conversation.view', id: 'dsh-token', order: 30, locale: NS, label: sessionLabel }, (props) => h(SessionView, props))
      )
      slots.inject('settings.section', () =>
        slots.register({ name: 'settings.section', id: 'dsh-token', order: 90, locale: NS, label: () => (translate ? translate('panel') : 'Token 统计') }, () => h(SettingsPanel))
      )
    }

    module.exports = {
      name: 'dsh-token',
      inject: ['slots', 'locale'],
      apply,
    }
    return module.exports
  },
})
