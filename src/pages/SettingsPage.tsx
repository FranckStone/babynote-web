import { useAccess } from "../auth";
import { AnimatedList } from "../components/AnimatedList";
import { Icon } from "../components/Icon";
import { ShareLinkCard } from "../components/ShareLinkCard";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { TrashItem } from "../../shared/types";
import { feedingAlarm } from "../alarm";
import {
  DateDisplay,
  WeightDisplay,
  bloodGlucoseMomentNames,
  excretionAmountNames,
  excretionTypeNames,
  feedingTypeNames,
  format1,
  formatFeedingAmount,
} from "../lib/display";
import { recordKindMeta } from "../lib/timeline";
import { useSettings } from "../store";
import { api } from "../api";
import { Modal } from "../components/widgets";

function trashKey(item: TrashItem): string {
  return `${item.kind}-${item.record.id}`;
}

function trashRecordedAt(item: TrashItem): number {
  return item.kind === "feeding" ? item.record.startedAt : item.record.recordedAt;
}

function trashDescription(item: TrashItem): { title: string; detail: string } {
  switch (item.kind) {
    case "feeding":
      return {
        title: feedingTypeNames[item.record.feedingType] ?? "喂奶",
        detail: item.record.amountML == null ? "未填写奶量" : formatFeedingAmount(item.record.amountML),
      };
    case "weight":
      return { title: "体重记录", detail: WeightDisplay.jinText(item.record.weightKG) };
    case "medication":
      return { title: item.record.name || "药物", detail: item.record.dosage || "未填写剂量" };
    case "checkup":
      return {
        title: item.record.location || "检查记录",
        detail: item.record.summary || item.record.note || "未填写详情",
      };
    case "fetalMovement": {
      const details = [
        item.record.movementCount == null ? null : `${item.record.movementCount} 次`,
        item.record.durationMinutes == null ? null : `${item.record.durationMinutes} 分钟`,
      ].filter(Boolean);
      return { title: "胎动记录", detail: details.join(" · ") || "未填写次数或时长" };
    }
    case "bloodGlucose":
      return {
        title: bloodGlucoseMomentNames[item.record.moment] ?? "血糖",
        detail: `${format1(item.record.valueMMOL)} mmol/L`,
      };
    case "excretion":
      return {
        title: excretionTypeNames[item.record.type] ?? "屎尿记录",
        detail: item.record.amount ? `量${excretionAmountNames[item.record.amount]}` : "未填写量",
      };
  }
}

function RecycleBinModal({
  items,
  isLoading,
  loadError,
  onDismiss,
  onRetry,
  onRemove,
}: {
  items: TrashItem[];
  isLoading: boolean;
  loadError: string | null;
  onDismiss: () => void;
  onRetry: () => Promise<void>;
  onRemove: (item: TrashItem) => void;
}) {
  const { canWrite } = useAccess();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<TrashItem | null>(null);
  const [feedback, setFeedback] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const restore = async (item: TrashItem) => {
    const key = trashKey(item);
    setBusyKey(key);
    setActionError(null);
    try {
      await api.restoreTrash(item.kind, item.record.id);
      onRemove(item);
      setFeedback(`已恢复${recordKindMeta[item.kind].name}记录`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "恢复失败，请重试");
    } finally {
      setBusyKey(null);
    }
  };

  const permanentlyDelete = async (item: TrashItem) => {
    const key = trashKey(item);
    setBusyKey(key);
    setActionError(null);
    try {
      await api.permanentlyDeleteTrash(item.kind, item.record.id);
      onRemove(item);
      setConfirmingDelete(null);
      setFeedback("已永久删除记录");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "删除失败，请重试");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <>
      <Modal title={`回收站${items.length > 0 ? `（${items.length}）` : ""}`} onDismiss={onDismiss}>
        <div className="trash-intro">
          <span className="trash-intro-icon" aria-hidden="true"><Icon name="undo" /></span>
          <div>
            <strong>误删的记录可以在这里恢复</strong>
            <span className="muted small">永久删除后将无法找回。</span>
          </div>
        </div>

        <span className="sr-only" aria-live="polite">{feedback}</span>
        {actionError && <div className="trash-error" role="alert">{actionError}</div>}

        {isLoading ? (
          <div className="trash-state" role="status">正在读取回收站…</div>
        ) : loadError ? (
          <div className="trash-state">
            <span>{loadError}</span>
            <button type="button" className="trash-retry-button" onClick={() => void onRetry()}>
              重新加载
            </button>
          </div>
        ) : (
          <div className="trash-list">
            <AnimatedList emptyState={(
              <div className="trash-empty-state">
                <span className="trash-empty-icon" aria-hidden="true"><Icon name="check" strokeWidth={2.4} /></span>
                <strong>回收站是空的</strong>
                <span className="muted small">删除的记录会暂存在这里。</span>
              </div>
            )}>
              {items.map((item) => {
                const meta = recordKindMeta[item.kind];
                const description = trashDescription(item);
                const key = trashKey(item);
                const isBusy = busyKey === key;
                return (
                  <article className="trash-item" key={key}>
                    <div className="trash-item-main">
                      <span
                        className="trash-item-icon"
                        style={{ background: `color-mix(in srgb, ${meta.tint} 14%, transparent)`, color: meta.tint }}
                        aria-hidden="true"
                      >
                        <Icon name={meta.icon} />
                      </span>
                      <div className="trash-item-copy">
                        <div className="trash-item-title-row">
                          <strong>{description.title}</strong>
                          <span className="muted small">{DateDisplay.dateTime(trashRecordedAt(item))}</span>
                        </div>
                        <span className="trash-item-detail">{description.detail}</span>
                        <span className="muted trash-deleted-time">
                          {DateDisplay.dateTime(item.deletedAt)} 移入回收站
                        </span>
                      </div>
                    </div>
                    {canWrite && <div className="trash-actions">
                      <button
                        type="button"
                        className="trash-restore-button"
                        disabled={isBusy || busyKey !== null}
                        onClick={() => void restore(item)}
                      >
                        {isBusy ? "处理中…" : "恢复"}
                      </button>
                      <button
                        type="button"
                        className="trash-delete-button"
                        disabled={busyKey !== null}
                        onClick={() => setConfirmingDelete(item)}
                      >
                        永久删除
                      </button>
                    </div>}
                  </article>
                );
              })}
            </AnimatedList>
          </div>
        )}
      </Modal>

      {confirmingDelete && (
        <Modal
          title="永久删除这条记录？"
          onDismiss={() => setConfirmingDelete(null)}
          onSave={() => void permanentlyDelete(confirmingDelete)}
          canSave={busyKey === null}
          saveLabel={busyKey === trashKey(confirmingDelete) ? "删除中…" : "永久删除"}
        >
          <div className="trash-confirmation">
            <strong>{trashDescription(confirmingDelete).title}</strong>
            <span className="muted small">此操作无法撤销，记录将不能再恢复。</span>
          </div>
        </Modal>
      )}
    </>
  );
}

export function SettingsPage({ onLogout }: { onLogout: () => void }) {
  const { isOwner, canWrite, shareName } = useAccess();
  const [settings, updateSettings] = useSettings();
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashLoading, setTrashLoading] = useState(true);
  const [trashError, setTrashError] = useState<string | null>(null);
  const alarmState = useSyncExternalStore(
    (listener) => feedingAlarm.subscribe(listener),
    () => feedingAlarm.getState(),
  );

  const loadTrash = useCallback(async () => {
    setTrashLoading(true);
    setTrashError(null);
    try {
      setTrashItems(await api.fetchTrash());
    } catch (error) {
      setTrashError(error instanceof Error ? error.message : "回收站加载失败，请重试");
    } finally {
      setTrashLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTrash();
  }, [loadTrash]);

  return (
    <div className="page settings-page">
      <h1 className="page-title">设置</h1>

      <section className="card settings-screen-card">
        <h2 className="card-title">屏幕</h2>

        <label className="row" style={{ cursor: "pointer" }}>
          <span style={{ flex: 1 }}>保持屏幕常亮</span>
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={settings.keepAwakeEnabled}
              onChange={(event) => updateSettings({ keepAwakeEnabled: event.target.checked })}
            />
            <span className="toggle-track" aria-hidden="true" />
          </span>
        </label>
        <span className="muted" style={{ fontSize: 12 }}>
          开启后会阻止 iPad 自动息屏；页面切到后台时会自动释放，回到前台后重新申请。低电量模式或系统拒绝时可能无法保持常亮。
        </span>

        <hr className="settings-divider" />

        <label className="row" style={{ cursor: "pointer" }}>
          <span style={{ flex: 1 }}>夜间自动柔光</span>
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={settings.nightDimEnabled}
              onChange={(event) => updateSettings({ nightDimEnabled: event.target.checked })}
            />
            <span className="toggle-track" aria-hidden="true" />
          </span>
        </label>
        <span className="muted" style={{ fontSize: 12 }}>
          每晚 20:00 至次日 07:00 自动降低网页亮度和色彩刺激，白天自动恢复。
        </span>
      </section>

      <section className="card settings-alarm-card">
        <h2 className="card-title">喂奶闹钟</h2>

        <label className="row" style={{ cursor: "pointer" }}>
          <span style={{ flex: 1 }}>开启超时闹钟</span>
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={settings.feedingOverdueAlarmEnabled}
              onChange={(event) => updateSettings({ feedingOverdueAlarmEnabled: event.target.checked })}
            />
            <span className="toggle-track" aria-hidden="true" />
          </span>
        </label>

        <div className="row">
          <div style={{ flex: 1, opacity: settings.feedingOverdueAlarmEnabled ? 1 : 0.5 }}>
            <div>最后一次喂奶后</div>
            <div className="muted small">{DateDisplay.delayText(settings.feedingOverdueDelayMinutes)}</div>
          </div>
          <button
            type="button"
            className="chip"
            style={{ background: "var(--surface-variant)" }}
            disabled={!settings.feedingOverdueAlarmEnabled}
            onClick={() =>
              updateSettings({
                feedingOverdueDelayMinutes: Math.max(settings.feedingOverdueDelayMinutes - 15, 30),
              })
            }
          >
            −
          </button>
          <button
            type="button"
            className="chip"
            style={{ background: "var(--surface-variant)" }}
            disabled={!settings.feedingOverdueAlarmEnabled}
            onClick={() =>
              updateSettings({
                feedingOverdueDelayMinutes: Math.min(settings.feedingOverdueDelayMinutes + 15, 360),
              })
            }
          >
            ＋
          </button>
        </div>

        <span className="muted" style={{ fontSize: 12 }}>
          到时间后会持续响铃和震动；保存新的喂奶记录后会自动重新计算。网页关闭后不会触发,请保持页面打开。
        </span>

        <button
          type="button"
          className="primary-button"
          style={{ background: "var(--surface-variant)", minHeight: 44, fontSize: 15 }}
          onClick={() => feedingAlarm.startTestAlarm()}
        >
          <Icon name="bell" size={18} />
          测试持续闹钟
        </button>

        {alarmState.isActive && (
          <button
            type="button"
            className="primary-button"
            style={{ background: "rgb(229 57 53 / 12%)", color: "var(--red)", minHeight: 44, fontSize: 15 }}
            onClick={() => feedingAlarm.stopAlarm()}
          >
            <Icon name="stop" size={18} />
            停止闹钟
          </button>
        )}

        <span className="muted" style={{ fontSize: 12 }}>
          点击后会立即持续响铃和震动，直到手动停止。
        </span>
      </section>

      <section className="card settings-data-card">
        <h2 className="card-title">数据</h2>
        <button
          type="button"
          className="settings-navigation-row"
          onClick={() => {
            setTrashOpen(true);
            void loadTrash();
          }}
        >
          <span className="settings-navigation-icon" aria-hidden="true">
            <Icon name="trash" />
          </span>
          <span className="settings-navigation-copy">
            <strong>回收站</strong>
            <span className="muted small">恢复误删记录或永久清理</span>
          </span>
          {!trashLoading && !trashError && trashItems.length > 0 && (
            <span className="trash-count" aria-label={`${trashItems.length} 条记录`}>{trashItems.length}</span>
          )}
          <span className="settings-navigation-chevron" aria-hidden="true"><Icon name="chevronRight" size={20} strokeWidth={2} /></span>
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          普通删除只会移入回收站，不会立刻永久清除。
        </span>
      </section>

      <section className="card settings-account-card">
        <h2 className="card-title">账号</h2>
        <div className="settings-account-summary">
          <span className="settings-account-badge">{isOwner ? "管理员" : canWrite ? "读写访问" : "只读访问"}</span>
          <span className="muted small">{isOwner ? "通过访问密码登录" : `通过「${shareName}」登录`}</span>
        </div>
        <span className="muted small">{isOwner ? "可管理全部记录和分享 Key。" : "管理分享 Key 需要使用密码登录。"}</span>
        <button
          type="button"
          className="primary-button"
          style={{ background: "var(--surface-variant)", minHeight: 44, fontSize: 15 }}
          onClick={async () => {
            await api.logout();
            onLogout();
          }}
        >
          退出登录
        </button>
      </section>

      {isOwner && <ShareLinkCard />}

      {trashOpen && (
        <RecycleBinModal
          items={trashItems}
          isLoading={trashLoading}
          loadError={trashError}
          onDismiss={() => setTrashOpen(false)}
          onRetry={loadTrash}
          onRemove={(removedItem) => {
            const removedKey = trashKey(removedItem);
            setTrashItems((current) => current.filter((item) => trashKey(item) !== removedKey));
          }}
        />
      )}
    </div>
  );
}
