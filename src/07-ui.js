/* ---------------- 控制台 UI（Shadow DOM 隔离，避免被页面 CSS 污染） ---------------- */

CXAI.UI = (function () {
  let host = null;

  /** 独立设置中心的默认地址（换部署位时改这里，或用配置项 ui.settingsURL 覆盖） */
  const DEFAULT_SETTINGS_URL = 'https://cx-exam-ai.pages.dev/settings.html';
  let root = null;
  let state = { running: false, paused: false, total: 0, done: 0, answered: 0, todo: 0, failed: 0, current: 0, pageKind: '-', providers: 0, qlist: [], pending: null, doneAll: false, mode: 'single' };

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
/* 细滚动条（浅色） */
* { scrollbar-width: thin; scrollbar-color: #c7cdd8 transparent; }
*::-webkit-scrollbar { width: 7px; height: 7px; }
*::-webkit-scrollbar-track { background: transparent; }
*::-webkit-scrollbar-thumb { background: #ccd2dd; border-radius: 7px; }
*::-webkit-scrollbar-thumb:hover { background: #b6bfcd; }
*::-webkit-scrollbar-corner { background: transparent; }

.wrap { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; font-size: 13px; color: #1f2430; }

/* 悬浮球：浅色、平时很淡，可拖 */
.ball { position: relative; width: 34px; height: 34px; border-radius: 50%;
  background: rgba(248,250,252,.5); border: 1px solid rgba(203,213,225,.4);
  color: #9aa3b2; display:flex; align-items:center; justify-content:center;
  font-size: 10px; font-weight: 600; letter-spacing:.3px; cursor: pointer;
  opacity: .26; transition: opacity .18s, background .18s, transform .12s, box-shadow .18s;
  user-select:none; touch-action:none; box-shadow: 0 2px 8px rgba(16,24,40,.08); }
.ball:hover { opacity: .9; background:rgba(255,255,255,.95); color:#2563eb; border-color:#cbd9f2; box-shadow: 0 3px 10px rgba(37,99,235,.12); }
.ball.busy { opacity: .4; }
.ball.busy::after { content:''; position:absolute; right:4px; top:4px; width:6px; height:6px; border-radius:50%; background:#16a34a; }
/* 长按后弹出的手势提示（球上方） */
.gmode { position:absolute; right:4px; bottom:44px; background:#fff; border:1px solid #e5e8ee; border-radius:9px;
  box-shadow:0 8px 22px rgba(16,24,40,.12); padding:5px; display:none; flex-direction:column; gap:2px;
  font-size:11px; color:#6b7280; white-space:nowrap; z-index:2; }
.gmode.show { display:flex; }
.gmode .g { padding:4px 9px; border-radius:6px; transition:.12s; }
.gmode .g.on { background:#eaf1ff; color:#2563eb; font-weight:600; }
.gtoast { position:absolute; right:0; bottom:44px; background:#111827; color:#fff; font-size:11px; line-height:1.4;
  padding:4px 9px; border-radius:7px; opacity:0; transform:translateY(5px); transition:.18s; pointer-events:none;
  white-space:nowrap; z-index:3; }
.gtoast.show { opacity:.9; transform:translateY(0); }

/* 运行/结束时球本身变淡绿并显示数字或 OK（不再额外加一个小圆） */
.ball.running { background: rgba(220,252,231,.46); border-color: rgba(167,243,208,.5); color: #62a987; opacity: .42; }
.ball.running #balllabel { font-size: 11px; }
.ball.done { background: rgba(220,252,231,.62); border-color: rgba(167,243,208,.6); color: #4f9e72; opacity: .5; }
.ball.done #balllabel { font-size: 10px; letter-spacing: .5px; }
.ball.dragging { opacity: 1; cursor: grabbing; transform: scale(1.05); }

.panel { position:absolute; right:0; bottom:44px; width: 404px; max-height: 76vh; background:#fff; border:1px solid #e5e8ee;
  border-radius: 12px; box-shadow: 0 16px 44px rgba(16,24,40,.16); display:none; flex-direction:column; overflow:hidden; }
.panel.show { display:flex; }
.hd { padding:10px 12px; background:#f7f8fb; border-bottom:1px solid #e8ebf1; display:flex; align-items:center; gap:8px; }
.hd .t { font-weight:600; font-size:13px; color:#111827; flex:1; }
.hd .x { cursor:pointer; color:#7b8494; padding:5px 9px; font-size:17px; line-height:1;
  border-radius:7px; transition:background .15s, color .15s; user-select:none; }
.hd .x:hover { color:#2563eb; background:#eef4ff; }
.hd .x.close:hover { color:#dc2626; background:#fdeeee; }
.stat { display:grid; grid-template-columns:repeat(4,1fr); gap:1px; background:#e8ebf1; }
.stat div { background:#fff; padding:7px 6px; text-align:center; }
.stat b { display:block; font-size:15px; color:#2563eb; font-weight:700; }
.stat span { font-size:11px; color:#8a93a3; }
.bar { display:flex; gap:5px; padding:8px 10px; border-bottom:1px solid #e8ebf1; }
button.b { flex:1; padding:6px 0; border-radius:7px; border:1px solid #dde2ea; background:#fff; color:#374151;
  cursor:pointer; font-size:11.5px; transition:.15s; }
button.b:hover { background:#f5f7fb; border-color:#c8d2e0; color:#111827; }
button.b.primary { background:linear-gradient(135deg,#3b82f6,#6366f1); border:none; color:#fff; font-weight:600; box-shadow:0 2px 8px rgba(59,130,246,.24); }
button.b.danger { color:#dc2626; border-color:#f0c9c9; background:#fff7f7; }
button.b:disabled { opacity:.45; cursor:not-allowed; box-shadow:none; }

/* 题号格子：颜色即状态 */
.qgrid { display:grid; grid-template-columns:repeat(auto-fill, minmax(36px,1fr)); gap:6px;
  padding:9px 10px; max-height:138px; overflow-y:auto; overflow-x:hidden;
  border-bottom:1px solid #e8ebf1; background:#fafbfd; }
.qcard { height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center;
  font-size:12px; font-weight:600; cursor:pointer; border:1px solid #e2e7ef; background:#fff; color:#6b7280;
  transition:.15s; user-select:none; overflow:hidden; }
.qcard:hover { border-color:#bcd0f5; color:#2563eb; background:#f6f9ff; }
.qcard.ok { background:#eaf8ef; border-color:#bfe6cd; color:#15803d; }
.qcard.no { background:#fdf6e3; border-color:#f0e0b8; color:#a16207; }
.qcard.err { background:#fdeeee; border-color:#f3c9c9; color:#b91c1c; }
.qcard.wait { background:#fef7e6; border-color:#f2dfae; color:#b45309; }
.qcard.cur { box-shadow: 0 0 0 2px #2563eb inset; }
.qcard.sel { box-shadow: 0 0 0 2px #2563eb, 0 0 0 4px rgba(37,99,235,.14); }

.qdetail { flex:1; min-height:110px; overflow-y:auto; overflow-x:hidden; padding:9px 12px 10px; background:#fff; }
.qd-hd { display:flex; align-items:center; gap:6px; margin-bottom:6px; }
.qd-hd .qn { font-weight:700; color:#2563eb; font-size:13px; }
.qd-hd .tag { font-size:10px; padding:1px 5px; border-radius:4px; background:#eef2f9; color:#5b6b86; }
.qd-hd .st { font-size:10px; padding:1px 5px; border-radius:4px; margin-left:auto; }
.qd-hd .st.ok { background:#eaf8ef; color:#15803d; }
.qd-hd .st.no { background:#fdf6e3; color:#a16207; }
.qd-hd .st.err { background:#fdeeee; color:#b91c1c; }
.qd-hd .st.wait { background:#fef7e6; color:#b45309; }
.qd-hd .st.todo { background:#f4f5f7; color:#6b7280; }
.qd-jump { font-size:10px; color:#2563eb; cursor:pointer; padding:1px 5px; border:1px solid #cfe0fb; border-radius:4px; background:#f6f9ff; }
.qd-jump:hover { background:#e9f1ff; }
.qd-stem { font-size:12px; color:#1f2937; line-height:1.6; margin-bottom:7px; word-break:break-word; }
.qd-opts { list-style:none; margin:0 0 8px; padding:0; }
.qd-opts li { display:flex; gap:6px; font-size:11.5px; color:#4b5563; padding:3px 4px; line-height:1.5; word-break:break-word; border-radius:5px; }
.qd-opts li b { flex:none; width:16px; height:16px; border-radius:4px; background:#f1f3f7; color:#6b7280; font-size:10px;
  display:flex; align-items:center; justify-content:center; font-weight:700; margin-top:1px; }
.qd-opts li.ai { background:#f2f7ff; }
.qd-opts li.ai b { background:#2563eb; color:#fff; }
.qd-opts li.pg { background:#f1faf4; color:#166534; }
.qd-opts li.pg b { background:#15803d; color:#fff; }
.qd-meta { border-top:1px dashed #e5e8ee; padding-top:7px; display:flex; flex-direction:column; gap:5px; }
.qd-meta .kv { display:flex; align-items:baseline; gap:6px; flex-wrap:wrap; }
.qd-meta .k { flex:none; min-width:52px; font-size:10.5px; color:#8a93a3; }
.qd-meta .v { font-size:11.5px; font-weight:600; color:#111827; word-break:break-word; line-height:1.5; }
.qd-meta .v.ai { color:#2563eb; }
.qd-meta .v.pg { color:#15803d; }
.qd-meta .v.muted { font-weight:400; color:#8a93a3; }
.qd-meta .chip { font-size:10px; line-height:15px; padding:0 5px; border-radius:4px; color:#5b6b86;
  background:#f4f6fa; border:1px solid #e3e8f0; flex:none; }
.qd-meta .chip.ok { color:#15803d; background:#eaf8ef; border-color:#bfe6cd; }
.qd-meta .chip.bad { color:#b91c1c; background:#fdeeee; border-color:#f3c9c9; }
.qempty { padding:16px 12px; color:#9aa3b2; font-size:11.5px; text-align:center; line-height:1.6; }

.logs { flex:0 0 auto; max-height:0; overflow:hidden; transition:max-height .2s; background:#fff; }
.logs.show { max-height: 148px; overflow-y:auto; border-top:1px solid #e8ebf1; }
.lg { padding:2px 12px; font-size:11px; color:#5b6472; line-height:1.55; font-family:ui-monospace,Menlo,monospace; }
.lg.warn { color:#b45309; } .lg.error { color:#dc2626; } .lg.ok { color:#15803d; }
.q { padding:8px 12px; border-bottom:1px solid #f0f2f6; }
.q .h { display:flex; gap:6px; align-items:baseline; }
.q .idx { color:#8a93a3; font-size:11px; min-width:22px; }
.q .tag { font-size:10px; padding:1px 5px; border-radius:4px; background:#eef2f9; color:#5b6b86; }
.q .ans { margin-left:auto; font-weight:700; color:#15803d; font-size:13px; }
.q .ans.low { color:#b45309; }
.q .ans.err { color:#dc2626; }
.q .stem { color:#4b5563; font-size:11.5px; margin:3px 0 0 28px; line-height:1.5; word-break:break-word; }
.q .meta { margin-left:28px; font-size:10.5px; color:#8a93a3; margin-top:2px; }
.q .meta em { color:#2563eb; font-style:normal; }
.ft { padding:6px 12px; border-top:1px solid #e8ebf1; font-size:10.5px; color:#8a93a3; display:flex; align-items:center; gap:10px; background:#f7f8fb; }
.ft .lg-toggle { margin-left:auto; cursor:pointer; color:#8a93a3; padding:1px 5px; border-radius:4px; }
.ft .lg-toggle:hover { color:#2563eb; background:#eef4ff; }
.ft .ftstate { margin-left:0; }

/* 设置层 */
.mask { position:fixed; inset:0; background:rgba(17,24,39,.32); backdrop-filter: blur(1.5px); display:none; z-index:10; }
.mask.show { display:block; }
.dlg { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); width:min(820px,94vw); height:min(660px,88vh);
  background:#fff; border:1px solid #e5e8ee; border-radius:12px; display:flex; flex-direction:column; overflow:hidden;
  box-shadow:0 24px 64px rgba(16,24,40,.22); }
.dlg .dh { padding:11px 14px; font-weight:600; font-size:13px; color:#111827; border-bottom:1px solid #e8ebf1;
  display:flex; align-items:center; background:#f7f8fb; }
.dlg .dh .x { margin-left:auto; cursor:pointer; color:#9aa3b2; }
.dlg .dh .x:hover { color:#2563eb; }
.dbody { flex:1; display:flex; min-height:0; }
.dnav { width:126px; flex:none; border-right:1px solid #eaedf3; background:#fafbfd; padding:10px 8px; display:flex; flex-direction:column; gap:3px; overflow-y:auto; }
.navhd { font-size:10px; color:#a3abb9; padding:2px 10px 7px; letter-spacing:.5px; }
.ntab { display:flex; align-items:center; gap:7px; padding:8px 10px; border-radius:8px; font-size:12px; color:#5b6472;
  cursor:pointer; user-select:none; transition:.15s; }
.ntab:hover { background:#f1f4f9; color:#111827; }
.ntab.on { background:#eaf1ff; color:#2563eb; font-weight:600; box-shadow: inset 3px 0 0 #2563eb; }
.ntab .ic { font-size:12px; opacity:.85; width:14px; text-align:center; }
.dlg .db { flex:1; min-width:0; overflow-y:auto; overflow-x:hidden; padding:12px 14px; background:#fff; }
.dlg .df { padding:9px 14px; border-top:1px solid #e8ebf1; display:flex; gap:8px; background:#f7f8fb; }
.tabs { display:flex; gap:2px; border-bottom:1px solid #e8ebf1; margin:-2px 0 10px; background:#fff; }
.tab { padding:7px 12px; font-size:12px; color:#6b7280; cursor:pointer; border-radius:7px 7px 0 0; }
.tab:hover { color:#111827; background:#f4f6fa; }
.tab.on { color:#2563eb; background:#eef4ff; }
.pane { display:none; }
.pane.show { display:block; }
.testout { margin-top:7px; padding:8px 10px; background:#fafbfd; border:1px solid #e6eaf1; border-radius:8px;
  font-family:ui-monospace,Menlo,monospace; font-size:11px; color:#5b6472; line-height:1.7;
  max-height:150px; overflow-y:auto; white-space:pre-wrap; word-break:break-word; }
.testout .ok { color:#15803d; } .testout .bad { color:#dc2626; } .testout .mid { color:#b45309; }

.fld { margin-bottom:9px; }
.fld label { display:block; font-size:11px; color:#6b7280; margin-bottom:3px; }
.fld input[type=text], .fld input[type=password], .fld input[type=number], .fld select, .fld textarea {
  width:100%; background:#fff; border:1px solid #dde2ea; color:#111827; border-radius:7px; padding:6px 8px; font-size:12px; outline:none; transition:.15s; }
.fld input:hover, .fld select:hover, .fld textarea:hover { border-color:#c8d2e0; }
.fld input:focus, .fld select:focus, .fld textarea:focus { border-color:#2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.12); }
.withbtn { display:flex; gap:6px; align-items:center; }
.withbtn input { flex:1; min-width:0; }
.mini { flex:0 0 auto; padding:5px 9px; font-size:11px; border-radius:6px; border:1px solid #dde2ea; background:#fff; color:#4b5563; cursor:pointer; }
.mini:hover { border-color:#2563eb; color:#2563eb; background:#f6f9ff; }
.mini[disabled] { opacity:.55; cursor:default; }
#mpop { position:fixed; display:none; background:#fff; border:1px solid #dfe4ec; border-radius:9px; box-shadow:0 14px 36px rgba(16,24,40,.18); overflow:hidden; }
#mpop .mph { display:flex; gap:6px; align-items:center; padding:7px 8px; border-bottom:1px solid #e8ebf1; }
#mpop .mpf { flex:1; min-width:0; background:#fff; border:1px solid #dde2ea; border-radius:6px; color:#111827; font-size:12px; padding:5px 7px; }
#mpop .mpc { font-size:11px; color:#8a93a3; white-space:nowrap; }
#mpop .mpl { max-height:262px; overflow-y:auto; padding:4px; }
#mpop .mi { padding:5px 8px; font-size:12px; color:#374151; border-radius:6px; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#mpop .mi:hover { background:#f1f5fb; color:#111827; }
#mpop .mi.on { background:#eaf1ff; color:#2563eb; }
#mpop .mi-empty { padding:10px; font-size:12px; color:#8a93a3; }

/* 模型折叠卡 */
.pv { border:1px solid #e6eaf1; border-radius:10px; margin-bottom:7px; background:#fff; overflow:hidden; transition:border-color .15s, box-shadow .15s; }
.pv:hover { border-color:#cfd8e5; }
.pv .fld { margin-bottom:6px; }
.pv .row2 { gap:7px; }
.pv .ph { display:flex; align-items:center; gap:8px; padding:0 11px; height:38px; cursor:pointer; margin:0; }
.pv .ph:hover { background:#f7f9fc; }
.pv[data-open="1"] { border-color:#c9d8f2; box-shadow:0 2px 10px rgba(37,99,235,.07); }
.pv[data-open="1"] .ph { background:#f7f9fc; }
.pv .dot { width:7px; height:7px; border-radius:50%; background:#16a34a; flex:none; }
.pv.off .dot { background:#c7cdd8; }
.pv .nm { font-size:12px; font-weight:600; color:#111827; flex:none; min-width:50px; line-height:1; }
.pv .pm { flex:1; min-width:0; font-size:11.5px; line-height:1; color:#2563eb; font-family:ui-monospace,Menlo,monospace;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pv .chipx { flex:none; font-size:10px; line-height:15px; padding:0 5px; border-radius:4px;
  color:#5b6b86; background:#f2f5fa; border:1px solid #e3e8f0; }
.pv .ph .del { flex:none; color:#dc2626; font-size:11px; line-height:1; padding:4px 6px; border-radius:5px; }
.pv .ph .del:hover { background:#fdeeee; }
/* 行头里的复选框必须是一行内的小控件，不能继承 .fld label 的块级/间距 */
.pv .ph label.chk { display:inline-flex; align-items:center; gap:4px; margin:0; padding:0;
  font-size:11px; line-height:1; color:#4b5563; white-space:nowrap; flex:none; }
.pv .ph label.chk input { width:13px; height:13px; margin:0; accent-color:#2563eb; vertical-align:middle; }
.pv .ph .dot, .pv .ph .chipx { margin-top:0; }
.pv .pbody { display:none; padding:8px 10px 10px; border-top:1px solid #eef1f6; background:#fcfdff; }
.pv[data-open="1"] .pbody { display:block; }
.addrow { width:100%; padding:8px 0; border-radius:9px; border:1px dashed #cfd8e5; background:#fafbfd;
  color:#5b6472; font-size:12px; cursor:pointer; }
.addrow:hover { border-color:#2563eb; color:#2563eb; background:#f5f9ff; }
.pvbar { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
.pvbar .t { font-size:12px; color:#4b5563; flex:1; }
.pvbar .mini { flex:none; }

details.adv { border-top:1px solid #e8ebf1; margin-top:8px; padding-top:6px; }
details.more { margin-top:6px; border-top:1px dashed #e8ebf1; padding-top:2px; }
details.adv > summary, details.more > summary { cursor:pointer; font-size:11px; color:#6b7280; padding:5px 0; list-style:none; user-select:none; }
details.adv > summary:hover, details.more > summary:hover { color:#2563eb; }
details.adv > summary::-webkit-details-marker, details.more > summary::-webkit-details-marker { display:none; }
details.adv > summary::before, details.more > summary::before { content:'▸ '; }
details.adv[open] > summary::before, details.more[open] > summary::before { content:'▾ '; }
details.adv[open] > summary, details.more[open] > summary { margin-bottom:6px; }
.row2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.row3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; }
.chk, .fld label.chk { display:flex; align-items:center; gap:5px; font-size:11.5px; color:#4b5563; margin-bottom:0; }
.fld label.chk { margin-top:5px; }
.help { font-size:10.5px; color:#8a93a3; line-height:1.6; margin-top:2px; }
.pv .mhint { font-size:10.5px; color:#8a93a3; }
.tagv { display:inline-block; font-size:9.5px; padding:1px 4px; border-radius:3px; background:#eef4ff; color:#2563eb; margin-left:4px; }
`;
  /* ---------------- 结构 ---------------- */

  function template() {
    return `
<div class="wrap">
  <div class="panel" id="panel">
    <div class="hd">
      <div class="t">CX 考试 AI 大脑</div>
      <div class="x cfg" data-act="cfg" title="设置">⚙</div>
      <div class="x close" data-act="hide" title="收起面板">✕</div>
    </div>
    <div class="stat">
      <div><b id="s-total">0</b><span>题目</span></div>
      <div><b id="s-done">0</b><span>已答</span></div>
      <div><b id="s-todo">0</b><span>未答</span></div>
      <div><b id="s-model">0</b><span>模型</span></div>
    </div>
    <div class="bar">
      <button class="b primary" data-act="next" title="答下一道还没答的题">答一题</button>
      <button class="b" data-act="run" title="从头连答到底">自动连答</button>
      <button class="b" data-act="pause">暂停</button>
      <button class="b danger" data-act="stop">停止</button>
    </div>
    <div class="qgrid" id="qgrid"></div>
    <div class="qdetail" id="qdetail"></div>
    <div class="logs" id="logs"></div>
    <div class="ft">Ctrl+Shift+X 呼出/隐藏<span class="lg-toggle" data-act="logs" title="展开/收起日志">日志</span><span id="s-state" class="ftstate">待机</span></div>
    <div class="mask" id="mask">
      <div class="dlg">
        <div class="dh">设置<div class="x" data-act="cfg-close">✕</div></div>
        <div class="dbody">
          <div class="dnav" id="cfg-nav">
            <div class="navhd">分类</div>
            <div class="ntab on" data-act="tab" data-tab="model"><span class="ic">◈</span>模型</div>
            <div class="ntab" data-act="tab" data-tab="judge"><span class="ic">◉</span>判题</div>
            <div class="ntab" data-act="tab" data-tab="run"><span class="ic">▷</span>运行</div>
            <div class="ntab" data-act="tab" data-tab="bak"><span class="ic">⇅</span>备份</div>
          </div>
          <div class="db" id="cfg-body"></div>
        </div>
        <div class="df">
          <button class="b" data-act="cfg-page" title="在独立网页里配置，同一份配置，改完考试页直接生效">独立设置页 ↗</button>
          <button class="b" data-act="cfg-test">测试连接</button>
          <button class="b primary" data-act="cfg-save">保存</button>
        </div>
      </div>
    </div>
  </div>
  <div class="gmode" id="gmode">
    <div class="g" data-dir="left">← 左滑：答一题</div>
    <div class="g" data-dir="up">↑ 上滑：自动连答</div>
  </div>
  <div class="gtoast" id="gtoast"></div>
  <div class="ball" id="ball"><span id="balllabel">CX</span></div>
</div>`;
  }

  function mount() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'cx-ai-host';
    host.style.cssText = 'position:fixed;z-index:2147483000;';
    (document.body || document.documentElement).appendChild(host);
    root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
    const box = document.createElement('div');
    box.innerHTML = template();
    root.appendChild(box);
    // 设置窗必须挂在 shadow 根上：它原先嵌在 .wrap/.panel 里，panel 收起时 display:none，
    // 展开时又被 46px 宽的 wrap 夹住，导致整块 0×0 点不到。
    const maskEl = box.querySelector('#mask');
    if (maskEl && maskEl.parentElement && maskEl.parentElement.id === 'panel') {
      root.appendChild(maskEl);
    }
    bind();
    setupBall();
    render();

  }

  /** 卸掉整个界面（交卷/离开作答页时用）：节点移除，引用清空，之后可再 mount */
  function unmount() {
    try {
      if (host && host.parentNode) host.parentNode.removeChild(host);
    } catch (e) {}
    host = null;
    root = null;
  }

  const $ = (sel) => (root ? root.querySelector(sel) : null);

  function bind() {
    root.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'ball') return; // 悬浮球的单击由 setupBall 处理（要和拖动区分）
      // 事件目标常常是行内的子节点（模型名、图标、文字），直接读 e.target 的 data-act
      // 会读不到 —— 表现就是"有时点得开、有时点不开"：点在空隙能开，点在文字上没反应。
      // 统一往上找最近一个带 data-act 的祖先。
      const actEl = e.target.closest ? e.target.closest('[data-act]') : null;
      const act =
        (e.target.getAttribute && e.target.getAttribute('data-act')) ||
        (actEl && actEl.getAttribute('data-act'));
      if (!act) return;
      switch (act) {
        case 'hide':
          togglePanel(false);
          break;
        case 'cfg':
          openConfig();
          break;
        case 'cfg-close':
          closeConfig();
          break;
        case 'cfg-save':
          saveConfig();
          break;
        case 'cfg-test':
          testProviders();
          break;
        case 'cfg-export':
          exportConfig();
          break;
        case 'cfg-import':
          importConfig();
          break;
        case 'cfg-page':
          openSettingsPage();
          break;
        case 'run':
          CXAI.Engine.start();
          break;
        case 'next':
          CXAI.Engine.answerNext();
          break;
        case 'prefetch':
          CXAI.Engine.prefetch();
          break;
        case 'pause':
          CXAI.Engine.togglePause();
          break;
        case 'stop':
          CXAI.Engine.stop();
          break;
        case 'help':
          showHelp();
          break;
        case 'pick': {
          const row = e.target.closest ? e.target.closest('.qcard') : null;
          const n = Number((actEl && actEl.getAttribute('data-i')) || e.target.getAttribute('data-i') || (row && row.getAttribute('data-i')) || 0) || 0;
          if (n) {
            state.sel = n;
            render();
          }
          break;
        }
        case 'tab': {
          const t = e.target.closest ? e.target.closest('.ntab') : null;
          if (t) showTab(t.getAttribute('data-tab'));
          break;
        }
        case 'pv-toggle': {
          // 点行头展开/收起；但行头里的勾选框、删除、下拉不该触发
          if (e.target.closest && e.target.closest('input, label, select, button, .del, a, [data-del], [data-fetch], [data-pick]')) break;
          const card = e.target.closest ? e.target.closest('.pv') : null;
          if (!card) break;
          card.setAttribute('data-open', card.getAttribute('data-open') === '1' ? '0' : '1');
          break;
        }
        case 'pv-all': {
          const want = e.target.getAttribute('data-open') === '1' ? '1' : '0';
          Array.from(root.querySelectorAll('.pv')).forEach((c) => c.setAttribute('data-open', want));
          break;
        }
        case 'logs': {
          const lg = $('#logs');
          if (lg) lg.classList.toggle('show');
          break;
        }
        case 'go': {
          const n = Number((actEl && actEl.getAttribute('data-i')) || e.target.getAttribute('data-i') || 0) || 0;
          if (n && CXAI.Engine && CXAI.Engine.jumpTo) CXAI.Engine.jumpTo(n);
          break;
        }
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'X' || e.key === 'x')) {
        e.preventDefault();
        togglePanel();
      }
    });
    CXAI.Log.on((entry) => appendLog(entry));
  }

  /* ---------------- 渲染 ---------------- */

  /** 面板贴着球的一侧展开：球在左半屏就往右开，别溢出屏幕 */
  function placePanel(ballLeft) {
    const p = $('#panel');
    if (!p) return;
    const x = ballLeft != null ? ballLeft : (root.querySelector('.wrap') || { getBoundingClientRect: () => ({ left: window.innerWidth - 40 }) }).getBoundingClientRect().left;
    if (x < 440) {
      p.style.left = '0';
      p.style.right = 'auto';
    } else {
      p.style.right = '0';
      p.style.left = 'auto';
    }
  }

  /**
   * 悬浮球的单击 / 双击。
   *   单击 = 直接开始答题（跑着的时候=暂停）
   *   双击 = 打开/收起整个面板
   * 用 260ms 定时器区分：单击先挂起，等这么久没有第二次点击才执行。
   */
  let ballClickTimer = null;
  let toastTimer = null;

  function toast(text) {
    const el = $('#gtoast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
  }

  function modeNow() {
    return state.mode === 'auto' ? 'auto' : 'single';
  }

  /** 切换小球点击模式：single=点一下答一题 / auto=点一下跑完整卷 */
  function setMode(m, silent) {
    state.mode = m === 'auto' ? 'auto' : 'single';
    try {
      CXAI.Store.set('ballMode', state.mode);
    } catch (e) {}
    render();
    if (!silent) toast(state.mode === 'auto' ? '模式：自动连答（点一下跑完整卷）' : '模式：答一题（点一下答一道）');
  }

  /** 单击：按当前模式执行；双击：开合面板（260ms 内第二次点击算双击） */
  function onClickBall() {
    if (ballClickTimer) {
      clearTimeout(ballClickTimer);
      ballClickTimer = null;
      togglePanel();
      return;
    }
    ballClickTimer = setTimeout(function () {
      ballClickTimer = null;
      try {
        if (modeNow() === 'auto') {
          if (CXAI.Engine.st.running) CXAI.Engine.togglePause();
          else CXAI.Engine.start();
        } else {
          if (CXAI.Engine.st.running) {
            CXAI.Engine.stop();
            toast('已停止自动连答');
            return;
          }
          CXAI.Engine.answerNext();
        }
      } catch (e) {}
    }, 260);
  }

  /**
   * 悬浮球手势：
   *   单击        = 按当前模式执行（答一题 / 自动连答）
   *   双击        = 开合面板
   *   长按后左滑  = 切到「答一题」模式
   *   长按后上滑  = 切到「自动连答」模式
   *   直接拖动    = 摆位置（长按一旦触发就不再拖动，避免两种意图打架）
   */
  function setupBall() {
    const ball = $('#ball');
    const wrap = root.querySelector('.wrap');
    const gmode = $('#gmode');
    if (!ball || !wrap) return;
    try {
      const pos = CXAI.Store.get('uiPos', null);
      if (pos && pos.left != null) {
        wrap.style.left = pos.left + 'px';
        wrap.style.top = pos.top + 'px';
        wrap.style.right = 'auto';
        wrap.style.bottom = 'auto';
      }
      const m = CXAI.Store.get('ballMode', '');
      if (m === 'auto' || m === 'single') state.mode = m;
    } catch (e) {}
    placePanel();

    let drag = null;
    let lpTimer = null;
    const LP_MS = 420;
    const GEST = 26;

    const showHint = (on) => {
      if (gmode) gmode.classList.toggle('show', !!on);
    };
    const markDir = (dir) => {
      if (!gmode) return;
      Array.from(gmode.querySelectorAll('.g')).forEach((g) => g.classList.toggle('on', !!dir && g.getAttribute('data-dir') === dir));
    };

    ball.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = wrap.getBoundingClientRect();
      drag = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false, lp: false, dir: '' };
      try {
        ball.setPointerCapture(e.pointerId);
      } catch (err) {}
      clearTimeout(lpTimer);
      lpTimer = setTimeout(function () {
        if (!drag || drag.moved) return;
        drag.lp = true;
        ball.classList.add('dragging');
        showHint(true);
        markDir('');
      }, LP_MS);
      e.preventDefault();
    });

    ball.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      if (drag.lp) {
        // 长按之后：移动 = 选手势方向（不再拖动位置）
        let dir = '';
        if (dx <= -GEST && Math.abs(dx) >= Math.abs(dy)) dir = 'left';
        else if (dy <= -GEST && Math.abs(dy) > Math.abs(dx)) dir = 'up';
        if (dir !== drag.dir) {
          drag.dir = dir;
          markDir(dir);
        }
        e.preventDefault();
        return;
      }
      if (Math.abs(dx) + Math.abs(dy) > 4) {
        drag.moved = true;
        clearTimeout(lpTimer);
      }
      if (!drag.moved) return;
      const left = Math.min(window.innerWidth - 42, Math.max(2, drag.ox + dx));
      const top = Math.min(window.innerHeight - 42, Math.max(2, drag.oy + dy));
      wrap.style.left = left + 'px';
      wrap.style.top = top + 'px';
      wrap.style.right = 'auto';
      wrap.style.bottom = 'auto';
      e.preventDefault();
    });

    const finish = () => {
      clearTimeout(lpTimer);
      if (!drag) return;
      const d = drag;
      drag = null;
      ball.classList.remove('dragging');
      showHint(false);
      if (d.lp) {
        if (d.dir === 'left') setMode('single');
        else if (d.dir === 'up') setMode('auto');
        else toast('已取消（没选方向）');
        return;
      }
      if (!d.moved) {
        onClickBall();
        return;
      }
      const r = wrap.getBoundingClientRect();
      try {
        CXAI.Store.set('uiPos', { left: Math.round(r.left), top: Math.round(r.top) });
      } catch (err) {}
      placePanel(r.left);
    };

    ball.addEventListener('pointerup', (e) => {
      try {
        ball.releasePointerCapture(e.pointerId);
      } catch (err) {}
      finish();
    });
    ball.addEventListener('pointercancel', () => {
      drag = null;
      clearTimeout(lpTimer);
      ball.classList.remove('dragging');
      showHint(false);
    });
  }

  function togglePanel(force) {
    const p = $('#panel');
    if (!p) return;
    const show = force != null ? force : !p.classList.contains('show');
    p.classList.toggle('show', show);
    if (show) placePanel();
    try {
      CXAI.Store.set('uiOpen', show);
    } catch (e) {}
  }

  function render() {
    if (!root) return;
    const set = (id, v) => {
      const el = $('#' + id);
      if (el) el.textContent = v;
    };
    const rows = rowsForRender();
    const answered = rows.filter((r) => r.status === 'ok' || r.status === 'skip').length;
    const failed = rows.filter((r) => r.status === 'fail').length;
    const total = Math.max(state.total || 0, rows.length);
    state.answered = answered;
    state.failed = failed;
    state.todo = Math.max(0, total - answered);
    set('s-total', total);
    set('s-done', answered);
    set('s-todo', state.todo);
    set('s-model', state.providers);
    set('s-page', state.pageKind);
    set('s-state', (state.running ? (state.paused ? '已暂停' : '运行中') : '待机') +
      (state.pageKind && state.pageKind !== '-' ? ' · ' + state.pageKind : '') +
      (failed ? ' · 失败 ' + failed : '') +
      ' · ' + (state.mode === 'auto' ? '自动连答' : '答一题'));
    renderQGrid(rows);
    renderQDetail(rows);
    const ball = $('#ball');
    if (ball) ball.classList.toggle('busy', state.running && !state.paused);
    const label = $('#balllabel');
    if (label) {
      if (state.doneAll && !state.running) label.textContent = 'OK';
      else if (state.running) label.textContent = String(state.answered || 0);
      else label.textContent = 'CX';
    }
    if (ball) {
      ball.classList.toggle('running', !!state.running && !state.doneAll);
      ball.classList.toggle('done', !!state.doneAll && !state.running);
    }
    const runBtn = $('[data-act="run"]');
    if (runBtn) {
      runBtn.textContent = state.running ? '运行中…' : '自动连答';
      runBtn.disabled = state.running;
    }
  }

  function update(patch) {
    Object.assign(state, patch || {});
    render();
  }

  function appendLog(entry) {
    const box = $('#logs');
    if (!box) return;
    const div = document.createElement('div');
    div.className = 'lg ' + (entry.level || 'info');
    const t = new Date(entry.t);
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    div.textContent = `${hh}:${mm}:${ss} ${entry.msg}`;
    box.appendChild(div);
    const maxLines = Math.max(50, Number(CXAI.Cfg.get('ui.logMax', 300)) || 300);
    while (box.children.length > maxLines) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  /* ---------------- 作答清单：一题一格 + 点开看详情 ---------------- */

  /**
   * 把"清单记录 + 还没做过的题号"合成完整的一张表（每道题都要有一格）。
   * 换卷后旧清单要丢掉：清单按 paperKey 存，纸一换就重置（用户明确要求"不用留"）。
   */
  function rowsForRender() {
    const items = state.qlist || [];
    let maxNo = 0;
    items.forEach((it) => {
      maxNo = Math.max(maxNo, Number(it.index) || 0);
    });
    const total = Math.max(state.total || 0, maxNo);
    const byNo = {};
    items.forEach((it) => {
      const n = Number(it.index) || 0;
      if (n) byNo[n] = it;
    });
    const rows = [];
    for (let i = 1; i <= total; i++) rows.push(byNo[i] || { index: i, status: 'todo', placeholder: true });
    items.forEach((it) => {
      const n = Number(it.index) || 0;
      if (!n || n > total) rows.push(it);
    });
    return rows;
  }

  const STATUS_WORD = { ok: '已答', skip: '已答·原有', fail: '失败', wait: '作答中', todo: '未答' };

  function statusOf(it) {
    const n = Number(it.index) || 0;
    let st = it.status || 'todo';
    const cur = Number(state.current) || 0;
    const pend = state.pending && Number(state.pending.index) ? Number(state.pending.index) : 0;
    if (st === 'todo' && (n === cur || n === pend) && state.running) st = 'wait';
    return st;
  }

  function clsOf(st) {
    return st === 'ok' ? 'ok' : st === 'skip' ? 'no' : st === 'wait' ? 'wait' : st === 'fail' ? 'err' : 'todo';
  }

  /** 题号格子：颜色=状态，点击=在下方面板看这题的选项与 AI 作答 */
  function renderQGrid(rows) {
    const box = $('#qgrid');
    if (!box) return;
    rows = rows || rowsForRender();
    if (!rows.length) {
      box.innerHTML = '<div class="qempty">还没有题目 —— 进入考试/作业页后这里会出现题号格子</div>';
      return;
    }
    const esc = (t) => CXAI.U.escapeHtml(String(t == null ? '' : t));
    const cur = Number(state.current) || 0;
    const sel = Number(state.sel) || 0;
    box.innerHTML = rows
      .map((it) => {
        const n = Number(it.index) || 0;
        const st = statusOf(it);
        const cls = clsOf(st);
        const isCur = n && n === cur;
        const isSel = n && n === sel;
        const tip = [`#${n}`, STATUS_WORD[st] || '', it.typeLabel || '', it.stem || ''].filter(Boolean).join(' · ');
        return '<div class="qcard ' + cls + (isCur ? ' cur' : '') + (isSel ? ' sel' : '') +
          '" data-act="pick" data-i="' + esc(n) + '" title="' + esc(tip) + '">' + esc(n || '?') + '</div>';
      })
      .join('');
    // 选中/当前格滚进视野
    const focus = box.querySelector('.qcard.sel') || box.querySelector('.qcard.cur');
    if (focus && focus.scrollIntoView) {
      try {
        focus.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } catch (e) {}
    }
  }

  /** 选中题的下方详情：题干 / 选项（AI 选中的高亮）/ AI 答案 / 页面答案 / 置信度 */
  function renderQDetail(rows) {
    const box = $('#qdetail');
    if (!box) return;
    rows = rows || rowsForRender();
    const esc = (t) => CXAI.U.escapeHtml(String(t == null ? '' : t));
    let sel = Number(state.sel) || 0;
    if (!sel) {
      // 没选过就看当前题
      sel = Number(state.current) || Number(state.pending && state.pending.index) || 0;
      if (!sel && rows.length) sel = Number(rows[0].index) || 0;
    }
    const pend = state.pending && Number(state.pending.index) === sel ? state.pending : null;
    let it = rows.filter((r) => Number(r.index) === sel)[0];
    if (!it && pend) it = { index: sel, status: 'todo', placeholder: true, stem: pend.stem, typeLabel: pend.typeLabel };
    if (!it) {
      box.innerHTML = '<div class="qempty">点上面的题号格子，这里显示那道题的题目、选项和 AI 作答</div>';
      return;
    }
    const st = statusOf(it);
    const aiLetters = String(it.answer || '').toUpperCase().replace(/[^A-H]/g, '');
    const pgLetters = String(it.actual || '').toUpperCase().replace(/[^A-H]/g, '');
    const opts = (it.options && it.options.length ? it.options : []).map((o) => {
      const k = String(o.k || o.key || '').toUpperCase();
      const mark = aiLetters.indexOf(k) >= 0 ? ' ai' : pgLetters.indexOf(k) >= 0 ? ' pg' : '';
      const flag = pgLetters.indexOf(k) >= 0 ? ' ✓' : '';
      return '<li class="' + mark.trim() + '"><b>' + esc(k) + '</b><span>' + esc(String(o.t || o.text || '')) + flag + '</span></li>';
    }).join('');
    // 底部信息只显示"有值且有意义"的行：不再出现 ? / - 这种占位符
    const conf = it.confidence != null && Number(it.confidence) > 0 ? Math.round(Number(it.confidence) * 100) + '%' : '';
    const stageWord = {
      panel: '议会投票', critique: '交叉复核', arbiter: '仲裁裁决', fallback: '兜底取值',
      cached: '复用本次判定', stored: '复用上次判定', stem: '题干自带'
    };
    // 字母答案顺手翻成选项文字：B → B（北京），省得对着字母回看页面
    const letterize = (val) => {
      const raw = String(val == null ? '' : val).trim();
      if (!raw) return '';
      if (!/^[A-Ha-h]+$/.test(raw) || !it.options || !it.options.length) return raw;
      return raw.toUpperCase().split('').map((c) => {
        const o = it.options.filter((x) => String(x.k || '').toUpperCase() === c)[0];
        return o ? c + '（' + String(o.t || '').slice(0, 18) + '）' : c;
      }).join('  ');
    };
    const norm2 = (v) => String(v || '').replace(/[\s（）()·]/g, '').toUpperCase();
    const aiTxt = letterize(it.answer);
    const pgTxt = letterize(it.actual);
    const meta = [];
    if (aiTxt) {
      meta.push('<div class="kv"><span class="k">AI 判定</span><span class="v ai">' + esc(aiTxt) + '</span>' +
        (conf ? '<span class="chip">置信度 ' + conf + '</span>' : '') +
        (stageWord[it.stage] ? '<span class="chip">' + esc(stageWord[it.stage]) + '</span>' : '') + '</div>');
    }
    if (pgTxt) {
      const same = aiTxt && norm2(aiTxt) === norm2(pgTxt);
      meta.push('<div class="kv"><span class="k">页面已存</span><span class="v pg">' + esc(pgTxt) + '</span>' +
        (aiTxt
          ? (same ? '<span class="chip ok">与 AI 一致</span>' : '<span class="chip bad">与 AI 不一致</span>')
          : '<span class="chip">你手动作答 · AI 未参与</span>') + '</div>');
    }
    if (!meta.length) meta.push('<div class="kv"><span class="v muted">这题还没作答</span></div>');
    box.innerHTML =
      '<div class="qd-hd">' +
      '<span class="qn">#' + esc(it.index) + '</span>' +
      '<span class="tag">' + esc(it.typeLabel || '') + '</span>' +
      '<span class="st ' + clsOf(st) + '">' + (STATUS_WORD[st] || '未答') + '</span>' +
      '<span class="qd-jump" data-act="go" data-i="' + esc(it.index) + '">跳到该题</span>' +
      '</div>' +
      '<div class="qd-stem">' + esc(it.stem || (it.placeholder ? '这题还没有作答记录（点「开始答题」，或手动作答后回来查看）' : '(没有题干)')) + '</div>' +
      (opts ? '<ul class="qd-opts">' + opts + '</ul>' : '') +
      '<div class="qd-meta">' + meta.join('') + '</div>';
  }

  /* ---------------- 清单存储（按卷隔离，换卷即清空） ---------------- */

  function paperNow() {
    try {
      return CXAI.Scraper.paperKey ? CXAI.Scraper.paperKey() : '';
    } catch (e) {
      return '';
    }
  }

  function getQList() {
    try {
      const saved = CXAI.Store.get('qlist', null);
      if (!saved) return [];
      // 老格式（纯数组）直接当成"上一份卷子"，丢掉
      if (Array.isArray(saved)) return [];
      if (saved.paper !== paperNow()) return [];
      return saved.rows || [];
    } catch (e) {
      return [];
    }
  }

  function saveQList(rows) {
    try {
      CXAI.Store.set('qlist', { paper: paperNow(), rows: rows || [] });
    } catch (e) {}
  }

  /** 记一条作答记录（同一题重复处理只覆盖，不重复堆格子） */
  function pushQuestion(rec) {
    if (!rec) return;
    const arr = getQList().slice();
    const key = rec.key || 'qid:' + (rec.qid || rec.index);
    const at = arr.findIndex((x) => (x.key || 'qid:' + (x.qid || x.index)) === key);
    const item = Object.assign({}, rec, { key });
    if (at >= 0) arr[at] = item;
    else arr.push(item);
    const rows = arr.slice(-300);
    state.qlist = rows;
    saveQList(rows);
    // 图谱跟着当前题走：新记录进来就把详情切到这道题
    if (rec.status === 'ok' || rec.status === 'fail' || rec.status === 'skip') state.sel = Number(rec.index) || state.sel;
    render();
  }

  /** 追加一道题的判定结果卡片 */
  function addQuestionCard(q, result, applyResult) {
    const box = $('#logs');
    if (!box) return;
    const div = document.createElement('div');
    div.className = 'q';
    const ok = applyResult && applyResult.ok;
    const low = result && result.lowConfidence;
    const cls = !ok ? 'ans err' : low ? 'ans low' : 'ans';
    const shown = result ? (result.answerText || '?') : '跳过';
    const conf = result ? Math.round((result.confidence || 0) * 100) + '%' : '-';
    const stageMap = { panel: '议会', critique: '复核', arbiter: '仲裁', fallback: '兜底', cached: '缓存' };
    const votes = result && result.votes ? result.votes.length : 0;
    const agree = result && result.ratio != null ? Math.round(result.ratio * 100) + '%' : '-';
    div.innerHTML = `
      <div class="h">
        <span class="idx">#${(q.index || 0) + 1}</span>
        <span class="tag">${CXAI.U.escapeHtml(q.typeLabel)}</span>
        <span class="${cls}">${CXAI.U.escapeHtml(shown)}</span>
      </div>
      <div class="stem">${CXAI.U.escapeHtml(q.stem || '(无题干)')}</div>
      <div class="meta">置信度 <em>${conf}</em> · 一致率 <em>${agree}</em> · 阶段 <em>${stageMap[result && result.stage] || '-'}</em> · 投票 <em>${votes}</em>${ok ? '' : ' · <em style="color:#ef7676">写入失败</em>'}</div>`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  /* ---------------- 设置面板 ---------------- */

  /**
   * 预设下拉显示的应该是"这份配置实际像哪个预设"，而不是历史存下来的 preset 字段。
   * 旧版本存过 preset:'deepseek'，用户后来把 Base URL 改成 magpie 网关，
   * 下拉还显示 DeepSeek —— 就是这个原因。这里按 Base URL 反查，查不到再退回存的值。
   */
  function guessPreset(p) {
    const list = CXAI.PRESETS || [];
    const norm = (u) => String(u || '').replace(/\/+$/, '').toLowerCase();
    const hit = list.filter((x) => x.baseURL && norm(x.baseURL) === norm(p && p.baseURL))[0];
    if (hit) return hit.id;
    if (p && p.preset && list.some((x) => x.id === p.preset)) return p.preset;
    try {
      if (p && CXAI.isLocalURL(p.baseURL)) return 'magpie';
    } catch (e) {}
    return 'custom';
  }

  function presetOptions(cur) {
    const list = CXAI.PRESETS || [];
    const known = list.some((p) => p.id === cur);
    return (
      (cur && !known ? `<option value="${CXAI.U.escapeHtml(cur)}" selected>${CXAI.U.escapeHtml(cur)}</option>` : '') +
      list.map((p) => `<option value="${p.id}"${p.id === cur ? ' selected' : ''}>${CXAI.U.escapeHtml(p.label)}</option>`).join('')
    );
  }

  function setHint(el, text, bad) {
    if (!el) return;
    el.textContent = text || '';
    el.style.color = bad ? '#ff8f8f' : '';
  }

  /** 拉取某个 provider 的模型列表，填进该行的 datalist */
  async function fetchModels(i) {
    const row = root.querySelector('.pv[data-i="' + i + '"]');
    if (!row) return;
    const btn = row.querySelector('[data-fetch]');
    const hint = row.querySelector('.mhint');
    const p = readRow(row, i);
    if (!p.baseURL) return setHint(hint, '先填 Base URL', true);
    if (!p.apiKey && !p.keyOptional) return setHint(hint, '先填 API Key', true);
    const label = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '…';
    }
    setHint(hint, '正在拉取 ' + p.baseURL + ' 的模型列表…');
    try {
      const list = await CXAI.AI.listModels(p);
      row.__models = list;
      const mEl = row.querySelector('.f-model');
      if (mEl && !mEl.value.trim() && list.length) mEl.value = list[0].id;
      refreshVisionSelect();
      setHint(hint, list.length ? '拉到 ' + list.length + ' 个模型 · 点 ▾ 选择（可输入过滤）' : '接口没返回模型', !list.length);
      CXAI.Log.info('[模型] ' + (p.label || p.baseURL) + ' → ' + list.length + ' 个可用模型');
    } catch (err) {
      setHint(hint, '拉取失败：' + (err && err.message ? err.message : String(err)), true);
      CXAI.Log.warn('[模型] 拉取失败：' + (err && err.message ? err.message : err));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = label || '拉取';
      }
    }
  }

  /* ---------- 模型选择浮层（原生 datalist 只展示前几项，127 个没法用） ---------- */

  let picker = null;

  function hidePicker() {
    if (picker && picker.el) picker.el.style.display = 'none';
  }

  function renderPickerList() {
    if (!picker) return;
    const row = root.querySelector('.pv[data-i="' + picker.i + '"]');
    const all = (row && row.__models) || [];
    const q = (picker.filter.value || '').trim().toLowerCase();
    const hit = q ? all.filter((m) => (m.id + ' ' + (m.label || '')).toLowerCase().indexOf(q) >= 0) : all;
    const cur = row && row.querySelector('.f-model') ? row.querySelector('.f-model').value.trim() : '';
    picker.list.innerHTML = hit.length
      ? hit
          .slice(0, 400)
          .map(
            (m) =>
              `<div class="mi${m.id === cur ? ' on' : ''}" data-id="${CXAI.U.escapeHtml(m.id)}">${CXAI.U.escapeHtml(m.label || m.id)}</div>`
          )
          .join('')
      : '<div class="mi-empty">没有匹配的模型</div>';
    picker.count.textContent = hit.length + ' / ' + all.length;
  }

  function ensurePicker() {
    if (picker) return picker;
    const el = document.createElement('div');
    el.id = 'mpop';
    el.innerHTML =
      '<div class="mph"><input type="text" class="mpf" placeholder="输入关键词过滤…"><span class="mpc"></span></div><div class="mpl"></div>';
    root.appendChild(el);
    picker = { el: el, filter: el.querySelector('.mpf'), list: el.querySelector('.mpl'), count: el.querySelector('.mpc'), i: -1 };
    el.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.classList || !t.classList.contains('mi')) return;
      const id = t.getAttribute('data-id');
      const row = root.querySelector('.pv[data-i="' + picker.i + '"]');
      if (row && id != null) {
        const mEl = row.querySelector('.f-model');
        if (mEl) mEl.value = id;
        setHint(row.querySelector('.mhint'), '已选 ' + id);
        // 关键：浮层点选后必须重画读图下拉，否则那里还显示上一个模型的名字
        refreshVisionSelect();
      }
      hidePicker();
    });
    picker.filter.addEventListener('input', renderPickerList);
    document.addEventListener(
      'mousedown',
      (e) => {
        if (!picker || picker.el.style.display !== 'block') return;
        const path = e.composedPath ? e.composedPath() : [];
        if (path.indexOf(picker.el) >= 0) return;
        const isPickBtn = path.some((n) => n && n.getAttribute && n.getAttribute('data-pick') != null);
        if (isPickBtn) return;
        hidePicker();
      },
      true
    );
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hidePicker();
    });
    return picker;
  }

  async function openModelPicker(i) {
    let row = root.querySelector('.pv[data-i="' + i + '"]');
    if (!row) return;
    if (!row.__models || !row.__models.length) {
      await fetchModels(i);
      row = root.querySelector('.pv[data-i="' + i + '"]');
    }
    const list = (row && row.__models) || [];
    if (!list.length) return;
    const pk = ensurePicker();
    pk.i = i;
    pk.filter.value = '';
    renderPickerList();
    const btn = row.querySelector('[data-pick]') || row;
    const r = btn.getBoundingClientRect();
    const w = Math.max(260, Math.min(460, (r.width || 200) + 200));
    pk.el.style.width = w + 'px';
    pk.el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
    const h = 320;
    pk.el.style.top = (r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
    pk.el.style.display = 'block';
    pk.el.style.zIndex = '30';
    pk.filter.focus();
  }

  /** 事件只绑一次：点「拉取」；改 Key/Base/预设且模型名为空时自动拉一次 */
  function wireProviderBox(box) {
    if (box.__wired) return;
    box.__wired = 1;
    box.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.getAttribute) return;
      const del = t.getAttribute('data-del');
      if (del != null) {
        e.preventDefault();
        const list = readProviders();
        const at = Number(del);
        list.splice(at, 1);
        renderProviders(list);
        CXAI.Log.info('已删除模型 ' + (at + 1) + '（保存后生效）');
        return;
      }
      const idx = t.getAttribute('data-fetch');
      if (idx != null) {
        e.preventDefault();
        fetchModels(Number(idx));
        return;
      }
      const pk = t.getAttribute('data-pick');
      if (pk != null) {
        e.preventDefault();
        openModelPicker(Number(pk));
      }
    });
    let syncTimer = 0;
    const syncSoon = () => {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(refreshVisionSelect, 160);
    };
    box.addEventListener('input', (e) => {
      const t = e.target;
      if (!t || !t.classList) return;
      if (t.classList.contains('f-model') || t.classList.contains('f-base')) syncSoon();
    });
    box.addEventListener('change', (e) => {
      const t = e.target;
      if (!t || !t.classList) return;
      if (
        !t.classList.contains('f-key') &&
        !t.classList.contains('f-base') &&
        !t.classList.contains('f-preset') &&
        !t.classList.contains('f-model') &&
        !t.classList.contains('f-enabled')
      )
        return;
      refreshVisionSelect();
      const row = t.closest ? t.closest('.pv') : null;
      if (!row) return;
      const mEl = row.querySelector('.f-model');
      if (mEl && !mEl.value.trim()) fetchModels(Number(row.getAttribute('data-i')));
    });
  }

  /** 把预设值填进某个 provider 行 */
  function applyPreset(box, id) {
    const pre = (CXAI.PRESETS || []).filter((p) => p.id === id)[0];
    if (!pre || !box) return;
    box.setAttribute('data-preset', id);
    const setVal = (sel, v) => {
      const el = box.querySelector(sel);
      if (el && v != null) el.value = v;
    };
    if (pre.baseURL != null) setVal('.f-base', pre.baseURL);
    if (pre.apiKey != null) setVal('.f-key', pre.apiKey);
    if (pre.model != null) setVal('.f-model', pre.model);
    setVal('.f-style', pre.apiStyle || 'openai');
    const styleBox = box.querySelector('.stylebox');
    if (styleBox) styleBox.style.display = id === 'custom' ? '' : 'none';
    const hint = box.querySelector('.mhint');
    if (hint) setHint(hint, pre.hint || '');
    box.__models = null;
  }

  /** 取某个 provider 行的真实名字（模型名优先；绝不用预设名冒充模型名） */
  function rowName(box, i) {
    const model = ((box.querySelector('.f-model') || {}).value || '').trim();
    const presetId = box.querySelector('.f-preset') ? box.querySelector('.f-preset').value : '';
    const pre = (CXAI.PRESETS || []).filter((x) => x.id === presetId)[0] || null;
    const base = ((box.querySelector('.f-base') || {}).value || '').trim();
    let host = '';
    try {
      host = base ? new URL(base).host : '';
    } catch (e) {
      host = base.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    }
    return { model: model, presetLabel: pre ? pre.label : '', presetModel: pre ? pre.model || '' : '', base: base, host: host };
  }

  /**
   * 读图模型下拉：把所有行列出来，选中谁就让谁读图。
   * 显示顺序固定为「真实模型名 → 行号 → 主机」，模型名为空时明确写「未填模型名」，
   * 预设名只作为末尾的次要信息出现 —— 之前把预设名当模型名显示，导致下拉里全是 "DeepSeek"。
   */
  function refreshVisionSelect() {
    const sel = $('#cfg-vmodel');
    if (!sel) return;
    const cur = sel.value;
    const esc = (x) => CXAI.U.escapeHtml(x == null ? '' : String(x));
    const opts = ['<option value="">不用读图（纯文字题目）</option>'];
    const ids = [];
    root.querySelectorAll('.pv').forEach((box, i) => {
      const r = rowName(box, i);
      const id = box.getAttribute('data-id') || 'p' + i;
      ids.push(id);
      const name = r.model || '（未填模型名）';
      const tail = [];
      if (r.host) tail.push(r.host);
      // 模型名才是唯一可信的东西；只有模型名为空时才拿预设名兜底，避免下拉里塞满厂商名
      if (r.presetLabel && !r.model) tail.push('预设 ' + r.presetLabel);
      const enabled = box.querySelector('.f-enabled') ? box.querySelector('.f-enabled').checked : true;
      if (!enabled) tail.push('已停用');
      const text = `${name} · 模型 ${i + 1}` + (tail.length ? ' · ' + tail.join(' · ') : '');
      opts.push(`<option value="${esc(id)}" title="${esc(r.base || '未填 Base URL')}">${esc(text)}</option>`);
    });
    sel.innerHTML = opts.join('');
    // 只有当前值还在列表里才还原，否则退回「不用读图」，避免下拉显示空白/错位
    sel.value = cur && ids.indexOf(cur) >= 0 ? cur : '';
    syncVisionHint();
  }

  function syncVisionHint() {
    const sel = $('#cfg-vmodel');
    const hint = $('#vmodel-hint');
    if (!hint) return;
    const id = sel ? sel.value : '';
    const c = $('#cfg-vjudge');
    const both = !!(c && c.checked);
    const n = root.querySelectorAll('.pv').length;
    if (!id) {
      hint.textContent = both ? '' : '选「不用读图」时，带图的题会当成纯文字去猜';
      return;
    }
    if (both) {
      hint.textContent =
        n <= 1
          ? '就这一个模型：图片先转成文字，再由它自己作答、自己投票 —— 单模型也能跑完整套流程'
          : '图片先由它转成文字，然后它也会进议会投票（相当于多一票）';
    } else {
      hint.textContent =
        n <= 1
          ? '它只负责把图转成文字，不投票；现在是唯一的模型，判题会没有模型可用 —— 建议勾上上面那个框'
          : '题目图片先交给这个模型转成文字，再交给下面的判题模型；它自己不投票';
    }
  }

  function openConfig() {
    const body = $('#cfg-body');
    if (!body) return;
    const c = CXAI.Cfg.data || CXAI.Cfg.load();
    const providers = c.ai.providers || [];
    const v = c.ai.vision || {};
    // 老配置或半截配置可能缺段，逐段兜底，避免渲染时抛异常导致面板打不开
    const D = CXAI.DEFAULT_CONFIG || {};
    const g = Object.assign({}, D.guard || {}, c.guard || {});
    const ap = Object.assign({}, D.apply || {}, c.apply || {});
    const strength =
      c.ai.judge.mode === 'single' ? 'single' : c.ai.judge.mode === 'fast' ? 'fast' : c.ai.judge.enableArbiter ? 'max' : 'council';
    body.innerHTML = `
      <div class="pane show" data-pane="model">
        <div class="fld">
          <label>读图模型（题目带图时先由它把图转成文字）</label>
          <select id="cfg-vmodel"></select>
          <label class="chk"><input type="checkbox" id="cfg-vjudge"${v.judgeToo ? ' checked' : ''}> 这个模型也参与判题（它读图 + 自己投票；只配 1 个模型时必须勾）</label>
          <div class="help" id="vmodel-hint"></div>
        </div>
        <div class="fld">
          <div class="pvbar">
            <span class="t">判题模型（至少一个；可加多个投票）</span>
            <button class="mini" data-act="pv-all" data-open="1">全部展开</button>
            <button class="mini" data-act="pv-all" data-open="0">全部收起</button>
          </div>
          <div id="cfg-providers"></div>
          <button class="addrow" data-act="cfg-add" id="cfg-add">+ 添加模型</button>
        </div>
        <div class="fld">
          <label>连通性测试</label>
          <button class="b" data-act="cfg-test" id="cfg-test2" style="width:100%;margin-top:0">测试连接</button>
          <div class="testout" id="cfg-testout">点了才会测：逐个 ping 每个模型，结果直接显示在这里</div>
        </div>
      </div>

      <div class="pane" data-pane="judge">
        <div class="fld">
          <label>判定强度</label>
          <select id="cfg-strength">
            <option value="single"${strength === 'single' ? ' selected' : ''}>省 token · 单模型直接作答</option>
            <option value="fast"${strength === 'fast' ? ' selected' : ''}>快速 · 单模型采样 3 次自一致</option>
            <option value="council"${strength === 'council' ? ' selected' : ''}>标准 · 多模型议会投票（推荐）</option>
            <option value="max"${strength === 'max' ? ' selected' : ''}>严格 · 议会 + 交叉复核 + 仲裁</option>
          </select>
          <div class="help">答得准就别动它。越往下越慢、越费 token。</div>
        </div>
        <div class="row2">
          <div class="fld"><label>判定模式</label>
            <select id="cfg-mode">
              <option value="council"${c.ai.judge.mode === 'council' ? ' selected' : ''}>议会（多模型投票）</option>
              <option value="fast"${c.ai.judge.mode === 'fast' ? ' selected' : ''}>快速（单模型多次采样）</option>
              <option value="single"${c.ai.judge.mode === 'single' ? ' selected' : ''}>单模型</option>
            </select></div>
          <div class="fld"><label>参与模型数</label><input type="number" id="cfg-panel" min="1" max="6" value="${c.ai.judge.panelSize}"></div>
        </div>
        <div class="row2">
          <div class="fld"><label>一致率阈值</label><input type="number" id="cfg-vote" min="0.3" max="1" step="0.05" value="${c.ai.judge.voteThreshold}"></div>
          <div class="fld"><label>最低置信度</label><input type="number" id="cfg-minconf" min="0" max="1" step="0.05" value="${c.ai.judge.minConfidence}"></div>
        </div>
        <div class="fld"><label>单题并发</label><input type="number" id="cfg-conc" min="1" max="6" value="${c.ai.judge.concurrency}"></div>
        <div class="fld">
          <label>复核与仲裁</label>
          <label class="chk"><input type="checkbox" id="cfg-critique"${c.ai.judge.enableCritique ? ' checked' : ''}> 交叉复核（Round 2）</label>
          <label class="chk"><input type="checkbox" id="cfg-arbiter"${c.ai.judge.enableArbiter ? ' checked' : ''}> 仲裁（Round 3）</label>
        </div>
      </div>

      <div class="pane" data-pane="run">
        <div class="row2">
          <div class="fld"><label>题间最短间隔(ms)</label><input type="number" id="cfg-dmin" value="${g.minDelay}"></div>
          <div class="fld"><label>题间最长间隔(ms)</label><input type="number" id="cfg-dmax" value="${g.maxDelay}"></div>
        </div>
        <div class="row2">
          <div class="fld">
            <label>弹窗自动关闭(秒)</label>
            <input type="number" id="cfg-dlg" min="0" max="120" value="${Number(g.dialogDelaySec != null ? g.dialogDelaySec : 10)}">
            <div class="help">弹窗出现后等这么多秒才自动关；期间你手动关掉就不动它。0 = 永不自动关。</div>
          </div>
          <div class="fld">
            <label>日志保留行数</label>
            <input type="number" id="cfg-logmax" min="50" max="2000" value="${Number(CXAI.Cfg.get('ui.logMax', 300))}">
            <div class="help">面板「日志」区的上限，超出从头丢。</div>
          </div>
        </div>
        <div class="fld">
          <label>落盘行为</label>
          <label class="chk"><input type="checkbox" id="cfg-guard"${g.enabled ? ' checked' : ''}> 环境伪装（前台保持 + 自动确认弹窗）</label>
          <label class="chk"><input type="checkbox" id="cfg-force"${ap.overwriteAnswered ? ' checked' : ''}> 重做已答题目</label>
          <label class="chk"><input type="checkbox" id="cfg-save"${ap.saveEach ? ' checked' : ''}> 每题点保存按钮</label>
          <label class="chk"><input type="checkbox" id="cfg-submit"${ap.submit === true || ap.autoSubmit === true ? ' checked' : ''}> 全部答完后自动交卷（慎用）</label>
        </div>
        <div class="fld">
          <label>答案预取</label>
          <button class="b" data-act="prefetch" style="width:100%;margin-top:0">立即预取当前页答案</button>
          <div class="help">进考试页时已默认在后台预取（每道题先判一遍存起来）。这里只是手动再跑一次，点小球答一题时就不用等模型。</div>
        </div>
      </div>

      <div class="pane" data-pane="bak">
        <div class="fld">
          <label>配置备份 · 换浏览器 / 换域名时用它搬</label>
          <div class="row2">
            <button class="b" data-act="cfg-export" style="margin-top:0">导出到文本框</button>
            <button class="b" data-act="cfg-import" style="margin-top:0">从文本框导入</button>
          </div>
          <textarea id="cfg-io" rows="8" style="height:180px;font-family:ui-monospace,monospace;font-size:11px" placeholder="点「导出到文本框」把当前配置变成 JSON；在另一台电脑 / 另一个域名粘贴进来点「从文本框导入」"></textarea>
          <div class="help" id="cfg-iohint"></div>
        </div>
        <div class="fld">
          <label>存储状态</label>
          <div class="testout" id="cfg-storeinfo"></div>
        </div>
      </div>`;
    renderProviders(providers);
    const vsel0 = $('#cfg-vmodel');
    if (vsel0) {
      const saved = providers.filter((p) => p.vision && (p.role === 'vision' || p.role === 'both'))[0];
      // 只配了一个模型时，读书+判题都只能靠它：默认就选它读图、并勾上「也参与判题」
      const only = providers.length === 1 ? providers[0] : null;
      const preOne = only ? (CXAI.PRESETS || []).filter((x) => x.id === (only.preset || ''))[0] : null;
      // 只有一个模型、且它看起来能读图（预设带视觉 / 本地网关 / 已勾视觉）→ 默认让它读图并兼任判题
      const onlyVision = !!(
        only &&
        (only.vision ||
          only.role === 'vision' ||
          only.role === 'both' ||
          (preOne && preOne.vision) ||
          CXAI.isLocalURL(only.baseURL))
      );
      const autoBoth = !!(only && !saved && onlyVision);
      vsel0.value = v.ocrProviderId || (saved ? saved.id : '') || (autoBoth ? only.id : '') || '';
      const vj = $('#cfg-vjudge');
      if (vj) vj.checked = saved ? saved.role === 'both' : autoBoth ? true : !!v.judgeToo;
      syncVisionHint();
    }
    $('#cfg-add').addEventListener('click', () => {
      const list = readProviders();
      list.push(
        CXAI.normalizeProvider(
          { id: CXAI.U.uid('p'), label: '新模型', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', weight: 1 },
          list.length
        )
      );
      renderProviders(list);
    });
    // 判定强度：一次改四个高级字段，普通用户只碰这一个下拉
    const stSel = $('#cfg-strength');
    if (stSel) {
      stSel.addEventListener('change', () => {
        const MAP = {
          single: { mode: 'single', panel: 1, critique: false, arbiter: false },
          fast: { mode: 'fast', panel: 1, critique: false, arbiter: false },
          council: { mode: 'council', panel: 3, critique: true, arbiter: false },
          max: { mode: 'council', panel: 3, critique: true, arbiter: true }
        };
        const cfg = MAP[stSel.value];
        if (!cfg) return;
        const setV = (sel, val) => {
          const el = $(sel);
          if (el) el.value = String(val);
        };
        const setC = (sel, on) => {
          const el = $(sel);
          if (el) el.checked = !!on;
        };
        setV('#cfg-mode', cfg.mode);
        setV('#cfg-panel', cfg.panel);
        setC('#cfg-critique', cfg.critique);
        setC('#cfg-arbiter', cfg.arbiter);
      });
    }
    const storeInfo = $('#cfg-storeinfo');
    if (storeInfo) {
      try {
        const info = CXAI.Store.info(CXAI.CONFIG_KEY);
        storeInfo.textContent =
          '后端：' + info.backend + ' · 范围：' + (info.backend === 'gm' ? '所有域名共享' : '仅本域名') +
          ' · 体积：' + info.bytes + ' 字节\n' + '站点：' + location.host + '\n版本：' + CXAI.__version;
      } catch (e) {
        storeInfo.textContent = '读取失败：' + e.message;
      }
    }
    const ioHint = $('#cfg-iohint');
    if (ioHint) {
      const info = CXAI.Store.info(CXAI.CONFIG_KEY);
      ioHint.textContent =
        info.backend === 'gm'
          ? '存储：油猴 GM 存储（本脚本在所有域名间共享，换考试站点配置不会丢）· ' + info.bytes + ' 字节'
          : '存储：仅本源 localStorage（换域名就看不到这份配置）· ' + info.bytes + ' 字节 —— 用上面的导出/导入搬';
    }
    const vmSel = $('#cfg-vmodel');
    if (vmSel) vmSel.addEventListener('change', syncVisionHint);
    const vjChk = $('#cfg-vjudge');
    if (vjChk) vjChk.addEventListener('change', syncVisionHint);
    // 预设联动（委托，避免重渲染丢监听）
    const pbox = $('#cfg-providers');
    if (pbox) {
      pbox.addEventListener('change', (e) => {
        const t = e.target;
        if (t && t.classList && t.classList.contains('f-preset')) {
          applyPreset(t.closest('.pv'), t.value);
          refreshVisionSelect();
        }
      });
    }
    showTab(state.cfgTab || 'model');
    $('#mask').classList.add('show');
  }

  /** 切换设置窗页签（左侧竖排导航） */
  function showTab(name) {
    if (!root) return;
    name = name || 'model';
    state.cfgTab = name;
    Array.from(root.querySelectorAll('.ntab')).forEach((x) => x.classList.toggle('on', x.getAttribute('data-tab') === name));
    Array.from(root.querySelectorAll('.pane')).forEach((x) => x.classList.toggle('show', x.getAttribute('data-pane') === name));
  }

  function renderProviders(list) {
    const box = $('#cfg-providers');
    if (!box) return;
    const esc = (s) => CXAI.U.escapeHtml(s == null ? '' : String(s));
    box.innerHTML = (list || [])
      .map((p, i) => {
        const pid = p.id || 'p' + i;
        const style = p.apiStyle === 'anthropic' ? 'anthropic' : 'openai';
        const preset = guessPreset(p);
        const showStyle = preset === 'custom';
        return `
      <div class="pv${p.enabled ? '' : ' off'}" data-i="${i}" data-id="${esc(pid)}" data-preset="${esc(preset)}" data-open="${i === 0 ? '1' : '0'}">
        <div class="ph" data-act="pv-toggle" data-i="${i}" title="点击展开 / 收起这张卡">
          <span class="dot"></span>
          <span class="nm">模型 ${i + 1}</span>
          <span class="pm">${esc(p.model || '(未填模型名)')}</span>
          <span class="chipx">${esc(preset)}</span>
          <label class="chk" data-nohead="1"><input type="checkbox" class="f-enabled"${p.enabled ? ' checked' : ''}>启用</label>
          <span class="del" data-del="${i}">删除</span>
        </div>
        <div class="pbody">
        <div class="row2">
          <div class="fld"><label>预设</label><select class="f-preset">${presetOptions(preset)}</select></div>
          <div class="fld"><label>模型名</label>
            <div class="withbtn"><input type="text" class="f-model" value="${esc(p.model)}" placeholder="填好 Key 点「拉取」"><button type="button" class="mini" data-fetch="${i}">拉取</button><button type="button" class="mini" data-pick="${i}" title="从拉取到的模型里选">▾</button></div>
            <div class="hint mhint"></div></div>
        </div>
        <div class="row2">
          <div class="fld"><label>Base URL</label><input type="text" class="f-base" value="${esc(p.baseURL)}" placeholder="https://api.deepseek.com/v1"></div>
          <div class="fld"><label>API Key</label><input type="password" class="f-key" value="${esc(p.apiKey)}" placeholder="本地网关可留空"></div>
        </div>
        <div class="row2 stylebox"${showStyle ? '' : ' style="display:none"'}>
          <div class="fld"><label>接口协议</label>
            <select class="f-style">
              <option value="openai"${style === 'openai' ? ' selected' : ''}>OpenAI 兼容（/chat/completions）</option>
              <option value="anthropic"${style === 'anthropic' ? ' selected' : ''}>Anthropic 兼容（/v1/messages）</option>
            </select></div>
          <div class="fld"><label>说明</label><div class="hint">默认 OpenAI 兼容，Base URL 不用改</div></div>
        </div>
        </div>
      </div>`;
      })
      .join('');
    wireProviderBox(box);
    refreshVisionSelect();
  }

  function readRow(box, i) {
    const q = (sel) => box.querySelector(sel);
    const v = (sel) => (q(sel) ? q(sel).value : '');
    const ck = (sel) => !!(q(sel) && q(sel).checked);
    const presetId = q('.f-preset') ? q('.f-preset').value : box.getAttribute('data-preset') || '';
    const pre = (CXAI.PRESETS || []).filter((p) => p.id === presetId)[0] || null;
    const tempRaw = String(v('.f-temp') || '').trim();
    return CXAI.normalizeProvider(
      {
        id: box.getAttribute('data-id') || 'p' + i,
        preset: presetId,
        label: v('.f-model').trim() || v('.f-label').trim() || (pre ? pre.label : '') || '模型' + (i + 1),
        baseURL: v('.f-base').trim(),
        apiStyle: v('.f-style') || 'openai',
        role: 'judge',
        apiKey: v('.f-key').trim(),
        model: v('.f-model').trim(),
        weight: Number(v('.f-weight')) || 1,
        temperature: tempRaw === '' ? 0.2 : Number(tempRaw),
        maxTokens: Number(v('.f-max')) || 700,
        enabled: ck('.f-enabled'),
        vision: false,
        jsonMode: q('.f-json') ? ck('.f-json') : true,
        keyOptional: q('.f-keyopt') ? ck('.f-keyopt') : undefined,
        extraBody: undefined,
        extraHeaders: undefined
      },
      i
    );
  }

  function readProviders() {
    const out = [];
    root.querySelectorAll('.pv').forEach((box, i) => out.push(readRow(box, i)));
    const sel = $('#cfg-vmodel');
    const vid = sel ? sel.value : '';
    const both = (function () {
      const c = $('#cfg-vjudge');
      return !!(c && c.checked);
    })();
    out.forEach((p) => {
      const isVision = !!vid && p.id === vid;
      if (!isVision) {
        p.role = 'judge';
        p.vision = false;
      } else if (both) {
        p.role = 'both';
        p.vision = true;
      } else {
        p.role = 'vision';
        p.vision = true;
      }
    });
    return out;
  }

  /** 独立设置中心的地址（配置项 ui.settingsURL 可覆盖，方便自建部署 / 本地调试） */
  function settingsURL() {
    try {
      const u = CXAI.Cfg.get('ui.settingsURL', '');
      if (u) return String(u);
    } catch (e) {}
    return DEFAULT_SETTINGS_URL;
  }

  /** 新标签打开设置中心：同一份 GM 存储，改完回考试页直接生效 */
  function openSettingsPage() {
    const url = settingsURL();
    try {
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      location.href = url;
    }
    CXAI.Log.info('已打开设置中心：' + url);
  }

  function closeConfig() {
    const m = $('#mask');
    if (m) m.classList.remove('show');
  }

  function saveConfig(opt) {
    const silent = !!(opt && opt.silent);
    const val = (id) => $(id);
    const draft = readProviders();
    const vsel = val('#cfg-vmodel');
    const vid = vsel ? vsel.value : '';
    let judges = draft.filter((p) => p.enabled && p.role !== 'vision');
    let both = !!(vid && $('#cfg-vjudge') && $('#cfg-vjudge').checked);
    // 只有一个模型（或独立判题模型全被停用）时，让它兼任判题，别把保存卡死
    if (!judges.length && vid) {
      const vp = draft.filter((p) => p.id === vid && p.enabled)[0];
      if (vp) {
        vp.role = 'both';
        vp.vision = true;
        both = true;
        if ($('#cfg-vjudge')) $('#cfg-vjudge').checked = true;
        judges = draft.filter((p) => p.enabled && p.role !== 'vision');
        CXAI.Log.info('没有独立判题模型：已让读图模型「' + (vp.model || vp.label) + '」兼任判题');
      }
    }
    if (!judges.length) {
      CXAI.Log.error('没有可用模型：至少启用一个，或把读图模型也勾上「参与判题」');
      return false;
    }
    CXAI.Cfg.set('ai.providers', draft);
    CXAI.Cfg.set('ai.vision.enabled', !!vid);
    CXAI.Cfg.set('ai.vision.strategy', vid ? 'ocr' : 'off');
    CXAI.Cfg.set('ai.vision.ocrProviderId', vid || '');
    CXAI.Cfg.set('ai.vision.judgeToo', both);

    CXAI.Cfg.set('ai.judge.mode', val('#cfg-mode').value);
    // 不要向下夹到模型数：夹一次就会永久变小，之后加模型也回不来；真正取面板时 buildPanel 会自己夹
    CXAI.Cfg.set('ai.judge.panelSize', Math.max(1, Number(val('#cfg-panel').value) || 3));
    CXAI.Cfg.set('ai.judge.voteThreshold', Number(val('#cfg-vote').value) || 0.7);
    CXAI.Cfg.set('ai.judge.concurrency', Number(val('#cfg-conc').value) || 3);
    CXAI.Cfg.set('ai.judge.minConfidence', Number(val('#cfg-minconf').value) || 0.55);
    CXAI.Cfg.set('ai.judge.enableCritique', val('#cfg-critique').checked);
    CXAI.Cfg.set('ai.judge.enableArbiter', val('#cfg-arbiter').checked);

    CXAI.Cfg.set('guard.minDelay', Number(val('#cfg-dmin').value) || 1400);
    CXAI.Cfg.set('guard.maxDelay', Number(val('#cfg-dmax').value) || 4200);
    CXAI.Cfg.set('guard.enabled', val('#cfg-guard').checked);
    CXAI.Cfg.set('guard.dialogDelaySec', Math.max(0, Number(val('#cfg-dlg').value) || 0));
    CXAI.Cfg.set('ui.logMax', Math.max(50, Number(val('#cfg-logmax').value) || 300));
    CXAI.Cfg.set('apply.overwriteAnswered', val('#cfg-force').checked);
    CXAI.Cfg.set('apply.saveEach', val('#cfg-save').checked);
    CXAI.Cfg.set('apply.submit', val('#cfg-submit').checked);
    // 引擎（08）与 guard（06）实际读的是 apply.autoSubmit，两个字段一起写，避免开关只改一半
    CXAI.Cfg.set('apply.autoSubmit', val('#cfg-submit').checked);
    const wrote = CXAI.Cfg.save();
    if (!silent) {
      CXAI.Log.ok(
        '设置已保存 · 判题 ' + judges.length + ' 个' + (vid ? ' / 读图 1 个' + (both ? '（兼任判题）' : '') : '')
      );
      if (CXAI.Store.backend === 'local') CXAI.Log.warn('当前没有油猴存储：这份配置只在本网站生效，换域名请用面板底部「导出/导入」搬运');
    }
    update({ providers: CXAI.Cfg.activeProviders().length });
    if (!silent) closeConfig();
    return wrote !== false;
  }

  /* ---------- 配置搬运（换浏览器 / 换域名 / 换脚本实例） ---------- */

  function exportConfig() {
    if (!saveConfig({ silent: true })) return;
    const txt = $('#cfg-io');
    if (txt) txt.value = CXAI.Cfg.json();
    const hint = $('#cfg-iohint');
    if (hint) hint.textContent = '已导出 ' + (txt ? txt.value.length : 0) + ' 字符。全选复制，粘贴到另一台/另一个域名的同一个框里点「导入」。';
    CXAI.Log.ok('配置已导出到文本框（' + (txt ? txt.value.length : 0) + ' 字符）');
  }

  function importConfig() {
    const txt = $('#cfg-io');
    const raw = txt ? String(txt.value || '').trim() : '';
    if (!raw) {
      CXAI.Log.error('文本框是空的：先把导出的 JSON 粘进来');
      return;
    }
    try {
      CXAI.Cfg.importJSON(raw);
    } catch (e) {
      CXAI.Log.error('导入失败：' + (e && e.message ? e.message : e));
      return;
    }
    CXAI.Log.ok('配置已导入 · 模型 ' + (CXAI.Cfg.get('ai.providers', []) || []).length + ' 个');
    openConfig();
  }

  async function testProviders() {
    const out = $('#cfg-testout');
    const btn = $('#cfg-test2');
    const esc = (t) => CXAI.U.escapeHtml(String(t == null ? '' : t));
    const say = (html) => {
      if (out) out.innerHTML = html;
    };
    const line = (cls, text) => '<div class="' + cls + '">' + esc(text) + '</div>';

    const saved = CXAI.Cfg.get('ai.providers', []);
    const draft = readProviders();
    CXAI.Cfg.set('ai.providers', draft);
    const judge = CXAI.Cfg.activeProviders();
    const vis = CXAI.Cfg.visionProviders();
    const all = judge.concat(vis.filter((p) => judge.every((j) => j.id !== p.id)));

    if (!all.length) {
      CXAI.Cfg.set('ai.providers', saved);
      const msg = '没有可用模型：检查 Base URL / Key / 模型名是否填全（本地网关记得勾「允许空 Key」）';
      say(line('bad', msg));
      CXAI.Log.error(msg);
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = '测试中…';
    }
    say(line('mid', '正在测试 ' + all.length + ' 个模型…'));
    const lines = [];
    let okN = 0;
    for (const p of all) {
      const tag = p.role === 'vision' ? '[读图]' : p.vision ? '[判题+读图]' : '[判题]';
      const head = tag + (p.label || p.id) + ' · ' + (p.model || '(未填模型)') + ' · ' + (p.baseURL || '');
      lines.push(line('mid', '… ' + head));
      say(lines.join(''));
      try {
        const t0 = Date.now();
        const r = await CXAI.AI.ping(p);
        okN++;
        lines[lines.length - 1] = line('ok', '✓ ' + head + ' · ' + (r.ms || Date.now() - t0) + 'ms · ' +
          CXAI.U.truncate(String(r.text || '').replace(/\s+/g, ' '), 40));
        CXAI.Log.ok(`${p.label || p.id} 连通 (${r.ms}ms) · ${CXAI.U.truncate(r.text, 40)}`);
      } catch (e) {
        lines[lines.length - 1] = line('bad', '✗ ' + head + ' · ' + e.message);
        CXAI.Log.error(`${p.label || p.id} 失败：${e.message}`);
      }
      say(lines.join(''));
    }
    lines.push(line(okN === all.length ? 'ok' : 'bad', '完成：' + okN + '/' + all.length + ' 连通'));
    say(lines.join(''));
    if (btn) {
      btn.disabled = false;
      btn.textContent = '测试连接';
    }
    CXAI.Cfg.save();
  }

  function showHelp() {
    const box = $('#logs');
    if (!box) return;
    box.innerHTML = `
      <div class="lg">用法：</div>
      <div class="lg">1. 点 ⚙ → 模型列表里选「预设」自动填好，或手填任意兼容接口</div>
      <div class="lg">2. 图片题：在「图片题处理」选策略；要直传就把模型勾上「支持图片输入」</div>
      <div class="lg">3. 本地网关（magpie / Ollama / LM Studio）：Base URL 填本机端口，勾「允许空 Key」</div>
      <div class="lg">4. 打开考试页（整卷 / 单题模式均可），点「开始答题」</div>
      <div class="lg warn">低置信度题目标黄，建议人工复核后再交卷</div>
      <div class="lg">Ctrl+Shift+X 呼出面板；交卷只在显式开启时自动点</div>`;
  }

  return { mount, unmount, update, addQuestionCard, pushQuestion, rowsForRender, renderQGrid, renderQDetail, appendLog, togglePanel, openConfig, closeConfig, getQList, saveQList, settingsURL, openSettingsPage, state };
})();