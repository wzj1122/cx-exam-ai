import { useMemo, useState } from 'react';
import type { AppConfig, ProviderConfig } from '@cx/core';

export interface SettingsPanelProps {
  config: AppConfig;
  syncStatus?: string;
  busy?: boolean;
  onChange: (config: AppConfig) => void;
  onSave: () => Promise<void> | void;
  onExport: () => void;
  onImport: (text: string) => Promise<void> | void;
  onSyncCodeChange: (code: string) => void;
  onGenerateAndPush: () => Promise<void> | void;
  onPull: () => Promise<void> | void;
  onImportLegacy: () => Promise<void> | void;
  onTestProvider?: (provider: ProviderConfig) => Promise<void> | void;
  onListModels?: (provider: ProviderConfig) => Promise<void> | void;
  onClose?: () => void;
}

interface Preset {
  id: string;
  label: string;
  baseURL: string;
  model: string;
  apiStyle: ProviderConfig['apiStyle'];
  vision: boolean;
  keyOptional?: boolean;
  note: string;
}

/** 与第一代设置中心同一批预设，卡片文案保持"填 Key 后拉取选模型"的口径。 */
const PRESETS: Preset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    model: '',
    apiStyle: 'openai',
    vision: false,
    note: '（填 Key 后拉取选模型）',
  },
  {
    id: 'tokenrhythm',
    label: '基元律动',
    baseURL: 'https://tokenrhythm.studio/v1',
    model: '',
    apiStyle: 'openai',
    vision: false,
    note: '（填 Key 后拉取选模型）',
  },
  {
    id: 'qwen-vl',
    label: '通义千问 VL',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: '',
    apiStyle: 'openai',
    vision: true,
    note: '（填 Key 后拉取选模型）',
  },
  {
    id: 'qwen',
    label: '通义千问',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: '',
    apiStyle: 'openai',
    vision: false,
    note: '（填 Key 后拉取选模型）',
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    model: '',
    apiStyle: 'openai',
    vision: false,
    note: '（填 Key 后拉取选模型）',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    model: '',
    apiStyle: 'openai',
    vision: true,
    note: '（填 Key 后拉取选模型）',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    baseURL: 'http://127.0.0.1:11434/v1',
    model: '',
    apiStyle: 'openai',
    vision: false,
    keyOptional: true,
    note: '（填 Key 后拉取选模型）',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    baseURL: 'http://127.0.0.1:1234/v1',
    model: '',
    apiStyle: 'openai',
    vision: false,
    keyOptional: true,
    note: '（填 Key 后拉取选模型）',
  },
  {
    id: 'custom',
    label: '自定义模型',
    baseURL: '',
    model: '',
    apiStyle: 'openai',
    vision: false,
    note: '自定义地址',
  },
];

const TABS = [
  ['model', '◈', '模型'],
  ['judge', '◉', '判题'],
  ['vision', '▣', '读图'],
  ['run', '▷', '运行'],
  ['backup', '⇅', '备份'],
  ['diag', '◎', '诊断'],
] as const;

type TabId = (typeof TABS)[number][0];

const JUDGE_LEVELS = [
  ['single', '省 token', '一个模型直接答，最快最便宜'],
  ['fast', '快速', '一个模型连答几次，取一致的'],
  ['council', '标准（推荐）', '多个模型各自答，再投票'],
  ['max', '严格', '投票 + 交叉复核 + 仲裁，最准也最慢'],
] as const;

function uid(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function makeProvider(preset: Preset): ProviderConfig {
  return {
    id: uid(),
    label: preset.label,
    baseURL: preset.baseURL,
    apiKey: '',
    model: preset.model,
    apiStyle: preset.apiStyle,
    role: preset.vision ? 'vision' : 'fast',
    weight: 1,
    temperature: 0.1,
    vision: preset.vision,
  };
}

/** 当前判题强度：由模型数量 + 复核开关反推，给向导/面板显示。 */
function strengthOf(config: AppConfig): string {
  if (config.engine.maxArbiter > 0) return 'max';
  if (config.engine.maxVerify > 0) return 'council';
  return 'single';
}

export function SettingsPanel(props: SettingsPanelProps) {
  const { config, onChange } = props;
  const [tab, setTab] = useState<TabId>('model');
  const [advanced, setAdvanced] = useState(false);
  const [importText, setImportText] = useState('');
  const [pick, setPick] = useState('deepseek');
  const [draft, setDraft] = useState({ baseURL: '', apiKey: '', model: '' });
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const [strengthChoice, setStrengthChoice] = useState('');

  const enabledCount = config.providers.filter((p) => p.role !== 'vision' || p.vision).length;
  const visionProviders = config.providers.filter((p) => p.vision || p.role === 'vision');
  const preset = PRESETS.find((p) => p.id === pick) || PRESETS[0];
  const strength = strengthChoice || strengthOf(config);

  const patchEngine = (patch: Partial<AppConfig['engine']>) =>
    onChange({ ...config, engine: { ...config.engine, ...patch } });
  const patchApply = (patch: Partial<AppConfig['apply']>) =>
    onChange({ ...config, apply: { ...config.apply, ...patch } });
  const patchUi = (patch: Partial<AppConfig['ui']>) => onChange({ ...config, ui: { ...config.ui, ...patch } });

  const updateProvider = (index: number, patch: Partial<ProviderConfig>) =>
    onChange({
      ...config,
      providers: config.providers.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    });

  const addFromPreset = () => {
    const next = makeProvider({
      ...preset,
      baseURL: draft.baseURL.trim() || preset.baseURL,
      model: draft.model.trim() || preset.model,
    });
    next.apiKey = draft.apiKey.trim();
    onChange({ ...config, providers: [...config.providers, next] });
    setDraft({ baseURL: '', apiKey: '', model: '' });
  };

  const removeProvider = (index: number) =>
    onChange({ ...config, providers: config.providers.filter((_, i) => i !== index) });

  const exportMasked = () => {
    const clone = {
      ...config,
      providers: config.providers.map((p) => ({ ...p, apiKey: p.apiKey ? '***' : '' })),
    };
    const blob = new Blob([JSON.stringify(clone, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cx-exam-ai-diag-${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const statusBad = !!props.syncStatus && /失败|错误/.test(props.syncStatus);

  const head = (
    <div className="cxset-top">
      <div className="cxset-logo">CX</div>
      <div className="cxset-title">
        考试 AI 大脑 <small>设置中心</small>
      </div>
      <span className="cxset-pill ok">本地存储</span>
      <span className="cxset-pill">{enabledCount} 个已启用模型</span>
      <div className="spacer" />
      <button
        className="cxset-btn adv"
        onClick={() => void props.onGenerateAndPush()}
        disabled={props.busy || !config.providers.length}
      >
        生成同步码并上传
      </button>
      <button className={`cxset-btn${advanced ? '' : ' adv'}`} onClick={() => setAdvanced((v) => !v)}>
        {advanced ? '切回简单设置' : '高级设置'}
      </button>
      <button className="cxset-btn" onClick={() => void props.onSave()} disabled={props.busy}>
        保存
      </button>
      <span className="cxset-pill">v2.0.0</span>
    </div>
  );

  const nav = (
    <nav className="cxset-nav">
      <div className="hd">配置分类</div>
      {TABS.map(([id, icon, label]) => (
        <div
          key={id}
          className={`it${tab === id ? ' on' : ''}`}
          onClick={() => setTab(id as TabId)}
          role="button"
          tabIndex={0}
        >
          <span className="ic">{icon}</span>
          {label}
        </div>
      ))}
      <div className="foot">
        改动即时生效<br />
        考试页悬浮球 → 双击打开面板<br />
        默认只出答案表，不自动交卷
      </div>
    </nav>
  );

  const modelPane = (
    <>
      {config.providers.length === 0 ? (
        <>
          <div className="cxset-steps">
            {['添加模型', '判题强度', '读图'].map((name, i) => (
              <span key={name} className={`st${i === 0 ? ' on' : ''}`}>
                <b>{i + 1}</b>
                {name}
                {i < 2 ? <i className="ln" /> : null}
              </span>
            ))}
          </div>
          <section className="cxset-card">
            <h2>
              先加模型 <span className="tag">第 1 步 / 共 3 步 · 可加多个</span>
            </h2>
            <p className="desc">
              判题时多个模型会各自作答再投票，所以这里可以加好几个：选一家、填 Key、点「添加这个模型」，想加第二个就再选一次。
              用本地网关（Ollama / LM Studio 等）的话 Key 可以留空。
            </p>
            <div className="cxset-sub">选一家：</div>
            <div className="cxset-presets">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={`cxset-pre${pick === p.id ? ' on' : ''}`}
                  onClick={() => {
                    setPick(p.id);
                    setDraft({ baseURL: '', apiKey: '', model: '' });
                  }}
                >
                  <span className="nm">{p.label}</span>
                  <span className="bd">{p.model || p.note}</span>
                  <span className="bs">{p.baseURL.replace(/^https?:\/\//, '') || '自定义地址'}</span>
                  {pick === p.id ? <span className="go">已选中 ↓</span> : null}
                </button>
              ))}
            </div>
            <div className="cxset-grid" style={{ marginTop: 16 }}>
              {pick === 'custom' ? (
                <div className="cxset-fld" style={{ gridColumn: '1 / -1' }}>
                  <label>Base URL（必填）</label>
                  <input
                    className="cxset-in"
                    value={draft.baseURL}
                    placeholder="https://你的端点/v1"
                    onChange={(e) => setDraft({ ...draft, baseURL: e.target.value })}
                  />
                  <div className="hint">默认按 OpenAI 协议发请求（POST {'{base}'}/chat/completions）。</div>
                </div>
              ) : null}
              <div className="cxset-fld">
                <label>API Key{preset.keyOptional ? '（这家可留空）' : ''}</label>
                <input
                  className="cxset-in"
                  type="password"
                  autoComplete="off"
                  value={draft.apiKey}
                  placeholder={preset.keyOptional ? '本地网关随便填，或留空' : 'sk-…'}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                />
              </div>
              <div className="cxset-fld">
                <label>模型名</label>
                <input
                  className="cxset-in"
                  value={draft.model}
                  placeholder="留空也行，加完点「拉取」按清单选"
                  onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                />
                <div className="hint">模型名以端点最新返回的清单为准，所以默认不预设</div>
              </div>
            </div>
            <div className="cxset-row" style={{ marginTop: 16 }}>
              <button className="cxset-btn pri" onClick={addFromPreset}>
                + 添加这个模型
              </button>
              <span className="hint" style={{ flex: 1 }}>
                上面点一家，再填 Key。已经有清单里的模型就直接点「下一步」。
              </span>
              <button className="cxset-btn" onClick={() => setTab('judge')}>
                下一步 →
              </button>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="cxset-card">
            <h2>
              已添加的模型 <span className="tag">{config.providers.length} 个 · 判题会一起参与</span>
            </h2>
            <p className="desc">
              fast 负责首批快答，verify 负责低置信度复核，vision 负责图片题。点标题行展开改参数。
            </p>
            {config.providers.map((p, i) => {
              const open = openIds[p.id] ?? i === 0;
              return (
                <div key={p.id || i} className="cxset-pv" data-open={open ? '1' : '0'}>
                  <div
                    className="cxset-ph"
                    onClick={() => setOpenIds({ ...openIds, [p.id]: !open })}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="dot" />
                    <span className="nm">{p.label || `模型 ${i + 1}`}</span>
                    <span className="pm">{p.model || '（未选模型）'}</span>
                    <span className="chip">{p.role === 'vision' ? '读图' : p.role === 'verify' ? '复核' : p.role === 'both' ? '通用' : '快答'}</span>
                    <span className="del" onClick={(e) => { e.stopPropagation(); removeProvider(i); }}>
                      删除
                    </span>
                  </div>
                  <div className="cxset-pb">
                    <div className="cxset-grid">
                      <div className="cxset-fld">
                        <label>名称</label>
                        <input
                          className="cxset-in"
                          value={p.label}
                          onChange={(e) => updateProvider(i, { label: e.target.value })}
                        />
                      </div>
                      <div className="cxset-fld">
                        <label>角色</label>
                        <select
                          className="cxset-sel"
                          value={p.role}
                          onChange={(e) => updateProvider(i, { role: e.target.value as ProviderConfig['role'] })}
                        >
                          <option value="fast">fast · 快答</option>
                          <option value="verify">verify · 复核</option>
                          <option value="vision">vision · 读图</option>
                          <option value="both">both · 通用</option>
                        </select>
                      </div>
                      <div className="cxset-fld" style={{ gridColumn: '1 / -1' }}>
                        <label>Base URL</label>
                        <input
                          className="cxset-in"
                          placeholder="https://api.deepseek.com/v1"
                          value={p.baseURL}
                          onChange={(e) => updateProvider(i, { baseURL: e.target.value })}
                        />
                      </div>
                      <div className="cxset-fld">
                        <label>API Key</label>
                        <input
                          className="cxset-in"
                          type="password"
                          value={p.apiKey}
                          onChange={(e) => updateProvider(i, { apiKey: e.target.value })}
                        />
                      </div>
                      <div className="cxset-fld">
                        <label>模型名</label>
                        <input
                          className="cxset-in"
                          value={p.model}
                          onChange={(e) => updateProvider(i, { model: e.target.value })}
                        />
                      </div>
                      <div className="cxset-fld">
                        <label>协议</label>
                        <select
                          className="cxset-sel"
                          value={p.apiStyle}
                          onChange={(e) =>
                            updateProvider(i, { apiStyle: e.target.value as ProviderConfig['apiStyle'] })
                          }
                        >
                          <option value="openai">OpenAI 兼容</option>
                          <option value="anthropic">Anthropic</option>
                          <option value="gemini">Gemini</option>
                        </select>
                      </div>
                      <div className="cxset-fld">
                        <label>权重</label>
                        <input
                          className="cxset-in"
                          type="number"
                          min="0.1"
                          step="0.1"
                          value={p.weight}
                          onChange={(e) => updateProvider(i, { weight: Number(e.target.value) || 1 })}
                        />
                      </div>
                    </div>
                    <div className="cxset-row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                      <label className="cxset-chk">
                        <input
                          type="checkbox"
                          checked={!!p.vision}
                          onChange={(e) => updateProvider(i, { vision: e.target.checked })}
                        />
                        支持视觉
                      </label>
                      <div style={{ flex: 1 }} />
                      {props.onListModels ? (
                        <button className="cxset-btn mini" onClick={() => void props.onListModels?.(p)}>
                          拉取模型
                        </button>
                      ) : null}
                      {props.onTestProvider ? (
                        <button className="cxset-btn mini" onClick={() => void props.onTestProvider?.(p)}>
                          测试连通
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
          <section className="cxset-card">
            <h2>再加一个 <span className="tag">可选</span></h2>
            <p className="desc">
              加第二个模型后，低置信度的题会由它复核一遍。点下面的卡片只是选中预设，填好 Key 再点「添加这个模型」。
            </p>
            <div className="cxset-presets">
              {PRESETS.filter((p) => p.id !== 'custom').map((p) => (
                <button
                  key={p.id}
                  className={`cxset-pre${pick === p.id ? ' on' : ''}`}
                  onClick={() => {
                    setPick(p.id);
                    setDraft({ baseURL: '', apiKey: '', model: '' });
                  }}
                >
                  <span className="nm">{p.label}</span>
                  <span className="bd">{p.model || p.note}</span>
                  <span className="bs">{p.baseURL.replace(/^https?:\/\//, '')}</span>
                  {pick === p.id ? <span className="go">已选中 ↓</span> : null}
                </button>
              ))}
            </div>
            <div className="cxset-grid" style={{ marginTop: 14 }}>
              <div className="cxset-fld">
                <label>API Key{preset.keyOptional ? '（这家可留空）' : ''}</label>
                <input
                  className="cxset-in"
                  type="password"
                  autoComplete="off"
                  value={draft.apiKey}
                  placeholder={preset.keyOptional ? '本地网关随便填，或留空' : 'sk-…'}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                />
              </div>
              <div className="cxset-fld">
                <label>模型名</label>
                <input
                  className="cxset-in"
                  value={draft.model}
                  placeholder="留空也行，加完点「拉取」按清单选"
                  onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                />
              </div>
            </div>
            <div className="cxset-row" style={{ marginTop: 12 }}>
              <button className="cxset-btn pri" onClick={addFromPreset}>
                + 添加这个模型
              </button>
              <span className="hint">{preset.baseURL || '自定义地址'}</span>
            </div>
          </section>
        </>
      )}
    </>
  );

  const judgePane = (
    <>
      <section className="cxset-card">
        <h2>判题要多严格 <span className="tag">当前：{JUDGE_LEVELS.find((x) => x[0] === strength)?.[1]}</span></h2>
        <p className="desc">只有一个模型时选「标准」也没问题 —— 脚本会自动降级成单模型多次采样，不会卡住。</p>
        <div className="cxset-choices">
          {JUDGE_LEVELS.map(([v, title, desc]) => (
            <button
              key={v}
              className={`cxset-choice${strength === v ? ' on' : ''}`}
              onClick={() => {
                setStrengthChoice(v);
                if (v === 'single') {
                  onChange({ ...config, engine: { ...config.engine, maxVerify: 0, maxArbiter: 0 } });
                } else if (v === 'fast') {
                  onChange({ ...config, engine: { ...config.engine, maxVerify: 1, maxArbiter: 0 } });
                } else if (v === 'council') {
                  onChange({ ...config, engine: { ...config.engine, maxVerify: 1, maxArbiter: 0 } });
                } else {
                  onChange({ ...config, engine: { ...config.engine, maxVerify: 1, maxArbiter: 1 } });
                }
              }}
            >
              <b>{title}</b>
              <span>{desc}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="cxset-card">
        <h2>速度与超时</h2>
        <p className="desc">首轮按批快答；批量 JSON 解析失败会二分拆批，最小拆到单题，不整卷重来。</p>
        <div className="cxset-grid g3">
          <div className="cxset-fld">
            <label>批量题数</label>
            <input
              className="cxset-in"
              type="number"
              min="1"
              max="20"
              value={config.engine.batchSize}
              onChange={(e) => patchEngine({ batchSize: Number(e.target.value) || 10 })}
            />
          </div>
          <div className="cxset-fld">
            <label>批量字符上限</label>
            <input
              className="cxset-in"
              type="number"
              min="1000"
              step="500"
              value={config.engine.batchChars}
              onChange={(e) => patchEngine({ batchChars: Number(e.target.value) || 6000 })}
            />
          </div>
          <div className="cxset-fld">
            <label>并发</label>
            <input
              className="cxset-in"
              type="number"
              min="1"
              max="8"
              value={config.engine.concurrency}
              onChange={(e) => patchEngine({ concurrency: Number(e.target.value) || 4 })}
            />
          </div>
          <div className="cxset-fld">
            <label>复核阈值</label>
            <input
              className="cxset-in"
              type="number"
              min="0.1"
              max="1"
              step="0.05"
              value={config.engine.verifyThreshold}
              onChange={(e) => patchEngine({ verifyThreshold: Number(e.target.value) || 0.65 })}
            />
          </div>
          <div className="cxset-fld">
            <label>单请求超时 (ms)</label>
            <input
              className="cxset-in"
              type="number"
              min="5000"
              step="1000"
              value={config.engine.requestTimeoutMs}
              onChange={(e) => patchEngine({ requestTimeoutMs: Number(e.target.value) || 25000 })}
            />
          </div>
          <div className="cxset-fld">
            <label>单题超时 (ms)</label>
            <input
              className="cxset-in"
              type="number"
              min="5000"
              step="1000"
              value={config.engine.questionTimeoutMs}
              onChange={(e) => patchEngine({ questionTimeoutMs: Number(e.target.value) || 15000 })}
            />
          </div>
        </div>
      </section>
      <section className="cxset-card">
        <h2>填写规则</h2>
        <label className="cxset-chk">
          <input
            type="checkbox"
            checked={config.apply.clearExtra}
            onChange={(e) => patchApply({ clearExtra: e.target.checked })}
          />
          多选时清掉与目标答案不一致的已选项
        </label>
        <label className="cxset-chk">
          <input
            type="checkbox"
            checked={config.ui.riskDefaultExcluded}
            onChange={(e) => patchUi({ riskDefaultExcluded: e.target.checked })}
          />
          风险题默认不勾选（低置信度、复核分歧、字母歧义）
        </label>
        {advanced ? (
          <div className="cxset-grid g3" style={{ marginTop: 10 }}>
            <div className="cxset-fld">
              <label>落盘后等保存 (ms)</label>
              <input
                className="cxset-in"
                type="number"
                min="0"
                step="50"
                value={config.apply.saveQuietMs}
                onChange={(e) => patchApply({ saveQuietMs: Number(e.target.value) || 450 })}
              />
            </div>
            <div className="cxset-fld">
              <label>校验等待 (ms)</label>
              <input
                className="cxset-in"
                type="number"
                min="200"
                step="100"
                value={config.apply.verifyTimeoutMs}
                onChange={(e) => patchApply({ verifyTimeoutMs: Number(e.target.value) || 1600 })}
              />
            </div>
            <div className="cxset-fld">
              <label>点击重试次数</label>
              <input
                className="cxset-in"
                type="number"
                min="0"
                max="3"
                value={config.apply.maxActionRetries}
                onChange={(e) => patchApply({ maxActionRetries: Number(e.target.value) || 1 })}
              />
            </div>
          </div>
        ) : null}
      </section>
    </>
  );

  const visionPane = (
    <section className="cxset-card">
      <h2>图片题 <span className="tag">逐题处理，不进批量</span></h2>
      <p className="desc">
        带图的题会单独交给能看图的模型（或先 OCR 转文字再判）。v2 复用第一代的压缩、直传、PDF 页图与字体解密能力。
      </p>
      {visionProviders.length ? (
        <div className="cxset-added">
          <div className="cxset-added-hd">已标记为视觉模型的 {visionProviders.length} 个</div>
          {visionProviders.map((p) => (
            <div className="cxset-added-row" key={p.id}>
              <span className="dot" />
              <span className="nm">{p.label}</span>
              <span className="md">{p.model || '（未选模型）'}</span>
              <span className="bs">{p.baseURL}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="cxset-note">
          还没有视觉模型。到「模型」里给某个模型勾上「支持视觉」，并把角色设为 vision 或 both。
        </div>
      )}
      <div className="cxset-grid" style={{ marginTop: 12 }}>
        <div className="cxset-fld">
          <label>没有视觉模型时</label>
          <select
            className="cxset-sel"
            value={config.ui.showServerKey ? 'show' : 'hide'}
            onChange={(e) => patchUi({ showServerKey: e.target.value === 'show' })}
          >
            <option value="show">照常显示页面显示字母 + 服务端键</option>
            <option value="hide">只显示页面显示字母</option>
          </select>
          <div className="hint">选项乱序（randomOptions）时服务端键和显示字母不是一套，默认两个都留。</div>
        </div>
      </div>
    </section>
  );

  const runPane = (
    <>
      <section className="cxset-card">
        <h2>打开考试页之后</h2>
        <p className="desc">默认只读页面、只缓存答案，绝不自动点击、绝不自动交卷。</p>
        <label className="cxset-chk">
          <input
            type="checkbox"
            checked={config.ui.autoStart !== false}
            onChange={(e) => patchUi({ autoStart: e.target.checked })}
          />
          自动预取/缓存答案（后台判题，不点选项）
        </label>
        <label className="cxset-chk">
          <input
            type="checkbox"
            checked={config.ui.autoEnterPreview}
            onChange={(e) => patchUi({ autoEnterPreview: e.target.checked })}
          />
          检测到整卷预览入口时自动进入（3 秒可取消）
        </label>
        <label className="cxset-chk">
          <input
            type="checkbox"
            checked={config.ui.showServerKey}
            onChange={(e) => patchUi({ showServerKey: e.target.checked })}
          />
          答案表里显示服务端提交键（排查乱序题用）
        </label>
      </section>
      <section className="cxset-card">
        <h2>运行方式</h2>
        <div className="cxset-kv">
          <span className="k">单击悬浮球</span>
          <span className="v">按当前模式运行（答一题 / 全部填写），都会先跳到第一道未答题</span>
          <span className="k">长按悬浮球</span>
          <span className="v">切换「答一题 ↔ 全部填写」</span>
          <span className="k">双击悬浮球</span>
          <span className="v">打开/收起工作台面板</span>
          <span className="k">自动交卷</span>
          <span className="v">永不自动交卷，填完请自己复核后手动提交</span>
        </div>
      </section>
    </>
  );

  const backupPane = (
    <>
      <section className="cxset-card">
        <h2>云同步 <span className="tag">配置在浏览器内加密后上传，密钥不上传</span></h2>
        <div className="cxset-grid">
          <div className="cxset-fld">
            <label>同步码</label>
            <input
              className="cxset-in"
              placeholder="abc12345.xyz…"
              value={config.sync.code}
              onChange={(e) => props.onSyncCodeChange(e.target.value)}
            />
            <div className="hint">考试页面板里 ⇅ 粘同一个码，就能拉到这份配置。</div>
          </div>
        </div>
        <div className="cxset-row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          <button className="cxset-btn pri" onClick={() => void props.onGenerateAndPush()} disabled={props.busy}>
            生成并上传
          </button>
          <button className="cxset-btn" onClick={() => void props.onPull()} disabled={props.busy || !config.sync.code}>
            拉取
          </button>
          <button
            className="cxset-btn"
            onClick={() => void props.onImportLegacy()}
            disabled={props.busy || !config.sync.code}
          >
            从旧版导入
          </button>
          {props.syncStatus ? (
            <span className={statusBad ? 'cxset-bad' : 'hint'} style={{ flex: 1 }}>
              {props.syncStatus}
            </span>
          ) : null}
        </div>
      </section>
      <section className="cxset-card">
        <h2>配置文件</h2>
        <div className="cxset-row" style={{ marginBottom: 10 }}>
          <button className="cxset-btn" onClick={props.onExport}>
            导出 JSON
          </button>
          <span className="hint">导出含 API Key，别发群里。</span>
        </div>
        <textarea
          className="cxset-ta"
          placeholder="粘贴 JSON 后点导入"
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />
        <button
          className="cxset-btn"
          style={{ marginTop: 8 }}
          onClick={() => void props.onImport(importText)}
          disabled={!importText.trim()}
        >
          导入 JSON
        </button>
      </section>
    </>
  );

  const diagPane = (
    <>
      <section className="cxset-card">
        <h2>诊断</h2>
        <p className="desc">
          每题都会记录：页面 URL、qid、题干哈希、选项三元组、模型原始输出、落盘前后隐藏域、点击计划与耗时。
          考试页工作台里点「导出」拿单场诊断；这里导出的是配置快照（API Key 自动打码）。
        </p>
        <div className="cxset-kv">
          <span className="k">模型</span>
          <span className="v">{config.providers.length} 个（{enabledCount} 个参与判题）</span>
          <span className="k">判题强度</span>
          <span className="v">{JUDGE_LEVELS.find((x) => x[0] === strength)?.[1] || '-'}</span>
          <span className="k">批量</span>
          <span className="v">
            {config.engine.batchSize} 题 / {config.engine.batchChars} 字符 · 并发 {config.engine.concurrency}
          </span>
          <span className="k">风险题</span>
          <span className="v">{config.ui.riskDefaultExcluded ? '默认不填' : '默认填入（不推荐）'}</span>
          <span className="k">自动交卷</span>
          <span className="v">关闭（v2 不提供）</span>
        </div>
        <div className="cxset-row" style={{ marginTop: 12 }}>
          <button className="cxset-btn" onClick={exportMasked}>
            导出配置快照（打码）
          </button>
          <button className="cxset-btn" onClick={() => void props.onSave()} disabled={props.busy}>
            保存当前设置
          </button>
        </div>
      </section>
      <section className="cxset-card">
        <h2>已知限制</h2>
        <div className="cxset-note">
          <b>仅考试页</b>：作业、章节测验、刷课不在 v2 范围内，非考试页不注入、不提示。<br />
          <b>不自动交卷</b>：填完点工作台的「刷新复核」，逐题比对服务端渲染值后再自己提交。<br />
          <b>不猜着点</b>：点击后状态没变化只换该选项的另一个明确节点重试一次，仍失败立即标「需人工」并停住。
        </div>
      </section>
    </>
  );

  const pane = useMemo(() => {
    switch (tab) {
      case 'judge':
        return judgePane;
      case 'vision':
        return visionPane;
      case 'run':
        return runPane;
      case 'backup':
        return backupPane;
      case 'diag':
        return diagPane;
      default:
        return modelPane;
    }
  }, [tab, config, advanced, pick, draft, openIds, strengthChoice, props.busy, props.syncStatus, importText]);

  return (
    <div className="cxset-root">
      {head}
      <div className="cxset-layout">
        {nav}
        <main className="cxset-main">
          {pane}
          {props.onClose ? (
            <div className="cxset-row" style={{ marginTop: 14 }}>
              <button className="cxset-btn" onClick={props.onClose}>
                返回
              </button>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
