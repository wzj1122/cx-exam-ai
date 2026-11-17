# CX 考试 AI 大脑

**超星学习通考试页专用油猴脚本。不用题库** —— 每道题现场交给多个大模型独立作答，再交叉复核、分歧仲裁，最后把结果拟人化地点到页面上。模型、判题强度、读图策略都有**独立设置中心**（<https://cx-exam-ai.pages.dev/settings>），不必先进考试页。

[![version](https://img.shields.io/badge/version-1.8.1-6d8bff)](https://github.com/wzj1122/cx-exam-ai)
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

**配置在网页版设置中心做，脚本里只留同步码入口。** 打开 <https://cx-exam-ai.pages.dev/settings> → 选模型（预设 + 你自己的 Key）→ 点右上角 **「生成同步码并上传」**；回到考试页面板点右上角 **⇅**，把同步码粘进去点「拉取配置」就完事，之后改配置会自动同步。

模型可以加多个（越多议会投票越准）；题目带图就在设置中心「读图」里指定一个能看图的模型。预设如下：

| 预设 | Base URL | 模型名 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1` | 留空 → 点「拉取」按清单选 |
| 基元律动 | `https://tokenrhythm.studio/v1` | 同上 |
| 通义千问 VL / 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 同上 |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | 同上 |
| OpenAI | `https://api.openai.com/v1` | 同上 |
| Ollama / LM Studio | `127.0.0.1:11434/v1`、`127.0.0.1:1234/v1` | 同上，Key 可空 |
| 自定义模型 | 自己填 | 自己填；**默认 OpenAI 协议**（`POST {base}/chat/completions`，`Authorization: Bearer`），要 Anthropic 协议在高级设置里切 |

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
| 备份 | **云同步（生成同步码并上传 / 立即上传 / 停用）**、导出 / 导入 JSON、下载、从文件导入、恢复默认、存储状态 |
| 诊断 | 版本与构建时间、存储后端、模型清单、`CXAI.diag()` 原始输出、一键测试全部连接 |

要点：

- **改动即时保存**，没有「保存」按钮；回到考试页刷新一下就是新配置。
- **存储是按域名隔离的**（Tampermonkey / Violentmonkey 的 GM 存储作用域是「脚本 + 站点」），而超星考试页又分散在 `i.` / `mooc2-ans.` / `passport2.` 等多个子域 —— 纯前端传不过去。
  所以「备份」页提供 **云同步（推荐）**：配置在浏览器里用随机密钥 **AES-GCM 加密后**才上传到 Cloudflare KV，**密钥不上传**（零知识，KV 泄露也解不开）；考试页粘一次同步码，之后每次打开自动拉取。
- 顶栏常驻 **「生成同步码并上传」**（配好模型就点它，不用进高级设置）；点完同步码会自动复制，并显示在模型页顶部。
- 若脚本管理器不支持 GM 存储（设置页顶部会标「仅本域存储」），同样走上面两条通道搬运。
- 支持深链：`/settings.html?tab=judge` 直接落到判题栏，取值 `model` / `judge` / `vision` / `run` / `backup` / `diag`。
- 自建部署换了域名：把配置项 `ui.settingsURL` 指向你的地址，面板里的「独立设置页 ↗」会跟着变。
- 页面自带一份静态兜底：脚本没接管（版本 < 1.8.0、未授权该域名）时会显示排查步骤，不会白屏。
- 读图模型必须由你指定（下拉里**没有「自动挑」**）：脚本判断不了哪家模型真能看图，与其猜错不如让你选。
- 单题最多处理 **6** 张图（上限 20，在高级设置里调）。

### 简单版与高级版

默认是**简单版**：左栏只有「模型 / 判题 / 读图」三栏。

- 模型卡只填 **预设 / Base URL / API Key / 模型名**（附「拉取」「测试这个模型」）
- 判题只有一个 **判定强度** 四档下拉（省 token / 快速 / 标准 / 严格）
- 读图只问四件事：**要不要读图 / 怎么读 / 用哪个模型读 / 它要不要一起参与判题**

需要权重、温度、输出上限、阈值、并发、超时、运行节奏、备份、诊断时，点右上角 **「高级设置」** 才全部展开。
值一直保留，切回简单版不会被清掉。

### 第一次打开：三步向导

一个模型都没配、也没点过跳过时，设置页不是一堆表单，而是三步向导：

1. **加模型（可加多个）** —— 九个预设任选（含「自定义模型」，选它就要自己填 Base URL），填 Key，点「+ 添加这个模型」；
   已添加的会列在上方，想加第二个就再选一次（判题时多个模型会各自作答再投票）。每步都能点「拉取」按清单选模型、「测试连通」验通道
2. **判题强度** —— 四档任选，内部参数自动换算
3. **读图** —— 要不要处理图片题、用哪个模型读、怎么读

走完就写 `ui.onboarded=true` 进入简单版设置页；点「先跳过」也能跳过，之后随时回来配。

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

「设置 → 判题模型」每行顶部有**预设下拉**，共九个：**DeepSeek / 基元律动 / 通义千问 VL / 通义千问 / 智谱 GLM / OpenAI / Ollama / LM Studio / 自定义模型**。

**所有预设都不预设模型名** —— 模型名以端点最新返回的 `/models` 清单为准：选中预设、填好 Key，点「拉取」，脚本会把清单列出来让你选（模型名为空时自动选第一个，随时能换）。每行只露「预设 / Base URL / API Key / 模型名（含「拉取」「▾」）」。

**自定义默认按 OpenAI 兼容协议**（`POST {base}/chat/completions`，`Authorization: Bearer`）；如果你的端点只吃 Anthropic 协议（`POST {base}/v1/messages`，`x-api-key` + `anthropic-version`），把该行预设选成「自定义」后会多出「接口协议」下拉，切到 `Anthropic 兼容` 即可，Base URL 不用改。

- **接口风格**三选一：`OpenAI /chat/completions`、`Anthropic /v1/messages`、`Gemini generateContent`。magpie 这类本地网关同一端口三种都支持，选任意都行（预设里已不含 magpie，用「自定义模型」填它的地址即可）。
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
node tools/build-site.js # 生成 Cloudflare 发布目录 .site/（只含 index.html + settings.html + dist/ + images/）
node tools/verify-cdp.mjs # 真实浏览器端到端验证（CDP 驱动 Chrome，两个 origin 模拟跨域）
npx wrangler pages deploy --project-name=cx-exam-ai --branch=main   # 只发布 .site/ 到 Cloudflare Pages
```

### 一条命令发新版（GitHub + Cloudflare）

```bash
npm run release -- --bump patch    # 升 PATCH 位并发布；功能新增用 minor
npm run release -- --version 1.11.0
npm run release:dry                # 只构建+自检+测试，不提交不部署
```

`tools/release.js` 会依次：同步版本号（`package.json` → `src/00-header.js` 的 `@version`）→ 构建 `dist/` → 自检 → 离线测试 → 生成 `.site/` → 按白名单 `git add` → `commit` → `push origin main` → `wrangler pages deploy --branch=main` → 回读线上 `@version` 校验。中间任何一步失败就中止，不会留下"源码推了、`dist` 没推"或"两处版本号不一致"的半成品。

`--dry`（或 `npm run release:dry`）把最后三步换成跳过，适合先看构建和测试是否全绿。

零依赖，不需要 `npm install`。两层测试：

- `node tools/test-dom.js`：自建 DOM 垫片里的离线集成测试，覆盖整卷抓题、单选/多选/判断/填空点选、答案映射、分歧→复核→仲裁全链路，当前 **114 项断言全绿**。
- `node tools/verify-cdp.mjs`（`npm run e2e`）：起两个静态服务（不同端口 = 不同 origin，复现"设置页配好、考试页读不到"的真实隔离）+ headless Chrome，用真实鼠标事件跑完设置中心向导 → 生成配置码 → 考试页落库 → 悬浮球行为，当前 **20 项全绿**。

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

### v1.10.0（2026-11-17）新题型：附件题（PDF 当题干）

- **识别**：题干为空、正文全在附件里的题（`iframe.attach-iframe[module=insertAttach][objectid=…]`）。旧版会把这种题当空容器丢掉，整卷显示 0 题。
- **取图（不下载 PDF）**：附件逐页图地址由 `md5(objectid)` 的末三个字节推出 —— `https://s3.cldisk.com/sv-w9/doc/<f9/0d/c3>/<objectid>/thumb/N.png`。用 `HEAD` 探页数最准：s3 对缺失页返回 **404 + 1200×675 占位图**，所以 `img.onload` 判不出真假（实测 8 页全"成功"）。
- **喂模型**：页图直接进 `question.images`，复用原有读图通道（inline 直传 / ocr 转写都行）。
- **作答**：prompt 增加【附件材料】与「作答框 = 整份材料的答题区」说明；长答案 token 上限提到 4000，避免简答被截成半句。
- **题型标签**：按题型码还原中文名（4=简答题、5=论述题、6=计算题、8=名词解释…），不再把简答一律显示成"填空题"。
- 新增配置 `answer.attach`（默认开）与模块 `src/03c-attach.js`。
- 实测：2 页 PDF 试卷 → 自动取到 `thumb/1.png`、`thumb/2.png`（1023×1447），已进读图链路。

### v1.9.2（2026-11-17）整卷填空自动落盘 + 脚本内设置面板下线

- **修 bug：整卷预览下填空题填完不保存、卡住下一题。** 整卷/章节页每题都有自己的「保存」按钮，不点会在失焦或重绘时被清掉，超星还会拦住继续填下一题。现在整卷模式下只要该题有输入框（填空/简答）就自动点保存，不受 `saveEach` 配置限制。
- 顺带修掉一个隐藏很久的坑：`saveOne()` 命中的往往是外层容器 `div.savebtndiv`，直接点容器不会触发里面 `<a onclick="saveQuestion(…)">` 的行为 —— 现在会往下找真正可点的元素再点。
- **脚本内的设置面板整体移除**（`07-ui.js` 1742 → 983 行）：面板右上角原来的 ⚙ 换成 **⇅ 云同步**，只保留一个同步码输入框 + 「拉取配置」+「打开设置中心」。配置全在网页版设置中心，避免两处配置打架。
- 无模型时点「自动连答」会打开同一个小窗提示去配同步码；油猴菜单新增「输入同步码（云同步）」。
- E2E 扩到 **30 项**：新增 D 段用本地 mock 模型跑整卷两题，断言两题都写入且 **`saveCount=2`**（保存按钮真的被点了）。

### v1.9.1（2026-11-17）云同步入口提到顶栏

- 顶栏原「同步到考试页」（把配置编码进 URL 的旧方案）**删除**，换成 **「生成同步码并上传」**：没开云同步时点击即生成+上传+自动复制同步码；已开启时按钮变成「上传到云端」，点一下手动同步一次。
- 模型页顶部新增**云同步状态条**（简单版也可见）：显示当前同步码 + 「复制」「立即上传」，不用再点「高级设置 → 备份」去找。
- 备份页删掉「备用：离线搬运（同步到学习通）」整块 —— 那个方案只能落到打开的那个子域，留着只会误导。

### v1.9.0（2026-11-17）云同步：Cloudflare Pages Functions + KV 中转（彻底解决跨子域）

- **为什么必须上服务端**：超星考试页分散在 `i.chaoxing.com` / `mooc2-ans.chaoxing.com` / `passport2.chaoxing.com` 等多个子域，且未登录会 302 跳登录域（hash 被丢掉）。浏览器存储按 origin 隔离，纯前端方案无论怎么搬都到不了"考试页所在的那个子域"。
- 新增 `functions/api/sync/[id].js`（Pages Functions，跑在 `cx-exam-ai.pages.dev/api/sync/…`，国内可达）+ KV 命名空间 `CFG_KV`。
- 新增 `src/10-sync.js`：随机 128-bit 密钥 AES-GCM 加密配置后上传，密钥**从不上传**；服务端只存密文与 HMAC 写权限令牌（首次写入即绑定）。
- 设置中心「备份」页：**生成同步码并上传**、立即上传、从云端拉回校验、停用；改动 **自动上传**（1.2s 防抖）。
- 考试页面板：无配置时提示条里直接粘同步码拉取；存过码之后**打开即自动拉取**（`CXAI.Sync.autoPull()`）。
- 同步码形如 `abc12345.XYZ…`（33 字符）——它同时是解密密钥，别公开。

### v1.8.7（2026-11-17）修「设置中心的配置考试页读不到」+ 考试页不再自动弹窗

- **真 bug**：之前误以为「油猴 GM 存储同一脚本跨域名共享」，实际上 Tampermonkey / Violentmonkey 的存储作用域是「脚本 + 站点」。结果在设置中心（pages.dev）配好的模型，考试页（chaoxing.com）读不到，还弹出「当前域名还没有配置」。
  - 新增 `CXAI.cfgCodec`（base64 + UTF-8）与「**同步到学习通 →**」按钮：把整份配置编码进 URL hash 打开学习通，脚本在任何匹配页面读一次 `#cxai_cfg=…` 就落库到本域，并立刻清掉 hash（`history.replaceState`）。
  - 同时保留「复制配置码」与 JSON 导出/导入。
- **不再自动弹设置窗**：本域没配置时只记日志 + 在悬浮球左上角点一颗橙点，面板里显示一行提示条，除非你自己点球/点按钮，否则什么都不弹。只有你主动点「自动连答」而没模型时，才会打开设置面板。
- 修正所有「跨域名共享」的错误表述（设置页胶囊、诊断页、面板存储信息、README）。

### v1.8.6（2026-11-17）自定义模型默认走 OpenAI 协议

- 「自定义模型」的默认接口协议明确为 **OpenAI**（`POST {base}/chat/completions`，`Authorization: Bearer`）：预设说明、向导提示、高级设置里的下拉提示都写清楚了；套用预设与向导落库时都显式兜底成 `openai`，不会再残留上一次的 Anthropic/Gemini 选择。
- 修一个交互死角：在首次向导里点右上角「高级设置」原本没反应（向导优先渲染）——现在会结束引导、标记已完成并直接进高级设置页。

### v1.8.3（2026-11-17）预设换血：加基元律动、去 magpie/Kimi、模型名一律留空

- 新增预设 **基元律动**（`https://tokenrhythm.studio/v1`，OpenAI 兼容）。
- 删除预设 **magpie** 与 **Kimi**；「自定义」改名 **自定义模型**。现在共 9 个预设。
- **所有预设都不再预设模型名**（`model: ''`）：一律以点「拉取」后端点返回的清单为准，模型名为空时自动选第一个，可随时在同一行的下拉里换。
- 首次向导的第 1 步也加了「拉取」按钮与模型下拉，选完预设直接拉清单选模型，不用手打。
- 旧配置里存的 `preset: 'magpie' / 'kimi'` 不会报错：反查逻辑只认当前存在的预设，查不到就显示「自定义模型」，Base URL / 模型名原样保留。

### v1.8.2（2026-11-17）设置中心分简单版 / 高级版 + 首次三步向导

- 设置中心默认是**简单版**：只保留「模型 / 判题 / 读图」三栏；模型卡去掉权重、温度、输出上限、接口协议、允许空 Key；判题只留「判定强度」四档；读图只留「要不要读图 / 怎么读 / 用哪个模型 / 是否一起参与判题」。运行、备份、诊断在简单版里不出现。
- 右上角新增 **「高级设置」** 开关：打开才显示全部六栏与全部字段，值一直保留，切回简单版不受影响。
- 新增**三步向导**：没配模型且没点过跳过时，设置页变成「① 加一个模型（九个预设 + 测试连通）→ ② 判题强度 → ③ 读图」，走完才进设置页。
- **读图模型不再「自动挑」**：脚本拿不到"这家模型能不能看图"的数据，改由用户在下拉里指定；留空或指向已删模型时自动落到第一个启用模型，单模型时自动兼任判题。
- 单题图片数量默认 3 → **6**，上限 8 → **20**。

### v1.8.1（2026-11-16）修设置中心的三个问题

- **修首页被整页吞掉**：`isHere()` 把 Pages 根路径 `/` 也当成设置页，于是打开 `cx-exam-ai.pages.dev` 直接被接管，设置页上点「安装页」（链接回 `/`）又进设置页、回不去。现在只认 `/settings` 与 `/settings.html`。
- **新装不再"自带模型"**：`DEFAULT_CONFIG.ai.providers` 改为空数组。以前默认塞了 3 个空 Key 的模板模型，看起来像已经配好了。现在首次打开是空态 + 九个预设一键添加。
- **预设补全到 10 条**：`CXAI.PRESETS` 此前实际只有 `deepseek` / `magpie` / `custom` 三条，文档里写的 qwen / glm / kimi / openai / ollama / lmstudio 并不存在，现已补齐（含通义千问 VL 这类视觉模型）。
- **头部排版**：存储状态胶囊文案缩短（`仅本域存储` / `油猴存储 · 跨域共享`）且禁止折行，顶栏允许换行，窄窗口下不再挤成两行。

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
