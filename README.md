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
| 打赏区 | 已内置作者赞赏码：列表底部一张低调的「支持作者」卡片，点开展示二维码（可关闭，见下） |

## 数据来源与口径

- **内置快照**：`data/market.json`，700 条真实社区插件（取自 DSH Market 社区索引 `plugins.json`，按星标排序的头部条目），**断网也能完整浏览**。
- **在线刷新**：`refresh` 依次尝试
  `https://2bingling.github.io/dsh-market/plugins-lite.json`、
  `https://2bingling.github.io/dsh-market/plugins.json`（15s 超时）；
  成功后重建索引并缓存到 `$DSH_HOME/plugins/plugin-market/data.json`（下次启动优先使用更新的缓存）。
- **「使用人数」口径**：公开索引没有安装数遥测，唯一公开的使用热度信号是 GitHub 星标数（`stars`），并以社区综合分（`score`）作为同星标的 tie-break。UI 上已用「使用人数按社区星标热度排序」明确说明，**不展示编造的安装量**。

## 打赏 / 支持作者

本插件**默认展示作者的微信赞赏码**：市场列表底部有一张「支持作者」卡片，点「查看打赏方式」弹出面板显示二维码。不弹窗、不打断浏览，也不影响搜索和安装。

- **想关掉**：把 `data/sponsor.json` 里的 `"enabled": true` 改成 `false`，整块会消失。
- **想换成自己的**：复制 `data/sponsor.example.json`，填写 `links`（`http(s)` 链接）和/或 `qrcodes`（二维码），替换 `data/sponsor.json` 即可。
- **不改安装包也能覆盖**：在 `$DSH_HOME/plugins/plugin-market/sponsor.json` 放一份同格式配置（优先于包内配置，适合本地预览）。

配置示例：

```json
{
  "enabled": true,
  "title": { "zh": "支持作者", "en": "Support the author" },
  "note": { "zh": "如果它帮你省了时间，欢迎请作者喝杯咖啡。", "en": "..." },
  "links": [{ "label": "爱发电", "url": "https://afdian.com/a/your-name" }],
  "qrcodes": [{ "label": { "zh": "微信赞赏码", "en": "WeChat" }, "src": "data:image/jpeg;base64,..." }]
}
```

规则：

- 链接只接受 `http(s)`，`javascript:` / `ftp:` 等会被宿主丢弃
- 二维码只接受 `data:image/(png|jpeg|webp);base64,...`（≤512KB）或 `https` 图片地址
- 没有可用条目时整块自动隐藏
- 生成 base64：`printf 'data:image/png;base64,'; base64 -i wechat.png | tr -d '\n'`

## 结构

```
index.js           宿主半边：export const inject = ['webServer']，注册 POST /plugin-market/api
client.js          浏览器半边：sidebar.panellist + main 面板（原生 JS + React.createElement）
lib/search.js      纯函数：归一化 / 匹配 / 三种排序 / 标签分面 / 分页
data/market.json   内置快照（700 条）
data/sponsor.json  打赏配置（当前 enabled: true，内置作者赞赏码）
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
