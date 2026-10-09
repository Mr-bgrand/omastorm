import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test("search, share restoration and GPS denial stay usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    "/?mode=archived&style=stipple&station=KTLX&lat=35.333&lon=-97.277&zoom=8",
  );
  await expect(page.locator("main")).toHaveAttribute(
    "data-appearance",
    "retro",
  );
  await expect(
    page.getByRole("button", { name: "Stipple", exact: true }),
  ).toHaveClass(/selected/);
  await page.getByPlaceholder("City or radar station").fill("Phoenix");
  await expect(
    page.getByRole("button", { name: /Phoenix/ }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Phoenix/ })
    .first()
    .click();
  await expect(page.getByText("ARCHIVED SCAN", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "My location", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(/location|Location/);
  await expect(page.getByPlaceholder("City or radar station")).toBeVisible();
});
test("two live browsers have independent station and playback state", async ({
  browser,
}) => {
  const fixture = JSON.parse(
    readFileSync("public/fixtures/ktlx-20130520/frame.json", "utf8"),
  );
  const context = await browser.newContext();
  const methods: string[] = [];
  await context.route("https://radar.test/**", async (route) => {
    methods.push(route.request().method());
    const path = new URL(route.request().url()).pathname;
    const station = path.split("/")[3];
    if (path.endsWith("/assets/sweep"))
      return route.fulfill({
        path: "public/fixtures/ktlx-20130520/sweep.png",
        contentType: "image/png",
      });
    if (path.endsWith("/assets/azimuth-lut"))
      return route.fulfill({
        path: "public/fixtures/ktlx-20130520/lut.png",
        contentType: "image/png",
      });
    const frames = ["one", "two", "three"].map((id, i) => ({
      ...fixture,
      id: station + "-" + id,
      station,
      mode: "live",
      scanTime: new Date(Date.UTC(2026, 9, 9, 0, i * 5)).toISOString(),
      textureUrl:
        "/v1/stations/" +
        station +
        "/frames/" +
        station +
        "-" +
        id +
        "/assets/sweep",
      azimuthLutUrl:
        "/v1/stations/" +
        station +
        "/frames/" +
        station +
        "-" +
        id +
        "/assets/azimuth-lut",
    }));
    await route.fulfill({ json: { station, health: "ok", frames } });
  });
  const a = await context.newPage(),
    b = await context.newPage();
  await a.goto("/?mode=live&station=KTLX&style=pixels");
  await b.goto("/?mode=live&station=KAMX&style=modern");
  await expect(a.getByText("LIVE", { exact: true })).toBeVisible();
  await expect(a.locator("canvas[data-radar]")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(b.locator("canvas[data-radar]")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await a.getByRole("button", { name: "Glyphs", exact: true }).click();
  await a.getByRole("slider", { name: "Radar timeline" }).fill("0");
  await expect(a.locator(".frame-count")).toContainText("01 / 03");
  await expect(b.locator(".frame-count")).toContainText("03 / 03");
  await expect(b.locator("main")).toHaveAttribute("data-appearance", "modern");
  expect(methods.every((m) => m === "GET")).toBe(true);
  await context.close();
});
test("malformed sharing URLs safely load defaults", async ({ page }) => {
  await page.goto(
    "/?mode=archived&lat=999&lon=evil&zoom=Infinity&style=script",
  );
  await expect(page.locator("canvas[data-radar]")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(page.locator("main")).toHaveAttribute(
    "data-appearance",
    "modern",
  );
});
