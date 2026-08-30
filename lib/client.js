/**
 * dsh-token — 正式 Client 半区(浏览器 bundle)
 *
 * 官方协议:包导出子路径 `./client`;本文件注册工厂
 *   window.__ModuleLoader__.load({ id, factory })
 * 工厂 (require) => module.exports,惰性物化;样式用 <style data-plugin> 标签,
 * 由 client-modules 运行时统一回收。
 *
 * 职责:DSH shell 表面(侧边栏入口 / 会话内 Tab / 设置页信息面板)。
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
.dtk-entry{display:flex;align-items:center;gap:8px;width:100%;height:42px;border:0;border-radius:12px;padding:0 10px;color:var(--dsw-alias-label-primary,#f5f5f7);text-decoration:none;cursor:pointer;font-family:inherit;font-size:14px;box-sizing:border-box;background:transparent}
.dtk-entry:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.dtk-entry:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0a84ff);outline-offset:2px}
.dtk-ico{flex:none;display:inline-flex;align-items:center;justify-content:center;color:inherit}
.dtk-label{flex:1;min-width:0;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dtk-arrow{flex:none;display:inline-flex;align-items:center;justify-content:center;opacity:.6}
.dtk-entry.dtk-rail{justify-content:center;gap:0;width:36px;height:36px;margin:8px 0 10px;padding:0;border-radius:50%}
.dtk-frame-wrap{width:100%;height:100%;min-height:0;display:flex;flex-direction:column}
.dtk-frame{flex:1;width:100%;min-height:0;border:0;background:transparent}
.dtk-panel{display:flex;flex-direction:column;gap:10px;padding:4px 2px;max-width:640px}
.dtk-row{display:flex;justify-content:space-between;gap:12px;font-size:13px}
.dtk-row b{font-weight:600}
.dtk-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px;word-break:break-all;color:var(--dsw-alias-label-secondary,#8e8e93)}
.dtk-link{color:var(--dsw-alias-brand-primary,#0a84ff);text-decoration:none;font-size:13px}
`
    document.head.appendChild(style)

    function Glyph(props) {
      const s = props.size || 16
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, [
        h('line', { x1: 5, y1: 11, x2: 5, y2: 20 }),
        h('line', { x1: 12, y1: 4, x2: 12, y2: 20 }),
        h('line', { x1: 19, y1: 8, x2: 19, y2: 20 }),
        h('polyline', { points: '3 8 8 4 13 8 21 2' }),
      ])
    }
    function ArrowGlyph() {
      return h('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, [
        h('line', { x1: 7, y1: 17, x2: 17, y2: 7 }),
        h('polyline', { points: '8 7 17 7 17 16' }),
      ])
    }

    function SidebarEntry(props) {
      const wide = !!(props && props.wide)
      return h('a', {
        href: '/dsh-token',
        target: '_blank',
        rel: 'noopener noreferrer',
        className: 'dtk-entry' + (wide ? '' : ' dtk-rail'),
        title: 'Token 统计仪表盘 · dsh-token',
        'aria-label': 'Token 统计仪表盘',
        onClick: (ev) => { ev.stopPropagation() },
      }, [
        h('span', { className: 'dtk-ico' }, h(Glyph, { size: wide ? 16 : 18 })),
        wide ? h('span', { className: 'dtk-label' }, 'Token 统计') : null,
        wide ? h('span', { className: 'dtk-arrow' }, h(ArrowGlyph)) : null,
      ])
    }

    function TabView(props) {
      const sid = props && props.sessionId
      const src = '/dsh-token' + (sid ? '?session=' + encodeURIComponent(String(sid)) : '')
      return h('div', { className: 'dtk-frame-wrap' },
        h('iframe', { className: 'dtk-frame', src, title: 'dsh-token · Token 统计' })
      )
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
        h('div', { className: 'dtk-row' }, [h('b', null, '数据源'), h('span', { className: 'dtk-mono' }, info.sessionsRoot || '-')]),
        h('div', { className: 'dtk-row' }, [h('b', null, '缓存文件'), h('span', { className: 'dtk-mono' }, info.storeFile || '-')]),
        h('div', { className: 'dtk-row' }, [h('b', null, '会话 / 请求'), h('span', null, `${info.sessionCount} / ${info.requestCount}`)]),
        h('div', { className: 'dtk-row' }, [h('b', null, '最近扫描'), h('span', null, `变更 ${ls.changed || 0}/${ls.totalSessions || 0} · ${ls.durationMs || 0}ms`)]),
        h('div', { className: 'dtk-row' }, [h('b', null, '扫描统计'), h('span', null, `全量 ${st.fullScans || 0} · 增量 ${st.incrementalScans || 0} · 失败 ${st.failedSessions || 0}`)]),
        h('div', { className: 'dtk-row' }, [h('b', null, '模型'), h('span', { className: 'dtk-mono' }, (info.models || []).join(' · '))]),
        h('a', { className: 'dtk-link', href: '/dsh-token?tab=settings', target: '_blank', rel: 'noopener noreferrer' }, '打开完整仪表盘 →'),
      ])
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      const locale = ctx.get('locale')
      let translate = null
      let localeDispose = null
      if (locale !== undefined && typeof locale.register === 'function') {
        try {
          localeDispose = locale.register('dsh-token', { zh: { tab: 'Token 统计' }, en: { tab: 'Token stats' } })
          translate = typeof locale.bind === 'function' ? locale.bind('dsh-token') : null
        } catch (e) { /* locale 不可用 → 硬编码回退 */ }
      }
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => () => { try { if (localeDispose) localeDispose() } catch (e) { /* ignore */ } })
      }
      const tabLabel = () => (translate ? translate('tab') : 'Token 统计')

      slots.inject('sidebar.footer.action', () =>
        slots.register({ name: 'sidebar.footer.action', id: 'dsh-token', order: 0, label: 'Token 统计' }, (props) => h(SidebarEntry, props))
      )
      slots.inject('conversation.view', () =>
        slots.register({ name: 'conversation.view', id: 'dsh-token', order: 30, label: tabLabel }, (props) => h(TabView, props))
      )
      slots.inject('settings.section', () =>
        slots.register({ name: 'settings.section', id: 'dsh-token', order: 90, label: 'dsh-token' }, () => h(SettingsPanel))
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
