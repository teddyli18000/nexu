import {
  type DebugApiRequest,
  type DebugConsoleEntry,
  clearDebugApiRequests,
  clearDebugConsoleLogs,
  getDebugPanelSnapshot,
  isDebugPanelEnabled,
  reportDebugState,
  startDebugCollectors,
  subscribeDebugPanelStore,
} from "@/lib/debug-panel";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";

const DEBUG_PANEL_VISIBLE_STORAGE_KEY = "nexu-debug-panel-visible";
const DEBUG_PANEL_COLLAPSED_STORAGE_KEY = "nexu-debug-panel-collapsed";

type DebugTab = "environment" | "api" | "state" | "vitals" | "console";

const DEBUG_TABS: Array<{ key: DebugTab; label: string }> = [
  { key: "environment", label: "Environment" },
  { key: "api", label: "API" },
  { key: "state", label: "State" },
  { key: "vitals", label: "Vitals" },
  { key: "console", label: "Console" },
];

interface JsonTreeViewProps {
  value: unknown;
  rootLabel: string;
}

export function DebugPanel() {
  const enabled = isDebugPanelEnabled();
  const location = useLocation();
  const debugState = useSyncExternalStore(
    subscribeDebugPanelStore,
    getDebugPanelSnapshot,
    getDebugPanelSnapshot,
  );
  const [visible, setVisible] = useState<boolean>(() =>
    readStoredBoolean(DEBUG_PANEL_VISIBLE_STORAGE_KEY, true),
  );
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    readStoredBoolean(DEBUG_PANEL_COLLAPSED_STORAGE_KEY, false),
  );
  const [activeTab, setActiveTab] = useState<DebugTab>("environment");
  const [expandedRequestMap, setExpandedRequestMap] = useState<
    Record<string, boolean>
  >({});

  const stateTreeHasData = useMemo(
    () => Object.keys(debugState.stateTree).length > 0,
    [debugState.stateTree],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const stop = startDebugCollectors();
    return () => {
      stop();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    reportDebugState("router.location", {
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
    });
  }, [enabled, location.hash, location.pathname, location.search]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        setVisible((currentValue) => !currentValue);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [enabled]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      DEBUG_PANEL_VISIBLE_STORAGE_KEY,
      String(visible),
    );
  }, [visible]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      DEBUG_PANEL_COLLAPSED_STORAGE_KEY,
      String(collapsed),
    );
  }, [collapsed]);

  if (!enabled || !visible) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-[9999] rounded-xl border border-zinc-700 bg-zinc-900/95 text-zinc-100 shadow-2xl backdrop-blur-sm",
        collapsed ? "w-80" : "w-[28rem] max-w-[calc(100vw-1rem)]",
      )}
    >
      <div className="flex items-center justify-between border-b border-zinc-700 px-3 py-2">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold">Debug Panel</p>
          <p className="text-xs text-zinc-400">
            Shortcut:{" "}
            <kbd className="rounded border border-zinc-600 px-1">Ctrl</kbd>+
            <kbd className="rounded border border-zinc-600 px-1">Shift</kbd>+
            <kbd className="rounded border border-zinc-600 px-1">D</kbd>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setCollapsed((currentValue) => !currentValue);
            }}
            className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
          >
            {collapsed ? "Expand" : "Collapse"}
          </button>
          <button
            type="button"
            onClick={() => {
              setVisible(false);
            }}
            className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
          >
            Hide
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="flex border-b border-zinc-700 px-2 py-2">
            {DEBUG_TABS.map((tab) => {
              const countLabel = getTabCountLabel(tab.key, {
                apiCount: debugState.apiRequests.length,
                consoleCount: debugState.consoleLogs.length,
              });
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.key);
                  }}
                  className={cn(
                    "mr-1 rounded px-2 py-1 text-xs transition-colors",
                    activeTab === tab.key
                      ? "bg-zinc-700 text-zinc-100"
                      : "bg-transparent text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
                  )}
                >
                  {tab.label}
                  {countLabel ? (
                    <span className="ml-1 text-[10px] text-zinc-300">
                      ({countLabel})
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="max-h-[65vh] overflow-auto px-3 py-3">
            {activeTab === "environment" && (
              <div className="space-y-2 text-sm">
                <InfoRow
                  label="Environment"
                  value={debugState.environment.environment}
                />
                <InfoRow
                  label="Build Version"
                  value={debugState.environment.buildVersion}
                />
                <InfoRow
                  label="Git Commit"
                  value={debugState.environment.gitCommitHash}
                />
                <InfoRow
                  label="Panel Enabled"
                  value={String(isDebugPanelEnabled())}
                />
                <InfoRow label="Visible" value={String(visible)} />
              </div>
            )}

            {activeTab === "api" && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-zinc-100">
                    Recent API Requests
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      clearDebugApiRequests();
                    }}
                    className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
                  >
                    Clear
                  </button>
                </div>

                {debugState.apiRequests.length === 0 ? (
                  <p className="rounded border border-zinc-700 bg-zinc-800/50 p-3 text-xs text-zinc-400">
                    No API requests captured yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {debugState.apiRequests.map((request) => {
                      const expanded = Boolean(expandedRequestMap[request.id]);
                      return (
                        <ApiRequestItem
                          key={request.id}
                          request={request}
                          expanded={expanded}
                          onToggle={() => {
                            setExpandedRequestMap((currentMap) => ({
                              ...currentMap,
                              [request.id]: !expanded,
                            }));
                          }}
                        />
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {activeTab === "state" && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-zinc-100">
                    State Tree
                  </p>
                </div>
                {stateTreeHasData ? (
                  <JsonTreeView
                    value={debugState.stateTree}
                    rootLabel="stateTree"
                  />
                ) : (
                  <p className="rounded border border-zinc-700 bg-zinc-800/50 p-3 text-xs text-zinc-400">
                    No state has been reported yet. Use reportDebugState() from
                    your components.
                  </p>
                )}
              </section>
            )}

            {activeTab === "vitals" && (
              <section className="space-y-3">
                <p className="text-sm font-medium text-zinc-100">Web Vitals</p>
                <div className="grid grid-cols-1 gap-2">
                  <MetricCard
                    label="FCP"
                    value={debugState.webVitals.fcp}
                    unit="ms"
                    score={scoreWebVital("fcp", debugState.webVitals.fcp)}
                  />
                  <MetricCard
                    label="LCP"
                    value={debugState.webVitals.lcp}
                    unit="ms"
                    score={scoreWebVital("lcp", debugState.webVitals.lcp)}
                  />
                  <MetricCard
                    label="CLS"
                    value={debugState.webVitals.cls}
                    score={scoreWebVital("cls", debugState.webVitals.cls)}
                  />
                </div>
              </section>
            )}

            {activeTab === "console" && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-zinc-100">
                    Console Output
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      clearDebugConsoleLogs();
                    }}
                    className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
                  >
                    Clear
                  </button>
                </div>

                {debugState.consoleLogs.length === 0 ? (
                  <p className="rounded border border-zinc-700 bg-zinc-800/50 p-3 text-xs text-zinc-400">
                    No console output captured yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {debugState.consoleLogs.map((entry) => (
                      <ConsoleLogItem key={entry.id} entry={entry} />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded border border-zinc-700 bg-zinc-800/60 px-2 py-1.5">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className="max-w-[14rem] break-all text-right font-mono text-xs text-zinc-100">
        {value}
      </p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  unit,
  score,
}: {
  label: string;
  value: number | undefined;
  unit?: string;
  score: "good" | "needs-improvement" | "poor" | "unknown";
}) {
  return (
    <div className="rounded border border-zinc-700 bg-zinc-800/60 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-400">{label}</p>
        <span
          className={cn(
            "rounded px-2 py-0.5 text-[10px] uppercase tracking-wide",
            score === "good" && "bg-emerald-500/20 text-emerald-300",
            score === "needs-improvement" && "bg-amber-500/20 text-amber-300",
            score === "poor" && "bg-red-500/20 text-red-300",
            score === "unknown" && "bg-zinc-700 text-zinc-300",
          )}
        >
          {score}
        </span>
      </div>
      <p className="mt-2 font-mono text-xl text-zinc-100">
        {value === undefined ? "--" : value}
        {value === undefined ? "" : unit ? ` ${unit}` : ""}
      </p>
    </div>
  );
}

function ApiRequestItem({
  request,
  expanded,
  onToggle,
}: {
  request: DebugApiRequest;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded border border-zinc-700 bg-zinc-800/60 p-2">
      <button type="button" onClick={onToggle} className="w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-zinc-100">
              {request.method} {request.url}
            </p>
            <p className="mt-1 text-[11px] text-zinc-400">
              {formatTimestamp(request.timestamp)} • {request.durationMs} ms
            </p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold",
              getRequestStatusClassName(request.status),
            )}
          >
            {request.status}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          <PayloadCard title="Request Body" payload={request.requestBody} />
          <PayloadCard title="Response Body" payload={request.responseBody} />
          {request.errorMessage ? (
            <PayloadCard title="Error" payload={request.errorMessage} />
          ) : null}
        </div>
      )}
    </div>
  );
}

function ConsoleLogItem({ entry }: { entry: DebugConsoleEntry }) {
  return (
    <div className="rounded border border-zinc-700 bg-zinc-800/60 p-2">
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
            getConsoleLevelClassName(entry.level),
          )}
        >
          {entry.level}
        </span>
        <span className="text-[11px] text-zinc-400">
          {formatTimestamp(entry.timestamp)}
        </span>
      </div>
      <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-xs text-zinc-100">
        {entry.message || "(empty message)"}
      </pre>
    </div>
  );
}

function PayloadCard({ title, payload }: { title: string; payload?: string }) {
  return (
    <div className="rounded border border-zinc-700 bg-zinc-900/60 p-2">
      <p className="mb-1 text-[11px] text-zinc-400">{title}</p>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-zinc-100">
        {payload?.trim() ? payload : "(empty)"}
      </pre>
    </div>
  );
}

function JsonTreeView({ value, rootLabel }: JsonTreeViewProps) {
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({
    $: true,
  });
  const seenObjects = new WeakSet<object>();

  const toggleExpanded = (path: string) => {
    setExpandedMap((currentMap) => ({
      ...currentMap,
      [path]: !currentMap[path],
    }));
  };

  const renderNode = (
    currentValue: unknown,
    label: string,
    path: string,
    depth: number,
  ): React.ReactNode => {
    const indentation = {
      paddingLeft: `${depth * 12}px`,
    };
    const isObjectValue =
      typeof currentValue === "object" && currentValue !== null;

    if (!isObjectValue) {
      return (
        <div key={path} className="py-0.5 text-xs" style={indentation}>
          <span className="text-zinc-300">{label}: </span>
          <span className="text-cyan-300">
            {formatPrimitiveValue(currentValue)}
          </span>
        </div>
      );
    }

    const objectValue = currentValue as Record<string, unknown> | unknown[];
    if (seenObjects.has(objectValue as object)) {
      return (
        <div key={path} className="py-0.5 text-xs" style={indentation}>
          <span className="text-zinc-300">{label}: </span>
          <span className="text-amber-300">[Circular]</span>
        </div>
      );
    }
    seenObjects.add(objectValue as object);

    const entries = Array.isArray(objectValue)
      ? objectValue.map(
          (entryValue, index) => [String(index), entryValue] as const,
        )
      : Object.entries(objectValue);

    const expanded = expandedMap[path] ?? depth < 1;
    const shapeLabel = Array.isArray(objectValue)
      ? `Array(${entries.length})`
      : `{${entries.length} keys}`;

    return (
      <div key={path}>
        <button
          type="button"
          onClick={() => {
            toggleExpanded(path);
          }}
          className="flex w-full items-center gap-1 py-0.5 text-left text-xs hover:bg-zinc-800/60"
          style={indentation}
        >
          <span className="w-3 text-zinc-400">{expanded ? "▼" : "▶"}</span>
          <span className="text-zinc-200">{label}</span>
          <span className="text-zinc-500">{shapeLabel}</span>
        </button>

        {expanded && (
          <div>
            {entries.length === 0 ? (
              <div
                className="py-0.5 text-xs text-zinc-500"
                style={{ paddingLeft: `${(depth + 1) * 12}px` }}
              >
                (empty)
              </div>
            ) : (
              entries.map(([entryKey, entryValue]) =>
                renderNode(
                  entryValue,
                  entryKey,
                  `${path}.${entryKey}`,
                  depth + 1,
                ),
              )
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rounded border border-zinc-700 bg-zinc-900/60 p-2 font-mono">
      {renderNode(value, rootLabel, "$", 0)}
    </div>
  );
}

function scoreWebVital(
  metric: "fcp" | "lcp" | "cls",
  value: number | undefined,
): "good" | "needs-improvement" | "poor" | "unknown" {
  if (value === undefined) {
    return "unknown";
  }

  if (metric === "cls") {
    if (value <= 0.1) {
      return "good";
    }
    if (value <= 0.25) {
      return "needs-improvement";
    }
    return "poor";
  }

  if (metric === "fcp") {
    if (value <= 1800) {
      return "good";
    }
    if (value <= 3000) {
      return "needs-improvement";
    }
    return "poor";
  }

  if (value <= 2500) {
    return "good";
  }
  if (value <= 4000) {
    return "needs-improvement";
  }
  return "poor";
}

function getTabCountLabel(
  tab: DebugTab,
  data: {
    apiCount: number;
    consoleCount: number;
  },
): string | null {
  if (tab === "api") {
    return String(data.apiCount);
  }
  if (tab === "console") {
    return String(data.consoleCount);
  }
  return null;
}

function getRequestStatusClassName(status: DebugApiRequest["status"]): string {
  if (status === "ERROR") {
    return "bg-red-500/20 text-red-300";
  }
  if (status >= 200 && status < 300) {
    return "bg-emerald-500/20 text-emerald-300";
  }
  if (status >= 400) {
    return "bg-red-500/20 text-red-300";
  }
  return "bg-amber-500/20 text-amber-300";
}

function getConsoleLevelClassName(level: DebugConsoleEntry["level"]): string {
  if (level === "warn") {
    return "bg-amber-500/20 text-amber-300";
  }
  if (level === "error") {
    return "bg-red-500/20 text-red-300";
  }
  return "bg-zinc-700 text-zinc-200";
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

function formatPrimitiveValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "string") {
    return `"${value}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  if (typeof value === "symbol") {
    return value.toString();
  }
  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }
  return String(value);
}

function readStoredBoolean(storageKey: string, fallback: boolean): boolean {
  if (typeof window === "undefined") {
    return fallback;
  }
  const rawValue = window.localStorage.getItem(storageKey);
  if (rawValue === null) {
    return fallback;
  }
  return rawValue === "true";
}
