# 项目规则

## 仓库结构

这是 **CX 考试 AI 大脑**（超星学习通考试自动答题油猴脚本）的正式仓库：`wzj1122/cx-exam-ai`。

| 文件 / 目录 | 用途 | 能否修改/删除 |
| :--- | :--- | :--- |
| `src/00-header.js` | UserScript 元数据（`@version` / `@match` / `@grant` / `@updateURL`） | 可修改（版本升级时同步），不可删除 |
| `src/01-core.js` ~ `src/08-main.js` | 按编号顺序拼接的源码模块 | 可修改，不可删除 |
| `build.js` | 零依赖打包器 | 可修改，不可删除 |
| `dist/cx-exam-ai.user.js` | 构建产物，唯一交付物 | **只由 `node build.js` 生成，不手改** |
| `package.json` | 版本号、scripts、仓库元信息 | 可修改（版本号必须与 `00-header.js` 一致） |
| `README.md` | 面向使用者的说明（安装 / 使用 / 更新日志） | 可修改（功能变化时同步更新），不可删除 |
| `MAINTENANCE.md` | 维护手册（文件用途清单 / 数据流 / 变更记录） | 可修改，不可删除 |
| `index.html` | Cloudflare Pages 落地页与一键安装入口 | 可修改，不可删除 |
| `images/alipay.png` `images/wechat_pay.png` | 收款码 | 不可修改/删除 |
| `wrangler.jsonc` | Cloudflare Workers 静态资源部署配置（`assets.directory: "./.site"`，**不可改成 "./"**） | 可修改（改部署方式时），不可删除 |
| `LICENSE` | MIT 许可证 | 不可修改/删除 |
| `tools/*.js` | 自检、离线测试、CDP 调试工具 | 可修改，不可删除 |
| `CLAUDE.md` | 本规则文件 | 可修改，不可删除 |

**禁止提交**：`logs/`、`.watch.log`、`.watch.out`、`.chrome.log`、`.shot-*.png`、`.cdp-profile/`、`.chrome-profile/`、`.tmp-ocsjs/`（已写入 `.gitignore`，别用 `git add -f` 绕过）。

## 发布规则

### 正式发布流程

1. 改 `src/`，同步改 `src/00-header.js` 的 `@version` 与 `package.json` 的 `version`（两处必须一致）
2. `node build.js` 重建 `dist/cx-exam-ai.user.js`
3. `node tools/check.js` + `node tools/test-dom.js` 全绿
4. 更新 `README.md` 的更新日志与 `MAINTENANCE.md` 的变更记录
5. Commit + Push 到 `main`（Greasy Fork 从 `main` 同步，推送即触发）
6. 需要时创建 GitHub Release（tag 形如 `v1.7.0`）

### 版本号约定

- `MAJOR.MINOR.PATCH`。功能新增走 `MINOR`，纯修复走 `PATCH`。
- 版本号唯一来源是 `src/00-header.js` 的 `@version` 与 `package.json`；`dist` 里的 `CXAI.__version` 由构建脚本注入，不要手改。

## 推送规则

- 本仓库 `main` 分支始终是**可发布版本**，构建产物必须与源码同步（不能只推源码不推 `dist`）。
- 实验性改动先在分支上验证，确认通过自检与离线测试后再合入 `main`。
- 不提交任何 API Key、Cookie、考试账号信息或抓包得到的个人数据。

## 禁止操作

- 不要手改 `dist/cx-exam-ai.user.js`（会被下次构建覆盖）
- 不要删除 `dist/` 目录（三处一键安装链接都指向它）
- 不要删除 `index.html` 或 `images/`（Pages 落地页依赖）
- 不要修改 `LICENSE`
- Greasy Fork 建档拿到 `SCRIPT_ID` 后，必须在 `src/00-header.js` 补上 `@updateURL` / `@downloadURL`（自动更新依赖）；在此之前不要写占位 ID
- 不要把 `.cdp-profile/` 等浏览器用户数据目录推到远端（含登录态 Cookie）
