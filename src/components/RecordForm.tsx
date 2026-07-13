import { useState } from "react";
import type { RecordKind } from "../../shared/types";
import {
  WeightDisplay,
  doseText,
  format1,
  medicationDoseUnits,
  parseDose,
} from "../lib/display";
import { useData } from "../store";
import {
  AmountPicker,
  DateTimeField,
  IntervalHighlight,
  MedicationPresetGrid,
  Modal,
  MomentGrid,
  QuickAdjust,
  Segmented,
  TextField,
  feedingIntervalText,
} from "./widgets";

/** 从首页快速记录进入的单类型新建表单,对应 iOS QuickLogView(showsTypePicker: false)。 */
export function RecordFormModal({ kind, onDismiss }: { kind: RecordKind; onDismiss: () => void }) {
  switch (kind) {
    case "feeding":
      return <FeedingForm onDismiss={onDismiss} />;
    case "weight":
      return <WeightForm onDismiss={onDismiss} />;
    case "medication":
      return <MedicationForm onDismiss={onDismiss} />;
    case "checkup":
      return <CheckupForm onDismiss={onDismiss} />;
    case "fetalMovement":
      return <FetalMovementForm onDismiss={onDismiss} />;
    case "bloodGlucose":
      return <BloodGlucoseForm onDismiss={onDismiss} />;
    case "excretion":
      return <ExcretionForm onDismiss={onDismiss} />;
  }
}

function FeedingForm({ onDismiss }: { onDismiss: () => void }) {
  const { records, create } = useData();
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [endedAt, setEndedAt] = useState(() => Date.now() + 15 * 60_000);
  const latestAmount = records.feedings.find((record) => record.amountML != null)?.amountML ?? null;
  const [amountText, setAmountText] = useState(() => {
    const suggested = latestAmount != null ? Math.floor(latestAmount) : 60;
    return `${[30, 60, 90, 120, 150, 180].includes(suggested) ? suggested : 60}`;
  });
  const [note, setNote] = useState("");

  const canSave = endedAt >= startedAt && Number.isFinite(Number(amountText.trim())) && amountText.trim() !== "";
  const previousStart = records.feedings.find((record) => record.startedAt < startedAt)?.startedAt ?? null;

  return (
    <Modal
      title="喂奶记录"
      onDismiss={onDismiss}
      canSave={canSave}
      onSave={async () => {
        await create("feeding", {
          startedAt,
          endedAt,
          feedingType: "formula",
          amountML: Number(amountText.trim()),
          note,
        });
        onDismiss();
      }}
    >
      <DateTimeField label="开始时间" value={startedAt} onChange={setStartedAt} />
      <IntervalHighlight
        text={previousStart == null ? "还没有更早的喂奶记录" : feedingIntervalText(previousStart, startedAt)}
        progressMillis={previousStart == null ? 0 : Math.max(startedAt - previousStart, 0) % 60_000}
      />
      <DateTimeField label="结束时间" value={endedAt} onChange={setEndedAt} />
      <AmountPicker
        amountText={amountText}
        suggestionTitle={latestAmount != null ? `上次 ${Math.floor(latestAmount)} ml` : "默认 60 ml"}
        onChange={setAmountText}
      />
      <TextField label="备注" value={note} onChange={setNote} multiline />
    </Modal>
  );
}

function WeightForm({ onDismiss }: { onDismiss: () => void }) {
  const { records, create } = useData();
  const [recordedAt, setRecordedAt] = useState(() => Date.now());
  const latestKG = records.weights[0]?.weightKG ?? null;
  const suggestedJin = WeightDisplay.kgToJin(latestKG ?? 60);
  const [jinText, setJinText] = useState(() => format1(suggestedJin));
  const [note, setNote] = useState("");

  const jin = Number(jinText.trim());
  const canSave = jinText.trim() !== "" && Number.isFinite(jin);

  return (
    <Modal
      title="体重记录"
      onDismiss={onDismiss}
      canSave={canSave}
      onSave={async () => {
        await create("weight", { recordedAt, weightKG: WeightDisplay.jinToKG(jin), note });
        onDismiss();
      }}
    >
      <DateTimeField label="记录时间" value={recordedAt} onChange={setRecordedAt} />
      <QuickAdjust
        title="体重快捷调整"
        suggestionTitle={latestKG != null ? `上次 ${WeightDisplay.jinText(latestKG)}` : "默认 120.0 斤"}
        baseline={suggestedJin}
        currentValue={canSave ? jin : null}
        baseLimit={5}
        step={0.1}
        unitLabel="斤"
        onValueChange={(value) => setJinText(format1(value))}
      />
      <TextField label="体重（斤）" value={jinText} onChange={setJinText} inputMode="decimal" />
      <TextField label="备注" value={note} onChange={setNote} multiline />
    </Modal>
  );
}

function MedicationForm({ onDismiss }: { onDismiss: () => void }) {
  const { records, create } = useData();
  const [recordedAt, setRecordedAt] = useState(() => Date.now());
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("片");
  const [note, setNote] = useState("");

  // 与 iOS 一致:优先取同名药最近一次的剂量,否则取最近一条可解析的剂量。
  const trimmedName = name.trim();
  const sameNameDose = trimmedName
    ? (records.medications.find((record) => record.name === trimmedName)?.dosage ?? null)
    : null;
  const latestDose =
    (sameNameDose ? parseDose(sameNameDose) : null) ??
    records.medications.map((record) => parseDose(record.dosage)).find((dose) => dose != null) ??
    null;
  const suggestedDose = latestDose ?? { amount: 1, unit };
  const [amountText, setAmountText] = useState(() => format1(suggestedDose.amount));

  const amount = Number(amountText.trim());
  const canSave = trimmedName !== "" && amountText.trim() !== "" && Number.isFinite(amount);

  return (
    <Modal
      title="药物记录"
      onDismiss={onDismiss}
      canSave={canSave}
      onSave={async () => {
        await create("medication", {
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
          setUnit(preset.dosageUnit);
          setAmountText(format1(preset.dosageValue));
        }}
      />
      <TextField label="药名" value={name} onChange={setName} />
      <QuickAdjust
        title="剂量快捷调整"
        suggestionTitle={latestDose ? `上次 ${doseText(latestDose)}` : `默认 ${doseText(suggestedDose)}`}
        baseline={suggestedDose.amount}
        currentValue={Number.isFinite(amount) && amountText.trim() !== "" ? amount : null}
        baseLimit={Math.max(1, suggestedDose.amount)}
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

function CheckupForm({ onDismiss }: { onDismiss: () => void }) {
  const { create } = useData();
  const [recordedAt, setRecordedAt] = useState(() => Date.now());
  const [location, setLocation] = useState("");
  const [summary, setSummary] = useState("");
  const [attachment, setAttachment] = useState("");
  const [note, setNote] = useState("");

  const canSave = location.trim() !== "" && summary.trim() !== "";

  return (
    <Modal
      title="检查记录"
      onDismiss={onDismiss}
      canSave={canSave}
      onSave={async () => {
        await create("checkup", { recordedAt, location, summary, attachmentPath: attachment, note });
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

function FetalMovementForm({ onDismiss }: { onDismiss: () => void }) {
  const { create } = useData();
  const [recordedAt, setRecordedAt] = useState(() => Date.now());
  const [duration, setDuration] = useState("");
  const [count, setCount] = useState("");
  const [note, setNote] = useState("");

  const durationValue = Number.parseInt(duration.trim(), 10);
  const countValue = Number.parseInt(count.trim(), 10);
  const canSave = Number.isInteger(durationValue) || Number.isInteger(countValue) || note.trim() !== "";

  return (
    <Modal
      title="胎动记录"
      onDismiss={onDismiss}
      canSave={canSave}
      onSave={async () => {
        await create("fetalMovement", {
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

function BloodGlucoseForm({ onDismiss }: { onDismiss: () => void }) {
  const { records, create } = useData();
  const [recordedAt, setRecordedAt] = useState(() => Date.now());
  const [moment, setMoment] = useState("beforeBreakfast");
  const latestValue = records.bloodGlucoses[0]?.valueMMOL ?? null;
  const suggestedValue = latestValue ?? 5.5;
  const [valueText, setValueText] = useState(() => format1(suggestedValue));
  const [note, setNote] = useState("");

  const value = Number(valueText.trim());
  const canSave = valueText.trim() !== "" && Number.isFinite(value);

  return (
    <Modal
      title="血糖记录"
      onDismiss={onDismiss}
      canSave={canSave}
      onSave={async () => {
        await create("bloodGlucose", { recordedAt, moment, valueMMOL: value, note });
        onDismiss();
      }}
    >
      <DateTimeField label="记录时间" value={recordedAt} onChange={setRecordedAt} />
      <MomentGrid selected={moment} onSelect={setMoment} />
      <QuickAdjust
        title="血糖快捷调整"
        suggestionTitle={latestValue != null ? `上次 ${format1(latestValue)} mmol/L` : "默认 5.5 mmol/L"}
        baseline={suggestedValue}
        currentValue={canSave ? value : null}
        baseLimit={2}
        step={0.1}
        unitLabel="mmol/L"
        onValueChange={(next) => setValueText(format1(next))}
      />
      <TextField label="血糖（mmol/L）" value={valueText} onChange={setValueText} inputMode="decimal" />
      <TextField label="备注" value={note} onChange={setNote} multiline />
      {latestValue != null && (
        <span className="muted small">最近：{format1(latestValue)} mmol/L</span>
      )}
    </Modal>
  );
}

function ExcretionForm({ onDismiss }: { onDismiss: () => void }) {
  const { create } = useData();
  const [recordedAt, setRecordedAt] = useState(() => Date.now());
  const [typeIndex, setTypeIndex] = useState(0);
  const [amountIndex, setAmountIndex] = useState(0);
  const [note, setNote] = useState("");

  return (
    <Modal
      title="屎尿记录"
      onDismiss={onDismiss}
      onSave={async () => {
        await create("excretion", {
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

export function UnitPicker({ selected, onSelect }: { selected: string; onSelect: (unit: string) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="field-label">单位</span>
      <div className="grid-3" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        {medicationDoseUnits.map((unit) => (
          <button
            key={unit}
            type="button"
            className={`moment-button ${selected === unit ? "active" : ""}`}
            onClick={() => onSelect(unit)}
          >
            {unit}
          </button>
        ))}
      </div>
    </div>
  );
}
