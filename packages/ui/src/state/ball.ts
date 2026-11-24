export type BallMode = 'single' | 'all';

export interface BallOptions {
  id: string;
  parent: HTMLElement;
  getMode: () => BallMode;
  onModeChange: (mode: BallMode) => void;
  onRun: (mode: BallMode) => void;
  onTogglePanel: () => void;
}

export interface BallHandle {
  element: HTMLElement;
  setNumber: (value: number | string) => void;
  setMode: (mode: BallMode) => void;
  showToast: (text: string) => void;
  dispose: () => void;
}

function modeLabel(mode: BallMode): string {
  return mode === 'all' ? '全部填写' : '答一题';
}

export function mountBall(options: BallOptions): BallHandle {
  const ball = document.createElement('div');
  ball.id = options.id;
  ball.dataset.mode = options.getMode();
  ball.style.cssText =
    'position:fixed;right:12px;bottom:12px;z-index:2147483646;width:34px;height:34px;border-radius:50%;' +
    'background:rgba(248,250,252,.5);border:1px solid rgba(203,213,225,.4);color:#64748b;' +
    'box-shadow:0 2px 8px rgba(16,24,40,.08);display:flex;align-items:center;justify-content:center;' +
    'font:600 9px/1 system-ui,sans-serif;cursor:pointer;user-select:none;opacity:.3;transition:.18s;';
  ball.innerHTML =
    '<span class="cx-ball-cx" style="letter-spacing:.2px">CX</span>' +
    '<span class="cx-ball-num" style="position:absolute;top:-4px;right:-4px;min-width:14px;height:14px;' +
    'border-radius:7px;background:#3b82f6;color:#fff;font:700 8px/14px system-ui,sans-serif;' +
    'text-align:center;padding:0 3px;box-shadow:0 1px 4px rgba(37,99,235,.35)">•</span>';
  ball.title = `单击：${modeLabel(options.getMode())} · 双击：打开面板 · 长按：切换模式`;
  options.parent.appendChild(ball);

  const toast = document.createElement('div');
  toast.style.cssText =
    'position:fixed;right:12px;bottom:54px;z-index:2147483647;background:#111827;color:#fff;' +
    'font:10.5px/1.4 system-ui,sans-serif;padding:4px 9px;border-radius:7px;opacity:0;' +
    'transform:translateY(5px);transition:.18s;pointer-events:none;white-space:nowrap;';
  options.parent.appendChild(toast);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  const showToast = (text: string) => {
    toast.textContent = text;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(5px)';
    }, 1500);
  };

  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let clickTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressTriggered = false;
  let pressed = false;

  const clearLongPress = () => {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    pressed = true;
    longPressTriggered = false;
    clearLongPress();
    longPressTimer = setTimeout(() => {
      longPressTriggered = true;
      const next = options.getMode() === 'all' ? 'single' : 'all';
      options.onModeChange(next);
      setMode(next);
      showToast(`模式：${modeLabel(next)} · 单击运行`);
    }, 480);
  };

  const onPointerUp = () => {
    pressed = false;
    clearLongPress();
  };

  const onClick = () => {
    if (longPressTriggered) {
      longPressTriggered = false;
      return;
    }
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
      options.onTogglePanel();
      return;
    }
    clickTimer = setTimeout(() => {
      clickTimer = null;
      if (!pressed) options.onRun(options.getMode());
    }, 280);
  };

  const onMouseEnter = () => {
    ball.style.opacity = '.95';
    ball.style.background = 'rgba(255,255,255,.95)';
    ball.style.color = '#2563eb';
  };
  const onMouseLeave = () => {
    ball.style.opacity = '.3';
    ball.style.background = 'rgba(248,250,252,.5)';
    ball.style.color = '#64748b';
  };

  ball.addEventListener('pointerdown', onPointerDown);
  ball.addEventListener('pointerup', onPointerUp);
  ball.addEventListener('pointercancel', onPointerUp);
  ball.addEventListener('click', onClick);
  ball.addEventListener('mouseenter', onMouseEnter);
  ball.addEventListener('mouseleave', onMouseLeave);

  function setMode(mode: BallMode) {
    ball.dataset.mode = mode;
    const badge = ball.querySelector('.cx-ball-num') as HTMLElement | null;
    if (badge) badge.style.background = mode === 'all' ? '#16a34a' : '#3b82f6';
    ball.title = `单击：${modeLabel(mode)} · 双击：打开面板 · 长按：切换模式`;
  }

  return {
    element: ball,
    setNumber(value) {
      const badge = ball.querySelector('.cx-ball-num') as HTMLElement | null;
      if (badge) badge.textContent = String(value || '•');
    },
    setMode,
    showToast,
    dispose() {
      clearLongPress();
      if (clickTimer) clearTimeout(clickTimer);
      if (toastTimer) clearTimeout(toastTimer);
      ball.remove();
      toast.remove();
    },
  };
}
