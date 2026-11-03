# 插件市场（Plugin Market）

给 DeepSeek Harness 加一个**左侧栏入口的插件市场**：浏览、搜索、按使用人数排序、按标签筛选、查看详情与一键复制安装命令。

- npm：`dsh-plugmart`
- 仓库：<https://github.com/archiecheung/dsh-plugmart>

<!-- 收录后可在顶部挂 DSH Market 徽章：

[![DSH Market](https://raw.githubusercontent.com/2BingLing/dsh-market/master/assets/readme/badge-listed-zh.svg)](https://dsh.market/)
-->

## 安装

```bash
npx @deepseek-ai/dsh plugin --profile <profile> add dsh-plugmart
```

装完**重启 DSH** 生效（bundle 在启动时合成）。重启后左侧栏出现商店图标，点开即市场面板。

## 入口

- 位置：左侧栏导航图标（`sidebar.panellist`，位于「插件」与「定时任务」之间，order = 5）。
- 点击后在中央主面板打开「插件市场」页（`main` key = `plugin-market`）。
- 插件名称：**插件市场** / **Plugin Market**（跟随界面语言）。

## 功能

| 能力 | 说明 |
|---|---|
| 搜索 | 250ms 防抖、回车立即；匹配插件名、仓库 id、作者、标签、中英文描述；中文直接子串匹配，无需分词 |
| 排序 | **使用人数**（默认）、**最近更新**、**名称** |
| 标签筛选 | 顶部 16 个热门标签 chips，与搜索/排序叠加生效 |
| 分页 | 每页 24 条，「加载更多」追加 |
| 详情 | 右侧滑出：完整描述、作者、星标、更新时间、全部标签、安装命令（复制）、主页链接；Esc 关闭 |
| 刷新 | 一键拉取社区在线索引；失败时保留当前数据并给出中性提示（离线/超时/其他） |

## 数据来源与口径

- **内置快照**：`data/market.json`，700 条真实社区插件（取自 DSH Market 社区索引 `plugins.json`，按星标排序的头部条目），**断网也能完整浏览**。
- **在线刷新**：`refresh` 依次尝试
  `https://2bingling.github.io/dsh-market/plugins-lite.json`、
  `https://2bingling.github.io/dsh-market/plugins.json`（15s 超时）；
  成功后重建索引并缓存到 `$DSH_HOME/plugins/plugin-market/data.json`（下次启动优先使用更新的缓存）。
- **「使用人数」口径**：公开索引没有安装数遥测，唯一公开的使用热度信号是 GitHub 星标数（`stars`），并以社区综合分（`score`）作为同星标的 tie-break。UI 上已用「使用人数按社区星标热度排序」明确说明，**不展示编造的安装量**。

## 支持作者

这个插件免费开源、纯本地运行、不采集任何数据。如果它帮你省了时间，欢迎扫码请我喝杯咖啡（完全自愿，不影响任何功能）。

<img src="assets/sponsor-qr.jpg" alt="微信赞赏码" width="240" />

> 想自己二次开发的话：`data/sponsor.json` 里也留了一个**默认关闭**的可选打赏区，填上链接或二维码并设为 `enabled: true` 即可在面板底部显示（格式见 `data/sponsor.example.json`）。

## 结构

```
index.js           宿主半边：export const inject = ['webServer']，注册 POST /plugin-market/api
client.js          浏览器半边：sidebar.panellist + main 面板（原生 JS + React.createElement）
lib/search.js      纯函数：归一化 / 匹配 / 三种排序 / 标签分面 / 分页
data/market.json   内置快照（700 条）
data/sponsor.json  可选打赏配置（默认关闭，作者未启用）
assets/sponsor-qr.jpg  README 里的作者赞赏码
locale/{zh,en}.json  插件列表中的显示标题与描述
icon.svg           插件图标（原创）
cordis.patch.yml   bundle patch：插入行 local-plugin-market（避免与官方 market 行 id 冲突）
```

宿主 API（同源，JSON）：

```
POST /plugin-market/api   { "method": "meta" | "search" | "detail" | "refresh", "args": {...} }
200 { "ok": true, "result": ... } | 200 { "ok": false, "error": "...", "code": "..." }
```

## 常见问题

**能断网用吗？** 能。内置 700 条快照，搜索/排序/详情全部本地完成；联网时点「刷新数据」可换成全量社区索引。

**为什么排序叫「使用人数」而不是安装量？** 社区索引没有安装数，唯一公开信号是 GitHub 星标。我们按星标热度排序，并在界面上写明口径，不做假数据。

**刷新失败怎么办？** 页面顶部会给一条中性提示（离线 / 超时 / 其他），当前数据保持不变，继续可用。

**会采集数据吗？** 不会。插件只与 DSH 本地宿主通信，刷新时只请求上面两个公开索引 URL。

## License

MIT
