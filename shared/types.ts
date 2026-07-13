// 前后端共享的记录类型定义,字段与 iOS/Android 版模型一一对应。

export type FeedingType = "formula" | "mixed";

export type BloodGlucoseMoment =
  | "beforeBreakfast"
  | "afterBreakfast"
  | "beforeLunch"
  | "afterLunch"
  | "beforeDinner"
  | "afterDinner"
  | "beforeSleep";

export type ExcretionType = "poop" | "pee";
export type ExcretionAmount = "less" | "more";

export interface FeedingRecord {
  id: number;
  startedAt: number;
  endedAt: number | null;
  formulaStartedAt: number | null;
  feedingType: FeedingType;
  amountML: number | null;
  note: string;
}

export interface WeightRecord {
  id: number;
  recordedAt: number;
  weightKG: number;
  note: string;
}

export interface MedicationRecord {
  id: number;
  recordedAt: number;
  name: string;
  dosage: string;
  note: string;
}

export interface CheckupRecord {
  id: number;
  recordedAt: number;
  location: string;
  summary: string;
  attachmentPath: string;
  note: string;
}

export interface FetalMovementRecord {
  id: number;
  recordedAt: number;
  durationMinutes: number | null;
  movementCount: number | null;
  note: string;
}

export interface BloodGlucoseRecord {
  id: number;
  recordedAt: number;
  moment: BloodGlucoseMoment;
  valueMMOL: number;
  note: string;
}

export interface ExcretionRecord {
  id: number;
  recordedAt: number;
  type: ExcretionType;
  amount: ExcretionAmount | null;
  note: string;
}

export interface AllRecords {
  feedings: FeedingRecord[];
  weights: WeightRecord[];
  medications: MedicationRecord[];
  checkups: CheckupRecord[];
  fetalMovements: FetalMovementRecord[];
  bloodGlucoses: BloodGlucoseRecord[];
  excretions: ExcretionRecord[];
}

export type RecordKind =
  | "feeding"
  | "weight"
  | "medication"
  | "checkup"
  | "fetalMovement"
  | "bloodGlucose"
  | "excretion";
