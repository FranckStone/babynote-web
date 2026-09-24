import { Icon } from "../components/Icon";
import { EmptyState, SummaryCard } from "../components/widgets";
import { DateDisplay, WeightDisplay, bloodGlucoseMomentNames, excretionTypeNames, format1 } from "../lib/display";
import { buildRecentTimeline, recordKindMeta } from "../lib/timeline";
import { useData } from "../store";

export function HomePage() {
  const { records } = useData();

  const recentItems = buildRecentTimeline(records, 4);

  const todayCount = (times: number[]) => times.filter((time) => DateDisplay.isToday(time)).length;

  return (
    <div className="page home-page">
      <h1 className="page-title">宝宝笔记</h1>

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
          <EmptyState icon="inbox" text="还没有记录" description="先从一次快速记录开始。" />
        ) : (
          recentItems.map((item) => (
            <div key={item.id} className="card" style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
              <span
                className="icon-badge"
                style={{
                  background: `color-mix(in srgb, ${recordKindMeta[item.kind].tint} 14%, transparent)`,
                  color: recordKindMeta[item.kind].tint,
                }}
              >
                <Icon name={recordKindMeta[item.kind].icon} />
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

    </div>
  );
}
