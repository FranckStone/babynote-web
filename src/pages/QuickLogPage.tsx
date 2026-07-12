import { useEffect, useMemo, useRef, useState } from "react";
import type { ExcretionRecord, FeedingRecord } from "../../shared/types";
import { DateDisplay, formatFeedingAmount } from "../lib/display";
import { feedingDurationMinutes } from "../lib/timeline";
import { useData } from "../store";
import { AmountPicker, IntervalHighlight, Segmented, feedingIntervalText } from "../components/widgets";

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "feeding", label: "奶" },
  { key: "poop", label: "屎" },
  { key: "pee", label: "尿" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

type DayRecord =
  | { kind: "feeding"; record: FeedingRecord; previousStartedAt: number | null; recordedAt: number }
  | { kind: "excretion"; record: ExcretionRecord; recordedAt: number };

export function QuickLogPage() {
  const { records, create, update, remove } = useData();

  // 每秒刷新“距离上次喂奶”的实时计时
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const latestAmount = records.feedings.find((record) => record.amountML != null)?.amountML ?? null;
  const [amountText, setAmountText] = useState("60");
  const appliedSuggestion = useRef(false);
  useEffect(() => {
    if (appliedSuggestion.current || latestAmount == null) return;
    const suggested = Math.floor(latestAmount);
    setAmountText(`${[30, 60, 90, 120, 150, 180].includes(suggested) ? suggested : 60}`);
    appliedSuggestion.current = true;
  }, [latestAmount]);

  const [filter, setFilter] = useState<FilterKey>("all");
  const [dayOffset, setDayOffset] = useState(0);

  // 行内奶量调整先缓存,0.45 秒无操作再落库
  const [pendingAmounts, setPendingAmounts] = useState<Record<number, number>>({});
  const pendingTimers = useRef<Record<number, number>>({});

  const displayedAmount = (record: FeedingRecord): number | null =>
    pendingAmounts[record.id] ?? record.amountML;

  const adjustRecordAmount = (record: FeedingRecord, delta: number) => {
    const current = pendingAmounts[record.id] ?? Math.round(record.amountML ?? 0);
    const updated = Math.max(current + delta, 0);
    setPendingAmounts((previous) => ({ ...previous, [record.id]: updated }));

    window.clearTimeout(pendingTimers.current[record.id]);
    pendingTimers.current[record.id] = window.setTimeout(async () => {
      await update("feeding", record.id, { amountML: updated });
      setPendingAmounts((previous) => {
        const next = { ...previous };
        delete next[record.id];
        return next;
      });
    }, 450);
  };

  const dayStart = DateDisplay.startOfDayOffset(dayOffset, now);
  const dayEnd = DateDisplay.nextDay(dayStart);

  const dayRecords = useMemo(() => {
    const items: DayRecord[] = [];

    // feedings 按开始时间倒序,上一次喂奶就是倒序里的下一条。
    records.feedings.forEach((record, index) => {
      if (record.startedAt < dayStart || record.startedAt >= dayEnd) return;
      items.push({
        kind: "feeding",
        record,
        previousStartedAt: records.feedings[index + 1]?.startedAt ?? null,
        recordedAt: record.startedAt,
      });
    });

    for (const record of records.excretions) {
      if (record.recordedAt < dayStart || record.recordedAt >= dayEnd) continue;
      items.push({ kind: "excretion", record, recordedAt: record.recordedAt });
    }

    return items
      .filter((item) => {
        if (filter === "all") return true;
        if (filter === "feeding") return item.kind === "feeding";
        if (filter === "poop") return item.kind === "excretion" && item.record.type === "poop";
        return item.kind === "excretion" && item.record.type === "pee";
      })
      .sort((a, b) => b.recordedAt - a.recordedAt);
  }, [records, dayStart, dayEnd, filter]);

  const dayLabel = (offset: number): string => {
    if (offset === 0) return "今天";
    if (offset === 1) return "昨天";
    if (offset === 2) return "前天";
    if (offset === 3) return "大前天";
    return DateDisplay.shortDate(DateDisplay.startOfDayOffset(offset, now));
  };

  // 3 小时内喂奶统计
  const threeHourStats = useMemo(() => {
    const windowStart = now - 3 * 60 * 60_000;
    let count = 0;
    let total = 0;
    for (const record of records.feedings) {
      if (record.startedAt < windowStart) break;
      if (record.startedAt <= now + 1000) {
        count += 1;
        total += displayedAmount(record) ?? 0;
      }
    }
    return { count, total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records.feedings, now, pendingAmounts]);

  const previousFeedingStart = records.feedings.find((record) => record.startedAt < now)?.startedAt ?? null;
  const hasAmount = amountText.trim() !== "" && Number.isFinite(Number(amountText.trim()));

  // 日汇总
  const feedingItems = dayRecords.filter((item) => item.kind === "feeding") as Extract<DayRecord, { kind: "feeding" }>[];
  const feedingTotal = feedingItems.reduce((total, item) => total + (displayedAmount(item.record) ?? 0), 0);
  const poopCount = dayRecords.filter((item) => item.kind === "excretion" && item.record.type === "poop").length;
  const peeCount = dayRecords.filter((item) => item.kind === "excretion" && item.record.type === "pee").length;

  return (
    <div className="page quick-log-page">
      <h1 className="page-title">快速记录</h1>

      <section className="card quick-feeding-card">
        <h2 className="card-title">喂奶</h2>

        <IntervalHighlight text={feedingIntervalText(previousFeedingStart, now)} />

        <div className="row" style={{ background: "var(--surface-variant)", borderRadius: 16, padding: 12 }}>
          <span style={{ fontSize: 22 }}>🍼</span>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="muted small semibold">3小时内喂奶量</span>
            <div className="row">
              <span className="semibold" style={{ fontSize: 18 }}>
                {formatFeedingAmount(threeHourStats.total)}
              </span>
              <span className="spacer" />
              <span className="muted small">
                {threeHourStats.count > 0 ? `共 ${threeHourStats.count} 次` : "暂无记录"}
              </span>
            </div>
          </div>
        </div>

        <AmountPicker
          amountText={amountText}
          suggestionTitle={latestAmount != null ? `上次 ${Math.floor(latestAmount)} ml` : "默认 60 ml"}
          onChange={setAmountText}
        />

        <button
          type="button"
          className="primary-button"
          style={{ background: "rgb(233 30 99 / 16%)", color: "var(--pink)" }}
          disabled={!hasAmount}
          onClick={() =>
            create("feeding", {
              startedAt: Date.now(),
              feedingType: "formula",
              amountML: Number(amountText.trim()),
              note: "",
            })
          }
        >
          ➕ 喂奶
        </button>
      </section>

      <section className="card quick-excretion-card">
        <h2 className="card-title">屎尿</h2>
        <div className="row">
          <button
            type="button"
            className="primary-button"
            style={{ background: "rgb(141 110 99 / 16%)", color: "var(--brown)" }}
            onClick={() => create("excretion", { recordedAt: Date.now(), type: "poop", note: "" })}
          >
            🚽 屎
          </button>
          <button
            type="button"
            className="primary-button"
            style={{ background: "rgb(249 168 37 / 16%)", color: "var(--yellow)" }}
            onClick={() => create("excretion", { recordedAt: Date.now(), type: "pee", note: "" })}
          >
            💧 尿
          </button>
        </div>
      </section>

      <section className="card quick-records-card">
        <h2 className="card-title">{dayLabel(dayOffset)}记录</h2>

        <Segmented
          options={[0, 1, 2, 3, 4].map(dayLabel)}
          selectedIndex={dayOffset}
          onSelect={setDayOffset}
        />
        <Segmented
          options={FILTERS.map((item) => item.label)}
          selectedIndex={FILTERS.findIndex((item) => item.key === filter)}
          onSelect={(index) => setFilter(FILTERS[index].key)}
        />

        <div className="quick-records-scroll">
          {dayRecords.length === 0 ? (
            <span className="muted small">
              {filter === "all"
                ? `${dayLabel(dayOffset)}的喂奶、屎或尿记录会出现在这里。`
                : filter === "feeding"
                  ? `${dayLabel(dayOffset)}还没有喂奶记录。`
                  : filter === "poop"
                    ? `${dayLabel(dayOffset)}还没有屎记录。`
                    : `${dayLabel(dayOffset)}还没有尿记录。`}
            </span>
          ) : (
            <>
              <span className="muted small semibold">
                {dayLabel(dayOffset)} · 奶 {feedingItems.length} 次 · 共 {formatFeedingAmount(feedingTotal)} · 屎{" "}
                {poopCount} 次 · 尿 {peeCount} 次
              </span>

              {dayRecords.map((item) =>
                item.kind === "feeding" ? (
                  <FeedingRow
                    key={`feeding-${item.record.id}`}
                    record={item.record}
                    previousStartedAt={item.previousStartedAt}
                    displayedAmount={displayedAmount(item.record)}
                    onAdjust={(delta) => adjustRecordAmount(item.record, delta)}
                    onDelete={() => remove("feeding", item.record.id)}
                  />
                ) : (
                  <ExcretionRow
                    key={`excretion-${item.record.id}`}
                    record={item.record}
                    onDelete={() => remove("excretion", item.record.id)}
                  />
                ),
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function FeedingRow({
  record,
  previousStartedAt,
  displayedAmount,
  onAdjust,
  onDelete,
}: {
  record: FeedingRecord;
  previousStartedAt: number | null;
  displayedAmount: number | null;
  onAdjust: (delta: number) => void;
  onDelete: () => void;
}) {
  const duration = feedingDurationMinutes(record);
  const timing = [DateDisplay.time(record.startedAt), duration != null ? `${duration} 分` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="list-row">
      <span className="icon-badge" style={{ background: "rgb(30 136 229 / 14%)" }}>
        🍼
      </span>
      <div className="content">
        <span className="semibold small">喂奶</span>
        <span className="muted" style={{ fontSize: 12 }}>
          {timing}
        </span>
        {previousStartedAt != null && (
          <span className="muted" style={{ fontSize: 12 }}>
            间隔 {DateDisplay.durationText(Math.floor((record.startedAt - previousStartedAt) / 1000))}
          </span>
        )}
      </div>

      <div className="inline-stepper">
        <button type="button" onClick={() => onAdjust(-10)} aria-label="减少奶量">
          −
        </button>
        <span className="amount">
          {displayedAmount != null ? formatFeedingAmount(displayedAmount) : "未填奶量"}
        </span>
        <button type="button" onClick={() => onAdjust(10)} aria-label="增加奶量">
          +
        </button>
      </div>

      <button type="button" className="delete-button" onClick={onDelete} aria-label="删除">
        🗑
      </button>
    </div>
  );
}

function ExcretionRow({ record, onDelete }: { record: ExcretionRecord; onDelete: () => void }) {
  const isPoop = record.type === "poop";
  return (
    <div className="list-row">
      <span
        className="icon-badge"
        style={{ background: isPoop ? "rgb(141 110 99 / 14%)" : "rgb(249 168 37 / 14%)" }}
      >
        {isPoop ? "🚽" : "💧"}
      </span>
      <div className="content">
        <span className="semibold small">{isPoop ? "拉屎" : "撒尿"}</span>
        <span className="muted" style={{ fontSize: 12 }}>
          {DateDisplay.time(record.recordedAt)}
        </span>
      </div>
      <button type="button" className="delete-button" onClick={onDelete} aria-label="删除">
        🗑
      </button>
    </div>
  );
}
