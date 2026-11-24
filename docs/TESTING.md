# 测试说明

## 命令

```bash
npm run typecheck
npm test
npm run build
npm run smoke:userscript
npm run smoke:extension
```

- `npm test`：Vitest + jsdom，覆盖抓题、选项映射、落盘、答案引擎、云同步。
- `smoke:userscript`：用 Playwright 在本地模拟考试页注入构建后的油猴脚本，验证紧凑卡片/选项/服务端键渲染。
- `smoke:extension`：用 Playwright 自带 Chromium 加载 MV3 扩展，验证 content script 悬浮球、紧凑卡片与 options 页面能启动。
- 网页设置中心：本地静态服务 `.site`，打开 `/settings`，确认模型/同步页渲染。

## 真实页面 CDP

```bash
npm run build:userscript
CX_SHOT=/tmp/exam.png node tools/live-inject.mjs "考试 URL"
```

脚本连接本机 `127.0.0.1:9222` 的真实 Chrome，把 v2 油猴脚本注入当前/指定考试页；`GM_xmlhttpRequest` 通过 Node fetch 代理，避免页面 CORS。只注入 UI 与抓题，不会提交考试。

## 必测回归

1. `displayLabel=A / serverKey=D`、`displayLabel=B / serverKey=A` 的随机选项页；模型答 `O2` 时只点服务端键 `A` 的选项。
2. 正确选项已选中 -> 零点击。
3. 多选 `AC -> AB`：只取消 `C`、只补 `B`，不重复点 `A`。
4. 空答案禁止清空页面选项。
5. 题干/选项变化 -> 中止，不点第二个选项。
6. 判断题 `true/false` 与文本“对/错”互相映射。
7. 批量 JSON 缺项/无效 -> 拆批/单题，不整卷重来。
8. 文本题写入 textarea 后回读。
9. 云同步加密往返 + 旧版同步码迁移。

## 真实页面

你提供的只读考试链接只做：

- `snapshotPaper()` 抓题；
- `ApplyPlan` dry-run 生成（不点击）；
- 与页面显示字母/服务端键核对。

填写行为只在 `tests/fixtures/*` 与本地 mock 上验证；不要在真实考试上做未确认的写入测试。

2026-11-25 真机已验证：单题模式 Q1/Q2 单选、Q15 多选、Q21 判断、Q22 UEditor 填空均真实落盘并通过隐藏域/生成结果校验；Q23 简答 UEditor 实例已能按 qid 找到，但未写入未经核实的答案。单题模式的 `getTheQuestionByStart/getTheNextQuestion` 会先保存当前题，因此不做“只读遍历整卷”；只做逐题确认流程。

## 性能目标

- 10 道纯文本题批量首答 p50 ≤ 6s、p90 ≤ 15s（取决于供应商）。
- 30 题首轮 ≤ 60s。
- 单题填写+校验 ≤ 2s（不含页面自身保存）。
- 单请求硬超时 ≤ 30s。
