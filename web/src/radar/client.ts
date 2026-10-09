import { validateFrame } from "./model.ts";
import type { Catalog, RadarFrame, Station } from "./model.ts";
export class LatestRequest {
  private sequence = 0;
  begin() {
    return ++this.sequence;
  }
  current(id: number) {
    return id === this.sequence;
  }
}
export type Place = {
  name: string;
  region?: string;
  country?: string;
  lat: number;
  lon: number;
};
export function createClient(base: string) {
  const origin = base.replace(/\/$/, "");
  if (!/^https?:\/\//.test(origin))
    throw Error("Radar API must use an HTTP or HTTPS URL");
  async function json(path: string, signal?: AbortSignal) {
    const r = await fetch(origin + path, { signal, cache: "no-store" });
    if (!r.ok) {
      const details = await r.json().catch(() => null);
      throw Error(
        details?.message ??
          (r.status === 410
            ? "This scan expired. Refresh the timeline."
            : "Radar service is unavailable"),
      );
    }
    return r.json();
  }
  function normalize(f: RadarFrame) {
    const assets = (u: string) => {
      if (!u.startsWith("/v1/stations/"))
        throw Error("Invalid radar asset resource");
      return origin + u;
    };
    return validateFrame({
      ...f,
      textureUrl: assets(f.textureUrl),
      azimuthLutUrl: assets(f.azimuthLutUrl),
    });
  }
  return {
    async getStations(): Promise<Station[]> {
      return (await json("/v1/stations")).sites;
    },
    async searchPlaces(q: string, signal?: AbortSignal): Promise<Place[]> {
      return (await json("/v1/places?q=" + encodeURIComponent(q), signal))
        .results;
    },
    async getFrames(station: string, signal?: AbortSignal): Promise<Catalog> {
      const c = await json(
        "/v1/stations/" + encodeURIComponent(station) + "/frames",
        signal,
      );
      if (c.station !== station || !Array.isArray(c.frames))
        throw Error("Invalid station catalog");
      return {
        ...c,
        frames: c.frames
          .filter((f: RadarFrame) => f.status === "complete")
          .map(normalize),
      };
    },
    async getFrame(station: string, id: string, signal?: AbortSignal) {
      return normalize(
        await json(
          "/v1/stations/" +
            encodeURIComponent(station) +
            "/frames/" +
            encodeURIComponent(id),
          signal,
        ),
      );
    },
  };
}
export function nearestStation(sites: Station[], lat: number, lon: number) {
  const r = Math.PI / 180,
    a = lat * r;
  return [...sites].sort((s, t) => distance(s) - distance(t))[0];
  function distance(s: Station) {
    return (
      Math.sin(((s.lat - lat) * r) / 2) ** 2 +
      Math.cos(a) * Math.cos(s.lat * r) * Math.sin(((s.lon - lon) * r) / 2) ** 2
    );
  }
}
