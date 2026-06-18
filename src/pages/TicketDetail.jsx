import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageError, PageLoading } from "../components/PageStates";
import { ticketsBackend } from "../services/backendApis";
import { showError, showSuccess } from "../services/toast";
import { getTicketStatusLabel, normalizeTicketStatus } from "../utils/ticketStatus";
import TicketConversation from "../components/TicketConversation";
import {
  mergeMessages,
  normalizeTicketResponse,
  normalizeTicketThread,
} from "../utils/ticketConversation";

// Active conversation should feel live (poll only while visible).
const TICKET_DETAIL_POLL_MS = 10_000;

function safeStr(v) {
  const s = String(v ?? "").trim();
  return s && s !== "null" ? s : "";
}

export default function TicketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [ticket, setTicket] = useState(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const inFlightRef = useRef({ seq: 0 });
  const activeFetchCountRef = useRef(0);
  const mountedRef = useRef(true);
  const [messages, setMessages] = useState([]);
  const resyncRef = useRef({ active: false, seq: 0 });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/tickets");
    }
  };

  const load = async ({ initial = false, poll = false } = {}) => {
    if (poll && activeFetchCountRef.current > 0) return;
    const requestSeq = (inFlightRef.current.seq += 1);
    activeFetchCountRef.current += 1;
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const raw = await ticketsBackend.getById(id);
      if (!mountedRef.current || requestSeq !== inFlightRef.current.seq) return;

      const normalized = normalizeTicketResponse(raw);
      const thread = normalizeTicketThread(normalized.threadSource);

      setTicket(normalized.ticket || null);
      setMessages((prev) =>
        mergeMessages(initial ? [] : prev, thread, {
          ticketId: id,
          surface: "user-detail",
          reason: initial ? "load-initial" : "load-poll",
        }),
      );
      setLastUpdatedAt(Date.now());
      setError("");
    } catch (e) {
      if (!mountedRef.current || requestSeq !== inFlightRef.current.seq) return;
      if (initial) setTicket(null);
      setError(e?.message || "Failed to load ticket details.");
    } finally {
      activeFetchCountRef.current = Math.max(0, activeFetchCountRef.current - 1);
      if (mountedRef.current && requestSeq === inFlightRef.current.seq) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    if (!id) return;
    void load({ initial: true });
  }, [id]);

  useEffect(() => {
    if (!id) return undefined;
    let intervalId = null;
    const clear = () => {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const tick = () => {
      if (document.visibilityState === "visible") {
        void load({ initial: false, poll: true });
      }
    };
    const start = () => {
      clear();
      if (document.visibilityState !== "visible") return;
      intervalId = window.setInterval(tick, TICKET_DETAIL_POLL_MS);
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") clear();
      else start();
    };
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clear();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [id]);

  const title = useMemo(() => {
    return (
      safeStr(ticket?.title) ||
      safeStr(ticket?.subject) ||
      safeStr(ticket?.summary) ||
      `Ticket #${id}`
    );
  }, [ticket, id]);

  const status = normalizeTicketStatus(ticket?.status);
  const statusLabel = getTicketStatusLabel(status);
  const createdAt = ticket?.createdAt
    ? new Date(ticket.createdAt).toLocaleString()
    : "";
  const resolved = normalizeTicketStatus(status) === "RESOLVED";

  const handleSendReply = async (text) => {
    if (!id || !text.trim()) return;
    if (resyncRef.current.active) return;
    const seq = (resyncRef.current.seq += 1);
    resyncRef.current.active = true;
    try {
      await ticketsBackend.reply({
        ticketId: id,
        id,
        message: text,
        body: text,
      });
      showSuccess("Reply sent");
      // Safe refetch; merge prevents duplicates.
      await load({ initial: false });
    } catch (err) {
      showError(err?.message || "Could not send reply");
      // Resync anyway in case backend accepted but UI missed.
      await load({ initial: false });
    } finally {
      // Only clear if still the latest send attempt.
      if (seq === resyncRef.current.seq) {
        resyncRef.current.active = false;
      }
    }
  };

  const handleResolveTicket = async () => {
    if (!id) return;
    try {
      await ticketsBackend.resolve(id);
      showSuccess("Ticket marked as resolved");
      await load({ initial: false });
    } catch (err) {
      showError(err?.message || "Could not resolve ticket");
    }
  };

  const cardShell = {
    background: "linear-gradient(145deg, #ffffff 0%, #f8fbff 100%)",
    border: "1px solid rgba(37,99,235,0.12)",
    boxShadow: "0 10px 26px rgba(15,23,42,0.08)",
    borderRadius: 16,
    overflow: "hidden",
  };

  const statusTone =
    normalizeTicketStatus(status) === "RESOLVED"
      ? "#15803d"
      : normalizeTicketStatus(status) === "PENDING"
        ? "#92400e"
        : "#1d4ed8";

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <button
          type="button"
          onClick={handleBack}
          style={{
            border: "1px solid rgba(148,163,184,0.5)",
            background: "#fff",
            borderRadius: 12,
            padding: "8px 10px",
            cursor: "pointer",
            fontWeight: 900,
          }}
        >
          ← Back to Tickets
        </button>
        <Link to="/support/ticket" style={{ color: "#2563eb", fontWeight: 900 }}>
          Raise a new ticket
        </Link>
      </div>

      <div style={cardShell}>
        {loading ? <PageLoading title="Loading ticket..." /> : null}
        {!loading && error ? <PageError message={error} onRetry={() => void load()} /> : null}

        {!loading && !error && ticket ? (
          <div style={{ padding: 16 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                alignItems: "flex-start",
                marginBottom: 12,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>
                  Ticket #{safeStr(ticket?.id) || safeStr(id)}
                  {createdAt ? ` · Created ${createdAt}` : ""}
                </div>
                <h1
                  style={{
                    margin: "6px 0 0",
                    fontSize: 22,
                    letterSpacing: "-0.2px",
                    color: "#0f172a",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {title}
                </h1>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {!resolved && (
                  <button
                    type="button"
                    onClick={handleResolveTicket}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 12,
                      border: "1px solid #16a34a",
                      background: "#16a34a",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Resolve Ticket
                  </button>
                )}
                <span
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: `1px solid ${statusTone}33`,
                    background: `${statusTone}14`,
                    fontSize: 11,
                    fontWeight: 950,
                    color: statusTone,
                  }}
                >
                  {statusLabel}
                </span>
              </div>
            </div>

            {safeStr(ticket?.description || ticket?.message) ? (
              <div
                style={{
                  marginBottom: 14,
                  padding: 12,
                  borderRadius: 14,
                  border: "1px solid rgba(148,163,184,0.22)",
                  background: "#ffffff",
                  color: "#334155",
                  lineHeight: 1.55,
                }}
              >
                {safeStr(ticket?.description || ticket?.message)}
              </div>
            ) : null}
            <TicketConversation
              title="Conversation"
              meta={`Ticket #${safeStr(ticket?.id) || safeStr(id)}`}
              status={status}
              messages={messages}
              viewerIsAdmin={false}
              canReply={!resolved}
              resolvedNotice={resolved}
              rightLabel="You"
              leftLabel="Support"
              onSend={handleSendReply}
            />
            <div style={{ marginTop: 10, color: "#64748b", fontSize: 12, fontWeight: 700 }}>
              {refreshing ? "Checking for updates…" : lastUpdatedAt ? "Updated just now" : ""}
            </div>
          </div>
        ) : null}

        {/* Premium skeleton for first load without layout jump */}
        {loading ? (
          <div style={{ padding: 16 }}>
            <div className="s-skeleton s-line s-w-60 s-h-18" />
            <div style={{ height: 10 }} />
            <div className="s-skeleton s-line s-w-85" />
            <div style={{ height: 8 }} />
            <div className="s-skeleton s-line s-w-40" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
