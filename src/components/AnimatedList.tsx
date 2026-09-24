import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

interface Entry {
  key: string;
  child: ReactElement;
  exiting: boolean;
}

/** Keep removed rows mounted for their exit; a new list key resets date/filter changes. */
export function AnimatedList({ children, emptyState }: { children: ReactElement[]; emptyState?: ReactNode }) {
  const [state, setState] = useState(() => ({
    source: children,
    entries: children.map((child) => ({ key: String(child.key), child, exiting: false })),
  }));
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const positions = useRef(new Map<string, number>());
  const timers = useRef(new Map<string, number>());

  if (state.source !== children) {
    const entries: Entry[] = children.map((child) => ({ key: String(child.key), child, exiting: false }));
    const keys = new Set(entries.map((entry) => entry.key));
    state.entries.forEach((entry, index) => {
      if (!keys.has(entry.key)) entries.splice(index, 0, { ...entry, exiting: true });
    });
    setState({ source: children, entries });
  }

  const finishExit = (key: string) => {
    window.clearTimeout(timers.current.get(key));
    timers.current.delete(key);
    setState((current) => ({
      ...current,
      entries: current.entries.filter((entry) => entry.key !== key || !entry.exiting),
    }));
  };

  useLayoutEffect(() => {
    const nextPositions = new Map<string, number>();
    const moving: Array<{ node: HTMLDivElement; delta: number }> = [];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    state.entries.forEach((entry) => {
      const node = nodes.current.get(entry.key);
      if (!node) return;
      const top = node.offsetTop;
      nextPositions.set(entry.key, top);
      const previous = positions.current.get(entry.key);
      if (!reducedMotion && !entry.exiting && previous != null && previous !== top) {
        moving.push({ node, delta: previous - top });
      }
    });
    positions.current = nextPositions;
    moving.forEach(({ node, delta }) => {
      node.style.transition = "none";
      node.style.transform = `translateY(${delta}px)`;
    });
    if (moving.length) {
      // Flush once after all writes, then let transforms close the gaps smoothly.
      void moving[0].node.offsetHeight;
      moving.forEach(({ node }) => {
        node.style.transition = "";
        node.style.transform = "";
      });
    }
  }, [state.entries]);

  useEffect(() => {
    state.entries.forEach((entry) => {
      if (entry.exiting && !timers.current.has(entry.key)) {
        // Fallback for background tabs or browsers that omit animationend.
        timers.current.set(entry.key, window.setTimeout(() => finishExit(entry.key), 280));
      } else if (!entry.exiting && timers.current.has(entry.key)) {
        window.clearTimeout(timers.current.get(entry.key));
        timers.current.delete(entry.key);
      }
    });
  }, [state.entries]);

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  if (state.entries.length === 0) return <>{emptyState}</>;
  return <>{state.entries.map((entry) => (
    <div
      key={entry.key}
      ref={(node) => { if (node) nodes.current.set(entry.key, node); else nodes.current.delete(entry.key); }}
      className={`animated-list-item${entry.exiting ? " is-exiting" : ""}`}
      aria-hidden={entry.exiting || undefined}
      onClickCapture={(event) => {
        if (entry.exiting) { event.preventDefault(); event.stopPropagation(); }
      }}
      onFocusCapture={(event) => {
        if (entry.exiting) event.target.blur();
      }}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && event.animationName === "record-exit") finishExit(entry.key);
      }}
    >
      {entry.child}
    </div>
  ))}</>;
}
