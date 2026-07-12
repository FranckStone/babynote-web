import { useState } from "react";
import type { RecordKind } from "../../shared/types";
import { RecordEditorModal } from "../components/RecordEditor";
import { EmptyState } from "../components/widgets";
import { DateDisplay } from "../lib/display";
import { buildTimeline, recordKindMeta, recordKinds, type TimelineItem } from "../lib/timeline";
import { useData } from "../store";

export function TimelinePage() {
  const { records, remove } = useData();
  const [selectedKind, setSelectedKind] = useState<RecordKind | null>(null);
  const [editingItem, setEditingItem] = useState<TimelineItem | null>(null);

  const allItems = buildTimeline(records);
  const items = selectedKind ? allItems.filter((item) => item.kind === selectedKind) : allItems;

  return (
    <div className="page timeline-page">
      <h1 className="page-title">时间线</h1>

      <div className="chips timeline-filters">
        <button
          type="button"
          className={`chip ${selectedKind == null ? "active" : ""}`}
          onClick={() => setSelectedKind(null)}
        >
          全部
        </button>
        {recordKinds.map((kind) => (
          <button
            key={kind}
            type="button"
            className={`chip ${selectedKind === kind ? "active" : ""}`}
            onClick={() => setSelectedKind(kind)}
          >
            {recordKindMeta[kind].name}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState emoji="📅" text="还没有时间线记录" />
      ) : (
        items.map((item) => (
          <div key={item.id} className="card timeline-card" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0, textAlign: "left" }}
              onClick={() => setEditingItem(item)}
            >
              <span
                className="icon-badge"
                style={{ background: `color-mix(in srgb, ${recordKindMeta[item.kind].tint} 14%, transparent)` }}
              >
                {recordKindMeta[item.kind].emoji}
              </span>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                <span>
                  <span className="semibold">{item.title}</span>{" "}
                  <span className="muted" style={{ fontSize: 12 }}>
                    {DateDisplay.dateTime(item.recordedAt)}
                  </span>
                </span>
                <span className="muted small">{item.detail}</span>
                {item.note && (
                  <span className="muted" style={{ fontSize: 12 }}>
                    {item.note}
                  </span>
                )}
              </div>
            </button>

            <button
              type="button"
              className="delete-button"
              aria-label="删除"
              onClick={() => remove(item.kind, item.record.record.id)}
            >
              🗑
            </button>
          </div>
        ))
      )}

      {editingItem && <RecordEditorModal item={editingItem} onDismiss={() => setEditingItem(null)} />}
    </div>
  );
}
