# Bold and Wise Ventures UI — Technical Overview (Interview Notes)

This document explains **what the app does**, **why key patterns exist**, and **how it behaves in production-like conditions**. It is aligned with the current codebase (dashboard bundle caching, notifications, retries, and auth).

---

## 1. Project overview

### What the app does

This is a **React + Vite** single-page application for **Bold and Wise Ventures**. It provides:

- **Authentication** — login and registration flows; session token stored in `localStorage`; profile hydration from the backend.
- **User dashboard** — KPIs (apps, subscriptions, spend, KYC, referrals), transaction history with pagination, ticket summaries, and activity.
- **Notifications** — inbox list with unread count, mark read / delete / mark all read; polling to stay reasonably fresh.
- **Supporting flows** — plans, payment, profile/settings, raise ticket, admin dashboard (separate surface).

### Key features (user-visible)

- Cohesive **dashboard** with section-level loading and errors (partial failure is allowed).
- **Global notification inbox** available from layout and dashboard (single source via React context).
- **Optimistic resilience** — one automatic retry on transient failures before showing an error; “Retrying…” feedback on the second attempt.
- **Performance** — short-lived in-memory caches reduce duplicate network work when revisiting the dashboard or refreshing notifications within a TTL window.

---

## 2. Architecture decisions

### Why `NotificationInboxContext`?

Notifications are needed in **multiple places** (e.g. shell header / dashboard). Lifting state into a **context provider** avoids:

- Prop drilling.
- Duplicate `useEffect` chains that each poll the API.
- Divergent copies of “unread count” or list data.

The provider owns **list state**, **unread count**, **refresh**, **polling**, and **mutations** (mark read, delete, read all). Consumers call `useNotificationInbox()` and stay thin.

### Why dashboard caching (45s TTL)?

The user dashboard loads **several independent endpoints** (summary, transactions page, tickets, activity). Re-entering `/dashboard` or strict-mode double-mounting should not always repeat four calls.

A **small in-memory cache** (`dashboardBundleCache.js`) stores the last **successful** bundle result per session token for **45 seconds**. It:

- Speeds up repeat visits during the same session.
- Is **invalidated** on relevant mutations (profile, tickets, notifications) and on **login/logout** so data does not cross sessions or stay stale after writes.

### Why “retry once” instead of many retries?

`withRetryOnce` runs the request **twice at most**: try → on failure, optional “Retrying…” callback → second try → then surface the error.

This balances:

- **UX** — many users only need one backoff for flaky Wi‑Fi or a cold server.
- **Load** — avoids thundering herds from exponential backoff loops in the browser.
- **Predictability** — behavior is easy to reason about in interviews and in production (“one retry, then we tell the user”).

### Why pause polling when the tab is inactive?

When `document.visibilityState` is `hidden`, **notification polling** (and dashboard auto-refresh when enabled) **stops**. When the user returns, polling **resumes**.

This reduces **unnecessary API traffic** and battery use when the tab is in the background—standard practice for production web apps.

---

## 3. Performance optimizations

### Caching strategy

| Layer | Behavior |
|--------|-----------|
| Dashboard bundle | 45s TTL; invalidated on mutations and auth transitions; optional silent refetch when mounted dashboard listens for invalidation events. |
| Notification inbox | 45s TTL for `refresh()` unless `force: true`; avoids hammering list API on every dropdown open. |
| Invalidation debounce | `invalidateDashboardData()` clears cache **immediately** but **debounces** (400ms) the custom window event so burst mutations coalesce into **one** refetch wave. |

### Avoiding duplicate API calls

- **React Strict Mode** — initial dashboard load uses a **short-lived dedupe** for the parallel bundle in development so remount does not always double-fetch.
- **Request generation IDs** — transaction paging and dashboard loads use **monotonic request IDs** so late responses from an older navigation do not overwrite newer state.
- **`useCallback` / `useMemo`** — used where derived data (charts, filters, labels) would otherwise recompute every render without benefit.

### Navigation and refetch

`UserDashboard` ties its main `loadDashboardData` effect to **`loadDashboardData`’s identity**, which depends on **`token`**, not on `location.pathname`. Navigating between sidebar routes does **not** by itself re-run the full dashboard fetch—only token changes, explicit refresh, poll, or invalidation do.

---

## 4. Error handling strategy

### Section-level errors

Dashboard sections (summary, transactions, tickets, activity) use **`Promise.allSettled`** so **one failing endpoint does not blank the entire page**. Each section can show its own error message while others remain usable.

### Retry mechanism

Wrapping calls with **`withRetryOnce`**:

- Avoids showing an error on the **first** transient failure.
- Invokes **`onRetrying`** before the second attempt so the UI can show **“Retrying…”** without implying success or failure yet.

### Avoiding global error spam

Dashboard and quiet notification calls use flags such as **`suppressGlobalServerErrorToast`** so a **500** on one section does not necessarily duplicate into a **global toast**; the section still records the error for inline display.

---

## 5. Real-world readiness

### Partial failures

The UI assumes **the backend can fail independently per resource**. Summary might load while activity fails; the user still sees KPIs and can retry or navigate.

### How it scales (frontend angle)

- **Bounded retries** and **TTL caches** limit repeated work per user.
- **Visibility-aware polling** reduces concurrent load from idle tabs.
- **Debounced invalidation** prevents mutation storms from triggering many overlapping full-bundle refetches.

### Why this is production-oriented

- **Auth boundaries** — dashboard bundle cache is cleared on **login** and **logout**; pending debounced invalidation timers are **cancelled** on auth transitions to avoid stray updates.
- **Unmount safety** — notification refresh guards state updates after async work when the provider unmounts mid-flight.
- **Operational toggles** — e.g. `VITE_DASHBOARD_AUTOREFRESH` can disable periodic dashboard refresh in environments where polling is undesirable.

---

## 6. File map (quick reference)

| Area | Primary files |
|------|----------------|
| Auth | `src/context/AuthContext.jsx` |
| Notifications | `src/context/NotificationInboxContext.jsx` |
| Dashboard data | `src/pages/UserDashboard.jsx` |
| Bundle cache | `src/services/dashboardBundleCache.js` |
| Invalidation + event | `src/services/dashboardInvalidate.js` |
| Retry helper | `src/services/withRetryOnce.js` |

---

*Use this doc as a concise narrative during interviews: start with user value (dashboard + notifications), then data flow (context, cache, invalidation), then reliability (retries, partial errors, polling rules).*
