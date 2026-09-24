import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AllRecords, RecordKind } from "../shared/types";
import { api } from "./api";

const EMPTY_RECORDS: AllRecords = {
  feedings: [],
  weights: [],
  medications: [],
  checkups: [],
  fetalMovements: [],
  bloodGlucoses: [],
  excretions: [],
};

interface DataContextValue {
  records: AllRecords;
  isLoading: boolean;
  reload: () => Promise<void>;
  create: (kind: RecordKind, payload: Record<string, unknown>) => Promise<void>;
  update: (kind: RecordKind, id: number, payload: Record<string, unknown>) => Promise<void>;
  remove: (kind: RecordKind, id: number) => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<AllRecords>(EMPTY_RECORDS);
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    const data = await api.fetchRecords();
    setRecords(data);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    reload().catch(() => setIsLoading(false));
  }, [reload]);

  // 事件驱动实时同步：其他设备发生写入后，WebSocket 立即通知当前页面重新读取。
  // iOS Safari 挂起页面时经常把连接弄成"半死"状态(不触发 close),因此:
  // 1) 心跳 ping/pong 检测死链;2) 页面恢复可见时补拉数据并校验连接;3) 断线指数退避重连,重连成功后补拉。
  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let pongTimer: number | null = null;
    let reconnectDelay = 1000;
    let hasConnectedOnce = false;
    let disposed = false;

    const safeReload = () => void reload().catch(() => {});

    const clearPongTimer = () => {
      if (pongTimer != null) {
        window.clearTimeout(pongTimer);
        pongTimer = null;
      }
    };

    const stopHeartbeat = () => {
      if (heartbeatTimer != null) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      clearPongTimer();
    };

    const pingSocket = (target: WebSocket) => {
      try {
        target.send("ping");
      } catch {
        return;
      }
      // 10 秒内没有任何服务端消息就视为死链,主动关闭以触发重连
      if (pongTimer == null) {
        pongTimer = window.setTimeout(() => {
          pongTimer = null;
          target.close();
        }, 10_000);
      }
    };

    const connect = () => {
      if (disposed || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const nextSocket = new WebSocket(`${protocol}//${window.location.host}/api/events`);
      socket = nextSocket;

      nextSocket.addEventListener("open", () => {
        reconnectDelay = 1000;
        // 重连成功后补拉断线期间可能错过的变更
        if (hasConnectedOnce) safeReload();
        hasConnectedOnce = true;
        stopHeartbeat();
        heartbeatTimer = window.setInterval(() => {
          if (document.visibilityState === "visible") pingSocket(nextSocket);
        }, 30_000);
      });

      nextSocket.addEventListener("message", (event) => {
        clearPongTimer(); // 收到任何消息都说明连接活着
        if (event.data === "records-changed") safeReload();
      });

      nextSocket.addEventListener("close", () => {
        // 已被新连接取代的旧连接,收尾时不能动新连接的心跳/重连状态
        if (socket !== nextSocket) return;
        socket = null;
        stopHeartbeat();
        if (disposed) return;
        reconnectTimer = window.setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 15_000);
      });
    };

    // 页面从后台/冻结状态恢复(visibilitychange / bfcache pageshow):主动补拉 + 校验连接
    const handleResume = () => {
      if (disposed || document.visibilityState !== "visible") return;
      if (hasConnectedOnce) safeReload();
      if (socket?.readyState === WebSocket.OPEN) {
        pingSocket(socket);
      } else if (socket?.readyState !== WebSocket.CONNECTING) {
        if (reconnectTimer != null) {
          window.clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        reconnectDelay = 1000;
        connect();
      }
    };

    connect();
    window.addEventListener("online", connect);
    document.addEventListener("visibilitychange", handleResume);
    window.addEventListener("pageshow", handleResume);

    return () => {
      disposed = true;
      window.removeEventListener("online", connect);
      document.removeEventListener("visibilitychange", handleResume);
      window.removeEventListener("pageshow", handleResume);
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
      stopHeartbeat();
      socket?.close();
    };
  }, [reload]);

  const create = useCallback(
    async (kind: RecordKind, payload: Record<string, unknown>) => {
      await api.create(kind, payload);
      await reload();
    },
    [reload],
  );

  const update = useCallback(
    async (kind: RecordKind, id: number, payload: Record<string, unknown>) => {
      await api.update(kind, id, payload);
      await reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (kind: RecordKind, id: number) => {
      await api.remove(kind, id);
      await reload();
    },
    [reload],
  );

  const value = useMemo(
    () => ({ records, isLoading, reload, create, update, remove }),
    [records, isLoading, reload, create, update, remove],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const value = useContext(DataContext);
  if (!value) throw new Error("useData 必须在 DataProvider 内使用");
  return value;
}

// ---------- 本机设置(localStorage,和 iOS AppStorage 对应) ----------

export interface AppSettings {
  feedingOverdueAlarmEnabled: boolean;
  feedingOverdueDelayMinutes: number;
  keepAwakeEnabled: boolean;
  nightDimEnabled: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  feedingOverdueAlarmEnabled: false,
  feedingOverdueDelayMinutes: 180,
  keepAwakeEnabled: true,
  nightDimEnabled: true,
};

const SETTINGS_KEY = "babynote-settings";

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useSettings(): [AppSettings, (patch: Partial<AppSettings>) => void] {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent("babynote-settings-changed", { detail: next }));
      return next;
    });
  }, []);

  // 其他组件修改设置时同步
  useEffect(() => {
    const handler = (event: Event) => {
      setSettings((event as CustomEvent<AppSettings>).detail);
    };
    window.addEventListener("babynote-settings-changed", handler);
    return () => window.removeEventListener("babynote-settings-changed", handler);
  }, []);

  return [settings, updateSettings];
}
