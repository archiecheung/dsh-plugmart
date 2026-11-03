/**
 * Plugin Market — browser half.
 *
 * Registers the left-sidebar entry (`sidebar.panellist`, id `plugin-market`)
 * and the central panel (`main`, key `plugin-market`), then renders the market:
 * search, usage ranking, tag filters, paging and a detail overlay.
 *
 * Data comes from the plugin's own host half:
 *   POST /plugin-market/api  { method, args } -> { ok: true, result } | { ok: false, error }
 * Methods: meta | search | detail | refresh (see CONTRACT.md §5).
 *
 * Plain browser artifact: no JSX, no imports beyond the loader-provided
 * `react`, no module-level side effects.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugmart',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React

    const NS = 'marketPanel'
    const API_PATH = '/plugin-market/api'
    const PANEL_ID = 'plugin-market'
    const PAGE_SIZE = 24
    const TAG_LIMIT = 16

    /* ------------------------------------------------------------------ */
    /* i18n                                                                */
    /* ------------------------------------------------------------------ */

    const DICT = {
      zh: {
        panelTitle: '插件市场',
        panelSubtitle: '浏览、搜索并按使用人数发现 DSH 插件',
        marketSearch: '搜索插件名称、作者或标签',
        searchAria: '搜索插件',
        clearSearch: '清除搜索',
        sortUsage: '使用人数',
        sortRecent: '最近更新',
        sortName: '名称',
        sortAria: '排序方式',
        tagAria: '标签筛选',
        allPlugins: '全部插件',
        resultCount: '共 {total} 个插件',
        resultFiltered: '找到 {total} 个匹配插件',
        usageHint: '使用人数按社区星标热度排序',
        refresh: '刷新数据',
        refreshing: '刷新中…',
        refreshOk: '已从市场索引更新数据',
        refreshFailed: '刷新失败：{error}',
        offlineNotice: '当前离线：无法联网更新，继续使用内置快照',
        timeoutNotice: '联网更新超时，继续使用当前数据',
        loadMore: '加载更多',
        loadingMore: '加载中…',
        noResults: '没有匹配的插件',
        noResultsHint: '换个关键词，或清除标签筛选试试。',
        emptyMarket: '市场数据为空',
        emptyMarketHint: '内置快照未能加载，请尝试刷新数据。',
        loadFailed: '市场数据加载失败',
        retry: '重试',
        closeDetail: '关闭详情',
        openHomepage: '打开主页',
        sponsorTitle: '支持作者',
        sponsorNote: '如果这个插件帮你省了时间，可以请作者喝杯咖啡。',
        sponsorOpen: '查看打赏方式',
        sponsorClose: '关闭打赏面板',
        sponsorQr: '扫码打赏',
        sponsorLinks: '在线打赏',
        installCommand: '安装命令',
        copy: '复制',
        copied: '已复制',
        copyAria: '复制安装命令',
        noInstall: '该插件没有提供安装命令，请前往主页查看安装说明。',
        author: '作者',
        stars: '星标',
        updated: '更新',
        tags: '标签',
        sourceBundled: '内置快照',
        sourceLive: '在线索引',
        detailLoading: '加载详情…',
        detailFailed: '详情加载失败',
        justNow: '刚刚',
        minutesAgo: '{n} 分钟前',
        hoursAgo: '{n} 小时前',
        daysAgo: '{n} 天前',
        kindSkill: '技能',
        kindPlugin: '插件',
      },
      en: {
        panelTitle: 'Plugin Market',
        panelSubtitle: 'Browse, search, and discover DSH plugins by usage',
        marketSearch: 'Search plugin name, author, or tag',
        searchAria: 'Search plugins',
        clearSearch: 'Clear search',
        sortUsage: 'Usage',
        sortRecent: 'Recently updated',
        sortName: 'Name',
        sortAria: 'Sort order',
        tagAria: 'Filter by tag',
        allPlugins: 'All plugins',
        resultCount: '{total} plugins',
        resultFiltered: '{total} matching plugins',
        usageHint: 'Usage ranks by community stars',
        refresh: 'Refresh data',
        refreshing: 'Refreshing…',
        refreshOk: 'Market index updated',
        refreshFailed: 'Refresh failed: {error}',
        offlineNotice: 'Offline: cannot reach the market index, using the bundled snapshot',
        timeoutNotice: 'Update timed out, keeping the current data',
        loadMore: 'Load more',
        loadingMore: 'Loading…',
        noResults: 'No matching plugins',
        noResultsHint: 'Try another keyword or clear the tag filter.',
        emptyMarket: 'No market data',
        emptyMarketHint: 'The bundled snapshot did not load. Try refreshing.',
        loadFailed: 'Could not load the market',
        retry: 'Retry',
        closeDetail: 'Close details',
        openHomepage: 'Open homepage',
        sponsorTitle: 'Support the author',
        sponsorNote: 'If this plugin saved you time, you can buy the author a coffee.',
        sponsorOpen: 'Ways to support',
        sponsorClose: 'Close support dialog',
        sponsorQr: 'Scan to tip',
        sponsorLinks: 'Tip online',
        installCommand: 'Install command',
        copy: 'Copy',
        copied: 'Copied',
        copyAria: 'Copy install command',
        noInstall: 'This plugin ships no install command; see its homepage.',
        author: 'Author',
        stars: 'Stars',
        updated: 'Updated',
        tags: 'Tags',
        sourceBundled: 'Bundled snapshot',
        sourceLive: 'Live index',
        detailLoading: 'Loading details…',
        detailFailed: 'Could not load details',
        justNow: 'just now',
        minutesAgo: '{n} min ago',
        hoursAgo: '{n} h ago',
        daysAgo: '{n} d ago',
        kindSkill: 'Skill',
        kindPlugin: 'Plugin',
      },
    }

    /* ------------------------------------------------------------------ */
    /* Styles (theme tokens only)                                          */
    /* ------------------------------------------------------------------ */

    const CSS = `
.pm-root{position:relative;display:flex;flex-direction:column;box-sizing:border-box;width:100%;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
.pm-header{flex:0 0 auto;display:flex;align-items:flex-start;gap:16px;padding:20px 28px 12px;background:var(--dsw-alias-bg-base);border-bottom:1px solid var(--dsw-alias-border-l1)}
/* macOS desktop windows own a 48px drag strip at the top; entry pages must pad below it */
html[data-platform=darwin] .pm-header{padding-top:calc(20px + var(--dsh-frame-top-clearance,0px))}
.pm-heading{flex:1 1 auto;min-width:0}
.pm-title{margin:0;font-size:20px;font-weight:650;letter-spacing:.2px}
.pm-subtitle{margin:2px 0 0;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.pm-header-actions{display:flex;align-items:center;gap:8px;flex:0 0 auto;padding-top:2px}
.pm-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12.5px;font-weight:500;cursor:pointer;transition:background .15s,border-color .15s,color .15s;white-space:nowrap}
.pm-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.pm-btn:disabled{opacity:.6;cursor:default}
.pm-btn[data-primary="true"]{border-color:transparent;background:var(--dsw-alias-brand-primary);color:#fff}
.pm-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .15s,color .15s}
.pm-icon-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.pm-btn:focus-visible,.pm-icon-btn:focus-visible,.pm-chip:focus-visible,.pm-sort-btn:focus-visible,.pm-card:focus-visible,.pm-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.pm-controls{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:10px 12px;padding:12px 28px 12px;background:var(--dsw-alias-bg-base)}
.pm-search{position:relative;display:flex;align-items:center;flex:1 1 280px;min-width:220px;max-width:520px}
.pm-search-icon{position:absolute;left:11px;display:flex;color:var(--dsw-alias-label-secondary);pointer-events:none}
.pm-input{width:100%;height:36px;padding:0 34px 0 34px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit;transition:border-color .15s,box-shadow .15s}
.pm-input::placeholder{color:var(--dsw-alias-label-secondary)}
.pm-input:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px rgba(76,111,255,.16);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);outline:none}
.pm-search-clear{position:absolute;right:6px;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:none;border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.pm-search-clear:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.pm-sort{display:inline-flex;align-items:center;gap:2px;padding:3px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.pm-sort-btn{height:28px;padding:0 11px;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12.5px;font-weight:500;font-family:inherit;cursor:pointer;transition:background .15s,color .15s;white-space:nowrap}
.pm-sort-btn:hover{color:var(--dsw-alias-label-primary)}
.pm-sort-btn[data-active="true"]{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.12)}
.pm-hint{display:flex;align-items:center;gap:6px;margin:0 0 10px;padding:0 2px;font-size:11.5px;line-height:1.45;color:var(--dsw-alias-label-secondary)}
.pm-tags{flex:0 0 auto;display:flex;flex-wrap:nowrap;align-items:center;gap:6px;min-height:46px;padding:8px 28px 16px;overflow-x:auto;scrollbar-width:thin;background:var(--dsw-alias-bg-base)}
.pm-chip{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:13px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;font-family:inherit;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
.pm-chip:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.pm-chip[data-active="true"]{border-color:transparent;background:var(--dsw-alias-brand-primary);color:#fff}
.pm-chip-count{font-size:10.5px;opacity:.72;font-variant-numeric:tabular-nums}
.pm-body{flex:1 1 auto;min-height:0;overflow:auto;padding:4px 28px 36px}
.pm-inner{max-width:1100px;margin:0 auto}
.pm-count{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.pm-source{display:inline-flex;align-items:center;gap:6px}
.pm-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}
.pm-dot[data-source="bundled"]{background:var(--dsw-alias-state-idle-primary)}
.pm-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(320px,100%),1fr));gap:10px;margin:0;padding:0;list-style:none}
.pm-card{display:flex;gap:12px;width:100%;padding:14px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);text-align:left;font-family:inherit;color:inherit;cursor:pointer;transition:border-color .15s,background .15s,transform .15s}
.pm-card:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.pm-card:active{transform:translateY(1px)}
.pm-mono{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:10px;font-size:15px;font-weight:650;letter-spacing:.4px;color:#fff;user-select:none}
.pm-card-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:4px}
.pm-card-top{display:flex;align-items:baseline;gap:8px;min-width:0}
.pm-card-name{font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pm-badge{flex:0 0 auto;padding:1px 6px;border-radius:5px;border:1px solid var(--dsw-alias-border-l1);font-size:10px;color:var(--dsw-alias-label-secondary);font-weight:500}
.pm-card-desc{font-size:12px;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.pm-card-meta{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:2px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.pm-card-meta span{display:inline-flex;align-items:center;gap:3px;white-space:nowrap}
.pm-star{color:var(--dsw-alias-state-warn-primary)}
.pm-card-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.pm-tag{padding:1px 6px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:10.5px;white-space:nowrap}
.pm-skeleton{height:96px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);opacity:.75;animation:pm-pulse 1.4s ease-in-out infinite}
@keyframes pm-pulse{0%,100%{opacity:.45}50%{opacity:.85}}
@media (prefers-reduced-motion:reduce){.pm-skeleton{animation:none}.pm-card{transition:none}}
.pm-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:64px 24px;text-align:center;border-radius:14px;border:1px dashed var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.pm-state-title{font-size:14px;font-weight:600}
.pm-state-hint{max-width:420px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.pm-state-error .pm-state-title{color:var(--dsw-alias-state-error-primary)}
.pm-more{display:flex;justify-content:center;padding:16px 0 4px}
.pm-sponsor{display:flex;align-items:center;gap:12px;margin-top:14px;padding:12px 14px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.pm-sponsor-icon{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}
.pm-sponsor-text{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.pm-sponsor-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.pm-sponsor-note{font-size:12px;line-height:1.45;color:var(--dsw-alias-label-secondary)}
.pm-qr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin:0 0 6px}
.pm-qr{display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.pm-qr img{width:100%;max-width:160px;height:auto;border-radius:6px;background:#fff}
.pm-qr-label{font-size:11.5px;text-align:center;color:var(--dsw-alias-label-secondary)}
.pm-sponsor-links{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px}
.pm-sponsor-sheet{max-width:520px}
.pm-notice{margin:0 0 10px;padding:8px 12px;border-radius:9px;font-size:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}
.pm-notice[data-tone="error"]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.pm-overlay{position:absolute;inset:0;z-index:9;display:flex;justify-content:flex-end;background:rgba(16,20,32,.18);background:color-mix(in srgb,var(--dsw-alias-bg-base) 62%,transparent);backdrop-filter:blur(2px)}
.pm-detail{position:relative;display:flex;flex-direction:column;width:min(520px,94%);height:100%;box-sizing:border-box;border-left:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);box-shadow:-8px 0 28px rgba(0,0,0,.10);animation:pm-slide .18s ease-out}
@keyframes pm-slide{from{transform:translateX(16px);opacity:.4}to{transform:translateX(0);opacity:1}}
@media (prefers-reduced-motion:reduce){.pm-detail{animation:none}}
.pm-detail-head{display:flex;align-items:flex-start;gap:12px;padding:20px 20px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.pm-detail-head .pm-mono{width:46px;height:46px;font-size:17px}
.pm-detail-titles{flex:1 1 auto;min-width:0}
.pm-detail-name{font-size:16px;font-weight:650;word-break:break-word}
.pm-detail-author{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.pm-detail-body{flex:1 1 auto;min-height:0;overflow:auto;padding:16px 20px 24px;display:flex;flex-direction:column;gap:16px}
.pm-detail-desc{font-size:13px;line-height:1.65;white-space:pre-wrap;word-break:break-word}
.pm-detail-stats{display:flex;flex-wrap:wrap;gap:16px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.pm-detail-stats b{display:block;font-size:14px;color:var(--dsw-alias-label-primary);font-weight:600}
.pm-section-label{font-size:11px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.pm-cmd{display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.pm-cmd code{flex:1 1 auto;min-width:0;overflow-x:auto;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;color:var(--dsw-alias-label-primary)}
.pm-taglist{display:flex;flex-wrap:wrap;gap:5px}
.pm-link{display:inline-flex;align-items:center;gap:5px;color:var(--dsw-alias-brand-primary);font-size:12.5px;text-decoration:none}
.pm-link:hover{text-decoration:underline}
`

    /* ------------------------------------------------------------------ */
    /* Host API                                                            */
    /* ------------------------------------------------------------------ */

    async function api(method, args, signal) {
      const response = await fetch(API_PATH, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, args: args || {} }),
        signal,
      })
      if (!response || !response.ok) {
        throw new Error(`HTTP ${response ? response.status : 'error'}`)
      }
      const payload = await response.json()
      if (!payload || payload.ok !== true) {
        throw new Error((payload && payload.error) || 'request failed')
      }
      return payload.result
    }

    /* ------------------------------------------------------------------ */
    /* Formatting helpers                                                  */
    /* ------------------------------------------------------------------ */

    function formatCount(value) {
      const num = Number(value) || 0
      if (num >= 1e6) return `${(num / 1e6).toFixed(num >= 1e7 ? 0 : 1)}M`
      if (num >= 1000) return `${(num / 1000).toFixed(num >= 10000 ? 0 : 1)}k`
      return String(num)
    }

    function formatRelative(iso, localeId, t, now) {
      const ts = Date.parse(String(iso || ''))
      if (!Number.isFinite(ts)) return ''
      const diff = Math.max(0, (now || Date.now()) - ts)
      const minute = 60 * 1000
      const hour = 60 * minute
      const day = 24 * hour
      if (diff < minute) return t('justNow')
      if (diff < hour) return t('minutesAgo', { n: Math.floor(diff / minute) })
      if (diff < day) return t('hoursAgo', { n: Math.floor(diff / hour) })
      if (diff < 30 * day) return t('daysAgo', { n: Math.floor(diff / day) })
      try {
        return new Date(ts).toLocaleDateString(localeId === 'zh' ? 'zh-CN' : 'en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      } catch {
        return new Date(ts).toISOString().slice(0, 10)
      }
    }

    function pickDescription(item, localeId) {
      if (!item) return ''
      return (localeId === 'zh' ? item.descriptionZh || item.descriptionEn : item.descriptionEn || item.descriptionZh) || ''
    }

    function initialsOf(name) {
      const text = String(name || '').replace(/^@/u, '').replace(/^(dsh|plugin)[-_]/iu, '')
      if (!text) return '?'
      const chars = Array.from(text)
      const first = chars[0] || '?'
      if (/[a-z0-9]/iu.test(first)) {
        const word = text.split(/[-_.\s]+/u)[0] || text
        return word.slice(0, 1).toUpperCase()
      }
      return first
    }

    function hueOf(name) {
      let hash = 0
      const text = String(name || '')
      for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 360
      return hash
    }

    function isSkill(item) {
      return !!(item && item.type === 'skill')
    }

    /* ------------------------------------------------------------------ */
    /* Icons (original artwork, currentColor)                              */
    /* ------------------------------------------------------------------ */

    function MarketRailIcon(props) {
      const size = (props && props.size) || 20
      return h(
        'svg',
        {
          viewBox: '0 0 32 32',
          width: size,
          height: size,
          'aria-hidden': true,
          focusable: 'false',
          style: { display: 'block' },
        },
        h('path', {
          d: 'M5 12.2 7.6 6h16.8L27 12.2c0 1.9-1.5 3.4-3.4 3.4-1.4 0-2.6-.8-3.1-2-.6 1.2-1.8 2-3.2 2s-2.6-.8-3.2-2c-.6 1.2-1.8 2-3.2 2-1.9 0-3.4-1.5-3.4-3.4Z',
          fill: 'currentColor',
          opacity: '0.92',
        }),
        h('path', {
          d: 'M6.5 17.6h19V25c0 .9-.7 1.6-1.6 1.6H8.1c-.9 0-1.6-.7-1.6-1.6v-7.4Z',
          fill: 'currentColor',
        }),
        h('rect', { x: '13.8', y: '19.4', width: '4.4', height: '7.2', rx: '1', style: { fill: 'var(--dsw-specific-sidebar-fill, #EDEDF0)' } }),
        h('circle', { cx: '23.2', cy: '24.4', r: '2.6', fill: 'currentColor', opacity: '0.55' }),
      )
    }

    function IconSearch(props) {
      const size = (props && props.size) || 15
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, focusable: 'false' },
        h('circle', { cx: '7', cy: '7', r: '4.6', fill: 'none', stroke: 'currentColor', strokeWidth: '1.5' }),
        h('path', { d: 'M10.4 10.4 14 14', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' }),
      )
    }

    function IconClose(props) {
      const size = (props && props.size) || 14
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, focusable: 'false' },
        h('path', {
          d: 'M4 4l8 8M12 4l-8 8',
          stroke: 'currentColor',
          strokeWidth: '1.6',
          strokeLinecap: 'round',
          fill: 'none',
        }),
      )
    }

    function IconRefresh(props) {
      const size = (props && props.size) || 14
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, focusable: 'false' },
        h('path', {
          d: 'M13 8a5 5 0 1 1-1.6-3.7M13 2.4V6h-3.6',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '1.6',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function IconStar(props) {
      const size = (props && props.size) || 11
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, focusable: 'false' },
        h('path', {
          d: 'M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z',
          fill: 'currentColor',
        }),
      )
    }

    function IconCopy(props) {
      const size = (props && props.size) || 13
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, focusable: 'false' },
        h('rect', { x: '5.5', y: '5.5', width: '8', height: '8', rx: '1.6', fill: 'none', stroke: 'currentColor', strokeWidth: '1.4' }),
        h('path', { d: 'M10.5 5.5v-1A1.5 1.5 0 0 0 9 3H4a1 1 0 0 0-1 1v5a1.5 1.5 0 0 0 1.5 1.5h1', fill: 'none', stroke: 'currentColor', strokeWidth: '1.4' }),
      )
    }

    function IconExternal(props) {
      const size = (props && props.size) || 12
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, focusable: 'false' },
        h('path', {
          d: 'M9 3h4v4M13 3 7.5 8.5M11.5 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1h2.5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '1.5',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /* ------------------------------------------------------------------ */
    /* Hooks                                                               */
    /* ------------------------------------------------------------------ */

    function IconHeart(props) {
      const size = (props && props.size) || 16
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M12 20.3 4.6 13a4.9 4.9 0 0 1 0-6.9 4.8 4.8 0 0 1 6.8 0l.6.6.6-.6a4.8 4.8 0 0 1 6.8 0 4.9 4.9 0 0 1 0 6.9L12 20.3Z',
          stroke: 'currentColor',
          strokeWidth: '1.6',
          strokeLinejoin: 'round',
        }),
      )
    }

    /** Bilingual host value: a plain string, or `{ zh, en }`. */
    function pickLocalized(value, localeId) {
      if (!value) return ''
      if (typeof value === 'string') return value
      if (typeof value !== 'object') return ''
      return value[localeId] || value.zh || value.en || ''
    }

    function useLocale(ctx) {
      const locale = ctx && typeof ctx.get === 'function' ? ctx.get('locale') : undefined
      const subscribe = useCallback(
        (onChange) => {
          if (locale && typeof locale.subscribe === 'function') return locale.subscribe(onChange)
          return () => {}
        },
        [locale],
      )
      const getSnapshot = useCallback(() => {
        if (!locale) return 'zh'
        try {
          const snapshot =
            (typeof locale.getLocale === 'function' && locale.getLocale()) ||
            (typeof locale.getSnapshot === 'function' && locale.getSnapshot()) ||
            {}
          return String(snapshot.active || snapshot.id || snapshot.locale || 'zh')
        } catch {
          return 'zh'
        }
      }, [locale])
      const localeId = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
      const t = useMemo(() => {
        if (locale && typeof locale.bind === 'function') return locale.bind(NS)
        return (key) => key
      }, [locale, localeId])
      return { localeId, t }
    }

    function useDebounced(value, delay) {
      const [debounced, setDebounced] = useState(value)
      useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delay)
        return () => clearTimeout(timer)
      }, [value, delay])
      const flush = useCallback(() => setDebounced(value), [value])
      return [debounced, flush]
    }

    /* ------------------------------------------------------------------ */
    /* Sub-components                                                      */
    /* ------------------------------------------------------------------ */

    function Mono(props) {
      const item = props.item
      const hue = hueOf(item.name || item.id)
      const style = {
        background: `linear-gradient(135deg, hsl(${hue} 64% 54%), hsl(${(hue + 38) % 360} 66% 44%))`,
      }
      return h('div', { className: 'pm-mono', style, 'aria-hidden': true }, initialsOf(item.name || item.id))
    }

    function PluginCard(props) {
      const { item, t, localeId, now, onOpen } = props
      const description = pickDescription(item, localeId)
      const updated = formatRelative(item.updatedAt, localeId, t, now)
      return h(
        'button',
        {
          type: 'button',
          className: 'pm-card',
          onClick: () => onOpen(item),
          'aria-label': `${item.name} — ${description || t(isSkill(item) ? 'kindSkill' : 'kindPlugin')}`,
        },
        h(Mono, { item }),
        h(
          'div',
          { className: 'pm-card-main' },
          h('div', { className: 'pm-card-top' }, h('span', { className: 'pm-card-name' }, item.name || item.id), isSkill(item) ? h('span', { className: 'pm-badge' }, t('kindSkill')) : null),
          description ? h('div', { className: 'pm-card-desc' }, description) : null,
          h(
            'div',
            { className: 'pm-card-meta' },
            item.stars > 0 ? h('span', { className: 'pm-star' }, h(IconStar, {}), formatCount(item.stars)) : null,
            item.author ? h('span', null, item.author) : null,
            updated ? h('span', null, updated) : null,
          ),
          item.tags && item.tags.length
            ? h(
                'div',
                { className: 'pm-card-tags' },
                item.tags.slice(0, 3).map((tag) => h('span', { className: 'pm-tag', key: tag }, tag)),
              )
            : null,
        ),
      )
    }

    function SkeletonList() {
      return h(
        'ul',
        { className: 'pm-list', 'aria-hidden': true },
        [0, 1, 2].map((key) => h('li', { key }, h('div', { className: 'pm-skeleton' }))),
      )
    }

    function StateBox(props) {
      return h(
        'div',
        { className: `pm-state${props.tone === 'error' ? ' pm-state-error' : ''}` },
        h('div', { className: 'pm-state-title' }, props.title),
        props.hint ? h('div', { className: 'pm-state-hint' }, props.hint) : null,
        props.action ? props.action : null,
      )
    }

    function TagRow(props) {
      const { tags, active, onSelect, t } = props
      const list = (tags || []).slice(0, TAG_LIMIT)
      if (!list.length) return null
      return h(
        'div',
        { className: 'pm-tags', role: 'group', 'aria-label': t('tagAria') },
        h(
          'button',
          {
            type: 'button',
            className: 'pm-chip',
            'data-active': active ? 'false' : 'true',
            onClick: () => onSelect(null),
          },
          t('allPlugins'),
        ),
        list.map((tag) =>
          h(
            'button',
            {
              key: tag.id,
              type: 'button',
              className: 'pm-chip',
              'data-active': active === tag.id ? 'true' : 'false',
              onClick: () => onSelect(active === tag.id ? null : tag.id),
            },
            tag.title || tag.id,
            h('span', { className: 'pm-chip-count' }, formatCount(tag.count)),
          ),
        ),
      )
    }

    function DetailOverlay(props) {
      const { item, detail, loading, error, t, localeId, now, onClose, onRetry } = props
      const shown = detail || item
      const description = pickDescription(shown, localeId)
      const [copied, setCopied] = useState(false)
      const copyTimer = useRef(null)

      useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

      const copy = useCallback(async () => {
        const command = (shown && shown.install) || ''
        if (!command) return
        try {
          if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(command)
          } else {
            const area = document.createElement('textarea')
            area.value = command
            document.body.appendChild(area)
            area.select()
            document.execCommand('copy')
            document.body.removeChild(area)
          }
          setCopied(true)
          if (copyTimer.current) clearTimeout(copyTimer.current)
          copyTimer.current = setTimeout(() => setCopied(false), 1800)
        } catch {
          setCopied(false)
        }
      }, [shown])

      return h(
        'div',
        {
          className: 'pm-overlay',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': shown ? shown.name : t('panelTitle'),
        },
        h(
          'div',
          { className: 'pm-detail' },
          h(
            'div',
            { className: 'pm-detail-head' },
            shown ? h(Mono, { item: shown }) : null,
            h(
              'div',
              { className: 'pm-detail-titles' },
              h('div', { className: 'pm-detail-name' }, shown ? shown.name || shown.id : ''),
              shown && shown.author ? h('div', { className: 'pm-detail-author' }, shown.author) : null,
            ),
            h(
              'button',
              { type: 'button', className: 'pm-icon-btn', onClick: onClose, 'aria-label': t('closeDetail'), title: t('closeDetail') },
              h(IconClose, {}),
            ),
          ),
          h(
            'div',
            { className: 'pm-detail-body' },
            loading ? h('div', { className: 'pm-state-hint' }, t('detailLoading')) : null,
            error
              ? h(StateBox, {
                  tone: 'error',
                  title: t('detailFailed'),
                  hint: String(error),
                  action: h('button', { type: 'button', className: 'pm-btn', onClick: onRetry }, t('retry')),
                })
              : null,
            !loading && !error && shown
              ? [
                  h(
                    'div',
                    { className: 'pm-detail-stats', key: 'stats' },
                    shown.stars > 0
                      ? h('div', null, h('b', null, formatCount(shown.stars)), t('stars'))
                      : null,
                    shown.updatedAt ? h('div', null, h('b', null, formatRelative(shown.updatedAt, localeId, t, now) || '—'), t('updated')) : null,
                    shown.author ? h('div', null, h('b', null, shown.author), t('author')) : null,
                  ),
                  description
                    ? h('div', { className: 'pm-detail-desc', key: 'desc' }, description)
                    : null,
                  shown.tags && shown.tags.length
                    ? h(
                        'div',
                        { key: 'tags' },
                        h('div', { className: 'pm-section-label' }, t('tags')),
                        h(
                          'div',
                          { className: 'pm-taglist' },
                          shown.tags.map((tag) => h('span', { className: 'pm-tag', key: tag }, tag)),
                        ),
                      )
                    : null,
                  h(
                    'div',
                    { key: 'install' },
                    h('div', { className: 'pm-section-label' }, t('installCommand')),
                    shown.install
                      ? h(
                          'div',
                          { className: 'pm-cmd' },
                          h('code', null, shown.install),
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'pm-btn',
                              onClick: copy,
                              'aria-label': t('copyAria'),
                              title: t('copy'),
                            },
                            h(IconCopy, {}),
                            copied ? t('copied') : t('copy'),
                          ),
                        )
                      : h('div', { className: 'pm-state-hint' }, t('noInstall')),
                  ),
                  shown.homepage
                    ? h(
                        'a',
                        { key: 'home', className: 'pm-link', href: shown.homepage, target: '_blank', rel: 'noreferrer' },
                        t('openHomepage'),
                        h(IconExternal, {}),
                      )
                    : null,
                ]
              : [],
          ),
        ),
      )
    }

    function SponsorOverlay(props) {
      const { sponsor, t, localeId, onClose } = props
      const title = pickLocalized(sponsor.title, localeId) || t('sponsorTitle')
      const note = pickLocalized(sponsor.note, localeId) || t('sponsorNote')
      const links = Array.isArray(sponsor.links) ? sponsor.links : []
      const qrcodes = Array.isArray(sponsor.qrcodes) ? sponsor.qrcodes : []
      return h(
        'div',
        {
          className: 'pm-overlay',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': title,
          onMouseDown: (event) => {
            if (event && event.target === event.currentTarget) onClose()
          },
        },
        h(
          'div',
          { className: 'pm-detail pm-sponsor-sheet' },
          h(
            'div',
            { className: 'pm-detail-head' },
            h(
              'div',
              { className: 'pm-detail-titles' },
              h('div', { className: 'pm-detail-name' }, title),
              note ? h('div', { className: 'pm-detail-author' }, note) : null,
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'pm-icon-btn',
                onClick: onClose,
                'aria-label': t('sponsorClose'),
                title: t('sponsorClose'),
              },
              h(IconClose, {}),
            ),
          ),
          h(
            'div',
            { className: 'pm-detail-body' },
            qrcodes.length
              ? [
                  h('div', { className: 'pm-section-label', key: 'qr-label' }, t('sponsorQr')),
                  h(
                    'div',
                    { className: 'pm-qr-grid', key: 'qr-grid' },
                    qrcodes.map((qr, index) => {
                      const label = pickLocalized(qr.label, localeId)
                      return h(
                        'div',
                        { className: 'pm-qr', key: `qr-${index}` },
                        h('img', { src: qr.src, alt: label || t('sponsorQr'), loading: 'lazy' }),
                        label ? h('span', { className: 'pm-qr-label' }, label) : null,
                      )
                    }),
                  ),
                ]
              : null,
            links.length
              ? [
                  h('div', { className: 'pm-section-label', key: 'link-label' }, t('sponsorLinks')),
                  h(
                    'div',
                    { className: 'pm-sponsor-links', key: 'link-row' },
                    links.map((link, index) =>
                      h(
                        'a',
                        {
                          className: 'pm-link',
                          key: `link-${index}`,
                          href: link.url,
                          target: '_blank',
                          rel: 'noreferrer',
                        },
                        pickLocalized(link.label, localeId) || link.url,
                        h(IconExternal, {}),
                      ),
                    ),
                  ),
                ]
              : null,
          ),
        ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* Panel                                                               */
    /* ------------------------------------------------------------------ */

    function MarketPanel(props) {
      const ctx = props && props.ctx
      const { localeId, t } = useLocale(ctx)

      const [meta, setMeta] = useState(null)
      const [query, setQuery] = useState('')
      const [debouncedQuery, flushQuery] = useDebounced(query, 250)
      const [sort, setSort] = useState('usage')
      const [tag, setTag] = useState(null)
      const [items, setItems] = useState([])
      const [total, setTotal] = useState(0)
      const [hasMore, setHasMore] = useState(false)
      const [loading, setLoading] = useState(true)
      const [loadingMore, setLoadingMore] = useState(false)
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(null)
      const [refreshing, setRefreshing] = useState(false)
      const [detailName, setDetailName] = useState(null)
      const [detail, setDetail] = useState(null)
      const [detailLoading, setDetailLoading] = useState(false)
      const [detailError, setDetailError] = useState(null)
      const [now, setNow] = useState(() => Date.now())
      const [sponsorOpen, setSponsorOpen] = useState(false)

      const requestSeq = useRef(0)
      const abortRef = useRef(null)
      const mountedRef = useRef(true)
      const detailSeq = useRef(0)

      useEffect(() => {
        mountedRef.current = true
        return () => {
          mountedRef.current = false
          if (abortRef.current) {
            try { abortRef.current.abort() } catch { /* ignore */ }
            abortRef.current = null
          }
        }
      }, [])

      // Keep relative timestamps fresh without re-rendering on every tick.
      useEffect(() => {
        const timer = setInterval(() => {
          if (mountedRef.current) setNow(Date.now())
        }, 60 * 1000)
        return () => clearInterval(timer)
      }, [])

      const loadMeta = useCallback(async () => {
        try {
          const result = await api('meta', {})
          if (!mountedRef.current) return
          setMeta(result)
        } catch (err) {
          if (!mountedRef.current) return
          setMeta((current) => current || { total: 0, tags: [], sorts: ['usage', 'recent', 'name'], source: 'bundled' })
          setError(err && err.message ? err.message : String(err))
        }
      }, [])

      const loadPage = useCallback(
        async (offset, append) => {
          const seq = ++requestSeq.current
          if (abortRef.current) {
            try { abortRef.current.abort() } catch { /* ignore */ }
          }
          const controller = typeof AbortController === 'function' ? new AbortController() : null
          abortRef.current = controller
          if (append) setLoadingMore(true)
          else {
            setLoading(true)
            setError(null)
          }
          try {
            const result = await api(
              'search',
              {
                text: debouncedQuery,
                sort,
                tag,
                offset,
                limit: PAGE_SIZE,
              },
              controller ? controller.signal : undefined,
            )
            if (!mountedRef.current || seq !== requestSeq.current) return
            const page = result && Array.isArray(result.items) ? result.items : []
            setItems((current) => (append ? current.concat(page) : page))
            setTotal(result && Number.isFinite(result.total) ? result.total : page.length)
            setHasMore(Boolean(result && result.hasMore))
            setError(null)
          } catch (err) {
            if (!mountedRef.current || seq !== requestSeq.current) return
            if (err && (err.name === 'AbortError' || /abort/iu.test(String(err.message)))) return
            setError(err && err.message ? err.message : String(err))
            if (!append) setItems([])
          } finally {
            if (mountedRef.current && seq === requestSeq.current) {
              setLoading(false)
              setLoadingMore(false)
            }
          }
        },
        [debouncedQuery, sort, tag],
      )

      const loadMetaRef = useRef(loadMeta)
      const loadPageRef = useRef(loadPage)
      loadMetaRef.current = loadMeta
      loadPageRef.current = loadPage

      // Initial load.
      useEffect(() => {
        loadMetaRef.current()
      }, [])

      // Every filter change starts from the first page.
      useEffect(() => {
        loadPageRef.current(0, false)
      }, [debouncedQuery, sort, tag])

      const onRefresh = useCallback(async () => {
        if (refreshing) return
        setRefreshing(true)
        setNotice(null)
        try {
          const result = await api('refresh', {})
          if (!mountedRef.current) return
          if (result && result.ok) {
            setNotice({ tone: 'ok', text: t('refreshOk') })
            await loadMeta()
            await loadPage(0, false)
          } else {
            const code = (result && result.code) || ''
            const detail = (result && result.error) || 'unknown'
            if (code === 'NETWORK' || /network unreachable/iu.test(String(detail))) {
              setNotice({ tone: 'info', text: t('offlineNotice') })
            } else if (code === 'TIMEOUT') {
              setNotice({ tone: 'info', text: t('timeoutNotice') })
            } else {
              setNotice({ tone: 'error', text: t('refreshFailed', { error: detail }) })
            }
          }
        } catch (err) {
          if (!mountedRef.current) return
          const message = (err && err.message) || String(err)
          if (/network|fetch failed|offline/iu.test(message)) setNotice({ tone: 'info', text: t('offlineNotice') })
          else setNotice({ tone: 'error', text: t('refreshFailed', { error: message }) })
        } finally {
          if (mountedRef.current) setRefreshing(false)
        }
      }, [refreshing, t, loadMeta, loadPage])

      // Auto-dismiss the refresh notice.
      useEffect(() => {
        if (!notice) return undefined
        const timer = setTimeout(() => {
          if (mountedRef.current) setNotice(null)
        }, notice.tone === 'info' ? 6500 : 5000)
        return () => clearTimeout(timer)
      }, [notice])

      const openDetail = useCallback(async (item) => {
        if (!item) return
        setDetailName(item.name || item.id)
        setDetail(item)
        setDetailError(null)
        setDetailLoading(true)
        const seq = ++detailSeq.current
        try {
          const found = await api('detail', { name: item.name || item.id })
          if (!mountedRef.current || seq !== detailSeq.current) return
          if (found) setDetail(found)
        } catch (err) {
          if (!mountedRef.current || seq !== detailSeq.current) return
          setDetailError(err && err.message ? err.message : String(err))
        } finally {
          if (mountedRef.current && seq === detailSeq.current) setDetailLoading(false)
        }
      }, [])

      const closeDetail = useCallback(() => {
        detailSeq.current += 1
        setDetailName(null)
        setDetail(null)
        setDetailError(null)
        setDetailLoading(false)
      }, [])

      // Escape closes the topmost overlay (sponsor sheet first, then detail).
      useEffect(() => {
        if (!detailName && !sponsorOpen) return undefined
        if (sponsorOpen && !detailName) {
          const onKeyDown = (event) => {
            if (event && (event.key === 'Escape' || event.key === 'Esc')) {
              event.preventDefault()
              event.stopPropagation()
              setSponsorOpen(false)
            }
          }
          window.addEventListener('keydown', onKeyDown)
          return () => window.removeEventListener('keydown', onKeyDown)
        }
        if (!detailName) return undefined
        const onKeyDown = (event) => {
          if (event && (event.key === 'Escape' || event.key === 'Esc')) {
            event.preventDefault()
            event.stopPropagation()
            closeDetail()
          }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [detailName, closeDetail])

      const onSearchChange = useCallback((event) => {
        setQuery(event && event.target ? event.target.value : '')
      }, [])

      const retryDetail = useCallback(() => {
        if (detail) openDetail(detail)
      }, [detail, openDetail])

      const tags = (meta && Array.isArray(meta.tags) ? meta.tags : []).filter((tagEntry) => tagEntry && (tagEntry.count || 0) > 0)
      const source = (meta && meta.source) || 'bundled'
      const sponsor = (meta && meta.sponsor) || null
      const hasFilters = Boolean(debouncedQuery.trim()) || Boolean(tag)
      const countLabel = hasFilters ? t('resultFiltered', { total }) : t('resultCount', { total })

      return h(
        'div',
        { className: 'pm-root' },
        h('style', null, CSS),
        h(
          'header',
          { className: 'pm-header', 'data-window-drag': 'true' },
          h(
            'div',
            { className: 'pm-heading' },
            h('h1', { className: 'pm-title' }, t('panelTitle')),
            h('p', { className: 'pm-subtitle' }, t('panelSubtitle')),
          ),
          h(
            'div',
            { className: 'pm-header-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'pm-btn',
                onClick: onRefresh,
                disabled: refreshing,
                'aria-label': refreshing ? t('refreshing') : t('refresh'),
                title: t('refresh'),
                'data-window-drag-recall': 'true',
              },
              h(IconRefresh, {}),
              refreshing ? t('refreshing') : t('refresh'),
            ),
          ),
        ),
        h(
          'div',
          { className: 'pm-controls' },
          h(
            'div',
            { className: 'pm-search' },
            h('span', { className: 'pm-search-icon' }, h(IconSearch, {})),
            h('input', {
              className: 'pm-input',
              type: 'search',
              value: query,
              onChange: onSearchChange,
              onKeyDown: (event) => {
                if (event && event.key === 'Enter') {
                  event.preventDefault()
                  flushQuery()
                }
              },
              placeholder: t('marketSearch'),
              'aria-label': t('searchAria'),
              spellCheck: false,
              autoComplete: 'off',
            }),
            query
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'pm-search-clear',
                    onClick: () => setQuery(''),
                    'aria-label': t('clearSearch'),
                    title: t('clearSearch'),
                  },
                  h(IconClose, { size: 12 }),
                )
              : null,
          ),
          h(
            'div',
            { className: 'pm-sort', role: 'group', 'aria-label': t('sortAria') },
            [
              ['usage', 'sortUsage'],
              ['recent', 'sortRecent'],
              ['name', 'sortName'],
            ].map(([key, label]) =>
              h(
                'button',
                {
                  key,
                  type: 'button',
                  className: 'pm-sort-btn',
                  'data-active': sort === key ? 'true' : 'false',
                  'aria-pressed': sort === key ? 'true' : 'false',
                  onClick: () => setSort(key),
                },
                t(label),
              ),
            ),
          ),
        ),
        h(TagRow, { tags, active: tag, onSelect: setTag, t }),
        h(
          'div',
          { className: 'pm-body' },
          h(
            'div',
            { className: 'pm-inner' },
            notice
              ? h('div', { className: 'pm-notice', 'data-tone': notice.tone || 'ok', role: 'status' }, notice.text)
              : null,
            h('p', { className: 'pm-hint' }, t('usageHint')),
            h(
              'div',
              { className: 'pm-count' },
              h('span', null, countLabel),
              h(
                'span',
                { className: 'pm-source' },
                h('span', { className: 'pm-dot', 'data-source': source === 'live' ? 'live' : 'bundled' }),
                meta ? t(source === 'live' ? 'sourceLive' : 'sourceBundled') : '',
                meta && meta.generatedAt ? h('span', null, ` · ${String(meta.generatedAt).slice(0, 10)}`) : null,
              ),
            ),
            loading && items.length === 0 ? h(SkeletonList, {}) : null,
            !loading && error && items.length === 0
              ? h(StateBox, {
                  tone: 'error',
                  title: t('loadFailed'),
                  hint: String(error),
                  action: h('button', { type: 'button', className: 'pm-btn', onClick: () => loadPage(0, false) }, t('retry')),
                })
              : null,
            !loading && !error && items.length === 0
              ? h(StateBox, {
                  title: hasFilters ? t('noResults') : t('emptyMarket'),
                  hint: hasFilters ? t('noResultsHint') : t('emptyMarketHint'),
                  action: hasFilters
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'pm-btn',
                          onClick: () => {
                            setQuery('')
                            setTag(null)
                          },
                        },
                        t('allPlugins'),
                      )
                    : h('button', { type: 'button', className: 'pm-btn', onClick: onRefresh }, t('refresh')),
                })
              : null,
            items.length > 0
              ? h(
                  'ul',
                  { className: 'pm-list' },
                  items.map((item, index) =>
                    h('li', { key: `${item.name || item.id}#${index}` }, h(PluginCard, { item, t, localeId, now, onOpen: openDetail })),
                  ),
                )
              : null,
            items.length > 0 && hasMore
              ? h(
                  'div',
                  { className: 'pm-more' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'pm-btn',
                      disabled: loadingMore,
                      onClick: () => loadPage(items.length, true),
                    },
                    loadingMore ? t('loadingMore') : t('loadMore'),
                  ),
                )
              : null,
            sponsor && sponsor.enabled
              ? h(
                  'div',
                  { className: 'pm-sponsor' },
                  h('span', { className: 'pm-sponsor-icon' }, h(IconHeart, { size: 17 })),
                  h(
                    'div',
                    { className: 'pm-sponsor-text' },
                    h('span', { className: 'pm-sponsor-title' }, pickLocalized(sponsor.title, localeId) || t('sponsorTitle')),
                    h('span', { className: 'pm-sponsor-note' }, pickLocalized(sponsor.note, localeId) || t('sponsorNote')),
                  ),
                  h(
                    'button',
                    { type: 'button', className: 'pm-btn', onClick: () => setSponsorOpen(true) },
                    t('sponsorOpen'),
                  ),
                )
              : null,
          ),
        ),
        sponsorOpen && sponsor && sponsor.enabled
          ? h(SponsorOverlay, { sponsor, t, localeId, onClose: () => setSponsorOpen(false) })
          : null,
        detailName
          ? h(DetailOverlay, {
              item: detail,
              detail,
              loading: detailLoading,
              error: detailError,
              t,
              localeId,
              now,
              onClose: closeDetail,
              onRetry: retryDetail,
            })
          : null,
      )
    }

    /* ------------------------------------------------------------------ */
    /* Plugin entry                                                        */
    /* ------------------------------------------------------------------ */

    function PanelBridge(props) {
      return h(MarketPanel, { ctx: props.ctx })
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const events = []
        const currentLocale = () => (typeof ctx.get === 'function' ? ctx.get('locale') : undefined)

        // Register both built-in locales at once; a service that refuses the
        // bulk form still gets the per-locale call. A locale failure must never
        // take the sidebar entry down with it.
        const registerDictionaries = (loc) => {
          if (!loc || typeof loc.register !== 'function') return
          try {
            const dispose = loc.register(NS, DICT)
            if (typeof dispose === 'function') events.push(dispose)
          } catch {
            for (const [localeId, dict] of Object.entries(DICT)) {
              try {
                const dispose = loc.register(NS, localeId, dict)
                if (typeof dispose === 'function') events.push(dispose)
              } catch {
                /* keep the untranslated fallback */
              }
            }
          }
        }

        // The locale service may still be activating when this plugin applies
        // (the desktop client provides it after an IPC round-trip), so register
        // now when it is ready and otherwise wait for it as a soft dependency.
        registerDictionaries(currentLocale())
        if (!currentLocale() && typeof ctx.inject === 'function') {
          try {
            ctx.inject(['locale'], (childCtx) => {
              registerDictionaries(
                typeof childCtx.get === 'function' ? childCtx.get('locale') : childCtx.locale,
              )
            })
          } catch {
            /* older cores or a locale-less browser: keys stay untranslated */
          }
        }

        const railLabel = () => {
          try {
            const loc = currentLocale()
            if (loc && typeof loc.bind === 'function') return loc.bind(NS)('panelTitle')
          } catch {
            /* ignore */
          }
          return 'Plugin Market'
        }

        ctx.effect(() => {
          const disposers = []
          disposers.push(
            ctx.slots.inject('sidebar.panellist', () =>
              ctx.slots.register(
                { name: 'sidebar.panellist', id: PANEL_ID, order: 5, label: railLabel },
                MarketRailIcon,
              ),
            ),
          )
          disposers.push(
            ctx.slots.inject('main', () =>
              ctx.slots.register({ name: 'main', key: PANEL_ID }, (slotProps) =>
                h(PanelBridge, { ...(slotProps || {}), ctx }),
              ),
            ),
          )
          return () => {
            for (const dispose of disposers) {
              try {
                if (typeof dispose === 'function') dispose()
              } catch {
                /* ignore */
              }
            }
            for (const dispose of events) {
              try {
                if (typeof dispose === 'function') dispose()
              } catch {
                /* ignore */
              }
            }
          }
        }, 'plugin-market: sidebar entry and main panel')
      },
    }
  },
})
