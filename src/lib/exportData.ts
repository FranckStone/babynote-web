// 数据导出：CSV 带 UTF-8 BOM,Excel / Numbers 直接打开不乱码;JSON 为完整备份。

import type { AllRecords, RecordKind } from "../../shared/types";
import { bloodGlucoseMomentNames, excretionAmountNames, excretionTypeNames, feedingTypeNames } from "./display";
import { analyzeFeedings } from "./feedingAnalysis";
import { breastDurationMinutes, feedingDurationMinutes, formulaDurationMinutes, recordKindMeta } from "./timeline";

type Cell = string | number | null | undefined;

function pad(value: number) {
  return `${value}`.padStart(2, "0");
}

function dateTimeText(timeMillis: number | null) {
  if (timeMillis == null) return "";
  const date = new Date(timeMillis);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dateText(timeMillis: number) {
  return dateTimeText(timeMillis).slice(0, 10);
}

function escapeCell(value: Cell): string {
  if (value == null) return "";
  let text = `${value}`;
  // 防止以 = + - @ 开头的备注在表格软件里被当成公式执行。
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCSV(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n");
}

/** 各类记录导出为 CSV,按时间从早到晚排列。 */
export function recordsCSV(records: AllRecords, kind: RecordKind): string {
  switch (kind) {
    case "feeding":
      return toCSV(
        ["开始时间", "类型", "奶量(ml)", "结束时间", "时长(分钟)", "母乳(分钟)", "奶粉(分钟)", "备注"],
        [...records.feedings]
          .sort((a, b) => a.startedAt - b.startedAt)
          .map((record) => [
            dateTimeText(record.startedAt),
            feedingTypeNames[record.feedingType] ?? record.feedingType,
            record.amountML,
            dateTimeText(record.endedAt),
            feedingDurationMinutes(record),
            record.feedingType === "mixed" ? breastDurationMinutes(record) : null,
            record.feedingType === "mixed" ? formulaDurationMinutes(record) : null,
            record.note,
          ]),
      );
    case "excretion":
      return toCSV(
        ["时间", "类型", "量", "备注"],
        [...records.excretions]
          .sort((a, b) => a.recordedAt - b.recordedAt)
          .map((record) => [
            dateTimeText(record.recordedAt),
            excretionTypeNames[record.type] ?? record.type,
            record.amount ? excretionAmountNames[record.amount] : "",
            record.note,
          ]),
      );
    case "weight":
      return toCSV(
        ["时间", "体重(kg)", "体重(斤)", "备注"],
        [...records.weights]
          .sort((a, b) => a.recordedAt - b.recordedAt)
          .map((record) => [dateTimeText(record.recordedAt), record.weightKG, Math.round(record.weightKG * 20) / 10, record.note]),
      );
    case "medication":
      return toCSV(
        ["时间", "药名", "剂量", "备注"],
        [...records.medications]
          .sort((a, b) => a.recordedAt - b.recordedAt)
          .map((record) => [dateTimeText(record.recordedAt), record.name, record.dosage, record.note]),
      );
    case "checkup":
      return toCSV(
        ["时间", "地点", "结果摘要", "备注"],
        [...records.checkups]
          .sort((a, b) => a.recordedAt - b.recordedAt)
          .map((record) => [dateTimeText(record.recordedAt), record.location, record.summary, record.note]),
      );
    case "fetalMovement":
      return toCSV(
        ["时间", "时长(分钟)", "胎动次数", "备注"],
        [...records.fetalMovements]
          .sort((a, b) => a.recordedAt - b.recordedAt)
          .map((record) => [dateTimeText(record.recordedAt), record.durationMinutes, record.movementCount, record.note]),
      );
    case "bloodGlucose":
      return toCSV(
        ["时间", "时段", "血糖(mmol/L)", "备注"],
        [...records.bloodGlucoses]
          .sort((a, b) => a.recordedAt - b.recordedAt)
          .map((record) => [
            dateTimeText(record.recordedAt),
            bloodGlucoseMomentNames[record.moment] ?? record.moment,
            record.valueMMOL,
            record.note,
          ]),
      );
  }
}

/** 每日喂奶汇总，与统计页的口径一致(已排除 3 分钟内的疑似重复记录)。 */
export function feedingDailyCSV(records: AllRecords): string {
  const { days } = analyzeFeedings(records.feedings, records.weights);
  return toCSV(
    ["日期", "总奶量(ml)", "顿数", "每顿平均(ml)", "120ml及以上(顿)", "80-119ml(顿)", "少于80ml(顿)", "最长间隔(小时)", "近7天日均(ml)", "说明"],
    days.map((day) => [
      dateText(day.day),
      Math.round(day.totalML),
      day.count,
      day.averageML == null ? null : Math.round(day.averageML),
      day.bands.full,
      day.bands.medium,
      day.bands.small,
      day.longestGapHours == null ? null : Math.round(day.longestGapHours * 10) / 10,
      day.rollingAverageML == null ? null : Math.round(day.rollingAverageML),
      day.isToday ? "今天，尚未结束" : "",
    ]),
  );
}

export function backupJSON(records: AllRecords): string {
  return JSON.stringify({ app: "babynote", exportedAt: new Date().toISOString(), records }, null, 2);
}

export function recordCount(records: AllRecords, kind: RecordKind): number {
  const lists: Record<RecordKind, unknown[]> = {
    feeding: records.feedings,
    excretion: records.excretions,
    weight: records.weights,
    medication: records.medications,
    checkup: records.checkups,
    fetalMovement: records.fetalMovements,
    bloodGlucose: records.bloodGlucoses,
  };
  return lists[kind].length;
}

export function exportFileName(label: string, extension: "csv" | "json") {
  return `宝宝笔记-${label}-${dateText(Date.now())}.${extension}`;
}

export function kindLabel(kind: RecordKind) {
  return `${recordKindMeta[kind].name}记录`;
}

export function downloadFile(fileName: string, content: string, type: "csv" | "json") {
  const blob =
    type === "csv"
      ? new Blob(["﻿", content], { type: "text/csv;charset=utf-8" })
      : new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Safari 需要在点击后保留一会儿 URL 才能开始下载。
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
