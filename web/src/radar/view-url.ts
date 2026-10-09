import type { Camera, Treatment } from "./model.ts";
export type ViewSettings = {
  camera: Camera;
  station: string;
  treatment: Treatment;
};
export const DEFAULT_VIEW: ViewSettings = {
  camera: { lat: 35.333, lon: -97.277, zoom: 8 },
  station: "KTLX",
  treatment: "modern",
};
export function parseViewUrl(url: URL): ViewSettings {
  const p = url.searchParams;
  const number = (key: string, min: number, max: number, fallback: number) => {
    const raw = p.get(key);
    const n = raw === null || raw.trim() === "" ? NaN : Number(raw);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  const station = p.get("station") ?? "",
    style = p.get("style");
  return {
    camera: {
      lat: number("lat", -85, 85, DEFAULT_VIEW.camera.lat),
      lon: number("lon", -180, 180, DEFAULT_VIEW.camera.lon),
      zoom: number("zoom", 3, 12, 8),
    },
    station: /^[A-Z0-9]{4}$/.test(station) ? station : "KTLX",
    treatment:
      style && ["modern", "pixels", "glyphs", "stipple"].includes(style)
        ? (style as Treatment)
        : "modern",
  };
}
export function serializeViewUrl(v: ViewSettings, url: URL) {
  const result = new URL(url.origin + url.pathname);
  result.searchParams.set("station", v.station);
  result.searchParams.set("lat", v.camera.lat.toFixed(4));
  result.searchParams.set("lon", v.camera.lon.toFixed(4));
  result.searchParams.set("zoom", v.camera.zoom.toFixed(2));
  result.searchParams.set("style", v.treatment);
  return result;
}
