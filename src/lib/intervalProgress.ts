/** 进度条各段的粗细,与外圆角一致,让每段刚好盖住一个圆角。 */
export const INTERVAL_BAR_SIZE = 16;

/**
 * 进度环拆成 5 段沿边平移的色条:上边右半 → 右边 → 下边 → 左边 → 上边左半。
 * 每段的前沿始终垂直于边框(端口是正的),按各段长度分配时间让进度匀速前进;只动画 transform。
 */
export function intervalSweepFrames(width: number, height: number): Keyframe[][] {
  const side = Math.max(0, height - 2 * INTERVAL_BAR_SIZE);
  const segments: Array<[number, string]> = [
    [width / 2, "translateX(-100%)"],
    [side, "translateY(-100%)"],
    [width, "translateX(100%)"],
    [side, "translateY(100%)"],
    [width / 2, "translateX(-100%)"],
  ];
  const total = segments.reduce((sum, [length]) => sum + length, 0);
  if (total <= 0) return segments.map(() => []);

  let travelled = 0;
  return segments.map(([length, hidden]) => {
    const start = travelled / total;
    travelled += length;
    const end = travelled / total;
    return [
      { offset: 0, transform: hidden },
      { offset: start, transform: hidden },
      { offset: end, transform: "translate(0, 0)" },
      { offset: 1, transform: "translate(0, 0)" },
    ];
  });
}
