import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { feedingAlarm } from "./alarm";
import { Icon } from "./components/Icon";
import { api, UnauthorizedError } from "./api";
import type { SessionInfo } from "../shared/types";
import { SessionContext, useAccess } from "./auth";
import { HomePage } from "./pages/HomePage";
import { QuickLogPage } from "./pages/QuickLogPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StatsPage } from "./pages/StatsPage";
import { TimelinePage } from "./pages/TimelinePage";
import { DataProvider, useData, useSettings, type AppSettings } from "./store";

type AuthState = "checking" | "unauthed" | "authed";

const TABS = [
  { key: "home", label: "首页", icon: "home" },
  { key: "timeline", label: "时间线", icon: "timeline" },
  { key: "quickLog", label: "快速记录", icon: "plus" },
  { key: "stats", label: "统计", icon: "chart" },
  { key: "settings", label: "设置", icon: "settings" },
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
  const [session, setSession] = useState<SessionInfo>({ permission: "read" });
  const [shareToken, setShareToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("share"));
  const [shareAttempt, setShareAttempt] = useState(0);
  const [shareError, setShareError] = useState("");
  const [settings] = useSettings();

  useNightDimming(settings.nightDimEnabled);

  useEffect(() => {
    const expired = () => {
      setShareError("登录已失效，分享 Key 可能已停用或到期，请重新登录。");
      setAuthState("unauthed");
    };
    window.addEventListener("babynote-session-expired", expired);
    return () => window.removeEventListener("babynote-session-expired", expired);
  }, []);

  useEffect(() => {
    const openShare = () => {
      const token = new URLSearchParams(window.location.hash.slice(1)).get("share");
      if (token === null) return;
      setShareToken(token);
      setShareAttempt((attempt) => attempt + 1);
      setShareError("");
      setAuthState("checking");
    };
    window.addEventListener("hashchange", openShare);
    return () => window.removeEventListener("hashchange", openShare);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer = 0;

    // Credentials travel in the fragment, then leave the address bar before login.
    // Keep the token in component state so StrictMode and network retries still work.
    if (shareToken !== null) {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      hash.delete("share");
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${hash.toString() ? `#${hash}` : ""}`);
    }

    const check = () => {
      (shareToken !== null ? api.loginWithShare(shareToken) : api.me())
        .then((session) => {
          if (!cancelled) { setSession(session); setAuthState("authed"); }
        })
        .catch((error) => {
          if (cancelled) return;
          if (error instanceof UnauthorizedError) {
            if (shareToken !== null) setShareError("分享链接无效或已过期，请让家人重新生成，也可以使用密码登录。");
            setAuthState("unauthed");
          } else {
            // 网络错误(如 Safari 夜里回收页面后自动刷新时网络未就绪):
            // 不能当成未登录弹出登录页,保持"加载中"稍后重试。
            retryTimer = window.setTimeout(check, 2000);
          }
        });
    };

    check();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
    };
  }, [shareToken, shareAttempt]);

  if (authState === "checking") {
    return (
      <div className="login-page">
        <span className="muted">加载中…</span>
      </div>
    );
  }

  if (authState === "unauthed") {
    return <LoginPage initialError={shareError} onLoggedIn={(session) => { setSession(session); setShareError(""); setAuthState("authed"); }} />;
  }

  return (
    <SessionContext.Provider value={session}><DataProvider>
      <AuthedApp settings={settings} onLogout={() => setAuthState("unauthed")} />
    </DataProvider></SessionContext.Provider>
  );
}

function LoginPage({ onLoggedIn, initialError = "" }: { onLoggedIn: (session: SessionInfo) => void; initialError?: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (!password || isSubmitting) return;
    setIsSubmitting(true);
    setError("");
    try {
      onLoggedIn(await api.login(password));
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

function AuthedApp({ settings, onLogout }: { settings: AppSettings; onLogout: () => void }) {
  const { canWrite } = useAccess();
  const [tab, setTab] = useState<TabKey>(() => {
    const requested = tabFromPath(window.location.pathname);
    return !canWrite && requested === "quickLog" ? "timeline" : requested;
  });
  const { records, isLoading } = useData();
  const alarmState = useSyncExternalStore(
    (listener) => feedingAlarm.subscribe(listener),
    () => feedingAlarm.getState(),
  );

  // 老款 iPad 的 Safari/Chrome 工具栏会压缩真实可视区域。
  useEffect(() => {
    const tabletLayout = window.matchMedia("(min-width: 900px)");
    let animationFrame = 0;

    const updateViewportHeight = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        if (!tabletLayout.matches) {
          document.documentElement.style.removeProperty("--app-viewport-height");
          return;
        }

        const measuredHeight = window.visualViewport?.height ?? window.innerHeight;
        if (!Number.isFinite(measuredHeight) || measuredHeight < 320) return;
        document.documentElement.style.setProperty(
          "--app-viewport-height",
          `${Math.floor(measuredHeight)}px`,
        );
      });
    };

    updateViewportHeight();
    window.addEventListener("resize", updateViewportHeight);
    window.visualViewport?.addEventListener("resize", updateViewportHeight);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", updateViewportHeight);
      window.visualViewport?.removeEventListener("resize", updateViewportHeight);
      document.documentElement.style.removeProperty("--app-viewport-height");
    };
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const requested = tabFromPath(window.location.pathname);
      setTab(!canWrite && requested === "quickLog" ? "timeline" : requested);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [canWrite]);

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
      {tab === "quickLog" && (canWrite ? <QuickLogPage /> : <TimelinePage />)}
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
          {TABS.filter((item) => canWrite || item.key !== "quickLog").map((item) => (
            <a
              key={item.key}
              href={TAB_PATHS[item.key]}
              className={`tab-item ${item.key === "quickLog" ? "primary" : ""} ${tab === item.key ? "active" : ""}`}
              onClick={(event) => {
                event.preventDefault();
                navigateToTab(item.key);
              }}
            >
              <span className="tab-icon"><Icon name={item.icon} strokeWidth={item.key === "quickLog" ? 2.4 : 1.8} /></span>
              <span>{item.label}</span>
            </a>
          ))}
        </div>
      </nav>

      {alarmState.isActive && (
        <div className="alarm-overlay" onClick={() => feedingAlarm.stopAlarmAfterUserInteraction()}>
          <Icon name="bell" className="alarm-icon" size={64} strokeWidth={1.6} />
          <h1>{alarmState.title}</h1>
          <p>{alarmState.message}</p>
          <p className="hint">触摸屏幕任意位置即可停止</p>
        </div>
      )}
    </div>
  );
}

function useNightDimming(enabled: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    let transitionTimer = 0;

    const update = () => {
      window.clearTimeout(transitionTimer);

      const now = new Date();
      const hour = now.getHours();
      const isNight = enabled && (hour >= 20 || hour < 7);

      if (isNight) {
        root.dataset.nightDim = "true";
        themeColor?.setAttribute("content", "#09080b");
      } else {
        delete root.dataset.nightDim;
        themeColor?.setAttribute("content", "#e91e63");
      }

      if (!enabled) return;

      const nextTransition = new Date(now);
      if (hour >= 20) {
        nextTransition.setDate(nextTransition.getDate() + 1);
        nextTransition.setHours(7, 0, 1, 0);
      } else if (hour < 7) {
        nextTransition.setHours(7, 0, 1, 0);
      } else {
        nextTransition.setHours(20, 0, 1, 0);
      }

      transitionTimer = window.setTimeout(update, Math.max(nextTransition.getTime() - now.getTime(), 1000));
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") update();
    };

    update();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearTimeout(transitionTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      delete root.dataset.nightDim;
      themeColor?.setAttribute("content", "#e91e63");
    };
  }, [enabled]);
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
