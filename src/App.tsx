import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { feedingAlarm } from "./alarm";
import { api } from "./api";
import { HomePage } from "./pages/HomePage";
import { QuickLogPage } from "./pages/QuickLogPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StatsPage } from "./pages/StatsPage";
import { TimelinePage } from "./pages/TimelinePage";
import { DataProvider, useData, useSettings } from "./store";

type AuthState = "checking" | "unauthed" | "authed";

const TABS = [
  { key: "home", label: "首页", icon: "🏠" },
  { key: "timeline", label: "时间线", icon: "📋" },
  { key: "quickLog", label: "快速记录", icon: "➕" },
  { key: "stats", label: "统计", icon: "📈" },
  { key: "settings", label: "设置", icon: "⚙️" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const TAB_PATHS: Record<TabKey, string> = {
  home: "/",
  timeline: "/timeline",
  quickLog: "/quick-log",
  stats: "/stats",
  settings: "/settings",
};

function tabFromPath(pathname: string): TabKey {
  if (pathname.startsWith("/timeline")) return "timeline";
  if (pathname.startsWith("/quick-log")) return "quickLog";
  if (pathname.startsWith("/stats")) return "stats";
  if (pathname.startsWith("/settings")) return "settings";
  return "home";
}

export function App() {
  const [authState, setAuthState] = useState<AuthState>("checking");

  useEffect(() => {
    api
      .me()
      .then(() => setAuthState("authed"))
      .catch(() => setAuthState("unauthed"));
  }, []);

  if (authState === "checking") {
    return (
      <div className="login-page">
        <span className="muted">加载中…</span>
      </div>
    );
  }

  if (authState === "unauthed") {
    return <LoginPage onLoggedIn={() => setAuthState("authed")} />;
  }

  return (
    <DataProvider>
      <AuthedApp onLogout={() => setAuthState("unauthed")} />
    </DataProvider>
  );
}

function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (!password || isSubmitting) return;
    setIsSubmitting(true);
    setError("");
    try {
      await api.login(password);
      onLoggedIn();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <img className="login-logo" src="/icon-192.png" alt="宝宝笔记 Logo" />
      <h1 style={{ margin: 0 }}>宝宝笔记</h1>
      <form
        className="login-card"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          type="password"
          placeholder="访问密码"
          value={password}
          autoFocus
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && <span className="error-text">{error}</span>}
        <button
          type="submit"
          className="primary-button"
          style={{ background: "var(--pink)", color: "#fff" }}
          disabled={!password || isSubmitting}
        >
          {isSubmitting ? "登录中…" : "进入"}
        </button>
      </form>
    </div>
  );
}

function AuthedApp({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<TabKey>(() => tabFromPath(window.location.pathname));
  const { records, isLoading } = useData();
  const [settings] = useSettings();
  const alarmState = useSyncExternalStore(
    (listener) => feedingAlarm.subscribe(listener),
    () => feedingAlarm.getState(),
  );

  useEffect(() => {
    const handlePopState = () => setTab(tabFromPath(window.location.pathname));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigateToTab = (nextTab: TabKey) => {
    const path = TAB_PATHS[nextTab];
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
    setTab(nextTab);
  };

  // 喂奶记录或闹钟设置变化时重新计算提醒时间
  const latestFeeding = records.feedings[0] ?? null;
  const latestFeedingDate = latestFeeding ? (latestFeeding.endedAt ?? latestFeeding.startedAt) : null;
  useEffect(() => {
    feedingAlarm.update(
      settings.feedingOverdueAlarmEnabled,
      settings.feedingOverdueDelayMinutes,
      latestFeedingDate,
    );
  }, [settings.feedingOverdueAlarmEnabled, settings.feedingOverdueDelayMinutes, latestFeedingDate]);

  // 全局交互:停止正在响的闹钟
  useEffect(() => {
    const handler = () => {
      feedingAlarm.stopAlarmAfterUserInteraction();
    };
    window.addEventListener("pointerdown", handler);
    window.addEventListener("keydown", handler);
    window.addEventListener("scroll", handler, { passive: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", handler);
      window.removeEventListener("keydown", handler);
      window.removeEventListener("scroll", handler, { capture: true });
    };
  }, []);

  // Wake Lock 保持屏幕常亮
  useWakeLock(settings.keepAwakeEnabled);

  return (
    <div className="app">
      {tab === "home" && <HomePage />}
      {tab === "timeline" && <TimelinePage />}
      {tab === "quickLog" && <QuickLogPage />}
      {tab === "stats" && <StatsPage />}
      {tab === "settings" && <SettingsPage onLogout={onLogout} />}

      {isLoading && (
        <div style={{ position: "fixed", top: 12, left: 0, right: 0, textAlign: "center" }}>
          <span className="chip" style={{ background: "var(--surface)" }}>
            同步中…
          </span>
        </div>
      )}

      <nav className="tab-bar">
        <div className="tab-bar-inner">
          {TABS.map((item) => (
            <a
              key={item.key}
              href={TAB_PATHS[item.key]}
              className={`tab-item ${item.key === "quickLog" ? "primary" : ""} ${tab === item.key ? "active" : ""}`}
              onClick={(event) => {
                event.preventDefault();
                navigateToTab(item.key);
              }}
            >
              <span className="tab-icon">{item.icon}</span>
              <span>{item.label}</span>
            </a>
          ))}
        </div>
      </nav>

      {alarmState.isActive && (
        <div className="alarm-overlay" onClick={() => feedingAlarm.stopAlarmAfterUserInteraction()}>
          <span className="alarm-icon">🔔</span>
          <h1>{alarmState.title}</h1>
          <p>{alarmState.message}</p>
          <p className="hint">触摸屏幕任意位置即可停止</p>
        </div>
      )}
    </div>
  );
}

function useWakeLock(enabled: boolean) {
  const lockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!enabled || !("wakeLock" in navigator)) return;

    let cancelled = false;

    const request = async () => {
      try {
        if (document.visibilityState !== "visible") return;
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void lock.release();
          return;
        }
        lockRef.current = lock;
      } catch {
        // 浏览器拒绝(如低电量模式),忽略
      }
    };

    void request();
    const onVisibilityChange = () => void request();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void lockRef.current?.release();
      lockRef.current = null;
    };
  }, [enabled]);
}
