/**
 * Admin Apps catalog integration.
 *
 * Default: **live** — calls GET/POST/PATCH/DELETE `/admin/apps` (+ assets) when the admin session is valid.
 *
 * Set `VITE_ADMIN_APPS_DEMO_ONLY=true` to use in-memory placeholder rows only (no HTTP; local UI / design work).
 */
export const ADMIN_APPS_DEMO_ONLY = import.meta.env.VITE_ADMIN_APPS_DEMO_ONLY === "true";
