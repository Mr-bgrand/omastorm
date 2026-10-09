import { EARTH, EFFECTIVE_EARTH } from "./model.ts";
import type { Camera, RadarFrame, Treatment } from "./model.ts";
export type Sample =
  | { kind: "outside" | "below" | "folded" | "weak" }
  | { kind: "measured"; dbz: number; band: number };
export function decodeMoment(code: number, scale: number, offset: number) {
  if (code === 0) return { kind: "below" };
  if (code === 1) return { kind: "folded" };
  return { kind: "measured", dbz: (code - offset) / scale };
}
export function mercator(lat: number, lon: number): [number, number] {
  const a =
    (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  return [
    (lon + 180) / 360,
    (1 - Math.log(Math.tan(Math.PI / 4 + a / 2)) / Math.PI) / 2,
  ];
}
export function inverseMercator(x: number, y: number): [number, number] {
  return [
    (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
    ((((x * 360) % 360) + 360) % 360) - 180,
  ];
}
export function sampleAt(
  f: RadarFrame,
  c: Camera,
  w: number,
  h: number,
  x: number,
  y: number,
  sweep: Uint8Array,
  lut: Uint8Array,
  floor = 5,
): Sample {
  const p = mercator(c.lat, c.lon),
    site = mercator(f.site.lat, f.site.lon),
    u = 1 / (256 * 2 ** c.zoom);
  const sx = Math.floor(x / 3) * 3 + 1.5,
    sy = Math.floor(y / 3) * 3 + 1.5;
  const [lat, lon] = inverseMercator(
    p[0] + (sx - w / 2) * u,
    p[1] + (sy - h / 2) * u,
  );
  const rad = Math.PI / 180;
  const a = f.site.lat * rad,
    b = lat * rad,
    dl = (lon - f.site.lon) * rad,
    da = b - a;
  const hv = Math.min(
    1,
    Math.sin(da / 2) ** 2 + Math.cos(a) * Math.cos(b) * Math.sin(dl / 2) ** 2,
  );
  const ground = 2 * EARTH * Math.atan2(Math.sqrt(hv), Math.sqrt(1 - hv));
  let az =
    Math.atan2(
      Math.sin(dl) * Math.cos(b),
      Math.sin(da) + Math.sin(a) * Math.cos(b) * 2 * Math.sin(dl / 2) ** 2,
    ) / rad;
  if (az < 0) az += 360;
  const arc = ground / EFFECTIVE_EARTH,
    e = f.elevationDeg * rad;
  if (e + arc >= Math.PI / 2) return { kind: "outside" };
  const gate =
    ((EFFECTIVE_EARTH * Math.sin(arc)) / Math.cos(e + arc) - f.firstGateM) /
    f.gateSpacingM;
  if (gate < -0.5 || gate >= f.gates - 0.5) return { kind: "outside" };
  const li = Math.min(3599, Math.floor(az * 10)) * 4,
    row = lut[li] + 256 * lut[li + 1];
  const i = (row * f.gates + Math.floor(gate + 0.5)) * 4,
    code = sweep[i + 2],
    cls = sweep[i],
    status = sweep[i + 1];
  if (code >= 2 && (code - f.offset) / f.scale < floor) return { kind: "weak" };
  if (!cls)
    return { kind: status & 1 ? "folded" : status & 2 ? "below" : "outside" };
  return { kind: "measured", dbz: (code - f.offset) / f.scale, band: cls - 1 };
}
export function sampleColor(
  s: Sample,
  palette: string[],
  t: Treatment,
  x: number,
  y: number,
): number[] {
  const px = Math.floor(x % 3),
    py = Math.floor(y % 3);
  if (s.kind === "folded")
    return [
      px === py || px + py === 2 ? 245 : 24,
      px === py || px + py === 2 ? 245 : 24,
      px === py || px + py === 2 ? 245 : 24,
      255,
    ];
  if (s.kind !== "measured") return [0, 0, 0, 0];
  const group = Math.floor((s.band * 4) / palette.length);
  let alpha = 1;
  if (t === "glyphs")
    alpha =
      [0, 7, 3, 6, 4, 8, 2, 5, 1][py * 3 + px] < [2, 4, 7, 9][group] ? 1 : 0;
  if (t === "stipple") {
    const side = [1.75, 2, 2.25, 2.5][group];
    alpha =
      Math.max(0, Math.min(1, side * 0.5 + 0.5 - Math.abs((x % 3) - 1.5))) *
      Math.max(0, Math.min(1, side * 0.5 + 0.5 - Math.abs((y % 3) - 1.5)));
  }
  const hex = palette[s.band].slice(1);
  return [0, 2, 4]
    .map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * alpha))
    .concat(Math.round(255 * alpha));
}
