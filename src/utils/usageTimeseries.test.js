import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeDailyUsageSeries,
  normalizeHourlyUsageSeries,
  normalizeUsageTimeseriesPayload,
  parseUsageTimestamp,
} from "./usageTimeseries";

const FIXED_NOW = new Date(2026, 5, 4, 14, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("parseUsageTimestamp", () => {
  it("parses backend datetime as local wall time", () => {
    const d = parseUsageTimestamp("2026-06-03 14:00:00");
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(5);
    expect(d?.getDate()).toBe(3);
    expect(d?.getHours()).toBe(14);
    expect(d?.getMinutes()).toBe(0);
  });

  it("parses date-only YYYY-MM-DD", () => {
    const d = parseUsageTimestamp("2026-05-20");
    expect(d?.getDate()).toBe(20);
    expect(d?.getMonth()).toBe(4);
    expect(d?.getHours()).toBe(0);
  });

  it("parses ISO T separator", () => {
    const d = parseUsageTimestamp("2026-06-04T11:30:00");
    expect(d?.getHours()).toBe(11);
    expect(d?.getMinutes()).toBe(30);
  });

  it("returns null for invalid timestamps", () => {
    expect(parseUsageTimestamp("")).toBeNull();
    expect(parseUsageTimestamp("not-a-date")).toBeNull();
    expect(parseUsageTimestamp("2026-13-40 99:00:00")).toBeNull();
  });

  it("does not treat UTC Z suffix as local wall time (falls through safely)", () => {
    const d = parseUsageTimestamp("2026-06-04T09:00:00Z");
    expect(d).not.toBeNull();
  });
});

describe("normalizeHourlyUsageSeries", () => {
  it("always returns exactly 24 chronologically ordered buckets", () => {
    const rows = normalizeHourlyUsageSeries([
      { date: "2026-06-04 10:00:00", opens: 1 },
      { date: "2026-06-04 12:00:00", opens: 2 },
    ]);
    expect(rows).toHaveLength(24);
    expect(rows[0].bucketMs).toBeLessThan(rows[23].bucketMs);
    expect(rows[rows.length - 1].bucketMs).toBe(
      new Date(2026, 5, 4, 14, 0, 0, 0).getTime(),
    );
  });

  it("zero-fills sparse hourly data", () => {
    const rows = normalizeHourlyUsageSeries([
      { date: "2026-06-04 11:00:00", opens: 4 },
    ]);
    expect(rows).toHaveLength(24);
    expect(rows.filter((r) => r.usage > 0)).toHaveLength(1);
    expect(rows.find((r) => r.usage === 4)?.rawTime).toBe("2026-06-04 11:00:00");
  });

  it("keeps midnight buckets distinct across days", () => {
    const rows = normalizeHourlyUsageSeries([
      { date: "2026-06-03 23:00:00", opens: 5 },
      { date: "2026-06-04 00:00:00", opens: 3 },
    ]);
    const hits = rows.filter((r) => r.usage > 0);
    expect(hits).toHaveLength(2);
    expect(hits[0].bucketMs).not.toBe(hits[1].bucketMs);
  });

  it("ignores rows with unparseable timestamps", () => {
    const rows = normalizeHourlyUsageSeries([
      { date: "bad-value", opens: 9 },
      { date: "2026-06-04 13:00:00", opens: 2 },
    ]);
    expect(rows).toHaveLength(24);
    expect(rows.reduce((s, r) => s + r.usage, 0)).toBe(2);
  });
});

describe("normalizeDailyUsageSeries", () => {
  it("returns exactly 7 buckets for 7d", () => {
    const rows = normalizeDailyUsageSeries(
      [{ date: "2026-06-01", opens: 3 }, { date: "2026-06-04", opens: 1 }],
      7,
    );
    expect(rows).toHaveLength(7);
    expect(rows[rows.length - 1].rawTime).toBe("2026-06-04");
    expect(rows.reduce((s, r) => s + r.usage, 0)).toBe(4);
  });

  it("returns exactly 30 buckets for 30d with zero-fill", () => {
    const rows = normalizeDailyUsageSeries(
      [{ date: "2026-05-12", opens: 2 }, { date: "2026-06-04", opens: 1 }],
      30,
    );
    expect(rows).toHaveLength(30);
    expect(rows.filter((r) => r.usage > 0)).toHaveLength(2);
    expect(rows[0].bucketMs).toBeLessThan(rows[29].bucketMs);
  });

  it("returns empty for invalid dayCount", () => {
    expect(normalizeDailyUsageSeries([{ date: "2026-06-01", opens: 1 }], 14)).toEqual([]);
  });
});

describe("normalizeUsageTimeseriesPayload", () => {
  it("unwraps envelope and maps opens for 24h", () => {
    const out = normalizeUsageTimeseriesPayload(
      {
        data: [
          { date: "2026-06-04 10:00:00", opens: 1 },
          { date: "2026-06-04 13:00:00", opens: 2 },
        ],
      },
      "hour",
      "24h",
    );
    expect(out).toHaveLength(24);
    expect(out.reduce((s, r) => s + r.usage, 0)).toBe(3);
    expect(out.every((r) => r.axisKey && r.tooltipTime)).toBe(true);
  });

  it("handles sparse 7d API data", () => {
    const out = normalizeUsageTimeseriesPayload(
      { data: [{ date: "2026-06-02", opens: 5 }] },
      "day",
      "7d",
    );
    expect(out).toHaveLength(7);
    expect(out.find((r) => r.usage === 5)?.rawTime).toBe("2026-06-02");
  });

  it("handles sparse 30d API data", () => {
    const out = normalizeUsageTimeseriesPayload(
      {
        data: [
          { date: "2026-05-15", opens: 1 },
          { date: "2026-06-04", opens: 3 },
        ],
      },
      "day",
      "30d",
    );
    expect(out).toHaveLength(30);
    expect(out.reduce((s, r) => s + r.usage, 0)).toBe(4);
  });

  it("does not mis-parse data array of objects as numeric values", () => {
    const out = normalizeUsageTimeseriesPayload(
      { data: [{ date: "2026-06-04 12:00:00", opens: 7 }] },
      "hour",
      "24h",
    );
    expect(out.find((r) => r.usage === 7)).toBeTruthy();
  });

  it("returns empty for empty envelope", () => {
    expect(normalizeUsageTimeseriesPayload({ data: [] }, "day", "7d")).toEqual([]);
  });
});
