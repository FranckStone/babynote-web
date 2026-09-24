import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Icon } from "./components/Icon";
import "./styles.css";
import "./ios27.css";

const CRASH_RELOAD_KEY = "babynote-crash-reload-at";

// 渲染出错时 React 会卸载整棵树留下白屏,这里兜底:
// 10 分钟内自动刷新一次自愈(床头挂机没人操作),仍然出错则显示手动刷新按钮。
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    try {
      const lastReloadAt = Number(localStorage.getItem(CRASH_RELOAD_KEY) ?? 0);
      if (Date.now() - lastReloadAt > 10 * 60_000) {
        localStorage.setItem(CRASH_RELOAD_KEY, `${Date.now()}`);
        window.location.reload();
      }
    } catch {
      // localStorage 不可用(如隐私模式)时只提供手动刷新
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="login-page">
          <Icon name="frown" size={44} strokeWidth={1.6} style={{ color: "var(--text-secondary)" }} />
          <h1 style={{ margin: 0 }}>页面出错了</h1>
          <span className="muted">刷新一下就能恢复</span>
          <button
            type="button"
            className="primary-button"
            style={{ background: "var(--pink)", color: "#fff", minWidth: 200 }}
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
