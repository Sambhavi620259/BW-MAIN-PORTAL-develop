const styles = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    padding: "32px 16px",
    textAlign: "center",
  },
  icon: {
    fontSize: "28px",
    lineHeight: 1,
  },
  message: {
    margin: 0,
    fontSize: "14px",
    color: "#6b7280",
    maxWidth: "320px",
  },
  button: {
    marginTop: "4px",
    padding: "7px 18px",
    fontSize: "13px",
    fontWeight: 500,
    color: "#fff",
    background: "#ef4444",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    transition: "background 0.15s",
  },
};

export default function ErrorState({
  message = "Something went wrong.",
  onRetry,
}) {
  return (
    <div style={styles.wrapper}>
      <span style={styles.icon}>⚠️</span>
      <p style={styles.message}>{message}</p>
      {onRetry && (
        <button
          style={styles.button}
          onClick={onRetry}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#dc2626")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "#ef4444")}
        >
          Retry
        </button>
      )}
    </div>
  );
}
