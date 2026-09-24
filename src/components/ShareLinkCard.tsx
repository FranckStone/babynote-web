import { useCallback, useEffect, useRef, useState } from "react";
import type { CreateShareKey, ShareKey } from "../../shared/types";
import { api } from "../api";

function linkFor(key: ShareKey) {
  const url = new URL("/", window.location.origin);
  url.hash = new URLSearchParams({ share: key.token }).toString();
  return url.toString();
}

export function ShareLinkCard() {
  const [keys, setKeys] = useState<ShareKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [permission, setPermission] = useState<CreateShareKey["permission"]>("write");
  const [duration, setDuration] = useState("7");
  const [creating, setCreating] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [now, setNow] = useState(Date.now());
  const creatingLock = useRef(false);
  const togglingLock = useRef(false);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const localOnly = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try { setKeys(await api.fetchShareKeys()); }
    catch (error) { setLoadError(error instanceof Error ? error.message : "分享 Key 加载失败"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const create = async () => {
    if (creatingLock.current || !name.trim()) return;
    creatingLock.current = true;
    setCreating(true);
    setError("");
    setFeedback("");
    try {
      const key = await api.createShareKey({ name: name.trim(), permission, durationDays: duration === "permanent" ? null : Number(duration) as 1 | 7 | 30 });
      setKeys((current) => [key, ...current]);
      setName("");
      setNow(Date.now());
      setFeedback(`已创建「${key.name}」，已保存到列表`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "创建失败，请重试");
    } finally { creatingLock.current = false; setCreating(false); }
  };

  const toggle = async (key: ShareKey) => {
    if (togglingLock.current) return;
    togglingLock.current = true;
    setBusyKey(key.id);
    setError("");
    setFeedback("");
    try {
      const updated = await api.setShareKeyDisabled(key.id, key.disabledAt === null);
      setKeys((current) => current.map((item) => item.id === updated.id ? updated : item));
      setFeedback(`「${key.name}」已${updated.disabledAt === null ? "启用" : "停用"}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "操作失败，请重试");
    } finally { togglingLock.current = false; setBusyKey(null); }
  };

  const copy = async (key: ShareKey) => {
    setFeedback("");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(linkFor(key));
      setFeedback(`「${key.name}」的链接已复制`);
    } catch {
      const input = inputs.current.get(key.id);
      input?.focus(); input?.select(); input?.setSelectionRange(0, input.value.length);
      let copied = false;
      try { copied = document.execCommand("copy"); } catch { /* Manual copy remains available. */ }
      setFeedback(copied ? `「${key.name}」的链接已复制` : "请长按或复制已选中的链接");
    }
  };

  return (
    <section className="card settings-share-card">
      <h2 className="card-title">分享 Key</h2>
      <p className="muted small">为不同家人创建独立链接。只读可查看记录；读写可添加、修改和删除记录。停用或到期后，已登录的设备也将失去访问权限。</p>
      <form className="share-key-form" onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <label className="share-key-field">名称
          <input value={name} maxLength={50} required placeholder="例如：爸爸、奶奶、月嫂" onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="share-key-options">
          <label className="share-key-field">访问权限
            <select value={permission} onChange={(event) => setPermission(event.target.value as CreateShareKey["permission"])}>
              <option value="read">只读</option><option value="write">读写</option>
            </select>
          </label>
          <label className="share-key-field">有效期
            <select value={duration} onChange={(event) => setDuration(event.target.value)}>
              <option value="permanent">永久</option><option value="1">1 天</option><option value="7">7 天</option><option value="30">30 天</option>
            </select>
          </label>
        </div>
        <button type="submit" className="primary-button share-generate-button" disabled={creating || loading || !!loadError || !name.trim()}>
          {creating ? "创建中…" : "创建分享 Key"}
        </button>
      </form>
      {error && <span className="error-text" role="alert">{error}</span>}
      <span className="small share-feedback" role="status">{feedback}</span>
      <div className="share-key-list-heading"><strong>已创建的 Key{!loading && !loadError ? `（${keys.length}）` : ""}</strong>
        <button type="button" className="share-list-refresh" disabled={loading || creating || busyKey !== null} onClick={() => void load()}>刷新列表</button>
      </div>
      {loading ? <span className="muted small">正在加载…</span> : loadError ? (
        <span className="error-text" role="alert">{loadError}，请刷新列表重试。</span>
      ) : keys.length === 0 ? <p className="muted small">还没有分享 Key，创建后会保存在这里。</p> : (
        <div className="share-key-list">
          {keys.map((key) => {
            const expired = key.expiresAt !== null && key.expiresAt <= now;
            const active = !expired && key.disabledAt === null;
            return <article className="share-key-item" key={key.id}>
              <div className="share-key-title"><strong>{key.name}</strong><span className={`share-key-status ${active ? "active" : ""}`}>{key.disabledAt !== null ? "已停用" : expired ? "已过期" : "使用中"}</span></div>
              <div className="share-key-meta"><span>{key.permission === "read" ? "只读" : "读写"}</span><span>{key.expiresAt === null ? "永久有效" : `${new Date(key.expiresAt).toLocaleString("zh-CN")} 到期`}</span></div>
              <span className="muted small">创建于 {new Date(key.createdAt).toLocaleString("zh-CN")} · {key.lastUsedAt === null ? "尚未使用" : `最近登录 ${new Date(key.lastUsedAt).toLocaleString("zh-CN")}`}</span>
              <input ref={(node) => { if (node) inputs.current.set(key.id, node); else inputs.current.delete(key.id); }} aria-label={`${key.name}的分享链接`} readOnly value={linkFor(key)} onFocus={(event) => event.currentTarget.select()} />
              <div className="share-key-actions">
                <button type="button" className="share-copy-button" disabled={!active} onClick={() => void copy(key)}>复制链接</button>
                <button type="button" className="share-toggle-button" disabled={busyKey !== null || (expired && key.disabledAt !== null)} onClick={() => void toggle(key)}>
                  {busyKey === key.id ? "处理中…" : key.disabledAt === null ? "停用" : "启用"}
                </button>
              </div>
            </article>;
          })}
        </div>
      )}
      {localOnly && <p className="muted small">当前是本地地址，仅能在本机打开。分享给家人时，请在正式网站创建 Key。</p>}
    </section>
  );
}
