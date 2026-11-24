import * as Tabs from '@radix-ui/react-tabs';
import { useState } from 'react';
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

const EMPTY_PROVIDER: ProviderConfig = {
  id: '',
  label: '新模型',
  baseURL: '',
  apiKey: '',
  model: '',
  apiStyle: 'openai',
  role: 'fast',
  weight: 1,
  temperature: 0.1,
  vision: false,
};

function makeId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function SettingsPanel(props: SettingsPanelProps) {
  const { config, onChange } = props;
  const [importText, setImportText] = useState('');
  const [tab, setTab] = useState('models');

  const updateProvider = (index: number, patch: Partial<ProviderConfig>) => {
    const providers = config.providers.map((provider, i) => (i === index ? { ...provider, ...patch } : provider));
    onChange({ ...config, providers });
  };

  const addProvider = () => {
    onChange({
      ...config,
      providers: [...config.providers, { ...EMPTY_PROVIDER, id: makeId() }],
    });
  };

  const removeProvider = (index: number) => {
    onChange({ ...config, providers: config.providers.filter((_, i) => i !== index) });
  };

  return (
    <div className="cxai-settings">
      <div className="cxai-settings-head">
        <strong>设置</strong>
        <span className="cxai-actions">
          <button className="cxai-btn cxai-btn-primary" onClick={() => void props.onSave()} disabled={props.busy}>
            保存
          </button>
          {props.onClose ? (
            <button className="cxai-btn" onClick={props.onClose}>
              返回
            </button>
          ) : null}
        </span>
      </div>
      <div className="cxai-settings-body">
        <Tabs.Root value={tab} onValueChange={setTab}>
          <Tabs.List className="cxai-tabs">
            <Tabs.Trigger className="cxai-tab" data-active={tab === 'models'} value="models">
              模型
            </Tabs.Trigger>
            <Tabs.Trigger className="cxai-tab" data-active={tab === 'engine'} value="engine">
              判题
            </Tabs.Trigger>
            <Tabs.Trigger className="cxai-tab" data-active={tab === 'sync'} value="sync">
              同步
            </Tabs.Trigger>
            <Tabs.Trigger className="cxai-tab" data-active={tab === 'about'} value="about">
              关于
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="models">
            <div className="cxai-card-head">
              <span className="cxai-muted small">
                fast 负责首批快答，verify 负责低置信度复核，vision 负责图片题。
              </span>
              <button className="cxai-btn" onClick={addProvider}>
                + 添加模型
              </button>
            </div>
            {config.providers.length === 0 ? (
              <div className="cxai-card cxai-muted">
                还没有模型。先添加一个 OpenAI 兼容端点，填 Base URL、API Key、模型名，角色选 fast。
              </div>
            ) : null}
            {config.providers.map((provider, index) => (
              <div className="cxai-card" key={provider.id || index}>
                <div className="cxai-card-head">
                  <strong>{provider.label || provider.id}</strong>
                  <span className="cxai-actions">
                    {props.onListModels ? (
                      <button className="cxai-btn" onClick={() => void props.onListModels?.(provider)}>
                        拉取模型
                      </button>
                    ) : null}
                    {props.onTestProvider ? (
                      <button className="cxai-btn" onClick={() => void props.onTestProvider?.(provider)}>
                        测试
                      </button>
                    ) : null}
                    <button className="cxai-btn" onClick={() => removeProvider(index)}>
                      删除
                    </button>
                  </span>
                </div>
                <div className="cxai-grid2">
                  <div className="cxai-field">
                    <label>名称</label>
                    <input
                      className="cxai-input"
                      value={provider.label}
                      onChange={(e) => updateProvider(index, { label: e.target.value })}
                    />
                  </div>
                  <div className="cxai-field">
                    <label>角色</label>
                    <select
                      className="cxai-input"
                      value={provider.role}
                      onChange={(e) => updateProvider(index, { role: e.target.value as ProviderConfig['role'] })}
                    >
                      <option value="fast">fast · 快答</option>
                      <option value="verify">verify · 复核</option>
                      <option value="vision">vision · 读图</option>
                      <option value="both">both · 通用</option>
                    </select>
                  </div>
                </div>
                <div className="cxai-field">
                  <label>Base URL</label>
                  <input
                    className="cxai-input"
                    placeholder="https://api.deepseek.com/v1"
                    value={provider.baseURL}
                    onChange={(e) => updateProvider(index, { baseURL: e.target.value })}
                  />
                </div>
                <div className="cxai-grid2">
                  <div className="cxai-field">
                    <label>API Key</label>
                    <input
                      className="cxai-input"
                      type="password"
                      value={provider.apiKey}
                      onChange={(e) => updateProvider(index, { apiKey: e.target.value })}
                    />
                  </div>
                  <div className="cxai-field">
                    <label>模型名</label>
                    <input
                      className="cxai-input"
                      value={provider.model}
                      onChange={(e) => updateProvider(index, { model: e.target.value })}
                    />
                  </div>
                </div>
                <div className="cxai-grid2">
                  <div className="cxai-field">
                    <label>协议</label>
                    <select
                      className="cxai-input"
                      value={provider.apiStyle}
                      onChange={(e) =>
                        updateProvider(index, { apiStyle: e.target.value as ProviderConfig['apiStyle'] })
                      }
                    >
                      <option value="openai">OpenAI 兼容</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="gemini">Gemini</option>
                    </select>
                  </div>
                  <div className="cxai-field">
                    <label>权重</label>
                    <input
                      className="cxai-input"
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={provider.weight}
                      onChange={(e) => updateProvider(index, { weight: Number(e.target.value) || 1 })}
                    />
                  </div>
                </div>
                <label className="cxai-dialog-row">
                  <input
                    type="checkbox"
                    checked={!!provider.vision}
                    onChange={(e) => updateProvider(index, { vision: e.target.checked })}
                  />
                  支持视觉
                </label>
              </div>
            ))}
          </Tabs.Content>

          <Tabs.Content value="engine">
            <div className="cxai-card">
              <div className="cxai-grid2">
                <div className="cxai-field">
                  <label>批量题数</label>
                  <input
                    className="cxai-input"
                    type="number"
                    min="1"
                    max="20"
                    value={config.engine.batchSize}
                    onChange={(e) =>
                      onChange({ ...config, engine: { ...config.engine, batchSize: Number(e.target.value) || 10 } })
                    }
                  />
                </div>
                <div className="cxai-field">
                  <label>批量字符上限</label>
                  <input
                    className="cxai-input"
                    type="number"
                    min="1000"
                    step="500"
                    value={config.engine.batchChars}
                    onChange={(e) =>
                      onChange({ ...config, engine: { ...config.engine, batchChars: Number(e.target.value) || 6000 } })
                    }
                  />
                </div>
                <div className="cxai-field">
                  <label>并发</label>
                  <input
                    className="cxai-input"
                    type="number"
                    min="1"
                    max="8"
                    value={config.engine.concurrency}
                    onChange={(e) =>
                      onChange({ ...config, engine: { ...config.engine, concurrency: Number(e.target.value) || 4 } })
                    }
                  />
                </div>
                <div className="cxai-field">
                  <label>复核阈值</label>
                  <input
                    className="cxai-input"
                    type="number"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={config.engine.verifyThreshold}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        engine: { ...config.engine, verifyThreshold: Number(e.target.value) || 0.65 },
                      })
                    }
                  />
                </div>
              </div>
              <div className="cxai-grid2">
                <div className="cxai-field">
                  <label>单请求超时 (ms)</label>
                  <input
                    className="cxai-input"
                    type="number"
                    min="5000"
                    step="1000"
                    value={config.engine.requestTimeoutMs}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        engine: { ...config.engine, requestTimeoutMs: Number(e.target.value) || 25000 },
                      })
                    }
                  />
                </div>
                <div className="cxai-field">
                  <label>单题超时 (ms)</label>
                  <input
                    className="cxai-input"
                    type="number"
                    min="5000"
                    step="1000"
                    value={config.engine.questionTimeoutMs}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        engine: { ...config.engine, questionTimeoutMs: Number(e.target.value) || 15000 },
                      })
                    }
                  />
                </div>
              </div>
            </div>
            <div className="cxai-card">
              <label className="cxai-dialog-row">
                <input
                  type="checkbox"
                  checked={config.apply.clearExtra}
                  onChange={(e) =>
                    onChange({ ...config, apply: { ...config.apply, clearExtra: e.target.checked } })
                  }
                />
                多选时清掉与目标答案不一致的已选项
              </label>
              <label className="cxai-dialog-row">
                <input
                  type="checkbox"
                  checked={config.ui.riskDefaultExcluded}
                  onChange={(e) =>
                    onChange({ ...config, ui: { ...config.ui, riskDefaultExcluded: e.target.checked } })
                  }
                />
                风险题默认不勾选
              </label>
              <label className="cxai-dialog-row">
                <input
                  type="checkbox"
                  checked={config.ui.autoEnterPreview}
                  onChange={(e) =>
                    onChange({ ...config, ui: { ...config.ui, autoEnterPreview: e.target.checked } })
                  }
                />
                检测到整卷预览时自动进入（3 秒可取消）
              </label>
            </div>
          </Tabs.Content>

          <Tabs.Content value="sync">
            <div className="cxai-card">
              <div className="cxai-field">
                <label>同步码</label>
                <input
                  className="cxai-input"
                  placeholder="abc12345.xyz…"
                  value={config.sync.code}
                  onChange={(e) => props.onSyncCodeChange(e.target.value)}
                />
              </div>
              <div className="cxai-card-head">
                <span className="cxai-muted small">配置在浏览器内加密后上传，密钥不上传。</span>
                <span className="cxai-actions">
                  <button className="cxai-btn" onClick={() => void props.onGenerateAndPush()} disabled={props.busy}>
                    生成并上传
                  </button>
                  <button className="cxai-btn" onClick={() => void props.onPull()} disabled={props.busy || !config.sync.code}>
                    拉取
                  </button>
                  <button className="cxai-btn" onClick={() => void props.onImportLegacy()} disabled={props.busy || !config.sync.code}>
                    从旧版导入
                  </button>
                </span>
              </div>
              {props.syncStatus ? <div className={props.syncStatus.includes('失败') ? 'cxai-error' : 'cxai-muted'}>{props.syncStatus}</div> : null}
            </div>
            <div className="cxai-card">
              <div className="cxai-card-head">
                <strong>配置文件</strong>
                <button className="cxai-btn" onClick={props.onExport}>
                  导出 JSON
                </button>
              </div>
              <textarea
                className="cxai-textarea"
                placeholder="粘贴 JSON 后点导入"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <button
                className="cxai-btn"
                onClick={() => void props.onImport(importText)}
                disabled={!importText.trim()}
              >
                导入 JSON
              </button>
            </div>
          </Tabs.Content>

          <Tabs.Content value="about">
            <div className="cxai-card">
              <strong>CX 考试 AI 大脑 v2.0.0</strong>
              <p className="cxai-muted">
                考试专用，默认半自动：先出答案表，确认后串行填写；风险题默认不填；永不自动交卷。
              </p>
              <p className="cxai-muted small">
                选项同时保留页面显示字母与服务端提交键，模型只回答 O1…On 内部 ID，避免随机选项下点错。
              </p>
            </div>
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </div>
  );
}
