import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error) {
    // Keep silent in UI; console helps during QA.
    console.error("UI ErrorBoundary caught:", error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: 16,
            padding: 18,
            boxShadow: "0 10px 26px rgba(15,23,42,0.08)",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 18, color: "#0f172a" }}>
            Something went wrong
          </div>
          <div style={{ marginTop: 6, color: "#64748b" }}>
            Try refreshing the page. If the issue persists, please contact support.
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                border: "none",
                background: "#2563eb",
                color: "#fff",
                padding: "10px 12px",
                borderRadius: 12,
                cursor: "pointer",
                fontWeight: 900,
              }}
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: null })}
              style={{
                border: "1px solid #dbe2ed",
                background: "#f8fafc",
                color: "#0f172a",
                padding: "10px 12px",
                borderRadius: 12,
                cursor: "pointer",
                fontWeight: 900,
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
}

