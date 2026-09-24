import { useEffect, useMemo, useState } from "react";
import type { BloodGlucoseRecord, FeedingRecord } from "../../shared/types";
import { Icon } from "../components/Icon";
import { EmptyState, SummaryCard } from "../components/widgets";
import {
  DateDisplay,
  WeightDisplay,
  bloodGlucoseMomentNames,
  bloodGlucoseMoments,
  dailyControlUpperLimit,
  diagnosisUpperLimit,
  excretionTypeNames,
  format1,
  formatFeedingAmount,
} from "../lib/display";
import { breastDurationMinutes, feedingDurationMinutes, formulaDurationMinutes } from "../lib/timeline";
import { useData } from "../store";

type StatsDestination = "overview" | "feeding" | "weight" | "excretion" | "bloodGlucose";

export function StatsPage() {
  const destinationFromPath = (): StatsDestination => {
    const value = window.location.pathname.split("/")[2];
    if (value === "feeding" || value === "weight" || value === "excretion" || value === "bloodGlucose") {
      return value;
    }
    return "overview";
  };

  const [destination, setDestination] = useState<StatsDestination>(destinationFromPath);

  useEffect(() => {
    const handlePopState = () => setDestination(destinationFromPath());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = (next: StatsDestination) => {
    const path = next === "overview" ? "/stats" : `/stats/${next}`;
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
    setDestination(next);
  };

  if (destination === "overview") {
    return <StatsOverview onNavigate={navigate} />;
  }

  const titles: Record<Exclude<StatsDestination, "overview">, string> = {
    feeding: "喂奶统计",
    weight: "体重统计",
    excretion: "屎尿统计",
    bloodGlucose: "血糖统计",
  };

  return (
    <div className="page stats-detail-page">
      <button type="button" className="back-button" onClick={() => navigate("overview")}>
        <Icon name="arrowLeft" size={18} strokeWidth={2} />
        返回统计
      </button>
      <h1 className="page-title" style={{ marginTop: 0 }}>
        {titles[destination]}
      </h1>
      {destination === "feeding" && <FeedingStats />}
      {destination === "weight" && <WeightStats />}
      {destination === "excretion" && <ExcretionStats />}
      {destination === "bloodGlucose" && <BloodGlucoseStats />}
    </div>
  );
}

function StatsOverview({ onNavigate }: { onNavigate: (destination: StatsDestination) => void }) {
  const { records } = useData();
  const { feedings, weights, medications, fetalMovements, bloodGlucoses, excretions } = records;

  const averageIntervalHours = useMemo(() => {
    if (feedings.length < 2) return null;
    let total = 0;
    for (let index = 0; index < feedings.length - 1; index += 1) {
      total += (feedings[index].startedAt - feedings[index + 1].startedAt) / 3_600_000;
    }
    return total / (feedings.length - 1);
  }, [feedings]);

  return (
    <div className="page stats-overview-page">
      <h1 className="page-title">统计</h1>

      <SummaryCard
        title="喂奶记录总数"
        value={`${feedings.length}`}
        subtitle={
          averageIntervalHours != null ? `平均间隔 ${format1(averageIntervalHours)} 时` : "至少需要两条喂奶记录"
        }
        tint="var(--pink)"
        onClick={() => onNavigate("feeding")}
      />
      <SummaryCard
        title="体重记录总数"
        value={`${weights.length}`}
        subtitle={
          weights.length > 0 ? `最早 ${WeightDisplay.jinText(weights[weights.length - 1].weightKG)}` : "还没有记录"
        }
        tint="var(--orange)"
        onClick={() => onNavigate("weight")}
      />
      <SummaryCard
        title="药物记录总数"
        value={`${medications.length}`}
        subtitle={medications[0]?.name ?? "还没有记录"}
        tint="var(--blue)"
      />
      <SummaryCard
        title="胎动记录总数"
        value={`${fetalMovements.length}`}
        subtitle={(() => {
          const record = fetalMovements[0];
          if (!record) return "还没有记录";
          const parts: string[] = [];
          if (record.movementCount != null) parts.push(`${record.movementCount} 次`);
          if (record.durationMinutes != null) parts.push(`${record.durationMinutes} 分钟`);
          return parts.length > 0 ? parts.join(" · ") : "已记录";
        })()}
        tint="var(--mint)"
      />
      <SummaryCard
        title="屎尿记录总数"
        value={`${excretions.length}`}
        subtitle={
          excretions[0]
            ? `${excretionTypeNames[excretions[0].type]} ${DateDisplay.time(excretions[0].recordedAt)}`
            : "还没有记录"
        }
        tint="var(--brown)"
        onClick={() => onNavigate("excretion")}
      />
      <SummaryCard
        title="血糖记录总数"
        value={`${bloodGlucoses.length}`}
        subtitle={
          bloodGlucoses[0]
            ? `${bloodGlucoseMomentNames[bloodGlucoses[0].moment]} ${format1(bloodGlucoses[0].valueMMOL)} mmol/L`
            : "还没有记录"
        }
        tint="var(--red)"
        onClick={() => onNavigate("bloodGlucose")}
      />

      <section className="card">
        <h2 className="card-title">下一步建议</h2>
        <p className="muted small" style={{ margin: 0 }}>
          数据已保存在云端 D1,手机、平板和电脑都可以随时打开记录和查看。
        </p>
      </section>
    </div>
  );
}

// ---------- 喂奶统计 ----------

function FeedingStats() {
  const { records } = useData();

  const { dailyGroups, totalCount, totalAmount } = useMemo(() => {
    const ascending = [...records.feedings].sort((a, b) => a.startedAt - b.startedAt);
    let previousStartedAt: number | null = null;
    let total = 0;
    const items = ascending.map((record) => {
      const item = { record, previousStartedAt };
      previousStartedAt = record.startedAt;
      total += record.amountML ?? 0;
      return item;
    });

    const groups = new Map<number, typeof items>();
    for (const item of items) {
      const day = DateDisplay.startOfDay(item.record.startedAt);
      const group = groups.get(day) ?? [];
      group.push(item);
      groups.set(day, group);
    }

    return {
      dailyGroups: [...groups.entries()].sort((a, b) => b[0] - a[0]),
      totalCount: items.length,
      totalAmount: total,
    };
  }, [records.feedings]);

  if (dailyGroups.length === 0) {
    return <EmptyState icon="bottle" text="暂无喂奶数据" />;
  }

  return (
    <>
      {dailyGroups.map(([day, items]) => (
        <section key={day} className="card">
          <div className="row">
            <span className="semibold small">{DateDisplay.shortDate(day)}</span>
            <span className="spacer" />
            <span className="muted small">{items.length} 次</span>
          </div>
          {items.map((item, index) => (
            <FeedingStatsRow
              key={item.record.id}
              record={item.record}
              previousStartedAt={item.previousStartedAt}
              showDivider={index !== items.length - 1}
            />
          ))}
        </section>
      ))}

      <section className="card">
        <h2 className="card-title">统计摘要</h2>
        <span className="small">天数：{dailyGroups.length}</span>
        <span className="small">喂奶总次数：{totalCount}</span>
        {totalAmount > 0 && <span className="small">奶粉总量：{formatFeedingAmount(totalAmount)}</span>}
        {dailyGroups.length > 0 && (
          <span className="small">日均喂奶：{format1(totalCount / dailyGroups.length)} 次</span>
        )}
      </section>
    </>
  );
}

function FeedingStatsRow({
  record,
  previousStartedAt,
  showDivider,
}: {
  record: FeedingRecord;
  previousStartedAt: number | null;
  showDivider: boolean;
}) {
  const intervalText = (() => {
    if (previousStartedAt == null) return "首次记录";
    const minutes = Math.max(Math.floor((record.startedAt - previousStartedAt) / 60_000), 0);
    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;
    if (hours > 0 && remaining > 0) return `间隔 ${hours}时${remaining}分钟`;
    if (hours > 0) return `间隔 ${hours}时`;
    return `间隔 ${remaining}分钟`;
  })();

  const detailParts = [intervalText];
  if (record.feedingType === "mixed") {
    const breast = breastDurationMinutes(record);
    if (breast != null) detailParts.push(`母乳 ${breast} 分钟`);
    const formula = formulaDurationMinutes(record);
    if (formula != null) detailParts.push(`奶粉 ${formula} 分钟`);
  } else {
    const duration = feedingDurationMinutes(record);
    if (duration != null) detailParts.push(`${duration} 分钟`);
  }

  const amountText =
    record.amountML != null
      ? formatFeedingAmount(record.amountML)
      : feedingDurationMinutes(record) != null
        ? `${feedingDurationMinutes(record)} 分钟`
        : "未填写";

  return (
    <>
      <div className="list-row" style={{ alignItems: "flex-start" }}>
        <div style={{ width: 44 }}>
          <div className="semibold small">{DateDisplay.clockTime(record.startedAt)}</div>
          <div className="muted" style={{ fontSize: 11 }}>
            {DateDisplay.dayPeriod(record.startedAt)}
          </div>
        </div>
        <div className="content">
          <div className="row">
            <span className="semibold small">{record.feedingType === "mixed" ? "混合" : "奶粉"}</span>
            <span className="spacer" />
            <span className="semibold small" style={{ color: "var(--pink)" }}>
              {amountText}
            </span>
          </div>
          <span className="muted" style={{ fontSize: 12 }}>
            {detailParts.join("  ")}
          </span>
          {record.note.trim() !== "" && (
            <span className="muted" style={{ fontSize: 12 }}>
              {record.note}
            </span>
          )}
        </div>
      </div>
      {showDivider && <hr className="stats-divider" />}
    </>
  );
}

// ---------- 体重统计 ----------

const MAX_SELECTED_DAYS = 14;

function WeightStats() {
  const { records } = useData();

  const availableDays = useMemo(
    () =>
      [...new Set(records.weights.map((record) => DateDisplay.startOfDay(record.recordedAt)))].sort(
        (a, b) => a - b,
      ),
    [records.weights],
  );

  const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set());

  // 与 iOS 一致:默认选中最近 14 天,数据变化后清掉失效选择。
  useEffect(() => {
    setSelectedDays((previous) => {
      if (availableDays.length === 0) return new Set();
      let updated = new Set([...previous].filter((day) => availableDays.includes(day)));
      if (updated.size === 0) {
        updated = new Set(availableDays.slice(-MAX_SELECTED_DAYS));
      } else if (updated.size > MAX_SELECTED_DAYS) {
        updated = new Set([...updated].sort((a, b) => a - b).slice(-MAX_SELECTED_DAYS));
      }
      return updated;
    });
  }, [availableDays]);

  const latestJinByDay = useMemo(() => {
    const map = new Map<number, number>();
    for (const record of [...records.weights].sort((a, b) => b.recordedAt - a.recordedAt)) {
      const day = DateDisplay.startOfDay(record.recordedAt);
      if (!map.has(day)) map.set(day, WeightDisplay.kgToJin(record.weightKG));
    }
    return map;
  }, [records.weights]);

  const points = availableDays
    .filter((day) => selectedDays.has(day))
    .map((day) => ({ day, jin: latestJinByDay.get(day)! }))
    .filter((point) => point.jin != null);

  return (
    <>
      <section className="card">
        <h2 className="card-title">选择日期（最多 {MAX_SELECTED_DAYS} 天）</h2>
        {availableDays.length === 0 ? (
          <span className="muted small">暂无可选日期</span>
        ) : (
          <div className="chips">
            {availableDays.map((day) => (
              <button
                key={day}
                type="button"
                className={`chip ${selectedDays.has(day) ? "active" : ""}`}
                style={{ background: selectedDays.has(day) ? undefined : "var(--surface-variant)" }}
                onClick={() =>
                  setSelectedDays((previous) => {
                    const next = new Set(previous);
                    if (next.has(day)) {
                      next.delete(day);
                    } else if (next.size < MAX_SELECTED_DAYS) {
                      next.add(day);
                    }
                    return next;
                  })
                }
              >
                {DateDisplay.shortDate(day)}
              </button>
            ))}
          </div>
        )}
      </section>

      {points.length === 0 ? (
        <EmptyState icon="chart" text="请选择日期查看体重趋势" />
      ) : (
        <section className="card">
          <WeightLineChart points={points} />
        </section>
      )}

      <section className="card">
        <h2 className="card-title">统计摘要</h2>
        <span className="small">
          选中天数：{points.length} / {MAX_SELECTED_DAYS}
        </span>
        {points.length > 0 && (
          <>
            <span className="small">最新体重：{format1(points[points.length - 1].jin)} 斤</span>
            <span className="small">起始体重：{format1(points[0].jin)} 斤</span>
            {points.length >= 2 && (
              <span className="small">
                变化：{points[points.length - 1].jin - points[0].jin >= 0 ? "+" : ""}
                {format1(points[points.length - 1].jin - points[0].jin)} 斤
              </span>
            )}
          </>
        )}
      </section>
    </>
  );
}

function WeightLineChart({ points }: { points: { day: number; jin: number }[] }) {
  const width = 600;
  const height = 300;
  const left = 48;
  const right = 16;
  const top = 28;
  const bottom = 40;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;

  const values = points.map((point) => point.jin);
  const minValue = Math.min(...values) - 1;
  const maxValue = Math.max(...values) + 1;
  const range = maxValue - minValue || 1;

  const xAt = (index: number) =>
    points.length === 1 ? left + chartWidth / 2 : left + (chartWidth * index) / (points.length - 1);
  const yAt = (value: number) => top + chartHeight * (1 - (value - minValue) / range);

  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${xAt(index)},${yAt(point.jin)}`).join(" ");

  const gridLines = [0, 1, 2, 3, 4].map((step) => minValue + (range * step) / 4);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="体重趋势图">
      {gridLines.map((value) => (
        <g key={value}>
          <line
            x1={left}
            x2={width - right}
            y1={yAt(value)}
            y2={yAt(value)}
            stroke="var(--surface-variant)"
            strokeWidth={1}
          />
          <text x={left - 6} y={yAt(value) + 4} textAnchor="end" fontSize={11} fill="var(--text-secondary)">
            {format1(value)}
          </text>
        </g>
      ))}

      <text x={left - 6} y={top - 12} textAnchor="end" fontSize={11} fill="var(--text-secondary)">
        斤
      </text>

      <path d={path} fill="none" stroke="var(--orange)" strokeWidth={2.5} />

      {points.map((point, index) => (
        <g key={point.day}>
          <circle cx={xAt(index)} cy={yAt(point.jin)} r={4} fill="var(--orange)" />
          <text
            x={xAt(index)}
            y={yAt(point.jin) - 8}
            textAnchor="middle"
            fontSize={11}
            fill="var(--text-secondary)"
          >
            {format1(point.jin)}
          </text>
          {(points.length <= 7 || index % 2 === 0) && (
            <text x={xAt(index)} y={height - 12} textAnchor="middle" fontSize={11} fill="var(--text-secondary)">
              {DateDisplay.shortDate(point.day)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

// ---------- 屎尿统计 ----------

function ExcretionStats() {
  const { records } = useData();

  const dailyGroups = useMemo(() => {
    const groups = new Map<number, typeof records.excretions>();
    for (const record of [...records.excretions].sort((a, b) => a.recordedAt - b.recordedAt)) {
      const day = DateDisplay.startOfDay(record.recordedAt);
      const group = groups.get(day) ?? [];
      group.push(record);
      groups.set(day, group);
    }
    return [...groups.entries()].sort((a, b) => b[0] - a[0]);
  }, [records.excretions]);

  const totalPoop = records.excretions.filter((record) => record.type === "poop").length;
  const totalPee = records.excretions.filter((record) => record.type === "pee").length;
  const total = totalPoop + totalPee;

  if (dailyGroups.length === 0) {
    return <EmptyState icon="poop" text="暂无屎尿数据" />;
  }

  return (
    <>
      {dailyGroups.map(([day, dayRecords]) => {
        const poopCount = dayRecords.filter((record) => record.type === "poop").length;
        const peeCount = dayRecords.filter((record) => record.type === "pee").length;
        const parts: string[] = [];
        if (poopCount > 0) parts.push(`拉屎 ${poopCount}`);
        if (peeCount > 0) parts.push(`撒尿 ${peeCount}`);

        return (
          <section key={day} className="card">
            <div className="row">
              <span className="semibold small">{DateDisplay.shortDate(day)}</span>
              <span className="spacer" />
              <span className="muted small">{parts.join(" · ")}</span>
            </div>
            {dayRecords.map((record, index) => (
              <div key={record.id}>
                <div className="list-row" style={{ alignItems: "flex-start" }}>
                  <div style={{ width: 44 }}>
                    <div className="semibold small">{DateDisplay.clockTime(record.recordedAt)}</div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {DateDisplay.dayPeriod(record.recordedAt)}
                    </div>
                  </div>
                  <div className="content">
                    <span
                      className="semibold small"
                      style={{ color: record.type === "poop" ? "var(--brown)" : "var(--blue)" }}
                    >
                      {excretionTypeNames[record.type]}
                    </span>
                    {record.note.trim() !== "" && (
                      <span className="muted" style={{ fontSize: 12 }}>
                        {record.note}
                      </span>
                    )}
                  </div>
                </div>
                {index !== dayRecords.length - 1 && <hr className="stats-divider" />}
              </div>
            ))}
          </section>
        );
      })}

      <section className="card">
        <h2 className="card-title">统计摘要</h2>
        <span className="small">天数：{dailyGroups.length}</span>
        <span className="small">总次数：{total}</span>
        <span className="small">拉屎：{totalPoop} 次</span>
        <span className="small">撒尿：{totalPee} 次</span>
        {dailyGroups.length > 0 && <span className="small">日均：{format1(total / dailyGroups.length)} 次</span>}
      </section>
    </>
  );
}

// ---------- 血糖统计 ----------

interface MomentPoint {
  day: number;
  moment: string;
  value: number;
  recordedAt: number | null;
}

function BloodGlucoseStats() {
  const { records } = useData();
  const [comparisonEnabled, setComparisonEnabled] = useState(false);

  const daysDesc = useMemo(
    () =>
      [...new Set(records.bloodGlucoses.map((record) => DateDisplay.startOfDay(record.recordedAt)))].sort(
        (a, b) => b - a,
      ),
    [records.bloodGlucoses],
  );

  // 每天每个时段取最新一条
  const chartPoints = useMemo(() => {
    const lookup = new Map<string, BloodGlucoseRecord>();
    for (const record of [...records.bloodGlucoses].sort((a, b) => b.recordedAt - a.recordedAt)) {
      const key = `${DateDisplay.startOfDay(record.recordedAt)}-${record.moment}`;
      if (!lookup.has(key)) lookup.set(key, record);
    }

    const points: MomentPoint[] = [];
    for (const day of daysDesc) {
      for (const moment of bloodGlucoseMoments) {
        const record = lookup.get(`${day}-${moment}`);
        points.push({ day, moment, value: record?.valueMMOL ?? 0, recordedAt: record?.recordedAt ?? null });
      }
    }
    return points;
  }, [records.bloodGlucoses, daysDesc]);

  if (chartPoints.length === 0) {
    return <EmptyState icon="bloodDrop" text="暂无血糖数据" />;
  }

  const average =
    records.bloodGlucoses.length > 0
      ? records.bloodGlucoses.reduce((total, record) => total + record.valueMMOL, 0) / records.bloodGlucoses.length
      : null;

  const diagnosisExceeded = chartPoints.filter((point) => {
    const limit = diagnosisUpperLimit(point.moment);
    return limit != null && point.value >= limit;
  });
  const dailyControlExceeded = chartPoints.filter((point) => point.value > dailyControlUpperLimit(point.moment));

  return (
    <>
      {daysDesc.map((day) => {
        const dayPoints = chartPoints.filter((point) => point.day === day);
        const dayAverage = dayPoints.reduce((total, point) => total + point.value, 0) / dayPoints.length;

        return (
          <section key={day} className="card">
            <div className="row">
              <span className="semibold small">{DateDisplay.shortDate(day)}</span>
              <span className="spacer" />
              <span className="muted small">平均 {format1(dayAverage)}</span>
            </div>
            <GlucoseDayChart points={dayPoints} comparisonEnabled={comparisonEnabled} />
          </section>
        );
      })}

      <section className="card">
        <h2 className="card-title">统计摘要</h2>
        <span className="small">天数：{daysDesc.length}</span>
        <span className="small">记录总数：{records.bloodGlucoses.length}</span>
        {average != null && <span className="small">平均血糖：{average.toFixed(2)} mmol/L</span>}

        <span className="small semibold">参考范围（仅参考，请以医生建议为准）</span>
        <span className="muted" style={{ fontSize: 12 }}>
          1) 妊娠期糖尿病诊断阈值（75g OGTT）：空腹 &lt; 5.1，1小时 &lt; 10.0，2小时 &lt; 8.5 mmol/L
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          2) 日常控糖目标：餐前/睡前 ≤ 5.3，餐后1小时 ≤ 7.8（若测餐后2小时，建议 ≤ 6.7）mmol/L
        </span>

        <label className="row small" style={{ cursor: "pointer" }}>
          <span style={{ flex: 1 }}>对比当前展示数据并标出超标项</span>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={comparisonEnabled}
            onChange={(event) => setComparisonEnabled(event.target.checked)}
          />
        </label>

        {comparisonEnabled && (
          <>
            <span className="muted" style={{ fontSize: 12 }}>
              图中标红按“日常控糖目标”判断，附加显示超出值。
            </span>
            <ComparisonList
              title="按诊断阈值（空腹/餐后1小时可比）"
              points={diagnosisExceeded}
              limitResolver={diagnosisUpperLimit}
            />
            <ComparisonList
              title="按日常控糖目标"
              points={dailyControlExceeded}
              limitResolver={(moment) => dailyControlUpperLimit(moment)}
            />
          </>
        )}
      </section>
    </>
  );
}

function ComparisonList({
  title,
  points,
  limitResolver,
}: {
  title: string;
  points: MomentPoint[];
  limitResolver: (moment: string) => number | null;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="muted small semibold">{title}</span>
      {points.length === 0 ? (
        <span className="muted" style={{ fontSize: 12 }}>
          当前展示数据未发现超标
        </span>
      ) : (
        points.map((point) => {
          const limit = limitResolver(point.moment);
          if (limit == null) return null;
          return (
            <span key={`${point.day}-${point.moment}`} style={{ fontSize: 12, color: "var(--red)" }}>
              {DateDisplay.shortDate(point.day)} {bloodGlucoseMomentNames[point.moment]}：{format1(point.value)}
              （阈值 {format1(limit)}）
            </span>
          );
        })
      )}
    </div>
  );
}

function GlucoseDayChart({ points, comparisonEnabled }: { points: MomentPoint[]; comparisonEnabled: boolean }) {
  const width = 600;
  const height = 180;
  const top = 20;
  const bottom = 38;
  const chartHeight = height - top - bottom;
  const slotWidth = width / points.length;
  const barWidth = 26;
  const maxValue = Math.max(...points.map((point) => point.value), 10);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="血糖柱状图">
      {points.map((point, index) => {
        const centerX = slotWidth * index + slotWidth / 2;
        const barHeight = (point.value / maxValue) * chartHeight;
        const isExceeded = comparisonEnabled && point.value > dailyControlUpperLimit(point.moment);
        const color = isExceeded ? "var(--red)" : "var(--pink)";

        return (
          <g key={point.moment}>
            <rect
              x={centerX - barWidth / 2}
              y={top + chartHeight - barHeight}
              width={barWidth}
              height={Math.max(barHeight, 0)}
              fill={color}
              rx={3}
            />
            <text
              x={centerX}
              y={top + chartHeight - barHeight - 5}
              textAnchor="middle"
              fontSize={11}
              fill={isExceeded ? "var(--red)" : "var(--text-secondary)"}
            >
              {format1(point.value)}
            </text>
            <text x={centerX} y={height - 22} textAnchor="middle" fontSize={10} fill="var(--text-secondary)">
              {bloodGlucoseMomentNames[point.moment]}
            </text>
            <text x={centerX} y={height - 8} textAnchor="middle" fontSize={10} fill="var(--text-secondary)">
              {point.recordedAt != null ? DateDisplay.clockTime(point.recordedAt) : "--:--"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
