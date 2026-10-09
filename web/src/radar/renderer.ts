import { decode } from "fast-png";
import { vertex, fragment } from "./shaders.ts";
import { mercator } from "./sampling.ts";
import { validateFrame } from "./model.ts";
import type { RadarFrame, Camera, Treatment } from "./model.ts";
export type Renderer = {
  setFrame: (frame: RadarFrame) => Promise<void>;
  clearFrame: () => void;
  setCamera: (camera: Camera) => void;
  setTreatment: (t: Treatment) => void;
  resize: () => void;
  dispose: () => void;
};
export async function loadTexture(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw Error(
      response.status === 410
        ? "This scan expired. Refresh the timeline."
        : "Radar texture unavailable",
    );
  const data = await response.arrayBuffer();
  if (data.byteLength > 32 * 1024 * 1024)
    throw Error("Radar texture exceeds limit");
  const png = decode(data);
  if (png.depth !== 8 || png.channels !== 4)
    throw Error("Radar texture must contain exact RGBA channels");
  return {
    width: png.width,
    height: png.height,
    data: new Uint8Array(
      png.data.buffer,
      png.data.byteOffset,
      png.data.byteLength,
    ),
  };
}
export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const context = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (!context)
    throw Error("This device could not start WebGL2. Try another browser.");
  const gl: WebGL2RenderingContext = context;
  function compile(type: number, source: string) {
    const s = gl!.createShader(type)!;
    gl!.shaderSource(s, source);
    gl!.compileShader(s);
    if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
      const message = gl!.getShaderInfoLog(s);
      gl!.deleteShader(s);
      throw Error("Radar shader failed: " + message);
    }
    return s;
  }
  const vs = compile(gl.VERTEX_SHADER, vertex),
    fs = compile(gl.FRAGMENT_SHADER, fragment),
    program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw Error("Radar renderer could not link");
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.useProgram(program);
  const pos = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  const textures = [0, 1, 2].map(() => gl.createTexture()!);
  let frame: RadarFrame | null = null,
    camera: Camera = { lat: 35.333, lon: -97.277, zoom: 8 },
    appearance: Treatment = "modern",
    disposed = false,
    sequence = 0,
    abort: AbortController | undefined;
  const location = (n: string) => gl.getUniformLocation(program, n);
  const int = (n: string, x: number) => gl.uniform1i(location(n), x);
  const float = (n: string, x: number) => gl.uniform1f(location(n), x);
  function upload(slot: number, w: number, h: number, data: Uint8Array) {
    gl.activeTexture(gl.TEXTURE0 + slot);
    gl.bindTexture(gl.TEXTURE_2D, textures[slot]);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      w,
      h,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data,
    );
  }
  function draw() {
    if (disposed || gl.isContextLost()) return;
    gl.useProgram(program);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!frame) return;
    const w = canvas.clientWidth,
      h = canvas.clientHeight,
      p = mercator(camera.lat, camera.lon),
      site = mercator(frame.site.lat, frame.site.lon);
    let dx = p[0] - site[0];
    dx -= Math.round(dx);
    gl.uniform2f(location("viewport"), w, h);
    gl.uniform2f(location("centerOffset"), dx, p[1] - site[1]);
    float("unitsPerPixel", 1 / (256 * 2 ** camera.zoom));
    float("siteLatDeg", frame.site.lat);
    float("firstGateM", frame.firstGateM);
    float("gateSpacingM", frame.gateSpacingM);
    float("elevationDeg", frame.elevationDeg);
    float("qt_Opacity", 1);
    int("gates", frame.gates);
    int("rays", frame.textureRows);
    int("bands", frame.palette.length);
    int("weakBelow", Math.ceil(5 * frame.scale + frame.offset));
    int(
      "treatment",
      appearance === "glyphs" ? 1 : appearance === "stipple" ? 2 : 0,
    );
    int("sweep", 0);
    int("azimuthLut", 1);
    int("swatches", 2);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    draw();
  }
  function clearFrame() {
    sequence++;
    abort?.abort();
    frame = null;
    draw();
  }
  return {
    async setFrame(f) {
      clearFrame();
      validateFrame(f);
      const id = ++sequence;
      abort = new AbortController();
      const [s, l] = await Promise.all([
        loadTexture(f.textureUrl, abort.signal),
        loadTexture(f.azimuthLutUrl, abort.signal),
      ]);
      if (disposed || id !== sequence) return;
      if (
        s.width !== f.gates ||
        s.height !== f.textureRows ||
        l.width !== 3600 ||
        l.height !== 1
      )
        throw Error("Radar texture dimensions do not match this scan");
      upload(0, s.width, s.height, s.data);
      upload(1, l.width, l.height, l.data);
      const palette = new Uint8Array(
        f.palette.flatMap((c) => [
          parseInt(c.slice(1, 3), 16),
          parseInt(c.slice(3, 5), 16),
          parseInt(c.slice(5, 7), 16),
          255,
        ]),
      );
      upload(2, f.palette.length, 1, palette);
      frame = f;
      resize();
    },
    clearFrame,
    setCamera(c) {
      camera = c;
      draw();
    },
    setTreatment(t) {
      appearance = t;
      draw();
    },
    resize,
    dispose() {
      disposed = true;
      sequence++;
      abort?.abort();
      textures.forEach((t) => gl.deleteTexture(t));
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
}
