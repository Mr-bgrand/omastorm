import { test, expect } from "@playwright/test";
test("archived scan renders and both appearances work on a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?mode=archived");
  await expect(page.getByText("ARCHIVED SCAN", { exact: true })).toBeVisible();
  await expect(page.locator("canvas[data-radar]")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page.getByRole("button", { name: "Retro", exact: true }).click();
  await page.getByRole("button", { name: "Glyphs", exact: true }).click();
  await expect(page.locator("main")).toHaveAttribute(
    "data-appearance",
    "retro",
  );
  await page.screenshot({ path: "test-results/phone-retro.png" });
  await page.getByRole("button", { name: "Modern", exact: true }).click();
  await expect(page.locator("main")).toHaveAttribute(
    "data-appearance",
    "modern",
  );
  await page.screenshot({ path: "test-results/phone-modern.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("lost WebGL context reports a recoverable error", async ({ page }) => {
  await page.goto("/?mode=archived");
  const canvas = page.locator("canvas[data-radar]");
  await expect(canvas).toHaveAttribute("data-ready", "true");
  await canvas.evaluate((c: HTMLCanvasElement) =>
    c.getContext("webgl2")!.getExtension("WEBGL_lose_context")!.loseContext(),
  );
  await expect(page.getByText(/Graphics connection lost/)).toBeVisible();
});
test("GPU samples agree with golden CPU geometry in every treatment", async ({
  page,
}) => {
  const { readFileSync } = await import("node:fs");
  const { decode } = await import("fast-png");
  const { sampleAt, sampleColor } = await import("../src/radar/sampling.ts");
  const f = JSON.parse(
    readFileSync("public/fixtures/ktlx-20130520/frame.json", "utf8"),
  );
  const s = new Uint8Array(
    decode(readFileSync("public/fixtures/ktlx-20130520/sweep.png")).data,
  );
  const l = new Uint8Array(
    decode(readFileSync("public/fixtures/ktlx-20130520/lut.png")).data,
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?mode=archived&lat=35.333&lon=-97.277&zoom=8&style=pixels");
  const canvas = page.locator("canvas[data-radar]");
  await expect(canvas).toHaveAttribute("data-ready", "true");
  for (const treatment of ["pixels", "glyphs", "stipple"] as const) {
    await page
      .getByRole("button", {
        name: treatment[0].toUpperCase() + treatment.slice(1),
        exact: true,
      })
      .click();
    const samples = await canvas.evaluate((c: HTMLCanvasElement) => {
      const gl = c.getContext("webgl2")!;
      const result = [];
      for (let y = 20; y < c.height; y += 37)
        for (let x = 20; x < c.width; x += 43) {
          const rgba = new Uint8Array(4);
          gl.readPixels(
            x,
            c.height - 1 - y,
            1,
            1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            rgba,
          );
          result.push({ x, y, rgba: Array.from(rgba) });
        }
      return { w: c.clientWidth, h: c.clientHeight, result };
    });
    let measured = 0,
      matches = 0;
    for (const p of samples.result) {
      const sample = sampleAt(
        f,
        { lat: 35.333, lon: -97.277, zoom: 8 },
        samples.w,
        samples.h,
        p.x + 0.5,
        p.y + 0.5,
        s,
        l,
      );
      if (sample.kind === "measured") measured++;
      const expected = sampleColor(
        sample,
        f.palette,
        treatment,
        p.x + 0.5,
        p.y + 0.5,
      );
      if (expected.every((v, i) => Math.abs(v - p.rgba[i]) <= 2)) matches++;
    }
    expect(measured).toBeGreaterThan(10);
    expect(matches / samples.result.length).toBeGreaterThan(0.98);
  }
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(canvas).toHaveAttribute("data-ready", "true");
  await page.screenshot({ path: "test-results/desktop-retro.png" });
  await page.getByRole("button", { name: "Modern", exact: true }).click();
  await page.screenshot({ path: "test-results/desktop-modern.png" });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.screenshot({ path: "test-results/landscape-modern.png" });
});

test("source changes clear old radar while the new catalog is pending", async ({
  page,
}) => {
  await page.route("https://radar.test/**", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await page.goto("/?mode=archived");
  const canvas = page.locator("canvas[data-radar]");
  await expect(canvas).toHaveAttribute("data-ready", "true");
  const hasRadar = () =>
    canvas.evaluate((c: HTMLCanvasElement) => {
      const gl = c.getContext("webgl2")!;
      const pixels = new Uint8Array(c.width * c.height * 4);
      gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels.some((value, index) => index % 4 === 3 && value > 0);
    });
  expect(await hasRadar()).toBe(true);
  await page.getByRole("button", { name: "Live", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-ready", "false");
  await expect.poll(hasRadar).toBe(false);
});
