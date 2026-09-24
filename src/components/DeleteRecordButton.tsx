import { useRef, useState } from "react";

export function DeleteRecordButton({ onDelete }: { onDelete: () => Promise<void> }) {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (error) {
      setError(error instanceof Error ? error.message : "删除失败，请重试");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  return <>
    <button
      type="button"
      className="delete-button"
      onClick={() => void handleDelete()}
      disabled={busy}
      aria-label={busy ? "删除中" : "删除"}
      aria-busy={busy}
    />
    {error && <span className="record-delete-error" role="alert">{error}</span>}
  </>;
}
