/**
 * dsh-token — 正式 Client 半区(浏览器 bundle)
 *
 * 官方协议:包导出子路径 `./client`;本文件注册工厂
 *   window.__ModuleLoader__.load({ id, factory })
 * 工厂 (require) => module.exports,惰性物化;样式用 <style data-plugin> 标签,
 * 由 client-modules 运行时统一回收。
 *
 * 三个入口,定位不同、名字不同、**视觉语言也不同**:
 *   sidebar.footer.action  侧边栏一行 → 外壳的一部分:用 DSH 的 --dsw-alias-* 变量,
 *                          与 DSH 侧边栏浑然一体(不抢戏)。
 *   settings.section       设置页一段 → 同上,跟随宿主。
 *   conversation.view      「本会话用量」= 一整屏视图 → 跟随**产品**:复用
 *                          /dsh-token 仪表盘那一套 iOS 设计语言(液态玻璃卡片、
 *                          44px 大数字、彩色圆点图例、亮点小卡、分类条),
 *                          调色板与语义色跟仪表盘逐一对齐,一眼能看出是同一个插件。
 * 设计规则:**外壳跟随宿主,整屏视图跟随产品** —— 两者不混用,免得"像 DSH 又不像 DSH"。
 *
 * 只依赖平台种子模块 `react`(零第三方依赖,不 require DSH 内部包:
 * DSH 改内部导出时本插件不受影响)。
 * 仪表盘本体是独立单页(/dsh-token),由 Host 路由提供,数据走 /dsh-token/api/*,
 * 与本半区零耦合 —— 重设计页面时无需改动这里。
 */
window.__ModuleLoader__.load({
  // 注册 id 必须与 npm 包名一致:client-modules 运行时按包名匹配工厂,
  // 并按它回收 <style data-plugin> 标签。
  id: '@fufuf-c/dsh-token',
  factory: (require) => {
    // client-modules 运行时按 factory(require) 的返回值取模块导出,不提供
    // module 形参;参照 dsh-context/dsh-free-search 的打包产物,在工厂内
    // 自建 module 壳,末尾 module.exports + return module.exports 才能成立。
    var module = { exports: {} }
    const React = require('react')
    const h = React.createElement

    const style = document.createElement('style')
    style.setAttribute('data-plugin', '@fufuf-c/dsh-token')
    style.textContent = `
/* ======================= 外壳部位(跟随 DSH) ======================= */
.dtk-entry{display:flex;align-items:center;gap:8px;width:100%;height:42px;border:0;border-radius:12px;padding:0 10px;color:var(--dsw-alias-label-primary,#f5f5f7);text-decoration:none;cursor:pointer;font-family:inherit;font-size:14px;box-sizing:border-box;background:transparent}
.dtk-entry:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.dtk-entry:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0a84ff);outline-offset:2px}
.dtk-ico{flex:none;display:inline-flex;align-items:center;justify-content:center;color:inherit}
.dtk-label{flex:1;min-width:0;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dtk-arrow{flex:none;display:inline-flex;align-items:center;justify-content:center;opacity:.6}
.dtk-entry.dtk-rail{justify-content:center;gap:0;width:36px;height:36px;margin:8px 0 10px;padding:0;border-radius:50%}
.dtk-panel{display:flex;flex-direction:column;gap:10px;padding:4px 2px;max-width:640px}
.dtk-row{display:flex;justify-content:space-between;gap:12px;font-size:13px}
.dtk-row b{font-weight:600}
.dtk-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px;word-break:break-all;color:var(--dsw-alias-label-secondary,#8e8e93)}
.dtk-open{display:inline-flex;align-items:center;gap:6px;align-self:flex-start;font-size:13px;color:var(--dsw-alias-link,#4176e6);text-decoration:none}
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
.dtk-top h1{font-size:22px;font-weight:750;letter-spacing:-.022em;margin:0;flex:1;min-width:0}
.dtk-acts{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
/* iOS 胶囊按钮:次级=灰底 chip(与仪表盘 .peak-presets 同语言),主动作=强调色实心 */
.dtk-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 13px;border:0;border-radius:980px;background:var(--d-chip);font-size:12.5px;font-weight:600;color:var(--d-text2);cursor:pointer;font-family:inherit;white-space:nowrap;text-decoration:none;transition:background .18s ease-out,transform .14s ease-out,color .18s ease-out}
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
.dtk-chead h2{font-size:16px;font-weight:700;letter-spacing:-.015em;margin:0}
.dtk-chead .r{margin-left:auto;font-size:11.5px;color:var(--d-text2);font-variant-numeric:tabular-nums}
/* ---- hero:大数字 + 逐小时柱 ---- */
.dtk-hero-top{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
.dtk-hero-num{font-size:42px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums;line-height:1.05}
.dtk-hero-num .unit{font-size:15px;font-weight:600;color:var(--d-text2);letter-spacing:0;margin-left:6px}
.dtk-cost{text-align:right;flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.dtk-cost b{font-size:24px;font-weight:800;letter-spacing:-.022em;font-variant-numeric:tabular-nums;line-height:1.1}
.dtk-hero-meta{font-size:13px;color:var(--d-text2);margin-top:7px;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.dtk-hero-meta .sep{color:var(--d-text3)}
.dtk-hours{display:flex;align-items:flex-end;gap:3px;height:64px;margin-top:16px}
.dtk-hcol{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;border-radius:3px;overflow:hidden;background:var(--d-chip)}
.dtk-hcol i{display:block;width:100%}
.dtk-hid{background:var(--d-blue)}
.dtk-hpk{background:var(--d-orange)}
.dtk-haxis{display:flex;justify-content:space-between;margin-top:6px;font-size:10px;color:var(--d-text3);font-variant-numeric:tabular-nums}
/* ---- 图例胶囊 ---- */
.dtk-legend{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.dtk-lg{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:980px;background:var(--d-chip);color:var(--d-text2);font-size:11px;line-height:1.3;font-variant-numeric:tabular-nums}
.dtk-lg i{width:8px;height:8px;border-radius:50%;flex:none}
.dtk-lg.rule{background:none;padding-left:0;color:var(--d-text3)}
/* ---- 构成:细堆叠条 + 双列图例 ---- */
.dtk-segbar{display:flex;gap:2.5px;height:11px;border-radius:6px;overflow:hidden}
.dtk-segbar i{display:block;min-width:3px;border-radius:1px}
.dtk-seglegend{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;margin-top:14px}
.dtk-sli{display:flex;align-items:flex-start;gap:9px;min-width:0}
.dtk-sli .dot{width:9px;height:9px;border-radius:3px;flex:none;margin-top:5px}
.dtk-sli b{display:block;font-size:15px;font-weight:700;letter-spacing:-.01em;font-variant-numeric:tabular-nums;line-height:1.2}
.dtk-sli span{display:block;font-size:11px;color:var(--d-text2);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* ---- 亮点小卡 ---- */
.dtk-flow{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.dtk-mini{background:var(--d-glass);backdrop-filter:blur(40px) saturate(180%);-webkit-backdrop-filter:blur(40px) saturate(180%);border:1px solid var(--d-glass-border);border-radius:18px;padding:14px 15px;box-shadow:var(--d-shadow),var(--d-specular);min-width:0}
.dtk-mini .mk{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--d-text2);font-weight:600}
.dtk-mini .ic{width:20px;height:20px;border-radius:6.5px;display:inline-flex;align-items:center;justify-content:center;flex:none}
.dtk-mini .ic svg{width:11px;height:11px}
.dtk-mini .mv{font-size:22px;font-weight:750;letter-spacing:-.025em;margin-top:6px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dtk-mini .ms{font-size:11px;color:var(--d-text3);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* ---- 模型行(仪表盘 .catrow 语言) ---- */
.dtk-cat{position:relative;display:flex;align-items:center;gap:11px;padding:11px 10px;border-radius:12px}
.dtk-cat:not(:last-child)::after{content:'';position:absolute;left:32px;right:0;bottom:0;height:1px;background:var(--d-hairline-2)}
.dtk-cat .cdot{width:11px;height:11px;border-radius:4px;flex:none}
.dtk-cat .cmain{flex:1;min-width:0}
.dtk-cat .cname{font-size:12.5px;font-weight:600;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.dtk-cat .cbar{height:4.5px;border-radius:3px;background:var(--d-chip);margin-top:6px;overflow:hidden}
.dtk-cat .cbar i{display:block;height:100%;border-radius:3px;min-width:3px}
.dtk-cat .cval{text-align:right;flex:none}
.dtk-cat .cval b{font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;display:block;line-height:1.35}
.dtk-cat .cval span{font-size:10.5px;color:var(--d-text2);font-variant-numeric:tabular-nums}
.dtk-pill{display:inline-flex;align-items:center;gap:4px;padding:2.5px 9px;border-radius:980px;font-size:10.5px;font-weight:600;background:var(--d-chip);color:var(--d-text2);white-space:nowrap}
.dtk-pill.warn{background:color-mix(in srgb,var(--d-orange) 16%,transparent);color:var(--d-orange)}
.dtk-pill.good{background:color-mix(in srgb,var(--d-green) 15%,transparent);color:var(--d-green)}
/* ---- 异常提示 ---- */
.dtk-anom{display:flex;gap:10px;align-items:flex-start}
.dtk-anom .wi{color:var(--d-orange);flex:none;margin-top:1px}
.dtk-anom .wi svg{width:19px;height:19px}
.dtk-anom .at{font-size:13.5px;font-weight:700}
.dtk-anom .ad{font-size:11.5px;color:var(--d-text2);line-height:1.6;margin-top:3px}
.dtk-anom .aa{margin-top:10px}
/* ---- 空态 / 骨架 / 脚注 ---- */
.dtk-state{padding:32px 16px;text-align:center;color:var(--d-text2);display:flex;flex-direction:column;align-items:center;gap:4px}
.dtk-state .si{color:var(--d-text3);opacity:.45;margin-bottom:8px;display:inline-flex}
.dtk-state .si svg{width:32px;height:32px}
.dtk-state b{font-size:14.5px;font-weight:700;color:var(--d-text)}
.dtk-state span{font-size:11.5px;line-height:1.65;max-width:430px}
.dtk-state .dtk-acts{justify-content:center;margin-top:14px}
.dtk-skel{display:flex;flex-direction:column;gap:12px}
.dtk-skel i{display:block;border-radius:20px;background:var(--d-chip);animation:dtk-pulse 1.5s ease-in-out infinite}
.dtk-skel i:nth-child(1){height:120px}
.dtk-skel i:nth-child(2){height:96px}
.dtk-skel i:nth-child(3){height:140px}
@keyframes dtk-pulse{0%,100%{opacity:1}50%{opacity:.45}}
@keyframes dtk-spin{to{transform:rotate(360deg)}}
.dtk-spin{animation:dtk-spin .9s linear infinite}
.dtk-foot{text-align:center;font-size:11px;color:var(--d-text3);line-height:1.65;padding:0 8px}
`
    document.head.appendChild(style)

    // -----------------------------------------------------------------------
    // 数值格式化
    // -----------------------------------------------------------------------
    const TOK = (n) => {
      n = Number(n) || 0
      if (n >= 1e9) return (n / 1e9).toFixed(2) + ' B'
      if (n >= 1e6) return (n / 1e6).toFixed(2) + ' M'
      if (n >= 1e3) return (n / 1e3).toFixed(1) + ' K'
      return String(Math.round(n))
    }
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

    // -----------------------------------------------------------------------
    // 图标(24 网格描边,与仪表盘同一套画法)
    //
    // 小尺寸可读性是硬要求:形状必须撑满网格(内容跨 2.5–21.5),箭头/缺口要够大 ——
    // 14px 下才不会被看成一个正方形或一个圆圈。按钮里一律 16px。
    // -----------------------------------------------------------------------
    const path = (d, extra) => h('path', Object.assign({ d, key: d }, extra || {}))
    const Ico = (children, sw) => function Icon(props) {
      const p = props || {}
      const s = p.size || 16
      return h('svg', {
        width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: sw || 2, strokeLinecap: 'round', strokeLinejoin: 'round',
        className: p.className, 'aria-hidden': true,
      }, children)
    }
    /** 刷新:300° 圆弧 + 大箭头缺口(不是"一个圆圈") */
    const IcRefresh = Ico([
      path('M20.6 12A8.6 8.6 0 1 1 12 3.4c2.5 0 4.8 1.1 6.3 2.8'),
      path('M20.9 3.4v5.4h-5.4'),
    ])
    /** 复制:两份文档(前一张压在后一张右下),不是"一个正方形" */
    const IcCopy = Ico([
      h('rect', { key: 'r', x: 9.6, y: 9.6, width: 11.9, height: 11.9, rx: 3.1 }),
      path('M5.6 16.4H5a2.5 2.5 0 0 1-2.5-2.5V5A2.5 2.5 0 0 1 5 2.5h8.9A2.5 2.5 0 0 1 16.4 5v.6'),
    ])
    const IcCheck = Ico([path('M4.5 12.6l5 5L19.5 6')])
    /** 外链:纯箭头(带方框的小尺寸下会糊成一团) */
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

    /** 侧边栏入口图标 */
    function Glyph(props) {
      const s = (props && props.size) || 16
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, [
        h('line', { x1: 5, y1: 11, x2: 5, y2: 20, key: 'a' }),
        h('line', { x1: 12, y1: 4, x2: 12, y2: 20, key: 'b' }),
        h('line', { x1: 19, y1: 8, x2: 19, y2: 20, key: 'c' }),
        h('polyline', { points: '3 8 8 4 13 8 21 2', key: 'd' }),
      ])
    }
    function ArrowGlyph() {
      return h('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, [
        h('line', { x1: 7, y1: 17, x2: 17, y2: 7, key: 'a' }),
        h('polyline', { points: '8 7 17 7 17 16', key: 'b' }),
      ])
    }

    /** 复制到剪贴板(与仪表盘的降级链一致:navigator.clipboard → execCommand) */
    function writeClipboard(text) {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          return Promise.resolve(navigator.clipboard.writeText(text)).then(() => true).catch(() => false)
        }
      } catch (e) { /* 剪贴板不可用 → 走下面的降级 */ }
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
    /**
     * 高峰规则的紧凑人话:"工作日 9–12、14–18 点"。
     * 规则是**用户可改的配置**,所以这段文字必须来自服务端下发的 schedule,
     * 不许在客户端写死官方时段。
     */
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

    /** 复制用的纯文本摘要(与面板同一套口径,粘到聊天/issue 里都读得懂) */
    function summaryText(d) {
      const t = d.totals || {}
      const miss = t.miss || 0, read = t.read || 0, write = t.write || 0, out = t.out || 0
      const total = miss + read + write + out
      const reqs = d.requestCount || t.requests || 0
      const lines = [
        `本会话用量 · ${TOK(total)} tokens · ${MONEY(t.cost)}`,
        `${reqs} 次请求 · 缓存命中率 ${PCT((miss + read) > 0 ? read / (miss + read) : 0)} · 缓存省下 ${MONEY(t.saved)}`,
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
        const v = (x.miss || 0) + (x.read || 0) + (x.write || 0) + (x.out || 0)
        lines.push(`${m.key} ${TOK(v)} ${(x.cost || 0) > 0 ? MONEY(x.cost) : '未定价'}`)
      }
      return lines.join('\n')
    }

    // 构成四段的语义色 —— 与仪表盘 CATS 逐一对齐(命中=绿,未命中=红,输出=蓝,写入=灰)
    const CATS = [
      { key: 'read', label: '缓存命中', color: 'var(--d-green)' },
      { key: 'miss', label: '未命中', color: 'var(--d-red)' },
      { key: 'out', label: '输出', color: 'var(--d-blue)' },
      { key: 'write', label: '缓存写入', color: 'var(--d-gray)' },
    ]
    // 模型色序也照搬仪表盘 CAT_COLORS
    const CAT_COLORS = ['--d-blue', '--d-purple', '--d-teal', '--d-orange', '--d-red', '--d-green', '--d-indigo', '--d-gray']

    /** 侧边栏入口 = 全量仪表盘(独立单页,新开标签) */
    function SidebarEntry(props) {
      const p = props || {}
      const wide = !!p.wide
      return h('a', {
        href: '/dsh-token',
        target: '_blank',
        rel: 'noopener noreferrer',
        className: 'dtk-entry' + (wide ? '' : ' dtk-rail'),
        title: 'Token 统计仪表盘 · 全部会话(新开页面)',
        'aria-label': 'Token 统计仪表盘 · 全部会话',
        onClick: (ev) => { ev.stopPropagation() },
      }, [
        h('span', { className: 'dtk-ico', key: 'i' }, h(Glyph, { size: wide ? 16 : 18 })),
        wide ? h('span', { className: 'dtk-label', key: 'l' }, 'Token 统计') : null,
        wide ? h('span', { className: 'dtk-arrow', key: 'a' }, h(ArrowGlyph)) : null,
      ])
    }

    /**
     * 会话内的「本会话用量」面板。
     * 只服务当前对话,走 /api/session?brief=1(不带逐请求数组),原生渲染。
     * 版面刻意与仪表盘「今天」页同构:大数字 + 逐小时柱 + 构成 + 亮点 + 分类明细,
     * 让人一眼认出是同一个插件;但**不做全局导航、不带全局筛选**(那是完整仪表盘的事)。
     */
    function SessionView(props) {
      const sid = props && props.sessionId ? String(props.sessionId) : ''
      const [d, setD] = React.useState(undefined) // undefined=加载中 / null=库中还没有
      const [err, setErr] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [copied, setCopied] = React.useState(0) // 0=未复制 1=成功 2=失败
      const tried = React.useRef(false)

      const load = React.useCallback(() => {
        if (!sid) { setD(null); return Promise.resolve(null) }
        return fetch('/dsh-token/api/session?id=' + encodeURIComponent(sid) + '&brief=1', { cache: 'no-store' })
          .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
          .then((j) => { setD(j || null); setErr(null); return j })
          .catch((e) => { setD(null); setErr(String((e && e.message) || e)); return null })
      }, [sid])

      React.useEffect(() => {
        let alive = true
        setD(undefined); setErr(null); tried.current = false
        load().then((j) => {
          // 库中还没有这条会话(刚建的对话 / 尚未到扫描周期)→ 自动补一次增量扫描
          if (!alive || j || !sid || tried.current) return
          tried.current = true
          setBusy(true)
          fetch('/dsh-token/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' })
            .then(() => load())
            .catch(() => { /* 同源校验拒绝(域名访问)等情况:保持空态,不报错 */ })
            .then(() => { if (alive) setBusy(false) })
        })
        return () => { alive = false }
      }, [sid, load])

      const scan = () => {
        setBusy(true)
        return fetch('/dsh-token/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' })
          .catch(() => {})
          .then(() => load())
          .then(() => setBusy(false))
      }

      const onCopy = () => {
        if (!d) return
        Promise.resolve(writeClipboard(summaryText(d))).then((ok) => {
          setCopied(ok ? 1 : 2)
          setTimeout(() => setCopied(0), 1800)
        })
      }

      const dashBtn = h('a', {
        className: 'dtk-btn primary', href: '/dsh-token', target: '_blank', rel: 'noopener noreferrer',
        title: '全部会话 / 全部时间(新开页面)',
      }, [h(IcUp, { size: 16, key: 'i' }), '完整仪表盘'])

      const refreshBtn = (label) => h('button', {
        type: 'button', className: 'dtk-btn', disabled: busy, onClick: scan,
        title: '增量扫描一次本地日志并刷新',
      }, [
        busy ? h(IcRefresh, { size: 16, className: 'dtk-spin', key: 'i' }) : h(IcRefresh, { size: 16, key: 'i' }),
        busy ? (label || '刷新') + '中' : (label || '刷新'),
      ])

      const top = (withCopy) => h('div', { className: 'dtk-top' }, [
        h('h1', { key: 't' }, '本会话用量'),
        h('div', { className: 'dtk-acts', key: 'a' }, [
          withCopy ? h('button', {
            type: 'button', key: 'c', onClick: onCopy,
            className: 'dtk-btn ghost' + (copied === 1 ? ' ok' : copied === 2 ? ' bad' : ''),
            title: '复制本会话的用量摘要',
          }, [
            copied === 2 ? h(IcWarn, { size: 16, key: 'i' }) : copied === 1 ? h(IcCheck, { size: 16, key: 'i' }) : h(IcCopy, { size: 16, key: 'i' }),
            copied === 1 ? '已复制' : copied === 2 ? '复制失败' : '复制摘要',
          ]) : null,
          refreshBtn(),
          dashBtn,
        ]),
      ])

      if (d === undefined) {
        return h('div', { className: 'dtk-app' }, h('div', { className: 'dtk-inner' }, [
          top(false),
          h('section', { className: 'dtk-card', key: 'k' }, h('div', { className: 'dtk-skel' }, [h('i', { key: 1 }), h('i', { key: 2 }), h('i', { key: 3 })])),
        ]))
      }
      if (!d) {
        return h('div', { className: 'dtk-app' }, h('div', { className: 'dtk-inner' }, [
          top(false),
          h('section', { className: 'dtk-card', key: 'e' }, h('div', { className: 'dtk-state' }, [
            h('span', { className: 'si', key: 'i' }, h(IcGauge, { size: 32 })),
            h('b', { key: 't' }, '本会话还没有用量记录'),
            h('span', { key: 'a' }, 'DSH 会随着对话把日志写入磁盘,插件按周期增量扫描 —— 刚创建的对话可能要等下一次扫描。'),
            h('span', { key: 'b' }, '也可能这条会话的日志格式被宿主拒绝解析(v0 旧格式 / 未知事件),那样它不会出现在统计里。'),
            err ? h('span', { key: 'c', className: 'dtk-mono' }, 'detail: ' + err) : null,
            h('div', { className: 'dtk-acts', key: 'd' }, [
              h('button', { type: 'button', className: 'dtk-btn primary', key: 's', disabled: busy, onClick: scan }, [
                busy ? h(IcRefresh, { size: 16, className: 'dtk-spin', key: 'i' }) : h(IcRefresh, { size: 16, key: 'i' }),
                busy ? '扫描中' : '立即扫描',
              ]),
              dashBtn,
            ]),
          ])),
        ]))
      }

      // ---- 汇总口径(与仪表盘同一套) ----
      const t = d.totals || {}
      const miss = t.miss || 0, read = t.read || 0, write = t.write || 0, out = t.out || 0
      const total = miss + read + write + out
      const cost = t.cost || 0
      const priced = cost > 0
      // "未定价"只在**确实有量却没价**时出现:全零会话不该被扣上一顶帽子。
      // unpriced = 明确未定价的 tokens(host 逐条判定);部分未定价同样要标注 ——
      // 否则"费用偏低"会被读成完整账单。
      const unpricedTok = Number(d.unpriced) > 0 ? Number(d.unpriced) : 0
      const noPrice = total > 0 && (!priced || unpricedTok > 0)
      const saved = t.saved || 0
      const reqs = d.requestCount || t.requests || 0
      const share = (v) => (total > 0 ? v / total : 0)
      const hitRate = (miss + read) > 0 ? read / (miss + read) : 0
      const inTok = miss + read + write
      const avg = reqs > 0 ? total / reqs : 0
      const avgCost = reqs > 0 ? cost / reqs : 0
      const models = d.models || []
      const maxTok = models.reduce((s, m) => {
        const x = m.totals || {}
        return Math.max(s, (x.miss || 0) + (x.read || 0) + (x.write || 0) + (x.out || 0))
      }, 0)
      const parts = d.costParts && typeof d.costParts === 'object' ? d.costParts : null
      const tiers = d.tiers && typeof d.tiers === 'object' ? d.tiers : null
      const tp = tiers && tiers.peak ? (tiers.peak.tokens || 0) : 0
      const tidle = tiers && tiers.idle ? (tiers.idle.tokens || 0) : 0
      const peakShare = (tp + tidle) > 0 ? tp / (tp + tidle) : null
      // 旧 host(0.5.x)不发这些字段 → 对应区块整块隐藏,不留半张空卡
      const hours = Array.isArray(d.hours) && d.hours.length === 24 ? d.hours : null
      const hoursPeak = hours && Array.isArray(d.hoursPeak) && d.hoursPeak.length === 24 ? d.hoursPeak : null
      const maxHour = hours ? hours.reduce((s, v) => Math.max(s, v), 0) : 0
      const sched = schedText(d.schedule)

      // 旧 host 的 /api/session 不带 firstTs/lastTs → 整段时长连同分隔符一起省略
      const span = d.firstTs
        ? (DAY(d.firstTs) === DAY(d.lastTs) ? `${CLOCK(d.firstTs)}–${CLOCK(d.lastTs)}` : `${DAY(d.firstTs)} ${CLOCK(d.firstTs)} – ${DAY(d.lastTs)} ${CLOCK(d.lastTs)}`)
        : null

      const metaBits = []
      metaBits.push(h('span', { key: 'r' }, `${reqs} 次请求`))
      if ((d.activeDays || 0) >= 1) { metaBits.push(h('span', { key: 's1', className: 'sep' }, '·')); metaBits.push(h('span', { key: 'd' }, `活跃 ${d.activeDays} 天`)) }
      if (span) { metaBits.push(h('span', { key: 's2', className: 'sep' }, '·')); metaBits.push(h('span', { key: 'sp' }, span)) }
      if (noPrice) {
        metaBits.push(h('span', { key: 's3', className: 'sep' }, '·'))
        metaBits.push(h('span', { key: 'np' }, unpricedTok > 0 ? `${TOK(unpricedTok)} tokens 未定价,费用偏低` : '含未定价模型,费用偏低'))
      }

      // ---- 逐小时柱(空闲=蓝 / 高峰=橙,与下方分档图例同色) ----
      const hoursBlock = hours ? [
        h('div', { className: 'dtk-hours', key: 'b' }, hours.map((v, i) => {
          const pk = hoursPeak ? Math.min(hoursPeak[i] || 0, v) : 0
          const idleV = v - pk
          const height = maxHour > 0 ? Math.max(2, (v / maxHour) * 100) : 2
          const tip = `${pad2(i)}:00–${pad2((i + 1) % 24)}:00 · ${TOK(v)} tokens` + (pk > 0 ? ` · 高峰计费 ${TOK(pk)}` : '')
          return h('div', { className: 'dtk-hcol', key: i, style: { height: height + '%' }, title: tip }, [
            pk > 0 ? h('i', { className: 'dtk-hpk', key: 'p', style: { height: (pk / v * 100) + '%' } }) : null,
            idleV > 0 ? h('i', { className: 'dtk-hid', key: 'i', style: { height: (idleV / v * 100) + '%' } }) : null,
          ])
        })),
        h('div', { className: 'dtk-haxis', key: 'x' }, ['00', '06', '12', '18', '23'].map((s2) => h('span', { key: s2 }, s2))),
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

      // ---- 构成:细堆叠条 + 双列图例(每段带费用) ----
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

      // ---- 亮点小卡(仪表盘 .mini 语言) ----
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

      // ---- 按模型(仪表盘 .catrow 语言) ----
      const modelCard = models.length ? h('section', { className: 'dtk-card list', key: 'models' }, [
        h('div', { className: 'dtk-chead', key: 'h', style: { padding: '12px 10px 0' } }, [
          h('h2', null, models.length > 1 ? `按模型 · ${models.length}` : '模型'),
          h('span', { className: 'r' }, 'tokens · 费用'),
        ]),
        h('div', { key: 'l', style: { padding: '0 4px 6px' } }, models.map((m, i) => {
          const x = m.totals || {}
          const v = (x.miss || 0) + (x.read || 0) + (x.write || 0) + (x.out || 0)
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

      const anomCard = d.flagged ? h('section', { className: 'dtk-card', key: 'anom' }, h('div', { className: 'dtk-anom' }, [
        h('span', { className: 'wi', key: 'i' }, h(IcWarn, { size: 19 })),
        h('div', { key: 't' }, [
          h('div', { className: 'at', key: 'a' }, `异常增长 ${d.anomalies} 处`),
          h('div', { className: 'ad', key: 'b' }, '这些请求的累计用量比本会话中位数高出 2.5 倍以上,常见于一次性灌入大文件或工具回灌。'),
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

      return h('div', { className: 'dtk-app' }, h('div', { className: 'dtk-inner' }, [
        top(true),
        h('section', { className: 'dtk-card', key: 'hero' }, [
          h('div', { className: 'dtk-hero-top', key: 'top' }, [
            h('div', { className: 'dtk-hero-num', key: 'n' }, [
              h('span', { className: 'num' }, TOK(total)),
              h('span', { className: 'unit' }, 'tokens'),
            ]),
            h('span', { key: 'sp', style: { flex: '1' } }),
            h('div', { className: 'dtk-cost', key: 'c' }, [
              h('b', { key: 'b' }, noPrice ? '未定价' : MONEY(cost)),
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
      ].filter(Boolean)))
    }

    function SettingsPanel() {
      // 正式 bundle 没有 host.call;面板数据从同源 API 读取(与页面一致)。
      const [info, setInfo] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        fetch('/dsh-token/api/meta', { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => { if (alive && d) setInfo(d) })
          .catch(() => {})
        return () => { alive = false }
      }, [])
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
      // locale 命名空间:register / bind / 描述符的 locale 字段必须共用同一个字符串。
      const NS = 'dsh-token'
      let translate = null
      let localeDispose = null
      if (locale !== undefined && typeof locale.register === 'function') {
        try {
          // locale.register(ns, {zh, en}) —— 内置语言为 ["zh","en"],双向字典必须齐全;
          // 声明命名空间后,slots 的 locale 字段才能把 label 接进活动语言。
          localeDispose = locale.register(NS, {
            zh: { tab: 'Token 统计', panel: 'Token 统计', session: '本会话用量' },
            en: { tab: 'Token stats', panel: 'Token stats', session: 'Chat usage' },
          })
          translate = typeof locale.bind === 'function' ? locale.bind(NS) : null
        } catch (e) { /* locale 不可用 → 硬编码回退 */ }
      }
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => () => { try { if (localeDispose) localeDispose() } catch (e) { /* ignore */ } })
      }
      // label 支持 string | (() => string)(slot 运行时的 resolveSlotLabel 对两者都接受);
      // 用函数才能在切换语言后重新取值 —— label 是渲染期解析的。
      const tabLabel = () => (translate ? translate('tab') : 'Token 统计')
      // 会话内的入口只服务当前对话,名字必须与侧边栏的全量仪表盘区分开
      const sessionLabel = () => (translate ? translate('session') : '本会话用量')

      slots.inject('sidebar.footer.action', () =>
        slots.register({ name: 'sidebar.footer.action', id: 'dsh-token', order: 0, locale: NS, label: tabLabel }, (props) => h(SidebarEntry, props))
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
