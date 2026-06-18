import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "./AuthContext";
import { notificationsBackend } from "../services/backendApis";
import { invalidateDashboardData } from "../services/dashboardInvalidate";
import { mapNotificationRows, parseUnreadCountPayload } from "../services/notificationUtils";
import { withRetryOnce } from "../services/withRetryOnce";
import { showError, showSuccess } from "../services/toast";

const QUIET = { suppressGlobalServerErrorToast: true };
const INBOX_CACHE_TTL_MS = 45_000;
const POLL_MS = 30_000;

const NotificationInboxContext = createContext(null);

export function NotificationInboxProvider({ children }) {
  const { token, role } = useAuth();
  const isAdminInbox = role === "ROLE_ADMIN" || role === "ROLE_OWNER";
  const mountedRef = useRef(true);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");
  const cacheRef = useRef({ at: 0, rows: null });
  const inFlightMutationRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const computeUnread = useCallback((rows) => rows.filter((r) => !r.read).length, []);

  const fetchInboxPage = useCallback(
    async (opts) => {
      if (isAdminInbox) {
        return notificationsBackend.adminList({ page: 0, size: 10, ...opts });
      }
      return notificationsBackend.list({ page: 0, size: 10, ...opts });
    },
    [isAdminInbox],
  );

  const fetchUnreadCount = useCallback(
    async (opts) => {
      if (isAdminInbox) {
        return notificationsBackend.adminUnreadCount(opts);
      }
      return notificationsBackend.unreadCount(opts);
    },
    [isAdminInbox],
  );

  const refresh = useCallback(
    async (options = {}) => {
      const { force = false, silent = false } = options;
      if (!token) {
        if (!mountedRef.current) return;
        setNotifications([]);
        setUnreadCount(0);
        setError("");
        cacheRef.current = { at: 0, rows: null };
        return;
      }

      if (inFlightMutationRef.current) {
        return;
      }

      const now = Date.now();
      if (
        !force &&
        cacheRef.current.rows &&
        now - cacheRef.current.at < INBOX_CACHE_TTL_MS
      ) {
        if (!mountedRef.current) return;
        setNotifications(cacheRef.current.rows);
        setUnreadCount(computeUnread(cacheRef.current.rows));
        setError("");
        return;
      }

      if (!silent) setLoading(true);
      setError("");
      setRetrying(false);
      try {
        const [page, countRes] = await Promise.all([
          withRetryOnce(() => fetchInboxPage(QUIET), {
            onRetrying: () => {
              if (mountedRef.current) setRetrying(true);
            },
          }),
          fetchUnreadCount(QUIET).catch(() => null),
        ]);
        if (!mountedRef.current) return;
        const rows = mapNotificationRows(page);
        cacheRef.current = { at: Date.now(), rows };
        setNotifications(rows);
        const fromServer = parseUnreadCountPayload(countRes);
        const fromRows = computeUnread(rows);
        setUnreadCount(fromServer != null ? fromServer : fromRows);
      } catch (e) {
        if (!mountedRef.current) return;
        const status = e?.status;
        const msg =
          status === 401
            ? "Notifications are unavailable right now. You remain signed in."
            : e?.message || "Could not load notifications.";
        setError(msg);
        if (!cacheRef.current.rows?.length) {
          setNotifications([]);
          setUnreadCount(0);
        }
      } finally {
        if (mountedRef.current) {
          setRetrying(false);
          setLoading(false);
        }
      }
    },
    [token, computeUnread, fetchInboxPage, fetchUnreadCount],
  );

  useEffect(() => {
    if (!token) {
      setNotifications([]);
      setUnreadCount(0);
      setError("");
      cacheRef.current = { at: 0, rows: null };
      return undefined;
    }
    cacheRef.current = { at: 0, rows: null };
    void refresh({ silent: true, force: true });
    return undefined;
  }, [token, role, refresh]);

  useEffect(() => {
    if (!token) return undefined;
    let intervalId = null;
    const tick = () => {
      if (document.visibilityState === "visible") {
        void refresh({ silent: true, force: true });
      }
    };
    const stop = () => {
      if (intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };
    const start = () => {
      stop();
      if (document.visibilityState !== "visible") return;
      intervalId = window.setInterval(tick, POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stop();
      else start();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [token, refresh]);

  const markOneRead = useCallback(
    async (id) => {
      if (id == null) return;
      let wasUnread = false;
      setNotifications((prev) => {
        wasUnread = prev.some((row) => row.id === id && !row.read);
        const next = prev.map((row) => (row.id === id ? { ...row, read: true } : row));
        cacheRef.current = { at: Date.now(), rows: next };
        return next;
      });
      if (wasUnread) setUnreadCount((c) => Math.max(0, Number(c) - 1));
      
      inFlightMutationRef.current = true;
      try {
        await notificationsBackend.markRead(id);
        invalidateDashboardData("notification-mark-read");
      } catch (e) {
        showError(e?.message || "Failed to mark as read");
        void refresh({ force: true, silent: true });
      } finally {
        inFlightMutationRef.current = false;
      }
    },
    [refresh],
  );

  const deleteOne = useCallback(
    async (id) => {
      let wasUnread = false;
      setNotifications((prev) => {
        const hit = prev.find((n) => n.id === id);
        wasUnread = Boolean(hit && !hit.read);
        const next = prev.filter((n) => n.id !== id);
        cacheRef.current = { at: Date.now(), rows: next };
        return next;
      });
      if (wasUnread) setUnreadCount((c) => Math.max(0, Number(c) - 1));
      
      inFlightMutationRef.current = true;
      try {
        await notificationsBackend.deleteById(id);
        invalidateDashboardData("notification-delete");
      } catch (err) {
        showError(err?.message || "Could not remove notification");
        void refresh({ force: true, silent: true });
      } finally {
        inFlightMutationRef.current = false;
      }
    },
    [refresh],
  );

  const markAllRead = useCallback(async () => {
    if (!notifications.some((n) => !n.read)) return;
    
    inFlightMutationRef.current = true;
    const prevNotifications = notifications;
    const prevUnreadCount = unreadCount;

    // Optimistic UI updates
    const next = notifications.map((item) => ({ ...item, read: true }));
    setNotifications(next);
    setUnreadCount(0);
    cacheRef.current = { at: Date.now(), rows: next };

    try {
      await notificationsBackend.readAll();
      invalidateDashboardData("notification-read-all");
      showSuccess("All caught up");
    } catch (e) {
      // Rollback on failure
      setNotifications(prevNotifications);
      setUnreadCount(prevUnreadCount);
      cacheRef.current = { at: Date.now(), rows: prevNotifications };
      showError(e?.message || "Could not mark all as read");
    } finally {
      inFlightMutationRef.current = false;
    }
  }, [notifications, unreadCount]);

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      loading,
      retrying,
      error,
      refresh,
      markOneRead,
      deleteOne,
      markAllRead,
    }),
    [
      notifications,
      unreadCount,
      loading,
      retrying,
      error,
      refresh,
      markOneRead,
      deleteOne,
      markAllRead,
    ],
  );

  return (
    <NotificationInboxContext.Provider value={value}>
      {children}
    </NotificationInboxContext.Provider>
  );
}

export function useNotificationInbox() {
  const ctx = useContext(NotificationInboxContext);
  if (!ctx) {
    throw new Error("useNotificationInbox must be used within NotificationInboxProvider");
  }
  return ctx;
}
