const SYNC_INTERVAL_MS = 30_000;
const CONNECTION_TIMEOUT_MS = 10_000;

/** WebSocket 通知负责即时刷新，前台定时读取负责补上漏掉的通知。 */
export function startRecordSync(reload: () => Promise<void>): () => void {
  let socket: WebSocket | null = null;
  let reconnectTimer: number | undefined;
  let connectionTimer: number | undefined;
  let pongTimer: number | undefined;
  let reconnectDelay = 1000;
  let disposed = false;
  let refreshing = false;
  let refreshAgain = false;

  const isActive = () => !disposed && document.visibilityState === "visible";
  const canConnect = () => isActive() && navigator.onLine !== false;

  const refresh = async () => {
    if (!isActive()) return;
    if (refreshing) {
      refreshAgain = true;
      return;
    }
    refreshing = true;
    try {
      await reload();
    } catch {
      // 网络失败由下一次定时同步或恢复事件重试，保留当前记录。
    } finally {
      refreshing = false;
      if (refreshAgain) {
        refreshAgain = false;
        void refresh();
      }
    }
  };

  const clearReconnect = () => {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  };

  const releaseSocket = () => {
    window.clearTimeout(connectionTimer);
    window.clearTimeout(pongTimer);
    connectionTimer = pongTimer = undefined;
    const previous = socket;
    // 先丢弃引用：Safari 即使不派发 close，也不阻塞下一次连接。
    socket = null;
    try {
      previous?.close();
    } catch {
      // 已失效的连接无需等待浏览器关闭。
    }
  };

  const retry = () => {
    releaseSocket();
    clearReconnect();
    if (!canConnect()) return;
    reconnectTimer = window.setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 15_000);
  };

  const ping = (target: WebSocket) => {
    if (socket !== target || pongTimer !== undefined) return;
    // 先安排超时，避免无 close 事件的半开连接一直占用 socket。
    pongTimer = window.setTimeout(retry, CONNECTION_TIMEOUT_MS);
    try {
      target.send("ping");
    } catch {
      retry();
    }
  };

  function connect() {
    clearReconnect();
    if (!canConnect() || socket) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    let next: WebSocket;
    try {
      next = new WebSocket(`${protocol}//${window.location.host}/api/events`);
    } catch {
      retry();
      return;
    }
    socket = next;
    connectionTimer = window.setTimeout(retry, CONNECTION_TIMEOUT_MS);

    next.addEventListener("open", () => {
      if (socket !== next) return;
      window.clearTimeout(connectionTimer);
      connectionTimer = undefined;
      reconnectDelay = 1000;
      // 首次连接也补拉，覆盖初次读取与订阅成功之间的写入。
      void refresh();
      ping(next);
    });
    next.addEventListener("message", (event) => {
      if (socket !== next) return;
      window.clearTimeout(pongTimer);
      pongTimer = undefined;
      if (event.data === "records-changed") void refresh();
    });
    const handleFailure = () => {
      if (socket === next) retry();
    };
    next.addEventListener("error", handleFailure);
    next.addEventListener("close", handleFailure);
  }

  const resume = () => {
    if (!isActive()) return;
    void refresh();
    clearReconnect();
    reconnectDelay = 1000;
    // 从后台或网络切换恢复时重建连接，不相信 Safari 遗留的 readyState。
    releaseSocket();
    connect();
  };
  const pause = () => {
    clearReconnect();
    releaseSocket();
  };
  const handleVisibility = () => {
    if (isActive()) resume();
    else pause();
  };

  const syncTimer = window.setInterval(() => {
    if (!isActive()) return;
    void refresh();
    if (socket?.readyState === WebSocket.OPEN) ping(socket);
    else if (!socket && reconnectTimer === undefined) connect();
  }, SYNC_INTERVAL_MS);

  void refresh();
  connect();
  window.addEventListener("online", resume);
  window.addEventListener("offline", pause);
  window.addEventListener("pageshow", resume);
  window.addEventListener("pagehide", pause);
  window.addEventListener("focus", resume);
  document.addEventListener("visibilitychange", handleVisibility);

  return () => {
    disposed = true;
    window.clearInterval(syncTimer);
    pause();
    window.removeEventListener("online", resume);
    window.removeEventListener("offline", pause);
    window.removeEventListener("pageshow", resume);
    window.removeEventListener("pagehide", pause);
    window.removeEventListener("focus", resume);
    document.removeEventListener("visibilitychange", handleVisibility);
  };
}
