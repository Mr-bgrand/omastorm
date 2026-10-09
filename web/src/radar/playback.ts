import type { RadarFrame } from "./model.ts";
export type PlaybackState = {
  selected: string | null;
  playing: boolean;
  start?: string | null;
};
export function reconcilePlayback(
  s: PlaybackState,
  frames: RadarFrame[],
): PlaybackState {
  const complete = frames.filter((f) => f.status === "complete");
  if (!complete.length) return { selected: null, playing: false };
  if (s.selected && complete.some((f) => f.id === s.selected)) return s;
  return { ...s, selected: s.selected ? complete[0].id : complete.at(-1)!.id };
}
export function nextFrame(
  s: PlaybackState,
  frames: RadarFrame[],
): PlaybackState {
  const a = frames.filter((f) => f.status === "complete");
  if (!a.length) return { selected: null, playing: false };
  const i = a.findIndex((f) => f.id === s.selected),
    start = Math.max(
      0,
      a.findIndex((f) => f.id === s.start),
    );
  return { ...s, selected: a[i + 1 >= a.length ? start : i + 1].id };
}
export function playbackInterval(count: number) {
  return Math.max(250, Math.min(1000, 10000 / Math.max(1, count)));
}
