import { useSyncExternalStore } from "react";
import { feedingAlarm } from "../alarm";
import { DateDisplay } from "../lib/display";
import { useSettings } from "../store";
import { api } from "../api";

export function SettingsPage({ onLogout }: { onLogout: () => void }) {
  const [settings, updateSettings] = useSettings();
  const alarmState = useSyncExternalStore(
    (listener) => feedingAlarm.subscribe(listener),
    () => feedingAlarm.getState(),
  );

  return (
    <div className="page settings-page">
      <h1 className="page-title">设置</h1>

      <section className="card">
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
      </section>

      <section className="card">
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
          🔔 测试持续闹钟
        </button>

        {alarmState.isActive && (
          <button
            type="button"
            className="primary-button"
            style={{ background: "rgb(229 57 53 / 12%)", color: "var(--red)", minHeight: 44, fontSize: 15 }}
            onClick={() => feedingAlarm.stopAlarm()}
          >
            ⏹ 停止闹钟
          </button>
        )}

        <span className="muted" style={{ fontSize: 12 }}>
          点击后会立即持续响铃和震动，直到手动停止。
        </span>
      </section>

      <section className="card">
        <h2 className="card-title">账号</h2>
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
    </div>
  );
}
