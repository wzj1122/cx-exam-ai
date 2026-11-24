# 发布 Runbook

外部仓库改名、Cloudflare 部署、Greasy Fork 发布和 GitHub Release 都属于不可逆/对外可见操作，执行前需要用户明确确认。本仓库只准备代码与命令。

## 1. 仓库切换

```bash
# 旧仓库：确认工作区干净后打 tag
git tag v1.12.0
git push origin v1.12.0
```

在 GitHub 设置中：

1. 把 `wzj1122/cx-exam-ai` 改名为 `wzj1122/cx-exam-ai-legacy`。
2. Archive 旧仓库（或至少停止新功能）。
3. 新建 `wzj1122/cx-exam-ai`，把本目录推为 `main`。
4. 确认旧链接重定向与新仓库 README/Pages 链接。

## 2. Cloudflare Pages + KV

```bash
npx wrangler login
npx wrangler kv namespace create CFG_KV
# 把返回的 id 填进 wrangler.jsonc
npm run build
npx wrangler pages project create cx-exam-ai-app --production-branch main
npx wrangler pages deploy .site --project-name cx-exam-ai-app --branch main
```

部署后检查：

- `https://cx-exam-ai-app.pages.dev/` 能打开落地页。
- `https://cx-exam-ai-app.pages.dev/dist/cx-exam-ai.user.js` 能下载脚本。
- `https://cx-exam-ai-app.pages.dev/api/sync/<id>` 的 GET/PUT 与 `CFG_KV` 正常。

## 3. 油猴脚本

1. 打开 Greasy Fork 条目 `605687`。
2. 把脚本源地址改为新仓库 `apps/userscript/dist/cx-exam-ai.user.js` 的 raw 地址，或直接粘贴构建产物。
3. 版本保持 `2.0.0`，名称保持 `CX 考试 AI 大脑 · 学习通考试自动答题`。
4. 更新说明必须写明：v2 仅支持考试页；作业/刷课不在范围内；默认半自动，风险题不填，不自动交卷。
5. 发布后从 `https://update.greasyfork.org/scripts/605687/...user.js` 回读 `@version`，确认是 `2.0.0`。

## 4. Chrome 扩展

```bash
npm run package:extension
# 生成 release/cx-exam-ai-extension-v2.0.0.zip
```

在 GitHub Release：

- tag `v2.0.0`；
- 上传 zip；
- Release notes 写明加载方式：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序；不上 Chrome Web Store。

## 5. 发布后检查

- 扩展：加载 zip 解压目录，打开模拟考试页看到 CX 悬浮球；点球出现 404px 紧凑卡片，选项页能打开。
- 油猴：在 Tampermonkey 安装 v2，打开模拟考试页点球出现紧凑卡片。
- 配置：添加一个模型 → 测试连通 → 生成同步码 → 另一浏览器拉取。
- 回归：`npm run typecheck && npm test && npm run build && npm run smoke:userscript && npm run smoke:extension`。
- 真实考试：只用你提供的只读链接做抓题/dry-run，不点击、不提交。
