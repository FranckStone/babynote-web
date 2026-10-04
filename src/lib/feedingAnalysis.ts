// 喂奶趋势分析：按天汇总奶量、识别疑似重复记录，并生成近 7 天与前 7 天的对比结论。

import type { FeedingRecord, WeightRecord } from "../../shared/types";
import { DateDisplay } from "./display";

/** 与上一条间隔小于该值的记录视为连点产生的重复记录，不计入统计。 */
export const DUPLICATE_WINDOW_MS = 3 * 60_000;

/** 每顿奶量分档：用于看"喝足的顿"是否变少。 */
export const AMOUNT_BANDS = [
  { key: "small", label: "少于 80 ml", test: (ml: number) => ml < 80 },
  { key: "medium", label: "80–119 ml", test: (ml: number) => ml >= 80 && ml < 120 },
  { key: "full", label: "120 ml 及以上", test: (ml: number) => ml >= 120 },
] as const;

export type AmountBandKey = (typeof AMOUNT_BANDS)[number]["key"];

export interface FeedingDay {
  day: number;
  isToday: boolean;
  totalML: number;
  count: number;
  averageML: number | null;
  bands: Record<AmountBandKey, number>;
  /** 当天开始的喂奶与上一顿之间的最长间隔(小时)。 */
  longestGapHours: number | null;
  /** 截至当天(含)的近 7 个完整天日均;数据不足 7 天时为 null。 */
  rollingAverageML: number | null;
  feeds: FeedingRecord[];
}

export interface PeriodSummary {
  days: number;
  dailyML: number;
  feedsPerDay: number;
  perFeedML: number | null;
  smallFeeds: number;
  longestGapHours: number | null;
}

export interface FeedingAnalysis {
  days: FeedingDay[];
  duplicates: FeedingRecord[];
  recent: PeriodSummary | null;
  previous: PeriodSummary | null;
  today: { totalML: number; count: number; usualByNowML: number | null; hoursSinceLast: number | null };
  lowDays: FeedingDay[];
  mlPerKG: { value: number; weightKG: number; recordedAt: number } | null;
}

function bandOf(ml: number): AmountBandKey {
  return AMOUNT_BANDS.find((band) => band.test(ml))!.key;
}

export function dedupeFeedings(feedings: FeedingRecord[]) {
  const ascending = [...feedings].sort((a, b) => a.startedAt - b.startedAt);
  const kept: FeedingRecord[] = [];
  const duplicates: FeedingRecord[] = [];
  for (const record of ascending) {
    const previous = kept[kept.length - 1];
    if (previous && record.startedAt - previous.startedAt < DUPLICATE_WINDOW_MS) {
      duplicates.push(record);
    } else {
      kept.push(record);
    }
  }
  return { kept, duplicates };
}

function summarize(days: FeedingDay[]): PeriodSummary | null {
  if (days.length === 0) return null;
  const totalML = days.reduce((sum, day) => sum + day.totalML, 0);
  const count = days.reduce((sum, day) => sum + day.count, 0);
  const amounts = days.flatMap((day) => day.feeds.map((feed) => feed.amountML).filter((ml): ml is number => ml != null));
  const gaps = days.map((day) => day.longestGapHours).filter((gap): gap is number => gap != null);
  return {
    days: days.length,
    dailyML: totalML / days.length,
    feedsPerDay: count / days.length,
    perFeedML: amounts.length > 0 ? amounts.reduce((sum, ml) => sum + ml, 0) / amounts.length : null,
    smallFeeds: days.reduce((sum, day) => sum + day.bands.small, 0),
    longestGapHours: gaps.length > 0 ? Math.max(...gaps) : null,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function analyzeFeedings(
  feedings: FeedingRecord[],
  weights: WeightRecord[],
  now = Date.now(),
): FeedingAnalysis {
  const { kept, duplicates } = dedupeFeedings(feedings);
  const todayStart = DateDisplay.startOfDay(now);

  const byDay = new Map<number, FeedingRecord[]>();
  for (const record of kept) {
    const day = DateDisplay.startOfDay(record.startedAt);
    byDay.set(day, [...(byDay.get(day) ?? []), record]);
  }

  // 从第一条记录所在日连续铺到今天，没有记录的日子也保留为 0,避免图表跳天。
  const days: FeedingDay[] = [];
  if (kept.length > 0) {
    let previousStart: number | null = null;
    for (let day = DateDisplay.startOfDay(kept[0].startedAt); day <= todayStart; day = DateDisplay.nextDay(day)) {
      const feeds = byDay.get(day) ?? [];
      const bands: Record<AmountBandKey, number> = { small: 0, medium: 0, full: 0 };
      let totalML = 0;
      let amountCount = 0;
      let longestGapHours: number | null = null;
      for (const feed of feeds) {
        if (feed.amountML != null) {
          totalML += feed.amountML;
          amountCount += 1;
          bands[bandOf(feed.amountML)] += 1;
        }
        if (previousStart != null) {
          const gap = (feed.startedAt - previousStart) / 3_600_000;
          longestGapHours = Math.max(longestGapHours ?? 0, gap);
        }
        previousStart = feed.startedAt;
      }
      days.push({
        day,
        isToday: day === todayStart,
        totalML,
        count: feeds.length,
        averageML: amountCount > 0 ? totalML / amountCount : null,
        bands,
        longestGapHours,
        rollingAverageML: null,
        feeds,
      });
    }
  }

  // 第一天通常只记了半天，从第二天起才算完整天。
  const completeDays = days.filter((day, index) => !day.isToday && index > 0);
  for (const day of days) {
    if (day.isToday) continue;
    const window = completeDays.filter((candidate) => candidate.day <= day.day).slice(-7);
    if (window.length === 7 && window[window.length - 1].day === day.day) {
      day.rollingAverageML = window.reduce((sum, candidate) => sum + candidate.totalML, 0) / 7;
    }
  }

  const recentDays = completeDays.slice(-7);
  const previousDays = completeDays.slice(-14, -7);

  // 近 14 个完整天的中位数作基准，低于 80% 的日子单独提示。
  const baseline = median(completeDays.slice(-14).map((day) => day.totalML));
  const lowDays = baseline == null ? [] : recentDays.filter((day) => day.totalML < baseline * 0.8);

  const todayDay = days.find((day) => day.isToday);
  const minutesIntoDay = (now - todayStart) / 60_000;
  const usualByNow = recentDays.map((day) =>
    day.feeds
      .filter((feed) => (feed.startedAt - day.day) / 60_000 <= minutesIntoDay)
      .reduce((sum, feed) => sum + (feed.amountML ?? 0), 0),
  );
  const lastFeed = kept[kept.length - 1];

  const latestWeight = [...weights].sort((a, b) => b.recordedAt - a.recordedAt)[0];
  const recent = summarize(recentDays);

  return {
    days,
    duplicates,
    recent,
    previous: previousDays.length === 7 ? summarize(previousDays) : null,
    today: {
      totalML: todayDay?.totalML ?? 0,
      count: todayDay?.count ?? 0,
      usualByNowML: usualByNow.length > 0 ? usualByNow.reduce((sum, ml) => sum + ml, 0) / usualByNow.length : null,
      hoursSinceLast: lastFeed ? (now - lastFeed.startedAt) / 3_600_000 : null,
    },
    lowDays,
    mlPerKG:
      latestWeight && recent && latestWeight.weightKG > 0
        ? { value: recent.dailyML / latestWeight.weightKG, weightKG: latestWeight.weightKG, recordedAt: latestWeight.recordedAt }
        : null,
  };
}

export function percentChange(current: number, previous: number): number | null {
  return previous > 0 ? ((current - previous) / previous) * 100 : null;
}

function trendWord(change: number): string {
  const size = Math.abs(change);
  if (size < 5) return "基本持平";
  const direction = change > 0 ? "上升" : "下降";
  return size < 15 ? `略有${direction}` : `明显${direction}`;
}

function hoursText(hours: number): string {
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return minutes > 0 ? `${whole}时${minutes}分` : `${whole}时`;
}

export interface Insight {
  tone: "neutral" | "attention";
  text: string;
}

/** 生成通俗的文字结论，只陈述数据，不做医学诊断。 */
export function buildInsights(analysis: FeedingAnalysis): Insight[] {
  const { recent, previous, today, lowDays, duplicates, mlPerKG } = analysis;
  const insights: Insight[] = [];
  if (!recent) return insights;

  if (previous) {
    const dailyChange = percentChange(recent.dailyML, previous.dailyML) ?? 0;
    const countChange = percentChange(recent.feedsPerDay, previous.feedsPerDay) ?? 0;
    const perFeedChange =
      recent.perFeedML != null && previous.perFeedML != null ? percentChange(recent.perFeedML, previous.perFeedML) ?? 0 : 0;
    const signed = (value: number) => `${value > 0 ? "+" : ""}${Math.round(value)}%`;

    insights.push({
      tone: dailyChange <= -15 ? "attention" : "neutral",
      text: `近 7 天日均 ${Math.round(recent.dailyML)} ml，比前 7 天（${Math.round(previous.dailyML)} ml）${trendWord(dailyChange)}（${signed(dailyChange)}）。`,
    });

    if (Math.abs(dailyChange) >= 5) {
      const cause =
        Math.abs(countChange) >= Math.abs(perFeedChange)
          ? `主要是顿数变化：每天 ${previous.feedsPerDay.toFixed(1)} 顿 → ${recent.feedsPerDay.toFixed(1)} 顿`
          : `主要是每顿量变化：每顿 ${Math.round(previous.perFeedML ?? 0)} ml → ${Math.round(recent.perFeedML ?? 0)} ml`;
      insights.push({ tone: "neutral", text: `${cause}。` });
    }

    if (recent.smallFeeds > previous.smallFeeds + 1) {
      insights.push({
        tone: "attention",
        text: `少于 80 ml 的顿变多了：近 7 天 ${recent.smallFeeds} 顿，前 7 天 ${previous.smallFeeds} 顿。`,
      });
    }

    if (
      recent.longestGapHours != null &&
      previous.longestGapHours != null &&
      recent.longestGapHours - previous.longestGapHours >= 1
    ) {
      insights.push({
        tone: "neutral",
        text: `最长间隔从 ${hoursText(previous.longestGapHours)} 拉长到 ${hoursText(recent.longestGapHours)}，夜里睡得更久时顿数会自然减少。`,
      });
    }
  } else {
    insights.push({
      tone: "neutral",
      text: `近 ${recent.days} 天日均 ${Math.round(recent.dailyML)} ml，每天 ${recent.feedsPerDay.toFixed(1)} 顿。记满 14 天后会显示前后对比。`,
    });
  }

  if (lowDays.length > 0) {
    insights.push({
      tone: "attention",
      text: `偏少的日子：${lowDays.map((day) => `${DateDisplay.shortDate(day.day)} ${Math.round(day.totalML)} ml`).join("、")}（低于近 14 天中位数的 80%）。`,
    });
  }

  if (today.usualByNowML != null && today.usualByNowML > 0) {
    const diff = today.totalML - today.usualByNowML;
    const compare = Math.abs(diff) < today.usualByNowML * 0.1 ? "和平时差不多" : diff > 0 ? `比平时多 ${Math.round(diff)} ml` : `比平时少 ${Math.round(-diff)} ml`;
    const since = today.hoursSinceLast != null ? `，距上一顿 ${hoursText(today.hoursSinceLast)}` : "";
    insights.push({
      tone: "neutral",
      text: `今天到现在 ${Math.round(today.totalML)} ml / ${today.count} 顿，近 7 天同一时间平均 ${Math.round(today.usualByNowML)} ml，${compare}${since}。`,
    });
  }

  if (mlPerKG) {
    const value = Math.round(mlPerKG.value);
    const verdict = value < 120 ? "低于常见范围" : value > 180 ? "高于常见范围" : "在常见范围内";
    insights.push({
      tone: value < 120 || value > 180 ? "attention" : "neutral",
      text: `按最近体重 ${mlPerKG.weightKG} kg 计算，约 ${value} ml/kg/天，${verdict}（配方奶常用参考 120–180，约 150）。`,
    });
  } else {
    insights.push({ tone: "neutral", text: "录入体重后，可按每公斤奶量判断是否够量。" });
  }

  if (duplicates.length > 0) {
    insights.push({
      tone: "attention",
      text: `有 ${duplicates.length} 条记录与上一条相隔不到 3 分钟，疑似重复，已从统计中排除，可在时间线里核对删除。`,
    });
  }

  return insights;
}

const round1 = (value: number | null) => (value == null ? null : Math.round(value * 10) / 10);

function periodJson(period: PeriodSummary | null) {
  if (!period) return null;
  return {
    天数: period.days,
    日均ml: Math.round(period.dailyML),
    每天顿数: round1(period.feedsPerDay),
    每顿平均ml: period.perFeedML == null ? null : Math.round(period.perFeedML),
    少于80ml的顿数: period.smallFeeds,
    最长间隔小时: round1(period.longestGapHours),
  };
}

/** 发给 AI 的统计摘要：只含汇总数字，不含备注等自由文本。 */
export function buildAISummary(analysis: FeedingAnalysis, now = Date.now()) {
  const dateText = (time: number) => {
    const date = new Date(time);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };
  const completeDays = analysis.days.filter((day) => !day.isToday).slice(-21);
  const detailFrom = DateDisplay.startOfDayOffset(3, now);

  return {
    当前时间: `${dateText(now)} ${DateDisplay.clockTime(now)}`,
    记录起始日: analysis.days[0] ? dateText(analysis.days[0].day) : null,
    最近体重kg: analysis.mlPerKG?.weightKG ?? null,
    近7天: periodJson(analysis.recent),
    前7天: periodJson(analysis.previous),
    每日汇总: completeDays.map((day) => ({
      日期: dateText(day.day),
      总量ml: Math.round(day.totalML),
      顿数: day.count,
      每顿平均ml: day.averageML == null ? null : Math.round(day.averageML),
      "120ml及以上": day.bands.full,
      "80-119ml": day.bands.medium,
      少于80ml: day.bands.small,
      最长间隔小时: round1(day.longestGapHours),
    })),
    近3天每顿明细: analysis.days
      .filter((day) => day.day >= detailFrom)
      .map((day) => ({
        日期: dateText(day.day),
        喂奶: day.feeds.map((feed) => `${DateDisplay.clockTime(feed.startedAt)} ${feed.amountML ?? "?"}ml`).join(", "),
      })),
    今天: {
      截至现在ml: Math.round(analysis.today.totalML),
      顿数: analysis.today.count,
      近7天同一时间平均ml: analysis.today.usualByNowML == null ? null : Math.round(analysis.today.usualByNowML),
      距上一顿小时: round1(analysis.today.hoursSinceLast),
    },
    疑似重复已排除条数: analysis.duplicates.length,
  };
}
