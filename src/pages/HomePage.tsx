import { useState } from "react";
import type { RecordKind } from "../../shared/types";
import { RecordFormModal } from "../components/RecordForm";
import { EmptyState, Modal, SummaryCard } from "../components/widgets";
import { DateDisplay, WeightDisplay, bloodGlucoseMomentNames, excretionTypeNames, format1 } from "../lib/display";
import { buildRecentTimeline, recordKindMeta, recordKinds } from "../lib/timeline";
import { useData } from "../store";

export function HomePage() {
  const { records } = useData();
  const [isPickingKind, setIsPickingKind] = useState(false);
  const [formKind, setFormKind] = useState<RecordKind | null>(null);

  const recentItems = buildRecentTimeline(records, 4);

  const todayCount = (times: number[]) => times.filter((time) => DateDisplay.isToday(time)).length;

  const subtitleFor = (kind: RecordKind): string => {
    switch (kind) {
      case "feeding":
        return records.feedings[0] ? `最近 ${DateDisplay.time(records.feedings[0].startedAt)}` : "选择奶量后直接记录";
      case "weight":
        return records.weights[0] ? `最近 ${WeightDisplay.jinText(records.weights[0].weightKG)}` : "记录孕期体重变化";
      case "medication":
        return records.medications[0] ? `最近 ${records.medications[0].name}` : "记录药名和剂量";
      case "checkup":
        return records.checkups[0] ? `最近 ${records.checkups[0].location}` : "记录产检和检查结果";
      case "fetalMovement":
        return records.fetalMovements[0]
          ? `最近 ${DateDisplay.time(records.fetalMovements[0].recordedAt)}`
          : "记录胎动次数和时长";
      case "bloodGlucose":
        return records.bloodGlucoses[0]
          ? `最近 ${bloodGlucoseMomentNames[records.bloodGlucoses[0].moment]} ${format1(records.bloodGlucoses[0].valueMMOL)} mmol/L`
          : "记录餐前餐后和睡前血糖";
      case "excretion":
        return records.excretions[0]
          ? `最近 ${excretionTypeNames[records.excretions[0].type]} ${DateDisplay.time(records.excretions[0].recordedAt)}`
          : "记录拉屎和撒尿";
    }
  };

  return (
    <div className="page home-page">
      <h1 className="page-title">
        宝宝笔记
        <button type="button" onClick={() => setIsPickingKind(true)} aria-label="快速记录" style={{ fontSize: 24 }}>
          ＋
        </button>
      </h1>

      <section className="hero-card">
        <h2>今天最重要的是少一步操作。</h2>
        <p className="muted small" style={{ margin: 0 }}>
          喂奶、屎尿、体重、吃药、检查结果和胎动都能在几秒内记下来，后面再补充细节。
        </p>
        <button type="button" className="cta" onClick={() => setIsPickingKind(true)}>
          ⊕ 现在记录
        </button>
      </section>

      <div className="grid-2 home-summary-grid">
        <SummaryCard
          title="今日喂奶"
          value={`${todayCount(records.feedings.map((record) => record.startedAt))} 次`}
          subtitle={records.feedings[0] ? `最近 ${DateDisplay.time(records.feedings[0].startedAt)}` : "还没有记录"}
          tint="var(--pink)"
        />
        <SummaryCard
          title="最近体重"
          value={records.weights[0] ? WeightDisplay.jinText(records.weights[0].weightKG) : "--"}
          subtitle={records.weights[0] ? DateDisplay.shortDate(records.weights[0].recordedAt) : "还没有记录"}
          tint="var(--orange)"
        />
        <SummaryCard
          title="今日用药"
          value={`${todayCount(records.medications.map((record) => record.recordedAt))} 次`}
          subtitle={records.medications[0]?.name ?? "还没有记录"}
          tint="var(--blue)"
        />
        <SummaryCard
          title="最近产检"
          value={records.checkups[0]?.location ?? "--"}
          subtitle={records.checkups[0]?.summary ?? "还没有记录"}
          tint="var(--green)"
        />
        <SummaryCard
          title="今日胎动"
          value={`${todayCount(records.fetalMovements.map((record) => record.recordedAt))} 次`}
          subtitle={
            records.fetalMovements[0] ? DateDisplay.time(records.fetalMovements[0].recordedAt) : "还没有记录"
          }
          tint="var(--mint)"
        />
        <SummaryCard
          title="今日血糖"
          value={`${todayCount(records.bloodGlucoses.map((record) => record.recordedAt))} 次`}
          subtitle={
            records.bloodGlucoses[0]
              ? `${bloodGlucoseMomentNames[records.bloodGlucoses[0].moment]} ${format1(records.bloodGlucoses[0].valueMMOL)}`
              : "还没有记录"
          }
          tint="var(--red)"
        />
        <SummaryCard
          title="今日屎尿"
          value={`${todayCount(records.excretions.map((record) => record.recordedAt))} 次`}
          subtitle={
            records.excretions[0]
              ? `${excretionTypeNames[records.excretions[0].type]} ${DateDisplay.time(records.excretions[0].recordedAt)}`
              : "还没有记录"
          }
          tint="var(--brown)"
        />
      </div>

      <section className="home-recent" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 className="card-title">最近记录</h2>
        {recentItems.length === 0 ? (
          <EmptyState emoji="📥" text="还没有记录" description="先从一次快速记录开始。" />
        ) : (
          recentItems.map((item) => (
            <div key={item.id} className="card" style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
              <span
                className="icon-badge"
                style={{ background: `color-mix(in srgb, ${recordKindMeta[item.kind].tint} 14%, transparent)` }}
              >
                {recordKindMeta[item.kind].emoji}
              </span>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span className="semibold">{item.title}</span>
                <span className="muted small">{item.detail}</span>
                {item.note && (
                  <span className="muted" style={{ fontSize: 12 }}>
                    {item.note}
                  </span>
                )}
              </div>
              <span className="muted small">{DateDisplay.time(item.recordedAt)}</span>
            </div>
          ))
        )}
      </section>

      {isPickingKind && (
        <Modal title="选择要记录的内容" onDismiss={() => setIsPickingKind(false)}>
          <span className="muted small">点一下直接进入对应记录页</span>
          <div className="grid-2">
            {recordKinds.map((kind) => {
              const meta = recordKindMeta[kind];
              return (
                <button
                  key={kind}
                  type="button"
                  className="option-card"
                  style={{
                    background: `linear-gradient(135deg, color-mix(in srgb, ${meta.tint} 22%, transparent), color-mix(in srgb, ${meta.tint} 10%, transparent))`,
                  }}
                  onClick={() => {
                    setFormKind(kind);
                    setIsPickingKind(false);
                  }}
                >
                  <div className="row">
                    <span style={{ fontSize: 20 }}>{meta.emoji}</span>
                    <span className="spacer" />
                    <span className="muted">→</span>
                  </div>
                  <span className="name">{meta.name}</span>
                  <span className="subtitle">{subtitleFor(kind)}</span>
                </button>
              );
            })}
          </div>
        </Modal>
      )}

      {formKind && <RecordFormModal kind={formKind} onDismiss={() => setFormKind(null)} />}
    </div>
  );
}
