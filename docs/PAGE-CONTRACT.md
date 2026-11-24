# 学习通考试页契约

改选择器或落盘逻辑前先读这里。所有结论均来自旧版真机适配与参考项目公开经验，新增页面样本后应同步更新。

## 页面形态

| 形态 | 识别 | 说明 |
|---|---|---|
| 整卷预览 | `.questionLi` 数量 > 1，或 URL 含 `preview` | 一页多题，最适合整卷答案表 |
| 单题翻页 | `.questionLi` 数量 = 1，存在 `getTheNextQuestion(1)` | 每题保存后翻页 |
| 不允许预览 | 页面提示“本场考试已设置不允许整卷预览” | 只能走单题模式 |

v2 只处理考试页；作业 `dowork`、章节测验 `.TiMu` 不在范围内。

## 题目根

```html
<div class="questionLi" data="1234567">
  <input type="hidden" name="type1234567" value="0">
  <input type="hidden" id="answer1234567" value="">
  <h3 class="mark_name">1. 题干…</h3>
  <div class="stem_answer">…选项…</div>
</div>
```

- `qid`：根 `data` 的长数字；没有时读 `type{长数字}` / `answertype{长数字}`；单题页最后才读 `#questionId`。
- 题型：`typename` 属性、`type{qid}` 的值（0 单选 / 1 多选 / 3 判断 / 2、4… 文本）。

## 选项（最重要）

标准选项：

```html
<div class="answerBg" onclick="saveSingleSelect(this,'1234567')">
  <span class="num_option" data="D">A</span>
  <div class="answer_p">SYN</div>
</div>
```

- 页面显示字母来自 `span.num_option` 的**文本**。
- 服务端键来自 `span.num_option` 的 `data`。
- `randomOptions=true` 时两者可以不同；**一切按文本/服务端键匹配，不能按 DOM 位置**。
- 判断题 `data="true"/"false"`，显示“对/错”；隐藏域也是 `true/false`。
- 共用选项题选项是 `span[choice_name="A"]`；键就是 `choice_name`。
- 复合题选项行是 `.hoverDiv`，不是 `.answerBg`。
- 选项嵌套必须去重：`.answerBg` 包着 `.answer_p`/`.textDIV`，不去重会把 4 个选项读成 8 个。

## 隐藏域

- 选择题：`#answer{qid}` / `[name=answer{qid}]` / `[name=answers{qid}]`。
- 多选值可能是 `AB`、`A,B`、`["A","B"]`；判断题是 `true/false`。
- 填空题/简答：隐藏域可能是 HTML 文本，需要去标签。
- 保存是客户端到服务端的异步请求；“点击后 DOM 看着选中”不等于落库。v2 至少读隐藏域；提交前可点“刷新复核”以服务端渲染值为准。

## 翻页与预览

- 预览入口：`topreview()` 或文本“整卷预览”。
- 下一题：`getTheNextQuestion(1)`；不要抓成 `(-1)` 的上一题。
- 单题页的 `submitForm` 是全局单把手；失败/快速连点可能互相 abort。v2 串行动作 + 静默等待。

## 禁止事项

- 禁止用选项 DOM 位置直接当答案键。
- 禁止在未确认 `qid`/题干指纹时落盘。
- 禁止用坐标点击兜底。
- 禁止自动交卷。

## 2026-11-25 真机实测补充（exam-ans 单题）

- 页面标题在 `.h2_subject`；倒计时在 `#timer`，格式 `1409' 30''`。
- 总题量读“题量: N”；题号导航 `#topicNumberScroll li[data-asq]`：`.active` 是已答，`.current` 是当前题，`data-asq` 是题号。单题页的 `currentNumber` 从 URL `start + 1` 读。
- **全局 `#type=0` 是干扰项**：每题题型只在 `input[name="type{qid}"]`（或 `typeName{qid}`）；Q15 多选题若误读全局值会被当成单选。
- 标准选项行是 `.answerBg`，内部 `span.addChoice.choice{qid}.num_option[data]` 只是字母和键；不能把 span 当选项行，否则文本只剩 A/B/C/D。
- `getTheNextQuestion(1)` / `getTheQuestionByStart(n)` 都会先 `submitForm` 再跳转；单题模式没有安全的“只读翻完整卷”路径，v2 采用逐题确认 → 填写 → 下一题。
- 填空 Q22：UEditor 的隐藏 textarea 是 `#answerEditor{qid}{n}`，位于 `.edui-editor` 内；隐藏域 `#answer{qid}` 初值可能是 `"0"`，必须按未作答处理。写入要 `UE.getEditor(id).setContent(html,false)` + `sync()`。
- 简答 Q23：编辑器实例 id 可能是 `answer{qid}`，页面只有 iframe `#ueditor_0`，没有 textarea；按 qid/容器查找 UEditor 实例再 sync。
