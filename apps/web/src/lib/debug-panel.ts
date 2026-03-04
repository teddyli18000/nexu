const MAX_API_REQUESTS = 50;
const MAX_CONSOLE_LOGS = 200;
const MAX_PAYLOAD_LENGTH = 6000;

export type DebugConsoleLevel = "log" | "warn" | "error";
export type DebugRequestStatus = number | "ERROR";

export interface DebugEnvironmentInfo {
  environment: string;
  buildVersion: string;
  gitCommitHash: string;
}

export interface DebugApiRequest {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  status: DebugRequestStatus;
  durationMs: number;
  requestBody?: string;
  responseBody?: string;
  errorMessage?: string;
}

export interface DebugConsoleEntry {
  id: string;
  timestamp: number;
  level: DebugConsoleLevel;
  message: string;
  args: string[];
}

export interface DebugWebVitals {
  fcp?: number;
  lcp?: number;
  cls: number;
}

export interface DebugPanelState {
  environment: DebugEnvironmentInfo;
  apiRequests: DebugApiRequest[];
  consoleLogs: DebugConsoleEntry[];
  stateTree: Record<string, unknown>;
  webVitals: DebugWebVitals;
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];
type Listener = () => void;
type LayoutShiftPerformanceEntry = PerformanceEntry & {
  value: number;
  hadRecentInput: boolean;
};

const listeners = new Set<Listener>();
let stopApiMonitorRef: (() => void) | null = null;
let stopConsoleMonitorRef: (() => void) | null = null;
let stopWebVitalsMonitorRef: (() => void) | null = null;
let stopCollectorsRef: (() => void) | null = null;

let state: DebugPanelState = {
  environment: {
    environment: import.meta.env.MODE,
    buildVersion:
      typeof __APP_BUILD_VERSION__ === "string"
        ? __APP_BUILD_VERSION__
        : "unknown",
    gitCommitHash:
      typeof __APP_GIT_COMMIT_HASH__ === "string"
        ? __APP_GIT_COMMIT_HASH__
        : "unknown",
  },
  apiRequests: [],
  consoleLogs: [],
  stateTree: {},
  webVitals: {
    cls: 0,
  },
};

export function isDebugPanelEnabled(): boolean {
  return (
    import.meta.env.DEV && import.meta.env.VITE_DEBUG_PANEL_ENABLED !== "false"
  );
}

export function subscribeDebugPanelStore(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDebugPanelSnapshot(): DebugPanelState {
  return state;
}

export function reportDebugState(path: string, value: unknown): void {
  state = {
    ...state,
    stateTree: setNestedValue(state.stateTree, path, value),
  };
  notify();
}

export function clearDebugState(path?: string): void {
  if (!path) {
    state = {
      ...state,
      stateTree: {},
    };
    notify();
    return;
  }

  state = {
    ...state,
    stateTree: removeNestedValue(state.stateTree, path),
  };
  notify();
}

export function reportDebugApiRequest(
  payload: Omit<DebugApiRequest, "id" | "timestamp"> & {
    timestamp?: number;
  },
): void {
  const apiRequest: DebugApiRequest = {
    id: createId(),
    timestamp: payload.timestamp ?? Date.now(),
    method: payload.method,
    url: payload.url,
    status: payload.status,
    durationMs: round(payload.durationMs),
    requestBody: payload.requestBody,
    responseBody: payload.responseBody,
    errorMessage: payload.errorMessage,
  };

  state = {
    ...state,
    apiRequests: [apiRequest, ...state.apiRequests].slice(0, MAX_API_REQUESTS),
  };
  notify();
}

export function clearDebugApiRequests(): void {
  state = {
    ...state,
    apiRequests: [],
  };
  notify();
}

export function reportDebugConsole(
  level: DebugConsoleLevel,
  args: unknown[],
): void {
  const serializedArgs = args.map((arg) =>
    truncateText(stringifyUnknown(arg), MAX_PAYLOAD_LENGTH),
  );
  const consoleEntry: DebugConsoleEntry = {
    id: createId(),
    timestamp: Date.now(),
    level,
    message: serializedArgs.join(" "),
    args: serializedArgs,
  };

  state = {
    ...state,
    consoleLogs: [consoleEntry, ...state.consoleLogs].slice(
      0,
      MAX_CONSOLE_LOGS,
    ),
  };
  notify();
}

export function clearDebugConsoleLogs(): void {
  state = {
    ...state,
    consoleLogs: [],
  };
  notify();
}

export function startDebugCollectors(): () => void {
  if (stopCollectorsRef) {
    return stopCollectorsRef;
  }

  const stopApiMonitor = startApiRequestMonitor();
  const stopConsoleMonitor = startConsoleMonitor();
  const stopWebVitalsMonitor = startWebVitalsMonitor();

  stopCollectorsRef = () => {
    stopApiMonitor();
    stopConsoleMonitor();
    stopWebVitalsMonitor();
    stopCollectorsRef = null;
  };

  return stopCollectorsRef;
}

export function startApiRequestMonitor(): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  if (stopApiMonitorRef) {
    return stopApiMonitorRef;
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (
    input: FetchInput,
    init?: FetchInit,
  ): Promise<Response> => {
    const url = resolveRequestUrl(input);
    if (!shouldTrackApiRequest(url)) {
      return originalFetch(input, init);
    }

    const method = resolveRequestMethod(input, init);
    const startedAt = performance.now();
    const requestBody = await extractRequestBody(input, init);

    try {
      const response = await originalFetch(input, init);
      const responseBody = await extractResponseBody(response);
      reportDebugApiRequest({
        method,
        url,
        status: response.status,
        durationMs: performance.now() - startedAt,
        requestBody,
        responseBody,
      });
      return response;
    } catch (error: unknown) {
      reportDebugApiRequest({
        method,
        url,
        status: "ERROR",
        durationMs: performance.now() - startedAt,
        requestBody,
        errorMessage: stringifyUnknown(error),
      });
      throw error;
    }
  };

  stopApiMonitorRef = () => {
    window.fetch = originalFetch;
    stopApiMonitorRef = null;
  };

  return stopApiMonitorRef;
}

export function startConsoleMonitor(): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  if (stopConsoleMonitorRef) {
    return stopConsoleMonitorRef;
  }

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args: unknown[]): void => {
    originalLog(...args);
    reportDebugConsole("log", args);
  };
  console.warn = (...args: unknown[]): void => {
    originalWarn(...args);
    reportDebugConsole("warn", args);
  };
  console.error = (...args: unknown[]): void => {
    originalError(...args);
    reportDebugConsole("error", args);
  };

  stopConsoleMonitorRef = () => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    stopConsoleMonitorRef = null;
  };

  return stopConsoleMonitorRef;
}

export function startWebVitalsMonitor(): () => void {
  if (
    typeof window === "undefined" ||
    typeof PerformanceObserver === "undefined"
  ) {
    return () => {};
  }

  if (stopWebVitalsMonitorRef) {
    return stopWebVitalsMonitorRef;
  }

  const cleanups: Array<() => void> = [];
  const supportedEntryTypes = PerformanceObserver.supportedEntryTypes ?? [];

  if (supportedEntryTypes.includes("paint")) {
    const paintObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        if (entry.name === "first-contentful-paint") {
          setWebVital("fcp", entry.startTime);
        }
      }
    });
    paintObserver.observe({ type: "paint", buffered: true });
    cleanups.push(() => {
      paintObserver.disconnect();
    });
  }

  if (supportedEntryTypes.includes("largest-contentful-paint")) {
    const lcpObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const latestEntry = entries[entries.length - 1];
      if (latestEntry) {
        setWebVital("lcp", latestEntry.startTime);
      }
    });
    lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
    cleanups.push(() => {
      lcpObserver.disconnect();
    });
  }

  if (supportedEntryTypes.includes("layout-shift")) {
    let cls = state.webVitals.cls;
    const clsObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        const clsEntry = entry as LayoutShiftPerformanceEntry;
        if (!clsEntry.hadRecentInput) {
          cls += clsEntry.value;
        }
      }
      setWebVital("cls", cls);
    });
    clsObserver.observe({ type: "layout-shift", buffered: true });
    cleanups.push(() => {
      clsObserver.disconnect();
    });
  }

  stopWebVitalsMonitorRef = () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
    stopWebVitalsMonitorRef = null;
  };

  return stopWebVitalsMonitorRef;
}

function setWebVital(key: keyof DebugWebVitals, value: number): void {
  state = {
    ...state,
    webVitals: {
      ...state.webVitals,
      [key]: key === "cls" ? round(value, 3) : round(value),
    },
  };
  notify();
}

function shouldTrackApiRequest(url: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const resolvedUrl = new URL(url, window.location.origin);
    const pathname = resolvedUrl.pathname.toLowerCase();
    if (pathname.startsWith("/api") || pathname.startsWith("/v1")) {
      return true;
    }
    if (resolvedUrl.origin !== window.location.origin) {
      return pathname.includes("/api") || pathname.includes("/v1");
    }
    return false;
  } catch {
    return true;
  }
}

function resolveRequestUrl(input: FetchInput): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function resolveRequestMethod(input: FetchInput, init?: FetchInit): string {
  const methodFromInit = init?.method;
  if (methodFromInit) {
    return methodFromInit.toUpperCase();
  }
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method.toUpperCase();
  }
  return "GET";
}

async function extractRequestBody(
  input: FetchInput,
  init?: FetchInit,
): Promise<string | undefined> {
  if (init?.body != null) {
    return truncateText(await bodyInitToString(init.body), MAX_PAYLOAD_LENGTH);
  }

  if (typeof Request !== "undefined" && input instanceof Request) {
    try {
      const text = await input.clone().text();
      return truncateText(text, MAX_PAYLOAD_LENGTH);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

async function extractResponseBody(
  response: Response,
): Promise<string | undefined> {
  try {
    const text = await response.clone().text();
    if (!text) {
      return undefined;
    }
    return truncateText(text, MAX_PAYLOAD_LENGTH);
  } catch {
    return undefined;
  }
}

async function bodyInitToString(body: BodyInit): Promise<string> {
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const formDataObject = Array.from(body.entries()).reduce<
      Record<string, string>
    >((accumulator, [key, value]) => {
      accumulator[key] =
        typeof value === "string" ? value : `[File name=${value.name}]`;
      return accumulator;
    }, {});
    return JSON.stringify(formDataObject, null, 2);
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return `[Blob type=${body.type || "unknown"} size=${body.size}]`;
  }
  if (body instanceof ArrayBuffer) {
    return `[ArrayBuffer bytes=${body.byteLength}]`;
  }
  if (ArrayBuffer.isView(body)) {
    return `[ArrayBufferView bytes=${body.byteLength}]`;
  }
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    return "[ReadableStream]";
  }
  return String(body);
}

function setNestedValue(
  source: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const keys = path.split(".").filter(Boolean);
  if (keys.length === 0) {
    return source;
  }

  const rootCopy: Record<string, unknown> = { ...source };
  let cursor: Record<string, unknown> = rootCopy;

  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    if (!key) {
      continue;
    }
    const current = cursor[key];
    const currentObject =
      typeof current === "object" && current !== null && !Array.isArray(current)
        ? (current as Record<string, unknown>)
        : {};
    const clonedObject: Record<string, unknown> = { ...currentObject };
    cursor[key] = clonedObject;
    cursor = clonedObject;
  }

  const finalKey = keys[keys.length - 1];
  if (!finalKey) {
    return source;
  }
  cursor[finalKey] = value;
  return rootCopy;
}

function removeNestedValue(
  source: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  const keys = path.split(".").filter(Boolean);
  if (keys.length === 0) {
    return source;
  }

  const rootCopy: Record<string, unknown> = { ...source };
  let cursor: Record<string, unknown> = rootCopy;

  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    if (!key) {
      continue;
    }
    const current = cursor[key];
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current)
    ) {
      return source;
    }
    const clonedObject: Record<string, unknown> = {
      ...(current as Record<string, unknown>),
    };
    cursor[key] = clonedObject;
    cursor = clonedObject;
  }

  const finalKey = keys[keys.length - 1];
  if (!finalKey) {
    return source;
  }
  delete cursor[finalKey];
  return rootCopy;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }

  try {
    const serialized = JSON.stringify(value, null, 2);
    if (serialized === undefined) {
      return String(value);
    }
    return serialized;
  } catch {
    return String(value);
  }
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}… [truncated]`;
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function round(value: number, decimals = 2): number {
  const base = 10 ** decimals;
  return Math.round(value * base) / base;
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}
