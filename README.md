# CX 考试 AI 大脑 v2

考试专用、共享核心、双外壳的 AI 答题助手。当前仓库从 `2.0.0` 起（最新 `2.0.1`），只支持超星学习通考试页；旧版已归档为 `cx-exam-ai-legacy`。

## 在线地址

- 设置中心：<https://cx-exam-ai-app.pages.dev/settings>
- 油猴脚本：<https://cx-exam-ai-app.pages.dev/dist/cx-exam-ai.user.js>
- 扩展 zip：<https://cx-exam-ai-app.pages.dev/dist/cx-exam-ai-extension-v2.0.1.zip>
- 扩展 Release：<https://github.com/wzj1122/cx-exam-ai/releases/tag/v2.0.1>

## 形态

- **Chrome 扩展（Manifest V3）**：页面内 34px 浅色悬浮球 + 404px 紧凑卡片（第一代风格）；模型请求走 service worker。
- **篡改猴脚本**：同款 React 紧凑卡片挂载到页面 Shadow DOM。
- **悬浮球**：单击按当前模式运行；长按切换「答一题 / 全部填写」；双击开合卡片；球上显示当前题号。
- **共享核心**：抓题、选项映射、答案引擎、落盘协议、配置、云同步全部复用。

## 关键原则

- 选项拆成 `displayLabel`（页面显示字母）与 `serverKey`（真正提交的键），模型只回答内部 ID `O1…On`，落盘前再映射，避免随机选项下“答对点错”。
- 默认半自动：先出答案表，用户复核并确认后串行填写；风险题默认不填；**永不自动交卷**。
- 打开考试页自动预取/缓存当前可见题答案（不自动点击）；运行时先跳到最前面的未答题。
- 失败即停：点击后状态不符立刻标人工，不换选项猜着点。
- 速度分层：纯文本客观题批量快答，只有低置信度/分歧题才追加复核。

## 当前实现状态

已实现：

- 随机选项下 `displayLabel ≠ serverKey` 的抓题与落盘；关键回归用例已锁死。
- 整卷预览 / 单题翻页两种考试形态；整卷答案表、单题逐题确认。
- React 工作台（扩展/油猴共用的页面内紧凑卡片）、扩展选项页。
- 网页版设置中心（第一代网页版浅色版式：顶栏 + 左侧配置分类 + 主卡片 + 三步向导 + 9 个预设卡片）：`https://cx-exam-ai-app.pages.dev/settings`，卡片右上角 ⚙ 直接打开。
- OpenAI 兼容 / Anthropic / Gemini 三种模型协议；fast / verify / vision 角色。
- 批量快答、按需复核、单题超时与失败拆批。
- 本地配置、JSON 导入导出、AES-GCM 云同步、旧版同步码迁移。
- 扩展 package、油猴构建、Pages 站点与 `CFG_KV` 同步接口。

尚未包含（见 `docs/ROADMAP.md`）：

- 图片题直传视觉模型 / OCR、PDF 附件题干、`font-cxsecret` 字形解密。
- 焦点/可见性伪装与弹窗自动确认。
- 真实考试页的只读验收（等待你提供链接）。

## 目录

```text
apps/extension      MV3 扩展（content / background / options）
apps/userscript     篡改猴外壳与构建配置
apps/web-settings   网页版设置中心
packages/core       类型、答案引擎、模型接入、存储、云同步、诊断
packages/chaoxing   学习通考试页抓取、选项映射、落盘
packages/ui         React 工作台与设置组件
tests/              单元、DOM 夹具、端到端
functions/api/sync  Cloudflare Pages 配置同步接口
site/               Pages 落地页与配置说明
scripts/            站点/扩展打包脚本
docs/               架构、页面契约、测试说明
```

## 开发

```bash
npm install
npm run typecheck
npm test
npm run build
npm run smoke:userscript
npm run smoke:extension
```

构建产物：

- `apps/extension/dist/`：Chrome 扩展目录（开发者模式加载）。
- `apps/userscript/dist/cx-exam-ai.user.js`：篡改猴单文件脚本。
- `.site/`：设置中心与 landing page 的 Pages 发布目录。
- `release/cx-exam-ai-extension-v2.0.1.zip`：`npm run package:extension` 生成。

## 配置

- v2 配置默认存本机；可选加密云同步。
- 设置中心同时提供 JSON 导入/导出与旧版同步码导入。
- API Key 只保存在本地；云同步时只在客户端加密后上传密文，密钥不上传。

## 发布

- 扩展：GitHub Release zip，开发者模式加载；不上 Chrome Web Store。
- 油猴：Greasy Fork `605687`，脚本名保持不变，版本升到 `2.0.1`。
- 站点：Cloudflare Pages `cx-exam-ai-app.pages.dev`，KV 绑定 `CFG_KV`。

发布前请在 GitHub/Cloudflare 侧完成仓库改名、新建 Pages 项目与 KV 绑定；本仓库只准备代码和命令，不自动操作外部发布。
具体步骤见 `docs/RELEASE.md`。

## 许可

MIT。参考/移植的第三方代码与思路在 `NOTICE.md` 中注明。
