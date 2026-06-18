// @ts-check
import { test, expect } from "@playwright/test";
import { installApiMocks } from "./fixtures/mockApi.js";
import { loginAsUser, expectLoggedOut } from "./helpers/auth.js";
import {
  expectUsageBarCount,
  usageRangeButton,
  waitForDashboardReady,
  USAGE_BLOCK,
} from "./helpers/chart.js";

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
});

test.describe("smoke: login flow", () => {
  test("email + OTP login reaches dashboard", async ({ page }) => {
    await loginAsUser(page, expect);
    await waitForDashboardReady(page, expect);
  });
});

test.describe("smoke: dashboard loads", () => {
  test("dashboard shell and analytics block render", async ({ page }) => {
    await loginAsUser(page, expect);
    await waitForDashboardReady(page, expect);
    await expect(page.locator(".ud-navbar")).toBeVisible();
    await expect(page.locator(".ud-app-usage-picker-btn")).toBeEnabled();
  });
});

test.describe("smoke: usage analytics buckets", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsUser(page, expect);
    await waitForDashboardReady(page, expect);
  });

  test("24H renders 24 buckets", async ({ page }) => {
    await usageRangeButton(page, "24H").click();
    await expect(usageRangeButton(page, "24H")).toHaveClass(/ud-app-usage-range--active/);
    await expectUsageBarCount(page, expect, 24);
  });

  test("7D renders 7 buckets", async ({ page }) => {
    await usageRangeButton(page, "7D").click();
    await expect(usageRangeButton(page, "7D")).toHaveClass(/ud-app-usage-range--active/);
    await expectUsageBarCount(page, expect, 7);
  });

  test("30D renders 30 buckets", async ({ page }) => {
    await usageRangeButton(page, "30D").click();
    await expect(usageRangeButton(page, "30D")).toHaveClass(/ud-app-usage-range--active/);
    await expectUsageBarCount(page, expect, 30);
  });
});

test.describe("smoke: app switching", () => {
  test("usage app picker switches between apps", async ({ page }) => {
    await loginAsUser(page, expect);
    await waitForDashboardReady(page, expect);

    const picker = page.locator(".ud-app-usage-picker-btn");
    await expect(picker).toContainText("Alpha App");

    await picker.click();
    const listbox = page.locator(".ud-app-usage-picker-list[role='listbox']");
    await expect(listbox).toBeVisible();

    const betaOption = listbox.getByRole("option", { name: /Beta App/i });
    await betaOption.click();

    await expect(picker).toContainText("Beta App");
    await expect(listbox).toBeHidden();
    await expectUsageBarCount(page, expect, 7);
  });
});

test.describe("smoke: navigation routes", () => {
  const routes = [
    { label: "All Apps", path: "/all-apps", marker: ".all-apps-toolbar" },
    { label: "My Apps", path: "/my-apps", marker: "text=My Applications" },
    { label: "Favorites", path: "/favorites", marker: "text=Favorite Applications" },
    { label: "Activity", path: "/activity", marker: ".activity-page-root" },
    { label: "Home", path: "/dashboard", marker: ".ud-page" },
  ];

  for (const { label, path, marker } of routes) {
    test(`navbar navigates to ${label} (${path})`, async ({ page }) => {
      await loginAsUser(page, expect);
      await waitForDashboardReady(page, expect);

      await page.locator(".ud-nav-link").filter({ hasText: label }).click();
      await expect(page).toHaveURL(new RegExp(`${path.replace("/", "\\/")}$`));
      await expect(page.locator(marker).first()).toBeVisible();
    });
  }
});

test.describe("smoke: logout flow", () => {
  test("avatar menu logout clears session and returns to login", async ({ page }) => {
    await loginAsUser(page, expect);
    await waitForDashboardReady(page, expect);

    await page.locator(".ud-header-avatar").click();
    await expect(page.locator(".ud-avatar-popup")).toBeVisible();
    await page.locator(".ud-popup-logout").click();

    await expectLoggedOut(page, expect);
  });
});

test.describe("smoke: offline / network failure", () => {
  test("usage chart shows error when timeseries API fails", async ({ page }) => {
    await loginAsUser(page, expect);
    await waitForDashboardReady(page, expect);

    await page.route("**/api/v1.0/dashboard/app-usage-timeseries**", (route) =>
      route.abort("failed"),
    );
    await page.route("**/api/v1.0/dashboard/app-usage?**", (route) =>
      route.abort("failed"),
    );

    await usageRangeButton(page, "24H").click();
    await expect(page.locator(`${USAGE_BLOCK} [role="alert"]`)).toBeVisible();
    await expect(page.locator(USAGE_BLOCK)).toBeVisible();
  });

  test("dashboard stays usable when offline after initial load", async ({ page }) => {
    await loginAsUser(page, expect);
    await waitForDashboardReady(page, expect);

    await page.unroute("**/api/v1.0/**");
    await page.route("**/api/v1.0/**", (route) =>
      route.abort("internetdisconnected"),
    );
    await page.context().setOffline(true);

    await usageRangeButton(page, "24H").click();

    await expect(page.locator(".ud-page")).toBeVisible();
    await expect
      .poll(async () => {
        const alert = await page.locator(`${USAGE_BLOCK} [role="alert"]`).count();
        const retry = await page.locator(`${USAGE_BLOCK} .ud-app-usage-retry`).count();
        return alert + retry;
      })
      .toBeGreaterThan(0);
  });
});
