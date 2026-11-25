# CX 考试 AI v2 · 维护手册（MAINTENANCE）

> 本文件是本软件唯一的维护入口文档。任何修改前必读，修改完成后必须同步更新。
> 最后更新：2026-11-25 ｜ 当前版本：2.0.1

## 一、软件简介

CX 考试 AI v2 是超星学习通考试页的 AI 答题辅助工具，提供 Chrome Manifest V3 扩展与 Tampermonkey 油猴脚本两种外壳。两者共享 TypeScript 核心：抓题、选项映射、答案引擎、落盘校验、配置与云同步。

产品范围仅为考试页：整卷预览与单题翻页。作业、章节测验、刷课不在范围内，非考试页不注入。

## 二、目录结构总览

```text
cx-exam-ai-v2/
├── apps/extension/          MV3 扩展外壳
├── apps/userscript/         油猴外壳
├── apps/web-settings/       网页版设置中心
├── packages/core/           共享核心
├── packages/chaoxing/       学习通考试页适配
├── packages/ui/             React 工作台
├── tests/                   单元 / DOM / E2E
├── functions/api/sync/      Pages 配置同步
├── site/                    Pages 落地页与配置说明
├── docs/                    架构、页面契约、测试、发布
├── scripts/                 构建辅助
├── README.md
└── MAINTENANCE.md
```

## 三、文件用途清单

| 路径 | 用途 | 备注 |
|---|---|---|
| `packages/core/src/types/` | 领域类型与公共接口 | 选项/题目/答案/落盘计划 |
| `packages/core/src/engine/` | 分层快答、批量解析、复核、缓存 | 不直接操作 DOM |
| `packages/core/src/providers/` | OpenAI / Anthropic / Gemini 接入 | 统一 Transport |
| `packages/core/src/sync/` | AES-GCM 配置同步与 legacy 导入 | 零知识 |
| `packages/chaoxing/src/extract/` | 考试页抓题与选项三元组 | displayLabel/serverKey/text |
| `packages/chaoxing/src/apply/` | 差量落盘、状态校验、白名单点击 | 失败即停 |
| `packages/ui/src/` | React 紧凑卡片、答案表、设置 | 扩展/油猴共用 |
| `apps/extension/` | MV3 content/background/options | service worker 走网络 |
| `apps/userscript/` | 油猴入口、GM 适配、构建 | Shadow DOM |
| `apps/web-settings/` | 网页版设置中心 | `/settings` |
| `functions/api/sync/[id].js` | 云同步接口 | KV `CFG_KV` |
| `site/` | Pages 落地页与配置说明 | 构建到 `.site/` |
| `scripts/build-site.mjs` | 生成 `.site/` | 拷贝站点与油猴脚本 |
| `scripts/package-extension.mjs` | 打包扩展 zip | 输出到 `release/` |
| `tools/live-inject.mjs` | 真实浏览器 CDP 注入脚本 | 只注入抓题/UI，不提交 |
| `tests/` | 回归夹具与测试 | 含随机选项/多选/重绘/文本题 |
| `docs/ARCHITECTURE.md` | 分层与落盘协议 | 改核心前必读 |
| `docs/PAGE-CONTRACT.md` | 学习通页面契约 | 改选择器前必读 |
| `docs/TESTING.md` | 测试矩阵与性能目标 | 发布前执行 |
| `docs/ROADMAP.md` | 未交付能力 | 视觉/附件/字体/guard |

## 四、关键流程与数据流

1. content/userscript 检测考试页并抓取 `QuestionSnapshot`。
2. 选项映射为 `displayLabel / serverKey / text` 三元组，模型只看到内部 ID `O1…On`。
3. `AnswerEngine` 先快答（文本客观题批量），再对低置信度/分歧题复核。
4. 用户在 React 工作台复核答案表，确认后生成 `ApplyPlan`。
5. `ChaoxingAdapter.apply` 重抓题目、校验指纹、读当前状态、计算差量、逐动作点击、等待保存、重读校验。
6. 任何状态不符立即 `manual` 并停住；永不自动交卷。

## 五、修改安全守则

- 不得把 DOM 位置直接当作答案键；必须优先 `serverKey`，其次 `displayLabel`，最后才允许位置并标低置信度。
- 不得恢复坐标 `hit-test`、任意父容器点击、任意页面函数盲调等兜底。
- 抓题/落盘改动必须同时新增或更新随机选项夹具测试。
- 不得在日志、诊断包或云同步明文中写入 API Key、Cookie、考试账号信息。
- 发布前必须跑 `npm run typecheck`、`npm test`、`npm run build`。
- 扩展权限不得扩大到 `<all_urls>`；自定义模型域名用 optional host permissions。

## 六、变更记录（倒序，最新在上）

| 日期 | 版本 | 改动摘要 | 涉及文件 |
|---|---|---|---|
| 2026-11-25 | 2.0.1 | 设置中心改为第一代网页版浅色版式：顶栏（logo / 存储状态 / 模型数 / 生成同步码 / 高级设置 / 保存 / 版本）+ 左侧「配置分类」+ 主卡片 + 三步向导 + 9 个预设卡片；「再加一个」只选预设、填 Key 后才落库，不再生成空 Key 模型；判题强度按当前配置反推并支持点击切换；版本号统一升到 2.0.1（扩展 zip 与油猴脚本可收到更新） | `packages/ui/src/components/SettingsPanel.tsx` `packages/ui/src/styles/workbench.css` `packages/ui/src/state/settings-app.tsx` `tests/smoke-extension.mjs` `apps/extension/manifest.json` `apps/userscript/vite.config.ts` |
| 2026-11-25 | 2.0.0 | 初始化 v2 + 第一代浅色紧凑卡片 UI（34px 球 / 404px 卡片）；共享核心、双外壳、选项三元组、分层快答、半自动填写、云同步、随机选项/多选/重绘/文本题回归；真机适配 `addChoice` 内层 span、全局 `#type`、单题总题量/当前题号、`#timer`、UEditor 填空/简答；全题号网格、悬浮球单击/长按/双击状态机、网页版设置中心；打开页自动跳到最前未答题并预取缓存（不自动点击） | 全仓库 |
