import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { FeedingDay } from "../lib/feedingAnalysis";
import { moveDayRange, type DayRange, type RangeHandle } from "../lib/feedingRange";

const dateText = (day: number) => new Date(day).toLocaleDateString("zh-CN");

export function FeedingRangeSelector({ days, range, onChange }: {
  days: FeedingDay[];
  range: DayRange;
  onChange: (range: DayRange) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    width: number;
    handle: RangeHandle;
    initial: DayRange;
    last: DayRange;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const count = days.length;
  const { start, end } = range;
  const left = start / count * 100;
  const right = (end + 1) / count * 100;
  const label = `${dateText(days[start].day)} — ${dateText(days[end].day)}`;
  const preview = useMemo(() => {
    const max = Math.max(1, ...days.map((day) => day.totalML));
    const points = days.map((day, index) => `${(index + 0.5) / days.length * 1000},${56 - day.totalML / max * 48}`);
    return `M0,56 L${points.join(" L")} L1000,56 Z`;
  }, [days]);

  const beginDrag = (event: PointerEvent<HTMLElement>, handle?: RangeHandle) => {
    if (event.button !== 0 || !event.isPrimary || count <= 1 || dragRef.current) return;
    const track = trackRef.current;
    if (!track) return;
    const bounds = track.getBoundingClientRect();
    if (bounds.width <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    let initial = range;
    if (!handle) {
      const index = Math.min(count - 1, Math.max(0, Math.floor((event.clientX - bounds.left) / bounds.width * count)));
      handle = index < start ? "start" : index > end ? "end" : "move";
      if (handle !== "move") {
        initial = moveDayRange(range, count, handle, index - range[handle]);
        onChange(initial);
      }
    }
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, width: bounds.width, handle, initial, last: initial };
    track.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const delta = Math.round((event.clientX - drag.x) / drag.width * count);
    const next = moveDayRange(drag.initial, count, drag.handle, delta);
    if (next.start !== drag.last.start || next.end !== drag.last.end) {
      drag.last = next;
      onChange(next);
    }
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, handle: RangeHandle) => {
    const deltas: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageUp: -7, PageDown: 7, Home: -count, End: count };
    if (!(event.key in deltas)) return;
    event.preventDefault();
    onChange(moveDayRange(range, count, handle, deltas[event.key]));
  };

  return (
    <section className="card feeding-range-selector" aria-label="喂奶统计时间范围">
      <div className="feeding-range-heading">
        <h2 className="card-title">时间范围</h2>
        <span className="muted small">共 {end - start + 1} 天</span>
      </div>
      <div className="feeding-range-dates">{label}</div>
      <div
        ref={trackRef}
        className={`feeding-range-track${dragging ? " is-dragging" : ""}`}
        onPointerDown={(event) => beginDrag(event)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <svg viewBox="0 0 1000 60" preserveAspectRatio="none" aria-hidden="true">
          <path d={preview} />
        </svg>
        <div className="feeding-range-shade" style={{ left: 0, width: `${left}%` }} />
        <div className="feeding-range-shade" style={{ left: `${right}%`, right: 0 }} />
        <div
          className="feeding-range-window"
          style={{ left: `${left}%`, width: `${right - left}%` }}
          role="slider"
          tabIndex={count > 1 ? 0 : -1}
          aria-label="平移所选时间范围"
          aria-valuemin={0}
          aria-valuemax={count - (end - start + 1)}
          aria-valuenow={start}
          aria-valuetext={label}
          onKeyDown={(event) => onKeyDown(event, "move")}
        />
        <button
          type="button"
          role="slider"
          className="feeding-range-handle start"
          style={{ left: `${left}%` }}
          aria-label="起始日期"
          aria-valuemin={0}
          aria-valuemax={end}
          aria-valuenow={start}
          aria-valuetext={dateText(days[start].day)}
          disabled={count <= 1}
          onPointerDown={(event) => beginDrag(event, "start")}
          onKeyDown={(event) => onKeyDown(event, "start")}
        ><span aria-hidden="true" /></button>
        <button
          type="button"
          role="slider"
          className="feeding-range-handle end"
          style={{ left: `${right}%` }}
          aria-label="结束日期"
          aria-valuemin={start}
          aria-valuemax={count - 1}
          aria-valuenow={end}
          aria-valuetext={dateText(days[end].day)}
          disabled={count <= 1}
          onPointerDown={(event) => beginDrag(event, "end")}
          onKeyDown={(event) => onKeyDown(event, "end")}
        ><span aria-hidden="true" /></button>
      </div>
      <div className="feeding-range-axis muted small">
        <span>{dateText(days[0].day)}</span>
        <span>{dateText(days[count - 1].day)}</span>
      </div>
      <p className="muted small feeding-range-hint">拖动两端调整日期，拖动中间平移时段</p>
    </section>
  );
}
