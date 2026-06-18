import { useId, useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatUsageCount } from "../utils/usageTimeseries";
import "./AppUsageChart.css";

const CHART_HEIGHT = 268;

function UsageTooltipContent({ active, payload, label, appName }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  const usageVal = row?.usage;
  const time = label ?? row?.timeLabel ?? "";
  return (
    <div className="auc-tooltip">
      <div className="auc-tooltip-app">{appName || "App"}</div>
      <div className="auc-tooltip-time">{time}</div>
      <div className="auc-tooltip-usage">{formatUsageCount(usageVal)} uses</div>
    </div>
  );
}

/**
 * @param {{ rows: Array<{ timeLabel: string, usage: number }>; appName?: string }} props
 */
export default function AppUsageChart({ rows, appName = "App" }) {
  const uid = useId().replace(/:/g, "");
  const gradId = useMemo(() => `auc-bar-${uid}`, [uid]);
  const gradActiveId = useMemo(() => `auc-bar-active-${uid}`, [uid]);

  if (!Array.isArray(rows) || rows.length === 0) return null;

  return (
    <div className="auc-root ud-app-usage-recharts">
      <div className="auc-chart-panel">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart
            data={rows}
            margin={{ top: 18, right: 8, left: 0, bottom: 6 }}
            barCategoryGap="16%"
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7dd3fc" stopOpacity={1} />
                <stop offset="42%" stopColor="#3b82f6" stopOpacity={1} />
                <stop offset="100%" stopColor="#1e40af" stopOpacity={1} />
              </linearGradient>
              <linearGradient id={gradActiveId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#bae6fd" stopOpacity={1} />
                <stop offset="50%" stopColor="#2563eb" stopOpacity={1} />
                <stop offset="100%" stopColor="#1e3a8a" stopOpacity={1} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="4 6"
              vertical={false}
              stroke="rgba(148, 163, 184, 0.35)"
            />
            <XAxis
              dataKey="timeLabel"
              tick={{ fontSize: 11, fill: "#64748b", fontWeight: 600 }}
              interval="preserveStartEnd"
              tickLine={false}
              axisLine={{ stroke: "rgba(148, 163, 184, 0.4)" }}
              tickMargin={10}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#64748b", fontWeight: 600 }}
              allowDecimals={false}
              width={38}
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              label={{ value: "Usage", angle: -90, position: "insideLeft" }}
            />
            <Tooltip
              formatter={(value) => [`${formatUsageCount(value)} uses`, "Usage"]}
              labelFormatter={(label) => label}
            />
            <Bar
              dataKey="usage"
              radius={[12, 12, 6, 6]}
              maxBarSize={56}
              stroke="rgba(255,255,255,0.5)"
              strokeWidth={1}
              isAnimationActive
              animationDuration={560}
              animationEasing="ease-out"
              activeBar={{
                fill: `url(#${gradActiveId})`,
                stroke: "rgba(255,255,255,0.9)",
                strokeWidth: 2,
                radius: [14, 14, 6, 6],
              }}
            >
              {rows.map((_, i) => (
                <Cell
                  key={`cell-${i}`}
                  fill={`url(#${gradId})`}
                  fillOpacity={0.9 + (i % 4) * 0.025}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
