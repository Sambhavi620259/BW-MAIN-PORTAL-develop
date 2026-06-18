import { extractApiArrayAndMeta, peelRepeatedApiEnvelope } from "./apiEnvelope";

/** @param {string} range */
export function usageIntervalForRange(range) {
  return range === "24h" ? "hour" : "day";
}

/**
 * Parse backend usage timestamps (e.g. "2026-06-03 14:00:00") as local wall time.
 * @param {string | number | Date | null | undefined} raw
 * @returns {Date | null}
 */
export function parseUsageTimestamp(raw) {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date) {
    const t = raw.getTime();
    return Number.isNaN(t) ? null : raw;
  }

  const s = String(raw).trim();
  const dateOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const y = Number(dateOnly[1]);
    const mo = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;
    const d = new Date(y, mo - 1, day, 0, 0, 0, 0);
    if (Number.isNaN(d.getTime()) || d.getMonth() !== mo - 1 || d.getDate() !== day) {
      return null;
    }
    return d;
  }

  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/,
  );
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const day = Number(m[3]);
    const h = Number(m[4]);
    const min = Number(m[5]);
    const sec = Number(m[6] ?? 0);
    if (
      mo < 1 ||
      mo > 12 ||
      day < 1 ||
      day > 31 ||
      h > 23 ||
      min > 59 ||
      sec > 59
    ) {
      return null;
    }
    const d = new Date(y, mo - 1, day, h, min, sec, 0);
    if (
      Number.isNaN(d.getTime()) ||
      d.getMonth() !== mo - 1 ||
      d.getDate() !== day ||
      d.getHours() !== h
    ) {
      return null;
    }
    return d;
  }

  if (typeof raw === "number" || /^\d+$/.test(s)) {
    const n = Number(raw);
    if (n >= 0 && n <= 23) {
      const now = new Date();
      return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        n,
        0,
        0,
        0,
      );
    }
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** @param {Date} d */
function floorToHour(d) {
  const x = new Date(d.getTime());
  x.setMinutes(0, 0, 0);
  return x;
}

/** @param {Date} d */
function hourBucketMs(d) {
  return floorToHour(d).getTime();
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Hour-only X-axis label (full date belongs in tooltip). */
export function format24hAxisLabelHourOnly(slot) {
  return slot.toLocaleString("en-US", {
    hour: "numeric",
    hour12: true,
  });
}

/** @param {Date} slot */
export function format24hTooltipTime(slot) {
  return slot.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** @param {Date} d */
function formatBackendDateTime(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}:00`;
}

/**
 * @param {string} backendDate
 * @param {Date} slot
 */
export function formatBackendUsageTooltip(backendDate, slot) {
  const trimmed = String(backendDate ?? "").trim();
  if (trimmed) {
    const d = parseUsageTimestamp(trimmed);
    if (d) return format24hTooltipTime(d);
    return trimmed;
  }
  return format24hTooltipTime(slot);
}

function currentHourBucketMs() {
  return floorToHour(new Date()).getTime();
}

function currentDayBucketMs() {
  return floorToDay(new Date()).getTime();
}

/** @param {Record<string, unknown>} row */
function rowTimestampRaw(row) {
  return (
    row?.date ??
    row?.rawTime ??
    row?.time ??
    row?.timestamp ??
    row?.at ??
    row?.bucket ??
    row?.day
  );
}

/**
 * @param {number} endMs
 */
function build24HourWindowEndingAt(endMs) {
  const end = floorToHour(new Date(endMs));
  return Array.from({ length: 24 }, (_, i) => {
    const slot = new Date(end.getTime());
    slot.setHours(slot.getHours() - (23 - i));
    return slot.getTime();
  });
}

/**
 * Rolling last 24 hours; zero-fills missing hourly buckets.
 * @param {Array<Record<string, unknown>>} rows
 */
export function normalizeHourlyUsageSeries(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];

  /** @type {Map<number, { usage: number, backendDate: string }>} */
  const byBucket = new Map();

  for (const row of rows) {
    const raw = rowTimestampRaw(row);
    const d = parseUsageTimestamp(raw);
    if (!d) continue;
    const key = hourBucketMs(d);
    const usage = pickUsageMetric(row);
    const backendDate =
      typeof raw === "string" && raw.trim() ? raw.trim() : formatBackendDateTime(d);
    const prev = byBucket.get(key);
    byBucket.set(key, {
      usage: (prev?.usage || 0) + usage,
      backendDate: prev?.backendDate || backendDate,
    });
  }

  if (!byBucket.size) return [];

  const sortedMs = [...byBucket.keys()].sort((a, b) => a - b);
  const maxMs = sortedMs[sortedMs.length - 1];
  const endMs = Math.max(currentHourBucketMs(), maxMs);
  const slotMsList = build24HourWindowEndingAt(endMs);

  return slotMsList.map((ms) => {
    const slot = new Date(ms);
    const entry = byBucket.get(ms);
    const backendDate = entry?.backendDate ?? formatBackendDateTime(slot);
    return {
      bucketMs: ms,
      axisKey: String(ms),
      timeLabel: format24hAxisLabelHourOnly(slot),
      tooltipTime: formatBackendUsageTooltip(backendDate, slot),
      usage: entry?.usage || 0,
      rawTime: backendDate,
    };
  });
}

/** @param {Date} d */
function floorToDay(d) {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}

/** @param {Date} d */
function dayBucketMs(d) {
  return floorToDay(d).getTime();
}

/** @param {Date} slot */
export function formatDailyAxisLabel(slot) {
  return slot.toLocaleString("en-US", { month: "short", day: "numeric" });
}

/** @param {Date} slot @param {string} [backendDate] */
export function formatDailyUsageTooltip(slot, backendDate = "") {
  const trimmed = String(backendDate ?? "").trim();
  if (trimmed) {
    const d = parseUsageTimestamp(trimmed);
    if (d) {
      return d.toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  }
  return slot.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** @param {Date} d */
function formatBackendDateOnly(d) {
  return localDateKey(d);
}

/**
 * @param {number} endMs
 * @param {number} dayCount
 */
function buildDayWindowEndingAt(endMs, dayCount) {
  const end = floorToDay(new Date(endMs));
  return Array.from({ length: dayCount }, (_, i) => {
    const slot = new Date(end.getTime());
    slot.setDate(slot.getDate() - (dayCount - 1 - i));
    return slot.getTime();
  });
}

/**
 * Rolling last 7 / 30 days; zero-fills missing daily buckets.
 * @param {Array<Record<string, unknown>>} rows
 * @param {7 | 30} dayCount
 */
export function normalizeDailyUsageSeries(rows, dayCount) {
  if (!Array.isArray(rows) || !rows.length || (dayCount !== 7 && dayCount !== 30)) {
    return [];
  }

  /** @type {Map<number, { usage: number, backendDate: string }>} */
  const byBucket = new Map();

  for (const row of rows) {
    const raw = rowTimestampRaw(row);
    const d = parseUsageTimestamp(raw);
    if (!d) continue;
    const key = dayBucketMs(d);
    const usage = pickUsageMetric(row);
    let backendDate =
      typeof raw === "string" && raw.trim() ? raw.trim() : formatBackendDateOnly(d);
    if (/^\d{4}-\d{2}-\d{2}/.test(backendDate)) {
      backendDate = backendDate.slice(0, 10);
    }
    const prev = byBucket.get(key);
    byBucket.set(key, {
      usage: (prev?.usage || 0) + usage,
      backendDate: prev?.backendDate || backendDate,
    });
  }

  if (!byBucket.size) return [];

  const sortedMs = [...byBucket.keys()].sort((a, b) => a - b);
  const maxMs = sortedMs[sortedMs.length - 1];
  const endMs = Math.max(currentDayBucketMs(), maxMs);
  const slotMsList = buildDayWindowEndingAt(endMs, dayCount);

  return slotMsList.map((ms) => {
    const slot = new Date(ms);
    const entry = byBucket.get(ms);
    const backendDate = entry?.backendDate ?? formatBackendDateOnly(slot);
    const axisKey = backendDate.slice(0, 10);
    return {
      bucketMs: ms,
      axisKey,
      timeLabel: formatDailyAxisLabel(slot),
      tooltipTime: formatDailyUsageTooltip(slot, backendDate),
      usage: entry?.usage || 0,
      rawTime: backendDate,
    };
  });
}

function pickUsageMetric(row) {
  if (row == null) return 0;
  if (typeof row === "number") return Number.isFinite(row) ? row : 0;
  if (typeof row !== "object") return 0;
  const candidates = [
    row.usage,
    row.usageCount,
    row.usage_count,
    row.count,
    row.value,
    row.total,
    row.opens,
    row.openCount,
    row.hits,
    row.sessions,
    row.metric,
  ];
  for (const c of candidates) {
    const num = Number(c);
    if (Number.isFinite(num)) return num;
  }
  return 0;
}

/** Backend sometimes returns parallel `labels` + `values` instead of row objects. */
function rowsFromLabelValueArrays(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return [];
  const r = /** @type {Record<string, unknown>} */ (node);
  const labels = r.labels ?? r.label ?? r.dates ?? r.days;
  const values =
    r.values ?? r.counts ?? r.usageValues ?? r.metrics ?? r.data;
  if (!Array.isArray(values) || !values.length) return [];
  if (typeof values[0] === "object" && values[0] !== null) return [];
  if (Array.isArray(labels) && labels.length) {
    const len = Math.min(labels.length, values.length);
    if (!len) return [];
    return Array.from({ length: len }, (_, i) => ({
      label: labels[i],
      time: labels[i],
      date: labels[i],
      usage: values[i],
      count: values[i],
      value: values[i],
    }));
  }
  return values.map((v, i) => ({
    usage: v,
    count: v,
    value: v,
    time: i,
    hour: i,
  }));
}

const TIMESERIES_ARRAY_KEYS = [
  "timeseries",
  "timeSeries",
  "analytics",
  "usageData",
  "usageSeries",
  "dailyUsage",
  "history",
  "dataPoints",
  "entries",
  "chartData",
  "points",
  "series",
  "buckets",
  "items",
  "values",
  "data",
];

function arrayFromObjectKeys(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  const r = /** @type {Record<string, unknown>} */ (obj);
  const usageArr = r.usage;
  if (Array.isArray(usageArr) && usageArr.length) {
    if (typeof usageArr[0] === "object") return usageArr;
    return rowsFromLabelValueArrays({ values: usageArr });
  }
  for (const key of TIMESERIES_ARRAY_KEYS) {
    const candidate = r[key];
    if (Array.isArray(candidate) && candidate.length) return candidate;
  }
  return [];
}

/** Unwrap GET /dashboard/app-usage-timeseries list shapes (envelope + nested keys). */
function extractUsageTimeseriesPoints(body) {
  if (body == null) return [];

  const labelValueRows = rowsFromLabelValueArrays(body);
  if (labelValueRows.length) return labelValueRows;

  const primary = extractApiArrayAndMeta(body);
  if (primary.items.length) return primary.items;

  const peeled = peelRepeatedApiEnvelope(body);
  const fromPeeled = arrayFromObjectKeys(peeled);
  if (fromPeeled.length) return fromPeeled;

  const legacy = body?.data !== undefined ? body.data : body;
  const lvLegacy = rowsFromLabelValueArrays(legacy);
  if (lvLegacy.length) return lvLegacy;
  if (Array.isArray(legacy)) return legacy;
  return arrayFromObjectKeys(legacy);
}

/**
 * @param {string | number | Date} rawTime
 * @param {"hour" | "day"} granularity
 */
export function formatUsageAxisTime(rawTime, granularity) {
  if (rawTime == null || rawTime === "") return "";

  if (granularity === "hour") {
    const parsed = parseUsageTimestamp(rawTime);
    if (parsed) return format24hAxisLabelHourOnly(parsed);
  }

  if (
    granularity === "hour" &&
    (typeof rawTime === "number" || /^\d{1,2}$/.test(String(rawTime).trim()))
  ) {
    const hour = Number(rawTime);
    if (hour >= 0 && hour <= 23) {
      return new Date(2000, 0, 1, hour, 0, 0).toLocaleString("en-US", {
        hour: "numeric",
        hour12: true,
      });
    }
  }

  const d = parseUsageTimestamp(rawTime) ?? new Date(rawTime);
  if (Number.isNaN(d.getTime())) return String(rawTime);

  if (granularity === "hour") {
    return format24hAxisLabelHourOnly(d);
  }

  return d.toLocaleString("en-US", { month: "short", day: "numeric" });
}

export function formatUsageCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

function localDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** GET /dashboard/app-usage-timeseries — points for Recharts */
export function normalizeUsageTimeseriesPayload(
  body,
  granularity = "day",
  range = "7d",
) {
  const raw = extractUsageTimeseriesPoints(body);
  if (!raw.length) return [];

  if (granularity === "hour" && range === "24h") {
    return normalizeHourlyUsageSeries(raw);
  }

  if (granularity === "day" && range === "7d") {
    return normalizeDailyUsageSeries(raw, 7);
  }

  if (granularity === "day" && range === "30d") {
    return normalizeDailyUsageSeries(raw, 30);
  }

  const normalized = raw.map((row, i) => {
    if (typeof row === "number") {
      return {
        timeLabel: formatUsageAxisTime(i, granularity) || `T${i + 1}`,
        usage: Number.isFinite(row) ? row : 0,
        rawTime: String(i),
      };
    }

    const rawTime = rowTimestampRaw(row);
    const usage = pickUsageMetric(row);
    let timeLabel = String(row?.label ?? row?.timeLabel ?? "").trim();
    if (!timeLabel && rawTime != null && rawTime !== "") {
      timeLabel = formatUsageAxisTime(rawTime, granularity);
    }
    if (!timeLabel) timeLabel = `T${i + 1}`;

    return {
      timeLabel,
      usage,
      rawTime: rawTime != null ? String(rawTime) : `i-${i}`,
    };
  });

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log("[usageTimeseries] normalized", normalized.length, "points", normalized);
  }

  return normalized;
}
