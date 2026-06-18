/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').Route} Route */

export const E2E_EMAIL = "e2e@test.com";
export const E2E_PASSWORD = "password123";
export const E2E_OTP = "123456";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatBackendDateTime(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;
}

function formatBackendDateOnly(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** At least one parseable point so client normalization zero-fills full buckets. */
function buildMockTimeseries(range) {
  const now = new Date();
  if (range === "24h") {
    const hour = new Date(now);
    hour.setMinutes(0, 0, 0);
    return [{ date: formatBackendDateTime(hour), opens: 4 }];
  }
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return [{ date: formatBackendDateOnly(day), opens: 3 }];
}

const MOCK_APPS = [
  {
    appId: 101,
    appName: "Alpha App",
    name: "Alpha App",
    lastOpenedAt: new Date().toISOString(),
    status: "ACTIVE",
  },
  {
    appId: 102,
    appName: "Beta App",
    name: "Beta App",
    lastOpenedAt: new Date(Date.now() - 3_600_000).toISOString(),
    status: "ACTIVE",
  },
];

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Unsigned JWT-shaped token for client-side role hydration (no signature verification). */
export function createMockJwt({
  sub = E2E_EMAIL,
  role = "ROLE_USER",
  userId = "e2e-user-1",
} = {}) {
  const header = base64UrlEncode({ alg: "HS256", typ: "JWT" });
  const payload = base64UrlEncode({
    sub,
    role,
    userId,
    exp: Math.floor(Date.now() / 1000) + 86_400,
  });
  return `${header}.${payload}.e2e-mock-signature`;
}

/**
 * @param {string} url
 * @returns {string | null}
 */
export function extractApiPath(url) {
  try {
    const pathname = new URL(url).pathname;
    const idx = pathname.indexOf("/api/v1.0");
    if (idx === -1) return null;
    const rest = pathname.slice(idx + "/api/v1.0".length);
    return rest || "/";
  } catch {
    return null;
  }
}

function jsonResponse(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

/**
 * @param {Route} route
 * @param {unknown} body
 * @param {number} [status]
 */
async function fulfillJson(route, body, status = 200) {
  await route.fulfill(jsonResponse(body, status));
}

/**
 * @param {object} [options]
 * @param {Set<string>} [options.abortPaths] API path prefixes to abort (e.g. `/dashboard/app-usage-timeseries`)
 * @param {boolean} [options.abortAll] Abort every matched API request
 */
export function createMockApiHandler(options = {}) {
  const abortPaths = options.abortPaths ?? new Set();
  const abortAll = Boolean(options.abortAll);

  return async (/** @type {Route} */ route) => {
    const apiPath = extractApiPath(route.request().url());
    if (apiPath == null) {
      await route.continue();
      return;
    }

    if (abortAll || [...abortPaths].some((p) => apiPath.startsWith(p))) {
      await route.abort("failed");
      return;
    }

    const method = route.request().method().toUpperCase();

    if (method === "POST" && apiPath === "/login") {
      await fulfillJson(route, { message: "OTP sent", success: true });
      return;
    }

    if (method === "POST" && apiPath === "/verify-otp") {
      await fulfillJson(route, {
        token: createMockJwt(),
        role: "ROLE_USER",
        userId: "e2e-user-1",
      });
      return;
    }

    if (method === "GET" && apiPath === "/profile") {
      await fulfillJson(route, {
        name: "E2E User",
        email: E2E_EMAIL,
        phoneNumber: "9999999999",
        role: "ROLE_USER",
        userId: "e2e-user-1",
      });
      return;
    }

    if (method === "GET" && apiPath === "/dashboard/summary") {
      await fulfillJson(route, {
        walletBalance: 1250.5,
        activeApps: MOCK_APPS.length,
        openTickets: 0,
        totalTransactions: 3,
      });
      return;
    }

    if (method === "GET" && apiPath.startsWith("/dashboard/transactions")) {
      await fulfillJson(route, {
        content: [
          {
            id: "txn-1",
            amount: 100,
            type: "DEBIT",
            status: "SUCCESS",
            createdAt: new Date().toISOString(),
            description: "E2E payment",
          },
        ],
        totalElements: 1,
        totalPages: 1,
        number: 0,
        last: true,
      });
      return;
    }

    if (method === "GET" && apiPath.startsWith("/dashboard/recent-apps")) {
      await fulfillJson(route, MOCK_APPS);
      return;
    }

    if (
      method === "GET" &&
      (apiPath.startsWith("/dashboard/app-usage-timeseries") ||
        apiPath.startsWith("/dashboard/app-usage"))
    ) {
      const url = new URL(route.request().url());
      const range = url.searchParams.get("range") || "7d";
      const points = buildMockTimeseries(range);
      await fulfillJson(route, {
        data: points,
        range,
        interval: range === "24h" ? "hour" : "day",
      });
      return;
    }

    if (method === "GET" && apiPath.startsWith("/tickets/my")) {
      await fulfillJson(route, { content: [], totalElements: 0 });
      return;
    }

    if (method === "GET" && apiPath.startsWith("/activity/my")) {
      await fulfillJson(route, {
        content: [
          {
            id: "act-1",
            action: "LOGIN",
            description: "Signed in",
            createdAt: new Date().toISOString(),
          },
        ],
        totalElements: 1,
      });
      return;
    }

    if (method === "GET" && apiPath.startsWith("/application/list")) {
      await fulfillJson(route, MOCK_APPS);
      return;
    }

    if (
      method === "GET" &&
      (apiPath === "/application/my" || apiPath === "/app/my")
    ) {
      await fulfillJson(route, MOCK_APPS);
      return;
    }

    if (method === "GET" && apiPath.startsWith("/favorites/my")) {
      await fulfillJson(route, []);
      return;
    }

    if (method === "GET" && apiPath.startsWith("/favorites/list")) {
      await fulfillJson(route, []);
      return;
    }

    if (method === "GET" && apiPath.startsWith("/notifications/my")) {
      await fulfillJson(route, { content: [], totalElements: 0 });
      return;
    }

    if (method === "GET" && apiPath === "/notifications/unread-count") {
      await fulfillJson(route, { count: 0, unreadCount: 0 });
      return;
    }

    await fulfillJson(route, {});
  };
}

/**
 * Intercept backend calls so smoke tests run deterministically without a live API.
 * @param {Page} page
 * @param {object} [options]
 */
export async function installApiMocks(page, options = {}) {
  const handler = createMockApiHandler(options);
  await page.route("**/api/v1.0/**", handler);
}
