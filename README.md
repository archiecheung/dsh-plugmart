# 插件市场（Plugin Market）

给 DeepSeek Harness Web 端加一个**左侧栏入口的插件市场**：浏览、搜索、按使用人数排序、按标签筛选、查看详情与一键复制安装命令。

## 入口

- 位置：左侧栏导航图标（`sidebar.panellist`，位于「插件」与「定时任务」之间，order = 5）。
- 点击后在中央主面板打开「插件市场」页（`main` key = `plugin-market`）。
- 插件名称：**插件市场** / **Plugin Market**（跟随界面语言）。

## 功能

| 能力 | 说明 |
|---|---|
| 搜索 | 250ms 防抖；匹配插件名、仓库 id、作者、标签、中英文描述；中文直接子串匹配，无需分词 |
| 排序 | **使用人数**（默认）、**最近更新**、**名称** |
| 标签筛选 | 顶部 16 个热门标签 chips，与搜索/排序叠加生效 |
| 分页 | 每页 24 条，「加载更多」追加 |
| 详情 | 右侧滑出：完整描述、作者、星标、更新时间、全部标签、安装命令（复制）、主页链接；Esc 关闭 |
| 刷新 | 尝试从社区索引联网更新数据；失败时保留内置快照并给出中性提示（离线/超时/其他） |
| 打赏区 | 可选、默认关闭：列表底部一张低调的「支持作者」卡片，弹层展示二维码与在线打赏链接 |

## 数据来源与口径

- **内置快照**：`data/market.json`，700 条真实社区插件（来自 DSH Market 社区索引 `plugins.json` 的快照，含 1.6 万个插件的原始库中星标排名靠前的条目）。
- **「使用人数」口径**：公开索引没有安装数遥测，唯一公开的使用热度信号是 GitHub 星标数（`stars`），并以社区综合分（`score`）作为同星标的 tie-break。UI 上已用「使用人数按社区星标热度排序」明确说明，不展示编造的安装量。
- **在线刷新**：`refresh` 依次尝试
  `https://2bingling.github.io/dsh-market/plugins-lite.json`、
  `https://2bingling.github.io/dsh-market/plugins.json`（15s 超时）；
  成功后重建索引并缓存到 `$DSH_HOME/plugins/plugin-market/data.json`（下次启动优先使用更新的缓存）。

## 结构

```
index.js           宿主半边：export const inject = ['webServer']，注册 POST /plugin-market/api
lib/search.js      纯函数：归一化 / 匹配 / 三种排序 / 标签分面 / 分页
data/market.json   内置快照（700 条）
client.js          浏览器半边：sidebar.panellist + main 面板（原生 JS + React.createElement）
locale/{zh,en}.json  插件列表中的显示标题与描述
data/sponsor.json  打赏配置（默认 enabled:false；模板见 data/sponsor.example.json）
scripts/prepare-publish.mjs  生成可发布的 publish/ 目录（重写包名、校验清单）
PUBLISHING.md      发布到 npm / GitHub / DSH Market 索引的完整流程
icon.svg           插件图标（原创）
cordis.patch.yml   bundle patch：插入行 local-plugin-market（避免与官方 market 行 id 冲突）
```

宿主 API（同源，JSON）：

```
POST /plugin-market/api   { "method": "meta" | "search" | "detail" | "refresh", "args": {...} }
200 { "ok": true, "result": ... } | 200 { "ok": false, "error": "...", "code": "..." }
```

## 安装与生效

```bash
# 开发安装（plugin_manager 目录链接安装）
dsh plugin --profile desktop add dsh-plugmart
```

安装结果为 `application: restart-required`：**重启 DSH 桌面端后生效**（新 bundle 需要在新的 Host 模块代里加载）。重启后左侧栏出现商店图标，点开即市场面板。

## 打赏 / 支持作者（可选）

默认关闭，不配置就完全不渲染。发布前编辑 `data/sponsor.json`（可复制 `data/sponsor.example.json` 改名）：

```json
{
  "enabled": true,
  "title": { "zh": "支持作者", "en": "Support the author" },
  "note":  { "zh": "如果这个插件帮你省了时间，可以请作者喝杯咖啡。", "en": "..." },
  "links": [{ "label": "爱发电", "url": "https://afdian.com/a/your-name" }],
  "qrcodes": [{ "label": { "zh": "微信赞赏码", "en": "WeChat" }, "src": "data:image/png;base64,..." }]
}
```

- 链接只接受 `http(s)`；二维码只接受 `data:image/(png|jpeg|webp);base64`（≤512KB）或 `https` 图片
- 非法条目由宿主过滤；没有可用条目时整块自动隐藏
- 生成 base64：`printf 'data:image/png;base64,'; base64 -i wechat.png | tr -d '\n'`
- 运行期可用 `$DSH_HOME/plugins/plugin-market/sponsor.json` 覆盖包内配置

## 发布到插件市场

完整流程见 [PUBLISHING.md](./PUBLISHING.md)。一键生成发布目录（会重写包名并校验）：

```bash
node scripts/prepare-publish.mjs \
  --name dsh-plugin-market \
  --repo https://github.com/<you>/dsh-plugin-market \
  --author "Your Name <you@example.com>" \
  --sponsor data/sponsor.example.json      # 可选
cd publish && npm pack --dry-run && npm publish --access public
```

## 本地校验

```bash
NODE=/Users/archie/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node
$NODE --check index.js && $NODE --check client.js && $NODE --check lib/search.js
$NODE --test test/search.test.mjs          # 37 个离线单测
$NODE ../_market-checks/host-route.e2e.mjs # 宿主路由端到端（伪 req/res）
$NODE ../_market-checks/client-smoke.mjs   # 客户端制品结构 + 组件树冒烟（桩 React/loader）
```

## 已知限制

- 详情里的安装命令需要用户自行在终端执行（本版不提供页面内一键安装）；安装入口仍走「插件」页。
- 无网络时「刷新」会快速失败并给出提示，市场继续使用内置快照。
- 数据为社区索引快照，星标数与更新时间截至快照生成时间（见页面右上角数据源标签）。
- 若宿主提供 `pluginMarket` 官方索引服务（需在设置中配置索引 URL），本插件尚未接入，可作为后续迭代。
