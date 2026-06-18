/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').expect} Expect */

import { E2E_EMAIL, E2E_OTP, E2E_PASSWORD } from "../fixtures/mockApi.js";

/**
 * Complete the two-step email + OTP login and land on the user dashboard.
 * @param {Page} page
 * @param {Expect} expect
 */
export async function loginAsUser(page, expect) {
  await page.goto("/login");
  await expect(page.locator("#login-email")).toBeVisible();

  await page.locator("#login-email").fill(E2E_EMAIL);
  await page.locator("#login-password").fill(E2E_PASSWORD);
  await page.locator("form.login-form .login-submit-btn").click();

  await expect(page.locator("#login-otp")).toBeVisible();
  await page.locator("#login-otp").fill(E2E_OTP);
  await page.locator("form.login-form .login-submit-btn").click();

  await expect(page).toHaveURL(/\/dashboard$/);
}

/**
 * @param {Page} page
 * @param {Expect} expect
 */
export async function expectLoggedOut(page, expect) {
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator("#login-email")).toBeVisible();
  const token = await page.evaluate(() =>
    window.localStorage.getItem("ui-access-token"),
  );
  expect(token).toBeFalsy();
}
