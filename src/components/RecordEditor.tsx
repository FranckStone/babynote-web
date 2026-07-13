import { useState } from "react";
import type { TimelineItem } from "../lib/timeline";
import {
  WeightDisplay,
  doseText,
  format1,
  parseDose,
} from "../lib/display";
import { useData } from "../store";
import { UnitPicker } from "./RecordForm";
import {
  DateTimeField,
  MedicationPresetGrid,
  Modal,
  MomentGrid,
  QuickAdjust,
  Segmented,
  TextField,
} from "./widgets";

/** 编辑既有记录,对应 iOS RecordEditorView。 */
export function RecordEditorModal({ item, onDismiss }: { item: TimelineItem; onDismiss: () => void }) {
  const { remove } = useData();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleDelete = () => setConfirmingDelete(true);

  const editor = (() => {
    switch (item.record.kind) {
      case "feeding":
        return <FeedingEditor item={item} onDismiss={onDismiss} onDelete={handleDelete} />;
      case "weight":
        return <WeightEditor item={item} onDismiss={onDismiss} onDelete={handleDelete} />;
      case "medication":
        return <MedicationEditor item={item} onDismiss={onDismiss} onDelete={handleDelete} />;
      case "checkup":
        return <CheckupEditor item={item} onDismiss={onDismiss} onDelete={handleDelete} />;
      case "fetalMovement":
        return <FetalMovementEditor item={item} onDismiss={onDismiss} onDelete={handleDelete} />;
      case "bloodGlucose":
        return <BloodGlucoseEditor item={item} onDismiss={onDismiss} onDelete={handleDelete} />;
      case "excretion":
        return <ExcretionEditor item={item} onDismiss={onDismiss} onDelete={handleDelete} />;
    }
  })();

  return (
    <>
      {editor}
      {confirmingDelete && (
        <Modal
          title="删除这条记录？"
          onDismiss={() => setConfirmingDelete(false)}
          onSave={async () => {
            await remove(item.kind, item.record.record.id);
            setConfirmingDelete(false);
            onDismiss();
          }}
          saveLabel="删除"
        >
          <span className="muted small">删除后无法恢复。</span>
        </Modal>
      )}
    </>
  );
}

interface EditorProps {
  item: TimelineItem;
  onDismiss: () => void;
  onDelete: () => void;
}

function FeedingEditor({ item, onDismiss, onDelete }: EditorProps) {
  const { update } = useData();
  const original = item.record.kind === "feeding" ? item.record.record : null;
  if (!original) return null;

  return <FeedingEditorInner original={original} onDismiss={onDismiss} onDelete={onDelete} update={update} />;
}

function FeedingEditorInner({
  original,
  onDismiss,
  onDelete,
  update,
}: {
  original: import("../../shared/types").FeedingRecord;
  onDismiss: () => void;
  onDelete: () => void;
  update: ReturnType<typeof useData>["update"];
}) {
  const [startedAt, setStartedAt] = useState(original.startedAt);
  const [endedAt, setEndedAt] = useState(original.endedAt ?? original.startedAt);
  const [typeIndex, setTypeIndex] = useState(original.feedingType === "mixed" ? 1 : 0);
  const [formulaStartedAt, setFormulaStartedAt] = useState(original.formulaStartedAt);
  const [amountText, setAmountText] = useState(
    original.amountML != null ? `${Math.round(original.amountML)}` : "",
  );
  const [note, setNote] = useState(original.note);

  const isMixed = typeIndex === 1;

  return (
    <Modal
      title="编辑记录"
      onDismiss={onDismiss}
      onDelete={onDelete}
      saveLabel="完成"
      onSave={async () => {
        const trimmed = amountText.trim();
        await update("feeding", original.id, {
          startedAt,
          endedAt,
          formulaStartedAt: isMixed ? formulaStartedAt : null,
          feedingType: isMixed ? "mixed" : "formula",
          amountML: trimmed === "" ? null : Number(trimmed),
          note,
        });
        onDismiss();
      }}
    >
      <DateTimeField label="开始时间" value={startedAt} onChange={setStartedAt} />
      <DateTimeField label="结束时间" value={endedAt} onChange={(value) => setEndedAt(Math.max(value, startedAt))} />
      <Segmented
        options={["奶粉", "混合"]}
        selectedIndex={typeIndex}
        onSelect={(index) => {
          setTypeIndex(index);
          if (index === 1 && formulaStartedAt == null) {
            // 默认取喂奶时段的中点作为奶粉开始时间
            const fallbackEnd = endedAt > startedAt ? endedAt : startedAt + 15 * 60_000;
            setFormulaStartedAt(startedAt + Math.max(Math.floor((fallbackEnd - startedAt) / 2), 0));
          } else if (index === 0) {
            setFormulaStartedAt(null);
          }
        }}
      />
      {isMixed && (
        <DateTimeField
          label="奶粉开始时间"
          value={formulaStartedAt ?? startedAt}
          onChange={(value) => setFormulaStartedAt(Math.min(Math.max(value, startedAt), endedAt))}
        />
      )}
      <TextField label="奶粉量（ml）" value={amountText} onChange={setAmountText} inputMode="decimal" />
      <TextField label="备注" value={note} onChange={setNote} multiline />
    </Modal>
  );
}

function WeightEditor({ item, onDismiss, onDelete }: EditorProps) {
  const { update } = useData();
  const original = item.record.kind === "weight" ? item.record.record : null;
  const [recordedAt, setRecordedAt] = useState(original?.recordedAt ?? Date.now());
  const [jinText, setJinText] = useState(() =>
    original ? format1(WeightDisplay.kgToJin(original.weightKG)) : "",
  );
  const [note, setNote] = useState(original?.note ?? "");
  if (!original) return null;

  const jin = Number(jinText.trim());
  const canSave = jinText.trim() !== "" && Number.isFinite(jin);

  return (
    <Modal
      title="编辑记录"
      onDismiss={onDismiss}
      onDelete={onDelete}
      saveLabel="完成"
      canSave={canSave}
      onSave={async () => {
        await update("weight", original.id, {
          recordedAt,
          weightKG: WeightDisplay.jinToKG(jin),
          note,
        });
        onDismiss();
      }}
    >
      <DateTimeField label="记录时间" value={recordedAt} onChange={setRecordedAt} />
      <TextField label="体重（斤）" value={jinText} onChange={setJinText} inputMode="decimal" />
      <TextField label="备注" value={note} onChange={setNote} multiline />
    </Modal>
  );
}

function MedicationEditor({ item, onDismiss, onDelete }: EditorProps) {
  const { update } = useData();
  const original = item.record.kind === "medication" ? item.record.record : null;
  const parsed = original ? (parseDose(original.dosage) ?? { amount: 1, unit: "片" }) : { amount: 1, unit: "片" };
  const [recordedAt, setRecordedAt] = useState(original?.recordedAt ?? Date.now());
  const [name, setName] = useState(original?.name ?? "");
  const [baseline, setBaseline] = useState(parsed.amount);
  const [amountText, setAmountText] = useState(format1(parsed.amount));
  const [unit, setUnit] = useState(parsed.unit);
  const [note, setNote] = useState(original?.note ?? "");
  if (!original) return null;

  const amount = Number(amountText.trim());
  const canSave = name.trim() !== "" && amountText.trim() !== "" && Number.isFinite(amount);

  return (
    <Modal
      title="编辑记录"
      onDismiss={onDismiss}
      onDelete={onDelete}
      saveLabel="完成"
      canSave={canSave}
      onSave={async () => {
        await update("medication", original.id, {
          recordedAt,
          name,
          dosage: doseText({ amount, unit }),
          note,
        });
        onDismiss();
      }}
    >
      <DateTimeField label="记录时间" value={recordedAt} onChange={setRecordedAt} />
      <MedicationPresetGrid
        selectedName={name}
        onSelect={(preset) => {
          setName(preset.name);
          setBaseline(preset.dosageValue);
          setUnit(preset.dosageUnit);
          setAmountText(format1(preset.dosageValue));
        }}
      />
      <TextField label="药名" value={name} onChange={setName} />
      <QuickAdjust
        title="剂量快捷调整"
        suggestionTitle={`当前 ${doseText({ amount: Number.isFinite(amount) ? amount : baseline, unit })}`}
        baseline={baseline}
        currentValue={canSave ? amount : null}
        baseLimit={Math.max(1, baseline)}
        step={0.5}
        unitLabel={unit}
        onValueChange={(value) => setAmountText(format1(value))}
      />
      <TextField label="剂量" value={amountText} onChange={setAmountText} inputMode="decimal" />
      <UnitPicker selected={unit} onSelect={setUnit} />
      <TextField label="备注" value={note} onChange={setNote} multiline />
    </Modal>
  );
}

function CheckupEditor({ item, onDismiss, onDelete }: EditorProps) {
  const { update } = useData();
  const original = item.record.kind === "checkup" ? item.record.record : null;
  const [recordedAt, setRecordedAt] = useState(original?.recordedAt ?? Date.now());
  const [location, setLocation] = useState(original?.location ?? "");
  const [summary, setSummary] = useState(original?.summary ?? "");
  const [attachment, setAttachment] = useState(original?.attachmentPath ?? "");
  const [note, setNote] = useState(original?.note ?? "");
  if (!original) return null;

  return (
    <Modal
      title="编辑记录"
      onDismiss={onDismiss}
      onDelete={onDelete}
      saveLabel="完成"
      onSave={async () => {
        await update("checkup", original.id, {
          recordedAt,
          location,
          summary,
          attachmentPath: attachment,
          note,
        });
        onDismiss();
      }}
    >
      <DateTimeField label="记录时间" value={recordedAt} onChange={setRecordedAt} />
      <TextField label="医院 / 机构" value={location} onChange={setLocation} />
      <TextField label="结果摘要" value={summary} onChange={setSummary} multiline />
      <TextField label="附件路径占位" value={attachment} onChange={setAttachment} />
      <TextField label="备注" value={note} onChange={setNote} multiline />
    </Modal>
  );
}

function FetalMovementEditor({ item, onDismiss, onDelete }: EditorProps) {
  const { update } = useData();
  const original = item.record.kind === "fetalMovement" ? item.record.record : null;
  const [recordedAt, setRecordedAt] = useState(original?.recordedAt ?? Date.now());
  const [duration, setDuration] = useState(original?.durationMinutes?.toString() ?? "");
  const [count, setCount] = useState(original?.movementCount?.toString() ?? "");
  const [note, setNote] = useState(original?.note ?? "");
  if (!original) return null;

  return (
    <Modal
      title="编辑记录"
      onDismiss={onDismiss}
      onDelete={onDelete}
      saveLabel="完成"
      onSave={async () => {
        const durationValue = Number.parseInt(duration.trim(), 10);
        const countValue = Number.parseInt(count.trim(), 10);
        await update("fetalMovement", original.id, {
          recordedAt,
          durationMinutes: Number.isInteger(durationValue) ? durationValue : null,
          movementCount: Number.isInteger(countValue) ? countValue : null,
          note,
        });
        onDismiss();
      }}
    >
      <DateTimeField label="记录时间" value={recordedAt} onChange={setRecordedAt} />
      <TextField label="持续时长（分钟，可选）" value={duration} onChange={setDuration} inputMode="numeric" />
      <TextField label="胎动次数（可选）" value={count} onChange={setCount} inputMode="numeric" />
      <TextField label="备注" value={note} onChange={setNote} multiline />
    </Modal>
  );
}

function BloodGlucoseEditor({ item, onDismiss, onDelete }: EditorProps) {
  const { update } = useData();
  const original = item.record.kind === "bloodGlucose" ? item.record.record : null;
  const [recordedAt, setRecordedAt] = useState(original?.recordedAt ?? Date.now());
  const [moment, setMoment] = useState<string>(original?.moment ?? "beforeBreakfast");
  const [baseline] = useState(original?.valueMMOL ?? 5.5);
  const [valueText, setValueText] = useState(() => format1(original?.valueMMOL ?? 5.5));
  const [note, setNote] = useState(original?.note ?? "");
  if (!original) return null;

  const value = Number(valueText.trim());
  const canSave = valueText.trim() !== "" && Number.isFinite(value);

  return (
    <Modal
      title="编辑记录"
      onDismiss={onDismiss}
      onDelete={onDelete}
      saveLabel="完成"
      canSave={canSave}
      onSave={async () => {
        await update("bloodGlucose", original.id, {
          recordedAt,
          moment,
          valueMMOL: value,
          note,
        });
        onDismiss();
      }}
    >
      <DateTimeField label="记录时间" value={recordedAt} onChange={setRecordedAt} />
      <MomentGrid selected={moment} onSelect={setMoment} />
      <QuickAdjust
        title="血糖快捷调整"
        suggestionTitle={`当前 ${format1(canSave ? value : baseline)} mmol/L`}
        baseline={baseline}
        currentValue={canSave ? value : null}
        baseLimit={2}
        step={0.1}
        unitLabel="mmol/L"
        onValueChange={(next) => setValueText(format1(next))}
      />
      <TextField label="血糖（mmol/L）" value={valueText} onChange={setValueText} inputMode="decimal" />
      <TextField label="备注" value={note} onChange={setNote} multiline />
    </Modal>
  );
}

function ExcretionEditor({ item, onDismiss, onDelete }: EditorProps) {
  const { update } = useData();
  const original = item.record.kind === "excretion" ? item.record.record : null;
  const [recordedAt, setRecordedAt] = useState(original?.recordedAt ?? Date.now());
  const [typeIndex, setTypeIndex] = useState(original?.type === "pee" ? 1 : 0);
  const [amountIndex, setAmountIndex] = useState(original?.amount === "less" ? 1 : original?.amount === "more" ? 2 : 0);
  const [note, setNote] = useState(original?.note ?? "");
  if (!original) return null;

  return (
    <Modal
      title="编辑记录"
      onDismiss={onDismiss}
      onDelete={onDelete}
      saveLabel="完成"
      onSave={async () => {
        await update("excretion", original.id, {
          recordedAt,
          type: typeIndex === 0 ? "poop" : "pee",
          amount: amountIndex === 1 ? "less" : amountIndex === 2 ? "more" : null,
          note,
        });
        onDismiss();
      }}
    >
      <DateTimeField label="记录时间" value={recordedAt} onChange={setRecordedAt} />
      <Segmented options={["拉屎", "撒尿"]} selectedIndex={typeIndex} onSelect={setTypeIndex} />
      <span className="field-label">量</span>
      <Segmented options={["未选择", "少", "多"]} selectedIndex={amountIndex} onSelect={setAmountIndex} />
      <TextField label="备注" value={note} onChange={setNote} multiline />
    </Modal>
  );
}
