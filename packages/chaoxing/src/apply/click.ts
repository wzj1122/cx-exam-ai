import { randInt, sleep } from '@cx/core';

const POINTER_SEQUENCE = ['pointerover', 'pointerenter', 'mouseover', 'mouseenter'] as const;

function fire(el: Element, type: string, init: Record<string, unknown> = {}): void {
  try {
    const event =
      type.startsWith('pointer') && typeof PointerEvent !== 'undefined'
        ? new PointerEvent(type, { bubbles: true, cancelable: true, ...init })
        : new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(event);
  } catch {
    // ignore unsupported event constructors
  }
}

export async function humanClick(el: HTMLElement | null): Promise<boolean> {
  if (!el) return false;
  try {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } catch {
    try {
      el.scrollIntoView();
    } catch {
      // ignore
    }
  }
  await sleep(randInt(80, 180));
  const rect = el.getBoundingClientRect?.();
  const clientX = rect ? Math.round(rect.left + rect.width / 2) : 0;
  const clientY = rect ? Math.round(rect.top + rect.height / 2) : 0;
  const base = {
    clientX,
    clientY,
    screenX: clientX + (window.screenX || 0),
    screenY: clientY + (window.screenY || 0),
    button: 0,
    buttons: 0,
  };
  for (const type of POINTER_SEQUENCE) {
    fire(el, type, base);
    await sleep(randInt(4, 14));
  }
  fire(el, 'focus', base);
  fire(el, 'pointerdown', { ...base, buttons: 1 });
  fire(el, 'mousedown', { ...base, buttons: 1 });
  await sleep(randInt(35, 90));
  fire(el, 'pointerup', base);
  fire(el, 'mouseup', base);
  await sleep(randInt(8, 28));
  const preventJavascriptHref = (event: MouseEvent) => {
    const target = event.target as Element | null;
    const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (anchor && /^javascript:\s*(;|void\(0\))?\s*$/i.test(anchor.getAttribute('href') || '')) {
      event.preventDefault();
    }
  };
  document.addEventListener('click', preventJavascriptHref, true);
  try {
    el.click();
  } catch {
    return false;
  } finally {
    document.removeEventListener('click', preventJavascriptHref, true);
  }
  return true;
}

export async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs = 60,
): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return predicate();
}
