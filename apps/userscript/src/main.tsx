import { createRoot } from 'react-dom/client';
import css from '@cx/ui/styles.css?inline';
import {
  AnswerEngine,
  ConfigStore,
  createProviderCaller,
  SyncClient,
  SETTINGS_URL,
  type AppConfig,
} from '@cx/core';
import { ChaoxingAdapter, waitForExamPage } from '@cx/chaoxing';
import {
  LocalWorkbenchController,
  PortalContainerContext,
  WorkbenchApp,
  mountBall,
  type BallMode,
} from '@cx/ui';
import { GmStorage } from './gm-storage';
import { GmTransport } from './gm-transport';

const adapter = new ChaoxingAdapter({
  pageWindow: typeof unsafeWindow !== 'undefined' ? unsafeWindow : window,
});

void waitForExamPage(document, location.href).then((info) => {
  if (info) boot().catch((error) => console.warn('[CX AI] userscript boot failed', error));
});

async function boot() {
  const storage = new GmStorage();
  const configStore = new ConfigStore(storage);
  const config = await configStore.load();
  const transport = new GmTransport();
  const controller = new LocalWorkbenchController(adapter, buildEngine(config, transport), { config });
  const syncClient = new SyncClient(transport);
  (window as any).__CXAI_V2__ = { adapter, controller, configStore, syncClient };

  const host = document.createElement('div');
  host.id = 'cx-exam-ai-drawer-host';
  host.style.cssText =
    'position:fixed;right:12px;bottom:64px;width:min(404px,calc(100vw - 24px));height:auto;' +
    'max-height:76vh;z-index:2147483647;display:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  const mount = document.createElement('div');
  mount.style.height = 'auto';
  shadow.append(style, mount);
  document.documentElement.appendChild(host);

  const open = () => {
    host.style.display = 'block';
  };
  const close = () => {
    host.style.display = 'none';
  };
  const modeKey = 'cx-exam-ai:v2:ball-mode';
  const readMode = (): BallMode => {
    try {
      return localStorage.getItem(modeKey) === 'all' ? 'all' : 'single';
    } catch {
      return 'single';
    }
  };
  const ball = mountBall({
    id: 'cx-exam-ai-drawer-ball',
    parent: document.documentElement,
    getMode: readMode,
    onModeChange: (mode) => {
      try {
        localStorage.setItem(modeKey, mode);
      } catch {
        // ignore
      }
    },
    onRun: (mode) => {
      void (mode === 'all' ? controller.runAll() : controller.runSingle());
    },
    onTogglePanel: () => {
      if (host.style.display === 'block') close();
      else open();
    },
  });
  ball.setMode(readMode());
  controller.subscribe(() => {
    const state = controller.getState();
    ball.setNumber(state.paper?.currentNumber || state.paper?.questions[0]?.number || '•');
  });

  createRoot(mount).render(
    <PortalContainerContext.Provider value={mount}>
      <WorkbenchApp
        controller={controller}
        configStore={configStore}
        syncClient={syncClient}
        transport={transport}
        onOpenSettings={() => window.open(SETTINGS_URL, '_blank', 'noopener')}
        onClose={close}
      />
    </PortalContainerContext.Provider>,
  );
}

function buildEngine(config: AppConfig, transport: GmTransport): AnswerEngine {
  return new AnswerEngine({
    providers: config.providers,
    ...config.engine,
    caller: createProviderCaller(transport),
    onLog: (message) => console.info('[CX AI]', message),
  });
}
