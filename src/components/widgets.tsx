import { type ReactNode } from "react";
import {
  DateDisplay,
  bloodGlucoseMomentNames,
  bloodGlucoseMoments,
  format1,
  medicationPresets,
  type MedicationPreset,
} from "../lib/display";

export function Segmented({
  options,
  selectedIndex,
  onSelect,
}: {
  options: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="segmented">
      {options.map((option, index) => (
        <button
          key={option}
          type="button"
          className={index === selectedIndex ? "active" : ""}
          onClick={() => onSelect(index)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function SummaryCard({
  title,
  value,
  subtitle,
  tint,
  onClick,
}: {
  title: string;
  value: string;
  subtitle: string;
  tint: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="summary-card"
      style={{
        background: `color-mix(in srgb, ${tint} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${tint} 18%, transparent)`,
        cursor: onClick ? "pointer" : "default",
      }}
      onClick={onClick}
    >
      <span className="title">{title}</span>
      <span className="value">{value}</span>
      <span className="subtitle">{subtitle}</span>
    </button>
  );
}

export function Modal({
  title,
  onDismiss,
  onSave,
  canSave = true,
  saveLabel = "保存",
  onDelete,
  children,
}: {
  title: string;
  onDismiss: () => void;
  onSave?: () => void;
  canSave?: boolean;
  saveLabel?: string;
  onDelete?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div className="modal">
        <div className="modal-header">
          <button type="button" onClick={onDismiss}>
            取消
          </button>
          <span className="modal-title">{title}</span>
          <span>
            {onDelete && (
              <button type="button" className="danger" onClick={onDelete}>
                删除
              </button>
            )}
            {onSave && (
              <button type="button" disabled={!canSave} onClick={onSave}>
                {saveLabel}
              </button>
            )}
          </span>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ---------- 日期时间输入 ----------

function toLocalInputValue(timeMillis: number): string {
  const date = new Date(timeMillis);
  const pad = (value: number) => `${value}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function DateTimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (timeMillis: number) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="field-label">{label}</span>
      <input
        type="datetime-local"
        value={toLocalInputValue(value)}
        onChange={(event) => {
          const parsed = new Date(event.target.value).getTime();
          if (Number.isFinite(parsed)) onChange(parsed);
        }}
      />
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  inputMode,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: "decimal" | "numeric";
  multiline?: boolean;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="field-label">{label}</span>
      {multiline ? (
        <textarea rows={2} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input
          type="text"
          inputMode={inputMode}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

// ---------- 距离上次喂奶高亮块 ----------

export function IntervalHighlight({ text }: { text: string }) {
  return (
    <div className="interval-highlight">
      <span className="label">距离上次喂奶</span>
      <span className="value">{text}</span>
    </div>
  );
}

// ---------- 奶量选择 ----------

const AMOUNT_SHORTCUTS = [30, 60, 90, 120, 150, 180];

export function AmountPicker({
  amountText,
  suggestionTitle,
  onChange,
}: {
  amountText: string;
  suggestionTitle: string;
  onChange: (value: string) => void;
}) {
  const currentAmount = (() => {
    const parsed = Number(amountText.trim());
    return Number.isFinite(parsed) && amountText.trim() !== "" ? Math.max(Math.round(parsed), 0) : null;
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="row">
        <span className="field-label">奶量</span>
        <span className="spacer" />
        <span className="muted small">{suggestionTitle}</span>
      </div>

      <div className="grid-3">
        {AMOUNT_SHORTCUTS.map((amount) => (
          <button
            key={amount}
            type="button"
            className={`amount-shortcut ${currentAmount === amount ? "active" : ""}`}
            onClick={() => onChange(`${amount}`)}
          >
            {amount}
          </button>
        ))}
      </div>

      <div className="amount-display">
        <span className="label">当前奶量</span>
        <span className="value">
          {currentAmount ?? "--"}
          <span className="unit"> ml</span>
        </span>
      </div>

      <div className="pill-row">
        <button type="button" onClick={() => onChange(`${Math.max((currentAmount ?? 60) - 5, 0)}`)}>
          − 减 5
        </button>
        <span className="divider" />
        <button type="button" onClick={() => onChange(`${(currentAmount ?? 60) + 5}`)}>
          + 加 5
        </button>
      </div>
    </div>
  );
}

// ---------- 参考值滑杆快捷调整(体重/剂量/血糖共用) ----------

export function QuickAdjust({
  title,
  suggestionTitle,
  baseline,
  currentValue,
  baseLimit,
  step,
  unitLabel,
  onValueChange,
}: {
  title: string;
  suggestionTitle: string;
  baseline: number;
  currentValue: number | null;
  baseLimit: number;
  step: number;
  unitLabel: string;
  onValueChange: (value: number) => void;
}) {
  const value = currentValue ?? baseline;
  const limit = Math.max(baseLimit, Math.abs(value - baseline));
  const adjustment = Math.max(Math.min(value - baseline, limit), -limit);
  const delta = value - baseline;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="row">
        <span className="field-label">{title}</span>
        <span className="spacer" />
        <span className="muted small">{suggestionTitle}</span>
      </div>

      <div className="row small muted">
        <span>
          少 {format1(limit)} {unitLabel}
        </span>
        <span className="spacer" />
        <span className="semibold" style={{ color: "var(--text)" }}>
          参考 {format1(baseline)} {unitLabel}
        </span>
        <span className="spacer" />
        <span>
          多 {format1(limit)} {unitLabel}
        </span>
      </div>

      <input
        type="range"
        min={-limit}
        max={limit}
        step={step}
        value={adjustment}
        onChange={(event) => onValueChange(Math.max(baseline + Number(event.target.value), 0))}
      />

      <div style={{ textAlign: "center" }} className="semibold small">
        {Math.abs(delta) < 0.05
          ? `当前选择：参考 ${format1(value)} ${unitLabel}`
          : `当前选择：${format1(value)} ${unitLabel}（${delta > 0 ? "多" : "少"} ${format1(Math.abs(delta))} ${unitLabel}）`}
      </div>

      <div className="row">
        <button
          type="button"
          className="primary-button"
          style={{ minHeight: 40, background: "var(--surface-variant)", fontSize: 15 }}
          onClick={() => onValueChange(Math.max(value - step, 0))}
        >
          − 减
        </button>
        <button
          type="button"
          className="primary-button"
          style={{ minHeight: 40, background: "var(--surface-variant)", fontSize: 15 }}
          onClick={() => onValueChange(Math.max(value + step, 0))}
        >
          + 加
        </button>
      </div>
    </div>
  );
}

// ---------- 药物预设 ----------

export function MedicationPresetGrid({
  selectedName,
  onSelect,
}: {
  selectedName: string;
  onSelect: (preset: MedicationPreset) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="field-label">常用快捷添加</span>
      <div className="grid-2">
        {medicationPresets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`preset-card ${selectedName === preset.name ? "active" : ""}`}
            onClick={() => onSelect(preset)}
          >
            <span className="semibold small">{preset.name}</span>
            <span className="muted" style={{ fontSize: 12 }}>
              {preset.detail}
            </span>
          </button>
        ))}
      </div>
      <span className="muted" style={{ fontSize: 12 }}>
        快捷项仅用于记录常见补充剂，具体是否使用和剂量请以医嘱为准。
      </span>
    </div>
  );
}

// ---------- 血糖时段 ----------

export function MomentGrid({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (moment: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="field-label">快捷时段</span>
      <div className="grid-2">
        {bloodGlucoseMoments.map((moment) => (
          <button
            key={moment}
            type="button"
            className={`moment-button ${selected === moment ? "active" : ""}`}
            onClick={() => onSelect(moment)}
          >
            {bloodGlucoseMomentNames[moment]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function EmptyState({ emoji, text, description }: { emoji: string; text: string; description?: string }) {
  return (
    <div style={{ textAlign: "center", padding: "28px 0", display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontSize: 28 }}>{emoji}</span>
      <span className="muted small">{text}</span>
      {description && (
        <span className="muted" style={{ fontSize: 12 }}>
          {description}
        </span>
      )}
    </div>
  );
}

export function feedingIntervalText(previousStart: number | null, from: number): string {
  if (previousStart == null) return "还没有喂奶记录";
  return DateDisplay.durationText(Math.floor((from - previousStart) / 1000));
}
