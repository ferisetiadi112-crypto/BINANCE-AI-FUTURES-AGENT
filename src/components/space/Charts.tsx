import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Candle } from "@/lib/mock";

const axis = {
  stroke: "var(--color-muted-foreground)",
  fontSize: 10,
  fontFamily: "var(--font-mono)",
};

const tooltipStyle = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-hairline)",
  borderRadius: 4,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--color-popover-foreground)",
};

/** Hand-rolled SVG candlestick chart with terminal styling. */
export function CandleChart({ data, height = 340 }: { data: Candle[]; height?: number }) {
  const w = 1000;
  const h = height;
  const padL = 8;
  const padR = 62;
  const padT = 12;
  const padB = 46;
  const volH = 54;

  const highs = Math.max(...data.map((d) => d.h));
  const lows = Math.min(...data.map((d) => d.l));
  const range = highs - lows || 1;
  const maxVol = Math.max(...data.map((d) => d.v));

  const plotW = w - padL - padR;
  const plotH = h - padT - padB - volH;
  const step = plotW / data.length;
  const bw = Math.max(2, step * 0.58);

  const y = (p: number) => padT + ((highs - p) / range) * plotH;

  const gridLines = 5;
  const last = data[data.length - 1] ?? { t: "", o: 0, h: 1, l: 0, c: 0, v: 0 };

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label="Price candlestick chart">
        {Array.from({ length: gridLines + 1 }).map((_, i) => {
          const yy = padT + (plotH / gridLines) * i;
          const price = highs - (range / gridLines) * i;
          return (
            <g key={i}>
              <line
                x1={padL}
                x2={w - padR}
                y1={yy}
                y2={yy}
                stroke="var(--color-hairline)"
                strokeDasharray="2 6"
                strokeWidth={1}
              />
              <text
                x={w - padR + 8}
                y={yy + 3}
                fill="var(--color-muted-foreground)"
                fontSize={10}
                fontFamily="var(--font-mono)"
              >
                {price.toFixed(0)}
              </text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const x = padL + i * step + step / 2;
          const up = d.c >= d.o;
          const color = up ? "var(--color-gain)" : "var(--color-loss)";
          const top = y(Math.max(d.o, d.c));
          const bh = Math.max(1.5, Math.abs(y(d.o) - y(d.c)));
          const vh = (d.v / maxVol) * volH;
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={y(d.h)} y2={y(d.l)} stroke={color} strokeWidth={1} opacity={0.75} />
              <rect
                x={x - bw / 2}
                y={top}
                width={bw}
                height={bh}
                fill={up ? color : "var(--color-background)"}
                stroke={color}
                strokeWidth={1}
                opacity={up ? 0.9 : 1}
              />
              <rect
                x={x - bw / 2}
                y={h - padB - vh}
                width={bw}
                height={vh}
                fill={color}
                opacity={0.22}
              />
            </g>
          );
        })}

        {/* last price marker */}
        <line
          x1={padL}
          x2={w - padR}
          y1={y(last.c)}
          y2={y(last.c)}
          stroke="var(--color-primary)"
          strokeDasharray="4 4"
          strokeWidth={1}
          opacity={0.85}
        />
        <rect
          x={w - padR + 2}
          y={y(last.c) - 9}
          width={56}
          height={18}
          fill="var(--color-primary)"
          rx={2}
        />
        <text
          x={w - padR + 8}
          y={y(last.c) + 4}
          fill="var(--color-primary-foreground)"
          fontSize={10}
          fontWeight={700}
          fontFamily="var(--font-mono)"
        >
          {last.c.toFixed(0)}
        </text>

        {data.map((d, i) =>
          i % 8 === 0 ? (
            <text
              key={`t${i}`}
              x={padL + i * step + step / 2}
              y={h - 12}
              textAnchor="middle"
              fill="var(--color-muted-foreground)"
              fontSize={9}
              fontFamily="var(--font-mono)"
            >
              {d.t}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

export function EquityChart({
  data,
  height = 220,
}: {
  data: { d: string; equity: number; benchmark: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 6, left: -14, bottom: 0 }}>
        <defs>
          <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.45} />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--color-hairline)" strokeDasharray="2 6" vertical={false} />
        <XAxis dataKey="d" tick={axis} tickLine={false} axisLine={false} interval={6} />
        <YAxis tick={axis} tickLine={false} axisLine={false} width={54} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "var(--color-primary)", strokeOpacity: 0.3 }} />
        <Area
          type="monotone"
          dataKey="benchmark"
          stroke="var(--color-muted-foreground)"
          strokeDasharray="3 3"
          fill="none"
          strokeWidth={1}
          dot={false}
        />
        <Area
          type="monotone"
          dataKey="equity"
          stroke="var(--color-primary)"
          strokeWidth={2}
          fill="url(#eq)"
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SignalRadar({ data }: { data: { label: string; v: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke="var(--color-hairline)" />
        <PolarAngleAxis dataKey="label" tick={{ ...axis, fontSize: 9 }} />
        <Radar
          dataKey="v"
          stroke="var(--color-primary)"
          fill="var(--color-primary)"
          fillOpacity={0.22}
          strokeWidth={2}
        />
        <Tooltip contentStyle={tooltipStyle} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

export function MiniBars({
  data,
  dataKey,
  height = 180,
  negative = false,
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  height?: number;
  negative?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        <CartesianGrid stroke="var(--color-hairline)" strokeDasharray="2 6" vertical={false} />
        <XAxis dataKey="m" tick={axis} tickLine={false} axisLine={false} />
        <YAxis tick={axis} tickLine={false} axisLine={false} width={48} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--color-primary)", fillOpacity: 0.06 }} />
        <Bar dataKey={dataKey} radius={[2, 2, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={negative ? "var(--color-loss)" : "var(--color-primary)"} fillOpacity={0.75} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DualLine({
  data,
  height = 220,
}: {
  data: { cycle: string; accuracy: number; pf: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        <CartesianGrid stroke="var(--color-hairline)" strokeDasharray="2 6" vertical={false} />
        <XAxis dataKey="cycle" tick={axis} tickLine={false} axisLine={false} interval={4} />
        <YAxis yAxisId="l" tick={axis} tickLine={false} axisLine={false} width={44} />
        <YAxis yAxisId="r" orientation="right" tick={axis} tickLine={false} axisLine={false} width={38} />
        <Tooltip contentStyle={tooltipStyle} />
        <Line yAxisId="l" type="monotone" dataKey="accuracy" stroke="var(--color-primary)" strokeWidth={2} dot={false} />
        <Line yAxisId="r" type="monotone" dataKey="pf" stroke="var(--color-cyan-signal)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
