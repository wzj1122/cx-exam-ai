# 架构说明

## 分层

```text
apps/extension      MV3 content script / service worker / options
apps/userscript     GM adapter / Shadow DOM compact card / userscript build
packages/ui         React 工作台与设置组件（无 DOM 抓取逻辑）
packages/chaoxing   学习通考试页适配：抓题、选项映射、落盘
packages/core       领域类型、答案引擎、模型接入、存储、云同步
```

依赖方向：`apps -> ui -> core`，`apps -> chaoxing -> core`。`core` 不依赖 React，也不直接依赖学习通 DOM。

## 三个答案空间

这是 v2 最重要的不变量：

| 空间 | 来源 | 用途 |
|---|---|---|
| `displayLabel` | `span.num_option` 文本、选项前缀 | 用户看到的 A/B/C |
| `serverKey` | `span[data]`、`choice_name`、`true/false` | 页面实际提交、隐藏域回读 |
| `element` | 真实 DOM 节点 | 点击目标 |

模型 Prompt 只看到内部 ID `O1…On` 和选项文本，不回答 A/B/C。回填时：

```text
模型 optionId -> QuestionSnapshot.options[].serverKey -> element
```

隐藏域回读也先映射回 optionId，再比较集合。这样 `randomOptions=true` 时“页面显示 A、服务端键 B”不会点错。

## 落盘协议

`ChaoxingAdapter.apply(plan)` 的固定顺序：

1. 重新 snapshot，按 `questionId` 找题。
2. 比对 `fingerprint`（qid + 题型 + 题干 + 选项文本/键 + 图片）。不一致立即 `QUESTION_CHANGED`。
3. 读隐藏域，解析当前 optionId 集合；没有隐藏域才退回 DOM 选中态。
4. 计算差量：只补缺、只取消多余。
5. 单动作执行；点击后轮询状态，超时只允许对**同一选项**换一个明确节点重试一次。
6. 等待页面保存静默期；重新 snapshot，按集合比较最终答案。
7. 任何不符立即返回失败，不换别的选项猜着点。

禁止的兜底：

- 用 `elementFromPoint` 点“命中的任意元素”；
- 点任意父容器；
- 对任意全局函数盲调；
- 首次失败后换另一个选项重试。

页面函数白名单仅在“点击行内 onclick 已失效”时使用，且必须知道签名（如 `saveSingleSelect(row, qid)`）。

## 答案引擎

1. `fast` 模型先答；纯文本客观题按题数/字符数分批（默认 8–12 题、约 6000 字符）。
2. 批量返回缺项或 JSON 无效 -> 二分拆批，最小拆到单题。
3. 低置信度、键歧义、复核分歧才调用 `verify`；最多一次 verifier + 一次 arbiter。
4. 单选/判断如果模型返回多个 ID，只保留第一个并标风险。
5. 风险题默认不进入“一键填写”勾选集合。
6. 永不自动交卷。

## 外壳

- 扩展：content script 做 DOM、状态与页面内紧凑卡片；service worker 做跨域 fetch。
- 油猴：GM_xmlhttpRequest 走网络；React 挂到 Shadow DOM 紧凑卡片；GM 存储与 localStorage 回退。
- 两端 UI 组件相同，差别只在 transport 与 controller（本地 vs 远程）。

## 配置与同步

- 本机存储优先；云同步为可选双轨。
- 同步码 `id.key`，AES-GCM 加密，密钥不上传；服务端只存密文和 HMAC 写令牌。
- 旧版同步码可通过 `SyncClient.importLegacy` 从 `cx-exam-ai.pages.dev` 拉取，映射 provider/阈值后写入 v2 配置。
