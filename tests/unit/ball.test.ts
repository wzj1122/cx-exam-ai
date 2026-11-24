import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountBall, type BallMode } from '@cx/ui';

describe('ball modes', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('runs once on a single click, switches panel on double click', () => {
    vi.useFakeTimers();
    let mode: BallMode = 'single';
    const runs: BallMode[] = [];
    let panels = 0;
    const ball = mountBall({
      id: 'test-ball',
      parent: document.body,
      getMode: () => mode,
      onModeChange: (next) => {
        mode = next;
      },
      onRun: (next) => runs.push(next),
      onTogglePanel: () => panels++,
    });
    ball.element.click();
    vi.advanceTimersByTime(300);
    expect(runs).toEqual(['single']);
    ball.element.click();
    ball.element.click();
    vi.advanceTimersByTime(50);
    expect(panels).toBe(1);
    expect(runs).toHaveLength(1);
  });

  it('toggles mode on long press and shows the number badge', () => {
    vi.useFakeTimers();
    let mode: BallMode = 'single';
    const ball = mountBall({
      id: 'test-ball-2',
      parent: document.body,
      getMode: () => mode,
      onModeChange: (next) => {
        mode = next;
      },
      onRun: () => {},
      onTogglePanel: () => {},
    });
    ball.setNumber(7);
    expect((ball.element.querySelector('.cx-ball-num') as HTMLElement).textContent).toBe('7');
    ball.element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    vi.advanceTimersByTime(520);
    ball.element.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(mode).toBe('all');
    expect(ball.element.dataset.mode).toBe('all');
  });
});
