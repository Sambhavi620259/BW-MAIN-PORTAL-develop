import { useEffect, useMemo, useRef, useState } from "react";
import { isNearBottom, normalizeMessageSender } from "../utils/ticketConversation";
import "./TicketConversation.css";

function safeStr(v) {
  const s = String(v ?? "").trim();
  return s && s !== "null" ? s : "";
}

function formatTime(isoOrMs) {
  if (!isoOrMs) return "";
  const d = typeof isoOrMs === "number" ? new Date(isoOrMs) : new Date(String(isoOrMs));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function useAutosizeTextArea(textareaRef, value) {
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, 160);
    el.style.height = `${Math.max(next, 42)}px`;
  }, [textareaRef, value]);
}

/**
 * CSS layout: class `user` = right / blue bubble; class `admin` = left / grey bubble.
 * End-user portal: viewer is the customer → own messages use `user` (right).
 * Admin portal: viewer is staff → own (admin) messages use `user` (right).
 */
function bubbleCssSide(isAdminMessage, viewerIsAdmin) {
  if (viewerIsAdmin) {
    return isAdminMessage ? "user" : "admin";
  }
  return isAdminMessage ? "admin" : "user";
}

/**
 * TicketConversation
 * A shared, production-safe chat thread renderer + composer.
 *
 * Props:
 * - title, meta, status
 * - messages: [{ id, senderType?: "USER"|"ADMIN", text, createdAtMs, createdAtIso, ...raw backend fields }]
 * - viewerIsAdmin: when true, admin/staff messages align right (blue); when false (default), user messages align right.
 * - canReply, resolvedNotice, onSend, rightLabel / leftLabel, headerActions
 */
export default function TicketConversation({
  title,
  meta,
  status,
  messages,
  viewerIsAdmin = false,
  canReply,
  resolvedNotice,
  onSend,
  rightLabel = "You",
  leftLabel = "Support",
  headerActions = null,
}) {
  const streamRef = useRef(null);
  const textareaRef = useRef(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  useAutosizeTextArea(textareaRef, draft);

  const statusPill = useMemo(() => {
    const s = safeStr(status).toUpperCase();
    if (!s) return null;
    const cls = s === "RESOLVED" ? "tc-status-pill resolved" : "tc-status-pill";
    return <span className={cls}>{s}</span>;
  }, [status]);

  // Auto-scroll only if user is already near bottom.
  const lastMessageId = messages?.length ? messages[messages.length - 1]?.id : "";
  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    if (!isNearBottom(el, 140)) return;
    el.scrollTop = el.scrollHeight;
  }, [lastMessageId]);

  const handleKeyDown = async (e) => {
    if (e.key !== "Enter") return;
    if (e.shiftKey) return;
    e.preventDefault();
    await handleSend();
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || !canReply || sending) return;
    setSending(true);
    try {
      await onSend(text);
      setDraft("");
      const el = streamRef.current;
      if (el) {
        // After a successful send, assume user intent is to be at bottom.
        el.scrollTop = el.scrollHeight;
      }
      textareaRef.current?.focus?.();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="tc-shell">
      <div className="tc-head">
        <div style={{ minWidth: 0 }}>
          <h4 style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {safeStr(title) || "Ticket"}
          </h4>
          <div className="tc-head-meta">
            {meta ? <span>{meta}</span> : null}
          </div>
        </div>
        <div className="tc-head-actions">
          {statusPill}
          {headerActions}
        </div>
      </div>

      <div className="tc-stream" ref={streamRef}>
        {Array.isArray(messages) && messages.length ? (
          messages.map((m) => {
            const { isAdminMessage } = normalizeMessageSender(m, { silent: true });
            const cssSide = bubbleCssSide(isAdminMessage, viewerIsAdmin);
            const label = cssSide === "user" ? rightLabel : leftLabel;
            const time = formatTime(m?.createdAtIso || m?.createdAtMs);
            return (
              <div key={m.id} className={`tc-row ${cssSide}`}>
                <div className={`tc-bubble ${cssSide}`}>
                  <div className="tc-bubble-head">
                    <div className="tc-sender">{label}</div>
                    <div className="tc-time">{time}</div>
                  </div>
                  <div className="tc-text">{m.text}</div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="tc-empty">No messages yet.</div>
        )}
      </div>

      <div className="tc-compose">
        {resolvedNotice ? (
          <div className="tc-resolved-banner">Ticket resolved. Replies are disabled.</div>
        ) : null}
        <div className="tc-compose-row">
          <textarea
            ref={textareaRef}
            className="tc-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={canReply ? "Write a message…" : "Replies are disabled for this ticket."}
            disabled={!canReply || sending}
            rows={1}
          />
          <button
            type="button"
            className="tc-send"
            disabled={!canReply || sending || !draft.trim()}
            onClick={() => void handleSend()}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
