import type { AllRecords } from "../../shared/types";
import {
  backupJSON,
  downloadFile,
  exportFileName,
  feedingDailyCSV,
  kindLabel,
  recordCount,
  recordsCSV,
} from "../lib/exportData";
import { recordKindMeta, recordKinds } from "../lib/timeline";
import { Icon, type IconName } from "./Icon";
import { Modal } from "./widgets";

export function ExportDataModal({ records, onDismiss }: { records: AllRecords; onDismiss: () => void }) {
  const kinds = recordKinds.filter((kind) => recordCount(records, kind) > 0);
  const total = recordKinds.reduce((sum, kind) => sum + recordCount(records, kind), 0);

  return (
    <Modal title="导出数据" onDismiss={onDismiss}>
      <p className="muted small" style={{ margin: 0 }}>
        CSV 可用 Excel、Numbers 或 WPS 直接打开；JSON 是完整备份。回收站里的记录不会导出。
      </p>
      <div className="export-list">
        {kinds.includes("feeding") && (
          <ExportRow
            icon="chart"
            tint="var(--pink)"
            title="每日喂奶汇总"
            detail="每天总量、顿数、每顿平均、最长间隔"
            onClick={() => downloadFile(exportFileName("每日喂奶汇总", "csv"), feedingDailyCSV(records), "csv")}
          />
        )}
        {kinds.map((kind) => (
          <ExportRow
            key={kind}
            icon={recordKindMeta[kind].icon}
            tint={recordKindMeta[kind].tint}
            title={kindLabel(kind)}
            detail={`${recordCount(records, kind)} 条 · CSV`}
            onClick={() => downloadFile(exportFileName(kindLabel(kind), "csv"), recordsCSV(records, kind), "csv")}
          />
        ))}
        <ExportRow
          icon="inbox"
          tint="var(--text-secondary)"
          title="全部数据备份"
          detail={`${total} 条 · JSON`}
          onClick={() => downloadFile(exportFileName("全部数据", "json"), backupJSON(records), "json")}
        />
      </div>
    </Modal>
  );
}

function ExportRow({
  icon,
  tint,
  title,
  detail,
  onClick,
}: {
  icon: IconName;
  tint: string;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="settings-navigation-row export-row" onClick={onClick}>
      <span
        className="settings-navigation-icon"
        aria-hidden="true"
        style={{ background: `color-mix(in srgb, ${tint} 14%, transparent)`, color: tint }}
      >
        <Icon name={icon} />
      </span>
      <span className="settings-navigation-copy">
        <strong>{title}</strong>
        <span className="muted small">{detail}</span>
      </span>
      <span className="settings-navigation-chevron" aria-hidden="true">
        <Icon name="download" size={20} strokeWidth={2} />
      </span>
    </button>
  );
}
