import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AllRecords, RecordKind } from "../shared/types";
import { api } from "./api";
import { startRecordSync } from "./lib/recordSync";

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

  const reloadVersion = useRef(0);
  const reload = useCallback(async () => {
    const version = ++reloadVersion.current;
    try {
      const data = await api.fetchRecords();
      // 写入后的补拉与后台同步可能重叠，旧请求不能覆盖新请求的结果。
      if (version === reloadVersion.current) setRecords(data);
    } finally {
      if (version === reloadVersion.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => startRecordSync(reload), [reload]);

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
  /** 手动指定白天/黑夜主题;auto 跟随系统深色模式和夜间时段 */
  themeMode: ThemeMode;
}

export type ThemeMode = "auto" | "light" | "dark";

const DEFAULT_SETTINGS: AppSettings = {
  feedingOverdueAlarmEnabled: false,
  feedingOverdueDelayMinutes: 180,
  keepAwakeEnabled: true,
  themeMode: "auto",
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
