import type {
  AllRecords,
  BloodGlucoseRecord,
  CheckupRecord,
  ExcretionRecord,
  FeedingRecord,
  FetalMovementRecord,
  MedicationRecord,
  RecordKind,
  WeightRecord,
} from "../../shared/types";
import {
  WeightDisplay,
  bloodGlucoseMomentNames,
  excretionTypeNames,
  excretionAmountNames,
  feedingTypeNames,
  format1,
} from "./display";
import type { IconName } from "../components/Icon";

export type TimelineRecord =
  | { kind: "feeding"; record: FeedingRecord }
  | { kind: "weight"; record: WeightRecord }
  | { kind: "medication"; record: MedicationRecord }
  | { kind: "checkup"; record: CheckupRecord }
  | { kind: "fetalMovement"; record: FetalMovementRecord }
  | { kind: "bloodGlucose"; record: BloodGlucoseRecord }
  | { kind: "excretion"; record: ExcretionRecord };

export interface TimelineItem {
  id: string;
  recordedAt: number;
  kind: RecordKind;
  title: string;
  detail: string;
  note: string;
  record: TimelineRecord;
}

export const recordKindMeta: Record<RecordKind, { name: string; icon: IconName; tint: string }> = {
  feeding: { name: "喂奶", icon: "bottle", tint: "#e91e63" },
  weight: { name: "体重", icon: "weight", tint: "#f57c00" },
  medication: { name: "药物", icon: "pill", tint: "#1e88e5" },
  checkup: { name: "检查", icon: "stethoscope", tint: "#43a047" },
  fetalMovement: { name: "胎动", icon: "baby", tint: "#26a69a" },
  bloodGlucose: { name: "血糖", icon: "bloodDrop", tint: "#e53935" },
  excretion: { name: "屎尿", icon: "poop", tint: "#8d6e63" },
};

export const recordKinds: RecordKind[] = [
  "feeding",
  "excretion",
  "weight",
  "medication",
  "checkup",
  "fetalMovement",
  "bloodGlucose",
];

export function feedingDurationMinutes(record: FeedingRecord): number | null {
  if (record.endedAt == null) return null;
  return Math.max(Math.floor((record.endedAt - record.startedAt) / 60_000), 0);
}

export function breastDurationMinutes(record: FeedingRecord): number | null {
  if (record.feedingType !== "mixed" || record.formulaStartedAt == null) return null;
  return Math.max(Math.floor((record.formulaStartedAt - record.startedAt) / 60_000), 0);
}

export function formulaDurationMinutes(record: FeedingRecord): number | null {
  if (record.endedAt == null) return null;
  const formulaStart =
    record.feedingType === "mixed" ? (record.formulaStartedAt ?? record.startedAt) : record.startedAt;
  return Math.max(Math.floor((record.endedAt - formulaStart) / 60_000), 0);
}

function feedingDetail(record: FeedingRecord): string {
  const parts: string[] = [];
  if (record.amountML != null) parts.push(`${Math.floor(record.amountML)} ml`);
  if (record.feedingType === "mixed") {
    const breast = breastDurationMinutes(record);
    if (breast != null) parts.push(`母乳 ${breast} 分钟`);
    const formula = formulaDurationMinutes(record);
    if (formula != null) parts.push(`奶粉 ${formula} 分钟`);
  } else {
    const duration = feedingDurationMinutes(record);
    if (duration != null) parts.push(`${duration} 分钟`);
  }
  return parts.length > 0 ? parts.join(" · ") : "未填写时长或奶量";
}

function fetalMovementDetail(record: FetalMovementRecord): string {
  const parts: string[] = [];
  if (record.movementCount != null) parts.push(`${record.movementCount} 次`);
  if (record.durationMinutes != null) parts.push(`${record.durationMinutes} 分钟`);
  return parts.length > 0 ? parts.join(" · ") : "未填写次数或时长";
}

function makeItems(records: AllRecords): TimelineItem[][] {
  return [
    records.feedings.map((record): TimelineItem => ({
      id: `feeding-${record.id}`,
      recordedAt: record.startedAt,
      kind: "feeding",
      title: feedingTypeNames[record.feedingType] ?? "喂奶",
      detail: feedingDetail(record),
      note: record.note,
      record: { kind: "feeding", record },
    })),
    records.weights.map((record): TimelineItem => ({
      id: `weight-${record.id}`,
      recordedAt: record.recordedAt,
      kind: "weight",
      title: "体重记录",
      detail: WeightDisplay.jinText(record.weightKG),
      note: record.note,
      record: { kind: "weight", record },
    })),
    records.medications.map((record): TimelineItem => ({
      id: `medication-${record.id}`,
      recordedAt: record.recordedAt,
      kind: "medication",
      title: record.name,
      detail: record.dosage,
      note: record.note,
      record: { kind: "medication", record },
    })),
    records.checkups.map((record): TimelineItem => ({
      id: `checkup-${record.id}`,
      recordedAt: record.recordedAt,
      kind: "checkup",
      title: record.location,
      detail: record.summary,
      note: record.note,
      record: { kind: "checkup", record },
    })),
    records.fetalMovements.map((record): TimelineItem => ({
      id: `fetalMovement-${record.id}`,
      recordedAt: record.recordedAt,
      kind: "fetalMovement",
      title: "胎动记录",
      detail: fetalMovementDetail(record),
      note: record.note,
      record: { kind: "fetalMovement", record },
    })),
    records.bloodGlucoses.map((record): TimelineItem => ({
      id: `bloodGlucose-${record.id}`,
      recordedAt: record.recordedAt,
      kind: "bloodGlucose",
      title: "血糖监测",
      detail: `${bloodGlucoseMomentNames[record.moment]} · ${format1(record.valueMMOL)} mmol/L`,
      note: record.note,
      record: { kind: "bloodGlucose", record },
    })),
    records.excretions.map((record): TimelineItem => ({
      id: `excretion-${record.id}`,
      recordedAt: record.recordedAt,
      kind: "excretion",
      title: excretionTypeNames[record.type] ?? "屎尿",
      detail: record.amount ? `量：${excretionAmountNames[record.amount]}` : "屎尿记录",
      note: record.note,
      record: { kind: "excretion", record },
    })),
  ];
}

export function buildTimeline(records: AllRecords): TimelineItem[] {
  return makeItems(records)
    .flat()
    .sort((a, b) => b.recordedAt - a.recordedAt);
}

export function buildRecentTimeline(records: AllRecords, limit: number): TimelineItem[] {
  if (limit <= 0) return [];

  // 每组已按时间倒序,归并取最新 limit 条。
  const groups = makeItems(records);
  const indices = groups.map(() => 0);
  const recent: TimelineItem[] = [];

  while (recent.length < limit) {
    let nextGroupIndex = -1;
    let nextDate = Number.MIN_SAFE_INTEGER;

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const itemIndex = indices[groupIndex];
      if (itemIndex >= groups[groupIndex].length) continue;
      const candidateDate = groups[groupIndex][itemIndex].recordedAt;
      if (nextGroupIndex === -1 || candidateDate > nextDate) {
        nextGroupIndex = groupIndex;
        nextDate = candidateDate;
      }
    }

    if (nextGroupIndex === -1) break;
    recent.push(groups[nextGroupIndex][indices[nextGroupIndex]]);
    indices[nextGroupIndex] += 1;
  }

  return recent;
}
