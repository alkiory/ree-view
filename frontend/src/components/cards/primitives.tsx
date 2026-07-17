import type { ComponentType, ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  C,
  THEME_STORAGE_KEY,
  DEFAULT_THEME,
  type Theme,
} from "../../libs/design-tokens";

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = "" }: CardProps) {
  return (
    <div
      className={`rounded-2xl border ${className}`}
      style={{ background: C.surface, borderColor: C.border }}
    >
      {children}
    </div>
  );
}

interface SparklineProps {
  data: readonly number[];
  color: string;
  height?: number;
}

/**
 * Sparkline SVG mínima para KPI (sustituye `<LineChart>` por inline
 * SVG para evitar el overhead de un `<ResponsiveContainer>` por
 * sparkline × 4 KPIs).
 */
export function Sparkline({ data, color, height = 32 }: SparklineProps) {
  if (data.length === 0) {
    return <div style={{ height, width: "100%" }} aria-hidden="true" />;
  }
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 100;
  const h = 32;
  const stepX = w / Math.max(data.length - 1, 1);

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const areaPoints = `${points.join(" ")} ${w.toFixed(2)},${h} 0,${h}`;

  return (
    <div style={{ height, width: "100%" }} aria-hidden="true">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        style={{ display: "block" }}
      >
        <polygon points={areaPoints} fill={color} opacity="0.15" />
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

interface SectionLabelProps {
  icon?: IconComponent;
  children: ReactNode;
}

export function SectionLabel({ icon: Icon, children }: SectionLabelProps) {
  return (
    <div className="flex items-center gap-2 px-5 pt-5">
      {Icon && <Icon size={15} color={C.muted} />}
      <span
        className="text-[11px] font-semibold tracking-[0.14em] uppercase"
        style={{ color: C.muted, fontFamily: "'Space Grotesk', sans-serif" }}
      >
        {children}
      </span>
    </div>
  );
}

interface KPIProps {
  icon: IconComponent;
  label: string;
  value: string;
  unit?: string;
  accent: string;
  sub?: string;
  spark?: readonly number[];
}

export function KPI({
  icon: Icon,
  label,
  value,
  unit,
  accent,
  sub,
  spark,
}: KPIProps) {
  return (
    <Card className="flex-1 min-w-[190px]">
      <div className="p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span
            className="text-[11px] font-semibold tracking-[0.1em] uppercase"
            style={{ color: C.muted }}
          >
            {label}
          </span>
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: `${accent}1A` }}
          >
            <Icon size={14} color={accent} />
          </div>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span
            className="text-[26px] font-medium leading-none"
            style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.text }}
          >
            {value}
          </span>
          {unit && (
            <span className="text-xs" style={{ color: C.muted }}>
              {unit}
            </span>
          )}
        </div>
        {sub && (
          <span className="text-[11px]" style={{ color: C.muted }}>
            {sub}
          </span>
        )}
        {spark && spark.length > 0 && (
          <div className="-mx-1">
            <Sparkline data={spark} color={accent} />
          </div>
        )}
      </div>
    </Card>
  );
}

export interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
}

export type IconComponent = ComponentType<IconProps>;

interface CreateIconArgs {
  paths: ReactNode;
  viewBox?: string;
}

function createIcon({
  paths,
  viewBox = "0 0 24 24",
}: CreateIconArgs): IconComponent {
  const Icon: IconComponent = ({
    size = 24,
    color = "currentColor",
    strokeWidth = 2,
    className = "",
  }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      width={size}
      height={size}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {paths}
    </svg>
  );
  return Icon;
}

export const Zap = Object.assign(
  createIcon({
    paths: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  }),
  { displayName: "Zap" },
);

export const Gauge = Object.assign(
  createIcon({
    paths: (
      <>
        <path d="M12 14v8" />
        <path d="M3.34 19a10 10 0 1 1 17.32 0" />
        <path d="M7 11h10" />
      </>
    ),
  }),
  { displayName: "Gauge" },
);

export const ArrowLeftRight = Object.assign(
  createIcon({
    paths: (
      <>
        <path d="M8 3 4 7l4 4" />
        <path d="M4 7h16" />
        <path d="m16 21 4-4-4-4" />
        <path d="M20 17H4" />
      </>
    ),
  }),
  { displayName: "ArrowLeftRight" },
);

export const Battery = Object.assign(
  createIcon({
    paths: (
      <>
        <rect width="18" height="12" x="1" y="6" rx="2" ry="2" />
        <line x1="22" y1="11" x2="22" y2="13" />
        <line x1="6" y1="10" x2="6" y2="13" />
        <line x1="11" y1="10" x2="11" y2="13" />
        <line x1="16" y1="10" x2="16" y2="13" />
      </>
    ),
  }),
  { displayName: "Battery" },
);

export const Leaf = Object.assign(
  createIcon({
    paths: (
      <>
        <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.96c.95 1.95.94 6.92-1.83 9.4-2.43 2.36-6.74 2.42-7.86 2.64L11 20Z" />
        <path d="M2 21c0-3 1.85-5.36 5.08-6" />
      </>
    ),
  }),
  { displayName: "Leaf" },
);

export const Factory = Object.assign(
  createIcon({
    paths: (
      <path d="M2 20V8a2 2 0 0 1 2-2h2v4l3-3h2v4l3-3h2v4l3-3h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z" />
    ),
  }),
  { displayName: "Factory" },
);

export const Radio = Object.assign(
  createIcon({
    paths: (
      <>
        <path d="M4 5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H4Z" />
        <circle cx="12" cy="12" r="2" />
        <path d="M18 9h.01" />
        <path d="M6 9h.01" />
      </>
    ),
  }),
  { displayName: "Radio" },
);

export const CalendarDays = Object.assign(
  createIcon({
    paths: (
      <>
        <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <path d="M8 14h.01" />
        <path d="M12 14h.01" />
        <path d="M16 14h.01" />
        <path d="M8 18h.01" />
        <path d="M12 18h.01" />
      </>
    ),
  }),
  { displayName: "CalendarDays" },
);

export const ChevronDown = Object.assign(
  createIcon({ paths: <polyline points="6 9 12 15 18 9" /> }),
  { displayName: "ChevronDown" },
);

export const ICONS = {
  Zap,
  Gauge,
  ArrowLeftRight,
  Battery,
  Leaf,
  Factory,
  Radio,
  CalendarDays,
  ChevronDown,
} as const;

export const Sun = Object.assign(
  createIcon({
    paths: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </>
    ),
  }),
  { displayName: "Sun" },
);

export const Moon = Object.assign(
  createIcon({
    paths: (
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    ),
  }),
  { displayName: "Moon" },
);

interface ThemeToggleProps {
  className?: string;
}

/**
 * Toggle de tema claro/oscuro. Persiste en `localStorage` y muta
 * `data-theme` en `<html>` (CSS `var(--c-*)` resuelve el flip sin
 * re-render de React). FOUC-prevent se hace en `index.html`.
 */
export function ThemeToggle({ className = "" }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return DEFAULT_THEME;
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : DEFAULT_THEME;
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // localStorage puede estar deshabilitado (modo privado Safari, etc).
    }
  }, [theme]);

  const next: Theme = theme === "dark" ? "light" : "dark";
  const label = `Cambiar a tema ${next === "dark" ? "oscuro" : "claro"}`;

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11px] font-medium transition-opacity hover:opacity-80 active:opacity-60 ${className}`}
      style={{ borderColor: C.border, color: C.muted }}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
      data-current-theme={theme}
    >
      {next === "light" ? <Sun size={13} /> : <Moon size={13} />}
      {next === "light" ? "Claro" : "Oscuro"}
    </button>
  );
}
