# CX 考试 AI 大脑

**超星学习通考试页专用油猴脚本。不用题库** —— 每道题现场交给多个大模型独立作答，再交叉复核、分歧仲裁，最后把结果拟人化地点到页面上。

[![version](https://img.shields.io/badge/version-1.7.1-6d8bff)](https://github.com/wzj1122/cx-exam-ai)
[![license](https://img.shields.io/badge/license-MIT-3ddc97)](LICENSE)
[![userscript](https://img.shields.io/badge/Tampermonkey-userscript-9d6bff)](dist/cx-exam-ai.user.js)
[![no-deps](https://img.shields.io/badge/dependencies-0-lightgrey)](package.json)

参考 [ocsjs](https://github.com/ocsjs/ocsjs) 的"扫描 → 提取 → 作答"分离架构与学习通选择器经验重写，但去掉了整套 pnpm workspace 与题库依赖，**单文件、零运行时依赖、零 npm install**。

## 它解决的四件事

| 问题 | 做法 |
|---|---|
| 题干/选项抓不准 | 按考试页真实 DOM 层级解析，兼容整卷 `.questionLi` 与章节 `.TiMu` 两套结构，并做嵌套元素去重 |
| 字形加密（`font-cxsecret`） | 识别内联 base64 字体 → 360px 渲染 → 积分图降采样 → FRB2 特征表汉明距离匹配，把乱码字还原 |
| 答案不准 | 多模型议会：独立作答 → 交叉复核 → 仲裁，加权一致率达标才采纳 |
| 点不动 / 被判定非人类 | 完整指针事件序列 + 随机落点 + 随机间隔 + 概率性长停顿；点完必复核选中态 |

## 安装

> **前置要求**：浏览器已安装 [Tampermonkey（油猴）](https://www.tampermonkey.net/) 扩展。
>
> **⚠️ 重要提示**：脚本运行需要开启浏览器扩展的开发者模式。打开 `chrome://extensions/`，找到 Tampermonkey，开启右上角「开发者模式」；再进入扩展详情页（`chrome://extensions/?id=dhdgffkkebhmkfjojejmpbldmpobfkfo`）开启「允许运行用户脚本」。

### 一键安装（推荐）

| 平台 | 特点 | 安装链接 |
| :--- | :--- | :--- |
| **Cloudflare** | 国内高速 CDN，推荐国内用户使用 | [Cloudflare 安装](https://cx-exam-ai.pages.dev/dist/cx-exam-ai.user.js) |
| **GitHub** | 国际同步，获取最新源码和提交记录 | [GitHub 安装](https://github.com/wzj1122/cx-exam-ai/raw/main/dist/cx-exam-ai.user.js) |
| **Greasy Fork** | 全球最大油猴脚本库，支持自动更新 | [Greasy Fork 安装](https://update.greasyfork.org/scripts/605687/CX%20%E8%80%83%E8%AF%95%20AI%20%E5%A4%A7%E8%84%91%20%C2%B7%20%E5%AD%A6%E4%B9%A0%E9%80%9A%E8%80%83%E8%AF%95%E8%87%AA%E5%8A%A8%E7%AD%94%E9%A2%98.user.js) |

### 手动安装

1. 点击 Tampermonkey 图标 → 添加新脚本
2. 把 [`dist/cx-exam-ai.user.js`](dist/cx-exam-ai.user.js) 全文粘贴进去（或直接把文件拖进浏览器）
3. 保存（Ctrl+S）

### 项目主页与源码

- **GitHub 主页**：[https://github.com/wzj1122/cx-exam-ai](https://github.com/wzj1122/cx-exam-ai)
- **Greasy Fork 主页**：[https://greasyfork.org/zh-CN/scripts/605687](https://greasyfork.org/zh-CN/scripts/605687)
- **Cloudflare Pages 主页**：[https://cx-exam-ai.pages.dev](https://cx-exam-ai.pages.dev)

## 使用方法

### 第一步：打开考试页

登录超星学习通并进入考试/作业页，右下角出现 `CX` 悬浮球；按 `Ctrl+Shift+X` 呼出面板。

### 第二步：配置模型

点 ⚙ 打开设置。面板只有三块：**判定强度**下拉、**读图模型**下拉、**判题模型列表**；其余旋钮全折叠在「高级设置 · 一般不用改」里，默认值直接能用。**至少一个判题模型**（可加多个，越多越准）；题目带图就再挑一个读图模型：

| 预设 | Base URL | 模型名 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| magpie（本地） | `http://127.0.0.1:3425/v1` | `deepseek/deepseek-chat`，Key 填 `magpie` |
| 自定义 | 自己填 | 自己填，默认按 OpenAI 兼容接口发请求 |

填好 Base URL 和 Key 后点模型名右侧的「拉取」，脚本会向供应商的 `/models` 要一份清单，再从「▾」浮层里挑。点「测试连接」看到 `连通 (xxx ms)` 即可。

### 第三步：开始答题

点面板上的「开始」。脚本会自动抓题 → 调用模型判定 → 拟人化点选写入。低置信度题目会**标黄**，交卷前建议人工看一眼。

## 独立设置中心（不进考试页也能配）

装好脚本后直接打开 **https://cx-exam-ai.pages.dev/settings**（仓库里的文件名是 `settings.html`，Cloudflare Pages 会把它 308 到 `/settings`，两个地址都能用），
脚本会把这一页接管成一个完整的设置后台：

| 分类 | 能改什么 |
| :--- | :--- |
| 模型 | 增删模型、选预设、填 Base URL / Key、拉取模型清单、单卡测试、权重 / 温度 / 输出上限 |
| 判题 | 判定强度、议会模型数、一致率阈值、最低置信度、并发、超时、交叉复核与仲裁 |
| 读图 | 处理策略（auto / inline / ocr / off）、读图模型、是否兼任判题、缩放与质量、缓存 |
| 运行 | 翻页模式、题间间隔、弹窗延迟、拟人化、落盘重试、后台预取、自动交卷（慎用） |
| 备份 | 导出 / 导入 JSON、下载到本地、从文件导入、恢复默认、存储状态 |
| 诊断 | 版本与构建时间、存储后端、模型清单、`CXAI.diag()` 原始输出、一键测试全部连接 |

要点：

- **改动即时保存**，没有「保存」按钮；回到考试页刷新一下就是新配置。
- 靠的是油猴 GM 存储**同一脚本跨域名共享**，所以设置页（pages.dev）与考试页（chaoxing.com）读写的是同一份配置。
- 若脚本管理器不支持 GM 存储（页面顶部会标「仅本源 localStorage」），配置只在本域有效 —— 用「备份 → 导出」把 JSON 粘到考试页的 `⚙ → 备份` 里即可。
- 支持深链：`/settings.html?tab=judge` 直接落到判题栏，取值 `model` / `judge` / `vision` / `run` / `backup` / `diag`。
- 自建部署换了域名：把配置项 `ui.settingsURL` 指向你的地址，面板里的「独立设置页 ↗」会跟着变。
- 页面自带一份静态兜底：脚本没接管（版本 < 1.8.0、未授权该域名）时会显示排查步骤，不会白屏。

## 判定模式（严格模式到底怎么判）

模型分两类，互不重叠：**读图模型**（0 或 1 个，只把图转成文字，不投票）和**判题模型**（至少 1 个，全部参与判题）。面板顶上那个**判定强度**下拉就是下表的快捷开关，选它自动写回 `判定模式 / 参与模型数 / 交叉复核 / 仲裁`，日常只动这一个。

| 档位 | Round 1 | Round 2 | Round 3 |
|---|---|---|---|
| 省 token `single` | 权重最高的 1 个模型答一次 | — | — |
| 快速 `fast` | 1 个模型用 0.15 / 0.5 / 0.85 三档温度各答一次，自一致投票 | — | — |
| 标准 `council` | 取权重最高的 `panelSize`(默认 3) 个判题模型**并行独立作答** | 一致率不达标时，各模型看别人的答案再表态（权重 ×1.2） | — |
| 严格 `max` | 同上 | 同上 | 仍不达标时，权重最高的模型当裁判直接定案（权重 ×1.5） |

`council`/`max` 的具体判定顺序（代码在 `src/04-ai.js` 的 `solve()`）：

1. **Round 1** 并行问每个判题模型，各自给出 `{answer, confidence, reason}`，答案先归一到选项字母；
2. `tally()` 按答案键累加**加权票**，最高票为候选答案，`ratio` = 该票权重 / 总权重；
3. `ratio ≥ voteThreshold`(默认 0.7) → 直接采纳，收工；
4. 否则 **Round 2 交叉复核**：每个模型看到其他模型的答案后重新表态，权重 ×1.2 并入票池，再算一次 `ratio`；
5. 仍不达标且开了仲裁 → **Round 3**：权重最高的模型当裁决者，权重 ×1.5 并入票池，采纳其结果；
6. 全都不达标就取加权最高票兜底，并把该题标成低置信。

`confidence < minConfidence`(默认 0.55) 或 `ratio < 0.5` 的题目会在面板里**标黄**，交卷前建议人工看一眼。判题模型只有 1 个时，Round 2/3 没有意义，等价于单模型直接作答。

## 读图模型（图片题）

学习通不少题是截图或几何图，没有文字。设置里那个**读图模型**下拉就是干这个的：

- 选一个模型 → 页面上的题图（`GM_xmlhttpRequest` 带 `Referer` 抓，避免登录态校验）先交给它转成文字（题干 / 选项 / 图表描述），再交给下面的判题模型；
- 选「不用读图」→ 带图的题按纯文字去猜，准确率会掉；
- 读图模型**不参与投票**，它只负责看图，判题永远由判题模型做。所以只有 1 个模型时别把它设成读图模型，否则没有模型判题（保存会拦下来）。

抓图后 canvas 缩放到长边 1400px、JPEG 0.82 再编码 data URL；单张 <600B 视为占位图丢弃，累计超 4MB 截断；任何一步失败都降级成纯文本判题，不会中断整卷。

## 接自己的模型 / 本地网关

「设置 → 判题模型」每行顶部有**预设下拉**，只有三个：**DeepSeek / 自定义 / magpie**。选中自动填好 Base URL 与模型名，仍可手改。每行只露「预设 / Base URL / API Key / 模型名（含「拉取」「▾」）」。

**自定义默认按 OpenAI 兼容协议**（`POST {base}/chat/completions`，`Authorization: Bearer`）；如果你的端点只吃 Anthropic 协议（`POST {base}/v1/messages`，`x-api-key` + `anthropic-version`），把该行预设选成「自定义」后会多出「接口协议」下拉，切到 `Anthropic 兼容` 即可，Base URL 不用改。

- **接口风格**三选一：`OpenAI /chat/completions`、`Anthropic /v1/messages`、`Gemini generateContent`。magpie 同一端口三种都支持，选任意都行。
- **允许空 Key**：Base URL 是 `127.0.0.1` / `localhost` / `10.x` / `192.168.x` / `172.16-31.x` 时自动勾上，本地网关不必编个假 Key。
- **额外请求体/请求头 JSON**：如 `{"top_p":0.9}`、`{"X-Title":"cx-exam"}`，会深合并进请求。

magpie 示例（`OPENAI_API_KEY=magpie magpie` 起服务后）：

```
Base URL : http://127.0.0.1:3425/v1
模型名   : deepseek/deepseek-chat      ← provider/model 形式
接口风格 : openai                       ← 也可 anthropic / gemini
允许空Key: ✓
```

## 安全边界（默认行为）

- 交卷**永不自动点**，除非显式勾选"自动交卷"（勾了也会先停 10 秒等你反悔）。
- 弹窗只自动关"继续作答/继续考试"这类，含"交卷/提交试卷"的按钮一律不碰。
- 已答题目默认跳过；要重做需勾"重做已答题目"。

## 开发

```bash
node build.js          # 拼接 src/*.js → dist/cx-exam-ai.user.js
node build.js --watch  # 监听重建
node tools/check.js    # 语法 + 模块契约自检
node tools/test-dom.js # 离线集成测试（自建 DOM 垫片 + 模拟模型端点）
node tools/build-site.js # 生成 Cloudflare 发布目录 .site/（只含 index.html + dist/ + images/）
npx wrangler pages deploy --project-name=cx-exam-ai --branch=main   # 发布到 Cloudflare Pages
```

零依赖，不需要 `npm install`。测试夹具覆盖：整卷抓题、单选/多选/判断/填空点选、答案映射、分歧→复核→仲裁全链路，当前 111 项断言全绿。

改动前请先读 [`MAINTENANCE.md`](MAINTENANCE.md)（维护手册：文件用途清单、数据流、修改安全守则、完整变更记录）。

## 目录

```
cx-exam-ai/
├── build.js              零依赖打包器
├── src/
│   ├── 00-header.js      UserScript 元数据
│   ├── 01-core.js        配置/存储/工具/日志
│   ├── 02-font.js        字形加密还原
│   ├── 03-scraper.js     页面识别与题目解析
│   ├── 03b-vision.js     图片题读图层
│   ├── 04-ai.js          多重 AI 判定
│   ├── 05-apply.js       拟人化点选与写入
│   ├── 06-guard.js       环境伪装与节奏
│   ├── 07-ui.js          Shadow DOM 控制台
│   └── 08-main.js        主编排引擎
├── tools/{check,test-dom,build-site}.js
├── wrangler.jsonc        Cloudflare Pages 部署配置（pages_build_output_dir: ./.site）
├── dist/cx-exam-ai.user.js   构建产物（唯一交付物）
├── index.html            落地页（Cloudflare Pages 一键安装）
└── MAINTENANCE.md        维护手册
```

## 更新日志

### v1.8.0（2026-11-16）独立设置中心：不进考试页也能配模型

- 新增 `settings.html` + `src/09-settings.js`：脚本接管整页，六个分类（模型 / 判题 / 读图 / 运行 / 备份 / 诊断），改动即时保存。
- 新增 `@match`（`cx-exam-ai.pages.dev`、`wzj1122.github.io/cx-exam-ai`、`127.0.0.1`）：脚本能在设置页运行；页面靠 `<html data-cxai-settings>` 识别，不依赖域名硬编码。
- 考试页面板底部新增「独立设置页 ↗」，油猴菜单新增「打开设置中心（配置模型）」；地址可用 `ui.settingsURL` 覆盖。
- 顺手修掉一个真 bug：面板勾「自动交卷」只写了 `apply.submit`，而引擎与 guard 读的是 `apply.autoSubmit` —— 开关一直不生效。现在写入双写、读取双认。
- 支持 `/settings.html?tab=judge` 深链；`tools/build-site.js` 把 `settings.html` 一起发布。

### v1.7.1（2026-11-16）接入 Greasy Fork 自动更新

- 头部新增 `@updateURL` / `@downloadURL`，指向 Greasy Fork 脚本 `605687`；装过一次之后每次发版自动更新。
- 仓库已配置 Greasy Fork Webhook（push 事件），推送即触发同步，无需手动上传。
- 三处安装链接全部实际可用：Cloudflare（`cx-exam-ai.pages.dev`）/ GitHub raw / Greasy Fork。

### v1.7.0（2026-11-16）首个公开发布版

- 补全 UserScript 发布元数据：`@namespace` / `@author` / `@homepageURL` / `@supportURL`。`@updateURL` / `@downloadURL` 待在 Greasy Fork 建档拿到 `SCRIPT_ID` 后回填（占位 ID 会让油猴每次启动都去拉起一个 404 的更新地址，故先不写入）。
- 新增 `index.html` 一键安装落地页（Cloudflare Pages）、`LICENSE`（MIT）、`CLAUDE.md`（仓库规则）、`.gitignore`、`images/`。
- README 补齐一键安装表、使用方法、判定模式、读图模型、本地网关与支持作者。
- 其余功能与 v1.6.4 一致，详见 [MAINTENANCE.md](MAINTENANCE.md) 的变更记录。

### v1.6.x 及更早

详见 [MAINTENANCE.md](MAINTENANCE.md) 的「变更记录」章节（倒序，含每个版本的改动摘要与涉及文件）。

## 致谢

本项目基于以下开源项目改进而来：

- [ocsjs](https://github.com/ocsjs/ocsjs) —— MIT，学习通适配思路与选择器经验的主要参考
- [江西财经大学自动评教](https://github.com/wzj1122/jxufe-auto-evaluate) —— 本人的另一个油猴脚本，本仓库的发布流程（一键安装 / Greasy Fork / Pages）沿用其结构

## 二次开发

如需二次开发或有其他合作需求，请联系作者邮箱：**18293592881@163.com**

## 支持作者

如果这个项目帮到了你，可以请作者喝杯咖啡吗？

<p align="center">
  <img src="images/alipay.png" width="200" /> &nbsp;&nbsp;&nbsp;&nbsp; <img src="images/wechat_pay.png" width="200" />
</p>

## 免责声明

1. 本项目仅供**学习交流和技术研究**使用，不得用于任何违反学校规定或法律法规的用途。
2. 本项目不隶属于超星学习通或其任何关联机构，不代表其官方立场或观点。
3. 本项目不收集、存储或传输任何用户的个人信息、账号密码或考试数据。API Key 与作答结果只保存在浏览器本地（`GM_setValue` / `localStorage`）。
4. 使用本脚本进行考试作答可能违反学校的相关管理规定，用户应自行承担一切后果和责任。
5. 如有任何问题或侵权争议，请联系作者邮箱：**18293592881@163.com**

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件
