"use client";
import { useRadar } from "../radar/useRadar.ts";
import type { Treatment } from "../radar/model.ts";
import RadarCanvas from "./RadarCanvas.tsx";
import Basemap from "./Basemap.tsx";
import RadarControls from "./RadarControls.tsx";
import Icon from "./Icon.tsx";
export default function RadarViewer() {
  const r = useRadar(),
    retro = r.treatment !== "modern",
    frame = r.frame,
    index = Math.max(
      0,
      r.frames.findIndex((f) => f.id === r.playback.selected),
    );
  const setAppearance = (appearance: "modern" | "retro") =>
    r.setTreatment(appearance === "modern" ? "modern" : "glyphs");
  const status =
    r.source === "archived"
      ? "ARCHIVED SCAN"
      : r.health === "ok"
        ? "LIVE"
        : r.health.toUpperCase();
  const stamp = frame
    ? new Date(frame.scanTime).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : "Waiting for observations…";
  return (
    <main data-appearance={retro ? "retro" : "modern"}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Omastorm home">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <circle cx="16" cy="16" r="12" />
            <circle cx="16" cy="16" r="6" />
            <path d="M16 3v13l9 9M3 16h8" />
          </svg>
          <span>
            omastorm<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="appearance-switch" aria-label="Appearance">
          <button
            className={!retro ? "selected" : ""}
            onClick={() => setAppearance("modern")}
          >
            Modern
          </button>
          <button
            className={retro ? "selected" : ""}
            onClick={() => setAppearance("retro")}
          >
            Retro
          </button>
        </div>
        <span className="edition">WEB / 001</span>
      </header>
      <section className="viewer">
        <div className="summary">
          <div>
            <span className="eyebrow">A DIFFERENT WAY TO SEE THE WEATHER</span>
            <h1>
              Follow the storm<span>.</span>
            </h1>
            <p className="station-name">
              {r.activeSite?.name ?? "Oklahoma City"}{" "}
              <span> / {frame?.station ?? r.station}</span>
            </p>
          </div>
          <div className="feed-status">
            <span
              className={
                "status-pill " + (status === "LIVE" ? "live" : "archived")
              }
            >
              {status}
            </span>
            <span>NOAA NEXRAD · Reflectivity</span>
            <small>
              {r.source === "archived"
                ? "Golden reference · May 20, 2013 UTC"
                : frame
                  ? "Observed " + stamp
                  : "Connecting to the selected radar"}
            </small>
          </div>
        </div>
        <RadarControls
          search={r.search}
          choosePlace={r.choosePlace}
          chooseStation={r.chooseStation}
          locate={r.locate}
          share={r.share}
        />
        <div className="source-row">
          <div className="source-switch">
            <button
              className={r.source === "live" ? "selected" : ""}
              disabled={!r.liveAvailable}
              onClick={() => r.setSource("live")}
            >
              Live
            </button>
            <button
              className={r.source === "archived" ? "selected" : ""}
              onClick={() => r.setSource("archived")}
            >
              Archived example
            </button>
          </div>
          <span>
            {!r.liveAvailable
              ? "Live radar service not connected"
              : "Your view and playback stay independent"}
          </span>
        </div>
        <div className="map-stage">
          <Basemap camera={r.camera} frame={frame} retro={retro} />
          <RadarCanvas
            frame={frame}
            camera={r.camera}
            treatment={r.treatment}
            onCamera={r.setCamera}
          />
          <div className="map-top">
            <span className="map-badge">
              {retro
                ? "RETRO / " + r.treatment.toUpperCase()
                : "RADAR / REFLECTIVITY"}
            </span>
            <span className="map-badge">
              {frame ? frame.elevationDeg.toFixed(1) : "—"}° TILT
            </span>
          </div>
          <div className="zoom-controls">
            <button
              aria-label="Zoom in"
              onClick={() =>
                r.setCamera((c) => ({ ...c, zoom: Math.min(12, c.zoom + 0.5) }))
              }
            >
              +
            </button>
            <button
              aria-label="Zoom out"
              onClick={() =>
                r.setCamera((c) => ({ ...c, zoom: Math.max(3, c.zoom - 0.5) }))
              }
            >
              −
            </button>
            <button
              aria-label="Center radar"
              onClick={() =>
                r.setCamera((c) => ({
                  ...c,
                  lat: frame?.site.lat ?? 35.333,
                  lon: frame?.site.lon ?? -97.277,
                }))
              }
            >
              <Icon name="center" />
            </button>
          </div>
          <div className="map-bottom">
            <span>DRAG TO EXPLORE · PINCH TO ZOOM</span>
            <span>Natural Earth · NOAA</span>
          </div>
          {!frame && (
            <div className="map-loading">
              {r.health === "offline"
                ? "Radar unavailable. Try refreshing."
                : r.frames.length
                  ? "Loading scan…"
                  : "Waiting for a completed scan…"}
            </div>
          )}
        </div>
        <div className="below-map">
          <div className="legend">
            <div className="legend-title">
              <span>REFLECTIVITY</span>
              <span>dBZ · below 5 hidden</span>
            </div>
            <div className="legend-colors">
              {(frame?.palette ?? []).map((c) => (
                <i key={c} style={{ background: c }} />
              ))}
            </div>
            <div className="legend-labels">
              <span>&lt;0</span>
              <span>20</span>
              <span>40</span>
              <span>55</span>
              <span>70+</span>
            </div>
          </div>
          <div className="treatments">
            {retro ? (
              (["pixels", "glyphs", "stipple"] as Treatment[]).map((t) => (
                <button
                  key={t}
                  className={r.treatment === t ? "selected" : ""}
                  onClick={() => r.setTreatment(t)}
                >
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))
            ) : (
              <span className="quiet">
                Same observations. A fresh perspective.
              </span>
            )}
          </div>
        </div>
        <div className="timeline-panel">
          <button
            className="play-button"
            aria-label={
              r.playback.playing ? "Pause animation" : "Play animation"
            }
            disabled={r.frames.length < 2}
            onClick={() =>
              r.setPlayback((s) => ({
                ...s,
                playing: !s.playing,
                start:
                  s.selected === r.frames.at(-1)?.id
                    ? r.frames[0]?.id
                    : s.selected,
              }))
            }
          >
            <Icon name={r.playback.playing ? "pause" : "play"} />
          </button>
          <div className="observation">
            <span className="timeline-label">OBSERVATION</span>
            <time>{stamp}</time>
          </div>
          <span className="frame-count">
            {r.frames.length ? String(index + 1).padStart(2, "0") : "00"} /{" "}
            {String(r.frames.length).padStart(2, "0")}
          </span>
          <input
            className="timeline-slider"
            type="range"
            aria-label="Radar timeline"
            min="0"
            max={Math.max(0, r.frames.length - 1)}
            value={index}
            disabled={r.frames.length < 2}
            onChange={(e) =>
              r.setPlayback({
                selected: r.frames[Number(e.target.value)]?.id ?? null,
                playing: false,
              })
            }
          />
          <p>
            {r.source === "archived"
              ? "A real archived scan, not current weather."
              : "Completed radar observations. Each frame shows its actual scan time."}
          </p>
        </div>
        {r.message && (
          <div className="message" role="status">
            {r.message}
            {r.health === "offline" && r.source === "live" && (
              <button onClick={r.refresh}>Retry radar</button>
            )}
          </div>
        )}
        <footer>
          <span>
            Weather, with a little character.
            <br />
            <small>NOAA · Natural Earth · GeoNames CC BY 4.0</small>
          </span>
          <a
            href="https://github.com/wesleygrimes/omastorm"
            target="_blank"
            rel="noreferrer"
          >
            Built on Omastorm ↗<br />
            <small>MIT license & credits</small>
          </a>
        </footer>
      </section>
    </main>
  );
}
