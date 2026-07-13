import { useMemo, useRef, useState } from "react";
import type { RecordKind } from "../../shared/types";
import { RecordEditorModal } from "../components/RecordEditor";
import { EmptyState } from "../components/widgets";
import { DateDisplay, excretionAmountNames, formatFeedingAmount } from "../lib/display";
import { buildTimeline, recordKindMeta, recordKinds, type TimelineItem } from "../lib/timeline";
import { useData } from "../store";

const ALL_FILTERS: Array<{ kind: RecordKind | null; label: string }> = [
  { kind: null, label: "全部" },
  ...recordKinds.map((kind) => ({ kind, label: recordKindMeta[kind].name })),
];

function dateInputValue(timeMillis: number): string {
  const date = new Date(timeMillis);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromInput(value: string): number | null {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day).getTime();
}

function dayTitle(timeMillis: number): string {
  if (DateDisplay.isToday(timeMillis)) return "今天";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (DateDisplay.startOfDay(timeMillis) === DateDisplay.startOfDay(yesterday.getTime())) return "昨天";
  return DateDisplay.shortDate(timeMillis);
}

export function TimelinePage() {
  const { records, remove } = useData();
  const [selectedKind, setSelectedKind] = useState<RecordKind | null>(null);
  const [selectedDay, setSelectedDay] = useState(() => DateDisplay.startOfDay(Date.now()));
  const [editingItem, setEditingItem] = useState<TimelineItem | null>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const recentDays = Array.from({ length: 7 }, (_, offset) => ({
    time: DateDisplay.startOfDayOffset(offset),
    label: offset === 0 ? "今天" : offset === 1 ? "昨天" : offset === 2 ? "前天" : DateDisplay.shortDate(DateDisplay.startOfDayOffset(offset)),
  }));

  const allItems = useMemo(() => buildTimeline(records), [records]);
  const dayEnd = DateDisplay.nextDay(selectedDay);
  const dayItems = allItems.filter(
    (item) => item.recordedAt >= selectedDay && item.recordedAt < dayEnd,
  );
  const visibleItems = selectedKind ? dayItems.filter((item) => item.kind === selectedKind) : dayItems;

  const counts = useMemo(() => {
    const result = new Map<RecordKind, number>();
    for (const item of dayItems) result.set(item.kind, (result.get(item.kind) ?? 0) + 1);
    return result;
  }, [dayItems]);

  const moveDay = (offset: number) => {
    const date = new Date(selectedDay);
    date.setDate(date.getDate() + offset);
    setSelectedDay(DateDisplay.startOfDay(date.getTime()));
  };

  const intervalFor = (item: TimelineItem): string | null => {
    if (item.kind !== "feeding" && item.kind !== "excretion") return null;
    const index = allItems.findIndex((candidate) => candidate.id === item.id);
    if (index < 0) return null;
    const previous = allItems.slice(index + 1).find((candidate) => {
      if (item.kind === "feeding") return candidate.kind === "feeding";
      return (
        candidate.kind === "excretion" &&
        candidate.record.kind === "excretion" &&
        item.record.kind === "excretion" &&
        candidate.record.record.type === item.record.record.type
      );
    });
    if (!previous) return null;
    return DateDisplay.compactDurationText((item.recordedAt - previous.recordedAt) / 1000);
  };

  const primaryValueFor = (item: TimelineItem): string | null => {
    if (item.record.kind === "feeding") {
      return item.record.record.amountML != null ? formatFeedingAmount(item.record.record.amountML) : "未填奶量";
    }
    if (item.record.kind === "excretion") {
      return item.record.record.amount ? excretionAmountNames[item.record.record.amount] : "未选择";
    }
    return null;
  };

  return (
    <div className="page timeline-page">
      <h1 className="page-title">时间线</h1>

      <section className="card timeline-records-card">
        <div className="timeline-date-header">
          <button type="button" className="timeline-day-button" onClick={() => moveDay(-1)} aria-label="前一天">
            ‹
          </button>
          <div className="timeline-date-picker">
            <button
              type="button"
              className="timeline-date-trigger"
              onClick={() => {
                const input = dateInputRef.current;
                if (!input) return;
                try {
                  input.showPicker();
                } catch {
                  input.click();
                }
              }}
            >
              <span className="semibold">{dayTitle(selectedDay)}</span>
              <span className="muted small">{DateDisplay.shortDate(selectedDay)}</span>
            </button>
            <input
              ref={dateInputRef}
              type="date"
              aria-label="选择记录日期"
              value={dateInputValue(selectedDay)}
              onChange={(event) => {
                const next = dateFromInput(event.target.value);
                if (next != null) setSelectedDay(DateDisplay.startOfDay(next));
              }}
            />
          </div>
          <button type="button" className="timeline-day-button" onClick={() => moveDay(1)} aria-label="后一天">
            ›
          </button>
          {!DateDisplay.isToday(selectedDay) && (
            <button type="button" className="timeline-today-button" onClick={() => setSelectedDay(DateDisplay.startOfDay(Date.now()))}>
              回到今天
            </button>
          )}
        </div>

        <div className="timeline-recent-days" aria-label="近期日期">
          {recentDays.map((day) => (
            <button
              key={day.time}
              type="button"
              className={DateDisplay.startOfDay(selectedDay) === day.time ? "active" : ""}
              onClick={() => setSelectedDay(day.time)}
            >
              {day.label}
            </button>
          ))}
        </div>

        <div className="chips timeline-filters">
          {ALL_FILTERS.map((filter) => {
            const count = filter.kind == null ? dayItems.length : counts.get(filter.kind) ?? 0;
            return (
              <button
                key={filter.kind ?? "all"}
                type="button"
                className={`chip ${selectedKind === filter.kind ? "active" : ""}`}
                onClick={() => setSelectedKind(filter.kind)}
              >
                {filter.label} {count}
              </button>
            );
          })}
        </div>

        <div className="timeline-summary">
          <span>{dayTitle(selectedDay)}共 {dayItems.length} 条记录</span>
          {selectedKind && <span>当前显示 {recordKindMeta[selectedKind].name} {visibleItems.length} 条</span>}
        </div>

        <div className="quick-records-scroll timeline-records-scroll">
          {visibleItems.length === 0 ? (
            <EmptyState emoji="📅" text={`${dayTitle(selectedDay)}没有${selectedKind ? recordKindMeta[selectedKind].name : ""}记录`} />
          ) : (
            visibleItems.map((item) => {
              const meta = recordKindMeta[item.kind];
              const rowEmoji =
                item.record.kind === "excretion"
                  ? item.record.record.type === "poop"
                    ? "💩"
                    : "💧"
                  : meta.emoji;
              const interval = intervalFor(item);
              const primaryValue = primaryValueFor(item);
              const isIntervalRecord = item.kind === "feeding" || item.kind === "excretion";
              const secondaryText = isIntervalRecord ? interval ?? "—" : item.detail;
              return (
                <div key={item.id} className="list-row timeline-record-row">
                  <span
                    className="icon-badge"
                    style={{ background: `color-mix(in srgb, ${meta.tint} 14%, transparent)` }}
                  >
                    {rowEmoji}
                  </span>
                  <div className="timeline-record-main">
                    <span className="content">
                      {item.kind !== "feeding" && item.kind !== "excretion" && (
                        <span className="semibold">{item.title}</span>
                      )}
                      <span className="timeline-record-time">{DateDisplay.clockTime(item.recordedAt)}</span>
                    </span>
                    <span className="timeline-record-time-spacer" aria-hidden="true" />
                    <span
                      className={`timeline-record-value ${primaryValue ? "" : "empty"}`}
                      style={primaryValue ? { color: meta.tint } : undefined}
                    >
                      {primaryValue ?? "—"}
                    </span>
                    <span className={`timeline-record-secondary ${interval ? "is-interval" : ""}`}>
                      {secondaryText}
                    </span>
                    <button type="button" className="timeline-edit-button" onClick={() => setEditingItem(item)}>
                      编辑 ›
                    </button>
                  </div>
                  <button
                    type="button"
                    className="delete-button"
                    aria-label="删除"
                    onClick={() => remove(item.kind, item.record.record.id)}
                  />
                </div>
              );
            })
          )}
        </div>
      </section>

      {editingItem && <RecordEditorModal item={editingItem} onDismiss={() => setEditingItem(null)} />}
    </div>
  );
}
