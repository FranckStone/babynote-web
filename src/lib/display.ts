// 展示格式化工具,逻辑与 iOS DateDisplay / WeightDisplay / MedicationDose 一致。

export const DateDisplay = {
  shortDate(timeMillis: number): string {
    const date = new Date(timeMillis);
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  },

  dateTime(timeMillis: number): string {
    return `${this.shortDate(timeMillis)} ${this.time(timeMillis)}`;
  },

  time(timeMillis: number): string {
    const date = new Date(timeMillis);
    const minutes = `${date.getMinutes()}`.padStart(2, "0");
    return `${this.dayPeriod(timeMillis)} ${date.getHours()}:${minutes}`;
  },

  clockTime(timeMillis: number): string {
    const date = new Date(timeMillis);
    return `${`${date.getHours()}`.padStart(2, "0")}:${`${date.getMinutes()}`.padStart(2, "0")}`;
  },

  dayPeriod(timeMillis: number): string {
    const hour = new Date(timeMillis).getHours();
    if (hour >= 7 && hour < 12) return "上午";
    if (hour >= 12 && hour < 19) return "下午";
    return "晚上";
  },

  startOfDay(timeMillis: number): number {
    const date = new Date(timeMillis);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  },

  isToday(timeMillis: number): boolean {
    return this.startOfDay(timeMillis) === this.startOfDay(Date.now());
  },

  startOfDayOffset(offsetDays: number, fromMillis = Date.now()): number {
    const date = new Date(fromMillis);
    date.setDate(date.getDate() - offsetDays);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  },

  nextDay(dayStartMillis: number): number {
    const date = new Date(dayStartMillis);
    date.setDate(date.getDate() + 1);
    return date.getTime();
  },

  durationText(seconds: number): string {
    const safe = Math.max(seconds, 0);
    const days = Math.floor(safe / 86_400);
    const hours = Math.floor((safe % 86_400) / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const remaining = Math.floor(safe % 60);

    if (days > 0) return `${days}天${hours}时${minutes}分${remaining}秒`;
    if (hours > 0) return `${hours}时${minutes}分${remaining}秒`;
    if (minutes > 0) return `${minutes}分${remaining}秒`;
    return `${remaining}秒`;
  },

  compactDurationText(seconds: number): string {
    const safe = Math.max(Math.floor(seconds), 0);
    const parts = [
      { value: Math.floor(safe / 86_400), unit: "天" },
      { value: Math.floor((safe % 86_400) / 3600), unit: "时" },
      { value: Math.floor((safe % 3600) / 60), unit: "分" },
      { value: safe % 60, unit: "秒" },
    ]
      .filter((part) => part.value > 0)
      .slice(0, 2);

    return parts.length > 0 ? parts.map((part) => `${part.value}${part.unit}`).join("") : "0秒";
  },

  delayText(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;
    if (hours > 0 && remaining > 0) return `${hours}时${remaining}分钟`;
    if (hours > 0) return `${hours}时`;
    return `${minutes}分钟`;
  },
};

export const WeightDisplay = {
  kgToJin: (kg: number) => kg * 2,
  jinToKG: (jin: number) => jin / 2,
  jinText: (kg: number) => `${(kg * 2).toFixed(1)} 斤`,
};

export function format1(value: number): string {
  return value.toFixed(1);
}

export function formatFeedingAmount(amountML: number): string {
  return Number.isInteger(amountML) ? `${amountML} ml` : `${amountML.toFixed(1)} ml`;
}

export interface MedicationDose {
  amount: number;
  unit: string;
}

export function doseText(dose: MedicationDose): string {
  const amountText = Math.abs(Math.round(dose.amount) - dose.amount) < 0.001
    ? `${Math.round(dose.amount)}`
    : dose.amount.toFixed(1);
  return `${amountText} ${dose.unit}`;
}

export function parseDose(rawValue: string): MedicationDose | null {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  const match = /([0-9]+(?:\.[0-9]+)?)\s*(.*)/.exec(trimmed);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2].trim() || "片";
  return { amount, unit };
}

export const medicationDoseUnits = ["片", "粒", "袋", "ml", "mg", "mcg", "IU", "次"];

export interface MedicationPreset {
  id: string;
  name: string;
  dosageValue: number;
  dosageUnit: string;
  detail: string;
}

export const medicationPresets: MedicationPreset[] = [
  { id: "prenatal-vitamin", name: "孕妇复合维生素", dosageValue: 1, dosageUnit: "片", detail: "常见日常补充" },
  { id: "folic-acid", name: "叶酸", dosageValue: 1, dosageUnit: "片", detail: "孕早期常见" },
  { id: "iron", name: "铁剂", dosageValue: 1, dosageUnit: "片", detail: "贫血或缺铁时常见" },
  { id: "calcium", name: "钙剂", dosageValue: 1, dosageUnit: "片", detail: "常与维生素 D 搭配" },
  { id: "vitamin-d", name: "维生素 D", dosageValue: 1, dosageUnit: "粒", detail: "孕期常见补充" },
];

export const feedingTypeNames: Record<string, string> = {
  formula: "奶粉",
  mixed: "混合",
};

export const bloodGlucoseMoments = [
  "beforeBreakfast",
  "afterBreakfast",
  "beforeLunch",
  "afterLunch",
  "beforeDinner",
  "afterDinner",
  "beforeSleep",
] as const;

export const bloodGlucoseMomentNames: Record<string, string> = {
  beforeBreakfast: "早餐前",
  afterBreakfast: "早餐后",
  beforeLunch: "午餐前",
  afterLunch: "午餐后",
  beforeDinner: "晚餐前",
  afterDinner: "晚餐后",
  beforeSleep: "睡前",
};

export const excretionTypeNames: Record<string, string> = {
  poop: "拉屎",
  pee: "撒尿",
};

export const excretionAmountNames: Record<string, string> = {
  less: "少",
  more: "多",
};

// 妊娠期糖尿病诊断阈值(75g OGTT)
export function diagnosisUpperLimit(moment: string): number | null {
  if (moment === "beforeBreakfast") return 5.1;
  if (moment === "afterBreakfast" || moment === "afterLunch" || moment === "afterDinner") return 10.0;
  return null;
}

// 日常控糖目标
export function dailyControlUpperLimit(moment: string): number {
  return moment.startsWith("after") ? 7.8 : 5.3;
}
