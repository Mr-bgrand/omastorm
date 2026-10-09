"use client";
import { useEffect, useRef, useState } from "react";
import { createRenderer } from "../radar/renderer.ts";
import type { Renderer } from "../radar/renderer.ts";
import { mercator, inverseMercator } from "../radar/sampling.ts";
import type { RadarFrame, Camera, Treatment } from "../radar/model.ts";
export default function RadarCanvas({
  frame,
  camera,
  treatment,
  onCamera,
}: {
  frame: RadarFrame | null;
  camera: Camera;
  treatment: Treatment;
  onCamera: (c: Camera) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    renderer = useRef<Renderer | null>(null),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [revision, setRevision] = useState(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>()),
    previous = useRef<{ x: number; y: number; distance: number } | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  useEffect(() => {
    const c = canvas.current!;
    let r: Renderer;
    try {
      r = createRenderer(c);
      renderer.current = r;
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const lost = (e: Event) => {
      e.preventDefault();
      setReady(false);
      setError("Graphics connection lost. Reload the renderer to continue.");
    };
    const restored = () => setRevision((v) => v + 1);
    c.addEventListener("webglcontextlost", lost);
    c.addEventListener("webglcontextrestored", restored);
    const ob = new ResizeObserver(() => r.resize());
    ob.observe(c);
    return () => {
      c.removeEventListener("webglcontextlost", lost);
      c.removeEventListener("webglcontextrestored", restored);
      ob.disconnect();
      r.dispose();
      renderer.current = null;
    };
  }, [revision]);
  useEffect(() => {
    let alive = true;
    setReady(false);
    const r = renderer.current;
    if (!frame) {
      r?.clearFrame();
      setError("");
    } else if (r)
      r.setFrame(frame)
        .then(() => {
          if (alive) {
            setReady(true);
            setError("");
          }
        })
        .catch((e) => {
          if (alive && e.name !== "AbortError") setError(e.message);
        });
    return () => {
      alive = false;
      r?.clearFrame();
    };
  }, [frame, revision]);
  useEffect(() => renderer.current?.setCamera(camera), [camera, revision]);
  useEffect(
    () => renderer.current?.setTreatment(treatment),
    [treatment, revision],
  );
  function gesture() {
    const a = [...pointers.current.values()];
    if (!a.length) {
      previous.current = null;
      return;
    }
    const p = {
      x: a.reduce((s, p) => s + p.x, 0) / a.length,
      y: a.reduce((s, p) => s + p.y, 0) / a.length,
      distance:
        a.length === 2 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0,
    };
    const prev = previous.current;
    previous.current = p;
    if (!prev) return;
    const c = cameraRef.current,
      center = mercator(c.lat, c.lon),
      scale = 256 * 2 ** c.zoom;
    const [lat, lon] = inverseMercator(
      center[0] - (p.x - prev.x) / scale,
      center[1] - (p.y - prev.y) / scale,
    );
    const zoom =
      p.distance && prev.distance
        ? Math.max(
            3,
            Math.min(12, c.zoom + Math.log2(p.distance / prev.distance)),
          )
        : c.zoom;
    onCamera({ lat: Math.max(-85, Math.min(85, lat)), lon, zoom });
  }
  return (
    <>
      <canvas
        data-radar
        data-ready={ready ? "true" : "false"}
        ref={canvas}
        className="map-layer radar-layer"
        aria-label="Weather radar map. Drag to pan, pinch to zoom."
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          previous.current = null;
          gesture();
        }}
        onPointerMove={(e) => {
          if (pointers.current.has(e.pointerId)) {
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            gesture();
          }
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          previous.current = null;
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          previous.current = null;
        }}
        onWheel={(e) =>
          onCamera({
            ...camera,
            zoom: Math.max(3, Math.min(12, camera.zoom - e.deltaY * 0.002)),
          })
        }
      />
      {error && (
        <div className="map-error" role="alert">
          <strong>Radar could not draw</strong>
          <p>{error}</p>
          <button
            onClick={() => {
              setError("");
              setRevision((v) => v + 1);
            }}
          >
            Reload renderer
          </button>
        </div>
      )}
    </>
  );
}
