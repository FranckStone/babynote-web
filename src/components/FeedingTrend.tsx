import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FeedingRecord, WeightRecord } from "../../shared/types";
import { streamFeedingAnalysis } from "../api";
import { DateDisplay, formatFeedingAmount } from "../lib/display";
import { resolveDayRange, type DayRange } from "../lib/feedingRange";
import { FeedingRangeSelector } from "./FeedingRangeSelector";
import {
  AMOUNT_BANDS,
  analyzeFeedings,
  buildAISummary,
  buildInsights,
  summarizeFeedingRange,
  scopeFeedingIntervals,
  type FeedingAnalysis,
  percentChange,
  type AmountBandKey,
  type FeedingDay,
  type PeriodSummary,
} from "../lib/feedingAnalysis";
import { Segmented } from "./widgets";

const RANGE_OPTIONS = [
  { label: "14 天", days: 14 },
  { label: "30 天", days: 30 },
  { label: "90 天", days: 90 },
  { label: "全部", days: null },
];

const BAND_COLORS: Record<AmountBandKey, string> = {
  full: "var(--pink)",
  medium: "var(--feed-band-medium)",
  small: "var(--feed-band-small)",
};

const shortDay = (day: number) => {
  const date = new Date(day);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

const hoursText = (hours: number) => {
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return minutes > 0 ? `${whole}时${minutes}分` : `${whole}时`;
};

export function FeedingTrend({ feedings, weights }: { feedings: FeedingRecord[]; weights: WeightRecord[] }) {
  const analysis = useMemo(() => analyzeFeedings(feedings, weights), [feedings, weights]);
  const insights = useMemo(() => buildInsights(analysis), [analysis]);
  const [rangeIndex, setRangeIndex] = useState(RANGE_OPTIONS.length - 1);
  const [customDates, setCustomDates] = useState<DayRange | null>(null);

  if (analysis.days.length === 0) return null;

  const rangeDays = RANGE_OPTIONS[rangeIndex].days;
  const range = resolveDayRange(analysis.days.map((day) => day.day), rangeDays, customDates);
  const visibleDays = scopeFeedingIntervals(analysis.days.slice(range.start, range.end + 1));
  const selectRange = (next: DayRange) => {
    if (next.start === 0 && next.end === analysis.days.length - 1) {
      setCustomDates(null);
      setRangeIndex(RANGE_OPTIONS.length - 1);
    } else {
      setCustomDates({ start: analysis.days[next.start].day, end: analysis.days[next.end].day });
    }
  };
  const selected = summarizeFeedingRange(visibleDays)!;
  const previous = range.start >= visibleDays.length
    ? summarizeFeedingRange(analysis.days.slice(range.start - visibleDays.length, range.start))
    : null;
  const selectedDates = `${new Date(visibleDays[0].day).toLocaleDateString("zh-CN")} — ${new Date(visibleDays[visibleDays.length - 1].day).toLocaleDateString("zh-CN")}`;

  return (
    <div className="feeding-trend">
      <div className="feeding-trend-tiles">
        <StatTile
          label="日均奶量"
          value={`${Math.round(selected.dailyML)} ml`}
          delta={deltaText(selected, previous, (period) => period.dailyML)}
        />
        <StatTile
          label="每顿平均"
          value={selected.perFeedML != null ? `${Math.round(selected.perFeedML)} ml` : "—"}
          delta={deltaText(selected, previous, (period) => period.perFeedML)}
        />
        <StatTile
          label="每天顿数"
          value={`${selected.feedsPerDay.toFixed(1)} 顿`}
          delta={deltaText(selected, previous, (period) => period.feedsPerDay)}
        />
        <StatTile
          label="最长间隔"
          value={selected.longestGapHours != null ? hoursText(selected.longestGapHours) : "—"}
          delta={previous?.longestGapHours != null ? `上一时段 ${hoursText(previous.longestGapHours)}` : null}
        />
      </div>
      <p className="muted feeding-trend-footnote">
        所选时段：{selectedDates}（{selected.days} 天）
        {visibleDays.some((day) => day.isToday) ? "；含今天未结束的数据" : ""}
        {previous ? "；与前一等长时段对比" : ""}
      </p>

      <section className="card">
        <h2 className="card-title">近 7 天趋势分析</h2>
        <ul className="feeding-insights">
          {insights.map((insight) => (
            <li key={insight.text} className={insight.tone === "attention" ? "attention" : ""}>
              {insight.text}
            </li>
          ))}
        </ul>
        <AIInsight analysis={analysis} />
        <p className="muted feeding-trend-footnote">仅根据记录数据统计，不能代替医生判断。</p>
      </section>

      <Segmented
        options={RANGE_OPTIONS.map((option) => option.label)}
        selectedIndex={customDates == null ? rangeIndex : -1}
        onSelect={(index) => { setRangeIndex(index); setCustomDates(null); }}
      />

      <FeedingRangeSelector days={analysis.days} range={range} onChange={selectRange} />

      <section className="card">
        <h2 className="card-title">每日奶量</h2>
        <Legend
          items={[
            { label: "每日总量", color: "var(--pink)", shape: "rect" },
            { label: "7 天平均", color: "var(--blue)", shape: "line" },
          ]}
        />
        <ColumnChart
          days={visibleDays}
          ariaLabel="每日奶量柱状图"
          unit="ml"
          segments={(day) => [{ key: "total", value: day.totalML, color: "var(--pink)" }]}
          line={(day) => day.rollingAverageML}
          tooltip={(day) => (
            <>
              <strong>{formatFeedingAmount(day.totalML)}</strong>
              <span>
                {day.count} 顿{day.averageML != null ? ` · 每顿 ${Math.round(day.averageML)} ml` : ""}
              </span>
              {day.rollingAverageML != null && (
                <span className="key-line" style={{ ["--key" as string]: "var(--blue)" }}>
                  7 天平均 {Math.round(day.rollingAverageML)} ml
                </span>
              )}
            </>
          )}
        />
      </section>

      <section className="card">
        <h2 className="card-title">每天顿数与每顿奶量</h2>
        <Legend
          items={[...AMOUNT_BANDS].reverse().map((band) => ({ label: band.label, color: BAND_COLORS[band.key], shape: "rect" as const }))}
        />
        <ColumnChart
          days={visibleDays}
          ariaLabel="每天各档奶量顿数堆叠柱状图"
          unit="顿"
          segments={(day) =>
            (["full", "medium", "small"] as const).map((key) => ({ key, value: day.bands[key], color: BAND_COLORS[key] }))
          }
          tooltip={(day) => (
            <>
              <strong>{day.count} 顿</strong>
              {[...AMOUNT_BANDS].reverse()
                .filter((band) => day.bands[band.key] > 0)
                .map((band) => (
                  <span key={band.key} className="key-rect" style={{ ["--key" as string]: BAND_COLORS[band.key] }}>
                    {band.label}：{day.bands[band.key]} 顿
                  </span>
                ))}
              {day.feeds.length > 0 && (
                <span className="feeding-tooltip-feeds">
                  {day.feeds.map((feed) => (
                    <span key={feed.id}>
                      {DateDisplay.clockTime(feed.startedAt)} <b>{feed.amountML ?? "—"}</b>
                    </span>
                  ))}
                </span>
              )}
            </>
          )}
        />
      </section>

      <section className="card">
        <h2 className="card-title">每天最长间隔</h2>
        <p className="muted feeding-trend-footnote" style={{ marginTop: -6 }}>
          通常是夜里的长觉；间隔变长时，一天的顿数会跟着减少
        </p>
        <ColumnChart
          days={visibleDays}
          ariaLabel="每天最长喂奶间隔柱状图"
          unit="时"
          segments={(day) => [{ key: "gap", value: day.longestGapHours ?? 0, color: "var(--pink)" }]}
          tooltip={(day) => <strong>{day.longestGapHours != null ? hoursText(day.longestGapHours) : "无记录"}</strong>}
        />
      </section>
    </div>
  );
}

const AI_CACHE_KEY = "babynote.feedingAI";

interface CachedAI {
  fingerprint: string;
  text: string;
  createdAt: number;
}

function readCachedAI(): CachedAI | null {
  try {
    const value = localStorage.getItem(AI_CACHE_KEY);
    return value ? (JSON.parse(value) as CachedAI) : null;
  } catch {
    return null;
  }
}

function AIInsight({ analysis }: { analysis: FeedingAnalysis }) {
  const summary = useMemo(() => buildAISummary(analysis), [analysis]);
  // 只在记录变化时才算"数据已更新";当前时间、距上一顿等随时间变的字段不参与。
  const fingerprint = useMemo(
    () => JSON.stringify([summary.每日汇总, summary.近3天每顿明细, summary.最近体重kg]),
    [summary],
  );
  const [result, setResult] = useState<CachedAI | null>(readCachedAI);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setStreamingText("");
    let text = "";
    try {
      await streamFeedingAnalysis(
        summary,
        (chunk) => {
          text += chunk;
          setStreamingText(text);
        },
        controller.signal,
      );
      if (!text.trim()) throw new Error("AI 没有返回内容，请重试");
      const next = { fingerprint, text, createdAt: Date.now() };
      setResult(next);
      try {
        localStorage.setItem(AI_CACHE_KEY, JSON.stringify(next));
      } catch {
        // 无痕模式等场景下存不了，不影响本次展示。
      }
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "AI 分析失败");
    } finally {
      if (abortRef.current === controller) setStreamingText(null);
    }
  };

  const isRunning = streamingText != null;
  const shownText = streamingText ?? result?.text ?? null;
  const isStale = !isRunning && result != null && result.fingerprint !== fingerprint;

  return (
    <div className="feeding-ai">
      <div className="row">
        <span className="semibold small">AI 解读</span>
        <span className="muted" style={{ fontSize: 12 }}>
          DeepSeek
          {!isRunning && result && ` · ${DateDisplay.shortDate(result.createdAt)} ${DateDisplay.clockTime(result.createdAt)}`}
          {isStale && " · 记录有更新"}
        </span>
        <span className="spacer" />
        <button type="button" className="feeding-ai-button" onClick={run} disabled={isRunning}>
          {isRunning ? "分析中…" : result ? "重新分析" : "让 AI 分析"}
        </button>
      </div>
      {error && <p className="feeding-ai-error">{error}</p>}
      {shownText != null && <AIText text={shownText} pending={isRunning} />}
    </div>
  );
}

/** 渲染模型按"【标题】+ '- ' 条目"格式输出的纯文本。 */
function AIText({ text, pending }: { text: string; pending: boolean }) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0 && pending) return <p className="muted small feeding-ai-body">正在读取数据…</p>;
  return (
    <div className="feeding-ai-body" aria-live="polite">
      {lines.map((line, index) =>
        /^【.*】$/.test(line) ? (
          <h3 key={index}>{line.slice(1, -1)}</h3>
        ) : (
          <p key={index} className={line.startsWith("- ") ? "item" : undefined}>
            {line.replace(/^- /, "")}
          </p>
        ),
      )}
    </div>
  );
}

function deltaText(
  recent: PeriodSummary,
  previous: PeriodSummary | null,
  pick: (period: PeriodSummary) => number | null,
): string | null {
  const current = pick(recent);
  const before = previous ? pick(previous) : null;
  if (current == null || before == null) return null;
  const change = percentChange(current, before);
  if (change == null) return null;
  if (Math.abs(change) < 1) return "持平";
  return `${change > 0 ? "↑" : "↓"} ${Math.abs(Math.round(change))}%`;
}

function StatTile({ label, value, delta }: { label: string; value: string; delta: string | null }) {
  return (
    <div className="feeding-stat-tile">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {delta && <span className="delta">{delta}</span>}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; shape: "rect" | "line" }[] }) {
  return (
    <div className="feeding-legend">
      {items.map((item) => (
        <span key={item.label}>
          <i className={item.shape} style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** 取不超过 5 格的整齐刻度。 */
function niceScale(maxValue: number) {
  const rough = Math.max(maxValue, 1) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough)!;
  const max = Math.ceil(maxValue / step) * step || step;
  return { max, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, index) => index * step) };
}

interface Segment {
  key: string;
  value: number;
  color: string;
}

const CHART_HEIGHT = 214;
const MARGIN = { top: 26, right: 8, bottom: 24, left: 36 };
const SEGMENT_GAP = 2;
const CORNER = 4;

/** 顶端 4px 圆角、底部直角的柱子路径。 */
function columnPath(x: number, y: number, width: number, height: number, rounded: boolean) {
  if (height <= 0) return "";
  const radius = rounded ? Math.min(CORNER, width / 2, height) : 0;
  return `M${x},${y + height}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + width - radius}Q${x + width},${y} ${x + width},${y + radius}V${y + height}Z`;
}

function ColumnChart({
  days,
  ariaLabel,
  unit,
  segments,
  line,
  tooltip,
}: {
  days: FeedingDay[];
  ariaLabel: string;
  unit: string;
  segments: (day: FeedingDay) => Segment[];
  line?: (day: FeedingDay) => number | null;
  tooltip: (day: FeedingDay) => ReactNode;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  useEffect(() => setActiveIndex(null), [days]);

  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 0);
  const plotHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  const band = days.length > 0 ? plotWidth / days.length : 0;
  const columnWidth = Math.max(Math.min(24, band - SEGMENT_GAP), 1);

  const segmentsByDay = days.map(segments);
  const lineValues = line ? days.map(line) : [];
  const maxValue = Math.max(
    ...segmentsByDay.map((list) => list.reduce((sum, segment) => sum + segment.value, 0)),
    ...lineValues.filter((value): value is number => value != null),
  );
  const scale = niceScale(maxValue);
  const yAt = (value: number) => MARGIN.top + plotHeight * (1 - value / scale.max);
  const xCenter = (index: number) => MARGIN.left + band * index + band / 2;

  // 横轴标签至少相隔 36px,从最右(最新)一天往回取。
  const labelEvery = Math.max(1, Math.ceil(36 / Math.max(band, 1)));

  const linePath = lineValues
    .map((value, index) => ({ value, index }))
    .reduce<string>((path, point, position, points) => {
      if (point.value == null) return path;
      const previous = points[position - 1];
      const command = previous?.value == null ? "M" : "L";
      return `${path}${command}${xCenter(point.index)},${yAt(point.value)}`;
    }, "");

  const active = activeIndex != null ? days[activeIndex] : null;
  // 提示框放在柱子旁边，不挡住当前柱：左半边的柱往右放，右半边的往左放。
  const tooltipOnRight = activeIndex != null && xCenter(activeIndex) < width / 2;
  const tooltipStyle =
    activeIndex == null
      ? undefined
      : tooltipOnRight
        ? { left: xCenter(activeIndex) + columnWidth / 2 + 8 }
        : { left: xCenter(activeIndex) - columnWidth / 2 - 8, transform: "translateX(-100%)" };

  return (
    <div
      ref={ref}
      className="feeding-chart"
      // 触屏抬手后也会触发 pointerleave,只在鼠标移出时收起提示框。
      onPointerLeave={(event) => event.pointerType === "mouse" && setActiveIndex(null)}
    >
      {width > 0 && (
        <svg width={width} height={CHART_HEIGHT} role="img" aria-label={ariaLabel}>
          {scale.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={yAt(tick)}
                y2={yAt(tick)}
                stroke="var(--surface-variant)"
                strokeWidth={1}
              />
              <text x={MARGIN.left - 6} y={yAt(tick) + 4} textAnchor="end" className="feeding-chart-tick">
                {tick}
              </text>
            </g>
          ))}
          <text x={MARGIN.left - 6} y={10} textAnchor="end" className="feeding-chart-tick">
            {unit}
          </text>

          {days.map((day, index) => {
            const list = segmentsByDay[index].filter((segment) => segment.value > 0);
            const x = xCenter(index) - columnWidth / 2;
            let base = 0;
            const dimmed = activeIndex != null && activeIndex !== index;
            return (
              <g
                key={day.day}
                opacity={dimmed ? 0.55 : day.isToday ? 0.5 : 1}
                className="feeding-chart-column"
              >
                {list.map((segment, position) => {
                  const bottom = yAt(base);
                  base += segment.value;
                  const top = yAt(base);
                  const isTop = position === list.length - 1;
                  // 相邻段之间留 2px 表面色空隙，最底一段贴住基线。
                  const height = bottom - top - (position > 0 ? SEGMENT_GAP : 0);
                  return <path key={segment.key} d={columnPath(x, top, columnWidth, height, isTop)} fill={segment.color} />;
                })}
              </g>
            );
          })}

          {linePath && (
            <path d={linePath} fill="none" stroke="var(--blue)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          )}
          {active && line && lineValues[activeIndex!] != null && (
            <circle
              cx={xCenter(activeIndex!)}
              cy={yAt(lineValues[activeIndex!]!)}
              r={4}
              fill="var(--blue)"
              stroke="var(--surface)"
              strokeWidth={2}
            />
          )}

          <line
            x1={MARGIN.left}
            x2={width - MARGIN.right}
            y1={yAt(0)}
            y2={yAt(0)}
            stroke="var(--text-secondary)"
            strokeOpacity={0.4}
            strokeWidth={1}
          />
          {days.map((day, index) =>
            (days.length - 1 - index) % labelEvery === 0 ? (
              <text key={day.day} x={xCenter(index)} y={CHART_HEIGHT - 6} textAnchor="middle" className="feeding-chart-tick">
                {day.isToday ? "今天" : shortDay(day.day)}
              </text>
            ) : null,
          )}

          {days.map((day, index) => (
            <rect
              key={day.day}
              x={MARGIN.left + band * index}
              y={MARGIN.top}
              width={band}
              height={plotHeight}
              fill="transparent"
              tabIndex={0}
              aria-label={`${DateDisplay.shortDate(day.day)}`}
              onPointerEnter={() => setActiveIndex(index)}
              onClick={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onBlur={() => setActiveIndex(null)}
            />
          ))}
        </svg>
      )}

      {active && (
        <div className="feeding-tooltip" style={tooltipStyle} role="status">
          <span className="date">
            {DateDisplay.shortDate(active.day)}
            {active.isToday ? "(今天，进行中)" : ""}
          </span>
          {tooltip(active)}
        </div>
      )}
    </div>
  );
}
