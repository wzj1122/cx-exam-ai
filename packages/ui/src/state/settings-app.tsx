import { useEffect, useState } from 'react';
import {
  DEFAULT_CONFIG,
  listModels,
  pingProvider,
  type AppConfig,
  type ConfigStore,
  type HttpTransport,
  type ProviderConfig,
  type SyncClient,
} from '@cx/core';
import { SettingsPanel } from '../components/SettingsPanel';

export interface SettingsAppProps {
  configStore: ConfigStore;
  syncClient: SyncClient;
  transport: HttpTransport;
}

export function SettingsApp({ configStore, syncClient, transport }: SettingsAppProps) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    void configStore.load().then((next) => {
      setConfig(next);
      setLoaded(true);
    });
  }, [configStore]);

  const apply = async (next: AppConfig) => {
    const saved = await configStore.save(next);
    setConfig(saved);
  };

  const save = async () => {
    setBusy(true);
    try {
      await apply(config);
      setStatus('设置已保存');
    } catch (error) {
      setStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const exportConfig = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cx-exam-ai-config-${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importConfig = async (text: string) => {
    try {
      const next = await configStore.importJson(text);
      setConfig(next);
      setStatus('配置已导入');
    } catch (error) {
      setStatus(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const generateAndPush = async () => {
    setBusy(true);
    try {
      const result = await syncClient.createAndPush(config);
      const next = { ...config, sync: { ...config.sync, code: result.code } };
      setConfig(next);
      await configStore.setSyncCode(result.code);
      await configStore.save(next);
      setStatus(`已生成同步码并上传：${result.code}`);
    } catch (error) {
      setStatus(`上传失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const pull = async () => {
    setBusy(true);
    try {
      const result = await syncClient.pull(config.sync.code);
      setConfig(result.config);
      await configStore.setSyncCode(config.sync.code);
      await configStore.save(result.config);
      setStatus('配置已从云端拉取');
    } catch (error) {
      setStatus(`拉取失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const importLegacy = async () => {
    setBusy(true);
    try {
      const migrated = await syncClient.importLegacy(config.sync.code);
      setConfig(migrated);
      await configStore.save(migrated);
      setStatus(`已从旧版导入 ${migrated.providers.length} 个模型`);
    } catch (error) {
      setStatus(`旧版导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const testProvider = async (provider: ProviderConfig) => {
    setStatus(`正在测试 ${provider.label || provider.id}…`);
    try {
      const result = await pingProvider(provider, transport);
      setStatus(`${provider.label || provider.id} 连通（${result.ms}ms）`);
    } catch (error) {
      setStatus(`${provider.label || provider.id} 测试失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const fetchModels = async (provider: ProviderConfig) => {
    setStatus(`正在拉取 ${provider.label || provider.id} 的模型列表…`);
    try {
      const models = await listModels(provider, transport);
      if (!models.length) {
        setStatus('端点没有返回可用模型');
        return;
      }
      const next = {
        ...config,
        providers: config.providers.map((item) =>
          item.id === provider.id ? { ...item, model: item.model || models[0] } : item,
        ),
      };
      setConfig(next);
      setStatus(`拿到 ${models.length} 个模型：${models.slice(0, 8).join('、')}${models.length > 8 ? '…' : ''}`);
    } catch (error) {
      setStatus(`拉取模型失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  if (!loaded) return <div className="cxai-root" style={{ padding: 24 }}>正在加载配置…</div>;

  return (
    <div
      className="cxai-root"
      style={{ height: '100vh', display: 'flex', justifyContent: 'center', padding: '24px 16px', boxSizing: 'border-box' }}
    >
      <SettingsPanel
        config={config}
        syncStatus={status}
        busy={busy}
        onChange={setConfig}
        onSave={save}
        onExport={exportConfig}
        onImport={importConfig}
        onSyncCodeChange={(code) => {
          setConfig({ ...config, sync: { ...config.sync, code } });
          void configStore.setSyncCode(code);
        }}
        onGenerateAndPush={generateAndPush}
        onPull={pull}
        onImportLegacy={importLegacy}
        onTestProvider={testProvider}
        onListModels={fetchModels}
      />
    </div>
  );
}
