import {
  AnswerEngine,
  ConfigStore,
  createProviderCaller,
  SETTINGS_URL,
  type AppConfig,
  type ExamPaper,
} from '@cx/core';
import { ChaoxingAdapter, waitForExamPage } from '@cx/chaoxing';
import {
  LocalWorkbenchController,
  type WorkbenchState,
} from '../../../../packages/ui/src/state/workbench-controller';
import { WorkbenchApp, PortalContainerContext, mountBall, type BallMode } from '@cx/ui';
import css from '../../../../packages/ui/src/styles/workbench.css?inline';
import { createRoot } from 'react-dom/client';
import { ChromeStorageAdapter } from '../lib/storage';
import { BackgroundTransport } from '../lib/transport';

const adapter = new ChaoxingAdapter();
void waitForExamPage(document, location.href).then((info) => {
  if (info) boot().catch((error) => console.warn('[CX AI] boot failed', error));
});

async function boot() {
  const storage = new ChromeStorageAdapter();
  const configStore = new ConfigStore(storage);
  const config = await configStore.load();
  const transport = new BackgroundTransport();
  const engine = buildEngine(config, transport);
  const controller = new LocalWorkbenchController(adapter, engine, {
    config,
    onLog: (message) => console.info('[CX AI]', message),
  });
  (window as any).__CXAI_V2__ = { adapter, controller, configStore };

  const host = document.createElement('div');
  host.id = 'cx-exam-ai-card-host';
  host.style.cssText =
    'position:fixed;right:12px;bottom:64px;z-index:2147483645;width:min(404px,calc(100vw - 24px));' +
    'height:auto;max-height:76vh;display:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  const mount = document.createElement('div');
  shadow.append(style, mount);
  document.documentElement.appendChild(host);

  const open = () => {
    host.style.display = 'block';
  };
  const close = () => {
    host.style.display = 'none';
  };
  const toggle = () => {
    if (host.style.display === 'block') close();
    else open();
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
    id: 'cx-exam-ai-ball',
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
    onTogglePanel: toggle,
  });
  ball.setMode(readMode());

  createRoot(mount).render(
    <PortalContainerContext.Provider value={mount}>
      <WorkbenchApp
        controller={controller}
        configStore={configStore}
        transport={transport}
        onOpenSettings={() => chrome.tabs.create({ url: SETTINGS_URL })}
        onClose={close}
      />
    </PortalContainerContext.Provider>,
  );

  controller.subscribe(() => {
    const state = controller.getState();
    ball.setNumber(state.paper?.currentNumber || state.paper?.questions[0]?.number || '•');
    void chrome.runtime.sendMessage({ type: 'CX_STATE_UPDATE', state: serializeState(state) });
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'CX_GET_STATE') {
      sendResponse({ ok: true, state: serializeState(controller.getState()) });
      return false;
    }
    if (message?.type === 'CX_INIT') {
      void controller.init().then(() => sendResponse({ ok: true, state: serializeState(controller.getState()) }));
      return true;
    }
    if (message?.type === 'CX_TOGGLE_PANEL') {
      toggle();
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === 'CX_ACTION') {
      void handleAction(controller, configStore, transport, message.action, message.payload)
        .then((value) => sendResponse({ ok: true, value, state: serializeState(controller.getState()) }))
        .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    return false;
  });
}

function buildEngine(config: AppConfig, transport: BackgroundTransport): AnswerEngine {
  return new AnswerEngine({
    providers: config.providers,
    ...config.engine,
    caller: createProviderCaller(transport),
    onLog: (message) => console.info('[CX AI]', message),
  });
}

async function handleAction(
  controller: LocalWorkbenchController,
  configStore: ConfigStore,
  transport: BackgroundTransport,
  action: string,
  payload: any,
) {
  switch (action) {
    case 'solveAll':
      return controller.solveAll();
    case 'solveOne':
      return controller.solveOne(payload.questionId);
    case 'applyAll':
      return controller.applyAll();
    case 'applyOne':
      return controller.applyOne(payload.questionId);
    case 'applyAndNext':
      return controller.applyAndNext(payload.questionId);
    case 'runSingle':
      return controller.runSingle();
    case 'runAll':
      return controller.runAll();
    case 'jumpToQuestion':
      return controller.jumpToQuestion(payload.number, payload.qid);
    case 'setSelected':
      return controller.setSelected(payload.questionId);
    case 'setAnswerOption':
      return controller.setAnswerOption(payload.questionId, payload.optionIds);
    case 'setAnswerText':
      return controller.setAnswerText(payload.questionId, payload.text);
    case 'toggleFill':
      return controller.toggleFill(payload.questionId);
    case 'setFillIds':
      return controller.setFillIds(payload.ids);
    case 'enterPreview':
      return controller.enterPreview();
    case 'cancelPreview':
      return controller.cancelPreview();
    case 'nextQuestion':
      return controller.nextQuestion();
    case 'verifyAll':
      return controller.verifyAll();
    case 'exportDiagnostics':
      return controller.exportDiagnostics();
    case 'reloadConfig': {
      const config = await configStore.load();
      controller.updateConfig(config);
      controller.setEngine(buildEngine(config, transport));
      return config;
    }
    default:
      throw new Error(`未知动作：${action}`);
  }
}

function serializeState(state: WorkbenchState): WorkbenchState {
  const paper = state.paper ? serializePaper(state.paper) : null;
  return { ...state, paper };
}

function serializePaper(paper: ExamPaper): ExamPaper {
  return {
    ...paper,
    questions: paper.questions.map((q) => ({
      ...q,
      root: undefined,
      inputs: q.inputs.map((input) => ({ ...input, element: undefined })),
      options: q.options.map((option) => ({
        ...option,
        element: undefined,
        clickElement: undefined,
      })),
    })),
  };
}

