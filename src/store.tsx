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
  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/api/events`);

      socket.addEventListener("message", (event) => {
        if (event.data === "records-changed") void reload();
      });

      socket.addEventListener("close", () => {
        socket = null;
        if (!disposed) reconnectTimer = window.setTimeout(connect, 1000);
      });
    };

    connect();
    window.addEventListener("online", connect);

    return () => {
      disposed = true;
      window.removeEventListener("online", connect);
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
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
}

const DEFAULT_SETTINGS: AppSettings = {
  feedingOverdueAlarmEnabled: false,
  feedingOverdueDelayMinutes: 180,
  keepAwakeEnabled: true,
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
