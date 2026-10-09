"use client";
import { useEffect, useRef } from "react";
import { mercator } from "../radar/sampling.ts";
import type { Camera, RadarFrame } from "../radar/model.ts";
export default function Basemap({
  camera,
  frame,
  retro,
}: {
  camera: Camera;
  frame: RadarFrame | null;
  retro: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const lines = useRef<number[][][]>([]);
  const paintRef = useRef<() => void>(() => {});
  const places = useRef<
    { name: string; lat: number; lon: number; population: number }[]
  >([]);
  useEffect(() => {
    let alive = true;
    fetch("/data/geography.json")
      .then((r) => r.json())
      .then((g) => {
        if (alive) {
          lines.current = g;
          paintRef.current();
        }
      })
      .catch(() => {});
    fetch("/data/places.json")
      .then((r) => r.json())
      .then((p) => {
        if (alive) {
          places.current = p;
          paintRef.current();
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []); // Geography is shared immutable data.
  function paint() {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.clientWidth,
      h = canvas.clientHeight,
      dpr = Math.min(devicePixelRatio, 2);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const center = mercator(camera.lat, camera.lon),
      scale = 256 * 2 ** camera.zoom;
    const at = (lat: number, lon: number) => {
      const p = mercator(lat, lon);
      let dx = p[0] - center[0];
      dx -= Math.round(dx);
      return [w / 2 + dx * scale, h / 2 + (p[1] - center[1]) * scale];
    };
    ctx.strokeStyle = retro ? "#314643" : "#30433d";
    ctx.lineWidth = 0.8;
    for (const line of lines.current) {
      ctx.beginPath();
      let last: number[] | null = null;
      for (const p of line) {
        const q = at(p[1], p[0]);
        if (!last || Math.abs(q[0] - last[0]) > scale / 2)
          ctx.moveTo(q[0], q[1]);
        else ctx.lineTo(q[0], q[1]);
        last = q;
      }
      ctx.stroke();
    }
    const labels: { x: number; y: number }[] = [];
    ctx.font = "10px sans-serif";
    ctx.fillStyle = "#8ba498";
    for (const place of [...places.current].sort(
      (a, b) => b.population - a.population,
    )) {
      if (camera.zoom < 6 && place.population < 200000) continue;
      const [x, y] = at(place.lat, place.lon);
      if (
        x < 30 ||
        x > w - 70 ||
        y < 40 ||
        y > h - 30 ||
        labels.some((p) => Math.abs(p.x - x) < 95 && Math.abs(p.y - y) < 24)
      )
        continue;
      labels.push({ x, y });
      ctx.fillText(place.name, x + 5, y - 5);
      if (labels.length >= 14) break;
    }
    if (frame) {
      const [x, y] = at(frame.site.lat, frame.site.lon);
      ctx.strokeStyle = retro ? "#375951" : "#335348";
      ctx.setLineDash([3, 7]);
      for (const km of [100, 200, 300]) {
        const radius =
          ((km * 1000) /
            (40075016 * Math.cos((frame.site.lat * Math.PI) / 180))) *
          scale;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = "#9ab29e";
      ctx.beginPath();
      ctx.moveTo(x - 5, y);
      ctx.lineTo(x + 5, y);
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x, y + 5);
      ctx.stroke();
      ctx.fillStyle = "#b4c5b5";
      ctx.font = "10px monospace";
      ctx.fillText(frame.station, x + 10, y - 9);
    }
  }
  paintRef.current = paint;
  useEffect(() => {
    paint();
    const ob = new ResizeObserver(paint);
    if (ref.current) ob.observe(ref.current);
    return () => ob.disconnect();
  }, [camera, frame, retro]);
  return <canvas ref={ref} className="map-layer" aria-hidden="true" />;
}
