import { useEffect, useMemo, useRef, useState } from "react";
import type { ExcretionRecord, FeedingRecord } from "../../shared/types";
import { DateDisplay, formatFeedingAmount } from "../lib/display";
import { feedingDurationMinutes } from "../lib/timeline";
import { useData } from "../store";
import { AmountPicker, IntervalHighlight, Modal, Segmented, feedingIntervalText } from "../components/widgets";

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "feeding", label: "奶" },
  { key: "poop", label: "屎" },
  { key: "pee", label: "尿" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

type DayRecord =
  | { kind: "feeding"; record: FeedingRecord; previousStartedAt: number | null; recordedAt: number }
  | { kind: "excretion"; record: ExcretionRecord; previousRecordedAt: number | null; recordedAt: number };

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

  const dayStart = DateDisplay.startOfDay(now);
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

    records.excretions.forEach((record, index) => {
      if (record.recordedAt < dayStart || record.recordedAt >= dayEnd) return;
      const previousRecordedAt =
        records.excretions.slice(index + 1).find((candidate) => candidate.type === record.type)?.recordedAt ?? null;
      items.push({ kind: "excretion", record, previousRecordedAt, recordedAt: record.recordedAt });
    });

    return items
      .filter((item) => {
        if (filter === "all") return true;
        if (filter === "feeding") return item.kind === "feeding";
        if (filter === "poop") return item.kind === "excretion" && item.record.type === "poop";
        return item.kind === "excretion" && item.record.type === "pee";
      })
      .sort((a, b) => b.recordedAt - a.recordedAt);
  }, [records, dayStart, dayEnd, filter]);

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

        <IntervalHighlight
          key={previousFeedingStart ?? "no-feeding"}
          text={feedingIntervalText(previousFeedingStart, now)}
          progressMillis={previousFeedingStart == null ? 0 : Math.max(now - previousFeedingStart, 0) % 60_000}
        />

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
            💩 屎
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
        <h2 className="card-title">今天记录</h2>
        <Segmented
          options={FILTERS.map((item) => item.label)}
          selectedIndex={FILTERS.findIndex((item) => item.key === filter)}
          onSelect={(index) => setFilter(FILTERS[index].key)}
        />

        <div className="quick-records-scroll">
          {dayRecords.length === 0 ? (
            <span className="muted small">
              {filter === "all"
                ? "今天的喂奶、屎或尿记录会出现在这里。"
                : filter === "feeding"
                  ? "今天还没有喂奶记录。"
                  : filter === "poop"
                    ? "今天还没有屎记录。"
                    : "今天还没有尿记录。"}
            </span>
          ) : (
            <>
              <span className="muted small semibold">
                今天 · 奶 {feedingItems.length} 次 · 共 {formatFeedingAmount(feedingTotal)} · 屎{" "}
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
                  onTimeChange={(startedAt) => update("feeding", item.record.id, { startedAt })}
                  onDelete={() => remove("feeding", item.record.id)}
                  />
                ) : (
                  <ExcretionRow
                    key={`excretion-${item.record.id}`}
                    record={item.record}
                    previousRecordedAt={item.previousRecordedAt}
                    onTimeChange={(recordedAt) => update("excretion", item.record.id, { recordedAt })}
                    onAmountChange={(amount) => update("excretion", item.record.id, { amount })}
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
  onTimeChange,
  onDelete,
}: {
  record: FeedingRecord;
  previousStartedAt: number | null;
  displayedAmount: number | null;
  onAdjust: (delta: number) => void;
  onTimeChange: (timeMillis: number) => void;
  onDelete: () => void;
}) {
  const duration = feedingDurationMinutes(record);

  return (
    <div className="list-row">
      <span className="icon-badge" style={{ background: "rgb(30 136 229 / 14%)" }}>
        🍼
      </span>
      <div className="content">
        <div className="record-time-row">
          <RecordTimeInput timeMillis={record.startedAt} label="修改喂奶时间" onChange={onTimeChange} />
          {duration != null && <span className="muted">· {duration} 分</span>}
        </div>
      </div>

      <span className={`record-row-interval ${previousStartedAt == null ? "empty" : ""}`}>
        {previousStartedAt == null
          ? "—"
          : DateDisplay.compactDurationText((record.startedAt - previousStartedAt) / 1000)}
      </span>

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
      </button>
    </div>
  );
}

function ExcretionRow({
  record,
  previousRecordedAt,
  onTimeChange,
  onAmountChange,
  onDelete,
}: {
  record: ExcretionRecord;
  previousRecordedAt: number | null;
  onTimeChange: (timeMillis: number) => void;
  onAmountChange: (amount: "less" | "more") => void;
  onDelete: () => void;
}) {
  const isPoop = record.type === "poop";
  return (
    <div className="list-row">
      <span
        className="icon-badge"
        style={{ background: isPoop ? "rgb(141 110 99 / 14%)" : "rgb(249 168 37 / 14%)" }}
      >
        {isPoop ? "💩" : "💧"}
      </span>
      <div className="content">
        <div className="record-time-row">
          <RecordTimeInput timeMillis={record.recordedAt} label="修改屎尿时间" onChange={onTimeChange} />
        </div>
      </div>
      <span className={`record-row-interval ${previousRecordedAt == null ? "empty" : ""}`}>
        {previousRecordedAt == null
          ? "—"
          : DateDisplay.compactDurationText((record.recordedAt - previousRecordedAt) / 1000)}
      </span>
      <div className="excretion-amount-toggle" aria-label="屎尿量">
        <button
          type="button"
          className={record.amount === "less" ? "active" : ""}
          onClick={() => onAmountChange("less")}
        >
          少
        </button>
        <button
          type="button"
          className={record.amount === "more" ? "active" : ""}
          onClick={() => onAmountChange("more")}
        >
          多
        </button>
      </div>
      <button type="button" className="delete-button" onClick={onDelete} aria-label="删除">
      </button>
    </div>
  );
}

function RecordTimeInput({
  timeMillis,
  label,
  onChange,
}: {
  timeMillis: number;
  label: string;
  onChange: (timeMillis: number) => void;
}) {
  const sourceDate = new Date(timeMillis);
  const [isOpen, setIsOpen] = useState(false);
  const [hours, setHours] = useState(sourceDate.getHours());
  const [minutes, setMinutes] = useState(sourceDate.getMinutes());

  const openPicker = () => {
    const current = new Date(timeMillis);
    setHours(current.getHours());
    setMinutes(current.getMinutes());
    setIsOpen(true);
  };

  return (
    <>
      <button type="button" className="record-time-button" aria-label={label} onClick={openPicker}>
        🕐 {DateDisplay.clockTime(timeMillis)}
      </button>

      {isOpen && (
        <Modal
          title="修改记录时间"
          onDismiss={() => setIsOpen(false)}
          onSave={() => {
            const next = new Date(timeMillis);
            next.setHours(hours, minutes, 0, 0);
            onChange(next.getTime());
            setIsOpen(false);
          }}
        >
          <div className="time-picker-value">
            {`${hours}`.padStart(2, "0")}:{`${minutes}`.padStart(2, "0")}
          </div>

          <div className="time-picker-sliders">
            <div className="time-slider-group">
              <span className="field-label">时</span>
              <div className="time-stepper-row">
                <button type="button" onClick={() => setHours((hours + 23) % 24)} aria-label="小时减一">−</button>
                <strong>{`${hours}`.padStart(2, "0")} 时</strong>
                <button type="button" onClick={() => setHours((hours + 1) % 24)} aria-label="小时加一">＋</button>
              </div>
              <input
                type="range"
                min={0}
                max={23}
                step={1}
                value={hours}
                aria-label="小时滑块"
                onChange={(event) => setHours(Number(event.target.value))}
              />
              <span className="time-slider-scale"><span>0 时</span><span>12 时</span><span>23 时</span></span>
            </div>

            <div className="time-slider-group">
              <span className="field-label">分钟</span>
              <div className="time-stepper-row">
                <button type="button" onClick={() => setMinutes((minutes + 59) % 60)} aria-label="分钟减一">−</button>
                <strong>{`${minutes}`.padStart(2, "0")} 分</strong>
                <button type="button" onClick={() => setMinutes((minutes + 1) % 60)} aria-label="分钟加一">＋</button>
              </div>
              <input
                type="range"
                min={0}
                max={59}
                step={1}
                value={minutes}
                aria-label="分钟滑块"
                onChange={(event) => setMinutes(Number(event.target.value))}
              />
              <span className="time-slider-scale"><span>0 分</span><span>30 分</span><span>59 分</span></span>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
