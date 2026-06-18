/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').expect} Expect */
/** @typedef {import('@playwright/test').Locator} Locator */

export const USAGE_BLOCK = ".ud-app-usage-block";
export const USAGE_CHART = `${USAGE_BLOCK} .auc-root`;
export const USAGE_BAR = `${USAGE_CHART} .recharts-bar-rectangle`;

/**
 * @param {Page} page
 * @returns {Locator}
 */
export function usageRangeButton(page, label) {
  return page
    .locator(`${USAGE_BLOCK} .ud-app-usage-range`)
    .filter({ hasText: label });
}

/**
 * Wait until the usage chart renders the expected number of bar buckets.
 * Uses polling instead of fixed sleeps to avoid flakiness across animations.
 * @param {Page} page
 * @param {Expect} expect
 * @param {number} expectedCount
 */
export async function expectUsageBarCount(page, expect, expectedCount) {
  const chart = page.locator(USAGE_CHART);
  await expect(chart).toBeVisible();
  await expect
    .poll(
      async () => page.locator(USAGE_BAR).count(),
      { timeout: 20_000 },
    )
    .toBe(expectedCount);
}

/**
 * @param {Page} page
 * @param {Expect} expect
 */
export async function waitForDashboardReady(page, expect) {
  await expect(page.locator(".ud-page")).toBeVisible();
  await expect(page.locator(".ud-greeting h1")).toBeVisible();
  await expect(page.locator(USAGE_BLOCK)).toBeVisible();
  await expect(page.locator(".ud-app-usage-picker-btn")).toBeEnabled();
  await expectUsageBarCount(page, expect, 7);
}
