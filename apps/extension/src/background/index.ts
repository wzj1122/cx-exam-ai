chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  void chrome.tabs
    .sendMessage(tab.id, { type: 'CX_TOGGLE_PANEL' })
    .catch(() => chrome.runtime.openOptionsPage());
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'CX_HTTP') {
    void handleHttp(message.options)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'CX_REQUEST_ORIGIN') {
    const origin = String(message.origin || '');
    if (!origin) {
      sendResponse({ ok: false, error: '缺少 origin' });
      return false;
    }
    void chrome.permissions
      .request({ origins: [`${origin}/*`] })
      .then((granted) => sendResponse({ ok: granted }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  return false;
});

async function handleHttp(options: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 25_000);
  try {
    const response = await fetch(options.url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
    return { status: response.status, bodyText: await response.text() };
  } finally {
    clearTimeout(timeout);
  }
}
