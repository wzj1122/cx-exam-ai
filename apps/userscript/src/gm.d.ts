declare function GM_getValue<T = unknown>(key: string, fallback?: T): T;
declare function GM_setValue(key: string, value: unknown): void;
declare function GM_deleteValue(key: string): void;
declare function GM_xmlhttpRequest(options: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  data?: string;
  timeout?: number;
  anonymous?: boolean;
  onload?: (response: { status: number; responseText: string; response?: unknown }) => void;
  onerror?: (error: unknown) => void;
  ontimeout?: () => void;
}): void;
declare const unsafeWindow: Window & typeof globalThis;

declare module '*.css?inline' {
  const css: string;
  export default css;
}
