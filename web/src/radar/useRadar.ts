"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadFixture } from "./fixture.ts";
import { createClient, nearestStation } from "./client.ts";
import type { Place } from "./client.ts";
import { DEFAULT_VIEW, parseViewUrl, serializeViewUrl } from "./view-url.ts";
import { reconcilePlayback, nextFrame, playbackInterval } from "./playback.ts";
import type { PlaybackState } from "./playback.ts";
import type {
  Camera,
  Health,
  RadarFrame,
  Station,
  Treatment,
} from "./model.ts";
export function useRadar() {
  const base = process.env.NEXT_PUBLIC_RADAR_API_URL ?? "";
  const client = useMemo(() => (base ? createClient(base) : null), [base]);
  const [camera, setCamera] = useState<Camera>(DEFAULT_VIEW.camera),
    [treatment, setTreatment] = useState<Treatment>("modern"),
    [station, setStation] = useState("KTLX"),
    [source, setSource] = useState<"live" | "archived">("archived"),
    [sites, setSites] = useState<Station[]>([]),
    [places, setPlaces] = useState<Place[]>([]),
    [frames, setFrames] = useState<RadarFrame[]>([]),
    [health, setHealth] = useState<Health>("loading"),
    [playback, setPlayback] = useState<PlaybackState>({
      selected: null,
      playing: false,
    }),
    [message, setMessage] = useState(""),
    [initialized, setInitialized] = useState(false),
    [retry, setRetry] = useState(0);
  const querySequence = useRef(0);
  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    const url = new URL(location.href);
    let view = parseViewUrl(url);
    if (!url.searchParams.has("style") && !url.searchParams.has("lat"))
      try {
        const saved = localStorage.getItem("omastorm-view");
        if (saved) view = parseViewUrl(new URL(saved));
      } catch {}
    setCamera(view.camera);
    setTreatment(view.treatment);
    setStation(view.station);
    setSource(
      client && url.searchParams.get("mode") !== "archived"
        ? "live"
        : "archived",
    );
    setInitialized(true);
    fetch("/data/stations.json")
      .then((r) => r.json())
      .then((d) => setSites(d.sites))
      .catch(() => setMessage("Station list unavailable. Try reloading."));
    fetch("/data/places.json")
      .then((r) => r.json())
      .then(setPlaces)
      .catch(() => {});
  }, [client]);
  useEffect(() => {
    if (!initialized) return;
    try {
      localStorage.setItem(
        "omastorm-view",
        serializeViewUrl({ camera, station, treatment }, new URL(location.href))
          .href,
      );
    } catch {}
  }, [camera, station, treatment, initialized]);
  useEffect(() => {
    if (!initialized) return;
    let alive = true;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    setFrames([]);
    setPlayback({ selected: null, playing: false });
    setHealth("loading");
    setMessage("");
    async function refresh() {
      if (!alive) return;
      if (document.hidden) {
        timer = setTimeout(refresh, 30000);
        return;
      }
      try {
        if (source === "archived") {
          const f = await loadFixture();
          if (alive) {
            setFrames([f]);
            setPlayback({ selected: f.id, playing: false });
            setHealth("ok");
          }
          return;
        }
        if (!client)
          throw Error(
            "Live radar service is not connected. The archived scan is available.",
          );
        const c = await client.getFrames(station, abort.signal);
        if (!alive) return;
        setFrames(c.frames);
        setHealth(c.health);
        setPlayback((s) => reconcilePlayback(s, c.frames));
        setMessage("");
        failures = 0;
      } catch (e) {
        if (alive && (e as Error).name !== "AbortError") {
          setHealth("offline");
          setMessage((e as Error).message);
          failures++;
        }
      }
      if (alive)
        timer = setTimeout(
          refresh,
          Math.min(120000, 30000 * 2 ** Math.min(failures, 2)),
        );
    }
    const wake = () => {
      if (!document.hidden && source === "live") {
        clearTimeout(timer);
        void refresh();
      }
    };
    void refresh();
    document.addEventListener("visibilitychange", wake);
    return () => {
      alive = false;
      abort.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [station, source, client, initialized, retry]);
  useEffect(() => {
    if (!playback.playing || frames.length < 2) return;
    const timer = setInterval(
      () => setPlayback((s) => nextFrame(s, frames)),
      playbackInterval(frames.length),
    );
    return () => clearInterval(timer);
  }, [playback.playing, frames]);
  const frame = frames.find((f) => f.id === playback.selected) ?? null;
  const activeSite = sites.find((s) => s.id === (frame?.station ?? station));
  function choosePlace(p: Place) {
    setCamera((c) => ({ ...c, lat: p.lat, lon: p.lon }));
    const nearest = nearestStation(sites, p.lat, p.lon);
    if (nearest) setStation(nearest.id);
    if (source === "archived")
      setMessage(
        "Map moved. The displayed radar remains the archived Oklahoma City scan.",
      );
  }
  function chooseStation(s: Station) {
    setStation(s.id);
    setCamera((c) => ({ ...c, lat: s.lat, lon: s.lon }));
    if (source === "archived")
      setMessage("Map moved. Switch to Live to load this radar station.");
  }
  function locate() {
    if (!navigator.geolocation) {
      setMessage("Location is unavailable. Search a city instead.");
      return;
    }
    setMessage("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        choosePlace({
          name: "your location",
          lat: p.coords.latitude,
          lon: p.coords.longitude,
        });
        setMessage(
          source === "archived"
            ? "Location found. Archived radar remains at Oklahoma City."
            : "Location found. Radar source selected nearby.",
        );
      },
      () =>
        setMessage(
          "Location access was denied or unavailable. Search a city instead.",
        ),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }
  async function share() {
    const url = serializeViewUrl(
      { camera, station, treatment },
      new URL(location.href),
    );
    url.searchParams.set("mode", source);
    try {
      if (navigator.share)
        await navigator.share({ title: "Omastorm radar", url: url.href });
      else {
        await navigator.clipboard.writeText(url.href);
        setMessage("Radar link copied.");
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        setMessage("Could not share. Copy this link: " + url.href);
    }
  }
  const search = useCallback(
    async (q: string): Promise<(Place | Station)[]> => {
      const id = ++querySequence.current;
      const value = q.trim().toLowerCase();
      if (!value) return [];
      const localSites = sites
        .filter((s) =>
          (s.id + " " + s.name + " " + s.state).toLowerCase().includes(value),
        )
        .slice(0, 5);
      const localPlaces = places
        .filter((p) => (p.name + " " + p.region).toLowerCase().includes(value))
        .slice(0, 5);
      if (localSites.length || localPlaces.length)
        return [...localSites, ...localPlaces].slice(0, 8);
      if (client && source === "live") {
        try {
          const result = await client.searchPlaces(q);
          return id === querySequence.current ? result : [];
        } catch {
          return [];
        }
      }
      return [];
    },
    [sites, places, client, source],
  );
  return {
    camera,
    setCamera,
    treatment,
    setTreatment,
    station,
    sites,
    source,
    setSource,
    liveAvailable: !!client,
    frames,
    frame,
    health,
    activeSite,
    playback,
    setPlayback,
    message,
    setMessage,
    choosePlace,
    chooseStation,
    locate,
    share,
    search,
    refresh: () => setRetry((n) => n + 1),
  };
}
