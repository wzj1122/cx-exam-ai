import { useEffect, useMemo, useState } from 'react';
import {
  AnswerEngine,
  createProviderCaller,
  DEFAULT_CONFIG,
  SETTINGS_URL,
  type AppConfig,
  type ConfigStore,
  type HttpTransport,
  type SyncClient,
} from '@cx/core';
import type { WorkbenchController } from './workbench-controller';
import { Workbench } from '../components/Workbench';

export interface WorkbenchAppProps {
  controller: WorkbenchController & {
    setEngine?: (engine: AnswerEngine) => void;
    updateConfig?: (config: AppConfig) => void;
  };
  configStore: ConfigStore;
  syncClient?: SyncClient;
  transport: HttpTransport;
  onOpenSettings?: () => void;
  onClose?: () => void;
}

function buildEngine(config: AppConfig, transport: HttpTransport): AnswerEngine {
  return new AnswerEngine({
    providers: config.providers,
    ...config.engine,
    caller: createProviderCaller(transport),
    onLog: (message) => console.info('[cx-ai]', message),
  });
}

export function WorkbenchApp({
  controller,
  configStore,
  syncClient,
  transport,
  onOpenSettings,
  onClose,
}: WorkbenchAppProps) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [syncCode, setSyncCode] = useState('');
  const [syncStatus, setSyncStatus] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void configStore.load().then((next) => {
      if (!alive) return;
      setConfig(next);
      setLoaded(true);
      controller.updateConfig?.(next);
      controller.setEngine?.(buildEngine(next, transport));
      void controller.init();
    });
    void configStore.getSyncCode().then(setSyncCode);
    return () => {
      alive = false;
      controller.dispose();
    };
  }, [configStore, controller, transport]);

  const rootStyle = useMemo(() => ({ height: 'auto' }), []);

  const pullSync = async (code: string) => {
    if (!syncClient) return;
    setSyncBusy(true);
    try {
      const result = await syncClient.pull(code);
      const saved = await configStore.save(result.config);
      await configStore.setSyncCode(code);
      setConfig(saved);
      controller.updateConfig?.(saved);
      controller.setEngine?.(buildEngine(saved, transport));
      setSyncStatus('同步成功，模型配置已更新');
    } catch (error) {
      setSyncStatus(`同步失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSyncBusy(false);
    }
  };

  if (!loaded) {
    return (
      <div className="cxai-root" style={rootStyle}>
        <div className="cxai-workbench">
          <div className="cxai-list-empty">正在加载配置…</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="cxai-root"
      style={rootStyle}
      data-theme={config.ui.theme === 'auto' ? undefined : config.ui.theme}
    >
      <Workbench
        controller={controller}
        onOpenSettings={onOpenSettings || (() => window.open(SETTINGS_URL, '_blank', 'noopener'))}
        onClose={onClose}
        syncCode={syncCode}
        syncStatus={syncStatus}
        syncBusy={syncBusy}
        onSyncCodeChange={(code) => {
          setSyncCode(code);
          void configStore.setSyncCode(code);
        }}
        onSyncPull={pullSync}
      />
    </div>
  );
}
